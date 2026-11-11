// Outreach pacing follows the editor's settings (2026-11-01 fix):
//  A  one copy of the gaps / daily limit (engine Autopilot settings); the Sender dialog's old copy is adopted once
//  B  one pacing model: a random gap inside "wait at least / at most" (an old 'auto' setting is read as it)
//  C  per-organisation counts and the last-send time survive a restart (rebuilt from the event log)
//  D  the wait is explained in words
// Every file lives in a temp folder — never the editor's userData.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { waitReason, fmtGapRange } from '../../src/outreach/activityFormat'

const require = createRequire(import.meta.url)
const { createEventLog } = require('../../electron/outreach-events.cjs')
const { createJobStore } = require('../../electron/outreach-jobs.cjs')
const { createEngine } = require('../../electron/outreach-engine.cjs')
const { createSettingsManager, migratePacingFromMailer, DEFAULT_SETTINGS } = require('../../electron/outreach-settings.cjs')
const mailerMod = require('../../electron/mailer.cjs')

// Sunday 2026-11-01 10:00 Dhaka — inside the default Sun–Thu 09:00–17:00 window
const BASE = Date.UTC(2026, 10, 1, 4, 0, 0)

let dir: string
let now: number
let timers: Map<number, { fn: () => void; runAt: number }>
let tid = 0

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outreach-pacing-'))
  now = BASE
  timers = new Map()
})
afterEach(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
})

function engineWith(settings: any, rnd = () => 0.5) {
  const events = createEventLog({ dir, clock: () => now })
  const jobs = createJobStore({ dir, clock: () => now })
  const sent: string[] = []
  const engine = createEngine({
    clock: () => now,
    setTimer: (fn: () => void, ms: number) => { const id = ++tid; timers.set(id, { fn, runAt: now + ms }); return id },
    clearTimer: (id: number) => timers.delete(id),
    events,
    jobs,
    settings,
    mailer: { send: async (p: any) => { sent.push(p.to); return { ok: true, messageId: `<m${sent.length}@x>` } }, status: () => ({}) },
    online: async () => true,
    rnd,
    emit: () => {},
    env: { ESB_OUTREACH_DRYRUN: '0', ESB_OUTREACH_SPEED: '1', ESB_OUTREACH_NO_WINDOW: '0' },
  })
  return { engine, events, jobs, sent }
}

const winOpen = { enabled: true, from: '09:00', to: '17:00', days: [0, 1, 2, 3, 4], tz: 'Asia/Dhaka' }

