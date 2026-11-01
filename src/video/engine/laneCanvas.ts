// Waveforms and filmstrips on the timeline, drawn imperatively into ONE canvas over the lanes (no React re-render,
// no element per tile). The canvas covers only the visible part of the lanes and follows the horizontal scroll, so a
// ten-minute clip at high zoom never needs a canvas wider than the window. It redraws when the lanes' DOM changes
// (an edit, a zoom: MutationObserver), on scroll and resize, and when a waveform or filmstrip finishes reading.

import type { Clip, MediaAsset } from '../timeline'
import { getCachedImage } from '../compositor'
import { filmstripFor, onFilmstrip, tileRect } from './filmstrip'
import { levelFor, onPeaks, peaksFor } from './peaks'
import type { Peaks } from './peaks'
import { previewUrl } from './mediaSource'

/** Space at the top of a clip block for its name; the picture or waveform goes under it. */
const TITLE_BAND = 16

export interface LaneSource {
  clips: () => Clip[]
  assets: () => MediaAsset[]
  zoom: () => number
}

/** What names a file for its cache entries: path + size + mtime when it has them (a replaced file reads again). */
export const identityOf = (a: MediaAsset | undefined, url: string) => (a?.path ? `${a.path}|${a.size}|${a.mtimeMs ?? 0}` : url)

export interface LaneVisualState { waveforms: number; strips: number; pending: number }

export function attachLaneCanvas(canvas: HTMLCanvasElement, scroller: HTMLElement, lanes: HTMLElement, src: LaneSource): { detach: () => void; redraw: () => void; state: () => LaneVisualState } {
  let raf = 0
  let last: LaneVisualState = { waveforms: 0, strips: 0, pending: 0 }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(draw) }

  function draw() {
    raf = 0
    const dpr = window.devicePixelRatio || 1
    const lanesRect = lanes.getBoundingClientRect()
    const scRect = scroller.getBoundingClientRect()
    // the visible part of the lanes, in client pixels
    const headers = (scroller.querySelector('.vw-track-headers') as HTMLElement | null)?.offsetWidth ?? 0
    const left = Math.max(lanesRect.left, scRect.left + headers)
    const right = Math.min(lanesRect.right, scRect.right)
    const top = lanesRect.top
    const w = Math.max(0, right - left)
    const h = lanesRect.height
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    // the canvas is the lanes' sibling (so its own style writes are not lane mutations): place it over them
    canvas.style.top = `${lanes.offsetTop}px`
    canvas.style.transform = `translateX(${left - lanesRect.left}px)`
    const W = Math.round(w * dpr)
    const H = Math.round(h * dpr)
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, W, H)
    ctx.scale(dpr, dpr)
    const zoom = src.zoom()
    const byId = new Map(src.clips().map((c) => [c.id, c]))
    const assets = new Map(src.assets().map((a) => [a.id, a]))
    const state: LaneVisualState = { waveforms: 0, strips: 0, pending: 0 }
    for (const el of lanes.querySelectorAll<HTMLElement>('.vw-clip-block[data-clip-id]')) {
      const clip = byId.get(el.dataset.clipId!)
      if (!clip || !clip.sourceUrl) continue
      const r = el.getBoundingClientRect()
      if (r.right < left || r.left > right || r.height < TITLE_BAND + 10) continue
      const x0 = r.left - left
      const y0 = r.top - top + TITLE_BAND
      const bw = r.width
      const bh = r.height - TITLE_BAND - 3
      const visL = Math.max(x0 + 1, 0)
      const visR = Math.min(x0 + bw - 1, w)
      if (visR <= visL) continue
      ctx.save()
      ctx.beginPath()
      ctx.rect(visL, y0, visR - visL, bh)
      ctx.clip()
      const asset = clip.mediaAssetId ? assets.get(clip.mediaAssetId) : undefined
      if (clip.kind === 'audio') {
        const ps = peaksFor(clip.sourceUrl, identityOf(asset, clip.sourceUrl))
        if (ps.state === 'ready') { drawWave(ctx, ps.peaks, clip, x0, y0, bh, visL, visR, zoom * dpr, dpr); state.waveforms++ } else if (ps.state === 'pending') state.pending++
      } else if (clip.kind === 'video' && clip.still) {
        const img = getCachedImage(clip.sourceUrl)
        if (img && img.complete && img.naturalWidth) {
          const tw = bh * (img.naturalWidth / img.naturalHeight)
          for (let x = x0; x < visR; x += tw) if (x + tw > visL) drawTile(ctx, img, 0, 0, img.naturalWidth, img.naturalHeight, x, y0, tw, bh)
          state.strips++
        }
      } else if (clip.kind === 'video') {
        const url = previewUrl(clip) ?? clip.sourceUrl
        const fs = filmstripFor(url, identityOf(asset, clip.sourceUrl))
        if (fs.state === 'ready' || fs.state === 'partial') {
          const f = fs.strip
          if (f.image) {
            const tw = bh * (f.tileW / f.tileH)
            for (let k = Math.max(0, Math.floor((visL - x0) / tw)); x0 + k * tw < visR; k++) {
              const st = (clip.in || 0) + (k * tw) / zoom
              const i = Math.min(f.count - 1, Math.floor(st / f.step))
              if (i >= f.ready) continue
              const tr = tileRect(f, i)
              drawTile(ctx, f.image, tr.sx, tr.sy, tr.sw, tr.sh, x0 + k * tw, y0, tw, bh)
            }
            state.strips++
          }
          if (fs.state === 'partial') state.pending++
        } else if (fs.state === 'pending') state.pending++
      }
      ctx.restore()
    }
    last = state
    canvas.dataset.waveforms = String(state.waveforms)
    canvas.dataset.strips = String(state.strips)
    canvas.dataset.pending = String(state.pending)
  }

  const mo = new MutationObserver(schedule)
  mo.observe(lanes, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] })
  scroller.addEventListener('scroll', schedule, { passive: true })
  const ro = new ResizeObserver(schedule)
  ro.observe(scroller)
  const offP = onPeaks(schedule)
  const offF = onFilmstrip(schedule)
  window.addEventListener('esb:video-media-ready', schedule)
  schedule()
  return {
    redraw: schedule,
    state: () => last,
    detach: () => { mo.disconnect(); ro.disconnect(); scroller.removeEventListener('scroll', schedule); offP(); offF(); window.removeEventListener('esb:video-media-ready', schedule); cancelAnimationFrame(raf) },
  }
}

