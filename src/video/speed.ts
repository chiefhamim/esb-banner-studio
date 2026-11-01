// Speed (Phase 2): how a clip's timeline time maps to the time in its source file. Pure; one rule for the preview,
// the export, the audio and every edit.
//
// A clip plays its source span [in, out]. Its speed is either a constant (`clip.speed` = 0.1…10, default 1) or a ramp
// (`clip.speed = { ramp: [{ t, v, ease }] }`: speed `v` at clip-local timeline second `t`, eased between keys like any
// keyframe, held before the first and after the last). Freeze frames (`clip.freezes = [{ at, dur }]`, clip-local
// timeline seconds) hold the picture for `dur` seconds: the speed is 0 there. `clip.reverse` plays the span from `out`
// back to `in`. The source time at clip-local time t is
//
//     forward:  in  + P(t)        reverse:  out − P(t)        P(t) = ∫₀ᵗ speed(τ) · (τ not in a freeze) dτ
//
// and the clip's timeline length is the D with P(D) = out − in (`clipDurationFor`). A clip with none of these fields
// maps exactly as before (in + t), so every Phase 0/1 project plays and exports unchanged.

import type { Clip, Keyframe } from './timeline'
import { sampleKeys } from './keyframes'

export const SPEED_MIN = 0.1
export const SPEED_MAX = 10

/** A freeze frame: from clip-local timeline second `at`, the picture holds for `dur` seconds. */
export interface Freeze { at: number; dur: number }

type Timed = Pick<Clip, 'speed' | 'freezes' | 'reverse' | 'in' | 'out' | 'duration'>

export const clampSpeed = (v: number) => (Number.isFinite(v) ? Math.min(SPEED_MAX, Math.max(SPEED_MIN, v)) : 1)

/** The ramp keys of a clip, or undefined for a constant speed. */
export function rampOf(clip: Pick<Clip, 'speed'>): Keyframe[] | undefined {
  const s = clip.speed
  return s && typeof s === 'object' && Array.isArray(s.ramp) && s.ramp.length ? s.ramp : undefined
}

/** The constant speed (1 when unset; a ramp's first speed for a ramped clip). */
export function constantSpeed(clip: Pick<Clip, 'speed'>): number {
  const s = clip.speed
  if (typeof s === 'number') return clampSpeed(s)
  const r = rampOf(clip)
  return r ? clampSpeed(r[0].v) : 1
}

/** The clip changes time in any way (speed ≠ 1, a ramp, a freeze or reverse). */
export function isRetimed(clip: Timed): boolean {
  return !!rampOf(clip) || (typeof clip.speed === 'number' && Math.abs(clip.speed - 1) > 1e-9) || !!clip.freezes?.length || !!clip.reverse
}

function freezesOf(clip: Pick<Clip, 'freezes'>): Freeze[] {
  const f = clip.freezes
  if (!f || !f.length) return []
  return f.filter((x) => Number.isFinite(x.at) && Number.isFinite(x.dur) && x.dur > 0).sort((a, b) => a.at - b.at)
}

/** Speed at clip-local time t ignoring freezes (the ramp value, or the constant). */
export function speedAt(clip: Pick<Clip, 'speed'>, t: number): number {
  const r = rampOf(clip)
  if (!r) return constantSpeed(clip)
  return clampSpeed(sampleKeys(r, t) ?? 1)
}

/** The picture is held at clip-local time t. */
export function isFrozenAt(clip: Pick<Clip, 'freezes'>, t: number): boolean {
  return freezesOf(clip).some((f) => t >= f.at && t < f.at + f.dur)
}

/** Seconds of freeze in [0, t). */
function frozenBefore(fs: Freeze[], t: number): number {
  let sum = 0
  for (const f of fs) {
    if (f.at >= t) break
    sum += Math.min(f.dur, t - f.at)
  }
  return sum
}

// ---- ramps: a cumulative table per ramp + freezes (cached by object identity; edits make new objects)

