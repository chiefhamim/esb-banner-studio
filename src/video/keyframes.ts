// Keyframes (Phase 2): animated numeric properties of a clip, pure and shared by the preview, the export and the UI.
//
// A clip's animation lives at `clip.keyframes[prop]`: a list of `{ t, v, ease }` where `t` is seconds from the clip's
// start ON THE TIMELINE (clip-local timeline time, not source time, so a speed change never moves an animation) and
// `v` the value. A key's `ease` shapes the segment from that key to the next one. Before the first key the value is
// the first key's; after the last, the last key's. A property with no keys is not animated: the clip's own field is
// used (the `fallback` of `sampleProp`).
//
// Property names: the transform/crop/sound names in `PROPS` map to clip fields (`PROP_FIELD`); any other name works
// too (Part B adds effect parameters as `fx.<effectId>.<param>`), sampleProp never needs to know it.

import type { Clip, Ease, Keyframe } from './timeline'
import { EFFECT_DEFS, isEffectType } from './effects'

/** One property's keys, sorted by `t`. Stored at `clip.keyframes[prop]`. */
export type KeyframeTrack = Keyframe[]
export type { Ease, Keyframe }
export type BezierPoints = [number, number, number, number]

/** The CSS-standard cubic-bezier shapes of the named eases. */
export const EASE_BEZIER: Record<'easeIn' | 'easeOut' | 'easeInOut', BezierPoints> = {
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
}
export const EASE_LABEL: Record<'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'bezier', string> = {
  linear: 'Linear', easeIn: 'Ease in', easeOut: 'Ease out', easeInOut: 'Ease in and out', bezier: 'Custom curve',
}
/** The default custom curve (a gentle S) offered when the editor first picks "Custom curve". */
export const DEFAULT_BEZIER: BezierPoints = [0.25, 0.1, 0.25, 1]

/** Two keys closer than this (seconds) are the same key: a frame at 240 fps. */
export const KEY_EPS = 1 / 240

/** The animatable clip properties the inspector offers, with the clip field each one animates. */
export const PROPS = ['x', 'y', 'scale', 'rotation', 'opacity', 'cropL', 'cropR', 'cropT', 'cropB', 'volume'] as const
export type ClipProp = (typeof PROPS)[number]
export const PROP_FIELD: Record<ClipProp, keyof Clip> = {
  x: 'offX', y: 'offY', scale: 'scale', rotation: 'rotation', opacity: 'opacity',
  cropL: 'cropL', cropR: 'cropR', cropT: 'cropT', cropB: 'cropB', volume: 'volume',
}
export const PROP_DEFAULT: Record<ClipProp, number> = {
  x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, cropL: 0, cropR: 0, cropT: 0, cropB: 0, volume: 1,
}
export const PROP_LABEL: Record<ClipProp, string> = {
  x: 'Position X', y: 'Position Y', scale: 'Scale', rotation: 'Rotation', opacity: 'Opacity',
  cropL: 'Crop left', cropR: 'Crop right', cropT: 'Crop top', cropB: 'Crop bottom', volume: 'Volume',
}

/** The clip's own (unanimated) value of a property. */
export function baseValue(clip: Clip, prop: string): number {
  const f = PROP_FIELD[prop as ClipProp]
  if (!f) return 0
  const v = clip[f]
  return typeof v === 'number' && Number.isFinite(v) ? v : PROP_DEFAULT[prop as ClipProp]
}

// ---------------------------------------------------------------- easing

/** x(u) or y(u) of a cubic bezier from (0,0) to (1,1) with control points p1, p2. */
const bz = (u: number, p1: number, p2: number) => {
  const iu = 1 - u
  return 3 * iu * iu * u * p1 + 3 * iu * u * u * p2 + u * u * u
}
const bzD = (u: number, p1: number, p2: number) => {
  const iu = 1 - u
  return 3 * iu * iu * p1 + 6 * iu * u * (p2 - p1) + 3 * u * u * (1 - p2)
}

