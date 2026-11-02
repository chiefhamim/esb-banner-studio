// ADAPTER (Phase 3 Part B → Part A): how a Grid data-card clip reaches the compositor until Part A's title path is
// merged. At the merge the lead points render.ts at Part A's title rasteriser and deletes this file; the only call
// site is the `clip.dataCard` branch in engine/render.ts. Everything a card needs is in dataCardClip.ts
// (`dataCardSpec`): this file only turns that spec into a frame-sized raster.
//
// Raster policy: the card is drawn by the prebuild's renderTitleSpec at clip-local time. While something on it moves
// (the count-up, the chart growing, the in/out phases) it is redrawn every frame into one per-clip canvas uploaded
// into a per-clip slot texture (no texture-cache churn); once settled (titleIsStatic) it is one static texture kept by
// content key, so a held card costs nothing per frame.

import type { Clip } from '../timeline'
import { dataCardSpec, type DataCardRef } from '../dataCardClip'
import { canvasMeasurer, type Measurer } from '../titles/layout'
import { renderTitleSpec, titleIsStatic } from '../titles/render'
import { countUpText } from '../titles/numbers'
import type { TitleSpec } from '../titles/spec'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas
export interface Raster { src: TexImageSource; width: number; height: number }

export type DataCardLayer =
  | { mode: 'static'; key: string; make: () => Raster | null }
  | { mode: 'live'; slot: string; raster: Raster }

let fontEpoch = 0
if (typeof document !== 'undefined' && document.fonts) {
  document.fonts.addEventListener?.('loadingdone', () => { fontEpoch++; specs.clear() })
}

function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

let measurer: Measurer | null = null
function measure(): Measurer {
  if (!measurer) measurer = canvasMeasurer(makeCanvas(8, 8).getContext('2d') as Ctx)
  return measurer
}

/** Built specs by content (a card's spec depends on its stored data, style, frame, length and editor/export). */
const specs = new Map<string, TitleSpec | null>()
function contentKey(card: DataCardRef, w: number, h: number, editor: boolean, duration: number) {
  return JSON.stringify([card, w, h, editor, Math.round(duration * 1000), fontEpoch])
}
function specOf(card: DataCardRef, w: number, h: number, editor: boolean, duration: number): { key: string; spec: TitleSpec | null } {
  const key = contentKey(card, w, h, editor, duration)
  let spec = specs.get(key)
  if (spec === undefined) {
    if (specs.size > 64) specs.clear()
    spec = dataCardSpec(card, { frame: { w, h }, measure: measure(), editor, duration })
    specs.set(key, spec)
  }
  return { key, spec }
}

/** One canvas per live clip (frame-sized), reused every frame while it animates. */
const liveCanvas = new Map<string, AnyCanvas>()
function canvasFor(slot: string, w: number, h: number): AnyCanvas {
  let c = liveCanvas.get(slot)
  if (!c || c.width !== w || c.height !== h) {
    if (liveCanvas.size > 8) liveCanvas.clear()
    c = makeCanvas(w, h)
    liveCanvas.set(slot, c)
  }
  return c
}

function draw(c: AnyCanvas, spec: TitleSpec, local: number): Raster {
  const ctx = c.getContext('2d') as Ctx
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, c.width, c.height)
  renderTitleSpec(ctx, spec, local, { measure: measure() })
  return { src: c as TexImageSource, width: c.width, height: c.height }
}

/** How to draw a data-card clip at timeline time t, or null when it is not a data card. */
export function dataCardLayer(clip: Clip, t: number, w: number, h: number, editor: boolean): DataCardLayer | null {
  const card = clip.dataCard
  if (!card) return null
  const { key, spec } = specOf(card, w, h, editor, clip.duration)
  if (!spec) return null
  const local = Math.max(0, t - clip.start)
  if (titleIsStatic(spec, local, measure())) {
    return { mode: 'static', key: `data|${key}`, make: () => draw(makeCanvas(w, h), spec, local) }
  }
  const slot = `data|${clip.id}`
  return { mode: 'live', slot, raster: draw(canvasFor(slot, w, h), spec, local) }
}

/** The words a data card shows at timeline time t (count-ups as they read then), for tests and the e2e. */
export function dataCardTextAt(clip: Clip, t: number, w: number, h: number, editor = false, m?: Measurer): Record<string, string> {
  const card = clip.dataCard
  if (!card) return {}
  const spec = m ? dataCardSpec(card, { frame: { w, h }, measure: m, editor, duration: clip.duration }) : specOf(card, w, h, editor, clip.duration).spec
  const out: Record<string, string> = {}
  for (const el of spec?.elements ?? []) if (el.type === 'text') out[el.id] = el.countUp ? countUpText(el.countUp, Math.max(0, t - clip.start)) : el.text
  return out
}
