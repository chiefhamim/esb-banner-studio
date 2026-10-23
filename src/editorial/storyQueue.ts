// The story queue: several stories in flight at once, each with its own source, draft and checklist, and a status
// the desk can read at a glance. The editorial store still holds the one story being edited; the queue keeps a
// snapshot of every story, autosaves the active one, and swaps a story back in when the editor picks it.
//
// Everything stays on this machine (localStorage), capped at MAX_STORIES so the store cannot outgrow the ~5 MB a
// browser profile allows. Nothing here talks to the site: a story reaches esbpowerline.com only through Publish.

import { create } from 'zustand'
import { useEditorialStore } from './editorialStore'
import type { EditorialChecklist, EditorialDraft } from './editorialStore'

export type StoryStatus = 'draft' | 'review' | 'approved' | 'published'
export const STATUS_LABEL: Record<StoryStatus, string> = { draft: 'Draft', review: 'Needs check', approved: 'Approved', published: 'Published' }
export const STORY_STATUSES: StoryStatus[] = ['draft', 'review', 'approved', 'published']

type EditorialSnapshot = {
  source: ReturnType<typeof useEditorialStore.getState>['source']
  draft: EditorialDraft
  checklist: EditorialChecklist
  deskAuto: boolean
  translationProvider: ReturnType<typeof useEditorialStore.getState>['translationProvider']
  modelUsed: string | null
}

export interface StoryItem {
  id: string
  status: StoryStatus
  /** The status was picked by hand, so the checklist no longer moves it. */
  statusPinned?: boolean
  createdAt: number
  updatedAt: number
  publishedUrl?: string
  snapshot: EditorialSnapshot
}

export const MAX_STORIES = 40
const KEY = 'esb-banner-studio/editorial/queue/v1'

// ---------------------------------------------------------------- pure helpers (unit-tested)

/** The name a story goes by in the queue: the English headline, else the source's own title. */
export function storyTitle(s: Pick<EditorialSnapshot, 'draft' | 'source'>): string {
  return s.draft.headline.trim() || s.source?.title?.trim() || 'Untitled story'
}

export function hasContent(s: Pick<EditorialSnapshot, 'draft' | 'source'>): boolean {
  return !!(s.source || s.draft.headline.trim() || s.draft.body.trim())
}

/** The three checks the publish sheet requires — all ticked moves a story from draft to approved. */
export function checklistDone(c: EditorialChecklist): boolean {
  return c.figuresChecked && c.namesChecked && c.attributionKept
}

/** Status follows the work unless an editor set it by hand; published is never undone by the checklist. */
export function nextStatus(item: Pick<StoryItem, 'status' | 'statusPinned'>, snap: EditorialSnapshot): StoryStatus {
  if (item.status === 'published' || item.statusPinned) return item.status
  if (checklistDone(snap.checklist)) return 'approved'
  return snap.draft.body.trim() ? 'review' : 'draft'
}

/**
 * Keep the queue within MAX_STORIES: the active story always stays; published stories go first, then the oldest
 * by last edit. Returns newest-first.
 */
export function capStories(items: StoryItem[], activeId: string | null, max = MAX_STORIES): StoryItem[] {
  const sorted = [...items].sort((a, b) => b.updatedAt - a.updatedAt)
  if (sorted.length <= max) return sorted
  const drop = sorted
    .filter((s) => s.id !== activeId)
    .sort((a, b) => (a.status === 'published' ? 0 : 1) - (b.status === 'published' ? 0 : 1) || a.updatedAt - b.updatedAt)
    .slice(0, sorted.length - max)
    .map((s) => s.id)
  return sorted.filter((s) => !drop.includes(s.id))
}

const newId = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

function snapshotOfEditor(): EditorialSnapshot {
  const e = useEditorialStore.getState()
  return { source: e.source, draft: e.draft, checklist: e.checklist, deskAuto: e.deskAuto, translationProvider: e.translationProvider, modelUsed: e.modelUsed }
}

// ---------------------------------------------------------------- store

interface QueueState {
  stories: StoryItem[]
  activeId: string | null
  /** Write the story in the editor into its queue entry now (creating one if it has content and none exists). */
  saveActive: () => void
  /** About to load a different story into the editor: keep the current one and give the next its own entry. */
  beginStory: () => void
  /** An empty editor; the current story stays in the queue. */
  newStory: () => void
  switchTo: (id: string) => void
  remove: (id: string) => void
  setStatus: (id: string, status: StoryStatus) => void
  markPublished: (url?: string) => void
}

function load(): { stories: StoryItem[]; activeId: string | null } {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null
    if (!raw) return { stories: [], activeId: null }
    const p = JSON.parse(raw) as { stories?: StoryItem[]; activeId?: string | null }
    const stories = Array.isArray(p.stories) ? p.stories.filter((s) => s && typeof s.id === 'string' && s.snapshot?.draft) : []
    return { stories, activeId: stories.some((s) => s.id === p.activeId) ? p.activeId ?? null : null }
  } catch {
    return { stories: [], activeId: null }
  }
}