/** The eased progress (0..1 in, y out) of a CSS-style cubic-bezier(x1, y1, x2, y2). x1/x2 are clamped to 0..1 so the
 * curve is a function of time; y may overshoot (an anticipation or a bounce). */
export function cubicBezier(x: number, b: readonly number[]): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const x1 = Math.min(1, Math.max(0, b[0] ?? 0))
  const y1 = b[1] ?? 0
  const x2 = Math.min(1, Math.max(0, b[2] ?? 1))
  const y2 = b[3] ?? 1
  // Newton first (fast, exact on smooth curves), bisection when the slope is too flat
  return bz(solveU(x, x1, x2), y1, y2)
}

/** The curve parameter u at which x(u) = x (x1/x2 already clamped to 0..1). Precise to ~1e-12, so a segment split
 * exactly (splitBezier) samples the same as the original. */
function solveU(x: number, x1: number, x2: number): number {
  let u = x
  for (let i = 0; i < 12; i++) {
    const err = bz(u, x1, x2) - x
    if (Math.abs(err) < 1e-12) return u
    const d = bzD(u, x1, x2)
    if (Math.abs(d) < 1e-6) break
    u -= err / d
    if (u < 0 || u > 1) break
  }
  if (u >= 0 && u <= 1 && Math.abs(bz(u, x1, x2) - x) < 1e-11) return u
  let lo = 0
  let hi = 1
  u = x
  for (let i = 0; i < 64; i++) {
    const v = bz(u, x1, x2)
    if (Math.abs(v - x) < 1e-13) break
    if (v < x) lo = u
    else hi = u
    u = (lo + hi) / 2
  }
  return u
}

/** The ease of a key as one of the named shapes (older spellings 'ease-in'… are read too). */
export function easeName(k: Pick<Keyframe, 'ease' | 'bezier'>): 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'bezier' {
  const e = k.ease as unknown
  if (Array.isArray(e)) return 'bezier'
  switch (e) {
    case 'easeIn': case 'ease-in': return 'easeIn'
    case 'easeOut': case 'ease-out': return 'easeOut'
    case 'easeInOut': case 'ease-in-out': return 'easeInOut'
    case 'bezier': return 'bezier'
    default: return 'linear'
  }
}

/** The bezier points a key's ease stands for (linear = the diagonal). */
export function easePoints(k: Pick<Keyframe, 'ease' | 'bezier'>): BezierPoints {
  const e = k.ease as unknown
  if (Array.isArray(e) && e.length === 4) return e.map(Number) as BezierPoints
  const n = easeName(k)
  if (n === 'bezier') return (Array.isArray(k.bezier) && k.bezier.length === 4 ? k.bezier : DEFAULT_BEZIER) as BezierPoints
  if (n === 'linear') return [0, 0, 1, 1]
  return EASE_BEZIER[n]
}

/** Eased progress 0..1 across the segment that starts at key `k`. */
export function applyEase(k: Pick<Keyframe, 'ease' | 'bezier'>, u: number): number {
  const n = easeName(k)
  if (n === 'linear') return u
  return cubicBezier(u, easePoints(k))
}

// ---------------------------------------------------------------- sampling

const sortedCache = new WeakMap<KeyframeTrack, KeyframeTrack>()
/** The keys sorted by time (the stored list is kept sorted by the edits below; a hand-edited file may not be). */
function sorted(keys: KeyframeTrack): KeyframeTrack {
  let ok = true
  for (let i = 1; i < keys.length; i++) if (keys[i].t < keys[i - 1].t) { ok = false; break }
  if (ok) return keys
  let s = sortedCache.get(keys)
  if (!s) { s = [...keys].sort((a, b) => a.t - b.t); sortedCache.set(keys, s) }
  return s
}

