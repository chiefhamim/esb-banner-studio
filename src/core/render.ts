import { getCollage } from './collage'
import { drawVignette, processedPhoto, slotAdjust } from './photoEdit'
import { figmaGradient, rgba } from './gradient'
import { drawText, layoutText } from './text'
import type { Backdrop, El, IconEl, PhotoSlot, PhotosEl, RectEl, Scene, WatermarkEl } from './types'
import type { IconPathDef } from './tokens'

type Ctx = CanvasRenderingContext2D

/** Decoded images by key. */
export type Assets = Record<string, CanvasImageSource & { width: number; height: number }>

function pathRoundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  if (r > 0) ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2))
  else ctx.rect(x, y, w, h)
}

/** Canvas shadows ignore the transform, so scale blur/offset by the current zoom to stay proportional. */
function applyShadow(ctx: Ctx, sh: { x: number; y: number; blur: number; color: string; alpha: number }) {
  const k = ctx.getTransform().a
  ctx.shadowColor = rgba(sh.color, sh.alpha)
  ctx.shadowBlur = sh.blur * k
  ctx.shadowOffsetX = sh.x * k
  ctx.shadowOffsetY = sh.y * k
}

function drawRect(ctx: Ctx, el: RectEl) {
  ctx.save()
  if (el.shadow) applyShadow(ctx, el.shadow)
  ctx.fillStyle = typeof el.fill === 'string' ? el.fill : figmaGradient(ctx, el.fill, el.x, el.y, el.w, el.h)
  pathRoundRect(ctx, el.x, el.y, el.w, el.h, el.radius)
  ctx.fill()
  ctx.restore()
  if (el.pattern && el.pattern.alpha > 0) drawPattern(ctx, el)
  if (el.stroke && el.stroke.width > 0) {
    ctx.save()
    ctx.strokeStyle = el.stroke.color
    ctx.lineWidth = el.stroke.width
    // inside stroke: inset the path by half the width so the outline stays within the box
    const i = el.stroke.width / 2
    pathRoundRect(ctx, el.x + i, el.y + i, Math.max(0, el.w - i * 2), Math.max(0, el.h - i * 2), Math.max(0, el.radius - i))
    ctx.stroke()
    ctx.restore()
  }
}

/** A fine pattern over a rect's fill, drawn in banner units so it exports at any scale. Grain is a fixed-seed noise,
 *  so the same card always gets the same grain (no flicker between renders). */
function drawPattern(ctx: Ctx, el: RectEl) {
  const p = el.pattern!
  const step = Math.max(6, 28 * p.scale)
  ctx.save()
  pathRoundRect(ctx, el.x, el.y, el.w, el.h, el.radius)
  ctx.clip()
  ctx.globalAlpha *= Math.min(1, p.alpha)
  ctx.fillStyle = p.color
  ctx.strokeStyle = p.color
  ctx.lineWidth = Math.max(1, step * 0.06)
  const x0 = el.x, y0 = el.y, x1 = el.x + el.w, y1 = el.y + el.h
  if (p.kind === 'dots') {
    const r = Math.max(1, step * 0.09)
    for (let y = y0 + step / 2; y < y1; y += step) for (let x = x0 + step / 2; x < x1; x += step) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill() }
  } else if (p.kind === 'lines' || p.kind === 'grid') {
    ctx.beginPath()
    for (let y = y0 + step; y < y1; y += step) { ctx.moveTo(x0, y); ctx.lineTo(x1, y) }
    if (p.kind === 'grid') for (let x = x0 + step; x < x1; x += step) { ctx.moveTo(x, y0); ctx.lineTo(x, y1) }
    ctx.stroke()
  } else if (p.kind === 'diagonal') {
    ctx.beginPath()
    for (let d = -el.h; d < el.w; d += step) { ctx.moveTo(x0 + d, y1); ctx.lineTo(x0 + d + el.h, y0) }
    ctx.stroke()
  } else if (p.kind === 'grain') {
    let seed = 1234567
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    const g = Math.max(1.5, step * 0.08), n = Math.min(60000, Math.round((el.w * el.h) / (g * g * 6)))
    for (let i = 0; i < n; i++) { ctx.globalAlpha = Math.min(1, p.alpha) * rnd(); ctx.fillRect(x0 + rnd() * el.w, y0 + rnd() * el.h, g, g) }
  }
  ctx.restore()
}

