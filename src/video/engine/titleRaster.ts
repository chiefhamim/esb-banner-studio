// Title clips on the GPU: a title is drawn with Canvas 2D (titles/render.ts renderTitleSpec, stickers.ts) into a canvas
// the size of the title's own bounding box (not the frame) and uploaded as a texture that is drawn as a quad at the
// box's place. A lower third costs a strip of the frame, not 8 MB (1080p) or 33 MB (4K) per frame and per texture.
//
//   static   while nothing moves (titleIsStatic: after every in phase has settled and before the first out phase) the
//            raster is made once and kept by content (words, look, accent, frame size, editor/export, fonts) in the
//            compositor's static cache — scrubbing or playing over a settled title redraws nothing;
//   moving   during an in or out phase (or a count-up) the raster is redrawn for each new FRAME of the project (the
//            instant is quantised to the project's frame time, so a display refreshing faster than the project's frame
//            rate does not redraw the same picture) into one slot texture per clip (re-uploaded; the slot is pruned
//            when the clip leaves the screen).
//
// The monitor and the export call this through the same renderFrame, so an animated title's frame at t is the same
// picture in both. Classic (migrated Phase 0–2) titles are drawn by compositor.ts's old overlay code, unchanged.
// Drawing never throws out of here: a title that cannot be drawn is logged once and left out of the frame; the export
// check (titleClip.ts titleProblems) draws it first and refuses the export with a named problem.

import type { Clip } from '../timeline'
import { fontEpochNow, getCachedImage, rasterKey, rasterLayer, stationLogo } from '../compositor'
import { legacyView, STICKER_COLORS, titleDuration, titleLocal } from '../titleModel'
import { buildTitleSpec, titleAccent } from '../titleClip'
import { titleMeasurer } from '../titleMeasure'
import { phaseLength } from '../titles/anim'
import { clean } from '../titles/kit'
import { createLayoutCache, type Measurer } from '../titles/layout'
import { layoutOf, renderTitleSpec, titleIsStatic } from '../titles/render'
import type { TitleElement, TitleSpec } from '../titles/spec'
import type { KaraokeFrame } from '../titles/draw'
import { drawSticker, stickerIsStatic, type StickerDraw } from '../titles/stickers'
import type { GLCompositor, TexHandle } from './glCompositor'

export { titleMeasurer }

type Ctx2 = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** How many times a title raster was drawn (tests: a static title once, a moving one once per new frame). */
export const titleRasterStats = { static: 0, moving: 0, reset() { this.static = 0; this.moving = 0 } }

/** A rectangle of the frame in pixels. */
export interface Box { x: number; y: number; w: number; h: number }

// the layout cache is keyed by measurer (layout.ts), so it follows the measurer that titleMeasurer() remakes when fonts load
const layoutCache = createLayoutCache()

// ------------------------------------------------------------------ specs, by content

const specs = new Map<string, TitleSpec | null>()
let specEpoch = -1
const contentKey = (clip: Clip, w: number, h: number, editor: boolean) =>
  JSON.stringify([clip.titleData ?? clip.dataCard, titleAccent(clip), titleDuration(clip), w, h, editor, fontEpochNow(), stationLogo() ? 1 : 0])

/** The clip's spec for this frame size (cached by content; dropped when fonts arrive). */
export function titleSpecFor(clip: Clip, w: number, h: number, editor: boolean): TitleSpec | null {
  const m = titleMeasurer()
  const e = fontEpochNow()
  if (e !== specEpoch) { specs.clear(); bounds = new WeakMap(); specEpoch = e }
  const k = contentKey(clip, w, h, editor)
  if (specs.has(k)) { const v = specs.get(k)!; specs.delete(k); specs.set(k, v); return v }
  const spec = buildTitleSpec(clip, w, h, editor, m)
  specs.set(k, spec)
  if (specs.size > 96) specs.delete(specs.keys().next().value!)
  return spec
}

// ------------------------------------------------------------------ bounding box

let bounds = new WeakMap<TitleSpec, Box>()

