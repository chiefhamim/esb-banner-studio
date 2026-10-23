// Quick visual pass: drive a few UI states and save screenshots to tools/out/shot-*.png
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
const PORT = 5197
const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'tools', 'out')
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }
let browser
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage()
  page.setDefaultTimeout(8000)
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForSelector('.topbar'); await page.waitForTimeout(500)
  await page.setInputFiles('input[type=file]', path.join(root, 'src/assets/images/sample-photo.jpg'))
  await page.click('.left .side-tabs button:has-text("Story")')
  await page.click('.cat:has-text("Grid")')
  await page.fill('.pnl-body textarea', 'Titas-28 Adds 12.5 MMCFD to Grid Tomorrow; 55 MMCFD More in 3–4 Months')
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(out, 'shot-1-story.png') })
  await page.click('.layer:has-text("Headline")', { position: { x: 60, y: 10 } })
  await page.waitForTimeout(200)
  await page.screenshot({ path: path.join(out, 'shot-2-selected.png') })
  await page.click('.left .side-tabs button:has-text("Photos")')
  await page.waitForTimeout(200)
  await page.screenshot({ path: path.join(out, 'shot-3-photos.png') })
  await page.click('.select >> nth=0').catch(() => {})
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(out, 'shot-4-dropdown.png') })
  console.log('errors:', errs.slice(0, 5))
} catch (e) { console.log('ERR', e.message) } finally { await browser?.close().catch(() => {}); vite.kill() }
