// outreach-stats.cjs
// Aggregates outreach events into high-level metrics and time-series for Activity desk (§3.1).

'use strict'

/**
 * Creates an hour-bucket key resolver for a specific timezone.
 * Caches by integer hour timestamp to aggregate 100k events in < 50ms.
 */
function createTimezoneHelper(tz = 'Asia/Dhaka') {
  let validTz = 'Asia/Dhaka'
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz })
    validTz = tz
  } catch {
    validTz = 'Asia/Dhaka'
  }

  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: validTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  })

  // Cache: bucketIndex (hour integer) -> { day: 'YYYY-MM-DD', hour: 0..23 }
  const cache = new Map()

  function getParts(ts) {
    if (typeof ts !== 'number' || isNaN(ts)) ts = 0
    const hourBucket = Math.floor(ts / 3600000)
    let cached = cache.get(hourBucket)
    if (cached) return cached

    const parts = dtf.formatToParts(new Date(ts))
    let year = '1970'
    let month = '01'
    let day = '01'
    let hour = 0

    for (const p of parts) {
      if (p.type === 'year') year = p.value
      else if (p.type === 'month') month = p.value
      else if (p.type === 'day') day = p.value
      else if (p.type === 'hour') hour = parseInt(p.value, 10) || 0
    }

    cached = {
      day: `${year}-${month}-${day}`,
      hour: hour % 24,
    }
    cache.set(hourBucket, cached)
    return cached
  }

  return { getParts, tz: validTz }
}

/**
 * Computes all Activity Desk statistics from raw events and active jobs (§3.1).
 */
