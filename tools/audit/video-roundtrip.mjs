// Video with footage → Graphics → back to Video: does the monitor still draw? (the owner saw the viewport break)
import { _electron as electron } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
const root = path.resolve(import.meta.dirname, '../..')
const exe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-vrt-'))
const speech = path.join(work, 'speech-6s.mp4')
fs.copyFileSync(path.join(root, 'tools/fixtures/video/speech-6s.mp4'), speech)
const out = path.join(root, 'artifacts', 'pass10'); fs.mkdirSync(out, { recursive: true })
const app = await electron.launch({ executablePath: exe, args: [root, '--user-data-dir=' + path.join(work, 'p')], env: { ...process.env, ESB_NO_SYNC: '1' } })
const page = await app.firstWindow()
page.setDefaultTimeout(20000)
const logs = []
page.on('console', (m) => { if (/error|warn/.test(m.type())) logs.push(m.type() + ': ' + m.text().slice(0, 300)) })
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + (e.stack || e.message).slice(0, 900)))
await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }) }, speech)
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 950))
await page.evaluate(() => localStorage.setItem('esb-banner-studio/theme', 'dark')); await page.reload()
await page.waitForSelector('.launch-tile')
const go = (l) => page.evaluate((l) => [...document.querySelectorAll('.ws-btn, .launch-tile, button')].find((x) => new RegExp('^' + l).test((x.getAttribute('aria-label') || x.textContent || '').trim()))?.click(), l)
await go('Video'); await page.waitForSelector('.vw-start-import'); await page.click('.vw-start-import')
await page.waitForSelector('.vw-media-card'); await page.click('.vw-media-card .vw-add')
await page.waitForFunction(() => document.querySelectorAll('.vw-clip-block').length >= 1)
const sample = () => page.evaluate(() => {
  const g = document.querySelector('.vw-canvas'); if (!g) return 'no canvas'
  const gl = g.getContext('webgl2'); const lost = gl?.isContextLost()
  const c = document.createElement('canvas'); c.width = g.width; c.height = g.height
  c.getContext('2d').drawImage(g, 0, 0)
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  let s = 0, n = 0; for (let i = 0; i < d.length; i += 4 * 97) { s += d[i] + d[i + 1] + d[i + 2]; n++ }
  return `${g.width}x${g.height} css ${g.clientWidth}x${g.clientHeight} lost=${lost} mean=${Math.round(s / n)} err=${document.querySelector('.vw-gl-error')?.textContent || '-'}`
})
await page.click('.vw-ruler, .vw-timeline', { position: { x: 300, y: 10 } }).catch(() => {})
await page.waitForTimeout(1200)
console.log('first     ', await sample()); await page.screenshot({ path: path.join(out, 'vrt-0.png') })
for (let i = 1; i <= Number(process.env.N || 4); i++) {
  if (i === 2) { await page.click('.play-btn').catch(() => {}); await page.waitForTimeout(500) }
  await go('Graphics'); await page.waitForTimeout(1200)
  await go('Video'); await page.waitForTimeout(1500)
  console.log('round ' + i, await sample().catch(e => 'EVAL FAIL ' + e.message))
  const shotOk = await page.screenshot({ path: path.join(out, `vrt-${i}.png`), timeout: 8000 }).then(() => 'painted', () => 'NO PAINT')
  console.log('  ', shotOk)
}
// film Graphics -> Video
await go('Graphics'); await page.waitForTimeout(1200)
await go('Video')
for (let i = 0; i < 10; i++) await page.screenshot({ path: path.join(out, `vfilm-${i}.png`) })
console.log(logs.join('\n'))
await app.close().catch(() => {}); process.exit(0)
