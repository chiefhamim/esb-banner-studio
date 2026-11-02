// Canvas 2D rasters for the Video desk's WebGL2 compositor (engine/render.ts draws the frame; this file draws the
// pictures that are not footage): overlays (lower third, headline, card, breaking, picture, logo), captions, the
// "Media offline" slate and the ESB bug. Bangla is shaped by the browser's own text engine.
//
// Placeholders: an overlay added from the bin starts with empty fields. In the editor (`editor: true`) an empty field
// is drawn as its label, dimmed ("Speaker name"), so the editor sees what to fill in; an export never draws them, and
// an overlay with nothing filled in is left out of the file altogether. Nothing here supplies a name, title or figure.

import type { Clip } from './timeline'
import logoUrl from '../assets/images/esb-logo.png'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

const videoCache = new Map<string, HTMLVideoElement>()
const imageCache = new Map<string, HTMLImageElement>()

let stationLogoImg: HTMLImageElement | null = null
if (typeof Image !== 'undefined') {
  stationLogoImg = new Image()
  stationLogoImg.src = logoUrl
}

/** Media served by the app's own protocol is read with CORS, so drawing it never taints the canvas (the export reads
 * the canvas back to encode it). Object and data URLs are same-origin already. */
const needsCors = (url: string) => !/^(blob:|data:)/i.test(url)

export function getCachedVideo(url: string): HTMLVideoElement | null {
  if (typeof document === 'undefined') return null
  let v = videoCache.get(url)
  if (!v) {
    v = document.createElement('video')
    if (needsCors(url)) v.crossOrigin = 'anonymous'
    v.muted = true // the picture only: its sound plays from the linked A1 clip, which carries the volume and mute
    v.playsInline = true
    v.preload = 'auto'
    v.addEventListener('seeked', () => window.dispatchEvent(new Event('esb:video-media-ready')))
    v.addEventListener('loadeddata', () => window.dispatchEvent(new Event('esb:video-media-ready')))
    v.src = url
    videoCache.set(url, v)
  }
  return v
}

export function getCachedImage(url: string): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null
  let img = imageCache.get(url)
  if (!img) {
    img = new Image()
    if (needsCors(url)) img.crossOrigin = 'anonymous'
    // the preview redraws only when something changes; a picture that finishes loading is such a change
    img.onload = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event('esb:video-media-ready')) }
    img.src = url
    imageCache.set(url, img)
  }
  return img
}

/** Forget a media element whose URL is no longer used (a relinked or removed file). */
export function dropCachedMedia(url: string) {
  const v = videoCache.get(url)
  if (v) { try { v.pause(); v.removeAttribute('src'); v.load() } catch { /* already gone */ } videoCache.delete(url) }
  const img = imageCache.get(url)
  if (img) { img.onload = null; img.removeAttribute('src'); imageCache.delete(url) }
}

/** Release every cached <video> and picture whose URL is not in `keep` (a new or opened project, a removed file):
 * each <video> holds a decoder and its buffered frames until it is let go. */
export function pruneMediaCache(keep: Set<string>) {
  for (const url of [...videoCache.keys(), ...imageCache.keys()]) if (!keep.has(url)) dropCachedMedia(url)
}

/** How many media elements are cached (tests). */
export const mediaCacheSize = () => videoCache.size + imageCache.size

/** The <video> already made for `url`, without making one. */
export const peekCachedVideo = (url: string) => videoCache.get(url) ?? null

export const hasBangla = (s: string) => /[ঀ-৿]/.test(s)
const face = (text: string) => (hasBangla(text) ? '"Hind Siliguri", "ESB Sans", sans-serif' : '"ESB Sans", Inter, sans-serif')

/** Break `text` into lines no wider than `maxW` (at the context's current font), at most `maxLines`; the last line
 * that does not fit ends with an ellipsis. Bangla is shaped by the canvas itself, so a word is never cut inside. */
export function wrapLines(ctx: Ctx, text: string, maxW: number, maxLines: number): string[] {
  const lines: string[] = []
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    const cur = lines[lines.length - 1]
    if (cur !== undefined && ctx.measureText(cur + ' ' + word).width <= maxW) lines[lines.length - 1] = cur + ' ' + word
    else lines.push(word)
  }
  if (lines.length > maxLines) {
    lines.length = maxLines
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + ' …'
  }
  return lines
}

