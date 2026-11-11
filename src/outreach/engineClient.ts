import type {
  OutreachPlan,
  OutreachPlanQuery,
  AutopilotSettings,
  EsbBridge,
  JobSnapshot,
  JobSpec,
  OutreachEvent,
  OutreachPush,
  OutreachStats,
} from '../esb'
import { project } from './reconcile'
import { overlay, useOutreachStore } from './outreachStore'
import { useEngineStore } from './engineStore'

const CURSOR_KEY = 'esb-banner-studio/outreach/cursor'

const DEFAULT_SETTINGS: AutopilotSettings = {
  window: { enabled: true, from: '09:00', to: '17:00', days: [0, 1, 2, 3, 4], tz: 'Asia/Dhaka' },
  dailyLimit: 100,
  ramp: true,
  pace: 'auto',
  minDelaySec: 180,
  maxDelaySec: 480,
  domainMaxPerDay: 0,
  domainMinGapSec: 3 * 60,
  contactCooldownDays: 30,
  traySending: true,
  aiAutonomy: 'suggest',
  aiReadsReply: false,
  autoResume: true,
}

let initialized = false
let unsubscribePush: (() => void) | null = null
let mailRefresh: ReturnType<typeof setTimeout> | null = null
let mailTicker: ReturnType<typeof setInterval> | null = null

/**
 * "N of 150 today" is the mailer's own count, and it was read only when the desk opened or a batch started, so it sat
 * at the old figure while emails went out. Asked again after each send (the ledger is written before the event).
 */
function refreshMailSoon(): void {
  if (mailRefresh) return
  mailRefresh = setTimeout(() => { mailRefresh = null; void useOutreachStore.getState().refreshMail() }, 250)
}
const refreshMailIfKnown = (): void => { if (useOutreachStore.getState().mail) refreshMailSoon() }

function getBridge(): EsbBridge | undefined {
  if (typeof window !== 'undefined' && window.esb) {
    return window.esb
  }
  return undefined
}

export function getStoredCursor(): string | null {
  try {
    return localStorage.getItem(CURSOR_KEY)
  } catch {
    return null
  }
}

export function setStoredCursor(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem(CURSOR_KEY, id)
    } else {
      localStorage.removeItem(CURSOR_KEY)
    }
  } catch {}
}

/**
 * Apply a batch of outreach events onto useOutreachStore and advance cursor.
 */
export function applyEvents(events: OutreachEvent[]): void {
  if (!events || events.length === 0) return
  const st = useOutreachStore.getState()
  const res = project(
    {
      campaigns: st.campaigns,
      optOut: st.optOut,
      bouncedAddrs: st.bouncedAddrs,
    },
    events
  )

  if (res.campaigns !== st.campaigns || res.optOut !== st.optOut || res.bouncedAddrs !== st.bouncedAddrs) {
    const activeCamp = res.campaigns.find((c) => c.id === st.activeId) ?? null
    useOutreachStore.setState({
      campaigns: res.campaigns,
      optOut: res.optOut,
      bouncedAddrs: res.bouncedAddrs,
      contacts: overlay(st.contacts, { approved: st.approved, optOut: res.optOut, bouncedAddrs: res.bouncedAddrs, names: st.names }, activeCamp, st.mail),
    })
  }

  for (const n of res.news) {
    st.addLog(n.level, n.text)
  }

  const lastId = events[events.length - 1]?.id
  if (lastId) {
    setStoredCursor(lastId)
    useEngineStore.getState().setLastEventId(lastId)
  }
}

/**
 * Sync the active campaign's run / progress indicators with the job in the engine.
 */
function syncActiveCampaignRun(): void {
  const outreach = useOutreachStore.getState()
  const engine = useEngineStore.getState()
  const activeCamp = outreach.campaign()
  if (!activeCamp) return

  const job = engine.jobForCampaign(activeCamp.id)
  if (!job) {
    if (outreach.run !== 'idle') {
      outreach.setRun('idle', { runSent: 0, runTotal: 0, nextAt: null })
    }
    return
  }

  if (job.status === 'running') {
    outreach.setRun('running', { runSent: job.sent, runTotal: job.total, nextAt: job.until ?? null })
  } else if (job.status === 'waiting') {
    outreach.setRun('running', { runSent: job.sent, runTotal: job.total, nextAt: job.until ?? null })
  } else if (job.status === 'paused') {
    outreach.setRun('paused', { runSent: job.sent, runTotal: job.total, nextAt: null })
  } else {
    outreach.setRun('idle', { runSent: job.sent, runTotal: job.total, nextAt: null })
  }
}