interface Table { h: number; n: number; cum: Float64Array; end: number }
const tables = new WeakMap<object, WeakMap<object, Table>>()
const NO_FREEZE = {}
const TABLE_STEP = 1 / 1000
const TABLE_MAX = 400_000

function tableFor(clip: Pick<Clip, 'speed' | 'freezes' | 'duration'>, fs: Freeze[]): Table {
  const rampObj = clip.speed as object
  const fKey = (clip.freezes as object | undefined) ?? NO_FREEZE
  let inner = tables.get(rampObj)
  if (!inner) { inner = new WeakMap(); tables.set(rampObj, inner) }
  const hit = inner.get(fKey)
  const r = rampOf(clip)!
  // the table covers every key and freeze and the clip's length; past it the speed is the last key's, unfrozen
  const end = Math.max(clip.duration || 0, r[r.length - 1].t, ...fs.map((f) => f.at + f.dur), 0.001)
  if (hit && hit.end >= end) return hit
  const n = Math.min(TABLE_MAX, Math.max(16, Math.ceil(end / TABLE_STEP)))
  const h = end / n
  const cum = new Float64Array(n + 1)
  let fi = 0
  for (let i = 0; i < n; i++) {
    const mid = (i + 0.5) * h
    while (fi < fs.length && fs[fi].at + fs[fi].dur <= mid) fi++
    const frozen = fi < fs.length && mid >= fs[fi].at && mid < fs[fi].at + fs[fi].dur
    cum[i + 1] = cum[i] + (frozen ? 0 : clampSpeed(sampleKeys(r, mid) ?? 1)) * h
  }
  const tb = { h, n, cum, end }
  inner.set(fKey, tb)
  return tb
}

/**
 * Source seconds played from the clip's start up to clip-local time t: P(t) (≥ 0 for t ≥ 0). Outside [0, length]
 * it continues at the edge speed (used by trims that extend a clip).
 */
export function progressAt(clip: Pick<Clip, 'speed' | 'freezes' | 'duration'>, t: number): number {
  const fs = freezesOf(clip)
  const r = rampOf(clip)
  if (!r) {
    const s = constantSpeed(clip)
    if (t <= 0) return s * t
    return s * (t - frozenBefore(fs, t))
  }
  if (t <= 0) return speedAt(clip, 0) * t
  const tb = tableFor(clip, fs)
  if (t >= tb.end) return tb.cum[tb.n] + speedAt(clip, tb.end) * (t - tb.end)
  const x = t / tb.h
  const i = Math.floor(x)
  return tb.cum[i] + (tb.cum[i + 1] - tb.cum[i]) * (x - i)
}

/**
 * The time in the source file shown (and heard) at a moment of the clip.
 *
 * @param clip    the clip: `in`, `out`, `speed` (constant or `{ ramp }`), `freezes`, `reverse`, `duration`
 * @param tLocal  seconds from the clip's start on the timeline (timeline time − clip.start), clamped to the clip
 * @returns seconds in the source file (absolute, i.e. including `in`), never below 0. Forward: in + P(t); reverse:
 *          out − P(t). Without speed fields this is exactly `in + tLocal`.
 */
export function sourceTimeAt(clip: Timed, tLocal: number): number {
  const t = Math.max(0, Math.min(clip.duration > 0 ? clip.duration : tLocal, tLocal))
  const p = isRetimed(clip) ? progressAt(clip, t) : t
  const src = clip.reverse ? clip.out - p : (clip.in || 0) + p
  return Math.max(0, src)
}

/** Like sourceTimeAt but not clamped to the clip (trims that extend an edge need the source time just outside). */
export function sourceTimeUnclamped(clip: Timed, tLocal: number): number {
  const p = isRetimed(clip) ? progressAt(clip, tLocal) : tLocal
  return clip.reverse ? clip.out - p : (clip.in || 0) + p
}

/**
 * The timeline length a clip needs to play its whole source span [in, out] at its speed, freezes included.
 * Constant speed s: (out − in) / s + freezes. A ramp is solved on its table.
 */
