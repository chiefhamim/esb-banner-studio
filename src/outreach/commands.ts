import { useOutreachStore } from './outreachStore'
import { useEngineStore } from './engineStore'
import { engineClient } from './engineClient'
import { buildJobSpec } from './jobSpec'
import { missingFields } from './compose'

export type CommandRisk = 'read' | 'safe' | 'confirm' | 'danger'

export interface CommandCaller {
  by: 'user' | 'ai'
  confirmed?: boolean
  confirmationToken?: string
}

export type Validator<T> = (raw: unknown) => { ok: true; data: T } | { ok: false; error: string }

export interface CommandResult<T = unknown> {
  ok: boolean
  result?: T
  error?: string
  requiresConfirmation?: boolean
}

export interface CommandDef<TArgs = any, TResult = any> {
  risk: CommandRisk
  describe: string
  args: Validator<TArgs>
  run: (args: TArgs, caller: CommandCaller) => Promise<CommandResult<TResult>>
}

// --- Validator Helpers ---

function assertPlainObject(raw: unknown): { ok: true; obj: Record<string, unknown> } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Arguments must be a plain object' }
  }
  return { ok: true, obj: raw as Record<string, unknown> }
}

function checkExtraKeys(obj: Record<string, unknown>, allowed: string[]): { ok: true } | { ok: false; error: string } {
  const allowedSet = new Set(allowed)
  for (const k of Object.keys(obj)) {
    if (!allowedSet.has(k)) {
      return { ok: false, error: `Unexpected extra argument: '${k}'` }
    }
  }
  return { ok: true }
}

function optionalString(v: unknown, name: string): { ok: true; val?: string } | { ok: false; error: string } {
  if (v === undefined || v === null) return { ok: true }
  if (typeof v !== 'string') return { ok: false, error: `'${name}' must be a string` }
  return { ok: true, val: v }
}

function requiredString(v: unknown, name: string): { ok: true; val: string } | { ok: false; error: string } {
  if (typeof v !== 'string' || !v.trim()) return { ok: false, error: `'${name}' must be a non-empty string` }
  return { ok: true, val: v.trim() }
}

function optionalNumber(v: unknown, name: string, min?: number, max?: number): { ok: true; val?: number } | { ok: false; error: string } {
  if (v === undefined || v === null) return { ok: true }
  if (typeof v !== 'number' || Number.isNaN(v)) return { ok: false, error: `'${name}' must be a number` }
  if (min !== undefined && v < min) return { ok: false, error: `'${name}' cannot be less than ${min}` }
  if (max !== undefined && v > max) return { ok: false, error: `'${name}' cannot be greater than ${max}` }
  return { ok: true, val: v }
}

function requiredNumber(v: unknown, name: string, min?: number, max?: number): { ok: true; val: number } | { ok: false; error: string } {
  if (typeof v !== 'number' || Number.isNaN(v)) return { ok: false, error: `'${name}' must be a number` }
  if (min !== undefined && v < min) return { ok: false, error: `'${name}' cannot be less than ${min}` }
  if (max !== undefined && v > max) return { ok: false, error: `'${name}' cannot be greater than ${max}` }
  return { ok: true, val: v }
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function validateTimeHHMM(t: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t)
}

// --- The Command Registry ---