const pathCache = new Map<string, Path2D>()
function getPath2D(d: string): Path2D {
  let p = pathCache.get(d)
  if (!p) {
    if (pathCache.size > 512) pathCache.clear()
    p = new Path2D(d)
    pathCache.set(d, p)
  }
  return p
}

export function drawPaths(ctx: Ctx | OffscreenCanvasRenderingContext2D, paths: IconPathDef[], inkColor?: string) {
  for (const p of paths) {
    const path = getPath2D(p.d)
    if (p.fill) {
      ctx.globalAlpha *= p.fillOpacity ?? 1
      ctx.fillStyle = p.fill
      ctx.fill(path)
      ctx.globalAlpha /= p.fillOpacity ?? 1
    }
    if (p.stroke) {
      ctx.strokeStyle = p.stroke === '$ink' ? (inkColor ?? '#fff') : p.stroke
      ctx.lineWidth = p.strokeWidth ?? 1
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.stroke(path)
    }
  }
}

function drawIcon(ctx: Ctx, el: IconEl & { ink?: string }) {
  ctx.save()
  ctx.translate(el.x, el.y)
  ctx.scale(el.w / el.vw, el.h / el.vh)
  drawPaths(ctx, el.paths, (el as { ink?: string }).ink)
  ctx.restore()
}

function drawImageFit(ctx: Ctx, img: Assets[string], x: number, y: number, w: number, h: number, mode: 'contain' | 'cover') {
  const s = mode === 'contain' ? Math.min(w / img.width, h / img.height) : Math.max(w / img.width, h / img.height)
  const dw = img.width * s
  const dh = img.height * s
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
}

export function slotRects(el: PhotosEl) {
  return getCollage(el.collage).layout(el.w, el.h, el.gap).map((r) => ({ x: el.x + r.x, y: el.y + r.y, w: r.w, h: r.h }))
}

/** Blurred, slightly darkened copy of a photo that fills a slot: cached per photo + slot size (small canvas, so blurring it is cheap). */
const backdropCache = new WeakMap<object, Map<string, HTMLCanvasElement>>()
function blurredBackdrop(img: Assets[string], w: number, h: number): HTMLCanvasElement {
  let m = backdropCache.get(img)
  if (!m) { m = new Map(); backdropCache.set(img, m) }
  const key = `${Math.round(w)}x${Math.round(h)}`
  const hit = m.get(key)
  if (hit) return hit
  const k = 0.2
  const c = document.createElement('canvas')
  c.width = Math.max(8, Math.round(w * k))
  c.height = Math.max(8, Math.round(h * k))
  const x = c.getContext('2d')!
  const s = Math.max(c.width / img.width, c.height / img.height) * 1.2
  x.filter = 'blur(5px)'
  x.drawImage(img, (c.width - img.width * s) / 2, (c.height - img.height * s) / 2, img.width * s, img.height * s)
  x.filter = 'none'
  x.fillStyle = 'rgba(0,0,0,0.28)'
  x.fillRect(0, 0, c.width, c.height)
  if (m.size > 24) m.clear()
  m.set(key, c)
  return c
}

/**
 * One photo slot, exactly as the banner paints it: cover-scale × zoom, pan across the overflow, the backdrop when zoomed
 * out past the edges, then the non-destructive tone filters and vignette. Shared with the Editorial desk's featured-image
 * editor so its preview is the same pixels Graphics renders, not a CSS approximation.
 */
