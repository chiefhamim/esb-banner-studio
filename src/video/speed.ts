// Speed (Phase 2): how a clip's timeline time maps to the time in its source file. Pure; one rule for the preview,
// the export, the audio and every edit.
//
// A clip plays its source span [in, out]. Its speed is either a constant (`clip.speed` = 0.1…10, default 1) or a ramp
// (`clip.speed = { ramp: [{ t, v, ease }] }`: speed `v` at clip-local timeline second `t`, eased between keys like any
// keyframe, held before the first and after the last). Freeze frames (`clip.freezes = [{ at, dur }]`, clip-local
// timeline seconds) hold the picture for `dur` seconds: the speed is 0 there. `clip.reverse` plays the span from `out`
// back to `in`. The source time at clip-local time t is
//
//     forward:  in  + P(t)        reverse:  out − P(t) − ε    P(t) = ∫₀ᵗ speed(τ) · (τ not in a freeze) dτ
//
// Reverse convention: frame k of a reversed clip shows source frame N−1−k (N = frames in the span). `out − P(t)` at
// t = 0 is the span's end, which is the START of the first frame AFTER the span, so the reverse mapping is moved one
// millisecond earlier (ε = REVERSE_EPS: well inside any frame up to 1000 fps, and larger than the frame lookup's own
// 1e-3-frame tolerance), clamped to `in`. Edits (trims, splits) use the exact `sourceTimeUnclamped`, never ε.
// and the clip's timeline length is the D with P(D) = out − in (`clipDurationFor`). A clip with none of these fields
// maps exactly as before (in + t), so every Phase 0/1 project plays and exports unchanged.

import type { Clip, Keyframe } from './timeline'
import { insertKeyAt, sampleKeys, sanitizeKeyList } from './keyframes'

export const SPEED_MIN = 0.1
export const SPEED_MAX = 10
/** Seconds a reversed clip's source time sits before `out − P(t)`, so it lands inside the span (see the header). */
export const REVERSE_EPS = 1e-3

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

// ---------------------------------------------------------------- reading a project file (never trust it)

/** Most ramp keys and freezes one clip keeps. */
export const MAX_RAMP_KEYS = 256
export const MAX_FREEZES = 64
/** Longest single freeze (seconds). */
export const MAX_FREEZE = 3600

/** `clip.speed` from a file: a finite constant (clamped to 0.1–10; 1 → undefined) or `{ ramp }` of sanitised keys
 * (keyframes.ts sanitizeKeyList, speeds clamped, at most MAX_RAMP_KEYS); anything else → undefined (normal speed). */
export function sanitizeSpeed(raw: unknown): Clip['speed'] {
  if (typeof raw === 'number') { if (!Number.isFinite(raw)) return undefined; const s = clampSpeed(raw); return Math.abs(s - 1) < 1e-9 ? undefined : s }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const keys = sanitizeKeyList((raw as { ramp?: unknown }).ramp, { max: MAX_RAMP_KEYS, vMin: SPEED_MIN, vMax: SPEED_MAX })
  return keys.length ? { ramp: keys } : undefined
}

/** `clip.freezes` from a file: plain `{ at, dur }` with finite `at` ≥ 0 and 0 < dur ≤ MAX_FREEZE, at most MAX_FREEZES,
 * sorted, overlapping ones merged; undefined when none is left. */
export function sanitizeFreezes(raw: unknown): Freeze[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const fs: Freeze[] = []
  for (const f of raw.slice(0, MAX_FREEZES * 4)) {
    if (!f || typeof f !== 'object' || Array.isArray(f)) continue
    const { at, dur } = f as { at?: unknown; dur?: unknown }
    if (typeof at !== 'number' || typeof dur !== 'number' || !Number.isFinite(at) || !Number.isFinite(dur) || dur <= 0) continue
    fs.push({ at: Math.min(1e5, Math.max(0, at)), dur: Math.min(MAX_FREEZE, dur) })
  }
  fs.sort((a, b) => a.at - b.at)
  const out: Freeze[] = []
  for (const f of fs) {
    const last = out[out.length - 1]
    if (last && f.at <= last.at + last.dur) last.dur = Math.max(last.dur, f.at + f.dur - last.at)
    else if (out.length < MAX_FREEZES) out.push({ ...f })
  }
  return out.length ? out : undefined
}

