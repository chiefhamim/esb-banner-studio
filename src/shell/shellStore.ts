import { create } from 'zustand'

export type WorkspaceId = 'home' | 'graphics' | 'editorial' | 'video' | 'audio'

interface ShellState {
  workspace: WorkspaceId
  setWorkspace: (ws: WorkspaceId) => void
  recoveryAvailable: boolean
  recoveryTime: string | null
  setRecoveryAvailable: (avail: boolean, timeStr?: string | null) => void
}

const STORAGE_KEY = 'esb-banner-studio/shell'

function loadSavedWorkspace(): WorkspaceId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed.workspace === 'home' || parsed.workspace === 'graphics') {
        return parsed.workspace
      }
    }
  } catch { /* ignore */ }
  return 'graphics' // Default to graphics workspace
}

export const useShellStore = create<ShellState>((set) => ({
  workspace: loadSavedWorkspace(),
  setWorkspace: (ws) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ workspace: ws }))
    } catch { /* ignore */ }
    set({ workspace: ws })
  },
  recoveryAvailable: false,
  recoveryTime: null,
  setRecoveryAvailable: (avail, timeStr = null) => {
    set({ recoveryAvailable: avail, recoveryTime: timeStr })
  },
}))
