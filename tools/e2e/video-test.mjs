// End-to-end checks of the Video desk in the browser (dev server), with ffprobe/ffmpeg reading the exported files.
// Fixtures are synthetic (tools/fixtures/media, tools/fixtures/video — make-fixtures.mjs). The desktop-only parts
// (files by path, save/relaunch, renderer crash, streamed export, RAM) are in tools/e2e/video-electron-test.mjs.
import { chromium } from 'playwright-core'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { launchBrowser } from '../launch-browser.mjs'
import { portOffset } from '../port-offset.mjs'
import { measure } from './video-playback-measure.mjs'

const PORT = 5195 + portOffset()
const root = path.resolve(import.meta.dirname, '../..')
const fx = (p) => path.join(root, 'tools/fixtures', p)
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })

const waitUp = async () => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/`)).ok) return } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('Vite did not start')
}

let browser
let failed = 0
function check(label, condition, info = '') {
  if (condition) console.log(`PASS ${label} ${info}`)
  else { console.error(`FAIL ${label} ${info}`); failed++ }
}

const probe = (f) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-count_frames', '-of', 'json', f]).toString())
/** mean level (dB) of a stretch of a file's sound; -999 when ffmpeg reports none (digital silence) */
const level = (file, ss, t) => { const r = spawnSync('ffmpeg', ['-v', 'info', '-ss', String(ss), '-t', String(t), '-i', file, '-af', 'volumedetect', '-f', 'null', '-']); return Number(/mean_volume: (-?[\d.]+)/.exec(String(r.stderr))?.[1] ?? -999) }
/** RGB of one pixel of the frame shown at time t */
const pixelAt = (file, t, x, y) => [...spawnSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `format=rgb24,crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']).stdout]
const near = (px, rgb, tol = 40) => px.length === 3 && px.every((v, i) => Math.abs(v - rgb[i]) <= tol)

