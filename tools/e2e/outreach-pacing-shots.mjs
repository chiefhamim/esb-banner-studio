// Screenshots for the 2026-11-01 pacing fix: the Sender dialog and Autopilot settings showing ONE set of gaps, and the
// Send footer saying WHY it waits (the gap, then an organisation's 20-min spacing), with the "Sending at any hour"
// warning — light and dark. Dry run in a temp profile (nothing is sent, the editor's data is never touched).
// Usage: npm run build && node tools/e2e/outreach-pacing-shots.mjs   → tools/out/outreach-fix/*.png
import { _electron as electron } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const root = path.resolve(import.meta.dirname, '../..')
const out = path.join(root, 'tools', 'out', 'outreach-fix')
fs.mkdirSync(out, { recursive: true })
const win = process.platform === 'win32'
const exe = path.join(root, 'node_modules', 'electron', 'dist', win ? 'electron.exe' : 'electron')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-pacing-shots-'))
const app = await electron.launch({
  executablePath: exe,
  args: [...(win ? [] : ['--no-sandbox']), root, '--user-data-dir=' + profile],
  env: { ...process.env, ESB_OUTREACH_DRYRUN: '1', ESB_OUTREACH_SPEED: '10', ESB_NO_SYNC: '1', ESB_OUTREACH_TRACKING: '0' },
})
const page = await app.firstWindow()
await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {})
let fails = 0
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++ }
const shot = async (name, loc) => { const f = path.join(out, `${name}.png`); await (loc ?? page).screenshot({ path: f }); console.log('shot', f) }
const toOutreach = async () => {
  await page.waitForSelector('.home-shell, .topbar', { timeout: 20000 })
  const tile = page.locator('.launch-tile:has-text("Outreach")')
  if (await tile.count()) await tile.first().click(); else await page.click('.ws-btn[data-ws="outreach"]')
  await page.waitForSelector('.outreach-workspace')
  await page.waitForTimeout(600)
}
const theme = async (t) => { await page.evaluate((x) => localStorage.setItem('esb-banner-studio/theme', x), t); await page.reload(); await toOutreach() }
const closeDialog = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(300) }

try {
  await toOutreach()
  // a sender account (example.com) and the pacing an editor would set: 1–2 min gaps, any hour, 20-min org spacing
  await page.evaluate(() => window.esb.outreachSave({ host: 'smtp.gmail.com', port: 587, user: 'desk@example.com', name: 'ESB Power Line', dailyLimit: 100, minDelaySec: 60, maxDelaySec: 120 }, 'abcd efgh ijkl mnop'))
  const saved = await page.evaluate(() => window.esb.outreachSettingsSave({ window: { enabled: false, from: '09:00', to: '17:00', days: [0, 1, 2, 3, 4], tz: 'Asia/Dhaka' }, pace: 'manual', minDelaySec: 60, maxDelaySec: 120, domainMinGapSec: 1200, domainMaxPerDay: 3 }))
  check(saved && saved.ok && saved.settings.dryRun === true, 'settings saved; the dry-run flag survives a save')
  await page.reload()
  await toOutreach()

  // Sender dialog and Autopilot settings read the same numbers
  for (const t of ['light', 'dark']) {
    await theme(t)
    await page.evaluate(() => document.querySelector('.ed-account')?.click())
    await page.waitForSelector('.or-sender-form', { timeout: 5000 })
    await page.waitForTimeout(400)
    const vals = await page.locator('.or-sender-form .or-grid3 input').evaluateAll((els) => els.map((e) => e.value))
    check(vals[1] === '1' && vals[2] === '2', `${t}: Sender dialog shows the engine's 1–2 min (${vals.join(' / ')})`)
    await shot(`sender-dialog-${t}`, page.locator('.dialog').first())
    await closeDialog()
    const card = page.locator('.or-autopilot-card button:has-text("Autopilot settings")')
    if (await card.count()) await card.first().click()
    else { await page.locator('.menubar button:has-text("Campaign"), [role="menubar"] button:has-text("Campaign")').first().click(); await page.locator('[role="menuitem"]:has-text("Autopilot settings"), .menu-item:has-text("Autopilot settings")').first().click() }
    await page.waitForSelector('text=How fast', { timeout: 5000 })
    await page.waitForTimeout(400)
    const ap = await page.locator('.or-dialog-section .or-grid3 input').evaluateAll((els) => els.map((e) => e.value))
    check(ap[0] === '1' && ap[1] === '2', `${t}: Autopilot settings shows the same 1–2 min (${ap.join(' / ')})`)
    await shot(`autopilot-dialog-${t}`, page.locator('.dialog').first())
    await closeDialog()
  }

  // a dry-run batch to two addresses at one organisation: first the gap, then that organisation's spacing
  await theme('light')
  const newEmail = page.locator('button:has-text("New email")')
  if (await newEmail.count()) await newEmail.first().click()
  await page.waitForTimeout(800)
  const cid = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('esb-banner-studio/outreach/v2') || '{}').activeId || null } catch { return null } })
  const res = await page.evaluate((id) => window.esb.outreachJobSubmit({ campaignId: id, campaignName: 'Pacing check', kind: 'first', messages: [{ to: 'one@desco.example.org', subject: 'S', body: 'B' }, { to: 'two@desco.example.org', subject: 'S', body: 'B' }] }), cid)
  check(res && res.ok, 'dry-run job submitted')
  const foot = page.locator('.or-right-foot')
  const why = page.locator('[data-testid="or-foot-why"]')
  await why.waitFor({ timeout: 15000 })
  const gapText = await why.innerText()
  check(/^gap 1–2 min$/.test(gapText), `footer says the gap: "${gapText}"`)
  check(await page.locator('[data-testid="or-any-hour"]').count() > 0, 'footer/card warn "Sending at any hour"')
  await shot('send-footer-gap-light', foot)
  // the gap is 6–12 s at speed 10; then desco.example.org waits its 20-min spacing (2 min at speed 10)
  await page.waitForFunction(() => /spacing per organisation/.test(document.querySelector('[data-testid="or-foot-why"]')?.textContent || ''), null, { timeout: 30000 })
  const domText = await why.innerText()
  check(domText === 'desco.example.org: 20-min spacing per organisation', `footer says the organisation spacing: "${domText}"`)
  const progress = await page.locator('.or-progress').innerText()
  check(/Next in \d+:\d{2}/.test(progress), `with the countdown: "${progress.replace(/\s+/g, ' ')}"`)
  await shot('send-footer-domain-light', foot)
  await shot('send-tab-domain-light')
  await theme('dark')
  await why.waitFor({ timeout: 10000 })
  await shot('send-footer-domain-dark', foot)
  await shot('send-tab-domain-dark')
} finally {
  await app.close()
  fs.rmSync(profile, { recursive: true, force: true })
}
console.log(fails ? `${fails} failed` : 'all passed')
process.exit(fails ? 1 : 0)
