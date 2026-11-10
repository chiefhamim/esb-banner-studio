// Narrow the Graphics left column step by step and record which label form the card-type control shows.
import { chromium } from 'playwright-core'
import { launchBrowser } from '../launch-browser.mjs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { portOffset } from '../port-offset.mjs'
const PORT = 5199 + portOffset()
const root = path.resolve(import.meta.dirname, '../..')
const out = path.join(root, 'artifacts', 'pass5'); fs.mkdirSync(out, { recursive: true })
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch {} await new Promise(r => setTimeout(r, 500)) }
let browser
try {
  browser = await launchBrowser(chromium)
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage(); page.setDefaultTimeout(8000)
  await page.goto(`http://localhost:${PORT}/`)
  await page.evaluate(() => localStorage.setItem('esb-banner-studio/theme', 'dark'))
  await page.reload(); await page.waitForTimeout(500)
  await page.evaluate(() => [...document.querySelectorAll('button')].find(x => /Graphics/.test(x.textContent || ''))?.click())
  await page.waitForSelector('.card-type-seg'); await page.waitForTimeout(700)
  const handle = page.locator('.col-handle').first()
  await handle.focus()
  for (let i = 0; i <= 8; i++) {
    const info = await page.evaluate(() => { const e = document.querySelector('.card-type-seg'); return { w: Math.round(e.clientWidth), short: e.classList.contains('is-short'), text: [...e.querySelectorAll('button')].map(b => { const l = b.querySelector('.seg-label'); const vis = [...l.children].find(c => getComputedStyle(c).display !== 'none'); return (vis || l).textContent }).join(' | '), clipped: e.scrollWidth > e.clientWidth + 1 } })
    console.log(JSON.stringify(info))
    if (info.w) await page.locator('.card-type-seg').screenshot({ path: path.join(out, `seg-${i}.png`) })
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(350)
  }
} finally { await browser?.close(); vite.kill() }