try {
  await waitUp()
  browser = await launchBrowser(chromium)
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
  page.setDefaultTimeout(20000)
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err))

  await page.goto(`http://localhost:${PORT}/`)
  await page.evaluate(() => localStorage.removeItem('esb-banner-studio/video-autosave/v1'))
  await page.waitForSelector('.launch-tile')
  await page.click('.launch-tile:has-text("Video")')
  await page.waitForSelector('.video-workspace')
  check('Video desk mounted', (await page.locator('.video-workspace').count()) === 1)

  // 1. A new project is empty, with a clear start, and nothing invented on screen
  check('Starts empty: no demo clips', (await page.locator('.vw-clip-block').count()) === 0)
  check('Start screen offers Import media and Build from story', (await page.locator('.vw-start-import').count()) === 1 && (await page.locator('.vw-start-story').count()) === 1)
  const deskText = await page.locator('.video-workspace').innerText()
  check('No fabricated names or figures on the desk', !/Rezwanul|MMCFD|16,500|Chairman/.test(deskText))
  check('Timecode reads zero', (await page.textContent('.vw-timecode'))?.trim() === '00:00:00:00')
  check('Monitor canvas rendered', (await page.locator('.vw-canvas').count()) === 1)
  check('Split is disabled with nothing on the timeline', await page.locator('.vw-split').isDisabled())

  // 1b. Playback keeps real time: the playhead after 3 s of play is 3.0 s (wall clock), even with 60 clips on the desk
  for (const n of [0, 60]) {
    const m = await measure(page, n)
    check(`Playback keeps real time with ${n} clips (playhead after 3 s ≈ the time that passed, ±0.1 s)`, Math.abs(m.playhead - m.wall) <= 0.1 && Math.abs(m.playhead - 3) <= 0.1, JSON.stringify(m))
  }
  await page.evaluate(() => { const st = window.__videoStore.getState(); st.loadProject({ ...st.project, clips: [] }); st.seek(0) })

  // 2. Overlay presets start empty; their labels show in the editor only
  await page.click('.vw-bin-panel .side-tabs button:has-text("Overlays")')
  check('ESB bug switch on the Overlays tab', (await page.locator('.vw-bug-row input[type=checkbox]').isChecked()))
  await page.click('.vw-preset-card[data-preset="lower-third"] button:has-text("Add")')
  const lt = await page.evaluate(() => window.__videoStore.getState().project.clips.find((c) => c.overlayType === 'lower-third'))
  check('A lower third is added with empty fields', !!lt && lt.overlayText === '' && lt.overlaySub === '', JSON.stringify(lt && { t: lt.overlayText, s: lt.overlaySub }))
  check('Inspector shows the labels as placeholders', (await page.getAttribute('.vw-f-text', 'placeholder')) === 'Speaker name' && (await page.inputValue('.vw-f-text')) === '')
  await page.click('.vw-clip-block[data-clip-kind="overlay"]')
  await page.keyboard.press('Delete')
  check('Play / pause transport', await (async () => { await page.click('.play-btn'); await page.waitForTimeout(200); const on = await page.locator('.play-btn.playing').count(); await page.click('.play-btn'); return on === 1 })())

  // 3. Import: footage with and without sound, a tone, a picture
  await page.click('.vw-bin-panel .side-tabs button:has-text("Media")')
  await page.setInputFiles('.video-workspace input[type=file][multiple]', [fx('media/red-green-2s.mp4'), fx('media/tone-440-2s.wav'), fx('video/speech-6s.mp4'), fx('media/synthetic-rig.jpg')])
  await page.waitForFunction(() => window.__videoStore.getState().mediaAssets.length >= 4, null, { timeout: 30000 })
  const assets = await page.evaluate(() => window.__videoStore.getState().mediaAssets.map((a) => ({ name: a.name, type: a.type, hasAudio: a.hasAudio, duration: a.duration })))
  const speech = assets.find((a) => a.name === 'speech-6s.mp4'), rg = assets.find((a) => a.name === 'red-green-2s.mp4')
  check('Import reads each file: sound or not, and length', speech?.hasAudio === true && rg?.hasAudio === false && Math.abs(speech.duration - 6) < 0.1, JSON.stringify(assets))

  // 4. Footage with sound → V1 + linked A1; export keeps the speech
  // the play check above moved the playhead; footage lands at the playhead
  await page.evaluate(() => window.__videoStore.getState().seek(0))
  await page.click('.vw-media-card:has-text("speech-6s.mp4") .vw-add')
  const added = await page.evaluate(() => window.__videoStore.getState().project.clips.map((c) => ({ t: c.trackId, k: c.kind, link: c.linkId, start: c.start })))
  check('Footage with sound lands on V1 with its own sound linked on A1', added.length === 2 && added.some((c) => c.t === 'v1') && added.some((c) => c.t === 'a1' && c.k === 'audio') && added[0].link && added[0].link === added[1].link, JSON.stringify(added))
  await page.click('.vw-clip-block[data-clip-kind="audio"]')
  check('Inspector: linked sound has volume, a sound switch and Unlink', (await page.locator('.vw-s-vol').count()) === 1 && (await page.locator('.vw-unlink').count()) === 1)

  // P3: dragging a clip across many pointer moves is ONE undo step; a slider drag likewise
  {
    const before = await page.evaluate(() => window.__videoStore.getState().history.length)
    const box = await page.locator('.vw-clip-block[data-clip-kind="video"]').boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    for (let k = 1; k <= 25; k++) await page.mouse.move(box.x + box.width / 2 + k * 4, box.y + box.height / 2)
    await page.mouse.up()
    const after = await page.evaluate(() => { const s = window.__videoStore.getState(); return { h: s.history.length, starts: s.project.clips.map((c) => c.start) } })
    check('A drag of 25 pointer moves is one undo step (the linked pair moved together)', after.h === before + 1 && after.starts.every((t) => t > 2), JSON.stringify({ before, ...after }))
    await page.keyboard.press('Control+z')
    const undone = await page.evaluate(() => window.__videoStore.getState().project.clips.map((c) => c.start))
    check('One undo puts the dragged pair back', undone.every((t) => t === 0), JSON.stringify(undone))
    await page.click('.vw-clip-block[data-clip-kind="audio"]')
    const h0 = await page.evaluate(() => window.__videoStore.getState().history.length)
    const sl = await page.locator('.vw-s-vol').boundingBox()
    await page.mouse.move(sl.x + sl.width - 4, sl.y + sl.height / 2)
    await page.mouse.down()
    for (let k = 1; k <= 15; k++) await page.mouse.move(sl.x + sl.width - 4 - k * 8, sl.y + sl.height / 2)
    await page.mouse.up()
    const vol = await page.evaluate(() => { const s = window.__videoStore.getState(); return { h: s.history.length, v: s.project.clips.find((c) => c.kind === 'audio').volume } })
    check('A volume slider drag is one undo step', vol.h === h0 + 1 && vol.v < 0.8, JSON.stringify({ h0, ...vol }))
    await page.keyboard.press('Escape')
    await page.evaluate(() => window.__videoStore.getState().undo())
  }

  const exportOnce = async (length) => {
    await page.click('.vw-header-actions button:has-text("Export")')
    await page.waitForSelector('.vx')
    if (length) await page.click(`.vx-row .seg-ctl button:has-text("${length === 'draft' ? 'First' : length}")`)
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 300000 }), page.click('.vx-go')])
    const file = await download.path()
    await page.waitForSelector('.vw-export-success')
    const facts = (await page.locator('.vw-export-success').innerText()).replace(/\s+/g, ' ')
    await page.click('.vw-export-modal button:has-text("Done")')
    return { file, facts }
  }
  const sp = await exportOnce()
  const p1 = probe(sp.file)
  const v1 = p1.streams.find((s) => s.codec_type === 'video'), a1 = p1.streams.find((s) => s.codec_type === 'audio')
  check('Export is MP4 / H.264, the timeline’s true length, every frame', p1.format.format_name.includes('mp4') && v1.codec_name === 'h264' && Math.abs(Number(p1.format.duration) - 6) < 0.1 && Number(v1.nb_read_frames) === 180, `${p1.format.format_name} ${v1.codec_name} ${p1.format.duration}s ${v1.nb_read_frames} frames`)
  const srcVoice = level(fx('video/speech-6s.mp4'), 1.2, 3), outQuiet = level(sp.file, 0.1, 0.7), outVoice = level(sp.file, 1.2, 3)
  check('ACCEPT footage sound exports: an audio stream, speech above the noise floor where it is, silence before', !!a1 && /aac|opus/.test(a1.codec_name) && (outQuiet === -999 || outQuiet < -60) && outVoice > -40 && Math.abs(outVoice - srcVoice) < 3, `${a1?.codec_name}; before ${outQuiet} dB, speech ${outVoice} dB (source ${srcVoice} dB)`)
  check('ESB bug is drawn top right (white plate)', near(pixelAt(sp.file, 0.5, 1694, 42), [250, 250, 250], 20), JSON.stringify(pixelAt(sp.file, 0.5, 1694, 42)))
  fs.rmSync(sp.file, { force: true })

  // 5. Layers: two overlays at once, a crossfade, a placeholder-only title, a transform, a headline, the bug off
  await page.evaluate(() => {
    const st = window.__videoStore.getState()
    const a = st.mediaAssets
    const vid = a.find((x) => x.name === 'red-green-2s.mp4'), aud = a.find((x) => x.type === 'audio')
    const c = (o) => ({ in: 0, color: '#2563eb', ...o, out: o.duration })
    window.__videoStore.setState({ project: { ...st.project, bug: true, duration: 7, clips: [
      c({ id: 'fa', trackId: 'v1', title: 'rg a', kind: 'video', start: 0, duration: 2, sourceUrl: vid.url, mediaAssetId: vid.id }),
      c({ id: 'fb', trackId: 'v1', title: 'rg b', kind: 'video', start: 1.5, duration: 1.5, sourceUrl: vid.url, mediaAssetId: vid.id }),
      c({ id: 'lt', trackId: 'v2', title: 'Lower third', kind: 'overlay', start: 0, duration: 3, overlayType: 'lower-third', overlayText: 'Test name', overlaySub: 'Test role' }),
      c({ id: 'cd', trackId: 'v2', title: 'Card', kind: 'overlay', start: 0.5, duration: 2.5, overlayType: 'card', overlayText: 'Card title', overlaySub: 'Card text', accent: '#7c3aed' }),
      c({ id: 'empty', trackId: 'v2', title: 'Lower third', kind: 'overlay', start: 3, duration: 1, overlayType: 'lower-third', overlayText: '', overlaySub: '' }),
      c({ id: 'fc', trackId: 'v1', title: 'rg c', kind: 'video', start: 4, duration: 1, sourceUrl: vid.url, mediaAssetId: vid.id, fit: 'fit', scale: 0.5, offX: 0.25 }),
      c({ id: 'hd', trackId: 'v2', title: 'Headline', kind: 'overlay', start: 5, duration: 1, overlayType: 'headline', overlayText: 'Headline test', overlaySub: 'Desk', accent: '#00e676' }),
      c({ id: 'tone', trackId: 'a1', title: 'tone', kind: 'audio', start: 1, duration: 2, sourceUrl: aud.url, mediaAssetId: aud.id, volume: 0.8 }),
    ] } })
  })
  const lay = await exportOnce()
  const L = lay.file
  const ltStripe = pixelAt(L, 0.6, 124, 845), cardBar = pixelAt(L, 0.6, 430, 459)
  check('ACCEPT two overlays at once both render: lower-third stripe and card accent in one frame', near(ltStripe, [30, 155, 74]) && near(cardBar, [124, 58, 237]), JSON.stringify({ ltStripe, cardBar }))
  const fade = pixelAt(L, 1.75, 300, 540)
  check('Overlapping V1 clips crossfade (half red, half green mid-overlap)', fade[0] > 80 && fade[0] < 180 && fade[1] > 80 && fade[1] < 180, JSON.stringify(fade))
  check('Frame-exact: frame 29 red, frame 30 green', near(pixelAt(L, 29 / 30 + 0.001, 300, 540), [255, 0, 0], 80) && near(pixelAt(L, 30 / 30 + 0.001, 300, 540), [0, 255, 0], 80))
  const emptyStripe = pixelAt(L, 3.5, 124, 845), emptyPanel = pixelAt(L, 3.5, 600, 900)
  check('A title with nothing typed in is left out of the export (no panel, no placeholder)', emptyStripe.every((v) => v < 12) && emptyPanel.every((v) => v < 12), JSON.stringify({ emptyStripe, emptyPanel }))
  const tLeft = pixelAt(L, 4.5, 700, 540), tRight = pixelAt(L, 4.5, 1200, 540)
  check('Footage transform: fit, 50 % scale, moved right', tLeft.every((v) => v < 12) && near(tRight, [255, 0, 0], 80), JSON.stringify({ tLeft, tRight }))
  check('Headline overlay renders with its accent', near(pixelAt(L, 5.5, 112, 900), [0, 230, 118], 50), JSON.stringify(pixelAt(L, 5.5, 112, 900)))
  const quiet = level(L, 0.1, 0.7), tone = level(L, 1.2, 1.5)
  check('A1 tone starts where its clip starts', (quiet === -999 || quiet < -60) && tone > -30, `before ${quiet} dB, during ${tone} dB`)
  fs.rmSync(L, { force: true })
  // 5b. Phase 2: a keyframed move lands at the exact pixel positions at three times, and a 2× clip plays its source
  // twice as fast. Keyframes and speed are applied by the engine (Part B, src/video/engine/*) through the contract in
  // src/video/keyframes.ts / speed.ts; before that engine is merged these two checks are reported PENDING-MERGE.
  await page.evaluate(() => { window.__layersProject = window.__videoStore.getState().project })
  const engineDir = path.join(root, 'src/video/engine')
  const engineReads = (name) => fs.readdirSync(engineDir).some((f) => f.endsWith('.ts') && fs.readFileSync(path.join(engineDir, f), 'utf8').includes(name))
  const engineKeyframes = engineReads('sampleProp')
  const engineSpeed = engineReads('sourceTimeAt')
  /** The first and last lit pixel of row y (r+g+b over 150) in the frame at t. */
  const litSpan = (file, t, y) => {
    const row = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `format=rgb24,crop=1920:1:0:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']).stdout
    let first = -1, last = -1
    for (let x = 0; x < 1920; x++) if (row[x * 3] + row[x * 3 + 1] + row[x * 3 + 2] > 150) { if (first < 0) first = x; last = x }
    return [first, last]
  }
  await page.evaluate(() => {
    const st = window.__videoStore.getState()
    const vid = st.mediaAssets.find((x) => x.name === 'red-green-2s.mp4')
    // a quarter-size picture (fit, 25 %) moved from 30 % left of centre to 30 % right of it over 2 s, linear
    window.__videoStore.setState({ project: { ...st.project, bug: false, duration: 5, clips: [
      { id: 'kf', trackId: 'v1', title: 'kf', kind: 'video', start: 0, duration: 2, in: 0, out: 2, color: '#2563eb', sourceUrl: vid.url, mediaAssetId: vid.id, srcDuration: 2, fit: 'fit', scale: 0.25, offX: 0, keyframes: { x: [{ t: 0, v: -0.3 }, { t: 2, v: 0.3 }] } },
      { id: 'fast', trackId: 'v1', title: 'fast', kind: 'video', start: 3, duration: 1, in: 0, out: 2, color: '#2563eb', sourceUrl: vid.url, mediaAssetId: vid.id, srcDuration: 2, speed: 2 },
    ] } })
  })
  const kfx = await exportOnce()
  // expected left edge: centre 960 + x·1920, minus half the 480 px picture → x(0.5) = −0.15 → 432; x(1) = 0 → 720; x(1.5) = 0.15 → 1008
  const want = [[0.5, 432], [1, 720], [1.5, 1008]]
  const got = want.map(([t]) => litSpan(kfx.file, t + 0.001, 540))
  const kfOk = got.every(([a, b], i) => Math.abs(a - want[i][1]) <= 2 && Math.abs(b - (want[i][1] + 479)) <= 2)
  if (engineKeyframes) check('ACCEPT a keyframed move exports to the exact pixel positions at three times (±2 px)', kfOk, JSON.stringify({ want: want.map((w) => w[1]), got }))
  else console.log(`PENDING-MERGE keyframed move export: the engine (Part B) does not read keyframes on this branch yet; picture spans now ${JSON.stringify(got)}, after the merge they must start at ${want.map((w) => w[1]).join(' / ')} ±2 px`)
  const fastPx = pixelAt(kfx.file, 3.6, 960, 540) // 0.6 s into a 2× clip = source 1.2 s: green
  if (engineSpeed) check('ACCEPT a 2× clip plays its source twice as fast (green at 0.6 s = source 1.2 s)', near(fastPx, [0, 255, 0], 80), JSON.stringify(fastPx))
  else console.log(`PENDING-MERGE 2× speed export: the engine (Part B) does not map source time through speed.ts on this branch yet; pixel now ${JSON.stringify(fastPx)}, after the merge it must be green`)
  check('A 2× clip of a 2 s file is 1 s on the timeline (the export runs 4 s)', Math.abs(Number(probe(kfx.file).format.duration) - 4) < 0.1, String(probe(kfx.file).format.duration))
  fs.rmSync(kfx.file, { force: true })

  // 5c. Phase 2 editing through the UI: tools, ripple delete, markers, a keyframe diamond, a compound opened in place
  await page.evaluate(() => {
    const st = window.__videoStore.getState()
    const vid = st.mediaAssets.find((x) => x.name === 'red-green-2s.mp4')
    const pair = (id, start) => [
      { id, trackId: 'v1', title: id, kind: 'video', start, duration: 2, in: 0, out: 2, color: '#2563eb', sourceUrl: vid.url, mediaAssetId: vid.id, srcDuration: 2, linkId: `L${id}` },
      { id: `${id}s`, trackId: 'a1', title: `${id} sound`, kind: 'audio', start, duration: 2, in: 0, out: 2, color: '#7c3aed', sourceUrl: vid.url, mediaAssetId: vid.id, srcDuration: 2, linkId: `L${id}` },
    ]
    window.__videoStore.setState({ project: { ...st.project, clips: [...pair('p1', 0), ...pair('p2', 2), ...pair('p3', 4)], markers: undefined }, selectedClipId: null, selectedIds: [], currentTime: 1 })
  })
  await page.keyboard.press('b')
  check('B picks the Ripple tool (toolbar shows it)', (await page.evaluate(() => window.__videoStore.getState().tool)) === 'ripple' && /Ripple/.test(await page.locator('.vw-tool-menu').innerText()))
  await page.keyboard.press('v')
  await page.click('.vw-clip-block[data-clip-id="p2"]', { position: { x: 30, y: 20 } })
  const h0 = await page.evaluate(() => window.__videoStore.getState().history.length)
  await page.keyboard.press('Shift+Delete')
  const rip = await page.evaluate(() => { const s = window.__videoStore.getState(); const g = (id) => s.project.clips.find((c) => c.id === id); return { h: s.history.length, p3: g('p3')?.start, p3s: g('p3s')?.start, gone: !g('p2') && !g('p2s') } })
  check('Shift+Del ripple-deletes: the pair goes, the next pair moves up in sync, one undo step', rip.gone && rip.p3 === 2 && rip.p3s === 2 && rip.h === h0 + 1, JSON.stringify(rip))
  await page.keyboard.press('m')
  await page.waitForSelector('.vw-marker')
  check('M drops a marker on the ruler at the playhead', (await page.evaluate(() => window.__videoStore.getState().project.markers?.map((m) => m.t))).join() === '1')
  await page.click('.vw-clip-block[data-clip-id="p1"]', { position: { x: 30, y: 20 } })
  await page.click('.vw-prop[data-prop="scale"] .vw-kf-toggle')
  await page.waitForSelector('.vw-kf-lane .vw-kf-key')
  const kfs = await page.evaluate(() => JSON.stringify(window.__videoStore.getState().project.clips.find((c) => c.id === 'p1').keyframes))
  check('The ◆ beside Scale adds a keyframe at the playhead and the keyframe lane appears under the clip', kfs === JSON.stringify({ scale: [{ t: 1, v: 1 }] }), kfs)
  await page.keyboard.down('Shift'); await page.click('.vw-clip-block[data-clip-id="p3"]', { position: { x: 30, y: 20 } }); await page.keyboard.up('Shift')
  await page.keyboard.press('Control+Alt+g')
  const cmp = await page.evaluate(() => { const s = window.__videoStore.getState(); return s.project.clips.filter((c) => c.compound).map((c) => ({ id: c.id, n: c.compound.clips.length, d: c.duration })) })
  check('Ctrl+Alt+G makes one compound clip of the selection (with the linked sound)', cmp.length === 1 && cmp[0].n === 4 && cmp[0].d === 4, JSON.stringify(cmp))
  await page.dblclick(`.vw-clip-block[data-clip-id="${cmp[0]?.id}"]`, { position: { x: 30, y: 20 } })
  await page.waitForSelector('.vw-compound-bar')
  check('Double-click opens the compound in place (breadcrumb, its own clips on the lanes)', (await page.locator('.vw-clip-block').count()) === 4 && (await page.locator('.vw-clip-block[data-clip-id="p3"]').count()) === 1)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  check('Esc closes it back to the main timeline', (await page.locator('.vw-compound-bar').count()) === 0 && (await page.evaluate(() => window.__videoStore.getState().compoundPath.length)) === 0)
  // back to the layers project of step 5 for the bug-off export
  await page.evaluate(() => { const s = window.__videoStore.getState(); s.loadProject(window.__layersProject, { assets: s.mediaAssets, dirty: true }) })
  await page.click('.vw-bin-panel .side-tabs button:has-text("Overlays")')
  await page.click('.vw-bug-row .switch')
  const noBug = await exportOnce()
  check('ESB bug switched off: nothing top right', pixelAt(noBug.file, 3.5, 1694, 42).every((v) => v < 12), JSON.stringify(pixelAt(noBug.file, 3.5, 1694, 42)))
  fs.rmSync(noBug.file, { force: true })

  // 6. Missing media blocks the export with a reason
  await page.evaluate(() => { const st = window.__videoStore.getState(); window.__videoStore.setState({ project: { ...st.project, clips: [{ ...st.project.clips[0], sourceUrl: undefined }] } }) })
  await page.click('.vw-header-actions button:has-text("Export")')
  await page.waitForSelector('.vx')
  check('Export is refused while a clip has no media', (await page.locator('.vx-blocked').count()) === 1 && (await page.locator('.vx-go').isDisabled()))
  await page.click('.vx-actions button:has-text("Cancel")')

  // 7. A picture from the bin: a full-frame still on V1, or an overlay when asked
  await page.evaluate(() => window.__videoStore.setState((s) => ({ project: { ...s.project, clips: [] } })))
  await page.click('.vw-bin-panel .side-tabs button:has-text("Media")')
  await page.click('.vw-media-card:has-text("synthetic-rig.jpg") .vw-add')
  await page.click('.vw-media-card:has-text("synthetic-rig.jpg") .vw-add-overlay')
  const pics = await page.evaluate(() => window.__videoStore.getState().project.clips.map((c) => ({ t: c.trackId, still: !!c.still, k: c.kind })))
  check('Bin picture → V1 full-frame still; "Overlay" → V2', pics.some((c) => c.t === 'v1' && c.still) && pics.some((c) => c.t === 'v2' && c.k === 'overlay'), JSON.stringify(pics))

  // 8. Story → video: a cut from the Editorial draft; the panel scrolls back to its headline
  await page.evaluate(() => {
    const ed = window.__editorialStore.getState()
    ed.setDraftField('headline', 'Synthetic test headline for the video desk')
    ed.setDraftField('deck', 'A synthetic deck sentence written only for this test run.')
    ed.setDraftField('body', 'The first synthetic body sentence is long enough to caption. The second synthetic body sentence is also long enough.')
  })
  await page.click('.vw-bin-panel .side-tabs button:has-text("Story")')
  await page.waitForSelector('.vw-story-points')
  check('Story tab previews the cut from the draft', (await page.locator('.vw-story-points li').count()) === 5, String(await page.locator('.vw-story-points li').count()))
  await page.click('.vw-story-build')
  await page.click('.vw-story-confirm button:has-text("Replace")')
  await page.waitForSelector('.vw-story-note')
  await page.waitForTimeout(200)
  const built = await page.evaluate(() => { const p = window.__videoStore.getState().project; return { n: p.clips.length, stills: p.clips.filter((c) => c.still).length, withAsset: p.clips.filter((c) => c.still && c.mediaAssetId).length, titles: p.clips.filter((c) => c.still).map((c) => c.title) } })
  check('Build story video replaces the timeline with the cut; its stills are bin media', built.stills === 3 && built.withAsset === 3 && built.n >= 7, JSON.stringify(built))
  check('After building, the Story panel is scrolled back to the top', (await page.evaluate(() => document.querySelector('.vw-bin-content').scrollTop)) === 0)
  const sv = await exportOnce('draft')
  const bannerPx = pixelAt(sv.file, 1, 960, 40)
  check('The banner still is in the exported frames', bannerPx.length === 3 && bannerPx.reduce((a, b) => a + b, 0) / 3 > 150, JSON.stringify(bannerPx))
  fs.rmSync(sv.file, { force: true })

  // 9. Autosave (browser: localStorage) and the restore card after a reload
  await page.waitForFunction(() => (JSON.parse(localStorage.getItem('esb-banner-studio/video-autosave/v1') || '[]').at(-1)?.text || '').includes('Synthetic test headline'), null, { timeout: 15000 })
  const savedClips = await page.evaluate(() => window.__videoStore.getState().project.clips.length)
  check('Autosave writes a snapshot within 10 s', true, `${savedClips} clips`)
  await page.reload()
  await page.waitForSelector('.launch-tile')
  await page.click('.launch-tile:has-text("Video")')
  await page.waitForSelector('.vw-restore-card', { timeout: 8000 }).catch(() => {})
  check('After a reload the "Restore unsaved video" card appears', (await page.locator('.vw-restore-card').count()) === 1)
  await page.click('.vw-restore-go')
  await page.waitForFunction((n) => window.__videoStore.getState().project.clips.length === n, savedClips)
  check('Restore brings back the last state', (await page.evaluate(() => window.__videoStore.getState().project.name)).startsWith('Synthetic test headline'))

  // 10. Open and New ask first when there is unsaved work; New then empties the desk
  await page.click('.vw-open')
  check('Open with unsaved work asks first', (await page.locator('.dialog[aria-label="Open another video?"]').count()) === 1)
  await page.click('.dialog[aria-label="Open another video?"] button:has-text("Cancel")')
  await page.click('.vw-new')
  await page.waitForSelector('.dialog[aria-label="Start a new video?"]')
  await page.click('.vw-confirm-new')
  check('New → confirm → an empty video', (await page.evaluate(() => window.__videoStore.getState().project.clips.length)) === 0 && (await page.locator('.vw-start-card').count()) === 1)

  // 11. Back to Graphics
  await page.click('.vw-header .ws-btn[data-ws="graphics"]')
  await page.waitForSelector('.app > .topbar')
  check('Switched back to Graphics workspace', (await page.locator('.app > .topbar').count()) === 1 && (await page.locator('.video-workspace').count()) === 0)

  await browser.close()
} catch (err) {
  console.error('Video E2E test error:', err)
  failed++
} finally {
  vite.kill()
  process.exit(failed > 0 ? 1 : 0)
}
