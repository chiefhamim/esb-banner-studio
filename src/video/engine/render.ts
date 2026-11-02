// The one render path: renderFrame(t) draws the timeline at time t into a GLCompositor's canvas. The monitor calls it
// with frames from the preview engine (cache + look-ahead, proxies); the export calls it with frames decoded exactly
// at each export frame time from the original files. Everything else — layer order, transforms, crossfades, titles,
// the bug — is decided here once, so a preview frame and an export frame are drawn the same way.
//
// Phase 2: transforms, opacity and crop are sampled each frame (keyframes, engine/animation.ts); a clip's effects and
// blend mode are resolved into the compositor's LayerFx (engine/fxResolve.ts); an adjustment layer (an overlay clip
// with `adjustment: true`) applies its effects to everything on the tracks below its own (not to clips beside it on its
// own track); footage source time follows the clip's speed (sourceTimeAt) — the frame lookup is told the clip, and
// asks animation.ts for the time itself.

import type { Clip, VideoProject } from '../timeline'
import { footageRect, layersAt } from '../timeline'
import { bugKey, captionLimit, getCachedImage, offlineKey, rasterBug, rasterKey, rasterLayer, rasterOffline } from '../compositor'
import { FX_MATTE, fxActive, type GLCompositor, type LayerDraw, type LayerFx } from './glCompositor'
import { personMatteFor } from './personMatte'
import { frameQuad, layerQuad, uvOf } from './layerMath'
import { hasKeyframes, sampleProp, srcAt } from './animation'
import { beginFxFrame, resolveFx } from './fxResolve'
import { titleTexture, titleTop, type Box } from './titleRaster'
import { legacyView } from '../titleModel'
import { DEFAULT_SAFE_ZONES } from '../titles/brand'
import { guidesKey, rasterGuides, type Guides } from './guides'

/** A footage picture for this instant: a decoded frame (ImageBitmap / VideoFrame) or, for a file the decoder cannot
 * read, its <video> element (`live`: the picture changes under the same object). */
export interface FrameInput { image: TexImageSource; width: number; height: number; live?: boolean }
export type FrameLookup = (clip: Clip) => FrameInput | null

export interface RenderOptions {
  /** The monitor: draw labels for empty fields and a "Media offline" slate. Off for an export. */
  editor?: boolean
  frames: FrameLookup
  /** Editor only: safe-zone guides drawn over the picture (never in an export). */
  guides?: Guides | null
}

export interface RenderReport {
  /** Footage layers that had a picture. */
  footage: number
  /** Footage clips under the playhead with no picture this frame (still decoding, or no file). */
  missing: string[]
}

const FULL_UV: [number, number, number, number] = [0, 0, 1, 1]

/** Source time of `clip` at timeline time `t` (its speed, ramp, reverse or freeze included). */
export const srcTime = (c: Clip, t: number) => srcAt(c, t)

/** The still's slow move: 0→6 % over the clip, so a held picture does not read as a frozen frame. */
export function kenBurnsZoom(c: Clip, t: number) {
  const p = Math.min(1, Math.max(0, (t - c.start) / Math.max(0.001, c.duration)))
  return 1 + 0.06 * (c.kenBurns === 'out' ? 1 - p : p)
}

/** The animated transform of a clip at one instant (a reused object: footageRect reads it at once). */
interface Pose { fit: Clip['fit']; scale: number; offX: number; offY: number; cropL: number; cropR: number; cropT: number; cropB: number; rotation: number; opacity: number }
const pose: Pose = { fit: undefined, scale: 1, offX: 0, offY: 0, cropL: 0, cropR: 0, cropT: 0, cropB: 0, rotation: 0, opacity: 1 }

/** Fill `pose` with the clip's transform at timeline time t: keyframes where it has them (x, y, scale, rotation,
 * opacity, crop), its static fields elsewhere. */
export function poseAt(c: Clip, t: number): Readonly<Pose> {
  pose.fit = c.fit
  if (!hasKeyframes(c)) {
    pose.scale = c.scale ?? 1; pose.offX = c.offX ?? 0; pose.offY = c.offY ?? 0
    pose.cropL = c.cropL ?? 0; pose.cropR = c.cropR ?? 0; pose.cropT = c.cropT ?? 0; pose.cropB = c.cropB ?? 0
    pose.rotation = c.rotation ?? 0; pose.opacity = c.opacity ?? 1
    return pose
  }
  const tl = t - c.start
  pose.scale = sampleProp(c, 'scale', tl, c.scale ?? 1)
  pose.offX = sampleProp(c, 'x', tl, c.offX ?? 0)
  pose.offY = sampleProp(c, 'y', tl, c.offY ?? 0)
  pose.cropL = sampleProp(c, 'cropL', tl, c.cropL ?? 0)
  pose.cropR = sampleProp(c, 'cropR', tl, c.cropR ?? 0)
  pose.cropT = sampleProp(c, 'cropT', tl, c.cropT ?? 0)
  pose.cropB = sampleProp(c, 'cropB', tl, c.cropB ?? 0)
  pose.rotation = sampleProp(c, 'rotation', tl, c.rotation ?? 0)
  pose.opacity = Math.min(1, Math.max(0, sampleProp(c, 'opacity', tl, c.opacity ?? 1)))
  return pose
}

