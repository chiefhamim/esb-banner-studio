// Auto ducking: a sidechain envelope follower reads the voice bus and produces a gain curve (dB, ≤ 0) for the music
// bus — down by up to `depth` dB while someone speaks, back up after they stop. The curve is a proposal: Phase 4 shows
// it as an editable volume lane before anything is mixed with it.

import { simplify, toKeyframes } from './curve'
import type { Keyframe } from '../timeline'

export interface DuckOptions {
  /** Voice level (RMS, dBFS) above which the music starts to duck. Default −40. */
  threshold?: number
  /** Compression ratio above the threshold (reduction = excess · (1 − 1/ratio)). Default 10. */
  ratio?: number
  /** Most the music is lowered, dB (positive number). Default 12. */
  depth?: number
  /** Seconds to go down / come back up (time constants). Defaults 0.05 / 0.4. */
  attack?: number
  release?: number
  /** Seconds the duck holds after the voice drops (bridges gaps between words). Default 0.25. */
  hold?: number
  /** Voice RMS window, seconds. Default 0.03. */
  window?: number
  /** Control points per second of the curve. Default 100. */
  rate?: number
}

export interface GainCurve {
  /** Points per second; point i is at i / rate seconds. */
  rate: number
  /** Gain in dB at each point (0 = unchanged). */
  gainDb: Float32Array
}

/** The music gain curve for a voice bus (any channel count; levels are read from all channels). */
export function duckingCurve(voice: Float32Array[], sampleRate: number, opts: DuckOptions = {}): GainCurve {
  const threshold = opts.threshold ?? -40
  const ratio = Math.max(1, opts.ratio ?? 10)
  const depth = Math.abs(opts.depth ?? 12)
  const rate = opts.rate ?? 100
  const n = voice[0]?.length ?? 0
  const points = Math.ceil((n / sampleRate) * rate) + 1
  const win = Math.max(1, Math.round((opts.window ?? 0.03) * sampleRate))
  const dt = 1 / rate
  const att = 1 - Math.exp(-dt / Math.max(1e-4, opts.attack ?? 0.05))
  const rel = 1 - Math.exp(-dt / Math.max(1e-4, opts.release ?? 0.4))
  const holdPts = Math.round((opts.hold ?? 0.25) * rate)
  // prefix sum of the summed squares for O(1) windowed RMS
  const P = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (const ch of voice) s += ch[i] * ch[i]
    P[i + 1] = P[i] + s / voice.length
  }
  const gain = new Float32Array(points)
  let red = 0
  let held = 0
  let holdLeft = 0
  for (let p = 0; p < points; p++) {
    const c = Math.round(p * dt * sampleRate)
    const a = Math.max(0, Math.min(n, c - (win >> 1)))
    const b = Math.max(a + 1, Math.min(n, a + win))
    const ms = b <= n && b > a ? (P[Math.min(n, b)] - P[a]) / (b - a) : 0
    const level = ms > 0 ? 10 * Math.log10(ms) : -Infinity
    let target = level > threshold ? Math.min(depth, (level - threshold) * (1 - 1 / ratio)) : 0
    if (target >= held) { held = target; holdLeft = holdPts } else if (holdLeft > 0) { holdLeft--; target = held } else held = target
    red += (target - red) * (target > red ? att : rel)
    gain[p] = -red
  }
  return { rate, gainDb: gain }
}

/** Gain (dB) of a curve at time t, linearly interpolated. */
export function curveAt(c: GainCurve, t: number): number {
  const x = t * c.rate
  const i = Math.floor(x)
  if (i < 0) return c.gainDb[0] ?? 0
  if (i >= c.gainDb.length - 1) return c.gainDb[c.gainDb.length - 1] ?? 0
  const f = x - i
  return c.gainDb[i] * (1 - f) + c.gainDb[i + 1] * f
}

/** Apply a dB curve to audio (new arrays). */
export function applyGainCurve(channels: Float32Array[], sampleRate: number, c: GainCurve): Float32Array[] {
  const n = channels[0]?.length ?? 0
  const g = new Float32Array(n)
  for (let i = 0; i < n; i++) g[i] = Math.pow(10, curveAt(c, i / sampleRate) / 20)
  return channels.map((ch) => { const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = ch[i] * g[i]; return o })
}

/** The curve as volume keyframes (linear gain 0..1, the unit of `Clip.volume`), simplified to within `tolDb`. */
export function curveToVolumeKeyframes(c: GainCurve, opts: { tolDb?: number; t0?: number } = {}): Keyframe[] {
  const pts = Array.from(c.gainDb, (v, i) => ({ t: i / c.rate, v }))
  return toKeyframes(simplify(pts, opts.tolDb ?? 0.25), { t0: opts.t0 }).map((k) => ({ ...k, v: Math.round(Math.pow(10, k.v / 20) * 10000) / 10000 }))
}
