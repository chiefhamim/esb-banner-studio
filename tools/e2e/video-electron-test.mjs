// The Video desk in the desktop app (dist/ + Electron): files by path, the esb-media:// protocol, the streamed export,
// save → quit → relaunch → open, a renderer crash → the restore card, relinking a moved file, and the main process
// refusing hostile calls. VIDEO_LONG=1 adds the 10-minute 1080p export with its memory measured (fixture made by
// `node tools/fixtures/video/make-fixtures.mjs --long`). Needs a fresh `npm run build`. Linux: run under xvfb-run -a.
import { _electron as electron } from 'playwright-core'
import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const root = path.resolve(import.meta.dirname, '../..')
const win = process.platform === 'win32'
const exe = path.join(root, 'node_modules', 'electron', 'dist', win ? 'electron.exe' : 'electron')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-vprofile-'))
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-vwork-'))
const LONG = process.env.VIDEO_LONG === '1'
let failed = 0
const results = {}
function check(label, ok, info = '') { console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${info}`); if (!ok) failed++ }

const probe = (f) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', f]).toString())
const level = (file, ss, t) => { const r = spawnSync('ffmpeg', ['-v', 'info', '-ss', String(ss), '-t', String(t), '-i', file, '-af', 'volumedetect', '-f', 'null', '-']); return Number(/mean_volume: (-?[\d.]+)/.exec(String(r.stderr))?.[1] ?? -999) }

// the media sits in its own folder, as an editor's footage would
const footage = path.join(work, 'footage')
fs.mkdirSync(footage)
const speech = path.join(footage, 'speech-6s.mp4')
fs.copyFileSync(path.join(root, 'tools/fixtures/video/speech-6s.mp4'), speech)
const projectFile = path.join(work, 'phase0.esbvideo')

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
    const c = document.querySelector('.vw-canvas')
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
  const saved = JSON.parse(fs.readFileSync(projectFile, 'utf8'))
  check('Project saved with the footage’s real path (no runtime URLs)', saved.mediaAssets[0].path === speech && !JSON.stringify(saved).includes('esb-media:'), saved.mediaAssets[0].path)
  await page.fill('.vw-title-input', 'Edited after save')
  await page.waitForFunction(() => /autosaved/.test(document.querySelector('.vw-sb-save')?.textContent || ''), null, { timeout: 15000 })
  const snaps = fs.readdirSync(path.join(profile, 'video-autosave'))
  check('Autosave wrote a snapshot to userData within 10 s (temp + rename, no .tmp left)', snaps.some((f) => /^snap-\d+\.json$/.test(f)) && !snaps.some((f) => f.endsWith('.tmp')), snaps.join(','))

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

  // 5. ACCEPT: save, quit, relaunch, open → the footage plays
  await queue(app, 'save', projectFile)
  await inWin(`document.querySelector('.vw-save').click()`)
  await waitIn(`document.querySelector('.vw-sb-save')?.textContent === 'Saved'`)
  await app.close()
  run = await launch()
  ;({ app, page } = run)
  await openVideo(page)
  check('After a clean save and quit, no restore card is offered', (await page.locator('.vw-restore-card').count()) === 0)
  await queue(app, 'open', projectFile)
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
  await queue(app, 'open', projectFile)
  await page.click('.vw-open')
  await page.waitForSelector('.vw-missing')
  await page.click('.vw-header-actions button:has-text("Export")')
  check('A missing file is flagged, and Export refuses until it is relinked', (await page.locator('.vx-blocked').count()) === 1)
  await page.click('.vx-actions button:has-text("Cancel")')
  await queue(app, 'open', moved)
  await page.click('.vw-relink')
  await page.waitForFunction(() => !document.querySelector('.vw-missing'))
  check('Relink finds the moved file and the footage plays again', (await footagePlays(page)).ok)

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
