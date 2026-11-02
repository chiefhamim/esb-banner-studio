import { fmtDateTime, fmtTime, fmtWallClock } from '../ui/time'
import type { AutopilotSettings, JobSnapshot, LivePlan, OutreachEvent, OutreachStats, PlanWarning } from '../esb'

const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  if (s < 60) return `${s} s`
  if (s < 3600) {
    const m = Math.floor(s / 60)
    const remS = s % 60
    return remS === 0 ? `${m} m` : `${m} m ${String(remS).padStart(2, '0')} s`
  }
  if (s < 86400) {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')} m`
  }
  const d = Math.round(s / 86400)
  return `${d} day${d === 1 ? '' : 's'}`
}

/** Time of day in the Autopilot window's zone, in the editor's 12/24-hour choice: "4:58 PM" / "16:58". */
export function fmtClock(ts: number, tz = 'Asia/Dhaka'): string {
  return fmtTime(ts, { tz })
}

/** Day and time in the Autopilot window's zone: "Sun 1 Nov 4:58 PM" / "Sun 1 Nov 16:58". */
export function fmtDay(ts: number, tz = 'Asia/Dhaka'): string {
  return fmtDateTime(ts, { tz })
}

export function fmtShortDay(ts: number, tz = 'Asia/Dhaka'): string {
  try {
    const dtf = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    })
    const parts = dtf.formatToParts(new Date(ts))
    const p: Record<string, string> = {}
    for (const part of parts) p[part.type] = part.value
    return `${p.weekday} ${p.day} ${p.month}`
  } catch {
    const d = new Date(ts)
    return `${DOW_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`
  }
}


export function fmtDurationHours(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h} h ${String(m).padStart(2, '0')} m`
}

export function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  // an hour or more reads as hours and minutes ("15 h 59 m"), never "959:05"
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')} m`
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

export function fmtMinutes(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60000))
  return `${m} min`
}

/** "1–2 min" / "45 s–2 min" / "20 min": a pacing range as the editor typed it. */
export function fmtGapRange(lo?: number, hi?: number): string {
  const one = (sec: number) => (sec >= 60 ? `${Math.round((sec / 60) * 10) / 10}` : `${sec} s`)
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return ''
  const a = lo as number, b = hi as number
  if (a >= 60 && b >= 60) return a === b ? `${one(a)} min` : `${one(a)}–${one(b)} min`
  if (a === b) return `${a} s`
  return `${one(a)}${a >= 60 ? ' min' : ''}–${one(b)}${b >= 60 ? ' min' : ''}`
}

/**
 * Why the engine is holding a batch, in words, from JobSnapshot.why + .wait (electron/outreach-engine.cjs):
 * "desco.gov.bd: 20-min spacing per organisation", "desco.gov.bd had 3 today (limit 3 per organisation)",
 * "gap 1–2 min", "outside sending hours (09:00–17:00)". Null when it is not waiting.
 */
export function waitReason(job: Pick<JobSnapshot, 'status' | 'why' | 'wait'> | null | undefined): string | null {
  if (!job || job.status !== 'waiting' || !job.why) return null
  const w = job.wait || {}
  switch (job.why) {
    case 'domain': {
      const org = w.domain || 'Same organisation'
      if (w.kind === 'limit') return `${org} had ${w.count ?? w.max ?? 3} today (limit ${w.max ?? 3} per organisation)`
      if (w.kind === 'spacing') return `${org}: ${Math.max(1, Math.round((w.gapSec ?? 1200) / 60))}-min spacing per organisation`
      return 'every remaining organisation was just emailed — checking again in a minute'
    }
    case 'gap': {
      const r = fmtGapRange(w.minSec, w.maxSec)
      return r ? `gap ${r}` : 'gap between emails'
    }
    case 'window':
      return w.from && w.to ? `outside sending hours (${fmtWallClock(w.from)}–${fmtWallClock(w.to)})` : 'outside sending hours'
    case 'cap':
      return capReason(w)
    case 'quota':
      return 'Gmail asked to slow down'
    case 'offline':
      return 'offline — trying again every minute'
    case 'schedule':
      return 'scheduled start'
    case 'held':
      return 'all remaining contacts are held'
    default:
      return null
  }
}