/** One filmstrip tile with a 1 px gap after it and a hairline inside its edge, so neighbouring tiles — and a light
 * picture such as a banner — still read as separate frames. */
function drawTile(ctx: CanvasRenderingContext2D, img: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, x: number, y: number, w: number, h: number) {
  const dw = Math.max(1, w - 1)
  ctx.drawImage(img, sx, sy, sw, sh, x, y, dw, h)
  ctx.strokeStyle = 'rgba(0,0,0,0.28)'
  ctx.lineWidth = 1
  ctx.strokeRect(x + 0.5, y + 0.5, dw - 1, h - 1)
}

/** Waveform heights are drawn on a dB scale from this floor (dBFS) to 0 dBFS, so a quiet sound (a −18 dBFS tone,
 * speech) fills a readable part of the lane instead of a 1–2 px hairline; anything above silence is at least 1 px. */
export const WAVE_FLOOR_DB = -48
/** Fraction of the half-height a peak of linear amplitude `a` (0..1) is drawn at. */
export function waveHeight(a: number): number {
  if (!(a > 0)) return 0
  const db = 20 * Math.log10(Math.min(1, a))
  return Math.max(0, Math.min(1, (db - WAVE_FLOOR_DB) / -WAVE_FLOOR_DB))
}

/** A waveform: one bar per device pixel (the peak over that pixel, both sides of the centre line, dB scale), from the
 * level with at least one bin per pixel. A span with no sound at all says "Silent" instead of drawing a line. */
function drawWave(ctx: CanvasRenderingContext2D, peaks: Peaks, clip: Clip, x0: number, y0: number, bh: number, visL: number, visR: number, pxPerSecDevice: number, dpr: number) {
  const level = levelFor(peaks, pxPerSecDevice)
  const data = peaks.levels[level]
  const rate = peaks.rates[level]
  const bins = data.length / 2
  const mid = y0 + bh / 2
  const half = bh / 2 - 1
  const gain = Math.max(0, Math.min(1, clip.volume ?? 1))
  ctx.fillStyle = clip.muted ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.82)'
  const step = 1 / dpr
  const zoom = pxPerSecDevice / dpr
  let any = false
  for (let x = visL; x < visR; x += step) {
    const t0 = (clip.in || 0) + (x - x0) / zoom
    const t1 = t0 + step / zoom
    let i0 = Math.floor(t0 * rate)
    let i1 = Math.max(i0 + 1, Math.ceil(t1 * rate))
    if (i0 >= bins) break
    i0 = Math.max(0, i0)
    i1 = Math.min(bins, i1)
    let peak = 0
    for (let i = i0; i < i1; i++) peak = Math.max(peak, -data[i * 2], data[i * 2 + 1])
    if (peak <= 0) continue
    any = true
    const hh = Math.max(step, waveHeight((peak / 127) * Math.max(gain, 0.02)) * half)
    ctx.fillRect(x, mid - hh, step, hh * 2)
  }
  if (!any && visR - visL > 40) {
    ctx.fillStyle = 'rgba(255,255,255,0.72)'
    ctx.font = '500 10px "ESB Sans", Inter, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.fillText('Silent', Math.max(visL, x0) + 6, mid)
  }
}
