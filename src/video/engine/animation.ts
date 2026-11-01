// The engine's view of Part A's keyframe and speed models, behind one guarded adapter (like mediaSource.ts for media).
//
// Part A provides, by contract:
//   keyframes.ts  sampleProp(clip, prop, tLocal, fallback): number      x, y, scale, rotation, opacity, cropL/R/T/B,
//                                                                       volume and fx.<effectId>.<param>
//   speed.ts      sourceTimeAt(clip, tLocal): number                     source seconds shown at clip-local time tLocal
//                 clipDurationFor(clip): number                          timeline length of the clip at its speed
//                 audioRateAt(clip, tLocal): number                      |speed| of the sound there (0 = frozen)
//                 clip.preservePitch (default true)
// The modules are picked up with import.meta.glob, so this branch builds and runs without them; when they are absent
// (or a function is missing or throws) the fallbacks below read the reserved fields of the v2 clip type directly:
// `keyframes[prop]` (t local seconds, linear / ease / bezier) and `speed` (a number: |rate| 0.1–10, negative =
// reverse, 0 = freeze; or { ramp: [{ t, v }] } with v the signed rate at local time t, integrated). The render path,
// the preview decoder, the export and both sound paths only ever call the functions in this file.

import type { Clip, Keyframe } from '../timeline'

type KeyframesModule = { sampleProp?: (clip: Clip, prop: string, tLocal: number, fallback: number) => number }
type SpeedModule = {
  sourceTimeAt?: (clip: Clip, tLocal: number) => number
  clipDurationFor?: (clip: Clip) => number
  audioRateAt?: (clip: Clip, tLocal: number) => number
}

const kfMods = import.meta.glob<KeyframesModule>('../keyframes.ts', { eager: true })
const spMods = import.meta.glob<SpeedModule>('../speed.ts', { eager: true })
const kf: KeyframesModule = Object.values(kfMods)[0] ?? {}
const sp: SpeedModule = Object.values(spMods)[0] ?? {}
const fn = <T>(v: T | undefined) => (typeof v === 'function' ? v : undefined)
const partSample = fn(kf.sampleProp)
const partSource = fn(sp.sourceTimeAt)
const partDuration = fn(sp.clipDurationFor)
const partRate = fn(sp.audioRateAt)

/** Which side of the contract is live (the progress notes and tests report it). */
export const animationSource = { keyframes: partSample ? 'part-a' : 'fallback', speed: partSource ? 'part-a' : 'fallback' } as const

// ---------------------------------------------------------------- keyframes

/** Whether a property of the clip is animated (has two or more keys, or one key: a constant). */
export function animated(clip: Clip, prop: string): boolean {
  const k = clip.keyframes?.[prop]
  return Array.isArray(k) && k.length > 0
}

/** Any keyframes at all (the render path skips the look-ups for a clip without them). */
export const hasKeyframes = (clip: Clip) => !!clip.keyframes && Object.keys(clip.keyframes).length > 0

/** The value of `prop` at clip-local time `tLocal`; `fallback` when it is not animated. */
export function sampleProp(clip: Clip, prop: string, tLocal: number, fallback: number): number {
  if (!clip.keyframes) return fallback
  if (partSample) {
    try { const v = partSample(clip, prop, tLocal, fallback); return Number.isFinite(v) ? v : fallback } catch { /* fall back */ }
  }
  return sampleKeys(clip.keyframes[prop], tLocal, fallback)
}

/** Fallback interpolation of a key list (sorted or not). Before the first key: its value; after the last: its value. */
export function sampleKeys(keys: Keyframe[] | undefined, t: number, fallback: number): number {
  if (!Array.isArray(keys) || keys.length === 0) return fallback
  let prev: Keyframe | null = null
  let next: Keyframe | null = null
  for (const k of keys) {
    if (!k || !Number.isFinite(k.t) || !Number.isFinite(k.v)) continue
    if (k.t <= t && (!prev || k.t >= prev.t)) prev = k
    if (k.t > t && (!next || k.t < next.t)) next = k
  }
  if (!prev && !next) return fallback
  if (!prev) return next!.v
  if (!next) return prev.v
  const span = next.t - prev.t
  const u = span > 0 ? (t - prev.t) / span : 1
  return prev.v + (next.v - prev.v) * ease(prev, u)
}

