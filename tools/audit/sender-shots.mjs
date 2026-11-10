// The Outreach sender dialog and its service picker (open), both themes. → artifacts/pass10/sender-*.png
import { _electron as electron } from 'playwright-core'
import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os'
const root = path.resolve(import.meta.dirname, '../..')
const out = path.join(root, 'artifacts', 'pass10'); fs.mkdirSync(out, { recursive: true })
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root, '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'esb-snd-'))], env: { ...process.env, ESB_NO_SYNC: '1', ESB_OUTREACH_DRYRUN: '1' } })
const page = await app.firstWindow(); page.setDefaultTimeout(20000)
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900))
for (const t of ['dark', 'light']) {
  await page.evaluate((x) => { localStorage.setItem('esb-banner-studio/theme', x); localStorage.setItem('esb-banner-studio/workspace', JSON.stringify({ workspace: 'outreach' })) }, t); await page.reload()
  await page.waitForSelector('.launch-tile, .ws-btn')
  await page.evaluate(() => { const t = [...document.querySelectorAll('.launch-tile')].find((x) => /Outreach/.test(x.textContent)); if (t) t.click(); else document.querySelector('.desk-slot.is-active .ws-btn[data-ws="outreach"]')?.click() })
  await page.waitForSelector('.desk-slot.is-active .outreach-workspace'); await page.waitForTimeout(500)
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w.isMinimized()) w.restore(); w.showInactive() })
  await page.click('.desk-slot.is-active .mb-item:has-text("List")'); await page.click('.menu-item:has-text("Sender")'); await page.waitForSelector('.or-sender-form'); await page.waitForTimeout(400)
  const d = await page.locator('.dialog').boundingBox()
  await page.screenshot({ path: path.join(out, `sender-${t}.png`), clip: d })
  await page.click('.or-sender-select'); await page.waitForTimeout(350)
  await page.screenshot({ path: path.join(out, `sender-open-${t}.png`), clip: { x: d.x, y: d.y, width: d.width, height: Math.min(900 - d.y, d.height + 160) } })
  console.log(t, await page.evaluate(() => { const s = document.querySelector('.or-sender-select').getBoundingClientRect(); const i = document.querySelector('.or-sender-form input').getBoundingClientRect(); return `select h${Math.round(s.height)} w${Math.round(s.width)} | input h${Math.round(i.height)}` }))
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
}
await app.close()
