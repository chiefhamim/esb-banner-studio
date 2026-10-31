// ESB Studio — Outreach Autonomous Engine (electron/outreach-engine.cjs)
// Headless send loop, schedule gating, error recovery, circuit breaker, and inbox sync (§1.5, §4.5, §4.6).

const {
  windowState,
  secondsLeftInWindow,
  rampCap,
  autoGap,
  domainOf,
  isWebmail,
  pickNext,
  planSchedule,
  wallTimeToEpoch,
  planDistribution,
  DIST_TZ,
  DIST_GRACE_MS,
} = require('./outreach-schedule.cjs')
const { classifySendError } = require('./outreach-errors.cjs')

const DAY_MS = 24 * 3600 * 1000

// W3 — distribution: the words a failed job carries (the Queue shows them as written)
const DIST_INTERRUPTED = 'interrupted — check the site before scheduling again'
const DIST_MISSED = 'missed — the app was not running within 2 hours of the scheduled time'
const DIST_NO_ANSWER = 'no answer from the window — check the site before scheduling again'
const DIST_REFUSED = 'refused — the ledger shows this story already went there, or is scheduled there'
const DIST_MAX_AHEAD_MS = 60 * DAY_MS

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
  // W3 — distribution. In dry-run the renderer is told to call nothing remote. ESB_DIST_MOCKED=1 (honoured only with
  // DRYRUN) is the e2e harness saying it intercepts every renderer request: the renderer then runs its real publish and
  // post requests against those mocks, and still never uses a main-process network bridge.
  const distMocked = dryRun && env.ESB_DIST_MOCKED === '1'
  const distResultTimeoutMs = Number(deps.distResultTimeoutMs) || 10 * 60 * 1000
  let distTimer = null
  let distInFlight = null // { jobId, key, watchdog }
  let distExecutorReady = false

  let activeTimer = null
  let inboxTimer = null
  let isRunning = false
  let lastSendAt = 0

  // Recent attempts for circuit breaker: array of { success: boolean, kind?: string }
  const recentAttempts = []
  let consecutiveFailures = 0

  // Domain tracking: domain -> { countToday: number, lastSentAt: number, resetAt: number }
  const domainStats = new Map()

  function getSettings() {
    return settingsMgr && typeof settingsMgr.get === 'function'
      ? settingsMgr.get()
      : {
          window: { enabled: !noWindow, from: '09:00', to: '17:00', days: [0, 1, 2, 3, 4], tz: 'Asia/Dhaka' },
          dailyLimit: 100,
          ramp: true,
          pace: 'auto',
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

  // Count sends in rolling 24 hours
  function countSentLast24h() {
    const now = clock()
    const cutoff = now - DAY_MS
    let n = 0
    if (events && typeof events.count === 'function') {
      n = events.count((e) => e.type === 'send.ok' && e.t >= cutoff && (!dryRun ? !e.dry : true))
    }
    return n
  }

  // Count distinct calendar days with send.ok
  function countSendDays() {
    if (!events || typeof events.read !== 'function') return 1
    const res = events.read({ types: ['send.ok', 'legacy.sent'], limit: 5000, includeDry: dryRun })
    const days = new Set()
    for (const e of res.events) {
      const dStr = new Date(e.t).toISOString().slice(0, 10)
      days.add(dStr)
    }
    return Math.max(1, days.size)
  }

  // Cooldown check: has this address received any first letter in the last N days?
  function isUnderCooldown(email, days) {
    if (!events || typeof events.read !== 'function') return false
    const cutoff = clock() - Math.max(7, days) * DAY_MS
    const res = events.read({ types: ['send.ok'], email, limit: 10, includeDry: dryRun })
    return res.events.some((e) => e.run !== 'followup' && e.t >= cutoff)
  }

  function cleanDomainStats(now) {
    for (const [dom, st] of domainStats.entries()) {
      if (now >= st.resetAt) {
        domainStats.delete(dom)
      }
    }
  }

  function recordDomainSend(dom, now) {
    if (!dom || isWebmail(dom)) return
    cleanDomainStats(now)
    const prev = domainStats.get(dom) || { countToday: 0, lastSentAt: 0, resetAt: now + DAY_MS }
    domainStats.set(dom, {
      countToday: prev.countToday + 1,
      lastSentAt: now,
      resetAt: prev.resetAt || now + DAY_MS,
    })
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
    cleanDomainStats(now)
    const cfg = getSettings()
    const win = getEffectiveWindow(cfg)

    // 1. Pick oldest active job
    const activeJobs = jobs
      .list()
      .filter((j) => j.kind !== 'distribute' && (j.status === 'queued' || j.status === 'running' || j.status === 'waiting'))
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
      if (candidate.status === 'waiting' && candidate.until && now < candidate.until) {
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
      jobs.saveState(job)
      pushProgress(job)
      const waitMs = Math.max(1000, Math.round((job.until - now) / speed))
      activeTimer = setTimer(tick, waitMs)
      return
    }

    // 3. Room & quota check
    const sent24h = countSentLast24h()
    const sendDays = countSendDays()
    const effectiveCap = rampCap(cfg.dailyLimit || 100, sendDays, cfg.ramp !== false)
    const room = effectiveCap - sent24h

    if (room <= 0) {
      job.status = 'waiting'
      job.why = 'cap'
      // Oldest send in last 24h + 24h
      job.until = now + 3600 * 1000 // Retry in an hour
      jobs.saveState(job)
      pushProgress(job)
      activeTimer = setTimer(tick, Math.max(1000, Math.round(3600 * 1000 / speed)))
      return
    }

    // 4. Gap check
    const isAutoPace = cfg.pace !== 'manual'
    let requiredGapSec = 60
    if (isAutoPace) {
      const spanSec = secondsLeftInWindow(now, win)
      requiredGapSec = autoGap(spanSec, room, rnd)
    } else {
      const minG = cfg.minDelaySec || 180
      const maxG = cfg.maxDelaySec || 480
      requiredGapSec = Math.round(minG + rnd() * (maxG - minG))
    }

    const elapsedSinceLastSendMs = now - lastSendAt
    const effectiveGapMs = Math.round((requiredGapSec * 1000) / speed)
    if (lastSendAt > 0 && elapsedSinceLastSendMs < effectiveGapMs) {
      job.status = 'waiting'
      job.why = 'gap'
      job.until = lastSendAt + effectiveGapMs
      jobs.saveState(job)
      pushProgress(job)
      const waitMs = Math.max(50, Math.round(job.until - now))
      activeTimer = setTimer(tick, waitMs)
      return
    }

    // 5. Pick next message
    cleanDomainStats(now)
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
      recordDomainSend(domain, tEnd)
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
        ms,
        attempt: (job.state.failed[msgIdx]?.attempts || 0) + 1,
        dry: job.dry || dryRun,
      })

      job.state.sent.push(msgIdx)
      delete job.state.failed[msgIdx]
      jobs.saveState(job)
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

    // 8. Schedule next tick
    const nextWaitMs = Math.max(100, Math.round((requiredGapSec * 1000) / speed))
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
        emit('inbox', res)
      }
    } catch {}
  }

  // ---------------------------------------------------------------- W3 — distribution
  // A distribution job publishes one story to one destination once. The engine decides "fire now", writes
  // `distribute.fire` to the ledger BEFORE it tells the window, and accepts exactly one result for exactly that job and
  // key. The engine never fires anything twice: a job found running after a crash becomes failed (interrupted), and a
  // key with any live ledger entry (created, fired, done, failed — anything but cancelled) refuses another job.

  const isDist = (j) => !!j && j.kind === 'distribute'

  function distSnap(j) {
    return {
      jobId: j.id,
      kind: 'distribute',
      action: j.action,
      storyId: j.storyId,
      slug: j.slug || '',
      headline: j.headline || '',
      fireAt: j.fireAt,
      approved: j.approved === true,
      key: j.key,
      status: j.status,
      attempt: j.attempt || 0,
      result: j.result || null,
      dry: !!j.dry,
      createdAt: j.createdAt,
      firedAt: j.firedAt || null,
      endedAt: j.endedAt || null,
    }
  }

  function pushDist(j) {
    emit('distribute', { job: distSnap(j) })
  }

  function distLedger(type, j, extra = {}) {
    return events.append({ type, jobId: j.id, key: j.key, action: j.action, storyId: j.storyId, name: j.headline, dry: !!j.dry, ...extra })
  }

  /** Ledger entries other jobs hold on a key (dry-run entries count only in dry-run). */
  function keyHolders(key, exceptJobId) {
    const list = events && typeof events.distKeyState === 'function' ? events.distKeyState(key) : []
    return list.filter((e) => e.type !== 'distribute.cancelled' && e.jobId !== exceptJobId && (dryRun || !e.dry))
  }

  function ownLedger(j) {
    const list = events && typeof events.distKeyState === 'function' ? events.distKeyState(j.key) : []
    return list.find((e) => e.jobId === j.id) || null
  }

  function distEnd(j, ok, reason, detail) {
    const now = clock()
    j.status = ok ? 'done' : 'failed'
    j.result = { ok, reason: reason || null, detail: detail || '', at: now }
    j.endedAt = now
    jobs.saveState(j, { force: true })
    pushDist(j)
  }

  function distFail(j, reason, detail) {
    distLedger('distribute.failed', j, { reason, detail })
    distEnd(j, false, reason, detail)
  }

  function scheduleDistTick(ms) {
    if (!isRunning) return
    if (distTimer) clearTimer(distTimer)
    distTimer = setTimer(distTick, Math.max(50, Math.round(ms)))
  }

  function clearInFlight() {
    if (distInFlight && distInFlight.watchdog) clearTimer(distInFlight.watchdog)
    distInFlight = null
  }

  function distTick() {
    distTimer = null
    if (!isRunning) return
    const now = clock()
    const planned = planDistribution(jobs.list(), now, { graceMs: DIST_GRACE_MS })
    for (const j of planned.missed) distFail(j, 'missed', DIST_MISSED)
    if (distInFlight) return // the result (or the watchdog) ticks again
    if (planned.fire && distExecutorReady) {
      fireDist(planned.fire)
      return
    }
    // wall-clock waits (never divided by ESB_OUTREACH_SPEED), re-checked at least every minute against clock jumps
    if (planned.nextAt !== null) scheduleDistTick(Math.min(planned.nextAt - now, 60 * 1000))
  }

  function fireDist(j) {
    const now = clock()
    const own = ownLedger(j)
    const others = keyHolders(j.key, j.id)
    if (others.length > 0 || !own || own.type !== 'distribute.created') {
      distLedger('distribute.skip', j, { reason: others.length ? `key held by ${others[0].jobId} (${others[0].type})` : `ledger shows ${own ? own.type : 'nothing'} for this job` })
      distFail(j, 'refused', DIST_REFUSED)
      scheduleDistTick(50)
      return
    }
    j.status = 'running'
    j.attempt = (j.attempt || 0) + 1
    j.firedAt = now
    if (!j.startedAt) j.startedAt = now
    // the ledger line is written (synchronously) before anything leaves the main process
    distLedger('distribute.fire', j, { attempt: j.attempt, fireAt: j.fireAt })
    jobs.saveState(j, { force: true })
    distInFlight = { jobId: j.id, key: j.key, watchdog: setTimer(() => onDistWatchdog(j.id), distResultTimeoutMs) }
    pushDist(j)
    emit('distribute.fire', {
      jobId: j.id,
      key: j.key,
      action: j.action,
      storyId: j.storyId,
      dry: dryRun && !distMocked,
      ...(distMocked ? { mocked: true } : {}),
    })
  }

  function onDistWatchdog(jobId) {
    if (!distInFlight || distInFlight.jobId !== jobId) return
    distInFlight = null
    const j = jobs.get(jobId)
    if (isDist(j) && j.status === 'running') distFail(j, 'no-answer', DIST_NO_ANSWER)
    scheduleDistTick(50)
  }

  /** The window says it can (or no longer can) execute: firing waits for it; losing it mid-job fails that job. */
  function setDistExecutor(ready) {
    distExecutorReady = ready === true
    if (!distExecutorReady && distInFlight) {
      const j = jobs.get(distInFlight.jobId)
      clearInFlight()
      if (isDist(j) && j.status === 'running') distFail(j, 'interrupted', DIST_INTERRUPTED)
    }
    if (distExecutorReady) scheduleDistTick(50)
    return { ok: true }
  }

  /** The window's one report for the job it was told to fire. Anything else is refused and changes nothing. */
  function distributeResult(r) {
    const j = r && jobs.get(r.jobId)
    if (!isDist(j)) return { ok: false, error: 'Job not found' }
    if (j.status !== 'running' || !distInFlight || distInFlight.jobId !== j.id) return { ok: false, error: 'This job is not waiting for a result' }
    if (r.key !== j.key || r.key !== distInFlight.key) return { ok: false, error: 'The key does not match the job that was fired' }
    clearInFlight()
    const detail = typeof r.detail === 'string' ? r.detail : ''
    distLedger(r.ok === true ? 'distribute.done' : 'distribute.failed', j, { detail, ...(r.ok === true ? {} : { reason: 'error' }) })
    distEnd(j, r.ok === true, r.ok === true ? null : 'error', detail)
    scheduleDistTick(50)
    return { ok: true }
  }

  function submitDistribute(spec) {
    const now = clock()
    const fireAt = wallTimeToEpoch(spec.date, spec.time, DIST_TZ)
    if (fireAt === null) return { ok: false, error: 'That date or time is not valid.' }
    if (fireAt <= now) return { ok: false, error: 'That time has already passed in Dhaka. Pick a later time.' }
    if (fireAt > now + DIST_MAX_AHEAD_MS) return { ok: false, error: 'Schedule at most 60 days ahead.' }
    const key = `dist:${spec.storyId}:${spec.action}`
    const existing = jobs.list().find((j) => isDist(j) && j.key === key && j.status !== 'cancelled')
    if (existing) {
      const why = existing.status === 'done'
        ? 'This story already went there.'
        : existing.status === 'failed'
          ? 'The last attempt for this story there failed. Check the site, then cancel it in the Queue before scheduling again.'
          : 'This story is already scheduled there.'
      return { ok: false, error: why, jobId: existing.id }
    }
    if (keyHolders(key, null).length > 0) return { ok: false, error: 'The ledger shows this story already went there, or is scheduled there.' }
    const j = jobs.createDistribute({ ...spec, key, fireAt }, { dry: dryRun })
    distLedger('distribute.created', j, { fireAt })
    pushDist(j)
    scheduleDistTick(50)
    return { ok: true, jobId: j.id, rejected: [] }
  }

  function controlDist(j, action) {
    if (action === 'release' || action === 'hold') {
      if (j.status !== 'queued') return { ok: false, error: j.status === 'running' ? 'It is going out now.' : 'Only a scheduled job can be approved or held.' }
      const approve = action === 'release'
      if (j.approved !== approve) {
        j.approved = approve
        jobs.saveState(j, { force: true })
        distLedger(approve ? 'distribute.approved' : 'distribute.held', j, { by: 'user' })
        pushDist(j)
      }
      scheduleDistTick(50)
      return { ok: true }
    }
    if (action === 'stop') {
      if (j.status !== 'queued' && j.status !== 'failed') {
        return { ok: false, error: j.status === 'running' ? 'It is going out now — wait for the result.' : j.status === 'done' ? 'It already went out.' : 'Already cancelled.' }
      }
      distLedger('distribute.cancelled', j, { by: 'user', was: j.status })
      j.status = 'cancelled'
      j.endedAt = clock()
      jobs.saveState(j, { force: true })
      pushDist(j)
      scheduleDistTick(50)
      return { ok: true }
    }
    return { ok: false, error: 'A scheduled story is approved, held or cancelled — not paused or resumed.' }
  }

  /** Relaunch: the ledger wins over a state file; nothing that may have gone out is fired again. */
  function recoverDistribution() {
    const now = clock()
    for (const j of jobs.list()) {
      if (!isDist(j)) continue
      const own = ownLedger(j)
      if (own && own.type === 'distribute.cancelled' && j.status !== 'cancelled') {
        j.status = 'cancelled'
        jobs.saveState(j, { force: true })
        continue
      }
      const firedOnDisk = own && (own.type === 'distribute.fire' || own.type === 'distribute.done' || own.type === 'distribute.failed')
      if (j.status === 'running' || (j.status === 'queued' && firedOnDisk)) {
        if (own && own.type === 'distribute.done') distEnd(j, true, null, 'recorded in the ledger before the restart')
        else if (own && own.type === 'distribute.failed') distEnd(j, false, 'error', 'recorded in the ledger before the restart')
        else distFail(j, 'interrupted', DIST_INTERRUPTED)
        continue
      }
      if (j.status === 'queued' && typeof j.fireAt === 'number' && now > j.fireAt + DIST_GRACE_MS) distFail(j, 'missed', DIST_MISSED)
    }
  }

  function distSnapshot() {
    return jobs.list().filter(isDist).sort((a, b) => a.fireAt - b.fireAt).map(distSnap)
  }

  function start() {
    if (isRunning) return
    isRunning = true
    events.append({ type: 'engine.start', clean: true, dry: dryRun })

    // Load jobs & reconcile with newer events
    jobs.load()
    const activeList = jobs.list()
    for (const j of activeList) {
      if (j.kind === 'distribute') continue // W3: recovered by recoverDistribution(), never auto-resumed
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

    recoverDistribution()

    // Start tick and inbox timer
    activeTimer = setTimer(tick, 1000)
    distTimer = setTimer(distTick, 1000)
    inboxTimer = setTimer(async function runInbox() {
      await pollInbox()
      if (isRunning) {
        inboxTimer = setTimer(runInbox, 15 * 60 * 1000)
      }
    }, 20000)
  }

  function submit(spec) {
    if (spec && spec.kind === 'distribute') return submitDistribute(spec)
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
    if (isDist(job)) return controlDist(job, action)

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
      if (isDist(job)) continue // a scheduled story is held per job (Queue → Hold), not by Pause all
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
    return jobs.list().filter((j) => !isDist(j)).map((j) => ({
      jobId: j.id,
      campaignId: j.campaignId,
      name: j.campaignName,
      kind: j.kind,
      status: j.status,
      why: j.why,
      until: j.until,
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
    return jobs.list().some((j) =>
      isDist(j)
        ? j.approved === true && (j.status === 'queued' || j.status === 'running') // W3: the window must stay alive to execute it
        : j.status === 'running' || j.status === 'queued' || j.status === 'waiting')
  }

  function plan(count) {
    const cfg = getSettings()
    return planSchedule({
      count,
      now: clock(),
      settings: cfg,
      sentLast24h: countSentLast24h(),
      sendDays: countSendDays(),
    })
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
    if (distTimer) {
      clearTimer(distTimer)
      distTimer = null
    }
    // a distribution job running at quit stays "running" on disk: the next launch marks it interrupted
    clearInFlight()

    for (const job of jobs.list()) {
      if (isDist(job)) continue
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

  return {
    start,
    submit,
    control,
    pauseAll,
    snapshot,
    isActive,
    plan,
    shutdown,
    tick,
    distributeResult,
    setDistExecutor,
    distSnapshot,
    distTick,
  }
}

module.exports = {
  createEngine,
}
