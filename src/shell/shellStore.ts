import { create } from 'zustand'
import { reducedMotion } from '../ui/motion'

export type WorkspaceId = 'home' | 'graphics' | 'editorial' | 'video' | 'audio'

interface ShellState {
  workspace: WorkspaceId
  setWorkspace: (ws: WorkspaceId) => void
  recoveryAvailable: boolean
  recoveryTime: string | null
  setRecoveryAvailable: (avail: boolean, timeStr?: string | null) => void
  /** Editorial → Graphics hand-off: which left-panel tab Graphics should open on, consumed once on arrival. */
  graphicsFocus: 'photos' | null
  /** Workspace that sent the user to Graphics, so Graphics can offer the way back. */
  returnTo: WorkspaceId | null
  openGraphicsFrom: (from: WorkspaceId, focus: 'photos' | null) => void
  consumeGraphicsFocus: () => 'photos' | null
}

const STORAGE_KEY = 'esb-banner-studio/shell'
let moving = false
let queued: WorkspaceId | null = null
/** Which way the last desk change went (+1 toward Video, -1 toward Home); App.tsx animates the arriving desk with it. */
export const deskMotion = { dir: 1 as 1 | -1 }
const ORDER: WorkspaceId[] = ['home', 'editorial', 'graphics', 'video', 'audio']

/** The app always opens on Home, whichever workspace was open when it was closed. */
const loadSavedWorkspace = (): WorkspaceId => 'home'

export const useShellStore = create<ShellState>((set, get) => ({
  workspace: loadSavedWorkspace(),
  setWorkspace: (ws) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ workspace: ws }))
    } catch { /* ignore */ }
    // any move away from Graphics ends the round trip, so the back button never outlives it
    const apply = () => set((st) => ({ workspace: ws, returnTo: ws === 'graphics' ? st.returnTo : null }))
    const from = get().workspace
    const el = document.querySelector<HTMLElement>('.workspace-main > *')
    if (from === ws || !el || typeof el.animate !== 'function' || reducedMotion()) { apply(); return }
    // the desk on screen eases out toward the side it came from, then the new desk drifts in and settles (App.tsx)
    if (moving) { queued = ws; return }
    moving = true
    deskMotion.dir = ORDER.indexOf(ws) >= ORDER.indexOf(from) ? 1 : -1
    el.style.pointerEvents = 'none'
    const out = el.animate([{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: `translateX(${-deskMotion.dir * 22}px)` }], { duration: 150, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' })
    const done = () => {
      apply()
      moving = false
      if (queued && queued !== ws) { const next = queued; queued = null; get().setWorkspace(next) } else queued = null
    }
    out.finished.then(done, done)
  },
  recoveryAvailable: false,
  recoveryTime: null,
  setRecoveryAvailable: (avail, timeStr = null) => {
    set({ recoveryAvailable: avail, recoveryTime: timeStr })
  },
  graphicsFocus: null,
  returnTo: null,
  openGraphicsFrom: (from, focus) => {
    set({ returnTo: from, graphicsFocus: focus })
    get().setWorkspace('graphics')
  },
  consumeGraphicsFocus: () => {
    const f = get().graphicsFocus
    if (f) set({ graphicsFocus: null })
    return f
  },
}))
