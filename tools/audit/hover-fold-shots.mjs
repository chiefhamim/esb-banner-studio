// Pass-4 check: Graphics header at 900, hover language (tool vs rail vs desk tab), fold filmstrip.
import { chromium } from 'playwright-core'
import { launchBrowser } from '../launch-browser.mjs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { portOffset } from '../port-offset.mjs'
const PORT = 5198 + portOffset()
const root = path.resolve(import.meta.dirname, '../..')
const out = path.join(root, 'artifacts', 'pass4'); fs.mkdirSync(out, { recursive: true })
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch {} await new Promise(r => setTimeout(r, 500)) }
let browser
try {
  browser = await launchBrowser(chromium)
  for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext({ viewport: { width: Number(process.env.W || 900), height: 700 } })
    const page = await ctx.newPage(); page.setDefaultTimeout(8000)
    await page.goto(`http://localhost:${PORT}/`)
    await page.evaluate(t => localStorage.setItem('esb-banner-studio/theme', t), theme)
    await page.reload(); await page.waitForTimeout(600)
    await page.evaluate(() => [...document.querySelectorAll('button')].find(x => /Graphics/.test(x.textContent || ''))?.click())
    await page.waitForSelector('.gx-head'); await page.waitForTimeout(900)
    const hdr = page.locator('.gx-head')
    await hdr.screenshot({ path: path.join(out, `header-900-${theme}.png`) })
    const over = await page.evaluate(() => { const h = document.querySelector('.gx-head'); return { sw: h.scrollWidth, cw: h.clientWidth } })
    console.log(theme, 'header scroll/client', over.sw, over.cw)
    // hovers
    await page.locator('.toolbar .ibtn').nth(1).hover(); await page.waitForTimeout(250)
    await page.screenshot({ path: path.join(out, `hover-tool-${theme}.png`), clip: { x: 0, y: 0, width: 120, height: 200 } })
    await page.locator('.ws-btn[data-ws="news"]').hover(); await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(out, `hover-tab-${theme}.png`), clip: { x: 0, y: 0, width: 460, height: 48 } })
    // fold left column via its handle double-click, filmstrip
    const h = page.locator('.col-handle').first()
    await h.dblclick({ force: true })
    for (const t of [40, 120, 200, 300, 450]) { await page.waitForTimeout(t === 40 ? 40 : t - [40,120,200,300,450][[40,120,200,300,450].indexOf(t)-1]); await page.screenshot({ path: path.join(out, `fold-${theme}-${t}.png`), clip: { x: 0, y: 44, width: 420, height: 300 } }) }
    await page.locator('.col-rail-btn').nth(2).hover(); await page.waitForTimeout(250)
    await page.screenshot({ path: path.join(out, `hover-rail-${theme}.png`), clip: { x: 0, y: 0, width: 120, height: 200 } })
    await ctx.close()
  }
} finally { await browser?.close(); vite.kill() }
console.log('done')