// ---------------------------------------------------------------- freezes

const freezeCache = new WeakMap<object, Freeze[]>()
/** The clip's valid freezes, sorted (cached per freezes array: the per-frame look-ups allocate nothing). */
export function freezesOf(clip: Pick<Clip, 'freezes'>): Freeze[] {
  const f = clip.freezes
  if (!Array.isArray(f) || !f.length) return NO_FREEZES
  let hit = freezeCache.get(f)
  if (!hit) {
    hit = f.filter((x) => !!x && Number.isFinite(x.at) && Number.isFinite(x.dur) && x.dur > 0).sort((a, b) => a.at - b.at)
    freezeCache.set(f, hit)
  }
  return hit
}
const NO_FREEZES: Freeze[] = []

/** Speed at clip-local time t ignoring freezes (the ramp value, or the constant). */
export function speedAt(clip: Pick<Clip, 'speed'>, t: number): number {
  const r = rampOf(clip)
  if (!r) return constantSpeed(clip)
  return clampSpeed(sampleKeys(r, t) ?? 1)
}

/** The picture is held at clip-local time t. */
export function isFrozenAt(clip: Pick<Clip, 'freezes'>, t: number): boolean {
  for (const f of freezesOf(clip)) {
    if (f.at > t) return false
    if (t < f.at + f.dur) return true
  }
  return false
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
//
// The table's cells end on every ramp key and every freeze edge, so inside a cell the speed is one smooth eased piece
// (or 0: frozen). Each cell is integrated with 3-point Gauss–Legendre (exact for polynomials up to degree 5; the eased
// segments are smooth), and a time inside a cell is integrated the same way from the cell's start — so P(t) is
// accurate to ~1e-9 s with a few thousand cells, and a split of the ramp (insertKeyAt) plays exactly as before. The
// table covers the keys and the freezes only: past its end the speed is the last key's and nothing is frozen, so it
// does not depend on the clip's length (one table per committed ramp, whatever the length it is tried at).

interface Table { x: Float64Array; cum: Float64Array; frozen: Uint8Array; n: number; end: number }
const tables = new WeakMap<object, WeakMap<object, Table>>()
const NO_FREEZE = {}
/** Cells per second at most, and cells per table at most. */
const CELLS_PER_S = 200
const TABLE_MAX = 40_000
const GX = [-Math.sqrt(3 / 5), 0, Math.sqrt(3 / 5)]
const GW = [5 / 9, 8 / 9, 5 / 9]

function gauss(r: Keyframe[], a: number, b: number): number {
  if (b <= a) return 0
  const m = (a + b) / 2
  const h = (b - a) / 2
  let s = 0
  for (let i = 0; i < 3; i++) s += GW[i] * clampSpeed(sampleKeys(r, m + h * GX[i]) ?? 1)
  return s * h
}

function tableFor(clip: Pick<Clip, 'speed' | 'freezes'>, fs: Freeze[]): Table {
  const rampObj = clip.speed as object
  const fKey = (clip.freezes as object | undefined) ?? NO_FREEZE
  let inner = tables.get(rampObj)
  if (!inner) { inner = new WeakMap(); tables.set(rampObj, inner) }
  const hit = inner.get(fKey)
  if (hit) return hit
  const r = rampOf(clip)!
  // break points: 0, every key, every freeze edge
  const pts: number[] = [0]
  for (const k of r) if (k.t > 0) pts.push(k.t)
  for (const f of fs) { pts.push(f.at); pts.push(f.at + f.dur) }
  pts.sort((a, b) => a - b)
  const end = Math.max(pts[pts.length - 1], 1e-3)
  const per = Math.min(CELLS_PER_S, TABLE_MAX / end)
  const xs: number[] = [0]
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    if (b - a < 1e-12) continue
    const m = Math.max(1, Math.ceil((b - a) * per))
    for (let j = 1; j <= m; j++) xs.push(j === m ? b : a + ((b - a) * j) / m)
  }
  if (xs[xs.length - 1] < end) xs.push(end)
  const n = xs.length - 1
  const x = Float64Array.from(xs)
  const cum = new Float64Array(n + 1)
  const frozen = new Uint8Array(n)
  let fi = 0
  for (let i = 0; i < n; i++) {
    const mid = (x[i] + x[i + 1]) / 2
    while (fi < fs.length && fs[fi].at + fs[fi].dur <= mid) fi++
    const fz = fi < fs.length && mid >= fs[fi].at && mid < fs[fi].at + fs[fi].dur
    frozen[i] = fz ? 1 : 0
    cum[i + 1] = cum[i] + (fz ? 0 : gauss(r, x[i], x[i + 1]))
  }
  const tb = { x, cum, frozen, n, end }
  inner.set(fKey, tb)
  return tb
}

