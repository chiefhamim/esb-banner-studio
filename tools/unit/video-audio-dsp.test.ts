// Phase 4 pre-build: ducking, fades/crossfades, the built-in denoiser, onset/beat detection, RMS summaries.
import { describe, expect, it } from 'vitest'
import { applyGainCurve, curveAt, curveToVolumeKeyframes, duckingCurve } from '../../src/video/audio/ducking'
import { applyFades, clipFadeGain, crossfade, crossfadeGains, fadeGain } from '../../src/video/audio/fades'
import { denoise } from '../../src/video/audio/denoise'
import { detectOnsets, estimateTempo } from '../../src/video/audio/onsets'
import { rmsOver, rmsSummary } from '../../src/video/audio/summary'
import { FFT } from '../../src/video/audio/fft'
import { simplify, valueAt } from '../../src/video/audio/curve'
import { db, noise, rms, sine } from './audio-fixtures'

const SR = 48000

describe('FFT', () => {
  it('round-trips and finds a bin-centred tone', () => {
    const f = new FFT(256)
    const re = new Float64Array(256)
    const im = new Float64Array(256)
    for (let i = 0; i < 256; i++) re[i] = Math.cos((2 * Math.PI * 8 * i) / 256)
    const orig = re.slice()
    f.transform(re, im)
    expect(Math.hypot(re[8], im[8])).toBeCloseTo(128, 6)
    expect(Math.hypot(re[9], im[9])).toBeLessThan(1e-9)
    f.transform(re, im, true)
    for (let i = 0; i < 256; i++) expect(re[i]).toBeCloseTo(orig[i], 9)
  })
})

describe('ducking', () => {
  // music: a steady tone; voice: noise bursts at 2–4 s and 6–8 s (−20 dBFS RMS)
  const n = SR * 10
  const music = sine(n, SR, 330, 0.3)
  const voice = new Float32Array(n)
  const burst = noise(n, 0.1, 5)
  for (let i = 0; i < n; i++) { const t = i / SR; if ((t >= 2 && t < 4) || (t >= 6 && t < 8)) voice[i] = burst[i] }

  for (const depth of [6, 12, 18]) {
    it(`lowers the music by the set ${depth} dB under the voice and leaves it alone elsewhere (RMS)`, () => {
      const c = duckingCurve([voice], SR, { depth, threshold: -40 })
      const [ducked] = applyGainCurve([music], SR, c)
      const under = db(rms(ducked, Math.round(2.6 * SR), Math.round(3.8 * SR)) / rms(music, Math.round(2.6 * SR), Math.round(3.8 * SR)))
      expect(Math.abs(under + depth)).toBeLessThan(0.5)
      const before = db(rms(ducked, 0, Math.round(1.5 * SR)) / rms(music, 0, Math.round(1.5 * SR)))
      expect(Math.abs(before)).toBeLessThan(0.05)
      const after = db(rms(ducked, Math.round(9.5 * SR), n) / rms(music, Math.round(9.5 * SR), n))
      expect(Math.abs(after)).toBeLessThan(0.5) // back up within half a dB 1.5 s after the voice
    })
  }

  it('attacks quickly, holds across a short gap and releases slowly', () => {
    const c = duckingCurve([voice], SR, { depth: 12, attack: 0.05, release: 0.4, hold: 0.25 })
    expect(curveAt(c, 2.3)).toBeLessThan(-10) // ~6 attack time constants in
    expect(curveAt(c, 4.2)).toBeLessThan(-11) // still held 0.2 s after the voice stopped
    expect(curveAt(c, 4.6)).toBeGreaterThan(-11) // releasing
    expect(curveAt(c, 5.9)).toBeGreaterThan(-0.5)
  })

  it('becomes a short list of volume keyframes', () => {
    const c = duckingCurve([voice], SR, { depth: 12 })
    const kf = curveToVolumeKeyframes(c, { tolDb: 0.5 })
    expect(kf.length).toBeLessThan(80)
    expect(kf[0]).toMatchObject({ t: 0, v: 1, ease: 'linear' })
    expect(valueAt(kf, 3)).toBeCloseTo(Math.pow(10, -12 / 20), 1)
  })

  it('a quiet voice below the threshold leaves the music unchanged', () => {
    const c = duckingCurve([noise(SR * 2, 0.001, 2)], SR, { threshold: -40 })
    expect(Math.min(...c.gainDb)).toBeGreaterThan(-0.01)
  })
})

