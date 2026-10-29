// Outreach Autopilot E2E Skeleton (§1.9)
// Verifies headless dry-run engine send loop through Electron bridge.

import { _electron as electron } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const root = path.resolve(import.meta.dirname, '../..')
const win = process.platform === 'win32'
const exe = path.join(root, 'node_modules', 'electron', 'dist', win ? 'electron.exe' : 'electron')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-autopilot-profile-'))

const app = await electron.launch({
  executablePath: exe,
  args: [...(win ? [] : ['--no-sandbox']), root, '--user-data-dir=' + profile],
  env: {
    ...process.env,
    ESB_OUTREACH_DRYRUN: '1',
    ESB_OUTREACH_SPEED: '600',
    ESB_OUTREACH_NO_WINDOW: '1',
    ESB_NO_SYNC: '1',
  },
})

const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

try {
  await page.waitForSelector('.topbar', { timeout: 15000 })
  await page.waitForTimeout(1000)

  // 1. Submit a 5-message dry-run job
  const subRes = await page.evaluate(async () => {
    const spec = {
      campaignId: 'e2e-autopilot-skeleton',
      campaignName: 'E2E Skeleton Run',
      kind: 'first',
      messages: [
        { to: 'recipient1@domain1.com', subject: 'Subject 1', body: 'Body 1' },
        { to: 'recipient2@domain2.com', subject: 'Subject 2', body: 'Body 2' },
        { to: 'recipient3@domain3.com', subject: 'Subject 3', body: 'Body 3' },
        { to: 'recipient4@domain4.com', subject: 'Subject 4', body: 'Body 4' },
        { to: 'recipient5@domain5.com', subject: 'Subject 5', body: 'Body 5' },
      ],
    }
    return window.esb.outreachJobSubmit(spec)
  })

  console.log(subRes && subRes.ok ? 'PASS' : 'FAIL', 'outreachJobSubmit submitted 5-message job', JSON.stringify(subRes))

  // 2. Poll until 5 send.ok events recorded
  let okEvents = []
  const startTime = Date.now()
  while (Date.now() - startTime < 15000) {
    const res = await page.evaluate(async () => {
      return window.esb.outreachEvents({ types: ['send.ok'], limit: 10, includeDry: true })
    })
    okEvents = (res && res.events) || []
    if (okEvents.length >= 5) break
    await page.waitForTimeout(500)
  }

  const allFive = okEvents.length === 5
  const allDry = okEvents.every((e) => e.dry === true)
  console.log(allFive && allDry ? 'PASS' : 'FAIL', 'asserted 5 dry-run send.ok events', `count: ${okEvents.length}`)

  // 3. Poll until job snapshot state is 'done'
  let snap = null
  const snapStart = Date.now()
  while (Date.now() - snapStart < 5000) {
    snap = await page.evaluate(async (jobId) => {
      const jobs = await window.esb.outreachJobs()
      return jobs.find((j) => j.jobId === jobId)
    }, subRes.jobId)
    if (snap && snap.status === 'done') break
    await page.waitForTimeout(200)
  }

  console.log(snap && snap.status === 'done' && snap.sent === 5 ? 'PASS' : 'FAIL', 'job snapshot completed as done', JSON.stringify(snap ? { status: snap.status, sent: snap.sent } : null))
  console.log(errors.length === 0 ? 'PASS' : 'FAIL', 'no console errors during run')
} finally {
  await app.close().catch(() => {})
  try {
    fs.rmSync(profile, { recursive: true, force: true })
  } catch {}
}
