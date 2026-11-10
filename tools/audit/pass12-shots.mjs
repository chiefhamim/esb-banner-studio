// Pass 12 checks: News settings, News group heading + trending menu, Outreach preview (dark/phone), Home user menu,
// a folded rail. Synthetic example.org data only. → artifacts/pass12/
import { _electron as electron } from 'playwright-core'
import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os'
const root = path.resolve(import.meta.dirname, '../..')
const out = path.join(root, 'artifacts', 'pass12'); fs.mkdirSync(out, { recursive: true })
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-p12-'))
const csv = path.join(profile, 'p12.csv'); fs.writeFileSync(csv, ['Serial,Person Name,Designation,Organization,Sector Group,Email,Phone,Purpose,Mail Server,Deliverability Status,Address', ...Array.from({ length: 12 }, (_, i) => `${i + 1},Contact ${i + 1},Engineer,Org ${i % 4},Power,c${i}@org${i % 4}.example.org,,News,,SAFE_TO_SEND,Dhaka`)].join('\n'))
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root, '--user-data-dir=' + profile], env: { ...process.env, ESB_NO_SYNC: '1', ESB_OUTREACH_DRYRUN: '1' } })
const page = await app.firstWindow(); page.setDefaultTimeout(20000)
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await app.evaluate(({ BrowserWindow }) => { const b = BrowserWindow.getAllWindows()[0]; b.setContentSize(1440, 900); if (b.isMinimized()) b.restore(); b.showInactive() })
const shot = (n, clip) => page.screenshot({ path: path.join(out, n + '.png'), ...(clip ? { clip } : {}) })
const go = async (d) => { await page.evaluate((d) => { const t = [...document.querySelectorAll('.launch-tile')].find((x) => x.textContent.includes(d)); if (t) t.click(); else document.querySelector(`.desk-slot.is-active .ws-btn[data-ws="${d.toLowerCase()}"]`)?.click() }, d); await page.waitForTimeout(1300) }
const theme = process.env.THEME || 'dark'
await page.evaluate((x) => localStorage.setItem('esb-banner-studio/theme', x), theme); await page.reload(); await page.waitForSelector('.launch-tile'); await page.waitForTimeout(600)
// Home user menu
await page.click('.home-user-btn'); await page.waitForTimeout(400); await shot(`home-menu-${theme}`, { x: 1040, y: 0, width: 400, height: 300 }); await page.keyboard.press('Escape')
// News
await go('News'); await page.waitForTimeout(5000)
await page.evaluate(() => { const s = document.querySelector('.desk-slot.is-active .nw-sheet'); if (s) s.scrollTop = 400 }); await page.waitForTimeout(300)
await shot(`news-scrolled-${theme}`, { x: 270, y: 40, width: 860, height: 300 })
await page.evaluate(() => { const s = document.querySelector('.desk-slot.is-active .nw-sheet'); if (s) s.scrollTop = 0 })
const more = page.locator('.desk-slot.is-active .nw-trend-more'); if (await more.count()) { await more.click(); await page.waitForTimeout(300); await shot(`news-trendmenu-${theme}`, { x: 500, y: 60, width: 640, height: 420 }); await page.keyboard.press('Escape') }
await page.click('.desk-slot.is-active .topbar [aria-label="News settings"], .desk-slot.is-active .topbar .ibtn[data-tip="News settings"]').catch(() => {}); await page.waitForTimeout(500)
const d = page.locator('.dialog'); if (await d.count()) { await shot(`news-settings-${theme}`, await d.boundingBox()); await page.keyboard.press('Escape') }
// Outreach preview
await go('Outreach')
await page.setInputFiles('.desk-slot.is-active .outreach-workspace input[accept=".xlsx,.csv,.xls"] >> nth=0', csv); await page.waitForTimeout(1500)
await page.click('.desk-slot.is-active .or-view-seg button:has-text("Preview")'); await page.waitForTimeout(600)
await page.click('.desk-slot.is-active .or-look-seg button:has-text("Dark")').catch(() => {}); await page.click('.desk-slot.is-active .or-look-seg button:has-text("Phone")').catch(() => {}); await page.waitForTimeout(700)
await shot(`outreach-preview-dark-phone-${theme}`)
await page.click('.desk-slot.is-active .or-look-seg button:has-text("Light")').catch(() => {}); await page.click('.desk-slot.is-active .or-look-seg button:has-text("Desktop")').catch(() => {}); await page.waitForTimeout(400)
// a folded rail
await page.click('.desk-slot.is-active .or-left .col-fold'); await page.waitForTimeout(700)
await shot(`rail-${theme}`, { x: 0, y: 40, width: 200, height: 260 })
await app.close()
