// The Video desk in the desktop app (dist/ + Electron): files by path, the esb-media:// protocol, the streamed export,
// save → quit → relaunch → open, a renderer crash → the restore card, relinking a moved file, and the main process
// refusing hostile calls. Phase 1: Save makes a .esbvideo project FOLDER (project.json + media/proxies/cache/autosave/
// renders), a moved file is found again by hash (Relink all), and a 4K import (copied into the project) gets a 540p
// proxy in the background that the preview uses while the export still reads the original. VIDEO_LONG=1 adds the 10-minute 1080p export with its memory measured (fixture made by
// `node tools/fixtures/video/make-fixtures.mjs --long`). Needs a fresh `npm run build`. Linux: run under xvfb-run -a.
import { _electron as electron } from 'playwright-core'
import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { createRequire } from 'node:module'

const root = path.resolve(import.meta.dirname, '../..')
const win = process.platform === 'win32'
const exe = path.join(root, 'node_modules', 'electron', 'dist', win ? 'electron.exe' : 'electron')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-vprofile-'))
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-vwork-'))
const LONG = process.env.VIDEO_LONG === '1'
let failed = 0
const results = {}
const videoMedia = createRequire(import.meta.url)('../../electron/video-media.cjs')
function check(label, ok, info = '') { console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${info}`); if (!ok) failed++ }

const probe = (f) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', f]).toString())
const level = (file, ss, t) => { const r = spawnSync('ffmpeg', ['-v', 'info', '-ss', String(ss), '-t', String(t), '-i', file, '-af', 'volumedetect', '-f', 'null', '-']); return Number(/mean_volume: (-?[\d.]+)/.exec(String(r.stderr))?.[1] ?? -999) }

// the media sits in its own folder, as an editor's footage would
const footage = path.join(work, 'footage')
fs.mkdirSync(footage)
const speech = path.join(footage, 'speech-6s.mp4')
fs.copyFileSync(path.join(root, 'tools/fixtures/video/speech-6s.mp4'), speech)
const projectFile = path.join(work, 'phase0.esbvideo') // a project folder since Phase 1
const projectJson = path.join(projectFile, 'project.json')

async function launch() {
  const app = await electron.launch({ executablePath: exe, args: [...(win ? [] : ['--no-sandbox']), root, '--user-data-dir=' + profile], env: { ...process.env, ESB_NO_SYNC: '1' } })
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.setDefaultTimeout(30000)
  // the OS dialogs answer from a queue, as an editor picking files would
  await app.evaluate(({ dialog }) => {
    globalThis.__open = []; globalThis.__save = []
    dialog.showOpenDialog = async () => { const p = globalThis.__open.shift(); return p ? { canceled: false, filePaths: [].concat(p) } : { canceled: true, filePaths: [] } }
    dialog.showSaveDialog = async () => { const p = globalThis.__save.shift(); return p ? { canceled: false, filePath: p } : { canceled: true } }
  })
  await page.waitForSelector('.home-shell, .topbar', { timeout: 20000 })
  return { app, page, errors }
}
const queue = (app, kind, p) => app.evaluate((_e, [k, v]) => { globalThis[k].push(v) }, [kind === 'open' ? '__open' : '__save', p])
const openVideo = async (page) => { await page.click('.launch-tile:has-text("Video")'); await page.waitForSelector('.video-workspace') }

/** The monitor shows moving footage: its pixels vary, and change after a second of playback. Reading the canvas also
 * proves the media protocol's CORS keeps it untainted (the export reads it back). */
async function footagePlays(page) {
  const sample = () => page.evaluate(() => {
    // the monitor is a WebGL2 canvas (Phase 1): copy it into a 2D one to read it (it would throw if tainted)
    const g = document.querySelector('.vw-canvas')
    const c = document.createElement('canvas')
    c.width = g.width
    c.height = g.height
    c.getContext('2d').drawImage(g, 0, 0)
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let sum = 0, sq = 0, n = 0
    const vals = []
    for (let i = 0; i < d.length; i += 4 * 97) { const v = d[i] + d[i + 1] + d[i + 2]; sum += v; sq += v * v; n++; vals.push(v) }
    const mean = sum / n
    return { sd: Math.sqrt(sq / n - mean * mean), vals }
  })
  await page.waitForTimeout(800)
  const a = await sample()
  await page.click('.play-btn')
  await page.waitForTimeout(1200)
  await page.click('.play-btn')
  await page.waitForTimeout(400)
  const b = await sample()
  const diff = a.vals.reduce((n, v, i) => n + (Math.abs(v - b.vals[i]) > 30 ? 1 : 0), 0) / a.vals.length
  const time = await page.textContent('.vw-current-time')
  return { ok: a.sd > 40 && diff > 0.02, sd: Math.round(a.sd), changed: Math.round(diff * 100) + '%', time }
}

let run = await launch()
try {
  let { app, page } = run
  await openVideo(page)
  check('Video desk opens empty with a start screen', (await page.locator('.vw-start-import').count()) === 1)

  // 1. Import through main's own dialog: the renderer gets an esb-media:// URL, never reads the path itself
  await queue(app, 'open', [speech])
  await page.click('.vw-start-import')
  await page.waitForSelector('.vw-media-card:has-text("speech-6s.mp4")')
  const card = await page.locator('.vw-media-card').first().innerText()
  check('Import by path: the bin shows length and "sound"', /0:06/.test(card) && /sound/.test(card), card.replace(/\s+/g, ' '))
  await page.click('.vw-media-card .vw-add')
  await page.waitForFunction(() => document.querySelectorAll('.vw-clip-block').length === 2)
  const plays1 = await footagePlays(page)
  check('Footage plays on the monitor from the media protocol (canvas readable)', plays1.ok, JSON.stringify(plays1))

  // 2. Export streams to the chosen file through main; nothing left half-written
  const out = path.join(work, 'speech-export.mp4')
  await queue(app, 'save', out)
  await page.click('.vw-header-actions button:has-text("Export")')
  await page.waitForSelector('.vx-go:not([disabled])')
  await page.click('.vx-go')
  await page.waitForSelector('.vw-export-success', { timeout: 120000 })
  const shown = await page.locator('.vx-file').innerText()
  await page.click('.vw-export-modal button:has-text("Done")')
  const p = probe(out)
  const a = p.streams.find((s) => s.codec_type === 'audio')
  const quiet = level(out, 0.1, 0.7), voice = level(out, 1.2, 3)
  check('ACCEPT streamed export: MP4 on disk with the footage’s speech (RMS above the floor where it is)', fs.existsSync(out) && !fs.existsSync(out + '.partial') && !!a && Math.abs(Number(p.format.duration) - 6) < 0.1 && voice > -40 && (quiet === -999 || quiet < -60), `${shown} · ${a?.codec_name} · ${p.format.duration}s · before ${quiet} dB, speech ${voice} dB`)
  results.speechExport = { duration: Number(p.format.duration), audio: a?.codec_name, speechDb: voice, beforeDb: quiet }

  // 3. Save the project; then an edit, autosaved
  await queue(app, 'save', projectFile)
  await page.click('.vw-save')
  await page.waitForFunction((f) => document.querySelector('.vw-sb-save')?.textContent === 'Saved', projectFile)
  const saved = JSON.parse(fs.readFileSync(projectJson, 'utf8'))
  const layout = ['media', 'proxies', 'cache', 'autosave', 'renders'].every((d) => fs.statSync(path.join(projectFile, d)).isDirectory())
  check('Save makes a project folder: project.json (schema v2) + media/proxies/cache/autosave/renders', layout && saved.format === 'esb-video-project' && saved.version === 2 && Array.isArray(saved.timeline?.clips), JSON.stringify({ layout, format: saved.format, version: saved.version }))
  check('Project saved with the footage’s real path, size and quick hash (no runtime URLs)', saved.media[0].path === speech && saved.media[0].storage === 'reference' && /^[0-9a-f]{32}$/.test(saved.media[0].hash || '') && !JSON.stringify(saved).includes('esb-media:'), saved.media[0].path + ' ' + saved.media[0].hash)
  await page.fill('.vw-title-input', 'Edited after save')
  await page.waitForFunction(() => /autosaved/.test(document.querySelector('.vw-sb-save')?.textContent || ''), null, { timeout: 15000 })
  const snaps = fs.readdirSync(path.join(projectFile, 'autosave'))
  check('Autosave wrote a snapshot into the project folder’s autosave/ within 10 s (temp + rename, no .tmp left)', snaps.some((f) => /^snap-\d+-[0-9a-f]{12}\.json$/.test(f)) && !snaps.some((f) => f.endsWith('.tmp')), snaps.join(','))

  // 4. ACCEPT: kill the renderer mid-edit → the restore card, with the last state
  // Playwright gives up on a crashed page, so the reloaded window is driven through main (executeJavaScript)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer())
  await new Promise((r) => setTimeout(r, 1000))
  const inWin = (js) => app.evaluate(({ BrowserWindow }, code) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(code), js)
  const waitIn = async (js, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await inWin(js).catch(() => false)) return true; await new Promise((r) => setTimeout(r, 250)) } return false }
  check('The crashed renderer is gone', await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.isCrashed()))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.reload())
  await waitIn(`!!document.querySelector('.launch-tile')`)
  await inWin(`[...document.querySelectorAll('.launch-tile')].find((t) => /Video/.test(t.textContent)).click()`)
  await waitIn(`!!document.querySelector('.vw-restore-card')`, 10000)
  const restoreText = String(await inWin(`document.querySelector('.vw-restore-card')?.innerText || ''`)).replace(/\s+/g, ' ')
  check('ACCEPT renderer killed mid-edit: the restore card appears with the last state', /Edited after save/.test(restoreText) && /2 clips/.test(restoreText), restoreText)
  await inWin(`document.querySelector('.vw-restore-go').click()`)
  const back = await waitIn(`document.querySelectorAll('.vw-clip-block').length === 2 && document.querySelector('.vw-title-input').value === 'Edited after save'`)
  check('Restore puts the edit back', back)

  // 5. ACCEPT: save, quit, relaunch, open → the footage plays (the restored snapshot knew its folder: no dialog)
  await inWin(`document.querySelector('.vw-save').click()`)
  await waitIn(`document.querySelector('.vw-sb-save')?.textContent === 'Saved'`)
  await app.close()
  run = await launch()
  ;({ app, page } = run)
  await openVideo(page)
  check('After a clean save and quit, no restore card is offered', (await page.locator('.vw-restore-card').count()) === 0)
  await queue(app, 'open', projectJson)
  await page.click('.vw-open')
  await page.waitForFunction(() => document.querySelectorAll('.vw-clip-block').length === 2)
  const plays2 = await footagePlays(page)
  check('ACCEPT save → quit → relaunch → open: the footage plays', plays2.ok && (await page.locator('.vw-missing').count()) === 0, JSON.stringify(plays2))

  // 6. A moved file is reported missing and can be relinked
  await app.close()
  const moved = path.join(footage, 'moved-speech.mp4')
  fs.renameSync(speech, moved)
  run = await launch()
  ;({ app, page } = run)
  await openVideo(page)
  if (await page.locator('.vw-restore-discard').count()) await page.click('.vw-restore-discard')
  await queue(app, 'open', projectJson)
  await page.click('.vw-open')
  await page.waitForSelector('.vw-missing')
  await page.click('.vw-header-actions button:has-text("Export")')
  check('A missing file is flagged, and Export refuses until it is relinked', (await page.locator('.vx-blocked').count()) === 1)
  await page.click('.vx-actions button:has-text("Cancel")')
  // the moved (renamed) file sits in the same folder: found again by size + quick hash, offered as one click
  await page.waitForSelector('.vw-bin-relink-all', { timeout: 15000 })
  const foundText = (await page.locator('.vw-missing').innerText()).replace(/\s+/g, ' ')
  await page.click('.vw-bin-relink-all')
  await page.waitForFunction(() => !document.querySelector('.vw-missing'))
  const relinkedPath = await page.evaluate(() => window.__videoStore ? null : document.querySelector('.vw-media-card .vw-media-title')?.getAttribute('data-tip'))
  check('Relink by hash: the renamed file is found again and Relink all brings the footage back', (await footagePlays(page)).ok && /found again/.test(foundText) && /moved-speech\.mp4/.test(relinkedPath || ''), foundText + ' → ' + relinkedPath)

  // 7. The main process refuses hostile calls
  const hostile = await page.evaluate(async () => {
    const r = {}
    r.write = await window.esb.videoExportWrite('bogus', 0, new Uint8Array(4)).then(() => 'accepted', () => 'refused')
    r.resolve = (await window.esb.videoResolve(['C:\\Windows\\win.ini', 'C:\\Windows\\Media\\tada.wav']))?.every((x) => x.missing)
    r.saveOutside = await window.esb.videoSaveProject('x', '{}', 'C:\\Windows\\evil.esbvideo').then(() => 'accepted', () => 'refused')
    r.saveNotProject = await window.esb.videoSaveProject('x', '{}', 'C:\\Users\\evil.esb').then(() => 'accepted', () => 'refused')
    r.dropString = (await window.esb.videoImportDropped(['C:\\Windows\\Media\\tada.wav'])).length
    r.unknownId = await fetch('esb-media://m/' + 'a'.repeat(32)).then((x) => x.status, () => 'error')
    r.badSnapshot = await window.esb.videoAutosave('not json').then(() => 'accepted', () => 'refused')
    return r
  })
  check('Main refuses hostile Video calls (bogus export id, unapproved paths, project outside scope, path strings as drops, unknown media id, non-JSON snapshot)', hostile.write === 'refused' && hostile.resolve === true && hostile.saveOutside === 'refused' && hostile.saveNotProject === 'refused' && hostile.dropString === 0 && hostile.unknownId === 404 && hostile.badSnapshot === 'refused', JSON.stringify(hostile))
  const cmsCanRead = await app.evaluate(async ({ session }) => {
    try { const r = await session.fromPartition('persist:esb-site').fetch('esb-media://m/' + 'a'.repeat(32)); return r.status } catch { return 'refused' }
  })
  check('The CMS window’s session cannot use the media protocol', cmsCanRead !== 200 && cmsCanRead !== 404, String(cmsCanRead))

  // S1: a crafted project approves nothing. It names a real media file this app never imported and a network share;
  // both come back missing (Relink), the file's would-be id is not served, and the registry does not grow.
  {
    const secret = path.join(work, 'private', 'secret.mp4')
    fs.mkdirSync(path.dirname(secret))
    fs.copyFileSync(path.join(root, 'tools/fixtures/video/speech-6s.mp4'), secret)
    const crafted = path.join(work, 'crafted.esbvideo')
    fs.writeFileSync(crafted, JSON.stringify({ id: 'crafted', name: 'Crafted', aspect: '16:9', width: 1920, height: 1080, fps: 30, duration: 10, tracks: [['v2', 'overlay'], ['v1', 'video'], ['c1', 'caption'], ['a1', 'audio']].map(([id, kind]) => ({ id, name: id, kind, muted: false, locked: false })), clips: [], mediaAssets: [{ id: 'x1', name: 'secret.mp4', type: 'video', path: secret, size: 1, duration: 6 }, { id: 'x2', name: 'clip.mp4', type: 'video', path: '\\\\192.0.2.1\\share\\clip.mp4', size: 1, duration: 6 }] }))
    const regBefore = fs.readFileSync(path.join(profile, 'video-media.json'), 'utf8')
    await queue(app, 'open', crafted)
    await page.click('.vw-open')
    if (await page.locator('.vw-confirm-open').count()) await page.click('.vw-confirm-open')
    await page.waitForFunction(() => document.querySelectorAll('.vw-media-card.missing').length === 2, null, { timeout: 15000 })
    const status = await page.evaluate((id) => fetch('esb-media://m/' + id).then((r) => r.status, () => 'error'), videoMedia.mediaId(secret))
    await new Promise((r) => setTimeout(r, 800)) // past the registry's write debounce
    const regAfter = fs.readFileSync(path.join(profile, 'video-media.json'), 'utf8')
    check('S1: opening a crafted project approves none of its media (both missing, not served, registry unchanged)', status === 404 && regAfter === regBefore && !regAfter.includes('secret.mp4') && !regAfter.includes('192.0.2.1'), JSON.stringify({ status, grew: regAfter !== regBefore }))
  }

  // P8: the window reloads mid-export → main closes the writer and removes the half file
  {
    await queue(app, 'open', [moved])
    await page.click('.vw-start-import')
    await page.click('.vw-media-card:has-text("moved-speech.mp4") .vw-add')
    await page.waitForFunction(() => document.querySelectorAll('.vw-clip-block').length === 2)
    const out = path.join(work, 'reloaded-mid-export.mp4')
    await queue(app, 'save', out)
    await page.click('.vw-header-actions button:has-text("Export")')
    await page.waitForSelector('.vx-go:not([disabled])')
    await page.click('.vx-go')
    const started = await (async () => { for (let i = 0; i < 100; i++) { if (fs.existsSync(out + '.partial')) return true; await new Promise((r) => setTimeout(r, 50)) } return false })()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.reload())
    await page.waitForSelector('.launch-tile', { timeout: 20000 })
    await new Promise((r) => setTimeout(r, 500))
    check('P8: a reload mid-export removes the half-written file (no .partial, no target)', started && !fs.existsSync(out + '.partial') && !fs.existsSync(out), JSON.stringify({ started, partial: fs.existsSync(out + '.partial'), target: fs.existsSync(out) }))
    await openVideo(page)
    if (await page.locator('.vw-restore-discard').count()) await page.click('.vw-restore-discard')
  }

  // 9. Phase 1 Part A: create a project folder → import a 4K file (copied into the project) → its proxy appears in
  // the background → the preview uses the proxy URL → the export reads the original (resolution and sharpness)
  {
    const uhd = path.join(root, 'tools/out/video-fixtures/uhd-4k.mp4')
    if (!fs.existsSync(uhd)) execFileSync(process.execPath, [path.join(root, 'tools/fixtures/video/make-fixtures.mjs'), '--4k'], { stdio: 'inherit' })
    const src4k = path.join(footage, 'uhd-4k.mp4')
    fs.copyFileSync(uhd, src4k)
    const vmedia = (fn) => page.evaluate(fn)
    const assetInfo = () => vmedia(() => {
      const vm = window.__videoMedia
      const a = vm.assets().find((x) => x.name === 'uhd-4k.mp4')
      return a ? { id: a.id, preview: vm.previewUrlFor(a.id), exp: vm.exportUrlFor(a.id), info: vm.mediaInfo(a.id), meta: vm.meta(a.id), folder: vm.folder() } : null
    })
    if (await page.locator('.vw-new').count()) { await page.click('.vw-new'); if (await page.locator('.vw-confirm-new').count()) await page.click('.vw-confirm-new') }
    await page.fill('.vw-title-input', 'Proxy test')
    const folder = path.join(work, 'Proxy test.esbvideo')
    await queue(app, 'save', folder)
    await page.click('.vw-save')
    await page.waitForFunction(() => document.querySelector('.vw-sb-save')?.textContent === 'Saved')
    check('Create project folder: Save makes <name>.esbvideo/ with project.json and its subfolders', fs.existsSync(path.join(folder, 'project.json')) && ['media', 'proxies', 'cache', 'autosave', 'renders'].every((d) => fs.existsSync(path.join(folder, d))))

    await page.click('.vw-bin-import-mode button:has-text("Copy")')
    await queue(app, 'open', [src4k])
    const t0 = Date.now()
    await page.click('.vw-dropzone')
    await page.waitForSelector('.vw-media-card:has-text("uhd-4k.mp4")', { timeout: 60000 })
    const copied = path.join(folder, 'media', 'uhd-4k.mp4')
    check('Import with Copy: the 4K file is copied into the project’s media/', fs.existsSync(copied) && fs.statSync(copied).size === fs.statSync(src4k).size)
    const sawPending = await page.waitForSelector('.vw-bin-card[data-proxy="pending"]', { timeout: 30000 }).then(() => true, () => false)
    const pendingText = sawPending ? await page.locator('.vw-bin-card[data-proxy="pending"] .vw-bin-proxy').innerText().catch(() => '') : ''
    await page.waitForSelector('.vw-bin-card[data-proxy="ready"]', { timeout: 300000 })
    const importToReady = Date.now() - t0
    const r = await assetInfo()
    const proxyFile = path.join(folder, 'proxies', `${r.meta.hash}.mp4`)
    const pp = probe(proxyFile)
    const pv = pp.streams.find((s) => s.codec_type === 'video')
    const keys = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-skip_frame', 'nokey', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', proxyFile]).toString().trim().split(/\s+/).map(Number).filter(Number.isFinite)
    const maxGap = keys.slice(1).reduce((m, t, i) => Math.max(m, t - keys[i]), 0)
    results.proxy = { fixture: '3840x2160 30 fps 4 s, GOP 3 s', importToReadyMs: importToReady, workerMs: r.meta.proxyMs, proxy: `${pv?.width}x${pv?.height} ${pv?.codec_name}`, keyframes: keys.length, maxKeyGap: Math.round(maxGap * 1000) / 1000, sizeKB: Math.round(fs.statSync(proxyFile).size / 1024), sawPending, pendingText }
    check('ACCEPT a 4K source gets a proxy automatically in the background: 960×540 H.264, key frame every ≤ 0.5 s, in proxies/', sawPending && pv?.width === 960 && pv?.height === 540 && pv?.codec_name === 'h264' && keys.length >= 8 && maxGap <= 0.51, JSON.stringify(results.proxy))
    check('mediaInfo: H.264, 30 fps, 3840×2160, the long GOP measured from packets (≈ 3 s), proxy ready', /^avc/.test(r.info.codec || '') && Math.abs(r.info.fps - 30) < 0.5 && r.info.width === 3840 && r.info.height === 2160 && r.info.keyframeInterval > 2.5 && r.info.proxy === 'ready' && r.info.missing === false, JSON.stringify(r.info))
    check('Preview uses the proxy URL; export uses the original', r.preview.startsWith(`esb-media://p/${r.folder.id}/proxies/`) && /^esb-media:\/\/m\/[0-9a-f]{32}$/.test(r.exp), `${r.preview} | ${r.exp}`)
    const cardText = (await page.locator('.vw-media-card:has-text("uhd-4k.mp4")').innerText()).replace(/\s+/g, ' ')
    check('The bin card shows codec, fps, size, length and the proxy badge', /H\.264/.test(cardText) && /30 fps/.test(cardText) && /3840×2160/.test(cardText) && /0:04/.test(cardText) && /MB/.test(cardText) && /proxy/i.test(cardText), cardText)

    await page.click('.vw-media-card:has-text("uhd-4k.mp4") .vw-add')
    await page.waitForFunction(() => document.querySelectorAll('.vw-clip-block').length === 2)
    const out4k = path.join(work, 'uhd-export.mp4')
    await queue(app, 'save', out4k)
    await page.click('.vw-header-actions button:has-text("Export")')
    await page.waitForSelector('.vx-go:not([disabled])')
    await page.click('.vx-go')
    await page.waitForSelector('.vw-export-success', { timeout: 180000 })
    await page.click('.vw-export-modal button:has-text("Done")')
    const ev = probe(out4k).streams.find((s) => s.codec_type === 'video')
    // sharpness (colour-independent): mean |Laplacian| of the same centre crop (clear of the ESB bug) in the exported
    // frame, the 4K original scaled to 1080p and the 540p proxy scaled up to 1080p. An export from the proxy would be
    // as soft as the upscaled proxy; from the original it is as sharp as the downscaled original.
    const gray = (src, scale) => execFileSync('ffmpeg', ['-v', 'error', '-ss', '1.0', '-i', src, '-frames:v', '1', '-vf', `${scale ? 'scale=1920:1080:flags=bicubic,' : ''}crop=960:540:480:270,format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 })
    const sharp = (b) => { const w = 960; let t = 0, n = 0; for (let y = 1; y < 539; y++) for (let x = 1; x < 959; x++) { const i = y * w + x; t += Math.abs(4 * b[i] - b[i - 1] - b[i + 1] - b[i - w] - b[i + w]); n++ } return Math.round((t / n) * 100) / 100 }
    const sExport = sharp(gray(out4k, false)), sOrig = sharp(gray(src4k, true)), sProxy = sharp(gray(proxyFile, true))
    results.exportFromOriginal = { size: `${ev?.width}x${ev?.height}`, sharpExport: sExport, sharpOriginal1080: sOrig, sharpProxyUpscaled: sProxy }
    check('ACCEPT the export reads the original: 1920×1080, as sharp as the 4K original scaled down (not the soft 540p proxy)', ev?.width === 1920 && ev?.height === 1080 && sExport > sProxy * 1.3 && Math.abs(sExport - sOrig) < Math.abs(sExport - sProxy), JSON.stringify(results.exportFromOriginal))

    // the main process refuses hostile folder calls; the cache works inside the folder only
    const fid = r.folder.id
    const h = await page.evaluate(async (fid) => {
      const o = {}
      const ref = async (p) => p.then(() => 'accepted', () => 'refused')
      o.cacheWrite = await ref(window.esb.videoCacheWrite(fid, 'wave-test', new Uint8Array([1, 2, 3])))
      o.cacheRead = Array.from((await window.esb.videoCacheRead(fid, 'wave-test')) || [])
      o.cacheBadKey = await ref(window.esb.videoCacheWrite(fid, '../evil', new Uint8Array(1)))
      o.cacheBig = await ref(window.esb.videoCacheWrite(fid, 'big', new Uint8Array(33 * 1024 * 1024)))
      o.saveBogus = await ref(window.esb.videoFolderSave('f'.repeat(32), '{}'))
      o.saveLibrary = await ref(window.esb.videoFolderSave('u', '{}'))
      o.resolveTraversal = (await window.esb.videoFolderResolve(fid, ['media/../../secret.mp4', 'media/uhd-4k.mp4:x', 'proxies/x.mp4'])).every((x) => x.missing)
      o.cacheServed = await fetch(`esb-media://p/${fid}/cache/wave-test.bin`).then((x) => x.status, () => 'error')
      o.traversalServed = await fetch(`esb-media://p/${fid}/media/..%2Fproject.json`).then((x) => x.status, () => 'error')
      o.proxyBadHash = await ref(window.esb.videoProxyBegin(fid, '../x'))
      o.factsUnknown = (await window.esb.videoMediaFacts(['esb-media://m/' + 'a'.repeat(32), 'file:///C:/Windows/win.ini'])).every((x) => x.missing)
      o.relinkUnapproved = (await window.esb.videoRelinkSearch(null, [{ id: 'x', path: 'C:\\Windows\\Media\\tada.wav', size: 1, hash: 'a'.repeat(32) }])).length
      return o
    }, fid)
    const cacheOnDisk = fs.existsSync(path.join(folder, 'cache', 'wave-test.bin'))
    check('Folder IPC is hostile-safe (bad cache key / size, unknown folder, traversal, ADS, cache not served, bad proxy name) and the cache lands in cache/', cacheOnDisk && h.cacheWrite === 'accepted' && h.cacheRead.join() === '1,2,3' && h.cacheBadKey === 'refused' && h.cacheBig === 'refused' && h.saveBogus === 'refused' && h.saveLibrary === 'refused' && h.resolveTraversal && h.cacheServed === 404 && h.traversalServed === 404 && h.proxyBadHash === 'refused' && h.factsUnknown && h.relinkUnapproved === 0, JSON.stringify({ ...h, cacheOnDisk }))

    // survives a restart: the proxy file is removed while the app is closed → reopening redoes it (cancel works,
    // Make proxy queues it again); with the proxy on disk, a reopen finds it at once without making it again
    await page.click('.vw-save')
    await page.waitForFunction(() => document.querySelector('.vw-sb-save')?.textContent === 'Saved')
    await app.close()
    fs.rmSync(proxyFile)
    run = await launch()
    ;({ app, page } = run)
    await openVideo(page)
    if (await page.locator('.vw-restore-discard').count()) await page.click('.vw-restore-discard')
    await queue(app, 'open', path.join(folder, 'project.json'))
    await page.click('.vw-open')
    await page.waitForSelector('.vw-bin-card[data-proxy="pending"]', { timeout: 30000 })
    await page.click('.vw-bin-card[data-proxy="pending"] .vw-bin-proxy-x').catch(() => {})
    const afterCancel = await page.waitForSelector('.vw-bin-card[data-proxy="none"] .vw-bin-proxy.make, .vw-bin-card[data-proxy="ready"]', { timeout: 30000 }).then((e) => e.evaluate((n) => n.closest('.vw-bin-card').getAttribute('data-proxy')))
    const partials = fs.readdirSync(path.join(folder, 'proxies')).filter((f) => f.endsWith('.partial'))
    check('Cancel stops the proxy and leaves no half file; Make proxy is offered', afterCancel === 'none' && partials.length === 0, JSON.stringify({ afterCancel, partials }))
    if (afterCancel === 'none') await page.click('.vw-bin-proxy.make')
    await page.waitForSelector('.vw-bin-card[data-proxy="ready"]', { timeout: 300000 })
    check('Restart with the proxy gone: it is made again', fs.existsSync(proxyFile))
    await app.close()
    run = await launch()
    ;({ app, page } = run)
    await openVideo(page)
    if (await page.locator('.vw-restore-discard').count()) await page.click('.vw-restore-discard')
    await queue(app, 'open', path.join(folder, 'project.json'))
    const t1 = Date.now()
    await page.click('.vw-open')
    await page.waitForSelector('.vw-bin-card[data-proxy="ready"]', { timeout: 20000 })
    const again = await assetInfo()
    check('Restart with the proxy on disk: it is found again at once (not remade) and the copy plays from media/', !again.meta.proxyMs && Date.now() - t1 < 20000 && again.preview.includes('/proxies/') && (await page.locator('.vw-missing').count()) === 0, `${Date.now() - t1} ms`)
  }

  // 8. VIDEO_LONG: a 10-minute 1080p export, memory sampled every 500 ms across every Electron process
  if (LONG) {
    const long = path.join(root, 'tools/out/video-fixtures/long-1080p.mp4')
    if (!fs.existsSync(long)) throw new Error('Run node tools/fixtures/video/make-fixtures.mjs --long first')
    await page.click('.vw-new')
    if (await page.locator('.vw-confirm-new').count()) await page.click('.vw-confirm-new')
    await queue(app, 'open', [long])
    await page.click('.vw-start-import')
    await page.waitForSelector('.vw-media-card:has-text("long-1080p.mp4")')
    await page.click('.vw-media-card:has-text("long-1080p.mp4") .vw-add')
    const longOut = path.join(work, 'long-export.mp4')
    await queue(app, 'save', longOut)
    await page.click('.vw-header-actions button:has-text("Export")')
    await page.waitForSelector('.vx-go:not([disabled])')
    const sampleMem = () => app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => ({ type: m.type, ws: m.memory.workingSetSize, priv: m.memory.privateBytes ?? 0 })))
    let peakTotal = 0, peakRenderer = 0, peakGpu = 0, samples = 0
    const idle = (await sampleMem()).reduce((n, x) => n + x.ws, 0)
    const t0 = Date.now()
    await page.click('.vx-go')
    let done = false
    const watcher = page.waitForSelector('.vw-export-success, .signin-error', { timeout: 60 * 60 * 1000 }).then(() => { done = true })
    while (!done) {
      const m = await sampleMem()
      const total = m.reduce((n, x) => n + x.ws, 0)
      peakTotal = Math.max(peakTotal, total)
      peakRenderer = Math.max(peakRenderer, ...m.filter((x) => x.type === 'Tab').map((x) => x.ws))
      peakGpu = Math.max(peakGpu, ...m.filter((x) => x.type === 'GPU').map((x) => x.ws))
      samples++
      await new Promise((r) => setTimeout(r, 500))
    }
    await watcher
    const secs = (Date.now() - t0) / 1000
    const lp = probe(longOut)
    const la = lp.streams.find((s) => s.codec_type === 'audio')
    const mbOf = (kb) => Math.round(kb / 1024)
    results.long = { seconds: Math.round(secs), idleTotalMB: mbOf(idle), duration: Number(lp.format.duration), sizeMB: Math.round(fs.statSync(longOut).size / 1048576), peakTotalMB: mbOf(peakTotal), peakRendererMB: mbOf(peakRenderer), peakGpuMB: mbOf(peakGpu), samples, audio: la?.codec_name }
    check('ACCEPT a 10-minute 1080p export holds RAM under 1.5 GB (all Electron processes, working set)', peakTotal < 1.5 * 1024 * 1024 && Math.abs(Number(lp.format.duration) - 600) < 0.2 && !!la, JSON.stringify(results.long))
    fs.rmSync(longOut, { force: true })
  }

  check('No page errors', run.errors.length === 0, run.errors.slice(0, 3).join(' | '))
} catch (err) {
  console.error('FAIL video electron test error:', err)
  failed++
} finally {
  await run.app.close().catch(() => {})
  if (process.env.JSON) fs.writeFileSync(process.env.JSON, JSON.stringify(results, null, 2))
  fs.rmSync(work, { recursive: true, force: true })
  process.exit(failed ? 1 : 0)
}
