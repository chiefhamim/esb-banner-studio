// ESB Studio — Outreach Scheduling Maths (electron/outreach-schedule.cjs)
// Pure scheduling, send window, pacing, ramp-up, and domain throttling functions (§4.6).

const PUBLIC_WEBMAILS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'ymail.com',
  'rocketmail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'aol.com',
  'zoho.com',
  'gmx.com',
  'mail.com',
])

const DAY_MS = 24 * 3600 * 1000

/**
 * Extracts zoned date parts using Intl.DateTimeFormat without external date libraries.
 */
function zonedParts(ts, tz = 'Asia/Dhaka') {
  const d = new Date(ts)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short', // Sun, Mon, Tue, Wed, Thu, Fri, Sat
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  })

  const parts = formatter.formatToParts(d)
  const map = {}
  for (const p of parts) {
    map[p.type] = p.value
  }

  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const weekday = weekdayMap[map.weekday] ?? d.getUTCDay()
  const year = Number(map.year)
  const month = Number(map.month)
  const day = Number(map.day)
  let hour = Number(map.hour)
  if (hour === 24) hour = 0
  const minute = Number(map.minute)
  const second = Number(map.second)

  return { year, month, day, weekday, hour, minute, second }
}

function parseTime(timeStr) {
  const [h, m] = String(timeStr || '09:00').split(':').map(Number)
  return { hour: h || 0, minute: m || 0 }
}

/**
 * Checks if the window is currently open, and calculates when it opens/closes next.
 */
function windowState(now, win = {}) {
  const enabled = win.enabled !== false
  if (!enabled) {
    return { open: true, opensAt: null, closesAt: null }
  }

  const tz = win.tz || 'Asia/Dhaka'
  const days = new Set(Array.isArray(win.days) ? win.days : [0, 1, 2, 3, 4]) // Default Sun(0)..Thu(4)
  const start = parseTime(win.from || '09:00')
  const end = parseTime(win.to || '17:00')

  const zp = zonedParts(now, tz)
  const curMinutes = zp.hour * 60 + zp.minute + zp.second / 60
  const startMinutes = start.hour * 60 + start.minute
  const endMinutes = end.hour * 60 + end.minute

  const isTodayOpenDay = days.has(zp.weekday)
  const isOpenTime = curMinutes >= startMinutes && curMinutes < endMinutes
  const isOpen = isTodayOpenDay && isOpenTime

  // Find when today's window closes
  let closesAt = null
  if (isOpen) {
    const msUntilClose = (endMinutes - curMinutes) * 60 * 1000
    closesAt = Math.round(now + msUntilClose)
  }

  // Find next opening
  let opensAt = null
  if (isOpen) {
    opensAt = null
  } else {
    // Scan ahead up to 8 days to find the next opening
    for (let dayOffset = 0; dayOffset <= 8; dayOffset++) {
      const probeTarget = now + dayOffset * DAY_MS
      const probeZp = zonedParts(probeTarget, tz)
      if (!days.has(probeZp.weekday)) continue

      // If today and we haven't reached start time yet
      if (dayOffset === 0 && curMinutes < startMinutes) {
        const msUntilStart = (startMinutes - curMinutes) * 60 * 1000
        opensAt = Math.round(now + msUntilStart)
        break
      }

      // Future day
      if (dayOffset > 0) {
        // Approximate time of probe day at startMinutes
        // We know probeZp represents the date in tz
        const curDayMinutes = probeZp.hour * 60 + probeZp.minute + probeZp.second / 60
        const diffMs = (startMinutes - curDayMinutes) * 60 * 1000
        opensAt = Math.round(probeTarget + diffMs)
        break
      }
    }
  }

  return { open: isOpen, opensAt, closesAt }
}

function secondsLeftInWindow(now, win = {}) {
  const ws = windowState(now, win)
  if (!ws.open) return 0
  if (!ws.closesAt) return 12 * 3600 // Window disabled fallback (12h)
  return Math.max(0, Math.round((ws.closesAt - now) / 1000))
}

function rampCap(dailyLimit = 100, sendDays = 1, ramp = true) {
  if (!ramp) return dailyLimit
  const dayIndex = Math.max(1, sendDays)
  const rampAllowed = 30 + 20 * (dayIndex - 1)
  return Math.min(dailyLimit, rampAllowed)
}

function autoGap(spanSec, room, rnd = Math.random) {
  const effectiveRoom = Math.max(1, room)
  const span = Math.max(60, spanSec)
  const rawGap = span / effectiveRoom
  const clamped = Math.max(60, Math.min(1800, rawGap))
  const factor = 0.7 + (rnd() * 0.6) // 0.7 .. 1.3
  const jittered = clamped * factor
  return Math.max(60, Math.round(jittered))
}

