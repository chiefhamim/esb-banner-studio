// Outreach, 2026-11-02 simplification:
//  A  the daily limit is a CALENDAR day in the sending time zone (resets at Dhaka midnight), for the account and for
//     each organisation; the mailer's ledger uses the same rule (outreach-schedule.cjs capState)
//  B  a rolling 24 h safety ceiling still holds across midnight
//  C  the live plan (livePlan) and its words (planLine / warningText)
//  D  old settings migrate without losing the editor's values
//  E  the Activity log: an event with an object where text is expected is shown, not crashed on; a 50k-event history
//     is read once
// Every file lives in a temp folder — never the editor's userData. Addresses are synthetic (example.org / .gov.bd
// shapes only).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { waitReason, planLine, warningText, fmtAbout, displaySafe, describeEvent } from '../../src/outreach/activityFormat'

const require = createRequire(import.meta.url)
const { createEventLog } = require('../../electron/outreach-events.cjs')
const { createJobStore } = require('../../electron/outreach-jobs.cjs')
const { createEngine } = require('../../electron/outreach-engine.cjs')
const { createSettingsManager, DEFAULT_SETTINGS } = require('../../electron/outreach-settings.cjs')
const sched = require('../../electron/outreach-schedule.cjs')

const H = 3600 * 1000
// Dhaka is UTC+6, no DST: D(y, m, d, h, min) = that wall-clock time in Dhaka
const D = (m: number, d: number, h: number, min = 0) => Date.UTC(2026, m - 1, d, h - 6, min)

// the editor's settings on 2026-11-02 (read from his outreach-autopilot.json by the lead)
const OWNER = {
  ...DEFAULT_SETTINGS,
  window: { enabled: true, from: '09:00', to: '21:00', days: [0, 1, 2, 3, 4, 5, 6], tz: 'Asia/Dhaka' },
  dailyLimit: 100,
  ramp: false,
  pace: 'manual',
  minDelaySec: 60,
  maxDelaySec: 120,
  domainMaxPerDay: 3,
  domainMinGapSec: 1200,
}

let dir: string
let now: number
let timers: Map<number, { fn: () => void; runAt: number }>
let tid = 0
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outreach-daily-'))
  timers = new Map()
})
afterEach(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
})

function engineWith(cfg: any) {
  const events = createEventLog({ dir, clock: () => now })
  const jobs = createJobStore({ dir, clock: () => now })
  const sent: string[] = []
  const engine = createEngine({
    clock: () => now,
    setTimer: (fn: () => void, ms: number) => { const id = ++tid; timers.set(id, { fn, runAt: now + ms }); return id },
    clearTimer: (id: number) => timers.delete(id),
    events,
    jobs,
    settings: { get: () => cfg },
    mailer: { send: async (p: any) => { sent.push(p.to); return { ok: true, messageId: `<m${sent.length}@x>` } }, status: () => ({}) },
    online: async () => true,
    rnd: () => 0.5,
    emit: () => {},
    env: { ESB_OUTREACH_DRYRUN: '0', ESB_OUTREACH_SPEED: '1', ESB_OUTREACH_NO_WINDOW: '0' },
  })
  return { engine, events, jobs, sent }
}

/** n earlier send.ok events, `everyMin` apart from `from`, each to its own organisation */
function seed(n: number, from: number, everyMin = 2, dom = (i: number) => `o${i}.example.org`) {
  const events = createEventLog({ dir, clock: () => from })
  for (let i = 0; i < n; i++) events.append({ type: 'send.ok', t: from + i * everyMin * 60_000, email: `p${i}@${dom(i)}`, campaignId: 'old', run: 'first' })
}

const job = (h: ReturnType<typeof engineWith>, id: string, to: string[]) => {
  h.engine.submit({ campaignId: id, messages: to.map((x) => ({ to: x, subject: 's', body: 'b' })) })
  return () => h.engine.snapshot().find((x: any) => x.campaignId === id)
}

