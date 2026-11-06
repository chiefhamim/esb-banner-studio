import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react'
import './App.css'
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
import './styles/home.css'
import './styles/outreach.css'
import './styles/outreach-activity.css'
// the design layer loads after every other stylesheet so it is the last word on shared chrome
import './styles/studio.css'

installBannerLink()

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
    const el = document.querySelector<HTMLElement>('.workspace-main > *')
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

  if (isGallery) {
    return <Suspense fallback={<DeskLoading />}><ComponentGallery /></Suspense>
  }

  return (
    <div className="studio-shell">
      <div className="workspace-main">
        {/* each desk has its own error boundary: a render error shows a recoverable message there, never a blank app */}
        {workspace === 'home' && <DeskBoundary desk="Home"><HomeWorkspace /></DeskBoundary>}
        <Suspense fallback={<DeskLoading />}>
          {workspace === 'editorial' && <DeskBoundary desk="Editorial" onLeave={toHome}><EditorialWorkspace /></DeskBoundary>}
          {workspace === 'video' && <DeskBoundary desk="Video" onLeave={toHome}><VideoWorkspace /></DeskBoundary>}
          {workspace === 'outreach' && <DeskBoundary desk="Outreach" onLeave={toHome}><OutreachWorkspace /></DeskBoundary>}
          {workspace === 'news' && <DeskBoundary desk="News" onLeave={toHome}><NewsWorkspace /></DeskBoundary>}
        </Suspense>
        {workspace === 'graphics' && (
          base ? <DeskBoundary desk="Graphics" onLeave={toHome}><GraphicsWorkspace base={base} /></DeskBoundary> : (
            <div className="loading"><div className="spinner" />Loading fonts and artwork…</div>
          )
        )}
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
