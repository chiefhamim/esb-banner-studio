import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
const PORT = 5194, root = path.resolve(import.meta.dirname, '..')
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }
let b
try {
  b = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await b.newPage({ viewport: { width: 1600, height: 950 } })
  await page.goto(`http://localhost:${PORT}/`); await page.waitForTimeout(1500)
  for (const f of ['fb45','social','web']) console.log(f, JSON.stringify(await page.evaluate((f) => window.__store.getState().scene(f).elements.map((e) => `${e.group}/${e.id}${e.visible?'':'(off)'}`), f)))
} finally { await b?.close(); vite.kill() }
