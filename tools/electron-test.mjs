// Launch the packaged-style app (dist/ + Electron) and check the native bridge and a save.
import { _electron as electron } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
const root = path.resolve(import.meta.dirname, '..')
const win = process.platform === 'win32'
const exe = path.join(root, 'node_modules', 'electron', 'dist', win ? 'electron.exe' : 'electron')
// isolated profile so the test never touches the user's saved work
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-profile-'))
const app = await electron.launch({ executablePath: exe, args: [...(win ? [] : ['--no-sandbox']), root, '--user-data-dir=' + profile] })
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
try {
  await page.waitForSelector('.topbar', { timeout: 15000 })
  await page.waitForTimeout(800)
  const hasBridge = await page.evaluate(() => typeof window.esb?.saveImage === 'function' && typeof window.esb?.pickFolder === 'function')
  console.log(hasBridge ? 'PASS' : 'FAIL', 'preload bridge exposed')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-'))
  const saved = await page.evaluate((d) => window.esb.saveImage('probe.png', new Uint8Array([137, 80, 78, 71]), d), tmp)
  console.log(saved && fs.existsSync(saved) ? 'PASS' : 'FAIL', 'native save writes file', saved)
  const sneaky = await page.evaluate((d) => window.esb.saveImage('../escape.png', new Uint8Array([1]), d), tmp)
  console.log(path.dirname(sneaky) === tmp ? 'PASS' : 'FAIL', 'file name is sanitised to the chosen folder')

  // S2: Path scoping checks
  const forgedRead = await page.evaluate(() => window.esb.readProject('C:\\Windows\\System32\\drivers\\etc\\hosts'))
  console.log(forgedRead === null ? 'PASS' : 'FAIL', 'forged read-project path rejected')

  const forgedSaveRes = await page.evaluate(async () => {
    try {
      await window.esb.saveImage('evil.png', new Uint8Array([1]), 'C:\\Windows\\System32')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })
  console.log(!forgedSaveRes.ok && forgedSaveRes.error.includes('denied') ? 'PASS' : 'FAIL', 'forged save-image dir rejected')

  // S1: Network guard SSRF checks
  const loopbackFetch = await page.evaluate(() => window.esb.fetchUrl('http://127.0.0.1:9999/'))
  console.log(!loopbackFetch.ok && loopbackFetch.code === 'private_address' ? 'PASS' : 'FAIL', 'SSRF 127.0.0.1 rejected')

  const metaFetch = await page.evaluate(() => window.esb.fetchUrl('http://169.254.169.254/latest/meta-data/'))
  console.log(!metaFetch.ok && metaFetch.code === 'private_address' ? 'PASS' : 'FAIL', 'SSRF 169.254.169.254 rejected')

  const menuGone = await app.evaluate(({ Menu }) => Menu.getApplicationMenu() === null)
  console.log(menuGone ? 'PASS' : 'FAIL', 'native menu removed (Alt cannot pop it up)')
  const title = await page.title()
  console.log(title.includes('ESB Studio') ? 'PASS' : 'FAIL', 'window title is ESB Studio:', title)
  const canvasOk = await page.evaluate(() => { const c = document.querySelector('.stage-canvas'); return !!c && c.width > 300 })
  console.log(canvasOk ? 'PASS' : 'FAIL', 'stage canvas rendered')

  // Workspace switcher navigation
  await page.click('.ws-btn[data-ws="home"]')
  await page.waitForSelector('.home-workspace')
  const homeOk = await page.evaluate(() => !!document.querySelector('.home-workspace h1')?.textContent.includes('ESB PowerLine Studio'))
  console.log(homeOk ? 'PASS' : 'FAIL', 'switched to Home workspace')

  await page.click('.ws-btn[data-ws="editorial"]')
  await page.waitForSelector('.editorial-workspace')
  const editorialOk = await page.waitForSelector('.editorial-workspace .ws-btn.on[data-ws="editorial"]', { timeout: 8000 }).then(() => true, () => false)
  console.log(editorialOk ? 'PASS' : 'FAIL', 'switched to Editorial workspace')

  await page.click('.ws-btn[data-ws="video"]')
  await page.waitForSelector('.video-workspace')
  const videoOk = await page.evaluate(() => !!document.querySelector('.video-workspace canvas'))
  console.log(videoOk ? 'PASS' : 'FAIL', 'switched to Video workspace')

  await page.click('.ws-btn[data-ws="graphics"]')
  await page.waitForSelector('.stage-canvas')
  const graphicsOk = await page.evaluate(() => !!document.querySelector('.stage-canvas'))
  console.log(graphicsOk ? 'PASS' : 'FAIL', 'switched back to Graphics workspace')
  await page.screenshot({ path: path.join(root, 'tools', 'out', 'electron.png') })
  console.log(errors.length ? 'FAIL' : 'PASS', 'no console errors', errors.slice(0, 3).join(' | '))
} finally {
  await app.close()
}