/** What an overlay field shows: its text, or in the editor only its dimmed label when empty. */
export function fieldText(value: string | undefined, label: string, editor: boolean): { text: string; placeholder: boolean } | null {
  const v = (value ?? '').trim()
  if (v) return { text: v, placeholder: false }
  return editor ? { text: label, placeholder: true } : null
}

/** The labels shown for each overlay's empty fields (editor only). */
export const OVERLAY_LABELS = {
  'lower-third': { text: 'Speaker name', sub: 'Role or organisation' },
  breaking: { text: 'Breaking headline', sub: 'Supporting line (optional)' },
  headline: { text: 'Headline', sub: 'Kicker (optional)' },
  card: { text: 'Card title', sub: 'Card text' },
  logo: { text: '', sub: '' },
} as const

const PLACEHOLDER_INK = 'rgba(255, 255, 255, 0.38)'
const ESB_STRIPES = ['#1e9b4a', '#e52d2d', '#ec8e3c']

// ---------------------------------------------------------------- rasters for the WebGL2 compositor
//
// Titles, captions, picture overlays, the "Media offline" slate and the ESB bug are drawn here with Canvas 2D (the
// browser shapes Bangla) into a frame-sized canvas, which the compositor uploads once and keeps by `rasterKey`. A
// raster is made again only when something that changes its pixels changes (its words, accent, place, the frame size,
// editor or export, a picture finishing loading, fonts arriving).

let fontEpoch = 0
if (typeof document !== 'undefined' && document.fonts) {
  document.fonts.addEventListener?.('loadingdone', () => { fontEpoch++; if (typeof window !== 'undefined') window.dispatchEvent(new Event('esb:video-media-ready')) })
}

/** Bumped whenever web fonts finish loading (a raster or a measurement made before is stale). */
export const fontEpochNow = () => fontEpoch
/** The ESB logo, once loaded (titles' end card draws it as-is). */
export const stationLogo = (): HTMLImageElement | null => (stationLogoImg && stationLogoImg.complete && stationLogoImg.naturalWidth > 0 ? stationLogoImg : null)

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/** A reusable scratch canvas per size (a raster is uploaded to the GPU at once, so one canvas serves every raster). */
const scratch = new Map<string, HTMLCanvasElement | OffscreenCanvas>()
function scratchCanvas(w: number, h: number) {
  const k = `${w}x${h}`
  let c = scratch.get(k)
  if (!c) {
    if (scratch.size > 4) scratch.clear()
    c = makeCanvas(w, h)
    scratch.set(k, c)
  }
  const ctx = c.getContext('2d') as Ctx
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, w, h)
  return { c, ctx }
}

const imageState = (url?: string) => {
  if (!url) { const l = stationLogoImg; return l && l.complete && l.naturalWidth > 0 ? 'L1' : 'L0' }
  const img = getCachedImage(url)
  return img && img.complete && img.naturalWidth > 0 ? `I${img.naturalWidth}x${img.naturalHeight}` : 'I0'
}

/** Everything that changes a text/graphic layer's pixels, as one string (the compositor's texture key). */
export function rasterKey(clip: Clip, w: number, h: number, editor: boolean, captionBottom: number): string {
  const pic = clip.kind === 'overlay' && (clip.overlayType === 'logo' || clip.sourceUrl) ? imageState(clip.sourceUrl) : ''
  return JSON.stringify([clip.kind, clip.overlayType, clip.overlayText, clip.overlaySub, clip.captionText, clip.accent, clip.sourceUrl, clip.scale, clip.posX, clip.posY, w, h, editor, clip.kind === 'caption' ? Math.round(captionBottom) : 0, pic, fontEpoch])
}

/** Draw an overlay or caption clip into a frame-sized canvas. Null when it draws nothing (an empty title in an
 * export, a picture not loaded yet). */
export function rasterLayer(clip: Clip, w: number, h: number, editor: boolean, captionBottom: number): { src: TexImageSource; width: number; height: number } | null {
  if (clip.kind === 'caption' && !fieldText(clip.captionText, 'Caption text', editor)) return null
  if (clip.kind === 'overlay' && !editor && emptyOverlay(clip)) return null
  if (clip.kind !== 'overlay' && clip.kind !== 'caption') return null
  const { c, ctx } = scratchCanvas(w, h)
  if (clip.kind === 'overlay') renderOverlayClip(ctx, clip, w, h, editor)
  else renderCaptionClip(ctx, clip, w, h, editor, captionBottom)
  return { src: c as TexImageSource, width: w, height: h }
}

