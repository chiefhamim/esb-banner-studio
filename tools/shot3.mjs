// Visual review of the new UI (menus, formats, categories, overflow audit).
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
const PORT = 5191
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
  await page.waitForSelector('.topbar'); await page.waitForTimeout(600)
  const ph = path.join(root, 'src/assets/images/sample-photo.jpg')
  await page.setInputFiles('input[type=file]', ph)
  await page.fill('.pnl-body textarea.input', 'Titas-28 Adds 12.5 MMCFD to Grid Tomorrow; 55 MMCFD More in 3–4 Months')
  await page.click('.cat:has-text("Grid")')
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(out, 's3-1-main.png') })
  await page.locator('.layer .name', { hasText: /^Headline$/ }).first().click(); await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(out, 's4-light.png') })
  await page.click('[aria-label="Dark theme"]'); await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(out, 's4-dark.png'), clip: { x: 0, y: 0, width: 700, height: 120 } })
  console.log('errors:', errs.slice(0, 5))
} catch (e) { console.log('ERR', e.message) } finally { await browser?.close().catch(() => {}); vite.kill() }
