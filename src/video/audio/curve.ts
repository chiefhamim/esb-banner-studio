// Sampled curves → the timeline's keyframes. Shared by the ducking curve (a volume lane) and the reframe path
// (offX / offY), so both hand Phase 4/5 the shape `Clip.keyframes[prop]` already has.

import type { Keyframe } from '../timeline'

export interface Pt { t: number; v: number }

/** Ramer–Douglas–Peucker: the fewest points whose straight segments stay within `tol` of every sample. */
export function simplify(points: Pt[], tol: number): Pt[] {
  if (points.length <= 2) return points.slice()
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const pa = points[a]
    const pb = points[b]
    let worst = -1
    let far = 0
    for (let i = a + 1; i < b; i++) {
      const p = points[i]
      const span = pb.t - pa.t
      const lerp = span > 0 ? pa.v + ((pb.v - pa.v) * (p.t - pa.t)) / span : pa.v
      const d = Math.abs(p.v - lerp)
      if (d > far) { far = d; worst = i }
    }
    if (worst > 0 && far > tol) { keep[worst] = 1; stack.push([a, worst], [worst, b]) }
  }
  return points.filter((_, i) => keep[i])
}

/** Points → keyframes (linear segments, times rounded to the millisecond, `t0` subtracted). */
export function toKeyframes(points: Pt[], opts: { t0?: number; ease?: Keyframe['ease']; digits?: number } = {}): Keyframe[] {
  const t0 = opts.t0 ?? 0
  const k = Math.pow(10, opts.digits ?? 4)
  return points.map((p) => ({ t: Math.round((p.t - t0) * 1000) / 1000, v: Math.round(p.v * k) / k, ease: opts.ease ?? 'linear' }))
}

/** Value of linear keyframes at t (held before the first and after the last). */
export function valueAt(kf: Keyframe[], t: number): number {
  if (!kf.length) return 0
  if (t <= kf[0].t) return kf[0].v
  for (let i = 1; i < kf.length; i++) {
    if (t <= kf[i].t) {
      const a = kf[i - 1]
      const b = kf[i]
      return b.t > a.t ? a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t) : b.v
    }
  }
  return kf[kf.length - 1].v
}