/** How far an element's animation or style can draw outside its own rectangle (px). */
function reach(el: TitleElement, s: number): number {
  let r = 0
  for (const ph of [el.anim?.in, el.anim?.out]) {
    if (!ph) continue
    if (ph.effects.includes('slide')) r = Math.max(r, ph.distance ?? 24)
    if (ph.effects.includes('blur')) r = Math.max(r, 3 * (ph.blurPx ?? 12))
  }
  if (el.type === 'text') {
    const st = el.style
    if (st.shadow) r = Math.max(r, st.shadow.blur * 2 + Math.max(Math.abs(st.shadow.dx), Math.abs(st.shadow.dy)))
    if (st.stroke) r = Math.max(r, st.stroke.width * 2)
    if (st.box) r = Math.max(r, st.box.padX + st.box.padY)
    if (el.font.italic) r = Math.max(r, el.font.lineHeight * 0.25)
  }
  // a scale effect (overshoot easings) grows a unit a little past its box
  const grows = [el.anim?.in, el.anim?.out].some((ph) => ph?.effects.includes('scale'))
  const size = el.type === 'text' ? el.font.lineHeight * 2 : Math.max(el.w, el.h)
  if (grows) r = Math.max(r, size * 0.12)
  return r + 6 * s
}

/** The rectangle of the frame a title can touch over its whole life: its elements' boxes plus how far their motion and
 * style reach, clipped to the frame and rounded outward. */
export function titleBounds(spec: TitleSpec, w: number, h: number, measure: Measurer): Box {
  const hit = bounds.get(spec)
  if (hit) return hit
  const s = Math.min(w, h) / 1080
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const el of spec.elements) {
    const r = reach(el, s)
    const eh = el.type === 'text' ? layoutOf(el, measure).height : el.h
    x0 = Math.min(x0, el.x - r); y0 = Math.min(y0, el.y - r)
    x1 = Math.max(x1, el.x + el.w + r); y1 = Math.max(y1, el.y + eh + r)
  }
  const box: Box = Number.isFinite(x0)
    ? { x: Math.max(0, Math.floor(x0)), y: Math.max(0, Math.floor(y0)), w: 0, h: 0 }
    : { x: 0, y: 0, w: 0, h: 0 }
  if (Number.isFinite(x0)) { box.w = Math.max(1, Math.min(w, Math.ceil(x1)) - box.x); box.h = Math.max(1, Math.min(h, Math.ceil(y1)) - box.y) }
  bounds.set(spec, box)
  return box
}

// ------------------------------------------------------------------ canvases

const canvases = new Map<string, HTMLCanvasElement | OffscreenCanvas>()
function canvasFor(w: number, h: number) {
  const k = `${w}x${h}`
  let c = canvases.get(k)
  if (!c) {
    if (canvases.size > 12) canvases.clear()
    c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h })
    canvases.set(k, c)
  }
  const ctx = c.getContext('2d') as Ctx2
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, w, h)
  return { c, ctx, k }
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
  const text = clean(td.fields.text)
  if (st.shape === 'callout' && !text && !editor) return null
  return { shape: st.shape, color, x: st.x, y: st.y, size: st.size, rotation: st.rotation, text: text || null, placeholder: editor ? 'Callout text' : null }
}

const failed = new Set<string>()
/** Say once (per clip and message) that a title could not be drawn; the frame goes on without it. */
function failedOnce(clip: Clip, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  const k = `${clip.id}|${msg}`
  if (failed.has(k)) return
  failed.add(k)
  console.error(`[video] title ${clip.id} could not be drawn: ${msg}`)
}

/** Draw the title into a canvas of `box` size (translated, so the elements keep their frame coordinates). */
function draw(clip: Clip, box: Box, w: number, h: number, tl: number, spec: TitleSpec | null, sticker: StickerDraw | null) {
  const { c, ctx } = canvasFor(box.w, box.h)
  ctx.translate(-box.x, -box.y)
  if (sticker) drawSticker(ctx, sticker, w, h, tl, titleDuration(clip), titleMeasurer())
  else if (spec) renderTitleSpec(ctx, spec, tl, { measure: titleMeasurer(), image: imageOf, layoutCache, karaoke: karaokeSource?.(clip, tl) ?? undefined })
  return { src: c as TexImageSource, width: box.w, height: box.h }
}

/** What the compositor draws: the texture and where in the frame it goes. */
export interface TitleLayer { tex: TexHandle; box: Box }