function computeStats(events = [], jobs = [], options = {}) {
  const from = typeof options.from === 'number' ? options.from : 0
  const to = typeof options.to === 'number' ? options.to : Date.now()
  const jobId = options.jobId
  const campaignId = options.campaignId
  const includeDry = options.includeDry === true
  const tz = options.tz || 'Asia/Dhaka'
  const settings = options.settings || {}

  const tzHelper = createTimezoneHelper(tz)
  const todayDateStr = tzHelper.getParts(to).day

  const totals = {
    sent: 0,
    failed: 0,
    rejected: 0,
    skipped: 0,
    bounced: 0,
    replied: 0,
    optedOut: 0,
    retries: 0,
    // unique addresses (an inbox check used to re-log the same reply/bounce every time; a retried address fails per attempt)
    failedUnique: 0,
  }
  const seenBounce = new Set()
  const seenReply = new Set()
  const seenFail = new Set()
  const keyOfEmail = (e) => String(e || '').toLowerCase().trim()

  const byHour = Array.from({ length: 24 }, (_, h) => ({ h, sent: 0, failed: 0 }))
  const today = Array.from({ length: 24 }, (_, h) => ({ t: h, sent: 0, failed: 0 }))
  const byDayMap = new Map()

  const sendMsList = []
  // Map of `${jobId}_${day}` -> array of timestamp `t` for average gap calculation
  const gapMap = new Map()
  // Map of normalized email -> last send.ok timestamp `t` for reply median calculation
  const emailSendTimes = new Map()
  const replyDiffs = []

  let firstSendAt = null
  let lastSendAt = null

  // Active time tracking: job status transitions from events
  // job.started, job.resumed -> job.waiting, job.paused, job.done, job.stopped
  const jobRunningRanges = []
  const activeStarts = new Map() // jobId -> start timestamp

  // Filter events within range and matching criteria
  for (const ev of events) {
    if (!ev || typeof ev.t !== 'number') continue
    if (ev.t < from || ev.t > to) continue
    if (!includeDry && ev.dry) continue
    if (jobId && ev.jobId !== jobId) continue
    if (campaignId && ev.campaignId !== campaignId) continue

    const parts = tzHelper.getParts(ev.t)
    const h = parts.hour
    const dStr = parts.day

    if (!byDayMap.has(dStr)) {
      byDayMap.set(dStr, { day: dStr, sent: 0, failed: 0, bounced: 0, replied: 0 })
    }
    const dayEntry = byDayMap.get(dStr)

    // Job state transitions for active time calculation
    if (ev.type === 'job.started' || ev.type === 'job.resumed') {
      activeStarts.set(ev.jobId || 'default', ev.t)
    } else if (['job.waiting', 'job.paused', 'job.done', 'job.stopped'].includes(ev.type)) {
      const jId = ev.jobId || 'default'
      if (activeStarts.has(jId)) {
        const startT = activeStarts.get(jId)
        activeStarts.delete(jId)
        if (ev.t >= startT) {
          jobRunningRanges.push({ start: startT, end: ev.t })
        }
      }
    }

    if (ev.type === 'send.ok') {
      totals.sent++
      byHour[h].sent++
      dayEntry.sent++
      if (dStr === todayDateStr) {
        today[h].sent++
      }

      if (typeof ev.ms === 'number' && ev.ms > 0) {
        sendMsList.push(ev.ms)
      }

      const jId = ev.jobId || 'default'
      const gapKey = `${jId}_${dStr}`
      if (!gapMap.has(gapKey)) gapMap.set(gapKey, [])
      gapMap.get(gapKey).push(ev.t)

      if (ev.email) {
        const em = String(ev.email).toLowerCase().trim()
        emailSendTimes.set(em, ev.t)
      }

      if (firstSendAt === null || ev.t < firstSendAt) firstSendAt = ev.t
      if (lastSendAt === null || ev.t > lastSendAt) lastSendAt = ev.t
    } else if (ev.type === 'send.fail') {
      totals.failed++
      const fk = keyOfEmail(ev.email)
      if (!fk || !seenFail.has(fk)) { if (fk) seenFail.add(fk); totals.failedUnique++ }
      byHour[h].failed++
      dayEntry.failed++
      if (dStr === todayDateStr) {
        today[h].failed++
      }
    } else if (ev.type === 'send.retry') {
      totals.retries++
    } else if (ev.type === 'send.skip') {
      totals.skipped++
    } else if (ev.type === 'send.reject') {
      totals.rejected++
    } else if (ev.type === 'bounce') {
      // one per address: a bounce re-read on a later inbox check is the same bounce
      const bk = keyOfEmail(ev.email)
      if (bk && seenBounce.has(bk)) continue
      if (bk) seenBounce.add(bk)
      totals.bounced++
      dayEntry.bounced++
    } else if (ev.type === 'reply') {
      // Definition: Replied = reply with auto: false (non-automated replies), one per address
      const rk = keyOfEmail(ev.email)
      if (ev.auto !== true && !(rk && seenReply.has(rk))) {
        if (rk) seenReply.add(rk)
        totals.replied++
        dayEntry.replied++
        if (ev.email) {
          const em = String(ev.email).toLowerCase().trim()
          if (emailSendTimes.has(em)) {
            const sendT = emailSendTimes.get(em)
            if (ev.t >= sendT) {
              replyDiffs.push(ev.t - sendT)
            }
          }
        }
      }
    } else if (ev.type === 'optout') {
      if (ev.on !== false) totals.optedOut++
    }
  }

  // Close any ongoing active intervals with min(now, to)
  for (const [jId, startT] of activeStarts.entries()) {
    const endT = Math.min(Date.now(), to)
    if (endT >= startT) {
      jobRunningRanges.push({ start: startT, end: endT })
    }
  }

  // Active time calculation
  let activeMs = 0
  if (jobRunningRanges.length > 0) {
    // Merge overlapping running intervals
    jobRunningRanges.sort((a, b) => a.start - b.start)
    let cur = { ...jobRunningRanges[0] }
    for (let i = 1; i < jobRunningRanges.length; i++) {
      const next = jobRunningRanges[i]
      if (next.start <= cur.end) {
        cur.end = Math.max(cur.end, next.end)
      } else {
        activeMs += Math.max(0, cur.end - cur.start)
        cur = { ...next }
      }
    }
    activeMs += Math.max(0, cur.end - cur.start)
  }

  // Durations: avgSendMs & p95SendMs
  sendMsList.sort((a, b) => a - b)
  const avgSendMs = sendMsList.length ? Math.round(sendMsList.reduce((a, b) => a + b, 0) / sendMsList.length) : 0
  const p95Idx = Math.floor(sendMsList.length * 0.95)
  const p95SendMs = sendMsList.length ? sendMsList[p95Idx] : 0

  // Average gap between consecutive send.ok inside same job and same day
  let sumGapsSec = 0
  let gapCount = 0
  for (const times of gapMap.values()) {
    if (times.length >= 2) {
      times.sort((a, b) => a - b)
      for (let i = 1; i < times.length; i++) {
        sumGapsSec += (times[i] - times[i - 1]) / 1000
        gapCount++
      }
    }
  }
  const avgGapSec = gapCount > 0 ? Math.round(sumGapsSec / gapCount) : 0

  const elapsedMs = Math.max(0, to - from)
  // If activeMs is 0 but we have sends, fall back to estimated active time
  if (activeMs === 0 && totals.sent > 0) {
    activeMs = totals.sent * (avgSendMs + avgGapSec * 1000)
  }
  const activeHours = activeMs / 3600000
  const perActiveHour = activeHours > 0 ? Math.round(totals.sent / activeHours) : totals.sent

  // Median time to reply
  let replyMedianMs = null
  if (replyDiffs.length > 0) {
    replyDiffs.sort((a, b) => a - b)
    const mid = Math.floor(replyDiffs.length / 2)
    if (replyDiffs.length % 2 === 1) {
      replyMedianMs = replyDiffs[mid]
    } else {
      replyMedianMs = Math.round((replyDiffs[mid - 1] + replyDiffs[mid]) / 2)
    }
  }

  const byDay = [...byDayMap.values()].sort((a, b) => a.day.localeCompare(b.day))

  return {
    totals,
    byHour,
    byDay,
    today,
    window: settings.window || options.window || null,
    cap: settings.dailyLimit || options.cap || 100,
    durations: {
      avgSendMs,
      p95SendMs,
      avgGapSec,
      activeMs,
      elapsedMs,
      perActiveHour,
    },
    replyMedianMs,
    firstSendAt,
    lastSendAt,
    jobs: Array.isArray(jobs) ? jobs : [],
  }
}

module.exports = {
  createTimezoneHelper,
  computeStats,
}
