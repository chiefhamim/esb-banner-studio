// Finds text that is clipped / overflowing its container across panels, dialogs and menus (both themes).
import { chromium } from 'playwright-core'
import { launchBrowser } from './launch-browser.mjs'
import { spawn } from 'node:child_process'
import path from 'node:path'
const PORT = 5190
const root = path.resolve(import.meta.dirname, '..')
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }
let browser
const found = new Map()
try {
  browser = await launchBrowser(chromium)
  const page = await (await browser.newContext({ viewport: { width: Number(process.env.W ?? 1600), height: 950 } })).newPage()
  page.setDefaultTimeout(8000)
  await page.goto(`http://localhost:${PORT}/`)
  // a fresh profile opens on Home; this script works in Graphics
  await page.evaluate(() => localStorage.setItem('esb-banner-studio/shell', JSON.stringify({ workspace: 'graphics' })))
  await page.reload()
  await page.waitForSelector('.topbar'); await page.waitForTimeout(600)
  const audit = async (label) => {
    const list = await page.evaluate(() => {
      const out = []
      const vis = (el) => { const r = el.getBoundingClientRect(); const c = getComputedStyle(el); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none' }
      const path = (el) => { const p = []; for (let e = el; e && e !== document.body && p.length < 4; e = e.parentElement) p.push(e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ').filter(Boolean).slice(0, 2).join('.') : '')); return p.join(' < ') }
      for (const el of document.querySelectorAll('body *')) {
        if (!vis(el) || el.closest('.stage-area, svg, canvas')) continue
        const c = getComputedStyle(el)
        const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
        const isInput = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
        if ((hasOwnText || isInput) && el.scrollWidth > el.clientWidth + 1 && c.overflowX !== 'visible' && c.overflowX !== 'auto' && c.overflowX !== 'scroll') out.push({ kind: 'clipped-x', el: path(el), text: (el.value ?? el.textContent).trim().slice(0, 40), sw: el.scrollWidth, cw: el.clientWidth })
        if (hasOwnText && c.webkitLineClamp !== 'none' && el.scrollHeight > el.clientHeight + 1) out.push({ kind: 'clamped', el: path(el), text: el.textContent.trim().slice(0, 40) })
        if (hasOwnText && el.children.length === 0) {
          const r = document.createRange(); r.selectNodeContents(el); const tr = r.getBoundingClientRect()
          let par = el.parentElement
          const pc = par && getComputedStyle(par)
          if (par && el.tagName !== 'TEXTAREA' && pc.overflowX === 'visible') { const pb = par.getBoundingClientRect(); if (tr.right > pb.right + 1.5 || tr.left < pb.left - 1.5) out.push({ kind: 'outside-parent', el: path(el), text: el.textContent.trim().slice(0, 40), over: Math.round(Math.max(tr.right - pb.right, pb.left - tr.left)) }) }
        }
      }
      return out
    })
    for (const f of list) { const key = f.kind + '|' + f.el + '|' + f.text; if (!found.has(key)) found.set(key, { ...f, state: label }) }
  }
  const ph = path.join(root, 'src/assets/images/sample-photo.jpg')
  await page.setInputFiles('input[type=file]', [ph, ph, ph]); await page.waitForTimeout(500)
  await page.locator('.pnl > header', { hasText: 'Headline' }).first().click()
  await page.fill('.pnl-body textarea.input', 'Review Meeting Held on Progress of Power Division Development Projects')
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.click('[aria-label="Dark theme"]')
    await page.click('.side-tabs button:has-text("Story")')
    for (const h of ['Label pill', 'Photo credit', 'Post caption']) { const hd = page.locator('.pnl > header', { hasText: h }); if (!(await hd.locator('xpath=..').getAttribute('class')).includes('open')) await hd.click() }
    await audit(theme + ':story')
    await page.click('.lp:has-text("BREAKING")'); await audit(theme + ':label')
    await page.click('.side-tabs button:has-text("Photos")'); await audit(theme + ':photos')
    await page.click('.pv-btn'); await page.waitForSelector('.pvw .fb-card'); await audit(theme + ':preview')
    for (const d of ['Desktop', 'Link post']) { await page.click(`.pvw .seg-ctl button:has-text("${d}")`); await audit(theme + ':preview-' + d) }
    await page.click('.pvw .seg-ctl button:has-text("Phone")'); await page.click('.pvw [aria-label^="Close preview"]')
    for (const name of ['Headline', 'Category chip', 'Logo', 'Photos', 'Header background', 'Date number', 'Footer line']) {
      const row = page.locator('.layer .name', { hasText: new RegExp('^' + name + '$') })
      if (await row.count()) { await row.first().click(); await page.waitForTimeout(120); await audit(theme + ':inspector:' + name) }
    }
    await page.keyboard.press('Control+a'); await audit(theme + ':multi')
    await page.keyboard.press('t'); await page.waitForTimeout(100); await audit(theme + ':newtext')
    for (const m of ['File', 'Edit', 'Insert', 'Arrange', 'View', 'Help']) { await page.click(`.mb-item:has-text("${m}")`); await page.waitForTimeout(120); await audit(theme + ':menu:' + m); await page.keyboard.press('Escape') }
    await page.click('.fmtpick'); await page.waitForTimeout(150); await audit(theme + ':formats'); await page.keyboard.press('Escape')
    await page.click('.side-tabs button:has-text("Story")'); await page.click('.datefield'); await page.waitForTimeout(150); await audit(theme + ':date'); await page.keyboard.press('Escape')
    await page.keyboard.press('Control+e'); await page.waitForSelector('.dialog'); await audit(theme + ':export'); await page.keyboard.press('Escape')
    await page.keyboard.press('?'); await page.waitForTimeout(150); await audit(theme + ':keys'); await page.keyboard.press('Escape')
  }
  const rows = [...found.values()]
  console.log(rows.length ? rows.map((r) => `${r.kind.padEnd(14)} [${r.state}] ${r.el}  "${r.text}" ${r.sw ? r.sw + '>' + r.cw : r.over ? '+' + r.over + 'px' : ''}`).join('\n') : 'NO OVERFLOW FOUND')
} catch (e) { console.log('ERR', e.stack ?? e.message) } finally { await browser?.close().catch(() => {}); vite.kill() }
