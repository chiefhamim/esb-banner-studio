// Overflow audit for the populated Outreach desk at several widths, both themes.
import { chromium } from 'playwright-core'
import { launchBrowser } from '../launch-browser.mjs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { portOffset } from '../port-offset.mjs'
const PORT = 5196 + portOffset()
const root = path.resolve(import.meta.dirname, '../..')
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }
const csvPath = path.join(root, 'tools', 'fixtures', 'synthetic-contacts.csv')
const csvBuffer = fs.readFileSync(csvPath)

const detector = () => {
  const out = []
  const vis = (el) => { const r = el.getBoundingClientRect(); const c = getComputedStyle(el); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none' }
  const pathOf = (el) => { const p = []; for (let e = el; e && e !== document.body && p.length < 4; e = e.parentElement) p.push(e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ').filter(Boolean).slice(0, 2).join('.') : '')); return p.join(' < ') }
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el) || el.closest('svg, canvas')) continue
    const c = getComputedStyle(el)
    const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    const isInput = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
    if ((hasOwnText) && !isInput && el.scrollWidth > el.clientWidth + 1 && c.overflowX !== 'visible' && c.overflowX !== 'auto' && c.overflowX !== 'scroll' && c.textOverflow !== 'ellipsis') out.push({ kind: 'clipped-x', el: pathOf(el), text: (el.textContent).trim().slice(0, 50), over: el.scrollWidth - el.clientWidth })
    if (hasOwnText && el.children.length === 0) {
      const r = document.createRange(); r.selectNodeContents(el); const tr = r.getBoundingClientRect()
      const par = el.parentElement
      const pc = par && getComputedStyle(par)
      if (par && el.tagName !== 'TEXTAREA' && pc.overflowX === 'visible' && pc.display !== 'contents') { const pb = par.getBoundingClientRect(); if (tr.right > pb.right + 1.5 || tr.left < pb.left - 1.5) out.push({ kind: 'outside-parent', el: pathOf(el), text: el.textContent.trim().slice(0, 50), over: Math.round(Math.max(tr.right - pb.right, pb.left - tr.left)) }) }
    }
  }
  return out
}

let browser
const found = new Map()
try {
  browser = await launchBrowser(chromium)
  for (const theme of ['dark', 'light']) {
    for (const w of [900, 1000, 1180, 1366, 1600]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 860 } })
      const page = await ctx.newPage()
      page.setDefaultTimeout(8000)
      await page.goto(`http://localhost:${PORT}/`)
      await page.evaluate((t) => { localStorage.setItem('esb-banner-studio/theme', t) }, theme)
      await page.reload(); await page.waitForTimeout(700)
      await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /Outreach/i.test(x.textContent || '')); b?.click() })
      await page.waitForSelector('.outreach-workspace'); await page.waitForTimeout(600)
      const fi = page.locator('input[type=file][accept*=".xlsx"]')
      if (await fi.count()) { await fi.first().setInputFiles({ name: 'synthetic-contacts.csv', mimeType: 'text/csv', buffer: csvBuffer }); await page.waitForTimeout(900) }
      // make a campaign so the composer is on screen
      await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /New campaign/i.test(x.textContent || '')); b?.click() })
      await page.waitForTimeout(700)
      const collect = async (label) => {
        const list = await page.evaluate(detector)
        for (const f of list) {
          const k = `${f.kind} ${f.el} :: ${f.text}`
          if (!found.has(k)) found.set(k, { ...f, at: [] })
          found.get(k).at.push(`${theme}/${w}/${label}`)
        }
      }
      await collect('composer')
      // left tabs
      for (const t of ['Campaigns', 'Sources']) {
        await page.evaluate((tt) => { const b = [...document.querySelectorAll('.side-tabs button, .tabs button')].find((x) => (x.textContent || '').trim().startsWith(tt)); b?.click() }, t)
        await page.waitForTimeout(400); await collect('left-' + t)
      }
      // review & send sheet
      await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /Review & send/i.test(x.textContent || '')); b?.click() })
      await page.waitForTimeout(600); await collect('review-sheet')
      await page.keyboard.press('Escape'); await page.waitForTimeout(300)
      // assistant
      await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /Ask the assistant/i.test(x.textContent || '')); b?.click() })
      await page.waitForTimeout(500); await collect('assistant')
      await page.keyboard.press('Escape'); await page.waitForTimeout(200)
      await ctx.close()
    }
  }
} finally { await browser?.close(); vite.kill() }
const rows = [...found.values()]
console.log(`${rows.length} unique findings`)
for (const f of rows) console.log(`- [${f.kind} +${f.over ?? '?'}px] ${f.el}\n    "${f.text}" @ ${f.at.slice(0, 4).join(', ')}${f.at.length > 4 ? ` +${f.at.length - 4}` : ''}`)
