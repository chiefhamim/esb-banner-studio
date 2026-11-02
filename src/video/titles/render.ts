// Draw a whole TitleSpec at element-local time t onto a Canvas 2D context (frame-sized; works on OffscreenCanvas).
// Text is laid out once per content (layout cache) and only re-evaluated for animation each frame; a count-up figure
// re-lays its single short line while counting and lands on the exact source string.
//
// For the compositor (Phase 3 wiring): the raster changes only while something animates. `titleIsStatic(spec, t)`
// says when the frame equals the settled one, so the texture can be kept by content key from then on.

import { evalTextAnim, phaseLength, type AnimIndex } from './anim'
import { drawChart } from './charts'
import { drawTitle, paint, roundRect, withState, type KaraokeFrame } from './draw'
import { createLayoutCache, type Measurer, type TitleLayout } from './layout'
import { countUpText } from './numbers'
import type { TitleElement, TitleSpec } from './spec'
import { PLACEHOLDER_INK } from './kit'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

const SINGLE: AnimIndex = { counts: { line: 1, word: 1, grapheme: 1 }, graphemes: [{ wordIndex: 0, lineIndex: 0 }], words: [{ lineIndex: 0 }] }

export interface RenderOptions {
  measure: Measurer
  /** The picture for an image element (the editor's photo, or the ESB logo for brandAsset 'esb-logo'), when loaded. */
  image?: (el: Extract<TitleElement, { type: 'image' }>) => CanvasImageSource | null
  /** Karaoke frame per text element id. */
  karaoke?: Record<string, KaraokeFrame | null>
  layoutCache?: (spec: Parameters<ReturnType<typeof createLayoutCache>>[0], m: Measurer) => TitleLayout
}

const defaultCache = createLayoutCache()

/** Lay out one text element (cached by content). */
export function layoutOf(el: Extract<TitleElement, { type: 'text' }>, measure: Measurer, text = el.text, cache = defaultCache): TitleLayout {
  return cache({ text, font: el.font, maxWidth: el.w, align: el.align, maxLines: el.maxLines }, measure)
}

export function renderTitleSpec(ctx: Ctx, spec: TitleSpec, t: number, opts: RenderOptions): void {
  const cache = opts.layoutCache ?? defaultCache
  for (const el of spec.elements) {
    // placeholders are editor-only, whatever the spec says
    if (!spec.editor && 'placeholder' in el && el.placeholder) continue
    if (el.type === 'text') {
      const shown = el.countUp ? countUpText(el.countUp, t) : el.text
      const lay = cache({ text: shown, font: el.font, maxWidth: el.w, align: el.align, maxLines: el.maxLines }, opts.measure)
      const frame = el.anim ? evalTextAnim(el.anim, t, lay) : null
      drawTitle(ctx, lay, frame, el.style, { x: el.x, y: el.y, karaoke: opts.karaoke?.[el.id] ?? null, placeholderInk: el.placeholder ? PLACEHOLDER_INK : undefined })
      continue
    }
    const st = el.anim ? evalTextAnim(el.anim, t, SINGLE) : null
    if (st?.hidden) continue
    const state = st ? st.states[0] : { opacity: 1, dx: 0, dy: 0, scale: 1, blur: 0, clip: null }
    const box = { x: el.x, y: el.y, w: el.w, h: el.h }
    withState(ctx, state, box, () => {
      if (el.type === 'rect') {
        if (el.stripes?.length) {
          const vertical = el.h >= el.w
          const n = el.stripes.length
          el.stripes.forEach((c, k) => {
            ctx.fillStyle = c
            if (vertical) ctx.fillRect(el.x, el.y + (el.h / n) * k, el.w, el.h / n)
            else ctx.fillRect(el.x + (el.w / n) * k, el.y, el.w / n, el.h)
          })
          return
        }
        ctx.save()
        ctx.translate(el.x, el.y)
        ctx.fillStyle = el.gradient ? paint(ctx, el.gradient, { boxWidth: el.w, height: el.h }) : el.fill
        if (el.radius) { roundRect(ctx, 0, 0, el.w, el.h, el.radius); ctx.fill() } else ctx.fillRect(0, 0, el.w, el.h)
        ctx.restore()
      } else if (el.type === 'image') {
        const img = opts.image?.(el) ?? null
        if (!img) {
          if (spec.editor) { ctx.save(); ctx.setLineDash([8, 6]); ctx.strokeStyle = PLACEHOLDER_INK; ctx.lineWidth = 2; roundRect(ctx, el.x, el.y, el.w, el.h, el.radius ?? 0); ctx.stroke(); ctx.restore() }
          return
        }
        ctx.save()
        if (el.radius) { roundRect(ctx, el.x, el.y, el.w, el.h, el.radius); ctx.clip() }
        if (el.brandAsset) {
          // the protected logo is fitted inside its box at its own aspect, never stretched or recoloured
          const iw = (img as { width: number }).width, ih = (img as { height: number }).height
          const k = Math.min(el.w / iw, el.h / ih)
          ctx.drawImage(img, el.x + (el.w - iw * k) / 2, el.y + (el.h - ih * k) / 2, iw * k, ih * k)
        } else {
          // the editor's photo covers its slot (centre crop)
          const iw = (img as { width: number }).width, ih = (img as { height: number }).height
          const k = Math.max(el.w / iw, el.h / ih)
          ctx.drawImage(img, el.x + (el.w - iw * k) / 2, el.y + (el.h - ih * k) / 2, iw * k, ih * k)
        }
        ctx.restore()
      } else if (el.type === 'chart') {
        drawChart(ctx, box, el.chart, t, opts.measure)
      }
    })
  }
}

/** The last moment anything in the spec moves before its out phase (count-ups and chart growth included). */
export function settleTime(spec: TitleSpec, measure: Measurer): number {
  let end = 0
  for (const el of spec.elements) {
    if (el.anim?.in) {
      const counts = el.type === 'text' ? layoutOf(el, measure).counts : SINGLE.counts
      end = Math.max(end, phaseLength(el.anim.in, counts))
    }
    if (el.type === 'text' && el.countUp) end = Math.max(end, (el.countUp.delay ?? 0) + el.countUp.duration)
    if (el.type === 'chart' && el.chart.grow) end = Math.max(end, (el.chart.grow.delay ?? 0) + el.chart.grow.duration)
  }
  return end
}

/** The start of the earliest out phase (Infinity without one). */
export function exitTime(spec: TitleSpec, measure: Measurer): number {
  let start = Infinity
  for (const el of spec.elements) {
    if (!el.anim?.out) continue
    const counts = el.type === 'text' ? layoutOf(el, measure).counts : SINGLE.counts
    start = Math.min(start, el.anim.duration - phaseLength(el.anim.out, counts))
  }
  return start
}

/** True when the frame at t equals the settled title (a cached texture can be reused). */
export const titleIsStatic = (spec: TitleSpec, t: number, measure: Measurer) => t >= settleTime(spec, measure) && t < exitTime(spec, measure)