/** When the daily limit / safety ceiling lets sending resume, in words — "resumes 09:00 (sending hours)",
 *  "resumes 00:00 (new day)", "resumes Tue 3 Nov 15:26". Tomorrow's clock time reads as a time; further out as a day. */
function resumeWords(w: NonNullable<JobSnapshot['wait']>): string {
  const at = w.resumeAt ?? w.resetAt
  if (!at) return ''
  const tz = w.tz || 'Asia/Dhaka'
  const when = at - Date.now() < 36 * 3600 * 1000 ? fmtClock(at, tz) : fmtDay(at, tz)
  if (w.kind === 'ceiling') return ` · resumes ${when}`
  return ` · resumes ${when} (${w.hours ? 'sending hours' : 'new day'})`
}

/** The daily-limit wait in words (calendar day; or the 24 h safety ceiling). */
export function capReason(w: NonNullable<JobSnapshot['wait']> | Record<string, never>): string {
  if (w.limit === undefined) return 'daily limit reached'
  if (w.kind === 'ceiling') return `safety limit: ${w.sent ?? w.ceiling} emails in 24 h (max ${w.ceiling ?? 400})${resumeWords(w)}`
  // a job snapshot from before 2026-11-02 has no kind: the old rolling wording
  if (!w.kind) return `${w.sent ?? w.limit} sent in 24 h — ${w.ramp ? `warm-up limit ${w.limit} today` : `daily limit ${w.limit}`}`
  return `${w.ramp ? 'warm-up' : 'daily'} limit reached — ${w.sent ?? w.limit} of ${w.limit} sent today${resumeWords(w)}`
}

export interface RunDescription {
  status: 'idle' | 'sending' | 'waiting' | 'paused' | 'done' | 'stopped' | 'problem'
  label: string
  chipClass: string
  sentence: string
  summary: string
  countText: string
  percent: number
  nextInText?: string
  etaText?: string
  /** waitReason(): what exactly it waits for. */
  reason?: string
}

