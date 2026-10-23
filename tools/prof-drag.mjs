// CPU profile of dragging a layer: top self-time functions. node tools/prof-drag.mjs
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
const PORT = 5200, root = path.resolve(import.meta.dirname, '..')
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }
let b
try {
  b = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await (await b.newContext({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 1.25 })).newPage()
  await page.goto(`http://localhost:${PORT}/`); await page.waitForSelector('.topbar'); await page.waitForTimeout(800)
  const ph = path.join(root, 'src/assets/images/sample-photo.jpg')
  await page.setInputFiles('input[type=file]', [ph]); await page.waitForTimeout(800)
  await page.locator('.el-row:has-text("Headline") .name').first().click()
  const hb = await page.locator('.el-box.selected').boundingBox()
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 100 })
  const from = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.waitForTimeout(100)
  await cdp.send('Profiler.start')
  for (let i = 1; i <= 80; i++) { await page.mouse.move(from.x - i, from.y - i * 0.6); await page.waitForTimeout(7) }
  await page.waitForTimeout(60)
  const { profile } = await cdp.send('Profiler.stop'); await page.mouse.up()
  const self = new Map(); const byId = new Map(profile.nodes.map((n) => [n.id, n]))
  const dt = profile.timeDeltas; let tot = 0
  profile.samples.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) || 0) + dt[i]); tot += dt[i] })
  console.log('total sampled ms', (tot / 1000).toFixed(0))
  for (const [k, v] of [...self.entries()].sort((a, c) => c[1] - a[1]).slice(0, 18)) console.log((v / 1000).toFixed(1).padStart(7), 'ms', k)
} finally { await b?.close(); vite.kill() }
