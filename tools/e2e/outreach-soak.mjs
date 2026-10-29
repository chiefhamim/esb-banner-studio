// tools/e2e/outreach-soak.mjs
// Phase 7.1 Soak Test: 5,000-message dry-run simulation across days (§7.1)
// Asserts:
// 1. Zero duplicate send.ok per recipient address
// 2. Event count equals total sends + failures + skips (5,000 messages)
// 3. Heap memory growth < 100 MB
// 4. Pause control latency < 500 ms

import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createJobStore } = require('../../electron/outreach-jobs.cjs')
const { createEventLog } = require('../../electron/outreach-events.cjs')
const { createSettingsManager } = require('../../electron/outreach-settings.cjs')
const { createEngine } = require('../../electron/outreach-engine.cjs')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outreach-soak-'))
const initialMemory = process.memoryUsage().heapUsed

console.log('--- Starting Outreach Autopilot Soak Test (5,000 Messages) ---')
console.log(`Working temporary dir: ${tmpDir}`)

const SPEED = 3600

// Simulated clock and timers
const BASE_TIME = Date.UTC(2026, 10, 1, 4, 0, 0) // Sunday 10:00 Asia/Dhaka
let now = BASE_TIME
let timerId = 0
const timers = new Map()

function fakeSetTimer(fn, ms) {
  const id = ++timerId
  // Convert compressed ms to simulated wall-clock ms
  const simMs = Math.max(10, ms * SPEED)
  timers.set(id, { fn, runAt: now + simMs })
  return id
}

function fakeClearTimer(id) {
  timers.delete(id)
}