function persist(stories: StoryItem[], activeId: string | null) {
  if (typeof localStorage === 'undefined') return
  let list = stories
  for (let i = 0; i < 4; i++) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ stories: list, activeId }))
      return
    } catch {
      // over quota: shed the oldest stories that are not being edited and try again
      list = capStories(list, activeId, Math.max(1, list.length - 5))
    }
  }
}

let applying = false
// Set by beginStory: the source on the desk when an import started. The next save that sees a different source
// starts a new entry; an import that fails leaves the source alone, so nothing is duplicated.
let forkFrom: EditorialSnapshot['source'] | undefined

export const useStoryQueue = create<QueueState>((set, get) => ({
  ...load(),

  saveActive: () => {
    if (applying) return
    const snap = snapshotOfEditor()
    const { stories, activeId } = get()
    const now = Date.now()
    let cur = activeId ? stories.find((s) => s.id === activeId) : undefined
    if (forkFrom !== undefined && snap.source !== forkFrom) {
      forkFrom = undefined
      cur = undefined
    }
    if (!cur) {
      if (!hasContent(snap)) return
      const item: StoryItem = { id: newId(), status: 'draft', createdAt: now, updatedAt: now, snapshot: snap }
      item.status = nextStatus(item, snap)
      const next = capStories([item, ...stories], item.id)
      set({ stories: next, activeId: item.id })
      persist(next, item.id)
      return
    }
    if (cur.snapshot.draft === snap.draft && cur.snapshot.source === snap.source && cur.snapshot.checklist === snap.checklist && cur.snapshot.deskAuto === snap.deskAuto) return
    const updated: StoryItem = { ...cur, snapshot: snap, updatedAt: now, status: nextStatus(cur, snap) }
    const next = capStories(stories.map((s) => (s.id === cur.id ? updated : s)), cur.id)
    set({ stories: next })
    persist(next, cur.id)
  },

  beginStory: () => {
    get().saveActive()
    forkFrom = hasContent(snapshotOfEditor()) ? useEditorialStore.getState().source : undefined
  },

  newStory: () => {
    get().saveActive()
    forkFrom = undefined
    applying = true
    try { useEditorialStore.getState().clear() } finally { applying = false }
    set({ activeId: null })
    persist(get().stories, null)
  },

  switchTo: (id) => {
    const { activeId } = get()
    if (id === activeId) return
    get().saveActive()
    forkFrom = undefined
    const item = get().stories.find((s) => s.id === id)
    if (!item) return
    applying = true
    try {
      const s = item.snapshot
      useEditorialStore.setState({ source: s.source, draft: s.draft, checklist: s.checklist, deskAuto: s.deskAuto, translationProvider: s.translationProvider, modelUsed: s.modelUsed, discrepancies: [] })
      useEditorialStore.getState().reverify()
    } finally {
      applying = false
    }
    set({ activeId: id })
    persist(get().stories, id)
    // the banner follows the story on the desk, as it does when a story is first loaded
    const ed = useEditorialStore.getState()
    if (ed.bannerLink && ed.draft.headline.trim()) ed.applyDraftToBanner()
  },

  remove: (id) => {
    const { stories, activeId } = get()
    if (id === activeId) {
      applying = true
      try { useEditorialStore.getState().clear() } finally { applying = false }
    }
    const next = stories.filter((s) => s.id !== id)
    const nextActive = id === activeId ? null : activeId
    set({ stories: next, activeId: nextActive })
    persist(next, nextActive)
  },

  setStatus: (id, status) => {
    const next = get().stories.map((s) => (s.id === id ? { ...s, status, statusPinned: status !== 'published' } : s))
    set({ stories: next })
    persist(next, get().activeId)
  },

  markPublished: (url) => {
    get().saveActive()
    const { activeId } = get()
    if (!activeId) return
    const next = get().stories.map((s) => (s.id === activeId ? { ...s, status: 'published' as const, statusPinned: false, publishedUrl: url ?? s.publishedUrl, updatedAt: Date.now() } : s))
    set({ stories: next })
    persist(next, activeId)
  },
}))

// The editor autosaves into its queue entry, a moment after typing stops. A launch with a draft from before the
// queue existed adopts it as the first story.
if (typeof window !== 'undefined') {
  let timer: ReturnType<typeof setTimeout> | undefined
  useEditorialStore.subscribe(() => {
    if (applying) return
    clearTimeout(timer)
    timer = setTimeout(() => useStoryQueue.getState().saveActive(), 500)
  })
  if (!useStoryQueue.getState().activeId) useStoryQueue.getState().saveActive()
  window.addEventListener('beforeunload', () => useStoryQueue.getState().saveActive())
}
