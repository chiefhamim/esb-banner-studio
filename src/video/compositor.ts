// Composite frame renderer for ESB Studio Video Desk.
// Renders video frames, broadcast lower-thirds, headline banners, and captions onto a Canvas.

import type { Clip, VideoProject } from './timeline'
import { getClipsAtTime } from './timeline'
import logoUrl from '../assets/images/esb-logo.png'

const videoCache = new Map<string, HTMLVideoElement>()
const imageCache = new Map<string, HTMLImageElement>()

let stationLogoImg: HTMLImageElement | null = null
if (typeof Image !== 'undefined') {
  stationLogoImg = new Image()
  stationLogoImg.src = logoUrl
}

export function getCachedVideo(url: string): HTMLVideoElement | null {
  if (typeof document === 'undefined') return null
  let v = videoCache.get(url)
  if (!v) {
    v = document.createElement('video')
    v.src = url
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    v.crossOrigin = 'anonymous'
    videoCache.set(url, v)
  }
  return v
}

export function getCachedImage(url: string): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null
  let img = imageCache.get(url)
  if (!img) {
    img = new Image()
    img.src = url
    imageCache.set(url, img)
  }
  return img
}

export function renderCompositeFrame(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  timeline: VideoProject,
  time: number,
  canvasWidth: number,
  canvasHeight: number,
) {
  const w = canvasWidth
  const h = canvasHeight
  const clips = getClipsAtTime(timeline, time)

  // 1. Base Studio background
  ctx.save()
  const bgGrad = ctx.createLinearGradient(0, 0, 0, h)
  bgGrad.addColorStop(0, '#0f172a')
  bgGrad.addColorStop(1, '#020617')
  ctx.fillStyle = bgGrad
  ctx.fillRect(0, 0, w, h)

  // 2. V1 Video footage layer
  const videoClip = clips.find((c) => c.trackId === 'v1')
  if (videoClip) {
    let renderedRealVideo = false
    if (videoClip.sourceUrl) {
      const v = getCachedVideo(videoClip.sourceUrl)
      if (v) {
        const targetTime = Math.max(0, (videoClip.in || 0) + (time - videoClip.start))
        if (Math.abs(v.currentTime - targetTime) > 0.08) {
          v.currentTime = targetTime
        }
        if (v.readyState >= 2 && v.videoWidth > 0) {
          ctx.save()
          if (videoClip.opacity !== undefined) ctx.globalAlpha = videoClip.opacity
          const vAspect = v.videoWidth / v.videoHeight
          const cAspect = w / h
          let dw = w
          let dh = h
          let dx = 0
          let dy = 0
          if (vAspect > cAspect) {
            dw = h * vAspect
            dx = (w - dw) / 2
          } else {
            dh = w / vAspect
            dy = (h - dh) / 2
          }
          ctx.drawImage(v, dx, dy, dw, dh)
          ctx.restore()
          renderedRealVideo = true
        }
      }
    }

    if (!renderedRealVideo) {
      // Dynamic simulated footage with studio gradient, grid, and safe guides
      const footageGrad = ctx.createRadialGradient(w * 0.5, h * 0.4, 50, w * 0.5, h * 0.4, w * 0.7)
      footageGrad.addColorStop(0, '#1e293b')
      footageGrad.addColorStop(1, '#090d16')
      ctx.fillStyle = footageGrad
      ctx.fillRect(0, 0, w, h)

      // Subtle video grid texture
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)'
      ctx.lineWidth = 1
      const gridSize = Math.round(w / 16)
      for (let x = 0; x < w; x += gridSize) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, h)
        ctx.stroke()
      }
      for (let y = 0; y < h; y += gridSize) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(w, y)
        ctx.stroke()
      }

      // Centered clip title watermark
      ctx.fillStyle = 'rgba(255, 255, 255, 0.18)'
      ctx.font = `600 ${Math.round(h * 0.04)}px "ESB Sans", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(`[ ${videoClip.title.toUpperCase()} ]`, w / 2, h * 0.45)

      // SMPTE safe area bounds (90% action safe, 80% title safe)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
      ctx.lineWidth = 1
      ctx.strokeRect(w * 0.05, h * 0.05, w * 0.9, h * 0.9)
    }
  }

  // 3. V2 Overlays (Lower Thirds, Breaking Banners, Bug, Logos)
  const overlayClip = clips.find((c) => c.trackId === 'v2')
  if (overlayClip) {
    renderOverlayClip(ctx, overlayClip, w, h)
  }

  // 4. C1 Subtitles & Captions
  const captionClip = clips.find((c) => c.trackId === 'c1')
  if (captionClip && captionClip.captionText) {
    renderCaptionClip(ctx, captionClip, w, h)
  }

  // 5. Watermark Bug (Top Right)
  renderStationBug(ctx, w, h, time)

  ctx.restore()
}

function renderOverlayClip(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  clip: Clip,
  w: number,
  h: number,
) {
  ctx.save()
  const scale = h / 1080

  if (clip.overlayType === 'lower-third') {
    // Broadcast Lower Third
    const boxX = w * 0.06
    const boxY = h * 0.76
    const boxW = Math.min(w * 0.72, 880 * scale)
    const boxH = 130 * scale

    // Glass panel background
    ctx.fillStyle = 'rgba(18, 18, 22, 0.92)'
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
    ctx.lineWidth = 1.5 * scale
    ctx.beginPath()
    ctx.roundRect(boxX, boxY, boxW, boxH, 12 * scale)
    ctx.fill()
    ctx.stroke()

    // Left brand color stripes
    const barX = boxX + 6 * scale
    const barW = 6 * scale
    const barH = (boxH - 16 * scale) / 3
    const startY = boxY + 8 * scale

    ctx.fillStyle = '#1e9b4a'
    ctx.fillRect(barX, startY, barW, barH)
    ctx.fillStyle = '#e52d2d'
    ctx.fillRect(barX, startY + barH, barW, barH)
    ctx.fillStyle = '#ec8e3c'
    ctx.fillRect(barX, startY + barH * 2, barW, barH)

    // Text: Name & Title
    const textX = boxX + 32 * scale
    ctx.textAlign = 'left'

    // Overline
    ctx.fillStyle = '#a1a1aa'
    ctx.font = `600 ${Math.round(13 * scale)}px "ESB Sans", sans-serif`
    ctx.fillText('ESB POWERLINE BROADCAST', textX, boxY + 32 * scale)

    // Name
    ctx.fillStyle = '#f4f4f5'
    ctx.font = `700 ${Math.round(30 * scale)}px "ESB Sans", sans-serif`
    ctx.fillText(clip.overlayText || 'Guest Speaker', textX, boxY + 70 * scale)

    // Designation / Role
    ctx.fillStyle = '#d4d4d8'
    ctx.font = `500 ${Math.round(18 * scale)}px "ESB Sans", sans-serif`
    ctx.fillText(clip.overlaySub || 'Newsroom Analyst', textX, boxY + 104 * scale)
  } else if (clip.overlayType === 'breaking') {
    // Breaking News Banner Bar
    const barY = h * 0.82
    const barH = 110 * scale

    // Red header pill
    ctx.fillStyle = '#b42318'
    ctx.beginPath()
    ctx.roundRect(w * 0.05, barY - 24 * scale, 180 * scale, 32 * scale, 6 * scale)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.font = `700 ${Math.round(14 * scale)}px "ESB Sans", sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText('সরাসরি · BREAKING', w * 0.05 + 90 * scale, barY - 4 * scale)

    // Banner container
    ctx.fillStyle = 'rgba(15, 15, 18, 0.94)'
    ctx.strokeStyle = '#b42318'
    ctx.lineWidth = 2 * scale
    ctx.beginPath()
    ctx.roundRect(w * 0.05, barY + 8 * scale, w * 0.9, barH, 10 * scale)
    ctx.fill()
    ctx.stroke()

    // Bengali Headline
    ctx.textAlign = 'left'
    ctx.fillStyle = '#ffffff'
    ctx.font = `700 ${Math.round(28 * scale)}px "Hind Siliguri", "ESB Sans", sans-serif`
    ctx.fillText(clip.overlayText || 'ব্রেকিং নিউজ শিরোনাম', w * 0.08, barY + 54 * scale)

    // Subtitle
    ctx.fillStyle = '#a1a1aa'
    ctx.font = `500 ${Math.round(16 * scale)}px "ESB Sans", sans-serif`
    ctx.fillText(clip.overlaySub || 'Energy Sector Bangladesh · Live Update', w * 0.08, barY + 92 * scale)
  } else if (clip.overlayType === 'logo' || (clip.sourceUrl && clip.kind === 'overlay')) {
    // Official ESB Logo or User Image Overlay
    const img = clip.sourceUrl ? getCachedImage(clip.sourceUrl) : stationLogoImg
    if (img && img.complete && img.naturalWidth > 0) {
      const nativeAspect = img.naturalWidth / img.naturalHeight
      const targetH = Math.min(180 * scale, h * 0.2) * (clip.scale || 1)
      const targetW = targetH * nativeAspect
      const posX = clip.posX !== undefined ? clip.posX * w : w * 0.06
      const posY = clip.posY !== undefined ? clip.posY * h : h * 0.08

      if (clip.opacity !== undefined) ctx.globalAlpha = clip.opacity
      ctx.drawImage(img, posX, posY, targetW, targetH)
    }
  }

  ctx.restore()
}

