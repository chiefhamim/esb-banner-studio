// 2026-11-09 Outreach audit fixes: one event per inbox message, unique-address stats, remote bounces/replies into the
// log, dry runs never marking sent, per-organisation overrides, the bounce circuit breaker.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { project } from '../../src/outreach/reconcile'
import { newCampaign } from '../../src/outreach/outreachStore'
import { applySendRows } from '../../src/outreach/cloudMerge'
import { parseDomainOverrides } from '../../src/outreach/activityFormat'

const require = createRequire(import.meta.url)
const { createEventLog } = require('../../electron/outreach-events.cjs')
const { computeStats } = require('../../electron/outreach-stats.cjs')
const { pickNext } = require('../../electron/outreach-schedule.cjs')
const { validateSettings } = require('../../electron/outreach-settings.cjs')
const { validateRemoteSends } = require('../../electron/outreach-guard.cjs')
const { createJobStore } = require('../../electron/outreach-jobs.cjs')
const { createEngine } = require('../../electron/outreach-engine.cjs')

let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outreach-integrity-')) })
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* temp */ } })

const NOW = Date.UTC(2026, 10, 9, 6)

describe('inbox events: one per message, at the message’s own time', () => {
  it('a reply / bounce re-read on the next check is not logged again — also after a restart', () => {
    const log = createEventLog({ dir, clock: () => NOW })
    const at = NOW - 3 * 3600_000
    expect(log.append({ type: 'bounce', email: 'X@example.com', at, t: at, reason: '550' })).toBeTruthy()
    expect(log.append({ type: 'bounce', email: 'x@example.com', at, t: at, reason: '550' })).toBeNull()
    expect(log.append({ type: 'reply', email: 'y@example.com', at, t: at, auto: false })).toBeTruthy()
    const again = createEventLog({ dir, clock: () => NOW })
    expect(again.append({ type: 'reply', email: 'y@example.com', at, t: at, auto: false })).toBeNull()
    // a different message from the same address is a new event
    expect(again.append({ type: 'reply', email: 'y@example.com', at: at + 60_000, t: at + 60_000, auto: false })).toBeTruthy()
    const evs = again.read({ types: ['reply', 'bounce'], limit: 100 }).events
    expect(evs).toHaveLength(3)
    expect(evs.find((e: any) => e.type === 'bounce').t).toBe(at)
  })
  it('stats count unique addresses: re-logged replies/bounces from older builds, failures per attempt', () => {
    const t = NOW - 3600_000
    const events = [
      { type: 'send.ok', email: 'a@example.com', t }, { type: 'send.ok', email: 'b@example.com', t }, { type: 'send.ok', email: 'c@example.com', t },
      { type: 'bounce', email: 'a@example.com', t: t + 1 }, { type: 'bounce', email: 'a@example.com', t: t + 2 }, { type: 'bounce', email: 'A@example.com', t: t + 3 },
      { type: 'reply', email: 'b@example.com', auto: false, t: t + 4 }, { type: 'reply', email: 'b@example.com', auto: false, t: t + 5 },
      { type: 'send.fail', email: 'c@example.com', t: t + 6 }, { type: 'send.fail', email: 'c@example.com', t: t + 7 },
    ]
    const s = computeStats(events, [], { from: 0, to: NOW })
    expect(s.totals).toMatchObject({ bounced: 1, replied: 1, failed: 2, failedUnique: 1 })
  })
})

describe('cloud rows: bounces and replies read on the other PC reach this PC’s log', () => {
  it('applySendRows hands bounced/replied rows to main, with the message id of a remote send', () => {
    const c = newCampaign({ id: 'cmp-r' })
    const rows: any[] = [
      { id: 'cmp-r:campaign:a@example.com', campaign_id: 'cmp-r', email: 'a@example.com', kind: 'campaign', status: 'bounced', detail: '550 no such user', message_key: null, message_id: '<m1@x>', at: '2026-11-08T06:00:00Z', pc: 'OTHER#aaaaaaaa' },
      { id: 'cmp-r:campaign:b@example.com', campaign_id: 'cmp-r', email: 'b@example.com', kind: 'campaign', status: 'sent', detail: null, message_key: null, message_id: '<m2@x>', at: '2026-11-08T06:00:00Z', pc: 'OTHER#aaaaaaaa' },
    ]
    const res = applySendRows([c], rows, 'ME#bbbbbbbb')
    expect(res.ledger).toEqual(expect.arrayContaining([
      expect.objectContaining({ email: 'a@example.com', status: 'bounced', detail: '550 no such user' }),
      expect.objectContaining({ email: 'b@example.com', messageId: '<m2@x>' }),
    ]))
  })
  it('the guard accepts sent / bounced / replied, refuses anything else', () => {
    const at = Date.now() - 3600_000
    const g = validateRemoteSends([
      { email: 'a@example.com', kind: 'campaign', campaignId: 'c1', at, status: 'bounced', detail: 'gone\nnow' },
      { email: 'a@example.com', kind: 'campaign', campaignId: 'c1', at, messageId: '<id@x>' },
      { email: 'b@example.com', kind: 'campaign', campaignId: 'c1', at, status: 'deleted' },
    ])
    expect(g.ok).toBe(true)
    expect(g.rejected).toBe(1)
    expect(g.entries).toEqual([
      { email: 'a@example.com', kind: 'campaign', campaignId: 'c1', at, status: 'bounced', detail: 'gone now' },
      { email: 'a@example.com', kind: 'campaign', campaignId: 'c1', at, messageId: '<id@x>' },
    ])
  })
})

