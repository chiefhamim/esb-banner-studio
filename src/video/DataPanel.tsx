// Video bin → Data: Grid data cards from esbpowerline.com's published daily data. Pick a day (default: the newest
// published), see every figure and series with its unit and date BEFORE adding, then Add puts a data-card clip on
// the overlay track at the playhead. The inspector section (DataCardInspector) sets the card's style and animation
// and refreshes its figure from the site, asking before it changes anything.
//
// Without the desktop app or a sign-in the tab says so; cards already on the timeline keep their stored values and
// are never refetched on their own (an export reads the clip, not the site).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../ui/Icon'
import { Seg, Select } from '../ui/controls'
import type { Opt } from '../ui/controls'
import { getStoredStaffSession, type StaffSession } from '../editorial/siteApi'
import { useVideoStore, viewOf } from './videoStore'
import { trackForKind, type Clip } from './timeline'
import { GRID_METRICS, readMetric, gridSourceLine } from './titles/grid'
import { formatExact } from './titles/numbers'
import { CATEGORIES } from '../core/tokens'
import {
  DATA_ANIM_IN, DATA_ANIM_OUT, DATA_SERIES, SERIES_LABEL, cardLabel, cardValueText, dataCardClip, dataCardFor, defaultChartKind, derivedFormula, readSeries, refreshDiff,
  type ChartKind, type DataCardRef, type DataCardStyle, type DataSeriesId, type FetchedDay, type RefreshDiff,
} from './dataCardClip'
import { cachedGridDates, cachedGridDay, canFetchGrid, loadGridDay, loadLatestGridDay } from './gridData'

const fmtFetched = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** A derived figure: what it is in words, the full formula one click (or hover) away, never raw code in the list. */
function DerivedNote({ formula }: { formula: string }) {
  const [open, setOpen] = useState(false)
  const what = /×\s*100/.test(formula) ? 'share of total' : /\+/.test(formula) ? 'sum of published values' : 'calculated from the published values'
  return (
    <div className="vw-data-derived">
      <p className="vw-hint">
        <span data-tip={formula}>Derived: {what}</span>{' '}
        <button type="button" className="vw-link-btn vw-formula-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? 'Hide formula' : 'Show formula'}</button>
      </p>
      {open && <p className="vw-hint vw-formula" data-role="formula">{formula}</p>}
    </div>
  )
}

function useStaffSession(): StaffSession | null {
  const [s, setS] = useState<StaffSession | null>(() => (typeof localStorage !== 'undefined' ? getStoredStaffSession() : null))
  useEffect(() => {
    const on = () => setS(getStoredStaffSession())
    window.addEventListener('esb-session', on)
    window.addEventListener('storage', on)
    return () => { window.removeEventListener('esb-session', on); window.removeEventListener('storage', on) }
  }, [])
  return s
}

type Load = { state: 'idle' } | { state: 'loading'; what: string } | { state: 'ok'; fetched: FetchedDay; cached: boolean } | { state: 'error'; error: string; code: string }

/** Remember the last day the tab showed, so going back to it does not ask the site again. */
let lastShown: { fetched: FetchedDay; cached: boolean } | null = null

