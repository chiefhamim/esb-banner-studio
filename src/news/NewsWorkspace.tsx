// News desk: EnergyWatch (the office news watcher by Yeasin Fiyaz), run by ESB AI Studio itself. Ported from ESB Studio
// Phone's News tab (src/mobile/watch/WatchPanel.tsx, 2026-11-06) onto this app's own desk frame, the same one Outreach
// and Editorial use: header (workspace switcher, menu bar, the checker's state, Check now), a left column of filters
// (kinds, trending topics, portals with their live counts and health), the headlines on a sheet in the centre, the
// chosen headline on the right with its one action pinned at the foot (Start a story), and a status bar. The engine
// (matcher, feed parser, sources, store, range search) is the phone's, copied; a check fills the list live.
//
// A headline is never fetched or translated from here. "Start a story" hands its link to Editorial's Link tab, as the
// Wire does, and the editor presses Fetch there. Google News-only stories open in the browser (their links are encoded).
import { useEffect, useMemo, useRef, useState } from 'react'
import { WorkspaceSwitcher } from '../shell/WorkspaceRail'
import { useShellStore } from '../shell/shellStore'
import { useStore } from '../store'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { Dialog, IconButton, MenuBar, MenuButton, Seg, Toggle } from '../ui/controls'
import type { MenuDef, MenuEntry } from '../ui/controls'
import { fmtDateTime, fmtTime, useClockFormat } from '../ui/time'
import { relTime } from '../editorial/wire'
import { FEED_COUNT, PORTALS, isPhoneFeed, useWatch, visibleItems, type WatchCat, type WatchItem } from './watchStore'
import { EW_FEEDS } from './ewSources'
import { MAX_RANGE_DAYS, checkRange, useRange } from './rangeSearch'
import { PORTAL_BRANDS } from './portalBrands'
import './news.css'

const YEASIN_PORTFOLIO = 'https://yeasinfiyaz.netlify.app'
const CAT_LABEL: Record<WatchCat, string> = { energy: 'Energy and power', leadership: 'PM & President' }
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

