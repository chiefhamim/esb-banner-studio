// The one canvas measurer the title code uses (titleClip's export checks, the engine's layout, settle/exit times): it
// is remade when fonts finish loading, so a width measured with the fallback font is never served afterwards. The
// layout caches are keyed by measurer (layout.ts createLayoutCache), so they follow it without being cleared.

import { fontEpochNow } from './fontEpoch'
import { canvasMeasurer, type Measurer } from './titles/layout'

type Ctx2 = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

let epoch = -1
let measurer: Measurer | null = null
let ctx: Ctx2 | null | undefined

/** A canvas measurer for the current font epoch, or null when the platform has no canvas (tests, workers). */
export function titleMeasurerOrNull(): Measurer | null {
  const e = fontEpochNow()
  if (measurer && e === epoch) return measurer
  if (ctx === undefined) {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(8, 8) : typeof document !== 'undefined' ? document.createElement('canvas') : null
    ctx = (c?.getContext('2d') as Ctx2 | null | undefined) ?? null
  }
  if (!ctx) return null
  measurer = canvasMeasurer(ctx as CanvasRenderingContext2D)
  epoch = e
  return measurer
}

/** As above; throws without a canvas (the engine always has one). */
export function titleMeasurer(): Measurer {
  const m = titleMeasurerOrNull()
  if (!m) throw new Error('no canvas to measure titles with')
  return m
}

/** The epoch the current measurer was made in (spec caches drop what is older). */
export const measurerEpoch = () => { titleMeasurerOrNull(); return epoch }
