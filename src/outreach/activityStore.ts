// src/outreach/activityStore.ts
// Activity Desk state management: range, filters, paged transaction log, and debounced stats (§3.2).

import { create } from 'zustand'
import type { OutreachEvent, OutreachStats } from '../esb'
import { displaySafe } from './activityFormat'

export type ActivityRange = 'today' | '7d' | '30d' | 'all'
export type ActivityTab = 'overview' | 'log' | 'reports'
export type LogChip =
  | 'all'
  | 'sent'
  | 'failed'
  | 'replies'
  | 'bounces'
  | 'optouts'
  | 'skipped'
  | 'control'
  | 'assistant'

export interface ActivityStoreState {
  tab: ActivityTab
  range: ActivityRange
  campaignId: string | null // null means "All campaigns"
  includeDry: boolean
  hasDryEvents: boolean
  searchQuery: string
  activeChip: LogChip

  stats: OutreachStats | null
  logEvents: OutreachEvent[]
  hasMoreEvents: boolean
  isLoading: boolean
  isError: boolean
  errorMessage: string | null

  // Report selection (for the 360px inspector panel)
  selectedReportType: 'day' | 'run' | null
  selectedDay: string | null
  selectedJobId: string | null

  setTab: (tab: ActivityTab) => void
  setRange: (range: ActivityRange) => void
  setCampaignId: (campaignId: string | null) => void
  setIncludeDry: (includeDry: boolean) => void
  setSearchQuery: (searchQuery: string) => void
  setActiveChip: (activeChip: LogChip) => void
  setSelectedDay: (day: string | null) => void
  setSelectedJobId: (jobId: string | null) => void

  fetchStats: () => Promise<void>
  fetchLog: (reset?: boolean) => Promise<void>
  loadMoreLog: () => Promise<void>
  mountDesk: () => () => void
}

function rangeToFromTo(range: ActivityRange): { from: number; to: number } {
  const now = Date.now()
  switch (range) {
    case 'today': {
      // 24 hours back or start of today
      return { from: now - 24 * 3600 * 1000, to: now }
    }
    case '7d': {
      return { from: now - 7 * 24 * 3600 * 1000, to: now }
    }
    case '30d': {
      return { from: now - 30 * 24 * 3600 * 1000, to: now }
    }
    case 'all':
    default: {
      return { from: 0, to: now }
    }
  }
}

function chipToEventTypes(chip: LogChip): string[] | undefined {
  switch (chip) {
    case 'sent':
      return ['send.ok']
    case 'failed':
      return ['send.fail']
    case 'replies':
      return ['reply']
    case 'bounces':
      return ['bounce']
    case 'optouts':
      return ['optout']
    case 'skipped':
      return ['send.skip']
    case 'control':
      return ['job.started', 'job.resumed', 'job.paused', 'job.waiting', 'job.done', 'job.stopped', 'engine.start', 'engine.quit']
    case 'assistant':
      return ['ai.action']
    case 'all':
    default:
      return undefined
  }
}

