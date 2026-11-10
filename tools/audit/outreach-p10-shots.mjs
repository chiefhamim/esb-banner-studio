// Pass 10 Outreach: compose with a campaign open, right Send/Contact/Review, Activity header. Synthetic example.org data.
// Usage: npm run build && node tools/audit/outreach-p10-shots.mjs → artifacts/pass10/or-*.png  (W/H window size)
import { _electron as electron } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
const root = path.resolve(import.meta.dirname, '../..')
const out = path.join(root, 'artifacts', 'pass10'); fs.mkdirSync(out, { recursive: true })
const exe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-orp10-'))
const W = Number(process.env.W || 1600), H = Number(process.env.H || 950)
const csvPath = path.join(profile, 'p10-contacts.csv')
const rows = ['Serial,Person Name,Designation,Organization,Sector Group,Email,Phone,Purpose,Mail Server,Deliverability Status,Address']
for (let i = 0; i < 40; i++) rows.push(`${i + 1},Contact ${i + 1},Engineer,Org ${i % 8},Power,c${i}@org${i % 8}.example.org,,News,,SAFE_TO_SEND,Dhaka`)
fs.writeFileSync(csvPath, rows.join('\n'))
const app = await electron.launch({ executablePath: exe, args: [root, '--user-data-dir=' + profile], env: { ...process.env, ESB_OUTREACH_DRYRUN: '1', ESB_NO_SYNC: '1', ESB_OUTREACH_TRACKING: '0' } })
const page = await app.firstWindow()
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message))
await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [W, H])
const toOutreach = async () => { await page.waitForSelector('.launch-tile'); await page.click('.launch-tile:has-text("Outreach")'); await page.waitForSelector('.outreach-workspace'); await page.waitForTimeout(700) }
const diag = async () => {
  const js = await Promise.race([page.evaluate(() => 'js ok ' + document.visibilityState + ' focus=' + document.hasFocus()), new Promise(r => setTimeout(() => r('JS STUCK'), 4000))])
  const raf = await Promise.race([page.evaluate(() => new Promise(r => requestAnimationFrame(() => r('raf ok')))), new Promise(r => setTimeout(() => r('RAF STUCK'), 4000))])
  const win = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; return { visible: w.isVisible(), min: w.isMinimized(), focused: w.isFocused(), crashed: w.webContents.isCrashed(), painting: w.webContents.isPainting?.() } })
  const anims = await Promise.race([page.evaluate(() => document.getAnimations().map(a => (a.effect?.target?.className || '').toString().slice(0, 40) + ':' + a.playState).slice(0, 12).join(' | ')), new Promise(r => setTimeout(() => r('?'), 3000))])
  console.log('HANG DIAG', js, raf, JSON.stringify(win), anims)
}
const shot = async (n, clip) => {
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w.isMinimized()) { w.showInactive(); w.restore() } })
  const ok = await page.screenshot({ path: path.join(out, `or-${n}.png`), timeout: 8000, ...(clip ? { clip } : {}) }).then(() => true, () => false)
  if (!ok) { console.log('NO PAINT at', n); await diag(); const ok2 = await page.screenshot({ path: path.join(out, `or-${n}.png`), timeout: 8000 }).then(() => true, () => false); console.log('retry', ok2) }
  else console.log('shot', n)
}
const box = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return `${(e.className || e.tagName).toString().slice(0, 44)} x${Math.round(r.left)}-${Math.round(r.right)} y${Math.round(r.top)}-${Math.round(r.bottom)}` }), sel)
await toOutreach()
await page.evaluate(() => window.esb.outreachSave({ host: 'smtp.gmail.com', port: 587, user: 'desk@example.com', name: 'ESB Power Line', dailyLimit: 100, minDelaySec: 60, maxDelaySec: 120 }, 'abcd efgh ijkl mnop'))
await page.setInputFiles('.outreach-workspace input[accept=".xlsx,.csv,.xls"] >> nth=0', csvPath)
await page.waitForTimeout(1500)
for (const t of (process.env.THEMES || 'dark,light').split(',')) {
  await page.evaluate((x) => localStorage.setItem('esb-banner-studio/theme', x), t); await page.reload(); await toOutreach()
  await page.locator('.or-row').first().click().catch(() => {}); await page.waitForTimeout(400)
  await shot('full-' + t)
  if (t === 'dark') {
    console.log('head', await box('.or-head > *, .topbar > *'))
    console.log('right', await box('.or-right > *, .or-right-scroll > *, .or-right .col-fold'))
    console.log('left', await box('.or-left > *, .or-left .col-fold'))
    console.log('compose', await box('.or-center > *, .or-compose > *, .or-line'))
  }
  await shot('center-' + t, { x: 330, y: 40, width: 940, height: 330 })
  for (const tab of ['Send', 'Contact', 'Review']) {
    await page.locator(`.or-right .side-tabs button:has-text("${tab}")`).first().click().catch(() => {}); await page.waitForTimeout(450)
    await shot(`right-${tab.toLowerCase()}-${t}`, { x: W - 380, y: 40, width: 380, height: H - 40 })
  }
  await page.locator('.or-desk-seg button').nth(1).click(); await page.waitForTimeout(900)
  await shot('activity-' + t)
  await page.locator('.or-desk-seg button').first().click(); await page.waitForTimeout(500)
}
await app.close()
