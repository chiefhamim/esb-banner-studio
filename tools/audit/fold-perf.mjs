// Frame-time profile of folding/opening a column: rAF deltas + long tasks + what changes per frame.
import { chromium } from 'playwright-core'
import { launchBrowser } from '../launch-browser.mjs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { portOffset } from '../port-offset.mjs'
const PORT = 5201 + portOffset()
const root = path.resolve(import.meta.dirname, '../..')
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch {} await new Promise(r => setTimeout(r, 500)) }
const desk = process.env.DESK || 'Graphics'
let browser
try {
  browser = await launchBrowser(chromium)
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } })
  const page = await ctx.newPage(); page.setDefaultTimeout(8000)
  await page.goto(`http://localhost:${PORT}/`)
  await page.evaluate(() => localStorage.setItem('esb-banner-studio/theme', 'dark'))
  await page.reload(); await page.waitForTimeout(500)
  await page.evaluate((d) => [...document.querySelectorAll('button')].find(x => new RegExp(d).test(x.textContent || ''))?.click(), desk)
  await page.waitForSelector('.col-handle'); await page.waitForTimeout(900)
  const run = async (label) => {
    const r = await page.evaluate(() => new Promise((res) => {
      const d = []; let last = performance.now(); const lt = []
      new PerformanceObserver((l) => { for (const e of l.getEntries()) lt.push(Math.round(e.duration)) }).observe({ type: 'longtask' })
      const h = document.querySelector('.col-handle')
      h.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      const t0 = performance.now()
      const tick = (n) => { d.push(n - last); last = n; if (n - t0 < 700) requestAnimationFrame(tick); else res({ frames: d.length, worst: Math.round(Math.max(...d)), over20: d.filter(x => x > 20).length, avg: +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(1), longtasks: lt }) }
      requestAnimationFrame(tick)
    }))
    console.log(label, JSON.stringify(r))
    await page.waitForTimeout(500)
  }
  await run('fold  '); await run('open  '); await run('fold  '); await run('open  ')
} finally { await browser?.close(); vite.kill() }
