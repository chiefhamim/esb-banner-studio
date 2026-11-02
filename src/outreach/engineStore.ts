import { create } from 'zustand'
import type { AutopilotSettings, JobSnapshot, JobWait, OutreachStats } from '../esb'

export interface EngineStoreState {
  jobs: JobSnapshot[]
  settings: AutopilotSettings | null
  stats: OutreachStats | null
  isAvailable: boolean
  lastEventId: string | null

  setJobs: (jobs: JobSnapshot[]) => void
  setSettings: (settings: AutopilotSettings) => void
  setStats: (stats: OutreachStats) => void
  setIsAvailable: (available: boolean) => void
  setLastEventId: (id: string | null) => void
  updateFromProgress: (p: {
    jobId: string
    campaignId: string
    status: string
    why?: string | null
    until?: number | null
    wait?: JobWait | null
    reason?: string | null
    sent: number
    total: number
    failed: number
    remaining?: number
    current?: string
    nextAt?: number | null
  }) => void
  jobForCampaign: (campaignId: string | null | undefined) => JobSnapshot | undefined
}

export const useEngineStore = create<EngineStoreState>((set, get) => ({
  jobs: [],
  settings: null,
  stats: null,
  isAvailable: typeof window !== 'undefined' && typeof window.esb?.outreachJobs === 'function',
  lastEventId: null,

  setJobs: (jobs) => set({ jobs }),
  setSettings: (settings) => set({ settings }),
  setStats: (stats) => set({ stats }),
  setIsAvailable: (isAvailable) => set({ isAvailable }),
  setLastEventId: (lastEventId) => set({ lastEventId }),

  updateFromProgress: (p) => {
    const list = get().jobs
    const existing = list.find((j) => j.jobId === p.jobId)
    if (!existing) {
      const created: JobSnapshot = {
        jobId: p.jobId,
        campaignId: p.campaignId,
        name: p.campaignId,
        kind: 'first',
        status: p.status as JobSnapshot['status'],
        why: p.why as JobSnapshot['why'],
        until: p.until,
        wait: p.wait ?? null,
        reason: p.reason as JobSnapshot['reason'],
        dry: false,
        total: p.total,
        sent: p.sent,
        failed: p.failed,
        skipped: 0,
        held: 0,
        remaining: p.remaining ?? Math.max(0, p.total - p.sent - p.failed),
        createdAt: Date.now(),
      }
      set({ jobs: [created, ...list] })
      return
    }

    const updated: JobSnapshot = {
      ...existing,
      status: p.status as JobSnapshot['status'],
      why: (p.why as JobSnapshot['why']) ?? existing.why,
      until: p.until !== undefined ? p.until : existing.until,
      // every progress push carries the engine's current wait detail (null while sending)
      wait: p.wait !== undefined ? p.wait : existing.wait,
      reason: (p.reason as JobSnapshot['reason']) ?? existing.reason,
      sent: p.sent,
      total: p.total,
      failed: p.failed,
      remaining: p.remaining ?? Math.max(0, p.total - p.sent - p.failed),
    }

    set({
      jobs: list.map((j) => (j.jobId === p.jobId ? updated : j)),
    })
  },

  jobForCampaign: (campaignId) => {
    if (!campaignId) return undefined
    const matching = get().jobs.filter((j) => j.campaignId === campaignId)
    if (matching.length === 0) return undefined
    const active = matching.find((j) => ['queued', 'running', 'waiting', 'paused'].includes(j.status))
    return active || matching[0]
  },
}))

if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV && typeof window !== 'undefined') Object.assign(window, { __engineStore: useEngineStore })
