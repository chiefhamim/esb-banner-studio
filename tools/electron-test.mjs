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
// ESB_NO_SYNC: a test run must not start the git auto-sync daemon inside the checkout
const app = await electron.launch({ executablePath: exe, args: [...(win ? [] : ['--no-sandbox']), root, '--user-data-dir=' + profile], env: { ...process.env, ESB_NO_SYNC: '1' } })
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
  // a real PNG signature, long enough for the main process's image check (it reads 16 bytes)
  const PNG = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1]
  // the default folder (Pictures/ESB Banners): the main process refuses the temp directory by design
  const picDir = path.join(await app.evaluate(({ app: a }) => a.getPath('pictures')), 'ESB Banners')
  fs.mkdirSync(picDir, { recursive: true })
  const saved = await page.evaluate(([d, b]) => window.esb.saveImage('esb-test-probe.png', new Uint8Array(b), d), [picDir, PNG])
  console.log(saved && fs.existsSync(saved) ? 'PASS' : 'FAIL', 'native save writes file', saved)
  const sneaky = await page.evaluate(([d, b]) => window.esb.saveImage('../esb-test-escape.png', new Uint8Array(b), d), [picDir, PNG])
  console.log(saved && sneaky && path.dirname(sneaky) === path.dirname(saved) ? 'PASS' : 'FAIL', 'file name is sanitised to the chosen folder')
  const tempRefused = await page.evaluate(([d, b]) => window.esb.saveImage('x.png', new Uint8Array(b), d).then(() => false, () => true), [tmp, PNG])
  console.log(tempRefused ? 'PASS' : 'FAIL', 'a save into the temp directory is refused')
  for (const f of [saved, sneaky]) if (f) fs.rmSync(f, { force: true })

  // S2: Path scoping checks
  const forgedRead = await page.evaluate(() => window.esb.readProject('C:\\Windows\\System32\\drivers\\etc\\hosts'))
  console.log(forgedRead === null ? 'PASS' : 'FAIL', 'forged read-project path rejected')

  const forgedSaveRes = await page.evaluate(async (b) => {
    try {
      // real PNG bytes, so the folder check is what refuses it (one byte is refused earlier, as "not an image")
      await window.esb.saveImage('evil.png', new Uint8Array(b), 'C:\\Windows\\System32')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  }, PNG)
  console.log(!forgedSaveRes.ok && forgedSaveRes.error.includes('denied') ? 'PASS' : 'FAIL', 'forged save-image dir rejected')

  // S1: Network guard SSRF checks
  const loopbackFetch = await page.evaluate(() => window.esb.fetchUrl('http://127.0.0.1:9999/'))
  console.log(!loopbackFetch.ok && loopbackFetch.code === 'private_address' ? 'PASS' : 'FAIL', 'SSRF 127.0.0.1 rejected')

  const metaFetch = await page.evaluate(() => window.esb.fetchUrl('http://169.254.169.254/latest/meta-data/'))
  console.log(!metaFetch.ok && metaFetch.code === 'private_address' ? 'PASS' : 'FAIL', 'SSRF 169.254.169.254 rejected')

  // Opening the site CMS as the signed-in editor: the main process writes the site's own session cookie into the
  // separate esbpowerline.com profile (never the app's) and opens the CMS in its own window. Junk is refused.
  const fakeCookie = [{ name: 'sb-sxgokpmrbgdndstygapc-auth-token', value: 'base64-eyJhY2Nlc3NfdG9rZW4iOiJ0In0' }]
  await page.evaluate((c) => window.esb.openSiteAs(c, '/cms/articles/new'), fakeCookie)
  const siteState = await app.evaluate(async ({ session, BrowserWindow }) => {
    const site = await session.fromPartition('persist:esb-site').cookies.get({ url: 'https://esbpowerline.com' })
    const appSide = await session.defaultSession.cookies.get({ url: 'https://esbpowerline.com' })
    const wins = BrowserWindow.getAllWindows().map((w) => w.webContents.getURL() || w.getTitle())
    return { site: site.map((c) => c.name + '=' + c.value.slice(0, 12) + (c.secure ? ' secure' : '')), appSide: appSide.length, wins }
  })
  console.log(siteState.site.length === 1 && /secure/.test(siteState.site[0]) && siteState.appSide === 0 ? 'PASS' : 'FAIL', 'site session cookie written to the site profile only', JSON.stringify(siteState.site))
  console.log(siteState.wins.some((u) => /esbpowerline\.com\/cms\/articles\/new|esbpowerline/.test(u)) ? 'PASS' : 'FAIL', 'CMS window opened on esbpowerline.com', JSON.stringify(siteState.wins))
  const junk = await page.evaluate(() => window.esb.openSiteAs([{ name: 'evil', value: 'x;Domain=.example.com' }], '//evil.com').then(() => 'accepted', (e) => 'refused'))
  console.log(junk === 'refused' ? 'PASS' : 'FAIL', 'malformed session cookies are refused')
  // Publishing uploads the Web banner through the main process; it refuses anything it should not send, before
  // sending anything (the request itself is covered by tools/unit/site-upload.test.ts)
  const upBad = await page.evaluate(() => window.esb.siteUpload([{ name: 'evil', value: 'x' }], new Uint8Array([0xff, 0xd8, 0xff, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), 'image/jpeg', 'x'))
  const upSvg = await page.evaluate((c) => window.esb.siteUpload(c, new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'image/svg+xml', 'x'), fakeCookie)
  const upFake = await page.evaluate((c) => window.esb.siteUpload(c, new Uint8Array(64), 'image/jpeg', 'x'), fakeCookie)
  console.log(!upBad.ok && /Not signed in/.test(upBad.error) && !upSvg.ok && /Only JPEG/.test(upSvg.error) && !upFake.ok && /not the image type/.test(upFake.error) ? 'PASS' : 'FAIL', 'banner upload IPC refuses bad sessions, types and bytes', JSON.stringify([upBad.error, upSvg.error, upFake.error]))
  const probeBad = await page.evaluate(() => window.esb.siteUploadProbe([]))
  console.log(!probeBad.ok && probeBad.status === 0 ? 'PASS' : 'FAIL', 'upload probe needs a session')
  // Outreach mail bridge: no file reads, one checked email at a time, nothing sent without a saved account
  const oldBridge = await page.evaluate(() => ['loadMailingList', 'sendOutreachEmail'].filter((k) => k in window.esb))
  console.log(oldBridge.length ? 'FAIL' : 'PASS', 'the old any-file / any-config mail bridge is gone', oldBridge.join(','))
  const st0 = await page.evaluate(() => window.esb.outreachStatus())
  console.log(st0 && st0.configured === false && st0.sent24h === 0 ? 'PASS' : 'FAIL', 'outreach status answers from the main process', JSON.stringify(st0))
  const pathAtt = await page.evaluate(() => window.esb.outreachSend({ to: 'a@example.com', subject: 's', text: 't', attachments: [{ name: 'hosts.pdf', path: 'C:\\Windows\\System32\\drivers\\etc\\hosts' }] }))
  const twoTo = await page.evaluate(() => window.esb.outreachSend({ to: 'a@example.com, b@example.com', subject: 's', text: 't' }))
  const noAcct = await page.evaluate(() => window.esb.outreachSend({ to: 'a@example.com', subject: 's', text: 't' }))
  console.log(!pathAtt.ok && /path/.test(pathAtt.error) && !twoTo.ok && !noAcct.ok && /Save the sender/.test(noAcct.error) ? 'PASS' : 'FAIL', 'outreach send refuses a disk path, two recipients, and anything before an account is saved', JSON.stringify([pathAtt, twoTo, noAcct]))
  const ver = await page.evaluate(() => window.esb.outreachVerify(true))
  console.log(ver && ver.ok === false && /sender|account|password/i.test(ver.error || '') ? 'PASS' : 'FAIL', 'mail-server check answers "no account" instead of pretending to be signed in', JSON.stringify(ver))
  const ib = await page.evaluate(() => window.esb.outreachInbox(true))
  console.log(ib && ib.ok === false && /sender account/i.test(ib.error || '') ? 'PASS' : 'FAIL', 'inbox check answers "no account" before one is saved, and reads nothing', JSON.stringify(ib))
  const badHost = await page.evaluate(() => window.esb.outreachSave({ host: 'localhost', port: 587, user: 'desk@example.com', name: 'x', dailyLimit: 50, minDelaySec: 60, maxDelaySec: 120 }))
  const saveOk = await page.evaluate(() => window.esb.outreachSave({ host: 'smtp.gmail.com', port: 587, user: 'desk@example.com', name: 'ESB PowerLine', dailyLimit: 50, minDelaySec: 60, maxDelaySec: 120 }, 'abcd efgh ijkl mnop'))
  const stored = fs.existsSync(path.join(profile, 'outreach-smtp.json')) ? fs.readFileSync(path.join(profile, 'outreach-smtp.json'), 'utf8') : ''
  // where the OS keychain is available the password is stored encrypted; where it is not, it is refused, never stored plain
  const pwOk = saveOk.ok ? saveOk.status.hasPassword === saveOk.status.encryption && !stored.includes('abcdefgh') && !JSON.stringify(saveOk).includes('abcd') : /encrypt/.test(saveOk.error)
  console.log(!badHost.ok && pwOk ? 'PASS' : 'FAIL', 'sender settings validated in main; the app password is encrypted or refused, never stored or returned in clear', JSON.stringify({ badHost: badHost.error, saved: saveOk.ok ? saveOk.status.hasPassword : saveOk.error }))

  await page.evaluate(() => window.esb.siteSignOut())
  const afterOut = await app.evaluate(async ({ session }) => (await session.fromPartition('persist:esb-site').cookies.get({ url: 'https://esbpowerline.com' })).length)
  console.log(afterOut === 0 ? 'PASS' : 'FAIL', 'signing out clears the site session')

  const menuGone = await app.evaluate(({ Menu }) => Menu.getApplicationMenu() === null)
  console.log(menuGone ? 'PASS' : 'FAIL', 'native menu removed (Alt cannot pop it up)')
  const title = await page.title()
  console.log(title.includes('ESB AI Studio') ? 'PASS' : 'FAIL', 'window title is ESB AI Studio:', title)
  // the app opens on Home; the Graphics tile opens the banner editor
  await page.click('.launch-tile:has-text("Graphics")')
  await page.waitForSelector('.stage-canvas', { timeout: 20000 }).catch(() => {})
  const canvasOk = await page.evaluate(() => { const c = document.querySelector('.stage-canvas'); return !!c && c.width > 300 })
  console.log(canvasOk ? 'PASS' : 'FAIL', 'stage canvas rendered')

  // Workspace switcher navigation
  await page.click('[data-ws="home"]')
  await page.waitForSelector('.home-workspace')
  const homeOk = await page.evaluate(() => !!document.querySelector('.home-workspace h1')?.textContent.includes('Ai Studio'))
  console.log(homeOk ? 'PASS' : 'FAIL', 'switched to Home workspace')

  // The Home picture drifts slowly; an offset saved from "Move background" at the old limit left a strip of the page showing along the screen edge
  // at the extremes of the drift. The offset is now limited to what the drift leaves, so the picture covers the screen at every phase.
  await page.evaluate(() => localStorage.setItem('esb-banner-studio/home-bg-pos', JSON.stringify({ light: { x: 6, y: -6, s: 1 }, dark: { x: 6, y: -6, s: 1 } })))
  await page.reload()
  await page.waitForSelector('.topbar, .home-shell')
  await page.evaluate(() => document.querySelector('[data-ws="home"]')?.click())
  await page.waitForSelector('.home-bg-img')
  const gap = await page.evaluate(async () => {
    const img = document.querySelector('.home-bg-img'); img.style.animationPlayState = 'paused'
    let worst = 0
    for (let t = 0; t <= 40; t += 2) {
      img.style.animationDelay = '-' + t + 's'; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const b = img.getBoundingClientRect()
      worst = Math.max(worst, b.left, b.top, innerWidth - b.right, innerHeight - b.bottom)
    }
    return worst
  })
  console.log(gap <= 0 ? 'PASS' : 'FAIL', 'Home picture covers the screen at every phase of its drift, even with a saved offset', gap.toFixed(1) + ' px')

  await page.click('.launch-tile:has-text("Editorial")') // Home has no switcher; desks open from their tiles
  await page.waitForSelector('.editorial-workspace')
  const editorialOk = await page.waitForSelector('.editorial-workspace .ws-btn.on[data-ws="editorial"]', { timeout: 8000 }).then(() => true, () => false)
  console.log(editorialOk ? 'PASS' : 'FAIL', 'switched to Editorial workspace')

  await page.click('.ws-btn[data-ws="video"]')
  await page.waitForSelector('.video-workspace')
  const videoOk = await page.evaluate(() => !!document.querySelector('.video-workspace canvas'))
  console.log(videoOk ? 'PASS' : 'FAIL', 'switched to Video workspace')

  await page.click('.ws-btn[data-ws="outreach"]')
  await page.waitForSelector('.outreach-workspace')
  const outreachOk = await page.evaluate(() => !!document.querySelector('.or-left') && !!document.querySelector('.or-center') && !!document.querySelector('.or-right'))
  console.log(outreachOk ? 'PASS' : 'FAIL', 'switched to Outreach workspace')

  await page.click('.ws-btn[data-ws="graphics"]')
  await page.waitForSelector('.stage-canvas')
  const graphicsOk = await page.evaluate(() => !!document.querySelector('.stage-canvas'))
  console.log(graphicsOk ? 'PASS' : 'FAIL', 'switched back to Graphics workspace')
  await page.screenshot({ path: path.join(root, 'tools', 'out', 'electron.png') })
  console.log(errors.length ? 'FAIL' : 'PASS', 'no console errors', errors.slice(0, 3).join(' | '))

  // Home → Quit ends the app (last: nothing runs after it)
  await page.click('[data-ws="home"]')
  await page.waitForSelector('.home-head-btn.quit')
  await page.screenshot({ path: path.join(root, 'tools', 'out', 'electron-home.png') })
  const closed = new Promise((r) => app.process().once('exit', () => r(true)))
  // the corner controls are folded into one handle that opens on hover
  await page.hover('.home-head-actions').catch(() => {})
  await page.waitForTimeout(400)
  await page.click('.home-head-btn.quit').catch(() => {})
  const quitOk = await Promise.race([closed, new Promise((r) => setTimeout(() => r(false), 8000))])
  console.log(quitOk ? 'PASS' : 'FAIL', 'Home → Quit closes the app')
} finally {
  await app.close().catch(() => {})
}
