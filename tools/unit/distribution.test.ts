// W3 — Distribution scheduler: the engine half (main process). Dhaka wall time → instant, the approval gate, the
// idempotency key, exactly-once firing, relaunch recovery, the 2-hour missed rule and the tray's isActive().
// Synthetic data only; fake clock and timers; every engine runs on its own temp folder.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { createEventLog } = require('../../electron/outreach-events.cjs')
const { createJobStore } = require('../../electron/outreach-jobs.cjs')
const { createEngine } = require('../../electron/outreach-engine.cjs')
const { wallTimeToEpoch, epochToWallTime, planDistribution, DIST_GRACE_MS } = require('../../electron/outreach-schedule.cjs')
const { validateJobSpec, validateDistributeResult, validateControl } = require('../../electron/outreach-guard.cjs')

const MIN = 60_000
const HOUR = 60 * MIN
// Sunday 2026-11-01 10:00 Asia/Dhaka (UTC+6) = 04:00 Z
const BASE = Date.UTC(2026, 10, 1, 4, 0, 0)

let dir: string
let now: number
let timers: Map<number, { fn: () => unknown; at: number }>
let seq = 0

const clock = () => now
const setTimer = (fn: () => unknown, ms: number) => { const id = ++seq; timers.set(id, { fn, at: now + ms }); return id }
const clearTimer = (id: number) => { timers.delete(id) }

/** Move the clock and run every timer that falls due, including ones those timers set, in time order. */
async function advance(ms: number) {
  const end = now + ms
  for (;;) {
    const next = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
    if (!next) break
    timers.delete(next[0])
    now = Math.max(now, next[1].at)
    await next[1].fn()
  }
  now = end
}

type Emitted = { kind: string; data: any }

function boot(opts: { dry?: boolean; env?: Record<string, string>; distResultTimeoutMs?: number; mail?: any[] } = {}) {
  const events = createEventLog({ dir, clock })
  const jobs = createJobStore({ dir, clock })
  const emitted: Emitted[] = []
  const mail = opts.mail ?? []
  const engine = createEngine({
    clock, setTimer, clearTimer, events, jobs,
    settings: { get: () => ({ window: { enabled: false }, dailyLimit: 100, ramp: false, pace: 'manual', minDelaySec: 1, maxDelaySec: 1, domainMaxPerDay: 50, domainMinGapSec: 1, contactCooldownDays: 30, autoResume: true }) },
    mailer: { send: async (m: any) => { mail.push(m); return { ok: true, messageId: '<m@example.com>' } }, status: () => ({}) },
    inbox: { check: async () => ({ ok: false }) },
    online: async () => true,
    rnd: () => 0.5,
    emit: (kind: string, data: any) => { emitted.push({ kind, data }) },
    env: { ESB_OUTREACH_DRYRUN: opts.dry === false ? '0' : '1', ...(opts.env ?? {}) },
    distResultTimeoutMs: opts.distResultTimeoutMs,
  })
  const fires = () => emitted.filter((e) => e.kind === 'distribute.fire').map((e) => e.data)
  const ledger = (type?: string) => events.read({ limit: 10000, includeDry: true }).events.filter((e: any) => !type || e.type === type).reverse()
  const dist = (id: string) => engine.distSnapshot().find((j: any) => j.jobId === id)
  return { engine, events, jobs, emitted, fires, ledger, dist, mail }
}

/** A Dhaka wall time `minutes` after the clock. */
function dhakaIn(minutes: number, seconds = 0) {
  const t = now + minutes * MIN + seconds * 1000
  const w = epochToWallTime(t)
  const s = new Date(t + 6 * HOUR).getUTCSeconds()
  return { date: w.date, time: `${w.time}:${String(s).padStart(2, '0')}` }
}

function spec(storyId: string, action: 'publish-site' | 'post-facebook', when: { date: string; time: string }) {
  return { kind: 'distribute', action, storyId, slug: 'grid-adds-400-mw', headline: 'Grid operator adds 400 MW', ...when }
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w3-distribution-'))
  now = BASE
  timers = new Map()
  seq = 0
})
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* temp */ } })

