// Safe-zone guides on the monitor (editor only; never drawn into an export): the title-safe frame (90 %), and on a
// portrait frame the Reels or Shorts UI zones (the caption/handle band at the bottom, the button column on the right,
// the header band at the top — titles/brand.ts DEFAULT_SAFE_ZONES, the same numbers the kit lays titles out by).

import { DEFAULT_SAFE_ZONES, safeRect, type Platform } from '../titles/brand'

export interface Guides {
  /** Which feed's UI zones to show on a portrait frame (null: title-safe only). */
  platform: Platform | null
}

export const guidesKey = (g: Guides, w: number, h: number) => `guides|${g.platform ?? '-'}|${w}x${h}|${typeof window !== 'undefined' ? window.devicePixelRatio : 1}`

/** The zones a guide overlay shades, in frame pixels (tests read the same rectangles). */
export function guideZones(g: Guides, w: number, h: number) {
  const portrait = h > w * 1.3
  const z = portrait && g.platform ? DEFAULT_SAFE_ZONES.platforms[g.platform] : null
  return {
    titleSafe: safeRect(w, h, { platform: null }),
    critical: safeRect(w, h, { platform: portrait ? g.platform : null }),
    bands: z ? [
      { x: 0, y: h * (1 - z.bottom), w, h: h * z.bottom, label: g.platform === 'shorts' ? 'Shorts: title, channel, music' : 'Reels: caption, handle, music' },
      { x: w * (1 - z.right), y: h * z.top, w: w * z.right, h: h * (1 - z.top - z.bottom), label: 'Buttons' },
      { x: 0, y: 0, w, h: h * z.top, label: 'Header' },
    ] : [],
  }
}

/** The guide picture: lines only, nothing to read (the legend and any warning are the monitor's own chip, outside the
 * picture's pixels). 16:9 and other landscape frames get the title-safe frame alone; a portrait frame with a feed
 * chosen gets the zone the feed's own buttons and caption cover, lightly shaded, with one dashed line at its edge. */
export function rasterGuides(g: Guides, w: number, h: number): { src: TexImageSource; width: number; height: number } {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h })
  const ctx = c.getContext('2d') as CanvasRenderingContext2D
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  const z = guideZones(g, w, h)
  const line = Math.max(1, dpr)
  const dashed = (r: { x: number; y: number; w: number; h: number }, alpha: number) => {
    ctx.save()
    ctx.setLineDash([6 * dpr, 5 * dpr])
    ctx.lineWidth = line
    ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1)
    ctx.restore()
  }
  if (z.bands.length) {
    const k = z.critical
    ctx.fillStyle = 'rgba(229, 45, 45, 0.2)'
    ctx.beginPath()
    ctx.rect(0, 0, w, h)
    ctx.rect(k.x, k.y, k.w, k.h)
    ctx.fill('evenodd')
    dashed(k, 0.85)
  } else {
    dashed(z.titleSafe, 0.6)
  }
  return { src: c as TexImageSource, width: w, height: h }
}
