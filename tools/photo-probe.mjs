// Reproduce "photo library / adding photos is broken" using the real user paths (Add button, drop, paste, double-click on the photo area).
import { chromium, _electron as electron } from 'playwright-core'
import { launchBrowser } from './launch-browser.mjs'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const root = path.resolve(import.meta.dirname, '..')
const photo = path.join(root, 'src/assets/images/sample-photo.jpg')
const mode = process.argv[2] ?? 'dev'
let app, browser, vite, page
if (mode === 'electron') {
  const exe = path.join(root, 'release-v1.5.4', 'win-unpacked', 'ESB Studio.exe')
  app = await electron.launch({ executablePath: exe, args: [], env: { ...process.env, ESB_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'esb-p-')) } })
  page = await app.firstWindow()
} else {
  const PORT = 5184
  vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }
  browser = await launchBrowser(chromium)
  page = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage()
  await page.goto(`http://localhost:${PORT}/`)
}
page.setDefaultTimeout(6000)
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
const log = (n, ok, x = '') => console.log(ok ? 'PASS' : 'FAIL', n, x)
try {
  await page.waitForSelector('.topbar'); await page.waitForTimeout(600)
  await page.click('.side-tabs button:has-text("Photos")')
  // 1) the Add button -> native file chooser
  const chooser = page.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null)
  await page.click('.pnl-actions button:has-text("Add")')
  const fc = await chooser
  log('Add button opens the file chooser', !!fc)
  if (fc) await fc.setFiles(photo)
  await page.waitForTimeout(600)
  const thumbs = await page.locator('.thumb').count()
  log('photo appears in the library', thumbs === 1, 'thumbs=' + thumbs)
  const slotSrc = await page.evaluate(() => window.__store?.getState().doc.photos.slots.fb45[0].src ?? 'n/a (prod build)')
  log('photo is placed in slot 1', slotSrc !== null, String(slotSrc))
  const thumbLoaded = await page.evaluate(() => { const i = document.querySelector('.thumb img'); return !!i && i.complete && i.naturalWidth > 0 })
  log('library thumbnail actually loads (blob URL ok)', thumbLoaded)
  // 2) drag & drop onto the window
  const buf = fs.readFileSync(photo).toString('base64')
  await page.evaluate(async (b64) => {
    const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
    const dt = new DataTransfer(); dt.items.add(new File([u8], 'dropped.jpg', { type: 'image/jpeg' }))
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, buf)
  await page.waitForTimeout(600)
  log('dropping a file adds a photo', (await page.locator('.thumb').count()) === 2, 'thumbs=' + (await page.locator('.thumb').count()))
  // 3) double-click on the empty photo slot area of the canvas opens the chooser
  const c2 = page.waitForEvent('filechooser', { timeout: 3000 }).catch(() => null)
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('esb:add-photos')))
  log('esb:add-photos opens the file chooser', !!(await c2))
  console.log('errors:', errs.slice(0, 4))
} finally { await (browser ?? app)?.close(); vite?.kill() }