function ease(k: Keyframe, u: number): number {
  const e = k.ease as unknown
  if (Array.isArray(e) && e.length === 4) return cubicBezier(e as [number, number, number, number], u)
  switch (String(e)) {
    case 'ease-in': case 'easeIn': return u * u
    case 'ease-out': case 'easeOut': return 1 - (1 - u) * (1 - u)
    case 'ease-in-out': case 'easeInOut': return u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u)
    case 'bezier': return k.bezier ? cubicBezier(k.bezier, u) : u
    default: return u
  }
}

/** CSS-style cubic-bezier(x1, y1, x2, y2) at progress x (Newton, then bisection). */
export function cubicBezier([x1, y1, x2, y2]: [number, number, number, number], x: number): number {
  const bx = (t: number) => 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t
  const by = (t: number) => 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t
  let lo = 0
  let hi = 1
  let t = x
  for (let i = 0; i < 24; i++) {
    const v = bx(t) - x
    if (Math.abs(v) < 1e-6) break
    if (v > 0) hi = t
    else lo = t
    t = (lo + hi) / 2
  }
  return by(t)
}

// ---------------------------------------------------------------- speed

/** Reverse shows the frame just before the span's end first (frame N−1−k at timeline frame k); the fallback uses the
 * same ε as speed.ts. */
const REV_EPS = 1e-3
const MIN_RATE = 0.1
const MAX_RATE = 10
type RampKey = { t: number; v: number }

/** A clip with no speed set plays its source 1:1 (the fast path every Phase 1 clip takes). */
export function isPlainSpeed(c: Clip): boolean {
  return (c.speed == null || c.speed === 1) && !reversed(c) && !freezesOf(c).length
}

const clampRate = (r: number) => (r === 0 ? 0 : Math.sign(r) * Math.min(MAX_RATE, Math.max(MIN_RATE, Math.abs(r))))
const reversed = (c: Clip) => (c as { reverse?: boolean }).reverse === true
type Freeze = { at: number; dur: number }
/** Part A's freeze frames (`clip.freezes`, clip-local seconds): the picture holds, the sound is silent. */
function freezesOf(c: Clip): Freeze[] {
  const f = (c as { freezes?: Freeze[] }).freezes
  return Array.isArray(f) ? f.filter((x) => x && Number.isFinite(x.at) && Number.isFinite(x.dur) && x.dur > 0) : []
}
const frozenAt = (c: Clip, t: number) => freezesOf(c).some((f) => t >= f.at && t < f.at + f.dur)
/** Seconds of freeze before local time t. */
const frozenBefore = (c: Clip, t: number) => freezesOf(c).reduce((s, f) => s + Math.max(0, Math.min(t, f.at + f.dur) - f.at), 0)

function ramp(c: Clip): RampKey[] | null {
  const s = c.speed
  if (!s || typeof s !== 'object' || !Array.isArray(s.ramp)) return null
  const keys = s.ramp.filter((k) => k && Number.isFinite(k.t) && Number.isFinite(k.v)).map((k) => ({ t: k.t, v: clampRate(k.v) })).sort((a, b) => a.t - b.t)
  return keys.length ? keys : null
}

/** The fallback's signed rate at local time t (0 inside a freeze). */
function rateFallback(c: Clip, t: number): number {
  if (frozenAt(c, t)) return 0
  const keys = ramp(c)
  if (keys) {
    if (t <= keys[0].t) return keys[0].v
    for (let i = 1; i < keys.length; i++) if (t < keys[i].t) { const a = keys[i - 1], b = keys[i]; return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t) }
    return keys[keys.length - 1].v
  }
  const r = typeof c.speed === 'number' && Number.isFinite(c.speed) ? clampRate(c.speed) : 1
  return reversed(c) ? -Math.abs(r) : r
}

