// Phase 2 — Part B acceptance tests (effects rendering, speed in the engine), in the browser on the dev server, with
// ffmpeg reading the exported files back. Fixtures are synthetic (tools/fixtures/video/engine-fixtures.mjs).
//   node tools/e2e/video-fx-test.mjs              all of it (the playback run lasts FX_PLAY_SECONDS, default 30 s)
//   SKIP=perf,golden node ...                      leave parts out (golden, lut, key, pitch, reverse, preview, ui, perf)
//   JSON=path node ...                             keep the measured numbers
import { chromium } from 'playwright-core'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchBrowser } from '../launch-browser.mjs'
import { portOffset } from '../port-offset.mjs'
import { ensureEngineFixtures } from '../fixtures/video/engine-fixtures.mjs'
import { measureEngine, seedFxLayers, testCube } from './video-playback-measure.mjs'

const PORT = 5199 + portOffset()
const PLAY_SECONDS = Number(process.env.FX_PLAY_SECONDS || 30)
const root = path.resolve(import.meta.dirname, '../..')
const FX = ensureEngineFixtures(['golden-src.mp4', 'layer-a-1080p30.mp4', 'layer-b-1080p30.mp4', 'layer-c-1080p30.mp4', 'greenscreen.mp4', 'counter-360p.mp4'])
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
const results = {}
const skip = new Set((process.env.SKIP || '').split(',').filter(Boolean))