describe('Dhaka wall time → epoch', () => {
  it('converts with the fixed +06:00 offset, including the midnight boundary', () => {
    expect(wallTimeToEpoch('2026-11-01', '10:00')).toBe(BASE)
    expect(wallTimeToEpoch('2026-11-02', '00:00')).toBe(Date.UTC(2026, 10, 1, 18, 0, 0))
    // 23:59 → 00:00 is one minute, across the date change, and across a month and a year end
    expect(wallTimeToEpoch('2026-11-02', '00:00')! - wallTimeToEpoch('2026-11-01', '23:59')!).toBe(MIN)
    expect(wallTimeToEpoch('2026-12-01', '00:00')! - wallTimeToEpoch('2026-11-30', '23:59')!).toBe(MIN)
    expect(wallTimeToEpoch('2027-01-01', '00:00')).toBe(Date.UTC(2026, 11, 31, 18, 0, 0))
    expect(wallTimeToEpoch('2026-11-01', '05:59:30')).toBe(Date.UTC(2026, 10, 0, 23, 59, 30))
  })
  it('round-trips and refuses nonsense', () => {
    expect(epochToWallTime(wallTimeToEpoch('2026-11-01', '23:45')!)).toEqual({ date: '2026-11-01', time: '23:45' })
    for (const [d, t] of [['2026-02-31', '10:00'], ['2026-13-01', '10:00'], ['2026-11-01', '24:00'], ['2026-11-01', '9:00'], ['01-11-2026', '10:00'], ['2026-11-01', '10:60'], ['', '']]) {
      expect(wallTimeToEpoch(d, t)).toBeNull()
    }
    expect(wallTimeToEpoch('2026-11-01', '10:00', 'Not/AZone')).toBeNull()
  })
  it('rejects a time that has passed (and the exact present), accepts a second later', () => {
    const { engine } = boot()
    engine.start()
    expect(engine.submit(spec('s1', 'publish-site', { date: '2026-11-01', time: '09:59' }))).toMatchObject({ ok: false, error: expect.stringMatching(/already passed/) })
    expect(engine.submit(spec('s1', 'publish-site', { date: '2026-11-01', time: '10:00' }))).toMatchObject({ ok: false })
    expect(engine.submit(spec('s1', 'publish-site', { date: '2026-11-01', time: '10:00:01' }))).toMatchObject({ ok: true })
    expect(engine.submit(spec('s2', 'publish-site', { date: '2027-03-01', time: '10:00' }))).toMatchObject({ ok: false, error: expect.stringMatching(/60 days/) })
  })
  it('schedules at 23:59 for 00:00 next day and fires at 00:00, not before', async () => {
    now = wallTimeToEpoch('2026-11-01', '23:59')!
    const h = boot()
    h.engine.start()
    h.engine.setDistExecutor(true)
    const r = h.engine.submit(spec('s1', 'publish-site', { date: '2026-11-02', time: '00:00' }))
    expect(r.ok).toBe(true)
    expect(h.dist(r.jobId).fireAt).toBe(Date.UTC(2026, 10, 1, 18, 0, 0))
    h.engine.control(r.jobId, 'release')
    await advance(59_000)
    expect(h.fires()).toHaveLength(0)
    await advance(1_100)
    expect(h.fires()).toHaveLength(1)
  })
})

