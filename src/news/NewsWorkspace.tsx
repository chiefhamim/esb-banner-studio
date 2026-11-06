// News desk: EnergyWatch (the office news watcher by Yeasin Fiyaz), run by ESB AI Studio itself. Ported from ESB Studio
// Phone's News tab (src/mobile/watch/WatchPanel.tsx, 2026-11-06) onto this app's own controls and desk frame: the
// workspace switcher, a header with the checker's state and Check now, one centred reading column, and Dialogs for the
// settings and a date range. The engine (matcher, feed parser, sources, store, range search) is the phone's, copied.
//
// A headline is never fetched or translated from here. "Start a story" hands its link to Editorial's Link tab, as the
// Wire does, and the editor presses Fetch there. Google News-only stories open in the browser (their links are encoded).
import { useEffect, useMemo, useRef, useState } from 'react'
import { WorkspaceSwitcher } from '../shell/WorkspaceRail'
import { useShellStore } from '../shell/shellStore'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { Dialog, IconButton, MenuButton, MenuList, Popover, Seg, Toggle } from '../ui/controls'
import type { MenuEntry } from '../ui/controls'
import { fmtDateTime, useClockFormat } from '../ui/time'
import { relTime } from '../editorial/wire'
import { PORTALS, isPhoneFeed, useWatch, visibleItems, type WatchCat, type WatchItem } from './watchStore'
import { EW_FEEDS } from './ewSources'
import { MAX_RANGE_DAYS, checkRange, useRange } from './rangeSearch'
import { PORTAL_BRANDS } from './portalBrands'
import './news.css'

const YEASIN_PORTFOLIO = 'https://yeasinfiyaz.netlify.app'
const CAT_LABEL: Record<WatchCat, string> = { energy: 'Energy', leadership: 'PM & President' }
const WINDOWS = [1, 3, 6, 12, 24]
const windowLabel = (h: number) => (h === 1 ? 'Last hour' : `Last ${h} hours`)
/** Bangla letters: the headline gets lang="bn" so it is set in Hind Siliguri at Bangla line spacing. */
const BN = /[ঀ-৿]/
const feedKind = (url: string) => (/news\.google\./.test(url) ? 'Google News' : /bing\.com/.test(url) ? 'Bing News' : 'own feed')
/** External pages open in the system browser (main.cjs routes http(s) window.open to shell.openExternal). */
const openExternal = (url: string) => { window.open(url, '_blank', 'noopener') }

// ---------------------------------------------------------------- marks (EnergyWatch's own, as on the phone)
export function EwMark({ size = 28 }: { size?: number }) {
  return (
    <span className="nw-mark" style={{ width: size, height: size, borderRadius: Math.round(size * 0.3) }} aria-hidden>
      <svg viewBox="0 0 24 24" width={Math.round(size * 0.53)} height={Math.round(size * 0.53)}><path d="M13 3 6 14h5l-1 7 7-11h-5z" fill="#fff" /></svg>
    </span>
  )
}
const EwName = () => <span className="nw-name">Energy<span>Watch</span></span>
const YeasinName = () => <button type="button" className="nw-yeasin" data-tip="Yeasin Fiyaz's portfolio (opens in the browser)" onClick={() => openExternal(YEASIN_PORTFOLIO)}>Yeasin Fiyaz</button>

function PortalIcon({ name, size = 14 }: { name: string; size?: number }) {
  const b = PORTAL_BRANDS[name]
  const tile = Math.round(size * 1.3)
  return (
    <span className={'nw-favicon' + (b?.icon ? '' : ' is-letter')} style={{ width: tile, height: tile, borderRadius: Math.round(tile * 0.28), fontSize: size * 0.7 }} aria-hidden>
      {b?.icon ? <img src={b.icon} width={size} height={size} alt="" loading="lazy" /> : name.slice(0, 1)}
    </span>
  )
}
function PortalName({ name }: { name: string }) {
  const c = PORTAL_BRANDS[name]?.color
  return <span className={'nw-src' + (c ? '' : ' is-ink')} style={c ? ({ '--src': c } as React.CSSProperties) : undefined}><PortalIcon name={name} /><span>{name}</span></span>
}

