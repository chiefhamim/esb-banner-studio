// The "next email" countdown must tick every second while a batch waits between sends, both in the status-bar
// Autopilot pill and in the open campaign's Send footer. Dry run (nothing is sent), pacing compressed.
// Usage: node tools/e2e/outreach-countdown-check.mjs   (run `npm run build` first; it drives the built app)
import { _electron as electron } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const root = path.resolve(import.meta.dirname, '../..')
const win = process.platform === 'win32'
const exe = path.join(root, 'node_modules', 'electron', 'dist', win ? 'electron.exe' : 'electron')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-countdown-profile-'))
const app = await electron.launch({
  executablePath: exe,
  args: [...(win ? [] : ['--no-sandbox']), root, '--user-data-dir=' + profile],
  env: { ...process.env, ESB_OUTREACH_DRYRUN: '1', ESB_OUTREACH_SPEED: '12', ESB_OUTREACH_NO_WINDOW: '1', ESB_NO_SYNC: '1' },
})
const page = await app.firstWindow()
let fails = 0
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++ }
const TIME = /\d+:\d{2}/

try {
  await page.waitForSelector('.home-shell, .topbar', { timeout: 15000 })
  const tile = page.locator('.launch-tile:has-text("Outreach")')
  if (await tile.count()) await tile.first().click(); else await page.click('.ws-btn[data-ws="outreach"]:visible')
  await page.waitForSelector('.outreach-workspace')
  // a real campaign on the desk, so the pill and the Send footer follow this job
  const newEmail = page.locator('button:has-text("New email")')
  if (await newEmail.count()) await newEmail.first().click()
  await page.waitForTimeout(800)
  const cid = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('esb-banner-studio/outreach/v2') || '{}').activeId || null } catch { return null } })
  check(!!cid, `campaign open on the desk (${cid})`)
  const res = await page.evaluate((id) => window.esb.outreachJobSubmit({
    campaignId: id, campaignName: 'Countdown', kind: 'first',
    messages: [1, 2, 3, 4].map((i) => ({ to: `r${i}@d${i}.example.com`, subject: 'S', body: 'B' })),
  }), cid)
  check(res && res.ok, 'dry-run job submitted')

  const pill = [], foot = []
  for (let i = 0; i < 16; i++) {
    pill.push(await page.locator('.or-sb-autopilot .or-ap-full-text').innerText().catch(() => ''))
    foot.push((await page.locator('.or-progress').innerText().catch(() => '')).replace(/\s+/g, ' '))
    await page.waitForTimeout(1000)
  }
  console.log('pill:  ', JSON.stringify(pill))
  console.log('footer:', JSON.stringify(foot))
  const p = pill.filter((t) => TIME.test(t)), f = foot.filter((t) => /Next in/.test(t) && TIME.test(t))
  check(p.length >= 3 && new Set(p).size >= 3, `status-bar pill shows a ticking countdown (${p.length} samples, ${new Set(p).size} distinct)`)
  check(f.length >= 3 && new Set(f).size >= 3, `Send footer shows a ticking "Next in" (${f.length} samples, ${new Set(f).size} distinct)`)
} finally {
  await app.close()
  fs.rmSync(profile, { recursive: true, force: true })
}
console.log(fails ? `${fails} failed` : 'all passed')
process.exit(fails ? 1 : 0)
