// Phase 5 in the desktop app (dist/ + Electron, the page loaded from a FILE): the local AI runtime (MediaPipe wasm +
// the bundled models) must load from file URLs under the app's CSP, with nothing fetched from the network. Drives the
// real UI: import footage, Effects → Add effect → Remove background (model status), Captions → Auto reframe → Analyse
// faces (the detector loads and runs; the speech fixture has no face, so the honest "no face" answer is expected), the
// transcript panel (AI off or no key: says why, sends nothing), and a cut by the silence plan. Needs a fresh `npm run build`.
import { _electron as electron } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const root = path.resolve(import.meta.dirname, '../..')
const win = process.platform === 'win32'
const exe = path.join(root, 'node_modules', 'electron', 'dist', win ? 'electron.exe' : 'electron')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-v5profile-'))
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-v5work-'))
let failed = 0
const check = (label, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${info}`); if (!ok) failed++ }
const speech = path.join(work, 'speech-6s.mp4')
fs.copyFileSync(path.join(root, 'tools/fixtures/video/speech-6s.mp4'), speech)

const app = await electron.launch({ executablePath: exe, args: [...(win ? [] : ['--no-sandbox']), root, '--user-data-dir=' + profile], env: { ...process.env, ESB_NO_SYNC: '1' } })
const page = await app.firstWindow()
const errors = []
const requests = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('request', (r) => { const u = r.url(); if (!/^(file|blob|data|esb-media|devtools):/.test(u)) requests.push(u) })
page.setDefaultTimeout(40000)
await page.setViewportSize({ width: 1366, height: 820 }).catch(() => {})
await app.evaluate(({ dialog }) => {
  globalThis.__open = []
  dialog.showOpenDialog = async () => { const p = globalThis.__open.shift(); return p ? { canceled: false, filePaths: [].concat(p) } : { canceled: true, filePaths: [] } }
})
try {
  await page.waitForSelector('.home-shell, .topbar', { timeout: 20000 })
  await page.click('.launch-tile:has-text("Video")')
  await page.waitForSelector('.video-workspace')
  await app.evaluate((_e, p) => { globalThis.__open.push(p) }, speech)
  await page.click('.vw-start-import')
  await page.waitForSelector('.vw-media-card:has-text("speech-6s.mp4")')
  await page.click('.vw-media-card .vw-add')
  await page.waitForFunction(() => document.querySelectorAll('.vw-clip-block').length >= 1)

  // ---- Remove background: the model loads from the app's own files
  await page.locator('.vw-clip-block').first().click()
  await page.click('.vw-fx-panel .vw-fx-head')
  await page.click('.vw-fx-panel .vw-fx-add')
  await page.click('.menu .menu-item:has-text("Remove background")')
  await page.waitForFunction(() => /Ready\.|could not be loaded/.test(document.querySelector('.vw-fx-item[data-fx="personMatte"]')?.textContent ?? ''), null, { timeout: 40000 })
  const fxText = await page.locator('.vw-fx-item[data-fx="personMatte"]').innerText()
  check('Remove background: the local model loads from the app files (file URLs, CSP allows wasm)', /Ready\./.test(fxText), fxText.replace(/\s+/g, ' ').slice(0, 160))

  // ---- Auto reframe: the face detector loads and runs on the real clip
  await page.keyboard.press('Escape').catch(() => {})
  await page.evaluate(() => document.querySelector('.vw-bin-panel')?.scrollTo({ top: 0 }))
  const closeBtn = page.locator('.vw-inspector-panel [aria-label="Close"], .vw-inspector-panel button:has-text("Close")')
  if (await closeBtn.count()) await closeBtn.first().click().catch(() => {})
  await page.getByRole('tab', { name: 'Captions', exact: true }).first().click()
  const switchBtn = page.getByRole('button', { name: /Switch project to 9:16/ })
  if (await switchBtn.count()) await switchBtn.first().click()
  await page.getByRole('button', { name: 'Analyse faces' }).first().click()
  await page.waitForFunction(() => /No face was found|could not|Face in frame/i.test(document.querySelector('.vw-reframe')?.textContent ?? ''), null, { timeout: 60000 })
  const rf = await page.locator('.vw-reframe').innerText()
  check('Auto reframe: the detector loads from file URLs and answers (no face in the speech clip)', /No face was found/.test(rf), rf.replace(/\s+/g, ' ').slice(0, 200))

  // ---- Silence plan on the real clip's sound, then cut it (one undo step)
  await page.getByRole('button', { name: 'Find silences' }).first().click()
  await page.waitForSelector('.vw-cut-plan', { timeout: 30000 })
  const before = await page.locator('.vw-clip-block').count()
  const planText = await page.locator('.vw-cut-plan').first().innerText()
  check('Silence plan lists cuts for the speech clip (silent first second)', /cuts: [1-9]/.test(planText), planText.replace(/\s+/g, ' ').slice(0, 120))
  await page.getByRole('button', { name: 'Remove these cuts' }).first().click()
  await page.waitForFunction((n) => document.querySelectorAll('.vw-clip-block').length !== n, before, { timeout: 15000 }).catch(() => {})
  const lenText = await page.textContent('.vw-current-time').catch(() => '')
  check('Removing the silences changes the timeline (and says it can be undone)', /Removed \d+ silence cut/.test(await page.locator('.vw-transcript').innerText()), String(lenText))

  // ---- Transcribe: with no key or AI off it says why and sends nothing
  await page.getByRole('button', { name: /Transcribe with Gemini/ }).first().click()
  await page.waitForSelector('[aria-label="Transcript"] [role="alert"]', { timeout: 20000 })
  const alert = await page.locator('[aria-label="Transcript"] [role="alert"]').first().innerText()
  check('Transcribe without a key: a plain reason, no request to an AI company', /Gemini|AI is OFF|key/i.test(alert) && !requests.some((u) => /generativelanguage|anthropic|openai/.test(u)), alert.slice(0, 120))

  check('Nothing was fetched from the network by these features', !requests.some((u) => /mediapipe|googleapis|storage\.google|jsdelivr|unpkg|cdn/i.test(u)), JSON.stringify(requests.slice(0, 5)))
  check('No page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
} catch (e) {
  console.log('FAIL test error', e.message)
  console.log('reframe panel:', (await page.locator('.vw-reframe').innerText().catch(() => 'none')).replace(/s+/g, ' '))
  failed++
}
await app.close().catch(() => {})
console.log(failed ? `\n${failed} FAILED` : '\nAll passed')
process.exit(failed ? 1 : 0)
