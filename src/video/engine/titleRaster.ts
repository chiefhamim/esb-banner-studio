// Title clips on the GPU: a title is drawn with Canvas 2D (titles/render.ts renderTitleSpec, stickers.ts) into a
// frame-sized canvas and uploaded as a texture.
//
//   static   while nothing moves (titleIsStatic: after every in phase has settled and before the first out phase) the
//            raster is made once and kept by content (words, look, accent, frame size, editor/export, fonts) in the
//            compositor's static cache — scrubbing or playing over a settled title redraws nothing;
//   moving   during an in or out phase (or a count-up) the raster is redrawn for each new instant into one slot
//            texture per clip (re-uploaded; the slot is pruned when the clip leaves the screen).
//
// The monitor and the export call this through the same renderFrame, so an animated title's frame at t is the same
// picture in both. Classic (migrated Phase 0–2) titles are drawn by compositor.ts's old overlay code, unchanged.

import type { Clip } from '../timeline'
import { fontEpochNow, getCachedImage, rasterKey, rasterLayer, stationLogo } from '../compositor'
import { legacyView, STICKER_COLORS, titleDuration, titleLocal } from '../titleModel'
import { buildTitleSpec, titleAccent } from '../titleClip'
import { canvasMeasurer, createLayoutCache, type Measurer } from '../titles/layout'
import { renderTitleSpec, titleIsStatic } from '../titles/render'
import type { TitleSpec } from '../titles/spec'
import type { KaraokeFrame } from '../titles/draw'
import { drawSticker, stickerIsStatic, type StickerDraw } from '../titles/stickers'
import type { GLCompositor, TexHandle } from './glCompositor'

type Ctx2 = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** How many times a title raster was drawn (tests: a static title once, a moving one once per new frame). */
export const titleRasterStats = { static: 0, moving: 0, reset() { this.static = 0; this.moving = 0 } }

// ------------------------------------------------------------------ measuring (fresh after fonts arrive)

let measureEpoch = -1
let measurer: Measurer | null = null
let layoutCache = createLayoutCache()
let measureCtx: Ctx2 | null = null

/** The canvas measurer for titles; remade (with its layout cache) when fonts finish loading. */
export function titleMeasurer(): Measurer {
  const epoch = fontEpochNow()
  if (measurer && epoch === measureEpoch) return measurer
  if (!measureCtx) {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(8, 8) : document.createElement('canvas')
    measureCtx = c.getContext('2d') as Ctx2
  }
  measurer = canvasMeasurer(measureCtx as CanvasRenderingContext2D)
  layoutCache = createLayoutCache()
  specs.clear()
  measureEpoch = epoch
  return measurer
}

// ------------------------------------------------------------------ specs, by content

const specs = new Map<string, TitleSpec | null>()
const contentKey = (clip: Clip, w: number, h: number, editor: boolean) =>
  JSON.stringify([clip.titleData ?? clip.dataCard, titleAccent(clip), titleDuration(clip), w, h, editor, fontEpochNow(), stationLogo() ? 1 : 0])

/** The clip's spec for this frame size (cached by content). */
export function titleSpecFor(clip: Clip, w: number, h: number, editor: boolean): TitleSpec | null {
  const m = titleMeasurer()
  const k = contentKey(clip, w, h, editor)
  if (specs.has(k)) { const v = specs.get(k)!; specs.delete(k); specs.set(k, v); return v }
  const spec = buildTitleSpec(clip, w, h, editor, m)
  specs.set(k, spec)
  if (specs.size > 96) specs.delete(specs.keys().next().value!)
  return spec
}

// ------------------------------------------------------------------ canvases

const canvases = new Map<string, HTMLCanvasElement | OffscreenCanvas>()
function canvasFor(w: number, h: number) {
  const k = `${w}x${h}`
  let c = canvases.get(k)
  if (!c) {
    if (canvases.size > 4) canvases.clear()
    c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h })
    canvases.set(k, c)
  }
  const ctx = c.getContext('2d') as Ctx2
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, w, h)
  return { c, ctx }
}

/** Karaoke (Phase 5): word timings come from a reviewed transcript. Until a source is set nothing is highlighted —
 * no timings are ever made up here. The source returns a frame per text element id for a clip at local time t. */
export type KaraokeSource = (clip: Clip, tLocal: number) => Record<string, KaraokeFrame | null> | null
let karaokeSource: KaraokeSource | null = null
export function setKaraokeSource(src: KaraokeSource | null) { karaokeSource = src }

