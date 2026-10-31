// src/core/photoEdit.ts
// Non-destructive photo editing for the banner's photo slots: a per-pixel tone and colour pipeline (exposure, contrast,
// highlights, shadows, whites, blacks, temperature, tint, vibrance, saturation, fade, black & white), sharpening and
// grain, and flips — applied to a working copy of the photo, never to the photo itself. Vignette and blur are drawn
// on top by the renderer (they depend on the slot, not the photo). The same pipeline renders the full-size edited photo
// for "Save edited photo", so the banner and the saved file are the same pixels.

import type { PhotoAdjust, PhotoSlot } from './types'

export type { PhotoAdjust }

/** The edit in force for a slot: its `adjust` plus the five fields older documents stored on the slot itself. */
export function slotAdjust(slot: PhotoSlot | undefined): PhotoAdjust {
  if (!slot) return {}
  const a = slot.adjust ?? {}
  return {
    ...a,
    exposure: a.exposure ?? slot.brightness,
    contrast: a.contrast ?? slot.contrast,
    saturation: a.saturation ?? slot.saturation,
    temp: a.temp ?? slot.warmth,
    vignette: a.vignette ?? slot.vignette,
  }
}

const PIXEL_KEYS = ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'temp', 'tint', 'vibrance', 'saturation', 'fade', 'sharpen', 'grain'] as const

/** True when the edit changes nothing the pixel pipeline does (vignette and blur are drawn separately). */
export function pixelNeutral(a: PhotoAdjust): boolean {
  return PIXEL_KEYS.every((k) => !a[k]) && !a.mono && !a.flipX && !a.flipY
}
export function isNeutral(a: PhotoAdjust): boolean {
  return pixelNeutral(a) && !a.vignette && !a.blur
}

/** One-click looks. Each is a full edit (every value it does not name returns to zero). */
export const LOOKS: { id: string; name: string; a: PhotoAdjust }[] = [
  { id: 'natural', name: 'Natural', a: {} },
  { id: 'newsroom', name: 'Newsroom', a: { exposure: 4, contrast: 12, highlights: -18, shadows: 14, vibrance: 14, sharpen: 25 } },
  { id: 'vivid', name: 'Vivid', a: { contrast: 20, highlights: -10, shadows: 8, vibrance: 35, saturation: 10, sharpen: 20 } },
  { id: 'warm', name: 'Warm', a: { exposure: 3, contrast: 10, temp: 32, tint: 4, vibrance: 12 } },
  { id: 'golden', name: 'Golden hour', a: { exposure: 5, contrast: 14, highlights: -20, temp: 48, tint: 8, vibrance: 18, vignette: 22 } },
  { id: 'cool', name: 'Cool', a: { contrast: 12, temp: -32, tint: -4, vibrance: 8 } },
  { id: 'matte', name: 'Matte', a: { contrast: -12, fade: 40, saturation: -12, highlights: -10 } },
  { id: 'faded', name: 'Faded film', a: { contrast: -8, fade: 55, temp: 10, saturation: -24, grain: 22 } },
  { id: 'mono', name: 'Mono', a: { mono: true, contrast: 10, sharpen: 15 } },
  { id: 'noir', name: 'Noir', a: { mono: true, contrast: 42, blacks: -24, highlights: -10, vignette: 38, grain: 14 } },
  { id: 'dusk', name: 'Dusk', a: { exposure: -6, contrast: 16, temp: -18, tint: 14, vibrance: 10, vignette: 28 } },
  { id: 'crisp', name: 'Crisp', a: { contrast: 16, whites: 12, blacks: -12, sharpen: 45, vibrance: 6 } },
]

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

