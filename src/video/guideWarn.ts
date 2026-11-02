// The monitor's safe-zone note: what the guides mean (a small legend chip) and, when a title on screen now reaches
// outside the safe area, which edge it crosses and where it is (editor only, drawn as HTML over the monitor).

import type { Clip } from './timeline'
import { titleSpecFor } from './engine/titleRaster'
import { guideZones, type Guides } from './engine/guides'

export interface GuideWarning { zone: string; box: { x: number; y: number; w: number; h: number } }

/** The first title (or data card) on screen at `t` whose drawn parts leave the safe area, in frame fractions. */
export function titleGuideWarning(clips: Clip[], t: number, w: number, h: number, g: Guides): GuideWarning | null {
  const z = guideZones(g, w, h)
  const k = z.bands.length ? z.critical : z.titleSafe
  const feed = z.bands.length ? (g.platform === 'shorts' ? 'Shorts' : 'Reels') : null
  for (const c of clips) {
    if ((!c.titleData && !c.dataCard) || c.titleData?.template === 'sticker' || t < c.start || t >= c.start + c.duration) continue
    const spec = titleSpecFor(c, w, h, true)
    if (!spec) continue
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    // the panel, picture or chart is what is measured; bare words are measured only when there is nothing else (their
    // height is a line count the layout may not fill, which would warn about space the words never use)
    const solid = spec.elements.filter((e) => e.type !== 'text' && !((e.type === 'image') && e.placeholder))
    for (const e of solid.length ? solid : spec.elements) {
      if (e.type === 'text' && e.placeholder) continue
      const bw = e.w
      const bh = e.type === 'text' ? e.font.lineHeight : e.h
      if (!(bw > 0) || !(bh > 0)) continue
      x0 = Math.min(x0, e.x); y0 = Math.min(y0, e.y); x1 = Math.max(x1, e.x + bw); y1 = Math.max(y1, e.y + bh)
    }
    if (!Number.isFinite(x0)) continue
    const tol = Math.max(2, h * 0.005)
    const over = [
      y1 > k.y + k.h + tol ? (feed ? 'caption area' : 'bottom margin') : null,
      x1 > k.x + k.w + tol ? (feed ? 'buttons' : 'right margin') : null,
      y0 < k.y - tol ? (feed ? 'header' : 'top margin') : null,
      x0 < k.x - tol ? 'left margin' : null,
    ].filter(Boolean) as string[]
    if (over.length) return { zone: `${feed ? `${feed} ` : ''}${over.join(' and ')}`, box: { x: x0 / w, y: y0 / h, w: (x1 - x0) / w, h: (y1 - y0) / h } }
  }
  return null
}