/** ∫₀ᵗ rate (the fallback's source offset), piecewise linear between ramp keys. */
function offsetFallback(c: Clip, t: number): number {
  const keys = ramp(c)
  if (!keys) {
    const r = typeof c.speed === 'number' && Number.isFinite(c.speed) ? clampRate(c.speed) : 1
    return (reversed(c) ? -Math.abs(r) : r) * (t - frozenBefore(c, t))
  }
  if (freezesOf(c).length) {
    // a ramp with freezes: midpoint sums on a 240 Hz grid
    const n = Math.max(1, Math.ceil(t * 240))
    const h = t / n
    let acc = 0
    for (let i = 0; i < n; i++) acc += rateFallback(c, (i + 0.5) * h) * h
    return acc
  }
  let acc = 0
  let x = 0
  const seg = (a: number, b: number) => { if (b > a) acc += ((rateFallback(c, a) + rateFallback(c, b)) / 2) * (b - a) }
  for (const k of keys) {
    if (k.t <= 0) continue
    const to = Math.min(t, k.t)
    seg(x, to)
    x = to
    if (x >= t) break
  }
  if (x < t) seg(x, t)
  return acc
}

const spanOf = (c: Clip) => { const a = c.in || 0; const b = c.out > a ? c.out : a + c.duration; return [a, b] as const }

/** Source seconds of the file shown at clip-local time `tLocal` (≥ 0, inside the clip's source span). Part A's
 * speed.ts is absolute and already lands a reversed clip inside its span (frame k shows source frame N−1−k). */
export function sourceTimeAt(c: Clip, tLocal: number): number {
  const [a, b] = spanOf(c)
  if (isPlainSpeed(c)) return Math.max(0, a + tLocal)
  let s: number | null = null
  if (partSource) {
    try { const v = partSource(c, tLocal); if (Number.isFinite(v)) s = v } catch { /* fall back */ }
  }
  if (s == null) {
    const off = offsetFallback(c, tLocal)
    // a clip that starts reversed plays its span from the end
    const backwards = !ramp(c) && (reversed(c) || (typeof c.speed === 'number' && c.speed < 0))
    s = backwards ? b + off - REV_EPS : a + off
  }
  return Math.max(0, Math.min(Math.max(a, b - REV_EPS * 0.5), Math.max(a, s)))
}

/** Source time at timeline time `t` (the one mapping preview, export and still use). */
export const srcAt = (c: Clip, t: number) => sourceTimeAt(c, t - c.start)

/** |speed| of the clip's sound at clip-local time (0 = frozen: silent). */
export function audioRateAt(c: Clip, tLocal: number): number {
  if (isPlainSpeed(c)) return 1
  if (partRate) { try { const v = partRate(c, tLocal); if (Number.isFinite(v)) return Math.abs(v) } catch { /* fall back */ } }
  if (frozenAt(c, tLocal)) return 0
  return Math.abs(rateFallback(c, tLocal))
}

/** Signed direction of the source at clip-local time: 1 forward, −1 reverse, 0 frozen. */
export function directionAt(c: Clip, tLocal: number): -1 | 0 | 1 {
  if (isPlainSpeed(c)) return 1
  const d = sourceTimeAt(c, tLocal + 0.02) - sourceTimeAt(c, tLocal)
  return Math.abs(d) < 1e-4 ? 0 : d > 0 ? 1 : -1
}

/** Timeline length of the clip at its speed (the source span over the rate; a ramp solved numerically). */
export function clipDurationFor(c: Clip): number {
  if (partDuration) { try { const v = partDuration(c); if (Number.isFinite(v) && v > 0) return v } catch { /* fall back */ } }
  const [a, b] = spanOf(c)
  const span = b - a
  if (isPlainSpeed(c)) return span
  if (!ramp(c)) {
    const r = typeof c.speed === 'number' && Number.isFinite(c.speed) ? Math.abs(clampRate(c.speed)) : 1
    if (r <= 0) return c.duration
    let d = span / r
    for (const f of [...freezesOf(c)].sort((x, y) => x.at - y.at)) if (f.at < d - 1e-9) d += f.dur
    return d
  }
  // the local time at which |∫ rate| reaches the span (bisection; ≤ span / MIN_RATE)
  let lo = 0
  let hi = span / MIN_RATE
  if (Math.abs(offsetFallback(c, hi)) < span) return hi
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (Math.abs(offsetFallback(c, m)) < span) lo = m; else hi = m }
  return hi
}

/** The clip's sound keeps its pitch when sped up or slowed (default true). */
export const preservePitch = (c: Clip) => (c as { preservePitch?: boolean }).preservePitch !== false
