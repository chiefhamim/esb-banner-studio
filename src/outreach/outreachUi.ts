// What the desk is showing — tabs, the editor's view and which sheet is open — shared by the header menus and the
// columns, so "View → Sources" and the Sources tab are one switch. Not saved: every launch opens on Contacts / Edit.

import { create } from 'zustand'

export type LeftTab = 'contacts' | 'campaigns' | 'sources'
export type RightTab = 'send' | 'contact' | 'review'
export type Sheet = null | 'sender' | 'ai' | 'signatures' | 'prompt' | 'review-send' | 'save-template' | 'rename'

interface UiState {
  left: LeftTab
  right: RightTab
  view: 'edit' | 'preview'
  sheet: Sheet
  showLog: boolean
  set: (p: Partial<Omit<UiState, 'set'>>) => void
}

export const useOutreachUi = create<UiState>((set) => ({
  left: 'contacts', right: 'send', view: 'edit', sheet: null, showLog: false,
  set: (p) => set(p),
}))
