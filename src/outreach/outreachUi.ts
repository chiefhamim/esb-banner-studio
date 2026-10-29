// What the desk is showing — tabs, the editor's view and which sheet is open — shared by the header menus and the
// columns, so "View → Sources" and the Sources tab are one switch. Not saved: every launch opens on Contacts / Edit.
// `ask()` is the desk's own confirm/prompt: the browser's grey window.confirm/prompt looked like an error from another
// program, ignored the theme and blocked the whole app.

import { create } from 'zustand'

export type LeftTab = 'contacts' | 'campaigns' | 'sources'
export type RightTab = 'send' | 'contact' | 'review'
export type Sheet = null | 'sender' | 'ai' | 'signatures' | 'prompt' | 'footer' | 'review-send' | 'save-template' | 'rename' | 'follow-up' | 'templates'

export interface AskRequest {
  title: string
  body?: string
  /** With an input the answer is its text; without, true. Cancel is null. */
  input?: { label: string; value?: string; placeholder?: string; multiline?: boolean; pattern?: RegExp }
  ok: string
  danger?: boolean
}

interface UiState {
  left: LeftTab
  right: RightTab
  view: 'edit' | 'preview'
  sheet: Sheet
  showLog: boolean
  asking: (AskRequest & { resolve: (v: string | true | null) => void }) | null
  set: (p: Partial<Omit<UiState, 'set'>>) => void
}

export const useOutreachUi = create<UiState>((set) => ({
  left: 'contacts', right: 'send', view: 'edit', sheet: null, showLog: false, asking: null,
  set: (p) => set(p),
}))

export function ask(req: AskRequest): Promise<string | true | null> {
  return new Promise((resolve) => {
    useOutreachUi.getState().asking?.resolve(null)
    useOutreachUi.setState({ asking: { ...req, resolve: (v) => { useOutreachUi.setState({ asking: null }); resolve(v) } } })
  })
}