export const useActivityStore = create<ActivityStoreState>((set, get) => {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  return {
    tab: 'overview',
    range: 'today',
    campaignId: null,
    includeDry: false,
    hasDryEvents: false,
    searchQuery: '',
    activeChip: 'all',

    stats: null,
    logEvents: [],
    hasMoreEvents: false,
    isLoading: false,
    isError: false,
    errorMessage: null,

    selectedReportType: null,
    selectedDay: null,
    selectedJobId: null,

    setTab: (tab) => {
      set({ tab })
      if (tab === 'log' && get().logEvents.length === 0) {
        get().fetchLog(true)
      }
    },

    setRange: (range) => {
      set({ range })
      get().fetchStats()
      if (get().tab === 'log') get().fetchLog(true)
    },

    setCampaignId: (campaignId) => {
      set({ campaignId })
      get().fetchStats()
      if (get().tab === 'log') get().fetchLog(true)
    },

    setIncludeDry: (includeDry) => {
      set({ includeDry })
      get().fetchStats()
      if (get().tab === 'log') get().fetchLog(true)
    },

    setSearchQuery: (searchQuery) => {
      set({ searchQuery })
      if (get().tab === 'log') get().fetchLog(true)
    },

    setActiveChip: (activeChip) => {
      set({ activeChip })
      if (get().tab === 'log') get().fetchLog(true)
    },

    setSelectedDay: (selectedDay) => {
      set({ selectedDay, selectedReportType: selectedDay ? 'day' : null })
    },

    setSelectedJobId: (selectedJobId) => {
      set({ selectedJobId, selectedReportType: selectedJobId ? 'run' : null })
    },

    fetchStats: async () => {
      const bridge = typeof window !== 'undefined' ? window.esb : null
      if (!bridge?.outreachStats) {
        set({ isError: false })
        return
      }

      const { range, campaignId, includeDry } = get()
      const { from, to } = rangeToFromTo(range)

      try {
        set({ isLoading: true, isError: false, errorMessage: null })
        const res = await bridge.outreachStats({
          from,
          to,
          campaignId: campaignId || undefined,
          includeDry,
        })

        if ('error' in res && res.error) {
          set({ isLoading: false, isError: true, errorMessage: String(res.error) })
          return
        }

        // Also check if any dry events exist to show "Include test runs" toggle
        let hasDry = get().hasDryEvents
        if (!hasDry && bridge.outreachEvents) {
          const dryCheck = await bridge.outreachEvents({ limit: 1 })
          if (dryCheck.events?.some((e) => e.dry)) hasDry = true
        }

        set({
          stats: res as OutreachStats,
          hasDryEvents: hasDry,
          isLoading: false,
          isError: false,
        })
      } catch (err: unknown) {
        set({
          isLoading: false,
          isError: true,
          errorMessage: err instanceof Error ? err.message : String(err),
        })
      }
    },

    fetchLog: async (reset = false) => {
      if (reset) set({ logEvents: [] })
      const bridge = typeof window !== 'undefined' ? window.esb : null
      if (!bridge?.outreachEvents) return

      const { range, campaignId, includeDry, searchQuery, activeChip } = get()
      const { from, to } = rangeToFromTo(range)
      const types = chipToEventTypes(activeChip)

      try {
        const res = await bridge.outreachEvents({
          from,
          to,
          campaignId: campaignId || undefined,
          types,
          q: searchQuery || undefined,
          limit: 200,
          includeDry,
        })

        set({
          logEvents: (res.events || []).map(displaySafe),
          hasMoreEvents: res.hasMore || false,
        })
      } catch {
        /* ignore fetch errors in log */
      }
    },

    loadMoreLog: async () => {
      const bridge = typeof window !== 'undefined' ? window.esb : null
      const current = get().logEvents
      if (!bridge?.outreachEvents || current.length === 0 || !get().hasMoreEvents) return

      const lastId = current[current.length - 1].id
      const { range, campaignId, includeDry, searchQuery, activeChip } = get()
      const { from, to } = rangeToFromTo(range)
      const types = chipToEventTypes(activeChip)

      try {
        const res = await bridge.outreachEvents({
          from,
          to,
          campaignId: campaignId || undefined,
          types,
          q: searchQuery || undefined,
          before: lastId,
          limit: 200,
          includeDry,
        })

        set({
          logEvents: [...current, ...(res.events || []).map(displaySafe)],
          hasMoreEvents: res.hasMore || false,
        })
      } catch {
        /* ignore load more errors */
      }
    },

    mountDesk: () => {
      // 1. Initial fetch
      get().fetchStats()
      if (get().tab === 'log') get().fetchLog(true)

      // 2. Subscribe to push events debounced to 1s
      const bridge = typeof window !== 'undefined' ? window.esb : null
      let unsub: (() => void) | undefined

      if (bridge?.onOutreach) {
        unsub = bridge.onOutreach(() => {
          if (debounceTimer) clearTimeout(debounceTimer)
          debounceTimer = setTimeout(() => {
            get().fetchStats()
            if (get().tab === 'log') get().fetchLog(false)
          }, 1000)
        })
      }

      // Cleanup when unmounting Activity Desk
      return () => {
        if (debounceTimer) {
          clearTimeout(debounceTimer)
          debounceTimer = null
        }
        if (unsub) unsub()
      }
    },
  }
})

// Dev handle for test runner
if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV && typeof window !== 'undefined') {
  Object.assign(window, { __activityStore: useActivityStore })
}
