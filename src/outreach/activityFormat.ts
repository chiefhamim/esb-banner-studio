import { fmtDateTime, fmtTime, fmtWallClock } from '../ui/time'
import type { AutopilotSettings, JobSnapshot, OutreachEvent, OutreachStats } from '../esb'

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
        sentence = `Daily limit reached — continues at ${fmtClock(until, tz)}`
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
export function describeEvent(ev: OutreachEvent): string {
  switch (ev.type) {
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
