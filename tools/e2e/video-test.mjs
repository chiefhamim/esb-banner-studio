// End-to-end checks of the Video desk in the browser (dev server), with ffprobe/ffmpeg reading the exported files.
// Fixtures are synthetic (tools/fixtures/media, tools/fixtures/video — make-fixtures.mjs). The desktop-only parts
// (files by path, save/relaunch, renderer crash, streamed export, RAM) are in tools/e2e/video-electron-test.mjs.
import { chromium } from 'playwright-core'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { launchBrowser } from '../launch-browser.mjs'
import { portOffset } from '../port-offset.mjs'

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

  const exportOnce = async (length) => {
    await page.click('.vw-header-actions button:has-text("Export")')
    await page.waitForSelector('.vx')
    if (length) await page.click(`.vx-row .seg-ctl button:has-text("${length}")`)
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

  // 10. New asks first when there is unsaved work, then empties the desk
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
