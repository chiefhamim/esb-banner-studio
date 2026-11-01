// The one render path: renderFrame(t) draws the timeline at time t into a GLCompositor's canvas. The monitor calls it
// with frames from the preview engine (cache + look-ahead, proxies); the export calls it with frames decoded exactly
// at each export frame time from the original files. Everything else — layer order, transforms, crossfades, titles,
// the bug — is decided here once, so a preview frame and an export frame are drawn the same way.

import type { Clip, VideoProject } from '../timeline'
import { footageRect, layersAt } from '../timeline'
import { bugKey, captionLimit, getCachedImage, offlineKey, rasterBug, rasterKey, rasterLayer, rasterOffline } from '../compositor'
import type { GLCompositor, LayerDraw } from './glCompositor'
import { frameQuad, layerQuad, uvOf } from './layerMath'

/** A footage picture for this instant: a decoded frame (ImageBitmap / VideoFrame) or, for a file the decoder cannot
 * read, its <video> element (`live`: the picture changes under the same object). */
export interface FrameInput { image: TexImageSource; width: number; height: number; live?: boolean }
export type FrameLookup = (clip: Clip) => FrameInput | null

export interface RenderOptions {
  /** The monitor: draw labels for empty fields and a "Media offline" slate. Off for an export. */
  editor?: boolean
  frames: FrameLookup
}

export interface RenderReport {
  /** Footage layers that had a picture. */
  footage: number
  /** Footage clips under the playhead with no picture this frame (still decoding, or no file). */
  missing: string[]
}

const FULL_UV: [number, number, number, number] = [0, 0, 1, 1]

/** Source time of `clip` at timeline time `t`. */
export const srcTime = (c: Clip, t: number) => Math.max(0, (c.in || 0) + (t - c.start))

/** The still's slow move: 0→6 % over the clip, so a held picture does not read as a frozen frame. */
export function kenBurnsZoom(c: Clip, t: number) {
  const p = Math.min(1, Math.max(0, (t - c.start) / Math.max(0.001, c.duration)))
  return 1 + 0.06 * (c.kenBurns === 'out' ? 1 - p : p)
}

export function renderFrame(comp: GLCompositor, project: VideoProject, t: number, w: number, h: number, opts: RenderOptions): RenderReport {
  const editor = !!opts.editor
  comp.begin(w, h)
  const layers = layersAt(project, t)
  const captionBottom = captionLimit(layers.map((l) => l.clip), w, h, editor)
  const report: RenderReport = { footage: 0, missing: [] }
  const slots = new Set<string>()

  const drawOf = (clip: Clip, alpha: number): LayerDraw | null => {
    if (clip.kind === 'video') {
      if (clip.still) {
        if (!clip.sourceUrl) return editor ? offline(clip) : null
        const img = getCachedImage(clip.sourceUrl)
        if (!img || !img.complete || !img.naturalWidth) return null
        const iw = img.naturalWidth
        const ih = img.naturalHeight
        const tex = comp.staticTexture(`img|${clip.sourceUrl}`, () => ({ src: img, width: iw, height: ih }))
        if (!tex) return null
        const r = footageRect(iw, ih, w, h, clip, kenBurnsZoom(clip, t))
        return { tex, quad: layerQuad(r, clip.rotation, clip.anchorX, clip.anchorY), uv: uvOf(r, iw, ih), alpha }
      }
      const f = clip.sourceUrl ? opts.frames(clip) : null
      if (!f) {
        report.missing.push(clip.id)
        return editor && !clip.sourceUrl ? offline(clip) : null
      }
      report.footage++
      slots.add(clip.id)
      const tex = comp.slotTexture(clip.id, f.image, f.width, f.height, f.live)
      const r = footageRect(f.width, f.height, w, h, clip)
      return { tex, quad: layerQuad(r, clip.rotation, clip.anchorX, clip.anchorY), uv: uvOf(r, f.width, f.height), alpha }
    }
    if (clip.kind === 'overlay' || clip.kind === 'caption') {
      const tex = comp.staticTexture(rasterKey(clip, w, h, editor, captionBottom), () => rasterLayer(clip, w, h, editor, captionBottom))
      if (!tex) return null
      return { tex, quad: frameQuad(w, h, clip.offX, clip.offY, clip.rotation, clip.anchorX, clip.anchorY), uv: FULL_UV, alpha }
    }
    return null
  }
  const offline = (clip: Clip): LayerDraw | null => {
    const tex = comp.staticTexture(offlineKey(clip, w, h), () => rasterOffline(clip, w, h))
    return tex ? { tex, quad: frameQuad(w, h), uv: FULL_UV, alpha: 1 } : null
  }

  // the draw list; a crossfade replaces the outgoing clip's own draw with one two-input mix
  type Item = { kind: 'layer'; clip: Clip; d: LayerDraw | null } | { kind: 'mix'; clip: Clip; a: LayerDraw | null; b: LayerDraw | null; p: number }
  const items: Item[] = []
  let branded = false
  for (const l of layers) {
    if (l.clip.kind === 'video' && l.clip.branded) branded = true
    if (l.mix) {
      const prev = items[items.length - 1]
      const b = drawOf(l.clip, l.clip.opacity ?? 1)
      if (prev && prev.kind === 'layer' && prev.clip.id === l.mix.from.id) items[items.length - 1] = { kind: 'mix', clip: l.clip, a: prev.d, b, p: l.mix.progress }
      else items.push({ kind: 'layer', clip: l.clip, d: b ? { ...b, alpha: l.alpha } : null })
      continue
    }
    if (l.alpha <= 0) { items.push({ kind: 'layer', clip: l.clip, d: null }); continue }
    items.push({ kind: 'layer', clip: l.clip, d: drawOf(l.clip, l.alpha) })
  }
  for (const it of items) {
    if (it.kind === 'layer') { if (it.d) comp.draw(it.d) }
    else if (it.b) comp.mix(it.a, it.b, it.p)
    else if (it.a) comp.draw({ ...it.a, alpha: it.a.alpha * (1 - it.p) })
  }

  // the ESB bug (top right), unless switched off, over a banner still (whose own masthead sits exactly there), or on an
  // empty timeline (nothing to brand: the monitor stays black behind the start card)
  if (project.bug !== false && !branded && project.clips.length > 0) {
    const tex = comp.staticTexture(bugKey(w, h), () => rasterBug(w, h))
    if (tex) comp.draw({ tex, quad: frameQuad(w, h), uv: FULL_UV, alpha: 1 })
  }
  comp.pruneSlots(slots)
  return report
}