// ---------------------------------------------------------------- small pieces
function useAutoCheck() {
  const autoMin = useWatch((s) => s.prefs.autoMin)
  useEffect(() => {
    const tick = () => {
      const { lastRun, running, run, prefs } = useWatch.getState()
      if (document.visibilityState !== 'visible' || running) return
      const every = (prefs.autoMin || 0) * 60_000
      if (lastRun == null || (every > 0 && Date.now() - lastRun >= every)) void run()
    }
    tick()
    const id = window.setInterval(tick, 30_000)
    document.addEventListener('visibilitychange', tick)
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', tick) }
  }, [autoMin])
}

/** A "⋯" button with this app's menu (MenuButton always carries a label and a chevron). */
function MoreMenu({ items, tip }: { items: MenuEntry[]; tip: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <span ref={ref} className={'nw-more' + (open ? ' open' : '')}>
      <IconButton icon="more" tip={tip} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }} active={open} />
      {open && ref.current && <Popover anchor={{ el: ref.current }} onClose={() => setOpen(false)} align="end" className="menu" minWidth={220}><MenuList items={items} onDone={() => setOpen(false)} /></Popover>}
    </span>
  )
}

interface Toast { text: string; undo?: () => void; id: number }

// ---------------------------------------------------------------- the desk
export function NewsWorkspace() {
  const items = useWatch((s) => s.items)
  const hidden = useWatch((s) => s.hidden)
  const prefs = useWatch((s) => s.prefs)
  const running = useWatch((s) => s.running)
  const lastRun = useWatch((s) => s.lastRun)
  const newKeys = useWatch((s) => s.newKeys)
  const feeds = useWatch((s) => s.feeds)
  const range = useRange((s) => s.range)
  useClockFormat()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<'all' | WatchCat>('all')
  const [dialog, setDialog] = useState<null | 'settings' | 'range'>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [, tick] = useState(0)
  useAutoCheck()
  useEffect(() => { const id = window.setInterval(() => tick((n) => n + 1), 30_000); return () => window.clearInterval(id) }, [])
  useEffect(() => { if (!toast) return; const id = window.setTimeout(() => setToast(null), toast.undo ? 6000 : 3500); return () => window.clearTimeout(id) }, [toast])
  const say = (text: string, undo?: () => void) => setToast({ text, undo, id: Date.now() })

  // the topics behind the headlines, most frequent first: one click filters to that topic
  const trending = useMemo(() => {
    const c = new Map<string, number>()
    for (const x of items) for (const m of x.matched) c.set(m, (c.get(m) ?? 0) + 1)
    return [...c].filter(([t]) => t.length > 1).sort((a, b) => b[1] - a[1]).slice(0, 8)
  }, [items])
  const rangeView = useMemo(() => (range ? visibleItems(range.items, hidden, { ...prefs, maxAgeH: 24 * 365 }, q, 'all') : null), [range, hidden, prefs, q])
  const liveView = useMemo(() => visibleItems(items, hidden, prefs, q, 'all'), [items, hidden, prefs, q])
  const base = rangeView ?? liveView
  const isNew = useMemo(() => new Set(range ? [] : newKeys), [newKeys, range])
  // what the latest check added goes first, so the NEW tags are what the editor sees on top
  const shown = useMemo(() => {
    const list = cat === 'all' ? base : base.filter((x) => x.categories.includes(cat))
    return isNew.size ? [...list.filter((x) => isNew.has(x.key)), ...list.filter((x) => !isNew.has(x.key))] : list
  }, [base, cat, isNew])
  const now = Date.now()
  const fresh = shown.filter((x) => isNew.has(x.key)).length
  const off = new Set(prefs.portalsOff)
  const failed = EW_FEEDS.filter((f) => isPhoneFeed(f) && !off.has(f.name) && feeds[f.id] && !feeds[f.id].ok).length
  const busy = range ? range.running : running
  const pct = range && range.total ? Math.round((range.done / range.total) * 100) : 0

  const check = async () => {
    const r = await useWatch.getState().run()
    if (!r) return
    if (r.failed > r.checked / 2) say(`Most portals did not answer (${r.failed} of ${r.checked}). Check the connection.`)
    else say(r.added ? `${r.added} new ${r.added === 1 ? 'headline' : 'headlines'}` : 'No new headlines')
  }
  const refresh = () => void (range ? useRange.getState().search(range.from, range.to) : check())
  const markAll = () => {
    const before = useWatch.getState().newKeys
    useWatch.getState().markAllRead()
    say(`${before.length} marked as read`, () => useWatch.setState({ newKeys: before }))
  }
  const startStory = (x: WatchItem) => useShellStore.getState().openStoryFrom(x.link)
  const use = (x: WatchItem) => (x.google ? openExternal(x.link) : startStory(x))
  const menu = (x: WatchItem): MenuEntry[] => [
    ...(x.google ? [] : [{ label: 'Start a story from it', icon: 'filePlus' as IconName, onClick: () => startStory(x) }]),
    { label: 'Open in the browser', icon: 'externalLink', onClick: () => openExternal(x.link) },
    { label: 'Copy link', icon: 'copy', onClick: () => { void navigator.clipboard?.writeText(x.link).then(() => say('Link copied'), () => say('Could not copy')) } },
    ...(isNew.has(x.key) ? [{ label: 'Mark as read', icon: 'check' as IconName, onClick: () => useWatch.getState().markRead(x.key) }] : []),
    { divider: true },
    { label: 'Hide', icon: 'eyeOff', onClick: () => { useWatch.getState().hide(x.key); say('Headline hidden', () => useWatch.getState().unhide(x.key)) } },
  ]
  const timeMenu: MenuEntry[] = [
    ...WINDOWS.map((h) => ({ label: windowLabel(h), checked: !range && prefs.maxAgeH === h, onClick: () => { useRange.getState().clear(); useWatch.getState().setPrefs({ maxAgeH: h }) } })),
    { divider: true },
    { label: 'Pick dates and times…', icon: 'calendar', checked: !!range, onClick: () => setDialog('range') },
  ]
  const cats: ('all' | WatchCat)[] = ['all', ...(['energy', 'leadership'] as WatchCat[]).filter((c) => prefs.show[c])]
  const inCat = (c: 'all' | WatchCat) => (c === 'all' ? base.length : base.filter((x) => x.categories.includes(c)).length)
  const when = (x: WatchItem) => (x.published ? (range ? fmtDateTime(Date.parse(x.published)) : relTime(Math.min(Date.parse(x.published), now), now)) : `found ${relTime(Math.min(x.foundAt, now), now)}`)

  return (
    <div className="news-workspace">
      <header className="topbar ed-head nw-head">
        <WorkspaceSwitcher />
        <div className="nw-brand"><EwMark /><b><EwName /></b><span className="nw-by">by <YeasinName /></span></div>
        <div className="spacer" />
        <span className="nw-state" role="status">
          <i className={'nw-live' + (busy ? ' is-busy' : failed ? ' is-warn' : '')} aria-hidden />
          {range
            ? (range.running ? <>Searching {pct}%</> : <>{range.items.length} found{range.failed ? <> · <b className="nw-warn">{range.failed} failed</b></> : null}</>)
            : running ? <>Reading {PORTALS.length - prefs.portalsOff.length} portals</> : lastRun ? <>Checked {relTime(Math.min(lastRun, now), now)}{failed ? <> · <b className="nw-warn">{failed} not answering</b></> : null}</> : <>Not checked yet</>}
        </span>
        <MenuButton icon="clock" label={range ? 'Dates' : windowLabel(prefs.maxAgeH)} items={timeMenu} align="end" className="nw-when" />
        <IconButton icon="sliders" tip="EnergyWatch settings" onClick={() => setDialog('settings')} />
        <button type="button" className={'btn primary nw-check' + (busy ? ' is-busy' : '')} disabled={busy} onClick={refresh} data-tip={range ? 'Search this range again' : 'Read every portal now'}>
          <Icon name="refresh" size={15} />{range ? 'Search again' : 'Check now'}
        </button>
      </header>

      <main className="nw-body">
        <div className="nw-col">
          <div className="nw-tools">
            <label className="nw-search">
              <Icon name="search" size={15} />
              <input type="search" placeholder="Search headlines or portals" aria-label="Search headlines" value={q} onChange={(e) => setQ(e.target.value)} />
              {q && <button type="button" className="nw-search-x" aria-label="Clear the search" onClick={() => setQ('')}><Icon name="x" size={14} /></button>}
            </label>
            {cats.length > 2 && (
              <Seg<'all' | WatchCat> label="Show" value={cat} onChange={setCat} className="nw-cats"
                options={cats.map((c) => ({ value: c, label: `${c === 'all' ? 'All' : CAT_LABEL[c]} ${inCat(c)}` }))} />
            )}
            <span className="nw-grow" />
            {fresh > 0 && !busy && !range && <button type="button" className="btn nw-new" onClick={markAll} data-tip="Mark all as read"><Icon name="checkDouble" size={15} />{fresh} new</button>}
          </div>
          {trending.length > 0 && (
            <div className="nw-trend" role="group" aria-label="Trending topics">
              <span className="nw-trend-h"><Icon name="trendingUp" size={13} />Trending</span>
              {trending.map(([t, n]) => <button key={t} type="button" className={'chip' + (q.toLowerCase() === t.toLowerCase() ? ' on' : '')} onClick={() => setQ(q.toLowerCase() === t.toLowerCase() ? '' : t)}>{t}<small>{n}</small></button>)}
            </div>
          )}
          {range && (
            <div className="nw-range">
              <Icon name="calendar" size={15} />
              <button type="button" className="nw-range-txt" onClick={() => setDialog('range')}><b>{fmtDateTime(range.from)}</b> to <b>{fmtDateTime(range.to)}</b></button>
              <span className="nw-grow" />
              <button type="button" className="btn ghost" onClick={() => useRange.getState().clear()}>Back to the latest</button>
              {range.running && <span className="nw-bar" style={{ '--p': `${pct}%` } as React.CSSProperties} aria-hidden />}
            </div>
          )}

          <ul className="nw-list" aria-label="Headlines">
            {shown.map((x) => (
              <li key={x.key} className={'nw-row' + (isNew.has(x.key) ? ' is-new' : '')}>
                <button type="button" className="nw-row-main" onClick={() => use(x)} data-tip={x.google ? 'Google News only: opens in the browser' : 'Start a story from this link'}>
                  <span className="nw-hl" lang={BN.test(x.title) ? 'bn' : 'en'}>{isNew.has(x.key) && <span className="nw-newtag">New</span>}{x.title}</span>
                  <span className="nw-meta">
                    <PortalName name={x.source} />
                    <span className="nw-time">{when(x)}</span>
                    {x.categories.includes('leadership') && <span className="nw-tag" data-tip="PM & President"><Icon name="users" size={12} /></span>}
                    {x.google && <span className="nw-tag" data-tip="Google News link"><Icon name="externalLink" size={12} /></span>}
                  </span>
                </button>
                <span className="nw-row-acts">
                  {!x.google && <button type="button" className="btn nw-start" onClick={() => startStory(x)}><Icon name="filePlus" size={14} />Start a story</button>}
                  <IconButton icon="externalLink" tip="Open in the browser" onClick={() => openExternal(x.link)} />
                  <MoreMenu items={menu(x)} tip="More" />
                </span>
              </li>
            ))}
          </ul>
          {!shown.length && (
            <div className="nw-empty">
              <EwMark size={48} />
              <h3>{busy ? 'Reading the portals' : base.length || items.length || range ? 'Nothing matches' : <EwName />}</h3>
              <p>{range ? (range.running ? 'Headlines appear here as each portal answers.' : 'No energy or PM & President headlines in this range. Try a wider one.')
                : items.length ? 'Try another search, or a longer time range.'
                : `Energy, power and PM & President headlines from ${PORTALS.length} Bangladeshi portals, picked by EnergyWatch's rules. Runs on this computer.`}</p>
              {!items.length && !busy && !range && <button type="button" className="btn primary" onClick={refresh}><Icon name="refresh" size={15} />Check now</button>}
            </div>
          )}
        </div>
      </main>

      {toast && (
        <div key={toast.id} className="toast nw-toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && <button type="button" className="nw-toast-undo" onClick={() => { toast.undo?.(); setToast(null) }}>Undo</button>}
        </div>
      )}
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog(null)} onRestored={() => say('EnergyWatch settings restored')} />}
      {dialog === 'range' && <RangeDialog onClose={() => setDialog(null)} />}
    </div>
  )
}

