import { chromium } from 'playwright-core'
import { launchBrowser } from './launch-browser.mjs'
import { spawn } from 'node:child_process'
import path from 'node:path'
const PORT = 5183
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
  await page.evaluate(() => window.__store.getState().setContent({ label: 'breaking', labelPos: 'hc' }))
  await page.click('.pv-btn'); await page.waitForSelector('.pvw'); await page.waitForTimeout(600)
  await page.screenshot({ path: path.join(out, 's7-phone.png') })
  await page.click('.pvw .seg-ctl button:has-text("Desktop")'); await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(out, 's7-desktop.png') })
  console.log('errors:', errs.slice(0, 4))
} finally { await b?.close(); vite.kill() }
