// Beat and onset detection for music markers: spectral flux (half-wave rectified rise of log-compressed magnitude)
// with an adaptive median threshold and peak picking, each onset refined to ~1 ms in the time domain; a tempo
// estimate from the flux autocorrelation (60–200 BPM, mild preference for ~120 to settle octave errors) and a beat
// grid phased to the strongest onsets. Markers are suggestions; the editor keeps or drops them.

import { FFT, downmix, hann } from './fft'

export interface Onset { t: number; strength: number }
export interface TempoEstimate { bpm: number; confidence: number }
export interface OnsetResult {
  onsets: Onset[]
  /** Flux envelope (one value per hop), for drawing and for the tempo. */
  flux: Float32Array
  /** Seconds per flux value. */
  hopSec: number
  tempo: TempoEstimate | null
  /** Beat times (seconds) on the estimated tempo, phased to the onsets. */
  beats: number[]
}

export interface OnsetOptions {
  /** FFT size. Default 1024 (≥ 32 kHz) or 512. */
  fftSize?: number
  /** Hop, seconds. Default 0.01. */
  hop?: number
  /** Threshold = median(±window) · multiplier + delta (delta as a fraction of the flux maximum). */
  multiplier?: number
  delta?: number
  /** Median window half-width, seconds. Default 0.1. */
  window?: number
  /** Shortest gap between onsets, seconds. Default 0.06. */
  minGap?: number
  /** Tempo search range, BPM. Default 60–200. */
  minBpm?: number
  maxBpm?: number
}

export function spectralFlux(x: Float32Array, sampleRate: number, opts: Pick<OnsetOptions, 'fftSize' | 'hop'> = {}): { flux: Float32Array; hop: number; size: number } {
  const size = opts.fftSize ?? (sampleRate >= 32000 ? 1024 : 512)
  const hop = Math.max(1, Math.round((opts.hop ?? 0.01) * sampleRate))
  const fft = new FFT(size)
  const win = hann(size)
  const bins = size / 2 + 1
  // frame f is centred on sample f·hop
  const nf = Math.ceil(x.length / hop) + 1
  const flux = new Float32Array(nf)
  let prev = new Float64Array(bins)
  let cur = new Float64Array(bins)
  const re = new Float64Array(size)
  const im = new Float64Array(size)
  for (let f = 0; f < nf; f++) {
    const o = f * hop - size / 2
    for (let i = 0; i < size; i++) { const j = o + i; re[i] = j >= 0 && j < x.length ? x[j] * win[i] : 0; im[i] = 0 }
    fft.transform(re, im)
    let s = 0
    for (let k = 0; k < bins; k++) {
      cur[k] = Math.log1p(100 * Math.hypot(re[k], im[k]))
      const d = cur[k] - prev[k]
      if (d > 0 && f > 0) s += d
    }
    flux[f] = s
    const t = prev; prev = cur; cur = t
  }
  return { flux, hop, size }
}

/** Refine an onset to the 1 ms block where the energy jumps most, within ±`span` samples of `c`. */
function refine(x: Float32Array, c: number, span: number, sampleRate: number): number {
  const blk = Math.max(1, Math.round(sampleRate / 1000))
  const a = Math.max(0, c - span)
  const b = Math.min(x.length, c + span)
  let best = c
  let bestRatio = 0
  const e: number[] = []
  for (let s = a; s + blk <= b; s += blk) {
    let v = 0
    for (let i = s; i < s + blk; i++) v += x[i] * x[i]
    e.push(v)
  }
  for (let i = 1; i < e.length; i++) {
    let base = 0
    let k = 0
    for (let j = Math.max(0, i - 8); j < i; j++) { base += e[j]; k++ }
    base = base / Math.max(1, k)
    const ratio = e[i] / (base + 1e-12)
    if (ratio > bestRatio) { bestRatio = ratio; best = a + i * blk }
  }
  return best
}

