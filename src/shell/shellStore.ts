import { create } from 'zustand'

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

/** The app always opens on Home, whichever workspace was open when it was closed. */
const loadSavedWorkspace = (): WorkspaceId => 'home'

export const useShellStore = create<ShellState>((set, get) => ({
  workspace: loadSavedWorkspace(),
  setWorkspace: (ws) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ workspace: ws }))
    } catch { /* ignore */ }
    // any move away from Graphics ends the round trip, so the back button never outlives it
    set((st) => ({ workspace: ws, returnTo: ws === 'graphics' ? st.returnTo : null }))
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