/** The value of a key list at `t` (seconds, the list's own time base). Undefined for an empty list. */
export function sampleKeys(keys: KeyframeTrack | undefined, t: number): number | undefined {
  if (!keys || !keys.length) return undefined
  const ks = sorted(keys)
  const valid = (v: number) => (Number.isFinite(v) ? v : 0)
  if (ks.length === 1 || t <= ks[0].t) return valid(ks[0].v)
  const last = ks[ks.length - 1]
  if (t >= last.t) return valid(last.v)
  // binary search for the segment [i, i + 1] holding t
  let lo = 0
  let hi = ks.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (ks[mid].t <= t) lo = mid
    else hi = mid
  }
  const a = ks[lo]
  const b = ks[hi]
  const span = b.t - a.t
  if (span <= 0) return valid(b.v)
  const u = (t - a.t) / span
  return valid(a.v) + (valid(b.v) - valid(a.v)) * applyEase(a, u)
}

/**
 * The value of a clip property at a moment of the clip.
 *
 * @param clip      the clip (its `keyframes[prop]` is read; nothing else)
 * @param prop      any property name: `x`, `y`, `scale`, `rotation`, `opacity`, `cropL|R|T|B`, `volume`, or an effect
 *                  parameter such as `fx.<effectId>.<param>`
 * @param tLocal    seconds from the clip's start on the timeline (timeline time − clip.start)
 * @param fallback  the value when the property has no keys (normally the clip's own field)
 * @returns the eased value; exactly a key's value at that key's time; held before the first and after the last key
 */
export function sampleProp(clip: Pick<Clip, 'keyframes'>, prop: string, tLocal: number, fallback: number): number {
  const v = sampleKeys(clip.keyframes?.[prop], tLocal)
  return v === undefined ? fallback : v
}

/** A clip property's value at tLocal, its own field as the fallback (the inspector's readout). */
export function valueAt(clip: Clip, prop: string, tLocal: number): number {
  return sampleProp(clip, prop, tLocal, baseValue(clip, prop))
}

export function isAnimated(clip: Pick<Clip, 'keyframes'>, prop: string): boolean {
  return (clip.keyframes?.[prop]?.length ?? 0) > 0
}

/** The key of `prop` at `t` (within KEY_EPS), if there is one. */
export function keyAt(clip: Pick<Clip, 'keyframes'>, prop: string, t: number): Keyframe | undefined {
  return clip.keyframes?.[prop]?.find((k) => Math.abs(k.t - t) <= KEY_EPS)
}

// ---------------------------------------------------------------- edits (pure: each returns a new clip)

function withTrack(clip: Clip, prop: string, keys: KeyframeTrack): Clip {
  const next = { ...(clip.keyframes ?? {}) }
  if (keys.length) next[prop] = keys
  else delete next[prop]
  return { ...clip, keyframes: Object.keys(next).length ? next : undefined }
}

/** Set (add or replace) the key of `prop` at `t`. A replaced key keeps its ease unless one is given. */
export function setKey(clip: Clip, prop: string, t: number, v: number, ease?: Keyframe['ease'], bezier?: BezierPoints): Clip {
  const keys = clip.keyframes?.[prop] ?? []
  const at = Math.max(0, t)
  const i = keys.findIndex((k) => Math.abs(k.t - at) <= KEY_EPS)
  const out = [...keys]
  if (i >= 0) out[i] = { ...out[i], v, ...(ease ? { ease } : {}), ...(bezier ? { bezier } : {}) }
  else out.push({ t: at, v, ...(ease ? { ease } : {}), ...(bezier ? { bezier } : {}) })
  out.sort((a, b) => a.t - b.t)
  return withTrack(clip, prop, out)
}

/** Remove the key of `prop` at `t`. Removing the last key leaves the property at the value it had there, so the
 * picture does not jump when the animation is turned off. */
export function removeKey(clip: Clip, prop: string, t: number): Clip {
  const keys = clip.keyframes?.[prop] ?? []
  const left = keys.filter((k) => Math.abs(k.t - t) > KEY_EPS)
  if (left.length === keys.length) return clip
  let next = withTrack(clip, prop, left)
  if (!left.length && PROP_FIELD[prop as ClipProp]) next = { ...next, [PROP_FIELD[prop as ClipProp]]: keys[0].v }
  return next
}