describe('fades', () => {
  it('curves hit their landmarks', () => {
    expect(fadeGain('linear', 0.5)).toBeCloseTo(0.5)
    expect(20 * Math.log10(fadeGain('equal-power', 0.5))).toBeCloseTo(-3.01, 1)
    expect(20 * Math.log10(fadeGain('log', 0.5))).toBeCloseTo(-30, 5)
    for (const c of ['linear', 'equal-power', 'log'] as const) { expect(fadeGain(c, 0)).toBe(0); expect(fadeGain(c, 1)).toBe(1) }
  })

  it('an equal-power crossfade keeps constant power; linear keeps constant amplitude', () => {
    for (let x = 0; x <= 1; x += 0.1) {
      const g = crossfadeGains('equal-power', x)
      expect(g.out ** 2 + g.in ** 2).toBeCloseTo(1, 9)
      const l = crossfadeGains('linear', x)
      expect(l.out + l.in).toBeCloseTo(1, 9)
    }
  })

  it('clip fades shape the head and tail only', () => {
    const spec = { fadeIn: 1, fadeOut: 2, curve: 'linear' as const }
    expect(clipFadeGain(spec, 0, 10)).toBe(0)
    expect(clipFadeGain(spec, 0.5, 10)).toBeCloseTo(0.5)
    expect(clipFadeGain(spec, 5, 10)).toBe(1)
    expect(clipFadeGain(spec, 9, 10)).toBeCloseTo(0.5)
    const [o] = applyFades([new Float32Array(SR * 4).fill(1)], SR, spec)
    expect(o[0]).toBe(0)
    expect(o[SR * 2]).toBe(1)
    expect(o[SR * 3]).toBeCloseTo(0.5, 3)
  })

  it('crossfade joins two signals with the right length and no dip for correlated sound', () => {
    const a = new Float32Array(SR).fill(0.5)
    const b = new Float32Array(SR).fill(0.5)
    const [o] = crossfade([a], [b], SR, 0.25, 'linear')
    expect(o.length).toBe(SR * 2 - SR / 4)
    for (let i = 0; i < o.length; i += 1000) expect(o[i]).toBeCloseTo(0.5, 5)
  })
})

describe('built-in noise reduction', () => {
  // speech-like: a harmonic voice (120 Hz with 12 harmonics, syllable-rate AM) talking 60 % of the time
  function voiceLike(n: number) {
    const x = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const t = i / SR
      const on = Math.sin(2 * Math.PI * 0.35 * t) > -0.3 ? 1 : 0
      const am = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * t) ** 2
      let s = 0
      const f0 = 120 * (1 + 0.05 * Math.sin(2 * Math.PI * 0.5 * t))
      for (let h = 1; h <= 12; h++) s += Math.sin(2 * Math.PI * f0 * h * t + h) / h
      x[i] = 0.15 * on * am * s
    }
    return x
  }
  const snr = (clean: Float32Array, x: Float32Array) => {
    let s = 0
    let e = 0
    for (let i = 0; i < clean.length; i++) { s += clean[i] ** 2; e += (x[i] - clean[i]) ** 2 }
    return 10 * Math.log10(s / e)
  }

  it('improves the SNR of a noisy speech-like fixture by at least 6 dB (white noise, 5 dB SNR)', () => {
    const n = SR * 8
    const clean = voiceLike(n)
    const ns = noise(n, rms(clean) / Math.pow(10, 5 / 20), 9)
    const noisy = new Float32Array(n)
    for (let i = 0; i < n; i++) noisy[i] = clean[i] + ns[i]
    const [out] = denoise([noisy], SR)
    const gain = snr(clean, out) - snr(clean, noisy)
    console.log(`[denoise] white @5 dB: ${snr(clean, noisy).toFixed(2)} → ${snr(clean, out).toFixed(2)} dB (+${gain.toFixed(2)})`)
    expect(gain).toBeGreaterThanOrEqual(6)
  })

  it('also helps with a marked noise-only range and with pink-ish noise', () => {
    const n = SR * 8
    const clean = voiceLike(n)
    for (let i = 0; i < SR; i++) clean[i] = 0 // first second: noise only
    const w = noise(n, 1, 4)
    const pink = new Float32Array(n)
    let y = 0
    for (let i = 0; i < n; i++) { y = 0.9 * y + w[i]; pink[i] = y }
    const k = rms(clean) / Math.pow(10, 5 / 20) / rms(pink)
    for (let i = 0; i < n; i++) pink[i] *= k
    const noisy = new Float32Array(n)
    for (let i = 0; i < n; i++) noisy[i] = clean[i] + pink[i]
    const [out] = denoise([noisy], SR, { noiseRange: [0, 1] })
    const gain = snr(clean, out) - snr(clean, noisy)
    console.log(`[denoise] coloured noise @5 dB, marked range: ${snr(clean, noisy).toFixed(2)} → ${snr(clean, out).toFixed(2)} dB (+${gain.toFixed(2)})`)
    expect(gain).toBeGreaterThanOrEqual(6)
  })

  it('leaves a clean signal nearly unchanged (perfect reconstruction when nothing is noise)', () => {
    const x = sine(SR * 2, SR, 440, 0.5)
    const [out] = denoise([x], SR, { noiseRange: [5, 6] /* outside: falls back to quiet frames of the tone itself */, reduction: 0 })
    let e = 0
    for (let i = 0; i < x.length; i++) e += (out[i] - x[i]) ** 2
    expect(Math.sqrt(e / x.length)).toBeLessThan(1e-6)
  })

  it('keeps the length and every channel', () => {
    const out = denoise([noise(12345, 0.1, 1), noise(12345, 0.1, 2)], SR)
    expect(out.length).toBe(2)
    expect(out[0].length).toBe(12345)
  })
})

