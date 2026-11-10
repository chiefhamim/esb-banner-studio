import { Activity, Suspense, lazy, startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { WorkspaceId } from './shell/shellStore'
import './App.css'
import { DeskRail, useDeskNav } from './shell/WorkspaceRail'
import { loadBaseAssets } from './core/assets'
import type { Assets } from './core/render'
import { HomeWorkspace } from './shell/HomeWorkspace'
import { GraphicsWorkspace } from './shell/GraphicsWorkspace'
import { startScheduler } from './outreach/campaign'
import { useShellStore, deskMotion } from './shell/shellStore'
import { arriveFrames, reducedMotion } from './ui/motion'
import { useStore } from './store'
import { Dialog, Tooltips } from './ui/controls'
import { DeskBoundary } from './ui/DeskBoundary'
import { CATEGORIES } from './core/tokens'
import { installBannerLink } from './editorial/bannerLink'
import { installScrollCalm } from './ui/scrollCalm'
import { installHeaderCentering } from './ui/headerCenter'
import './styles/home.css'
import './styles/outreach.css'
import './styles/outreach-activity.css'
// the design layer loads after every other stylesheet so it is the last word on shared chrome
import './styles/studio.css'
import './styles/newsroom.css'
import './styles/side-rail.css'

installBannerLink()
installScrollCalm()
installHeaderCentering()

// Editorial (TipTap, the AI SDKs), Video (mediabunny) and Outreach (the workbook reader) are their own chunks, so the
// app opens on Home and Graphics without parsing them: the single bundle was 2.3 MB. They are fetched in the background
// once the first screen is up (below), so switching desk does not wait on the network or the parser.
const loadEditorial = () => import('./editorial/EditorialWorkspace')
const loadVideo = () => import('./video/VideoWorkspace')
const loadOutreach = () => import('./outreach/OutreachWorkspace')
const loadNews = () => import('./news/NewsWorkspace')
const EditorialWorkspace = lazy(() => loadEditorial().then((m) => ({ default: m.EditorialWorkspace })))
const VideoWorkspace = lazy(() => loadVideo().then((m) => ({ default: m.VideoWorkspace })))
const OutreachWorkspace = lazy(() => loadOutreach().then((m) => ({ default: m.OutreachWorkspace })))
const NewsWorkspace = lazy(() => loadNews().then((m) => ({ default: m.NewsWorkspace })))
const ComponentGallery = lazy(() => import('./ui/ComponentGallery').then((m) => ({ default: m.ComponentGallery })))
const KEEP_ALIVE: WorkspaceId[] = ['news', 'editorial', 'graphics', 'outreach']
const toHome = () => useShellStore.getState().setWorkspace('home')
const DeskLoading = () => <div className="loading"><div className="spinner" />Opening the desk</div>

export default function App() {
  const [base, setBase] = useState<Assets | null>(null)
  const workspace = useShellStore((s) => s.workspace)
  const theme = useStore((s) => s.theme)
  const quitPrompt = useShellStore((s) => s.quitPrompt)
  const isGallery = typeof window !== 'undefined' && window.location.search.includes('gallery')

  useEffect(() => {
    loadBaseAssets().then((b) => setBase(b))
    // a campaign scheduled on the Outreach desk starts at its time whichever desk is open
    startScheduler()
    // warm the other desks while the editor is still looking at the first screen
    const warm = () => { void loadEditorial(); void loadOutreach(); void loadVideo(); void loadNews() }
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
    if (idle) idle(warm, { timeout: 3000 }); else setTimeout(warm, 1500)
  }, [])

  // A desk that arrives after a switch drifts in and settles with a soft overshoot, on the same spring as the tab chip
  // (the desk that was showing has already eased out in shellStore.setWorkspace)
  const lastDesk = useRef(workspace)
  useLayoutEffect(() => {
    if (lastDesk.current === workspace) return
    lastDesk.current = workspace
    // a parked desk keeps the end state of its exit animation (faded, shifted, pointer-events off): clear it now, while
    // it is hidden, so it is whole the next time it is shown
    for (const p of document.querySelectorAll<HTMLElement>('.workspace-main > .desk-slot.is-parked')) { p.getAnimations().forEach((a) => a.cancel()); p.style.removeProperty('pointer-events') }
    const el = document.querySelector<HTMLElement>(`.workspace-main > .desk-slot[data-desk="${workspace}"]`)
    if (!el || typeof el.animate !== 'function' || reducedMotion()) return
    el.animate(arriveFrames(deskMotion.dir), { duration: 560, easing: 'linear' })
  }, [workspace])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.dataset.workspace = workspace
  }, [theme, workspace])

  // The story's category colour on the page root for Editorial and Graphics, so menus, popovers and dialogs
  // mark a selection in the same colour as the open panel and the chosen tile.
  // Outreach is independent and unaffected by story categories, using its own brand colour.
  const categoryId = useStore((s) => s.doc.content.categoryId)
  useEffect(() => {
    const root = document.documentElement.style
    if (workspace === 'outreach') {
      root.setProperty('--cat', theme === 'dark' ? '#3b82f6' : '#2563eb')
      root.setProperty('--cat-ink', '#ffffff')
      return
    }
    // News is EnergyWatch's desk: its teal marks selection there (Yeasin's app: #0d9488, dark #2dd4bf)
    if (workspace === 'news') {
      root.setProperty('--cat', theme === 'dark' ? '#2dd4bf' : '#0d9488')
      root.setProperty('--cat-ink', theme === 'dark' ? '#042f2e' : '#ffffff')
      return
    }
    const c = CATEGORIES.find((x) => x.id === categoryId)
    if (c) {
      root.setProperty('--cat', c.accent)
      root.setProperty('--cat-ink', c.chipText)
    } else {
      root.removeProperty('--cat')
      root.removeProperty('--cat-ink')
    }
  }, [categoryId, workspace, theme])

  // Ctrl+Q quits the desktop app from any workspace, as the Home → Quit button does
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'q' && window.esb?.quit) {
        e.preventDefault()
        void useShellStore.getState().triggerQuit()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  useEffect(() => {
    if (window.esb?.onOutreach) {
      return window.esb.onOutreach((m: any) => {
        if (m.kind === 'request-quit') {
          useShellStore.getState().setQuitPrompt(true)
        }
      })
    }
  }, [])

  const deskNav = useDeskNav()
  const [kept, setKept] = useState<ReadonlySet<WorkspaceId>>(() => new Set(KEEP_ALIVE.includes(workspace) ? [workspace] : []))
  useEffect(() => { if (KEEP_ALIVE.includes(workspace)) setKept((k) => (k.has(workspace) ? k : new Set([...k, workspace]))) }, [workspace])
  // Pre-build the other desks hidden, one at a time while the app is idle: a hidden <Activity> renders at the lowest
  // priority and runs no effects (nothing fetches, ticks or listens until the desk is opened), so the first visit to a
  // desk is a reveal instead of a build.
  useEffect(() => {
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 200))
    const timers: number[] = []
    KEEP_ALIVE.forEach((id, i) => timers.push(window.setTimeout(() => idle(() => startTransition(() => setKept((k) => (k.has(id) ? k : new Set([...k, id])))), { timeout: 4000 }), 2500 + i * 1200)))
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [])
  // React's <Activity> parks a desk: hidden from layout, its effects (timers, listeners, observers) stopped, its state
  // and DOM kept; showing it re-runs the effects only. The desk elements are memoised so an App update never re-renders
  // a desk (with four desks kept, that re-render was ~20-40 ms per switch — tools/audit/electron-switch-trace.mjs).
  const slot = (id: WorkspaceId, node: ReactNode) => {
    const on = workspace === id
    if (!on && !kept.has(id)) return null
    // the slot (and its active/parked mark) sits OUTSIDE the <Activity>: React defers every update inside a hidden
    // Activity, so a mark inside it stayed "is-active" after the desk was parked — the next switch then faded out the
    // wrong desk, which came back at opacity 0 (a blank window)
    return <div key={id} className={'desk-slot ' + (on ? 'is-active' : 'is-parked')} data-desk={id}><Activity mode={on ? 'visible' : 'hidden'}>{node}</Activity></div>
  }
  const newsDesk = useMemo(() => <Suspense fallback={<DeskLoading />}><DeskBoundary desk="News" onLeave={toHome}><NewsWorkspace /></DeskBoundary></Suspense>, [])
  const editorialDesk = useMemo(() => <Suspense fallback={<DeskLoading />}><DeskBoundary desk="Editorial" onLeave={toHome}><EditorialWorkspace /></DeskBoundary></Suspense>, [])
  const outreachDesk = useMemo(() => <Suspense fallback={<DeskLoading />}><DeskBoundary desk="Outreach" onLeave={toHome}><OutreachWorkspace /></DeskBoundary></Suspense>, [])
  const graphicsDesk = useMemo(() => base ? <DeskBoundary desk="Graphics" onLeave={toHome}><GraphicsWorkspace base={base} /></DeskBoundary> : <div className="loading"><div className="spinner" />Loading fonts and artwork…</div>, [base])
  if (isGallery) {
    return <Suspense fallback={<DeskLoading />}><ComponentGallery /></Suspense>
  }

  return (
    <div className="studio-shell" data-desknav={deskNav}>
      {deskNav === 'left' && workspace !== 'home' && <DeskRail />}
      <div className="workspace-main">
        {/* Desks stay mounted after their first visit and are parked (invisible, inert) while another is on screen, so
            switching back is instant: no rebuild, scroll and open panels exactly as left. Home is light and Video holds
            decoded media (and could keep playing), so those two are built only while open. A parked desk's effects are
            stopped by <Activity>; its window listeners also check deskIs() as a second guard. */}
        {workspace === 'home' && <div className="desk-slot is-active" data-desk="home"><DeskBoundary desk="Home"><HomeWorkspace /></DeskBoundary></div>}
        {slot('news', newsDesk)}
        {slot('editorial', editorialDesk)}
        {slot('graphics', graphicsDesk)}
        {slot('outreach', outreachDesk)}
        {workspace === 'video' && <div className="desk-slot is-active" data-desk="video"><Suspense fallback={<DeskLoading />}><DeskBoundary desk="Video" onLeave={toHome}><VideoWorkspace /></DeskBoundary></Suspense></div>}
      </div>
      {/* one tooltip layer for every workspace (it lived inside Graphics, so Editorial, Video and Home had none) */}
      <Tooltips />
      {quitPrompt && (
        <Dialog
          title="Sending is in progress"
          kicker="OUTREACH"
          width={480}
          onClose={() => useShellStore.getState().setQuitPrompt(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => useShellStore.getState().setQuitPrompt(false)}>
                Keep sending
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  useShellStore.getState().setQuitPrompt(false)
                  void window.esb?.quit?.(true)
                }}
              >
                Quit and pause
              </button>
            </>
          }
        >
          <p style={{ margin: 0, fontSize: 13, lineHeight: '20px', color: 'var(--text-2)' }}>
            Quit now? Sending pauses and can be resumed the next time you open ESB AI Studio.
          </p>
        </Dialog>
      )}
    </div>
  )
}