export function drawSlotImage(ctx: Ctx, img: Assets[string], slot: PhotoSlot, r: { x: number; y: number; w: number; h: number }, backdrop: Backdrop, tint: string) {
  const s = Math.max(r.w / img.width, r.h / img.height) * (slot.zoom || 1)
  const dw = img.width * s
  const dh = img.height * s
  const ox = dw - r.w
  const oy = dh - r.h
  const dx = r.x - (0.5 + slot.panX * 0.5) * ox
  const dy = r.y - (0.5 + slot.panY * 0.5) * oy
  // zoomed out past the slot edges: paint the chosen backdrop first
  if (dw < r.w - 0.5 || dh < r.h - 0.5) {
    const mode = backdrop
    if (mode === 'blur') { ctx.imageSmoothingQuality = 'high'; ctx.drawImage(blurredBackdrop(img, r.w, r.h), r.x, r.y, r.w, r.h) }
    else { ctx.fillStyle = mode === 'black' ? '#000000' : mode === 'white' ? '#ffffff' : tint; ctx.fillRect(r.x, r.y, r.w, r.h) }
  }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  // the photo editor's pixel work is done once on a cached copy (photoEdit.ts); blur and vignette belong to the slot
  const a = slotAdjust(slot)
  const pic = processedPhoto(img, a)
  if (a.blur) ctx.filter = `blur(${(a.blur * Math.max(r.w, r.h) / 1080).toFixed(2)}px)`
  ctx.drawImage(pic, dx, dy, dw, dh)
  ctx.filter = 'none'
  drawVignette(ctx, r, a.vignette ?? 0)
}

function drawPhotos(ctx: Ctx, el: PhotosEl, assets: Assets) {
  ctx.fillStyle = el.gapColor
  ctx.fillRect(el.x, el.y, el.w, el.h)
  const rects = slotRects(el)
  rects.forEach((r, i) => {
    const slot = el.slots[i]
    ctx.save()
    ctx.beginPath()
    ctx.rect(r.x, r.y, r.w, r.h)
    ctx.clip()
    const img = slot?.src ? assets[slot.src] : undefined
    if (!img) {
      ctx.fillStyle = el.tint
      ctx.fillRect(r.x, r.y, r.w, r.h)
    } else {
      drawSlotImage(ctx, img, slot, r, el.backdrop ?? 'blur', el.tint)
    }
    ctx.restore()
  })
}

const wmArtCache = new Map<string, HTMLCanvasElement>()
function getWatermarkArt(el: WatermarkEl): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  const key = `${el.paths.map((p) => p.d).join('|')}|${el.color}|${el.size}|${el.strokeWidth}`
  let art = wmArtCache.get(key)
  if (!art) {
    art = document.createElement('canvas')
    art.width = art.height = Math.ceil(el.size)
    const a = art.getContext('2d')!
    const k = el.size / 26
    a.scale(k, k)
    a.strokeStyle = el.color
    a.lineWidth = el.strokeWidth / k
    a.lineCap = 'round'
    a.lineJoin = 'round'
    for (const p of el.paths) a.stroke(getPath2D(p.d))
    if (wmArtCache.size > 16) wmArtCache.clear()
    wmArtCache.set(key, art)
  }
  return art
}

function buildWatermark(el: WatermarkEl): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  const off = document.createElement('canvas')
  off.width = Math.ceil(el.w)
  off.height = Math.ceil(el.h)
  const c = off.getContext('2d')!
  // artwork frame (clips its own strokes), drawn on its own canvas so the blur can spread past the frame edge
  const art = getWatermarkArt(el)
  if (!art) return null
  // Figma layer blur radius r == gaussian sigma r / 2
  if (el.blur) c.filter = `blur(${el.blur / 2}px)`
  c.drawImage(art, el.ox, el.oy)
  c.filter = 'none'
  c.globalCompositeOperation = 'destination-in'
  c.fillStyle = figmaGradient(c, el.mask, 0, 0, el.w, el.h)
  c.fillRect(0, 0, el.w, el.h)
  return off
}

const wmCache = new Map<string, HTMLCanvasElement>()
function drawWatermark(ctx: Ctx, el: WatermarkEl) {
  const key = JSON.stringify([el.paths.map((p) => p.d), el.color, el.size, el.strokeWidth, el.blur ?? 0, el.ox, el.oy, Math.ceil(el.w), Math.ceil(el.h), el.mask])
  let off = wmCache.get(key)
  if (!off) {
    const built = buildWatermark(el)
    if (!built) return
    off = built
    if (wmCache.size > 8) wmCache.clear()
    wmCache.set(key, off)
  }
  ctx.save()
  ctx.globalAlpha *= el.maxOpacity
  ctx.drawImage(off, el.x, el.y)
  ctx.restore()
}