describe('onsets and tempo', () => {
  function clicks(bpm: number, seconds: number, start = 0.5) {
    const n = SR * seconds
    const x = new Float32Array(n)
    const times: number[] = []
    const period = 60 / bpm
    for (let t = start; t < seconds - 0.1; t += period) {
      times.push(t)
      const i0 = Math.round(t * SR)
      for (let i = 0; i < 1200 && i0 + i < n; i++) x[i0 + i] += 0.6 * Math.exp(-i / 150) * Math.sin((2 * Math.PI * 2000 * i) / SR)
    }
    return { x, times }
  }

  it('finds every click within 5 ms and no extra ones', () => {
    const { x, times } = clicks(120, 10)
    const r = detectOnsets([x], SR)
    expect(r.onsets.length).toBe(times.length)
    r.onsets.forEach((o, i) => expect(Math.abs(o.t - times[i])).toBeLessThan(0.005))
  })

  for (const bpm of [90, 120, 128, 150]) {
    it(`estimates ${bpm} BPM within 1 BPM and lays a beat grid on the clicks`, () => {
      const { x, times } = clicks(bpm, 12)
      const r = detectOnsets([x], SR)
      expect(r.tempo).not.toBeNull()
      expect(Math.abs(r.tempo!.bpm - bpm)).toBeLessThan(1)
      // every click has a beat within 20 ms
      for (const t of times.slice(0, -1)) expect(Math.min(...r.beats.map((b) => Math.abs(b - t)))).toBeLessThan(0.02)
    })
  }

  it('silence has no onsets and no tempo', () => {
    const r = detectOnsets([new Float32Array(SR * 3)], SR)
    expect(r.onsets).toEqual([])
    expect(estimateTempo(r.flux, r.hopSec)).toBeNull()
  })
})

describe('RMS summary (alongside the engine peaks)', () => {
  it('uses the peaks ladder of rates and reads a span back in dBFS', () => {
    const x = new Float32Array(SR * 4)
    x.set(sine(SR * 2, SR, 1000, 0.5), SR * 2)
    const s = rmsSummary([x], SR)
    expect(s.rates).toEqual([200, 50, 12.5, 3.125])
    expect(s.levels[0].length).toBe(800)
    expect(s.levels[1].length).toBe(200)
    expect(rmsOver(s, 0, 1.9)).toBe(-Infinity)
    expect(rmsOver(s, 2.2, 3.8)).toBeCloseTo(20 * Math.log10(0.5 / Math.SQRT2), 1)
    expect(s.levels[3][s.levels[3].length - 1]).toBeCloseTo(0.5 / Math.SQRT2, 2)
  })
})

describe('curve helpers', () => {
  it('simplify keeps corners within tolerance', () => {
    const pts = Array.from({ length: 101 }, (_, i) => ({ t: i / 100, v: i < 50 ? 0 : 1 }))
    const s = simplify(pts, 0.01)
    expect(s.length).toBeLessThanOrEqual(5)
    for (const p of pts) expect(Math.abs(valueAt(s.map((q) => ({ ...q })), p.t) - p.v)).toBeLessThanOrEqual(0.5 + 1e-9)
  })
})