describe('approval gate', () => {
  it('planDistribution never picks an unapproved job, and orders site before Facebook', () => {
    const base = { kind: 'distribute', status: 'queued', fireAt: BASE - MIN, createdAt: 1 }
    const plan = planDistribution([
      { ...base, id: 'a', action: 'post-facebook', approved: true },
      { ...base, id: 'b', action: 'publish-site', approved: true },
      { ...base, id: 'c', action: 'publish-site', approved: false, fireAt: BASE - 2 * MIN },
      { ...base, id: 'd', action: 'publish-site', approved: true, status: 'done' },
      { id: 'e', kind: 'first', status: 'queued' },
    ], BASE)
    expect(plan.fire.id).toBe('b')
    expect(planDistribution([{ ...base, id: 'c', action: 'publish-site', approved: false }], BASE).fire).toBeNull()
  })
  it('an unapproved job never fires; approve → it fires once; hold before its time → it does not', async () => {
    const h = boot()
    h.engine.start()
    h.engine.setDistExecutor(true)
    const a = h.engine.submit(spec('s1', 'publish-site', dhakaIn(1)))
    const b = h.engine.submit(spec('s1', 'post-facebook', dhakaIn(1)))
    expect(h.dist(a.jobId).approved).toBe(false)
    await advance(5 * MIN)
    expect(h.fires()).toHaveLength(0)
    h.engine.control(a.jobId, 'release')
    h.engine.control(b.jobId, 'release')
    h.engine.control(b.jobId, 'hold')
    await advance(MIN)
    expect(h.fires().map((f) => f.jobId)).toEqual([a.jobId])
    expect(h.dist(b.jobId)).toMatchObject({ status: 'queued', approved: false })
  })
  it('the renderer cannot create an approved job: approved/status/key/fireAt in the spec are dropped', () => {
    const g = validateJobSpec({ ...spec('s1', 'publish-site', { date: '2026-11-02', time: '10:00' }), approved: true, status: 'done', key: 'dist:other:publish-site', fireAt: 1, dry: false })
    expect(g.ok).toBe(true)
    expect(Object.keys(g.cleaned).sort()).toEqual(['action', 'date', 'headline', 'kind', 'slug', 'storyId', 'time'])
    for (const bad of [{ action: 'post-x' }, { storyId: '../x' }, { slug: 'Bad Slug' }, { slug: '' }, { date: '2026/11/02' }, { time: '10h' }, { headline: '' }]) {
      expect(validateJobSpec({ ...spec('s1', 'publish-site', { date: '2026-11-02', time: '10:00' }), ...bad }).ok).toBe(false)
    }
    expect(validateControl('dist-x', 'release').ok).toBe(true)
  })
})