/** The table cell holding t (0 ≤ t < end). */
function cellOf(tb: Table, t: number): number {
  let lo = 0
  let hi = tb.n
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (tb.x[mid] <= t) lo = mid
    else hi = mid
  }
  return lo
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
  const i = cellOf(tb, t)
  return tb.cum[i] + (tb.frozen[i] ? 0 : gauss(r, tb.x[i], t))
}

/**
 * The time in the source file shown (and heard) at a moment of the clip.
 *
 * @param clip    the clip: `in`, `out`, `speed` (constant or `{ ramp }`), `freezes`, `reverse`, `duration`
 * @param tLocal  seconds from the clip's start on the timeline (timeline time − clip.start), clamped to the clip
 * @returns seconds in the source file (absolute, i.e. including `in`), never below 0. Forward: in + P(t); reverse:
 *          max(in, out − P(t) − REVERSE_EPS), so frame k of a reversed clip shows source frame N−1−k. Without speed
 *          fields this is exactly `in + tLocal`.
 */
export function sourceTimeAt(clip: Timed, tLocal: number): number {
  const t = Math.max(0, Math.min(clip.duration > 0 ? clip.duration : tLocal, tLocal))
  const timed = isRetimed(clip)
  const p = timed ? progressAt(clip, t) : t
  // never past the span: a held last frame (a freeze at the end) shows `out`'s frame, not the file beyond it
  const src = clip.reverse ? Math.max(clip.in || 0, clip.out - p - REVERSE_EPS) : (timed ? Math.min(clip.out, (clip.in || 0) + p) : (clip.in || 0) + p)
  return Math.max(0, src)
}

/** Like sourceTimeAt but not clamped to the clip (trims that extend an edge need the source time just outside). */
export function sourceTimeUnclamped(clip: Timed, tLocal: number): number {
  const p = isRetimed(clip) ? progressAt(clip, tLocal) : tLocal
  return clip.reverse ? clip.out - p : (clip.in || 0) + p
}

/**
 * The timeline length a clip needs to play its whole source span [in, out] at its speed, freezes included (a freeze
 * that starts exactly where the content ends holds the last frame: it counts too).
 * Constant speed s: (out − in) / s + freezes. A ramp is solved on its table.
 */