export function describeRun(
  job: JobSnapshot | null | undefined,
  settings: AutopilotSettings | null | undefined,
  now = Date.now()
): RunDescription {
  const tz = settings?.window?.tz || 'Asia/Dhaka'
  const tzShort = tz.split('/').pop()?.replace(/_/g, ' ') || 'Dhaka'

  if (!job || job.status === 'queued' && job.sent === 0 && job.total === 0) {
    const days = (settings?.window?.days || [0, 1, 2, 3, 4]).map((d) => DOW_NAMES[d]).join(', ')
    const winText = settings?.window?.enabled
      ? `${days} ${fmtWallClock(settings.window.from)}–${fmtWallClock(settings.window.to)}, ${tzShort}`
      : 'Sending anytime'
    const rampText = settings?.ramp
      ? `Up to ${settings?.dailyLimit ?? 100} a day (ramp)`
      : `Up to ${settings?.dailyLimit ?? 100} a day`

    return {
      status: 'idle',
      label: 'Idle',
      chipClass: 'cs-idle',
      sentence: winText,
      summary: rampText,
      countText: 'No campaign sending',
      percent: 0,
    }
  }

  const total = Math.max(1, job.total)
  const sent = job.sent
  const percent = Math.min(100, Math.round((sent / total) * 100))
  const countText = `${sent.toLocaleString()} of ${total.toLocaleString()}`

  if (job.status === 'running') {
    const nextIn = job.until ? fmtCountdown(job.until - now) : undefined
    return {
      status: 'sending',
      label: 'Sending',
      chipClass: 'cs-sending',
      sentence: `Sending ${countText}`,
      summary: `Sending ${countText} · ${percent}%`,
      countText,
      percent,
      nextInText: nextIn ? `Next in ${nextIn}` : undefined,
    }
  }

  if (job.status === 'waiting') {
    let sentence = 'Waiting to send'
    const until = job.until || now

    switch (job.why) {
      case 'window':
        sentence = `Waiting for the window — opens ${fmtDay(until, tz)}`
        break
      case 'cap':
        sentence = job.wait?.kind === 'ceiling'
          ? `Safety limit reached — continues at ${fmtClock(until, tz)}`
          : `Daily limit reached — continues at ${fmtClock(until, tz)}`
        break
      case 'gap':
        sentence = `Spacing out sends — next in ${fmtCountdown(until - now)}`
        break
      case 'domain':
        sentence = `Same company just emailed — next in ${fmtMinutes(until - now)}`
        break
      case 'offline':
        sentence = 'Offline — trying again every minute'
        break
      case 'quota':
        sentence = `Gmail asked us to slow down — continues at ${fmtClock(until, tz)}`
        break
      case 'held':
        sentence = 'Waiting — all remaining messages are held'
        break
      default:
        sentence = `Waiting — next in ${fmtCountdown(until - now)}`
    }

    return {
      status: 'waiting',
      label: 'Waiting',
      chipClass: 'cs-waiting',
      sentence,
      summary: sentence,
      countText,
      percent,
      nextInText: job.until ? `Next in ${fmtCountdown(job.until - now)}` : undefined,
      reason: waitReason(job) ?? undefined,
    }
  }

  if (job.status === 'paused') {
    let sentence = 'Paused'
    switch (job.reason) {
      case 'user':
        sentence = 'Paused by you'
        break
      case 'auth':
        sentence = 'Paused — sign-in problem'
        break
      case 'circuit':
        sentence = 'Paused to protect your account: 3 of the last 10 addresses were refused'
        break
      case 'content':
        sentence = 'Paused — the attachment is too large'
        break
      case 'quit':
        sentence = 'Paused when the app closed'
        break
      default:
        sentence = 'Paused'
    }

    return {
      status: 'paused',
      label: 'Paused',
      chipClass: 'cs-paused',
      sentence,
      summary: sentence,
      countText,
      percent,
    }
  }

  if (job.status === 'done') {
    return {
      status: 'done',
      label: 'Done',
      chipClass: 'cs-done',
      sentence: `${sent.toLocaleString()} sent in full`,
      summary: `${sent.toLocaleString()} sent.`,
      countText,
      percent: 100,
    }
  }

  return {
    status: 'stopped',
    label: 'Stopped',
    chipClass: 'cs-stopped',
    sentence: 'Sending was stopped',
    summary: 'Sending was stopped.',
    countText,
    percent,
  }
}

/** Human sentence describing an append-only event for the Activity Log (§5.7) */
// Fields the desk prints as text. The log is append-only and written by several builds (and by other PCs through
// sync), so a field may hold anything: the 2026-11-01 `settings.migrated` event carried `to: { minDelaySec, … }`, the
// Log printed `ev.to` as the recipient, React threw "objects are not valid as a React child" and, with no boundary,
// the whole window went blank ("clicking Log freezes the app"). Every event is passed through this before it is shown.
const TEXT_FIELDS = ['email', 'to', 'name', 'org', 'campaignName', 'campaignId', 'error', 'kind', 'code', 'reason', 'detail', 'text', 'why', 'subject', 'by', 'what', 'source', 'type', 'id'] as const
const NUM_FIELDS = ['t', 'ms', 'attempt', 'sent', 'failed', 'skipped', 'total'] as const

