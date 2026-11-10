// Open a pasted story on the Editorial desk (translator stubbed, no network) and shoot it — both themes, scrollbars visible.
import { chromium } from 'playwright-core'
import { launchBrowser } from '../launch-browser.mjs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { portOffset } from '../port-offset.mjs'
const PORT = 5202 + portOffset()
const root = path.resolve(import.meta.dirname, '../..')
const out = path.join(root, 'artifacts', 'story'); fs.mkdirSync(out, { recursive: true })
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch {} await new Promise(r => setTimeout(r, 500)) }
const paras = ['৫৯২ কোটি টাকায় দুটি নতুন কূপ খনন করবে পেট্রোবাংলা, জাতীয় গ্রিডে যুক্ত হবে ৩০ এমএমসিএফডি গ্যাস', ...Array.from({ length: 14 }, (_, i) => `সিলেট গ্যাস ফিল্ডের আওতায় দুটি নতুন উন্নয়ন কূপ খননের উদ্যোগ নিয়েছে পেট্রোবাংলা ও বাপেক্স। অনুচ্ছেদ ${i + 1}।`)]
let browser
try {
  browser = await launchBrowser(chromium)
  for (const theme of (process.env.THEMES || 'dark,light').split(',')) {
    const ctx = await browser.newContext({ viewport: { width: Number(process.env.W || 1440), height: 900 } })
    const page = await ctx.newPage(); page.setDefaultTimeout(15000)
    await page.addInitScript(() => { window.__customTranslator = async (t) => 'Petrobangla will drill two new wells at Tk 592 crore, adding 30 MMCFD of gas to the national grid. ' + t.length })
    await page.goto(`http://localhost:${PORT}/`)
    await page.evaluate(t => localStorage.setItem('esb-banner-studio/theme', t), theme)
    await page.reload(); await page.waitForTimeout(500)
    await page.evaluate(() => [...document.querySelectorAll('button')].find(x => /Editorial/.test(x.textContent || ''))?.click())
    await page.waitForSelector('button:has-text("Paste Text or File")'); await page.click('button:has-text("Paste Text or File")')
    await page.waitForSelector('.ed-paste-area'); await page.fill('.ed-paste-area', paras.join('\n'))
    await page.click('button:has-text("Process Story")')
    await page.waitForSelector('.ed-card-story', { timeout: 30000 }); await page.waitForTimeout(1800)
    await page.screenshot({ path: path.join(out, `story-${theme}.png`) })
    await page.screenshot({ path: path.join(out, `edge-center-${theme}.png`), clip: { x: 1040, y: 300, width: 120, height: 260 } })
    await page.screenshot({ path: path.join(out, `edge-window-${theme}.png`), clip: { x: 1340, y: 300, width: 100, height: 260 } })
    // where are the scrollbars? list scrollers and their right-edge distance to the window
    const sc = await page.evaluate(() => [...document.querySelectorAll('*')].filter(e => { const c = getComputedStyle(e); return /(auto|scroll)/.test(c.overflowY) && e.scrollHeight > e.clientHeight + 4 && e.clientHeight > 80 }).map(e => { const r = e.getBoundingClientRect(); return { cls: (e.className || '').toString().slice(0, 40), right: Math.round(innerWidth - r.right), bar: e.offsetWidth - e.clientWidth } }))
    console.log(theme, JSON.stringify(sc))
    const pr = await page.evaluate(() => ['.ed-center','.es-scroll'].map(q => { const e = document.querySelector(q); const c = getComputedStyle(e); return { q, ovY: c.overflowY, gut: c.scrollbarGutter, w: e.clientWidth, ow: e.offsetWidth, sw: c.scrollbarWidth, sh: e.scrollHeight, ch: e.clientHeight } }))
    console.log(JSON.stringify(pr))
    console.log(JSON.stringify(await page.evaluate(() => ['.ed-center','.es-scroll','.ed-src-scroll'].map(q => { const e = document.querySelector(q); const ps = getComputedStyle(e, '::-webkit-scrollbar'); const th = getComputedStyle(e, '::-webkit-scrollbar-thumb'); return { q, pw: ps.width, pdisp: ps.display, thbg: th.backgroundColor, cls: e.className, tag: e.tagName, parent: e.parentElement.className } }))))
    await ctx.close()
  }
} finally { await browser?.close(); vite.kill() }
