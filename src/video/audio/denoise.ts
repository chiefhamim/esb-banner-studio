// Built-in noise reduction: STFT (Hann, 75 % overlap, weighted overlap-add) with a decision-directed Wiener gain
// (Ephraim–Malah style a-priori SNR) over a noise spectrum that is either measured from a range the editor marks as
// "noise only" or estimated from the quietest frames of the clip. A gain floor keeps the residual noise natural
// instead of "musical". Pure TS; this is the fallback — an RNNoise WASM engine can be offered later behind the same
// `denoise()` shape (see docs/VIDEO_PRO_PROGRESS.md, Phase 4/5 pre-build).

import { FFT, hann } from './fft'

export interface DenoiseOptions {
  /** FFT size (power of two). Default 2048 (~43 ms at 48 kHz) at 32 kHz and up, else 1024. */
  fftSize?: number
  /** Most the noise is lowered, dB (the gain floor). Default 18. */
  reduction?: number
  /** Noise over-estimate factor (1 = as measured; higher removes more and colours speech more). Default 1. */
  strength?: number
  /** Decision-directed smoothing (0..1). Default 0.9 (tuned on the test fixtures: less musical noise than 0.98 at
   *  the same SNR gain). */
  smoothing?: number
  /** A noise-only stretch, seconds [start, end): the noise spectrum is measured there. Otherwise estimated. */
  noiseRange?: [number, number]
  /** Fraction of the quietest frames that the automatic estimate averages. Default 0.1. */
  quietFraction?: number
}

/** Mean noise power per bin. */
export type NoiseProfile = Float64Array

function frames(len: number, size: number, hop: number) { return Math.ceil((len + size) / hop) }

/** Frame f of a channel windowed into (r, m) and transformed; frame f covers samples [f·hop − size, f·hop). */
function frameSpectrum(x: Float32Array, f: number, size: number, hop: number, win: Float64Array, fft: FFT, r: Float64Array, m: Float64Array) {
  const o = f * hop - size
  for (let i = 0; i < size; i++) { const j = o + i; r[i] = j >= 0 && j < x.length ? x[j] * win[i] : 0; m[i] = 0 }
  fft.transform(r, m)
}

/** Noise spectrum of a channel (mean power per bin): the frames inside `noiseRange`, else the quietest
 * `quietFraction` of the frames that hold any sound. Two light passes, so a long clip never holds every spectrum. */
export function estimateNoise(x: Float32Array, sampleRate: number, opts: Pick<DenoiseOptions, 'fftSize' | 'noiseRange' | 'quietFraction'> = {}): NoiseProfile {
  const size = opts.fftSize ?? (sampleRate >= 32000 ? 2048 : 1024)
  const hop = size / 4
  const win = hann(size)
  const fft = new FFT(size)
  const bins = size / 2 + 1
  const nf = frames(x.length, size, hop)
  let chosen: number[] = []
  if (opts.noiseRange) {
    const [a, b] = opts.noiseRange
    for (let f = 0; f < nf; f++) {
      const t0 = (f * hop - size) / sampleRate
      if (t0 >= a && t0 + size / sampleRate <= b) chosen.push(f)
    }
  }
  if (!chosen.length) {
    // frame energy straight from the samples (Parseval: proportional to the spectrum's), whole frames only
    const energy: { f: number; e: number }[] = []
    for (let f = Math.ceil(size / hop); f < nf; f++) {
      const o = f * hop - size
      if (o + size > x.length) break
      let e = 0
      for (let i = 0; i < size; i++) { const v = x[o + i] * win[i]; e += v * v }
      if (e > 0) energy.push({ f, e })
    }
    energy.sort((p, q) => p.e - q.e)
    const k = Math.max(Math.min(5, energy.length), Math.round(energy.length * (opts.quietFraction ?? 0.1)))
    chosen = energy.slice(0, k).map((v) => v.f)
  }
  const out = new Float64Array(bins)
  const r = new Float64Array(size)
  const m = new Float64Array(size)
  for (const f of chosen) {
    frameSpectrum(x, f, size, hop, win, fft, r, m)
    for (let k = 0; k < bins; k++) out[k] += r[k] * r[k] + m[k] * m[k]
  }
  for (let k = 0; k < bins; k++) out[k] /= Math.max(1, chosen.length)
  return out
}

/** Reduce stationary background noise (hiss, hum floor, room tone, fan). Returns new arrays of the same length. */
export function denoise(channels: Float32Array[], sampleRate: number, opts: DenoiseOptions = {}): Float32Array[] {
  const size = opts.fftSize ?? (sampleRate >= 32000 ? 2048 : 1024)
  const hop = size / 4
  const win = hann(size)
  const fft = new FFT(size)
  const floor = Math.pow(10, -(opts.reduction ?? 18) / 20)
  const over = opts.strength ?? 1
  const alpha = opts.smoothing ?? 0.9
  const bins = size / 2 + 1
  // Hann analysis × Hann synthesis at 75 % overlap sums to 1.5
  const norm = 1 / 1.5
  return channels.map((x) => {
    const N = estimateNoise(x, sampleRate, { ...opts, fftSize: size })
    const nf = frames(x.length, size, hop)
    // Overlap-add through a ring of one window (not a buffer the length of the signal): after frame f, the `hop` samples at
    // its start can no longer change, so they are written to the output and the ring slides on. Memory stays at the input
    // and the output (Float32), however long the clip is.
    const y = new Float32Array(x.length)
    const acc = new Float64Array(size)
    let written = -size // signal index of acc[0] (the stream starts one window before the signal)
    const prevG = new Float64Array(bins).fill(1)
    const prevGamma = new Float64Array(bins).fill(1)
    const r = new Float64Array(size)
    const m = new Float64Array(size)
    const G = new Float64Array(bins)
    for (let f = 0; f < nf; f++) {
      frameSpectrum(x, f, size, hop, win, fft, r, m)
      for (let k = 0; k < bins; k++) {
        const nk = N[k] * over
        if (nk <= 0) { G[k] = 1; continue }
        const gamma = Math.min(1e6, (r[k] * r[k] + m[k] * m[k]) / nk)
        const xi = alpha * prevG[k] * prevG[k] * prevGamma[k] + (1 - alpha) * Math.max(gamma - 1, 0)
        G[k] = Math.max(floor, xi / (1 + xi))
        prevGamma[k] = gamma
      }
      // light smoothing across neighbouring bins tames isolated "musical" tones
      for (let k = 0; k < bins; k++) {
        const g = 0.25 * G[Math.max(0, k - 1)] + 0.5 * G[k] + 0.25 * G[Math.min(bins - 1, k + 1)]
        prevG[k] = G[k]
        r[k] *= g
        m[k] *= g
        if (k > 0 && k < size / 2) { r[size - k] *= g; m[size - k] *= g }
      }
      fft.transform(r, m, true)
      // this frame starts at signal index f·hop − size (== `written` here)
      for (let i = 0; i < size; i++) acc[i] += r[i] * win[i] * norm
      for (let i = 0; i < hop; i++) { const j = written + i; if (j >= 0 && j < x.length) y[j] = acc[i] }
      acc.copyWithin(0, hop)
      acc.fill(0, size - hop)
      written += hop
    }
    return y
  })
}
