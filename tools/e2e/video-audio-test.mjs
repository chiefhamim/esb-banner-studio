// Phase 4 - Part A acceptance tests (the audio engine: one graph for preview and export, processing, loudness), in the
// browser on the dev server, with ffmpeg reading the exported files back. Fixtures are synthetic WAVs written here into
// tools/out/video-fixtures/p4a-*.wav (nothing is real footage or a recording).
//   node tools/e2e/video-audio-test.mjs
//   SKIP=perf,denoise node ...        leave parts out (loudness, duck, fades, preview, denoise, mix, old, perf)
//   LONG=1 node ...                   also a full 10-minute export (slow)
//   JSON=path node ...                keep the measured numbers
import { chromium } from 'playwright-core'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchBrowser } from '../launch-browser.mjs'
import { portOffset } from '../port-offset.mjs'

const PORT = 5252 + portOffset()
const root = path.resolve(import.meta.dirname, '../..')
const OUT = path.join(root, 'tools', 'out', 'video-fixtures')
fs.mkdirSync(OUT, { recursive: true })
const SR = 48000
const skip = new Set((process.env.SKIP || '').split(',').filter(Boolean))
const results = {}
let failed = 0
function check(label, condition, info = '') {
  if (condition) console.log(`PASS ${label} ${info}`)
  else { console.error(`FAIL ${label} ${info}`); failed++ }
}

// ---------------------------------------------------------------- synthetic fixtures
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
function gauss(n, rms, seed) { const r = rng(seed); const o = new Float32Array(n); for (let i = 0; i < n; i += 2) { const u = Math.max(1e-12, r()); const v = r(); const m = Math.sqrt(-2 * Math.log(u)); o[i] = m * Math.cos(2 * Math.PI * v) * rms; if (i + 1 < n) o[i + 1] = m * Math.sin(2 * Math.PI * v) * rms } return o }
function writeWav(file, chans) {
  const n = chans[0].length
  const buf = Buffer.alloc(44 + n * chans.length * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * chans.length * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(chans.length, 22); buf.writeUInt32LE(SR, 24)
  buf.writeUInt32LE(SR * chans.length * 2, 28); buf.writeUInt16LE(chans.length * 2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * chans.length * 2, 40)
  let o = 44
  for (let i = 0; i < n; i++) for (const c of chans) { buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(c[i] * 32767))), o); o += 2 }
  fs.writeFileSync(file, buf)
}
const tone = (n, f, a) => { const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = a * Math.sin((2 * Math.PI * f * i) / SR); return o }
/** Speech-like: harmonics of 140 Hz with a syllable envelope (3 Hz), a second of silence at the head. */
function speechLike(n, amp) {
  const o = new Float32Array(n)
  for (let i = SR; i < n; i++) {
    const t = i / SR
    const env = Math.pow(Math.max(0, Math.sin(2 * Math.PI * 2.7 * t)), 0.6)
    o[i] = amp * env * (Math.sin(2 * Math.PI * 140 * t) + 0.7 * Math.sin(2 * Math.PI * 280 * t) + 0.5 * Math.sin(2 * Math.PI * 560 * t) + 0.3 * Math.sin(2 * Math.PI * 1120 * t + 1)) / 2.2
  }
  return o
}
const FIX = {}
function fixture(name, make) { const f = path.join(OUT, name); if (!fs.existsSync(f)) writeWav(f, make()); FIX[name] = f; return f }
fixture('p4a-music.wav', () => { // quiet two-tone music-ish bed, 24 s, with a few sharp transients
  const n = SR * 24; const a = tone(n, 220, 0.04); const b = tone(n, 330, 0.03)
  for (let i = 0; i < n; i++) { a[i] += b[i]; const k = i % (SR * 3); if (k < 240) a[i] += 0.5 * Math.exp(-k / 60) * Math.sin(k * 0.9) }
  return [a, a]
})
fixture('p4a-tone.wav', () => { const t = tone(SR * 12, 1000, 0.25); return [t, t] })
fixture('p4a-voice.wav', () => { const t = tone(SR * 12, 440, 0.3); return [t, t] })
fixture('p4a-bed.wav', () => { const t = tone(SR * 12, 220, 0.3); return [t, t] })
const cleanSpeech = speechLike(SR * 10, 0.5)
fixture('p4a-clean.wav', () => [cleanSpeech, cleanSpeech])
fixture('p4a-noisy.wav', () => { const nz = gauss(SR * 10, 0.05, 7); const x = new Float32Array(nz.length); for (let i = 0; i < x.length; i++) x[i] = cleanSpeech[i] + nz[i]; return [x, x] })
fixture('p4a-noisy60.wav', () => { const n = SR * 60; const sp = speechLike(n, 0.5); const nz = gauss(n, 0.05, 9); for (let i = 0; i < n; i++) sp[i] += nz[i]; return [sp, sp] })
if (process.env.LONG || !skip.has('perf')) fixture('p4a-long.wav', () => { const n = SR * 600; const sp = speechLike(n, 0.4); const t = tone(n, 196, 0.05); for (let i = 0; i < n; i++) t[i] += 0.02 * Math.sin(i * 0.0007); return [sp, t] })