const emptyOverlay = (c: Clip) => c.overlayType !== 'logo' && !c.sourceUrl && !(c.overlayText ?? '').trim() && !(c.overlaySub ?? '').trim()

export const offlineKey = (clip: Clip, w: number, h: number) => JSON.stringify(['offline', clip.title, w, h, fontEpoch])

/** Editor-only words on the monitor (the offline slate, an empty card's hint) never go below a legible size: `px` at
 * the frame's scale, but at least `min` CSS pixels on a small monitor (the raster is drawn in device pixels). */
function legible(px: number, min: number): number {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  return Math.round(Math.max(px, min * dpr))
}

/** The honest slate for a clip whose file is not there (editor only; an export with missing media is refused). */
export function rasterOffline(clip: Clip, w: number, h: number): { src: TexImageSource; width: number; height: number } {
  const { c, ctx } = scratchCanvas(w, h)
  ctx.fillStyle = '#16181d'
  ctx.fillRect(0, 0, w, h)
  const s = Math.min(w, h) / 1080
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const big = legible(34 * s, 15)
  const small = legible(24 * s, 12)
  ctx.font = `700 ${big}px "ESB Sans", sans-serif`
  ctx.fillText('Media offline', w / 2, h / 2 - big * 0.7)
  ctx.font = `500 ${small}px ${face(clip.title)}`
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.fillText(clip.title.length > 60 ? clip.title.slice(0, 57) + '…' : clip.title, w / 2, h / 2 + small * 0.9)
  return { src: c as TexImageSource, width: w, height: h }
}

export const bugKey = (w: number, h: number) => `bug|${w}x${h}|${imageState()}`

/** The ESB bug raster (null until the logo has loaded). */
export function rasterBug(w: number, h: number): { src: TexImageSource; width: number; height: number } | null {
  if (!(stationLogoImg && stationLogoImg.complete && stationLogoImg.naturalWidth > 0)) return null
  const { c, ctx } = scratchCanvas(w, h)
  renderStationBug(ctx, w, h)
  return { src: c as TexImageSource, width: w, height: h }
}

function stripes(ctx: Ctx, x: number, y: number, bw: number, bh: number, accent?: string) {
  if (accent) { ctx.fillStyle = accent; ctx.fillRect(x, y, bw, bh); return }
  const part = bh / 3
  ESB_STRIPES.forEach((c, k) => { ctx.fillStyle = c; ctx.fillRect(x, y + part * k, bw, part) })
}

