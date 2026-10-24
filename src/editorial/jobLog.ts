// The desk's timed jobs — story translation, SEO, social captions — as a short history the header chip and its panel read.
// A job has steps (each with the time it took), a provider and model once known, and an error if it failed.

import { create } from 'zustand'

export type JobKind = 'story' | 'seo' | 'social' | 'publish'
export interface JobStep { label: string; start: number; end?: number }
export interface Job {
  id: number
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
  /** Newest first. */
  jobs: Job[]
  begin: (kind: JobKind, title: string, firstStep: string) => number
  step: (id: number, label: string) => void
  finish: (id: number, result?: { by?: string; error?: string }) => void
  /** Drops finished jobs; a job still running stays. */
  clear: () => void
}

const KEEP = 12
let nextId = 1

const edit = (jobs: Job[], id: number, fn: (j: Job, now: number) => Job) => {
  const now = Date.now()
  return jobs.map((j) => (j.id === id && !j.end ? fn(j, now) : j))
}

export const useJobLog = create<JobLogState>((set) => ({
  jobs: [],
  begin: (kind, title, firstStep) => {
    const id = nextId++
    const now = Date.now()
    set((s) => ({ jobs: [{ id, kind, title, by: '', start: now, steps: [{ label: firstStep, start: now }] }, ...s.jobs].slice(0, KEEP) }))
    return id
  },
  step: (id, label) => set((s) => ({
    jobs: edit(s.jobs, id, (j, now) => {
      const last = j.steps[j.steps.length - 1]
      if (last.label === label) return j
      return { ...j, steps: [...j.steps.slice(0, -1), { ...last, end: now }, { label, start: now }] }
    }),
  })),
  finish: (id, result) => set((s) => ({
    jobs: edit(s.jobs, id, (j, now) => ({
      ...j,
      end: now,
      by: result?.by ?? j.by,
      error: result?.error,
      steps: [...j.steps.slice(0, -1), { ...j.steps[j.steps.length - 1], end: now }],
    })),
  })),
  clear: () => set((s) => ({ jobs: s.jobs.filter((j) => !j.end) })),
}))