const waitUp = async () => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/`)).ok) return } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('Vite did not start')
}

let failed = 0
function check(label, condition, info = '') {
  if (condition) console.log(`PASS ${label} ${info}`)
  else { console.error(`FAIL ${label} ${info}`); failed++ }
}

/** Raw RGB24 of frame `n` of a file (exact frame, by index), optionally scaled. */
function frameOf(file, n, w, h, scale = '') {
  const vf = `select=eq(n\\,${n})${scale ? ',' + scale : ''},format=rgb24`
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', vf, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 * 1024 * 1024 })
  return r.stdout.length === w * h * 3 ? r.stdout : null
}
function diff(rgba, rgb, w, h, tol = 48) {
  let bad = 0
  let sum = 0
  for (let i = 0, j = 0; i < w * h; i++, j += 3) {
    const k = i * 4
    const a = Math.abs(rgba[k] - rgb[j]), b = Math.abs(rgba[k + 1] - rgb[j + 1]), c = Math.abs(rgba[k + 2] - rgb[j + 2])
    sum += (a + b + c) / 3
    if (Math.max(a, b, c) > tol) bad++
  }
  return { bad: bad / (w * h), mean: sum / (w * h) }
}
const pct = (x) => Math.round(x * 10000) / 100
function probe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,nb_frames,duration', '-of', 'json', file])
  return JSON.parse(String(r.stdout))
}
function pcm(file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 256 * 1024 * 1024 })
  const b = r.stdout
  return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4))
}
/** Dominant frequency between lo and hi Hz (Goertzel scan, 1 Hz then 0.1 Hz). */
function dominant(x, rate = 48000, lo = 200, hi = 2000) {
  const power = (f) => { const cw = 2 * Math.cos((2 * Math.PI * f) / rate); let s1 = 0, s2 = 0; for (let i = 0; i < x.length; i++) { const s = x[i] + cw * s1 - s2; s2 = s1; s1 = s } return s1 * s1 + s2 * s2 - cw * s1 * s2 }
  let best = lo, bp = -1
  for (let f = lo; f <= hi; f += 1) { const p = power(f); if (p > bp) { bp = p; best = f } }
  let fine = best
  for (let f = best - 1; f <= best + 1; f += 0.1) { const p = power(f); if (p > bp) { bp = p; fine = f } }
  return Math.round(fine * 10) / 10
}
/** The source frame number written in a counter-fixture frame (10 bars of 64 px at 640×360, LSB left). */
function counterOf(gray640x360) {
  let n = 0
  for (let b = 0; b < 10; b++) if (gray640x360[180 * 640 + 32 + 64 * b] > 128) n |= 1 << b
  return n
}
function counterFrames(file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', 'scale=640:360:flags=area,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 256 * 1024 * 1024 })
  const out = []
  for (let o = 0; o + 640 * 360 <= r.stdout.length; o += 640 * 360) out.push(counterOf(r.stdout.subarray(o, o + 640 * 360)))
  return out
}
/** The LUT on the CPU (trilinear), the reference the exported frame is checked against. */
function parseTestCube(text) {
  const lines = text.split('\n').filter((l) => /^[\d.]/.test(l.trim()))
  const size = Number(/LUT_3D_SIZE (\d+)/.exec(text)[1])
  const data = new Float32Array(size ** 3 * 3)
  lines.forEach((l, i) => { const v = l.trim().split(/\s+/).map(Number); data.set(v, i * 3) })
  return { size, data }
}
function lutCpu({ size: N, data }, r, g, b, out) {
  const c = (v) => Math.min(1, Math.max(0, v)) * (N - 1)
  const x = c(r), y = c(g), z = c(b)
  const x0 = Math.min(N - 2, Math.floor(x)), y0 = Math.min(N - 2, Math.floor(y)), z0 = Math.min(N - 2, Math.floor(z))
  const fx = x - x0, fy = y - y0, fz = z - z0
  const at = (i, j, k, ch) => data[((k * N + j) * N + i) * 3 + ch]
  for (let ch = 0; ch < 3; ch++) {
    const c00 = at(x0, y0, z0, ch) * (1 - fx) + at(x0 + 1, y0, z0, ch) * fx
    const c10 = at(x0, y0 + 1, z0, ch) * (1 - fx) + at(x0 + 1, y0 + 1, z0, ch) * fx
    const c01 = at(x0, y0, z0 + 1, ch) * (1 - fx) + at(x0 + 1, y0, z0 + 1, ch) * fx
    const c11 = at(x0, y0 + 1, z0 + 1, ch) * (1 - fx) + at(x0 + 1, y0 + 1, z0 + 1, ch) * fx
    out[ch] = (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz
  }
  return out
}

let browser
try {
  await waitUp()
  browser = await launchBrowser(chromium, { args: ['--autoplay-policy=no-user-gesture-required'] })
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
  if (process.env.CONSOLE) page.on('console', (m) => console.log('console', m.type(), m.text().slice(0, 300)))
  page.setDefaultTimeout(30000)
  const errors = []
  page.on('pageerror', (err) => { errors.push(String(err)); console.error('PAGE ERROR:', err) })
  await page.goto(`http://localhost:${PORT}/`)
  await page.evaluate(() => localStorage.removeItem('esb-banner-studio/video-autosave/v1'))
  await page.waitForSelector('.launch-tile')
  await page.click('.launch-tile:has-text("Video")')
  await page.waitForSelector('.video-workspace')
  check('WebGL2 monitor: no error slate (effect shaders compiled)', (await page.locator('.vw-gl-error').count()) === 0)
  results.animation = await page.evaluate(() => window.__videoEngine.animationSource?.() ?? null)

  await page.setInputFiles('.video-workspace input[type=file][multiple]', Object.values(FX))
  await page.waitForFunction((n) => window.__videoStore.getState().mediaAssets.length >= n, Object.keys(FX).length, { timeout: 120000 })
  const A = await page.evaluate((names) => Object.fromEntries(names.map((n) => { const a = window.__videoStore.getState().mediaAssets.find((x) => x.name === n); return [n, { id: a.id, url: a.url }] })), Object.keys(FX))
  // two more video tracks (V3, V4) over V1 for the layered cases
  await page.evaluate(() => { const st = window.__videoStore.getState(); for (const id of ['v3', 'v4']) if (!window.__videoStore.getState().project.tracks.some((t) => t.id === id)) st.addTrack('video') })
  const setClips = (clips, extra = {}) => page.evaluate(({ clips, extra }) => {
    const st = window.__videoStore.getState()
    st.loadProject({ ...st.project, ...extra, clips: clips.map((c) => ({ in: 0, color: '#2563eb', title: c.id, ...c, out: c.out ?? (c.in ?? 0) + c.duration })) }, { assets: st.mediaAssets, dirty: true })
    st.seek(0)
  }, { clips, extra })
  const exportNow = async (name) => {
    await page.click('.vw-header-actions button:has-text("Export")')
    await page.waitForSelector('.vx')
    const dl = page.waitForEvent('download', { timeout: 240000 }).then((d) => ({ d }), (e) => ({ err: String(e.message).split('\n')[0] }))
    await page.click('.vx-go')
    const failText = page.waitForSelector('.vw-export-modal .signin-error', { timeout: 240000 }).then(async (e) => ({ err: await e.innerText() }), () => ({ err: 'no download and no error' }))
    const r = await Promise.race([dl, failText])
    if (r.err) { await page.click('.vw-export-modal button:has-text("Close"), .vw-export-modal button:has-text("Cancel")').catch(() => {}); throw new Error('export failed: ' + r.err) }
    const file = path.join(os.tmpdir(), `esb-fx-${name}-${process.pid}.mp4`)
    await r.d.saveAs(file)
    await page.waitForSelector('.vw-export-success')
    await page.click('.vw-export-modal button:has-text("Done")')
    return file
  }
  const still = (t) => page.evaluate(async (t) => window.__videoEngine.still(t), t)
  const fx = (id, type, params) => ({ id, type, enabled: true, params })
  const cube = testCube(33)
  const G = A['golden-src.mp4']
  const B = A['layer-b-1080p30.mp4']
  const K = A['greenscreen.mp4']
  const C = A['counter-360p.mp4']
  const L = A['layer-a-1080p30.mp4']
  const g = (o) => ({ trackId: 'v1', kind: 'video', sourceUrl: G.url, mediaAssetId: G.id, srcDuration: 12, ...o })

  // ---------------------------------------------------------------- ACCEPT: golden frames preview == export for each effect
  if (!skip.has('golden')) {
    const BLENDS = ['multiply', 'screen', 'overlay', 'add', 'darken', 'lighten', 'soft-light']
    const segs = [
      ['colour', [g({ id: 'e0', start: 0, duration: 1, in: 0, effects: [fx('c0', 'colour', { exposure: 0.5, contrast: 0.3, saturation: -0.4, vibrance: 0.5, temperature: 0.5, tint: -0.3, highlights: -0.4, shadows: 0.4 })] })]],
      ['lut', [g({ id: 'e1', start: 1, duration: 1, in: 1, effects: [fx('l1', 'lut', { cube, name: 'warm', intensity: 0.8 })] })]],
      ['mask rect + ellipse (feather, invert)', [g({ id: 'e2b', start: 2, duration: 1, in: 5 }), { id: 'e2', trackId: 'v3', kind: 'video', start: 2, duration: 1, in: 2, sourceUrl: B.url, mediaAssetId: B.id, srcDuration: 65, effects: [fx('m1', 'mask', { shape: 'rect', x: 0.4, y: 0.5, w: 0.5, h: 0.6, feather: 0.08 }), fx('m2', 'mask', { shape: 'ellipse', x: 0.55, y: 0.45, w: 0.25, h: 0.3, feather: 0.03, invert: true })] }]],
      ['chroma key', [g({ id: 'e3b', start: 3, duration: 1, in: 3 }), { id: 'e3', trackId: 'v3', kind: 'video', start: 3, duration: 1, in: 0, sourceUrl: K.url, mediaAssetId: K.id, srcDuration: 4, effects: [fx('k1', 'chromaKey', { color: '#00b140', tolerance: 0.3, softness: 0.15, spill: 0.8 })] }]],
      ['blur', [g({ id: 'e4', start: 4, duration: 1, in: 4, effects: [fx('b1', 'blur', { radius: 14 })] })]],
      ['sharpen + vignette', [g({ id: 'e5', start: 5, duration: 1, in: 5, effects: [fx('s1', 'sharpen', { amount: 1 }), fx('v1', 'vignette', { amount: 0.7, size: 0.4, softness: 0.5 })] })]],
      ...BLENDS.map((m, i) => [`blend ${m}`, [g({ id: `e${6 + i}b`, start: 6 + i, duration: 1, in: (6 + i) % 11 }), { id: `e${6 + i}`, trackId: 'v3', kind: 'video', start: 6 + i, duration: 1, in: 6 + i, sourceUrl: B.url, mediaAssetId: B.id, srcDuration: 65, opacity: 0.85, fit: 'fit', scale: 0.8, blendMode: m }]]),
      ['adjustment layer (colour + blur + mask)', [g({ id: 'e13b', start: 13, duration: 1, in: 2 }), { id: 'e13', trackId: 'v2', kind: 'overlay', start: 13, duration: 1, adjustment: true, opacity: 0.9, effects: [fx('a1', 'colour', { saturation: -1, contrast: 0.4 }), fx('a2', 'blur', { radius: 6 }), fx('a3', 'mask', { shape: 'ellipse', x: 0.5, y: 0.5, w: 0.7, h: 0.7, feather: 0.1, invert: true })] }]],
      ['keyframed transform (x, scale, rotation, opacity, crop)', [g({ id: 'e14', start: 14, duration: 1, in: 6, fit: 'fit', keyframes: { x: [{ t: 0, v: -0.1 }, { t: 1, v: 0.15, ease: 'ease-in-out' }], scale: [{ t: 0, v: 1 }, { t: 1, v: 0.6 }], rotation: [{ t: 0, v: 0 }, { t: 1, v: 12 }], opacity: [{ t: 0, v: 1 }, { t: 1, v: 0.5 }], cropL: [{ t: 0, v: 0 }, { t: 1, v: 0.2 }] } })]],
    ]
    await setClips(segs.flatMap(([, c]) => c))
    const file = await exportNow('golden')
    const scores = []
    for (let i = 0; i < segs.length; i++) {
      const n = i * 30 + 15
      const s = await still(n / 30)
      const ex = frameOf(file, n, 1920, 1080)
      if (!ex) { scores.push({ effect: segs[i][0], n, error: 'no export frame' }); continue }
      const d = diff(Buffer.from(s.base64, 'base64'), ex, 1920, 1080)
      scores.push({ effect: segs[i][0], n, meanPct: pct(d.mean / 255), offPct: pct(d.bad) })
    }
    results.golden = scores
    check(`ACCEPT golden frames, preview == export for each effect (${segs.length} cases; mean difference ≤ 1 %, ≤ 1 % of pixels off by > 48 levels)`, scores.every((s) => s.meanPct != null && s.meanPct <= 1 && s.offPct <= 1), JSON.stringify(scores))
    // and each effect changed the picture (a no-op shader would also be "equal")
    const plain = await page.evaluate(async () => {
      const st = window.__videoStore.getState()
      const p = st.project
      const out = []
      for (const t of [0.5, 1.5, 4.5, 5.5]) {
        const strip = { ...p, clips: p.clips.map((c) => ({ ...c, effects: undefined })) }
        window.__videoStore.setState({ project: strip })
        const a = await window.__videoEngine.still(t)
        window.__videoStore.setState({ project: p })
        const b = await window.__videoEngine.still(t)
        const x = Uint8Array.from(atob(a.base64), (ch) => ch.charCodeAt(0))
        const y = Uint8Array.from(atob(b.base64), (ch) => ch.charCodeAt(0))
        let sum = 0
        for (let i = 0; i < x.length; i += 4 * 7) sum += Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2])
        out.push(Math.round((sum / (3 * (x.length / 28)) / 255) * 10000) / 100)
      }
      return out
    })
    results.effectChange = plain
    check('each effect changes the picture (colour, LUT, blur, sharpen+vignette: mean change > 1 %)', plain.every((v) => v > 1), JSON.stringify(plain))

    // an adjustment layer acts on the tracks BELOW it only: a lower third on its own track (V2) that starts before it
    // stays as it is. Reference = the same lower third moved to a track above V2 (the adjustment alone on V2).
    const lt = { id: 'adj-lt', trackId: 'v2', kind: 'overlay', start: 0, duration: 2, overlayType: 'lower-third', overlayText: 'Golden lower third', overlaySub: 'Unchanged by the adjustment' }
    const ad = { id: 'adj-ad', trackId: 'v2', kind: 'overlay', start: 0.5, duration: 1.5, adjustment: true, effects: [fx('ag', 'colour', { saturation: -1, contrast: 0.4 })] }
    const base = g({ id: 'adj-f', start: 0, duration: 2, in: 2 })
    const tracksOf = () => page.evaluate(() => window.__videoStore.getState().project.tracks)
    const tr = await tracksOf()
    const above = [{ id: 'lt-top', name: 'Titles', kind: 'overlay', muted: false, locked: false }, ...tr]
    const pixels = async (clips, extra) => { await setClips(clips, extra); await page.waitForTimeout(300); return (await still(1)).base64 }
    const sameTrack = await pixels([base, lt, ad], { bug: false, tracks: tr })
    const reference = await pixels([base, { ...lt, trackId: 'lt-top' }, ad], { bug: false, tracks: above })
    const noAdj = await pixels([base, lt], { bug: false, tracks: tr })
    const cmp = (p, q) => page.evaluate(({ p, q }) => {
      const x = Uint8Array.from(atob(p), (ch) => ch.charCodeAt(0))
      const y = Uint8Array.from(atob(q), (ch) => ch.charCodeAt(0))
      let sum = 0
      for (let i = 0; i < x.length; i += 4 * 7) sum += Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2])
      return Math.round((sum / (3 * (x.length / 28)) / 255) * 10000) / 100
    }, { p, q })
    results.adjustmentOwnTrack = { vsReferencePct: await cmp(sameTrack, reference), vsNoAdjustmentPct: await cmp(sameTrack, noAdj) }
    await setClips([base], { tracks: tr })
    check('GOLDEN an adjustment layer leaves a lower third on its own track (starting before it) unchanged: same picture as the lower third on a track above (mean ≤ 0.2 %), and it still greys the footage (> 1 %)', results.adjustmentOwnTrack.vsReferencePct <= 0.2 && results.adjustmentOwnTrack.vsNoAdjustmentPct > 1, JSON.stringify(results.adjustmentOwnTrack))
    fs.rmSync(file, { force: true })
  }

  // ---------------------------------------------------------------- ACCEPT: a LUT export matches a CPU reference frame
  if (!skip.has('lut')) {
    await setClips([g({ id: 'lut', start: 0, duration: 2, in: 0, effects: [fx('l', 'lut', { cube, name: 'warm', intensity: 1 })] })], { bug: false })
    const file = await exportNow('lut')
    const n = 30
    const ex = frameOf(file, n, 1920, 1080)
    // the reference: the same source frame as this app decodes it (the preview still with the LUT left out), run through
    // the LUT on the CPU (trilinear, as written in this test, independent of the shader)
    const plainStill = await page.evaluate(async (t) => {
      const st = window.__videoStore.getState()
      const p = st.project
      window.__videoStore.setState({ project: { ...p, clips: p.clips.map((c) => ({ ...c, effects: undefined })) } })
      try { return await window.__videoEngine.still(t) } finally { window.__videoStore.setState({ project: p }) }
    }, n / 30)
    const src = Buffer.from(plainStill.base64, 'base64')
    const ffsrc = frameOf(FX['golden-src.mp4'], n, 1920, 1080)
    const lut = parseTestCube(cube)
    const o = [0, 0, 0]
    let sum = 0, sumSrc = 0, sumFf = 0, bad = 0
    for (let i = 0, j = 0; i < 1920 * 1080 * 3; i += 3, j += 4) {
      lutCpu(lut, src[j] / 255, src[j + 1] / 255, src[j + 2] / 255, o)
      let m = 0
      for (let ch = 0; ch < 3; ch++) { const d = Math.abs(o[ch] * 255 - ex[i + ch]); sum += d; m = Math.max(m, d); sumSrc += Math.abs(src[j + ch] - ex[i + ch]) }
      lutCpu(lut, ffsrc[i] / 255, ffsrc[i + 1] / 255, ffsrc[i + 2] / 255, o)
      for (let ch = 0; ch < 3; ch++) sumFf += Math.abs(o[ch] * 255 - ex[i + ch])
      if (m > 48) bad++
    }
    const N3 = 1920 * 1080 * 3
    const meanPct = pct(sum / N3 / 255)
    results.lut = { meanPct, offPct: pct(bad / (1920 * 1080)), withoutLutMeanPct: pct(sumSrc / N3 / 255), ffmpegDecodedSourceMeanPct: pct(sumFf / N3 / 255) }
    check('ACCEPT LUT export matches the CPU reference (trilinear .cube on the decoded source frame; mean difference ≤ 1 %)', meanPct <= 1 && results.lut.withoutLutMeanPct > 2, JSON.stringify(results.lut))
    fs.rmSync(file, { force: true })
  }

  // ---------------------------------------------------------------- ACCEPT: chroma key leaves < 1 % green spill pixels
  if (!skip.has('key')) {
    await setClips([{ id: 'key', trackId: 'v1', kind: 'video', start: 0, duration: 2, in: 0, sourceUrl: K.url, mediaAssetId: K.id, srcDuration: 4, fit: 'fill', effects: [fx('k', 'chromaKey', { color: '#00b140' })] }], { bug: false })
    const file = await exportNow('key')
    const ex = frameOf(file, 30, 1920, 1080)
    const raw = frameOf(FX['greenscreen.mp4'], 30, 1920, 1080, 'scale=1920:1080')
    const green = (b) => { let n = 0; for (let i = 0; i < b.length; i += 3) if (b[i + 1] > 48 && b[i + 1] > Math.max(b[i], b[i + 2]) + 24) n++; return n / (b.length / 3) }
    const at = (b, x, y) => { const i = (y * 1920 + x) * 3; return [b[i], b[i + 1], b[i + 2]] }
    const subject = at(ex, 960, 400)
    const bg = at(ex, 150, 150)
    results.key = { spillPct: pct(green(ex)), beforePct: pct(green(raw)), subject, background: bg }
    check('ACCEPT chroma key: < 1 % green spill pixels left (green screen fixture with a spill fringe), subject kept, screen gone', green(ex) < 0.01 && green(raw) > 0.5 && subject[0] > 150 && Math.abs(subject[0] - 200) < 30 && bg.every((v) => v < 24), JSON.stringify(results.key))
    fs.rmSync(file, { force: true })
  }

  // ---------------------------------------------------------------- ACCEPT: 2× clip — half length, pitch preserved (and doubled without)
  if (!skip.has('pitch')) {
    const two = (preservePitch) => [
      { id: 'sv', trackId: 'v1', kind: 'video', start: 0, duration: 4, in: 0, out: 8, speed: 2, sourceUrl: L.url, mediaAssetId: L.id, srcDuration: 65, linkId: 'S2', ...(preservePitch === false ? { preservePitch } : {}) },
      { id: 'sa', trackId: 'a1', kind: 'audio', start: 0, duration: 4, in: 0, out: 8, speed: 2, sourceUrl: L.url, mediaAssetId: L.id, srcDuration: 65, linkId: 'S2', volume: 1, ...(preservePitch === false ? { preservePitch } : {}) },
    ]
    await setClips(two(true))
    const f1 = await exportNow('pitch')
    const p1 = probe(f1)
    const a1 = pcm(f1)
    const freq1 = dominant(a1.subarray(48000, 48000 * 3))
    const rms = Math.sqrt(a1.subarray(48000, 48000 * 3).reduce((s, v) => s + v * v, 0) / 96000)
    await setClips(two(false))
    const f2 = await exportNow('pitch-off')
    const freq2 = dominant(pcm(f2).subarray(48000, 48000 * 3))
    const dur = Number(p1.format.duration)
    results.pitch = { exportSeconds: dur, sourceSeconds: 8, preserved: freq1, notPreserved: freq2, rms: Math.round(rms * 1000) / 1000 }
    check('ACCEPT 2× clip exports at half its source length (8 s of source → 4 s)', Math.abs(dur - 4) <= 0.05, JSON.stringify(results.pitch))
    check('ACCEPT 2× with preservePitch (default): the 440 Hz tone measures 440 ± 5 Hz', Math.abs(freq1 - 440) <= 5 && rms > 0.05, JSON.stringify(results.pitch))
    check('ACCEPT 2× with preservePitch = false: the tone doubles (880 ± 10 Hz)', Math.abs(freq2 - 880) <= 10, JSON.stringify(results.pitch))
    fs.rmSync(f1, { force: true })
    fs.rmSync(f2, { force: true })
  }

  // ---------------------------------------------------------------- ACCEPT: reverse exports frames in reverse order (frame counter)
  if (!skip.has('reverse')) {
    const ctr = (o) => ({ trackId: 'v1', kind: 'video', sourceUrl: C.url, mediaAssetId: C.id, srcDuration: 6, ...o })
    await setClips([ctr({ id: 'rv', start: 0, duration: 4, in: 0, out: 4, reverse: true })], { bug: false })
    const f = await exportNow('reverse')
    const seq = counterFrames(f)
    const steps = seq.slice(1).map((v, i) => v - seq[i])
    const exactSteps = steps.filter((s) => s === -1).length
    results.reverse = { frames: seq.length, first: seq[0], last: seq.at(-1), stepsOfMinusOne: exactSteps, head: seq.slice(0, 6), tail: seq.slice(-4) }
    check('ACCEPT reverse clip exports its frames in reverse order (counter 119 → 0, every step −1)', seq.length === 120 && seq[0] === 119 && seq.at(-1) === 0 && exactSteps === 119, JSON.stringify(results.reverse))
    fs.rmSync(f, { force: true })
    // 2× forward and a ramp (1× → 3×) on the same counter: frames step 2, and strictly increasing
    await setClips([ctr({ id: 'f2', start: 0, duration: 2, in: 0, out: 4, speed: 2 }), ctr({ id: 'fr', start: 2, duration: 1.5, in: 0, out: 6, speed: { ramp: [{ t: 0, v: 1 }, { t: 1.5, v: 3 }] } })], { bug: false })
    const f3 = await exportNow('fast')
    const s3 = counterFrames(f3)
    const twoX = s3.slice(0, 60)
    const rampPart = s3.slice(60)
    results.fast = { twoX: { first: twoX[0], last: twoX.at(-1), allStep2: twoX.slice(1).every((v, i) => v - twoX[i] === 2) }, ramp: { first: rampPart[0], last: rampPart.at(-1), increasing: rampPart.slice(1).every((v, i) => v > rampPart[i]), firstStep: rampPart[1] - rampPart[0], lastStep: rampPart.at(-1) - rampPart.at(-2) } }
    check('2× forward shows every second source frame; a 1×→3× ramp speeds up (steps grow from 1 to 3)', results.fast.twoX.allStep2 && twoX[0] === 0 && results.fast.ramp.increasing && results.fast.ramp.firstStep === 1 && results.fast.ramp.lastStep >= 2, JSON.stringify(results.fast))
    fs.rmSync(f3, { force: true })
  }

  // ---------------------------------------------------------------- preview: reverse playback and 2× sound through Web Audio
  if (!skip.has('preview')) {
    await setClips([g({ id: 'pr', start: 0, duration: 4, in: 0, out: 8, speed: 2, reverse: true })])
    await page.waitForTimeout(600)
    const m = await measureEngine(page, 3)
    results.previewReverse2x = { dropped: m.dropped, frames: m.frames, pct: m.frames ? Math.round((m.dropped / m.frames) * 10000) / 100 : 100, gaps: m.gaps.slice(0, 8) }
    check('preview: a 1080p clip reversed at 2× plays with ≤ 5 % dropped frames (GOP-by-GOP backward decode)', m.frames > 60 && results.previewReverse2x.pct <= 5, JSON.stringify(results.previewReverse2x))
    // a "Hero moment" ramp (2× → 0.3× → 2×): the fast parts once dropped every frame decoded just above the look-ahead
    const hero = await page.evaluate((c) => window.__videoEngine.rampPreset(c, 'hero'), g({ id: 'hr', start: 0, duration: 6, in: 0, out: 6, title: 'hero', color: '#2563eb' }))
    await setClips([hero])
    await page.waitForTimeout(600)
    const mh = await measureEngine(page, Math.min(8, hero.duration - 0.5))
    results.previewHero = { dropped: mh.dropped, frames: mh.frames, pct: mh.frames ? Math.round((mh.dropped / mh.frames) * 10000) / 100 : 100, gaps: mh.gaps.slice(0, 8), duration: hero.duration }
    check('preview: a "Hero moment" speed ramp plays with ≤ 2 % dropped frames', mh.frames > 100 && results.previewHero.pct <= 2, JSON.stringify(results.previewHero))
    await setClips([
      { id: 'pv', trackId: 'v1', kind: 'video', start: 0, duration: 4, in: 0, out: 8, speed: 2, sourceUrl: L.url, mediaAssetId: L.id, srcDuration: 65, linkId: 'P2' },
      { id: 'pa', trackId: 'a1', kind: 'audio', start: 0, duration: 4, in: 0, out: 8, speed: 2, sourceUrl: L.url, mediaAssetId: L.id, srcDuration: 65, linkId: 'P2', volume: 1 },
    ])
    await page.waitForTimeout(600)
    const heard = await page.evaluate(async () => {
      const audio = window.__videoEngine.audio()
      const got = []
      audio.tap = (buf) => { got.push(Float32Array.from(buf)) }
      window.__videoStore.getState().play()
      await new Promise((r) => setTimeout(r, 2500))
      window.__videoStore.getState().pause()
      audio.tap = null
      const all = new Float32Array(got.reduce((s, b) => s + b.length, 0))
      let o = 0
      for (const b of got) { all.set(b, o); o += b.length }
      // the steady middle second
      const mid = all.subarray(Math.floor(all.length / 2) - 24000, Math.floor(all.length / 2) + 24000)
      let rms = 0
      for (const v of mid) rms += v * v
      return { samples: all.length, mid: Array.from(mid), rms: Math.sqrt(rms / Math.max(1, mid.length)) }
    })
    const pf = heard.mid.length ? dominant(Float32Array.from(heard.mid)) : 0
    results.previewPitch = { frequency: pf, rms: Math.round(heard.rms * 1000) / 1000, samples: heard.samples }
    check('preview: a 2× clip is heard at 440 ± 5 Hz (same stretcher as the export, scheduled on Web Audio)', Math.abs(pf - 440) <= 5 && heard.rms > 0.02, JSON.stringify(results.previewPitch))
  }

  // ---------------------------------------------------------------- UI: effects + colour panels, LUT import, adjustment layer
  if (!skip.has('ui')) {
    await setClips([g({ id: 'ui', start: 0, duration: 4, in: 0 })])
    await page.evaluate(() => window.__videoStore.getState().selectClip('ui'))
    await page.waitForSelector('.vw-fx-panel')
    await page.click('.vw-colour-panel .vw-fx-head')
    await page.waitForSelector('.vw-colour-panel .vw-s-fx-exposure')
    const lutFile = path.join(os.tmpdir(), `esb-fx-test-${process.pid}.cube`)
    fs.writeFileSync(lutFile, cube)
    await page.setInputFiles('.vw-colour-panel input[type=file]', lutFile)
    await page.waitForFunction(() => window.__videoStore.getState().project.clips[0].effects?.some((e) => e.type === 'lut' && e.params?.lut), null, { timeout: 10000 })
    const lutState = await page.evaluate(() => { const e = window.__videoStore.getState().project.clips[0].effects.find((x) => x.type === 'lut'); return { name: e.params.name, chars: (window.__videoEngine.lutText?.(e.params.lut) ?? '').length, id: e.params.lut } })
    fs.writeFileSync(lutFile, 'LUT_3D_SIZE 17\n0 0 0\n')
    await page.setInputFiles('.vw-colour-panel input[type=file]', lutFile)
    const lutError = await page.locator('.vw-colour-panel .vw-fx-error').innerText().catch(() => '')
    fs.rmSync(lutFile, { force: true })
    results.ui = { lut: lutState, badLutMessage: lutError }
    check('Colour panel: a .cube LUT imports (stored once per project by content id) and a broken one is refused with a reason', lutState.chars > 1000 && /Expected 17³/.test(lutError), JSON.stringify(results.ui))
    await page.click('.vw-fx-panel .vw-fx-head')
    await page.click('.vw-fx-panel .vw-fx-add')
    await page.click('.menu .menu-item:has-text("Mask")')
    const kinds = await page.evaluate(() => window.__videoStore.getState().project.clips[0].effects.map((e) => e.type))
    check('Effects panel: Add → Mask adds a mask effect', kinds.includes('mask'), JSON.stringify(kinds))
    await page.keyboard.press('Control+z')
    const afterUndo = await page.evaluate(() => window.__videoStore.getState().project.clips[0].effects.map((e) => e.type))
    check('Ctrl+Z takes the added effect back', !afterUndo.includes('mask'), JSON.stringify(afterUndo))
    await page.evaluate(() => window.__videoStore.getState().selectClip(null))
    await page.click('.video-workspace [role=tab]:has-text("Titles"), .video-workspace button:has-text("Titles")')
    const before = await page.evaluate(() => window.__videoStore.getState().project.clips.length)
    await page.click('.vw-adjust-add')
    const adj = await page.evaluate(() => window.__videoStore.getState().project.clips.find((c) => c.adjustment))
    check('Titles tab: “Adjustment layer” adds an adjustment clip over the footage', !!adj && adj.kind === 'overlay' && (await page.evaluate(() => window.__videoStore.getState().project.clips.length)) === before + 1, JSON.stringify(adj && { track: adj.trackId, effects: adj.effects?.map((e) => e.type) }))
  }

  // ---------------------------------------------------------------- ACCEPT: performance — 3 layers + colour + LUT + blur
  if (!skip.has('perf')) {
    await seedFxLayers(page, PLAY_SECONDS)
    await page.waitForTimeout(1500)
    const m = await measureEngine(page, PLAY_SECONDS)
    const p = m.frames ? (m.dropped / m.frames) * 100 : 100
    results.perf = { seconds: PLAY_SECONDS, dropped: m.dropped, frames: m.frames, pct: Math.round(p * 100) / 100, draws: m.draws, playhead: m.playhead, cacheMB: m.cacheMB, gaps: m.gaps.slice(0, 12) }
    check(`ACCEPT 1080p30, 3 layers + colour + LUT + blur for ${PLAY_SECONDS} s: dropped frames ≤ 2 %`, m.frames >= PLAY_SECONDS * 30 * 0.97 && p <= 2, JSON.stringify(results.perf))
  }

  check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (e) {
  console.error('FAIL harness:', e)
  failed++
} finally {
  await browser?.close().catch(() => {})
  vite.kill()
}
console.log('RESULTS ' + JSON.stringify(results))
if (process.env.JSON) fs.writeFileSync(process.env.JSON, JSON.stringify(results, null, 2))
process.exit(failed ? 1 : 0)
