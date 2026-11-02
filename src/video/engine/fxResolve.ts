// A clip's effect list → the compositor's LayerFx for one frame: parameters read (keyframes through animation.ts),
// clamped, scaled to the output size, LUT textures made on first use. Written into pooled objects, so a frame
// allocates nothing here once its LUTs and key colours have been seen.

import type { Clip, ClipEffect } from '../timeline'
import type { EffectType } from '../effects'
import { EFFECT_DEFS, MAX_MASKS, blendIndex, cachedCube, chromaOf, hexToRgb, isEffectType, lutOf } from '../effects'
import type { NumParam } from '../effects'
import { sampleProp } from './animation'
import type { GLCompositor, LayerFx } from './glCompositor'
import { FX_COLOUR, FX_KEY, FX_LUT, FX_MASK, FX_SHARPEN, FX_VIGNETTE, newLayerFx, resetLayerFx } from './glCompositor'

/** Editor-only switches the monitor reads (not part of the project): an effect left out while its key colour is
 * being picked from the monitor. */
export const fxEditor = { skipEffect: '' }

const pool: LayerFx[] = []
let used = 0
/** Start a frame: every pooled LayerFx is free again. */
export function beginFxFrame() { used = 0 }
function take(): LayerFx {
  let fx = pool[used]
  if (!fx) { fx = newLayerFx(); pool[used] = fx }
  used++
  resetLayerFx(fx)
  return fx
}

const keyChroma = new Map<string, [number, number]>()
function chromaFor(hex: string): [number, number] {
  let c = keyChroma.get(hex)
  if (!c) { const [r, g, b] = hexToRgb(hex); c = chromaOf(r, g, b); keyChroma.set(hex, c); if (keyChroma.size > 64) keyChroma.delete(keyChroma.keys().next().value!) }
  return c
}

/** Numeric parameter definitions by type and key (looked up per frame without a search). */
const NUM: Record<string, Record<string, NumParam>> = {}
for (const [type, def] of Object.entries(EFFECT_DEFS)) { NUM[type] = {}; for (const p of def.params) if (p.kind === 'num') NUM[type][p.key] = p }
/** `fx.<id>.<key>` keyframe names, made once per effect id and key (no string building per frame). */
const kfNames = new Map<string, Record<string, string>>()
function kfName(id: string, key: string): string {
  let m = kfNames.get(id)
  if (!m) { m = {}; kfNames.set(id, m); if (kfNames.size > 512) kfNames.delete(kfNames.keys().next().value!) }
  return (m[key] ??= `fx.${id}.${key}`)
}

/** A numeric parameter at clip-local time t (keyframes under fx.<id>.<key>), clamped to its range. */
function num(c: Clip, e: ClipEffect, type: EffectType, key: string, t: number): number {
  const p = NUM[type][key]
  if (!p) return 0
  const raw = e.params?.[key]
  const base = typeof raw === 'number' && Number.isFinite(raw) ? raw : p.def
  const v = c.keyframes ? sampleProp(c, kfName(e.id, key), t, base) : base
  return Math.min(p.max, Math.max(p.min, Number.isFinite(v) ? v : p.def))
}

/** The effects of `clip` at timeline time `t` for a w×h output of a project `projectH` lines tall; null when the clip
 * has nothing to apply. `adjustment`: the clip is an adjustment layer (no chroma key there). `editor`: the monitor (an
 * effect whose key colour is being picked is left out there, never in an export). */