export function detectOnsets(channels: Float32Array[], sampleRate: number, opts: OnsetOptions = {}): OnsetResult {
  const x = downmix(channels)
  const { flux, hop, size } = spectralFlux(x, sampleRate, opts)
  const hopSec = hop / sampleRate
  const max = flux.reduce((m, v) => (v > m ? v : m), 0)
  const w = Math.max(1, Math.round((opts.window ?? 0.1) / hopSec))
  const mult = opts.multiplier ?? 1.5
  const delta = (opts.delta ?? 0.05) * max
  const minGap = Math.round((opts.minGap ?? 0.06) / hopSec)
  const onsets: Onset[] = []
  let last = -Infinity
  const buf: number[] = []
  for (let f = 1; f < flux.length - 1; f++) {
    const v = flux[f]
    if (v <= 0 || v < flux[f - 1] || v < flux[f + 1]) continue
    buf.length = 0
    for (let j = Math.max(0, f - w); j <= Math.min(flux.length - 1, f + w); j++) buf.push(flux[j])
    buf.sort((a, b) => a - b)
    const thr = buf[buf.length >> 1] * mult + delta
    if (v < thr) continue
    if (f - last < minGap) {
      // keep the stronger of two close peaks
      if (onsets.length && v > onsets[onsets.length - 1].strength) { onsets.pop() } else continue
    }
    const s = refine(x, f * hop, size / 2, sampleRate)
    onsets.push({ t: s / sampleRate, strength: v })
    last = f
  }
  const tempo = estimateTempo(flux, hopSec, opts)
  const beats = tempo ? beatGrid(onsets, tempo.bpm, x.length / sampleRate) : []
  return { onsets, flux, hopSec, tempo, beats }
}

/** Tempo from the autocorrelation of the flux envelope. */
export function estimateTempo(flux: Float32Array, hopSec: number, opts: Pick<OnsetOptions, 'minBpm' | 'maxBpm'> = {}): TempoEstimate | null {
  const n = flux.length
  if (n < 8) return null
  let mean = 0
  for (let i = 0; i < n; i++) mean += flux[i]
  mean /= n
  const d = new Float64Array(n)
  for (let i = 0; i < n; i++) d[i] = flux[i] - mean
  const lagMin = Math.max(1, Math.floor(60 / (opts.maxBpm ?? 200) / hopSec))
  const lagMax = Math.min(n - 2, Math.ceil(60 / (opts.minBpm ?? 60) / hopSec))
  if (lagMax <= lagMin) return null
  let zero = 0
  for (let i = 0; i < n; i++) zero += d[i] * d[i]
  if (zero <= 0) return null
  const ac = new Float64Array(lagMax + 2)
  for (let L = lagMin - 1; L <= lagMax + 1; L++) {
    if (L < 1) continue
    let s = 0
    for (let i = 0; i + L < n; i++) s += d[i] * d[i + L]
    ac[L] = s / (n - L)
  }
  let best = -1
  let bestScore = -Infinity
  for (let L = lagMin; L <= lagMax; L++) {
    if (ac[L] < ac[L - 1] || ac[L] < ac[L + 1]) continue
    const bpm = 60 / (L * hopSec)
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2)
    const score = ac[L] * prior
    if (score > bestScore) { bestScore = score; best = L }
  }
  if (best < 0) return null
  // parabolic refinement of the peak
  const a = ac[best - 1]
  const b = ac[best]
  const c = ac[best + 1]
  const den = a - 2 * b + c
  const lag = den !== 0 ? best + (0.5 * (a - c)) / den : best
  return { bpm: 60 / (lag * hopSec), confidence: Math.max(0, Math.min(1, b / (zero / n))) }
}

/** A beat grid at `bpm`, phased so the most onset strength falls on the beats. */
export function beatGrid(onsets: Onset[], bpm: number, duration: number): number[] {
  if (!onsets.length || !(bpm > 0)) return []
  const period = 60 / bpm
  let bestPhase = 0
  let bestScore = -Infinity
  for (const o of onsets.slice(0, 200)) {
    const phase = ((o.t % period) + period) % period
    let score = 0
    for (const p of onsets) {
      const r = (((p.t - phase) % period) + period) % period
      const dev = Math.min(r, period - r)
      if (dev < 0.03) score += p.strength * (1 - dev / 0.03)
    }
    if (score > bestScore) { bestScore = score; bestPhase = phase }
  }
  const out: number[] = []
  for (let t = bestPhase; t < duration; t += period) out.push(Math.round(t * 1000) / 1000)
  return out
}
