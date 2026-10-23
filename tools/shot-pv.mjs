import { chromium } from 'playwright-core'
import { launchBrowser } from './launch-browser.mjs'
import { spawn } from 'node:child_process'
import path from 'node:path'
const PORT = 5193, root = path.resolve(import.meta.dirname, '..')
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }
let b
try {
  b = await launchBrowser(chromium)
  const page = await b.newPage({ viewport: { width: 1600, height: 950 } })
  await page.goto(`http://localhost:${PORT}/`); await page.waitForTimeout(1500)
  await page.click('.pv-btn'); await page.waitForSelector('.pvw'); await page.waitForTimeout(600)
  const bb = await page.locator('.fb-phone').boundingBox(); console.log('phone', Math.round(bb.width), Math.round(bb.height))
  await page.screenshot({ path: process.argv[2] })
} finally { await b?.close(); vite.kill() }
