// Loudness normalisation to a delivery target (−14 LUFS for YouTube/Facebook, −16 for podcasts and some phones,
// −23 for EBU R128 broadcast) with a true-peak ceiling (−1 dBTP), and the look-ahead true-peak limiter it needs when
// the gain alone would push peaks over the ceiling. Pure TS; the result is new arrays, the input is never changed.

import { fromDb, interpolator, measureLoudness, toDb, truePeakEnvelope, truePeakEnvelopeGated } from './loudness'
import type { LoudnessReport } from './loudness'

export const LOUDNESS_TARGETS = [
  { id: 'web', lufs: -14, label: 'YouTube / Facebook (−14 LUFS)' },
  { id: 'podcast', lufs: -16, label: 'Podcast / mobile (−16 LUFS)' },
  { id: 'broadcast', lufs: -23, label: 'EBU R128 broadcast (−23 LUFS)' },
] as const
export const DEFAULT_CEILING = -1

export interface NormalizePlan {
  /** Gain to apply, dB (0 for silence: nothing to normalise). */
  gainDb: number
  /** True peak after that gain alone, dBTP. */
  predictedTruePeak: number
  /** The gain alone would cross the ceiling: the limiter must run. */
  limit: boolean
}

/** The gain that takes a measured signal to `target`, and whether the ceiling then needs a limiter. */
export function normalizeGain(m: Pick<LoudnessReport, 'integrated' | 'truePeak'>, opts: { target: number; ceiling?: number }): NormalizePlan {
  const ceiling = opts.ceiling ?? DEFAULT_CEILING
  if (!Number.isFinite(m.integrated)) return { gainDb: 0, predictedTruePeak: m.truePeak, limit: false }
  const gainDb = Math.round((opts.target - m.integrated) * 1000) / 1000
  const predictedTruePeak = m.truePeak + gainDb
  return { gainDb, predictedTruePeak, limit: predictedTruePeak > ceiling }
}

export function applyGain(channels: Float32Array[], gainDb: number): Float32Array[] {
  const g = fromDb(gainDb)
  return channels.map((ch) => { const o = new Float32Array(ch.length); for (let i = 0; i < ch.length; i++) o[i] = ch[i] * g; return o })
}

export interface LimiterOptions {
  /** Ceiling, dBTP (default −1). */
  ceiling?: number
  /** Look-ahead, seconds (default 5 ms): the gain starts falling this long before a peak. */
  lookahead?: number
  /** Release time constant, seconds (default 80 ms). */
  release?: number
}

/** Sliding minimum over [i − r, i + r] (monotonic deque, O(n)). */
function slidingMin(x: Float32Array, r: number): Float32Array {
  const n = x.length
  const out = new Float32Array(n)
  const q = new Int32Array(n)
  let head = 0
  let tail = 0
  let next = 0
  for (let i = 0; i < n; i++) {
    const hi = Math.min(n - 1, i + r)
    while (next <= hi) {
      while (tail > head && x[q[tail - 1]] >= x[next]) tail--
      q[tail++] = next++
    }
    while (q[head] < i - r) head++
    out[i] = x[q[head]]
  }
  return out
}

/** The limiter reads peaks through a longer, full-band interpolator than the meter: a limiter tuned to the meter's own
 * filter leaves peaks that a better reconstruction (ffmpeg's 192 kHz resampler) still sees up to ~0.4 dB higher. */
let STRICT: Float64Array[] | null = null
const LIMIT_MARGIN_DB = 0.4

/** The linked (same for every channel) gain curve that keeps the true peak under the ceiling. */
export function limiterGain(channels: Float32Array[], sampleRate: number, opts: LimiterOptions = {}): Float32Array {
  const n = channels[0]?.length ?? 0
  const ceil = fromDb((opts.ceiling ?? DEFAULT_CEILING) - LIMIT_MARGIN_DB)
  const r = Math.max(1, Math.round((opts.lookahead ?? 0.005) * sampleRate))
  const req = new Float32Array(n).fill(1)
  for (const ch of channels) {
    // the gain only reacts to peaks over the ceiling: the oversampled envelope is worked out around samples within 6 dB of it
    const env = truePeakEnvelopeGated(ch, ceil * 0.5, (STRICT ??= interpolator(64, 1, 10)))
    for (let i = 0; i < n; i++) if (env[i] > ceil) req[i] = Math.min(req[i], ceil / env[i])
  }
  // min over ±r, then a centred average over ±r: every averaged value is ≤ the requirement at the centre
  const h = slidingMin(req, r)
  const P = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) P[i + 1] = P[i] + h[i]
  const w = 2 * r + 1
  const avg = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - r)
    const hi = Math.min(n, i + r + 1)
    const outside = Math.max(0, r - i) + Math.max(0, i + r + 1 - n) // beyond the ends counts as gain 1
    avg[i] = Math.min(1, (P[hi] - P[lo] + outside) / w)
  }
  // recover smoothly after a peak, never above what the average allows
  const rel = 1 - Math.exp(-1 / ((opts.release ?? 0.08) * sampleRate))
  const g = new Float32Array(n)
  let prev = 1
  for (let i = 0; i < n; i++) {
    const up = prev + (1 - prev) * rel
    prev = Math.min(avg[i], up)
    g[i] = prev
  }
  return g
}

/** Apply the true-peak limiter (new arrays). */
export function limitTruePeak(channels: Float32Array[], sampleRate: number, opts: LimiterOptions = {}): Float32Array[] {
  const g = limiterGain(channels, sampleRate, opts)
  return channels.map((ch) => { const o = new Float32Array(ch.length); for (let i = 0; i < ch.length; i++) o[i] = ch[i] * g[i]; return o })
}

export interface NormalizeResult {
  channels: Float32Array[]
  /** Total gain applied before limiting, dB. */
  gainDb: number
  limited: boolean
  before: LoudnessReport
  after: LoudnessReport
}

/** Measure, apply the gain to the target, limit to the ceiling if needed, and re-measure; when limiting pulled the
 * loudness under the target, the gain is raised and the pass repeated (up to 4 passes, ±0.1 LU). */
export function normalizeLoudness(channels: Float32Array[], sampleRate: number, opts: { target: number; ceiling?: number } & Omit<LimiterOptions, 'ceiling'>): NormalizeResult {
  const ceiling = opts.ceiling ?? DEFAULT_CEILING
  const before = measureLoudness(channels, sampleRate)
  const plan = normalizeGain(before, { target: opts.target, ceiling })
  let gainDb = plan.gainDb
  let out = applyGain(channels, gainDb)
  let limited = false
  let after = before
  for (let pass = 0; pass < 4; pass++) {
    out = applyGain(channels, gainDb)
    const tp = toDb(Math.max(...out.map((ch) => { let m = 0; const e = truePeakEnvelope(ch); for (let i = 0; i < e.length; i++) if (e[i] > m) m = e[i]; return m })))
    if (tp > ceiling) { out = limitTruePeak(out, sampleRate, { ...opts, ceiling }); limited = true }
    after = measureLoudness(out, sampleRate)
    const miss = opts.target - after.integrated
    if (!Number.isFinite(miss) || Math.abs(miss) <= 0.1 || !limited) break
    gainDb += miss
  }
  return { channels: out, gainDb, limited, before, after }
}