/** An adjustment layer: an overlay clip whose effects apply to what is below it. */
/** A rectangle of the frame as a layer quad, moved and turned about the frame's anchor exactly as `frameQuad` does. */
function boxQuad(box: Box, w: number, h: number, offX = 0, offY = 0, deg = 0, ax = 0.5, ay = 0.5) {
  if (box.x === 0 && box.y === 0 && box.w === w && box.h === h) return frameQuad(w, h, offX, offY, deg, ax, ay)
  const x0 = offX * w + box.x, y0 = offY * h + box.y, x1 = x0 + box.w, y1 = y0 + box.h
  if (!deg) return [x0, y0, x1, y0, x1, y1, x0, y1] as ReturnType<typeof frameQuad>
  const px = offX * w + ax * w, py = offY * h + ay * h
  const a = (deg * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a)
  const rot = (x: number, y: number) => [px + (x - px) * cos - (y - py) * sin, py + (x - px) * sin + (y - py) * cos]
  return [...rot(x0, y0), ...rot(x1, y0), ...rot(x1, y1), ...rot(x0, y1)] as ReturnType<typeof frameQuad>
}

export const isAdjustment = (c: Clip) => (c as { adjustment?: boolean }).adjustment === true

export function renderFrame(comp: GLCompositor, project: VideoProject, t: number, w: number, h: number, opts: RenderOptions): RenderReport {
  const editor = !!opts.editor
  comp.begin(w, h)
  beginFxFrame()
  const layers = layersAt(project, t)
  // a caption sits above a lower third or strap on screen at the same time (classic titles as before; kit titles by
  // their own top edge)
  let captionBottom = captionLimit(layers.map((l) => legacyView(l.clip)), w, h, editor)
  for (const l of layers) {
    const top = l.clip.titleData ? titleTop(l.clip, w, h, editor) : null
    if (top != null) captionBottom = Math.min(captionBottom, top - 18 * (Math.min(w, h) / 1080))
  }
  // a portrait project with a safe zone keeps captions above the platform's caption / music band
  if (project.safeZone && h / w >= 1.5) captionBottom = Math.min(captionBottom, h * (1 - DEFAULT_SAFE_ZONES.platforms[project.safeZone].bottom))
  const report: RenderReport = { footage: 0, missing: [] }
  const slots = new Set<string>()
  const fxOf = (clip: Clip): LayerFx | null => resolveFx(comp, clip, t, h, project.height, false, editor)

  const drawOf = (clip: Clip, alpha: number): LayerDraw | null => {
    if (clip.kind === 'video') {
      const p = poseAt(clip, t)
      if (clip.still) {
        if (!clip.sourceUrl) return editor ? offline(clip) : null
        const img = getCachedImage(clip.sourceUrl)
        if (!img || !img.complete || !img.naturalWidth) return null
        const iw = img.naturalWidth
        const ih = img.naturalHeight
        const tex = comp.staticTexture(`img|${clip.sourceUrl}`, () => ({ src: img, width: iw, height: ih }))
        if (!tex) return null
        const r = footageRect(iw, ih, w, h, p, kenBurnsZoom(clip, t))
        return { tex, quad: layerQuad(r, p.rotation, clip.anchorX, clip.anchorY), uv: uvOf(r, iw, ih), alpha, fx: fxOf(clip) }
      }
      const f = clip.sourceUrl ? opts.frames(clip) : null
      if (!f) {
        report.missing.push(clip.id)
        return editor && !clip.sourceUrl ? offline(clip) : null
      }
      report.footage++
      slots.add(clip.id)
      const tex = comp.slotTexture(clip.id, f.image, f.width, f.height, f.live)
      const r = footageRect(f.width, f.height, w, h, p)
      const fx = fxOf(clip)
      if (fx?.wantMatte) {
        // the person matte of THIS frame (same instant, same picture), so preview and export agree
        const m = personMatteFor(clip.id, t.toFixed(5), f.image as CanvasImageSource)
        if (m) { fx.matte = m; fx.matteSlot = clip.id; fx.flags |= FX_MATTE }
        // an export never draws the layer without its matte: that would be a silent wrong frame
        else if (!editor) throw new Error('The background could not be removed for this frame, so the export was stopped. Nothing was saved.')
      }
      return { tex, quad: layerQuad(r, p.rotation, clip.anchorX, clip.anchorY), uv: uvOf(r, f.width, f.height), alpha, fx }
    }
    if (clip.kind === 'overlay' && (clip.titleData || clip.dataCard)) {
      const fx = fxOf(clip)
      // the title's texture is its bounding box; a clip with effects acting on its whole layer gets the whole frame
      const layer = titleTexture(comp, clip, t, w, h, editor, slots, project.fps, fxActive(fx))
      if (!layer) return null
      const p = poseAt(clip, t)
      return { tex: layer.tex, quad: boxQuad(layer.box, w, h, p.offX, p.offY, p.rotation, clip.anchorX, clip.anchorY), uv: FULL_UV, alpha, fx }
    }
    if (clip.kind === 'overlay' || clip.kind === 'caption') {
      const tex = comp.staticTexture(rasterKey(clip, w, h, editor, captionBottom), () => rasterLayer(clip, w, h, editor, captionBottom))
      if (!tex) return null
      const p = poseAt(clip, t)
      return { tex, quad: frameQuad(w, h, p.offX, p.offY, p.rotation, clip.anchorX, clip.anchorY), uv: FULL_UV, alpha, fx: fxOf(clip) }
    }
    return null
  }
  const offline = (clip: Clip): LayerDraw | null => {
    const tex = comp.staticTexture(offlineKey(clip, w, h), () => rasterOffline(clip, w, h))
    return tex ? { tex, quad: frameQuad(w, h), uv: FULL_UV, alpha: 1 } : null
  }
  /** A layer's opacity now: its (keyframed) opacity × the crossfade's share of layersAt's alpha. */
  const alphaOf = (clip: Clip, layerAlpha: number, progress?: number) => {
    if (!hasKeyframes(clip)) return layerAlpha
    const base = clip.opacity ?? 1
    const share = base > 0 ? layerAlpha / base : progress ?? 1
    return poseAt(clip, t).opacity * share
  }

  // the draw list; a crossfade replaces the outgoing clip's own draw with one two-input mix
  type Item = { kind: 'layer'; clip: Clip; d: LayerDraw | null } | { kind: 'mix'; clip: Clip; a: LayerDraw | null; b: LayerDraw | null; p: number } | { kind: 'adjust'; clip: Clip; fx: LayerFx | null; alpha: number }
  const items: Item[] = []
  let branded = false
  // where the current track's draws begin: an adjustment layer acts on the tracks BELOW it only, so it goes in before
  // the clips of its own track that layersAt lists first (they start earlier; they are not below it)
  let trackId: string | null = null
  let trackStart = 0
  for (const l of layers) {
    if (l.clip.trackId !== trackId) { trackId = l.clip.trackId; trackStart = items.length }
    if (l.clip.kind === 'video' && l.clip.branded) branded = true
    if (isAdjustment(l.clip)) {
      const a = alphaOf(l.clip, l.alpha)
      items.splice(trackStart++, 0, { kind: 'adjust', clip: l.clip, fx: a > 0 ? resolveFx(comp, l.clip, t, h, project.height, true, editor) : null, alpha: a })
      continue
    }
    if (l.mix) {
      const prev = items[items.length - 1]
      const b = drawOf(l.clip, alphaOf(l.clip, l.clip.opacity ?? 1))
      if (prev && prev.kind === 'layer' && prev.clip.id === l.mix.from.id) items[items.length - 1] = { kind: 'mix', clip: l.clip, a: prev.d, b, p: l.mix.progress }
      else items.push({ kind: 'layer', clip: l.clip, d: b ? { ...b, alpha: alphaOf(l.clip, l.alpha, l.mix.progress) } : null })
      continue
    }
    const a = alphaOf(l.clip, l.alpha)
    if (a <= 0) { items.push({ kind: 'layer', clip: l.clip, d: null }); continue }
    items.push({ kind: 'layer', clip: l.clip, d: drawOf(l.clip, a) })
  }
  for (const it of items) {
    if (it.kind === 'layer') { if (it.d) comp.draw(it.d) }
    else if (it.kind === 'adjust') { if (it.fx) comp.adjust(it.fx, it.alpha) }
    else if (it.b) comp.mix(it.a, it.b, it.p)
    else if (it.a) comp.draw({ ...it.a, alpha: it.a.alpha * (1 - it.p) })
  }

  // the ESB bug (top right), unless switched off, over a banner still (whose own masthead sits exactly there), or on an
  // empty timeline (nothing to brand: the monitor stays black behind the start card)
  if (project.bug !== false && !branded && project.clips.length > 0) {
    const corner = project.bugCorner ?? 'tr'
    const tex = comp.staticTexture(bugKey(w, h, corner), () => rasterBug(w, h, corner))
    if (tex) comp.draw({ tex, quad: frameQuad(w, h), uv: FULL_UV, alpha: 1 })
  }
  if (editor && opts.guides) {
    const g = opts.guides
    const tex = comp.staticTexture(guidesKey(g, w, h), () => rasterGuides(g, w, h))
    if (tex) comp.draw({ tex, quad: frameQuad(w, h), uv: FULL_UV, alpha: 1 })
  }
  comp.pruneSlots(slots)
  return report
}