/** The diamond in the inspector: a key at `t` is removed if there is one, else one is added with the current value. */
export function toggleKey(clip: Clip, prop: string, t: number): Clip {
  return keyAt(clip, prop, t) ? removeKey(clip, prop, t) : setKey(clip, prop, t, valueAt(clip, prop, t))
}

/** Move the key of `prop` at `from` to `to` (clamped to the clip). A key already at `to` is replaced. */
export function moveKey(clip: Clip, prop: string, from: number, to: number): Clip {
  const keys = clip.keyframes?.[prop] ?? []
  const k = keys.find((x) => Math.abs(x.t - from) <= KEY_EPS)
  if (!k) return clip
  const dest = Math.max(0, Math.min(clip.duration, to))
  const rest = keys.filter((x) => x !== k && Math.abs(x.t - dest) > KEY_EPS)
  return withTrack(clip, prop, [...rest, { ...k, t: dest }].sort((a, b) => a.t - b.t))
}

/** Set the ease of the key of `prop` at `t` (the shape of the segment after it). */
export function setKeyEase(clip: Clip, prop: string, t: number, ease: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'bezier', bezier?: BezierPoints): Clip {
  const keys = clip.keyframes?.[prop] ?? []
  let hit = false
  const out = keys.map((k) => {
    if (Math.abs(k.t - t) > KEY_EPS) return k
    hit = true
    const { bezier: _b, ...rest } = k
    return ease === 'bezier' ? { ...rest, ease, bezier: bezier ?? (Array.isArray(k.bezier) ? k.bezier : DEFAULT_BEZIER) } : ease === 'linear' ? { t: k.t, v: k.v } : { ...rest, ease }
  })
  return hit ? withTrack(clip, prop, out) : clip
}

/** Every key time of the clip (all properties, or one), sorted and de-duplicated. */
export function keyTimes(clip: Pick<Clip, 'keyframes'>, prop?: string): number[] {
  const out: number[] = []
  const tracks = prop ? [clip.keyframes?.[prop] ?? []] : Object.values(clip.keyframes ?? {})
  for (const ks of tracks) for (const k of ks) if (!out.some((t) => Math.abs(t - k.t) <= KEY_EPS)) out.push(k.t)
  return out.sort((a, b) => a - b)
}

/** Keys closer than this (seconds) are at the same moment for an exact cut. */
const CUT_EPS = 1e-9

/** The key list with a key at `tc` that changes nothing: the segment holding `tc` is split exactly (de Casteljau on
 * its cubic bezier), so sampling the result gives the same values as the original everywhere. A time outside the keys
 * (held), on a key, or on a flat segment needs no new shape. `exact` is false only for an overshooting curve whose
 * split point lands on its start or end value (no bezier from v to v can carry the bump): then the earlier key's shape
 * is kept over the shorter span, as before. */