export const engineClient = {
  /**
   * Initializes the engine connection: listens to push events, catches up from cursor,
   * loads initial settings and active jobs.
   */
  async init(): Promise<void> {
    if (initialized) return
    initialized = true

    const bridge = getBridge()
    const engineStore = useEngineStore.getState()

    if (!bridge || typeof bridge.outreachJobs !== 'function') {
      engineStore.setIsAvailable(false)
      return
    }

    engineStore.setIsAvailable(true)

    // Subscribe to push notifications
    if (typeof bridge.onOutreach === 'function') {
      unsubscribePush = bridge.onOutreach((payload: OutreachPush) => {
        if (payload.kind === 'progress') {
          useEngineStore.getState().updateFromProgress(payload)
          syncActiveCampaignRun()
        } else if (payload.kind === 'event') {
          applyEvents([payload.event])
          syncActiveCampaignRun()
          if (payload.event.type === 'send.ok') refreshMailSoon()
        } else if (payload.kind === 'inbox') {
          useOutreachStore.getState().applyInboxResult(payload.result)
        }
      })
    }

    // the day's count also has to turn over at midnight and catch up after the PC slept
    mailTicker = setInterval(refreshMailIfKnown, 60_000)
    window.addEventListener('focus', refreshMailIfKnown)

    // Subscribe to campaign switches to keep run state in sync
    useOutreachStore.subscribe((state, prev) => {
      if (state.activeId !== prev.activeId) {
        syncActiveCampaignRun()
      }
    })

    // Load initial jobs
    try {
      const jobs = await bridge.outreachJobs()
      engineStore.setJobs(jobs)
      syncActiveCampaignRun()
    } catch {}

    // Load initial settings
    try {
      if (typeof bridge.outreachSettings === 'function') {
        const settings = await bridge.outreachSettings()
        engineStore.setSettings(settings)
      }
    } catch {}

    // Catch up on any events since last cursor
    try {
      const cursor = getStoredCursor()
      const query: { limit: number; since?: string } = { limit: 1000 }
      if (cursor) {
        query.since = cursor
      }
      if (bridge.outreachEvents) {
        const res = await bridge.outreachEvents(query)
        if (res && res.events && res.events.length > 0) {
          applyEvents(res.events)
          syncActiveCampaignRun()
        }
      }
    } catch {}
  },

  destroy(): void {
    if (unsubscribePush) {
      unsubscribePush()
      unsubscribePush = null
    }
    if (mailTicker) { clearInterval(mailTicker); mailTicker = null }
    if (mailRefresh) { clearTimeout(mailRefresh); mailRefresh = null }
    if (typeof window !== 'undefined') window.removeEventListener('focus', refreshMailIfKnown)
    initialized = false
  },

  async submit(spec: JobSpec): Promise<{ ok: true; jobId: string; rejected: { index: number; error: string }[] } | { ok: false; error: string }> {
    const bridge = getBridge()
    if (!bridge?.outreachJobSubmit) {
      return { ok: false, error: 'Engine bridge unavailable' }
    }
    const res = await bridge.outreachJobSubmit(spec)
    if (res.ok && res.jobId) {
      const jobs = await this.jobs()
      useEngineStore.getState().setJobs(jobs)
      syncActiveCampaignRun()
    }
    return res
  },

  async control(
    jobId: string,
    action: 'pause' | 'resume' | 'stop' | 'hold' | 'release' | 'send-next' | 'clean-names',
    arg?: string | number
  ): Promise<{ ok: boolean; error?: string; count?: number }> {
    const bridge = getBridge()
    if (!bridge?.outreachJobControl) {
      return { ok: false, error: 'Engine bridge unavailable' }
    }
    const res = await bridge.outreachJobControl(jobId, action, arg)
    if (res.ok) {
      const jobs = await this.jobs()
      useEngineStore.getState().setJobs(jobs)
      syncActiveCampaignRun()
    }
    return res
  },

  async pauseAll(on: boolean): Promise<{ ok: boolean }> {
    const bridge = getBridge()
    if (!bridge?.outreachPauseAll) {
      return { ok: false }
    }
    const res = await bridge.outreachPauseAll(on)
    if (res.ok) {
      const jobs = await this.jobs()
      useEngineStore.getState().setJobs(jobs)
      syncActiveCampaignRun()
    }
    return res
  },

  async jobs(): Promise<JobSnapshot[]> {
    const bridge = getBridge()
    if (!bridge?.outreachJobs) return []
    try {
      const list = await bridge.outreachJobs()
      useEngineStore.getState().setJobs(list)
      return list
    } catch {
      return []
    }
  },

  async events(query?: {
    since?: string
    before?: string
    from?: number
    to?: number
    jobId?: string
    campaignId?: string
    types?: string[]
    q?: string
    limit?: number
  }): Promise<{ events: OutreachEvent[]; hasMore: boolean }> {
    const bridge = getBridge()
    if (!bridge?.outreachEvents) return { events: [], hasMore: false }
    return bridge.outreachEvents(query)
  },

  async stats(query: {
    from: number
    to: number
    jobId?: string
    campaignId?: string
    includeDry?: boolean
  }): Promise<OutreachStats> {
    const bridge = getBridge()
    if (!bridge?.outreachStats) {
      return {
        totals: { sent: 0, failed: 0, rejected: 0, skipped: 0, bounced: 0, replied: 0, optedOut: 0, retries: 0 },
        byHour: [],
        byDay: [],
        today: [],
        window: null,
        cap: 100,
        durations: { avgSendMs: 0, p95SendMs: 0, avgGapSec: 0, activeMs: 0, elapsedMs: 0, perActiveHour: 0 },
        replyMedianMs: null,
        firstSendAt: null,
        lastSendAt: null,
        jobs: [],
      }
    }
    return bridge.outreachStats(query)
  },

  async plan(query: OutreachPlanQuery): Promise<OutreachPlan> {
    const bridge = getBridge()
    if (!bridge?.outreachPlan) {
      return { days: 0, firstAt: null, lastAt: null, perDay: [], notes: [] }
    }
    return bridge.outreachPlan(query)
  },

  async settings(): Promise<AutopilotSettings> {
    const bridge = getBridge()
    if (!bridge?.outreachSettings) return DEFAULT_SETTINGS
    try {
      const s = await bridge.outreachSettings()
      useEngineStore.getState().setSettings(s)
      return s
    } catch {
      return DEFAULT_SETTINGS
    }
  },

  async saveSettings(patch: Partial<AutopilotSettings>): Promise<{ ok: boolean; error?: string; settings?: AutopilotSettings }> {
    const bridge = getBridge()
    if (!bridge?.outreachSettingsSave) {
      return { ok: false, error: 'Engine bridge unavailable' }
    }
    const res = await bridge.outreachSettingsSave(patch)
    if (res.ok && res.settings) {
      useEngineStore.getState().setSettings(res.settings)
    }
    return res
  },

  async checkAddresses(domains: string[]): Promise<Record<string, { mx: boolean; a: boolean; error?: string }>> {
    const bridge = getBridge()
    if (!bridge?.outreachCheckAddresses) return {}
    return bridge.outreachCheckAddresses(domains)
  },

  async logEvent(ev: {
    type: 'ai.action' | 'note'
    text: string
    command?: string
    status?: string
    campaignId?: string
  }): Promise<{ ok: boolean }> {
    const bridge = getBridge()
    if (!bridge?.outreachLogEvent) {
      return { ok: false }
    }
    return bridge.outreachLogEvent(ev)
  },

  async optOut(email: string, on: boolean): Promise<{ ok: boolean }> {
    const bridge = getBridge()
    if (!bridge?.outreachOptOut) {
      return { ok: false }
    }
    return bridge.outreachOptOut(email, on)
  },

  async syncOptOuts(emails: string[]): Promise<{ ok: boolean; added: number }> {
    const bridge = getBridge()
    if (!bridge?.outreachSyncOptOuts) {
      return { ok: false, added: 0 }
    }
    return bridge.outreachSyncOptOuts(emails)
  },
}
