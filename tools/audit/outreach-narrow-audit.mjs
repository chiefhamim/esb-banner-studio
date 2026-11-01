// Outreach at narrow widths: screenshots each left/right tab and reports clipped, overlapping or tiny controls.
//   W=900,1024 H=640 node tools/audit/outreach-narrow-audit.mjs   (SHOTS=dir to keep screenshots)
import { chromium } from 'playwright-core'
import { launchBrowser } from '../launch-browser.mjs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { portOffset } from '../port-offset.mjs'
const PORT = 5230 + portOffset()
const root = path.resolve(import.meta.dirname, '../..')
const widths = (process.env.W || '900,1024').split(',').map(Number)
const H = Number(process.env.H || 640)
const shots = process.env.SHOTS || path.join(os.homedir(), 'or-audit')
fs.mkdirSync(shots, { recursive: true })
const csv = path.join(shots, 'contacts.csv')
fs.writeFileSync(csv, 'Name,Email,Designation,Organization\n' + Array.from({ length: 30 }, (_, i) => `Person ${i},p${i}@example.com,Chief Engineer ${i},Power Grid Company of Bangladesh Limited`).join('\n'))
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }
const browser = await launchBrowser(chromium)
try {
  for (const w of widths) for (const theme of ['light', 'dark']) {
    const page = await (await browser.newContext({ viewport: { width: w, height: H } })).newPage()
    await page.goto(`http://localhost:${PORT}/`)
    await page.waitForSelector('.studio-shell')
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
    const tile = page.locator('.launch-tile:has-text("Outreach")')
    if (await tile.count()) await tile.first().click(); else await page.click('.ws-btn[data-ws="outreach"]')
    await page.waitForSelector('.outreach-workspace')
    await page.waitForTimeout(500)
    const inp = page.locator('input[type=file]').first()
    if (await inp.count()) { await inp.setInputFiles(csv); await page.waitForTimeout(800) }
    const tabs = async (sel) => page.$$eval(sel + ' button', (b) => b.map((x) => x.textContent.trim()))
    const check = async (label) => {
      await page.screenshot({ path: path.join(shots, `${w}-${theme}-${label}.png`) })
      const res = await page.evaluate(() => {
        const out = []
        const vw = innerWidth
        if (document.documentElement.scrollWidth > vw + 1) out.push('page-x ' + document.documentElement.scrollWidth)
        for (const el of document.querySelectorAll('.outreach-workspace *')) {
          const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue
          const cs = getComputedStyle(el); if (cs.visibility === 'hidden') continue
          const tag = el.tagName
          const name = el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : tag
          if (r.right > vw + 1 || r.left < -1) out.push(`offscreen ${name} ${Math.round(r.left)}..${Math.round(r.right)} "${(el.textContent || '').trim().slice(0, 24)}"`)
          if ((tag === 'BUTTON' || tag === 'INPUT') && el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis' && cs.overflowX !== 'visible') out.push(`cut-x ${name} "${(el.textContent || '').trim().slice(0, 24)}"`)
          if (el.children.length === 0 && el.textContent.trim().length > 1 && r.width < 12 && r.height > 40) out.push(`sliver ${name} w=${Math.round(r.width)} h=${Math.round(r.height)}`)
          if (tag === 'BUTTON' && (r.height < 24 || r.width < 24) && el.textContent.trim() === '' && !el.querySelector('svg')) out.push(`tiny ${name}`)
        }
        return [...new Set(out)].slice(0, 25)
      })
      console.log(`[${w} ${theme}] ${label}: ${res.length ? '\n  ' + res.join('\n  ') : 'ok'}`)
    }
    await check('start')
    for (const sel of ['.or-tabs', '.or-rtabs']) {
      const names = (await page.locator(sel).count()) ? await tabs(sel) : []
      for (const n of names) { await page.locator(`${sel} button`, { hasText: n }).first().click().catch(() => {}); await page.waitForTimeout(250); await check(`${sel.slice(1)}-${n.replace(/\W+/g, '')}`) }
    }
    await page.close()
  }
} finally { await browser.close(); vite.kill() }
