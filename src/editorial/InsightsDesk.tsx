// The Insights desk: how this app's published stories did on Facebook, beside what the AI cost this session.
// Every figure comes from the publish log (what this app did), the insights cache (what Graph answered, with when) or
// useAiUsage (what the AI providers reported). A figure that was never read is a dash; nothing here is a sample.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Seg } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { BarChart } from '../outreach/charts'
import type { FacebookConfig } from './facebook'
import { aiFor, estimateCost, fmtDollars, useAiUsage, usageTotals } from './aiProviders'
import type { AiSettings } from './aiProviders'
import {
  PUBLISHED_EVENT, STALE_MS, blockedReason, cacheAge, fmtAge, formatLabel, inRange, loadInsightsCache, readPublishLog,
  refreshInsights, saveInsightsCache, startOfWeek, toCsv, weeklyTable, weeksOf, writeWeeklySummary,
} from './insights'
import type { InsightsCache, PublishRecord } from './insights'
import { fmtDateTime, fmtTime, useClockFormat } from '../ui/time'

type Range = 7 | 28 | 90
const RANGES: { value: Range; label: string }[] = [{ value: 7, label: '7 days' }, { value: 28, label: '28 days' }, { value: 90, label: '90 days' }]

const n = (v: number | null) => (v == null ? '—' : v.toLocaleString('en-US'))
const tk = (v: number) => (v >= 10_000 ? Math.round(v / 1000) + 'k' : v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(v))
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const clock = (iso: string) => fmtDateTime(iso, { weekday: false })

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Sum of a metric over records, or null when no record has it (so "no figures" never reads as zero). */
function total(records: PublishRecord[], cache: InsightsCache, key: 'impressions' | 'reactions' | 'clicks') {
  let sum = 0, have = 0
  for (const r of records) {
    const v = r.facebookPostId ? cache.posts[r.facebookPostId]?.metrics?.[key] : null
    if (v != null) { sum += v; have++ }
  }
  return { value: have ? sum : null, have }
}