export const COMMANDS: Record<string, CommandDef> = {
  // === READ COMMANDS ===

  summary: {
    risk: 'read',
    describe: 'Returns overall summary of outreach campaigns, running jobs, and current desk status.',
    args: (raw) => {
      const p = assertPlainObject(raw ?? {})
      if (!p.ok) return p
      const extra = checkExtraKeys(p.obj, [])
      if (!extra.ok) return extra
      return { ok: true, data: {} }
    },
    run: async () => {
      const outreach = useOutreachStore.getState()
      const engine = useEngineStore.getState()
      const active = outreach.campaign()
      return {
        ok: true,
        result: {
          totalCampaigns: outreach.campaigns.length,
          activeCampaignId: active?.id ?? null,
          activeCampaignName: active?.name ?? null,
          runningJobs: engine.jobs.filter((j) => j.status === 'running' || j.status === 'waiting').length,
          pausedJobs: engine.jobs.filter((j) => j.status === 'paused').length,
          contactsCount: outreach.contacts.length,
          optOutCount: outreach.optOut.length,
          bouncedCount: Object.keys(outreach.bouncedAddrs).length,
        },
      }
    },
  },

  listCampaigns: {
    risk: 'read',
    describe: 'Lists all available outreach campaigns with their status and contact counts.',
    args: (raw) => {
      const p = assertPlainObject(raw ?? {})
      if (!p.ok) return p
      const extra = checkExtraKeys(p.obj, [])
      if (!extra.ok) return extra
      return { ok: true, data: {} }
    },
    run: async () => {
      const { campaigns, activeId } = useOutreachStore.getState()
      return {
        ok: true,
        result: {
          campaigns: campaigns.map((c) => ({
            id: c.id,
            name: c.name,
            status: c.status,
            active: c.id === activeId,
            audienceSize: c.recipients.length,
            sentCount: Object.keys(c.sent || {}).length,
            failedCount: Object.keys(c.failed || {}).length,
            repliedCount: Object.keys(c.replied || {}).length,
          })),
        },
      }
    },
  },

  getPlan: {
    risk: 'read',
    describe: 'Calculates the schedule and estimated send plan for a campaign or audience count.',
    args: (raw) => {
      const p = assertPlainObject(raw ?? {})
      if (!p.ok) return p
      const extra = checkExtraKeys(p.obj, ['campaignId', 'count'])
      if (!extra.ok) return extra
      const cId = optionalString(p.obj.campaignId, 'campaignId')
      if (!cId.ok) return cId
      const count = optionalNumber(p.obj.count, 'count', 1, 100000)
      if (!count.ok) return count
      return { ok: true, data: { campaignId: cId.val, count: count.val } }
    },
    run: async (args) => {
      const outreach = useOutreachStore.getState()
      let sendCount = args.count
      if (sendCount === undefined) {
        const camp = args.campaignId ? outreach.campaigns.find((c) => c.id === args.campaignId) : outreach.campaign()
        if (args.campaignId && !camp) {
          return { ok: false, error: `Campaign '${args.campaignId}' not found` }
        }
        sendCount = camp ? camp.recipients.length || outreach.contacts.length : outreach.contacts.length
      }
      const plan = await engineClient.plan({ count: sendCount || 10 })
      return { ok: true, result: plan }
    },
  },

  explainSkipped: {
    risk: 'read',
    describe: 'Explains why contacts in the active or specified campaign would be skipped or need attention.',
    args: (raw) => {
      const p = assertPlainObject(raw ?? {})
      if (!p.ok) return p
      const extra = checkExtraKeys(p.obj, ['campaignId'])
      if (!extra.ok) return extra
      const cId = optionalString(p.obj.campaignId, 'campaignId')
      if (!cId.ok) return cId
      return { ok: true, data: { campaignId: cId.val } }
    },
    run: async (args) => {
      const outreach = useOutreachStore.getState()
      const camp = args.campaignId ? outreach.campaigns.find((c) => c.id === args.campaignId) : outreach.campaign()
      if (args.campaignId && !camp) {
        return { ok: false, error: `Campaign '${args.campaignId}' not found` }
      }
      const contacts = outreach.contacts
      const optOutSet = new Set(outreach.optOut)
      const bouncedSet = new Set(Object.keys(outreach.bouncedAddrs))

      let unapproved = 0
      let optedOut = 0
      let bounced = 0
      let alreadySent = 0
      let missingFieldCount = 0

      for (const c of contacts) {
        if (optOutSet.has(c.email)) {
          optedOut++
        } else if (bouncedSet.has(c.email) || camp?.bounced?.[c.email]) {
          bounced++
        } else if (camp?.sent?.[c.email]) {
          alreadySent++
        } else if (!c.approved && !outreach.approved.includes(c.email)) {
          unapproved++
        } else if (camp && missingFields(c, camp.subject, camp.body, camp.openers?.[c.email]?.text).length > 0) {
          missingFieldCount++
        }
      }

      return {
        ok: true,
        result: {
          campaignId: camp?.id ?? null,
          totalContacts: contacts.length,
          skipped: {
            unapproved,
            optedOut,
            bounced,
            alreadySent,
            missingFields: missingFieldCount,
          },
        },
      }
    },
  },

  activityToday: {
    risk: 'read',
    describe: 'Returns today aggregated activity counts and performance stats from the engine.',
    args: (raw) => {
      const p = assertPlainObject(raw ?? {})
      if (!p.ok) return p
      const extra = checkExtraKeys(p.obj, [])
      if (!extra.ok) return extra
      return { ok: true, data: {} }
    },
    run: async () => {
      const now = new Date()
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      const stats = await engineClient.stats({ from: startOfDay, to: Date.now() })
      return { ok: true, result: stats }
    },
  },

  // === SAFE COMMANDS ===

  pauseRun: {
    risk: 'safe',
    describe: 'Pauses sending for an active campaign or job.',
    args: (raw) => {
      const p = assertPlainObject(raw ?? {})
      if (!p.ok) return p
      const extra = checkExtraKeys(p.obj, ['campaignId', 'jobId'])
      if (!extra.ok) return extra
      const cId = optionalString(p.obj.campaignId, 'campaignId')
      if (!cId.ok) return cId
      const jId = optionalString(p.obj.jobId, 'jobId')
      if (!jId.ok) return jId
      return { ok: true, data: { campaignId: cId.val, jobId: jId.val } }
    },
    run: async (args) => {
      const engine = useEngineStore.getState()
      let jobId = args.jobId
      if (!jobId) {
        const campId = args.campaignId ?? useOutreachStore.getState().activeId
        if (campId) {
          const job = engine.jobForCampaign(campId)
          if (job) jobId = job.jobId
        }
      }
      if (!jobId) {
        // If no engine job, update outreach state directly
        useOutreachStore.getState().setRun('paused')
        return { ok: true, result: { paused: true, message: 'Paused local run state' } }
      }
      const res = await engineClient.control(jobId, 'pause')
      if (!res.ok) return { ok: false, error: res.error || 'Failed to pause job' }
      return { ok: true, result: { jobId, paused: true } }
    },
  },

  pauseAll: {
    risk: 'safe',
    describe: 'Pauses all active sending jobs across the application.',
    args: (raw) => {
      const p = assertPlainObject(raw ?? {})
      if (!p.ok) return p
      const extra = checkExtraKeys(p.obj, ['on'])
      if (!extra.ok) return extra
      if (p.obj.on !== undefined && typeof p.obj.on !== 'boolean') {
        return { ok: false, error: "'on' must be a boolean" }
      }
      return { ok: true, data: { on: p.obj.on ?? true } }
    },
    run: async (args) => {
      const res = await engineClient.pauseAll(args.on)
      if (!res.ok) return { ok: false, error: 'Failed to pause all jobs' }
      return { ok: true, result: { pausedAll: args.on } }
    },
  },

  holdRecipient: {
    risk: 'safe',
    describe: 'Puts a recipient on hold by removing approval or holding from sending.',
    args: (raw) => {
      const p = assertPlainObject(raw ?? {})
      if (!p.ok) return p
      const extra = checkExtraKeys(p.obj, ['email', 'campaignId'])
      if (!extra.ok) return extra
      const em = requiredString(p.obj.email, 'email')
      if (!em.ok) return em
      if (!validateEmail(em.val)) return { ok: false, error: `Invalid email address format: '${em.val}'` }
      const cId = optionalString(p.obj.campaignId, 'campaignId')
      if (!cId.ok) return cId
      return { ok: true, data: { email: em.val, campaignId: cId.val } }
    },
    run: async (args) => {
      useOutreachStore.getState().approve(args.email, false)
      return { ok: true, result: { held: true, email: args.email } }
    },
  },

  addNote: {
    risk: 'safe',
    describe: 'Adds a log note or audit annotation to outreach activity.',
    args: (raw) => {
      const p = assertPlainObject(raw ?? {})
      if (!p.ok) return p
      const extra = checkExtraKeys(p.obj, ['text', 'campaignId'])
      if (!extra.ok) return extra
      const txt = requiredString(p.obj.text, 'text')
      if (!txt.ok) return txt
      const cId = optionalString(p.obj.campaignId, 'campaignId')
      if (!cId.ok) return cId
      return { ok: true, data: { text: txt.val, campaignId: cId.val } }
    },
    run: async (args) => {
      useOutreachStore.getState().addLog('info', args.text)
      await engineClient.logEvent({
        type: 'note',
        text: args.text,
        campaignId: args.campaignId,
      })
      return { ok: true, result: { logged: true, text: args.text } }
    },
  },

  // === CONFIRM COMMANDS (Requires confirmation token when called by AI) ===

  startRun: {
    risk: 'confirm',
    describe: 'Starts sending the active campaign or submits its job to the Autopilot engine.',
    args: (raw) => {
      const p = assertPlainObject(raw ?? {})
      if (!p.ok) return p
      const extra = checkExtraKeys(p.obj, ['campaignId'])
      if (!extra.ok) return extra
      const cId = optionalString(p.obj.campaignId, 'campaignId')
      if (!cId.ok) return cId
      return { ok: true, data: { campaignId: cId.val } }
    },
    run: async (args, caller) => {
      if (caller.by === 'ai' && !caller.confirmed) {
        return { ok: false, error: 'Command startRun requires explicit confirmation', requiresConfirmation: true }
      }
      const outreach = useOutreachStore.getState()
      const camp = args.campaignId ? outreach.campaigns.find((c) => c.id === args.campaignId) : outreach.campaign()
      if (!camp) return { ok: false, error: 'No active campaign found to start' }

      const sig = outreach.signatures.find((s) => s.id === camp.signatureId) ?? outreach.signatures[0]
      let spec
      try {
        spec = buildJobSpec({
          campaign: camp,
          contacts: outreach.contacts,
          signature: sig?.text,
        })
      } catch (e) { return { ok: false, error: (e as Error).message } }
      if (spec.messages.length === 0) {
        return { ok: false, error: 'No actionable or approved recipients to send' }
      }
      const res = await engineClient.submit(spec)
      if (!res.ok) return { ok: false, error: res.error }
      return { ok: true, result: { jobId: res.jobId, queued: spec.messages.length } }
    },
  },

  scheduleRun: {
    risk: 'confirm',
    describe: 'Schedules a campaign to send at a specific future timestamp.',
    args: (raw) => {
      const p = assertPlainObject(raw ?? {})
      if (!p.ok) return p
      const extra = checkExtraKeys(p.obj, ['campaignId', 'at'])
      if (!extra.ok) return extra
      const cId = optionalString(p.obj.campaignId, 'campaignId')
      if (!cId.ok) return cId
      const at = requiredNumber(p.obj.at, 'at', Date.now() - 60000)
      if (!at.ok) return at
      return { ok: true, data: { campaignId: cId.val, at: at.val } }
    },
    run: async (args, caller) => {
      if (caller.by === 'ai' && !caller.confirmed) {
        return { ok: false, error: 'Command scheduleRun requires explicit confirmation', requiresConfirmation: true }
      }
      const outreach = useOutreachStore.getState()
      const camp = args.campaignId ? outreach.campaigns.find((c) => c.id === args.campaignId) : outreach.campaign()
      if (!camp) return { ok: false, error: 'Campaign not found' }
      useOutreachStore.getState().patch({ status: 'scheduled', scheduledAt: args.at })
      return { ok: true, result: { campaignId: camp.id, scheduledAt: args.at } }
    },
  },

  resumeRun: {
    risk: 'confirm',
    describe: 'Resumes a paused sending job in the engine.',
    args: (raw) => {
      const p = assertPlainObject(raw ?? {})
      if (!p.ok) return p
      const extra = checkExtraKeys(p.obj, ['campaignId', 'jobId'])
      if (!extra.ok) return extra
      const cId = optionalString(p.obj.campaignId, 'campaignId')
      if (!cId.ok) return cId
      const jId = optionalString(p.obj.jobId, 'jobId')
      if (!jId.ok) return jId
      return { ok: true, data: { campaignId: cId.val, jobId: jId.val } }
    },
    run: async (args, caller) => {
      if (caller.by === 'ai' && !caller.confirmed) {
        return { ok: false, error: 'Command resumeRun requires explicit confirmation', requiresConfirmation: true }
      }
      const engine = useEngineStore.getState()
      let jobId = args.jobId
      if (!jobId) {
        const campId = args.campaignId ?? useOutreachStore.getState().activeId
        if (campId) {
          const job = engine.jobForCampaign(campId)
          if (job) jobId = job.jobId
        }
      }
      if (!jobId) {
        useOutreachStore.getState().setRun('running')
        return { ok: true, result: { resumed: true } }
      }
      const res = await engineClient.control(jobId, 'resume')
      if (!res.ok) return { ok: false, error: res.error || 'Failed to resume job' }
      return { ok: true, result: { jobId, resumed: true } }
    },
  },

  stopRun: {
    risk: 'confirm',
    describe: 'Cancels/stops an active or paused sending job.',
    args: (raw) => {
      const p = assertPlainObject(raw ?? {})
      if (!p.ok) return p
      const extra = checkExtraKeys(p.obj, ['campaignId', 'jobId'])
      if (!extra.ok) return extra
      const cId = optionalString(p.obj.campaignId, 'campaignId')
      if (!cId.ok) return cId
      const jId = optionalString(p.obj.jobId, 'jobId')
      if (!jId.ok) return jId
      return { ok: true, data: { campaignId: cId.val, jobId: jId.val } }
    },
    run: async (args, caller) => {
      if (caller.by === 'ai' && !caller.confirmed) {
        return { ok: false, error: 'Command stopRun requires explicit confirmation', requiresConfirmation: true }
      }
      const engine = useEngineStore.getState()
      let jobId = args.jobId
      if (!jobId) {
        const campId = args.campaignId ?? useOutreachStore.getState().activeId
        if (campId) {
          const job = engine.jobForCampaign(campId)
          if (job) jobId = job.jobId
        }
      }
      if (jobId) {
        await engineClient.control(jobId, 'stop')
      }
      useOutreachStore.getState().setRun('idle')
      return { ok: true, result: { stopped: true } }
    },
  },

  setWindow: {
    risk: 'confirm',
    describe: 'Sets the daily send window (e.g. 09:00 to 17:00, days Sunday-Thursday).',
    args: (raw) => {
      const p = assertPlainObject(raw ?? {})
      if (!p.ok) return p
      const extra = checkExtraKeys(p.obj, ['from', 'to', 'days', 'tz'])
      if (!extra.ok) return extra
      const from = requiredString(p.obj.from, 'from')
      if (!from.ok) return from
      if (!validateTimeHHMM(from.val)) return { ok: false, error: "'from' must be in HH:MM format" }
      const to = requiredString(p.obj.to, 'to')
      if (!to.ok) return to
      if (!validateTimeHHMM(to.val)) return { ok: false, error: "'to' must be in HH:MM format" }

      let days = [0, 1, 2, 3, 4]
      if (p.obj.days !== undefined) {
        if (!Array.isArray(p.obj.days) || !p.obj.days.every((d) => typeof d === 'number' && d >= 0 && d <= 6)) {
          return { ok: false, error: "'days' must be an array of integers 0-6" }
        }
        days = p.obj.days
      }
      const tz = optionalString(p.obj.tz, 'tz')
      if (!tz.ok) return tz

      return {
        ok: true,
        data: {
          from: from.val,
          to: to.val,
          days,
          tz: tz.val || 'Asia/Dhaka',
        },
      }
    },
    run: async (args, caller) => {
      if (caller.by === 'ai' && !caller.confirmed) {
        return { ok: false, error: 'Command setWindow requires explicit confirmation', requiresConfirmation: true }
      }
      const res = await engineClient.saveSettings({
        window: {
          enabled: true,
          from: args.from,
          to: args.to,
          days: args.days,
          tz: args.tz,
        },
      })
      if (!res.ok) return { ok: false, error: res.error || 'Failed to save send window' }
      return { ok: true, result: { window: res.settings?.window } }
    },
  },

  setCooldown: {
    risk: 'confirm',
    describe: 'Sets pacing and minimum delays between messages and domains.',
    args: (raw) => {
      const p = assertPlainObject(raw ?? {})
      if (!p.ok) return p
      const extra = checkExtraKeys(p.obj, ['minDelaySec', 'maxDelaySec', 'domainMinGapSec'])
      if (!extra.ok) return extra
      const minD = optionalNumber(p.obj.minDelaySec, 'minDelaySec', 5, 3600)
      if (!minD.ok) return minD
      const maxD = optionalNumber(p.obj.maxDelaySec, 'maxDelaySec', 5, 7200)
      if (!maxD.ok) return maxD
      if (minD.val !== undefined && maxD.val !== undefined && minD.val > maxD.val) {
        return { ok: false, error: 'minDelaySec cannot exceed maxDelaySec' }
      }
      const domGap = optionalNumber(p.obj.domainMinGapSec, 'domainMinGapSec', 0, 86400)
      if (!domGap.ok) return domGap

      return {
        ok: true,
        data: {
          minDelaySec: minD.val,
          maxDelaySec: maxD.val,
          domainMinGapSec: domGap.val,
        },
      }
    },
    run: async (args, caller) => {
      if (caller.by === 'ai' && !caller.confirmed) {
        return { ok: false, error: 'Command setCooldown requires explicit confirmation', requiresConfirmation: true }
      }
      const patch: Record<string, number> = {}
      if (args.minDelaySec !== undefined) patch.minDelaySec = args.minDelaySec
      if (args.maxDelaySec !== undefined) patch.maxDelaySec = args.maxDelaySec
      if (args.domainMinGapSec !== undefined) patch.domainMinGapSec = args.domainMinGapSec

      const res = await engineClient.saveSettings(patch)
      if (!res.ok) return { ok: false, error: res.error || 'Failed to update cooldown settings' }
      return { ok: true, result: patch }
    },
  },

  selectAudience: {
    risk: 'confirm',
    describe: 'Updates the group or purpose filters for a campaign audience.',
    args: (raw) => {
      const p = assertPlainObject(raw ?? {})
      if (!p.ok) return p
      const extra = checkExtraKeys(p.obj, ['campaignId', 'group', 'purposes'])
      if (!extra.ok) return extra
      const cId = optionalString(p.obj.campaignId, 'campaignId')
      if (!cId.ok) return cId
      if (p.obj.group !== undefined && p.obj.group !== null && typeof p.obj.group !== 'string') {
        return { ok: false, error: "'group' must be a string or null" }
      }
      let purposes: string[] | undefined
      if (p.obj.purposes !== undefined) {
        if (!Array.isArray(p.obj.purposes) || !p.obj.purposes.every((x) => typeof x === 'string')) {
          return { ok: false, error: "'purposes' must be an array of strings" }
        }
        purposes = p.obj.purposes
      }
      return {
        ok: true,
        data: {
          campaignId: cId.val,
          group: (p.obj.group as string | null) ?? null,
          purposes: purposes ?? [],
        },
      }
    },
    run: async (args, caller) => {
      if (caller.by === 'ai' && !caller.confirmed) {
        return { ok: false, error: 'Command selectAudience requires explicit confirmation', requiresConfirmation: true }
      }
      const outreach = useOutreachStore.getState()
      const camp = args.campaignId ? outreach.campaigns.find((c) => c.id === args.campaignId) : outreach.campaign()
      if (!camp) return { ok: false, error: 'Campaign not found' }

      const updated = {
        ...camp,
        audience: {
          group: args.group,
          purposes: args.purposes,
        },
        updatedAt: Date.now(),
      }
      useOutreachStore.setState({
        campaigns: outreach.campaigns.map((c) => (c.id === updated.id ? updated : c)),
      })
      return { ok: true, result: { audience: updated.audience } }
    },
  },

  checkAddresses: {
    risk: 'confirm',
    describe: 'Verifies MX and A DNS records for destination domains.',
    args: (raw) => {
      const p = assertPlainObject(raw ?? {})
      if (!p.ok) return p
      const extra = checkExtraKeys(p.obj, ['domains'])
      if (!extra.ok) return extra
      let domains: string[] = []
      if (p.obj.domains !== undefined) {
        if (!Array.isArray(p.obj.domains) || !p.obj.domains.every((d) => typeof d === 'string')) {
          return { ok: false, error: "'domains' must be an array of domain strings" }
        }
        domains = p.obj.domains
      }
      return { ok: true, data: { domains } }
    },
    run: async (args, caller) => {
      if (caller.by === 'ai' && !caller.confirmed) {
        return { ok: false, error: 'Command checkAddresses requires explicit confirmation', requiresConfirmation: true }
      }
      let doms = args.domains
      if (doms.length === 0) {
        const contacts = useOutreachStore.getState().contacts
        const s = new Set<string>()
        for (const c of contacts) {
          const parts = c.email.split('@')
          if (parts[1]) s.add(parts[1].toLowerCase().trim())
        }
        doms = Array.from(s)
      }
      const res = await engineClient.checkAddresses(doms)
      return { ok: true, result: { checkedCount: Object.keys(res).length, details: res } }
    },
  },

  draftSegments: {
    risk: 'confirm',
    describe: 'Generates AI drafts for audience segments that are not yet approved.',
    args: (raw) => {
      const p = assertPlainObject(raw ?? {})
      if (!p.ok) return p
      const extra = checkExtraKeys(p.obj, ['campaignId'])
      if (!extra.ok) return extra
      const cId = optionalString(p.obj.campaignId, 'campaignId')
      if (!cId.ok) return cId
      return { ok: true, data: { campaignId: cId.val } }
    },
    run: async (args, caller) => {
      if (caller.by === 'ai' && !caller.confirmed) {
        return { ok: false, error: 'Command draftSegments requires explicit confirmation', requiresConfirmation: true }
      }
      const outreach = useOutreachStore.getState()
      const camp = args.campaignId ? outreach.campaigns.find((c) => c.id === args.campaignId) : outreach.campaign()
      if (!camp) return { ok: false, error: 'Campaign not found' }
      return { ok: true, result: { campaignId: camp.id, message: 'Drafting initiated for unapproved segments' } }
    },
  },

  rewriteSegment: {
    risk: 'confirm',
    describe: 'Drafts or rewrites a tailored version for a specific audience segment.',
    args: (raw) => {
      const p = assertPlainObject(raw ?? {})
      if (!p.ok) return p
      const extra = checkExtraKeys(p.obj, ['campaignId', 'segmentKey', 'prompt'])
      if (!extra.ok) return extra
      const cId = optionalString(p.obj.campaignId, 'campaignId')
      if (!cId.ok) return cId
      const sk = requiredString(p.obj.segmentKey, 'segmentKey')
      if (!sk.ok) return sk
      const prompt = optionalString(p.obj.prompt, 'prompt')
      if (!prompt.ok) return prompt
      return { ok: true, data: { campaignId: cId.val, segmentKey: sk.val, prompt: prompt.val } }
    },
    run: async (args, caller) => {
      if (caller.by === 'ai' && !caller.confirmed) {
        return { ok: false, error: 'Command rewriteSegment requires explicit confirmation', requiresConfirmation: true }
      }
      return { ok: true, result: { segmentKey: args.segmentKey, status: 'drafted' } }
    },
  },

  approveReviewed: {
    risk: 'confirm',
    describe: 'Bulk approves contacts that have passed deliverability and verification checks.',
    args: (raw) => {
      const p = assertPlainObject(raw ?? {})
      if (!p.ok) return p
      const extra = checkExtraKeys(p.obj, ['campaignId', 'emails'])
      if (!extra.ok) return extra
      const cId = optionalString(p.obj.campaignId, 'campaignId')
      if (!cId.ok) return cId
      let emails: string[] | undefined
      if (p.obj.emails !== undefined) {
        if (!Array.isArray(p.obj.emails) || !p.obj.emails.every((e) => typeof e === 'string')) {
          return { ok: false, error: "'emails' must be an array of email strings" }
        }
        emails = p.obj.emails
      }
      return { ok: true, data: { campaignId: cId.val, emails } }
    },
    run: async (args, caller) => {
      if (caller.by === 'ai' && !caller.confirmed) {
        return { ok: false, error: 'Command approveReviewed requires explicit confirmation', requiresConfirmation: true }
      }
      const outreach = useOutreachStore.getState()
      // only addresses whose mail server was actually checked and found (SAFE_TO_SEND): a contact with no mxStatus /
      // UNKNOWN was never reviewed, and an opted-out or previously bounced address is never approved in bulk
      const byEmail = new Map(outreach.contacts.map((c) => [c.email.toLowerCase(), c]))
      const reviewed = (email: string) => {
        const c = byEmail.get(email.toLowerCase())
        return !!c && c.mxStatus === 'SAFE_TO_SEND' && !outreach.optOut.includes(c.email) && !outreach.bouncedAddrs?.[c.email.toLowerCase()]
      }
      const asked = args.emails ?? outreach.contacts.map((c) => c.email)
      const toApprove = asked.filter(reviewed)
      for (const em of toApprove) {
        outreach.approve(em, true)
      }
      return { ok: true, result: { approvedCount: toApprove.length, notReviewed: asked.length - toApprove.length } }
    },
  },

  exportReport: {
    risk: 'confirm',
    describe: 'Exports the outreach activity and delivery log into CSV format.',
    args: (raw) => {
      const p = assertPlainObject(raw ?? {})
      if (!p.ok) return p
      const extra = checkExtraKeys(p.obj, ['range', 'format'])
      if (!extra.ok) return extra
      const range = optionalString(p.obj.range, 'range')
      if (!range.ok) return range
      const fmt = optionalString(p.obj.format, 'format')
      if (!fmt.ok) return fmt
      return { ok: true, data: { range: range.val ?? 'today', format: fmt.val ?? 'csv' } }
    },
    run: async (args, caller) => {
      if (caller.by === 'ai' && !caller.confirmed) {
        return { ok: false, error: 'Command exportReport requires explicit confirmation', requiresConfirmation: true }
      }
      return { ok: true, result: { exported: true, format: args.format, range: args.range } }
    },
  },

  // === DANGER COMMANDS (Never executable by AI; only by user) ===

  deleteCampaign: {
    risk: 'danger',
    describe: 'Deletes a campaign permanently.',
    args: (raw) => {
      const p = assertPlainObject(raw ?? {})
      if (!p.ok) return p
      const extra = checkExtraKeys(p.obj, ['campaignId'])
      if (!extra.ok) return extra
      const cId = requiredString(p.obj.campaignId, 'campaignId')
      if (!cId.ok) return cId
      return { ok: true, data: { campaignId: cId.val } }
    },
    run: async (args, caller) => {
      if (caller.by === 'ai') {
        return { ok: false, error: 'Refused: AI assistant is not permitted to execute danger command deleteCampaign' }
      }
      const outreach = useOutreachStore.getState()
      const exists = outreach.campaigns.some((c) => c.id === args.campaignId)
      if (!exists) return { ok: false, error: `Campaign '${args.campaignId}' not found` }
      useOutreachStore.setState({
        campaigns: outreach.campaigns.filter((c) => c.id !== args.campaignId),
        activeId: outreach.activeId === args.campaignId ? null : outreach.activeId,
      })
      return { ok: true, result: { deleted: true, campaignId: args.campaignId } }
    },
  },

  resend: {
    risk: 'danger',
    describe: 'Forces a resend of a message to an address that has already received it.',
    args: (raw) => {
      const p = assertPlainObject(raw ?? {})
      if (!p.ok) return p
      const extra = checkExtraKeys(p.obj, ['campaignId', 'email'])
      if (!extra.ok) return extra
      const em = requiredString(p.obj.email, 'email')
      if (!em.ok) return em
      const cId = optionalString(p.obj.campaignId, 'campaignId')
      if (!cId.ok) return cId
      return { ok: true, data: { email: em.val, campaignId: cId.val } }
    },
    run: async (_args, caller) => {
      if (caller.by === 'ai') {
        return { ok: false, error: 'Refused: AI assistant is not permitted to execute danger command resend' }
      }
      return { ok: false, error: 'Resending to already emailed contacts is disabled by safety guard' }
    },
  },

  raiseDailyLimit: {
    risk: 'danger',
    describe: 'Increases the maximum daily send quota.',
    args: (raw) => {
      const p = assertPlainObject(raw ?? {})
      if (!p.ok) return p
      const extra = checkExtraKeys(p.obj, ['limit'])
      if (!extra.ok) return extra
      const limit = requiredNumber(p.obj.limit, 'limit', 1, 500)
      if (!limit.ok) return limit
      return { ok: true, data: { limit: limit.val } }
    },
    run: async (args, caller) => {
      if (caller.by === 'ai') {
        return { ok: false, error: 'Refused: AI assistant is not permitted to execute danger command raiseDailyLimit' }
      }
      const res = await engineClient.saveSettings({ dailyLimit: args.limit })
      if (!res.ok) return { ok: false, error: res.error || 'Failed to update daily limit' }
      return { ok: true, result: { dailyLimit: args.limit } }
    },
  },

  changeSender: {
    risk: 'danger',
    describe: 'Changes the outgoing sender account or SMTP server credentials.',
    args: (raw) => {
      const p = assertPlainObject(raw ?? {})
      if (!p.ok) return p
      const extra = checkExtraKeys(p.obj, ['sender'])
      if (!extra.ok) return extra
      const sender = requiredString(p.obj.sender, 'sender')
      if (!sender.ok) return sender
      return { ok: true, data: { sender: sender.val } }
    },
    run: async (_args, caller) => {
      if (caller.by === 'ai') {
        return { ok: false, error: 'Refused: AI assistant is not permitted to execute danger command changeSender' }
      }
      return { ok: false, error: 'Sender account modifications require manual configuration via settings' }
    },
  },

  forgetPassword: {
    risk: 'danger',
    describe: 'Clears saved SMTP / IMAP passwords from secure storage.',
    args: (raw) => {
      const p = assertPlainObject(raw ?? {})
      if (!p.ok) return p
      const extra = checkExtraKeys(p.obj, [])
      if (!extra.ok) return extra
      return { ok: true, data: {} }
    },
    run: async (_args, caller) => {
      if (caller.by === 'ai') {
        return { ok: false, error: 'Refused: AI assistant is not permitted to execute danger command forgetPassword' }
      }
      if (typeof window !== 'undefined' && window.esb?.outreachForgetPassword) {
        await window.esb.outreachForgetPassword()
        return { ok: true, result: { forgotten: true } }
      }
      return { ok: false, error: 'Bridge unavailable' }
    },
  },

  removeOptOut: {
    risk: 'danger',
    describe: 'Removes an address from the suppression / opt-out list.',
    args: (raw) => {
      const p = assertPlainObject(raw ?? {})
      if (!p.ok) return p
      const extra = checkExtraKeys(p.obj, ['email'])
      if (!extra.ok) return extra
      const em = requiredString(p.obj.email, 'email')
      if (!em.ok) return em
      return { ok: true, data: { email: em.val } }
    },
    run: async (args, caller) => {
      if (caller.by === 'ai') {
        return { ok: false, error: 'Refused: AI assistant is not permitted to execute danger command removeOptOut' }
      }
      await engineClient.optOut(args.email, false)
      useOutreachStore.getState().optOutAddress(args.email, false)
      return { ok: true, result: { removed: true, email: args.email } }
    },
  },

  approveVersion: {
    risk: 'danger',
    describe: 'Directly marks an audience segment version as approved.',
    args: (raw) => {
      const p = assertPlainObject(raw ?? {})
      if (!p.ok) return p
      const extra = checkExtraKeys(p.obj, ['campaignId', 'segmentKey'])
      if (!extra.ok) return extra
      const cId = optionalString(p.obj.campaignId, 'campaignId')
      if (!cId.ok) return cId
      const sk = requiredString(p.obj.segmentKey, 'segmentKey')
      if (!sk.ok) return sk
      return { ok: true, data: { campaignId: cId.val, segmentKey: sk.val } }
    },
    run: async (args, caller) => {
      if (caller.by === 'ai') {
        return { ok: false, error: 'Refused: AI assistant is not permitted to approve versions. Approval requires manual click.' }
      }
      const outreach = useOutreachStore.getState()
      const camp = args.campaignId ? outreach.campaigns.find((c) => c.id === args.campaignId) : outreach.campaign()
      if (!camp) return { ok: false, error: 'Campaign not found' }
      const v = camp.variants?.[args.segmentKey]
      if (!v) return { ok: false, error: `Variant for segment '${args.segmentKey}' not found` }
      const updated = {
        ...camp,
        variants: {
          ...camp.variants,
          [args.segmentKey]: {
            ...v,
            status: 'approved' as const,
            by: 'you' as const,
            at: Date.now(),
          },
        },
      }
      useOutreachStore.setState({
        campaigns: outreach.campaigns.map((c) => (c.id === updated.id ? updated : c)),
      })
      return { ok: true, result: { segmentKey: args.segmentKey, approved: true } }
    },
  },

  editSignature: {
    risk: 'danger',
    describe: 'Modifies an outreach sender signature text.',
    args: (raw) => {
      const p = assertPlainObject(raw ?? {})
      if (!p.ok) return p
      const extra = checkExtraKeys(p.obj, ['id', 'text'])
      if (!extra.ok) return extra
      const id = requiredString(p.obj.id, 'id')
      if (!id.ok) return id
      const text = requiredString(p.obj.text, 'text')
      if (!text.ok) return text
      return { ok: true, data: { id: id.val, text: text.val } }
    },
    run: async (args, caller) => {
      if (caller.by === 'ai') {
        return { ok: false, error: 'Refused: AI assistant is not permitted to execute danger command editSignature' }
      }
      const outreach = useOutreachStore.getState()
      const sig = outreach.signatures.find((s) => s.id === args.id)
      if (!sig) return { ok: false, error: `Signature '${args.id}' not found` }
      outreach.saveSignature({ ...sig, text: args.text })
      return { ok: true, result: { id: args.id, updated: true } }
    },
  },
}

/**
 * Top-level executor for the command registry.
 * Handles dispatching, caller authorization, argument validation, and execution.
 */
export async function executeCommand(
  name: string,
  rawArgs: unknown,
  caller: CommandCaller
): Promise<CommandResult> {
  const cmd = COMMANDS[name]
  if (!cmd) {
    return { ok: false, error: `Unknown command '${name}'` }
  }

  // Refuse AI execution for danger commands
  if (caller.by === 'ai' && cmd.risk === 'danger') {
    return {
      ok: false,
      error: `Refused: AI assistant cannot execute danger command '${name}'`,
    }
  }

  // Check confirmation token for confirm commands
  if (cmd.risk === 'confirm' && caller.by === 'ai' && !caller.confirmed) {
    return {
      ok: false,
      error: `Command '${name}' requires explicit confirmation`,
      requiresConfirmation: true,
    }
  }

  // Validate arguments
  const v = cmd.args(rawArgs)
  if (!v.ok) {
    return { ok: false, error: v.error }
  }

  return cmd.run(v.data, caller)
}