describe('reconcile: a dry run never marks anything', () => {
  it('ignores dry send.ok / bounce / reply', () => {
    const c = newCampaign({ id: 'c-dry' })
    const next = project({ campaigns: [c], optOut: [], bouncedAddrs: {} }, [
      { id: '1', t: 5, type: 'send.ok', campaignId: 'c-dry', email: 'a@example.com', run: 'first', dry: true },
      { id: '2', t: 6, type: 'bounce', email: 'a@example.com', dry: true },
    ] as any)
    expect(next.campaigns[0].sent).toEqual({})
    expect(next.bouncedAddrs).toEqual({})
  })
})

describe('per-organisation overrides', () => {
  const msgs = [{ to: 'x@big.gov.bd' }, { to: 'y@small.gov.bd' }]
  const stats = new Map([['big.gov.bd', { lastSentAt: 0, countToday: 3, resetAt: NOW + 3600_000 }], ['small.gov.bd', { lastSentAt: 0, countToday: 3, resetAt: NOW + 7200_000 }]])
  it('a domain with a higher limit keeps going; the rest wait with how many are held', () => {
    expect(pickNext(msgs, [], NOW, stats, { domainMaxPerDay: 3, domainMinGapSec: 0, domainOverrides: { 'big.gov.bd': 10 } })).toMatchObject({ index: 0 })
    const w = pickNext(msgs, [], NOW, stats, { domainMaxPerDay: 3, domainMinGapSec: 0 })
    expect(w).toMatchObject({ waiting: 'domain', kind: 'limit', domain: 'big.gov.bd', domainsHeld: 2, earliestAt: NOW + 3600_000 })
  })
  it('settings validate the map; the dialog parses "domain = N" lines', () => {
    expect(validateSettings({ domainOverrides: { 'BPDB.gov.bd': 10 } }).cleaned.domainOverrides).toEqual({ 'bpdb.gov.bd': 10 })
    expect(validateSettings({ domainOverrides: { 'not a domain': 3 } }).valid).toBe(false)
    expect(validateSettings({ domainOverrides: { 'a.com': 0 } }).valid).toBe(false)
    expect(parseDomainOverrides('bpdb.gov.bd = 10\nnesco.gov.bd: 5\nnonsense')).toEqual({ map: { 'bpdb.gov.bd': 10, 'nesco.gov.bd': 5 }, bad: ['nonsense'] })
  })
})

describe('bounce circuit breaker', () => {
  it('pauses a job over 3% bounces after ≥30 sends; resuming re-pauses only on a new bounce', () => {
    const now = NOW
    const events = createEventLog({ dir, clock: () => now })
    const jobs = createJobStore({ dir, clock: () => now })
    const engine = createEngine({
      clock: () => now, setTimer: () => 0, clearTimer: () => {}, events, jobs,
      settings: { get: () => ({ window: { enabled: false }, dailyLimit: 100, domainMaxPerDay: 50, domainMinGapSec: 0, minDelaySec: 1, maxDelaySec: 1, contactCooldownDays: 30 }), set: () => {} },
      mailer: { send: async () => ({ ok: true }), status: () => ({}) }, online: async () => true, emit: () => {}, env: {},
    })
    const messages = Array.from({ length: 40 }, (_, i) => ({ to: `p${i}@example${i}.com`, subject: 'S', body: 'B' }))
    engine.submit({ campaignId: 'cb', campaignName: 'CB', messages })
    const job = jobs.list()[0]
    job.state.sent = Array.from({ length: 40 }, (_, i) => i)
    job.status = 'waiting'
    events.append({ type: 'bounce', email: 'p1@example1.com', at: now - 10, t: now - 10 })
    expect(engine.checkBounces()).toEqual([]) // 1/40 = 2.5%
    events.append({ type: 'bounce', email: 'p2@example2.com', at: now - 9, t: now - 9 })
    expect(engine.checkBounces()).toEqual([job.id]) // 2/40 = 5%
    expect(engine.snapshot()[0]).toMatchObject({ status: 'paused', reason: 'bounces' })
    engine.control(job.id, 'resume')
    expect(engine.checkBounces()).toEqual([])
    events.append({ type: 'bounce', email: 'p3@example3.com', at: now - 8, t: now - 8 })
    expect(engine.checkBounces()).toEqual([job.id])
  })
})
