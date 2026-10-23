import { getCollage } from './collage'
import { figmaGradient, rgba } from './gradient'
import { drawText, layoutText } from './text'
import type { El, IconEl, PhotosEl, RectEl, Scene, WatermarkEl } from './types'
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
      const s = Math.max(r.w / img.width, r.h / img.height) * (slot.zoom || 1)
      const dw = img.width * s
      const dh = img.height * s
      const ox = dw - r.w
      const oy = dh - r.h
      const dx = r.x - (0.5 + slot.panX * 0.5) * ox
      const dy = r.y - (0.5 + slot.panY * 0.5) * oy
      // zoomed out past the slot edges: paint the chosen backdrop first
      if (dw < r.w - 0.5 || dh < r.h - 0.5) {
        const mode = el.backdrop ?? 'blur'
        if (mode === 'blur') { ctx.imageSmoothingQuality = 'high'; ctx.drawImage(blurredBackdrop(img, r.w, r.h), r.x, r.y, r.w, r.h) }
        else { ctx.fillStyle = mode === 'black' ? '#000000' : mode === 'white' ? '#ffffff' : el.tint; ctx.fillRect(r.x, r.y, r.w, r.h) }
      }
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      const br = 1 + (slot.brightness ?? 0) / 100
      const ct = 1 + (slot.contrast ?? 0) / 100
      const sat = 1 + (slot.saturation ?? 0) / 100
      const wm = slot.warmth ?? 0
      const filters: string[] = []
      if (br !== 1) filters.push(`brightness(${br})`)
      if (ct !== 1) filters.push(`contrast(${ct})`)
      if (sat !== 1) filters.push(`saturate(${sat})`)
      if (wm !== 0) {
        if (wm > 0) filters.push(`sepia(${Math.round(wm * 0.35)}%) hue-rotate(-${Math.round(wm * 0.15)}deg)`)
        else filters.push(`hue-rotate(${Math.round(wm * 0.25)}deg)`)
      }
      if (filters.length) ctx.filter = filters.join(' ')
      ctx.drawImage(img, dx, dy, dw, dh)
      ctx.filter = 'none'

      if (slot.vignette && slot.vignette > 0) {
        const vig = ctx.createRadialGradient(
          r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h) * 0.3,
          r.x + r.w / 2, r.y + r.h / 2, Math.max(r.w, r.h) * 0.75
        )
        vig.addColorStop(0, 'rgba(0,0,0,0)')
        vig.addColorStop(1, `rgba(0,0,0,${((slot.vignette / 100) * 0.8).toFixed(2)})`)
        ctx.fillStyle = vig
        ctx.fillRect(r.x, r.y, r.w, r.h)
      }
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
        ctx.save()
        ctx.beginPath(); ctx.rect(el.x, el.y, el.w, el.h); ctx.clip()
        drawImageFit(ctx, img, el.x, el.y, el.w, el.h, el.fit)
        ctx.restore()
        if (el.stroke && el.stroke.width > 0) { ctx.shadowColor = 'transparent'; ctx.strokeStyle = el.stroke.color; ctx.lineWidth = el.stroke.width; const i = el.stroke.width / 2; ctx.strokeRect(el.x + i, el.y + i, el.w - el.stroke.width, el.h - el.stroke.width) }
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