/** A copy of the event where every field the desk prints is a string or number (anything else is dropped). */
export function displaySafe(ev: OutreachEvent): OutreachEvent {
  const out: OutreachEvent = { ...ev }
  for (const k of TEXT_FIELDS) {
    const v = out[k]
    if (v === undefined || v === null) continue
    if (typeof v === 'string') continue
    if (typeof v === 'number' && Number.isFinite(v)) { out[k] = String(v); continue }
    delete out[k]
  }
  for (const k of NUM_FIELDS) {
    const v = out[k]
    if (v === undefined || v === null) continue
    if (typeof v !== 'number' || !Number.isFinite(v)) delete out[k]
  }
  if (typeof out.id !== 'string') out.id = `${out.t ?? 0}-${Math.random().toString(36).slice(2, 8)}`
  if (typeof out.t !== 'number') out.t = 0
  if (typeof out.type !== 'string') out.type = 'unknown'
  return out
}

export function describeEvent(ev: OutreachEvent): string {
  switch (ev.type) {
    case 'settings.migrated':
      return 'Sending settings updated by an app update'
    case 'send.ok':
      return `Sent to ${ev.name || ev.email || ev.to}${ev.org ? ` (${ev.org})` : ''}`
    case 'send.fail':
      return `Failed sending to ${ev.email || ev.to}: ${ev.error || ev.kind || 'Refused'}`
    case 'send.retry':
      return `Will retry ${ev.email || ev.to} (attempt ${ev.attempt || 1}): ${ev.error || ev.kind}`
    case 'send.skip':
      return `Skipped ${ev.email || ev.to}: ${ev.reason}`
    case 'reply':
      return `${ev.email || ev.to} replied${ev.unsubscribe ? ' with unsubscribe request' : ''}`
    case 'bounce':
      return `${ev.email || ev.to} bounced: ${ev.reason}`
    case 'optout':
      return `${ev.email || ev.to} ${ev.on === false ? 're-subscribed' : 'opted out'}`
    case 'recipient.held':
      return `Held sending to ${ev.email || ev.to}`
    case 'recipient.released':
      return `Released hold on ${ev.email || ev.to}`
    case 'job.created':
      return `Created sending batch for ${ev.name || 'campaign'} (${ev.total || 0} emails)`
    case 'job.started':
    case 'job.resumed':
      return `Sending started`
    case 'job.paused':
      return `Paused${ev.reason ? ` (${ev.reason})` : ''}`
    case 'job.waiting':
      return `Waiting (${ev.why || 'window'})`
    case 'job.done':
      return `Batch finished: ${ev.sent || 0} sent`
    case 'job.stopped':
      return `Batch stopped: ${ev.sent || 0} sent`
    case 'engine.start':
      return 'Engine started'
    case 'engine.quit':
      return 'Engine quit cleanly'
    case 'inbox.checked':
      return 'Inbox checked for replies'
    case 'ai.action':
      return `Assistant: ${ev.text || ''}`
    case 'note':
      return ev.text || ''
    default:
      return ev.type
  }
}

/** Plain text report summary built from numbers only (§5.7) */
export function reportSummary(stats: OutreachStats, campaignName = 'All campaigns'): string {
  const sent = (stats.totals?.sent || 0).toLocaleString()
  const failed = (stats.totals?.failed || 0).toLocaleString()
  const bounced = (stats.totals?.bounced || 0).toLocaleString()
  const replies = (stats.totals?.replied || 0).toLocaleString()
  const optedOut = (stats.totals?.optedOut || 0).toLocaleString()

  const tz = stats.window?.tz || 'Asia/Dhaka'
  const timeRange = stats.firstSendAt && stats.lastSendAt
    ? ` between ${fmtDay(stats.firstSendAt, tz)} and ${fmtDay(stats.lastSendAt, tz)}`
    : ''

  const timeSending = fmtDurationHours(Math.round((stats.durations?.activeMs || 0) / 1000))
  const avgGap = fmtDuration(stats.durations?.avgGapSec || 0)

  return `${campaignName} — ${sent} sent${timeRange}; ${failed} failed; ${bounced} bounced; ${replies} replies (${optedOut} unsubscribed). Time sending: ${timeSending}; average gap ${avgGap}.`
}