/** Where moving rasters were last drawn, per compositor (slot → instant + content). */
const lastDrawn = new WeakMap<GLCompositor, Map<string, string>>()
const epochOf = new WeakMap<GLCompositor, number>()

/** The instant on the project's frame grid at or before t (a hair of tolerance for floating-point: frame i/fps is frame i). */
export const frameTime = (t: number, fps: number) => (fps > 0 ? Math.floor(t * fps + 1e-6) / fps : t)

/** The texture of a title clip at timeline time t, or null when it draws nothing. Adds the slot it used (a moving
 * title) to `slots`, so the frame keeps it. `full` asks for a frame-sized texture (a clip with effects that act on its
 * whole layer). */
export function titleTexture(comp: GLCompositor, clip: Clip, t: number, w: number, h: number, editor: boolean, slots: Set<string>, fps = 30, full = false): TitleLayer | null {
  const td = clip.titleData
  if (!td && !clip.dataCard) return null
  const whole: Box = { x: 0, y: 0, w, h }
  if (td?.look === 'classic') {
    // the Phase 0–2 drawing, exactly (an old project looks as it did); never animated
    const old = legacyView(clip)
    const tex = comp.staticTexture(rasterKey(old, w, h, editor, 0), () => { const r = rasterLayer(old, w, h, editor, 0); if (r) titleRasterStats.static++; return r })
    return tex ? { tex, box: whole } : null
  }
  const epoch = fontEpochNow()
  if (epochOf.get(comp) !== epoch) {
    // fonts arrived: the title textures made before are stale and never drawn again, so free them now
    comp.evictStatics((k) => k.startsWith('title|') && !k.startsWith(`title|e${epoch}|`))
    epochOf.set(comp, epoch)
  }
  const tl = frameTime(titleLocal(clip, t), fps)
  const sticker = td?.template === 'sticker' ? stickerOf(clip, editor) : null
  let spec: TitleSpec | null
  try { spec = sticker ? null : titleSpecFor(clip, w, h, editor) } catch (e) { failedOnce(clip, e); return null }
  if (!sticker && (!spec || !spec.elements.length)) return null
  const measure = titleMeasurer()
  let box = whole
  if (!sticker && !full) { try { box = titleBounds(spec!, w, h, measure) } catch (e) { failedOnce(clip, e); return null } }
  const key = contentKey(clip, w, h, editor)
  // a karaoke highlight (Phase 5) moves with the words, so such a title is redrawn every frame
  let settled: boolean
  try { settled = sticker ? stickerIsStatic(tl, titleDuration(clip)) : !karaokeSource && titleIsStatic(spec!, tl, measure) } catch (e) { failedOnce(clip, e); return null }
  const boxKey = `${box.x},${box.y},${box.w},${box.h}`
  if (settled) {
    const sk = `title|e${epoch}|${key}|${imgState(spec)}|${boxKey}`
    if (failed.has(sk)) return null
    const tex = comp.staticTexture(sk, () => {
      try { const r = draw(clip, box, w, h, tl, spec, sticker); titleRasterStats.static++; return r } catch (e) { failedOnce(clip, e); failed.add(sk); return null }
    })
    return tex ? { tex, box } : null
  }
  const slot = `title:${clip.id}`
  slots.add(slot)
  let seen = lastDrawn.get(comp)
  if (!seen) { seen = new Map(); lastDrawn.set(comp, seen) }
  const at = `${key}|${imgState(spec)}|${boxKey}|${tl.toFixed(6)}`
  if (seen.get(slot) === at && comp.hasSlot(slot)) {
    // the same instant again (a paused redraw, or a display refreshing faster than the project's frame rate): the
    // slot already holds it (no upload: same source object)
    const c = canvases.get(`${box.w}x${box.h}`)
    if (c) return { tex: comp.slotTexture(slot, c as TexImageSource, box.w, box.h, false), box }
  }
  seen.set(slot, at)
  titleRasterStats.moving++
  try {
    const r = draw(clip, box, w, h, tl, spec, sticker)
    return { tex: comp.slotTexture(slot, r.src, r.width, r.height, true), box }
  } catch (e) {
    failedOnce(clip, e)
    seen.delete(slot)
    return null
  }
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

// kept for the engine's tests: the longest an element's in phase runs, so a probe can find where motion ends
export const phaseEnd = phaseLength
