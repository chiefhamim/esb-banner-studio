// One physical feel for the whole app: damped springs, sampled into Web Animation keyframes.
// The tab chip (controls.tsx) and the desk change (App.tsx / shellStore.ts) both move with these.

/** Step response of a damped spring: 0 at t = 0, settling on 1 (a little past it first when zeta < 1). */
export const step = (t: number, zeta: number, omega: number) => {
  const wd = omega * Math.sqrt(1 - zeta * zeta)
  return 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t))
}

export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * A desk arriving: it drifts in from `dir * distance` px and settles with a soft overshoot while it fades up.
 * (dir = +1 arrives from the right, -1 from the left.)
 */
export function arriveFrames(dir: 1 | -1, distance = 34, duration = 0.56, zeta = 0.8, omega = 15): Keyframe[] {
  const N = 44
  const frames: Keyframe[] = []
  for (let i = 0; i <= N; i++) {
    const s = step((i / N) * duration, zeta, omega)
    frames.push({ transform: `translateX(${(dir * distance * (1 - s)).toFixed(2)}px)`, opacity: Math.max(0, Math.min(1, s * 1.3)), offset: i / N })
  }
  return frames
}