describe('A — the daily limit is a calendar day in Dhaka', () => {
  it('dayStartAt / nextDayStartAt: Dhaka midnight', () => {
    expect(sched.dayStartAt(D(11, 2, 11, 6))).toBe(D(11, 2, 0))
    expect(sched.nextDayStartAt(D(11, 2, 11, 6))).toBe(D(11, 3, 0))
    expect(sched.nextDayStartAt(D(11, 2, 0))).toBe(D(11, 3, 0))
    expect(sched.dayKey(D(11, 2, 0, 30))).toBe('2026-11-02')
    expect(sched.dayKey(D(11, 1, 23, 59))).toBe('2026-11-01')
  })

  it('the editor on 2 Nov 11:06: 81 sent yesterday + 19 after midnight → 81 more may go now (they waited for 15:26)', async () => {
    seed(81, D(11, 1, 15, 26), 4)
    seed(19, D(11, 2, 0, 0), 2, (i) => `n${i}.example.org`)
    now = D(11, 2, 11, 6)
    const st = sched.capState({ sendTimes: createEventLog({ dir, clock: () => now }).read({ types: ['send.ok'], from: now - 24 * H, limit: 1000 }).events.map((e: any) => e.t), now, dailyLimit: 100 })
    expect(st).toMatchObject({ sentToday: 19, sent24h: 100, room: 81, limitedBy: null })
    const h = engineWith(OWNER)
    h.engine.start()
    job(h, 'c1', ['a@fresh.example.org'])
    await h.engine.tick()
    expect(h.sent).toEqual(['a@fresh.example.org'])
  })

  it('a full day at 20:55 waits for 09:00 tomorrow (sending hours), and the reason says so', async () => {
    seed(100, D(11, 2, 9, 0), 7)
    now = D(11, 2, 20, 55)
    const h = engineWith(OWNER)
    h.engine.start()
    const j = job(h, 'c2', ['b@fresh.example.org'])
    await h.engine.tick()
    expect(h.sent).toHaveLength(0)
    expect(j()).toMatchObject({ status: 'waiting', why: 'cap', until: D(11, 3, 9, 0), wait: { kind: 'day', limit: 100, sent: 100, resetAt: D(11, 3, 0), resumeAt: D(11, 3, 9, 0) } })
    expect(waitReason(j())).toMatch(/^daily limit reached — 100 of 100 sent today · resumes .+ \(sending hours\)$/)
    // the window opens at 09:00 after a full day: it sends
    now = D(11, 3, 9, 0)
    await h.engine.tick()
    expect(h.sent).toEqual(['b@fresh.example.org'])
  })

  it('with sending hours off, a full day resumes at 00:00 (new day)', async () => {
    seed(100, D(11, 2, 9, 0), 7)
    now = D(11, 2, 22, 0)
    const h = engineWith({ ...OWNER, window: { ...OWNER.window, enabled: false } })
    h.engine.start()
    const j = job(h, 'c3', ['c@fresh.example.org'])
    await h.engine.tick()
    expect(j()).toMatchObject({ why: 'cap', until: D(11, 3, 0), wait: { kind: 'day', hours: null } })
    expect(waitReason(j())).toMatch(/\(new day\)$/)
    now = D(11, 3, 0, 0) + 1000
    await h.engine.tick()
    expect(h.sent).toHaveLength(1)
  })

  it('per organisation: 3 to one organisation late in the evening, a 4th waits only until Dhaka midnight', async () => {
    seed(3, D(11, 2, 22, 0), 25, () => 'desco.gov.bd')
    now = D(11, 2, 23, 30)
    const cfg = { ...OWNER, window: { ...OWNER.window, enabled: false } }
    const h = engineWith(cfg)
    h.engine.start()
    const j = job(h, 'c4', ['p9@desco.gov.bd'])
    await h.engine.tick()
    expect(h.sent).toHaveLength(0)
    expect(j()).toMatchObject({ why: 'domain', until: D(11, 3, 0), wait: { domain: 'desco.gov.bd', kind: 'limit', count: 3, max: 3 } })
    // the 20-min spacing still counts across midnight (last send 22:50 → fine at 00:00)
    now = D(11, 3, 0, 0) + 1000
    await h.engine.tick()
    expect(h.sent).toEqual(['p9@desco.gov.bd'])
  })

  it('per organisation: the spacing still holds across midnight', async () => {
    seed(1, D(11, 2, 23, 55), 1, () => 'nesco.gov.bd')
    now = D(11, 3, 0, 5)
    const h = engineWith({ ...OWNER, window: { ...OWNER.window, enabled: false } })
    h.engine.start()
    const j = job(h, 'c5', ['x@nesco.gov.bd'])
    await h.engine.tick()
    expect(j()).toMatchObject({ why: 'domain', until: D(11, 2, 23, 55) + 20 * 60_000, wait: { kind: 'spacing' } })
  })
})

