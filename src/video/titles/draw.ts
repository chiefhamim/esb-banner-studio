// Canvas 2D title renderer (works on an OffscreenCanvas). Draws a laid-out title (layout.ts) with a style (fill or
// gradient, stroke, shadow, background box) in an animation state (anim.ts), and optionally a karaoke word highlight.
//
// Settled units are drawn as whole words, so the browser shapes them exactly as a static title; only units in motion
// are drawn piece by piece. A grapheme cluster is the smallest piece, so a Bangla conjunct is always shaped whole.
// Italic is a 12° shear about the baseline, the same as the Graphics desk (src/core/text.ts): the bundled fonts have
// no italic files and Chromium does not synthesise one for a canvas FontFace.

import type { AnimFrame, UnitState } from './anim'
import { IDENTITY } from './anim'
import { cssFont, type TitleLayout, type LineBox, type WordBox, type GlyphBox } from './layout'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

const ITALIC_SHEAR = -0.21 // src/core/text.ts drawText

export interface GradientFill { type: 'linear'; /** degrees, 0 = left → right, 90 = top → bottom */ angle: number; stops: [number, string][] }
export type Fill = string | GradientFill

export interface TitleStyle {
  fill: Fill
  /** Outline drawn under the fill (centred stroke, so `width` is what shows outside the letters). */
  stroke?: { color: string; width: number }
  shadow?: { color: string; blur: number; dx: number; dy: number }
  /** Background box behind the block ('block') or behind each line ('line', caption style). */
  box?: { fill: string; padX: number; padY: number; radius: number; mode?: 'block' | 'line' }
  /** Karaoke colours: spoken words, the word being spoken (with an optional pill behind it), words to come. */
  karaoke?: { past?: string; active: string; future?: string; activeBox?: string }
}

/** Which word is being spoken (karaoke.ts `karaokeState`). */
export interface KaraokeFrame { active: number; past: (i: number) => boolean }

export interface DrawOptions {
  x: number
  y: number
  karaoke?: KaraokeFrame | null
  /** Draw placeholder text dimmed (editor only; validate.ts keeps placeholders out of exports). */
  placeholderInk?: string
}

export function paint(ctx: Ctx, fill: Fill, layout: { boxWidth: number; height: number }): string | CanvasGradient {
  if (typeof fill === 'string') return fill
  const w = layout.boxWidth, h = layout.height
  const a = (fill.angle * Math.PI) / 180
  const cx = w / 2, cy = h / 2
  const r = (Math.abs(Math.cos(a)) * w + Math.abs(Math.sin(a)) * h) / 2
  const g = ctx.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r)
  for (const [o, c] of fill.stops) g.addColorStop(Math.min(1, Math.max(0, o)), c)
  return g
}

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2))
  else ctx.rect(x, y, w, h)
}

/** Apply a unit state around the unit's box centre, then run `fn`. */
export function withState(ctx: Ctx, s: UnitState, box: { x: number; y: number; w: number; h: number }, fn: () => void) {
  if (s.opacity <= 0) return
  if (s.clip && (s.clip.x1 <= s.clip.x0 || s.clip.y1 <= s.clip.y0)) return
  ctx.save()
  ctx.globalAlpha *= s.opacity
  if (s.dx || s.dy) ctx.translate(s.dx, s.dy)
  if (s.scale !== 1) {
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2
    ctx.translate(cx, cy); ctx.scale(s.scale, s.scale); ctx.translate(-cx, -cy)
  }
  if (s.clip) {
    // the clip box reaches a little beyond the letters so descenders and strokes are not shaved when fully open
    ctx.beginPath()
    ctx.rect(box.x + box.w * s.clip.x0, box.y + box.h * s.clip.y0, box.w * (s.clip.x1 - s.clip.x0), box.h * (s.clip.y1 - s.clip.y0))
    ctx.clip()
  }
  if (s.blur > 0.05 && 'filter' in ctx) {
    // blur only what this unit can touch: clip to its box plus the blur's reach, so the filter works on a small area
    // and not on the whole canvas for every word
    const pad = s.blur * 3 + 24
    ctx.beginPath()
    ctx.rect(box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2)
    ctx.clip()
    ctx.filter = `blur(${s.blur.toFixed(2)}px)`
  }
  fn()
  ctx.restore()
}

function glyphText(ctx: Ctx, text: string, x: number, y: number, style: TitleStyle, italic: boolean, fill: string | CanvasGradient) {
  const at = (f: (tx: number, ty: number) => void) => {
    if (!italic) { f(x, y); return }
    ctx.save(); ctx.translate(x, y); ctx.transform(1, 0, ITALIC_SHEAR, 1, 0, 0); f(0, 0); ctx.restore()
  }
  if (style.stroke && style.stroke.width > 0) {
    // the shadow is cast once, by the plain letters (a shadow of the wide outline path costs 3x as much at 4K and is
    // hardly different); then the outline, then the letters again on top without a shadow
    ctx.fillStyle = fill
    at((tx, ty) => ctx.fillText(text, tx, ty))
    ctx.save()
    ctx.shadowColor = 'transparent'
    ctx.lineWidth = style.stroke.width * 2
    ctx.lineJoin = 'round'
    ctx.strokeStyle = style.stroke.color
    at((tx, ty) => ctx.strokeText(text, tx, ty))
    ctx.fillStyle = fill
    at((tx, ty) => ctx.fillText(text, tx, ty))
    ctx.restore()
    return
  }
  ctx.fillStyle = fill
  at((tx, ty) => ctx.fillText(text, tx, ty))
}

