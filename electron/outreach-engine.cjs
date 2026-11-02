// ESB Studio — Outreach Autonomous Engine (electron/outreach-engine.cjs)
// Headless send loop, schedule gating, error recovery, circuit breaker, and inbox sync (§1.5, §4.5, §4.6).

const {
  windowState,
  rampCap,
  domainOf,
  isWebmail,
  pickNext,
  planSchedule,
  capState,
  livePlan,
  dayKey,
  nextDayStartAt,
  nextOpenAt,
  GMAIL_SAFE_24H,
} = require('./outreach-schedule.cjs')
const { classifySendError } = require('./outreach-errors.cjs')

const DAY_MS = 24 * 3600 * 1000

function createEngine(deps = {}) {
  const clock = deps.clock || (() => Date.now())
  const setTimer = deps.setTimer || setTimeout
  const clearTimer = deps.clearTimer || clearTimeout
  const events = deps.events // event log
  const jobs = deps.jobs // job store
  const settingsMgr = deps.settings // settings provider: get(), save(), etc.
  const mailer = deps.mailer || { send: async () => ({ ok: false, error: 'No mailer' }), status: () => ({}) }
  const inbox = deps.inbox || { check: async () => ({ ok: false }) }
  const isOnlineFn = deps.online || (async () => true)
  const rnd = deps.rnd || Math.random
  const emit = deps.emit || (() => {}) // push event / progress to window
  const env = deps.env || process.env

  const dryRun = env.ESB_OUTREACH_DRYRUN === '1'
  const speed = Number(env.ESB_OUTREACH_SPEED) || 1
  const noWindow = env.ESB_OUTREACH_NO_WINDOW === '1'
  const failRate = Number(env.ESB_OUTREACH_FAIL) || 0

  let activeTimer = null
  let inboxTimer = null
  let isRunning = false
  let lastSendAt = 0

  // Recent attempts for circuit breaker: array of { success: boolean, kind?: string }
  const recentAttempts = []
  let consecutiveFailures = 0

  // Domain tracking: domain -> { countToday: number, lastSentAt: number, resetAt: number }
  // countToday is per CALENDAR day in the sending time zone (resetAt = the next local midnight); lastSentAt survives
  // midnight, so the spacing between two emails to one organisation still holds across it.
  const domainStats = new Map()

  function getSettings() {
    return settingsMgr && typeof settingsMgr.get === 'function'
      ? settingsMgr.get()
      : {
          window: { enabled: !noWindow, from: '09:00', to: '17:00', days: [0, 1, 2, 3, 4], tz: 'Asia/Dhaka' },
          dailyLimit: 100,
          ramp: true,
          pace: 'manual',
          minDelaySec: 180,
          maxDelaySec: 480,
          domainMaxPerDay: 3,
          domainMinGapSec: 20 * 60,
          contactCooldownDays: 30,
          autoResume: true,
        }
  }

  function getEffectiveWindow(cfg) {
    if (noWindow) {
      return { enabled: false }
    }
    return cfg.window || { enabled: true, from: '09:00', to: '17:00', days: [0, 1, 2, 3, 4], tz: 'Asia/Dhaka' }
  }

  // The time zone every "day" is counted in: the sending hours' zone, also when the hours are switched off.
  function tzOf(cfg) {
    return (cfg && cfg.window && cfg.window.tz) || 'Asia/Dhaka'
  }

  // Times of the sends that count toward the limits (real ones, or all in a dry run) in the last 24 h. The calendar
  // day always lies inside it, so one read answers both the daily limit and the 24 h safety ceiling.
  function recentSendTimes(now) {
    if (!events || typeof events.read !== 'function') return []
    const res = events.read({ types: ['send.ok'], from: now - DAY_MS, limit: 100000, includeDry: dryRun })
    return (res.events || []).map((e) => e.t).filter((t) => Number.isFinite(t) && t <= now)
  }

  // The daily limit (calendar day, warm-up applied) and the 24 h ceiling, by the one rule in outreach-schedule.cjs
  function capNow(cfg, now) {
    const tz = tzOf(cfg)
    const limit = rampCap(cfg.dailyLimit || 100, countSendDays(tz), cfg.ramp !== false)
    const st = capState({ sendTimes: recentSendTimes(now), now, tz, dailyLimit: limit, ceiling24h: cfg.gmailCeiling24h || GMAIL_SAFE_24H })
    return { ...st, limit, tz }
  }

  let sendDayCache = { sig: '', days: new Set() }
  // Distinct sending days (local calendar days in the sending time zone — they were UTC days) for the warm-up
  function countSendDays(tz = 'Asia/Dhaka') {
    if (!events || typeof events.read !== 'function') return 1
    const res = events.read({ types: ['send.ok', 'legacy.sent'], limit: 5000, includeDry: dryRun })
    // the same sends give the same days: remembered until a send is added (or the zone changes)
    const sig = `${tz}|${res.events.length}|${res.events.length ? res.events[0].t : 0}`
    let days = sendDayCache.sig === sig ? sendDayCache.days : null
    if (!days) {
      days = new Set()
      for (const e of res.events) days.add(dayKey(e.t, tz))
      sendDayCache = { sig, days }
    }
    // today is a sending day even before its first send (day 1 on the first day, day 2 the next morning)
    return days.size + (days.has(dayKey(clock(), tz)) ? 0 : 1)
  }

  // Cooldown check: has this address received any first letter in the last N days?
  function isUnderCooldown(email, days) {
    if (!events || typeof events.read !== 'function') return false
    const cutoff = clock() - Math.max(7, days) * DAY_MS
    const res = events.read({ types: ['send.ok'], email, limit: 10, includeDry: dryRun })
    return res.events.some((e) => e.run !== 'followup' && e.t >= cutoff)
  }

  // Did another PC already send this campaign's letter to this address? (merged from the shared ledger as send.ok
  // events marked remote — see esb:outreach-mark-sent)
  function sentElsewhere(email, campaignId, kind) {
    if (!events || typeof events.read !== 'function') return false
    const res = events.read({ types: ['send.ok'], email, limit: 50, includeDry: true })
    return res.events.some((e) => e.remote && e.campaignId === campaignId && (kind === 'followup' ? e.run === 'followup' : e.run !== 'followup'))
  }

  // a new local day clears each organisation's count; an entry is forgotten once its last send is a day old
  function cleanDomainStats(now, tz) {
    for (const [dom, st] of domainStats.entries()) {
      if (now >= st.resetAt) {
        if (now - (st.lastSentAt || 0) >= DAY_MS) domainStats.delete(dom)
        else domainStats.set(dom, { countToday: 0, lastSentAt: st.lastSentAt, resetAt: nextDayStartAt(now, tz) })
      }
    }
  }

  function recordDomainSend(dom, now, tz) {
    if (!dom || isWebmail(dom)) return
    cleanDomainStats(now, tz)
    const prev = domainStats.get(dom) || { countToday: 0, lastSentAt: 0, resetAt: nextDayStartAt(now, tz) }
    domainStats.set(dom, {
      countToday: prev.countToday + 1,
      lastSentAt: now,
      resetAt: prev.resetAt || nextDayStartAt(now, tz),
    })
  }

  // After a restart the per-organisation counts and the time of the last send came back empty, so every restart
  // reset the "3 a day per organisation" limit and skipped the gap before the next email. Both are rebuilt from the
  // event log (the single source of truth): every send.ok of the last 24 h — from this PC or merged from another
  // (remote), real ones only unless this is a dry run — replayed through recordDomainSend in time order, so the
  // counts (per local calendar day) and the last-send times are exactly what they were.
  function rebuildFromLog() {
    if (!events || typeof events.read !== 'function') return
    const now = clock()
    const tz = tzOf(getSettings())
    const res = events.read({ types: ['send.ok'], from: now - DAY_MS, limit: 100000, includeDry: dryRun })
    const list = (res.events || []).filter((e) => Number.isFinite(e.t) && e.t <= now).sort((a, b) => a.t - b.t)
    domainStats.clear()
    for (const e of list) {
      recordDomainSend(domainOf(e.email || ''), e.t, tz)
      if (e.t > lastSendAt) lastSendAt = e.t
    }
    cleanDomainStats(now, tz)
  }

  // the gap before the next email: a random time between the editor's "wait at least / at most". One model since
  // 2026-11-02 — "spread over the hours" ('auto') stretched the gaps to fill the day, which with a calendar-day limit
  // only delayed emails the editor wanted out; an old 'auto' setting is read as this.
  function chooseGapSec(cfg) {
    const minG = Number.isFinite(cfg.minDelaySec) && cfg.minDelaySec > 0 ? cfg.minDelaySec : 180
    const maxG = Number.isFinite(cfg.maxDelaySec) && cfg.maxDelaySec >= minG ? cfg.maxDelaySec : Math.max(minG, 480)
    return Math.round(minG + rnd() * (maxG - minG))
  }

  function pushProgress(job) {
    if (!job) return
    const sentCount = (job.state.sent && job.state.sent.length) || 0
    const failedCount = Object.keys(job.state.failed || {}).length
    emit('progress', {
      jobId: job.id,
      campaignId: job.campaignId,
      status: job.status,
      why: job.why || undefined,
      until: job.until || undefined,
      // what exactly it waits for (organisation + limit / spacing, the gap range, the hours) — the desk words it
      wait: job.wait || null,
      reason: job.reason || undefined,
      sent: sentCount,
      total: job.total,
      failed: failedCount,
      nextAt: job.until || null,
    })
  }

  function checkCircuitBreaker(outcome) {
    // outcome: { success: boolean, kind?: string }
    recentAttempts.push(outcome)
    if (recentAttempts.length > 10) {
      recentAttempts.shift()
    }

    if (outcome.success) {
      consecutiveFailures = 0
      return null
    }

    consecutiveFailures++
    if (outcome.kind === 'auth') {
      return 'auth'
    }

    if (consecutiveFailures >= 5) {
      return '5 consecutive failures'
    }

    const badKinds = recentAttempts.filter(
      (a) => !a.success && (a.kind === 'recipient_permanent' || a.kind === 'policy')
    ).length
    if (badKinds >= 3) {
      return `${badKinds} of last 10 attempts refused`
    }

    return null
  }

  // Main schedule tick
  async function tick() {
    if (!isRunning) return
    if (activeTimer) {
      clearTimer(activeTimer)
      activeTimer = null
    }

    const now = clock()
    const cfg = getSettings()
    const win = getEffectiveWindow(cfg)
    cleanDomainStats(now, tzOf(cfg))

    // 1. Pick oldest active job
    const activeJobs = jobs
      .list()
      .filter((j) => j.status === 'queued' || j.status === 'running' || j.status === 'waiting')
      .sort((a, b) => a.createdAt - b.createdAt)

    if (activeJobs.length === 0) {
      return
    }

    let job = null
    let earliestUntil = Infinity

    for (const candidate of activeJobs) {
      if (candidate.startAt && now < candidate.startAt) {
        candidate.status = 'waiting'
        candidate.why = 'schedule'
        candidate.until = candidate.startAt
        jobs.saveState(candidate)
        pushProgress(candidate)
        if (candidate.startAt < earliestUntil) earliestUntil = candidate.startAt
        continue
      }
      // a spacing-out wait ('gap') is decided by the gap check below, which honours a pacing change made in
      // Settings since the wait was announced; every other wait (window, cap, quota, offline…) holds here
      if (candidate.status === 'waiting' && candidate.why !== 'gap' && candidate.until && now < candidate.until) {
        if (candidate.until < earliestUntil) earliestUntil = candidate.until
        continue
      }
      job = candidate
      break
    }

    if (!job) {
      if (Number.isFinite(earliestUntil)) {
        const waitMs = Math.max(500, Math.round((earliestUntil - now) / speed))
        activeTimer = setTimer(tick, waitMs)
      }
      return
    }

    // Check online status
    const online = await isOnlineFn().catch(() => false)
    if (!online) {
      job.status = 'waiting'
      job.why = 'offline'
      job.until = now + 60000
      jobs.saveState(job)
      pushProgress(job)
      activeTimer = setTimer(tick, Math.max(1000, Math.round(60000 / speed)))
      return
    }

    // 2. Send window check
    const ws = windowState(now, win)
    if (!ws.open) {
      job.status = 'waiting'
      job.why = 'window'
      job.until = ws.opensAt || now + 3600 * 1000
      job.wait = { from: win.from, to: win.to, tz: win.tz }
      jobs.saveState(job)
      pushProgress(job)
      const waitMs = Math.max(1000, Math.round((job.until - now) / speed))
      activeTimer = setTimer(tick, waitMs)
      return
    }

    // 3. Daily limit (calendar day in the sending time zone) and the 24 h safety ceiling
    const cap = capNow(cfg, now)
    if (cap.room <= 0) {
      job.status = 'waiting'
      job.why = 'cap'
      // the day's limit comes back at local midnight, the ceiling when its oldest send turns 24 h old; then the
      // sending hours decide (a full day at 20:55 resumes at 09:00 tomorrow, not at 00:00)
      const resumeAt = nextOpenAt(cap.freesAt || now + 3600 * 1000, win)
      job.until = resumeAt
      job.wait = {
        kind: cap.limitedBy,
        limit: cap.limit,
        sent: cap.limitedBy === 'ceiling' ? cap.sent24h : cap.sentToday,
        ceiling: cfg.gmailCeiling24h || GMAIL_SAFE_24H,
        ramp: cfg.ramp !== false && cap.limit < (cfg.dailyLimit || 100),
        resetAt: cap.freesAt,
        resumeAt,
        hours: resumeAt > (cap.freesAt || 0) && win.enabled !== false ? { from: win.from, to: win.to } : null,
        tz: cap.tz,
      }
      jobs.saveState(job)
      pushProgress(job)
      activeTimer = setTimer(tick, Math.max(1000, Math.round((job.until - now) / speed)))
      return
    }

    // 4. Gap check
    const requiredGapSec = chooseGapSec(cfg)
    const gapWait = { pace: 'manual', minSec: cfg.minDelaySec, maxSec: cfg.maxDelaySec }

    const elapsedSinceLastSendMs = now - lastSendAt
    const effectiveGapMs = Math.round((requiredGapSec * 1000) / speed)
    const gapKey = `${cfg.minDelaySec}|${cfg.maxDelaySec}`
    if (job.why === 'gap' && job.until && job.gapKey === gapKey) {
      // the gap after the last send was chosen once, when that send finished (step 8), and announced as job.until —
      // wait it out exactly, never re-roll it (a re-roll made the countdown jump or vanish). A pacing change in
      // Settings (different gapKey) falls through to the ordinary check below, so it applies from the next send.
      if (now < job.until) {
        job.status = 'waiting'
        activeTimer = setTimer(tick, Math.max(50, Math.round(job.until - now)))
        return
      }
    } else if (lastSendAt > 0 && elapsedSinceLastSendMs < effectiveGapMs) {
      job.status = 'waiting'
      job.why = 'gap'
      job.until = lastSendAt + effectiveGapMs
      job.wait = { ...gapWait, gapSec: requiredGapSec }
      jobs.saveState(job)
      pushProgress(job)
      const waitMs = Math.max(50, Math.round(job.until - now))
      activeTimer = setTimer(tick, waitMs)
      return
    }

    // 5. Pick next message
    cleanDomainStats(now, tzOf(cfg))
    const msgs = jobs.messages(job.id)
    const sentIndexes = new Set(job.state.sent || [])
    const heldIndexes = new Set(job.state.held || [])

    const effectiveDomainGapSec = Math.max(1, Math.round((cfg.domainMinGapSec ?? 20 * 60) / speed))
    const pick = pickNext(msgs, sentIndexes, now, domainStats, {
      domainMaxPerDay: cfg.domainMaxPerDay ?? 3,
      domainMinGapSec: effectiveDomainGapSec,
      heldSet: heldIndexes,
    })

    if (!pick) {
      // Check if there are un-sent messages
      const remainingUnsent = msgs.length - sentIndexes.size
      if (remainingUnsent > 0) {
        if (heldIndexes.size > 0 && remainingUnsent === heldIndexes.size) {
          job.status = 'waiting'
          job.why = 'held'
          job.until = null
          jobs.saveState(job)
          pushProgress(job)
          return
        }
        // Messages remain queued (e.g. waiting for domain reset or retry)
        job.status = 'waiting'
        job.why = 'domain'
        job.until = now + 60000
        job.wait = null
        jobs.saveState(job)
        pushProgress(job)
        activeTimer = setTimer(tick, Math.max(1000, Math.round(60000 / speed)))
        return
      }

      // All done!
      job.status = 'done'
      job.why = null
      job.until = null
      job.endedAt = now
      jobs.saveState(job, { force: true })
      events.append({
        type: 'job.done',
        jobId: job.id,
        campaignId: job.campaignId,
        sent: job.state.sent.length,
        failed: Object.keys(job.state.failed || {}).length,
        skipped: Object.keys(job.state.skipped || {}).length,
        dry: job.dry,
      })
      pushProgress(job)

      // Tick for next job
      activeTimer = setTimer(tick, 500)
      return
    }

    if (pick.waiting === 'domain') {
      job.status = 'waiting'
      job.why = 'domain'
      job.until = pick.earliestAt
      job.wait = {
        domain: pick.domain || null,
        kind: pick.kind || null,
        count: pick.count ?? null,
        max: cfg.domainMaxPerDay ?? 3,
        gapSec: cfg.domainMinGapSec ?? 20 * 60,
      }
      jobs.saveState(job)
      pushProgress(job)
      const waitMs = Math.max(1000, Math.round((pick.earliestAt - now) / speed))
      activeTimer = setTimer(tick, waitMs)
      return
    }

    const { index: msgIdx, email, domain } = pick
    const msg = msgs[msgIdx]

    // Check suppression
    const supp = events.suppression()
    if (supp.has(email)) {
      job.state.skipped[msgIdx] = 'suppressed'
      job.state.sent.push(msgIdx)
      jobs.saveState(job)
      events.append({
        type: 'send.skip',
        jobId: job.id,
        campaignId: job.campaignId,
        email,
        run: job.kind,
        reason: 'suppressed',
        dry: job.dry,
      })
      pushProgress(job)
      activeTimer = setTimer(tick, 100)
      return
    }

    // Sent from another PC (shared ledger): never again from here
    if (sentElsewhere(email, job.campaignId, job.kind)) {
      job.state.skipped[msgIdx] = 'elsewhere'
      job.state.sent.push(msgIdx)
      jobs.saveState(job)
      events.append({ type: 'send.skip', jobId: job.id, campaignId: job.campaignId, email, run: job.kind, reason: 'elsewhere', dry: job.dry })
      pushProgress(job)
      activeTimer = setTimer(tick, 100)
      return
    }

    // Check contact cooldown (first letters only)
    if (job.kind !== 'followup' && isUnderCooldown(email, cfg.contactCooldownDays || 30)) {
      job.state.skipped[msgIdx] = 'cooldown'
      job.state.sent.push(msgIdx)
      jobs.saveState(job)
      events.append({
        type: 'send.skip',
        jobId: job.id,
        campaignId: job.campaignId,
        email,
        run: job.kind,
        reason: 'cooldown',
        dry: job.dry,
      })
      pushProgress(job)
      activeTimer = setTimer(tick, 100)
      return
    }

    // 6. Execute Send
    job.status = 'running'
    job.why = null
    job.until = null
    job.wait = null
    if (!job.startedAt) job.startedAt = now
    jobs.saveState(job)
    pushProgress(job)

    const tStart = clock()
    let sendResult = null

    if (job.dry || dryRun) {
      // Dry-run simulated send
      await new Promise((r) => setTimeout(r, Math.max(1, Math.round((50 + rnd() * 150) / speed))))
      if (failRate > 0 && rnd() < failRate) {
        sendResult = { ok: false, error: '550 5.1.1 User unknown', kind: 'recipient_permanent' }
      } else {
        sendResult = { ok: true, messageId: `<dry-${clock()}-${msgIdx}>` }
      }
    } else {
      // Real send through mailer
      try {
        const fullPayload = {
          to: email,
          subject: msg.subject,
          body: msg.body,
          optOut: msg.optOut,
          ...job.shared,
          // labels the tracking links (…&c=id); the mailer validates it
          campaignId: job.campaignId,
          // a designed letter's per-recipient words ({name}, …); the page itself is in job.shared.design
          ...(msg.vars ? { vars: msg.vars } : {}),
          attachments: job.attachments,
          followUp: job.kind === 'followup',
        }
        sendResult = await mailer.send(fullPayload)
      } catch (err) {
        sendResult = { ok: false, error: err.message || String(err) }
      }
    }

    const tEnd = clock()
    const ms = Math.max(1, tEnd - tStart)
    lastSendAt = tEnd

    // 7. Handle Result
    if (sendResult.ok) {
      recordDomainSend(domain, tEnd, tzOf(cfg))
      checkCircuitBreaker({ success: true })

      events.append({
        type: 'send.ok',
        jobId: job.id,
        campaignId: job.campaignId,
        email,
        run: job.kind,
        name: msg.name,
        org: msg.org,
        key: msg.key,
        messageId: sendResult.messageId,
        // the tracking key the mailer put in this letter (null when the site's tracking was not live)
        ...(sendResult.messageKey ? { messageKey: sendResult.messageKey } : {}),
        ms,
        attempt: (job.state.failed[msgIdx]?.attempts || 0) + 1,
        dry: job.dry || dryRun,
      })

      job.state.sent.push(msgIdx)
      delete job.state.failed[msgIdx]
      jobs.saveState(job)
      pushProgress(job)
    } else if (sendResult.duplicate) {
      // the mailer's own ledger refused a repeat (sent within 7 days, perhaps from another PC): a skip, not a failure
      job.state.skipped[msgIdx] = 'already-sent'
      job.state.sent.push(msgIdx)
      delete job.state.failed[msgIdx]
      jobs.saveState(job)
      events.append({ type: 'send.skip', jobId: job.id, campaignId: job.campaignId, email, run: job.kind, reason: 'already-sent', detail: String(sendResult.error || '').slice(0, 200), dry: job.dry || dryRun })
      pushProgress(job)
    } else {
      const errInfo = classifySendError(sendResult)
      const prevAttempt = job.state.failed[msgIdx] || { attempts: 0 }
      const attemptNum = prevAttempt.attempts + 1

      if (errInfo.kind === 'auth') {
        job.status = 'paused'
        job.reason = 'auth'
        jobs.saveState(job, { force: true })
        events.append({
          type: 'job.paused',
          jobId: job.id,
          campaignId: job.campaignId,
          reason: 'auth',
          by: 'system',
          dry: job.dry || dryRun,
        })
        pushProgress(job)
        return
      }

      if (errInfo.kind === 'quota') {
        job.status = 'waiting'
        job.why = 'quota'
        job.until = now + 6 * 3600 * 1000
        jobs.saveState(job, { force: true })
        events.append({
          type: 'job.waiting',
          jobId: job.id,
          campaignId: job.campaignId,
          why: 'quota',
          until: job.until,
          dry: job.dry || dryRun,
        })
        pushProgress(job)
        const waitMs = Math.max(1000, Math.round(6 * 3600 * 1000 / speed))
        activeTimer = setTimer(tick, waitMs)
        return
      }

      if (errInfo.kind === 'network') {
        job.status = 'waiting'
        job.why = 'offline'
        job.until = now + 60000
        jobs.saveState(job, { force: true })
        pushProgress(job)
        const waitMs = Math.max(1000, Math.round(60000 / speed))
        activeTimer = setTimer(tick, waitMs)
        return
      }

      if (errInfo.kind === 'content_all') {
        job.status = 'paused'
        job.reason = 'content'
        jobs.saveState(job, { force: true })
        events.append({
          type: 'job.paused',
          jobId: job.id,
          campaignId: job.campaignId,
          reason: 'content',
          by: 'system',
          dry: job.dry || dryRun,
        })
        pushProgress(job)
        return
      }

      const trip = checkCircuitBreaker({ success: false, kind: errInfo.kind })
      if (trip) {
        job.status = 'paused'
        job.reason = 'circuit'
        jobs.saveState(job, { force: true })
        events.append({
          type: 'job.paused',
          jobId: job.id,
          campaignId: job.campaignId,
          reason: 'circuit',
          by: 'system',
          detail: trip,
          dry: job.dry || dryRun,
        })
        pushProgress(job)
        return
      }

      if (errInfo.kind === 'recipient_permanent' || errInfo.kind === 'policy' || attemptNum >= 3) {
        // Terminal failure
        job.state.failed[msgIdx] = { attempts: attemptNum, kind: errInfo.kind, error: errInfo.text }
        job.state.sent.push(msgIdx) // remove from pending queue
        jobs.saveState(job)
        events.append({
          type: 'send.fail',
          jobId: job.id,
          campaignId: job.campaignId,
          email,
          run: job.kind,
          kind: errInfo.kind,
          code: errInfo.code,
          error: errInfo.text,
          attempt: attemptNum,
          dry: job.dry || dryRun,
        })
        pushProgress(job)
      } else {
        // Retryable (5m -> 30m -> 3h)
        const backoffMs = attemptNum === 1 ? 5 * 60 * 1000 : attemptNum === 2 ? 30 * 60 * 1000 : 3 * 3600 * 1000
        job.state.failed[msgIdx] = {
          attempts: attemptNum,
          kind: errInfo.kind,
          error: errInfo.text,
          nextAt: now + backoffMs,
        }
        jobs.saveState(job)
        events.append({
          type: 'send.retry',
          jobId: job.id,
          campaignId: job.campaignId,
          email,
          run: job.kind,
          kind: errInfo.kind,
          code: errInfo.code,
          error: errInfo.text,
          attempt: attemptNum,
          nextAt: now + backoffMs,
          dry: job.dry || dryRun,
        })
        pushProgress(job)
      }
    }

    // 8. Schedule next tick — and say when: the desk's "Next in m:ss" countdown reads job.until
    const nextWaitMs = Math.max(100, Math.round((requiredGapSec * 1000) / speed))
    if (job.status === 'running') {
      job.status = 'waiting'
      job.why = 'gap'
      job.until = clock() + nextWaitMs
      job.wait = { ...gapWait, gapSec: requiredGapSec }
      job.gapKey = `${cfg.minDelaySec}|${cfg.maxDelaySec}`
      jobs.saveState(job)
      pushProgress(job)
    }
    activeTimer = setTimer(tick, nextWaitMs)
  }

  // Periodic Inbox check loop (every 15 min while sending or active in last 7 days)
  async function pollInbox() {
    try {
      const res = await inbox.check()
      if (res && res.ok && events) {
        events.append({
          type: 'inbox.checked',
          scanned: res.scanned || 0,
          replies: (res.replies && res.replies.length) || 0,
          bounces: (res.bounces && res.bounces.length) || 0,
          ok: true,
          dry: dryRun,
        })
        for (const rep of res.replies || []) {
          events.append({
            type: 'reply',
            email: rep.email,
            at: rep.at,
            subject: rep.subject,
            auto: rep.auto,
            unsubscribe: rep.unsubscribe,
            dry: dryRun,
          })
          if (rep.unsubscribe) {
            events.append({ type: 'optout', email: rep.email, on: true, by: 'reply', dry: dryRun })
          }
        }
        for (const bnc of res.bounces || []) {
          events.append({ type: 'bounce', email: bnc.email, at: bnc.at, reason: bnc.reason, dry: dryRun })
        }
        // the renderer reads payload.result (engineClient.ts); spreading res made every field top-level and it was lost
        emit('inbox', { result: res })
      }
    } catch {}
  }

  function start() {
    if (isRunning) return
    isRunning = true
    events.append({ type: 'engine.start', clean: true, dry: dryRun })
    rebuildFromLog()

    // Load jobs & reconcile with newer events
    jobs.load()
    const activeList = jobs.list()
    for (const j of activeList) {
      // Reconcile job sent/failed state from events
      if (events && typeof events.read === 'function') {
        const evRes = events.read({ jobId: j.id, limit: 100000, includeDry: true })
        if (evRes && evRes.events) {
          const sentSet = new Set(j.state.sent || [])
          const msgs = jobs.messages(j.id)
          const emailToIdx = new Map()
          for (let i = 0; i < msgs.length; i++) {
            const m = msgs[i]
            const em = (m.to || m.email || '').toLowerCase().trim()
            if (em) emailToIdx.set(em, i)
          }

          for (const ev of evRes.events) {
            const evEmail = (ev.email || '').toLowerCase().trim()
            const idx = emailToIdx.get(evEmail)
            if (idx !== undefined) {
              if (ev.type === 'send.ok') {
                sentSet.add(idx)
                delete j.state.failed[idx]
              } else if (
                ev.type === 'send.fail' &&
                (ev.kind === 'recipient_permanent' || ev.kind === 'policy' || ev.attempt >= 3)
              ) {
                sentSet.add(idx)
                j.state.failed[idx] = { attempts: ev.attempt || 1, kind: ev.kind, error: ev.error }
              } else if (ev.type === 'send.skip') {
                sentSet.add(idx)
                j.state.skipped[idx] = ev.reason
              }
            }
          }
          j.state.sent = [...sentSet]
        }
      }

      if (j.status === 'running' || j.status === 'waiting') {
        if (j.autoResume !== false) {
          j.status = 'queued'
          j.why = null
          j.until = null
        } else {
          j.status = 'paused'
          j.reason = 'quit'
        }
        jobs.saveState(j, { force: true })
      }
    }

    // Start tick and inbox timer
    activeTimer = setTimer(tick, 1000)
    inboxTimer = setTimer(async function runInbox() {
      await pollInbox()
      if (isRunning) {
        inboxTimer = setTimer(runInbox, 15 * 60 * 1000)
      }
    }, 20000)
  }

  function submit(spec) {
    if (!spec || !Array.isArray(spec.messages) || spec.messages.length === 0) {
      return { ok: false, error: 'Empty or invalid job spec' }
    }

    const job = jobs.create(spec, { dry: dryRun })
    events.append({
      type: 'job.created',
      jobId: job.id,
      campaignId: job.campaignId,
      name: job.campaignName,
      kind: job.kind,
      total: job.total,
      startAt: job.startAt,
      dry: job.dry,
    })
    pushProgress(job)

    if (isRunning && (!job.startAt || clock() >= job.startAt)) {
      if (!activeTimer) {
        activeTimer = setTimer(tick, 100)
      }
    }

    return { ok: true, jobId: job.id, rejected: [] }
  }

  function control(jobId, action, arg) {
    const job = jobs.get(jobId)
    if (!job) return { ok: false, error: 'Job not found' }

    if (action === 'pause') {
      job.status = 'paused'
      job.reason = 'user'
      job.why = null
      job.until = null
      jobs.saveState(job, { force: true })
      events.append({ type: 'job.paused', jobId: job.id, campaignId: job.campaignId, reason: 'user', by: 'user', dry: job.dry })
      pushProgress(job)
      return { ok: true }
    }

    if (action === 'resume') {
      job.status = 'queued'
      job.reason = null
      job.why = null
      job.until = null
      jobs.saveState(job, { force: true })
      events.append({ type: 'job.resumed', jobId: job.id, campaignId: job.campaignId, by: 'user', dry: job.dry })
      pushProgress(job)
      if (isRunning && !activeTimer) {
        activeTimer = setTimer(tick, 100)
      }
      return { ok: true }
    }

    if (action === 'stop') {
      job.status = 'stopped'
      job.reason = 'user'
      job.why = null
      job.until = null
      job.endedAt = clock()
      jobs.saveState(job, { force: true })
      events.append({
        type: 'job.stopped',
        jobId: job.id,
        campaignId: job.campaignId,
        sent: job.state.sent.length,
        failed: Object.keys(job.state.failed || {}).length,
        skipped: Object.keys(job.state.skipped || {}).length,
        dry: job.dry,
      })
      pushProgress(job)
      return { ok: true }
    }

    if (action === 'hold' || action === 'release') {
      const idx = typeof arg === 'number' ? arg : jobs.messages(job.id).findIndex((m) => (m.to || m.email) === arg)
      if (idx >= 0) {
        const held = new Set(job.state.held || [])
        if (action === 'hold') {
          held.add(idx)
          events.append({ type: 'recipient.held', jobId: job.id, campaignId: job.campaignId, email: arg, dry: job.dry })
        } else {
          held.delete(idx)
          events.append({ type: 'recipient.released', jobId: job.id, campaignId: job.campaignId, email: arg, dry: job.dry })
          if (job.status === 'waiting' && job.why === 'held') {
            job.status = 'queued'
            job.why = null
          }
        }
        job.state.held = [...held]
        jobs.saveState(job)
        pushProgress(job)
        if (action === 'release' && isRunning && !activeTimer) {
          activeTimer = setTimer(tick, 100)
        }
        return { ok: true }
      }
      return { ok: false, error: 'Recipient not found' }
    }

    return { ok: false, error: `Unknown action: ${action}` }
  }

  function pauseAll(on = true, by = 'user') {
    for (const job of jobs.list()) {
      if (on) {
        if (job.status === 'running' || job.status === 'queued' || job.status === 'waiting') {
          job.status = 'paused'
          job.reason = 'all'
          job.why = null
          job.until = null
          jobs.saveState(job, { force: true })
          events.append({ type: 'job.paused', jobId: job.id, campaignId: job.campaignId, reason: 'all', by, dry: job.dry })
          pushProgress(job)
        }
      } else {
        if (job.status === 'paused') {
          job.status = 'queued'
          job.reason = null
          job.why = null
          job.until = null
          jobs.saveState(job, { force: true })
          events.append({ type: 'job.resumed', jobId: job.id, campaignId: job.campaignId, by, dry: job.dry })
          pushProgress(job)
        }
      }
    }
    if (!on && isRunning && !activeTimer) {
      activeTimer = setTimer(tick, 100)
    }
    return { ok: true }
  }

  function snapshot() {
    return jobs.list().map((j) => ({
      jobId: j.id,
      campaignId: j.campaignId,
      name: j.campaignName,
      kind: j.kind,
      status: j.status,
      why: j.why,
      until: j.until,
      wait: j.wait || null,
      reason: j.reason,
      dry: j.dry,
      total: j.total,
      sent: (j.state.sent && j.state.sent.length) || 0,
      failed: Object.keys(j.state.failed || {}).length,
      skipped: Object.keys(j.state.skipped || {}).length,
      held: (j.state.held && j.state.held.length) || 0,
      remaining: Math.max(0, j.total - ((j.state.sent && j.state.sent.length) || 0)),
      createdAt: j.createdAt,
      startedAt: j.startedAt,
      endedAt: j.endedAt,
    }))
  }

  function isActive() {
    return jobs.list().some((j) => j.status === 'running' || j.status === 'queued' || j.status === 'waiting')
  }

  // The plan for `count` emails (Review & send, the assistant) and the Sending panel's live line. `draft` = settings
  // being edited and not saved yet (already validated by the caller), so the line follows what the editor types;
  // `domains` = the organisation of each remaining email (the per-organisation limit). Same functions as tick().
  function plan(count, { draft = null, domains = null } = {}) {
    const cfg = draft || getSettings()
    const now = clock()
    const tz = tzOf(cfg)
    const sendTimes = recentSendTimes(now)
    const sendDays = countSendDays(tz)
    const cap = capNow(cfg, now)
    cleanDomainStats(now, tz)
    const base = planSchedule({ count: Math.max(0, count || 0), now, settings: cfg, sentLast24h: cap.sent24h, sentToday: cap.sentToday, sendDays })
    const live = livePlan({ now, settings: cfg, sendTimes, sendDays, lastSendAt, remaining: count || 0, domains, domainToday: domainStats })
    return { ...base, notes: [], live }
  }

  function shutdown({ clean = true } = {}) {
    isRunning = false
    if (activeTimer) {
      clearTimer(activeTimer)
      activeTimer = null
    }
    if (inboxTimer) {
      clearTimer(inboxTimer)
      inboxTimer = null
    }

    for (const job of jobs.list()) {
      if (job.status === 'running' || job.status === 'queued' || job.status === 'waiting') {
        job.status = 'paused'
        job.reason = 'quit'
        job.why = null
        job.until = null
        jobs.saveState(job, { force: true })
      }
    }

    events.append({ type: 'engine.quit', clean: !!clean, dry: dryRun })
  }

  // Autopilot settings were saved (sending hours, days, daily limit, pacing, per-organisation limits): a batch asleep
  // until the OLD window opening, the old daily-limit reset, the old gap or the old organisation spacing must re-check now, not at its stale time. Only those holds are
  // cleared — the next tick re-applies the new settings and waits again if it still may not send. Paused, stopped and
  // Gmail-quota/offline waits are untouched.
  function settingsChanged() {
    let woke = false
    for (const j of jobs.list()) {
      if (j.status === 'waiting' && (j.why === 'window' || j.why === 'cap' || j.why === 'gap' || j.why === 'domain')) {
        j.status = 'queued'
        j.why = null
        j.until = null
        j.wait = null
        j.gapKey = undefined
        jobs.saveState(j, { force: true })
        pushProgress(j)
        woke = true
      }
    }
    if (woke && isRunning) {
      if (activeTimer) clearTimer(activeTimer)
      activeTimer = setTimer(tick, 100)
    }
    return { woke }
  }

  return {
    start,
    submit,
    settingsChanged,
    control,
    pauseAll,
    snapshot,
    isActive,
    plan,
    shutdown,
    tick,
  }
}

module.exports = {
  createEngine,
}