describe('B — the 24 h safety ceiling', () => {
  it('300 a day: 300 last evening + 100 after midnight = the ceiling of 400 holds until the oldest turns 24 h', async () => {
    seed(300, D(11, 1, 20, 0), 0.75)
    seed(100, D(11, 2, 0, 0), 0.3, (i) => `n${i}.example.org`)
    now = D(11, 2, 0, 40)
    const h = engineWith({ ...OWNER, window: { ...OWNER.window, enabled: false }, dailyLimit: 300, gmailCeiling24h: 400 })
    h.engine.start()
    const j = job(h, 'c6', ['d@fresh.example.org'])
    await h.engine.tick()
    expect(h.sent).toHaveLength(0)
    expect(j()).toMatchObject({ why: 'cap', until: D(11, 1, 20, 0) + 24 * H, wait: { kind: 'ceiling', sent: 400, ceiling: 400 } })
    expect(waitReason(j())).toMatch(/^safety limit: 400 emails in 24 h \(max 400\) · resumes /)
  })

  it('capState: the ceiling, the day and the free time', () => {
    const now0 = D(11, 2, 12, 0)
    const times = Array.from({ length: 50 }, (_, i) => D(11, 2, 9, 0) + i * 60_000)
    expect(sched.capState({ sendTimes: times, now: now0, dailyLimit: 50 })).toMatchObject({ room: 0, limitedBy: 'day', freesAt: D(11, 3, 0) })
    expect(sched.capState({ sendTimes: times, now: now0, dailyLimit: 100, ceiling24h: 50 })).toMatchObject({ room: 0, limitedBy: 'ceiling', freesAt: D(11, 3, 9, 0) })
    expect(sched.capState({ sendTimes: times, now: now0, dailyLimit: 100 })).toMatchObject({ room: 50, limitedBy: null })
    expect(sched.GMAIL_SAFE_24H).toBe(400)
  })
})

describe('C — the live plan', () => {
  const now0 = D(11, 2, 11, 6)
  it("the editor's numbers: 100 at 1–2 min ≈ 2.5 h; 182 left in 60 organisations finish on the 4th", () => {
    const sendTimes = Array.from({ length: 19 }, (_, i) => D(11, 2, 0, 0) + i * 130_000)
    const domains = Array.from({ length: 182 }, (_, i) => `org${i % 60}.gov.bd`)
    const p = sched.livePlan({ now: now0, settings: OWNER, sendTimes, remaining: 182, domains })
    expect(p).toMatchObject({ sentToday: 19, limitToday: 100, roomToday: 81, today: 81, dayDurationSec: 99 * 90, nextAt: now0, remaining: 182, days: 3, warnings: [] })
    expect(p.perDay.map((x: any) => x.n)).toEqual([81, 100, 1])
    expect(p.finishAt).toBe(D(11, 4, 9, 0))
    expect(fmtAbout(p.dayDurationSec)).toBe('about 2.5 h')
    const line = planLine(p, { campaign: true })
    expect(line).toMatch(/^Today: 19 of 100 sent · next email now · at 1–2 min gaps, 100 emails take about 2\.5 h · the remaining 182 in this campaign finish ~Wed 4 Nov /)
  })

  it('100 a day with 20-min gaps in a 2-hour window: only 6 fit — warned', () => {
    const s = { ...OWNER, window: { ...OWNER.window, from: '09:00', to: '11:00' }, minDelaySec: 1200, maxDelaySec: 1200 }
    const p = sched.livePlan({ now: D(11, 2, 8, 0), settings: s, sendTimes: [], remaining: 50 })
    expect(p.fitPerDay).toBe(6)
    expect(p.today).toBe(6)
    expect(p.warnings).toContainEqual(expect.objectContaining({ kind: 'hours', fit: 6, limit: 100 }))
    expect(warningText(p.warnings[0])).toMatch(/^Only about 6 emails fit in 2 h of sending hours at ~20 min gaps — fewer than the 100 a day you set/)
  })

  it('3 a day per organisation with most contacts in 4 organisations: how many can go today', () => {
    const domains = [...Array.from({ length: 46 }, (_, i) => `o${i % 4}.gov.bd`), 'a@gmail.com'.split('@')[1], '', 'x.example.org', 'y.example.org']
    const p = sched.livePlan({ now: now0, settings: OWNER, sendTimes: [], remaining: 50, domains })
    // 4 organisations × 3 + gmail + unknown (no organisation limit) + 2 other organisations × 3 (1 each left)
    expect(p.today).toBe(4 * 3 + 2 + 2)
    const w = p.warnings.find((x: any) => x.kind === 'org')
    // the two one-contact organisations do not hold anything back: the warning names the four crowded ones
    expect(w).toMatchObject({ today: 16, remaining: 50, inOrgs: 46, orgs: 4, orgMax: 3, orgGapMin: 20 })
    expect(warningText(w)).toBe('46 of the 50 remaining contacts are in 4 organisations — at 3 a day each, 20 min apart, only 16 can go today.')
  })

  it('a full day: next email tomorrow at the window opening; warm-up and the ceiling are warned', () => {
    const sendTimes = Array.from({ length: 100 }, (_, i) => D(11, 2, 9, 0) + i * 60_000)
    const p = sched.livePlan({ now: D(11, 2, 12, 0), settings: OWNER, sendTimes, remaining: 10 })
    expect(p).toMatchObject({ roomToday: 0, limitedBy: 'day', nextAt: D(11, 3, 9, 0), today: 0 })
    const q = sched.livePlan({ now: D(11, 2, 12, 0), settings: { ...OWNER, ramp: true, dailyLimit: 450 }, sendDays: 2, sendTimes: [], remaining: 0 })
    // 12 h at ~90 s gaps fits 480, so 450 a day fits the hours; the ceiling and the warm-up do not
    expect(q.warnings.map((x: any) => x.kind)).toEqual(['ceiling', 'ramp'])
    expect(q.limitToday).toBe(50)
  })
})

