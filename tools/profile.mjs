// CPU-profile a drag (4x throttled) and print the heaviest functions.
import { chromium } from 'playwright-core'
import { launchBrowser } from './launch-browser.mjs'
import { spawn } from 'node:child_process'
import path from 'node:path'
const PORT = 5193
const root = path.resolve(import.meta.dirname, '..')
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }
let browser
try {
  browser = await launchBrowser(chromium)
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 1.25 })).newPage()
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForSelector('.topbar'); await page.waitForTimeout(600)
  const ph = path.join(root, 'src/assets/images/sample-photo.jpg')
  await page.setInputFiles('input[type=file]', [ph, ph, ph]); await page.waitForTimeout(700)
  if (process.env.FMT === 'web') { await page.click('.pillnav button:has-text("WEB")'); await page.waitForTimeout(500) }
  await page.locator('.layer .name', { hasText: /^Headline$/ }).click()
  const box = await page.locator('.el-box.selected').boundingBox()
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start')
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2
  await page.mouse.move(cx, cy); await page.mouse.down()
  for (let i = 1; i <= 120; i++) { await page.mouse.move(cx - i * 2, cy - i); await new Promise((r) => setTimeout(r, 6)) }
  await page.mouse.up()
  const { profile } = await cdp.send('Profiler.stop')
  const self = new Map(); const total = profile.samples.length
  const byId = new Map(profile.nodes.map((n) => [n.id, n]))
  const counts = new Map(); for (const id of profile.samples) counts.set(id, (counts.get(id) ?? 0) + 1)
  for (const [id, c] of counts) { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${path.basename(n.callFrame.url).split('?')[0]}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) ?? 0) + c) }
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18)
  console.log('samples', total)
  for (const [k, c] of top) console.log(String((c / total * 100).toFixed(1)).padStart(5) + '%  ' + k)
} catch (e) { console.log('ERR', e.stack ?? e.message) } finally { await browser?.close().catch(() => {}); vite.kill() }