function domainOf(email) {
  if (typeof email !== 'string') return ''
  const at = email.lastIndexOf('@')
  return at >= 0 ? email.slice(at + 1).trim().toLowerCase() : ''
}

function isWebmail(domain) {
  return PUBLIC_WEBMAILS.has(String(domain || '').toLowerCase())
}

/**
 * Selects the next eligible message index from the job's messages queue.
 *
 * @param {Array<{ to: string, email?: string, held?: boolean }>} messages
 * @param {Set<number>|Array<number>} sentIndexes
 * @param {number} now
 * @param {Map<string, { lastSentAt: number, countToday: number }>} domainStats
 * @param {{
 *   domainMaxPerDay?: number,
 *   domainMinGapSec?: number,
 *   heldSet?: Set<number>
 * }} cfg
 * @returns {{ index: number, email: string, domain: string } | { waiting: 'domain', earliestAt: number } | null}
 */
function pickNext(messages, sentIndexes, now, domainStats, cfg = {}) {
  const maxPerDay = cfg.domainMaxPerDay ?? 3
  const minGapMs = (cfg.domainMinGapSec ?? (20 * 60)) * 1000
  const heldSet = cfg.heldSet || null
  const sentSet = sentIndexes instanceof Set ? sentIndexes : new Set(sentIndexes)

  let earliestDomainFreeAt = Infinity
  let foundAnyQueued = false

  for (let i = 0; i < messages.length; i++) {
    if (sentSet.has(i)) continue
    if (heldSet && heldSet.has(i)) continue
    const m = messages[i]
    if (!m || m.held) continue

    foundAnyQueued = true
    const email = m.to || m.email || ''
    const dom = domainOf(email)

    if (!dom || isWebmail(dom)) {
      return { index: i, email, domain: dom }
    }

    const st = domainStats.get(dom)
    if (!st) {
      return { index: i, email, domain: dom }
    }

    if (st.countToday >= maxPerDay) {
      // Exceeded daily domain count
      continue
    }

    const nextAllowedAt = (st.lastSentAt || 0) + minGapMs
    if (now >= nextAllowedAt) {
      return { index: i, email, domain: dom }
    } else {
      if (nextAllowedAt < earliestDomainFreeAt) {
        earliestDomainFreeAt = nextAllowedAt
      }
    }
  }

  if (!foundAnyQueued) {
    return null
  }

  if (Number.isFinite(earliestDomainFreeAt)) {
    return { waiting: 'domain', earliestAt: earliestDomainFreeAt }
  }

  return null
}

/**
 * Plans schedule across calendar days based on current window, limits and ramp.
 */
function planSchedule({ count, now, settings = {}, sentLast24h = 0, sendDays = 1 }) {
  const dailyLimit = settings.dailyLimit || 100
  const ramp = settings.ramp !== false
  const win = settings.window || { enabled: true, from: '09:00', to: '17:00', days: [0, 1, 2, 3, 4], tz: 'Asia/Dhaka' }
  const tz = win.tz || 'Asia/Dhaka'
  const openDays = new Set(Array.isArray(win.days) ? win.days : [0, 1, 2, 3, 4])
  const startTime = parseTime(win.from || '09:00')

  let remaining = count
  let currentSendDay = sendDays
  let dayOffset = 0
  const perDay = []
  let firstAt = null
  let lastAt = null

  while (remaining > 0 && dayOffset < 365) {
    const probeTime = now + dayOffset * DAY_MS
    const zp = zonedParts(probeTime, tz)

    if (win.enabled !== false && !openDays.has(zp.weekday)) {
      dayOffset++
      continue
    }

    const cap = rampCap(dailyLimit, currentSendDay, ramp)
    const availableToday = dayOffset === 0 ? Math.max(0, cap - sentLast24h) : cap

    if (availableToday > 0) {
      const willSendToday = Math.min(remaining, availableToday)
      perDay.push(willSendToday)
      remaining -= willSendToday
      currentSendDay++

      // Determine timestamps
      const approxStart = probeTime
      if (firstAt === null) {
        const ws = windowState(now, win)
        firstAt = ws.open ? now : (ws.opensAt || now)
      }
      lastAt = approxStart
    }

    dayOffset++
  }

  return {
    days: perDay.length,
    firstAt,
    lastAt,
    perDay,
  }
}

module.exports = {
  PUBLIC_WEBMAILS,
  zonedParts,
  windowState,
  secondsLeftInWindow,
  rampCap,
  autoGap,
  domainOf,
  isWebmail,
  pickNext,
  planSchedule,
}