describe('exactly once', () => {
  it('writes distribute.fire to the ledger before the push, and refuses a second job for the same key', async () => {
    const h = boot()
    let ledgerAtPush = -1
    const emit0 = h.emitted.push.bind(h.emitted)
    h.emitted.push = (e: Emitted) => { if (e.kind === 'distribute.fire') ledgerAtPush = h.ledger('distribute.fire').length; return emit0(e) }
    h.engine.start()
    h.engine.setDistExecutor(true)
    const a = h.engine.submit(spec('s1', 'publish-site', dhakaIn(1)))
    expect(h.engine.submit(spec('s1', 'publish-site', dhakaIn(2)))).toMatchObject({ ok: false, error: expect.stringMatching(/already scheduled/) })
    h.engine.control(a.jobId, 'release')
    await advance(61_000)
    expect(ledgerAtPush).toBe(1)
    expect(h.dist(a.jobId).status).toBe('running')
    expect(h.engine.submit(spec('s1', 'publish-site', dhakaIn(5)))).toMatchObject({ ok: false })
    expect(h.engine.control(a.jobId, 'stop')).toMatchObject({ ok: false, error: expect.stringMatching(/going out now/) })
    expect(h.engine.control(a.jobId, 'hold').ok).toBe(false)
  })
  it('accepts one result for exactly the fired job and key; forged, wrong-key and repeated results change nothing', async () => {
    const h = boot()
    h.engine.start()
    h.engine.setDistExecutor(true)
    const a = h.engine.submit(spec('s1', 'publish-site', dhakaIn(1)))
    const q = h.engine.submit(spec('s2', 'publish-site', dhakaIn(30)))
    h.engine.control(a.jobId, 'release')
    h.engine.control(q.jobId, 'release')
    // forged "done" for a job that was never fired
    expect(h.engine.distributeResult({ jobId: q.jobId, key: 'dist:s2:publish-site', ok: true, detail: '' }).ok).toBe(false)
    await advance(61_000)
    expect(h.engine.distributeResult({ jobId: a.jobId, key: 'dist:s2:publish-site', ok: true, detail: '' }).ok).toBe(false)
    expect(h.engine.distributeResult({ jobId: a.jobId, key: 'dist:s1:publish-site', ok: true, detail: 'Published' }).ok).toBe(true)
    expect(h.engine.distributeResult({ jobId: a.jobId, key: 'dist:s1:publish-site', ok: true, detail: 'again' }).ok).toBe(false)
    expect(h.dist(a.jobId)).toMatchObject({ status: 'done', result: { ok: true, detail: 'Published' } })
    expect(h.dist(q.jobId)).toMatchObject({ status: 'queued' })
    expect(h.ledger('distribute.done')).toHaveLength(1)
    // done is final: the key is refused, and the done job cannot be cancelled to free it
    expect(h.engine.submit(spec('s1', 'publish-site', dhakaIn(40)))).toMatchObject({ ok: false, error: expect.stringMatching(/already went there/) })
    expect(h.engine.control(a.jobId, 'stop').ok).toBe(false)
    expect(validateDistributeResult({ jobId: a.jobId, key: 'dist:s1:publish-site', ok: 'yes' }).ok).toBe(false)
    expect(validateDistributeResult({ jobId: a.jobId, key: 'not-a-key', ok: true }).ok).toBe(false)
    expect(validateDistributeResult({ ready: true })).toEqual({ ok: true, ready: true })
  })
  it('one in flight at a time: the second due job waits for the first result', async () => {
    const h = boot()
    h.engine.start()
    h.engine.setDistExecutor(true)
    const a = h.engine.submit(spec('s1', 'post-facebook', dhakaIn(1)))
    const b = h.engine.submit(spec('s1', 'publish-site', dhakaIn(1)))
    h.engine.control(a.jobId, 'release')
    h.engine.control(b.jobId, 'release')
    await advance(2 * MIN)
    expect(h.fires().map((f) => f.jobId)).toEqual([b.jobId]) // the site goes first at an equal time
    h.engine.distributeResult({ jobId: b.jobId, key: 'dist:s1:publish-site', ok: true, detail: '' })
    await advance(1000)
    expect(h.fires().map((f) => f.jobId)).toEqual([b.jobId, a.jobId])
    expect(h.fires()[0]).toMatchObject({ dry: true, action: 'publish-site', storyId: 's1', key: 'dist:s1:publish-site' })
  })
  it('waits for the window: nothing fires until the executor says it is ready', async () => {
    const h = boot()
    h.engine.start()
    const a = h.engine.submit(spec('s1', 'publish-site', dhakaIn(1)))
    h.engine.control(a.jobId, 'release')
    await advance(3 * MIN)
    expect(h.fires()).toHaveLength(0)
    h.engine.setDistExecutor(true)
    await advance(100)
    expect(h.fires()).toHaveLength(1)
  })
  it('a window that reloads mid-job fails the job as interrupted; no answer for 10 minutes fails it too', async () => {
    const h = boot({ distResultTimeoutMs: 10 * MIN })
    h.engine.start()
    h.engine.setDistExecutor(true)
    const a = h.engine.submit(spec('s1', 'publish-site', dhakaIn(1)))
    const b = h.engine.submit(spec('s2', 'publish-site', dhakaIn(1)))
    h.engine.control(a.jobId, 'release')
    h.engine.control(b.jobId, 'release')
    await advance(61_000)
    const first = h.fires()[0].jobId
    h.engine.setDistExecutor(false)
    expect(h.dist(first)).toMatchObject({ status: 'failed', result: { reason: 'interrupted' } })
    h.engine.setDistExecutor(true)
    await advance(100)
    const second = h.fires()[1].jobId
    expect(second).not.toBe(first)
    await advance(10 * MIN + 1)
    expect(h.dist(second)).toMatchObject({ status: 'failed', result: { reason: 'no-answer' } })
    expect(h.engine.distributeResult({ jobId: second, key: h.dist(second).key, ok: true, detail: 'late' }).ok).toBe(false)
    expect(h.fires()).toHaveLength(2)
  })
  it('a cancelled duplicate never frees a key another job already used', () => {
    const h = boot()
    h.engine.start()
    // hand-made inconsistency: job A is done for the key in the ledger, job B (same key) is cancelled
    h.events.append({ type: 'distribute.created', jobId: 'dist-a', key: 'dist:s9:publish-site', dry: true })
    h.events.append({ type: 'distribute.fire', jobId: 'dist-a', key: 'dist:s9:publish-site', dry: true })
    h.events.append({ type: 'distribute.done', jobId: 'dist-a', key: 'dist:s9:publish-site', dry: true })
    h.events.append({ type: 'distribute.created', jobId: 'dist-b', key: 'dist:s9:publish-site', dry: true })
    h.events.append({ type: 'distribute.cancelled', jobId: 'dist-b', key: 'dist:s9:publish-site', dry: true })
    expect(h.engine.submit(spec('s9', 'publish-site', dhakaIn(5)))).toMatchObject({ ok: false, error: expect.stringMatching(/ledger/) })
  })
})

