// Visual review of the restyled UI.
import { chromium } from 'playwright-core'
import { launchBrowser } from './launch-browser.mjs'
import { spawn } from 'node:child_process'
import path from 'node:path'
const PORT = 5195
const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'tools', 'out')
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }
let browser
try {
  browser = await launchBrowser(chromium)
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage()
  page.setDefaultTimeout(8000)
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForSelector('.topbar'); await page.waitForTimeout(600)
  await page.setInputFiles('input[type=file]', path.join(root, 'src/assets/images/sample-photo.jpg'))
  await page.click('.cat:has-text("Grid")')
  await page.fill('.pnl-body textarea.input', 'Titas-28 Adds 12.5 MMCFD to Grid Tomorrow; 55 MMCFD More in 3–4 Months')
  await page.waitForTimeout(300)
  await page.click('.layer .name:text-is("Headline")')
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(out, 's2-1-main.png') })
  await page.click('.datefield'); await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(out, 's2-2-date.png') })
  await page.keyboard.press('Escape')
  await page.click('.right .colorfield .cf-swatch >> nth=0'); await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(out, 's2-3-color.png') })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+e'); await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(out, 's2-4-export.png') })
  console.log('errors:', errs.slice(0, 5))
} catch (e) { console.log('ERR', e.message) } finally { await browser?.close().catch(() => {}); vite.kill() }
