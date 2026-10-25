// The desk's timed jobs — story translation, SEO, social captions, publishing — as a history the Activity panel reads.
// A job has steps (each with the time it took), a provider and model once known, and an error if it failed.
// Every job belongs to one story (the queue entry on the desk when it began), so a story's history never shows
// on another. Finished jobs are kept in localStorage; a job that was still running at quit is closed as interrupted.

import { create } from 'zustand'

export type JobKind = 'story' | 'seo' | 'social' | 'publish'
export interface JobStep { label: string; start: number; end?: number }
export interface Job {
  id: number
  /** Queue id of the story it ran for; '' while the story has no entry yet (adopted when it gets one). */
  story: string
  kind: JobKind
  title: string
  /** Provider and model that did the work, once known. */
  by: string
  start: number
  end?: number
  steps: JobStep[]
  error?: string
}

interface JobLogState {
  /** Newest first, across all stories; read one story's with `jobsOf`. */
  jobs: Job[]
  begin: (kind: JobKind, title: string, firstStep: string) => number
  step: (id: number, label: string) => void
  finish: (id: number, result?: { by?: string; error?: string }) => void
  /** Drops one story's finished jobs; a job still running stays. */
  clear: (story: string) => void
}

const KEY = 'esb-banner-studio/editorial/jobs/v1'
export const KEEP_PER_STORY = 12
const KEEP_TOTAL = 240

/** 7.1 s · 42 s · 1 m 05 s — one-decimal under ten seconds, whole seconds after, minutes past sixty. */
export function fmtDuration(ms: number): string {
  const s = ms / 1000
  if (s < 10) return s.toFixed(1) + ' s'
  if (s < 60) return Math.round(s) + ' s'
  const m = Math.floor(s / 60)
  return `${m} m ${String(Math.round(s - m * 60)).padStart(2, '0')} s`
}

/** The story new jobs are filed under — kept in step with the queue's active story. */
let currentStory = ''
export const setJobStory = (id: string | null) => { currentStory = id ?? '' }

export const jobsOf = (jobs: Job[], story: string): Job[] => jobs.filter((j) => j.story === story)

/** Newest first, at most KEEP_PER_STORY per story and KEEP_TOTAL overall. */
export function trimJobs(jobs: Job[]): Job[] {
  const seen = new Map<string, number>()
  const out: Job[] = []
  for (const j of jobs) {
    const n = (seen.get(j.story) ?? 0) + 1
    seen.set(j.story, n)
    if (n <= KEEP_PER_STORY && out.length < KEEP_TOTAL) out.push(j)
  }
  return out
}

function load(): { jobs: Job[]; next: number } {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null
    const p = raw ? (JSON.parse(raw) as Job[]) : []
    const now = Date.now()
    const jobs = (Array.isArray(p) ? p : [])
      .filter((j) => j && typeof j.id === 'number' && Array.isArray(j.steps) && j.steps.length)
      .map((j) => (j.end ? j : { ...j, end: now, error: j.error ?? 'Interrupted — the app was closed', steps: [...j.steps.slice(0, -1), { ...j.steps[j.steps.length - 1], end: now }] }))
    return { jobs, next: jobs.reduce((m, j) => Math.max(m, j.id), 0) + 1 }
  } catch {
    return { jobs: [], next: 1 }
  }
}

function persist(jobs: Job[]) {
  try { localStorage.setItem(KEY, JSON.stringify(jobs.filter((j) => j.end))) } catch { /* over quota or private mode: history stays in memory */ }
}

const edit = (jobs: Job[], id: number, fn: (j: Job, now: number) => Job) => {
  const now = Date.now()
  return jobs.map((j) => (j.id === id && !j.end ? fn(j, now) : j))
}

const loaded = load()
let nextId = loaded.next

export const useJobLog = create<JobLogState>((set, get) => ({
  jobs: loaded.jobs,
  begin: (kind, title, firstStep) => {
    const id = nextId++
    const now = Date.now()
    set((s) => ({ jobs: trimJobs([{ id, story: currentStory, kind, title, by: '', start: now, steps: [{ label: firstStep, start: now }] }, ...s.jobs]) }))
    return id
  },
  step: (id, label) => set((s) => ({
    jobs: edit(s.jobs, id, (j, now) => {
      const last = j.steps[j.steps.length - 1]
      if (last.label === label) return j
      return { ...j, steps: [...j.steps.slice(0, -1), { ...last, end: now }, { label, start: now }] }
    }),
  })),
  finish: (id, result) => {
    set((s) => ({
      jobs: edit(s.jobs, id, (j, now) => ({
        ...j,
        end: now,
        by: result?.by ?? j.by,
        error: result?.error,
        steps: [...j.steps.slice(0, -1), { ...j.steps[j.steps.length - 1], end: now }],
      })),
    }))
    persist(get().jobs)
  },
  clear: (story) => {
    set((s) => ({ jobs: s.jobs.filter((j) => j.story !== story || !j.end) }))
    persist(get().jobs)
  },
}))

/** A story just got its queue entry: jobs filed while it had none belong to it. */
export function adoptJobs(story: string) {
  setJobStory(story)
  useJobLog.setState((s) => ({ jobs: s.jobs.map((j) => (j.story === '' ? { ...j, story } : j)) }))
  persist(useJobLog.getState().jobs)
}

/** A story left the queue: its history goes with it. */
export function dropJobs(story: string) {
  useJobLog.setState((s) => ({ jobs: s.jobs.filter((j) => j.story !== story) }))
  persist(useJobLog.getState().jobs)
}
