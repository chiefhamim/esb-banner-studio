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

/** Mean-square level of the voice bus at every control point, computed block by block (so a ten-minute timeline never
 * holds its voice bus in memory): feed the bus in pieces with `push`, read the levels with `finish`. The level at a
 * point is the mean square over a `window` centred on it, summed over the channels' mean — the same number
 * `duckingCurve` reads from a whole signal (tested equal). */
export class VoiceLevels {
  private readonly sr: number
  private readonly win: number
  private readonly dt: number
  private sq = new Float64Array(0)
  /** Index of the first sample still held. */
  private base = 0
  private total = 0
  private nextPoint = 0
  readonly levels: number[] = []
  constructor(sampleRate: number, opts: Pick<DuckOptions, 'window' | 'rate'> = {}) {
    this.sr = sampleRate
    this.win = Math.max(1, Math.round((opts.window ?? 0.03) * sampleRate))
    this.dt = 1 / (opts.rate ?? 100)
  }
  private bounds(p: number, n: number): [number, number] {
    const c = Math.round(p * this.dt * this.sr)
    const a = Math.max(0, Math.min(n, c - (this.win >> 1)))
    const b = Math.max(a + 1, Math.min(n, a + this.win))
    return [a, b]
  }
  private sum(a: number, b: number) { let s = 0; for (let i = a; i < b; i++) s += this.sq[i - this.base]; return s / (b - a) }
  push(voice: Float32Array[]) {
    const n = voice[0]?.length ?? 0
    if (!n) return
    const add = new Float64Array(n)
    for (let i = 0; i < n; i++) { let s = 0; for (const ch of voice) s += ch[i] * ch[i]; add[i] = s / voice.length }
    const merged = new Float64Array(this.sq.length + n)
    merged.set(this.sq, 0)
    merged.set(add, this.sq.length)
    this.sq = merged
    this.total += n
    // a point is ready when its whole window is in (the end clamp only applies once the signal has ended)
    for (;;) {
      const c = Math.round(this.nextPoint * this.dt * this.sr)
      const a = Math.max(0, c - (this.win >> 1))
      if (a + this.win > this.total) break
      const [x, y] = this.bounds(this.nextPoint, this.total)
      this.levels.push(this.sum(x, y))
      this.nextPoint++
    }
    const keep = Math.max(0, Math.round(this.nextPoint * this.dt * this.sr) - (this.win >> 1))
    if (keep > this.base) { this.sq = this.sq.slice(keep - this.base); this.base = keep }
  }
  /** The levels for the whole signal (the remaining points use the clamped window at its end). */
  finish(): Float64Array {
    const points = Math.ceil((this.total / this.sr) / this.dt) + 1
    if (this.total === 0) return new Float64Array(points)
    while (this.nextPoint < points) {
      const [x, y] = this.bounds(this.nextPoint, this.total)
      this.levels.push(x >= this.base ? this.sum(x, Math.min(y, this.total)) : 0)
      this.nextPoint++
    }
    return Float64Array.from(this.levels)
  }
}

/** The gain curve from voice levels (mean square per control point, `rate` points a second). */
export function duckFromLevels(ms: ArrayLike<number>, opts: DuckOptions = {}): GainCurve {
  const threshold = opts.threshold ?? -40
  const ratio = Math.max(1, opts.ratio ?? 10)
  const depth = Math.abs(opts.depth ?? 12)
  const rate = opts.rate ?? 100
  const points = ms.length
  const dt = 1 / rate
  const att = 1 - Math.exp(-dt / Math.max(1e-4, opts.attack ?? 0.05))
  const rel = 1 - Math.exp(-dt / Math.max(1e-4, opts.release ?? 0.4))
  const holdPts = Math.round((opts.hold ?? 0.25) * rate)
  const gain = new Float32Array(points)
  let red = 0
  let held = 0
  let holdLeft = 0
  for (let p = 0; p < points; p++) {
    const level = ms[p] > 0 ? 10 * Math.log10(ms[p]) : -Infinity
    let target = level > threshold ? Math.min(depth, (level - threshold) * (1 - 1 / ratio)) : 0
    if (target >= held) { held = target; holdLeft = holdPts } else if (holdLeft > 0) { holdLeft--; target = held } else held = target
    red += (target - red) * (target > red ? att : rel)
    gain[p] = -red
  }
  return { rate, gainDb: gain }
}

/** The music gain curve for a voice bus (any channel count; levels are read from all channels). */
export function duckingCurve(voice: Float32Array[], sampleRate: number, opts: DuckOptions = {}): GainCurve {
  const v = new VoiceLevels(sampleRate, opts)
  v.push(voice)
  return duckFromLevels(v.finish(), opts)
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
