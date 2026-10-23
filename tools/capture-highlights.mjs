import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const PORT = 5198
const root = path.resolve(import.meta.dirname, '..')
const outDir = path.join(root, 'tools', 'out', 'ui-after')
fs.mkdirSync(outDir, { recursive: true })

const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })

for (let i = 0; i < 40; i++) {
  try {
    if ((await fetch(`http://localhost:${PORT}/`)).ok) break
  } catch {}
  await new Promise((r) => setTimeout(r, 400))
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(`http://localhost:${PORT}/`)
await page.waitForSelector('.topbar')

// 1. Click File menu to show Quit and start new
await page.click('.mb-item:has-text("File")')
await page.waitForSelector('.menu')
await page.screenshot({ path: path.join(outDir, 'screenshot-file-menu.png') })

// 2. Open Welcome Screen modal
await page.click('.menu-item:has-text("Welcome screen")')
await page.waitForSelector('.welcome-modal-content')
await page.screenshot({ path: path.join(outDir, 'screenshot-welcome-screen.png') })
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

// 3. Switch to Video Studio
await page.click('.rail-btn:has-text("Video")')
await page.waitForSelector('.video-workspace')
await page.screenshot({ path: path.join(outDir, 'screenshot-video-studio.png') })

await browser.close()
vite.kill()
console.log('Screenshots captured successfully!')
