import type { TextEl } from './types'

// Inter vertical metrics (hhea): ascender 0.96875 em, descender 0.2412 em  ->  "auto" line height 1.21 em.
import { getFontDef } from './fonts'

export const ASC = 0.96875
export const DESC = 0.2412109375
export const AUTO_LH = ASC + DESC

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export function fontString(weight: number, size: number, font?: string): string {
  return `${weight} ${size}px "${getFontDef(font).family}", "Hind Siliguri", Inter, sans-serif`
}

export function prepare(ctx: Ctx, el: Pick<TextEl, 'weight' | 'size' | 'ls' | 'font'>): void {
  ctx.font = fontString(el.weight, el.size, el.font)
  ;(ctx as CanvasRenderingContext2D).letterSpacing = `${el.ls}px`
  ;(ctx as CanvasRenderingContext2D).fontKerning = 'normal'
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
}

export function lineHeightPx(el: Pick<TextEl, 'size' | 'lh' | 'font'>): number {
  const f = getFontDef(el.font)
  return el.lh == null ? el.size * (f.asc + f.desc) : (el.size * el.lh) / 100
}

export interface Line { text: string; start: number; width: number }
export interface TextLayout { lines: Line[]; lineH: number; height: number; width: number }

let measureCtx: CanvasRenderingContext2D | null = null
export function getMeasureCtx(): CanvasRenderingContext2D {
  if (measureCtx) return measureCtx
  if (typeof document !== 'undefined') {
    measureCtx = document.createElement('canvas').getContext('2d')!
    return measureCtx
  }
  // Headless / Node environment fallback for unit tests
  measureCtx = {
    font: '',
    measureText: (text: string) => ({
      width: text.length * 8,
    }),
  } as unknown as CanvasRenderingContext2D
  return measureCtx
}

/** Greedy word wrap, matching how Figma breaks lines (breaks at spaces, trailing spaces ignored). */
type LayoutKey = Pick<TextEl, 'text' | 'weight' | 'size' | 'ls' | 'lh' | 'fit' | 'w' | 'font'>
const layoutMemo = new Map<string, TextLayout>()

/** Cached: the same text/style/width is laid out many times per interaction (build, settle, draw, panels). */
export function layoutText(ctx: Ctx, el: LayoutKey): TextLayout {
  const key = `${el.font ?? ''}|${el.weight}|${el.size}|${el.ls}|${el.lh}|${el.fit}|${el.fit === 'hug' ? 0 : el.w}|${el.text}`
  const hit = layoutMemo.get(key)
  if (hit) return hit
  const out = computeLayout(ctx, el)
  if (layoutMemo.size > 600) layoutMemo.clear()
  layoutMemo.set(key, out)
  return out
}

function computeLayout(ctx: Ctx, el: LayoutKey): TextLayout {
  prepare(ctx, el)
  const lineH = lineHeightPx(el)
  const lines: Line[] = []
  let offset = 0
  for (const para of el.text.split('\n')) {
    if (el.fit === 'hug') {
      lines.push({ text: para, start: offset, width: Math.max(0, ctx.measureText(para).width - el.ls) })
    } else {
      // break opportunities: spaces and right after a hyphen (Figma breaks "Battery-" / "Powered")
      const words: { t: string; s: number; sp: boolean }[] = []
      const re = /\S+/g
      let m: RegExpExecArray | null
      while ((m = re.exec(para))) {
        const pieces = m[0].match(/[^-–]+[-–]?|[-–]+/g) ?? [m[0]]
        let at = m.index
        pieces.forEach((p, i) => { words.push({ t: p, s: at, sp: i === 0 }); at += p.length })
      }
      if (!words.length) lines.push({ text: '', start: offset, width: 0 })
      let cur = ''
      let curStart = 0
      for (const w of words) {
        const cand = cur ? cur + (w.sp ? ' ' : '') + w.t : w.t
        if (cur && ctx.measureText(cand).width > el.w + 0.01) {
          lines.push({ text: cur, start: offset + curStart, width: Math.max(0, ctx.measureText(cur).width - el.ls) })
          cur = w.t
          curStart = w.s
        } else {
          if (!cur) curStart = w.s
          cur = cand
        }
      }
      if (cur) lines.push({ text: cur, start: offset + curStart, width: Math.max(0, ctx.measureText(cur).width - el.ls) })
    }
    offset += para.length + 1
  }
  const width = lines.reduce((a, l) => Math.max(a, l.width), 0)
  return { lines, lineH, height: lines.length * lineH, width }
}

/** Natural (single-line) width of a string in the element's style. */
export function measureWidth(el: Pick<TextEl, 'text' | 'weight' | 'size' | 'ls' | 'font'>): number {
  const ctx = getMeasureCtx()
  prepare(ctx, el)
  return Math.max(0, ctx.measureText(el.text).width - el.ls)
}

export function drawText(ctx: Ctx, el: TextEl): void {
  const lay = layoutText(ctx, el)
  prepare(ctx, el)
  const fd = getFontDef(el.font)
  const baselineOffset = (lay.lineH - (fd.asc + fd.desc) * el.size) / 2 + fd.asc * el.size
  const boxW = el.fit === 'hug' ? lay.width : el.w
  lay.lines.forEach((line, i) => {
    const y = el.y + i * lay.lineH + baselineOffset
    let x = el.x
    if (el.align === 'center') x = el.x + (boxW - line.width) / 2
    else if (el.align === 'right') x = el.x + boxW - line.width
    // split into colour runs
    const cuts = new Set<number>([0, line.text.length])
    for (const r of el.runs) {
      const a = r.start - line.start
      const b = r.end - line.start
      if (a > 0 && a < line.text.length) cuts.add(a)
      if (b > 0 && b < line.text.length) cuts.add(b)
    }
    const pts = [...cuts].sort((p, q) => p - q)
    let cx = x
    for (let k = 0; k < pts.length - 1; k++) {
      const seg = line.text.slice(pts[k], pts[k + 1])
      if (!seg) continue
      const absIdx = line.start + pts[k]
      const run = el.runs.find((r) => absIdx >= r.start && absIdx < r.end)
      if (el.stroke && el.stroke.width > 0) {
        ctx.save()
        ctx.lineWidth = el.stroke.width * 2 // centred stroke: half is hidden under the fill
        ctx.lineJoin = 'round'
        ctx.strokeStyle = el.stroke.color
        ctx.strokeText(seg, cx, y)
        ctx.restore()
      }
      ctx.fillStyle = run ? run.color : el.color
      ctx.fillText(seg, cx, y)
      cx += ctx.measureText(seg).width
    }
  })
}

