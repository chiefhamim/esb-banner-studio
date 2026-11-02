// Title layout: measured once per change (text, font, width), never per frame. Lines are broken at Intl.Segmenter
// word tokens (Bangla-safe, see segment.ts); every line, word and grapheme cluster gets its x offset, measured as the
// width of the text before it on its line, so the browser's shaping (Bangla conjuncts, kerning) is respected.
//
// Measuring goes through a `Measurer`, so tests inject a fake one and the app passes `canvasMeasurer(ctx)`.

import { getFontDef } from '../../core/fonts'
import { breakTokens, graphemes, hasBanglaText } from './segment'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export interface FontSpec {
  /** CSS font-family list, e.g. '"ESB Sans", Inter, sans-serif' or '"Hind Siliguri", "ESB Sans", sans-serif'. */
  family: string
  weight: number
  /** px */
  size: number
  /** px between letters (canvas letterSpacing); 0 for Bangla. */
  letterSpacing?: number
  /** Line height in px. */
  lineHeight: number
  italic?: boolean
  /** Which metrics to place the baseline with: Inter or Hind Siliguri (src/core/fonts.ts). */
  metrics?: 'inter' | 'bengali'
}

export type Measurer = (text: string, font: FontSpec) => number

export const cssFont = (f: FontSpec) => `${f.italic ? 'italic ' : ''}${f.weight} ${f.size}px ${f.family}`

/** A measurer over a real Canvas 2D context (works on OffscreenCanvas). Results are cached per font + text. */
export function canvasMeasurer(ctx: Ctx): Measurer {
  const cache = new Map<string, number>()
  return (text, font) => {
    const ls = font.letterSpacing ?? 0
    const k = `${cssFont(font)}|${ls}|${text}`
    const hit = cache.get(k)
    if (hit !== undefined) { cache.delete(k); cache.set(k, hit); return hit } // most recently used last
    ctx.font = cssFont(font)
    ;(ctx as CanvasRenderingContext2D).letterSpacing = `${ls}px`
    // canvas letterSpacing adds the space after the last letter too; drop it, as src/core/text.ts does
    const w = text ? Math.max(0, ctx.measureText(text).width - ls) : 0
    // least recently used out, a quarter at a time (the working set stays warm; never a wholesale clear)
    if (cache.size >= 4000) { let n = 1000; for (const key of cache.keys()) { cache.delete(key); if (--n <= 0) break } }
    cache.set(k, w)
    return w
  }
}

export type Align = 'left' | 'center' | 'right'

export interface LayoutSpec {
  text: string
  font: FontSpec
  maxWidth: number
  align?: Align
  /** Lines beyond this are cut and the last kept line ends with "…" (`truncated` is set). */
  maxLines?: number
}

export interface GlyphBox { text: string; x: number; width: number; index: number; wordIndex: number; lineIndex: number }
export interface WordBox { text: string; x: number; width: number; index: number; lineIndex: number; start: number; graphemes: GlyphBox[] }
export interface LineBox { text: string; x: number; top: number; baseline: number; width: number; index: number; words: WordBox[] }

export interface TitleLayout {
  key: string
  font: FontSpec
  align: Align
  boxWidth: number
  lines: LineBox[]
  words: WordBox[]
  graphemes: GlyphBox[]
  /** Widest line. */
  width: number
  height: number
  truncated: boolean
  counts: { line: number; word: number; grapheme: number }
}

export function layoutKey(spec: LayoutSpec): string {
  return JSON.stringify([spec.text, cssFont(spec.font), spec.font.letterSpacing ?? 0, spec.font.lineHeight, spec.maxWidth, spec.align ?? 'left', spec.maxLines ?? 0])
}

interface RawLine { tokens: { text: string; start: number; spaceBefore: boolean }[] }

const lineText = (l: RawLine) => l.tokens.map((t, i) => (i > 0 && t.spaceBefore ? ' ' : '') + t.text).join('')

