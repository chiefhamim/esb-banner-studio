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
// one formatter per zone: building an Intl.DateTimeFormat costs far more than using one, and the engine asks for
// the local day of every send on every tick (warm-up days, the calendar-day limit)
const ZONE_FORMATTERS = new Map()
function zoneFormatter(tz) {
  let f = ZONE_FORMATTERS.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    })
    ZONE_FORMATTERS.set(tz, f)
  }
  return f
}

function zonedParts(ts, tz = 'Asia/Dhaka') {
  const d = new Date(ts)
  const formatter = zoneFormatter(tz) || new Intl.DateTimeFormat('en-US', {
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

/**
 * Automatic pacing: spread the room left today across the time left in the window, jittered ±30 %.
 * With `bounds` ({ minSec, maxSec } = the editor's "wait at least / at most"), the result is always inside them:
 * automatic pacing never sends closer together than the editor's shortest gap and never waits longer than the
 * longest one (a long window with little room left therefore sends at the longest gap and finishes early, rather
 * than stretching past what the editor asked for). Without bounds: the old 60 s .. 1,800 s clamp.
 */
function autoGap(spanSec, room, rnd = Math.random, bounds = null) {
  const effectiveRoom = Math.max(1, room)
  const span = Math.max(60, spanSec)
  const rawGap = span / effectiveRoom
  const clamped = Math.max(60, Math.min(1800, rawGap))
  const factor = 0.7 + (rnd() * 0.6) // 0.7 .. 1.3
  const jittered = clamped * factor
  const lo = bounds && Number.isFinite(bounds.minSec) && bounds.minSec > 0 ? bounds.minSec : 60
  const hi = bounds && Number.isFinite(bounds.maxSec) && bounds.maxSec >= lo ? bounds.maxSec : Infinity
  if (!bounds) return Math.max(60, Math.round(jittered))
  // inside the editor's range: rawGap picks the point, the jitter keeps it from looking machine-made
  const target = Math.max(lo, Math.min(hi, rawGap))
  return Math.round(Math.max(lo, Math.min(hi, target * factor)))
}

// ─── The daily limit: ONE rule, used by the engine, the mailer's ledger and the live plan ───────────────────────────
// "100 a day" means 100 per CALENDAR day in the sending time zone: it starts again at local midnight (Asia/Dhaka for
// the desk). Until 2026-11-02 it was a rolling 24 h window, so 100 sends that began at 15:26 kept the next batch waiting
// until 15:26 the following day — about 4 hours into the sending hours. A calendar reset on its own could let a
// whole day's sends at 23:00 be followed by another day's at 00:00, so a second, fixed ceiling over any rolling 24 h
// (GMAIL_SAFE_24H, below Gmail's 500 for a consumer account) still applies; it is configurable in the settings file
// (`gmailCeiling24h`) but not on screen.
const GMAIL_SAFE_24H = 400

/** Local midnight (epoch ms) of the day `ts` falls on, in `tz`. */
function dayStartAt(ts, tz = 'Asia/Dhaka') {
  const zp = zonedParts(ts, tz)
  const ms = new Date(ts).getUTCMilliseconds()
  let start = ts - ((zp.hour * 60 + zp.minute) * 60 + zp.second) * 1000 - ms
  // a DST change during the day moves midnight by the offset change: one correction step
  const chk = zonedParts(start, tz)
  if (chk.hour !== 0 || chk.minute !== 0) {
    const off = chk.hour >= 12 ? (24 - chk.hour) * 3600 * 1000 - chk.minute * 60000 : -(chk.hour * 3600 * 1000 + chk.minute * 60000)
    start += off
  }
  return start
}

/** The next local midnight after `ts`. */
function nextDayStartAt(ts, tz = 'Asia/Dhaka') {
  return dayStartAt(dayStartAt(ts, tz) + 30 * 3600 * 1000, tz)
}

/** 'YYYY-MM-DD' of `ts` in `tz` (warm-up counts sending days by this). */
function dayKey(ts, tz = 'Asia/Dhaka') {
  const zp = zonedParts(ts, tz)
  return `${zp.year}-${String(zp.month).padStart(2, '0')}-${String(zp.day).padStart(2, '0')}`
}

/** When sending may next happen at or after `ts`: `ts` itself inside the hours, else the next opening. */
function nextOpenAt(ts, win = {}) {
  const ws = windowState(ts, win)
  return ws.open ? ts : ws.opensAt || ts
}

/**
 * How many may still go now under the daily limit (calendar day in `tz`) and the rolling 24 h safety ceiling.
 * `sendTimes`: times (ms) of the sends that count (real campaign sends and follow-ups; tests never count), any order.
 * @returns {{ sentToday: number, sent24h: number, room: number, limitedBy: null | 'day' | 'ceiling', freesAt: number | null, dayEndsAt: number }}
 */
function capState({ sendTimes = [], now, tz = 'Asia/Dhaka', dailyLimit = 100, ceiling24h = GMAIL_SAFE_24H }) {
  const start = dayStartAt(now, tz)
  const dayEndsAt = nextDayStartAt(now, tz)
  const since = now - DAY_MS
  const last24 = []
  let sentToday = 0
  for (const t of sendTimes) {
    if (!Number.isFinite(t) || t > now) continue
    if (t >= start) sentToday++
    if (t > since) last24.push(t)
  }
  const sent24h = last24.length
  const ceil = Number.isFinite(ceiling24h) && ceiling24h > 0 ? ceiling24h : GMAIL_SAFE_24H
  const roomDay = dailyLimit - sentToday
  const roomCeil = ceil - sent24h
  const room = Math.max(0, Math.min(roomDay, roomCeil))
  if (room > 0) return { sentToday, sent24h, room, limitedBy: null, freesAt: null, dayEndsAt }
  // the ceiling frees when the (sent24h - ceiling + 1)-th oldest send of the last 24 h turns 24 h old
  last24.sort((a, b) => a - b)
  const ceilFree = roomCeil <= 0 ? (last24[Math.max(0, sent24h - ceil)] ?? now) + DAY_MS : now
  if (roomDay <= 0) return { sentToday, sent24h, room: 0, limitedBy: 'day', freesAt: Math.max(dayEndsAt, ceilFree), dayEndsAt }
  return { sentToday, sent24h, room: 0, limitedBy: 'ceiling', freesAt: Math.max(now + 1000, ceilFree), dayEndsAt }
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
 * @returns {{ index: number, email: string, domain: string } | { waiting: 'domain', earliestAt: number, domain?: string, kind?: 'limit' | 'spacing', count?: number } | null}
 */
function pickNext(messages, sentIndexes, now, domainStats, cfg = {}) {
  const maxPerDay = cfg.domainMaxPerDay ?? 3
  const minGapMs = (cfg.domainMinGapSec ?? (20 * 60)) * 1000
  const heldSet = cfg.heldSet || null
  const sentSet = sentIndexes instanceof Set ? sentIndexes : new Set(sentIndexes)

  let earliestDomainFreeAt = Infinity
  let earliestInfo = null // { domain, kind: 'limit' | 'spacing', count }
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
      // Exceeded daily domain count - free when resetAt arrives
      const resetTime = st.resetAt || (now + 24 * 3600 * 1000)
      if (resetTime < earliestDomainFreeAt) {
        earliestDomainFreeAt = resetTime
        earliestInfo = { domain: dom, kind: 'limit', count: st.countToday }
      }
      continue
    }

    const nextAllowedAt = (st.lastSentAt || 0) + minGapMs
    if (now >= nextAllowedAt) {
      return { index: i, email, domain: dom }
    } else {
      if (nextAllowedAt < earliestDomainFreeAt) {
        earliestDomainFreeAt = nextAllowedAt
        earliestInfo = { domain: dom, kind: 'spacing', count: st.countToday }
      }
    }
  }

  if (!foundAnyQueued) {
    return null
  }

  if (Number.isFinite(earliestDomainFreeAt)) {
    return { waiting: 'domain', earliestAt: earliestDomainFreeAt, ...(earliestInfo || {}) }
  }

  return null
}

/**
 * Plans schedule across calendar days based on current window, limits and ramp.
 */
function planSchedule({ count, now, settings = {}, sentLast24h = 0, sentToday = null, sendDays = 1 }) {
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
    const availableToday = dayOffset === 0 ? Math.max(0, cap - (sentToday ?? sentLast24h)) : cap

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

/**
 * The live plan the Sending panel shows, simulated email by email with the engine's own rules: a gap between emails
 * (the middle of "wait at least / at most"), the sending hours, the calendar-day limit (with warm-up), the 24 h safety
 * ceiling, and per organisation at most N a day, M minutes apart. Pure; the engine supplies the log-derived inputs.
 *
 * @param {object} p
 * @param {number} p.now
 * @param {object} p.settings        Autopilot settings (possibly an unsaved draft)
 * @param {number[]} p.sendTimes     send.ok times of the last 24 h (any order)
 * @param {number} [p.sendDays]      sending days so far (warm-up)
 * @param {number} [p.lastSendAt]
 * @param {number} [p.remaining]     emails left in the campaign
 * @param {string[]} [p.domains]     the organisation (domain) of each remaining email, if known
 * @param {Map<string,{countToday:number,lastSentAt:number}>} [p.domainToday] per-organisation sends today
 */
function livePlan({ now, settings = {}, sendTimes = [], sendDays = 1, lastSendAt = 0, remaining = 0, domains = null, domainToday = null }) {
  const win = settings.window || { enabled: true, from: '09:00', to: '17:00', days: [0, 1, 2, 3, 4], tz: 'Asia/Dhaka' }
  const tz = win.tz || 'Asia/Dhaka'
  const windowOn = win.enabled !== false
  const limit = Number.isFinite(settings.dailyLimit) ? settings.dailyLimit : 100
  const ramp = settings.ramp !== false
  const ceiling = Number.isFinite(settings.gmailCeiling24h) ? settings.gmailCeiling24h : GMAIL_SAFE_24H
  const minGap = Number.isFinite(settings.minDelaySec) ? settings.minDelaySec : 180
  const maxGap = Number.isFinite(settings.maxDelaySec) && settings.maxDelaySec >= minGap ? settings.maxDelaySec : minGap
  const avgGap = (minGap + maxGap) / 2
  const orgMax = Number.isFinite(settings.domainMaxPerDay) ? settings.domainMaxPerDay : 3
  const orgGapMs = (Number.isFinite(settings.domainMinGapSec) ? settings.domainMinGapSec : 1200) * 1000
  const winOpts = windowOn ? win : { enabled: false }

  const limitToday = rampCap(limit, sendDays, ramp)
  const cap = capState({ sendTimes, now, tz, dailyLimit: limitToday, ceiling24h: ceiling })

  // the sending hours in one day, and how many emails fit in them at the average gap
  let span = 24 * 3600
  if (windowOn) {
    const a = parseTime(win.from)
    const b = parseTime(win.to)
    span = Math.max(0, (b.hour * 60 + b.minute - a.hour * 60 - a.minute) * 60)
  }
  // 09:00–11:00 at 20-min gaps: 09:00, 09:20 … 10:40 = 6 (the window closes at 11:00)
  const fitPerDay = Math.max(1, Math.ceil(span / avgGap))
  const dayDurationSec = Math.max(0, (Math.min(limit, ceiling) - 1) * avgGap)

  // ── simulate, email by email ──
  const queue = new Map() // domain -> remaining count ('' = no organisation limit: webmail or unknown)
  const doms = Array.isArray(domains) && domains.length ? domains : null
  const total = Math.max(0, Math.floor(remaining || (doms ? doms.length : 0)))
  if (doms) {
    for (const d of doms) {
      const k = d && !isWebmail(d) ? String(d).toLowerCase() : ''
      queue.set(k, (queue.get(k) || 0) + 1)
    }
  } else if (total) queue.set('', total)
  const orgToday = new Map() // domain -> { n, last }
  for (const k of queue.keys()) {
    if (!k || !(domainToday instanceof Map)) continue
    const st = domainToday.get(k)
    if (st) orgToday.set(k, { n: st.countToday || 0, last: st.lastSentAt || 0 })
  }

  let t = Math.max(now, lastSendAt ? lastSendAt + minGap * 1000 : now)
  if (cap.room <= 0 && cap.freesAt) t = Math.max(t, cap.freesAt)
  const todayKey = dayKey(now, tz)
  let day = todayKey
  let dayCount = cap.sentToday
  let dayIdx = sendDays
  let sentThisDay = false
  let left = total
  let firstAt = null
  let lastAt = null
  let today = 0
  const perDay = []
  let guard = 0
  const ceilWindow = sendTimes.filter((x) => Number.isFinite(x) && x > now - DAY_MS && x <= now).sort((a, b) => a - b)
  while (left > 0 && guard++ < 200000 && t < now + 400 * DAY_MS) {
    t = nextOpenAt(t, winOpts)
    const k = dayKey(t, tz)
    if (k !== day) {
      if (sentThisDay) dayIdx++
      day = k
      dayCount = 0
      sentThisDay = false
      orgToday.forEach((v) => { v.n = 0 })
    }
    if (dayCount >= rampCap(limit, dayIdx, ramp)) { t = nextDayStartAt(t, tz); continue }
    while (ceilWindow.length && ceilWindow[0] <= t - DAY_MS) ceilWindow.shift()
    if (ceilWindow.length >= ceiling) { t = ceilWindow[0] + DAY_MS; continue }
    // someone without an organisation limit first, else the organisation with the most left that may go now
    let pick = null
    let soonest = Infinity
    if ((queue.get('') || 0) > 0) pick = ''
    else {
      let best = -1
      for (const [d, n] of queue) {
        if (!d || n <= 0) continue
        const o = orgToday.get(d) || { n: 0, last: 0 }
        if (o.n >= orgMax) continue
        const at = o.last + orgGapMs
        if (at <= t) {
          if (n > best) { best = n; pick = d }
        } else if (at < soonest) soonest = at
      }
    }
    if (pick === null) { t = Number.isFinite(soonest) ? soonest : nextDayStartAt(t, tz); continue }
    queue.set(pick, queue.get(pick) - 1)
    if (pick) {
      const o = orgToday.get(pick) || { n: 0, last: 0 }
      o.n++
      o.last = t
      orgToday.set(pick, o)
    }
    if (firstAt === null) firstAt = t
    lastAt = t
    if (k === todayKey) today++
    if (!perDay.length || perDay[perDay.length - 1].day !== k) perDay.push({ day: k, n: 0 })
    perDay[perDay.length - 1].n++
    ceilWindow.push(t)
    dayCount++
    sentThisDay = true
    left--
    t += avgGap * 1000
  }

  // ── settings that hold each other back, as data (the panel words them) ──
  const warnings = []
  if (windowOn && fitPerDay < limit) warnings.push({ kind: 'hours', fit: fitPerDay, limit, spanSec: span, avgGapSec: avgGap })
  if (limit > ceiling) warnings.push({ kind: 'ceiling', ceiling, limit })
  if (ramp && limitToday < limit) warnings.push({ kind: 'ramp', limitToday, limit })
  if (!windowOn) warnings.push({ kind: 'anyHour' })
  if (doms && total > 0) {
    // name the organisations that hold the queue back: those with more contacts left than one day allows them
    const per = new Map()
    for (const d of doms) if (d && !isWebmail(d)) { const k = String(d).toLowerCase(); per.set(k, (per.get(k) || 0) + 1) }
    const crowded = [...per.values()].filter((n) => n > orgMax)
    const orgs = crowded.length || per.size
    const inOrgs = crowded.length ? crowded.reduce((x, n) => x + n, 0) : [...per.values()].reduce((x, n) => x + n, 0)
    // the hours and the daily limit would allow more today than the organisations do
    const otherwise = Math.min(total, cap.room, fitPerDay)
    const endOfToday = windowOn ? (windowState(now, win).closesAt || now) : nextDayStartAt(now, tz)
    if (orgs > 0 && today < otherwise && (firstAt === null || firstAt < endOfToday)) {
      warnings.push({ kind: 'org', today, remaining: total, inOrgs, orgs, orgMax, orgGapMin: Math.round(orgGapMs / 60000) })
    }
  }
  return {
    now,
    tz,
    limit,
    limitToday,
    sentToday: cap.sentToday,
    sent24h: cap.sent24h,
    roomToday: cap.room,
    limitedBy: cap.limitedBy,
    freesAt: cap.freesAt,
    ceiling,
    nextAt: total > 0 ? firstAt : null,
    minGapSec: minGap,
    maxGapSec: maxGap,
    avgGapSec: avgGap,
    dayDurationSec,
    fitPerDay,
    windowOn,
    remaining: total,
    today,
    finishAt: left === 0 && total > 0 ? lastAt : null,
    days: perDay.length,
    perDay,
    warnings,
  }
}

module.exports = {
  PUBLIC_WEBMAILS,
  livePlan,
  GMAIL_SAFE_24H,
  dayStartAt,
  nextDayStartAt,
  dayKey,
  nextOpenAt,
  capState,
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
