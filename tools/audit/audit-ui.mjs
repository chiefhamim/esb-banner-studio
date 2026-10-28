// Design-system audit: screenshots + counts of distinct type sizes / radii / gaps / colours actually rendered
import { chromium } from 'playwright-core'
import { launchBrowser } from '../launch-browser.mjs'
import { spawn } from 'node:child_process'
import path from 'node:path'
const PORT = 5195, root = path.resolve(import.meta.dirname, '../..')
const tag = process.argv[2] ?? 'a'
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }
let b
try {
  b = await launchBrowser(chromium)
  for (const [w, h] of [[1600, 950], [1366, 768]]) {
    const page = await b.newPage({ viewport: { width: w, height: h } })
    await page.goto(`http://localhost:${PORT}/`); await page.waitForTimeout(1500)
    await page.screenshot({ path: path.join(root, 'tools/out', `ui-${tag}-${w}.png`) })
    if (w === 1600) {
      const stats = await page.evaluate(() => {
        const c = { size: {}, radius: {}, pad: {}, gap: {}, weight: {}, family: {}, color: {}, bg: {} }
        const inc = (o, k) => { o[k] = (o[k] || 0) + 1 }
        for (const el of document.querySelectorAll('.app *')) {
          const s = getComputedStyle(el); const r = el.getBoundingClientRect()
          if (!r.width || !r.height) continue
          if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) { inc(c.size, s.fontSize); inc(c.weight, s.fontWeight); inc(c.family, s.fontFamily.split(',')[0]); inc(c.color, s.color) }
          if (s.borderRadius !== '0px') inc(c.radius, s.borderRadius.split(' ')[0])
          if (s.gap !== 'normal') inc(c.gap, s.gap.split(' ')[0])
          inc(c.pad, s.paddingLeft); if (s.backgroundColor !== 'rgba(0, 0, 0, 0)') inc(c.bg, s.backgroundColor)
        }
        const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`)
        return Object.fromEntries(Object.entries(c).map(([k, o]) => [k, top(o)]))
      })
      for (const [k, v] of Object.entries(stats)) console.log(k.padEnd(7), v.length, v.slice(0, 40).join('  '))
    }
    await page.close()
  }
} finally { await b?.close(); vite.kill() }
