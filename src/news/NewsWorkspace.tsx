// News desk: EnergyWatch (the office news & official government press release watcher by Yeasin Fiyaz), run by ESB AI Studio itself.
// Ported from ESB Studio Phone's News tab (src/mobile/watch/WatchPanel.tsx) onto this app's own desk frame:
// header (workspace switcher, menu bar, the checker's state, Check now), a left column of filters
// (categories: All headlines, Energy & Power, PM & President, Official Press; canonical trending topics; official press wings; portals),
// the headlines on a sheet in the centre with a live Trending topic bar, and the chosen headline on the right with Start a story.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { WorkspaceSwitcher } from '../shell/WorkspaceRail'
import { deskIs, useShellStore } from '../shell/shellStore'
import { useStore } from '../store'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { Dialog, IconButton, MenuBar, MenuButton, Seg, Toggle } from '../ui/controls'
import type { MenuDef, MenuEntry } from '../ui/controls'
import { useHelpMenu } from '../ui/HelpMenu'
import { AccountButton } from '../shell/AccountButton'
import { useSideColumn } from '../ui/sideColumnState'
import { ColumnHandle, ColumnRail, railClass } from '../ui/SideColumn'
import { fmtDateTime, fmtTime, useClockFormat } from '../ui/time'
import { relTime } from '../editorial/wire'
import { FEED_COUNT, PORTALS, PRESS_OFFICES, isPhoneFeed, trendingTopics, useWatch, visibleItems, type WatchCat, type WatchItem } from './watchStore'
import { EW_FEEDS, EW_PRESS_SOURCES } from './ewSources'
import { MAX_RANGE_DAYS, checkRange, useRange } from './rangeSearch'
import { PORTAL_BRANDS } from './portalBrands'
import './news.css'

const YEASIN_PORTFOLIO = 'https://yeasinfiyaz.netlify.app'
const CAT_LABEL: Record<WatchCat, string> = {
  energy: 'Energy & Power',
  leadership: 'PM & President',
  press: 'Official Press',
}
const WINDOWS = [1, 3, 6, 12, 24]
const windowLabel = (h: number) => (h === 1 ? 'Last hour' : `Last ${h} hours`)
/** Bangla letters: the text gets lang="bn" so it is set in Hind Siliguri at Bangla line spacing. */
const BN = /[ঀ-৿]/
const lang = (t: string) => (BN.test(t) ? 'bn' : 'en')
const feedKind = (url: string) => (/news\.google\./.test(url) ? 'Google News' : /bing\.com/.test(url) ? 'Bing News' : 'own feed')
/** External pages open in the system browser (main.cjs routes http(s) window.open to shell.openExternal). */
const openExternal = (url: string) => { window.open(url, '_blank', 'noopener') }
const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }
const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const itemTime = (x: WatchItem) => (x.published ? Date.parse(x.published) : x.foundAt)

// ---------------------------------------------------------------- EnergyWatch's own marks (from Yeasin's app.css)
export function EwMark({ size = 28 }: { size?: number }) {
  return (
    <span className="nw-mark" style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }} aria-hidden>
      <svg viewBox="0 0 24 24" width={Math.round(size * 0.56)} height={Math.round(size * 0.56)}><path d="M13.5 3 6.5 14h5l-1 7 7-11h-5z" fill="#fff" /></svg>
    </span>
  )
}
const EwName = () => <span className="nw-name">Energy<span>Watch</span></span>
const YeasinName = () => <button type="button" className="nw-yeasin" data-tip="Yeasin Fiyaz's portfolio (opens in the browser)" onClick={() => openExternal(YEASIN_PORTFOLIO)}>Yeasin Fiyaz</button>

function PortalIcon({ name, size = 14 }: { name: string; size?: number }) {
  const b = PORTAL_BRANDS[name]
  const tile = Math.round(size * 1.3)
  return (
    <span className={'nw-favicon' + (b?.icon ? '' : ' is-letter')} style={{ width: tile, height: tile, borderRadius: Math.round(tile * 0.28), fontSize: Math.round(size * 0.72) }} aria-hidden>
      {b?.icon ? <img src={b.icon} width={size} height={size} alt="" loading="lazy" /> : name.slice(0, 1)}
    </span>
  )
}
function PortalName({ name, size }: { name: string; size?: number }) {
  const c = PORTAL_BRANDS[name]?.color
  return <span className={'nw-src' + (c ? '' : ' is-ink')} style={c ? ({ '--src': c } as React.CSSProperties) : undefined}><PortalIcon name={name} size={size} /><span>{name}</span></span>
}

const NEWS_COLS_KEY = 'esb-banner-studio/news/columns'
const NEWS_COLS_DEFAULT = { lw: 272, rw: 320 }
const NEWS_LIMITS = { lw: [240, 480], rw: [260, 520] } as const

// ---------------------------------------------------------------- behaviour
function useAutoCheck() {
  const autoMin = useWatch((s) => s.prefs.autoMin)
  useEffect(() => {
    const tick = () => {
      const { lastRun, running, run, prefs } = useWatch.getState()
      if (document.visibilityState !== 'visible' || running || useRange.getState().range) return
      const every = (prefs.autoMin || 0) * 60_000
      if (lastRun == null || (every > 0 && Date.now() - lastRun >= every)) void run()
    }
    tick()
    const id = window.setInterval(tick, 20_000)
    document.addEventListener('visibilitychange', tick)
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', tick) }
  }, [autoMin])
}
/** The clock the relative times are read against: ticks every 15 s, so "2 min ago" and "next 7:02 PM" stay true. */
function useNow(every = 15_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), every); return () => window.clearInterval(id) }, [every])
  return now
}

/** The left column's sections open and close; the choice is remembered. */
type Folds = { show: boolean; trending: boolean; pressWings: boolean; portals: boolean }
const FOLDS_KEY = 'esb-banner-studio/news/folds'
const loadFolds = (): Folds => {
  const d: Folds = { show: true, trending: true, pressWings: false, portals: false }
  try { return { ...d, ...JSON.parse(localStorage.getItem(FOLDS_KEY) ?? '{}') } } catch { return d }
}
function Fold({ id, title, aside, open, onToggle, children }: { id: keyof Folds; title: string; aside?: React.ReactNode; open: boolean; onToggle: (id: keyof Folds) => void; children: React.ReactNode }) {
  return (
    <section className={'nw-sec nw-fold' + (open ? ' open' : '')}>
      <button type="button" className="nw-sec-h nw-fold-h" aria-expanded={open} onClick={() => onToggle(id)}>
        <Icon name="chevDown" size={13} className="nw-fold-chev" /><span>{title}</span>{aside ? <small>{aside}</small> : null}
      </button>
      <div className="nw-fold-body" inert={!open}><div className="nw-fold-inner">{children}</div></div>
    </section>
  )
}

interface Toast { text: string; undo?: () => void; id: number }
type Group = { label: string; items: WatchItem[] }

