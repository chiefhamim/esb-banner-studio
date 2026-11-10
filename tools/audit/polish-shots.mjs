import { chromium } from 'playwright-core'
import { launchBrowser } from '../launch-browser.mjs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { portOffset } from '../port-offset.mjs'

const PORT = 5193 + portOffset()
const root = path.resolve(import.meta.dirname, '../..')
const outDir = process.env.OUT || path.join(root, 'artifacts', 'polish-shots')
fs.mkdirSync(outDir, { recursive: true })

const vite = spawn(process.execPath,
  [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: root, stdio: 'ignore' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch {} await new Promise(r=>setTimeout(r,500)) }

const sizes = (process.env.SIZES || '1280x800,1920x1080,2560x1400,1000x700').split(',').map(s=>{const [w,h]=s.split('x').map(Number);return {w,h}})
const themes = (process.env.THEMES || 'dark,light').split(',')
const desks = (process.env.DESKS || 'home,news,editorial,graphics,outreach').split(',')

let browser
try {
  browser = await launchBrowser(chromium)
  for (const theme of themes) {
    for (const { w, h } of sizes) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } })
      const page = await ctx.newPage()
      page.setDefaultTimeout(8000)
      await page.goto(`http://localhost:${PORT}/`)
      await page.evaluate(th => { localStorage.setItem('esb-banner-studio/theme', th); document.documentElement.setAttribute('data-theme', th) }, theme)
      await page.reload(); await page.waitForTimeout(800)
      const shot = async name => page.screenshot({ path: path.join(outDir, `${name}-${theme}-${w}.png`) })
      for (const d of desks) {
        try {
          if (d === 'home') { /* already there */ }
          else {
            const btn = page.locator(`.ws-btn[data-ws="${d}"]`)
            if (await btn.count()) await btn.first().click()
            else {
              // from Home use launcher cell
              const cell = page.locator(`.home-launch [data-ws="${d}"], button:has-text("${d[0].toUpperCase()+d.slice(1)}")`)
              await cell.first().click()
            }
          }
          await page.waitForTimeout(900)
          await shot(d)
        } catch (e) { console.log(`skip ${d} ${theme} ${w}: ${e.message?.split('\n')[0]}`) }
      }
      await ctx.close()
    }
  }
} finally { await browser?.close(); vite.kill() }
console.log('done →', outDir)
