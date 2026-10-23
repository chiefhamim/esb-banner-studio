// Interaction performance probe: frame times while dragging + cost of building/rendering the scene.
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
const PORT = 5194
const root = path.resolve(import.meta.dirname, '..')
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }
let browser
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 1.25 })).newPage()
  page.setDefaultTimeout(10000)
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForSelector('.topbar'); await page.waitForTimeout(600)
  const ph = path.join(root, 'src/assets/images/sample-photo.jpg')
  await page.setInputFiles('input[type=file]', [ph, ph, ph])
  await page.waitForTimeout(700)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.THROTTLE ?? 4) })
  const fmtBtn = { social: '.pillnav button:has-text("FACEBOOK")', web: '.pillnav button:has-text("WEB")' }
  for (const fmt of ['social', 'web']) {
    if (await page.locator(fmtBtn[fmt]).count()) await page.click(fmtBtn[fmt])
    await page.waitForTimeout(500)
    const micro = {}
    // drag the headline layer and sample frame deltas
    await page.locator('.layer .name', { hasText: /^Headline$/ }).click()
    const box = await page.locator('.el-box.selected').boundingBox()
    await page.evaluate(() => { window.__f = []; const loop = (t) => { window.__f.push(t); window.__run && requestAnimationFrame(loop) }; window.__run = true; requestAnimationFrame(loop) })
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2
    await page.mouse.move(cx, cy); await page.mouse.down()
    for (let i = 1; i <= 90; i++) { await page.mouse.move(cx - i * 2, cy - i); await new Promise((r) => setTimeout(r, 6)) }
    await page.mouse.up()
    const fr = await page.evaluate(() => { window.__run = false; const f = window.__f; const d = f.slice(1).map((v, i) => v - f[i]); d.sort((a, b) => a - b); return { frames: f.length, avgMs: +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(1), p95: +d[Math.floor(d.length * 0.95)].toFixed(1), max: +d[d.length - 1].toFixed(1) } })
    console.log(fmt, JSON.stringify({ ...micro, drag: fr }))
    await page.keyboard.press('Control+z')
  }
} catch (e) { console.log('ERR', e.stack ?? e.message) } finally { await browser?.close().catch(() => {}); vite.kill() }
