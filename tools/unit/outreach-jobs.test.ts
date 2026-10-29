import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { createJobStore } = require('../../electron/outreach-jobs.cjs')

describe('outreach-jobs: job store & atomic state persistence (§4.3)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outreach-jobs-test-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {}
  })

  it('create writes both .messages.jsonl and .state.json, reload restores identical state', () => {
    const store = createJobStore({ dir: tmpDir, clock: () => 1730000000000 })

    const spec = {
      campaignId: 'cmp-123',
      campaignName: 'Test Campaign',
      kind: 'first' as const,
      shared: { signature: 'Best regards', lang: 'en' as const, letterhead: true, officialPad: false },
      attachments: [{ name: 'doc.pdf', dataUrl: 'data:application/pdf;base64,AAA=' }],
      messages: [
        { to: 'user1@example.com', subject: 'Hi User 1', body: 'Hello 1', optOut: 'Unsub' },
        { to: 'user2@example.com', subject: 'Hi User 2', body: 'Hello 2', optOut: 'Unsub' },
      ],
      startAt: null,
      autoResume: true,
    }

    const job = store.create(spec)
    expect(job.id).toBeDefined()
    expect(job.total).toBe(2)

    const mFile = path.join(tmpDir, 'outreach-jobs', `${job.id}.messages.jsonl`)
    const sFile = path.join(tmpDir, 'outreach-jobs', `${job.id}.state.json`)

    expect(fs.existsSync(mFile)).toBe(true)
    expect(fs.existsSync(sFile)).toBe(true)

    // Reload with fresh store
    const store2 = createJobStore({ dir: tmpDir })
    const loaded = store2.load()
    expect(loaded).toHaveLength(1)
    const reloadedJob = loaded[0]

    expect(reloadedJob.id).toBe(job.id)
    expect(reloadedJob.campaignId).toBe('cmp-123')
    expect(reloadedJob.total).toBe(2)
    expect(reloadedJob.messages).toHaveLength(2)
    expect(reloadedJob.messages[0].to).toBe('user1@example.com')
  })

  it('ignores half-written .state.json.tmp files during load', () => {
    const jobsDir = path.join(tmpDir, 'outreach-jobs')
    fs.mkdirSync(jobsDir, { recursive: true })

    fs.writeFileSync(path.join(jobsDir, 'job-incomplete.state.json.tmp'), '{"id":"bad-incomplete', 'utf8')

    const store = createJobStore({ dir: tmpDir })
    const loaded = store.load()
    expect(loaded).toHaveLength(0)
  })

  it('saveState debounce coalesces 1,000 calls into <= 2 writes', () => {
    let pendingTimer: (() => void) | null = null
    const fakeSetTimeout = (fn: () => void) => {
      pendingTimer = fn
      return 1 as any
    }
    const fakeClearTimeout = () => {
      pendingTimer = null
    }

    const store = createJobStore({
      dir: tmpDir,
      setTimeout: fakeSetTimeout,
      clearTimeout: fakeClearTimeout,
    })

    const job = store.create({
      campaignId: 'c1',
      messages: [{ to: 'u@example.com', subject: 's', body: 'b', optOut: 'o' }],
    })
    const initialWrites = store.getWriteCount() // 1 from create

    // 1,000 rapid calls to saveState without force
    for (let i = 0; i < 1000; i++) {
      job.state.sent.push(i)
      store.saveState(job)
    }

    expect(store.getWriteCount()).toBe(initialWrites) // still debounced, not written yet

    // Trigger timer
    if (pendingTimer) {
      ;(pendingTimer as () => void)()
    }

    expect(store.getWriteCount()).toBe(initialWrites + 1) // Exactly 1 coalesce write!
  })

  it('performance: 20,000 messages create in < 3 s and load in < 2 s', () => {
    const store = createJobStore({ dir: tmpDir })

    const messages = []
    for (let i = 0; i < 20000; i++) {
      messages.push({
        to: `user${i}@org${i % 100}.example.com`,
        subject: `Executive update ${i}`,
        body: `Dear Contact ${i}, here is the verified sector intelligence brief.`,
        optOut: 'Reply unsubscribe to opt out.',
      })
    }

    const t0 = performance.now()
    const job = store.create({
      campaignId: 'cmp-large',
      campaignName: 'Large Batch 20K',
      messages,
    })
    const createElapsed = performance.now() - t0
    expect(createElapsed).toBeLessThan(3000)

    const t1 = performance.now()
    const store2 = createJobStore({ dir: tmpDir })
    const loaded = store2.load()
    const loadElapsed = performance.now() - t1

    expect(loaded).toHaveLength(1)
    expect(loaded[0].total).toBe(20000)
    expect(loadElapsed).toBeLessThan(2000)
  })
})