export function clipDurationFor(clip: Timed): number {
  const span = Math.max(0, clip.out - clip.in)
  if (!isRetimed(clip)) return span
  const fs = freezesOf(clip)
  const r = rampOf(clip)
  if (!r) {
    const s = constantSpeed(clip)
    // walk the freezes in order: each one that starts before the content ends adds its length
    let d = span / s
    for (const f of fs) if (f.at < d - 1e-9) d += f.dur
    return d
  }
  // past the table's end the speed is the last key's and nothing is frozen, so the rest is exact arithmetic
  const tb = tableFor(clip, fs)
  if (tb.cum[tb.n] < span) return tb.end + (span - tb.cum[tb.n]) / speedAt(clip, tb.end)
  let lo = 0
  let hi = tb.n
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (tb.cum[mid] < span) lo = mid
    else hi = mid
  }
  const seg = tb.cum[hi] - tb.cum[lo]
  return (lo + (seg > 0 ? (span - tb.cum[lo]) / seg : 0)) * tb.h
}

/**
 * The rate of the clip's sound at a moment: source seconds per timeline second (|speed|; 0 inside a freeze, where the
 * sound is silent). The direction is `clip.reverse`; `clip.preservePitch` (default true) keeps the voice's pitch.
 *
 * @param clip    the clip (`speed`, `freezes`)
 * @param tLocal  seconds from the clip's start on the timeline
 */
export function audioRateAt(clip: Pick<Clip, 'speed' | 'freezes'>, tLocal: number): number {
  return isFrozenAt(clip, tLocal) ? 0 : speedAt(clip, tLocal)
}

/** Everything about the sound at a moment in one object: rate (as audioRateAt), direction and the pitch flag. */
export interface AudioPlayback { rate: number; reverse: boolean; preservePitch: boolean }
export function audioPlaybackAt(clip: Pick<Clip, 'speed' | 'freezes' | 'reverse' | 'preservePitch'>, tLocal: number): AudioPlayback {
  return { rate: audioRateAt(clip, tLocal), reverse: !!clip.reverse, preservePitch: clip.preservePitch !== false }
}

// ---------------------------------------------------------------- retiming a clip (pure; the timeline op ripples)

/** The clip at a constant speed (the ramp goes; freezes stay), its length recomputed from its source span. */
export function withConstantSpeed<C extends Clip>(clip: C, speed: number): C {
  const s = clampSpeed(speed)
  const next = { ...clip, speed: Math.abs(s - 1) < 1e-9 ? undefined : s }
  return { ...next, duration: clipDurationFor(next) }
}

/** Ramp presets: speed over the clip's length (`at` is a fraction of the resulting length). */
export const RAMP_PRESETS: Record<string, { label: string; hint: string; points: { at: number; v: number }[] }> = {
  rampUp: { label: 'Speed up', hint: 'Starts at normal speed and ends 3× fast', points: [{ at: 0, v: 1 }, { at: 1, v: 3 }] },
  rampDown: { label: 'Slow down', hint: 'Starts 3× fast and settles to normal speed', points: [{ at: 0, v: 3 }, { at: 1, v: 1 }] },
  hero: { label: 'Hero moment', hint: 'Fast, a long slow middle, fast again', points: [{ at: 0, v: 2 }, { at: 0.35, v: 0.3 }, { at: 0.65, v: 0.3 }, { at: 1, v: 2 }] },
  bullet: { label: 'Bullet', hint: 'Normal, a sharp dip to 0.2×, normal', points: [{ at: 0, v: 1 }, { at: 0.45, v: 0.2 }, { at: 0.55, v: 0.2 }, { at: 1, v: 1 }] },
  montage: { label: 'Montage', hint: 'Alternates fast and slow', points: [{ at: 0, v: 2 }, { at: 0.25, v: 0.5 }, { at: 0.5, v: 2 }, { at: 0.75, v: 0.5 }, { at: 1, v: 2 }] },
}