export function insertKeyAt(ks: KeyframeTrack, tc: number): { keys: KeyframeTrack; exact: boolean } {
  if (!ks.length || tc <= ks[0].t + CUT_EPS || tc >= ks[ks.length - 1].t - CUT_EPS) return { keys: ks, exact: true }
  let i = 0
  while (i < ks.length - 1 && ks[i + 1].t <= tc) i++
  const a = ks[i]
  const b = ks[i + 1]
  if (Math.abs(a.t - tc) <= CUT_EPS || Math.abs(b.t - tc) <= CUT_EPS || b.t - a.t <= CUT_EPS) return { keys: ks, exact: true }
  const span = b.t - a.t
  const xc = (tc - a.t) / span
  const va = Number.isFinite(a.v) ? a.v : 0
  const vb = Number.isFinite(b.v) ? b.v : 0
  const put = (left: Keyframe, mid: Keyframe) => [...ks.slice(0, i), left, mid, ...ks.slice(i + 1)]
  if (easeName(a) === 'linear') return { keys: put(a, { t: tc, v: va + (vb - va) * xc }), exact: true }
  if (va === vb) return { keys: put(a, { ...a, t: tc, v: va }), exact: true }
  const [x1r, y1, x2r, y2] = easePoints(a)
  const x1 = Math.min(1, Math.max(0, x1r))
  const x2 = Math.min(1, Math.max(0, x2r))
  const u = solveU(xc, x1, x2)
  // de Casteljau at u: P0 (0,0), P1, P2, P3 (1,1)
  const l = (p: number, q: number) => p + (q - p) * u
  const p01x = l(0, x1), p01y = l(0, y1)
  const p12x = l(x1, x2), p12y = l(y1, y2)
  const p23x = l(x2, 1), p23y = l(y2, 1)
  const p012x = l(p01x, p12x), p012y = l(p01y, p12y)
  const p123x = l(p12x, p23x), p123y = l(p12y, p23y)
  const cx = l(p012x, p123x), cy = l(p012y, p123y)
  const vc = va + (vb - va) * cy
  const approx = { keys: put(a, { ...a, t: tc, v: vc }), exact: false }
  if (Math.abs(cy) < 1e-9 || Math.abs(1 - cy) < 1e-9 || cx <= 0 || cx >= 1) return approx
  const left: BezierPoints = [p01x / cx, p01y / cy, p012x / cx, p012y / cy]
  const right: BezierPoints = [(p123x - cx) / (1 - cx), (p123y - cy) / (1 - cy), (p23x - cx) / (1 - cx), (p23y - cy) / (1 - cy)]
  const inUnit = (v: number) => v >= -1e-9 && v <= 1 + 1e-9
  if (!inUnit(left[0]) || !inUnit(left[2]) || !inUnit(right[0]) || !inUnit(right[2])) return approx
  const clampX = (p: BezierPoints): BezierPoints => [Math.min(1, Math.max(0, p[0])), p[1], Math.min(1, Math.max(0, p[2])), p[3]]
  return {
    keys: put({ t: a.t, v: a.v, ease: 'bezier', bezier: clampX(left) }, { t: tc, v: vc, ease: 'bezier', bezier: clampX(right) }),
    exact: true,
  }
}

/** The keys of a clip cut to the part [a, b] of its local time and re-based to start at 0 (a trim or a split). A
 * property animated across a cut gets a key at each cut edge, and the segment it falls in is split exactly
 * (insertKeyAt), so the kept part samples exactly as it did. */
export function cutKeyframes(keyframes: Clip['keyframes'], a: number, b: number): Clip['keyframes'] {
  if (!keyframes) return undefined
  const out: Record<string, Keyframe[]> = {}
  for (const [prop, keys] of Object.entries(keyframes)) {
    if (!Array.isArray(keys) || !keys.length) continue
    const ks = sorted(keys)
    const list = insertKeyAt(insertKeyAt(ks, a).keys, b).keys
    const inside = list.filter((k) => k.t >= a - CUT_EPS && k.t <= b + CUT_EPS).map((k) => ({ ...k, t: Math.max(0, k.t - a) }))
    if (!inside.length) inside.push({ t: 0, v: sampleKeys(ks, a)! })
    out[prop] = inside
  }
  return Object.keys(out).length ? out : undefined
}

// ---------------------------------------------------------------- reading a project file (never trust it)

/** Most keys kept per property, and properties per clip. */
export const MAX_KEYS = 1000
export const MAX_KEYED_PROPS = 64
const EASES = new Set(['easeIn', 'easeOut', 'easeInOut', 'bezier', 'ease-in', 'ease-out', 'ease-in-out'])
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** One key list from a file: plain objects with finite numbers only, `t` 0…1e5 s, `v` within [vMin, vMax], a known ease
 * (a bezier of four finite numbers, x clamped 0..1, y −10..10), at most `max` keys, sorted, one key per moment. */