function renderOverlayClip(ctx: Ctx, clip: Clip, w: number, h: number, editor: boolean) {
  ctx.save()
  const scale = h / 1080
  const short = Math.min(w, h) / 1080
  const type = clip.overlayType

  if (type === 'lower-third') {
    const labels = OVERLAY_LABELS['lower-third']
    const name = fieldText(clip.overlayText, labels.text, editor)
    const role = fieldText(clip.overlaySub, labels.sub, editor)
    if (name || role) {
      const boxX = w * 0.06
      const boxY = h * 0.76
      const boxW = Math.min(w * 0.88, 880 * short)
      const boxH = 130 * short
      ctx.fillStyle = 'rgba(18, 18, 22, 0.92)'
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
      ctx.lineWidth = 1.5 * short
      ctx.beginPath()
      ctx.roundRect(boxX, boxY, boxW, boxH, 12 * short)
      ctx.fill()
      ctx.stroke()
      stripes(ctx, boxX + 6 * short, boxY + 8 * short, 6 * short, boxH - 16 * short, clip.accent)
      const textX = boxX + 32 * short
      const maxW = boxW - 52 * short
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = '#a1a1aa'
      ctx.font = `700 ${Math.round(13 * short)}px "ESB Sans", sans-serif`
      ctx.fillText('ESB POWER LINE', textX, boxY + 32 * short)
      if (name) {
        ctx.fillStyle = name.placeholder ? PLACEHOLDER_INK : '#f4f4f5'
        ctx.font = `700 ${Math.round(30 * short)}px ${face(name.text)}`
        ctx.fillText(wrapLines(ctx, name.text, maxW, 1)[0] ?? '', textX, boxY + 70 * short)
      }
      if (role) {
        ctx.fillStyle = role.placeholder ? PLACEHOLDER_INK : '#d4d4d8'
        ctx.font = `500 ${Math.round(18 * short)}px ${face(role.text)}`
        ctx.fillText(wrapLines(ctx, role.text, maxW, 1)[0] ?? '', textX, boxY + 104 * short)
      }
    }
  } else if (type === 'breaking') {
    const labels = OVERLAY_LABELS.breaking
    const head = fieldText(clip.overlayText, labels.text, editor)
    const sub = clip.overlaySub?.trim() ? { text: clip.overlaySub.trim(), placeholder: false } : editor ? { text: labels.sub, placeholder: true } : null
    if (head) {
      const barY = h * 0.82
      const barH = 110 * scale
      ctx.fillStyle = clip.accent ?? '#b42318'
      ctx.beginPath()
      ctx.roundRect(w * 0.05, barY - 24 * scale, 150 * scale, 32 * scale, 6 * scale)
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.font = `800 ${Math.round(14 * scale)}px "ESB Sans", sans-serif`
      ctx.textAlign = 'center'
      ctx.fillText('BREAKING', w * 0.05 + 75 * scale, barY - 3 * scale)
      ctx.fillStyle = 'rgba(15, 15, 18, 0.94)'
      ctx.strokeStyle = clip.accent ?? '#b42318'
      ctx.lineWidth = 2 * scale
      ctx.beginPath()
      ctx.roundRect(w * 0.05, barY + 8 * scale, w * 0.9, barH, 10 * scale)
      ctx.fill()
      ctx.stroke()
      ctx.textAlign = 'left'
      ctx.fillStyle = head.placeholder ? PLACEHOLDER_INK : '#ffffff'
      ctx.font = `700 ${Math.round(28 * scale)}px ${face(head.text)}`
      ctx.fillText(wrapLines(ctx, head.text, w * 0.84, 1)[0] ?? '', w * 0.08, barY + (sub ? 54 : 70) * scale)
      if (sub) {
        ctx.fillStyle = sub.placeholder ? PLACEHOLDER_INK : '#a1a1aa'
        ctx.font = `500 ${Math.round(16 * scale)}px ${face(sub.text)}`
        ctx.fillText(wrapLines(ctx, sub.text, w * 0.84, 1)[0] ?? '', w * 0.08, barY + 92 * scale)
      }
    }
  } else if (type === 'headline') {
    // a title card's headline: lower half, a soft dark ramp behind it for legibility, an accent bar, sentence case
    const labels = OVERLAY_LABELS.headline
    const head = fieldText(clip.overlayText, labels.text, editor)
    const kicker = clip.overlaySub?.trim() ? { text: clip.overlaySub.trim(), placeholder: false } : null
    if (head) {
      const size = Math.round(58 * short)
      const lineH = Math.round(size * 1.18)
      const left = w * 0.07
      const maxW = w * 0.86
      ctx.font = `800 ${size}px ${face(head.text)}`
      const lines = wrapLines(ctx, head.text, maxW, 4)
      const kickerH = kicker ? 40 * short : 0
      const blockH = lines.length * lineH + kickerH
      const bottom = h * 0.88
      const top = bottom - blockH
      const ramp = ctx.createLinearGradient(0, top - 160 * short, 0, h)
      ramp.addColorStop(0, 'rgba(0,0,0,0)')
      ramp.addColorStop(0.45, 'rgba(0,0,0,0.62)')
      ramp.addColorStop(1, 'rgba(0,0,0,0.82)')
      ctx.fillStyle = ramp
      ctx.fillRect(0, top - 160 * short, w, h - (top - 160 * short))
      stripes(ctx, left - 26 * short, top + 4 * short, 8 * short, blockH - 8 * short, clip.accent)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      if (kicker) {
        ctx.fillStyle = clip.accent ?? '#e4e4e7'
        ctx.font = `700 ${Math.round(20 * short)}px ${face(kicker.text)}`
        ctx.fillText(kicker.text.toUpperCase(), left, top)
      }
      ctx.fillStyle = head.placeholder ? PLACEHOLDER_INK : '#ffffff'
      ctx.font = `800 ${size}px ${face(head.text)}`
      lines.forEach((l, k) => ctx.fillText(l, left, top + kickerH + k * lineH))
    }
  } else if (type === 'card') {
    // a centred text card: an accent bar on top, a title and a supporting text, both from the editor
    const labels = OVERLAY_LABELS.card
    const empty = !(clip.overlayText ?? '').trim() && !(clip.overlaySub ?? '').trim()
    const title = fieldText(clip.overlayText, labels.text, editor)
    const body = fieldText(clip.overlaySub, labels.sub, editor)
    if (empty && editor) {
      // nothing typed yet: a quiet dashed outline where the card will sit (editor only, never exported)
      const cardW = Math.min(w * 0.82, 1200 * short)
      const cardH = 220 * short
      const x = (w - cardW) / 2
      const y = (h - cardH) / 2
      ctx.setLineDash([10 * short, 8 * short])
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'
      ctx.lineWidth = 2 * short
      ctx.beginPath()
      ctx.roundRect(x, y, cardW, cardH, 16 * short)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
      ctx.fill()
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const big = legible(26 * short, 13)
      const small = legible(18 * short, 11)
      ctx.font = `600 ${big}px "ESB Sans", sans-serif`
      ctx.fillText('Text card', w / 2, h / 2 - big * 0.65)
      ctx.font = `500 ${small}px "ESB Sans", sans-serif`
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
      ctx.fillText('Type its title and text in the inspector', w / 2, h / 2 + small * 0.9)
    } else if (title || body) {
      const cardW = Math.min(w * 0.82, 1200 * short)
      const pad = 44 * short
      const tSize = Math.round(46 * short)
      const bSize = Math.round(28 * short)
      ctx.font = `800 ${tSize}px ${face(title?.text ?? '')}`
      const tLines = title ? wrapLines(ctx, title.text, cardW - pad * 2, 3) : []
      ctx.font = `500 ${bSize}px ${face(body?.text ?? '')}`
      const bLines = body ? wrapLines(ctx, body.text, cardW - pad * 2, 5) : []
      const tLH = tSize * 1.18
      const bLH = bSize * 1.45
      const gap = tLines.length && bLines.length ? 18 * short : 0
      const cardH = pad * 2 + tLines.length * tLH + gap + bLines.length * bLH + 8 * short
      const x = (w - cardW) / 2
      const y = (h - cardH) / 2
      ctx.fillStyle = 'rgba(14, 14, 18, 0.93)'
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
      ctx.lineWidth = 1.5 * short
      ctx.beginPath()
      ctx.roundRect(x, y, cardW, cardH, 16 * short)
      ctx.fill()
      ctx.stroke()
      if (clip.accent) { ctx.fillStyle = clip.accent; ctx.fillRect(x + pad, y + 20 * short, 64 * short, 8 * short) }
      else ESB_STRIPES.forEach((c, k) => { ctx.fillStyle = c; ctx.fillRect(x + pad + k * 22 * short, y + 20 * short, 20 * short, 8 * short) })
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      let ty = y + pad + 8 * short
      if (title) {
        ctx.fillStyle = title.placeholder ? PLACEHOLDER_INK : '#ffffff'
        ctx.font = `800 ${tSize}px ${face(title.text)}`
        tLines.forEach((l) => { ctx.fillText(l, x + pad, ty); ty += tLH })
      }
      ty += gap
      if (body) {
        ctx.fillStyle = body.placeholder ? PLACEHOLDER_INK : '#d4d4d8'
        ctx.font = `500 ${bSize}px ${face(body.text)}`
        bLines.forEach((l) => { ctx.fillText(l, x + pad, ty); ty += bLH })
      }
    }
  } else if (type === 'logo' || (clip.sourceUrl && clip.kind === 'overlay')) {
    // the ESB logo, or a picture from the bin added as an overlay
    const img = clip.sourceUrl ? getCachedImage(clip.sourceUrl) : stationLogoImg
    if (img && img.complete && img.naturalWidth > 0) {
      const nativeAspect = img.naturalWidth / img.naturalHeight
      const targetH = Math.min(180 * scale, h * 0.2) * (clip.scale || 1)
      const targetW = targetH * nativeAspect
      const posX = clip.posX !== undefined ? clip.posX * w : w * 0.06
      const posY = clip.posY !== undefined ? clip.posY * h : h * 0.08
      ctx.drawImage(img, posX, posY, targetW, targetH)
    }
  }
  ctx.restore()
}