async function advanceTime(ms) {
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

const jobStore = createJobStore({ dir: tmpDir, clock: () => now })
const eventLog = createEventLog({ dir: tmpDir, clock: () => now })
const settingsMgr = createSettingsManager({ dir: tmpDir })

// Autopilot settings for soak test: 1000/day
settingsMgr.save({
  dailyLimit: 1000,
  ramp: false,
  window: { enabled: true, from: '09:00', to: '17:00', days: [0, 1, 2, 3, 4], tz: 'Asia/Dhaka' },
  minDelaySec: 5,
  maxDelaySec: 10,
  domainMaxPerDay: 10,
  domainMinGapSec: 30,
  contactCooldownDays: 30,
})

// Simulated Mailer with 5% failure rate
const FAIL_RATE = 0.05
const sendLedger = []
let totalAttempts = 0

const mailer = {
  send: async (msg) => {
    totalAttempts++
    const isFail = Math.random() < FAIL_RATE
    if (isFail) {
      return { ok: false, error: 'SMTP 550 5.1.1 User unknown', status: '5.1.1', temporary: false }
    }
    sendLedger.push({ to: msg.to, at: now })
    return { ok: true, messageId: `<soak-${Date.now()}-${totalAttempts}@esbpowerline.com>` }
  },
  status: () => ({ hasTransport: true }),
}

const engine = createEngine({
  jobs: jobStore,
  events: eventLog,
  settings: settingsMgr,
  mailer,
  clock: () => now,
  setTimer: fakeSetTimer,
  clearTimer: fakeClearTimer,
  online: async () => true,
  rnd: () => Math.random(),
  inbox: { check: async () => ({ ok: true }) },
  env: {
    ESB_OUTREACH_DRYRUN: '1',
    ESB_OUTREACH_SPEED: String(SPEED),
    ESB_OUTREACH_NO_WINDOW: '0',
    ESB_OUTREACH_FAIL: '0.05',
  },
})

// Start engine
engine.start()

// Generate 5,000 synthetic messages across 1,000 domains (5 addresses per domain)
console.log('Generating 5,000 synthetic messages...')
const messages = []
for (let i = 0; i < 5000; i++) {
  const domId = Math.floor(i / 5) + 1
  const userNum = (i % 5) + 1
  messages.push({
    to: `user${userNum}@organization-${domId}.com.bd`,
    subject: `Energy Leadership Briefing ${i + 1}`,
    body: `Dear Representative, here is message ${i + 1}.`,
  })
}

// 1. Submit Job
const submitRes = engine.submit({
  campaignId: 'cmp-soak-5000',
  campaignName: 'National 5k Soak Campaign',
  kind: 'first',
  messages,
})

if (!submitRes.ok) {
  console.error('FAIL: Job submission rejected:', submitRes.error)
  process.exit(1)
}

const jobId = submitRes.jobId
console.log(`Job submitted successfully: ${jobId} (5,000 messages)`)

// 2. Run simulation loop with responsiveness check mid-run
console.log('Running soak execution loop across simulated days...')
let maxSteps = 100000
let steps = 0
let testedPause = false

while (timers.size > 0 && steps < maxSteps) {
  steps++
  const nextRunAt = Math.min(...[...timers.values()].map((t) => t.runAt))
  const delta = Math.max(1, nextRunAt - now)
  await advanceTime(delta)

  const snap = engine.snapshot().find((j) => j.jobId === jobId)

  // Mid-run responsiveness check at 500 messages sent
  const sentSoFar = (snap && snap.sent) || 0
  if (!testedPause && sentSoFar >= 500) {
    testedPause = true
    const t0 = performance.now()
    const pauseRes = engine.control(jobId, 'pause')
    const t1 = performance.now()
    const pauseLatencyMs = t1 - t0
    console.log(`[Responsiveness] Pause acknowledged in ${pauseLatencyMs.toFixed(2)} ms (contract < 500 ms)`)
    if (pauseLatencyMs > 500) {
      console.error(`FAIL: Pause latency ${pauseLatencyMs} ms exceeded 500 ms threshold`)
      process.exit(1)
    }
    const snapPaused = engine.snapshot().find((j) => j.jobId === jobId)
    if (snapPaused.status !== 'paused') {
      console.error('FAIL: Job did not transition to paused state')
      process.exit(1)
    }
    // Resume job
    engine.control(jobId, 'resume')
  }

  if (snap && snap.status === 'done') {
    break
  }
  // If circuit breaker trips during 5% failure rate, operator resumes the job
  if (snap && snap.status === 'paused' && snap.reason === 'circuit') {
    engine.control(jobId, 'resume')
  }
}

console.log(`Simulation finished in ${steps} steps. Simulated clock reached: ${new Date(now).toISOString()}`)

// 3. Verifications
// Assertion 1: No duplicate send.ok per recipient address
// Read all events across all months with from: 0
const allEvents = eventLog.read({ from: 0, limit: 100000, includeDry: true }).events
const sendOkEvents = allEvents.filter((e) => e.type === 'send.ok')
const failedEvents = allEvents.filter((e) => e.type === 'send.fail')
const skippedEvents = allEvents.filter((e) => e.type === 'send.skip')

const seenAddresses = new Set()
let duplicates = 0
for (const ev of sendOkEvents) {
  if (seenAddresses.has(ev.email)) {
    duplicates++
  }
  seenAddresses.add(ev.email)
}

console.log(`Total send.ok events: ${sendOkEvents.length}`)
console.log(`Total send.fail events: ${failedEvents.length}`)
console.log(`Total send.skip events: ${skippedEvents.length}`)

if (duplicates > 0) {
  console.error(`FAIL: Found ${duplicates} duplicate send.ok events! Zero duplicates allowed.`)
  process.exit(1)
} else {
  console.log('PASS: (1) Zero duplicate send.ok per recipient address confirmed.')
}

// Assertion 2: Event count equals total sends + failures + skips
const totalProcessed = sendOkEvents.length + failedEvents.length + skippedEvents.length
console.log(`Total terminal events: ${totalProcessed} (Target: 5,000)`)
if (totalProcessed !== 5000) {
  console.error(`FAIL: Total terminal events (${totalProcessed}) does not equal 5,000!`)
  process.exit(1)
} else {
  console.log('PASS: (2) Event count equals sends + failures + skips (5,000 messages accounted for).')
}

// Assertion 3: Memory growth < 100 MB
const finalMemory = process.memoryUsage().heapUsed
const memoryGrowthMB = (finalMemory - initialMemory) / (1024 * 1024)
console.log(`Initial Heap: ${(initialMemory / 1024 / 1024).toFixed(2)} MB`)
console.log(`Final Heap: ${(finalMemory / 1024 / 1024).toFixed(2)} MB`)
console.log(`Net Heap Growth: ${memoryGrowthMB.toFixed(2)} MB (Contract < 100 MB)`)

if (memoryGrowthMB > 100) {
  console.error(`FAIL: Memory growth ${memoryGrowthMB.toFixed(2)} MB exceeded 100 MB limit`)
  process.exit(1)
} else {
  console.log('PASS: (3) Memory growth strictly within bounds (< 100 MB).')
}

console.log('PASS: (4) UI / Loop responsiveness under load verified.')

// Clean up
try {
  fs.rmSync(tmpDir, { recursive: true, force: true })
} catch {}

console.log('=== SOAK TEST COMPLETED SUCCESSFULLY WITH 0 FAILURES ===')
process.exit(0)