export function InsightsDesk({ fb, ai, onConnectFb }: { fb: FacebookConfig | null; ai: AiSettings; onConnectFb: () => void }) {
  useClockFormat() // re-render when Home → Settings → Time format changes
  const [range, setRange] = useState<Range>(28)
  const [log, setLog] = useState<PublishRecord[]>(readPublishLog)
  const [cache, setCache] = useState<InsightsCache>(loadInsightsCache)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [summary, setSummary] = useState<{ state: 'busy' } | { state: 'ok'; text: string; model: string } | { state: 'bad'; error: string } | null>(null)
  const usageCalls = useAiUsage((s) => s.calls)

  // a story published while the desk is open appears at once; the clock keeps "4 min ago" and the rate-limit gate true
  useEffect(() => {
    const onPub = () => setLog(readPublishLog())
    window.addEventListener(PUBLISHED_EVENT, onPub)
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => { window.removeEventListener(PUBLISHED_EVENT, onPub); clearInterval(t) }
  }, [])

  const records = useMemo(() => inRange(log, range, now), [log, range, now])
  const blocked = blockedReason(cache, fb, now)

  const refresh = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const t = Date.now()
      const r = await refreshInsights(fb, inRange(readPublishLog(), 90, t), loadInsightsCache(), t)
      saveInsightsCache(r.cache)
      setCache(r.cache)
      setNow(Date.now())
    } finally {
      setBusy(false)
    }
  }, [busy, fb])

  // opening the desk reads what is stale (the 15-minute rule inside refreshInsights decides what that is)
  const fbKey = fb ? `${fb.pageId}|${fb.token.length}` : ''
  useEffect(() => {
    if (!fbKey || !log.some((r) => r.facebookPostId)) return
    const t = setTimeout(() => { void refresh() }, 0)
    return () => clearTimeout(t)
  }, [fbKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const ages = records.flatMap((r) => (r.facebookPostId ? [cacheAge(cache.posts[r.facebookPostId], now)] : [])).filter((a): a is number => a != null)
  const pageAge = cacheAge(cache.page, now)
  const oldest = ages.length ? Math.max(...ages) : pageAge
  const onFb = records.filter((r) => r.facebookPostId)
  const impressions = total(records, cache, 'impressions')
  const reactions = total(records, cache, 'reactions')
  const clicks = total(records, cache, 'clicks')
  const usage = usageTotals(usageCalls)
  const cost = estimateCost(usageCalls)

  const bars = onFb
    .filter((r) => cache.posts[r.facebookPostId!]?.metrics?.impressions != null)
    .slice(0, 24)
    .reverse()
    // BarChart keys bars by label, so two stories on one day get "1 Nov" and "1 Nov (2)"
    .map((r, i, all) => { const d = day(r.publishedAt); const k = all.slice(0, i).filter((x) => day(x.publishedAt) === d).length; return { r, label: k ? `${d} (${k + 1})` : d } })
    .map(({ r, label }) => ({ label, tooltip: `${r.headline || r.slug}: ${n(cache.posts[r.facebookPostId!]!.metrics!.impressions)} impressions`, impressions: cache.posts[r.facebookPostId!]!.metrics!.impressions ?? 0 }))

  const weeks = weeksOf(records, cache)
  const thisWeek = weeklyTable(log, cache, startOfWeek(now))
  const reviewAi = aiFor('review', ai)

  const exportCsv = () => {
    const rows = weeks.flatMap((w) => w.rows)
    download(`esb-insights-${range}d-${new Date(now).toISOString().slice(0, 10)}.csv`, toCsv(rows))
  }

  const summarise = async () => {
    setSummary({ state: 'busy' })
    try { setSummary({ state: 'ok', ...(await writeWeeklySummary(thisWeek, reviewAi)) }) } catch (e) { setSummary({ state: 'bad', error: (e as Error).message }) }
  }

  const refreshTip = blocked === 'no-token' ? 'Connect a Facebook Page first'
    : blocked === 'expired-token' ? 'Facebook rejected this Page token. Paste a new one; it will not be tried again'
    : blocked === 'rate-limited' ? `Facebook is limiting requests. Refresh opens again at ${fmtTime(cache.rateLimitedUntil!)}`
    : `Read the figures again from Facebook (each post at most once every ${STALE_MS / 60_000} minutes)`
  const err = cache.lastError

  return (
    <div className="ed-ins" role="main" aria-label="Insights">
      <header className="ed-ins-bar">
        <div className="ed-ins-bar-l">
          <Seg<Range> value={range} onChange={setRange} className="ed-ins-range" options={RANGES.map((r) => ({ value: r.value, label: r.label, tip: `Stories published in the last ${r.label}` }))} />
          <span className="ed-ins-age" aria-live="polite">{busy ? 'Reading Facebook…' : oldest != null ? `Figures from ${fmtAge(oldest)}` : fb ? 'No figures read yet' : 'Facebook not connected'}</span>
        </div>
        <div className="ed-ins-bar-r">
          {reviewAi && thisWeek.length > 0 && (
            <button type="button" className="btn sm ed-ins-ai" onClick={summarise} disabled={summary?.state === 'busy'} data-tip="Ask the Review AI for a short note on this week's table (only the table is sent)">
              <Icon name="sparkle" size={13} /><span>{summary?.state === 'busy' ? 'Writing…' : 'Summarise week'}</span>
            </button>
          )}
          <button type="button" className="btn sm ed-ins-refresh" onClick={refresh} disabled={busy || !!blocked} data-tip={refreshTip}>
            <Icon name="refresh" size={13} /><span>Refresh</span>
          </button>
          <button type="button" className="btn sm ed-ins-export" onClick={exportCsv} disabled={!records.length} data-tip="Download the weekly tables for this range as CSV">
            <Icon name="download" size={13} /><span>Export CSV</span>
          </button>
        </div>
      </header>

      <div className="ed-ins-scroll">
        {!fb && (
          <section className="ed-ins-card ed-ins-unconf">
            <span className="ed-ins-mark"><Icon name="link" size={18} /></span>
            <div>
              <h3>Facebook Page not connected</h3>
              <p>Reach, reactions and clicks come from the Facebook Page the Studio posts to. Connect it with a Page access token that has <b>pages_read_engagement</b> and <b>read_insights</b>. Until then only what this app published is shown.</p>
            </div>
            <button type="button" className="btn sm primary" onClick={onConnectFb}><Icon name="link" size={13} /><span>Connect a Page</span></button>
          </section>
        )}

        {fb && blocked === 'expired-token' && (
          <div className="callout bad ed-ins-note" role="status"><Icon name="alert" size={15} />
            <span>Facebook rejected the Page token: it expired or was revoked. Insights will not try it again. The figures below are the last ones read.</span>
            <button type="button" className="btn xs" onClick={onConnectFb}>Paste a new token</button>
          </div>
        )}
        {fb && blocked === 'rate-limited' && (
          <div className="callout warn ed-ins-note" role="status"><Icon name="clock" size={15} />
            <span>Facebook is limiting requests. Nothing is asked again before {fmtTime(cache.rateLimitedUntil!)}; the figures below are from the cache.</span>
          </div>
        )}
        {fb && !blocked && err && (err.kind === 'offline' || err.kind === 'bad-request' || err.kind === 'denied' || err.kind === 'malformed' || err.kind === 'http') && (
          <div className="callout warn ed-ins-note" role="status"><Icon name="info" size={15} />
            <span>{err.kind === 'bad-request' ? 'Facebook did not accept the insights request (a metric may no longer be offered for this Page or post). ' : ''}{err.message}</span>
          </div>
        )}

        {!log.length ? (
          <section className="ed-ins-card ed-ins-empty">
            <span className="ed-ins-mark"><Icon name="chart" size={18} /></span>
            <h3>Nothing published from this app yet</h3>
            <p>Each story published here is logged with its banner, category and time, and its Facebook figures appear once the Page has them.</p>
          </section>
        ) : (
          <>
            <div className="ed-ins-kpis">
              <div className="ed-ins-kpi" data-kpi="published"><span className="ed-ins-k">Published</span><b>{records.length}</b><i>{onFb.length} on Facebook</i></div>
              <div className="ed-ins-kpi" data-kpi="impressions"><span className="ed-ins-k">Impressions</span><b>{n(impressions.value)}</b><i>{impressions.have ? `from ${impressions.have} of ${onFb.length} posts` : 'not read yet'}</i></div>
              <div className="ed-ins-kpi" data-kpi="reactions"><span className="ed-ins-k">Reactions</span><b>{n(reactions.value)}</b><i>{reactions.have ? `from ${reactions.have} posts` : 'not read yet'}</i></div>
              <div className="ed-ins-kpi" data-kpi="clicks"><span className="ed-ins-k">Clicks</span><b>{n(clicks.value)}</b><i>{clicks.have ? `from ${clicks.have} posts` : 'not read yet'}</i></div>
              <div className="ed-ins-kpi" data-kpi="ai-cost"><span className="ed-ins-k">AI cost</span><b>{cost.priced ? fmtDollars(cost.dollars) : '—'}</b><i>{usage.calls ? `estimate · this session${cost.unpriced ? ` · ${cost.unpriced} unpriced` : ''}` : 'no AI calls this session'}</i></div>
            </div>

            <section className="ed-ins-card ed-ins-chart">
              <BarChart
                title="Impressions by story"
                summary={bars.length ? `${bars.length} ${bars.length === 1 ? 'post' : 'posts'} with figures, oldest first. Hover a bar for the headline.` : undefined}
                data={bars}
                series={[{ key: 'impressions', label: 'Impressions', colorVar: 'var(--ink)' }]}
                emptyText={fb ? 'No post in this range has impressions from Facebook yet.' : 'Connect a Facebook Page to read impressions.'}
              />
              {cache.page?.metrics && (
                <p className="ed-ins-page">Page, last 28 days: <b>{n(cache.page.metrics.impressions)}</b> impressions · <b>{n(cache.page.metrics.engagements)}</b> post engagements{pageAge != null ? ` · read ${fmtAge(pageAge)}` : ''}</p>
              )}
            </section>

            {summary && (
              <section className={'ed-ins-card ed-ins-summary' + (summary.state === 'bad' ? ' bad' : '')} aria-live="polite">
                <span className="ed-ins-k">AI draft · check it against the table</span>
                <p>{summary.state === 'busy' ? 'The Review AI is reading this week’s table…' : summary.state === 'ok' ? summary.text : summary.error}</p>
                {summary.state === 'ok' && <i>Written by {summary.model} from the table only.</i>}
              </section>
            )}

            {!records.length && <p className="hint ed-ins-none">Nothing published in the last {range} days.</p>}
            {weeks.map((w) => (
              <section key={w.weekStart} className="ed-ins-card ed-ins-week" data-week={w.rows[0]?.weekOf}>
                <header className="ed-ins-week-h"><h3>Week of {new Date(w.weekStart).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}</h3><span>{w.rows.length} {w.rows.length === 1 ? 'story' : 'stories'}</span></header>
                <table className="ed-ins-table">
                  <thead><tr><th>Story</th><th>Category</th><th>Banner</th><th>Published</th><th className="r">Impressions</th><th className="r">Reactions</th><th className="r">Clicks</th></tr></thead>
                  <tbody>
                    {w.rows.map((r) => (
                      <tr key={r.slug + r.publishedAt}>
                        <td className="ed-ins-story">{r.headline || r.slug}</td>
                        <td>{r.category}</td>
                        <td>{formatLabel(r.format)}</td>
                        <td>{clock(r.publishedAt)}</td>
                        {r.onFacebook ? <><td className="r">{n(r.impressions)}</td><td className="r">{n(r.reactions)}</td><td className="r">{n(r.clicks)}</td></> : <td className="r ed-ins-nofb" colSpan={3}>not on Facebook</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
          </>
        )}

        <section className="ed-ins-card ed-ins-usage" aria-label="AI usage this session">
          <header className="ed-ins-week-h"><h3>AI usage this session</h3><span>{usage.calls} {usage.calls === 1 ? 'call' : 'calls'}</span></header>
          {usage.calls ? (
            <dl className="ed-ins-usage-grid">
              <div><dt>Prompt tokens</dt><dd>{tk(usage.prompt)}</dd></div>
              <div><dt>From cache</dt><dd>{Math.round(usage.hitRate * 100)}%</dd></div>
              <div><dt>Output tokens</dt><dd>{tk(usage.output)}</dd></div>
              <div><dt>Cost (estimate)</dt><dd>{cost.priced ? fmtDollars(cost.dollars) : '—'}</dd></div>
            </dl>
          ) : <p className="hint">No AI call has reported its tokens since the app started.</p>}
          <p className="hint">Estimates use Claude list prices only; calls to other companies are counted but not priced.</p>
        </section>
      </div>
    </div>
  )
}

