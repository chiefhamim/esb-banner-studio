// Auto-reframe planner: 16:9 (or any) footage → a 9:16 / 4:5 / 1:1 crop that follows the subject. Input is the
// subject's box per analysed frame (detection itself — e.g. MediaPipe's face detector, run locally — is Phase 5's
// job); output is a smoothed crop path with a dead zone (small moves of the subject do not move the camera) and a
// top pan speed, kept so the subject never leaves the frame, and the same path as the clip keyframes the timeline
// stores (`clip.keyframes.offX / offY`, values in footageRect's units). A proposal: Phase 5 shows it as editable
// keyframes, marked AI, before it is applied.

import { simplify, toKeyframes } from '../audio/curve'
import type { Keyframe } from '../timeline'

/** A box in source coordinates, each 0..1 of the source width / height (x, y = top left). */
export interface SubjectBox { x: number; y: number; w: number; h: number }
export interface SubjectFrame { t: number; box: SubjectBox | null }

export type TargetAspect = '9:16' | '4:5' | '1:1'
export const ASPECT_RATIO: Record<TargetAspect, number> = { '9:16': 9 / 16, '4:5': 4 / 5, '1:1': 1 }

export interface ReframeOptions {
  /** Source size in pixels (only the ratio matters). */
  srcW: number
  srcH: number
  target: TargetAspect | number
  /** Extra zoom on top of filling the frame (1 = the largest crop). Default 1. */
  zoom?: number
  /** Half-width of the dead zone, as a fraction of the crop size. Default 0.1. */
  deadZone?: number
  /** Top pan speed, crop widths per second. Default 0.6. */
  maxSpeed?: number
  /** Smoothing time constant, seconds. Default 0.25. */
  smoothing?: number
  /** Where the subject's centre should sit vertically in the crop (0.5 = middle; faces read better a little high). */
  anchorY?: number
  /** Keep the whole box inside the crop even when that needs a faster move than maxSpeed. Default true. */
  keepInside?: boolean
  /** Source time of the clip's first frame (clip.in): keyframe times are made relative to it. Default 0. */
  clipIn?: number
}

export interface CropPoint { t: number; cx: number; cy: number }

