// Frame cost of the interactions that must feel instant on a 120–144 Hz display.
// Runs Edge with the frame-rate cap off, so the rAF interval *is* the cost of one frame (budget: 8.3 ms @120 Hz, 6.9 ms @144 Hz).
// node tools/audit/perf-ui.mjs   (THROTTLE=4 to simulate a slower CPU)
import { chromium } from 'playwright-core'
import { launchBrowser } from '../launch-browser.mjs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { portOffset } from '../port-offset.mjs'
const PORT = 5199 + portOffset(), root = path.resolve(import.meta.dirname, '../..')
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }
let b
try {
  b = await launchBrowser(chromium, { args: ['--disable-frame-rate-limit', '--disable-gpu-vsync'] })
  const page = await (await b.newContext({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 1.25 })).newPage()
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message))
  await page.goto(`http://localhost:${PORT}/`); await page.waitForSelector('.topbar'); await page.waitForTimeout(800)
  const ph = path.join(root, 'src/assets/images/sample-photo.jpg')
  await page.setInputFiles('input[type=file]', [ph, ph]); await page.waitForTimeout(800)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.THROTTLE ?? 1) })
  const start = () => page.evaluate(() => { window.__f = []; window.__run = true; const loop = (t) => { window.__f.push(t); if (window.__run) requestAnimationFrame(loop) }; requestAnimationFrame(loop) })
  const stop = () => page.evaluate(() => { window.__run = false; const f = window.__f, d = f.slice(1).map((v, i) => v - f[i]).sort((a, c) => a - c); const q = (p) => d[Math.min(d.length - 1, Math.floor(d.length * p))]; return { frames: f.length, p50: +q(.5).toFixed(1), p95: +q(.95).toFixed(1), p99: +q(.99).toFixed(1), max: +d[d.length - 1].toFixed(1), over8_3: d.filter((x) => x > 8.4).length } })
  const mid = async (sel) => { const r = await page.locator(sel).boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }
  await cdp.send('Performance.enable')
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
  // one pointer move per simulated 144 Hz frame; the main-thread time each move costs is what has to fit in 6.9 ms
  const sweep = async (from, dx, dy, n = 80) => {
    await page.mouse.move(from.x, from.y); await page.mouse.down()
    await page.waitForTimeout(100)
    const m0 = await metrics()
    for (let i = 1; i <= n; i++) { await page.mouse.move(from.x + (dx * i) / n, from.y + (dy * i) / n); await page.waitForTimeout(7) }
    await page.waitForTimeout(60)
    const m1 = await metrics(); await page.mouse.up()
    const per = (k) => +(((m1[k] - m0[k]) * 1000) / n).toFixed(2)
    return { moves: n, 'main-thread ms/move': per('TaskDuration'), script: per('ScriptDuration'), layout: per('LayoutDuration'), style: per('RecalcStyleDuration') }
  }
  const rows = {}
  rows['left panel resize'] = await sweep(await mid('.left > .splitter'), 120, 0)
  await page.locator('.left > .splitter').dblclick()
  rows['right panel resize'] = await sweep(await mid('.right > .splitter'), -120, 0)
  await page.locator('.right > .splitter').dblclick()
  await page.locator('.el-row:has-text("Headline") .name').first().click()
  const hb = await page.locator('.el-box.selected').boundingBox()
  rows['drag a layer on the banner'] = await sweep({ x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }, -90, -60)
  await page.keyboard.press('Control+z')
  await page.click('.pv-btn'); await page.waitForTimeout(500)
  rows['drag the preview window'] = await sweep(await mid('.pvw-head'), -200, 60)
  rows['resize the preview window'] = await sweep(await mid('.pvw-resize'), 90, 0)
  // typing in the headline repaints the banner and the preview
  await page.click('.pvw [aria-label^="Close preview"]')
  await page.locator('.pnl textarea.input').first().click()
  const t0 = await metrics()
  for (let i = 0; i < 40; i++) { await page.keyboard.type('x', { delay: 8 }) }
  await page.waitForTimeout(80)
  const t1 = await metrics()
  rows['type a headline (banner repaint)'] = { keys: 40, 'main-thread ms/key': +(((t1.TaskDuration - t0.TaskDuration) * 1000) / 40).toFixed(2), script: +(((t1.ScriptDuration - t0.ScriptDuration) * 1000) / 40).toFixed(2) }
  console.log(`CPU throttle ${process.env.THROTTLE ?? 1}×   (main-thread cost per interaction frame; budget 8.3 ms @120 Hz, 6.9 ms @144 Hz)`)
  for (const [k, v] of Object.entries(rows)) console.log(k.padEnd(34), JSON.stringify(v))
} catch (e) { console.log('ERR', e.stack ?? e.message) } finally { await b?.close().catch(() => {}); vite.kill() }