describe('A — the Sender dialog and Autopilot settings edit ONE copy, and the engine uses it', () => {
  it('a gap saved like the Sender dialog does (engine settings) is the gap the engine waits', async () => {
    const mgr = createSettingsManager({ dir })
    // what SenderDialog.save sends to engineClient.saveSettings for "1 – 2 min"
    expect(mgr.save({ dailyLimit: 100, minDelaySec: 60, maxDelaySec: 120, pace: 'manual', window: winOpen, domainMinGapSec: 0 }).ok).toBe(true)
    for (const r of [0, 0.5, 0.999]) {
      const h = engineWith(mgr, () => r)
      h.engine.start()
      h.engine.submit({ campaignId: `a${r}`, messages: [{ to: `x${r}@one.org`, subject: 's', body: 'b' }, { to: `y${r}@two.org`, subject: 's', body: 'b' }] })
      await h.engine.tick()
      const j = h.engine.snapshot().find((x: any) => x.campaignId === `a${r}`)
      expect(j.why).toBe('gap')
      const gap = (j.until - now) / 1000
      expect(gap).toBeGreaterThanOrEqual(60)
      expect(gap).toBeLessThanOrEqual(120)
      expect(j.wait).toMatchObject({ pace: 'manual', minSec: 60, maxSec: 120 })
      h.engine.shutdown()
      now += 3600 * 1000
    }
  })

  it('the mailer reports and enforces the engine numbers, not its own stale copy', async () => {
    const safeStorage = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from('enc:' + s), decryptString: (b: Buffer) => b.toString().replace(/^enc:/, '') }
    const nodemailer = { createTransport: () => ({ sendMail: async () => ({ messageId: '<id@example.com>' }) }) }
    const pacing = { dailyLimit: 2, minDelaySec: 60, maxDelaySec: 120 }
    const mailer = mailerMod.createMailer({ dir, safeStorage, nodemailer, clock: () => now, pacing: () => pacing })
    mailer.saveSettings({ host: 'smtp.gmail.com', port: 587, user: 'desk@example.com', name: 'ESB Power Line', dailyLimit: 100, minDelaySec: 180, maxDelaySec: 480 }, 'abcdefghijklmnop')
    expect(mailer.status().settings).toMatchObject({ dailyLimit: 2, minDelaySec: 60, maxDelaySec: 120 })
    for (const to of ['a@example.com', 'b@example.com']) {
      expect((await mailer.send({ to, subject: 'S', text: 'x' })).ok).toBe(true)
      now += 31_000 // the mailer's own floor is 30 s — it never adds a bigger one
    }
    const third = await mailer.send({ to: 'c@example.com', subject: 'S', text: 'x' })
    expect(third.ok).toBe(false)
    expect(third.error).toMatch(/Daily limit of 2/)
  })

  it('migration adopts the Sender dialog values the engine never read (the editor\'s files: smtp 60–120 s, autopilot 180–480 s manual, autopilot newer)', () => {
    const smtp = path.join(dir, 'outreach-smtp.json')
    fs.writeFileSync(smtp, JSON.stringify({ host: 'smtp.gmail.com', port: 587, user: 'desk@example.com', name: 'ESB', dailyLimit: 100, minDelaySec: 60, maxDelaySec: 120, password: null }))
    const mgr = createSettingsManager({ dir })
    mgr.save({ pace: 'manual', minDelaySec: 180, maxDelaySec: 480, window: { ...winOpen, enabled: false } })
    // the autopilot file is the newer one, as on the editor's PC (an Autopilot save rewrote it later)
    const old = new Date(Date.now() - 3600_000)
    fs.utimesSync(smtp, old, old)
    const events = createEventLog({ dir, clock: () => now })
    const r = migratePacingFromMailer({ settings: mgr, smtpFile: smtp, events })
    expect(r.migrated).toBe(true)
    expect(mgr.get()).toMatchObject({ minDelaySec: 60, maxDelaySec: 120, pace: 'manual', pacingMigrated: true })
    // nothing else changed — the window stays as he saved it
    expect(mgr.get().window.enabled).toBe(false)
    const ev = events.read({ types: ['settings.migrated'] }).events
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ before: { minDelaySec: 180, maxDelaySec: 480 }, after: { minDelaySec: 60, maxDelaySec: 120 } })
    // the smtp file is never written
    expect(JSON.parse(fs.readFileSync(smtp, 'utf8')).minDelaySec).toBe(60)
    // once only: a later change in Autopilot settings is never overwritten by the old smtp copy
    mgr.save({ minDelaySec: 300, maxDelaySec: 600 })
    expect(migratePacingFromMailer({ settings: mgr, smtpFile: smtp, events }).migrated).toBe(false)
    expect(mgr.get().minDelaySec).toBe(300)
    // and it survives a reload from disk
    expect(createSettingsManager({ dir }).get()).toMatchObject({ minDelaySec: 300, pacingMigrated: true })
  })

  it('migration keeps Autopilot values someone set on purpose when the smtp copy is older', () => {
    const smtp = path.join(dir, 'outreach-smtp.json')
    fs.writeFileSync(smtp, JSON.stringify({ dailyLimit: 100, minDelaySec: 60, maxDelaySec: 120 }))
    const old = new Date(Date.now() - 3600_000)
    fs.utimesSync(smtp, old, old)
    const mgr = createSettingsManager({ dir })
    mgr.save({ minDelaySec: 240, maxDelaySec: 300 }) // not the defaults: chosen deliberately (e.g. assistant setCooldown)
    expect(migratePacingFromMailer({ settings: mgr, smtpFile: smtp }).migrated).toBe(false)
    expect(mgr.get()).toMatchObject({ minDelaySec: 240, maxDelaySec: 300, pacingMigrated: true })
    expect(DEFAULT_SETTINGS.minDelaySec).toBe(180)
  })

  it('migration: newer smtp copy wins even over non-default autopilot values; no smtp file is a no-op', () => {
    const mgr = createSettingsManager({ dir })
    mgr.save({ minDelaySec: 240, maxDelaySec: 300, pace: 'auto' })
    const autoFile = path.join(dir, 'outreach-autopilot.json')
    const old = new Date(Date.now() - 3600_000)
    fs.utimesSync(autoFile, old, old)
    const smtp = path.join(dir, 'outreach-smtp.json')
    expect(migratePacingFromMailer({ settings: createSettingsManager({ dir: path.join(dir, 'none') }), smtpFile: path.join(dir, 'none', 'outreach-smtp.json') }).migrated).toBe(false)
    fs.writeFileSync(smtp, JSON.stringify({ dailyLimit: 50, minDelaySec: 90, maxDelaySec: 150 }))
    expect(migratePacingFromMailer({ settings: mgr, smtpFile: smtp }).migrated).toBe(true)
    expect(mgr.get()).toMatchObject({ minDelaySec: 90, maxDelaySec: 150, pace: 'manual', dailyLimit: 50 })
  })
})