/** The left column's sections open and close; the choice is remembered. Portals starts closed (53 rows). */
type Folds = { show: boolean; trending: boolean; portals: boolean }
const FOLDS_KEY = 'esb-banner-studio/news/folds'
const loadFolds = (): Folds => { const d = { show: true, trending: true, portals: false }; try { return { ...d, ...JSON.parse(localStorage.getItem(FOLDS_KEY) ?? '{}') } } catch { return d } }
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
  useAutoCheck()
  useEffect(() => { if (!toast) return; const id = window.setTimeout(() => setToast(null), toast.undo ? 6000 : 3500); return () => window.clearTimeout(id) }, [toast])
  const say = (text: string, undo?: () => void) => setToast((t) => ({ text, undo, id: (t?.id ?? 0) + 1 }))
  // a check that just changed the list re-reads the clock, so a headline that arrived now never reads "in 1 min"
  const now = Math.max(tickNow, lastRun ?? 0)

  // what the list is drawn from: a date range's results, or the live list in the chosen window
  const base = useMemo(() => (range ? visibleItems(range.items, hidden, { ...prefs, maxAgeH: 24 * 365 }, '', 'all') : visibleItems(items, hidden, prefs, '', 'all')), [range, items, hidden, prefs])
  const isNew = useMemo(() => new Set(range ? [] : newKeys), [newKeys, range])
  const needle = q.trim().toLowerCase()
  // search reads the headline, the portal and the topic words that picked it
  const inSearch = useMemo(() => (needle ? base.filter((x) => x.title.toLowerCase().includes(needle) || x.source.toLowerCase().includes(needle) || x.matched.some((m) => m.toLowerCase() === needle)) : base), [base, needle])
  const shown = useMemo(() => inSearch.filter((x) => (cat === 'all' || x.categories.includes(cat)) && (!portal || x.source === portal)), [inSearch, cat, portal])
  // the headlines under time headings; what the latest check added comes first, under New
  const groups = useMemo<Group[]>(() => {
    const out: Group[] = []
    const add = (label: string, x: WatchItem) => { const g = out.at(-1); if (g && g.label === label) g.items.push(x); else out.push({ label, items: [x] }) }
    for (const x of shown) if (isNew.has(x.key)) add('New in the last check', x)
    const today = new Date(now); today.setHours(0, 0, 0, 0)
    for (const x of shown) {
      if (isNew.has(x.key)) continue
      const t = itemTime(x)
      const label = range ? dayFmt.format(t)
        : now - t < 3600_000 ? 'Last hour'
        : t >= today.getTime() ? 'Earlier today'
        : t >= today.getTime() - 86400_000 ? 'Yesterday' : dayFmt.format(t)
      add(label, x)
    }
    return out
  }, [shown, isNew, now, range])
  const ordered = useMemo(() => groups.flatMap((g) => g.items), [groups])
  const selected = ordered.find((x) => x.key === sel) ?? ordered[0] ?? null

  // counts for the left column, from the search but before the column's own filters
  const catCount = (c: 'all' | WatchCat) => inSearch.filter((x) => (c === 'all' || x.categories.includes(c)) && (!portal || x.source === portal)).length
  const trending = useMemo(() => {
    const c = new Map<string, number>()
    for (const x of base) for (const m of x.matched) c.set(m, (c.get(m) ?? 0) + 1)
    return [...c].filter(([t]) => t.length > 1).sort((a, b) => b[1] - a[1]).slice(0, 10)
  }, [base])
  const portalsOff = prefs.portalsOff
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
  // health is told per portal: one that answers on any of its feeds is answering
  const portalsOn = PORTALS.length - portalsOff.length
  const down = portalRows.filter((p) => p.bad).length
  const busy = range ? range.running : running
  const pct = range ? (range.total ? Math.round((range.done / range.total) * 100) : 0) : progress?.total ? Math.round((progress.done / progress.total) * 100) : 0
  const freshCount = base.filter((x) => isNew.has(x.key)).length
  const nextAuto = !range && prefs.autoMin > 0 && lastRun ? lastRun + prefs.autoMin * 60_000 : null

  // ---- actions
  const check = async () => {
    const r = await useWatch.getState().run()
    if (!r) return
    if (r.failed > r.checked / 2) say(`Most feeds did not answer (${r.failed} of ${r.checked}). Check the connection.`)
    else say(r.added ? `${r.added} new ${r.added === 1 ? 'headline' : 'headlines'}` : 'No new headlines')
  }
  const refresh = () => void (range ? useRange.getState().search(range.from, range.to) : check())
  const markAll = () => {
    const before = useWatch.getState().newKeys
    if (!before.length) return
    useWatch.getState().markAllRead()
    say(`${before.length} marked as read`, () => useWatch.setState({ newKeys: before }))
  }
  const startStory = (x: WatchItem) => useShellStore.getState().openStoryFrom(x.link)
  const use = (x: WatchItem) => (x.google ? openExternal(x.link) : startStory(x))
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
      } else if (e.key === 'Enter' && selected && !t?.closest('button')) { e.preventDefault(); if (selected.google) openExternal(selected.link); else useShellStore.getState().openStoryFrom(selected.link) }
    }
  })
  useEffect(() => { const h = (e: KeyboardEvent) => keyRef.current(e); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [])
  // At the top of the list, headlines a check adds above must show, not be scrolled out of sight by the browser's scroll
  // anchoring (which keeps the old first row in place). Lower down, anchoring stays on so reading is not disturbed.
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
    { label: 'Start a story from it', icon: 'filePlus', shortcut: 'Enter', disabled: !x || x.google, onClick: () => x && startStory(x) },
    { label: 'Open in the browser', icon: 'externalLink', disabled: !x, onClick: () => x && openExternal(x.link) },
    { label: 'Copy link', icon: 'copy', disabled: !x, onClick: () => x && copy(x) },
    { divider: true },
    { label: 'Mark as read', icon: 'check', disabled: !x || !isNew.has(x.key), onClick: () => x && useWatch.getState().markRead(x.key) },
    { label: 'Hide', icon: 'eyeOff', disabled: !x, onClick: () => x && hide(x) },
  ]
  const menus: MenuDef[] = [
    { label: 'News', items: [
      { label: range ? 'Search this range again' : 'Check now', icon: 'refresh', disabled: busy, onClick: refresh },
      { label: 'Pick dates and times…', icon: 'calendar', onClick: () => setDialog('range') },
      ...(range ? [{ label: 'Back to the latest', icon: 'clock' as IconName, onClick: () => useRange.getState().clear() }] : []),
      { divider: true },
      { label: 'Mark all as read', icon: 'checkDouble', disabled: !freshCount, onClick: markAll },
      { label: hidden.length ? `Show hidden headlines again (${hidden.length})` : 'Show hidden headlines again', icon: 'eye', disabled: !hidden.length, onClick: showHidden },
      { divider: true },
      { label: 'EnergyWatch settings…', icon: 'sliders', onClick: () => setDialog('settings') },
    ] },
    { label: 'View', items: [
      { heading: 'Headlines from' },
      ...WINDOWS.map((h) => ({ label: windowLabel(h), checked: !range && prefs.maxAgeH === h, onClick: () => setWindow(h) })),
      { label: 'Dates and times…', checked: !!range, onClick: () => setDialog('range') },
      { divider: true },
      { heading: 'Kinds of news' },
      { label: CAT_LABEL.energy, checked: prefs.show.energy, onClick: () => useWatch.getState().setPrefs({ show: { ...prefs.show, energy: !prefs.show.energy } }) },
      { label: CAT_LABEL.leadership, checked: prefs.show.leadership, onClick: () => useWatch.getState().setPrefs({ show: { ...prefs.show, leadership: !prefs.show.leadership } }) },
      { divider: true },
      { label: 'Search headlines', icon: 'search', shortcut: '/', onClick: () => searchRef.current?.focus() },
      { label: 'Clear filters', icon: 'x', disabled: !needle && cat === 'all' && !portal, onClick: clearFilters },
      { divider: true },
      { heading: 'Appearance' },
      { label: 'Light', icon: 'sun', checked: theme !== 'dark', onClick: () => useStore.getState().setTheme('light') },
      { label: 'Dark', icon: 'moon', checked: theme === 'dark', onClick: () => useStore.getState().setTheme('dark') },
    ] },
    { label: 'Headline', items: headlineItems(selected) },
  ]
  const timeMenu: MenuEntry[] = [
    ...WINDOWS.map((h) => ({ label: windowLabel(h), checked: !range && prefs.maxAgeH === h, onClick: () => setWindow(h) })),
    { divider: true },
    { label: 'Pick dates and times…', icon: 'calendar', checked: !!range, onClick: () => setDialog('range') },
  ]

  const when = (x: WatchItem) => (x.published ? (range ? fmtTime(Date.parse(x.published)) : relTime(Math.min(Date.parse(x.published), now), now)) : `found ${relTime(Math.min(x.foundAt, now), now)}`)
  const cats: ('all' | WatchCat)[] = ['all', ...(['energy', 'leadership'] as WatchCat[]).filter((c) => prefs.show[c])]
  const filtered = !!needle || cat !== 'all' || !!portal
  const feedTone = busy ? 'on' : down > portalsOn / 2 ? 'off' : down ? 'warn' : lastRun ? 'on' : 'idle'

  return (
    <div className="news-workspace">
      <header className="topbar ed-head nw-head">
        <WorkspaceSwitcher />
        <MenuBar menus={menus} />
        <div className="spacer" />
        <div className="nw-brand">
          <EwMark size={24} />
          <b><EwName /></b>
          <span className="nw-by">by <YeasinName /></span>
        </div>
        <div className="spacer" />
        <MenuButton icon="clock" label={range ? 'Dates' : windowLabel(prefs.maxAgeH)} items={timeMenu} align="end" className="nw-when" title="Which headlines to show" />
        <IconButton icon="sliders" tip="EnergyWatch settings" onClick={() => setDialog('settings')} />
        <button type="button" className={'btn primary nw-check' + (busy ? ' is-busy' : '')} disabled={busy} onClick={refresh} data-tip={range ? 'Search this range again' : 'Read every portal now'}>
          <Icon name="refresh" size={15} /><span>{busy ? (range ? 'Searching' : 'Reading') : range ? 'Search again' : 'Check now'}</span>
        </button>
      </header>

      <div className="nw-body">
        {/* ---------------------------------------------------------------- left: what to show */}
        <aside className="nw-left" aria-label="Filters">
          <div className="nw-left-scroll">
            <Fold id="show" title="Show" open={folds.show} onToggle={toggleFold} aside={folds.show ? null : cat === 'all' ? 'All' : CAT_LABEL[cat]}>
              <div className="nw-nav" role="radiogroup" aria-label="Kinds of news">
                {cats.map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={cat === c} className={'nw-nav-row' + (cat === c ? ' on' : '') + ' is-' + c} onClick={() => setCat(c)}>
                    <span className="nw-nav-ic"><Icon name={c === 'all' ? 'inbox' : c === 'energy' ? 'bolt' : 'users'} size={15} /></span>
                    <span className="nw-nav-label">{c === 'all' ? 'All headlines' : CAT_LABEL[c]}</span>
                    <span className="nw-count">{catCount(c)}</span>
                  </button>
                ))}
              </div>
            </Fold>

            {trending.length > 0 && (
              <Fold id="trending" title="Trending" open={folds.trending} onToggle={toggleFold} aside={folds.trending ? null : needle ? q.trim() : `${trending.length} topics`}>
                <div className="nw-trend">
                  {trending.map(([t, n]) => {
                    const on = needle === t.toLowerCase()
                    return <button key={t} type="button" lang={lang(t)} className={'nw-chip' + (on ? ' on' : '')} aria-pressed={on} onClick={() => setQ(on ? '' : t)} data-tip={`${n} ${n === 1 ? 'headline mentions' : 'headlines mention'} ${t}`}>{t}<small>{n}</small></button>
                  })}
                </div>
              </Fold>
            )}

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
        </aside>

        {/* ---------------------------------------------------------------- centre: the headlines */}
        <main className="nw-center">
          <div className="nw-toolbar">
            <label className="nw-search">
              <Icon name="search" size={15} />
              <input ref={searchRef} type="search" placeholder="Search headlines, portals or topics" aria-label="Search headlines" value={q} onChange={(e) => setQ(e.target.value)} />
              {q ? <button type="button" className="nw-search-x" aria-label="Clear the search" onClick={() => { setQ(''); searchRef.current?.focus() }}><Icon name="x" size={14} /></button> : <kbd className="nw-kbd">/</kbd>}
            </label>
            {portal && <button type="button" className="nw-filter" onClick={() => setPortal(null)} data-tip="Show every portal"><PortalIcon name={portal} size={12} />{portal}<Icon name="x" size={12} /></button>}
            <span className="nw-grow" />
            {freshCount > 0 && <button type="button" className="btn nw-markall" onClick={markAll} data-tip="Mark all as read"><Icon name="checkDouble" size={15} /><b>{freshCount}</b> new</button>}
            {/* the check's progress: a track under the toolbar (inside the list, the sticky time headings covered it) */}
            {busy && !range && <span className="nw-progress" role="progressbar" aria-label="Reading the feeds" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ '--p': `${pct}%` } as React.CSSProperties} /></span>}
          </div>
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
                            {x.categories.includes('leadership') && <span className="nw-tag is-lead" data-tip="PM & President"><Icon name="users" size={12} /></span>}
                            {x.google && <span className="nw-tag" data-tip="Google News link: opens in the browser"><Icon name="globe" size={12} /></span>}
                          </span>
                          <span className="nw-hl" lang={lang(x.title)}>{x.title}</span>
                        </button>
                        <span className="nw-row-acts">
                          {!x.google && <button type="button" className="btn nw-start" onClick={() => startStory(x)} data-tip="Start a story from this link (Enter)"><Icon name="filePlus" size={14} />Start a story</button>}
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
                <h3>{busy ? (range ? 'Searching the portals' : 'Reading the portals') : filtered ? 'Nothing matches' : base.length || items.length || range ? 'No headlines in this window' : <EwName />}</h3>
                <p>{busy ? 'Headlines appear here as each portal answers.'
                  : filtered ? 'No headline here has those words, that portal or that kind of news.'
                  : range ? 'No energy or PM & President headlines between these times. Try a wider range.'
                  : items.length ? 'Nothing was published in this window. Try a longer one.'
                  : `Energy, power and PM & President headlines from ${PORTALS.length} Bangladeshi portals, picked by EnergyWatch's rules. Runs on this computer.`}</p>
                {filtered && !busy && <button type="button" className="btn" onClick={clearFilters}><Icon name="x" size={14} />Clear filters</button>}
                {!filtered && !busy && !items.length && !range && <button type="button" className="btn primary" onClick={refresh}><Icon name="refresh" size={15} />Check now</button>}
                {!filtered && !busy && items.length > 0 && !range && prefs.maxAgeH < 24 && <button type="button" className="btn" onClick={() => setWindow(24)}><Icon name="clock" size={14} />Last 24 hours</button>}
              </div>
            )}
          </div>
        </main>

        {/* ---------------------------------------------------------------- right: the chosen headline */}
        <aside className="nw-right" aria-label="Headline">
          <div className="nw-right-scroll">
            {selected ? <Detail x={selected} isNew={isNew.has(selected.key)} now={now} range={!!range} onCopy={() => copy(selected)} onTopic={(t) => setQ(t)} onPortal={(p) => setPortal(p)} /> : (
              <div className="nw-card nw-about">
                <div className="nw-credit"><EwMark size={36} /><span><b><EwName /></b><small>by <YeasinName /></small></span></div>
                <p className="nw-help">EnergyWatch reads {PORTALS.length} Bangladeshi news portals and keeps the energy, power and PM & President headlines. Pick one to see why it was chosen and start a story from it.</p>
              </div>
            )}
          </div>
          <div className="nw-right-foot">
            {selected && (
              <p className="nw-foot-note">{selected.google ? 'Google News link: it opens in the browser. Find the portal\'s own page to start a story.' : <>Opens Editorial with this link in <b>Paste Story Link</b>. Nothing is fetched until you press Fetch.</>}</p>
            )}
            <button type="button" className="btn primary nw-go" disabled={!selected} onClick={() => selected && use(selected)}>
              <Icon name={selected?.google ? 'externalLink' : 'filePlus'} size={15} />{selected?.google ? 'Open in the browser' : 'Start a story'}
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
          data-tip={busy ? 'Reading the portals now' : down ? `${down} ${down === 1 ? 'portal is' : 'portals are'} not answering (red dot in the list). Click for the portals` : lastRun ? 'Every portal answered the last check. Click for the portals' : 'Not checked yet'}>
          <span className="sb-k">Portals</span>
          <span className="sb-pill"><i className="sb-dot" aria-hidden />
            {range ? (range.running ? `Searching ${pct}%` : `${range.items.length} found`)
              : running ? `Reading ${progress?.done ?? 0} of ${progress?.total ?? FEED_COUNT} feeds`
              : !lastRun ? 'Not checked yet'
              : down ? `${portalsOn - down} of ${portalsOn} answering` : `${portalsOn} answering · ${FEED_COUNT} feeds`}
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
          {' · '}{range ? 'chosen dates' : windowLabel(prefs.maxAgeH).toLowerCase()}
        </span>
      </footer>

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

