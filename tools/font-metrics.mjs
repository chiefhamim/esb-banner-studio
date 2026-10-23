// Measure each bundled font's ascent / descent (as ratios of the font size) with the browser's own text engine.
import { chromium } from 'playwright-core'
import { launchBrowser } from './launch-browser.mjs'
import fs from 'node:fs'
import path from 'node:path'
const dir = path.resolve(import.meta.dirname, '..', 'src', 'assets', 'fonts')
const faces = { Inter: 'Inter-700.woff2', 'Space Grotesk': 'ui-grotesk-700.woff2', 'Source Serif 4': 'serif-700.woff2', Oswald: 'oswald-700.woff2' }
const b = await launchBrowser(chromium)
const page = await b.newPage()
await page.setContent('<canvas id=c></canvas>')
const data = Object.fromEntries(Object.entries(faces).map(([k, f]) => [k, fs.readFileSync(path.join(dir, f)).toString('base64')]))
const out = await page.evaluate(async (data) => {
  const res = {}
  for (const [name, b64] of Object.entries(data)) {
    const ff = new FontFace(name, `url(data:font/woff2;base64,${b64})`, { weight: '700' })
    await ff.load(); document.fonts.add(ff)
    const ctx = document.getElementById('c').getContext('2d')
    ctx.font = `700 1000px "${name}"`
    const m = ctx.measureText('Hxg')
    res[name] = { asc: +(m.fontBoundingBoxAscent / 1000).toFixed(5), desc: +(m.fontBoundingBoxDescent / 1000).toFixed(5) }
  }
  return res
}, data)
console.log(JSON.stringify(out, null, 1))
await b.close()
