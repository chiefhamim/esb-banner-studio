import { chromium } from 'playwright-core'
import { launchBrowser } from './launch-browser.mjs'
import { spawn } from 'node:child_process'
import path from 'node:path'
const PORT = 5187
const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'tools', 'out')
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }
let b
try {
  b = await launchBrowser(chromium)
  const page = await (await b.newContext({ viewport: { width: 1600, height: 950 } })).newPage()
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForSelector('.topbar'); await page.waitForTimeout(500)
  const ph = path.join(root, 'src/assets/images/crop.jpg')
  await page.setInputFiles('input[type=file]', path.join(root, 'src/assets/images/sample-photo.jpg')); await page.waitForTimeout(400)
  await page.click('.cat:has-text("Renewables")')
  await page.fill('.pnl-body textarea.input', 'Solar-Powered Irrigation Systems Transforming Bangladesh’s Agricultural Sector')
  await page.evaluate(() => { const s = window.__store.getState(); s.setSlot(0, { zoom: 0.45 }); s.setContent({ credit: 'Photo: PID', creditPos: 'tr', creditChip: true }) })
  await page.waitForTimeout(300)
  await page.locator('.layer .name', { hasText: /^Headline icon$/ }).click(); await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(out, 's5-light.png') })
  await page.click('[aria-label="Dark theme"]'); await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(out, 's5-dark.png'), clip: { x: 0, y: 0, width: 760, height: 130 } })
} finally { await b?.close(); vite.kill() }
