import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { createEventLog, monthKeyOf } = require('../../electron/outreach-events.cjs')

describe('outreach-events: append-only log & suppression fold', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outreach-events-test-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {}
  })

  it('append -> read round trip and order (newest first)', () => {
    let now = 1730000000000
    const log = createEventLog({ dir: tmpDir, clock: () => now })

    const e1 = log.append({ type: 'job.created', jobId: 'job-1', name: 'First Campaign' })
    now += 1000
    const e2 = log.append({ type: 'send.ok', jobId: 'job-1', email: 'test1@example.com' })
    now += 1000
    const e3 = log.append({ type: 'send.ok', jobId: 'job-1', email: 'test2@example.com' })

    const res = log.read()
    expect(res.events).toHaveLength(3)
    expect(res.events[0].id).toBe(e3.id)
    expect(res.events[1].id).toBe(e2.id)
    expect(res.events[2].id).toBe(e1.id)
    expect(res.hasMore).toBe(false)
  })

  it('filters by types, jobId, campaignId, email, search query and dry flag', () => {
    const log = createEventLog({ dir: tmpDir })
    log.append({ type: 'job.created', jobId: 'j1', campaignId: 'c1', name: 'Launch' })
    log.append({ type: 'send.ok', jobId: 'j1', campaignId: 'c1', email: 'alice@example.com', name: 'Alice' })
    log.append({ type: 'send.fail', jobId: 'j1', campaignId: 'c1', email: 'bob@example.com', error: 'No DNS', kind: 'recipient_permanent' })
    log.append({ type: 'send.ok', jobId: 'j2', campaignId: 'c2', email: 'carol@example.com', dry: true })

    expect(log.read({ types: ['send.ok'] }).events).toHaveLength(2)
    expect(log.read({ jobId: 'j1' }).events).toHaveLength(3)
    expect(log.read({ campaignId: 'c2' }).events).toHaveLength(1)
    expect(log.read({ email: 'ALICE@EXAMPLE.COM' }).events).toHaveLength(1)
    expect(log.read({ q: 'Alice' }).events).toHaveLength(1)
    expect(log.read({ includeDry: false }).events).toHaveLength(3)
  })

  it('paging stability with before parameter', () => {
    let t = 1000
    const log = createEventLog({ dir: tmpDir, clock: () => (t += 10) })
    const created: string[] = []
    for (let i = 0; i < 10; i++) {
      const e = log.append({ type: 'send.ok', email: `user${i}@example.com` })
      created.push(e.id)
    }

    const page1 = log.read({ limit: 4 })
    expect(page1.events).toHaveLength(4)
    expect(page1.hasMore).toBe(true)

    const lastId = page1.events[page1.events.length - 1].id
    const page2 = log.read({ limit: 4, before: lastId })
    expect(page2.events).toHaveLength(4)
    expect(page2.hasMore).toBe(true)

    // IDs between page 1 and page 2 must be disjoint
    const p1Ids = new Set(page1.events.map((e: any) => e.id))
    for (const e of page2.events) {
      expect(p1Ids.has(e.id)).toBe(false)
    }
  })

  it('writes into monthly rollover files', () => {
    const tJan = Date.UTC(2026, 0, 15, 12, 0, 0)
    const tFeb = Date.UTC(2026, 1, 15, 12, 0, 0)

    let current = tJan
    const log = createEventLog({ dir: tmpDir, clock: () => current })

    log.append({ type: 'send.ok', email: 'jan@example.com' })
    current = tFeb
    log.append({ type: 'send.ok', email: 'feb@example.com' })

    const janFile = path.join(tmpDir, 'outreach-events-2026-01.jsonl')
    const febFile = path.join(tmpDir, 'outreach-events-2026-02.jsonl')

    expect(fs.existsSync(janFile)).toBe(true)
    expect(fs.existsSync(febFile)).toBe(true)
    expect(fs.readFileSync(janFile, 'utf8')).toContain('jan@example.com')
    expect(fs.readFileSync(febFile, 'utf8')).toContain('feb@example.com')
  })

  it('tolerates corrupt lines and counts them without throwing', () => {
    const janFile = path.join(tmpDir, 'outreach-events-2026-01.jsonl')
    fs.writeFileSync(
      janFile,
      '{"id":"e1","t":1000,"type":"send.ok","email":"ok@example.com"}\n' +
      '{corrupt json line\n' +
      '{"id":"e2","t":1001,"type":"send.ok","email":"ok2@example.com"}\n',
      'utf8'
    )

    const log = createEventLog({ dir: tmpDir, clock: () => 2000 })
    expect(log.getBadLinesCount()).toBe(1)
    const res = log.read()
    expect(res.events).toHaveLength(2)
    expect(res.events.map((e: any) => e.email)).toEqual(['ok2@example.com', 'ok@example.com'])
  })

  it('suppression fold correctly handles optout on/off, bounce, permanent and policy fail', () => {
    const log = createEventLog({ dir: tmpDir })

    const supp = log.suppression()

    // 1. Opt out on
    log.append({ type: 'optout', email: 'user1@example.com', on: true })
    expect(supp.has('user1@example.com')).toBe(true)

    // 2. Opt out turned off (user re-subscribed)
    log.append({ type: 'optout', email: 'user1@example.com', on: false })
    expect(supp.has('user1@example.com')).toBe(false)

    // 3. Bounce
    log.append({ type: 'bounce', email: 'bounce@example.com', reason: '550 User unknown' })
    expect(supp.has('bounce@example.com')).toBe(true)

    // 4. Permanent failure
    log.append({ type: 'send.fail', email: 'perm@example.com', kind: 'recipient_permanent' })
    expect(supp.has('perm@example.com')).toBe(true)

    // 5. Policy failure
    log.append({ type: 'send.fail', email: 'policy@example.com', kind: 'policy' })
    expect(supp.has('policy@example.com')).toBe(true)

    // 6. Transient / ordinary failure does NOT suppress
    log.append({ type: 'send.fail', email: 'transient@example.com', kind: 'recipient_transient' })
    expect(supp.has('transient@example.com')).toBe(false)

    // Case insensitivity
    expect(supp.has('BOUNCE@EXAMPLE.COM')).toBe(true)
  })

  it('performance: 10,000 appends + 3 reads in < 3 s', () => {
    let t = 1000000
    const log = createEventLog({ dir: tmpDir, clock: () => (t += 1) })

    const t0 = performance.now()
    for (let i = 0; i < 10000; i++) {
      log.append({
        type: 'send.ok',
        jobId: `job-${i % 5}`,
        email: `user${i}@domain${i % 10}.example.com`,
        ms: 120,
      })
    }

    const r1 = log.read({ limit: 100 })
    const r2 = log.read({ types: ['send.ok'], limit: 50 })
    const r3 = log.read({ q: 'domain3', limit: 20 })

    const elapsed = performance.now() - t0
    expect(r1.events).toHaveLength(100)
    expect(r2.events).toHaveLength(50)
    expect(r3.events).toHaveLength(20)
    expect(elapsed).toBeLessThan(3000)
  })
})