/** The tone curve as a 256-entry table (the same curve for R, G and B). */
function toneLut(a: PhotoAdjust): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256)
  const exp = Math.pow(2, (a.exposure ?? 0) / 100)
  const con = 1 + (a.contrast ?? 0) / 100
  const hi = (a.highlights ?? 0) / 100, sh = (a.shadows ?? 0) / 100
  const wh = (a.whites ?? 0) / 100, bl = (a.blacks ?? 0) / 100
  const fade = (a.fade ?? 0) / 100
  for (let i = 0; i < 256; i++) {
    let x = (i / 255) * exp
    x += sh * 0.28 * (1 - smooth(0, 0.55, x)) * (1 - x)        // shadows lift or sink the dark half
    x += hi * 0.28 * smooth(0.45, 1, x) * (hi < 0 ? x : 1 - x)   // highlights recover or brighten the light half
    x += bl * 0.16 * Math.pow(1 - Math.min(1, x), 3)              // blacks move the very bottom
    x += wh * 0.16 * Math.pow(Math.min(1, Math.max(0, x)), 3)     // whites move the very top
    x = (x - 0.5) * con + 0.5                                     // contrast about mid-grey
    x = x * (1 - fade * 0.22) + fade * 0.13                       // fade lifts the blacks and softens the whites
    lut[i] = Math.round(Math.min(1, Math.max(0, x)) * 255)
  }
  return lut
}

type Src = CanvasImageSource & { width: number; height: number }
const cache = new WeakMap<object, Map<string, HTMLCanvasElement>>()

/** A key for the edit's pixel part (vignette and blur are drawn later, so they do not invalidate the copy). */
function pixelKey(a: PhotoAdjust, maxEdge: number): string {
  return JSON.stringify([maxEdge, ...PIXEL_KEYS.map((k) => a[k] ?? 0), !!a.mono, !!a.flipX, !!a.flipY])
}

/**
 * The photo with the edit applied, at most `maxEdge` px on its long side (the banner never needs more: its widest
 * slot is 1920 px and exports go up to 3×). Cached per photo and per edit, so redrawing the banner is free and dragging
 * a slider re-processes only once per value.
 */
export function processedPhoto(img: Src, a: PhotoAdjust, maxEdge = 2600): Src {
  if (pixelNeutral(a) || typeof document === 'undefined') return img
  const key = pixelKey(a, maxEdge)
  let m = cache.get(img)
  if (!m) { m = new Map(); cache.set(img, m) }
  const hit = m.get(key)
  if (hit) { m.delete(key); m.set(key, hit); return hit }
  const out = renderEdit(img, a, maxEdge)
  m.set(key, out)
  while (m.size > 4) m.delete(m.keys().next().value as string)  // keep the last few (undo / redo, looks)
  return out
}