export interface ReframePlan {
  /** Crop size, fraction of the source width / height. */
  cropW: number
  cropH: number
  path: CropPoint[]
  /** Clip keyframes (times relative to `clipIn`), plus the static settings they assume. */
  keyframes: { offX: Keyframe[]; offY: Keyframe[] }
  clip: { fit: 'fill'; scale: number }
  /** Frames where the subject box is fully inside the crop / frames with a box. */
  insideRatio: number
  /** Frames where keepInside had to exceed maxSpeed. */
  fastMoves: number
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

/** Crop size (fractions of the source) for a target aspect. */
export function cropSize(srcW: number, srcH: number, target: TargetAspect | number, zoom = 1): { w: number; h: number } {
  const at = typeof target === 'number' ? target : ASPECT_RATIO[target]
  const as = srcW / srcH
  const z = Math.max(1, zoom)
  return at < as ? { w: at / as / z, h: 1 / z } : { w: 1 / z, h: as / at / z }
}

/** Crop centre (source fractions) → footageRect offsets (fractions of the output frame), fill mode, scale = zoom. */
export function offsetsFor(cx: number, cy: number, srcW: number, srcH: number, target: TargetAspect | number, zoom = 1): { offX: number; offY: number } {
  const at = typeof target === 'number' ? target : ASPECT_RATIO[target]
  const as = srcW / srcH
  const kx = Math.max(1, as / at) * zoom // drawn width / frame width
  const ky = Math.max(1, at / as) * zoom
  return { offX: (0.5 - cx) * kx, offY: (0.5 - cy) * ky }
}

/** Fill gaps in detection: a gap between two detections is interpolated (the plan is made offline, so the next box
 * is known); before the first and after the last detection the nearest box is held. */
function filled(frames: SubjectFrame[]): (SubjectBox | null)[] {
  const out: (SubjectBox | null)[] = frames.map((f) => f.box)
  const known = out.map((b, i) => (b ? i : -1)).filter((i) => i >= 0)
  if (!known.length) return out
  for (let i = 0; i < known[0]; i++) out[i] = out[known[0]]
  for (let i = known[known.length - 1] + 1; i < out.length; i++) out[i] = out[known[known.length - 1]]
  for (let k = 1; k < known.length; k++) {
    const a = known[k - 1]
    const b = known[k]
    if (b - a < 2) continue
    const A = out[a]!
    const B = out[b]!
    const ta = frames[a].t
    const tb = frames[b].t
    for (let i = a + 1; i < b; i++) {
      const f = tb > ta ? (frames[i].t - ta) / (tb - ta) : 0
      out[i] = { x: A.x + (B.x - A.x) * f, y: A.y + (B.y - A.y) * f, w: A.w + (B.w - A.w) * f, h: A.h + (B.h - A.h) * f }
    }
  }
  return out
}

/** Dead-zone follower on one axis: move only when the subject leaves the dead zone, smoothly and no faster than
 * `speed`; then, if `lo`/`hi` are given, stay where the whole box is in view (counted as a fast move when it bites). */
function follow(desired: number[], times: number[], size: number, o: { dz: number; speed: number; tau: number; lo: number[]; hi: number[]; min: number; max: number }): { pos: number[]; fast: boolean[] } {
  const pos: number[] = []
  const fast: boolean[] = []
  let cam = clamp(desired[0], o.lo[0], o.hi[0])
  for (let i = 0; i < desired.length; i++) {
    const dt = i ? Math.max(1e-6, times[i] - times[i - 1]) : 0
    const d = desired[i]
    const dz = o.dz * size
    const target = d > cam + dz ? d - dz : d < cam - dz ? d + dz : cam
    if (i) {
      const lim = o.speed * size * dt
      cam += clamp((target - cam) * (1 - Math.exp(-dt / Math.max(1e-6, o.tau))), -lim, lim)
    }
    const kept = clamp(cam, o.lo[i], o.hi[i])
    fast.push(i > 0 && Math.abs(kept - cam) > 1e-9)
    cam = clamp(kept, o.min, o.max)
    pos.push(cam)
  }
  return { pos, fast }
}

export function planReframe(frames: SubjectFrame[], opts: ReframeOptions): ReframePlan {
  const zoom = opts.zoom ?? 1
  const { w: cw, h: ch } = cropSize(opts.srcW, opts.srcH, opts.target, zoom)
  const dz = opts.deadZone ?? 0.1
  const speed = opts.maxSpeed ?? 0.6
  const tau = opts.smoothing ?? 0.25
  const anchorY = opts.anchorY ?? 0.5
  const keep = opts.keepInside ?? true
  const boxes = filled(frames)
  const times = frames.map((f) => f.t)
  const dx = boxes.map((b) => clamp(b ? b.x + b.w / 2 : 0.5, cw / 2, 1 - cw / 2))
  // vertical: the subject's centre at anchorY of the crop
  const dy = boxes.map((b) => clamp(b ? b.y + b.h / 2 + (0.5 - anchorY) * ch : 0.5, ch / 2, 1 - ch / 2))
  // the range of crop centres that keeps the whole box in view (no limit when the box is bigger than the crop)
  const range = (lo: number, len: number, size: number) => (keep && len <= size ? [lo + len - size / 2, lo + size / 2] : [-Infinity, Infinity])
  const rx = boxes.map((b) => (b ? range(b.x, b.w, cw) : [-Infinity, Infinity]))
  const ry = boxes.map((b) => (b ? range(b.y, b.h, ch) : [-Infinity, Infinity]))
  const fx = cw < 1 ? follow(dx, times, cw, { dz, speed, tau, lo: rx.map((r) => r[0]), hi: rx.map((r) => r[1]), min: cw / 2, max: 1 - cw / 2 }) : { pos: dx.map(() => 0.5), fast: dx.map(() => false) }
  const fy = ch < 1 ? follow(dy, times, ch, { dz, speed, tau, lo: ry.map((r) => r[0]), hi: ry.map((r) => r[1]), min: ch / 2, max: 1 - ch / 2 }) : { pos: dy.map(() => 0.5), fast: dy.map(() => false) }
  let fast = 0
  let inside = 0
  let counted = 0
  const path: CropPoint[] = []
  for (let i = 0; i < frames.length; i++) {
    const cx = fx.pos[i]
    const cy = fy.pos[i]
    if (fx.fast[i] || fy.fast[i]) fast++
    const fb = frames[i].box
    if (fb) {
      counted++
      if (fb.x >= cx - cw / 2 - 1e-9 && fb.x + fb.w <= cx + cw / 2 + 1e-9 && fb.y >= cy - ch / 2 - 1e-9 && fb.y + fb.h <= cy + ch / 2 + 1e-9) inside++
    }
    path.push({ t: frames[i].t, cx, cy })
  }
  return { cropW: cw, cropH: ch, path, keyframes: pathToKeyframes(path, opts), clip: { fit: 'fill', scale: zoom }, insideRatio: counted ? inside / counted : 1, fastMoves: fast }
}

/** The path as offX / offY keyframes, simplified to within `tol` (fraction of the frame; default 0.002 ≈ 2 px at 1080). */
export function pathToKeyframes(path: CropPoint[], opts: Pick<ReframeOptions, 'srcW' | 'srcH' | 'target' | 'zoom'> & { clipIn?: number; tol?: number }): { offX: Keyframe[]; offY: Keyframe[] } {
  const tol = opts.tol ?? 0.002
  const offs = path.map((p) => ({ t: p.t, ...offsetsFor(p.cx, p.cy, opts.srcW, opts.srcH, opts.target, opts.zoom ?? 1) }))
  const kx = simplify(offs.map((o) => ({ t: o.t, v: o.offX })), tol)
  const ky = simplify(offs.map((o) => ({ t: o.t, v: o.offY })), tol)
  return { offX: toKeyframes(kx, { t0: opts.clipIn }), offY: toKeyframes(ky, { t0: opts.clipIn }) }
}