// ─── The Sending panel's live plan, in words (numbers from the engine: outreach-schedule.cjs livePlan) ───────────

/** "about 2.5 h" / "about 40 min" */
export function fmtAbout(sec: number): string {
  if (sec < 90 * 60) return `about ${Math.max(1, Math.round(sec / 60))} min`
  const h = Math.round((sec / 3600) * 2) / 2
  return `about ${h} h`
}

/** When the next email goes, in words, relative to `now` in the sending time zone. */
export function fmtNext(at: number | null, now: number, tz: string): string {
  if (at == null) return ''
  const d = at - now
  if (d < 45_000) return 'next email now'
  if (d < 60 * 60_000) return `next email in about ${Math.max(1, Math.round(d / 60_000))} min`
  const day = (t: number) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(t)
  if (day(at) === day(now)) return `next email at ${fmtTime(at, { tz })}`
  if (day(at) === day(now + 24 * 3600_000)) return `next email tomorrow ${fmtTime(at, { tz })}`
  return `next email ${fmtDateTime(at, { tz })}`
}

/** The plan line: "Today: 19 of 100 sent · next email now · at 1–2 min gaps, 100 emails take about 2.5 h · the
 *  remaining 182 in this campaign finish Wed 4 Nov 9:00 AM". */
export function planLine(p: LivePlan, opts: { campaign: boolean }): string {
  const parts = [`Today: ${p.sentToday} of ${p.limitToday} sent`]
  if (p.nextAt != null) parts.push(fmtNext(p.nextAt, p.now, p.tz))
  parts.push(`at ${fmtGapRange(p.minGapSec, p.maxGapSec)} gaps, ${Math.min(p.limit, p.ceiling)} emails take ${fmtAbout(p.dayDurationSec)}`)
  if (opts.campaign) {
    if (p.remaining === 0) parts.push('nothing left to send in this campaign')
    else if (p.finishAt != null) {
      const sameDay = p.perDay.length === 1 && p.perDay[0].day === new Intl.DateTimeFormat('en-CA', { timeZone: p.tz }).format(p.now)
      parts.push(`the remaining ${p.remaining.toLocaleString()} in this campaign finish ${sameDay ? `today ~${fmtTime(p.finishAt, { tz: p.tz })}` : `~${fmtDateTime(p.finishAt, { tz: p.tz })}`}`)
    }
  }
  return parts.join(' · ')
}

/** A contradiction between the settings, in plain words. */
export function warningText(w: PlanWarning): string {
  switch (w.kind) {
    case 'hours':
      return `Only about ${w.fit} emails fit in ${fmtAbout(w.spanSec).replace('about ', '')} of sending hours at ~${fmtGapRange(w.avgGapSec, w.avgGapSec)} gaps — fewer than the ${w.limit} a day you set. Widen the hours or shorten the gaps.`
    case 'ceiling':
      return `Safety ceiling: never more than ${w.ceiling} emails in any 24 hours (Gmail allows about 500), so ${w.limit} a day cannot all go.`
    case 'ramp':
      return `Warm-up is on: today’s limit is ${w.limitToday}, rising by 20 each sending day until it reaches ${w.limit}.`
    case 'anyHour':
      return 'Sending hours are off: emails go out at any hour, also at night and at weekends.'
    case 'org':
      return `${w.inOrgs.toLocaleString()} of the ${w.remaining.toLocaleString()} remaining contacts are in ${w.orgs.toLocaleString()} ${w.orgs === 1 ? 'organisation' : 'organisations'} — at ${w.orgMax} a day each${w.orgGapMin ? `, ${w.orgGapMin} min apart` : ''}, only ${w.today} can go today.`
  }
}

