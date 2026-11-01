// Pure geometry for the compositor: where a layer's four corners land in the frame, and which part of its texture
// they show. Unit-tested without a GPU.

import type { DrawRect } from '../timeline'

/** Corners in frame pixels (y down): top-left, top-right, bottom-right, bottom-left. */
export type Quad = [number, number, number, number, number, number, number, number]
/** Texture coordinates: u0, v0 (top left) and u1, v1 (bottom right), 0..1 with v down. */
export type UV = [number, number, number, number]

/** The quad of a drawn rectangle rotated by `deg` around its anchor (ax, ay as fractions of the rectangle). */
export function layerQuad(r: Pick<DrawRect, 'dx' | 'dy' | 'dw' | 'dh'>, deg = 0, ax = 0.5, ay = 0.5): Quad {
  const x0 = r.dx
  const y0 = r.dy
  const x1 = r.dx + r.dw
  const y1 = r.dy + r.dh
  if (!deg) return [x0, y0, x1, y0, x1, y1, x0, y1]
  const px = r.dx + ax * r.dw
  const py = r.dy + ay * r.dh
  const a = (deg * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const rot = (x: number, y: number) => [px + (x - px) * cos - (y - py) * sin, py + (x - px) * sin + (y - py) * cos]
  return [...rot(x0, y0), ...rot(x1, y0), ...rot(x1, y1), ...rot(x0, y1)] as Quad
}

/** The source rectangle of a DrawRect as texture coordinates. */
export function uvOf(r: Pick<DrawRect, 'sx' | 'sy' | 'sw' | 'sh'>, srcW: number, srcH: number): UV {
  return [r.sx / srcW, r.sy / srcH, (r.sx + r.sw) / srcW, (r.sy + r.sh) / srcH]
}

/** Interleaved vertex data (x, y, u, v) × 4 for a TRIANGLE_FAN over the quad. */
export function vertices(q: Quad, uv: UV): Float32Array {
  const [u0, v0, u1, v1] = uv
  return new Float32Array([q[0], q[1], u0, v0, q[2], q[3], u1, v0, q[4], q[5], u1, v1, q[6], q[7], u0, v1])
}

/** A full-frame quad (overlays rasterised at frame size), moved by (offX, offY) fractions of the frame and rotated. */
export function frameQuad(w: number, h: number, offX = 0, offY = 0, deg = 0, ax = 0.5, ay = 0.5): Quad {
  return layerQuad({ dx: offX * w, dy: offY * h, dw: w, dh: h }, deg, ax, ay)
}

/** `vertices` into a reused buffer (the compositor's per-draw upload; no allocation). */
export function writeVertices(out: Float32Array, q: Quad, uv: UV): Float32Array {
  const [u0, v0, u1, v1] = uv
  out[0] = q[0]; out[1] = q[1]; out[2] = u0; out[3] = v0
  out[4] = q[2]; out[5] = q[3]; out[6] = u1; out[7] = v0
  out[8] = q[4]; out[9] = q[5]; out[10] = u1; out[11] = v1
  out[12] = q[6]; out[13] = q[7]; out[14] = u0; out[15] = v1
  return out
}