/** The clip with a ramp preset applied. The keys sit at fractions of the length the ramp itself gives the clip (found
 * by a few rounds of fitting, since the length depends on the ramp). */
export function withRampPreset<C extends Clip>(clip: C, preset: keyof typeof RAMP_PRESETS): C {
  const pts = RAMP_PRESETS[preset]?.points
  if (!pts) return clip
  let d = clip.duration
  let next = clip
  for (let i = 0; i < 6; i++) {
    const ramp: Keyframe[] = pts.map((p) => ({ t: p.at * d, v: clampSpeed(p.v), ease: 'easeInOut' }))
    next = { ...clip, speed: { ramp } }
    const nd = clipDurationFor({ ...next, duration: d })
    if (Math.abs(nd - d) < 1e-4) { d = nd; break }
    d = nd
  }
  return { ...next, duration: d }
}

/** The clip with its ramp keys replaced (edited in the curve editor); its length follows. */
export function withRamp<C extends Clip>(clip: C, ramp: Keyframe[]): C {
  const keys = [...ramp].map((k) => ({ ...k, t: Math.max(0, k.t), v: clampSpeed(k.v) })).sort((a, b) => a.t - b.t)
  const next = { ...clip, speed: keys.length ? { ramp: keys } : undefined }
  return { ...next, duration: clipDurationFor(next) }
}

/** A freeze frame of `dur` seconds at clip-local `at`: the clip gets longer by `dur`, its source span is the same. */
export function withFreeze<C extends Clip>(clip: C, at: number, dur = 2): C {
  const a = Math.max(0, Math.min(clip.duration, at))
  // a freeze inside another freeze extends that one
  const fs = freezesOf(clip).map((f) => ({ ...f }))
  const hit = fs.find((f) => a >= f.at && a <= f.at + f.dur)
  if (hit) hit.dur += dur
  else {
    // later freezes are later on the timeline by `dur` too
    for (const f of fs) if (f.at > a) f.at += dur
    fs.push({ at: a, dur })
  }
  fs.sort((x, y) => x.at - y.at)
  // a ramp's later keys move with the content as well
  const r = rampOf(clip)
  const speed = r ? { ramp: r.map((k) => (k.t > a ? { ...k, t: k.t + dur } : k)) } : clip.speed
  const next = { ...clip, freezes: fs, speed }
  return { ...next, duration: clipDurationFor(next) }
}

export function withoutFreeze<C extends Clip>(clip: C, index: number): C {
  const fs = freezesOf(clip)
  const gone = fs[index]
  if (!gone) return clip
  const rest = fs.filter((_, i) => i !== index).map((f) => (f.at > gone.at ? { ...f, at: f.at - gone.dur } : f))
  const r = rampOf(clip)
  const speed = r ? { ramp: r.map((k) => (k.t > gone.at + gone.dur ? { ...k, t: k.t - gone.dur } : k)) } : clip.speed
  const next = { ...clip, freezes: rest.length ? rest : undefined, speed }
  return { ...next, duration: clipDurationFor(next) }
}

/** Reverse on/off: the same span backwards; the length is unchanged. */
export function withReverse<C extends Clip>(clip: C, on: boolean): C {
  return { ...clip, reverse: on || undefined }
}

/** The freeze list cut to [a, b] of local time and re-based to 0 (trims and splits). */
export function cutFreezes(freezes: Freeze[] | undefined, a: number, b: number): Freeze[] | undefined {
  if (!freezes?.length) return freezes
  const out: Freeze[] = []
  for (const f of freezes) {
    const s = Math.max(a, f.at)
    const e = Math.min(b, f.at + f.dur)
    if (e - s > 1e-6) out.push({ at: s - a, dur: e - s })
  }
  return out.length ? out : undefined
}

/** Seconds of freeze in the clip-local range [a, b). */
export function freezeIn(clip: Pick<Clip, 'freezes'>, a: number, b: number): number {
  const fs = freezesOf(clip)
  return frozenBefore(fs, b) - frozenBefore(fs, a)
}
