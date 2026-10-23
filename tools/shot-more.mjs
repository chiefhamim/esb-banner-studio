// More UI states for design review: node tools/shot-more.mjs <tag> [dark]
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
const PORT = 5198, root = path.resolve(import.meta.dirname, '..')
const tag = process.argv[2] ?? 'm'
const dark = process.argv[3] === 'dark'
const out = (n) => path.join(root, 'tools/out', `${tag}-${n}.png`)
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }
let b
try {
  b = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await b.newPage({ viewport: { width: 1600, height: 950 } })
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message))
  await page.goto(`http://localhost:${PORT}/`); await page.waitForTimeout(1500)
  if (dark) await page.evaluate(() => window.__store.getState().setTheme('dark'))
  await page.setInputFiles('input[type=file]', path.join(root, 'src/assets/images/sample-photo.jpg')); await page.waitForTimeout(500)
  await page.click('.side-tabs button:has-text("Photos")'); await page.waitForTimeout(250)
  await page.screenshot({ path: out('photos') })
  await page.click('.side-tabs button:has-text("Story")')
  // open a few story panels
  await page.evaluate(() => { for (const t of ['Label pill', 'Photo credit']) { const h = [...document.querySelectorAll('.pnl > header')].find((x) => x.textContent.includes(t)); if (h && !h.parentElement.classList.contains('open')) h.click() } })
  await page.waitForTimeout(250)
  await page.locator('.left .scroll').evaluate((e) => { e.scrollTop = 560 }); await page.waitForTimeout(150)
  await page.screenshot({ path: out('story-scrolled') })
  await page.click('.mb-item:has-text("File")'); await page.waitForTimeout(200)
  await page.screenshot({ path: out('menu') })
  await page.keyboard.press('Escape')
  await page.click('.fmtpick'); await page.waitForTimeout(200)
  await page.screenshot({ path: out('formats') })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+e'); await page.waitForSelector('.dialog'); await page.waitForTimeout(300)
  await page.screenshot({ path: out('export') })
  await page.keyboard.press('Escape')
  await page.keyboard.press('?'); await page.waitForTimeout(250)
  await page.screenshot({ path: out('keys') })
  await page.keyboard.press('Escape')
} finally { await b?.close(); vite.kill() }
