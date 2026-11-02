// Easing curves for title animation. Named curves plus any CSS-style cubic bézier.

export type EasingName = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'esb' | 'easeOutBack' | 'step'
export type Easing = EasingName | { bezier: [number, number, number, number] }

/** The studio's motion curve (CLAUDE.md §2.1 / §8: cubic-bezier(0.16, 1, 0.3, 1)). */
export const ESB_CURVE: [number, number, number, number] = [0.16, 1, 0.3, 1]

const NAMED: Record<Exclude<EasingName, 'linear' | 'easeOutBack' | 'step'>, [number, number, number, number]> = {
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
  esb: ESB_CURVE,
}

/** Solve a cubic bézier (P0 = 0,0, P3 = 1,1) for y at x, by Newton steps with a bisection fallback. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t
  const dsx = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  let t = x
  for (let i = 0; i < 8; i++) {
    const err = sx(t) - x
    if (Math.abs(err) < 1e-7) break
    const d = dsx(t)
    if (Math.abs(d) < 1e-6) break
    t -= err / d
  }
  if (t < 0 || t > 1 || Math.abs(sx(t) - x) > 1e-5) {
    let lo = 0, hi = 1
    t = x
    for (let i = 0; i < 40; i++) { const v = sx(t); if (Math.abs(v - x) < 1e-7) break; if (v < x) lo = t; else hi = t; t = (lo + hi) / 2 }
  }
  return ((ay * t + by) * t + cy) * t
}

/** Eased value of progress `p` (clamped to 0..1). The ends are exact: ease(0) = 0, ease(1) = 1. */
export function ease(e: Easing | undefined, p: number): number {
  const x = p <= 0 ? 0 : p >= 1 ? 1 : p
  if (x === 0 || x === 1) return x
  if (!e || e === 'linear') return x
  if (e === 'step') return 1
  if (e === 'easeOutBack') { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2) }
  const [a, b, c, d] = typeof e === 'string' ? NAMED[e] : e.bezier
  return cubicBezier(a, b, c, d, x)
}