describe('B — one pacing model: a random gap between "wait at least / at most"', () => {
  it('an old "spread over the hours" setting is read as the fixed gap', async () => {
    const mgr = { get: () => ({ ...DEFAULT_SETTINGS, window: winOpen, pace: 'auto', minDelaySec: 240, maxDelaySec: 300, domainMinGapSec: 0, ramp: false }) }
    const h = engineWith(mgr, () => 0)
    h.engine.start()
    const msgs = Array.from({ length: 200 }, (_, i) => ({ to: `u${i}@org${i}.com`, subject: 's', body: 'b' }))
    h.engine.submit({ campaignId: 'b1', messages: msgs })
    await h.engine.tick()
    const j = h.engine.snapshot()[0]
    expect(j.why).toBe('gap')
    expect((j.until - now) / 1000).toBeGreaterThanOrEqual(240)
    expect((j.until - now) / 1000).toBeLessThanOrEqual(300)
    expect(j.wait).toMatchObject({ pace: 'manual', minSec: 240, maxSec: 300 })
    expect(createSettingsManager({ dir: path.join(dir, 'p') }).validate({ pace: 'auto' }).cleaned.pace).toBe('manual')
  })
})

describe('C — a restart keeps the per-organisation counts and the gap', () => {
  it('3 emails to desco.gov.bd today, restart, a 4th waits for the daily limit — not sent', async () => {
    const cfg = { ...DEFAULT_SETTINGS, window: winOpen, pace: 'manual', minDelaySec: 30, maxDelaySec: 30, domainMaxPerDay: 3, domainMinGapSec: 60, ramp: false }
    const mgr = { get: () => cfg }
    let h = engineWith(mgr)
    h.engine.start()
    h.engine.submit({ campaignId: 'c1', messages: [1, 2, 3].map((i) => ({ to: `p${i}@desco.gov.bd`, subject: 's', body: 'b' })) })
    for (let i = 0; i < 3; i++) {
      await h.engine.tick()
      now += 61_000
    }
    expect(h.sent).toHaveLength(3)
    h.engine.shutdown()

    // the app restarts (as it did ~40 times on 2026-11-01)
    now += 5 * 60_000
    h = engineWith(mgr)
    h.engine.start()
    h.engine.submit({ campaignId: 'c2', messages: [{ to: 'p4@desco.gov.bd', subject: 's', body: 'b' }] })
    const c2 = () => h.engine.snapshot().find((x: any) => x.campaignId === 'c2')
    await h.engine.tick()
    expect(h.sent).toHaveLength(0)
    expect(c2()).toMatchObject({ status: 'waiting', why: 'domain', wait: { domain: 'desco.gov.bd', kind: 'limit', count: 3, max: 3 } })
    // freed by the next Dhaka day (a calendar day, like the account's), and the desk names the real next send: when the
    // sending hours open that morning, not midnight
    expect(c2().until).toBe(Date.UTC(2026, 10, 2, 3, 0, 0))

    // the limit is lifted while the batch waits: the app closes without a clean quit, and at the next launch it sends straight away instead of sleeping to morning
    h = engineWith({ get: () => ({ ...mgr.get(), domainMaxPerDay: 0, domainMinGapSec: 0 }) })
    h.engine.start()
    await h.engine.tick()
    expect(h.sent).toHaveLength(1)
  })

  it('restart right after a send still waits the gap (the last-send time is rebuilt too)', async () => {
    const cfg = { ...DEFAULT_SETTINGS, window: winOpen, pace: 'manual', minDelaySec: 120, maxDelaySec: 120, domainMinGapSec: 0, ramp: false }
    let h = engineWith({ get: () => cfg })
    h.engine.start()
    h.engine.submit({ campaignId: 'g1', messages: [{ to: 'a@one.org', subject: 's', body: 'b' }, { to: 'b@two.org', subject: 's', body: 'b' }] })
    await h.engine.tick()
    expect(h.sent).toHaveLength(1)
    h.engine.shutdown()
    now += 10_000
    h = engineWith({ get: () => cfg })
    h.engine.start()
    // a clean quit leaves the batch paused ('quit'); the editor presses Resume at once
    h.engine.control(h.engine.snapshot()[0].jobId, 'resume')
    await h.engine.tick()
    expect(h.sent).toHaveLength(0)
    const j = h.engine.snapshot()[0]
    expect(j.why).toBe('gap')
    expect(j.until).toBe(BASE + 120_000)
  })

  it('spacing per organisation after restart: says which organisation and the spacing', async () => {
    const cfg = { ...DEFAULT_SETTINGS, window: winOpen, pace: 'manual', minDelaySec: 30, maxDelaySec: 30, domainMaxPerDay: 3, domainMinGapSec: 1200, ramp: false }
    let h = engineWith({ get: () => cfg })
    h.engine.start()
    h.engine.submit({ campaignId: 's1', messages: [{ to: 'a@dpdc.gov.bd', subject: 's', body: 'b' }] })
    await h.engine.tick()
    h.engine.shutdown()
    now += 60_000
    h = engineWith({ get: () => cfg })
    h.engine.start()
    h.engine.submit({ campaignId: 's2', messages: [{ to: 'b@dpdc.gov.bd', subject: 's', body: 'b' }] })
    await h.engine.tick()
    const j = h.engine.snapshot().find((x: any) => x.campaignId === 's2')
    expect(j).toMatchObject({ why: 'domain', wait: { domain: 'dpdc.gov.bd', kind: 'spacing', gapSec: 1200 } })
    expect(j.until).toBe(BASE + 1200_000)
    expect(waitReason(j)).toBe('dpdc.gov.bd: 20-min spacing per organisation')
  })

  it('a changed organisation limit wakes a batch that waits for it', async () => {
    const cfg: any = { ...DEFAULT_SETTINGS, window: winOpen, pace: 'manual', minDelaySec: 30, maxDelaySec: 30, domainMaxPerDay: 1, domainMinGapSec: 0, ramp: false }
    const h = engineWith({ get: () => cfg })
    h.engine.start()
    h.engine.submit({ campaignId: 'w1', messages: [{ to: 'a@reb.gov.bd', subject: 's', body: 'b' }, { to: 'b@reb.gov.bd', subject: 's', body: 'b' }] })
    await h.engine.tick()
    now += 31_000
    await h.engine.tick()
    expect(h.engine.snapshot()[0]).toMatchObject({ why: 'domain', wait: { kind: 'limit' } })
    cfg.domainMaxPerDay = 5
    expect(h.engine.settingsChanged().woke).toBe(true)
    await h.engine.tick()
    expect(h.sent).toHaveLength(2)
  })
})

