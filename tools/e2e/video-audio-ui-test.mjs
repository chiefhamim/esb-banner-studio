// Phase 4 Part B acceptance (browser, dev server): the audio UI. Voiceover countdown + take on the A track at the playhead,
// real waveform tiles (a tone is drawn, silence says "Silent"), the mixer (mute works with no engine; with a stand-in for
// Part A's actions every control writes the store with ONE undo step per gesture), fade handles, the clip inspector's
// Audio section, the loudness readout, and the music library list (a fake desktop bridge with long Bangla names: no text
// cut or spilling). The audio ENGINE is Part A's: where this file stands in for it, it says so (STAND-IN).
//   node tools/e2e/video-audio-ui-test.mjs      PORT=5293 (default) · SHOTS=dir keeps screenshots
import { chromium } from 'playwright-core'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchBrowser } from '../launch-browser.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const PORT = Number(process.env.PORT || 5293)
const BASE = `http://localhost:${PORT}/`
const SHOTS = process.env.SHOTS ? path.resolve(process.env.SHOTS) : null
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })
let failed = 0
const check = (label, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${info}`); if (!ok) failed++ }

const dir = path.join(os.tmpdir(), 'p4b-audio-fixtures')
fs.mkdirSync(dir, { recursive: true })
const TONE = path.join(dir, 'tone-440.wav')
const SILENCE = path.join(dir, 'silence.wav')
const ff = (args, out) => { if (!fs.existsSync(out)) { const r = spawnSync('ffmpeg', ['-y', '-v', 'error', ...args, out]); if (r.status !== 0) throw new Error('ffmpeg: ' + r.stderr) } }
ff(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=6', '-c:a', 'pcm_s16le'], TONE)
ff(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '6', '-c:a', 'pcm_s16le'], SILENCE)

const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
const up = async () => { for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE)).ok) return } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 500)) } throw new Error('Vite did not start') }

const LONG_BN = 'অত্যন্ত দীর্ঘ বাংলা গানের নাম যেটি কোনো ফাঁকা জায়গা ছাড়াই অনেক লম্বা হতে পারে এবং সারিতে ধরা উচিত'
const LIB = [
  { rel: 'শান্ত পিয়ানো [ambient, ধীর] #news.mp3', name: 'শান্ত পিয়ানো.mp3', size: 1, mtimeMs: 1 },
  { rel: `${LONG_BN}.wav`, name: `${LONG_BN}.wav`, size: 1, mtimeMs: 1 },
  { rel: 'Upbeat/Morning Drive - Corporate (energetic, uplifting, tech) [licence CC-BY].mp3', name: 'x.mp3', size: 1, mtimeMs: 1 },
  { rel: 'averyveryveryveryveryveryveryveryveryveryveryveryveryveryveryverylongsingleword_without_spaces_at_all.flac', name: 'a.flac', size: 1, mtimeMs: 1 },
]

async function openVideo(page) {
  await page.goto(BASE)
  const tile = page.locator('.launch-tile:has-text("Video")')
  await Promise.race([tile.first().waitFor({ timeout: 30000 }), page.locator('.ws-btn[data-ws="video"]').first().waitFor({ timeout: 30000 })])
  if (await tile.count()) await tile.first().click(); else await page.click('.ws-btn[data-ws="video"]')
  await page.waitForSelector('.video-workspace', { timeout: 30000 })
}
const tab = (page, label) => page.locator('.vw-bin-panel').getByRole('tab', { name: label, exact: true }).first().click()
const state = (page, fn, arg) => page.evaluate(fn, arg)
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }) }

try {
  await up()
  const browser = await launchBrowser(chromium, { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] })
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 }, permissions: ['microphone'], reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message || e)))
  await openVideo(page)

  // ---------------------------------------------------------------- waveform tiles (real peaks)
  await page.locator('.video-workspace input[type=file][multiple]').first().setInputFiles([TONE, SILENCE])
  await page.waitForFunction(() => window.__videoStore.getState().mediaAssets.length >= 2)
  await page.waitForSelector('.vw-bin-wave[data-wave="ready"]', { timeout: 20000 }).catch(() => {})
  await page.waitForSelector('.vw-bin-wave[data-wave="silent"]', { timeout: 20000 }).catch(() => {})
  const tiles = await state(page, () => [...document.querySelectorAll('.vw-bin-card')].map((c) => {
    const w = c.querySelector('.vw-bin-wave')
    const cv = w?.querySelector('canvas')
    let cols = 0, rows = 0
    if (cv) {
      const g = cv.getContext('2d'); const d = g.getImageData(0, 0, cv.width, cv.height).data
      const colHit = new Set(), rowHit = new Set()
      for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) if (d[(y * cv.width + x) * 4 + 3] > 0) { colHit.add(x); rowHit.add(y) }
      cols = colHit.size; rows = rowHit.size
    }
    return { name: c.querySelector('.vw-media-title')?.textContent, state: w?.dataset.wave, word: w?.querySelector('.vw-wave-word')?.textContent, cols, rows, cw: cv?.width }
  }))
  const tone = tiles.find((t) => /tone/.test(t.name ?? ''))
  const sil = tiles.find((t) => /silence/.test(t.name ?? ''))
  check('bin tile of a tone is a real waveform (ready, drawn across the tile, not flat)', tone?.state === 'ready' && tone.cols >= tone.cw * 0.6 && tone.rows > 4, JSON.stringify(tone))
  check('bin tile of silence says "Silent" and draws nothing', sil?.state === 'silent' && sil.word === 'Silent' && sil.cols === 0, JSON.stringify(sil))

  // ---------------------------------------------------------------- voiceover: countdown, meter, take at the playhead
  await state(page, () => { window.__videoStore.getState().seek(2) })
  await tab(page, 'Audio')
  await page.locator('.vw-au-record').click()
  const seen = []
  const t0 = Date.now()
  while (Date.now() - t0 < 6000) {
    const c = await page.locator('.vw-au-countdown').getAttribute('data-count', { timeout: 200 }).catch(() => null)
    if (c && seen[seen.length - 1] !== c) seen.push(c)
    if (await page.locator('.vw-au-stop').count()) break
    await page.waitForTimeout(80)
  }
  check('countdown shows 3, 2, 1 before recording', seen.join(',') === '3,2,1', seen.join(','))
  if (SHOTS) {
    // a second countdown just for the picture
    await shot(page, 'recording')
  }
  await page.waitForSelector('.vw-au-stop')
  await page.waitForTimeout(1800)
  const meter = await page.locator('.vw-au-rec [role=meter]').getAttribute('data-db')
  check('mic level meter reads a live level while recording', meter !== '' && meter != null && Number(meter) > -60, `data-db=${meter}`)
  await shot(page, 'recording-live')
  await page.locator('.vw-au-stop').click()
  await page.waitForFunction(() => window.__videoStore.getState().project.clips.some((c) => /^Voiceover/.test(c.title)), null, { timeout: 15000 })
  const vo = await state(page, () => { const s = window.__videoStore.getState(); const c = s.project.clips.find((x) => /^Voiceover/.test(x.title)); const tr = s.project.tracks.find((t) => t.id === c.trackId); return { start: c.start, dur: c.duration, kind: c.kind, track: tr.kind, trackId: c.trackId, assets: s.mediaAssets.filter((a) => a.generated).length } })
  check('the take lands on the A track at the playhead (2 s)', vo.track === 'audio' && Math.abs(vo.start - 2) < 0.05 && vo.dur >= 1.5, JSON.stringify(vo))
  await page.waitForTimeout(300)
  const playing = await state(page, () => window.__videoStore.getState().playing)
  check('punch-in stopped the picture again after the take', playing === false)

  // ---------------------------------------------------------------- mixer with no engine: honest, mute works, one undo step
  await state(page, () => { const vs = window.__videoStore, s = vs.getState(); const a = s.mediaAssets.find((x) => /tone/.test(x.name)); s.addClip({ id: 'p4-a', trackId: 'a1', title: 'Tone A', kind: 'audio', start: 0, duration: 6, in: 0, out: 6, color: '#8b5cf6', sourceUrl: a.url, mediaAssetId: a.id, srcDuration: 6 }); s.selectClip(null) })
  await page.locator('.vw-mixer-btn').click()
  await page.waitForSelector('.vw-mixer')
  check('mixer says the engine is pending and switches the controls off', (await page.locator('.vw-mixer').getAttribute('data-engine')) === 'pending' && (await page.locator('.vw-mx-vol').first().isDisabled()) && (await page.locator('.vw-mx-pending').count()) === 1)
  check('mixer shows no fake meter without a graph', (await page.locator('.vw-mx-strip [role=meter].idle').count()) >= 1)
  await shot(page, 'mixer-pending')
  const h0 = await state(page, () => window.__videoStore.getState().history.length)
  await page.locator('.vw-mx-strip[data-track-id="a1"] .vw-mx-btn.mute').click()
  const m1 = await state(page, () => ({ muted: window.__videoStore.getState().project.tracks.find((t) => t.id === 'a1').muted, h: window.__videoStore.getState().history.length }))
  check('mute works now and is one undo step', m1.muted === true && m1.h === h0 + 1, JSON.stringify(m1))
  await state(page, () => window.__videoStore.getState().undo())
  await page.locator('.vw-mixer .vw-mx-close').click()

  // ---------------------------------------------------------------- STAND-IN for Part A's actions (to test this UI's wiring)
  await state(page, () => {
    const vs = window.__videoStore
    const hist = (s, next) => (s.gesture ? { project: next, dirty: true, rev: s.rev + 1 } : { history: [...s.history, s.project], future: [], project: next, dirty: true, rev: s.rev + 1 })
    const proj = (fn) => vs.setState((s) => hist(s, fn(s.project)))
    vs.setState({
      setClipAudio: (id, p) => proj((pr) => ({ ...pr, clips: pr.clips.map((c) => (c.id === id ? { ...c, ...p } : c)) })),
      setTrackAudio: (id, p) => proj((pr) => ({ ...pr, tracks: pr.tracks.map((t) => (t.id === id ? { ...t, ...p } : t)) })),
      setMasterAudio: (p) => proj((pr) => ({ ...pr, master: { gain: 0, limiter: true, ...(pr.master || {}), ...p } })),
      setDucking: (p) => proj((pr) => ({ ...pr, ducking: { enabled: false, depthDb: 12, threshold: -35, attack: 0.05, release: 0.4, ...(pr.ducking || {}), ...p } })),
      setLoudnessTarget: (t) => proj((pr) => ({ ...pr, loudnessTarget: t })),
    })
    globalThis.__esbAudioDev = {
      measureProjectLoudness: async () => ({ integrated: -14.2, truePeak: -1.3, range: 5.4 }),
      audioMeterLevels: () => ({ tracks: { a1: -18 }, master: -12 }),
      markBeats: async () => ({ bpm: 120, beats: [0.5, 1, 1.5] }),
    }
  })
  const hist = () => state(page, () => window.__videoStore.getState().history.length)
  const proj = () => state(page, () => JSON.parse(JSON.stringify(window.__videoStore.getState().project)))
  await page.locator('.vw-mixer-btn').click()
  await page.waitForSelector('.vw-mixer[data-engine="ready"]')
  check('with the stand-in engine the faders are on and meters read the graph', !(await page.locator('.vw-mx-vol').first().isDisabled()) && (await page.locator('.vw-mx-strip[data-track-id="a1"] [role=meter]').getAttribute('data-db')) === '-18.0')
  const drag = async (loc, fx) => {
    const b = await loc.boundingBox()
    await page.mouse.move(b.x + b.width * 0.5, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width * 0.6, b.y + b.height / 2, { steps: 4 })
    await page.mouse.move(b.x + b.width * fx, b.y + b.height / 2, { steps: 6 })
    await page.mouse.up()
  }
  let h = await hist()
  await drag(page.locator('.vw-mx-strip[data-track-id="a1"] .vw-mx-vol'), 0.97)
  let p = await proj()
  const a1 = p.tracks.find((t) => t.id === 'a1')
  check('fader drag sets the track volume in the store, ONE undo step', typeof a1.volume === 'number' && a1.volume > 0 && (await hist()) === h + 1, `volume=${a1.volume} steps=${(await hist()) - h} dom=${await page.locator('.vw-mx-strip[data-track-id="a1"] .vw-mx-vol').inputValue()} box=${JSON.stringify(await page.locator('.vw-mx-strip[data-track-id="a1"] .vw-mx-vol').boundingBox())}`)
  h = await hist()
  await drag(page.locator('.vw-mx-strip[data-track-id="a1"] .vw-mx-panner'), 0.9)
  p = await proj()
  check('pan drag sets pan, ONE undo step', p.tracks.find((t) => t.id === 'a1').pan > 0.3 && (await hist()) === h + 1)
  h = await hist()
  await drag(page.locator('.vw-mx-master-vol'), 0.2)
  p = await proj()
  check('master fader drag sets master gain, ONE undo step', p.master?.gain < 0 && (await hist()) === h + 1, JSON.stringify(p.master))
  h = await hist()
  await page.locator('.vw-mx-strip.master .switch').click()
  p = await proj()
  check('limiter switch writes master.limiter (one step)', p.master.limiter === false && (await hist()) === h + 1)
  h = await hist()
  await page.locator('.vw-mx-strip[data-track-id="a1"] .vw-mx-btn.solo').click()
  p = await proj()
  check('solo writes track.solo (one step)', p.tracks.find((t) => t.id === 'a1').solo === true && (await hist()) === h + 1)
  h = await hist()
  await page.locator('.vw-mx-duck .switch').click()
  p = await proj()
  check('"Music ducks under voice" writes ducking.enabled (one step)', p.ducking?.enabled === true && (await hist()) === h + 1)
  await drag(page.locator('.vw-mx-duck .vw-gslider').first(), 0.9)
  p = await proj()
  check('ducking depth drag changes depthDb', p.ducking.depthDb > 12, `depth=${p.ducking.depthDb}`)
  await shot(page, 'mixer-ready-ducking')
  await page.locator('.vw-mx-target').click()
  await page.getByText('−14 LUFS', { exact: false }).first().click()
  p = await proj()
  check('loudness target select writes project.loudnessTarget', p.loudnessTarget === -14, String(p.loudnessTarget))
  await page.locator('.vw-mx-measure-btn').click()
  await page.waitForFunction(() => document.querySelector('.vw-mx-readout')?.dataset.state === 'measured')
  const rd = await page.evaluate(() => ({ l: document.querySelector('.vw-mx-lufs').textContent, tp: document.querySelector('.vw-mx-tp').textContent, chip: document.querySelector('.vw-sb-loud')?.textContent, note: document.querySelector('.vw-mx-measure-note').textContent }))
  check('Measure shows integrated LUFS and true peak, and the status-bar chip follows', /14\.2/.test(rd.l) && /1\.3/.test(rd.tp) && /14\.2/.test(rd.chip ?? ''), JSON.stringify(rd))
  await shot(page, 'mixer-loudness')
  await page.locator('.vw-mixer .vw-mx-close').click()

  // ---------------------------------------------------------------- fade handles
  await state(page, () => window.__videoStore.getState().selectClip('p4-a'))
  await page.waitForSelector('.vw-clip-block[data-clip-id="p4-a"] .vw-fade-dot.in')
  const zoom = await state(page, () => window.__videoStore.getState().zoom)
  const dotIn = page.locator('.vw-clip-block[data-clip-id="p4-a"] .vw-fade-dot.in')
  const b = await dotIn.boundingBox()
  h = await hist()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height - 8)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height - 8, { steps: 5 })
  await page.mouse.move(b.x + b.width / 2 + 100, b.y + b.height - 8, { steps: 5 })
  await page.mouse.up()
  p = await proj()
  const ca = p.clips.find((c) => c.id === 'p4-a')
  check('dragging the fade-in dot updates the fade length (px / zoom), ONE undo step', ca.fadeIn && Math.abs(ca.fadeIn.dur - (100 + b.width / 2 - 11 - 11 + 11) / zoom) < 0.8 && ca.fadeIn.dur > 0.5 && (await hist()) === h + 1, `dur=${ca.fadeIn?.dur} zoom=${zoom} steps=${(await hist()) - h}`)
  const dotOut = page.locator('.vw-clip-block[data-clip-id="p4-a"] .vw-fade-dot.out')
  const bo = await dotOut.boundingBox()
  await page.mouse.move(bo.x + bo.width / 2, bo.y + bo.height - 8)
  await page.mouse.down()
  await page.mouse.move(bo.x + bo.width / 2 - 60, bo.y + bo.height - 8, { steps: 6 })
  await page.mouse.up()
  p = await proj()
  check('dragging the fade-out dot sets the fade out', p.clips.find((c) => c.id === 'p4-a').fadeOut?.dur > 0.4)
  await dotOut.click({ button: 'right' })
  await page.locator('.menu-item, [role=menuitem]', { hasText: 'Equal power' }).first().click()
  p = await proj()
  check('the dot menu sets the curve', p.clips.find((c) => c.id === 'p4-a').fadeOut.curve === 'equal-power')
  check('the fade shapes are drawn on the clip', (await page.locator('.vw-clip-block[data-clip-id="p4-a"] .vw-fade-shape').count()) === 2)
  const hit = await dotIn.boundingBox()
  check('fade dot hit area is at least 28 px wide', hit.width >= 28 && hit.height >= 20, `${hit.width}x${hit.height}`)
  await shot(page, 'fades')

  // ---------------------------------------------------------------- inspector Audio section
  await page.locator('.vw-jump button', { hasText: /^Audio$/ }).first().click()
  await page.waitForSelector('.vw-audio-panel .vw-s-gain')
  h = await hist()
  await drag(page.locator('.vw-s-gain'), 0.75)
  p = await proj()
  check('inspector gain slider writes clip.gain, ONE undo step', p.clips.find((c) => c.id === 'p4-a').gain > 0 && (await hist()) === h + 1)
  const fi = page.locator('.vw-f-fadein input')
  await fi.fill('1.5'); await fi.press('Enter')
  p = await proj()
  check('typed fade-in seconds commit on Enter', Math.abs(p.clips.find((c) => c.id === 'p4-a').fadeIn.dur - 1.5) < 1e-6)
  await state(page, () => { const s = window.__videoStore.getState(); s.setRangeIn(1); s.setRangeOut(2) })
  await page.locator('.vw-au-sample-btn').click()
  p = await proj()
  const nr = p.clips.find((c) => c.id === 'p4-a').denoise?.noiseRange
  check('"use selection as noise sample" stores the range as source seconds', nr && Math.abs(nr.start - 1) < 1e-6 && Math.abs(nr.end - 2) < 1e-6, JSON.stringify(nr))
  h = await hist()
  await page.locator('.vw-au-beats').click()
  await page.waitForSelector('.vw-au-proposal')
  check('Mark beats shows a proposal and adds nothing yet', (await proj()).markers?.length === undefined || (await proj()).markers.length === 0)
  await page.locator('.vw-au-accept').click()
  p = await proj()
  check('accepting the proposal adds one marker per beat as ONE undo step', p.markers?.length === 3 && (await hist()) === h + 1, `markers=${p.markers?.length}`)
  await shot(page, 'clip-audio-inspector')
  // crossfade between adjacent clips
  await state(page, () => { const s = window.__videoStore.getState(); const a = s.mediaAssets.find((x) => /tone/.test(x.name)); { const vo = s.project.clips.find((c) => /^Voiceover/.test(c.title)); s.updateClip({ ...vo, start: 30 }) } { const a0 = s.project.clips.find((c) => c.id === 'p4-a'); s.updateClip({ ...a0, duration: 5, out: 5 }) } s.addClip({ id: 'p4-b', trackId: 'a1', title: 'Tone B', kind: 'audio', start: 5, duration: 4, in: 1, out: 5, color: '#8b5cf6', sourceUrl: a.url, mediaAssetId: a.id, srcDuration: 6 }); s.selectClip('p4-a') })
  h = await hist()
  await page.locator('.vw-au-xfade').click()
  p = await proj()
    const xa = p.clips.find((c) => c.id === 'p4-a'), xb = p.clips.find((c) => c.id === 'p4-b')
  check('crossfade with the next clip overlaps them and fades both (equal power), ONE undo step', xa.fadeOut.dur > 0.05 && Math.abs(xa.fadeOut.dur - xb.fadeIn.dur) < 1e-6 && xb.start < xa.start + xa.duration - 0.04 && xa.fadeOut.curve === 'equal-power' && (await hist()) === h + 1, `fade=${xa.fadeOut.dur} overlap=${xa.start + xa.duration - xb.start}`)

  // ---------------------------------------------------------------- export sheet row
  await page.getByRole('button', { name: /Export/ }).first().click()
  await page.waitForSelector('.vx-loud-row')
  check('export sheet has a loudness target select', (await page.locator('.vx-loud-target').count()) === 1)
  await shot(page, 'export-loudness')
  await page.keyboard.press('Escape')
  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
  await ctx.close()

  // ---------------------------------------------------------------- music library list (fake desktop bridge): long Bangla names fit
  const ctx2 = await browser.newContext({ viewport: { width: 900, height: 800 }, reducedMotion: 'reduce' })
  await ctx2.addInitScript((lib) => {
    let folder = { path: 'C:\\Music\\ESB licensed', name: 'ESB licensed' }
    window.esb = { videoMusicFolder: async () => folder, videoMusicChoose: async () => folder, videoMusicClear: async () => { folder = null; return null }, videoMusicList: async () => ({ files: lib, truncated: false }), videoMusicUse: async () => { throw new Error('not in this test') } }
  }, LIB)
  const p2 = await ctx2.newPage()
  p2.setDefaultTimeout(20000)
  await openVideo(p2)
  await tab(p2, 'Audio')
  await p2.waitForSelector('.vw-au-track')
  const rows = await p2.evaluate(() => [...document.querySelectorAll('.vw-au-track')].map((r) => ({ title: r.querySelector('.vw-au-title').textContent, tags: [...r.querySelectorAll('.vw-au-tag')].map((t) => t.textContent) })))
  check('library lists the folder files with titles and tags parsed from the names', rows.length === 4 && rows[0].title === 'শান্ত পিয়ানো' && rows[0].tags.includes('ambient') && rows[0].tags.includes('news') && rows[2].title.startsWith('Morning Drive') && rows[2].tags.includes('uplifting'), JSON.stringify(rows.map((r) => [r.title.slice(0, 20), r.tags.length])))
  const overflow = await p2.evaluate(() => {
    const pane = document.querySelector('.vw-bin-content').getBoundingClientRect()
    const bad = []
    for (const el of document.querySelectorAll('.vw-au-track *')) {
      const r = el.getBoundingClientRect()
      if (r.width && (r.right > pane.right + 1 || r.left < pane.left - 1)) bad.push(el.className + ':' + Math.round(r.right - pane.right))
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible' && el.clientWidth > 0 && !/(canvas|svg)/i.test(el.tagName)) bad.push('clipped:' + el.className)
    }
    return bad
  })
  check('long Bangla and unbroken file names wrap inside the library row (nothing cut or spilling)', overflow.length === 0, overflow.slice(0, 4).join(', '))
  const small = await p2.evaluate(() => [...document.querySelectorAll('.vw-au button, .vw-au .ibtn')].map((b) => b.getBoundingClientRect()).filter((r) => r.height && (r.height < 28 || r.width < 28)).map((r) => r.width+'x'+r.height).join(','))
  check('every library and recorder control is at least 28 px', small === '', `${small} small`)
  if (SHOTS) await p2.screenshot({ path: path.join(SHOTS, 'library-900.png') })
  await ctx2.close()
  await browser.close()
} catch (e) {
  console.error('FAIL test crashed:', e?.stack || e)
  failed++
} finally {
  vite.kill()
}
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
