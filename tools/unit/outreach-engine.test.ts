import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { createEventLog } = require('../../electron/outreach-events.cjs')
const { createJobStore } = require('../../electron/outreach-jobs.cjs')
const { createEngine } = require('../../electron/outreach-engine.cjs')

describe('outreach-engine: headless send loop, error recovery & lifecycle (§1.5, §4.5, §4.6, §6)', () => {
  let tmpDir: string
  let now: number
  let timerId = 0
  let timers: Map<number, { fn: () => void; runAt: number }>

  function fakeClock() {
    return now
  }

  function fakeSetTimer(fn: () => void, ms: number) {
    const id = ++timerId
    timers.set(id, { fn, runAt: now + ms })
    return id
  }

  function fakeClearTimer(id: number) {
    timers.delete(id)
  }

  async function advanceTime(ms: number) {
    now += ms
    const ready = [...timers.entries()]
      .filter(([_, t]) => t.runAt <= now)
      .sort((a, b) => a[1].runAt - b[1].runAt)

    for (const [id, t] of ready) {
      if (timers.has(id)) {
        timers.delete(id)
        await t.fn()
      }
    }
  }

  // Base timestamp: Sunday 2026-11-01 10:00:00 Asia/Dhaka (10:00 is within 09:00-17:00 window, Sunday is day 0)
  // UTC: 2026-11-01 04:00:00 Z
  const BASE_TIME = Date.UTC(2026, 10, 1, 4, 0, 0)

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outreach-engine-test-'))
    now = BASE_TIME
    timerId = 0
    timers = new Map()
  })

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {}
  })

  function createTestHarness(overrides: Record<string, any> = {}) {
    const events = createEventLog({ dir: tmpDir, clock: fakeClock })
    const jobs = createJobStore({ dir: tmpDir, clock: fakeClock })
    let currentSettings = {
      window: { enabled: true, from: '09:00', to: '17:00', days: [0, 1, 2, 3, 4], tz: 'Asia/Dhaka' },
      dailyLimit: 100,
      ramp: true,
      pace: 'manual',
      minDelaySec: 1,
      maxDelaySec: 1,
      domainMaxPerDay: 3,
      domainMinGapSec: 1,
      contactCooldownDays: 30,
      autoResume: true,
      ...overrides.settings,
    }

    const settings = {
      get: () => currentSettings,
      set: (s: any) => {
        currentSettings = { ...currentSettings, ...s }
      },
    }

    const sentMails: any[] = []
    const mailer = {
      send: async (payload: any) => {
        sentMails.push(payload)
        if (overrides.sendError) {
          return typeof overrides.sendError === 'function' ? overrides.sendError(payload) : overrides.sendError
        }
        return { ok: true, messageId: `<msg-${sentMails.length}@example.com>` }
      },
      status: () => ({ hasTransport: true }),
    }

    const emitted: { channel: string; data: any }[] = []
    const emit = (channel: string, data: any) => {
      emitted.push({ channel, data })
    }

    let isOnline = overrides.isOnline !== undefined ? overrides.isOnline : true
    const onlineFn = async () => isOnline

    const engine = createEngine({
      clock: fakeClock,
      setTimer: fakeSetTimer,
      clearTimer: fakeClearTimer,
      events,
      jobs,
      settings,
      mailer,
      online: onlineFn,
      rnd: () => 0.5,
      emit,
      env: {
        ESB_OUTREACH_DRYRUN: overrides.dryRun ? '1' : '0',
        ESB_OUTREACH_SPEED: overrides.speed ? String(overrides.speed) : '1',
        ESB_OUTREACH_NO_WINDOW: overrides.noWindow ? '1' : '0',
      },
      ...overrides.deps,
    })

    return {
      events,
      jobs,
      settings,
      mailer,
      sentMails,
      emitted,
      engine,
      setOnline: (val: boolean) => {
        isOnline = val
      },
    }
  }

  // (1) sends all messages once, interleaving domains
  it('(1) sends all messages once, interleaving domains', async () => {
    const h = createTestHarness({ settings: { domainMinGapSec: 10 } })
    h.engine.start()

    const spec = {
      campaignId: 'c1',
      campaignName: 'Test C1',
      messages: [
        { to: 'alice@domainA.com', subject: 'Sub 1', body: 'Body 1' },
        { to: 'bob@domainA.com', subject: 'Sub 2', body: 'Body 2' },
        { to: 'carol@domainB.com', subject: 'Sub 3', body: 'Body 3' },
      ],
    }

    h.engine.submit(spec)

    // Tick 1: picks first available (alice@domainA)
    await h.engine.tick()
    expect(h.sentMails.length).toBe(1)
    expect(h.sentMails[0].to).toBe('alice@domainA.com')

    // Advance clock past pace gap (2s), but domainA is still within its 10s domainMinGapSec
    now += 2000

    // Tick 2: domainA is in cooldown gap, interleaves carol@domainB
    await h.engine.tick()
    expect(h.sentMails.length).toBe(2)
    expect(h.sentMails[1].to).toBe('carol@domainB.com')

    // Advance clock past domainA gap (10s)
    now += 10000

    // Tick 3: bob@domainA can now send
    await h.engine.tick()
    expect(h.sentMails.length).toBe(3)
    expect(h.sentMails[2].to).toBe('bob@domainA.com')

    // Advance clock past pace gap (2s)
    now += 2000

    // Tick 4: all done
    await h.engine.tick()
    const snap = h.engine.snapshot()
    expect(snap[0].status).toBe('done')
    expect(snap[0].sent).toBe(3)
  })

  // (2) window closed => waiting then continues when it opens
  it('(2) window closed => waiting then continues when it opens', async () => {
    // 2026-10-31 10:00:00 UTC is Saturday (day 6), window is closed
    now = Date.UTC(2026, 9, 31, 10, 0, 0)
    const h = createTestHarness()
    h.engine.start()

    h.engine.submit({
      campaignId: 'c2',
      messages: [{ to: 'test@example.com', subject: 'Hi', body: 'Hello' }],
    })

    await h.engine.tick()
    let snap = h.engine.snapshot()
    expect(snap[0].status).toBe('waiting')
    expect(snap[0].why).toBe('window')
    expect(snap[0].until).toBeGreaterThan(now)

    // Fast-forward to opensAt
    now = snap[0].until + 1000
    await h.engine.tick()
    snap = h.engine.snapshot()
    expect(snap[0].sent).toBe(1)
  })

  // (2b) sending hours widened while a batch waits for the window: it sends now, not at the old opening time
  it('(2b) new sending hours apply to a batch already waiting for the window', async () => {
    now = Date.UTC(2026, 9, 31, 10, 0, 0) // Saturday 16:00 Dhaka, outside the Sun–Thu window
    const h = createTestHarness()
    h.engine.start()
    h.engine.submit({ campaignId: 'c2b', messages: [{ to: 'test@example.com', subject: 'Hi', body: 'Hello' }] })
    await h.engine.tick()
    expect(h.engine.snapshot()[0].why).toBe('window')
    // the editor opens Saturdays too and saves; nothing else changes
    h.settings.set({ window: { enabled: true, from: '09:00', to: '17:00', days: [0, 1, 2, 3, 4, 6], tz: 'Asia/Dhaka' } })
    expect(h.engine.settingsChanged().woke).toBe(true)
    await h.engine.tick()
    expect(h.sentMails.length).toBe(1)
    // and narrowing the hours still holds a batch back (the tick re-applies the window)
    h.engine.submit({ campaignId: 'c2c', messages: [{ to: 'other@example.org', subject: 'Hi', body: 'Hello' }] })
    h.settings.set({ window: { enabled: true, from: '09:00', to: '17:00', days: [0, 1, 2, 3, 4], tz: 'Asia/Dhaka' } })
    h.engine.settingsChanged()
    now += 10 * 60 * 1000
    await h.engine.tick()
    expect(h.sentMails.length).toBe(1) // nothing went out on the now-closed Saturday
  })

  // (3) ramp day-1 cap 30
  it('(3) ramp day-1 cap 30', async () => {
    const h = createTestHarness({ settings: { ramp: true, dailyLimit: 100 } })
    h.engine.start()

    // 35 messages
    const msgs = Array.from({ length: 35 }, (_, i) => ({
      to: `user${i}@mail${i}.com`,
      subject: `Sub ${i}`,
      body: `Body ${i}`,
    }))
    h.engine.submit({ campaignId: 'c3', messages: msgs })

    for (let i = 0; i < 30; i++) {
      now += 2000
      await h.engine.tick()
    }

    expect(h.sentMails.length).toBe(30)

    // Tick 31 should hit ramp day-1 cap (30)
    now += 2000
    await h.engine.tick()
    const snap = h.engine.snapshot()
    expect(snap[0].status).toBe('waiting')
    expect(snap[0].why).toBe('cap')
    expect(h.sentMails.length).toBe(30)
  })

  // (4) gap clamp
  it('(4) gap clamp prevents sending faster than required pace gap', async () => {
    const h = createTestHarness({ settings: { pace: 'manual', minDelaySec: 10, maxDelaySec: 10 } })
    h.engine.start()

    h.engine.submit({
      campaignId: 'c4',
      messages: [
        { to: 'u1@ex1.com', subject: '1', body: '1' },
        { to: 'u2@ex2.com', subject: '2', body: '2' },
      ],
    })

    await h.engine.tick()
    expect(h.sentMails.length).toBe(1)

    // Advance only 3 seconds (< 10s gap)
    now += 3000
    await h.engine.tick()
    expect(h.sentMails.length).toBe(1)
    const snap = h.engine.snapshot()
    expect(snap[0].status).toBe('waiting')
    expect(snap[0].why).toBe('gap')

    // Advance remaining 7 seconds
    now += 7500
    await h.engine.tick()
    expect(h.sentMails.length).toBe(2)
  })

  // (5) pause finishes the in-flight send then halts, resume continues, stop cancels, pauseAll covers every job
  it('(5) pause finishes the in-flight send then halts, resume continues, stop cancels, pauseAll covers every job', async () => {
    const h = createTestHarness()
    h.engine.start()

    h.engine.submit({
      campaignId: 'c5a',
      messages: [
        { to: 'u1@ex1.com', subject: '1', body: '1' },
        { to: 'u2@ex2.com', subject: '2', body: '2' },
      ],
    })
    h.engine.submit({
      campaignId: 'c5b',
      messages: [{ to: 'u3@ex3.com', subject: '3', body: '3' }],
    })

    const jobs = h.engine.snapshot()
    const jobA = jobs[0].jobId
    const jobB = jobs[1].jobId

    // Send first
    await h.engine.tick()
    expect(h.sentMails.length).toBe(1)

    // Pause job A
    h.engine.control(jobA, 'pause')
    let snapA = h.engine.snapshot().find((j) => j.jobId === jobA)!
    expect(snapA.status).toBe('paused')
    expect(snapA.reason).toBe('user')

    // Now tick runs job B
    now += 2000
    await h.engine.tick()
    expect(h.sentMails.length).toBe(2)
    expect(h.sentMails[1].to).toBe('u3@ex3.com')

    // Resume job A
    h.engine.control(jobA, 'resume')
    snapA = h.engine.snapshot().find((j) => j.jobId === jobA)!
    expect(snapA.status).toBe('queued')

    // Stop job A
    h.engine.control(jobA, 'stop')
    snapA = h.engine.snapshot().find((j) => j.jobId === jobA)!
    expect(snapA.status).toBe('stopped')

    // pauseAll covers every job
    h.engine.pauseAll(true)
    const all = h.engine.snapshot()
    for (const j of all) {
      if (j.status !== 'stopped' && j.status !== 'done') {
        expect(j.status).toBe('paused')
      }
    }
  })

  // (6) transient error retries at 5 min / 30 min / 3 h then fails after 3
  it('(6) transient error retries at 5 min / 30 min / 3 h then fails after 3', async () => {
    let callCount = 0
    const h = createTestHarness({
      sendError: () => {
        callCount++
        return { ok: false, error: '451 4.3.0 Mailbox busy or greylisted' }
      },
    })
    h.engine.start()

    h.engine.submit({
      campaignId: 'c6',
      messages: [{ to: 'transient@example.com', subject: 'Hi', body: 'Body' }],
    })

    // Attempt 1 fails -> backoff 5 min
    await h.engine.tick()
    expect(callCount).toBe(1)
    let evs = h.events.read({ limit: 10 }).events
    let retryEv = evs.find((e) => e.type === 'send.retry')!
    expect(retryEv).toBeDefined()
    expect(retryEv.attempt).toBe(1)
    expect(retryEv.nextAt).toBe(now + 5 * 60 * 1000)

    // Attempt 2 fails -> backoff 30 min
    now += 5 * 60 * 1000 + 1000
    await h.engine.tick()
    expect(callCount).toBe(2)
    evs = h.events.read({ limit: 10 }).events
    retryEv = evs.find((e) => e.type === 'send.retry' && e.attempt === 2)!
    expect(retryEv).toBeDefined()
    expect(retryEv.nextAt).toBe(now + 30 * 60 * 1000)

    // Attempt 3 fails -> terminal failure
    now += 30 * 60 * 1000 + 1000
    await h.engine.tick()
    expect(callCount).toBe(3)
    evs = h.events.read({ limit: 10 }).events
    const failEv = evs.find((e) => e.type === 'send.fail')!
    expect(failEv).toBeDefined()
    expect(failEv.attempt).toBe(3)
  })

  // (7) permanent error is terminal, suppressed, never retried by a later job
  it('(7) permanent error is terminal, suppressed, never retried by a later job', async () => {
    const h = createTestHarness({
      sendError: { ok: false, error: '550 5.1.1 User unknown' },
    })
    h.engine.start()

    h.engine.submit({
      campaignId: 'c7a',
      messages: [{ to: 'baduser@example.com', subject: 'Hi', body: 'Hello' }],
    })

    await h.engine.tick()
    expect(h.events.suppression().has('baduser@example.com')).toBe(true)

    // Submit second job with same address
    h.engine.submit({
      campaignId: 'c7b',
      messages: [{ to: 'baduser@example.com', subject: 'Hi 2', body: 'Hello 2' }],
    })

    // Advance clock past gap: tick finishes c7a, then tick processes c7b
    now += 2000
    await h.engine.tick()
    now += 2000
    await h.engine.tick()

    const evs = h.events.read({ limit: 10 }).events
    const skipEv = evs.find((e) => e.type === 'send.skip' && e.campaignId === 'c7b')
    expect(skipEv).toBeDefined()
    expect(skipEv?.reason).toBe('suppressed')
  })

  // (8) auth error pauses the job and does not fail the recipient
  it('(8) auth error pauses the job and does not fail the recipient', async () => {
    const h = createTestHarness({
      sendError: { ok: false, error: '535 5.7.8 Username and Password not accepted', code: 'EAUTH' },
    })
    h.engine.start()

    h.engine.submit({
      campaignId: 'c8',
      messages: [{ to: 'recipient@example.com', subject: 'Hi', body: 'Hello' }],
    })

    await h.engine.tick()
    const snap = h.engine.snapshot()[0]
    expect(snap.status).toBe('paused')
    expect(snap.reason).toBe('auth')
    expect(snap.failed).toBe(0) // Recipient is NOT failed
    expect(snap.sent).toBe(0)
  })

  // (9) a "mailbox over its storage limit" error from one recipient does not pause the job
  it('(9) a "mailbox over its storage limit" error from one recipient does not pause the job', async () => {
    const h = createTestHarness({
      sendError: { ok: false, error: '552 5.2.2 Mailbox over its storage limit' },
    })
    h.engine.start()

    h.engine.submit({
      campaignId: 'c9',
      messages: [
        { to: 'fullmailbox@example.com', subject: 'Hi', body: 'Hello' },
        { to: 'normal@example.com', subject: 'Hi 2', body: 'Hello 2' },
      ],
    })

    await h.engine.tick()
    const snap = h.engine.snapshot()[0]
    // Job should NOT be paused!
    expect(snap.status).not.toBe('paused')
    const evs = h.events.read({ limit: 10 }).events
    const retryEv = evs.find((e) => e.type === 'send.retry')
    expect(retryEv).toBeDefined()
    expect(retryEv?.kind).toBe('recipient_transient')
  })

  // (10) quota => waiting 6 h
  it('(10) quota => waiting 6 h', async () => {
    const h = createTestHarness({
      sendError: { ok: false, error: '550 5.4.5 Daily user sending quota exceeded' },
    })
    h.engine.start()

    h.engine.submit({
      campaignId: 'c10',
      messages: [{ to: 'user@example.com', subject: 'Hi', body: 'Hello' }],
    })

    await h.engine.tick()
    const snap = h.engine.snapshot()[0]
    expect(snap.status).toBe('waiting')
    expect(snap.why).toBe('quota')
    expect(snap.until).toBe(now + 6 * 3600 * 1000)
    expect(snap.failed).toBe(0) // recipient not marked failed
  })

  // (11) breaker pauses at 3 refusals in 10
  it('(11) breaker pauses at 3 refusals in 10', async () => {
    let count = 0
    const h = createTestHarness({
      sendError: () => {
        count++
        if (count <= 3) {
          return { ok: false, error: '550 5.1.1 User unknown' }
        }
        return { ok: true, messageId: '<ok@ex.com>' }
      },
    })
    h.engine.start()

    h.engine.submit({
      campaignId: 'c11',
      messages: [
        { to: 'u1@ex1.com', subject: '1', body: '1' },
        { to: 'u2@ex2.com', subject: '2', body: '2' },
        { to: 'u3@ex3.com', subject: '3', body: '3' },
        { to: 'u4@ex4.com', subject: '4', body: '4' },
      ],
    })

    now += 2000
    await h.engine.tick() // refusal 1
    now += 2000
    await h.engine.tick() // refusal 2
    now += 2000
    await h.engine.tick() // refusal 3 -> trips breaker!

    const snap = h.engine.snapshot()[0]
    expect(snap.status).toBe('paused')
    expect(snap.reason).toBe('circuit')
  })

  // (12) offline => waiting, attempts not consumed, resumes when online
  it('(12) offline => waiting, attempts not consumed, resumes when online', async () => {
    const h = createTestHarness({ isOnline: false })
    h.engine.start()

    h.engine.submit({
      campaignId: 'c12',
      messages: [{ to: 'u@ex.com', subject: '1', body: '1' }],
    })

    await h.engine.tick()
    let snap = h.engine.snapshot()[0]
    expect(snap.status).toBe('waiting')
    expect(snap.why).toBe('offline')
    expect(snap.failed).toBe(0)
    expect(h.sentMails.length).toBe(0)

    // Bring online
    h.setOnline(true)
    now += 65000
    await h.engine.tick()
    snap = h.engine.snapshot()[0]
    expect(snap.sent).toBe(1)
  })

  // (13) cooldown skip
  it('(13) cooldown skip skips contacts contacted in last 30 days', async () => {
    const h = createTestHarness({ settings: { contactCooldownDays: 30 } })
    h.engine.start()

    // Record a send 5 days ago
    h.events.append({
      type: 'send.ok',
      jobId: 'prev-job',
      campaignId: 'c-prev',
      email: 'recent@example.com',
      t: now - 5 * 24 * 3600 * 1000,
    })

    h.engine.submit({
      campaignId: 'c13',
      kind: 'first',
      messages: [{ to: 'recent@example.com', subject: 'Hi', body: 'Hello' }],
    })

    await h.engine.tick()
    const snap = h.engine.snapshot()[0]
    expect(snap.skipped).toBe(1)
    const evs = h.events.read({ limit: 10 }).events
    const skipEv = evs.find((e) => e.type === 'send.skip')
    expect(skipEv?.reason).toBe('cooldown')
  })

  // (14) an optout event appended while running is honoured on the very next pick
  it('(14) an optout event appended while running is honoured on the very next pick', async () => {
    const h = createTestHarness()
    h.engine.start()

    h.engine.submit({
      campaignId: 'c14',
      messages: [
        { to: 'first@ex.com', subject: '1', body: '1' },
        { to: 'optoutme@ex.com', subject: '2', body: '2' },
      ],
    })

    await h.engine.tick()
    expect(h.sentMails.length).toBe(1)

    // User opts out
    h.events.append({ type: 'optout', email: 'optoutme@ex.com', on: true, by: 'user' })

    now += 2000
    await h.engine.tick()
    expect(h.sentMails.length).toBe(1) // Not sent!
    const evs = h.events.read({ limit: 10 }).events
    const skipEv = evs.find((e) => e.type === 'send.skip' && e.email === 'optoutme@ex.com')
    expect(skipEv?.reason).toBe('suppressed')
  })

  // (15) hold/release
  it('(15) hold/release', async () => {
    const h = createTestHarness()
    h.engine.start()

    h.engine.submit({
      campaignId: 'c15',
      messages: [
        { to: 'held@ex.com', subject: '1', body: '1' },
        { to: 'free@ex.com', subject: '2', body: '2' },
      ],
    })

    const job = h.engine.snapshot()[0]
    h.engine.control(job.jobId, 'hold', 'held@ex.com')

    // Tick picks free@ex.com instead of held
    await h.engine.tick()
    expect(h.sentMails.length).toBe(1)
    expect(h.sentMails[0].to).toBe('free@ex.com')

    // Held message remains
    now += 2000
    await h.engine.tick()
    expect(h.sentMails.length).toBe(1)

    // Release held message
    h.engine.control(job.jobId, 'release', 'held@ex.com')
    now += 2000
    await h.engine.tick()
    expect(h.sentMails.length).toBe(2)
    expect(h.sentMails[1].to).toBe('held@ex.com')
  })

  // (16) crash between send.ok and state save => a new engine on the same dir never resends
  it('(16) crash between send.ok and state save => a new engine on the same dir never resends', async () => {
    const h = createTestHarness()
    h.engine.start()

    h.engine.submit({
      campaignId: 'c16',
      messages: [
        { to: 'crash1@ex.com', subject: '1', body: '1' },
        { to: 'crash2@ex.com', subject: '2', body: '2' },
      ],
    })

    const jobId = h.engine.snapshot()[0].jobId

    // Simulate sending 1 message to crash1@ex.com and event written, but state NOT saved (simulated crash)
    h.events.append({
      type: 'send.ok',
      jobId,
      campaignId: 'c16',
      email: 'crash1@ex.com',
      messageId: '<c1@ex.com>',
    })

    // Now start a brand new engine on the same dir
    const h2 = createTestHarness()
    h2.engine.start()

    const snap = h2.engine.snapshot()[0]
    expect(snap.sent).toBe(1) // Reconciled from events!

    // Advance clock and tick: must send crash2@ex.com, NOT crash1@ex.com
    now += 2000
    await h2.engine.tick()
    expect(h2.sentMails.length).toBe(1)
    expect(h2.sentMails[0].to).toBe('crash2@ex.com')
  })

  // (17) unclean exit auto-resumes, clean quit stays paused
  it('(17) unclean exit auto-resumes, clean quit stays paused', async () => {
    const h1 = createTestHarness()
    h1.engine.start()
    h1.engine.submit({
      campaignId: 'c17',
      messages: [{ to: 'u@ex.com', subject: '1', body: '1' }],
    })
    // Unclean exit: no shutdown called
    const h2 = createTestHarness()
    h2.engine.start()
    expect(h2.engine.snapshot()[0].status).toBe('queued') // Auto-resumed!

    // Clean exit: call shutdown
    h2.engine.shutdown({ clean: true })
    const h3 = createTestHarness()
    h3.engine.start()
    expect(h3.engine.snapshot()[0].status).toBe('paused') // Stays paused!
  })

  // (18) future startAt
  it('(18) future startAt waits until scheduled time', async () => {
    const h = createTestHarness()
    h.engine.start()

    const future = now + 3600 * 1000
    h.engine.submit({
      campaignId: 'c18',
      startAt: future,
      messages: [{ to: 'future@ex.com', subject: '1', body: '1' }],
    })

    await h.engine.tick()
    let snap = h.engine.snapshot()[0]
    expect(snap.status).toBe('waiting')
    expect(snap.why).toBe('schedule')
    expect(snap.until).toBe(future)
    expect(h.sentMails.length).toBe(0)

    // Advance time past future startAt
    now = future + 1000
    await h.engine.tick()
    snap = h.engine.snapshot()[0]
    expect(snap.sent).toBe(1)
    expect(h.sentMails.length).toBe(1)
  })

  // (19) two jobs run sequentially, oldest first, a blocked job does not block another
  it('(19) two jobs run sequentially, oldest first, a blocked job does not block another', async () => {
    const h = createTestHarness()
    h.engine.start()

    // Job 1 is scheduled in future (blocked)
    h.engine.submit({
      campaignId: 'c19-future',
      startAt: now + 3600 * 1000,
      messages: [{ to: 'blocked@ex.com', subject: '1', body: '1' }],
    })

    // Job 2 is ready now
    now += 10
    h.engine.submit({
      campaignId: 'c19-ready',
      messages: [{ to: 'ready@ex.com', subject: '2', body: '2' }],
    })

    await h.engine.tick()
    expect(h.sentMails.length).toBe(1)
    expect(h.sentMails[0].to).toBe('ready@ex.com')
  })

  // (20) dry-run: no ledger write, events flagged dry
  it('(20) dry-run: no mailer send, events flagged dry', async () => {
    const h = createTestHarness({ dryRun: true })
    h.engine.start()

    h.engine.submit({
      campaignId: 'c20',
      messages: [{ to: 'dry@ex.com', subject: '1', body: '1' }],
    })

    await h.engine.tick()
    expect(h.sentMails.length).toBe(0) // Real mailer not called in dry run!
    const evs = h.events.read({ limit: 10, includeDry: true }).events
    const sendOk = evs.find((e) => e.type === 'send.ok')
    expect(sendOk).toBeDefined()
    expect(sendOk?.dry).toBe(true)
  })

  // (21) follow-up flag is passed through
  it('(21) follow-up flag is passed through', async () => {
    const h = createTestHarness()
    h.engine.start()

    h.engine.submit({
      campaignId: 'c21',
      kind: 'followup',
      messages: [{ to: 'followup@ex.com', subject: 'Fwd: 1', body: 'Following up' }],
    })

    await h.engine.tick()
    expect(h.sentMails.length).toBe(1)
    expect(h.sentMails[0].followUp).toBe(true)
    const evs = h.events.read({ limit: 10 }).events
    const ok = evs.find((e) => e.type === 'send.ok')
    expect(ok?.run).toBe('followup')
  })

  // (22) inbox events appended and pushed
  it('(22) inbox events appended and pushed', async () => {
    const inboxMock = {
      check: async () => ({
        ok: true,
        scanned: 15,
        replies: [{ email: 'client@ex.com', at: now, subject: 'Interested', auto: false, unsubscribe: false }],
        bounces: [{ email: 'bad@ex.com', at: now, reason: 'No such user' }],
      }),
    }
    const h = createTestHarness({ deps: { inbox: inboxMock } })
    h.engine.start()

    // Trigger inbox poll by advancing timer or calling internal runner
    await advanceTime(21000)

    const evs = h.events.read({ limit: 20 }).events
    expect(evs.some((e) => e.type === 'reply' && e.email === 'client@ex.com')).toBe(true)
    expect(evs.some((e) => e.type === 'bounce' && e.email === 'bad@ex.com')).toBe(true)
    expect(h.emitted.some((e) => e.channel === 'inbox')).toBe(true)
  })

  // (23) a settings change applies from the next send
  it('(23) a settings change applies from the next send', async () => {
    const h = createTestHarness({ settings: { pace: 'manual', minDelaySec: 5, maxDelaySec: 5 } })
    h.engine.start()

    h.engine.submit({
      campaignId: 'c23',
      messages: [
        { to: 'u1@ex.com', subject: '1', body: '1' },
        { to: 'u2@ex.com', subject: '2', body: '2' },
      ],
    })

    await h.engine.tick()
    expect(h.sentMails.length).toBe(1)

    // Update settings: reduce delay to 1s
    h.settings.set({ minDelaySec: 1, maxDelaySec: 1 })

    now += 1500
    await h.engine.tick()
    expect(h.sentMails.length).toBe(2)
  })

  // (24) 20,000-message job: 2,000 picks in < 2 s and memory stays flat
  it('(24) 20,000-message job: 2,000 picks in < 2 s and memory stays flat', () => {
    const { pickNext } = require('../../electron/outreach-schedule.cjs')
    const msgs: any[] = []
    for (let i = 0; i < 20000; i++) {
      msgs.push({ to: `user${i}@domain${i % 100}.com`, subject: `Sub ${i}`, body: 'B' })
    }

    const sentIndexes = new Set<number>()
    const domainStats = new Map()
    let curTime = now

    const startMem = process.memoryUsage().heapUsed
    const t0 = performance.now()

    for (let count = 0; count < 2000; count++) {
      curTime += 2000
      const pick = pickNext(msgs, sentIndexes, curTime, domainStats, {
        domainMaxPerDay: 100,
        domainMinGapSec: 1,
      })
      expect(pick).not.toBeNull()
      expect(pick.waiting).toBeUndefined()
      sentIndexes.add(pick.index)
    }

    const elapsed = performance.now() - t0
    const endMem = process.memoryUsage().heapUsed
    const memDiffMB = (endMem - startMem) / (1024 * 1024)

    expect(sentIndexes.size).toBe(2000)
    expect(elapsed).toBeLessThan(2000)
    expect(memDiffMB).toBeLessThan(50)
  })

  // (25) shutdown flushes state
  it('(25) shutdown flushes state', () => {
    const h = createTestHarness()
    h.engine.start()

    h.engine.submit({
      campaignId: 'c25',
      messages: [{ to: 'u@ex.com', subject: '1', body: '1' }],
    })

    h.engine.shutdown({ clean: true })

    const snap = h.engine.snapshot()[0]
    expect(snap.status).toBe('paused')
    expect(snap.reason).toBe('quit')

    const evs = h.events.read({ limit: 10 }).events
    const quitEv = evs.find((e) => e.type === 'engine.quit')
    expect(quitEv).toBeDefined()
    expect(quitEv?.clean).toBe(true)
  })

  // (26) cross-PC sync: an address another PC already sent is skipped here, never sent twice
  it('(26) skips an address the shared ledger says another PC sent, and passes the campaign id to the mailer', async () => {
    const h = createTestHarness()
    h.events.append({ type: 'send.ok', remote: true, campaignId: 'c26', email: 'done@example.com', run: 'first', t: now - 3600e3 })
    h.engine.start()
    h.engine.submit({ campaignId: 'c26', messages: [{ to: 'done@example.com', subject: 'S', body: 'B' }, { to: 'new@example.org', subject: 'S', body: 'B' }] })
    await h.engine.tick()
    await advanceTime(500)
    await h.engine.tick()
    expect(h.sentMails.map((x) => x.to)).toEqual(['new@example.org'])
    expect(h.sentMails[0].campaignId).toBe('c26')
    const skip = h.events.read({ types: ['send.skip'], limit: 5 }).events[0]
    expect(skip).toMatchObject({ email: 'done@example.com', reason: 'elsewhere', campaignId: 'c26' })
  })

  // (27) the mailer's ledger refusing a repeat is a skip with its reason, not a failure that trips the breaker
  it('(27) a duplicate refused by the mailer ledger is recorded as skipped, and the tracking key is kept on send.ok', async () => {
    const h = createTestHarness({ sendError: (p: { to: string }) => (p.to === 'dup@example.com' ? { ok: false, error: 'Already emailed dup@example.com on 2026-10-30', duplicate: true } : { ok: true, messageId: '<m@example.com>', messageKey: 'K'.repeat(22) }) })
    h.engine.start()
    h.engine.submit({ campaignId: 'c27', messages: [{ to: 'dup@example.com', subject: 'S', body: 'B' }, { to: 'ok@example.org', subject: 'S', body: 'B' }] })
    await h.engine.tick()
    now += 2000
    await h.engine.tick()
    expect(h.events.read({ types: ['send.fail', 'send.retry'], limit: 5 }).events).toEqual([])
    expect(h.events.read({ types: ['send.skip'], limit: 5 }).events[0]).toMatchObject({ email: 'dup@example.com', reason: 'already-sent' })
    expect(h.events.read({ types: ['send.ok'], limit: 5 }).events[0]).toMatchObject({ email: 'ok@example.org', messageKey: 'K'.repeat(22) })
  })

  // (28) a network blip during a send (the PC could not reach smtp.gmail.com) is transient: the job waits, the same
  // contact is tried again, no attempt is used, nothing is marked Failed and the circuit breaker is never fed
  it.each([
    ['ETIMEDOUT', { ok: false, error: 'Connection timeout', code: 'ETIMEDOUT', kind: 'network' }, 'offline'],
    ['ECONNREFUSED', { ok: false, error: 'connect ECONNREFUSED 142.250.4.108:587', code: 'ECONNREFUSED' }, 'offline'],
    ['ENOTFOUND', { ok: false, error: 'getaddrinfo ENOTFOUND smtp.gmail.com', code: 'ENOTFOUND' }, 'offline'],
    ['EAI_AGAIN', { ok: false, error: 'getaddrinfo EAI_AGAIN smtp.gmail.com', code: 'EAI_AGAIN' }, 'offline'],
    ['EHOSTUNREACH', { ok: false, error: 'connect EHOSTUNREACH', code: 'EHOSTUNREACH' }, 'offline'],
    ['ECONNRESET', { ok: false, error: 'read ECONNRESET', code: 'ECONNRESET' }, 'offline'],
    ['TLS certificate', { ok: false, error: 'certificate has expired', code: 'CERT_HAS_EXPIRED' }, 'tls'],
  ])('(28) send hit %s -> transient wait, same contact retried, no Failed, no breaker', async (_name, blip, why) => {
    let blips = 8 // more than the breaker's 5 consecutive failures and the 3-attempt limit
    const h = createTestHarness({
      sendError: () => (blips-- > 0 ? blip : { ok: true, messageId: '<ok@example.com>' }),
    })
    h.engine.start()
    h.engine.submit({ campaignId: 'c28', messages: [{ to: 'blip@example.com', subject: 'Hi', body: 'Body' }] })

    for (let i = 0; i < 8; i++) {
      await h.engine.tick()
      const snap = h.engine.snapshot()[0]
      expect(snap.status).toBe('waiting')
      expect(snap.why).toBe(why)
      expect(snap.failed).toBe(0)
      expect(snap.sent).toBe(0)
      now += 61_000
    }
    expect(h.events.read({ types: ['send.fail', 'send.retry', 'job.paused'], limit: 20 }).events).toEqual([])

    await h.engine.tick() // the network is back
    const snap = h.engine.snapshot()[0]
    expect(snap.sent).toBe(1)
    expect(snap.failed).toBe(0)
    expect(h.sentMails.length).toBe(9)
    expect(h.sentMails.every((m) => m.to === 'blip@example.com')).toBe(true)
    expect(h.events.read({ types: ['send.ok'], limit: 5 }).events[0]).toMatchObject({ email: 'blip@example.com', attempt: 1 })
  })

  // (29) a blip between real recipient failures does not count toward the circuit breaker's consecutive count
  it('(29) network blips between transient recipient failures never trip the breaker', async () => {
    const results = [
      { ok: false, error: '451 4.3.0 Mailbox busy, try again later' },
      { ok: false, error: 'Connection timeout', code: 'ETIMEDOUT' },
      { ok: false, error: 'Connection timeout', code: 'ETIMEDOUT' },
      { ok: false, error: 'Connection timeout', code: 'ETIMEDOUT' },
      { ok: false, error: 'Connection timeout', code: 'ETIMEDOUT' },
      { ok: false, error: 'Connection timeout', code: 'ETIMEDOUT' },
    ]
    const h = createTestHarness({ sendError: () => results.shift() ?? { ok: true, messageId: '<ok@example.com>' } })
    h.engine.start()
    h.engine.submit({ campaignId: 'c29', messages: [{ to: 'a@example.com', subject: 'Hi', body: 'B' }, { to: 'b@example.net', subject: 'Hi', body: 'B' }] })
    for (let i = 0; i < 12; i++) { await h.engine.tick(); now += 6 * 60_000 }
    const snap = h.engine.snapshot()[0]
    expect(snap.status).not.toBe('paused')
    expect(snap.sent).toBe(2)
    expect(h.events.read({ types: ['job.paused', 'send.fail'], limit: 5 }).events).toEqual([])
  })
})
