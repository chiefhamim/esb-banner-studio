import { chromium } from 'playwright-core'
import { launchBrowser } from './launch-browser.mjs'
import { spawn } from 'node:child_process'
import path from 'node:path'
const PORT = 5197, root = path.resolve(import.meta.dirname, '..')
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }
let b
try {
  b = await launchBrowser(chromium)
  const page = await b.newPage({ viewport: { width: 1600, height: 950 } })
  await page.goto(`http://localhost:${PORT}/`); await page.waitForTimeout(1200)
  await page.click('.left .pnl:has(h3:has-text("Headline")) textarea'); await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(root, 'tools/out/focus2.png'), clip: { x: 0, y: 420, width: 380, height: 500 } })
} finally { await b?.close(); vite.kill() }
