// Reproduce the Inspector hover glitch: hover each icon button in the first Inspector card and screenshot.
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
const PORT = 5188
const root = path.resolve(import.meta.dirname, '..')
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }
let b
try {
  b = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await (await b.newContext({ viewport: { width: 1600, height: 950 } })).newPage()
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForSelector('.topbar'); await page.waitForTimeout(500)
  await page.locator('.layer .name', { hasText: /^Headline$/ }).first().click(); await page.waitForTimeout(200)
  await page.locator('.align-bar .ibtn').nth(3).hover(); await page.waitForTimeout(900)
  await page.screenshot({ path: path.join(root, 'tools', 'out', 'hover-after.png'), clip: { x: 1180, y: 60, width: 420, height: 420 } })
} finally { await b?.close(); vite.kill() }