export function DataPanel() {
  const session = useStaffSession()
  const desktop = canFetchGrid()
  const [load, setLoad] = useState<Load>(() => (lastShown ? { state: 'ok', ...lastShown } : { state: 'idle' }))
  const [date, setDate] = useState<string>(lastShown?.fetched.day.isoDate ?? '')
  const [saved, setSaved] = useState<string[]>([])
  const [kinds, setKinds] = useState<Partial<Record<DataSeriesId, ChartKind>>>({})
  const seq = useRef(0)
  const addClip = useVideoStore((s) => s.addClip)

  const run = useCallback(async (what: string, f: () => ReturnType<typeof loadGridDay>) => {
    const my = ++seq.current
    setLoad({ state: 'loading', what })
    const r = await f()
    if (my !== seq.current) return // a newer request owns the panel
    if (r.ok) {
      lastShown = { fetched: r.fetched, cached: r.cached }
      setLoad({ state: 'ok', fetched: r.fetched, cached: r.cached })
      setDate(r.fetched.day.isoDate)
    } else {
      setLoad({ state: 'error', error: r.error, code: r.code })
      if (r.cachedLatest && !date) setDate(r.cachedLatest)
    }
    void cachedGridDates().then(setSaved)
  }, [date])

  // first visit: the newest published day (signed in), else the newest saved copy
  useEffect(() => {
    if (!desktop || lastShown) return
    void cachedGridDates().then((d) => {
      setSaved(d)
      if (session) void run('the newest published day', () => loadLatestGridDay())
      else if (d[0]) { setDate(d[0]); void run(`the saved copy of ${d[0]}`, () => cachedGridDay(d[0])) }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop, !!session])

  const day = load.state === 'ok' ? load.fetched : null
  const figures = useMemo(() => (day ? GRID_METRICS.map((id) => ({ id, fig: readMetric(day.day, id) })) : []), [day])
  const series = useMemo(() => (day ? DATA_SERIES.map((id) => ({ id, s: readSeries(day.day, id) })) : []), [day])

  const add = (metric: string, style?: Partial<DataCardStyle>) => {
    if (!day) return
    const card = dataCardFor(day, metric, style)
    if (!card) return
    const p = viewOf(useVideoStore.getState())
    const clip = dataCardClip(card, trackForKind(p, 'overlay') ?? trackForKind(p, 'text') ?? 'v2', useVideoStore.getState().currentTime)
    addClip(clip)
  }

  if (!desktop) {
    return (
      <div className="vw-preset-list vw-data-panel" data-state="no-app">
        <div className="vw-preset-card vw-data-note">
          <p className="vw-preset-desc"><Icon name="info" size={12} /> Grid data cards read esbpowerline.com's published daily data through the desktop app (it sends your site session). Open ESB Studio as the desktop app to use them.</p>
          <p className="vw-preset-desc">Cards already on the timeline keep the figures they were made with.</p>
        </div>
      </div>
    )
  }

  const busy = load.state === 'loading'
  return (
    <div className="vw-preset-list vw-data-panel" data-state={load.state} data-signed-in={session ? '1' : '0'}>
      {!session && (
        <div className="vw-preset-card vw-data-note vw-data-signed-out">
          <p className="vw-preset-desc"><Icon name="lock" size={12} /> <b>Sign in to esbpowerline.com in the Studio</b> (the account button, top right) to read the site's published Grid data.</p>
          <p className="vw-preset-desc">Live Grid data from the website is not enabled for the Studio yet: the site needs a change first. Until then no day can be loaded here, and no figures are shown.</p>
          <p className="vw-preset-desc">{saved.length ? `Saved days still open offline (${saved.length}). ` : ''}Cards already on the timeline keep their stored values and are never refetched on export.</p>
        </div>
      )}
      <div className="vw-preset-card vw-data-day">
        <div className="vw-data-row">
          <label className="vw-data-label" htmlFor="vw-data-date">Day</label>
          <input id="vw-data-date" type="date" className="vw-data-date" value={date} data-empty={date ? undefined : '1'} data-ph="Pick a day" min="2011-01-01" max="2030-12-31" onChange={(e) => setDate(e.target.value)} />
          <button type="button" className="btn xs vw-data-load" disabled={busy || !date || (!session && !saved.includes(date))} data-tip={!session && !saved.includes(date) ? 'Sign in to load this day (only saved days open offline)' : undefined} onClick={() => void run(date, () => (session ? loadGridDay(date) : cachedGridDay(date)))}>Load</button>
          <button type="button" className="btn xs subtle vw-data-latest" disabled={busy || !session} data-tip={session ? 'The newest day the site has published' : 'Sign in to ask the site for its newest day'} onClick={() => void run('the newest published day', () => loadLatestGridDay())}>Latest</button>
        </div>
        {load.state === 'loading' && <p className="vw-hint vw-data-status">Reading {load.what}…</p>}
        {load.state === 'error' && <p className="vw-hint vw-data-error" role="alert"><Icon name="alert" size={12} /> {load.error}</p>}
        {day && (
          <p className="vw-hint vw-data-status">
            {day.day.dateLabel} · fetched {fmtFetched(day.fetchedAt)}{load.state === 'ok' && load.cached ? ' (saved copy)' : ''}
          </p>
        )}
      </div>

      {day && (
        <>
          <div className="vw-data-head">Figures</div>
          {figures.map(({ id, fig }) => (
            <div key={id} className="vw-preset-card vw-data-item" data-metric={id} data-empty={fig ? undefined : '1'}>
              <div className="vw-preset-header">
                <span className="vw-data-name">{fig ? fig.label.en : id}</span>
                <button type="button" className="btn xs vw-data-add" disabled={!fig} onClick={() => add(id)}><Icon name="plus" size={12} />Add</button>
              </div>
              {fig ? (
                <p className="vw-data-value"><b className="vw-data-num">{formatExact(fig.value)}</b> {fig.unit}{fig.time ? ` · ${fig.time}` : ''} <span className="vw-data-date-tag">{fig.dateLabel}</span></p>
              ) : (
                <p className="vw-hint">Not published in this day's file.</p>
              )}
              {fig?.derived && <DerivedNote formula={fig.derived.formula} />}
            </div>
          ))}
          <div className="vw-data-head">Charts</div>
          {series.map(({ id, s }) => {
            const kind = kinds[id] ?? defaultChartKind(id)
            return (
              <div key={id} className="vw-preset-card vw-data-item" data-series={id} data-empty={s ? undefined : '1'}>
                <div className="vw-preset-header">
                  <span className="vw-data-name">{SERIES_LABEL[id]}</span>
                  <button type="button" className="btn xs vw-data-add" disabled={!s} onClick={() => add(id, { chart: kind })}><Icon name="plus" size={12} />Add</button>
                </div>
                {s ? (
                  <>
                    <p className="vw-data-value vw-data-series">{s.items.slice(0, 6).map((i) => `${i.label} ${formatExact(i.value)}`).join(' · ')}{s.items.length > 6 ? ` · +${s.items.length - 6} more` : ''} ({s.unit}) <span className="vw-data-date-tag">{s.dateLabel}</span></p>
                    {s.derived && <DerivedNote formula={s.derived.formula} />}
                    <Seg<ChartKind> className="vw-data-kind" label="Chart type" value={kind} onChange={(k) => setKinds((m) => ({ ...m, [id]: k }))} options={[{ value: 'bar', label: 'Bars' }, { value: 'line', label: 'Line' }, { value: 'donut', label: 'Donut' }]} />
                  </>
                ) : (
                  <p className="vw-hint">Not published in this day's file.</p>
                )}
              </div>
            )
          })}
          <p className="vw-hint vw-data-source">Every card carries “{gridSourceLine(day.day.dateLabel)}”.</p>
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ inspector

/** The site's ten story categories, the same accents titles take (tokens.ts), not the old sector palette. */
const accentOptions = (current: string | null | undefined): Opt<string>[] => {
  const opts: Opt<string>[] = [{ value: '', label: 'ESB stripes' }, ...CATEGORIES.map((c) => ({ value: c.accent, label: c.name, swatch: c.accent }))]
  if (current && !opts.some((o) => o.value.toLowerCase() === current.toLowerCase())) opts.push({ value: current, label: 'Colour on this card', swatch: current })
  return opts
}

type Refresh = { state: 'idle' } | { state: 'checking' } | { state: 'same'; at: string } | { state: 'changed'; diff: RefreshDiff; fresh: FetchedDay } | { state: 'error'; error: string }

/** The data card's own section of the clip inspector: what it shows and where from, style, animation, refresh.
 * Rendered with `key={clip.id}`, so another card starts with no refresh answer. */
export function DataCardInspector({ clip, locked, onChange }: { clip: Clip; locked: boolean; onChange: (c: Clip) => void }) {
  const card = clip.dataCard!
  const [refresh, setRefresh] = useState<Refresh>({ state: 'idle' })
  const setStyle = (patch: Partial<DataCardStyle>) => onChange({ ...clip, dataCard: { ...card, style: { ...card.style, ...patch } } })
  const derived = derivedFormula(card)
  const signedIn = !!useStaffSession()

  const check = async () => {
    setRefresh({ state: 'checking' })
    const r = await loadGridDay(card.date, true)
    if (!r.ok) { setRefresh({ state: 'error', error: r.error }); return }
    const diff = refreshDiff(card, r.fetched)
    setRefresh(diff.changed ? { state: 'changed', diff, fresh: r.fetched } : { state: 'same', at: r.fetched.fetchedAt })
  }
  const apply = (next: DataCardRef) => { onChange({ ...clip, dataCard: next, title: `${cardLabel(next)} · ${next.date}` }); setRefresh({ state: 'idle' }) }
  // unchanged: only the fetch time moves forward (the figure is the same), so the card states the newer check
  const touch = (at: string) => onChange({ ...clip, dataCard: { ...card, fetchedAt: at } })

  return (
    <div className="vw-data-inspector" data-kind={card.kind}>
      <div className="vw-subhead">Grid data</div>
      <p className="vw-data-value vw-data-shown"><b className="vw-data-num">{cardValueText(card)}</b></p>
      <p className="vw-hint vw-data-meta">{cardLabel(card)} · {card.dateLabel} ({card.date})</p>
      {card.kind === 'number' && card.figure && <p className="vw-hint vw-data-field">Read from {card.figure.sourceField}</p>}
      {derived && <DerivedNote formula={derived} />}
      <p className="vw-hint vw-data-src">Fetched {fmtFetched(card.fetchedAt)} from {card.source.replace(/^https?:\/\//, '')}</p>

      <div className="vw-field vw-field-row"><label>Language</label><Seg<'en' | 'bn'> value={card.style.lang} onChange={(v) => setStyle({ lang: v })} options={[{ value: 'en', label: 'English' }, { value: 'bn', label: 'বাংলা' }]} /></div>
      <div className="vw-field vw-field-row"><label>Digits</label><Seg<'latin' | 'bn'> value={card.style.digits} onChange={(v) => setStyle({ digits: v })} options={[{ value: 'latin', label: '123' }, { value: 'bn', label: '১২৩' }]} /></div>
      <div className="vw-field vw-field-row"><label>Accent</label><Select<string> className="compact vw-data-accent" value={card.style.accent ?? ''} options={accentOptions(card.style.accent)} onChange={(v) => setStyle({ accent: v || null })} /></div>
      {card.kind === 'chart' && (
        <div className="vw-field vw-field-row"><label>Chart</label><Seg<ChartKind> value={card.style.chart ?? 'bar'} onChange={(v) => setStyle({ chart: v })} options={[{ value: 'bar', label: 'Bars' }, { value: 'line', label: 'Line' }, { value: 'donut', label: 'Donut' }]} /></div>
      )}
      <div className="vw-field vw-field-row"><label>In</label><Select<string> className="compact vw-data-in" value={card.style.animIn} options={DATA_ANIM_IN} onChange={(v) => setStyle({ animIn: v as DataCardStyle['animIn'] })} /></div>
      <div className="vw-field vw-field-row"><label>Out</label><Select<string> className="compact vw-data-out" value={card.style.animOut} options={DATA_ANIM_OUT} onChange={(v) => setStyle({ animOut: v as DataCardStyle['animOut'] })} /></div>

      <div className="vw-data-refresh">
        <button type="button" className="btn sm vw-data-refresh-btn" disabled={locked || refresh.state === 'checking' || !canFetchGrid() || !signedIn} data-tip={signedIn ? 'Ask the site for this day again and compare' : 'Sign in to check the site'} onClick={() => void check()}>
          <Icon name="reset" size={12} />{refresh.state === 'checking' ? 'Checking…' : 'Refresh data'}
        </button>
        {!signedIn && <p className="vw-hint">Not signed in: the card keeps its stored figure.</p>}
        {refresh.state === 'error' && <p className="vw-hint vw-data-error" role="alert">{refresh.error}. The card keeps its stored figure.</p>}
        {refresh.state === 'same' && (
          <div className="vw-data-same">
            <p className="vw-hint">Unchanged: the site still publishes the same {card.kind === 'number' ? 'figure' : 'values'} for {card.dateLabel}.</p>
            {refresh.at !== card.fetchedAt && <button type="button" className="btn xs subtle vw-data-touch" onClick={() => { touch(refresh.at); setRefresh({ state: 'idle' }) }}>Note the new check time</button>}
          </div>
        )}
        {refresh.state === 'changed' && (
          <div className="vw-data-changed" role="alertdialog" aria-label="The published value changed">
            <p className="vw-hint"><b>{refresh.diff.missing ? 'The site no longer publishes this figure for that day.' : 'The published value changed since this card was made.'}</b></p>
            <p className="vw-hint vw-data-before">On the card: {refresh.diff.before}</p>
            {!refresh.diff.missing && <p className="vw-hint vw-data-after">Published now: {refresh.diff.after}</p>}
            <div className="vw-btn-row">
              {refresh.diff.next && <button type="button" className="btn sm primary vw-data-update" onClick={() => apply(refresh.diff.next!)}>Update the card</button>}
              <button type="button" className="btn sm vw-data-keep" onClick={() => setRefresh({ state: 'idle' })}>Keep the stored {card.kind === 'number' ? 'figure' : 'values'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
