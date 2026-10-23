import type { GradientFill } from './types'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export function rgba(hex: string, a = 1): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

/**
 * Build a canvas gradient that reproduces a Figma linear gradient inside the box (x, y, w, h).
 * Figma: t = tf00*xn + tf01*yn + tf02, with xn, yn in 0..1 across the box.
 */
export function figmaGradient(ctx: Ctx, g: GradientFill, x: number, y: number, w: number, h: number): CanvasGradient {
  const gx = g.tf[0][0] / w
  const gy = g.tf[0][1] / h
  const c = g.tf[0][2]
  const L = gx * gx + gy * gy
  const p0x = x + (-c * gx) / L
  const p0y = y + (-c * gy) / L
  const grad = ctx.createLinearGradient(p0x, p0y, p0x + gx / L, p0y + gy / L)
  for (const s of g.stops) grad.addColorStop(Math.min(1, Math.max(0, s.p)), rgba(s.c, s.a ?? 1))
  return grad
}