describe('D — old settings migrate safely', () => {
  it("the editor's file loads unchanged (plus the new ceiling); an old 'auto' file becomes the fixed gap with its numbers", () => {
    const f = path.join(dir, 'outreach-autopilot.json')
    const owner = { ...OWNER, contactCooldownDays: 30, traySending: true, aiAutonomy: 'confirm', aiReadsReply: false, autoResume: true, legacyBackfilled: true, pacingMigrated: true, orgLimitLifted: true, sharedUpdatedAt: 1793595832739 }
    delete (owner as any).gmailCeiling24h
    fs.writeFileSync(f, JSON.stringify(owner))
    const got = createSettingsManager({ dir }).get()
    expect(got).toMatchObject({ dailyLimit: 100, minDelaySec: 60, maxDelaySec: 120, pace: 'manual', window: OWNER.window, domainMaxPerDay: 3, domainMinGapSec: 1200, aiAutonomy: 'confirm', sharedUpdatedAt: 1793595832739, gmailCeiling24h: 400 })
    expect(JSON.parse(fs.readFileSync(f, 'utf8')).gmailCeiling24h).toBe(400)

    const d2 = path.join(dir, 'old')
    fs.mkdirSync(d2)
    fs.writeFileSync(path.join(d2, 'outreach-autopilot.json'), JSON.stringify({ ...DEFAULT_SETTINGS, pace: 'auto', minDelaySec: 240, maxDelaySec: 600, dailyLimit: 80 }))
    const m2 = createSettingsManager({ dir: d2 })
    expect(m2.get()).toMatchObject({ pace: 'manual', minDelaySec: 240, maxDelaySec: 600, dailyLimit: 80 })
    expect(JSON.parse(fs.readFileSync(path.join(d2, 'outreach-autopilot.json'), 'utf8')).pace).toBe('manual')
    // a value from an older PC through sync is also read as the fixed gap; the ceiling is bounded
    expect(m2.save({ pace: 'auto' }).settings.pace).toBe('manual')
    expect(m2.save({ gmailCeiling24h: 10 }).ok).toBe(false)
    expect(m2.save({ gmailCeiling24h: 1500 }).ok).toBe(true)
  })
})

describe('E — the Activity log', () => {
  it('an object where text is expected (the 2026-11-01 settings.migrated event) is dropped, not rendered', () => {
    const ev = displaySafe({ id: 'x', t: 1, type: 'settings.migrated', what: 'pacing', from: { a: 1 }, to: { minDelaySec: 60 } as any, source: 'outreach-smtp.json' })
    expect(ev.to).toBeUndefined()
    expect(describeEvent(ev)).toBe('Sending settings updated by an app update')
    expect(displaySafe({ id: 'y', t: 2, type: 'send.ok', email: 'a@example.org', name: 7 as any, code: { x: 1 } as any }).name).toBe('7')
    expect(displaySafe({ t: 3, type: { bad: 1 } } as any).type).toBe('unknown')
  })

  it('50,000 events: "All time" reads the files once, then answers from memory', () => {
    const lines: string[] = []
    const t0 = Date.UTC(2026, 6, 1)
    for (let i = 0; i < 50000; i++) lines.push(JSON.stringify({ id: `e${i}`, t: t0 + i * 200_000, type: 'send.ok', email: `p${i}@o${i % 400}.example.org` }))
    const byMonth: Record<string, string[]> = {}
    for (const l of lines) { const t = JSON.parse(l).t; const d = new Date(t); const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; (byMonth[k] ??= []).push(l) }
    for (const [k, ls] of Object.entries(byMonth)) fs.writeFileSync(path.join(dir, `outreach-events-${k}.jsonl`), ls.join('\n') + '\n')
    const log = createEventLog({ dir, clock: () => t0 + 50000 * 200_000 })
    const first = log.read({ from: 0, limit: 200 })
    expect(first.events).toHaveLength(200)
    expect(first.hasMore).toBe(true)
    const a = performance.now()
    for (let i = 0; i < 20; i++) log.read({ from: 0, limit: 200 })
    expect((performance.now() - a) / 20).toBeLessThan(10)
    // an append is seen by the next All read without re-reading
    log.append({ type: 'send.ok', email: 'new@example.org' })
    expect(log.read({ from: 0, limit: 1 }).events[0].email).toBe('new@example.org')
  })
})
