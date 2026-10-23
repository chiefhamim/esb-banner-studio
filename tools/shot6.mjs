import { chromium } from 'playwright-core'
import { launchBrowser } from './launch-browser.mjs'
import { spawn } from 'node:child_process'
import path from 'node:path'
const PORT = 5185
const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'tools', 'out')
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }
let b
try {
  b = await launchBrowser(chromium)
  const page = await (await b.newContext({ viewport: { width: 1600, height: 950 } })).newPage()
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForSelector('.topbar'); await page.waitForTimeout(500)
  await page.setInputFiles('input[type=file]', path.join(root, 'src/assets/images/sample-photo.jpg')); await page.waitForTimeout(400)
  await page.click('.cat:has-text("Renewables")')
  await page.fill('.pnl-body textarea.input', 'Government Cuts Total Duty on Import of Solar Equipment to 1 Percent')
  await page.evaluate(() => { const s = window.__store.getState(); s.setContent({ label: 'breaking' }) })
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(out, 's6-label.png') })
  await page.click('.side-tabs button:has-text("Preview")'); await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(out, 's6-preview-phone.png') })
  await page.click('.seg-ctl button:has-text("Link post")'); await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(out, 's6-preview-link.png'), clip: { x: 56, y: 60, width: 360, height: 880 } })
  console.log('errors:', errs.slice(0, 4))
} finally { await b?.close(); vite.kill() }
