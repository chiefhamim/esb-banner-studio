// Pass 11 checks: Welcome, About, News header + trending row, Video in light, Outreach list head, header right order.
import { _electron as electron } from 'playwright-core'
import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os'
const root = path.resolve(import.meta.dirname, '../..')
const out = path.join(root, 'artifacts', 'pass11'); fs.mkdirSync(out, { recursive: true })
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root, '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'esb-p11-'))], env: { ...process.env, ESB_NO_SYNC: '1', ESB_OUTREACH_DRYRUN: '1' } })
const page = await app.firstWindow(); page.setDefaultTimeout(20000)
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
const W = Number(process.env.W || 1440), H = 900
await app.evaluate(({ BrowserWindow }, [w, h]) => { const b = BrowserWindow.getAllWindows()[0]; b.setContentSize(w, h); if (b.isMinimized()) b.restore(); b.showInactive() }, [W, H])
const shot = (n, clip) => page.screenshot({ path: path.join(out, n + '.png'), ...(clip ? { clip } : {}) })
const go = async (d) => { await page.evaluate((d) => { const t = [...document.querySelectorAll('.launch-tile')].find((x) => x.textContent.includes(d)); if (t) t.click(); else document.querySelector(`.desk-slot.is-active .ws-btn[data-ws="${d.toLowerCase()}"]`)?.click() }, d); await page.waitForTimeout(1300) }
for (const t of (process.env.THEMES || 'light,dark').split(',')) {
  await page.evaluate((x) => localStorage.setItem('esb-banner-studio/theme', x), t); await page.reload(); await page.waitForSelector('.launch-tile'); await page.waitForTimeout(600)
  await go('News'); await page.waitForTimeout(4000)
  await shot(`news-${t}`)
  console.log(t, 'news right header', await page.evaluate(() => [...document.querySelector('.desk-slot.is-active .topbar').children].filter((e) => e.offsetParent).map((e) => (e.className || '').toString().split(' ')[0] + '@' + Math.round(e.getBoundingClientRect().left)).slice(-5).join(' ')))
  console.log(t, 'trend rows', await page.evaluate(() => { const b = document.querySelector('.desk-slot.is-active .nw-trendbar'); return b ? Math.round(b.getBoundingClientRect().height) + 'px, shown ' + b.querySelectorAll(':scope > .nw-chip').length + ', more ' + (b.querySelector('.nw-trend-more')?.textContent || '-') : 'none' }), 'left trending fold:', await page.locator('.desk-slot.is-active .nw-left :text("Trending Topics")').count())
  await page.click('.desk-slot.is-active .mb-item:has-text("Help")'); await page.click('.menu-item:has-text("Welcome screen")'); await page.waitForTimeout(500)
  await shot(`welcome-${t}`, await page.locator('.dialog').boundingBox()); await page.keyboard.press('Escape'); await page.waitForTimeout(300)
  await page.click('.desk-slot.is-active .mb-item:has-text("Help")'); await page.click('.menu-item:has-text("About")'); await page.waitForTimeout(500)
  await shot(`about-${t}`, await page.locator('.dialog').boundingBox()); await page.keyboard.press('Escape'); await page.waitForTimeout(300)
  await go('Video'); await shot(`video-${t}`)
  await go('Outreach'); await shot(`outreach-${t}`)
}
await app.close()