/** Apply the edit to a fresh canvas. */
export function renderEdit(img: Src, a: PhotoAdjust, maxEdge = Infinity): HTMLCanvasElement {
  const iw = (img as HTMLImageElement).naturalWidth || (img.width as number), ih = (img as HTMLImageElement).naturalHeight || (img.height as number)
  const s = Math.min(1, maxEdge / Math.max(iw, ih))
  const w = Math.max(1, Math.round(iw * s)), h = Math.max(1, Math.round(ih * s))
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.save()
  ctx.translate(a.flipX ? w : 0, a.flipY ? h : 0)
  ctx.scale(a.flipX ? -1 : 1, a.flipY ? -1 : 1)
  ctx.drawImage(img, 0, 0, w, h)
  ctx.restore()
  if (PIXEL_KEYS.every((k) => !a[k]) && !a.mono) return cv  // flips only

  const data = ctx.getImageData(0, 0, w, h)
  const px = data.data
  const lut = toneLut(a)
  const t = (a.temp ?? 0) / 100, tn = (a.tint ?? 0) / 100
  const sat = 1 + (a.saturation ?? 0) / 100, vib = (a.vibrance ?? 0) / 100
  const mono = !!a.mono
  const grain = (a.grain ?? 0) / 100
  const colour = t !== 0 || tn !== 0 || sat !== 1 || vib !== 0 || mono
  for (let i = 0; i < px.length; i += 4) {
    let r = lut[px[i]] / 255, g = lut[px[i + 1]] / 255, b = lut[px[i + 2]] / 255
    if (colour) {
      // temperature pushes red against blue, tint green against magenta; both weighted toward the mid-tones
      const L0 = 0.2126 * r + 0.7152 * g + 0.0722 * b
      const mid = 1 - Math.abs(L0 - 0.5) * 0.8
      r += t * 0.11 * mid + tn * 0.04 * mid
      g += t * 0.015 * mid - tn * 0.09 * mid
      b += -t * 0.13 * mid + tn * 0.04 * mid
      const L = 0.2126 * r + 0.7152 * g + 0.0722 * b
      if (mono) { r = g = b = L } else {
        const spread = Math.max(r, g, b) - Math.min(r, g, b)
        const f = sat * (1 + vib * (1 - Math.min(1, spread * 1.6)))   // vibrance lifts the muted colours most
        r = L + (r - L) * f; g = L + (g - L) * f; b = L + (b - L) * f
      }
    }
    if (grain) {
      // deterministic grain (the same every render, so exports match the screen)
      const n = (((i * 2654435761) >>> 0) % 1000) / 1000 - 0.5
      const d = n * grain * 0.16
      r += d; g += d; b += d
    }
    px[i] = r * 255; px[i + 1] = g * 255; px[i + 2] = b * 255
  }
  ctx.putImageData(data, 0, 0)

  const sharpen = (a.sharpen ?? 0) / 100
  if (sharpen > 0) {
    // unsharp mask: add back the difference between the photo and a softened copy
    const soft = document.createElement('canvas'); soft.width = w; soft.height = h
    const sc = soft.getContext('2d', { willReadFrequently: true })!
    sc.filter = `blur(${Math.max(0.6, Math.min(w, h) / 1400).toFixed(2)}px)`
    sc.drawImage(cv, 0, 0)
    const sd = sc.getImageData(0, 0, w, h).data
    const cur = ctx.getImageData(0, 0, w, h)
    const c = cur.data, amt = sharpen * 1.4
    for (let i = 0; i < c.length; i += 4) {
      c[i] = c[i] + (c[i] - sd[i]) * amt
      c[i + 1] = c[i + 1] + (c[i + 1] - sd[i + 1]) * amt
      c[i + 2] = c[i + 2] + (c[i + 2] - sd[i + 2]) * amt
    }
    ctx.putImageData(cur, 0, 0)
  }
  return cv
}

/** Vignette and blur at the slot: drawn by the renderer after the photo. */
export function drawVignette(ctx: CanvasRenderingContext2D, r: { x: number; y: number; w: number; h: number }, amount: number) {
  if (!amount) return
  const v = ctx.createRadialGradient(r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h) * 0.28, r.x + r.w / 2, r.y + r.h / 2, Math.max(r.w, r.h) * 0.75)
  v.addColorStop(0, 'rgba(0,0,0,0)')
  v.addColorStop(1, `rgba(0,0,0,${((amount / 100) * 0.8).toFixed(3)})`)
  ctx.fillStyle = v
  ctx.fillRect(r.x, r.y, r.w, r.h)
}

/** The edited photo at full size (capped at 6000 px), with its vignette, for "Save edited photo". */
export function editedPhotoCanvas(img: Src, a: PhotoAdjust): HTMLCanvasElement {
  const cv = renderEdit(img, a, 6000)
  const ctx = cv.getContext('2d')!
  if (a.blur) {
    const copy = document.createElement('canvas'); copy.width = cv.width; copy.height = cv.height
    const cc = copy.getContext('2d')!; cc.filter = `blur(${(a.blur * cv.width / 1080).toFixed(2)}px)`; cc.drawImage(cv, 0, 0)
    ctx.clearRect(0, 0, cv.width, cv.height); ctx.drawImage(copy, 0, 0)
  }
  drawVignette(ctx, { x: 0, y: 0, w: cv.width, h: cv.height }, a.vignette ?? 0)
  return cv
}
