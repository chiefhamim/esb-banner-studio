// In-house stickers and shapes for news video: arrow, circle, highlight bar, underline, box and callout. Drawn in code
// with Canvas 2D in the ESB palette (no downloaded artwork). Each draws itself on over its first ~0.5 s (a stroke that
// writes on, a bar that grows, a callout that scales in) and fades out over the last 0.3 s; in between it is static,
// so the compositor keeps one texture for it. A callout's words are the editor's, word for word.

import { ease } from './easing'
import { drawTitle, roundRect } from './draw'
import { fontFor } from './brand'
import { createLayoutCache, type Measurer } from './layout'
import { PLACEHOLDER_INK } from './kit'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export type StickerShapeName = 'arrow' | 'circle' | 'highlight' | 'underline' | 'box' | 'callout'

export interface StickerDraw {
  shape: StickerShapeName
  /** #rrggbb */
  color: string
  x: number
  y: number
  size: number
  rotation: number
  /** Callout words (editor's), or null. */
  text: string | null
  /** The callout's empty-field label (editor only). */
  placeholder?: string | null
}

export const STICKER_IN = 0.5
export const STICKER_OUT = 0.3

const layouts = createLayoutCache(64)

/** True when the sticker at local time t looks like its settled self (cacheable). */
export const stickerIsStatic = (t: number, duration: number) => t >= STICKER_IN && t < duration - STICKER_OUT

function ink(hex: string): string {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150 ? '#0b0b0e' : '#ffffff'
}

/** A callout's text box: at least 320 px wide at 1080 (a tiny sticker is not a 40 px column) and never wider than 90 % of
 * the frame; the text shrinks (34 → 20 px at 1080) until it fits three lines. `truncated` is true only when even the
 * smallest size does not fit: the export is then refused (titleClip.ts) rather than shown with an ellipsis. */
export function calloutBox(text: string, size: number, w: number, h: number, measure: Measurer) {
  const short = Math.min(w, h)
  const s = short / 1080
  const pad = 22 * s
  const maxWidth = Math.max(40, Math.min(w * 0.9 - pad * 2, Math.max(size * short - pad * 2, 320 * s)))
  let lay = layouts({ text, font: fontFor(text, 'label', Math.round(34 * s)), maxWidth, align: 'left', maxLines: 3 }, measure)
  for (const px of [30, 27, 24, 22, 20]) {
    if (!lay.truncated) break
    lay = layouts({ text, font: fontFor(text, 'label', Math.round(px * s)), maxWidth, align: 'left', maxLines: 3 }, measure)
  }
  return { lay, pad, truncated: lay.truncated }
}

/** Draw a sticker into a frame of w × h at local time t of a clip `duration` long. */
export function drawSticker(ctx: Ctx, st: StickerDraw, w: number, h: number, t: number, duration: number, measure: Measurer): void {
  const short = Math.min(w, h)
  const s = short / 1080
  const L = st.size * short
  const p = ease('esb', t / STICKER_IN)
  const outA = duration - t < STICKER_OUT ? Math.max(0, (duration - t) / STICKER_OUT) : 1
  if (p <= 0 || outA <= 0) return
  ctx.save()
  ctx.globalAlpha = outA
  ctx.translate(st.x * w, st.y * h)
  ctx.rotate((st.rotation * Math.PI) / 180)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // a soft shadow so a light shape reads on bright footage and a dark one on dark footage
  const shadow = () => { ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 8 * s; ctx.shadowOffsetY = 2 * s }
  switch (st.shape) {
    case 'arrow': {
      const lw = Math.max(3, 0.06 * L)
      const head = Math.max(lw * 2.4, 0.22 * L)
      const x0 = -L / 2, x1 = L / 2 - head * 0.6
      shadow()
      ctx.strokeStyle = st.color
      ctx.lineWidth = lw
      ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0 + (x1 - x0) * p, 0); ctx.stroke()
      if (p > 0.55) {
        const k = Math.min(1, (p - 0.55) / 0.45)
        ctx.fillStyle = st.color
        ctx.beginPath()
        ctx.moveTo(L / 2, 0)
        ctx.lineTo(L / 2 - head, -head * 0.55 * k)
        ctx.lineTo(L / 2 - head, head * 0.55 * k)
        ctx.closePath(); ctx.fill()
      }
      break
    }
    case 'circle': {
      // a hand-drawn ring: the stroke writes on clockwise and overlaps its start a little
      const lw = Math.max(3, 0.045 * L)
      shadow()
      ctx.strokeStyle = st.color
      ctx.lineWidth = lw
      ctx.beginPath()
      ctx.ellipse(0, 0, L / 2, L * 0.34, -0.06, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2.12 * p)
      ctx.stroke()
      break
    }
    case 'highlight': {
      const hh = 0.2 * L
      ctx.globalAlpha = outA * 0.5
      ctx.fillStyle = st.color
      roundRect(ctx, -L / 2, -hh / 2, L * p, hh, 4 * s)
      ctx.fill()
      break
    }
    case 'underline': {
      const lw = Math.max(3, 0.05 * L)
      shadow()
      ctx.strokeStyle = st.color
      ctx.lineWidth = lw
      ctx.beginPath(); ctx.moveTo(-L / 2, 0); ctx.lineTo(-L / 2 + L * p, 0); ctx.stroke()
      break
    }
    case 'box': {
      const bw = L, bh = L * 0.62
      const lw = Math.max(3, 0.035 * L)
      const per = 2 * (bw + bh)
      shadow()
      ctx.strokeStyle = st.color
      ctx.lineWidth = lw
      ctx.setLineDash([per * p, per])
      roundRect(ctx, -bw / 2, -bh / 2, bw, bh, 10 * s)
      ctx.stroke()
      break
    }
    case 'callout': {
      const shown = st.text?.trim() ? st.text.trim() : st.placeholder ?? null
      if (!shown) break
      const { lay, pad } = calloutBox(shown, st.size, w, h, measure)
      const bw = Math.max(lay.width, 10) + pad * 2, bh = lay.height + pad * 1.4
      const k = 0.85 + 0.15 * p
      ctx.globalAlpha = outA * Math.min(1, p * 1.4)
      ctx.scale(k, k)
      shadow()
      ctx.fillStyle = st.color
      roundRect(ctx, -bw / 2, -bh / 2, bw, bh, 12 * s)
      ctx.fill()
      // the pointer, under the box toward the lower left
      ctx.beginPath()
      ctx.moveTo(-bw / 2 + 28 * s, bh / 2 - 1)
      ctx.lineTo(-bw / 2 + 18 * s, bh / 2 + 26 * s)
      ctx.lineTo(-bw / 2 + 58 * s, bh / 2 - 1)
      ctx.closePath(); ctx.fill()
      ctx.shadowColor = 'transparent'
      const isPh = !st.text?.trim()
      drawTitle(ctx, lay, null, { fill: isPh ? PLACEHOLDER_INK : ink(st.color) }, { x: -bw / 2 + pad, y: -bh / 2 + pad * 0.7, placeholderInk: isPh ? PLACEHOLDER_INK : undefined })
      break
    }
  }
  ctx.restore()
}
