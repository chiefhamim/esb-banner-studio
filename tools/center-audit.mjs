// Centering audit: every button-like control's content (icons, labels, chips) measured against its padding box, in
// Home, Graphics, Video, the Editorial tabs and the AI dialog, at W= widths (default 900,1280,1920) in both themes.
// Reports a vertical offset over 1.5 px, a horizontal one over 1.5 px where the control centres its content, and any
// content that leaves its box. Usage: node tools/center-audit.mjs   (W=1024,1366 to choose widths)
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'
const PORT = 5217, root = fileURLToPath(new URL('..', import.meta.url))
const vite = spawn(process.execPath, [root + 'node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }
const widths = (process.env.W || '900,1280,1920').split(',').map(Number)
const measure = () => {
  const SEL = 'button, .btn, .ibtn, .pv-btn, .ws-btn, .mb-item, .select, .seo-chip, .fact-pill, .ed-state-chip, .tab, a.btn'
  const out = []
  for (const el of document.querySelectorAll(SEL)) {
    const r = el.getBoundingClientRect()
    if (r.width < 8 || r.height < 8 || r.bottom < 0 || r.top > innerHeight) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || +cs.opacity === 0 || cs.display === 'contents') continue
    if (el.closest('.popover, .canvas-wrap, .stage, .vw-timeline, iframe')) continue
    // content: visible svg/img/i children and text runs, not nested buttons
    const rects = []
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) { if (!c.textContent.trim()) continue; const rg = document.createRange(); rg.selectNodeContents(c); for (const q of rg.getClientRects()) if (q.width > 0) rects.push(q) }
        else if (c.nodeType === 1) {
          const s = getComputedStyle(c); if (s.display === 'none' || s.visibility === 'hidden' || s.position === 'absolute' || s.position === 'fixed') continue
          const chip = s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent'
          if (chip || c.matches('svg, img, i, kbd, .swatch-dot, .site-dot, .ed-avatar, .ed-ai-dot')) { const q = c.getBoundingClientRect(); if (q.width > 0) rects.push(q) }
          else walk(c)
        }
      }
    }
    walk(el)
    if (!rects.length) continue
    const L = Math.min(...rects.map((q) => q.left)), R = Math.max(...rects.map((q) => q.right)), T = Math.min(...rects.map((q) => q.top)), B = Math.max(...rects.map((q) => q.bottom))
    const bl = parseFloat(cs.borderLeftWidth), br = parseFloat(cs.borderRightWidth), bt = parseFloat(cs.borderTopWidth), bb = parseFloat(cs.borderBottomWidth)
    const box = { l: r.left + bl, r: r.right - br, t: r.top + bt, b: r.bottom - bb }
    const dy = ((T + B) / 2) - ((box.t + box.b) / 2)
    const centeredX = cs.justifyContent === 'center' || cs.textAlign === 'center' || (rects.length === 1 && el.querySelector('svg') && !el.textContent.trim())
    const pl = parseFloat(cs.paddingLeft), pr = parseFloat(cs.paddingRight)
    const dx = ((L + R) / 2) - ((box.l + pl + box.r - pr) / 2)
    const overflow = R > box.r + 0.5 || L < box.l - 0.5 || B > box.b + 0.5 || T < box.t - 0.5
    const name = (el.className?.baseVal ?? el.className ?? '').toString().split(' ').filter(Boolean).slice(0, 3).join('.') || el.tagName.toLowerCase()
    const label = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28)
    const tall = (B - T) > (box.b - box.t) * 0.9 // content fills the box (multi-line): nothing to centre
    if ((!tall && Math.abs(dy) > 1.5) || (centeredX && R - L < box.r - box.l - pl - pr - 1 && Math.abs(dx) > 1.5) || overflow) out.push(`${name} "${label}" dy=${dy.toFixed(1)} dx=${centeredX ? dx.toFixed(1) : '-'}${overflow ? ' OVERFLOW' : ''}`)
  }
  return out
}
const b = await launchBrowser(chromium)
const seen = new Map()
try {
  for (const theme of ['light', 'dark']) for (const w of widths) {
    const page = await b.newPage({ viewport: { width: w, height: 900 } })
    await page.addInitScript(() => { window.__customTranslator = async () => 'Petrobangla will drill two new wells in the Sylhet gas field, officials said on Sunday.' })
    await page.goto(`http://localhost:${PORT}/`); await page.waitForSelector('.studio-shell')
    if (theme === 'dark') await page.evaluate(() => window.__store.getState().setTheme('dark'))
    const add = (where, list) => { for (const l of list) { const k = `${where} :: ${l.replace(/d[xy]=-?[\d.]+/g, '')}`; if (!seen.has(k)) seen.set(k, `${where}@${w}/${theme} ${l}`) } }
    add('home', await page.evaluate(measure))
    for (const ws of ['graphics', 'video', 'editorial']) {
      await page.click(`.ws-btn[data-ws="${ws}"]`); await page.waitForTimeout(600)
      if (ws === 'editorial') {
        add('editorial-empty', await page.evaluate(measure))
        await page.click('button:has-text("Paste Text or File")'); await page.fill('.ed-paste-area', 'পেট্রোবাংলা সিলেট গ্যাসক্ষেত্রে দুটি নতুন কূপ খনন করবে\nপেট্রোবাংলা সিলেট গ্যাসক্ষেত্রে দুটি নতুন উন্নয়ন কূপ খননের উদ্যোগ নিয়েছে।')
        await page.click('button:has-text("Process Story")'); await page.waitForSelector('.ed-card-story', { timeout: 30000 }); await page.waitForTimeout(600)
        for (const tab of ['body', 'seo', 'social']) {
          await page.evaluate((t) => [...document.querySelectorAll('.ed-story-tabs button')].find((x) => new RegExp(t, 'i').test(x.textContent + (x.getAttribute('aria-label') || '')))?.click(), tab); await page.waitForTimeout(300)
          add('editorial-' + tab, await page.evaluate(measure))
        }
        await page.click('.ed-ai-chip'); await page.waitForTimeout(300); add('ai-dialog', await page.evaluate(measure)); await page.keyboard.press('Escape')
      } else add(ws, await page.evaluate(measure))
    }
    await page.close()
  }
} finally { await b.close(); vite.kill() }
console.log([...seen.values()].join('\n') || 'no problems')
console.log('total', seen.size)
