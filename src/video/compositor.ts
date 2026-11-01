// Composite frame renderer for the Video desk: one function draws a frame for the monitor and for the export.
//
// Every visual clip under the playhead is drawn, in track order (layersAt): footage and stills first, then overlays,
// then captions; overlapping footage on one track crossfades. Footage and stills take the clip's crop, fill/fit,
// scale and offset (footageRect).
//
// Placeholders: an overlay added from the bin starts with empty fields. In the editor (`editor: true`) an empty field
// is drawn as its label, dimmed ("Speaker name"), so the editor sees what to fill in; an export never draws them, and
// an overlay with nothing filled in is left out of the file altogether. Nothing here supplies a name, title or figure.

import type { Clip, VideoProject } from './timeline'
import { footageRect, layersAt } from './timeline'
import logoUrl from '../assets/images/esb-logo.png'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

const videoCache = new Map<string, HTMLVideoElement>()
const imageCache = new Map<string, HTMLImageElement>()

let stationLogoImg: HTMLImageElement | null = null
if (typeof Image !== 'undefined') {
  stationLogoImg = new Image()
  stationLogoImg.src = logoUrl
}

/** A frame the export decoded itself (a WebCodecs frame), drawn instead of the clip's <video> element. */
export interface FrameSource { image: CanvasImageSource; width: number; height: number }

export interface RenderOptions {
  /** The monitor: draw labels for empty fields and a "Media offline" slate. Off for an export. */
  editor?: boolean
  /** Decoded frames by clip id (export). Clips not in the map use their cached <video> element. */
  frames?: Map<string, FrameSource>
  /** The monitor is playing: the playback loop keeps each <video> running in step, so drawing must not seek it. */
  playing?: boolean
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

export function renderCompositeFrame(ctx: Ctx, timeline: VideoProject, time: number, canvasWidth: number, canvasHeight: number, opts: RenderOptions = {}) {
  const w = canvasWidth
  const h = canvasHeight
  const editor = !!opts.editor
  const layers = layersAt(timeline, time)

  ctx.save()
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, w, h)

  // a caption moves up over a lower third or breaking strap shown at the same time, so the two never overlap
  const captionBottom = captionLimit(layers.map((l) => l.clip), w, h, editor)
  let branded = false
  for (const { clip, alpha } of layers) {
    if (alpha <= 0) continue
    if (clip.kind === 'video') {
      if (clip.branded) branded = true
      drawFootage(ctx, clip, time, w, h, alpha, opts)
    } else if (clip.kind === 'overlay') {
      ctx.save()
      ctx.globalAlpha = alpha
      renderOverlayClip(ctx, clip, w, h, editor)
      ctx.restore()
    } else if (clip.kind === 'caption') {
      ctx.save()
      ctx.globalAlpha = alpha
      renderCaptionClip(ctx, clip, w, h, editor, captionBottom)
      ctx.restore()
    }
  }

  // the ESB bug (top right), unless switched off, over a banner still (whose own masthead sits exactly there), or on an
  // empty timeline (nothing to brand: the monitor stays black behind the start card)
  if (timeline.bug !== false && !branded && timeline.clips.length > 0) renderStationBug(ctx, w, h)
  ctx.restore()
}

function drawFootage(ctx: Ctx, clip: Clip, time: number, w: number, h: number, alpha: number, opts: RenderOptions) {
  let src: { image: CanvasImageSource; width: number; height: number } | null = null
  let zoom = 1
  if (clip.sourceUrl && clip.still) {
    const img = getCachedImage(clip.sourceUrl)
    if (img && img.complete && img.naturalWidth > 0) src = { image: img, width: img.naturalWidth, height: img.naturalHeight }
    // a still moves slowly, 0→6 % over the clip, so a picture held for several seconds does not read as a frozen frame
    const p = Math.min(1, Math.max(0, (time - clip.start) / Math.max(0.001, clip.duration)))
    zoom = 1 + 0.06 * (clip.kenBurns === 'out' ? 1 - p : p)
  } else if (clip.sourceUrl) {
    const decoded = opts.frames?.get(clip.id)
    if (decoded) src = decoded
    else {
      const v = getCachedVideo(clip.sourceUrl)
      if (v) {
        const targetTime = Math.max(0, (clip.in || 0) + (time - clip.start))
        // paused (scrubbing, stepping): put the frame exactly here. Playing: the playback loop runs the element and
        // corrects drift itself; seeking it every frame here is what made playback stutter.
        if (opts.editor && !opts.playing && Math.abs(v.currentTime - targetTime) > 0.04) v.currentTime = targetTime
        if (v.readyState >= 2 && v.videoWidth > 0) src = { image: v, width: v.videoWidth, height: v.videoHeight }
      }
    }
  }
  if (src) {
    const r = footageRect(src.width, src.height, w, h, clip, zoom)
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.drawImage(src.image, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh)
    ctx.restore()
  } else if (opts.editor && !clip.sourceUrl) {
    // an honest slate, in the editor only: the file is not there (an export with missing media is refused)
    ctx.save()
    ctx.fillStyle = '#16181d'
    ctx.fillRect(0, 0, w, h)
    const s = Math.min(w, h) / 1080
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `700 ${Math.round(34 * s)}px "ESB Sans", sans-serif`
    ctx.fillText('Media offline', w / 2, h / 2 - 24 * s)
    ctx.font = `500 ${Math.round(24 * s)}px ${face(clip.title)}`
    ctx.fillStyle = 'rgba(255,255,255,0.4)'
    ctx.fillText(clip.title.length > 60 ? clip.title.slice(0, 57) + '…' : clip.title, w / 2, h / 2 + 24 * s)
    ctx.restore()
  }
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
      ctx.font = `600 ${Math.round(26 * short)}px "ESB Sans", sans-serif`
      ctx.fillText('Text card', w / 2, h / 2 - 16 * short)
      ctx.font = `500 ${Math.round(18 * short)}px "ESB Sans", sans-serif`
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
      ctx.fillText('Type its title and text in the inspector', w / 2, h / 2 + 18 * short)
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