export function sanitizeKeyList(raw: unknown, opts: { max?: number; vMin?: number; vMax?: number } = {}): Keyframe[] {
  if (!Array.isArray(raw)) return []
  const max = opts.max ?? MAX_KEYS
  const vMin = opts.vMin ?? -1e6
  const vMax = opts.vMax ?? 1e6
  const bez = (b: unknown): BezierPoints | null => {
    if (!Array.isArray(b) || b.length !== 4 || !b.every(finite)) return null
    const c = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
    return [c(b[0], 0, 1), c(b[1], -10, 10), c(b[2], 0, 1), c(b[3], -10, 10)]
  }
  const out: Keyframe[] = []
  for (const k of raw.slice(0, max)) {
    if (!k || typeof k !== 'object' || Array.isArray(k)) continue
    const o = k as Record<string, unknown>
    if (!finite(o.t) || !finite(o.v)) continue
    const key: Keyframe = { t: Math.min(1e5, Math.max(0, o.t)), v: Math.min(vMax, Math.max(vMin, o.v)) }
    if (Array.isArray(o.ease)) { const b = bez(o.ease); if (b) key.ease = b }
    else if (typeof o.ease === 'string' && EASES.has(o.ease)) {
      if (o.ease === 'bezier') { const b = bez(o.bezier); if (b) { key.ease = 'bezier'; key.bezier = b } }
      else key.ease = o.ease as Ease
    }
    out.push(key)
  }
  out.sort((x, y) => x.t - y.t)
  // one key per moment (the later one in the file wins)
  const uniq: Keyframe[] = []
  for (const k of out) { if (uniq.length && Math.abs(uniq[uniq.length - 1].t - k.t) <= CUT_EPS) uniq[uniq.length - 1] = k; else uniq.push(k) }
  return uniq
}

/** A clip's keyframes from a file: a plain object whose property names are the inspector's (PROPS) or
 * `fx.<effectId>.<param>` for a numeric parameter of one of the clip's (already cleaned) effects; every list through
 * sanitizeKeyList. Read through a null-prototype object, so `__proto__` and friends are just names that are not
 * allowed. `renames` (an effect's id in the file → the id sanitizeEffects gave it) copies that effect's keys along. */
export function sanitizeKeyframes(raw: unknown, effects: readonly { id: string; type: string }[] = [], renames: readonly { from: string; to: string }[] = []): Record<string, Keyframe[]> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const src: Record<string, unknown> = Object.create(null)
  for (const name of Object.keys(raw).slice(0, MAX_KEYED_PROPS * 4)) src[name] = (raw as Record<string, unknown>)[name]
  for (const { from, to } of renames) {
    const pre = `fx.${from}.`
    for (const name of Object.keys(src)) if (name.startsWith(pre)) { const n2 = `fx.${to}.${name.slice(pre.length)}`; if (!(n2 in src)) src[n2] = src[name] }
  }
  const byId = new Map(effects.map((e) => [e.id, e.type]))
  const out: Record<string, Keyframe[]> = {}
  let n = 0
  for (const name of Object.keys(src)) {
    if (n >= MAX_KEYED_PROPS) break
    if (!keyableName(name, byId)) continue
    const keys = sanitizeKeyList(src[name])
    if (!keys.length) continue
    out[name] = keys
    n++
  }
  return n ? out : undefined
}

function keyableName(name: string, effects: Map<string, string>): boolean {
  if ((PROPS as readonly string[]).includes(name)) return true
  const m = /^fx\.([\w-]{1,60})\.(\w{1,40})$/.exec(name)
  if (!m) return false
  const type = effects.get(m[1])
  if (!type || !isEffectType(type)) return false
  return EFFECT_DEFS[type].params.some((p) => p.kind === 'num' && p.key === m[2])
}

/** Shift every key by `dt` (no cut): used when the clip's start moves but its content must not (a ripple trim of the
 * head that keeps the picture where it was is a cut, not this). */
export function shiftKeyframes(keyframes: Clip['keyframes'], dt: number): Clip['keyframes'] {
  if (!keyframes || !dt) return keyframes
  const out: Record<string, Keyframe[]> = {}
  for (const [p, ks] of Object.entries(keyframes)) out[p] = ks.map((k) => ({ ...k, t: k.t + dt }))
  return out
}
