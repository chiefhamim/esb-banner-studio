// src/outreach/ActivityOverview.tsx
// Activity Desk Overview tab: KPI strip, hourly distribution, running jobs, days chart, durations (§3.4, §5.7).
// Cards, icons and figures follow the Outreach inspector (`or-card`, `or-stats`) rather than a separate dashboard look.

import type { ReactNode } from 'react'
import { useActivityStore } from './activityStore'
import { BarChart } from './charts'
import { fmtDuration, fmtDay, describeRun } from './activityFormat'
import { Icon, type IconName } from '../ui/Icon'
import { useEngineStore } from './engineStore'
import { engineClient } from './engineClient'
import { fmtHour, useClockFormat } from '../ui/time'

function Kpi({ icon, tone, label, figure, sub, small }: { icon: IconName; tone: string; label: string; figure: ReactNode; sub: ReactNode; small?: boolean }) {
  return (
    <div className={'oa-kpi-tile tone-' + tone}>
      <div className="oa-kpi-caption">
        <span className="oa-kpi-mark" aria-hidden><Icon name={icon} size={14} /></span>
        {label}
      </div>
      <div className={'oa-kpi-figure' + (small ? ' sm' : '')}>{figure}</div>
      <div className="oa-kpi-sub">{sub}</div>
    </div>
  )
}

function CardHead({ icon, title, note, tone = 'quiet' }: { icon: IconName; title: string; note?: ReactNode; tone?: string }) {
  return (
    <header className="oa-card-head">
      <span className={`oa-card-head-mark tone-${tone}`} aria-hidden>
        <Icon name={icon} size={14} />
      </span>
      <h3>{title}</h3>
      {note != null && <span className="or-small">{note}</span>}
    </header>
  )
}

function Duration({ label, tip, value, sub }: { label: string; tip: string; value: ReactNode; sub: ReactNode }) {
  return (
    <div className="oa-duration-tile" title={tip}>
      <div className="oa-duration-label">{label}</div>
      <div className="oa-duration-val">{value}</div>
      <div className="oa-duration-sub">{sub}</div>
    </div>
  )
}