function renderCaptionClip(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  clip: Clip,
  w: number,
  h: number,
) {
  ctx.save()
  const scale = h / 1080
  const text = clip.captionText || ''

  ctx.font = `600 ${Math.round(24 * scale)}px "Hind Siliguri", "ESB Sans", sans-serif`
  const textWidth = ctx.measureText(text).width
  const padX = 24 * scale
  const boxW = textWidth + padX * 2
  const boxH = 48 * scale
  const boxX = (w - boxW) / 2
  const boxY = h * 0.88

  // Pill background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.82)'
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'
  ctx.lineWidth = 1 * scale
  ctx.beginPath()
  ctx.roundRect(boxX, boxY, boxW, boxH, 8 * scale)
  ctx.fill()
  ctx.stroke()

  // Subtitle text
  ctx.fillStyle = '#fef08a' // Warm broadcast caption yellow
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, w / 2, boxY + boxH / 2 + 2 * scale)

  ctx.restore()
}

function renderStationBug(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
) {
  ctx.save()
  const scale = h / 1080
  const bugW = 220 * scale
  const bugH = 38 * scale
  const bugX = w - bugW - 24 * scale
  const bugY = 32 * scale

  // Glass backing
  ctx.fillStyle = 'rgba(15, 15, 18, 0.78)'
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
  ctx.lineWidth = 1 * scale
  ctx.beginPath()
  ctx.roundRect(bugX, bugY, bugW, bugH, 8 * scale)
  ctx.fill()
  ctx.stroke()

  // Blinking REC dot
  const blink = Math.sin(time * 4) > 0
  ctx.fillStyle = blink ? '#ef4444' : '#7f1d1d'
  ctx.beginPath()
  ctx.arc(bugX + 16 * scale, bugY + 19 * scale, 4.5 * scale, 0, Math.PI * 2)
  ctx.fill()

  // Station logo at native aspect ratio if loaded
  let textOffsetX = bugX + 30 * scale
  if (stationLogoImg && stationLogoImg.complete && stationLogoImg.naturalWidth > 0) {
    const logoH = 22 * scale
    const logoW = logoH * (stationLogoImg.naturalWidth / stationLogoImg.naturalHeight)
    ctx.drawImage(stationLogoImg, textOffsetX, bugY + (bugH - logoH) / 2, logoW, logoH)
    textOffsetX += logoW + 8 * scale
  }

  // Logo text
  ctx.fillStyle = '#ffffff'
  ctx.font = `700 ${Math.round(12 * scale)}px "ESB Sans", sans-serif`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText('ESB POWERLINE', textOffsetX, bugY + 20 * scale)

  ctx.restore()
}
