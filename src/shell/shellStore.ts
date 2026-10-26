import { create } from 'zustand'
import { flushSync } from 'react-dom'

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
    // Between desks the browser cross-dissolves a snapshot of the old desk into the new one (View Transitions), with the two
    // sliding a few pixels in mirror image along the order Home, Editorial, Graphics, Video. Neither desk is mounted twice.
    const vt = (document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } }).startViewTransition
    if (from === ws || typeof vt !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { apply(); return }
    const dir = ORDER.indexOf(ws) >= ORDER.indexOf(from) ? 1 : -1
    const root = document.documentElement
    root.style.setProperty('--ws-dir', String(dir))
    root.dataset.vt = '1'
    const t = vt.call(document, () => { flushSync(apply) })
    t.finished.finally(() => { delete root.dataset.vt })
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