export function ActivityOverview() {
  useClockFormat() // re-render when Home → Settings → Time format changes
  const store = useActivityStore()
  const engine = useEngineStore()
  const stats = store.stats
  const settings = engine.settings

  if (store.isLoading && !stats) {
    return (
      <div className="oa-loading-state">
        <div className="oa-loading-skeleton kpi-strip" />
        <div className="oa-loading-skeleton chart-row" />
      </div>
    )
  }

  if (store.isError) {
    return (
      <div className="oa-error-state">
        <span className="oa-empty-mark bad"><Icon name="info" size={20} /></span>
        <p>{store.errorMessage || 'Failed to load activity metrics.'}</p>
        <button className="btn sm" onClick={() => store.fetchStats()}>
          Try again
        </button>
      </div>
    )
  }

  const totals = stats?.totals
  const hasHistory = totals && (totals.sent > 0 || totals.failed > 0 || totals.bounced > 0 || totals.replied > 0)

  if (!hasHistory) {
    return (
      <div className="oa-empty-desk">
        <div className="oa-empty-card">
          <span className="oa-empty-mark"><Icon name="mail" size={20} /></span>
          <h3>No activity yet</h3>
          <p>
            Nothing has been sent from this app yet. When a campaign runs, every email, reply and problem is listed here
            with its time.
          </p>
        </div>
      </div>
    )
  }

  // Active running jobs
  const activeJobs = (stats?.jobs || []).filter((j) =>
    ['running', 'waiting', 'paused', 'queued'].includes(j.status)
  )

  // 1. KPI strip calculations
  const sentToday = stats.today.reduce((acc, h) => acc + h.sent, 0)
  const sentRange = totals.sent
  const replies = totals.replied
  const bounced = totals.bounced + totals.failed
  const stillToSend = activeJobs.reduce((acc, j) => acc + (j.remaining || 0), 0)

  let finishesAbout = '—'
  const firstActiveWithEta = activeJobs.find((j) => j.etaAt)
  if (firstActiveWithEta?.etaAt) {
    finishesAbout = fmtDay(firstActiveWithEta.etaAt, stats.window?.tz)
  }

  // 2. Today by hour chart data
  const hourData = stats.today.map((h) => ({
    label: fmtHour(h.t),
    sent: h.sent,
    failed: h.failed,
    tooltip: `${fmtHour(h.t)}–${fmtHour(h.t + 1)} · ${h.sent} sent · ${h.failed} failed`,
  }))

  // 3. Days chart data
  const daysData = stats.byDay.map((d) => ({
    label: d.day.slice(5), // "MM-DD"
    sent: d.sent,
    failed: d.failed,
    bounced: d.bounced,
    replies: d.replied,
    tooltip: `${d.day} · ${d.sent} sent · ${d.failed} failed · ${d.bounced} bounced · ${d.replied} replies`,
  }))

  // Send window band for today (default 09:00 to 17:00)
  const windowBand = stats.window
    ? {
        fromIndex: parseInt(stats.window.from.split(':')[0], 10) || 9,
        toIndex: parseInt(stats.window.to.split(':')[0], 10) || 17,
        label: `Send window (${stats.window.from}–${stats.window.to})`,
      }
    : undefined

  const durations = stats.durations

  return (
    <div className="oa-overview">
      {/* KPI strip (6 tiles) */}
      <section className="oa-kpi-strip" aria-label="Key Performance Indicators">
        <Kpi icon="send" tone="sent" label="Sent today" figure={sentToday.toLocaleString()} sub={`of ${stats.cap || 60} cap`} />
        <Kpi icon="mail" tone="sent" label="Sent in range" figure={sentRange.toLocaleString()} sub="total emails" />
        <Kpi
          icon="inbox"
          tone="reply"
          label="Replies"
          figure={replies.toLocaleString()}
          sub={sentRange > 0 ? `${Math.round((replies / sentRange) * 100)}% of sent` : '0% of sent'}
        />
        <Kpi
          icon="info"
          tone="bad"
          label="Bounced or refused"
          figure={bounced.toLocaleString()}
          sub={totals.optedOut > 0 ? `${totals.optedOut} unsubscribed` : 'undeliverable'}
        />
        <Kpi icon="clock" tone="warn" label="Still to send" figure={stillToSend.toLocaleString()} sub={`${activeJobs.length} active runs`} />
        <Kpi
          icon="calendar"
          tone="quiet"
          label="Finishes about"
          figure={finishesAbout}
          small
          sub={activeJobs.length > 0 ? 'based on window & cap' : 'no active runs'}
        />
      </section>

      {/* Row 2: Today by hour + Running now cards */}
      <section className="oa-grid-row-2">
        <div className="oa-panel">
          <BarChart
            title="Today by hour"
            summary="Distribution of sends and problems across hours in your schedule time zone."
            data={hourData}
            series={[
              { key: 'sent', label: 'Sent', colorVar: 'var(--or-sent)' },
              { key: 'failed', label: 'Failed', colorVar: 'var(--danger)' },
            ]}
            stacked={true}
            band={windowBand}
            rule={stats.cap ? { value: stats.cap / 8, label: 'Target pace' } : undefined}
          />
        </div>

        <div className="oa-panel oa-running-panel">
          <CardHead icon="send" title="Running now" tone="sent" note={`${activeJobs.length} active`} />

          <div className="oa-running-list">
            {activeJobs.length === 0 ? (
              <div className="oa-no-runs">
                <span className="oa-empty-mark"><Icon name="pause" size={18} /></span>
                <p>No sending is running.</p>
                {stats.lastSendAt && (
                  <div className="oa-last-run-note">
                    Last sent email: {fmtDay(stats.lastSendAt, stats.window?.tz)}
                  </div>
                )}
              </div>
            ) : (
              activeJobs.map((job) => {
                const desc = describeRun(job, settings)
                return (
                  <div key={job.jobId} className="oa-job-card">
                    <div className="oa-job-card-top">
                      <span className="oa-job-name">{job.name || 'Campaign'}</span>
                      <span className={`or-chip ${desc.chipClass}`}>{desc.label}</span>
                    </div>

                    <div className="oa-job-sentence or-muted">{desc.sentence}</div>

                    <div className="oa-meter">
                      <div className="oa-meter-fill" style={{ width: `${desc.percent}%` }} />
                    </div>

                    <div className="oa-job-metrics">
                      <span>{desc.countText}</span>
                      {desc.nextInText && <span className="or-muted">{desc.nextInText}</span>}
                    </div>

                    <div className="oa-job-actions">
                      {job.status === 'running' || job.status === 'waiting' ? (
                        <button className="btn xs" onClick={() => engineClient.control(job.jobId, 'pause')}>
                          <Icon name="pause" size={13} />
                          <span>Pause</span>
                        </button>
                      ) : (
                        <button className="btn xs" onClick={() => engineClient.control(job.jobId, 'resume')}>
                          <Icon name="play" size={13} />
                          <span>Resume</span>
                        </button>
                      )}
                      <button className="btn xs danger-text" onClick={() => engineClient.control(job.jobId, 'stop')}>
                        <Icon name="x" size={13} />
                        <span>Stop</span>
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </section>

      {/* Row 3: Days chart */}
      <section className="oa-panel oa-days-panel">
        <BarChart
          title="Daily history"
          summary="Sends, failures, bounces and replies over the selected date range."
          data={daysData}
          series={[
            { key: 'sent', label: 'Sent', colorVar: 'var(--or-sent)' },
            { key: 'failed', label: 'Failed', colorVar: 'var(--danger)' },
            { key: 'bounced', label: 'Bounced', colorVar: 'var(--warning)' },
          ]}
          stacked={true}
          lineSeries={{ key: 'replies', label: 'Replies', colorVar: 'var(--or-reply)' }}
        />
      </section>

      {/* Row 4: How long it took (6 figures) */}
      <section className="oa-panel oa-durations-panel">
        <CardHead icon="clock" title="How long it took" tone="warn" note="Pacing & performance" />

        <div className="oa-durations-grid">
          <Duration
            label="Avg time per email"
            tip="Average time taken by the SMTP server to accept each email."
            value={durations?.avgSendMs ? `${(durations.avgSendMs / 1000).toFixed(1)} s` : '—'}
            sub={`p95: ${(durations?.p95SendMs || 0) / 1000} s`}
          />
          <Duration
            label="Average gap"
            tip="Average delay spaced out between consecutive emails."
            value={durations?.avgGapSec ? fmtDuration(durations.avgGapSec) : '—'}
            sub="between sends"
          />
          <Duration
            label="Time sending"
            tip="Total accumulated time when campaigns were actively sending."
            value={durations?.activeMs ? fmtDuration(Math.round(durations.activeMs / 1000)) : '0 s'}
            sub="active send time"
          />
          <Duration
            label="Elapsed time"
            tip="Total wall-clock elapsed time across the selected date range."
            value={durations?.elapsedMs ? fmtDuration(Math.round(durations.elapsedMs / 1000)) : '—'}
            sub="wall clock"
          />
          <Duration
            label="Emails per active hour"
            tip="Effective delivery throughput per hour of active sending."
            value={durations?.perActiveHour ? `${durations.perActiveHour}` : '—'}
            sub="throughput"
          />
          <Duration
            label="Median time to reply"
            tip="Median duration between sending an email and receiving a recipient reply."
            value={stats.replyMedianMs ? fmtDuration(Math.round(stats.replyMedianMs / 1000)) : '—'}
            sub="response speed"
          />
        </div>
      </section>
    </div>
  )
}