// ---------------------------------------------------------------- right column: the chosen headline
function Detail({ x, isNew, now, range, onCopy, onTopic, onPortal }: { x: WatchItem; isNew: boolean; now: number; range: boolean; onCopy: () => void; onTopic: (t: string) => void; onPortal: (p: string) => void }) {
  const t = x.published ? Date.parse(x.published) : null
  return (
    <>
      <section className="nw-card nw-detail" key={x.key}>
        <header className="nw-detail-top">
          <button type="button" className="nw-detail-src" onClick={() => onPortal(x.source)} data-tip={`Only ${x.source}`}><PortalName name={x.source} size={16} /></button>
          {isNew && <span className="nw-newtag">New</span>}
        </header>
        <h2 className="nw-detail-hl" lang={lang(x.title)}>{x.title}</h2>
        <p className="nw-detail-when">
          <Icon name="clock" size={13} />
          {t ? <span>{fmtDateTime(t)}{!range && <em> · {relTime(Math.min(t, now), now)}</em>}</span> : <span>Time not given · found {relTime(Math.min(x.foundAt, now), now)}</span>}
        </p>
        <div className="nw-kinds">
          {x.categories.includes('energy') && <span className="nw-kind is-energy"><Icon name="bolt" size={12} />Energy and power</span>}
          {x.categories.includes('leadership') && <span className="nw-kind is-lead"><Icon name="users" size={12} />PM & President</span>}
        </div>
      </section>

      {x.matched.length > 0 && (
        <section className="nw-card">
          <h4 className="nw-sec-h">Why it is here</h4>
          <p className="nw-help">The headline has {x.matched.length === 1 ? 'this word' : 'these words'} from EnergyWatch's list.</p>
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
        {x.google && <p className="nw-help">Only Google News has this story; its link is encoded, so it opens in the browser.</p>}
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
    return { tone: 'ok', text: `${fs.length} ${fs.length === 1 ? 'feed' : 'feeds'} · answering` }
  }
  return (
    <Dialog title="EnergyWatch" kicker="News desk settings" onClose={onClose} width={720}
      footer={<>
        <button type="button" className="btn ghost" onClick={() => { useWatch.getState().resetPrefs(); useRange.getState().clear(); onRestored() }}><Icon name="reset" size={14} />Restore EnergyWatch's settings</button>
        <span className="nw-grow" />
        <button type="button" className="btn primary" onClick={onClose}>Done</button>
      </>}>
      <div className="nw-settings">
        <div className="nw-credit nw-credit-lg"><EwMark size={40} /><span><b><EwName /></b><small>Made by <YeasinName /> for ESB Power Line. Its portals and keyword rules come from EnergyWatch; your changes here stay on this computer.</small></span></div>

        <section className="nw-dsec">
          <h4 className="nw-sec-h">Show</h4>
          <div className="nw-rows">
            <div className="nw-setrow"><span className="nw-setrow-ic is-energy"><Icon name="bolt" size={15} /></span><span className="nw-setrow-t"><b>Energy and power</b><small>Electricity, gas, fuel, LNG, LPG, power plants and the companies</small></span><Toggle checked={prefs.show.energy} label="Energy and power" onChange={(v) => setPrefs({ show: { ...prefs.show, energy: v } })} /></div>
            <div className="nw-setrow"><span className="nw-setrow-ic is-lead"><Icon name="users" size={15} /></span><span className="nw-setrow-t"><b>PM & President</b><small>Bangladesh's Prime Minister and President (foreign leaders are left out)</small></span><Toggle checked={prefs.show.leadership} label="PM and President" onChange={(v) => setPrefs({ show: { ...prefs.show, leadership: v } })} /></div>
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

        <WordList title="Always show headlines with" help="Your own words, on top of EnergyWatch's list. English matches whole words; Bangla matches inside words, so বিদ্যুৎ also finds বিদ্যুতের."
          words={prefs.keep} onChange={(keep) => setPrefs({ keep })} placeholder="e.g. Rooppur, সৌরবিদ্যুৎ" />
        <WordList title="Never show headlines with" help="A headline with any of these is left out, whatever else it says."
          words={prefs.never} onChange={(never) => setPrefs({ never })} placeholder="e.g. cricket" />

        <section className="nw-dsec">
          <h4 className="nw-sec-h">Portals<small>{PORTALS.length - prefs.portalsOff.length} of {PORTALS.length} on · {FEED_COUNT} feeds: own, Google News and Bing News</small></h4>
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
    <Dialog title="Pick dates and times" kicker="EnergyWatch" onClose={onClose} width={520}
      footer={<><span className="nw-grow" /><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={!!err} onClick={go}><Icon name="search" size={14} />Find headlines</button></>}>
      <div className="nw-settings">
        <p className="nw-help">Every energy and PM & President headline the portals published between these two moments, up to {MAX_RANGE_DAYS} days.</p>
        <div className="nw-trend">{presets.map(([l, f]) => <button key={l} type="button" className="nw-chip" onClick={f}>{l}</button>)}</div>
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