export function clipDurationFor(clip: Timed): number {
  const span = Math.max(0, clip.out - clip.in)
  if (!isRetimed(clip)) return span
  const fs = freezesOf(clip)
  const r = rampOf(clip)
  let d: number
  if (!r) {
    const s = constantSpeed(clip)
    // walk the freezes in order: each one that starts before (or right at) the content's end adds its length
    d = span / s
    for (const f of fs) if (f.at <= d + 1e-9) d += f.dur
    return d
  }
  const tb = tableFor(clip, fs)
  if (tb.cum[tb.n] < span) d = tb.end + (span - tb.cum[tb.n]) / speedAt(clip, tb.end)
  else {
    // the first cell whose end reaches the span, then the time inside it (bisection on the same integral)
    let lo = 0
    let hi = tb.n
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (tb.cum[mid] < span) lo = mid
      else hi = mid
    }
    const i = tb.cum[lo] >= span ? lo : hi - 1
    const want = span - tb.cum[i]
    let a = tb.x[i]
    let b = tb.x[i + 1]
    if (want <= 0 || tb.frozen[i]) d = a
    else {
      for (let k = 0; k < 60 && b - a > 1e-12; k++) { const m = (a + b) / 2; if (gauss(r, tb.x[i], m) < want) a = m; else b = m }
      d = (a + b) / 2
    }
  }
  // freezes that start where the content ends hold its last frame
  for (const f of fs) if (Math.abs(f.at - d) <= 1e-6) d = f.at + f.dur
  return d
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

/** A freeze frame of `dur` seconds at clip-local `at`: the clip gets longer by `dur`, its source span is the same.
 * `at` may be the clip's end (the last frame is held). On a ramped clip the ramp is split exactly at `at`
 * (keyframes.ts insertKeyAt) and what follows moves `dur` later with the content: a key at `at` and its copy at
 * `at + dur` carry the split curve, so every frame before and after the freeze plays as it did. */
export function withFreeze<C extends Clip>(clip: C, at: number, dur = 2): C {
  const a = Math.max(0, Math.min(clip.duration, at))
  // a freeze inside another freeze (or touching its end) extends that one
  const fs = freezesOf(clip).map((f) => ({ ...f }))
  const hit = fs.find((f) => a >= f.at && a <= f.at + f.dur)
  if (hit) hit.dur += dur
  else {
    // later freezes are later on the timeline by `dur` too
    for (const f of fs) if (f.at > a) f.at += dur
    fs.push({ at: a, dur })
  }
  fs.sort((x, y) => x.at - y.at)
  // a ramp's later keys move with the content as well; the segment across `at` is split first so it is not stretched
  const r = rampOf(clip)
  let speed = clip.speed
  if (r) {
    const pivot = hit ? hit.at + hit.dur - dur : a
    if (pivot <= r[0].t + 1e-9) speed = { ramp: r.map((k) => ({ ...k, t: k.t + dur })) }
    else if (pivot < r[r.length - 1].t - 1e-9) {
      const split = insertKeyAt(r, pivot).keys
      const i = split.findIndex((k) => Math.abs(k.t - pivot) <= 1e-9)
      const atKey = split[i]
      // the key at the pivot is flat through the hold; its copy after the hold carries the rest of the curve
      speed = { ramp: [...split.slice(0, i), { t: pivot, v: atKey.v }, { ...atKey, t: pivot + dur }, ...split.slice(i + 1).map((k) => ({ ...k, t: k.t + dur }))] }
    }
  }
  const next = { ...clip, freezes: fs, speed }
  return { ...next, duration: clipDurationFor(next) }
}

export function withoutFreeze<C extends Clip>(clip: C, index: number): C {
  const fs = freezesOf(clip)
  const gone = fs[index]
  if (!gone) return clip
  const rest = fs.filter((_, i) => i !== index).map((f) => (f.at > gone.at ? { ...f, at: f.at - gone.dur } : f))
  const r = rampOf(clip)
  let speed = clip.speed
  if (r) {
    const a = gone.at
    const b = gone.at + gone.dur
    // withFreeze left a flat key at `a` and its continuation at `b`: drop what lies inside the hold and close it up
    const hasEdge = r.some((k) => Math.abs(k.t - b) <= 1e-6)
    const keys = r
      .filter((k) => !(hasEdge && k.t >= a - 1e-9 && k.t < b - 1e-6))
      .map((k) => (k.t >= b - 1e-6 ? { ...k, t: Math.max(a, k.t - gone.dur) } : k))
    speed = { ramp: keys }
  }
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