describe('relaunch recovery', () => {
  it('a job found running becomes failed: interrupted, is never refired, and its key is refused until cancelled', async () => {
    const h1 = boot()
    h1.engine.start()
    h1.engine.setDistExecutor(true)
    const a = h1.engine.submit(spec('s1', 'publish-site', dhakaIn(1)))
    const done = h1.engine.submit(spec('s2', 'publish-site', dhakaIn(1)))
    h1.engine.control(a.jobId, 'release')
    h1.engine.control(done.jobId, 'release')
    await advance(61_000)
    const firstFired = h1.fires()[0].jobId
    h1.engine.distributeResult({ jobId: firstFired, key: h1.dist(firstFired).key, ok: true, detail: 'Published' })
    await advance(100)
    const running = h1.fires()[1].jobId
    expect(h1.dist(running).status).toBe('running')
    // crash: no shutdown; a new process loads the same folder
    timers.clear()
    const h2 = boot()
    h2.engine.start()
    h2.engine.setDistExecutor(true)
    expect(h2.dist(running)).toMatchObject({ status: 'failed', result: { reason: 'interrupted', detail: 'interrupted — check the site before scheduling again' } })
    expect(h2.dist(firstFired).status).toBe('done')
    await advance(10 * MIN)
    expect(h2.fires()).toHaveLength(0)
    expect(h2.ledger('distribute.fire').filter((e: any) => e.jobId === running)).toHaveLength(1)
    const key = h2.dist(running).key
    const storyId = h2.dist(running).storyId
    expect(h2.engine.submit(spec(storyId, 'publish-site', dhakaIn(5)))).toMatchObject({ ok: false, error: expect.stringMatching(/failed/) })
    expect(h2.engine.control(running, 'release').ok).toBe(false) // a failed job cannot be approved back into the queue
    expect(h2.engine.control(running, 'stop').ok).toBe(true)
    const again = h2.engine.submit(spec(storyId, 'publish-site', dhakaIn(5)))
    expect(again.ok).toBe(true)
    expect(h2.dist(again.jobId)).toMatchObject({ key, approved: false })
  })
  it('a crash between the ledger line and the state file still counts as fired', () => {
    const h1 = boot()
    h1.engine.start()
    const a = h1.engine.submit(spec('s1', 'publish-site', dhakaIn(1)))
    h1.engine.control(a.jobId, 'release')
    h1.events.append({ type: 'distribute.fire', jobId: a.jobId, key: 'dist:s1:publish-site', dry: true }) // state still says queued
    timers.clear()
    const h2 = boot()
    h2.engine.start()
    expect(h2.dist(a.jobId)).toMatchObject({ status: 'failed', result: { reason: 'interrupted' } })
  })
  it('a clean quit leaves a queued job queued; a running one is interrupted on the next launch', async () => {
    const h1 = boot()
    h1.engine.start()
    h1.engine.setDistExecutor(true)
    const a = h1.engine.submit(spec('s1', 'publish-site', dhakaIn(1)))
    const later = h1.engine.submit(spec('s2', 'publish-site', dhakaIn(30)))
    h1.engine.control(a.jobId, 'release')
    h1.engine.control(later.jobId, 'release')
    await advance(61_000)
    h1.engine.shutdown({ clean: true })
    timers.clear()
    const h2 = boot()
    h2.engine.start()
    expect(h2.dist(a.jobId).status).toBe('failed')
    expect(h2.dist(later.jobId)).toMatchObject({ status: 'queued', approved: true })
  })
})

