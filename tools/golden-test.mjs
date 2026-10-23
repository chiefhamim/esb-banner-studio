// Golden test: render templates in a real Chromium engine and diff them against Figma's own exports.
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'
import { launchBrowser } from './launch-browser.mjs'

const PORT = 5199
const root = path.resolve(import.meta.dirname, '..')
const outDir = path.join(root, 'tools', 'out')
fs.mkdirSync(outDir, { recursive: true })

const cases = JSON.parse(process.argv[2] ?? '[{"name":"social-01","fmt":"social","cat":"01","golden":"fb-01.png","mask":[0,297,1598,740]},{"name":"web-01","fmt":"web","cat":"01","golden":"web-01.png","mask":[0,200,1280,800]}]')

const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
const waitUp = async () => { for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://localhost:${PORT}/golden.html`); if (r.ok) return } catch {} await new Promise((r) => setTimeout(r, 500)) } throw new Error('vite did not start') }

function maskOut(png, [x, y, w, h]) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) { const k = (j * png.width + i) * 4; png.data[k] = 128; png.data[k + 1] = 128; png.data[k + 2] = 128; png.data[k + 3] = 255 }
}

try {
  await waitUp()
  const browser = await launchBrowser(chromium)
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message))
  for (const c of cases) {
    const qs = new URLSearchParams({ fmt: c.fmt, cat: c.cat, ...(c.extra ?? {}) })
    await page.goto(`http://localhost:${PORT}/golden.html?${qs}`)
    await page.waitForFunction('window.__done === true', null, { timeout: 30000 })
    const err = await page.evaluate('window.__err')
    if (err) { console.log(c.name, 'ERROR', err); continue }
    const dataUrl = await page.evaluate('window.__png')
    const mine = PNG.sync.read(Buffer.from(dataUrl.split(',')[1], 'base64'))
    fs.writeFileSync(path.join(outDir, c.name + '.png'), PNG.sync.write(mine))
    const metrics = await page.evaluate('window.__metrics')
    const gold = PNG.sync.read(fs.readFileSync(path.join(root, 'tools', 'golden', c.golden)))
    if (gold.width !== mine.width || gold.height !== mine.height) { console.log(c.name, 'SIZE MISMATCH', gold.width, gold.height, mine.width, mine.height); continue }
    if (c.mask) { maskOut(gold, c.mask); maskOut(mine, c.mask) }
    const diff = new PNG({ width: mine.width, height: mine.height })
    const bad = pixelmatch(mine.data, gold.data, diff.data, mine.width, mine.height, { threshold: 0.1, includeAA: false })
    fs.writeFileSync(path.join(outDir, c.name + '.diff.png'), PNG.sync.write(diff))
    const total = mine.width * mine.height
    console.log(`${c.name}: ${bad} px differ (${(bad / total * 100).toFixed(3)} %)`)
    if (process.env.METRICS) console.log(JSON.stringify(metrics))
  }
  await browser.close()
} finally { vite.kill() }