const imageOf = (el: { brandAsset?: string; src: string | null }): CanvasImageSource | null => {
  if (el.brandAsset === 'esb-logo') return stationLogo()
  if (!el.src) return null
  const img = getCachedImage(el.src)
  return img && img.complete && img.naturalWidth > 0 ? img : null
}

function stickerOf(clip: Clip, editor: boolean): StickerDraw | null {
  const td = clip.titleData
  const st = td?.sticker
  if (!td || !st) return null
  const color = STICKER_COLORS[st.color].hex ?? titleAccent(clip) ?? '#e52d2d'
  const text = (td.fields.text ?? '').trim()
  if (st.shape === 'callout' && !text && !editor) return null
  return { shape: st.shape, color, x: st.x, y: st.y, size: st.size, rotation: st.rotation, text: text || null, placeholder: editor ? 'Callout text' : null }
}

function draw(clip: Clip, w: number, h: number, _editor: boolean, tl: number, spec: TitleSpec | null, sticker: StickerDraw | null) {
  const { c, ctx } = canvasFor(w, h)
  if (sticker) drawSticker(ctx, sticker, w, h, tl, titleDuration(clip), titleMeasurer())
  else if (spec) renderTitleSpec(ctx, spec, tl, { measure: titleMeasurer(), image: imageOf, layoutCache, karaoke: karaokeSource?.(clip, tl) ?? undefined })
  return { src: c as TexImageSource, width: w, height: h }
}

/** Where moving rasters were last drawn, per compositor (slot → instant + content). */
const lastDrawn = new WeakMap<GLCompositor, Map<string, string>>()

/** The texture of a title clip at timeline time t, or null when it draws nothing. Adds the slot it used (a moving
 * title) to `slots`, so the frame keeps it. */
export function titleTexture(comp: GLCompositor, clip: Clip, t: number, w: number, h: number, editor: boolean, slots: Set<string>): TexHandle | null {
  const td = clip.titleData
  if (!td && !clip.dataCard) return null
  if (td?.look === 'classic') {
    // the Phase 0–2 drawing, exactly (an old project looks as it did); never animated
    const old = legacyView(clip)
    return comp.staticTexture(rasterKey(old, w, h, editor, 0), () => { const r = rasterLayer(old, w, h, editor, 0); if (r) titleRasterStats.static++; return r })
  }
  const tl = titleLocal(clip, t)
  const sticker = td?.template === 'sticker' ? stickerOf(clip, editor) : null
  const spec = sticker ? null : titleSpecFor(clip, w, h, editor)
  if (!sticker && (!spec || !spec.elements.length)) return null
  const key = contentKey(clip, w, h, editor)
  // a karaoke highlight (Phase 5) moves with the words, so such a title is redrawn every frame
  const settled = sticker ? stickerIsStatic(tl, titleDuration(clip)) : !karaokeSource && titleIsStatic(spec!, tl, titleMeasurer())
  if (settled) return comp.staticTexture(`title|${key}|${imgState(spec)}`, () => { titleRasterStats.static++; return draw(clip, w, h, editor, tl, spec, sticker) })
  const slot = `title:${clip.id}`
  slots.add(slot)
  let seen = lastDrawn.get(comp)
  if (!seen) { seen = new Map(); lastDrawn.set(comp, seen) }
  const at = `${key}|${imgState(spec)}|${tl.toFixed(6)}`
  if (seen.get(slot) === at && comp.hasSlot(slot)) {
    // the same instant again (a paused redraw): the slot already holds it (no upload: same source object)
    const c = canvases.get(`${w}x${h}`)
    if (c) return comp.slotTexture(slot, c as TexImageSource, w, h, false)
  }
  seen.set(slot, at)
  titleRasterStats.moving++
  const r = draw(clip, w, h, editor, tl, spec, sticker)
  return comp.slotTexture(slot, r.src, w, h, true)
}

const imgState = (spec: TitleSpec | null) => (spec?.elements.some((e) => e.type === 'image') ? spec.elements.filter((e) => e.type === 'image').map((e) => (imageOf(e as { src: string | null; brandAsset?: string }) ? 1 : 0)).join('') : '')

/** The top of a bottom-anchored title (lower third, name strap, breaking, source) on screen, for the caption limit. */
export function titleTop(clip: Clip, w: number, h: number, editor: boolean): number | null {
  const td = clip.titleData
  if (!td || td.look === 'classic' || !['lower-third', 'name-strap', 'breaking', 'source'].includes(td.template)) return null
  const spec = titleSpecFor(clip, w, h, editor)
  if (!spec || !spec.elements.length) return null
  return Math.min(...spec.elements.map((e) => e.y))
}