// ---------------------------------------------------------------- settings
function WordList({ title, help, words, onChange, placeholder }: { title: string; help: string; words: string[]; onChange: (w: string[]) => void; placeholder: string }) {
  const [v, setV] = useState('')
  const add = () => { const t = v.trim(); if (!t) return; if (!words.some((w) => w.toLowerCase() === t.toLowerCase())) onChange([...words, t]); setV('') }
  return (
    <section className="nw-sec">
      <h4>{title}</h4>
      <p className="nw-help">{help}</p>
      <div className="nw-addrow">
        <input className="input" value={v} placeholder={placeholder} aria-label={title} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
        <button type="button" className="btn" disabled={!v.trim()} onClick={add}><Icon name="plus" size={14} />Add</button>
      </div>
      {words.length > 0 && <div className="nw-words">{words.map((w) => <button key={w} type="button" className="chip" onClick={() => onChange(words.filter((x) => x !== w))} data-tip={`Remove ${w}`}>{w}<Icon name="x" size={12} /></button>)}</div>}
    </section>
  )
}

function SettingsDialog({ onClose, onRestored }: { onClose: () => void; onRestored: () => void }) {
  const prefs = useWatch((s) => s.prefs)
  const setPrefs = useWatch((s) => s.setPrefs)
  const feeds = useWatch((s) => s.feeds)
  const off = new Set(prefs.portalsOff)
  const portalState = (name: string) => {
    const fs = EW_FEEDS.filter((f) => isPhoneFeed(f) && f.name === name)
    const st = fs.map((f) => feeds[f.id]).filter(Boolean)
    if (!st.length) return { tone: '', text: 'Not checked yet' }
    const badFeeds = fs.filter((f) => feeds[f.id] && !feeds[f.id].ok)
    const why = badFeeds.map((f) => `${feedKind(f.url)}: ${feeds[f.id].error}`).join(' · ')
    if (badFeeds.length === st.length) return { tone: 'bad', text: `Not answering · ${why}` }
    if (badFeeds.length) return { tone: 'warn', text: `${fs.length - badFeeds.length} of ${fs.length} feeds answer · ${why}` }
    return { tone: 'ok', text: `${fs.length} ${fs.length === 1 ? 'feed' : 'feeds'} · fine` }
  }
  return (
    <Dialog title="EnergyWatch" kicker="News desk settings" onClose={onClose} width={720}
      footer={<>
        <button type="button" className="btn ghost" onClick={() => { useWatch.getState().resetPrefs(); useRange.getState().clear(); onRestored() }}><Icon name="reset" size={14} />Restore EnergyWatch's settings</button>
        <span className="nw-grow" />
        <button type="button" className="btn primary" onClick={onClose}>Done</button>
      </>}>
      <div className="nw-settings">
        <div className="nw-credit"><EwMark size={40} /><span><b><EwName /></b><small>Made by <YeasinName /> for ESB Power Line. Its portals and keyword rules come from EnergyWatch; your changes here stay on this computer.</small></span></div>

        <section className="nw-sec">
          <h4>Show</h4>
          <div className="nw-rows">
            <div className="nw-setrow"><span><b>Energy and power</b><small>Electricity, gas, fuel, LNG, LPG, power plants and the companies</small></span><Toggle checked={prefs.show.energy} label="Energy and power" onChange={(v) => setPrefs({ show: { ...prefs.show, energy: v } })} /></div>
            <div className="nw-setrow"><span><b>PM & President</b><small>Bangladesh's Prime Minister and President (foreign leaders are left out)</small></span><Toggle checked={prefs.show.leadership} label="PM and President" onChange={(v) => setPrefs({ show: { ...prefs.show, leadership: v } })} /></div>
          </div>
        </section>

        <div className="nw-sec nw-two">
          <section>
            <h4>Headlines from the last</h4>
            <Seg<number> label="Headlines from the last" value={prefs.maxAgeH} onChange={(v) => { useRange.getState().clear(); setPrefs({ maxAgeH: v }) }}
              options={WINDOWS.map((h) => ({ value: h, label: h === 1 ? '1 hour' : `${h} h` }))} />
          </section>
          <section>
            <h4>Check by itself while News is open</h4>
            <Seg<number> label="Check by itself" value={prefs.autoMin} onChange={(v) => setPrefs({ autoMin: v })}
              options={[{ value: 0, label: 'Off' }, { value: 5, label: '5 min' }, { value: 10, label: '10 min' }, { value: 30, label: '30 min' }]} />
          </section>
        </div>

        <WordList title="Always show headlines with" help="Your own words, on top of EnergyWatch's list. English matches whole words; Bangla matches inside words, so বিদ্যুৎ also finds বিদ্যুতের."
          words={prefs.keep} onChange={(keep) => setPrefs({ keep })} placeholder="e.g. Rooppur, সৌরবিদ্যুৎ" />
        <WordList title="Never show headlines with" help="A headline with any of these is left out, whatever else it says."
          words={prefs.never} onChange={(never) => setPrefs({ never })} placeholder="e.g. cricket" />

        <section className="nw-sec">
          <h4>Portals <small>{PORTALS.length - prefs.portalsOff.length} of {PORTALS.length} on</small></h4>
          <div className="nw-rows nw-portals">
            {PORTALS.map((p) => {
              const st = portalState(p.name)
              return (
                <div key={p.name} className="nw-setrow">
                  <PortalIcon name={p.name} size={18} />
                  <span><b>{p.name}</b><small className={st.tone ? `is-${st.tone}` : ''}>{st.text}</small></span>
                  <Toggle checked={!off.has(p.name)} label={p.name} small onChange={(v) => setPrefs({ portalsOff: v ? prefs.portalsOff.filter((n) => n !== p.name) : [...prefs.portalsOff, p.name] })} />
                </div>
              )
            })}
          </div>
        </section>
        <p className="nw-help">Tenders, press releases and research stay on the office EnergyWatch: they need a computer that is always on.</p>
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------- date range
const pad = (n: number) => String(n).padStart(2, '0')
const dateOf = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const timeOf = (t: number) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
const at = (d: string, t: string) => (d ? new Date(`${d}T${t || '00:00'}`).getTime() : NaN)
const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }

function RangeDialog({ onClose }: { onClose: () => void }) {
  const range = useRange.getState().range
  const now = Date.now()
  const [fd, setFd] = useState(() => dateOf(range?.from ?? now - 86400_000))
  const [ft, setFt] = useState(() => timeOf(range?.from ?? now - 86400_000))
  const [td, setTd] = useState(() => dateOf(range?.to ?? now))
  const [tt, setTt] = useState(() => timeOf(range?.to ?? now))
  const fill = (from: number, to: number) => { setFd(dateOf(from)); setFt(timeOf(from)); setTd(dateOf(to)); setTt(timeOf(to)) }
  const from = at(fd, ft), to = at(td, tt)
  const err = fd && td ? checkRange(from, to) : 'Pick both a start and an end.'
  const presets: [string, () => void][] = [
    ['Today', () => fill(startOfDay(now), now)],
    ['Yesterday', () => fill(startOfDay(now) - 86400_000, startOfDay(now) - 60_000)],
    ['Last 3 days', () => fill(now - 3 * 86400_000, now)],
    ['Last 7 days', () => fill(now - 7 * 86400_000, now)],
  ]
  const go = () => { if (err) return; onClose(); void useRange.getState().search(from, to) }
  return (
    <Dialog title="Pick dates and times" kicker="EnergyWatch" onClose={onClose} width={520}
      footer={<><span className="nw-grow" /><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={!!err} onClick={go}><Icon name="search" size={14} />Find headlines</button></>}>
      <div className="nw-settings">
        <p className="nw-help">Every energy and PM & President headline the portals published between these two moments, up to {MAX_RANGE_DAYS} days.</p>
        <div className="nw-words">{presets.map(([l, f]) => <button key={l} type="button" className="chip" onClick={f}>{l}</button>)}</div>
        <div className="nw-dt">
          <label><span>From</span><input className="input" type="date" value={fd} max={dateOf(now)} onChange={(e) => setFd(e.target.value)} aria-label="Start date" /><input className="input" type="time" value={ft} onChange={(e) => setFt(e.target.value)} aria-label="Start time" /></label>
          <label><span>To</span><input className="input" type="date" value={td} max={dateOf(now)} onChange={(e) => setTd(e.target.value)} aria-label="End date" /><input className="input" type="time" value={tt} onChange={(e) => setTt(e.target.value)} aria-label="End time" /></label>
        </div>
        {!err && <p className="nw-sum"><Icon name="check" size={14} /><span><b>{fmtDateTime(from)}</b> to <b>{fmtDateTime(to)}</b></span></p>}
        {err && fd && td && <p className="nw-sum is-bad"><Icon name="alert" size={14} /><span>{err}</span></p>}
        <p className="nw-help">Older headlines are searched on Google News, portal by portal. They open in the browser; headlines this computer already collected can start a story directly.</p>
      </div>
    </Dialog>
  )
}