// ---------------------------------------------------------------- the desk
export function NewsWorkspace() {
  const items = useWatch((s) => s.items)
  const hidden = useWatch((s) => s.hidden)
  const prefs = useWatch((s) => s.prefs)
  const running = useWatch((s) => s.running)
  const progress = useWatch((s) => s.progress)
  const lastRun = useWatch((s) => s.lastRun)
  const newKeys = useWatch((s) => s.newKeys)
  const feeds = useWatch((s) => s.feeds)
  const range = useRange((s) => s.range)
  const theme = useStore((s) => s.theme)
  useClockFormat()
  const tickNow = useNow()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<'all' | WatchCat>('all')
  const [portal, setPortal] = useState<string | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [dialog, setDialog] = useState<null | 'settings' | 'range'>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [folds, setFolds] = useState<Folds>(loadFolds)
  const toggleFold = (id: keyof Folds) => setFolds((f) => { const n = { ...f, [id]: !f[id] }; try { localStorage.setItem(FOLDS_KEY, JSON.stringify(n)) } catch { /* ignore */ } return n })
  const searchRef = useRef<HTMLInputElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  // Column widths, dragged like Graphics' side panels and remembered between launches; each folds to an icon rail.
  const legacyCols = (k: 'lw' | 'rw') => () => { const v = JSON.parse(localStorage.getItem(NEWS_COLS_KEY) ?? 'null'); return typeof v?.[k] === 'number' ? v[k] as number : undefined }
  const leftCol = useSideColumn('news/left', 'left', { def: NEWS_COLS_DEFAULT.lw, min: NEWS_LIMITS.lw[0], max: NEWS_LIMITS.lw[1] }, legacyCols('lw'))
  const rightCol = useSideColumn('news/right', 'right', { def: NEWS_COLS_DEFAULT.rw, min: NEWS_LIMITS.rw[0], max: NEWS_LIMITS.rw[1] }, legacyCols('rw'))
  const liveSize = (k: 'lw' | 'rw') => (v: number) => { bodyRef.current?.style.setProperty(k === 'lw' ? '--nw-lw' : '--nw-rw', `${v}px`) }
  /** Rail icon for a fold: open the column, then that fold (it stays open if it already is). */
  const openFold = (id: keyof Folds) => { if (!folds[id]) toggleFold(id) }

  useAutoCheck()
  useEffect(() => { if (!toast) return; const id = window.setTimeout(() => setToast(null), toast.undo ? 6000 : 3500); return () => window.clearTimeout(id) }, [toast])
  const say = (text: string, undo?: () => void) => setToast((t) => ({ text, undo, id: (t?.id ?? 0) + 1 }))
  const now = Math.max(tickNow, lastRun ?? 0)

  const effectiveItems = range ? range.items : items
  const effectivePrefs = useMemo(() => (range ? { ...prefs, maxAgeH: 24 * 365 } : prefs), [range, prefs])
  const isNew = useMemo(() => new Set(range ? [] : newKeys), [newKeys, range])

  // Unfiltered base within time window (for trending & category badges)
  const base = useMemo(
    () => visibleItems(effectiveItems, hidden, effectivePrefs, '', 'all', isNew),
    [effectiveItems, hidden, effectivePrefs, isNew],
  )
  const needle = q.trim().toLowerCase()

  // Search-filtered across all categories (for category counts)
  const inSearch = useMemo(
    () => visibleItems(effectiveItems, hidden, effectivePrefs, q, 'all', isNew),
    [effectiveItems, hidden, effectivePrefs, q, isNew],
  )

  // Shown items for active category + portal + query (sorted by relevance when query is active, then timestamp)
  const shown = useMemo(
    () => visibleItems(effectiveItems, hidden, effectivePrefs, q, cat, isNew).filter((x) => !portal || x.source === portal),
    [effectiveItems, hidden, effectivePrefs, q, cat, isNew, portal],
  )

  // Group headlines: when a topic/search query is active, keep relevance order intact under one heading;
  // otherwise group under time headings with New first.
  const groups = useMemo<Group[]>(() => {
    if (needle) {
      return shown.length ? [{ label: `Matching “${q.trim()}” · sorted by relevance`, items: shown }] : []
    }
    const out: Group[] = []
    const add = (label: string, x: WatchItem) => { const g = out.at(-1); if (g && g.label === label) g.items.push(x); else out.push({ label, items: [x] }) }
    for (const x of shown) if (isNew.has(x.key)) add('New in the last check', x)
    const today = new Date(now); today.setHours(0, 0, 0, 0)
    for (const x of shown) {
      if (isNew.has(x.key)) continue
      const t = itemTime(x)
      const label = range || cat === 'press' ? dayFmt.format(t)
        : now - t < 3600_000 ? 'Last hour'
        : t >= today.getTime() ? 'Earlier today'
        : t >= today.getTime() - 86400_000 ? 'Yesterday' : dayFmt.format(t)
      add(label, x)
    }
    return out
  }, [shown, isNew, now, range, needle, q, cat])

  const ordered = useMemo(() => groups.flatMap((g) => g.items), [groups])
  const selected = ordered.find((x) => x.key === sel) ?? ordered[0] ?? null

  // Category counts & canonical trending topics for the active category
  const catCount = (c: 'all' | WatchCat) => inSearch.filter((x) => (c === 'all' || x.categories.includes(c)) && (!portal || x.source === portal)).length
  const trending = useMemo(() => trendingTopics(base, cat, 12), [base, cat])

  const portalsOff = prefs.portalsOff
  const pressOfficeRows = useMemo(() => {
    const off = new Set(portalsOff)
    const n = new Map<string, number>()
    for (const x of inSearch) if (x.categories.includes('press')) n.set(x.source, (n.get(x.source) ?? 0) + 1)
    return PRESS_OFFICES.filter((o) => !off.has(o.name)).map((o) => {
      const src = EW_PRESS_SOURCES.find((s) => s.name === o.name)
      const st = src ? feeds[src.id] : undefined
      const bad = !!st && !st.ok
      const why = st?.error || 'Unreachable'
      return { name: o.name, office: o.office, count: n.get(o.name) ?? 0, bad, why }
    }).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }, [inSearch, feeds, portalsOff])

  const portalRows = useMemo(() => {
    const off = new Set(portalsOff)
    const n = new Map<string, number>()
    for (const x of inSearch) if (cat === 'all' || x.categories.includes(cat)) n.set(x.source, (n.get(x.source) ?? 0) + 1)
    return PORTALS.filter((p) => !off.has(p.name)).map((p) => {
      const fs = EW_FEEDS.filter((f) => isPhoneFeed(f) && f.name === p.name)
      const st = fs.map((f) => feeds[f.id]).filter(Boolean)
      const bad = st.length > 0 && st.every((s) => !s.ok)
      const why = fs.filter((f) => feeds[f.id] && !feeds[f.id].ok).map((f) => `${feedKind(f.url)}: ${feeds[f.id].error}`).join(' · ')
      return { name: p.name, count: n.get(p.name) ?? 0, bad, why }
    }).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }, [inSearch, cat, feeds, portalsOff])

  const portalsOn = PORTALS.filter((p) => !portalsOff.includes(p.name)).length
  const pressOfficesOn = PRESS_OFFICES.filter((o) => !portalsOff.includes(o.name)).length
  const down = portalRows.filter((p) => p.bad).length
  const busy = range ? range.running : running
  const pct = range ? (range.total ? Math.round((range.done / range.total) * 100) : 0) : progress?.total ? Math.round((progress.done / progress.total) * 100) : 0
  const freshCount = base.filter((x) => isNew.has(x.key)).length
  const nextAuto = !range && prefs.autoMin > 0 && lastRun ? lastRun + prefs.autoMin * 60_000 : null

  // ---- actions
  const check = async () => {
    const r = await useWatch.getState().run()
    if (!r) return
    if (r.failed > r.checked / 2) say(`Most sources did not answer (${r.failed} of ${r.checked}). Check the connection.`)
    else say(r.added ? `${r.added} new ${r.added === 1 ? 'headline' : 'headlines'}` : 'No new headlines')
  }
  const refresh = () => void (range ? useRange.getState().search(range.from, range.to) : check())
  const markAll = () => {
    const before = useWatch.getState().newKeys
    if (!before.length) return
    useWatch.getState().markAllRead()
    say(`${before.length} marked as read`, () => useWatch.setState({ newKeys: before }))
  }
  const startStory = (x: WatchItem) => { useWatch.getState().markRead(x.key); useShellStore.getState().openStoryFrom(x.link) }
  const use = (x: WatchItem) => startStory(x)
  /** The detail column's Start a story, for its folded rail. */
  const startSelected = () => { if (selected) startStory(selected) }
  const copy = (x: WatchItem) => { void navigator.clipboard?.writeText(x.link).then(() => say('Link copied'), () => say('Could not copy the link')) }
  const hide = (x: WatchItem) => {
    const i = ordered.findIndex((o) => o.key === x.key)
    const next = ordered[i + 1] ?? ordered[i - 1]
    useWatch.getState().hide(x.key)
    setSel(next?.key ?? null)
    say('Headline hidden', () => { useWatch.getState().unhide(x.key); setSel(x.key) })
  }
  const showHidden = () => {
    const before = useWatch.getState().hidden
    for (const k of before) useWatch.getState().unhide(k)
    say(`${before.length} hidden ${before.length === 1 ? 'headline' : 'headlines'} shown again`, () => { for (const k of before) useWatch.getState().hide(k) })
  }
  const setWindow = (h: number) => { useRange.getState().clear(); useWatch.getState().setPrefs({ maxAgeH: h }) }
  const clearFilters = () => { setQ(''); setCat('all'); setPortal(null) }

  // ---- keyboard: ↑ ↓ move through the headlines, Enter starts a story, / searches
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  useEffect(() => {
    keyRef.current = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (dialog || document.querySelector('.modal-bg, .popover')) return
      if (t && t.closest('input, textarea, select, [contenteditable="true"]')) {
        if (e.key === 'Escape' && t === searchRef.current) { setQ(''); searchRef.current?.blur() }
        return
      }
      if (e.key === '/' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); searchRef.current?.focus(); return }
      if (!ordered.length) return
      const i = selected ? ordered.findIndex((x) => x.key === selected.key) : -1
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const n = ordered[Math.min(ordered.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]
        setSel(n.key)
        requestAnimationFrame(() => sheetRef.current?.querySelector(`[data-key="${CSS.escape(n.key)}"]`)?.scrollIntoView({ block: 'nearest' }))
      } else if (e.key === 'Enter' && selected && !t?.closest('button')) { e.preventDefault(); startStory(selected) }
    }
  })
  useEffect(() => { const h = (e: KeyboardEvent) => { if (deskIs('news')) keyRef.current(e) }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [])
  useEffect(() => {
    const el = sheetRef.current
    if (!el) return
    const mark = () => el.toggleAttribute('data-top', el.scrollTop < 8)
    mark()
    el.addEventListener('scroll', mark, { passive: true })
    return () => el.removeEventListener('scroll', mark)
  }, [])

  // ---- menus
  const headlineItems = (x: WatchItem | null): MenuEntry[] => [
    { label: 'Start a story from it', icon: 'filePlus', shortcut: 'Enter', disabled: !x, onClick: () => x && startStory(x) },
    { label: 'Open in the browser', icon: 'externalLink', disabled: !x, onClick: () => x && openExternal(x.link) },
    { label: 'Copy link', icon: 'copy', disabled: !x, onClick: () => x && copy(x) },
    { divider: true },
    { label: 'Mark as read', icon: 'check', disabled: !x || !isNew.has(x.key), onClick: () => x && useWatch.getState().markRead(x.key) },
    { label: 'Hide', icon: 'eyeOff', disabled: !x, onClick: () => x && hide(x) },
  ]
  const help = useHelpMenu({ shortcuts: [{ group: 'Headlines', rows: [['/', 'Search headlines'], ['Esc', 'Clear the search'], ['↑ / ↓', 'Previous / next headline'], ['Enter', 'Start a story from the headline']] }] })
  const menus: MenuDef[] = [
    { label: 'News', items: [
      { label: range ? 'Search this range again' : 'Check now', icon: 'refresh', disabled: busy, onClick: refresh },
      { label: 'Pick dates and times', icon: 'calendar', onClick: () => setDialog('range') },
      ...(range ? [{ label: 'Back to the latest', icon: 'clock' as IconName, onClick: () => useRange.getState().clear() }] : []),
      { divider: true },
      { label: 'Mark all as read', icon: 'checkDouble', disabled: !freshCount, onClick: markAll },
      { label: hidden.length ? `Show hidden headlines again (${hidden.length})` : 'Show hidden headlines again', icon: 'eye', disabled: !hidden.length, onClick: showHidden },
      { divider: true },
      { label: 'News settings', icon: 'sliders', onClick: () => setDialog('settings') },
    ] },
    { label: 'View', items: [
      { heading: 'Headlines from' },
      ...WINDOWS.map((h) => ({ label: windowLabel(h), checked: !range && prefs.maxAgeH === h, onClick: () => setWindow(h) })),
      { label: 'Dates and times', checked: !!range, onClick: () => setDialog('range') },
      { divider: true },
      { heading: 'Categories' },
      { label: CAT_LABEL.energy, checked: prefs.show.energy !== false, onClick: () => useWatch.getState().setPrefs({ show: { ...prefs.show, energy: prefs.show.energy === false } }) },
      { label: CAT_LABEL.leadership, checked: prefs.show.leadership !== false, onClick: () => useWatch.getState().setPrefs({ show: { ...prefs.show, leadership: prefs.show.leadership === false } }) },
      { label: CAT_LABEL.press, checked: prefs.show.press !== false, onClick: () => useWatch.getState().setPrefs({ show: { ...prefs.show, press: prefs.show.press === false } }) },
      { divider: true },
      { label: 'Search headlines', icon: 'search', shortcut: '/', onClick: () => searchRef.current?.focus() },
      { label: 'Clear filters', icon: 'x', disabled: !needle && cat === 'all' && !portal, onClick: clearFilters },
      { divider: true },
      { heading: 'Appearance' },
      { label: 'Light', icon: 'sun', checked: theme !== 'dark', onClick: () => useStore.getState().setTheme('light') },
      { label: 'Dark', icon: 'moon', checked: theme === 'dark', onClick: () => useStore.getState().setTheme('dark') },
    ] },
    { label: 'Headline', items: headlineItems(selected) },
    help.menu,
  ]
  const timeMenu: MenuEntry[] = [
    ...WINDOWS.map((h) => ({ label: windowLabel(h), checked: !range && prefs.maxAgeH === h, onClick: () => setWindow(h) })),
    { divider: true },
    { label: 'Pick dates and times', icon: 'calendar', checked: !!range, onClick: () => setDialog('range') },
  ]

  const when = (x: WatchItem) => (x.published ? (range || cat === 'press' ? fmtDateTime(Date.parse(x.published)) : relTime(Math.min(Date.parse(x.published), now), now)) : `time not given · found ${relTime(Math.min(x.foundAt, now), now)}`)
  const cats: ('all' | WatchCat)[] = ['all', ...(['energy', 'leadership', 'press'] as WatchCat[]).filter((c) => prefs.show[c] !== false)]
  const filtered = !!needle || cat !== 'all' || !!portal
  const feedTone = busy ? 'on' : down > portalsOn / 2 ? 'off' : down ? 'warn' : lastRun ? 'on' : 'idle'

  return (
    <div ref={wsRef} className="news-workspace">
      <header className="topbar ed-head nw-head">
        <WorkspaceSwitcher />
        <MenuBar menus={menus} />
        <div className="spacer" />
        <MenuButton icon="clock" label={range ? 'Dates' : windowLabel(prefs.maxAgeH)} items={timeMenu} align="end" className="nw-when" title="Which headlines to show" />
        <IconButton icon="sliders" tip="News settings" onClick={() => setDialog('settings')} />
        <AccountButton onToast={say} />
        <button type="button" className={'btn primary nw-check' + (busy ? ' is-busy' : '')} disabled={busy} onClick={refresh} data-tip={range ? 'Search this range again' : 'Read every portal & official government press wing now'}>
          <Icon name="refresh" size={15} /><span>{busy ? (range ? 'Searching' : 'Reading') : range ? 'Search again' : 'Check now'}</span>
        </button>
      </header>

      <div ref={bodyRef} className="nw-body side-cols" style={{ ['--nw-lw' as string]: `${leftCol.px}px`, ['--nw-rw' as string]: `${rightCol.px}px` } as React.CSSProperties}>
        {/* ---------------------------------------------------------------- left: what to show */}
        <aside className={'nw-left' + railClass(leftCol)} aria-label="Filters">
          <div className="nw-brand-bar">
            <div className="nw-brand">
              <EwMark size={26} />
              <div className="nw-brand-text">
                <b><EwName /></b>
                <span className="nw-by">by <YeasinName /></span>
              </div>
            </div>
          </div>
          <div className="nw-left-scroll">
            <Fold id="show" title="Categories" open={folds.show} onToggle={toggleFold} aside={folds.show ? null : cat === 'all' ? 'All' : CAT_LABEL[cat]}>
              <div className="nw-nav" role="radiogroup" aria-label="Categories">
                {cats.map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={cat === c} className={'nw-nav-row' + (cat === c ? ' on' : '') + ' is-' + c} onClick={() => setCat(c)}>
                    <span className="nw-nav-ic"><Icon name={c === 'all' ? 'inbox' : c === 'energy' ? 'bolt' : c === 'leadership' ? 'users' : 'shield'} size={15} /></span>
                    <span className="nw-nav-label">{c === 'all' ? 'All headlines' : CAT_LABEL[c]}</span>
                    <span className="nw-count">{catCount(c)}</span>
                  </button>
                ))}
              </div>
            </Fold>

            <Fold id="pressWings" title="Official Press Wings" open={folds.pressWings} onToggle={toggleFold}
              aside={<>{portal && pressOfficeRows.some((o) => o.name === portal) && !folds.pressWings ? <b className="nw-fold-pick">{portal}</b> : <>{pressOfficesOn} offices</>}</>}>
              <div className="nw-nav">
                {pressOfficeRows.map((o) => (
                  <button key={o.name} type="button" className={'nw-nav-row nw-portal' + (portal === o.name ? ' on' : '') + (o.count ? '' : ' is-empty')} aria-pressed={portal === o.name}
                    onClick={() => { setPortal(portal === o.name ? null : o.name); if (portal !== o.name) setCat('press') }}
                    data-tip={o.bad ? `Not answering · ${o.why}` : `${o.office} · click to filter`}>
                    <PortalIcon name={o.name} size={14} />
                    <span className="nw-nav-label">{o.name}</span>
                    {o.bad && <i className="nw-bad" aria-label="Not answering" />}
                    <span className="nw-count">{o.count || ''}</span>
                  </button>
                ))}
              </div>
            </Fold>

            <Fold id="portals" title="Portals" open={folds.portals} onToggle={toggleFold}
              aside={<>{down ? <><b className="nw-warn">{down} not answering</b> · </> : null}{portal && !folds.portals ? <b className="nw-fold-pick">{portal}</b> : <>{portalsOn} · {FEED_COUNT} feeds</>}</>}>
              <div className="nw-nav">
                {portalRows.map((p) => (
                  <button key={p.name} type="button" className={'nw-nav-row nw-portal' + (portal === p.name ? ' on' : '') + (p.count ? '' : ' is-empty')} aria-pressed={portal === p.name}
                    onClick={() => setPortal(portal === p.name ? null : p.name)} data-tip={p.bad ? `Not answering · ${p.why}` : portal === p.name ? 'Show every portal' : `Only ${p.name}`}>
                    <PortalIcon name={p.name} size={14} />
                    <span className="nw-nav-label">{p.name}</span>
                    {p.bad && <i className="nw-bad" aria-label="Not answering" />}
                    <span className="nw-count">{p.count || ''}</span>
                  </button>
                ))}
              </div>
            </Fold>
          </div>
          <ColumnRail col={leftCol} label="Filters" items={[
            ...cats.map((c) => ({ id: c, icon: (c === 'all' ? 'inbox' : c === 'energy' ? 'bolt' : c === 'leadership' ? 'users' : 'shield') as IconName, label: c === 'all' ? 'All headlines' : CAT_LABEL[c], on: cat === c, onClick: () => setCat(c) })),
            { id: 'pressWings', icon: 'quote', label: 'Official Press Wings', onClick: () => openFold('pressWings') },
            { id: 'portals', icon: 'globe', label: 'Portals', on: !!portal && !pressOfficeRows.some((o) => o.name === portal), onClick: () => openFold('portals') },
          ]} />
          <ColumnHandle col={leftCol} label="Resize the filters column" root={() => wsRef.current} apply={liveSize('lw')} max={Math.round(window.innerWidth * 0.38)} />
        </aside>

        {/* ---------------------------------------------------------------- centre: the headlines */}
        <main className="nw-center">
          <div className="nw-toolbar">
            <label className="nw-search">
              <Icon name="search" size={15} />
              <input ref={searchRef} type="search" placeholder="Search headlines, topics, portals or government offices" aria-label="Search headlines" value={q} onChange={(e) => setQ(e.target.value)} />
              {q ? <button type="button" className="nw-search-x" aria-label="Clear the search" onClick={() => { setQ(''); searchRef.current?.focus() }}><Icon name="x" size={14} /></button> : <kbd className="nw-kbd">/</kbd>}
            </label>
            {portal && <button type="button" className="nw-filter" onClick={() => setPortal(null)} data-tip="Show every source"><PortalIcon name={portal} size={12} />{portal}<Icon name="x" size={12} /></button>}
            <span className="nw-grow" />
            {freshCount > 0 && <button type="button" className="btn nw-markall" onClick={markAll} data-tip="Mark all as read"><Icon name="checkDouble" size={15} /><b>{freshCount}</b> new</button>}
            {busy && !range && <span className="nw-progress" role="progressbar" aria-label="Reading the feeds" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ '--p': `${pct}%` } as React.CSSProperties} /></span>}
          </div>

          {trending.length > 0 && <TrendBar trending={trending} press={cat === 'press'} needle={needle} onPick={(t) => setQ(needle === t.toLowerCase() ? '' : t)} />}

          {range && (
            <div className="nw-range">
              <Icon name="calendar" size={15} />
              <button type="button" className="nw-range-txt" onClick={() => setDialog('range')} data-tip="Change the dates"><b>{fmtDateTime(range.from)}</b><span>to</span><b>{fmtDateTime(range.to)}</b></button>
              <span className="nw-grow" />
              <span className="nw-range-n">{range.running ? `Searching ${pct}%` : `${range.items.length} found${range.failed ? ` · ${range.failed} failed` : ''}`}</span>
              <button type="button" className="btn ghost" onClick={() => useRange.getState().clear()}>Back to the latest</button>
              {range.running && <span className="nw-bar" style={{ '--p': `${pct}%` } as React.CSSProperties} aria-hidden />}
            </div>
          )}

          <div ref={sheetRef} className="nw-sheet">
            {groups.map((g) => (
              <section key={g.label} className={'nw-group' + (g.label.startsWith('New') ? ' is-new' : '')} aria-label={g.label}>
                <h5 className="nw-group-h"><span>{g.label}</span><small>{g.items.length}</small></h5>
                <ul className="nw-list">
                  {g.items.map((x) => {
                    const on = selected?.key === x.key
                    return (
                      <li key={x.key} data-key={x.key} className={'nw-row' + (on ? ' on' : '') + (isNew.has(x.key) ? ' is-new' : '') + (isNew.has(x.key) && running ? ' is-arriving' : '')}>
                        <button type="button" className="nw-row-main" aria-current={on || undefined} onClick={() => setSel(x.key)} onDoubleClick={() => use(x)}>
                          <span className="nw-meta">
                            <PortalName name={x.source} />
                            <span className="nw-dot" aria-hidden>·</span>
                            <span className="nw-time">{when(x)}</span>
                            {x.categories.includes('press') && <span className="nw-tag is-press" data-tip="Official Government Press Release"><Icon name="shield" size={12} /></span>}
                            {x.categories.includes('leadership') && <span className="nw-tag is-lead" data-tip="PM & President"><Icon name="users" size={12} /></span>}
                            {x.google && <span className="nw-tag" data-tip="Via Google News — publisher page resolved automatically"><Icon name="globe" size={12} /></span>}
                          </span>
                          <span className="nw-hl" lang={lang(x.title)}>{x.title}</span>
                        </button>
                        <span className="nw-row-acts">
                          <button type="button" className="btn nw-start" onClick={() => startStory(x)} data-tip="Start a story from this link (Enter)"><Icon name="filePlus" size={14} />Start a story</button>
                          <IconButton icon="externalLink" tip="Open in the browser" onClick={() => openExternal(x.link)} />
                        </span>
                        {isNew.has(x.key) && <span className="nw-ribbon">New</span>}
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
            {!ordered.length && (
              <div className="nw-empty">
                {busy ? <span className="nw-spin" aria-hidden><Icon name="refresh" size={22} /></span> : filtered ? <Icon name="search" size={22} /> : <EwMark size={44} />}
                <h3>{busy ? (range ? 'Searching the portals' : 'Reading portals & official press wings') : filtered ? 'Nothing matches' : base.length || items.length || range ? 'No headlines in this window' : <EwName />}</h3>
                <p>{busy ? 'Headlines and official government press releases appear here as each source answers.'
                  : cat === 'press' && !items.some((x) => x.categories.includes('press')) ? 'Click Check now to scan official Bangladesh government ministry, division, commission & utility press wings.'
                  : filtered ? 'No headline here has those words, that source, or that category.'
                  : range ? 'No Energy & Power or PM & President headlines between these times. Try a wider range.'
                  : items.length ? 'Nothing was published in this window. Try a longer one.'
                  : `Energy & Power, PM & President, and Official Press releases from ${PORTALS.length} Bangladeshi portals and ${PRESS_OFFICES.length} government offices.`}</p>
                {filtered && !busy && <button type="button" className="btn" onClick={clearFilters}><Icon name="x" size={14} />Clear filters</button>}
                {(!filtered || (cat === 'press' && !items.some((x) => x.categories.includes('press')))) && !busy && !range && (
                  <button type="button" className="btn primary nw-scan-btn" onClick={refresh}>
                    <Icon name="refresh" size={15} />
                    <span>{items.length ? 'Check now' : `Scan all ${PORTALS.length} portals & ${PRESS_OFFICES.length} press wings`}</span>
                  </button>
                )}
                {!filtered && !busy && items.length > 0 && !range && prefs.maxAgeH < 24 && <button type="button" className="btn" onClick={() => setWindow(24)}><Icon name="clock" size={14} />Last 24 hours</button>}
              </div>
            )}
          </div>
        </main>

        {/* ---------------------------------------------------------------- right: the chosen headline */}
        <aside className={'nw-right' + railClass(rightCol)} aria-label="Headline">
          <ColumnHandle col={rightCol} label="Resize the detail panel" root={() => wsRef.current} apply={liveSize('rw')} max={Math.round(window.innerWidth * 0.42)} />
          <ColumnRail col={rightCol} label="Headline" items={[
            { id: 'detail', icon: 'newspaper', label: selected ? 'The chosen headline' : 'About EnergyWatch', onClick: () => {} },
          ]} actions={[
            { id: 'start', icon: 'filePlus', label: 'Start a story', primary: true, disabled: !selected, onClick: startSelected },
          ]} />
          <div className="nw-right-scroll">
            {selected ? <Detail x={selected} isNew={isNew.has(selected.key)} now={now} range={!!range} onCopy={() => copy(selected)} onTopic={(t) => setQ(t)} onPortal={(p) => setPortal(p)} /> : (
              <div className="nw-card nw-about">
                <div className="nw-credit"><EwMark size={36} /><span><b><EwName /></b><small>by <YeasinName /></small></span></div>
                <p className="nw-help">EnergyWatch reads {PORTALS.length} Bangladeshi news portals and {PRESS_OFFICES.length} official government press wings, keeping Energy & Power, PM & President, and Official Press headlines. Pick one to see why it was chosen and start a story from it.</p>
              </div>
            )}
          </div>
          <div className="nw-right-foot">
            {selected && (
              <p className="nw-foot-note">Opens Editorial and automatically fetches and translates this story into a new draft.</p>
            )}
            <button type="button" className="btn primary nw-go" disabled={!selected} onClick={() => selected && use(selected)}>
              <Icon name="filePlus" size={15} />Start a story
            </button>
            <div className="nw-foot-acts">
              <button type="button" className="btn" disabled={!selected || !isNew.has(selected.key)} onClick={() => selected && useWatch.getState().markRead(selected.key)}><Icon name="check" size={14} />Mark as read</button>
              <button type="button" className="btn" disabled={!selected} onClick={() => selected && hide(selected)}><Icon name="eyeOff" size={14} />Hide</button>
            </div>
          </div>
        </aside>
      </div>

      <footer className="statusbar ed-statusbar nw-status">
        <button type="button" className={'sb-cms nw-sb ' + feedTone} onClick={() => setDialog('settings')}
          data-tip={busy ? 'Reading portals & official press wings now' : down ? `${down} ${down === 1 ? 'portal is' : 'portals are'} not answering. Click for settings` : lastRun ? 'Sources answered the last check. Click for settings' : 'Not checked yet'}>
          <span className="sb-k">Sources</span>
          <span className="sb-pill"><i className="sb-dot" aria-hidden />
            {range ? (range.running ? `Searching ${pct}%` : `${range.items.length} found`)
              : running ? `Reading ${progress?.done ?? 0} of ${progress?.total ?? (FEED_COUNT + PRESS_OFFICES.length)} sources`
              : !lastRun ? 'Not checked yet'
              : down ? `${portalsOn - down} of ${portalsOn} portals · ${pressOfficesOn} press wings` : `${portalsOn} portals · ${pressOfficesOn} press wings`}
          </span>
        </button>
        <div className="sep" />
        <span className="nw-sb-item"><span className="sb-k">Checked</span>{lastRun ? <span data-tip={fmtDateTime(lastRun)}>{fmtTime(lastRun)} <em>· {relTime(Math.min(lastRun, now), now)}</em></span> : <span>Never</span>}</span>
        <div className="sep" />
        <button type="button" className="nw-sb-item nw-sb-btn" onClick={() => setDialog('settings')} data-tip="How often News checks by itself while it is open">
          <span className="sb-k">Auto</span>
          <span>{range ? 'Paused for the range' : prefs.autoMin ? <>Every {prefs.autoMin} min{nextAuto && !running ? <em> · next {fmtTime(Math.max(nextAuto, now))}</em> : null}</> : 'Off'}</span>
        </button>
        <span className="nw-grow" />
        <span className="nw-sb-sum">
          {filtered ? <><b>{shown.length}</b> of {base.length} headlines</> : <><b>{base.length}</b> {base.length === 1 ? 'headline' : 'headlines'}</>}
          {freshCount > 0 && <> · <b className="nw-sb-new">{freshCount} new</b></>}
          {' · '}{range ? 'chosen dates' : cat === 'press' ? 'official press releases' : windowLabel(prefs.maxAgeH).toLowerCase()}
        </span>
      </footer>

      {toast && (
        <div key={toast.id} className="toast nw-toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && <button type="button" className="nw-toast-undo" onClick={() => { toast.undo?.(); setToast(null) }}>Undo</button>}
        </div>
      )}
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog(null)} onRestored={() => say('News settings restored')} />}
      {dialog === 'range' && <RangeDialog onClose={() => setDialog(null)} />}
      {help.dialogs}
    </div>
  )
}

// ---------------------------------------------------------------- right column: the chosen headline
function Detail({ x, isNew, now, range, onCopy, onTopic, onPortal }: { x: WatchItem; isNew: boolean; now: number; range: boolean; onCopy: () => void; onTopic: (t: string) => void; onPortal: (p: string) => void }) {
  const t = x.published ? Date.parse(x.published) : null
  const pressOffice = EW_PRESS_SOURCES.find((s) => s.name === x.source)
  return (
    <>
      <section className="nw-card nw-detail" key={x.key}>
        <header className="nw-detail-top">
          <button type="button" className="nw-detail-src" onClick={() => onPortal(x.source)} data-tip={`Only ${x.source}`}><PortalName name={x.source} size={16} /></button>
          {isNew && <span className="nw-newtag">New</span>}
        </header>
        {pressOffice && <p className="nw-help" style={{ marginTop: -4, marginBottom: 4 }}>{pressOffice.office}</p>}
        <h2 className="nw-detail-hl" lang={lang(x.title)}>{x.title}</h2>
        <p className="nw-detail-when">
          <Icon name="clock" size={13} />
          {t ? <span>{fmtDateTime(t)}{!range && <em> · {relTime(Math.min(t, now), now)}</em>}</span> : <span>Time not given · found {relTime(Math.min(x.foundAt, now), now)}</span>}
        </p>
        <div className="nw-kinds">
          {x.categories.includes('press') && <span className="nw-kind is-press"><Icon name="shield" size={12} />Official Press</span>}
          {x.categories.includes('energy') && <span className="nw-kind is-energy"><Icon name="bolt" size={12} />Energy & Power</span>}
          {x.categories.includes('leadership') && <span className="nw-kind is-lead"><Icon name="users" size={12} />PM & President</span>}
        </div>
      </section>

      {x.matched.length > 0 && (
        <section className="nw-card">
          <h4 className="nw-sec-h">Why it is here</h4>
          <p className="nw-help">{x.categories.includes('press') ? 'Issued by an official Bangladesh government press wing or state energy/power organization.' : `The headline has ${x.matched.length === 1 ? 'this word' : 'these words'} from EnergyWatch's list.`}</p>
          <div className="nw-trend">
            {x.matched.map((m) => <button key={m} type="button" lang={lang(m)} className="nw-chip" onClick={() => onTopic(m)} data-tip={`Every headline with ${m}`}>{m}</button>)}
          </div>
        </section>
      )}

      <section className="nw-card">
        <h4 className="nw-sec-h">Link</h4>
        <div className="nw-link">
          <Icon name={x.google ? 'globe' : 'link'} size={14} />
          <span className="nw-link-host">{x.google ? 'Google News' : hostOf(x.link)}</span>
        </div>
        {x.google && <p className="nw-help">Found via Google News; starting a story resolves the publisher's page automatically.</p>}
        <div className="nw-btnrow">
          <button type="button" className="btn" onClick={() => openExternal(x.link)}><Icon name="externalLink" size={14} />Open</button>
          <button type="button" className="btn" onClick={onCopy}><Icon name="copy" size={14} />Copy link</button>
        </div>
      </section>
    </>
  )
}

// ---------------------------------------------------------------- settings
function WordList({ title, help, words, onChange, placeholder }: { title: string; help: string; words: string[]; onChange: (w: string[]) => void; placeholder: string }) {
  const [v, setV] = useState('')
  const add = () => { const t = v.trim(); if (!t) return; if (!words.some((w) => w.toLowerCase() === t.toLowerCase())) onChange([...words, t]); setV('') }
  return (
    <section className="nw-dsec">
      <h4 className="nw-sec-h">{title}</h4>
      <p className="nw-help">{help}</p>
      <div className="nw-addrow">
        <input className="input" value={v} placeholder={placeholder} aria-label={title} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
        <button type="button" className="btn" disabled={!v.trim()} onClick={add}><Icon name="plus" size={14} />Add</button>
      </div>
      {words.length > 0 && <div className="nw-trend">{words.map((w) => <button key={w} type="button" lang={lang(w)} className="nw-chip nw-word" onClick={() => onChange(words.filter((x) => x !== w))} data-tip={`Remove ${w}`}>{w}<Icon name="x" size={12} /></button>)}</div>}
    </section>
  )
}

type SetTab = 'general' | 'words' | 'press' | 'portals'

function SettingsDialog({ onClose, onRestored }: { onClose: () => void; onRestored: () => void }) {
  // four tabs instead of one long scroll: what to show, your words, the press wings, the portals
  const [tab, setTab] = useState<SetTab>('general')
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
    return { tone: 'ok', text: `${fs.length} ${fs.length === 1 ? 'feed' : 'feeds'} · answering` }
  }
  const pressState = (name: string) => {
    const src = EW_PRESS_SOURCES.find((s) => s.name === name)
    if (!src) return { tone: '', text: '' }
    const st = feeds[src.id]
    if (!st) return { tone: '', text: src.office }
    if (!st.ok) return { tone: 'bad', text: `${src.office} · ${st.error || 'Not answering'}` }
    return { tone: 'ok', text: `${src.office} · ${st.count} release${st.count === 1 ? '' : 's'}` }
  }
  return (
    <Dialog title="News settings" kicker="EnergyWatch by Yeasin Fiyaz" onClose={onClose} width={720}
      footer={<>
        <button type="button" className="btn ghost" onClick={() => { useWatch.getState().resetPrefs(); useRange.getState().clear(); onRestored() }}><Icon name="reset" size={14} />Restore EnergyWatch's settings</button>
        <span className="nw-grow" />
        <button type="button" className="btn primary" onClick={onClose}>Done</button>
      </>}>
      <div className="nw-settings">
        <Seg<SetTab> className="nw-set-tabs" label="News settings" value={tab} onChange={setTab} options={[{ value: 'general', label: 'General', icon: 'sliders' }, { value: 'words', label: 'Keywords', icon: 'search' }, { value: 'press', label: 'Press wings', icon: 'shield' }, { value: 'portals', label: 'Portals', icon: 'globe' }]} />
        <div className="nw-credit nw-credit-lg"><EwMark size={40} /><span><b><EwName /></b><small>Made by <YeasinName /> for ESB Power Line. Its portals, official press wings, and keyword rules come from EnergyWatch; your changes here stay on this computer.</small></span></div>

        {tab === 'general' && <>
        <section className="nw-dsec">
          <h4 className="nw-sec-h">Categories</h4>
          <div className="nw-rows">
            <div className="nw-setrow"><span className="nw-setrow-ic is-energy"><Icon name="bolt" size={15} /></span><span className="nw-setrow-t"><b>Energy & Power</b><small>Electricity, gas, fuel, LNG, LPG, power plants, grid, renewable energy & sector companies</small></span><Toggle checked={prefs.show.energy !== false} label="Energy & Power" onChange={(v) => setPrefs({ show: { ...prefs.show, energy: v } })} /></div>
            <div className="nw-setrow"><span className="nw-setrow-ic is-lead"><Icon name="users" size={15} /></span><span className="nw-setrow-t"><b>PM & President</b><small>Bangladesh's Prime Minister and President (foreign leaders & non-state org presidents are excluded)</small></span><Toggle checked={prefs.show.leadership !== false} label="PM and President" onChange={(v) => setPrefs({ show: { ...prefs.show, leadership: v } })} /></div>
            <div className="nw-setrow"><span className="nw-setrow-ic is-press"><Icon name="shield" size={15} /></span><span className="nw-setrow-t"><b>Official Press Releases</b><small>Official press wings of Power Division, EMRD, BERC, SREDA, PMO, Bangabhaban, PID, BPDB, Petrobangla, BPC, BREB, PGCB & utilities</small></span><Toggle checked={prefs.show.press !== false} label="Official Press Releases" onChange={(v) => setPrefs({ show: { ...prefs.show, press: v } })} /></div>
          </div>
        </section>

        <div className="nw-two">
          <section className="nw-dsec">
            <h4 className="nw-sec-h">Headlines from the last</h4>
            <Seg<number> label="Headlines from the last" value={prefs.maxAgeH} onChange={(v) => { useRange.getState().clear(); setPrefs({ maxAgeH: v }) }}
              options={WINDOWS.map((h) => ({ value: h, label: h === 1 ? '1 hour' : `${h} h` }))} />
          </section>
          <section className="nw-dsec">
            <h4 className="nw-sec-h">Check by itself while News is open</h4>
            <Seg<number> label="Check by itself" value={prefs.autoMin} onChange={(v) => setPrefs({ autoMin: v })}
              options={[{ value: 0, label: 'Off' }, { value: 1, label: '1 min' }, { value: 5, label: '5 min' }, { value: 10, label: '10 min' }, { value: 30, label: '30 min' }]} />
          </section>
        </div>

        </>}
        {tab === 'words' && <>
        <WordList title="Always show headlines with" help="Your own words, on top of EnergyWatch's list. English matches whole words; Bangla matches inside words, so বিদ্যুৎ also finds বিদ্যুতের."
          words={prefs.keep} onChange={(keep) => setPrefs({ keep })} placeholder="e.g. Rooppur, সৌরবিদ্যুৎ" />
        <WordList title="Never show headlines with" help="A headline with any of these is left out, whatever else it says."
          words={prefs.never} onChange={(never) => setPrefs({ never })} placeholder="e.g. cricket" />

        </>}
        {tab === 'press' && <>
        <section className="nw-dsec">
          <h4 className="nw-sec-h">Official Government Press Wings<small>{PRESS_OFFICES.filter((o) => !off.has(o.name)).length} of {PRESS_OFFICES.length} on · Ministries, Divisions, Commissions & Utilities</small></h4>
          <div className="nw-rows nw-portals">
            {PRESS_OFFICES.map((o) => {
              const st = pressState(o.name)
              return (
                <div key={o.name} className="nw-setrow">
                  <PortalIcon name={o.name} size={18} />
                  <span className="nw-setrow-t"><b>{o.name}</b><small className={st.tone ? `is-${st.tone}` : ''}>{st.text}</small></span>
                  <Toggle checked={!off.has(o.name)} label={o.name} small onChange={(v) => setPrefs({ portalsOff: v ? prefs.portalsOff.filter((n) => n !== o.name) : [...prefs.portalsOff, o.name] })} />
                </div>
              )
            })}
          </div>
        </section>

        </>}
        {tab === 'portals' && <>
        <section className="nw-dsec">
          <h4 className="nw-sec-h">Portals<small>{PORTALS.filter((p) => !off.has(p.name)).length} of {PORTALS.length} on · {FEED_COUNT} feeds: own, Google News and Bing News</small></h4>
          <div className="nw-rows nw-portals">
            {PORTALS.map((p) => {
              const st = portalState(p.name)
              return (
                <div key={p.name} className="nw-setrow">
                  <PortalIcon name={p.name} size={18} />
                  <span className="nw-setrow-t"><b>{p.name}</b><small className={st.tone ? `is-${st.tone}` : ''}>{st.text}</small></span>
                  <Toggle checked={!off.has(p.name)} label={p.name} small onChange={(v) => setPrefs({ portalsOff: v ? prefs.portalsOff.filter((n) => n !== p.name) : [...prefs.portalsOff, p.name] })} />
                </div>
              )
            })}
          </div>
        </section>
        </>}
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
  const [now] = useState(() => Date.now())
  const [init] = useState(() => useRange.getState().range)
  const [fd, setFd] = useState(() => dateOf(init?.from ?? now - 86400_000))
  const [ft, setFt] = useState(() => timeOf(init?.from ?? now - 86400_000))
  const [td, setTd] = useState(() => dateOf(init?.to ?? now))
  const [tt, setTt] = useState(() => timeOf(init?.to ?? now))
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
    <Dialog title="Pick dates and times" kicker="News" onClose={onClose} width={520}
      footer={<><span className="nw-grow" /><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={!!err} onClick={go}><Icon name="search" size={14} />Find headlines</button></>}>
      <div className="nw-settings">
        <p className="nw-help">Every Energy & Power and PM & President headline the portals published between these two moments, up to {MAX_RANGE_DAYS} days.</p>
        <div className="nw-trend">{presets.map(([l, f]) => <button key={l} type="button" className="nw-chip" onClick={f}>{l}</button>)}</div>
        <div className="nw-dt">
          <label><span>From</span><input className="input" type="date" value={fd} max={dateOf(now)} onChange={(e) => setFd(e.target.value)} aria-label="Start date" /><input className="input" type="time" value={ft} onChange={(e) => setFt(e.target.value)} aria-label="Start time" /></label>
          <label><span>To</span><input className="input" type="date" value={td} max={dateOf(now)} onChange={(e) => setTd(e.target.value)} aria-label="End date" /><input className="input" type="time" value={tt} onChange={(e) => setTt(e.target.value)} aria-label="End time" /></label>
        </div>
        {!err && <p className="nw-sum"><Icon name="check" size={14} /><span><b>{fmtDateTime(from)}</b> to <b>{fmtDateTime(to)}</b></span></p>}
        {err && fd && td && <p className="nw-sum is-bad"><Icon name="alert" size={14} /><span>{err}</span></p>}
        <p className="nw-help">Older headlines are searched on Google News, portal by portal, and can start a story directly.</p>
      </div>
    </Dialog>
  )
}

/** Trending topics: ONE row above the headlines (it was also a fold in the left column, and wrapped to three rows).
 * As many chips as fit are shown; the rest are under "+N", so the bar never grows and nothing is cut. */
function TrendBar({ trending, press, needle, onPick }: { trending: [string, number][]; press: boolean; needle: string; onPick: (t: string) => void }) {
  const row = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState(trending.length)
  useLayoutEffect(() => {
    const el = row.current
    if (!el) return
    const measure = () => {
      const chips = [...el.querySelectorAll<HTMLElement>('.nw-trend-measure > .nw-chip')]
      const head = el.querySelector<HTMLElement>('.nw-trendbar-h')
      const room = el.clientWidth - (head?.offsetWidth ?? 0) - 8
      const more = 64 // the "+N" button and its gap
      let used = 0, n = 0
      for (let i = 0; i < chips.length; i++) {
        const w = chips[i].offsetWidth + 7
        const left = chips.length - i - 1
        if (used + w > room - (left > 0 ? more : 0)) break
        used += w; n++
      }
      setFit((f) => (f === n ? f : n))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [trending])
  const chip = (t: string, n: number) => {
    const on = needle === t.toLowerCase()
    return (
      <button key={t} type="button" lang={lang(t)} className={'nw-chip' + (on ? ' on' : '')} aria-pressed={on} onClick={() => onPick(t)} data-tip={`Filter & sort by relevance for ${t} (${n})`}>
        <span>{t}</span><small>{n}</small>
      </button>
    )
  }
  const rest = trending.slice(fit)
  return (
    <div ref={row} className="nw-trendbar" role="group" aria-label="Trending topics">
      <span className="nw-trendbar-h"><Icon name="trendingUp" size={13} />{press ? 'Offices' : 'Trending'}</span>
      {trending.slice(0, fit).map(([t, n]) => chip(t, n))}
      {rest.length > 0 && <MenuButton label={`+${rest.length}`} className="nw-chip nw-trend-more" menuClassName="nw-trend-menu" align="end" title="More trending topics"
        items={rest.map(([t, n]) => ({ label: t, hint: String(n), checked: needle === t.toLowerCase(), onClick: () => onPick(t) }))} />}
      {/* every chip at its natural width, out of sight, so the row knows what fits */}
      <div className="nw-trend-measure" aria-hidden>{trending.map(([t, n]) => <span key={t} className="nw-chip"><span>{t}</span><small>{n}</small></span>)}</div>
    </div>
  )
}