export function drawElement(ctx: Ctx, el: El, assets: Assets) {
  if (!el.visible) return
  ctx.save()
  ctx.globalAlpha = el.opacity
  if (el.dropShadow && (el.kind === 'text' || el.kind === 'icon' || el.kind === 'rect')) applyShadow(ctx, el.dropShadow)
  switch (el.kind) {
    case 'rect': drawRect(ctx, el); break
    case 'text': {
      if (el.bgPill && el.bgPill.alpha > 0 && el.text.trim()) {
        const p = el.bgPill
        const lay = layoutText(ctx, el)
        const contentW = el.fit === 'box' && el.align === 'center'
          ? Math.max(120, Math.min(el.w, lay.width))
          : el.w
        const contentX = el.fit === 'box' && el.align === 'center'
          ? el.x + (el.w - contentW) / 2
          : el.x
        const bx = contentX - p.padX
        const by = el.y - p.padY
        const bw = contentW + p.padX * 2
        const bh = el.h + p.padY * 2
        ctx.save()
        applyShadow(ctx, { x: 0, y: 8, blur: 24, color: '#000000', alpha: Math.min(0.45, p.alpha * 0.6) })
        ctx.fillStyle = rgba(p.color, p.alpha)
        pathRoundRect(ctx, bx, by, bw, bh, p.radius)
        ctx.fill()
        ctx.restore()
        if (p.border) {
          ctx.save()
          ctx.strokeStyle = rgba(p.border, Math.min(0.85, p.alpha + 0.15))
          ctx.lineWidth = 2
          pathRoundRect(ctx, bx + 1, by + 1, Math.max(0, bw - 2), Math.max(0, bh - 2), Math.max(0, p.radius - 1))
          ctx.stroke()
          ctx.restore()
        }
      }
      drawText(ctx, el)
      break
    }
    case 'icon': drawIcon(ctx, el); break
    case 'image': {
      const img = assets[el.src]
      if (img) {
        if (el.dropShadow) applyShadow(ctx, el.dropShadow)
        const shapePath = (inset: number) => {
          ctx.beginPath()
          if (el.shape === 'circle') ctx.ellipse(el.x + el.w / 2, el.y + el.h / 2, Math.max(0, el.w / 2 - inset), Math.max(0, el.h / 2 - inset), 0, 0, Math.PI * 2)
          else if (el.shape === 'rounded') ctx.roundRect(el.x + inset, el.y + inset, Math.max(0, el.w - inset * 2), Math.max(0, el.h - inset * 2), Math.max(0, (el.radius ?? 16) - inset))
          else ctx.rect(el.x + inset, el.y + inset, Math.max(0, el.w - inset * 2), Math.max(0, el.h - inset * 2))
        }
        if (el.shape && el.shape !== 'rect' && el.dropShadow) {
          // the shadow follows the shape, not the picture's square box
          ctx.save(); ctx.fillStyle = '#000'; shapePath(0); ctx.fill(); ctx.restore()
        }
        ctx.save()
        if (el.shape && el.shape !== 'rect') ctx.shadowColor = 'transparent'
        shapePath(0); ctx.clip()
        drawImageFit(ctx, img, el.x, el.y, el.w, el.h, el.fit)
        ctx.restore()
        if (el.stroke && el.stroke.width > 0) { ctx.shadowColor = 'transparent'; ctx.strokeStyle = el.stroke.color; ctx.lineWidth = el.stroke.width; shapePath(el.stroke.width / 2); ctx.stroke() }
      }
      break
    }
    case 'photos': drawPhotos(ctx, el, assets); break
    case 'watermark': drawWatermark(ctx, el); break
  }
  ctx.restore()
}

export function renderScene(ctx: Ctx, scene: Scene, assets: Assets) {
  ctx.save()
  if (scene.background && scene.background !== 'transparent' && scene.background !== 'rgba(0,0,0,0)') {
    ctx.fillStyle = scene.background
    ctx.fillRect(0, 0, scene.w, scene.h)
  } else {
    ctx.clearRect(0, 0, scene.w, scene.h)
  }
  for (const el of scene.elements) drawElement(ctx, el, assets)
  ctx.restore()
}

export function renderToCanvas(scene: Scene, assets: Assets, scale = 1): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(scene.w * scale)
  canvas.height = Math.round(scene.h * scale)
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  renderScene(ctx, scene, assets)
  return canvas
}