/** Draw a title. `anim` null = the settled title. */
export function drawTitle(ctx: Ctx, layout: TitleLayout, anim: AnimFrame | null, style: TitleStyle, opts: DrawOptions): void {
  if (anim?.hidden) return
  const f = layout.font
  const lh = f.lineHeight
  ctx.save()
  ctx.translate(opts.x, opts.y)
  ctx.font = cssFont(f)
  ;(ctx as CanvasRenderingContext2D).letterSpacing = `${f.letterSpacing ?? 0}px`
  ;(ctx as CanvasRenderingContext2D).fontKerning = 'normal'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  const block = anim?.block ?? IDENTITY

  // background box
  if (style.box) {
    const b = style.box
    const boxes = b.mode === 'line'
      ? layout.lines.filter((l) => l.width > 0).map((l) => ({ x: l.x - b.padX, y: l.top - b.padY / 2, w: l.width + b.padX * 2, h: lh + b.padY }))
      : [{ x: Math.min(...layout.lines.map((l) => l.x)) - b.padX, y: -b.padY, w: layout.width + b.padX * 2, h: layout.height + b.padY * 2 }]
    const all = boxes.reduce((a, r) => ({ x: Math.min(a.x, r.x), y: Math.min(a.y, r.y), w: Math.max(a.x + a.w, r.x + r.w) - Math.min(a.x, r.x), h: Math.max(a.y + a.h, r.y + r.h) - Math.min(a.y, r.y) }), boxes[0] ?? { x: 0, y: 0, w: 0, h: 0 })
    withState(ctx, block, all, () => {
      ctx.fillStyle = b.fill
      for (const r of boxes) { roundRect(ctx, r.x, r.y, r.w, r.h, b.radius); ctx.fill() }
    })
  }

  if (style.shadow) {
    ctx.shadowColor = style.shadow.color
    ctx.shadowBlur = style.shadow.blur
    ctx.shadowOffsetX = style.shadow.dx
    ctx.shadowOffsetY = style.shadow.dy
  }
  const baseFill = opts.placeholderInk ?? paint(ctx, style.fill, layout)
  const k = style.karaoke && opts.karaoke ? { ...style.karaoke, frame: opts.karaoke } : null
  const wordFill = (w: WordBox): string | CanvasGradient => {
    if (!k) return baseFill
    if (w.index === k.frame.active) return k.active
    if (k.frame.past(w.index)) return k.past ?? baseFill
    return k.future ?? baseFill
  }
  const italic = !!f.italic
  const lineBox = (l: LineBox) => ({ x: l.x, y: l.top, w: Math.max(l.width, 1), h: lh })
  const wordBox = (w: WordBox, l: LineBox) => ({ x: w.x, y: l.top, w: Math.max(w.width, 1), h: lh })
  const glyphBox = (g: GlyphBox, l: LineBox) => ({ x: g.x, y: l.top, w: Math.max(g.width, 1), h: lh })

  const drawWord = (w: WordBox, l: LineBox) => {
    if (k && w.index === k.frame.active && k.activeBox) {
      ctx.save(); ctx.shadowColor = 'transparent'
      ctx.fillStyle = k.activeBox
      roundRect(ctx, w.x - f.size * 0.18, l.top + lh * 0.08, w.width + f.size * 0.36, lh * 0.84, f.size * 0.2); ctx.fill()
      ctx.restore()
    }
    glyphText(ctx, w.text, w.x, l.baseline, style, italic, wordFill(w))
  }

  const unit = anim?.unit ?? 'all'
  const states = anim?.states ?? [IDENTITY]
  withState(ctx, unit === 'all' ? states[0] : IDENTITY, { x: 0, y: 0, w: layout.boxWidth, h: layout.height }, () => {
    for (const l of layout.lines) {
      if (unit === 'line') { withState(ctx, states[l.index], lineBox(l), () => l.words.forEach((w) => drawWord(w, l))); continue }
      for (const w of l.words) {
        if (unit === 'word') { withState(ctx, states[w.index], wordBox(w, l), () => drawWord(w, l)); continue }
        if (unit === 'grapheme') {
          // a word whose clusters are all settled is drawn whole (exact shaping); else cluster by cluster
          if (w.graphemes.every((g) => states[g.index] === IDENTITY)) { drawWord(w, l); continue }
          for (const g of w.graphemes) withState(ctx, states[g.index], glyphBox(g, l), () => glyphText(ctx, g.text, g.x, l.baseline, style, italic, wordFill(w)))
          continue
        }
        drawWord(w, l)
      }
    }
  })
  ctx.restore()
}
