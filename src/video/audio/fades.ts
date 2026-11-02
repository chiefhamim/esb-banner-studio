// Fade curves and crossfades. A fade's gain at x ∈ [0, 1] (0 = silent end, 1 = full level):
//  linear       x                      (−6 dB at the midpoint)
//  equal-power  sin(x·π/2)             (−3 dB at the midpoint; a crossfade keeps constant power)
//  log          dB-linear from −60 dB  (sounds even to the ear; 0 at x = 0)

export type FadeCurve = 'linear' | 'equal-power' | 'log'

const LOG_FLOOR_DB = -60

export function fadeGain(curve: FadeCurve, x: number): number {
  const t = Math.min(1, Math.max(0, x))
  if (t === 0) return 0
  if (t === 1) return 1
  if (curve === 'linear') return t
  if (curve === 'equal-power') return Math.sin((t * Math.PI) / 2)
  return Math.pow(10, ((1 - t) * LOG_FLOOR_DB) / 20)
}

/** Gains of the outgoing and incoming sides of a crossfade at x ∈ [0, 1]. Equal-power: out² + in² = 1. */
export function crossfadeGains(curve: FadeCurve, x: number): { out: number; in: number } {
  return { out: fadeGain(curve, 1 - x), in: fadeGain(curve, x) }
}

export interface FadeSpec {
  /** Fade-in and fade-out lengths, seconds (0 = none). */
  fadeIn?: number
  fadeOut?: number
  curve?: FadeCurve
  /** Separate curve for the fade-out (default: `curve`). */
  curveOut?: FadeCurve
}

/** The clip gain at time t into a clip of `duration` seconds. */
export function clipFadeGain(spec: FadeSpec, t: number, duration: number): number {
  const curve = spec.curve ?? 'equal-power'
  let g = 1
  const fi = Math.max(0, spec.fadeIn ?? 0)
  const fo = Math.max(0, spec.fadeOut ?? 0)
  if (fi > 0 && t < fi) g *= fadeGain(curve, t / fi)
  if (fo > 0 && t > duration - fo) g *= fadeGain(spec.curveOut ?? curve, (duration - t) / fo)
  return g
}

/** Apply fades to audio in place-free fashion (new arrays). */
export function applyFades(channels: Float32Array[], sampleRate: number, spec: FadeSpec): Float32Array[] {
  const n = channels[0]?.length ?? 0
  const dur = n / sampleRate
  return channels.map((ch) => {
    const o = new Float32Array(ch)
    const fi = Math.min(n, Math.round((spec.fadeIn ?? 0) * sampleRate))
    const fo = Math.min(n, Math.round((spec.fadeOut ?? 0) * sampleRate))
    for (let i = 0; i < fi; i++) o[i] *= clipFadeGain(spec, i / sampleRate, dur)
    for (let i = n - fo; i < n; i++) o[i] *= clipFadeGain(spec, i / sampleRate, dur)
    return o
  })
}

/** Join two signals with an overlap of `overlap` seconds (b starts while a ends). Result length a + b − overlap. */
export function crossfade(a: Float32Array[], b: Float32Array[], sampleRate: number, overlap: number, curve: FadeCurve = 'equal-power'): Float32Array[] {
  const na = a[0]?.length ?? 0
  const nb = b[0]?.length ?? 0
  const ov = Math.max(0, Math.min(na, nb, Math.round(overlap * sampleRate)))
  return a.map((ca, c) => {
    const cb = b[c] ?? b[0]
    const o = new Float32Array(na + nb - ov)
    o.set(ca.subarray(0, na - ov), 0)
    for (let i = 0; i < ov; i++) {
      const x = ov > 1 ? i / (ov - 1) : 1
      const g = crossfadeGains(curve, x)
      o[na - ov + i] = ca[na - ov + i] * g.out + cb[i] * g.in
    }
    o.set(cb.subarray(ov), na)
    return o
  })
}
