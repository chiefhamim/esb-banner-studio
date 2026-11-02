// Loudness summaries for meters and the mixer. The waveform itself (min/max peaks at several resolutions, cached per
// file) is already built by the engine — `src/video/engine/peaks.ts` (PeakBuilder, pyramid, levelFor) — and is reused,
// not duplicated. This adds what peaks cannot give: RMS per bin at the same rates and levels, so a meter or a
// "how loud is this stretch" readout can be drawn from the same cache layout.

import { BASE_RATE, LEVELS } from '../engine/peaks'

export interface RmsSummary {
  duration: number
  /** Bins per second of each level (same ladder as Peaks: 200, 50, 12.5, 3.125). */
  rates: number[]
  /** Per level: RMS (linear, all channels pooled) of each bin. */
  levels: Float32Array[]
}

export function rmsSummary(channels: Float32Array[], sampleRate: number, rate = BASE_RATE, levels = LEVELS): RmsSummary {
  const n = channels[0]?.length ?? 0
  const duration = n / sampleRate
  const bins = Math.max(1, Math.ceil(duration * rate))
  const sq = new Float64Array(bins)
  const cnt = new Float64Array(bins)
  for (const ch of channels) {
    for (let i = 0; i < n; i++) {
      const b = Math.min(bins - 1, Math.floor((i / sampleRate) * rate))
      sq[b] += ch[i] * ch[i]
      cnt[b]++
    }
  }
  const out: Float32Array[] = []
  const rates: number[] = []
  let s = sq
  let c = cnt
  let r = rate
  for (let l = 0; l < levels; l++) {
    const lv = new Float32Array(s.length)
    for (let i = 0; i < s.length; i++) lv[i] = c[i] > 0 ? Math.sqrt(s[i] / c[i]) : 0
    out.push(lv)
    rates.push(r)
    const m = Math.ceil(s.length / 4)
    const s2 = new Float64Array(m)
    const c2 = new Float64Array(m)
    for (let i = 0; i < s.length; i++) { s2[i >> 2] += s[i]; c2[i >> 2] += c[i] }
    s = s2
    c = c2
    r /= 4
  }
  return { duration, rates, levels: out }
}

/** RMS (dBFS) of a time span from the finest level that resolves it. */
export function rmsOver(sum: RmsSummary, t0: number, t1: number): number {
  const r = sum.rates[0]
  const a = Math.max(0, Math.floor(t0 * r))
  const b = Math.min(sum.levels[0].length, Math.ceil(t1 * r))
  let s = 0
  let k = 0
  for (let i = a; i < b; i++) { s += sum.levels[0][i] ** 2; k++ }
  return k && s > 0 ? 10 * Math.log10(s / k) : -Infinity
}
