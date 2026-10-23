// Screenshots of the main UI states for design review: node tools/shot-states.mjs <tag>
import { chromium } from 'playwright-core'
import { launchBrowser } from './launch-browser.mjs'
import { spawn } from 'node:child_process'
import path from 'node:path'
const PORT = 5196, root = path.resolve(import.meta.dirname, '..')
const tag = process.argv[2] ?? 's'
const out = (n) => path.join(root, 'tools/out', `${tag}-${n}.png`)
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }
let b
try {
  b = await launchBrowser(chromium)
  const page = await b.newPage({ viewport: { width: 1600, height: 950 } })
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message))
  await page.goto(`http://localhost:${PORT}/`); await page.waitForTimeout(1500)
  // select the headline via the Elements list
  await page.click('.el-row:has-text("Headline") >> nth=0'); await page.waitForTimeout(300)
  await page.screenshot({ path: out('selected') })
  // hide logo + date, open preview
  await page.click('.el-row:has-text("Logo") .tgl'); await page.click('.el-row:has-text("Date") .tgl')
  await page.click('.pv-btn'); await page.waitForTimeout(500)
  await page.screenshot({ path: out('toggled-preview') })
  await page.click('.pvw [aria-label^="Close preview"]')
  // dark
  await page.evaluate(() => window.__store.getState().setTheme('dark')); await page.waitForTimeout(300)
  await page.screenshot({ path: out('dark') })
  await page.evaluate(() => window.__store.getState().setTheme('light'))
  await page.setViewportSize({ width: 1366, height: 768 }); await page.waitForTimeout(400)
  await page.screenshot({ path: out('1366') })
  // layers tab
  await page.click('.dock-tabs button:has-text("Layers")'); await page.waitForTimeout(200)
  await page.screenshot({ path: out('layers') })
} finally { await b?.close(); vite.kill() }
