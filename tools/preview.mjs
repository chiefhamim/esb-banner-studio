// Render any format(s) with the sample photo: node tools/preview.mjs fb45 sq [cat] [headline]
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
const PORT = 5192
const root = path.resolve(import.meta.dirname, '..')
const [fmts, cat, headline] = [process.argv[2]?.split(',') ?? ['fb45'], process.argv[3] ?? '05', process.argv[4] ?? 'Titas-28 Adds 12.5 MMCFD to Grid Tomorrow; 55 MMCFD More in 3–4 Months']
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/golden.html`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }
let b
try {
  b = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await b.newPage({ viewport: { width: 800, height: 600 } })
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message))
  for (const fmt of fmts) {
    const qs = new URLSearchParams({ fmt, cat, headline, hl: process.env.HL ?? '12.5 MMCFD', date: '2026-10-22', label: process.env.LABEL ?? 'none' })
    await page.goto(`http://localhost:${PORT}/golden.html?${qs}`)
    await page.waitForFunction('window.__done === true', null, { timeout: 30000 })
    const err = await page.evaluate('window.__err'); if (err) { console.log(fmt, 'ERR', err); continue }
    const png = (await page.evaluate('window.__png')).split(',')[1]
    fs.writeFileSync(path.join(root, 'tools', 'out', `preview-${fmt}.png`), Buffer.from(png, 'base64'))
    console.log('wrote', fmt)
  }
} finally { await b?.close(); vite.kill() }