export function resolveFx(comp: GLCompositor, clip: Clip, t: number, h: number, projectH: number, adjustment = false, editor = false): LayerFx | null {
  const effects = clip.effects
  const blend = adjustment ? 0 : blendIndex((clip as { blendMode?: string }).blendMode)
  if ((!effects || effects.length === 0) && !blend) return null
  const fx = take()
  fx.blend = blend
  const tl = t - clip.start
  let masks = 0
  for (const e of effects ?? []) {
    if (!e || e.enabled === false || !isEffectType(e.type) || (editor && e.id === fxEditor.skipEffect)) continue
    switch (e.type) {
      case 'colour': {
        fx.col1[0] = num(clip, e, 'colour', 'exposure', tl)
        fx.col1[1] = num(clip, e, 'colour', 'contrast', tl)
        fx.col1[2] = num(clip, e, 'colour', 'saturation', tl)
        fx.col1[3] = num(clip, e, 'colour', 'vibrance', tl)
        fx.col2[0] = num(clip, e, 'colour', 'temperature', tl)
        fx.col2[1] = num(clip, e, 'colour', 'tint', tl)
        fx.col2[2] = num(clip, e, 'colour', 'highlights', tl)
        fx.col2[3] = num(clip, e, 'colour', 'shadows', tl)
        let any = false
        for (let i = 0; i < 4; i++) if (fx.col1[i] !== 0 || fx.col2[i] !== 0) any = true
        if (any) fx.flags |= FX_COLOUR
        break
      }
      case 'lut': {
        // keyed by the LUT's content id (never the multi-MB text: a Map look-up of that text hashed it)
        const id = lutOf(e)
        const mixv = num(clip, e, 'lut', 'intensity', tl)
        if (!id || mixv <= 0) break
        if (!comp.lutTexture(id, () => cachedCube(id))) break
        fx.lut = id
        fx.lutMix = mixv
        fx.flags |= FX_LUT
        break
      }
      case 'chromaKey': {
        if (adjustment) break
        const hex = typeof e.params?.color === 'string' ? e.params.color : '#00b140'
        const [cb, cr] = chromaFor(hex)
        const tol = num(clip, e, 'chromaKey', 'tolerance', tl)
        const soft = num(clip, e, 'chromaKey', 'softness', tl)
        fx.key[0] = cb
        fx.key[1] = cr
        fx.key[2] = tol * 0.4
        fx.key[3] = tol * 0.4 + soft * 0.4 + 1e-4
        fx.spill = num(clip, e, 'chromaKey', 'spill', tl)
        fx.flags |= FX_KEY
        break
      }
      case 'personMatte': {
        if (adjustment) break
        fx.wantMatte = true
        fx.matteEdge = num(clip, e, 'personMatte', 'edge', tl)
        fx.matteInvert = e.params?.keep === 'background' ? 1 : 0
        break
      }
      case 'mask': {
        if (masks >= MAX_MASKS) break
        const i = masks * 4
        fx.maskA[i] = num(clip, e, 'mask', 'x', tl)
        fx.maskA[i + 1] = num(clip, e, 'mask', 'y', tl)
        fx.maskA[i + 2] = num(clip, e, 'mask', 'w', tl) / 2
        fx.maskA[i + 3] = num(clip, e, 'mask', 'h', tl) / 2
        fx.maskB[i] = e.params?.shape === 'rect' ? 0 : 1
        fx.maskB[i + 1] = num(clip, e, 'mask', 'feather', tl)
        fx.maskB[i + 2] = e.params?.invert === true ? 1 : 0
        fx.maskB[i + 3] = 0
        masks++
        fx.flags |= FX_MASK
        break
      }
      case 'blur': {
        const r = num(clip, e, 'blur', 'radius', tl)
        // radius in pixels of the export frame; the preview monitor scales it with its own size
        fx.blur = r > 0 ? 0.5 * r * (h / Math.max(1, projectH)) : 0
        break
      }
      case 'sharpen': {
        const a = num(clip, e, 'sharpen', 'amount', tl)
        if (a > 0) { fx.sharpen = a; fx.flags |= FX_SHARPEN }
        break
      }
      case 'vignette': {
        const a = num(clip, e, 'vignette', 'amount', tl)
        if (a > 0) {
          fx.vig[0] = a
          fx.vig[1] = num(clip, e, 'vignette', 'size', tl)
          fx.vig[2] = num(clip, e, 'vignette', 'softness', tl)
          fx.flags |= FX_VIGNETTE
        }
        break
      }
    }
  }
  fx.masks = masks
  return fx
}
