// tools/e2e/outreach-crash.mjs
// Phase 7.2 Crash & Recovery Test (§7.2)
// Asserts:
// 1. Process killed mid-run auto-resumes on relaunch
// 2. Zero duplicate send.ok per address after recovery
// 3. Clean Quit preserves paused state with reason 'quit' and interrupted status

import { _electron as electron } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { execSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '../..')
const win = process.platform === 'win32'
const exe = path.join(root, 'node_modules', 'electron', 'dist', win ? 'electron.exe' : 'electron')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-crash-test-'))

console.log('--- Starting Outreach Crash & Recovery Test ---')
console.log(`Profile dir: ${profile}`)

const launchApp = async () => {
  return electron.launch({
    executablePath: exe,
    args: [...(win ? [] : ['--no-sandbox']), root, '--user-data-dir=' + profile],
    env: {
      ...process.env,
      ESB_OUTREACH_DRYRUN: '1',
      ESB_OUTREACH_SPEED: '2400',
      ESB_OUTREACH_NO_WINDOW: '1',
      ESB_NO_SYNC: '1',
    },
  })
}

try {
  // === PART 1: Process Kill & Auto-Resume ===
  console.log('Launching app for Part 1 (Mid-run Kill)...')
  let app = await launchApp()
  let page = await app.firstWindow()
  await page.waitForSelector('.home-shell, .topbar', { timeout: 15000 })
  await page.waitForTimeout(500)

  // Configure settings: autoResume = true, dailyLimit = 500
  await page.evaluate(async () => {
    if (window.esb?.outreachSettingsSave) {
      await window.esb.outreachSettingsSave({ dailyLimit: 500, autoResume: true, ramp: false })
    }
  })

  // Submit 200-message job
  console.log('Submitting 200-message job...')
  const messages = []
  for (let i = 0; i < 200; i++) {
    messages.push({
      to: `recipient${i + 1}@crash-test-${i + 1}.org`,
      subject: `Crash Test Subject ${i + 1}`,
      body: `Body ${i + 1}`,
    })
  }

  const sub = await page.evaluate(async (msgs) => {
    return window.esb.outreachJobSubmit({
      campaignId: 'cmp-crash-200',
      campaignName: 'Crash Recovery Test',
      kind: 'first',
      autoResume: true,
      messages: msgs,
    })
  }, messages)

  if (!sub.ok) {
    console.error('FAIL: Job submission failed:', sub.error)
    process.exit(1)
  }
  const jobId = sub.jobId

  // Wait until ~30 messages sent
  console.log('Waiting until 30 messages are sent...')
  let sentCount = 0
  const t0 = Date.now()
  while (Date.now() - t0 < 10000) {
    const res = await page.evaluate(async () => {
      return window.esb.outreachEvents({ types: ['send.ok'], limit: 300, includeDry: true })
    })
    sentCount = res?.events?.length || 0
    if (sentCount >= 30) break
    await page.waitForTimeout(200)
  }
  console.log(`Sent ${sentCount} messages before crash. Now killing Electron process forcefully...`)

  // Kill the process forcefully (simulating unexpected power loss / crash)
  const electronPid = app.process().pid
  if (win) {
    try {
      execSync(`taskkill /F /T /PID ${electronPid}`, { stdio: 'ignore' })
    } catch {}
  } else {
    try {
      process.kill(electronPid, 'SIGKILL')
    } catch {}
  }

  // Wait for process to fully terminate
  await new Promise((r) => setTimeout(r, 1500))

  console.log('Relaunching Electron with same profile...')
  app = await launchApp()
  page = await app.firstWindow()
  await page.waitForSelector('.home-shell, .topbar', { timeout: 15000 })
  await page.waitForTimeout(1000)

  // Wait for auto-resume
  console.log('Checking auto-resume of interrupted job...')
  let snapAfterCrash = null
  const tResume = Date.now()
  while (Date.now() - tResume < 15000) {
    const jobs = await page.evaluate(async () => window.esb.outreachJobs())
    snapAfterCrash = jobs.find((j) => j.jobId === jobId)
    if (snapAfterCrash && (snapAfterCrash.status === 'running' || snapAfterCrash.status === 'waiting' || snapAfterCrash.status === 'done')) {
      break
    }
    await page.waitForTimeout(400)
  }

  console.log('Job status after crash relaunch:', snapAfterCrash?.status, `(sent: ${snapAfterCrash?.sent}/${snapAfterCrash?.total})`)
  if (!snapAfterCrash || (snapAfterCrash.status !== 'running' && snapAfterCrash.status !== 'waiting' && snapAfterCrash.status !== 'done')) {
    console.error('FAIL: Job did not auto-resume after crash!')
    process.exit(1)
  }
  console.log('PASS: (1) Interrupted job auto-resumed on relaunch.')

  // Wait for job completion
  console.log('Waiting for job completion...')
  const tFinish = Date.now()
  while (Date.now() - tFinish < 40000) {
    const jobs = await page.evaluate(async () => window.esb.outreachJobs())
    const j = jobs.find((x) => x.jobId === jobId)
    if (j && j.status === 'done') {
      snapAfterCrash = j
      break
    }
    await page.waitForTimeout(500)
  }

  // Verify zero duplicates
  const finalEvents = await page.evaluate(async () => {
    return window.esb.outreachEvents({ types: ['send.ok'], limit: 1000, includeDry: true })
  })
  const okList = finalEvents?.events || []
  const addrs = new Set()
  let dups = 0
  for (const ev of okList) {
    if (addrs.has(ev.email)) dups++
    addrs.add(ev.email)
  }

  console.log(`Total send.ok events recorded: ${okList.length}`)
  if (dups > 0) {
    console.error(`FAIL: Found ${dups} duplicate sends after recovery!`)
    process.exit(1)
  }
  console.log('PASS: (2) Zero duplicate send.ok per address confirmed after crash recovery.')

  // === PART 2: Clean Quit & Paused State Preservation ===
  console.log('--- Part 2: Clean Quit Test ---')
  console.log('Submitting 50-message job for clean quit test...')
  const messages50 = []
  for (let i = 0; i < 50; i++) {
    messages50.push({
      to: `clean${i + 1}@quit-test-${i + 1}.org`,
      subject: `Clean Quit Subject ${i + 1}`,
      body: `Body ${i + 1}`,
    })
  }

  const sub2 = await page.evaluate(async (msgs) => {
    return window.esb.outreachJobSubmit({
      campaignId: 'cmp-clean-quit-50',
      campaignName: 'Clean Quit Test',
      kind: 'first',
      autoResume: false,
      messages: msgs,
    })
  }, messages50)

  if (!sub2.ok) {
    console.error('FAIL: Job 2 submission failed:', sub2.error)
    process.exit(1)
  }
  const job2Id = sub2.jobId

  // Wait until ~5 messages are sent
  let sent2 = 0
  const t0Clean = Date.now()
  while (Date.now() - t0Clean < 10000) {
    const jobs = await page.evaluate(async () => window.esb.outreachJobs())
    const j2 = jobs.find((x) => x.jobId === job2Id)
    sent2 = (j2 && j2.sent) || 0
    if (sent2 >= 5) break
    await page.waitForTimeout(200)
  }
  console.log(`Sent ${sent2} messages. Now triggering clean app.close()...`)

  // Clean Quit
  await app.close()

  // Wait briefly for disk flushes
  await new Promise((r) => setTimeout(r, 1000))

  // Relaunch app
  console.log('Relaunching app after clean quit...')
  app = await launchApp()
  page = await app.firstWindow()
  await page.waitForSelector('.home-shell, .topbar', { timeout: 15000 })
  await page.waitForTimeout(500)

  // Verify job is paused with reason 'quit'
  const jobsAfterQuit = await page.evaluate(async () => window.esb.outreachJobs())
  const j2AfterQuit = jobsAfterQuit.find((x) => x.jobId === job2Id)
  console.log('Job status after clean quit relaunch:', j2AfterQuit?.status, 'reason:', j2AfterQuit?.reason)

  if (!j2AfterQuit || j2AfterQuit.status !== 'paused' || j2AfterQuit.reason !== 'quit') {
    console.error('FAIL: Job did not preserve paused state with reason "quit" after clean exit!')
    process.exit(1)
  }
  console.log('PASS: (3) Clean Quit preserved paused state with reason "quit".')

  // Resume the job and let it finish
  console.log('Resuming job to verify clean completion...')
  await page.evaluate(async (id) => {
    return window.esb.outreachJobControl(id, 'resume')
  }, job2Id)

  const tFinishClean = Date.now()
  let finalJ2 = null
  while (Date.now() - tFinishClean < 30000) {
    const jobs = await page.evaluate(async () => window.esb.outreachJobs())
    const j = jobs.find((x) => x.jobId === job2Id)
    if (j && j.status === 'done') {
      finalJ2 = j
      break
    }
    await page.waitForTimeout(400)
  }

  if (!finalJ2 || finalJ2.status !== 'done') {
    console.error('FAIL: Resumed clean quit job did not reach done status!')
    process.exit(1)
  }
  console.log(`PASS: (4) Resumed job completed cleanly (${finalJ2.sent}/${finalJ2.total} sent).`)

  await app.close().catch(() => {})
  console.log('=== CRASH & RECOVERY TEST PASSED SUCCESSFULLY ===')
} finally {
  try {
    fs.rmSync(profile, { recursive: true, force: true })
  } catch {}
}
