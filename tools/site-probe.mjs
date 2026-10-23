// Look at esbpowerline.com: screenshots + the real fonts/colours it uses.
import { chromium } from 'playwright-core'
import { launchBrowser } from './launch-browser.mjs'
import fs from 'node:fs'
const b = await launchBrowser(chromium)
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await p.goto('https://esbpowerline.com/', { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => console.log('goto', e.message))
await p.waitForTimeout(2500)
await p.screenshot({ path: 'tools/out/site/home.png' })
await p.screenshot({ path: 'tools/out/site/full.png', fullPage: true })
const info = await p.evaluate(() => {
  const cs = (el) => el ? getComputedStyle(el) : null
  const pick = (sel) => { const el = document.querySelector(sel); if (!el) return null; const c = cs(el); return { sel, font: c.fontFamily, size: c.fontSize, weight: c.fontWeight, color: c.color, bg: c.backgroundColor, radius: c.borderRadius, ls: c.letterSpacing } }
  const root = getComputedStyle(document.documentElement)
  const vars = {}
  for (const s of document.styleSheets) { try { for (const r of s.cssRules) if (r.selectorText === ':root' || r.selectorText === ':root, :host') for (const n of r.style) if (n.startsWith('--')) vars[n] = r.style.getPropertyValue(n).trim() } catch {} }
  return {
    title: document.title,
    body: pick('body'), h1: pick('h1'), h2: pick('h2'), h3: pick('h3'), p: pick('p'), a: pick('a'), button: pick('button'), nav: pick('nav'), header: pick('header'),
    btnLike: pick('a[class*=btn], a[class*=button], button[class*=btn], .btn'),
    fonts: [...document.fonts].map((f) => f.family + ' ' + f.weight + ' ' + f.status),
    links: [...document.querySelectorAll('link[rel=stylesheet],link[href*=font]')].map((l) => l.href).slice(0, 12),
    vars: Object.fromEntries(Object.entries(vars).slice(0, 60)),
    rootBg: root.backgroundColor,
  }
})
fs.writeFileSync('tools/out/site/info.json', JSON.stringify(info, null, 2))
console.log(JSON.stringify(info, null, 1).slice(0, 3500))
await b.close()