/** The lowest a caption's box may reach: just above a lower third or breaking strap on screen at the same time, else
 * 92 % down the frame. */
export function captionLimit(clips: Clip[], w: number, h: number, editor: boolean): number {
  const short = Math.min(w, h) / 1080
  let bottom = h * 0.92
  for (const c of clips) {
    if (c.kind !== 'overlay') continue
    const has = editor || !!(c.overlayText ?? '').trim() || (c.overlayType === 'lower-third' && !!(c.overlaySub ?? '').trim())
    if (!has) continue
    if (c.overlayType === 'lower-third') bottom = Math.min(bottom, h * 0.76 - 18 * short)
    else if (c.overlayType === 'breaking') bottom = Math.min(bottom, h * 0.82 - (24 + 18) * (h / 1080))
  }
  return bottom
}

function renderCaptionClip(ctx: Ctx, clip: Clip, w: number, h: number, editor: boolean, bottom = h * 0.92) {
  const field = fieldText(clip.captionText, 'Caption text', editor)
  if (!field) return
  ctx.save()
  // sized off the short side, so a 9:16 caption is as legible as a 16:9 one, and wrapped to the title-safe width
  const scale = Math.min(w, h) / 1080
  const size = Math.round(34 * scale)
  const lineH = Math.round(size * 1.32)
  ctx.font = `600 ${size}px "Hind Siliguri", "ESB Sans", sans-serif`
  const lines = wrapLines(ctx, field.text, w * 0.84, 3)
  const padX = 22 * scale
  const padY = 12 * scale
  const boxW = Math.min(w * 0.92, Math.max(...lines.map((l) => ctx.measureText(l).width)) + padX * 2)
  const boxH = lines.length * lineH + padY * 2
  const boxX = (w - boxW) / 2
  const boxY = bottom - boxH
  ctx.fillStyle = 'rgba(0, 0, 0, 0.78)'
  ctx.beginPath()
  ctx.roundRect(boxX, boxY, boxW, boxH, 10 * scale)
  ctx.fill()
  ctx.fillStyle = field.placeholder ? PLACEHOLDER_INK : '#fef08a' // broadcast caption yellow
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  lines.forEach((l, k) => ctx.fillText(l, w / 2, boxY + padY + lineH * (k + 0.5) + 1 * scale))
  ctx.restore()
}