describe('D — the wait in words', () => {
  const w = (why: any, wait: any) => waitReason({ status: 'waiting', why, wait })
  it('organisation limit and spacing', () => {
    expect(w('domain', { domain: 'desco.gov.bd', kind: 'limit', count: 3, max: 3 })).toBe('held by organisation limit: desco.gov.bd had 3 today (limit 3)')
    expect(waitReason({ status: 'waiting', why: 'domain', until: Date.UTC(2026, 10, 9, 18, 0), wait: { domain: 'desco.gov.bd', kind: 'limit', count: 3, max: 3, domainsHeld: 4 } }, 'Asia/Dhaka'))
      .toMatch(/^held by organisation limit: 4 domains, next at /)
    expect(w('domain', { domain: 'nesco.gov.bd', kind: 'spacing', gapSec: 1200 })).toBe('nesco.gov.bd: 20-min spacing per organisation')
  })
  it('gap, window, cap', () => {
    expect(w('gap', { pace: 'manual', minSec: 60, maxSec: 120 })).toBe('gap 1–2 min')
    expect(w('gap', { pace: 'auto', minSec: 180, maxSec: 480 })).toBe('gap 3–8 min')
    expect(w('gap', { pace: 'manual', minSec: 45, maxSec: 90 })).toBe('gap 45 s–1.5 min')
    expect(w('window', { from: '09:00', to: '17:00' })).toMatch(/^outside sending hours \(/)
    // a job snapshot saved by the previous build (no kind) keeps its old wording
    expect(w('cap', { limit: 100, sent: 100, ramp: false })).toBe('100 sent in 24 h — daily limit 100')
    expect(w('cap', { kind: 'day', limit: 100, sent: 100, ramp: false })).toBe('daily limit reached — 100 of 100 sent today')
    expect(w('cap', { kind: 'day', limit: 30, sent: 30, ramp: true })).toBe('warm-up limit reached — 30 of 30 sent today')
  })
  it('nothing when not waiting', () => {
    expect(waitReason({ status: 'running', why: null, wait: null })).toBeNull()
    expect(waitReason(null)).toBeNull()
    expect(fmtGapRange(60, 60)).toBe('1 min')
  })
})