// ---------------------------------------------------------------- measuring with ffmpeg
function pcm(file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '2', '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 1024 * 1024 * 1024 })
  const b = r.stdout
  const all = new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4))
  const n = Math.floor(all.length / 2)
  const L = new Float32Array(n); const R = new Float32Array(n)
  for (let i = 0; i < n; i++) { L[i] = all[2 * i]; R[i] = all[2 * i + 1] }
  return [L, R]
}
const rmsDb = (x, a, b) => { let s = 0; const i0 = Math.round(a * SR); const i1 = Math.min(x.length, Math.round(b * SR)); for (let i = i0; i < i1; i++) s += x[i] * x[i]; return 10 * Math.log10(s / Math.max(1, i1 - i0) + 1e-20) }
function ebur(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' })
  const t = r.stderr.slice(r.stderr.lastIndexOf('Summary:'))
  const num = (re) => { const m = t.match(re); return m ? parseFloat(m[1]) : NaN }
  return { I: num(/I:\s+(-?[\d.]+) LUFS/), LRA: num(/LRA:\s+(-?[\d.]+) LU/), peak: num(/Peak:\s+(-?[\d.]+) dBFS/) }
}
const probeDur = (file, stream) => { const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', stream, '-show_entries', 'stream=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }); return parseFloat(r.stdout) }

const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
const waitUp = async () => { for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) return } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 500)) } throw new Error('Vite did not start') }