/** Lay a title out. Pure given the measurer. */
export function layoutTitle(spec: LayoutSpec, measure: Measurer): TitleLayout {
  const { font, maxWidth } = spec
  const align = spec.align ?? 'left'
  const fits = (s: string) => measure(s, font) <= maxWidth + 0.01
  const raw: RawLine[] = []
  let offset = 0
  for (const para of spec.text.split('\n')) {
    const tokens = breakTokens(para)
    let cur: RawLine = { tokens: [] }
    const flush = () => { raw.push(cur); cur = { tokens: [] } }
    for (const tok0 of tokens) {
      const tok = { ...tok0, start: tok0.start + offset }
      if (cur.tokens.length) {
        const cand: RawLine = { tokens: [...cur.tokens, tok] }
        if (fits(lineText(cand))) { cur = cand; continue }
        flush()
      }
      if (fits(tok.text)) { cur.tokens.push({ ...tok, spaceBefore: false }); continue }
      // a single token wider than the box: break it between grapheme clusters (never inside one)
      let piece = ''
      let pieceStart = tok.start
      for (const g of graphemes(tok.text)) {
        if (piece && !fits(piece + g.text)) {
          cur.tokens.push({ text: piece, start: pieceStart, spaceBefore: false }); flush()
          piece = ''; pieceStart = tok.start + g.start
        }
        piece += g.text
      }
      cur.tokens.push({ text: piece, start: pieceStart, spaceBefore: false })
    }
    flush()
    offset += para.length + 1
  }

  let truncated = false
  if (spec.maxLines && raw.length > spec.maxLines) {
    truncated = true
    raw.length = spec.maxLines
    const last = raw[raw.length - 1]
    // drop clusters from the end of the last kept line until it fits with an ellipsis
    for (;;) {
      const t = last.tokens[last.tokens.length - 1]
      const withEll: RawLine = { tokens: [...last.tokens.slice(0, -1), { ...t, text: t.text + '…' }] }
      if (fits(lineText(withEll)) || (last.tokens.length === 1 && graphemes(t.text).length <= 1)) { last.tokens = withEll.tokens; break }
      const gs = graphemes(t.text)
      if (gs.length <= 1) last.tokens.pop()
      else t.text = gs.slice(0, -1).map((g) => g.text).join('')
      if (!last.tokens.length) { last.tokens = [{ text: '…', start: t.start, spaceBefore: false }]; break }
    }
  }

  const fd = getFontDef(font.metrics ?? (hasBanglaText(spec.text) ? 'bengali' : 'inter'))
  const baselineOffset = (font.lineHeight - (fd.asc + fd.desc) * font.size) / 2 + fd.asc * font.size
  const lines: LineBox[] = []
  const words: WordBox[] = []
  const glyphs: GlyphBox[] = []
  raw.forEach((rl, li) => {
    const text = lineText(rl)
    const width = measure(text, font)
    const x = align === 'center' ? (maxWidth - width) / 2 : align === 'right' ? maxWidth - width : 0
    const top = li * font.lineHeight
    const line: LineBox = { text, x, top, baseline: top + baselineOffset, width, index: li, words: [] }
    let prefix = ''
    rl.tokens.forEach((t, ti) => {
      if (ti > 0 && t.spaceBefore) prefix += ' '
      const wx = x + (prefix ? measure(prefix, font) : 0)
      const word: WordBox = { text: t.text, x: wx, width: measure(t.text, font), index: words.length, lineIndex: li, start: t.start, graphemes: [] }
      let gPrefix = ''
      for (const g of graphemes(t.text)) {
        const gx = wx + (gPrefix ? measure(gPrefix, font) : 0)
        const box: GlyphBox = { text: g.text, x: gx, width: measure(g.text, font), index: glyphs.length, wordIndex: word.index, lineIndex: li }
        word.graphemes.push(box)
        glyphs.push(box)
        gPrefix += g.text
      }
      words.push(word)
      line.words.push(word)
      prefix += t.text
    })
    lines.push(line)
  })
  return {
    key: layoutKey(spec),
    font,
    align,
    boxWidth: maxWidth,
    lines,
    words,
    graphemes: glyphs,
    width: lines.reduce((a, l) => Math.max(a, l.width), 0),
    height: lines.length * font.lineHeight,
    truncated,
    counts: { line: lines.length, word: words.length, grapheme: glyphs.length },
  }
}

/** A small cache so the same title is laid out once (the renderer calls this every frame). */
export function createLayoutCache(limit = 256) {
  // one memo per measurer: a layout made with the measurer of before the fonts arrived is never served to the new one
  const memos = new WeakMap<Measurer, Map<string, TitleLayout>>()
  return (spec: LayoutSpec, measure: Measurer): TitleLayout => {
    let memo = memos.get(measure)
    if (!memo) { memo = new Map(); memos.set(measure, memo) }
    const k = layoutKey(spec)
    const hit = memo.get(k)
    if (hit) { memo.delete(k); memo.set(k, hit); return hit }
    const out = layoutTitle(spec, measure)
    if (memo.size >= limit) memo.delete(memo.keys().next().value as string)
    memo.set(k, out)
    return out
  }
}