describe('missed-window rule (2 hours)', () => {
  async function scheduleAndQuit() {
    const h1 = boot()
    h1.engine.start()
    const a = h1.engine.submit(spec('s1', 'publish-site', dhakaIn(60)))
    h1.engine.control(a.jobId, 'release')
    const fireAt = h1.dist(a.jobId).fireAt
    h1.engine.shutdown({ clean: true })
    timers.clear()
    return { id: a.jobId, fireAt }
  }
  it('fires at the next launch when still within 2 hours of its time', async () => {
    const { id, fireAt } = await scheduleAndQuit()
    now = fireAt + DIST_GRACE_MS - MIN
    const h2 = boot()
    h2.engine.start()
    h2.engine.setDistExecutor(true)
    await advance(2000)
    expect(h2.fires().map((f) => f.jobId)).toEqual([id])
  })
  it('becomes failed: missed past 2 hours, and never fires', async () => {
    const { id, fireAt } = await scheduleAndQuit()
    now = fireAt + DIST_GRACE_MS + MIN
    const h2 = boot()
    h2.engine.start()
    h2.engine.setDistExecutor(true)
    await advance(5 * MIN)
    expect(h2.dist(id)).toMatchObject({ status: 'failed', result: { reason: 'missed' } })
    expect(h2.fires()).toHaveLength(0)
  })
  it('an unapproved job that stays unapproved past its window is missed too', async () => {
    const h = boot()
    h.engine.start()
    h.engine.setDistExecutor(true)
    const a = h.engine.submit(spec('s1', 'publish-site', dhakaIn(1)))
    await advance(DIST_GRACE_MS + 2 * MIN)
    expect(h.dist(a.jobId)).toMatchObject({ status: 'failed', result: { reason: 'missed' } })
    expect(h.fires()).toHaveLength(0)
  })
})

describe('isActive() and the email engine', () => {
  it('counts approved queued/running distribution jobs only', async () => {
    const h = boot()
    h.engine.start()
    const a = h.engine.submit(spec('s1', 'publish-site', dhakaIn(1)))
    expect(h.engine.isActive()).toBe(false) // unapproved: closing the window may quit
    h.engine.control(a.jobId, 'release')
    expect(h.engine.isActive()).toBe(true)
    h.engine.setDistExecutor(true)
    await advance(61_000)
    expect(h.dist(a.jobId).status).toBe('running')
    expect(h.engine.isActive()).toBe(true)
    h.engine.distributeResult({ jobId: a.jobId, key: 'dist:s1:publish-site', ok: true, detail: '' })
    expect(h.engine.isActive()).toBe(false)
  })
  it('the email loop, pause-all and the campaign snapshot ignore distribution jobs', async () => {
    const mail: any[] = []
    const h = boot({ dry: false, mail })
    h.engine.start()
    const a = h.engine.submit(spec('s1', 'publish-site', dhakaIn(1)))
    h.engine.control(a.jobId, 'release')
    h.engine.pauseAll(true)
    expect(h.dist(a.jobId)).toMatchObject({ status: 'queued', approved: true })
    expect(h.engine.snapshot()).toEqual([])
    expect(h.engine.control(a.jobId, 'pause').ok).toBe(false)
    await advance(5000)
    expect(mail).toHaveLength(0)
    // live mode: the push tells the window to really publish
    h.engine.setDistExecutor(true)
    await advance(61_000)
    expect(h.fires()[0]).toMatchObject({ dry: false })
    expect(h.fires()[0].mocked).toBeUndefined()
  })
  it('ESB_DIST_MOCKED only counts with dry-run', async () => {
    const h = boot({ env: { ESB_DIST_MOCKED: '1' } })
    h.engine.start()
    h.engine.setDistExecutor(true)
    const a = h.engine.submit(spec('s1', 'publish-site', dhakaIn(1)))
    h.engine.control(a.jobId, 'release')
    await advance(61_000)
    expect(h.fires()[0]).toMatchObject({ dry: false, mocked: true })
    expect(h.ledger('distribute.fire')[0].dry).toBe(true)
  })
  it('old job files still load next to distribution jobs', () => {
    const h1 = boot()
    h1.engine.start()
    const email = h1.engine.submit({ campaignId: 'c1', campaignName: 'C', kind: 'first', messages: [{ to: 'a@example.com', subject: 's', body: 'b' }], startAt: BASE + 365 * 24 * HOUR })
    const d = h1.engine.submit(spec('s1', 'post-facebook', dhakaIn(5)))
    h1.engine.shutdown({ clean: true })
    timers.clear()
    const h2 = boot()
    h2.engine.start()
    expect(h2.engine.snapshot().map((j: any) => j.jobId)).toEqual([email.jobId])
    expect(h2.engine.distSnapshot().map((j: any) => j.jobId)).toEqual([d.jobId])
  })
})