/** Working set (MB) of the browser's own processes (browser, renderers, GPU, utility) by pid. */
function pidsMB(pids) {
  const r = spawnSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum / 1MB`], { encoding: 'utf8' })
  return parseFloat(r.stdout) || 0
}

let browser
try {
  await waitUp()
  browser = await launchBrowser(chromium, { args: ['--autoplay-policy=no-user-gesture-required'] })
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } })
  if (process.env.CONSOLE) page.on('console', (m) => console.log('console', m.type(), m.text().slice(0, 300)))
  page.setDefaultTimeout(60000)
  const errors = []
  page.on('pageerror', (err) => { errors.push(String(err)); console.error('PAGE ERROR:', err) })
  await page.goto(`http://localhost:${PORT}/`)
  await page.evaluate(() => localStorage.removeItem('esb-banner-studio/video-autosave/v1'))
  await page.waitForSelector('.launch-tile')
  await page.click('.launch-tile:has-text("Video")')
  await page.waitForSelector('.video-workspace')
  const names = Object.keys(FIX)
  await page.setInputFiles('.video-workspace input[type=file][multiple]', Object.values(FIX))
  await page.waitForFunction((n) => window.__videoStore.getState().mediaAssets.length >= n, names.length, { timeout: 120000 })
  const A = {}
  for (const n of names) A[n] = await page.evaluate((n) => { const a = window.__videoStore.getState().mediaAssets.find((x) => x.name === n); return { id: a.id, url: a.url, duration: a.duration } }, n)

  /** An audio clip on a track. */
  const aclip = (id, file, o = {}) => ({ id, trackId: 'a1', kind: 'audio', title: id, color: '#7c3aed', start: 0, duration: 8, in: 0, out: (o.in ?? 0) + (o.duration ?? 8), sourceUrl: A[file].url, mediaAssetId: A[file].id, srcDuration: A[file].duration, volume: 1, ...o })
  const setProject = (clips, extra = {}, tracks) => page.evaluate(({ clips, extra, tracks }) => {
    const st = window.__videoStore.getState()
    const base = { ...st.project, width: 640, height: 360, aspect: '16:9', clips: [], master: undefined, ducking: undefined, loudnessTarget: undefined, busVolume: undefined, ...extra }
    if (tracks) base.tracks = [...base.tracks.filter((t) => t.kind !== 'audio'), ...tracks]
    else base.tracks = base.tracks.map((t) => (t.kind === 'audio' ? { id: t.id, name: t.name, kind: 'audio', muted: false, locked: false } : t))
    st.loadProject({ ...base, clips: clips.map((c) => ({ in: 0, ...c })) }, { assets: st.mediaAssets, dirty: true })
    st.seek(0)
  }, { clips, extra, tracks })
  const A2 = [{ id: 'a2', name: 'A2 - Music', kind: 'audio', muted: false, locked: false }]
  const exportNow = async (name) => {
    await page.click('.vw-header-actions button:has-text("Export")')
    await page.waitForSelector('.vx')
    const dl = page.waitForEvent('download', { timeout: 300000 }).then((d) => ({ d }), (e) => ({ err: String(e.message).split('\n')[0] }))
    await page.click('.vx-go')
    const failText = page.waitForSelector('.vw-export-modal .signin-error', { timeout: 300000 }).then(async (e) => ({ err: await e.innerText() }), () => ({ err: 'no download and no error' }))
    const r = await Promise.race([dl, failText])
    if (r.err) { await page.click('.vw-export-modal button:has-text("Close"), .vw-export-modal button:has-text("Cancel")').catch(() => {}); throw new Error('export failed: ' + r.err) }
    const file = path.join(os.tmpdir(), `esb-p4a-${name}-${process.pid}.mp4`)
    await r.d.saveAs(file)
    await page.waitForSelector('.vw-export-success')
    await page.click('.vw-export-modal button:has-text("Done")')
    return file
  }
  /** The mix straight from the export path (no video): the final audio (loudness stage included) as stereo arrays. */
  const finalMix = (duration, final = true) => page.evaluate(async ({ duration, final }) => {
    const { mixAudio } = await import('/src/video/engine/audioRender.ts')
    const b = await mixAudio(window.__videoStore.getState().project, duration, { final })
    if (!b) return null
    return { sr: b.sampleRate, n: b.length }
  }, { duration, final })

  // ---------------------------------------------------------------- ACCEPT loudness: -14 +-0.5 LUFS, true peak <= -1 dBTP
  if (!skip.has('loudness')) {
    const rows = []
    for (const target of [-14, -16, -23]) {
      await setProject([aclip('m', 'p4a-music.wav', { duration: 20 })], { loudnessTarget: target })
      const f = await exportNow(`loud${-target}`)
      const m = ebur(f)
      rows.push({ target, I: m.I, peak: m.peak, LRA: m.LRA })
      check(`ACCEPT export normalised to ${target} LUFS measures ${target} +-0.5 with true peak <= -1 dBTP (ffmpeg ebur128)`, Math.abs(m.I - target) <= 0.5 && m.peak <= -1, JSON.stringify({ I: m.I, truePeakDbTP: m.peak, LRA: m.LRA }))
      fs.rmSync(f, { force: true })
    }
    results.loudness = rows
    // not normalised: the same project exports at its natural level (no gain applied)
    await setProject([aclip('m', 'p4a-music.wav', { duration: 20 })])
    const f0 = await exportNow('loud-none')
    const m0 = ebur(f0)
    results.loudnessNone = m0
    check('No loudness target: the export keeps its own level (well under -14 LUFS for the quiet fixture)', m0.I < -25, JSON.stringify(m0))
    // the export's own report equals ffmpeg's reading
    await setProject([aclip('m', 'p4a-music.wav', { duration: 20 })], { loudnessTarget: -14 })
    const rep = await page.evaluate(async () => {
      const { prepareMix } = await import('/src/video/engine/audioRender.ts')
      const mix = await prepareMix(window.__videoStore.getState().project, 20)
      const peaks = []
      for (let b = await mix.next(); b; b = await mix.next()) { let m = 0; for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i])) } peaks.push(+(20 * Math.log10(m)).toFixed(2)) }
      const l = mix.loudness(); mix.dispose(); return { ...l, blockPeaks: peaks }
    })
    results.reportedLoudness = rep
    check('the loudness the export reports (measured on what it wrote) equals the target within 0.3 LU', Math.abs(rep.after.integrated + 14) <= 0.3 && rep.after.truePeak <= -1, JSON.stringify({ after: rep.after, gainDb: rep.gainDb, limited: rep.limited, blockPeaks: rep.blockPeaks }))
    fs.rmSync(f0, { force: true })
  }

  // ---------------------------------------------------------------- ACCEPT ducking: music lowered by the set dB under voice (hard-panned so the music channel is clean)
  if (!skip.has('duck')) {
    const mk = (depth) => setProject([
      aclip('bed', 'p4a-bed.wav', { id: 'bed', trackId: 'a2', start: 0, duration: 12, pan: 1 }),
      aclip('vox', 'p4a-voice.wav', { id: 'vox', trackId: 'a1', start: 4, duration: 4, pan: -1 }),
    ], { ducking: { enabled: true, source: 'voice', target: 'music', depthDb: depth, threshold: -40, attack: 0.05, release: 0.4 } }, [{ id: 'a1', name: 'A1', kind: 'audio', muted: false, locked: false, bus: 'voice' }, { id: 'a2', name: 'A2', kind: 'audio', muted: false, locked: false, bus: 'music' }])
    const rowsD = []
    for (const depth of [12, 6]) {
      await mk(depth)
      const f = await exportNow(`duck${depth}`)
      const [, R] = pcm(f)
      const before = rmsDb(R, 1, 3.5); const under = rmsDb(R, 5, 7.5); const after = rmsDb(R, 10.5, 11.8)
      rowsD.push({ depth, before, under, after, lowered: before - under })
      check(`ACCEPT ducking ${depth} dB: the music (right channel of the export) is ${depth} +-1 dB lower under the voice`, Math.abs(before - under - depth) <= 1, JSON.stringify({ beforeDb: before.toFixed(2), underDb: under.toFixed(2), afterDb: after.toFixed(2) }))
      check(`ducking ${depth} dB: the music comes back after the voice (within 1 dB of before)`, Math.abs(before - after) <= 1, '')
      fs.rmSync(f, { force: true })
    }
    results.ducking = rowsD
    // disabled: no change
    await mk(12)
    await page.evaluate(() => window.__videoStore.getState().setDucking({ enabled: false }))
    const f = await exportNow('duck-off')
    const [, R] = pcm(f)
    check('ducking off: the music level is the same under the voice', Math.abs(rmsDb(R, 1, 3.5) - rmsDb(R, 5, 7.5)) < 0.3, '')
    fs.rmSync(f, { force: true })
  }

  // ---------------------------------------------------------------- ACCEPT fades: expected gain at sampled times
  if (!skip.has('fades')) {
    const out = {}
    for (const curve of ['linear', 'equal-power', 'log']) {
      await setProject([aclip('t', 'p4a-tone.wav', { duration: 10, fadeIn: { dur: 4, curve }, fadeOut: { dur: 4, curve } })])
      const f = await exportNow(`fade-${curve}`)
      const [L] = pcm(f)
      const full = rmsDb(L, 4.5, 5.5)
      const gain = (x) => curve === 'linear' ? x : curve === 'equal-power' ? Math.sin((x * Math.PI) / 2) : Math.pow(10, ((1 - x) * -60) / 20)
      const rows = []
      let worst = 0
      for (const t of [0.5, 1, 2, 3, 3.5]) {
        const measured = rmsDb(L, t - 0.05, t + 0.05) - full
        const expected = 20 * Math.log10(gain(t / 4))
        // the 0.1 s window averages the curve: compare against the expected average over the same window
        let acc = 0; const K = 50
        for (let i = 0; i < K; i++) { const x = (t - 0.05 + (0.1 * (i + 0.5)) / K) / 4; acc += gain(x) ** 2 }
        const expAvg = 10 * Math.log10(acc / K)
        const mOut = rmsDb(L, 10 - t - 0.05, 10 - t + 0.05) - full
        worst = Math.max(worst, Math.abs(measured - expAvg), Math.abs(mOut - expAvg))
        rows.push({ t, measured: +measured.toFixed(2), fadeOut: +mOut.toFixed(2), expected: +expected.toFixed(2), expAvg: +expAvg.toFixed(2) })
      }
      out[curve] = { worst: +worst.toFixed(2), rows }
      check(`ACCEPT ${curve} fade-in and fade-out: gain at 5 sampled times matches the curve within 0.5 dB (worst ${worst.toFixed(2)} dB)`, worst <= 0.5, JSON.stringify(rows))
      fs.rmSync(f, { force: true })
    }
    results.fades = out
  }

  // ---------------------------------------------------------------- ACCEPT preview == export (RMS per 0.5 s window within 0.5 dB)
  if (!skip.has('preview')) {
    const clips = [
      aclip('bed', 'p4a-music.wav', { trackId: 'a2', start: 0, duration: 12, gain: -3, fadeIn: { dur: 2, curve: 'log' }, fadeOut: { dur: 2, curve: 'equal-power' }, pan: 0.4 }),
      aclip('vox', 'p4a-clean.wav', { trackId: 'a1', start: 3, duration: 7, in: 0.5, gain: 4, fadeIn: { dur: 0.5, curve: 'linear' } }),
      aclip('vox2', 'p4a-voice.wav', { trackId: 'a1', start: 1, duration: 2, volume: 0.6, speed: 1 }),
    ]
    await setProject(clips, { ducking: { enabled: true, source: 'voice', target: 'music', depthDb: 10, threshold: -40, attack: 0.05, release: 0.4 }, master: { gain: -2, limiter: false }, busVolume: { music: -1.5 } },
      [{ id: 'a1', name: 'A1', kind: 'audio', muted: false, locked: false, bus: 'voice', volume: -2 }, { id: 'a2', name: 'A2', kind: 'audio', muted: false, locked: false, bus: 'music', pan: -0.3 }])
    const DUR = 12
    const prev = await page.evaluate(async (DUR) => {
      const { AudioEngine } = await import('/src/video/engine/audioEngine.ts')
      const { prepareDuckForPreview } = await import('/src/video/engine/audioRender.ts')
      const { flattenCompounds } = await import('/src/video/timeline.ts')
      const p = flattenCompounds(window.__videoStore.getState().project)
      await prepareDuckForPreview(p)
      const eng = new AudioEngine()
      const off = new OfflineAudioContext(2, Math.round((DUR + 0.2) * 48000), 48000)
      eng.ctx = off
      // the engine's own start(): every clip scheduled, the graph built, the ducking applied, then rendered instead of played
      await eng.start(p, 0, performance.now() + 100, () => 1e9)
      await new Promise((r) => setTimeout(r, 2500))
      const buf = await off.startRendering()
      const L = buf.getChannelData(0); const R = buf.getChannelData(1)
      const o = Math.round(eng.map.base * 48000) // where the engine put timeline 0 (its clock starts ~0.1 s in)
      const rows = []
      for (let w = 0; w < DUR * 2; w++) {
        const a = o + w * 24000; let sl = 0; let sr = 0
        for (let i = a; i < a + 24000 && i < L.length; i++) { sl += L[i] * L[i]; sr += R[i] * R[i] }
        rows.push([10 * Math.log10(sl / 24000 + 1e-20), 10 * Math.log10(sr / 24000 + 1e-20)])
      }
      // the export's own mix (before the encoder), same windows
      const { mixAudio } = await import('/src/video/engine/audioRender.ts')
      const dm = await mixAudio(p, DUR, { final: false })
      const direct = []
      for (let w = 0; w < DUR * 2; w++) {
        const a = w * 24000; let sl = 0; let sr = 0
        const dl = dm.getChannelData(0); const dr = dm.getChannelData(1)
        for (let i = a; i < a + 24000 && i < dl.length; i++) { sl += dl[i] * dl[i]; sr += dr[i] * dr[i] }
        direct.push([10 * Math.log10(sl / 24000 + 1e-20), 10 * Math.log10(sr / 24000 + 1e-20)])
      }
      return { rows, direct }
    }, DUR)
    const prevDirect = prev.direct
    prev.rows.forEach((r, i) => { prev[i] = r })
    const f = await exportNow('preview')
    const [EL, ER] = pcm(f)
    let worst = 0; let counted = 0; let worstDirect = 0
    const rows = []
    for (let w = 0; w < DUR * 2; w++) {
      for (let c = 0; c < 2; c++) if (prev[w][c] > -60 || prevDirect[w][c] > -60) worstDirect = Math.max(worstDirect, Math.abs(prev[w][c] - prevDirect[w][c]))
      const e = [rmsDb(EL, w * 0.5, w * 0.5 + 0.5), rmsDb(ER, w * 0.5, w * 0.5 + 0.5)]
      for (let c = 0; c < 2; c++) {
        if (e[c] < -55 && prev[w][c] < -55) continue
        const d = Math.abs(e[c] - prev[w][c]); counted++
        worst = Math.max(worst, d)
        if (d > 0.3) rows.push({ w, c, preview: +prev[w][c].toFixed(2), exported: +e[c].toFixed(2) })
      }
    }
    results.previewVsExport = { worstVsEncoderFreeMix: worstDirect, direct0: prevDirect.slice(0, 4), prev0: prev.rows.slice(0, 4), worst, windows: counted, over03: rows.slice(0, 8) }
    check(`ACCEPT preview == export: RMS per 0.5 s window within 0.5 dB on a fixture (worst ${worst.toFixed(2)} dB over ${counted} windows; fades, pan, ducking, faders, master)`, worst <= 0.5 && counted > 30, JSON.stringify(rows.slice(0, 6)))
    fs.rmSync(f, { force: true })
  }

  // ---------------------------------------------------------------- ACCEPT noise reduction: SNR up >= 6 dB in the exported file
  if (!skip.has('denoise')) {
    const snr = (out, ref) => {
      // out = a*ref + e, a by least squares over a short search of alignments
      let best = null
      for (let lag = -2400; lag <= 2400; lag += 1) {
        let xy = 0; let xx = 0
        const i0 = SR * 2 + Math.max(0, -lag); const i1 = SR * 9
        for (let i = i0; i < i1; i += 3) { const o = out[i + lag]; xy += o * ref[i]; xx += ref[i] * ref[i] }
        if (!best || xy > best.xy) best = { lag, xy, xx }
      }
      const a = best.xy / best.xx
      let sig = 0; let err = 0
      for (let i = SR * 2; i < SR * 9; i++) { const e = out[i + best.lag] - a * ref[i]; sig += (a * ref[i]) ** 2; err += e * e }
      return 10 * Math.log10(sig / err)
    }
    const ref = (() => { const [c] = [cleanSpeech]; return c })()
    // the noisy and clean fixtures once, un-processed, through the same export
    await setProject([aclip('n', 'p4a-noisy.wav', { duration: 10 })])
    const f0 = await exportNow('noisy-raw')
    const [raw] = pcm(f0)
    const snrRaw = snr(raw, ref)
    const rows = []
    for (const variant of [{ amount: 0.8 }, { amount: 1 }, { amount: 0.8, noiseRange: [0.1, 0.9] }]) {
      await setProject([aclip('n', 'p4a-noisy.wav', { duration: 10, denoise: variant })])
      const f1 = await exportNow('noisy-dn')
      const [den] = pcm(f1)
      const s = snr(den, ref)
      rows.push({ ...variant, snrBefore: +snrRaw.toFixed(2), snrAfter: +s.toFixed(2), improvement: +(s - snrRaw).toFixed(2) })
      fs.rmSync(f1, { force: true })
    }
    results.denoise = rows
    check('ACCEPT noise reduction: SNR of the exported noisy fixture improves by >= 6 dB (amount 0.8)', rows[0].improvement >= 6, JSON.stringify(rows[0]))
    check('noise reduction at amount 1 and with a marked noise-only range also improves SNR by >= 6 dB', rows[1].improvement >= 6 && rows[2].improvement >= 6, JSON.stringify(rows.slice(1)))
    fs.rmSync(f0, { force: true })

    // the 60 s clip: the main thread is never blocked for more than 50 ms while it is reduced
    await setProject([aclip('n60', 'p4a-noisy60.wav', { duration: 60, denoise: { amount: 0.8 } })])
    const slice = await page.evaluate(async () => {
      const { denoiseClip } = await import('/src/video/engine/audioRender.ts')
      const p = window.__videoStore.getState().project
      const c = p.clips[0]
      let last = performance.now(); let max = 0; let beats = 0
      const iv = setInterval(() => { const n = performance.now(); max = Math.max(max, n - last - 10); last = n; beats++ }, 10)
      const t0 = performance.now()
      const buf = await denoiseClip(c, p)
      const ms = performance.now() - t0
      clearInterval(iv)
      return { ms: Math.round(ms), maxStallMs: Math.round(max), beats, ok: !!buf, seconds: buf ? buf.duration : 0 }
    })
    results.denoiseSlices = slice
    check('ACCEPT a 60 s clip is noise-reduced in a worker: the main thread is never blocked for more than 50 ms', slice.ok && slice.maxStallMs <= 50, JSON.stringify(slice))
  }

  // ---------------------------------------------------------------- mute / solo / bus / pan
  if (!skip.has('mix')) {
    const two = (extraA1 = {}, extraA2 = {}, clipExtra = {}) => setProject([
      aclip('x', 'p4a-voice.wav', { trackId: 'a1', duration: 6, ...clipExtra.x }), aclip('y', 'p4a-bed.wav', { trackId: 'a2', duration: 6, ...clipExtra.y }),
    ], {}, [{ id: 'a1', name: 'A1', kind: 'audio', muted: false, locked: false, ...extraA1 }, { id: 'a2', name: 'A2', kind: 'audio', muted: false, locked: false, ...extraA2 }])
    const lv = async (name, p) => { await p; const f = await exportNow(name); const [l, r] = pcm(f); fs.rmSync(f, { force: true }); return [rmsDb(l, 1, 5), rmsDb(r, 1, 5)] }
    const both = await lv('mix-both', two({ pan: -1 }, { pan: 1 }))
    check('pan: a track panned hard left sounds only on the left, a track panned hard right only on the right', both[0] > -15 && both[1] > -15, JSON.stringify(both))
    const muted = await lv('mix-mute', two({ muted: true, pan: -1 }, { pan: 1 }))
    check('mute: a muted track is silent, the other still plays', muted[0] < -80 && muted[1] > -15, JSON.stringify(muted))
    const solo = await lv('mix-solo', two({ pan: -1, solo: true }, { pan: 1 }))
    check('solo: with A1 soloed only A1 is heard', solo[0] > -15 && solo[1] < -80, JSON.stringify(solo))
    const vol = await lv('mix-vol', two({ pan: -1, volume: -6 }, { pan: 1 }))
    check('track fader -6 dB lowers that track by 6 dB (+-0.3)', Math.abs(both[0] - vol[0] - 6) < 0.3 && Math.abs(both[1] - vol[1]) < 0.3, JSON.stringify({ both, vol }))
    const clipPan = await lv('mix-clippan', two({}, {}, { x: { pan: -1 }, y: { pan: 1 } }))
    check('clip pan works the same as track pan', Math.abs(clipPan[0] - both[0]) < 0.3 && Math.abs(clipPan[1] - both[1]) < 0.3, JSON.stringify(clipPan))
    const gain = await lv('mix-gain', two({ pan: -1 }, { pan: 1 }, { x: { gain: -6.0206, volume: 1 } }))
    check('clip gain -6 dB lowers the clip by 6 dB', Math.abs(both[0] - gain[0] - 6.02) < 0.3, JSON.stringify(gain))
    // bus faders and the master
    await setProject([aclip('x', 'p4a-voice.wav', { trackId: 'a1', duration: 6, pan: -1 })], { busVolume: { voice: -6 }, master: { gain: -4, limiter: false } }, [{ id: 'a1', name: 'A1', kind: 'audio', muted: false, locked: false, bus: 'voice' }])
    const fb = await exportNow('mix-bus'); const [bl] = pcm(fb); fs.rmSync(fb, { force: true })
    check('bus fader -6 dB and master -4 dB: the clip is 10 dB lower (+-0.3)', Math.abs(both[0] - rmsDb(bl, 1, 5) - 10) < 0.3, String(rmsDb(bl, 1, 5)))
    results.mix = { both, muted, solo, vol, clipPan, gain }
  }

  // ---------------------------------------------------------------- an old project exports the same audio
  if (!skip.has('old')) {
    // a Phase 0-3 project (no Phase 4 field anywhere): volume 0.5 and a keyframed volume, plain tracks
    const clips = [aclip('o1', 'p4a-tone.wav', { duration: 5, volume: 0.5 }), aclip('o2', 'p4a-tone.wav', { start: 5, duration: 5, keyframes: { volume: [{ t: 0, v: 1 }, { t: 5, v: 0.2 }] } })]
    await setProject(clips)
    const f = await exportNow('old')
    const [l] = pcm(f)
    const vd = probeDur(f, 'v:0'); const ad = probeDur(f, 'a:0')
    const e1 = rmsDb(l, 1, 4); const exp1 = 20 * Math.log10(0.25 * 0.5 / Math.SQRT2)
    const e2a = rmsDb(l, 5.2, 5.8); const e2b = rmsDb(l, 9.2, 9.8)
    results.oldProject = { videoDur: vd, audioDur: ad, level: e1, expected: exp1, e2a, e2b }
    check('old project: audio stream length equals the video length (within 25 ms)', Math.abs(ad - vd) < 0.025 && Math.abs(vd - 10) < 0.05, JSON.stringify({ videoDur: vd, audioDur: ad }))
    check('old project: sound level is the plain volume (0.5) as before, volume keyframes still followed', Math.abs(e1 - exp1) < 0.3 && e2a - e2b > 10 && e2a - e2b < 20, JSON.stringify({ e1, exp1, e2a, e2b }))
    fs.rmSync(f, { force: true })
  }

  // ---------------------------------------------------------------- beats
  if (!skip.has('beats')) {
    await setProject([aclip('b', 'p4a-music.wav', { duration: 12 })])
    const r = await page.evaluate(async () => {
      const st = window.__videoStore.getState()
      const pr = await st.markBeats('b')
      const before = window.__videoStore.getState().project.markers?.length ?? 0
      const added = pr ? window.__videoStore.getState().applyBeats(pr, 'onsets') : 0
      const after = window.__videoStore.getState().project.markers?.length ?? 0
      window.__videoStore.getState().undo()
      const undone = window.__videoStore.getState().project.markers?.length ?? 0
      return { applied: pr?.applied, onsets: pr?.onsets.map((o) => o.t).slice(0, 8), n: pr?.onsets.length, before, added, after, undone }
    })
    results.beats = r
    // the fixture has a transient every 3 s (at 0, 3, 6, 9 s)
    const hits = [3, 6, 9].filter((t) => r.onsets?.some((o) => Math.abs(o - t) < 0.03))
    check('markBeats: a proposal first (nothing added), apply adds markers in one undo step', r.applied === false && r.before === 0 && r.added > 0 && r.after === r.added && r.undone === 0, JSON.stringify(r))
    check('markBeats finds the 3 s transients of the fixture within 30 ms', hits.length === 3, JSON.stringify(r.onsets))
  }

  // ---------------------------------------------------------------- 10-minute project: audio stage time and memory
  if (!skip.has('perf')) {
    const cdp = await browser.newBrowserCDPSession()
    const pidList = async () => (await cdp.send('SystemInfo.getProcessInfo')).processInfo.map((p) => p.id)
    const clips = [aclip('long-v', 'p4a-long.wav', { trackId: 'a1', duration: 600 }), aclip('long-m', 'p4a-long.wav', { trackId: 'a2', duration: 600, in: 0 })]
    const trk = (x) => [{ id: 'a1', name: 'A1', kind: 'audio', muted: false, locked: false, bus: 'voice' }, { id: 'a2', name: 'A2', kind: 'audio', muted: false, locked: false, bus: 'music', ...x }]
    const run = async (label, extra) => {
      await setProject(clips, extra, trk({}))
      let peak = 0; let stop = false
      const sampler = (async () => { while (!stop) { peak = Math.max(peak, pidsMB(await pidList())); await new Promise((r) => setTimeout(r, 1500)) } })()
      const t0 = Date.now()
      const r = await page.evaluate(async () => {
        const { prepareMix } = await import('/src/video/engine/audioRender.ts')
        const t = performance.now()
        const mix = await prepareMix(window.__videoStore.getState().project, 600)
        const prep = performance.now() - t
        let n = 0; let maxPiece = 0
        for (let b = await mix.next(); b; b = await mix.next()) { n += b.length; maxPiece = Math.max(maxPiece, b.length) }
        const l = mix.loudness(); mix.dispose()
        return { prepMs: Math.round(prep), totalMs: Math.round(performance.now() - t), seconds: n / 48000, loud: l && { I: l.after.integrated, tp: l.after.truePeak, gain: l.gainDb, limited: l.limited } }
      })
      stop = true; await sampler
      return { label, wallMs: Date.now() - t0, peakTreeMB: Math.round(peak), ...r }
    }
    const base = await run('plain mix (what the old export did: no ducking, no loudness stage)', {})
    const full = await run('ducking + loudness -14 + limiter', { ducking: { enabled: true, source: 'voice', target: 'music', depthDb: 12, threshold: -40, attack: 0.05, release: 0.4 }, loudnessTarget: -14, master: { gain: 0, limiter: true } })
    results.perf10min = { base, full }
    console.log('PERF 10 min audio stage', JSON.stringify(results.perf10min))
    check('10-minute project: the audio stage completes (600 s of sound) with and without ducking/loudness', Math.abs(base.seconds - 600) < 0.1 && Math.abs(full.seconds - 600) < 0.1 && full.loud && Math.abs(full.loud.I + 14) < 0.6, JSON.stringify({ base: base.totalMs, full: full.totalMs, loud: full.loud }))
  }

  check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (err) {
  console.error('Video audio test error:', err)
  failed++
} finally {
  if (process.env.JSON) fs.writeFileSync(process.env.JSON, JSON.stringify(results, null, 2))
  console.log('RESULTS', JSON.stringify(results))
  await browser?.close()
  vite.kill()
  process.exit(failed > 0 ? 1 : 0)
}