/** The ESB bug: the official logo on a white plate, top right. The wordmark has black and dark-green letters, so it
 * sits on white (on dark glass its "ESB" vanished). Sized off the frame's short side so it reads in a 9:16 frame and
 * on the monitor. No REC dot or "live" sign: a finished package is not live. */
function renderStationBug(ctx: Ctx, w: number, h: number) {
  const logo = stationLogoImg && stationLogoImg.complete && stationLogoImg.naturalWidth > 0 ? stationLogoImg : null
  if (!logo) return
  ctx.save()
  const s = Math.min(w, h) / 1080
  const logoH = 58 * s
  const logoW = logoH * (logo.naturalWidth / logo.naturalHeight)
  const padX = 14 * s
  const padY = 9 * s
  const plateW = logoW + padX * 2
  const plateH = logoH + padY * 2
  const x = w - plateW - 36 * s
  const y = 36 * s
  ctx.shadowColor = 'rgba(0, 0, 0, 0.28)'
  ctx.shadowBlur = 10 * s
  ctx.shadowOffsetY = 2 * s
  ctx.fillStyle = 'rgba(255, 255, 255, 0.94)'
  ctx.beginPath()
  ctx.roundRect(x, y, plateW, plateH, 10 * s)
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.drawImage(logo, x + padX, y + padY, logoW, logoH)
  ctx.restore()
}

/** Wait for the pictures a frame needs that load on their own (the ESB logo; still and overlay pictures), so the first
 * exported frames are not drawn without them. */
export async function picturesReady(urls: string[]) {
  const imgs = [stationLogoImg, ...urls.map((u) => getCachedImage(u))].filter((i): i is HTMLImageElement => !!i)
  await Promise.all(imgs.map((i) => (i.complete && i.naturalWidth > 0 ? null : i.decode().catch(() => {}))))
}
