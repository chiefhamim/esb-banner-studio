// Pass 10: shoot the spots the owner flagged (News fold, Outreach send/review/compose/activity) and reproduce
// Graphics → Video. Usage: npm run build && node tools/audit/pass10-shots.mjs  (THEME=dark|light) → artifacts/pass10/
import { _electron as electron } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
const root = path.resolve(import.meta.dirname, '../..')
const out = path.join(root, 'artifacts', 'pass10'); fs.mkdirSync(out, { recursive: true })
const win = process.platform === 'win32'
const exe = path.join(root, 'node_modules', 'electron', 'dist', win ? 'electron.exe' : 'electron')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-p10-'))
const theme = process.env.THEME || 'dark'
const W = Number(process.env.W || 1600), H = Number(process.env.H || 950)
const app = await electron.launch({ executablePath: exe, args: [...(win ? [] : ['--no-sandbox']), root, '--user-data-dir=' + profile], env: { ...process.env, ESB_NO_SYNC: '1' } })
const page = await app.firstWindow()
page.setDefaultTimeout(15000)
const logs = []
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text().slice(0, 300)) })
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message.slice(0, 400)))
await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [W, H])
await page.evaluate((t) => { localStorage.setItem('esb-banner-studio/theme', t) }, theme)
await page.reload(); await page.waitForTimeout(1500)
const shot = async (n, clip) => { await page.screenshot({ path: path.join(out, `${n}-${theme}.png`), ...(clip ? { clip } : {}) }); console.log('shot', n) }
const go = async (label) => { await page.evaluate((l) => [...document.querySelectorAll('.ws-btn, .launch-tile, button')].find((x) => new RegExp('^' + l).test((x.getAttribute('aria-label') || x.textContent || '').trim()))?.click(), label); await page.waitForTimeout(1100) }
const box = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return `${(e.className || '').toString().slice(0, 50)} x${Math.round(r.left)} y${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}` }), sel)

await go('News'); await page.waitForTimeout(2500)
await page.evaluate(() => document.querySelector('.nw-row')?.click()); await page.waitForTimeout(600)
await shot('news')
console.log('news folds', await box('.col-fold'))
console.log('news detail top', await box('.nw-detail-top, .nw-detail-top > *'))
await shot('news-detail-top', { x: W - 420, y: 40, width: 420, height: 140 })

await go('Outreach'); await page.waitForTimeout(1200)
await shot('outreach')
console.log('or folds', await box('.col-fold'))
console.log('or right', await box('.or-right > *, .or-right-scroll > *'))
await shot('outreach-right', { x: W - 400, y: 40, width: 400, height: H - 40 })
await shot('outreach-center-top', { x: 330, y: 40, width: 900, height: 260 })
for (const t of ['Review', 'Contact']) {
  await page.evaluate((t) => [...document.querySelectorAll('.or-right .side-tabs button, .or-right [role=tab]')].find(b => b.textContent.trim().startsWith(t))?.click(), t); await page.waitForTimeout(500)
  await shot('outreach-right-' + t.toLowerCase(), { x: W - 400, y: 40, width: 400, height: H - 40 })
}
await page.evaluate(() => [...document.querySelectorAll('.topbar button, header button')].find(b => b.textContent.trim() === 'Activity')?.click()); await page.waitForTimeout(900)
await shot('outreach-activity')
await shot('outreach-activity-head', { x: 0, y: 0, width: W, height: 140 })
await page.evaluate(() => [...document.querySelectorAll('.topbar button, header button')].find(b => b.textContent.trim() === 'Compose')?.click()); await page.waitForTimeout(600)

// Graphics → Video, and back and forth
await go('Graphics'); await page.waitForTimeout(1200); await shot('graphics')
await go('Video'); await page.waitForTimeout(1500); await shot('video-after-graphics')
console.log('video monitor', await box('.vw-monitor, .vw-viewer, canvas'))
await go('Graphics'); await page.waitForTimeout(900)
await go('Video'); await page.waitForTimeout(1500); await shot('video-after-graphics-2')
console.log('LOGS\n' + logs.join('\n'))
await app.close()
