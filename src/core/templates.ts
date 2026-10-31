import { getCollage } from './collage'
import { SOCIAL_ICONS } from './icons'
import { LABEL_ICONS, LABEL_PRESETS } from './newsroom'
import { getMeasureCtx, layoutText, lineHeightPx, measureWidth } from './text'
import {
  FOOTER_TEXT, FORMATS, INK, getFormat, FORMAT_IDS, LINK_PILL, SOCIAL_BG, STRIPE_COLORS, WEB_HEADER, WEEKDAY_RED,
  darkAccent, getCategory,
} from './tokens'
import type { Category } from './tokens'
import type {
  CardDesign, Doc, El, FormatId, GradientFill, IconEl, ImageEl, Override, PhotoSlot, PhotosEl, RectEl, Scene, TextEl, WatermarkEl,
} from './types'

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER']
const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']

export function dateParts(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return { num: String(dt.getDate()), monthYear: `${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`, weekday: WEEKDAYS[dt.getDay()] }
}

/** Headline sizes per format [1-70 chars, 71-90 chars]. Classic and Web come from the Figma guideline; 4:5 and 1:1 are tuned for the phone feed. */
const HEAD_SIZES: Record<FormatId, [number, number]> = {
  social: [60, 56],
  web: [56, 50],
  fb45: [58, 52],
  sq: [50, 45],
  yt: [46, 42],
  story: [58, 52],
  'lower-third': [38, 32],
  'title-card': [64, 56],
  'end-card': [48, 42],
}
export function headlineSize(format: FormatId, chars: number): number {
  return HEAD_SIZES[format][chars > 70 ? 1 : 0]
}

type Factory = {
  rect: (id: string, name: string, group: string, x: number, y: number, w: number, h: number, fill: RectEl['fill'], radius?: number, shadow?: RectEl['shadow']) => RectEl
  text: (id: string, name: string, group: string, x: number, y: number, p: Partial<TextEl> & { text: string; size: number }) => TextEl
  icon: (id: string, name: string, group: string, x: number, y: number, w: number, def: { vw: number; vh: number; paths: IconEl['paths'] }, ink?: string) => IconEl
}

function makeFactory(format: FormatId, doc: Doc): Factory & { ov: (id: string) => Override } {
  const ov = (id: string): Override => doc.overrides[`${format}:${id}`] ?? {}
  const base = (id: string, name: string, group: string, x: number, y: number, w: number, h: number) => ({
    id, name, group, x, y, w, h, visible: true, locked: false, opacity: 1,
  })
  return {
    ov,
    rect: (id, name, group, x, y, w, h, fill, radius = 0, shadow) => {
      const o = ov(id)
      return { kind: 'rect', ...base(id, name, group, x, y, w, h), fill: o.fill ?? fill, radius: o.radius ?? radius, shadow }
    },
    text: (id, name, group, x, y, p) => {
      const o = ov(id)
      const el: TextEl = {
        kind: 'text', ...base(id, name, group, x, y, p.w ?? 0, 0),
        text: o.text ?? p.text, weight: o.weight ?? p.weight ?? 800, font: o.font ?? p.font, size: o.size ?? p.size, ls: o.ls ?? p.ls ?? 0,
        lh: o.lh ?? p.lh ?? null, align: o.align ?? p.align ?? 'left', color: o.color ?? p.color ?? INK, runs: p.runs ?? [], fit: p.fit ?? 'hug',
      }
      return el
    },
    icon: (id, name, group, x, y, w, def, ink) => {
      const h = (w * def.vh) / def.vw
      return { kind: 'icon', ...base(id, name, group, x, y, w, h), vw: def.vw, vh: def.vh, paths: def.paths, ink }
    },
  }
}

/** Fill in measured width/height of text boxes. */
function settle(el: TextEl): TextEl {
  const ctx = getMeasureCtx()
  const lay = layoutText(ctx, el)
  if (el.fit === 'hug') el.w = lay.width
  el.h = lay.height
  return el
}

function stripes(F: Factory, ys: number[], h: number, widths: number[], xs: number[], idPrefix: string, group: string): RectEl[] {
  const out: RectEl[] = []
  ys.forEach((y, row) => {
    STRIPE_COLORS.forEach((c, i) => out.push(F.rect(`${idPrefix}-${row}-${i}`, `Stripe ${row + 1}.${i + 1}`, group, xs[i], y, widths[i], h, c)))
  })
  return out
}

function highlightRuns(text: string, phrase: string, color: string) {
  const needle = phrase.trim()
  if (!needle) return []
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const wordRe = new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`, 'gi')
  const runs: { start: number; end: number; color: string }[] = []
  for (const m of text.matchAll(wordRe)) {
    if (m.index !== undefined) runs.push({ start: m.index, end: m.index + m[0].length, color })
  }
  if (runs.length) return runs
  const i = text.toLowerCase().indexOf(needle.toLowerCase())
  return i < 0 ? [] : [{ start: i, end: i + needle.length, color }]
}

/** Photo credit on a corner of the photo area: text (styled from the Story panel) plus an optional dark pill behind it. */
function creditLine(F: Factory, c: Doc['content'], area: { x: number; y: number; w: number; h: number }): El[] {
  const m = 24
  const text = settle(F.text('credit', 'Photo credit', 'Photo', 0, 0, { text: c.credit.trim(), size: c.creditSize, weight: 700, font: c.creditFont, ls: 0.2, color: c.creditColor }))
  const padX = 14, padY = 7
  const inset = c.creditChip ? padX : 0
  text.x = c.creditPos === 'bl' || c.creditPos === 'tl' ? area.x + m + inset : area.x + area.w - m - inset - text.w
  text.y = c.creditPos === 'bl' || c.creditPos === 'br' ? area.y + area.h - 14 - (c.creditChip ? padY : 0) - text.h : area.y + 14 + (c.creditChip ? padY : 0)
  if (!c.creditChip) {
    text.dropShadow = { x: 0, y: 1.5, blur: 6, color: '#000000', alpha: 0.8 }
    return [text]
  }
  const chip = F.rect('credit-bg', 'Photo credit pill', 'Photo', text.x - padX, text.y - padY, text.w + padX * 2, text.h + padY * 2, 'rgba(8,12,20,0.62)', 10)
  return [chip, text]
}

/** The website's news label (Breaking / Featured / Trending / custom) as a pill on a corner of the photo: rect + icon + text, scaled to the format. */
function labelPill(F: Factory, c: Doc['content'], area: { x: number; y: number; w: number; h: number }, W: number, header: { x: number; y: number; w: number; h: number }): El[] {
  if (c.label === 'none') return []
  const preset = c.label === 'custom' ? null : LABEL_PRESETS[c.label]
  const bg = preset ? preset.bg : c.labelColor
  const border = preset ? preset.border : darkAccent(c.labelColor)
  const text = (c.labelText.trim() || (preset ? preset.text : 'LABEL')).toUpperCase()
  const icon = preset?.icon ?? null
  const f = Math.round(19 * (W / 1080) * c.labelScale * 100) / 100
  const h = f * 2, padX = f * 0.95, gap = f * 0.45, ic = f * 1.1
  const t = settle(F.text('label-text', 'Label text', 'Label', 0, 0, { text, size: f, weight: 700, ls: f * 0.07, color: '#ffffff' }))
  const w = padX * 2 + (icon ? ic + gap : 0) + t.w
  const m = 24 * (W / 1080)
  // 'hc' = centred in the header, with exactly the same gap above (to the top stripe) and below (to the bottom stripe)
  const x = c.labelPos === 'hc' ? header.x + (header.w - w) / 2 : c.labelPos === 'tl' || c.labelPos === 'bl' ? area.x + m : area.x + area.w - m - w
  const y = c.labelPos === 'hc' ? header.y + (header.h - h) / 2 : c.labelPos === 'tl' || c.labelPos === 'tr' ? area.y + m : area.y + area.h - m - h
  const rect = F.rect('label-bg', 'Label pill', 'Label', x, y, w, h, bg, h / 2, { x: 0, y: Math.max(1, f * 0.12), blur: f * 0.3, color: bg, alpha: 0.4 })
  rect.stroke = { color: border, width: Math.max(1.5, f * 0.07) }
  t.x = x + padX + (icon ? ic + gap : 0)
  t.y = y + (h - t.h) / 2
  const els: El[] = [rect]
  if (icon) els.push(F.icon('label-icon', 'Label icon', 'Label', x + padX, y + (h - ic) / 2, ic, { vw: 24, vh: 24, paths: LABEL_ICONS[icon] }, '#ffffff'))
  els.push(t)
  return els
}

function photosEl(F: Factory, id: string, x: number, y: number, w: number, h: number, doc: Doc, format: FormatId, tint: string): PhotosEl {
  const o = F.rect(id, 'Photos', 'Photo', x, y, w, h, '#000')
  const need = getCollage(doc.photos.collage).count
  const slots: PhotoSlot[] = Array.from({ length: need }, (_, i) => doc.photos.slots[format][i] ?? { src: null, zoom: 1, panX: 0, panY: 0 })
  return {
    kind: 'photos', id: o.id, name: 'Photos', group: 'Photo', x, y, w, h, visible: true, locked: false, opacity: 1,
    collage: doc.photos.collage, gap: doc.photos.gap, gapColor: doc.photos.gapColor, slots, tint, backdrop: doc.photos.backdrop ?? 'blur',
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Quote and Stats cards are built from independent design choices (types.ts CardDesign): picture or none, background,
// typeface, alignment, accent, order and highlight colour, plus size. A preset is only a starting combination; any
// choice changed afterwards is kept in content.quoteDesign / statDesign on top of the preset. Every piece is its own
// element, so it can still be selected, moved and restyled on the banner.
export interface CardPreset { id: string; name: string; note: string; d: CardDesign }
export const QUOTE_PRESETS: CardPreset[] = [
  { id: 'classic', name: 'Classic', note: 'Serif, centred', d: { photo: true, bg: 'tint', face: 'serif', align: 'center', mark: 'none', order: 'main', emph: 'accent' } },
  { id: 'bold', name: 'Bold', note: 'Big mark, left', d: { photo: true, bg: 'tint', face: 'sans', align: 'left', mark: 'mark', order: 'main', emph: 'accent' } },
  { id: 'minimal', name: 'Minimal', note: 'Paper, a rule', d: { photo: true, bg: 'paper', face: 'serif', align: 'center', mark: 'rule', order: 'main', emph: 'ink' } },
  { id: 'spotlight', name: 'Spotlight', note: 'Dark band', d: { photo: true, bg: 'ink', face: 'serif', align: 'center', mark: 'none', order: 'main', emph: 'accent' } },
  { id: 'poster', name: 'Poster', note: 'No photo, desk colour', d: { photo: false, bg: 'accent', face: 'condensed', align: 'left', mark: 'bar', order: 'main', emph: 'ink' } },
  { id: 'editorial', name: 'Editorial', note: 'No photo, paper', d: { photo: false, bg: 'paper', face: 'serif', align: 'left', mark: 'mark', order: 'main', emph: 'accent' } },
]
export const STAT_PRESETS: CardPreset[] = [
  { id: 'classic', name: 'Classic', note: 'Label over number', d: { photo: true, bg: 'tint', face: 'grotesk', align: 'center', mark: 'none', order: 'main', emph: 'accent' } },
  { id: 'hero', name: 'Hero', note: 'One huge number', d: { photo: true, bg: 'tint', face: 'grotesk', align: 'center', mark: 'none', order: 'alt', emph: 'accent' } },
  { id: 'split', name: 'Split', note: 'Number | words', d: { photo: true, bg: 'tint', face: 'grotesk', align: 'center', mark: 'rule', order: 'split', emph: 'accent' } },
  { id: 'spotlight', name: 'Spotlight', note: 'Dark band', d: { photo: true, bg: 'ink', face: 'grotesk', align: 'center', mark: 'none', order: 'main', emph: 'accent' } },
  { id: 'figure', name: 'Big figure', note: 'No photo, gradient', d: { photo: false, bg: 'gradient', face: 'condensed', align: 'left', mark: 'bar', order: 'alt', emph: 'ink' } },
  { id: 'report', name: 'Report', note: 'No photo, framed', d: { photo: false, bg: 'paper', face: 'grotesk', align: 'center', mark: 'frame', order: 'main', emph: 'accent' } },
]

/** The design in force: the chosen preset (Classic if none) with the editor's own changes on top. */
export function cardDesign(c: Doc['content'], kind: 'quote' | 'stat'): CardDesign {
  const presets = kind === 'quote' ? QUOTE_PRESETS : STAT_PRESETS
  const id = (kind === 'quote' ? c.quoteStyle : c.statStyle) ?? 'classic'
  const base = (presets.find((p) => p.id === id) ?? presets[0]).d
  return { ...base, ...((kind === 'quote' ? c.quoteDesign : c.statDesign) ?? {}) }
}

const SPOT_BG = '#0e1420'
const PAPER = '#f7f5ef'
const SUB = '#4a5568'
const SPOT_SUB = '#b8c2d1'
const TREND_UP = '#15803d'
const TREND_UP_DARK = '#4ade80'
const TREND_DOWN_DARK = '#f87171'

function mixHex(a: string, b: string, t: number): string {
  const pa = /^#?([0-9a-f]{6})$/i.exec(a.trim()), pb = /^#?([0-9a-f]{6})$/i.exec(b.trim())
  if (!pa || !pb) return a
  const na = parseInt(pa[1], 16), nb = parseInt(pb[1], 16)
  const ch = (s: number) => Math.round(((na >> s) & 255) + ((((nb >> s) & 255) - ((na >> s) & 255)) * t)).toString(16).padStart(2, '0')
  return '#' + ch(16) + ch(8) + ch(0)
}
/** The desk colour lifted toward white, so a dark accent (indigo, navy) still reads on a dark band. */
const onDark = (hex: string) => mixHex(hex, '#ffffff', 0.38)
function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim()); if (!m) return 0.5
  const n = parseInt(m[1], 16)
  const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
}

interface CardColours { fill: RectEl['fill']; ink: string; sub: string; hi: string; dark: boolean }
function cardColours(d: CardDesign, accent: string, band: string): CardColours {
  const base = cardColoursFor(d, accent, band)
  if (!d.bgColor && !d.inkColor && !d.hiColor) return base
  // the editor's own colours: a picked background decides light or dark text unless the text colour is picked too
  let out = base
  if (d.bgColor) {
    const dark = luminance(d.bgColor) < 0.4
    const ink = dark ? '#ffffff' : INK
    out = {
      fill: d.bg === 'gradient' ? { stops: [{ p: 0, c: d.bgColor }, { p: 1, c: mixHex(d.bgColor, '#000000', 0.45) }], tf: GRADIENT_DOWN } : d.bgColor,
      ink, sub: mixHex(ink, d.bgColor, 0.3), hi: d.emph === 'ink' ? ink : (dark ? onDark(accent) : darkAccent(accent)), dark,
    }
  }
  if (d.inkColor) out = { ...out, ink: d.inkColor, sub: mixHex(d.inkColor, typeof out.fill === 'string' ? out.fill : '#808080', 0.3) }
  if (d.hiColor) out = { ...out, hi: d.hiColor }
  return out
}
function cardColoursFor(d: CardDesign, accent: string, band: string): CardColours {
  const hi = (base: string, dark: boolean) => d.emph === 'ink' ? (dark ? '#ffffff' : INK) : base
  switch (d.bg) {
    case 'paper': return { fill: PAPER, ink: INK, sub: SUB, hi: hi(darkAccent(accent), false), dark: false }
    case 'ink': return { fill: SPOT_BG, ink: '#ffffff', sub: SPOT_SUB, hi: hi(onDark(accent), true), dark: true }
    case 'accent': {
      const darkText = luminance(accent) > 0.45
      const ink = darkText ? INK : '#ffffff'
      return { fill: accent, ink, sub: mixHex(ink, accent, 0.25), hi: ink, dark: !darkText }
    }
    case 'gradient':
      return { fill: { stops: [{ p: 0, c: accent }, { p: 1, c: darkAccent(darkAccent(accent)) }], tf: GRADIENT_DOWN }, ink: '#ffffff', sub: '#e3e7ee', hi: '#ffffff', dark: true }
    default: return { fill: band, ink: INK, sub: SUB, hi: hi(darkAccent(accent), false), dark: false }
  }
}

const FACE: Record<CardDesign['face'], { font: TextEl['font']; weight: 500 | 700 | 800; lh: number; ls: number }> = {
  serif: { font: 'serif', weight: 700, lh: 124, ls: 0 },
  sans: { font: 'inter', weight: 800, lh: 116, ls: -0.4 },
  condensed: { font: 'oswald', weight: 700, lh: 112, ls: 0.2 },
  grotesk: { font: 'grotesk', weight: 800, lh: 112, ls: -1 },
}

interface CardBox { x: number; w: number; top: number; h: number }

/** On a Quote / Stats card the band behind the words is a container: when the editor moves or resizes it, the text box
 *  inside keeps the same side margins and fills the band's new height, so the words follow and re-centre. */
function boxInBand(box: CardBox, band: { x: number; y: number; w: number; h: number }, o: Override): CardBox {
  const x = band.x + (o.dx ?? 0), y = band.y + (o.dy ?? 0), w = o.w ?? band.w, h = o.h ?? band.h
  return { x: x + (box.x - band.x), w: Math.max(120, w - (band.w - box.w)), top: y, h: Math.max(60, h) }
}

/** The card's text box: a real element ('card-box') the editor drags and resizes on the banner. It is created at the
 *  template's box (applyOverrides then moves/sizes it like any element) and the text is laid out in the moved, resized
 *  box — so the words follow the box and re-wrap to its width. Transparent until the editor gives it a fill. */
function cardTextBox(F: Factory & { ov: (id: string) => Override }, base: CardBox, k: number): { live: CardBox; el: RectEl } {
  const o = F.ov('card-box')
  const w = Math.max(160 * k, o.w ?? base.w), h = Math.max(80 * k, o.h ?? base.h)
  const live = { x: base.x + (o.dx ?? 0), top: base.top + (o.dy ?? 0), w, h }
  return { live, el: F.rect('card-box', 'Text box', 'Headline', base.x, base.top, base.w, base.h, 'rgba(0,0,0,0)', 16 * k) }
}
interface CardBlock { headline: TextEl; extras: El[]; fill: RectEl['fill'] }

/** Stack items vertically, centred in the box, with the given gap before each one; returns the block's top and bottom. */
function stackIn(box: CardBox, items: { el: El; gap: number }[]): [number, number] {
  const total = items.reduce((s, it, i) => s + (i ? it.gap : 0) + it.el.h, 0)
  let y = box.top + (box.h - total) / 2
  const top = y
  items.forEach((it, i) => { if (i) y += it.gap; it.el.y = y; y += it.el.h })
  return [top, y]
}

/** "▲ +1,240 MW" reads as up, "▼ −3 %" as down; the editor can force either or turn the colour off. */
export function trendOf(text: string, mode: 'auto' | 'up' | 'down' | 'none' = 'auto'): 'up' | 'down' | 'none' {
  if (mode !== 'auto') return mode
  const t = text.trim()
  if (/^[▲↑⬆+]|\bup\b|rise|record|high/i.test(t)) return 'up'
  if (/^[▼↓⬇\-−–]|\bdown\b|fall|drop|low/i.test(t)) return 'down'
  return 'none'
}

/** Accent pieces around a finished block: a side bar (or a short top bar when centred) or a frame. */
function ornaments(F: Factory, d: CardDesign, box: CardBox, top: number, bottom: number, textX: number, textW: number, accent: string, k: number): El[] {
  if (d.mark === 'bar') {
    if (d.align === 'center') { const w = 56 * k; return [F.rect('card-bar', 'Accent bar', 'Headline', box.x + (box.w - w) / 2, top - 26 * k, w, 6 * k, accent, 3 * k)] }
    const x = d.align === 'left' ? textX - 26 * k : textX + textW + 20 * k
    return [F.rect('card-bar', 'Accent bar', 'Headline', x, top, 6 * k, bottom - top, accent, 3 * k)]
  }
  if (d.mark === 'frame') {
    const p = 28 * k
    const fr = F.rect('card-frame', 'Frame', 'Headline', textX - p, top - p, textW + p * 2, bottom - top + p * 2, 'rgba(0,0,0,0)', 14 * k)
    fr.stroke = { color: accent, width: 3 * k }
    return [fr]
  }
  return []
}

function quoteBlock(F: Factory, c: Doc['content'], accent: string, band: string, box: CardBox, k: number, boost: number, r2: (v: number) => number): CardBlock {
  const d = cardDesign(c, 'quote')
  const col = cardColours(d, accent, band)
  const face = FACE[d.face]
  const sc = (c.cardScale ?? 1) * boost
  const raw = (c.quoteText || c.headline).trim() || 'Type the statement or quote here'
  const base = raw.length > 110 ? 36 : raw.length > 70 ? 42 : 48
  const pad = 24 * k
  const inset = d.mark === 'bar' && d.align !== 'center' ? 26 * k : d.mark === 'frame' ? 36 * k : 0
  const x = box.x + pad + (d.align === 'left' ? inset : 0), w = box.w - pad * 2 - inset
  const accentInk = d.accentColor ?? (col.dark ? onDark(accent) : accent)
  const items: { el: El; gap: number }[] = []
  const extras: El[] = []

  const quote = settle(F.text('headline', 'Quote statement', 'Headline', x, 0, {
    text: c.quoteMarks !== false && d.mark !== 'mark' ? `“${raw}”` : raw,
    size: r2(base * k * sc * (d.face === 'condensed' ? 1.12 : 1)), weight: face.weight, font: face.font, lh: face.lh, ls: face.ls * k,
    align: d.align, fit: 'box', w, color: col.ink,
  }))
  const nameText = (c.speakerName?.trim() || 'SPEAKER NAME').toUpperCase()
  const small = Math.min(sc, 1.25)
  const name = settle(F.text('speaker-name', 'Speaker name', 'Headline', x, 0, {
    text: d.mark === 'mark' && d.align === 'left' ? `— ${nameText}` : nameText, size: r2(26 * k * small), weight: 800, ls: 1.4 * k,
    font: d.face === 'condensed' ? 'oswald' : undefined, align: d.align, fit: 'box', w, color: col.hi,
  }))
  const title = settle(F.text('speaker-title', 'Speaker title', 'Headline', x, 0, {
    text: c.speakerTitle?.trim() || 'Speaker Designation / Title', size: r2(21 * k * small), weight: 500, align: d.align, fit: 'box', w, color: col.sub,
  }))
  const rw = 64 * k
  const rule = d.mark === 'rule' ? F.rect('quote-rule', 'Quote rule', 'Headline', d.align === 'center' ? box.x + (box.w - rw) / 2 : d.align === 'right' ? x + w - rw : x, 0, rw, 4 * k, accentInk, 2 * k) : null
  const mark = d.mark === 'mark' ? settle(F.text('quote-mark', 'Quote mark', 'Headline', x, 0, { text: '“', size: r2(140 * k * small), weight: 800, font: 'serif', lh: 60, color: accentInk, align: d.align, fit: 'box', w })) : null

  if (d.order === 'alt') {
    items.push({ el: name, gap: 0 }, { el: title, gap: 4 * k })
    if (rule) items.push({ el: rule, gap: 18 * k })
    if (mark) items.push({ el: mark, gap: 16 * k })
    items.push({ el: quote, gap: (rule ? 18 : mark ? 4 : 18) * k })
  } else {
    if (mark) items.push({ el: mark, gap: 0 })
    items.push({ el: quote, gap: mark ? 4 * k : 0 })
    if (rule) items.push({ el: rule, gap: 22 * k })
    items.push({ el: name, gap: (rule ? 14 : 16) * k }, { el: title, gap: 4 * k })
  }
  const [top, bottom] = stackIn(box, items)
  extras.push(...ornaments(F, d, box, top, bottom, x, w, accentInk, k))
  if (mark) extras.push(mark)
  if (rule) extras.push(rule)
  extras.push(name, title)
  return { headline: quote, extras, fill: col.fill }
}

function statBlock(F: Factory, c: Doc['content'], accent: string, band: string, box: CardBox, k: number, boost: number, r2: (v: number) => number): CardBlock {
  const d = cardDesign(c, 'stat')
  const col = cardColours(d, accent, band)
  const face = FACE[d.face]
  const sc = (c.cardScale ?? 1) * boost
  const small = Math.min(sc, 1.25)
  const numText = c.statNumber?.trim() || '16,470 MW'
  const labelText = (c.statLabel || c.headline).trim().toUpperCase() || 'PEAK ELECTRICITY GENERATION'
  const deltaText = c.statDelta?.trim() || ''
  const noteText = c.statNote?.trim() || ''
  const trend = trendOf(deltaText, c.statTrend)
  const trendCol = trend === 'up' ? (col.dark ? TREND_UP_DARK : TREND_UP) : trend === 'down' ? (col.dark ? TREND_DOWN_DARK : WEEKDAY_RED) : col.sub
  // on the desk colour itself a green or red trend vanishes, so it takes the text colour there (the arrow still says which way)
  const trendInk = d.bg === 'accent' ? col.ink : trendCol
  const numCol = c.statNumberInk ? col.ink : col.hi
  const accentInk = d.accentColor ?? (col.dark ? onDark(accent) : accent)
  const pad = 24 * k
  const extras: El[] = []
  const numFont = { font: face.font, weight: face.weight, ls: face.ls * k }

  const fitNum = (el: TextEl, maxW: number) => {
    const one = settle(F.text('measure', '', '', 0, 0, { text: el.text, size: el.size, weight: el.weight, font: el.font, ls: el.ls }))
    if (one.w > maxW) { el.size = r2(el.size * maxW / one.w); settle(el) }
  }

  if (d.order === 'split') {
    const gutter = 64 * k
    const colW = (box.w - pad * 2 - gutter) / 2
    const leftX = box.x + pad, rightX = leftX + colW + gutter
    const num = settle(F.text('headline', 'Stat number', 'Headline', leftX, 0, { text: numText, size: r2(84 * k * sc), ...numFont, align: 'right', fit: 'box', w: colW - 14 * k, color: numCol }))
    fitNum(num, (colW - 14 * k) * 0.96)
    const label = settle(F.text('stat-label', 'Stat label', 'Headline', rightX, 0, { text: labelText, size: r2(23 * k * small), weight: 800, ls: 1.6 * k, align: 'left', fit: 'box', w: colW, color: col.ink, lh: 120 }))
    const delta = deltaText ? settle(F.text('stat-delta', 'Stat delta', 'Headline', rightX, 0, { text: deltaText, size: r2(22 * k * small), weight: 700, align: 'left', fit: 'box', w: colW, color: trendInk })) : null
    const note = noteText ? settle(F.text('stat-note', 'Stat note', 'Headline', rightX, 0, { text: noteText, size: r2(20 * k * small), weight: 500, align: 'left', fit: 'box', w: colW, color: col.sub })) : null
    const right: { el: El; gap: number }[] = [{ el: label, gap: 0 }]
    if (delta) right.push({ el: delta, gap: 8 * k })
    if (note) right.push({ el: note, gap: 6 * k })
    const [nt, nb] = stackIn(box, [{ el: num, gap: 0 }])
    const [rt, rb] = stackIn(box, right)
    const top = Math.min(nt, rt), bottom = Math.max(nb, rb)
    extras.push(F.rect('stat-rule', 'Stat divider', 'Headline', leftX + colW + gutter / 2 - 2 * k, top, 4 * k, bottom - top, accentInk, 2 * k))
    if (d.mark === 'frame') extras.push(...ornaments(F, d, box, top, bottom, leftX, box.w - pad * 2, accentInk, k))
    extras.push(label, ...(delta ? [delta] : []), ...(note ? [note] : []))
    return { headline: num, extras, fill: col.fill }
  }

  const big = d.order === 'alt'
  const inset = d.mark === 'bar' && d.align !== 'center' ? 26 * k : d.mark === 'frame' ? 36 * k : 0
  const x = box.x + pad + (d.align === 'left' ? inset : 0), w = box.w - pad * 2 - inset
  const label = settle(F.text('stat-label', 'Stat label', 'Headline', x, 0, { text: labelText, size: r2((big ? 23 : 25) * k * small), weight: 800, ls: 2 * k, align: d.align, fit: 'box', w, color: col.ink }))
  const num = settle(F.text('headline', 'Stat number', 'Headline', x, 0, { text: numText, size: r2((big ? 122 : 84) * k * sc * (d.face === 'condensed' ? 1.1 : 1)), ...numFont, ls: (big ? 1.6 : 1) * face.ls * k, align: d.align, fit: 'box', w, color: numCol, lh: big ? 100 : null }))
  fitNum(num, w)
  const delta = deltaText ? settle(F.text('stat-delta', 'Stat delta', 'Headline', x, 0, { text: deltaText, size: r2(24 * k * small), weight: 700, align: d.align, fit: 'box', w, color: trendInk })) : null
  if (delta && big && d.align !== 'center') {
    // a pill hugs its words; a left or right box would stretch it across the card
    const right = delta.x + delta.w
    delta.fit = 'hug'; settle(delta)
    if (d.align === 'right') delta.x = right - delta.w
  }
  if (delta && big) delta.bgPill = { color: trend === 'none' || d.bg === 'accent' ? (col.dark ? '#ffffff' : '#64748b') : trendCol, alpha: 0.14, radius: Math.round(20 * k), padX: Math.round(16 * k), padY: Math.round(6 * k) }
  const note = noteText ? settle(F.text('stat-note', 'Stat note', 'Headline', x, 0, { text: noteText, size: r2(22 * k * small), weight: 500, align: d.align, fit: 'box', w, color: col.sub })) : null
  const rw = 64 * k
  const rule = d.mark === 'rule' ? F.rect('stat-rule', 'Stat rule', 'Headline', d.align === 'center' ? box.x + (box.w - rw) / 2 : d.align === 'right' ? x + w - rw : x, 0, rw, 4 * k, accentInk, 2 * k) : null

  const items: { el: El; gap: number }[] = big ? [{ el: num, gap: 0 }, { el: label, gap: 10 * k }] : [{ el: label, gap: 0 }, { el: num, gap: 6 * k }]
  if (rule) items.push({ el: rule, gap: 16 * k })
  if (delta) items.push({ el: delta, gap: (rule ? 14 : big ? 18 : 8) * k })
  if (note) items.push({ el: note, gap: (big && delta ? 14 : 6) * k })
  const [top, bottom] = stackIn(box, items)
  extras.push(...ornaments(F, d, box, top, bottom, x, w, accentInk, k))
  if (rule) extras.push(rule)
  extras.push(label, ...(delta ? [delta] : []), ...(note ? [note] : []))
  return { headline: num, extras, fill: col.fill }
}

const GRADIENT_DOWN: GradientFill['tf'] = [[0, 1, 0], [-1, 0, 1]]

/**
 * "Stack" layouts: header / photo / headline band / footer.
 * Every coordinate below is the classic 1598 x 1431 Figma value multiplied by one of three scales:
 *   kh  header geometry,  kb  headline-band items (link pill),  kf  footer (= width ratio).
 * With kh = kb = kf = 1 this reproduces the Figma template exactly (checked by the golden test).
 */
interface StackSpec {
  W: number
  H: number
  kh: number
  kb: number
  bandH: number
  /** headline text box (left, width) */
  headX: number
  headW: number
}

const STACK: Partial<Record<FormatId, StackSpec>> = {
  social: { W: 1598, H: 1431, kh: 1, kb: 1, bandH: 304, headX: 100, headW: 1398 },
  fb45: { W: 1080, H: 1350, kh: 0.74, kb: 0.84, bandH: 350, headX: 48, headW: 984 },
  sq: { W: 1080, H: 1080, kh: 0.7, kb: 0.8, bandH: 292, headX: 48, headW: 984 },
  story: { W: 1080, H: 1920, kh: 0.82, kb: 0.95, bandH: 480, headX: 48, headW: 984 },
}

function buildStack(format: FormatId, doc: Doc, cat: Category): El[] {
  const sp = STACK[format]!
  const F = makeFactory(format, doc)
  const c = doc.content
  const dp = dateParts(c.date)
  const els: El[] = []
  const { W, H, kh, kb } = sp
  const kf = W / 1598
  const accent = cat.accent
  const r2 = (v: number) => Math.round(v * 100) / 100

  const headerH = Math.round(297 * kh)
  const footH = r2(90 * kf)
  const footTop = H - footH
  const bandTop = footTop - sp.bandH
  const photoH = bandTop - headerH
  const stripeH = r2(22 * kh)

  // --- headline / quote / stat (based on cardType) ---
  let headline: TextEl
  const extraBandEls: El[] = []
  let pill: RectEl | null = null
  let pillIcon: IconEl | null = null
  let pillLabel: TextEl | null = null

  let cardFill: RectEl['fill'] | undefined
  let cardBoxEl: RectEl | null = null
  // a Quote / Stats card without a picture: the text block takes the photo area too, and its type grows with the room
  const card = c.cardType === 'quote' || c.cardType === 'stat' ? c.cardType : null
  const cd = card ? cardDesign(c, card) : null
  // a light footer the editor picked reads with dark text
  const footInk = cd?.footerColor && luminance(cd.footerColor) > 0.45 ? INK : FOOTER_TEXT
  const noPhoto = !!card && !cardDesign(c, card).photo
  if (card) {
    const bandBase = noPhoto ? { x: 0, y: headerH, w: W, h: footTop - headerH } : { x: 0, y: bandTop, w: W, h: sp.bandH }
    const box = boxInBand({ x: sp.headX, w: sp.headW, top: bandBase.y, h: bandBase.h }, bandBase, F.ov('band'))
    const boost = noPhoto ? Math.min(1.6, 1 + ((footTop - headerH) / sp.bandH - 1) * 0.3) : 1
    const tb = cardTextBox(F, box, kb)
    cardBoxEl = tb.el
    const blk = card === 'quote' ? quoteBlock(F, c, accent, cat.band, tb.live, kb, boost, r2) : statBlock(F, c, accent, cat.band, tb.live, kb, boost, r2)
    headline = blk.headline
    extraBandEls.push(...blk.extras)
    cardFill = blk.fill
  } else {
    // Standard headline (size by guideline)
    const hSize = headlineSize(format, c.headline.length)
    headline = settle(F.text('headline', 'Headline', 'Headline', sp.headX, 0, {
      text: c.headline, size: hSize, weight: 800, lh: 118, align: 'center', fit: 'box', w: sp.headW, color: INK,
      runs: c.highlightOnSocial ? highlightRuns(c.headline, c.highlight, darkAccent(accent)) : [],
    }))
    const PILL_H = r2(62 * kb)
    const GAP = r2(22 * kb)
    const groupH = (c.showLinkPill ? PILL_H + GAP : 0) + headline.h
    const groupTop = bandTop + sp.bandH * (157 / 304) - groupH / 2
    const pillY = groupTop
    headline.y = groupTop + (c.showLinkPill ? PILL_H + GAP : 0)

    const pillW = r2(543 * kb)
    const pillX = (W - pillW) / 2
    pill = F.rect('link-pill', 'News link pill', 'Headline', pillX, pillY, pillW, PILL_H, LINK_PILL, 31 * kb, { x: 0, y: 5 * kb, blur: 12 * kb, color: '#000000', alpha: 0.35 })
    pillIcon = F.icon('link-icon', 'Link icon', 'Headline', pillX + 26 * kb, pillY + 14 * kb, 34 * kb, SOCIAL_ICONS.bubble)
    pillLabel = settle(F.text('link-label', 'Link label', 'Headline', pillX + 74 * kb, pillY + 12 * kb, { text: 'NEWS LINK IN COMMENT  ↓', size: r2(31 * kb), weight: 800, color: '#ffffff' }))
  }

  if (c.headlineBg) {
    const bgCol = c.headlineBgColor ?? '#0b0f19'
    const isDarkPill = bgCol.startsWith('#0') || bgCol.startsWith('#1') || bgCol.startsWith('#2')
    if (!F.ov('headline').color && isDarkPill) {
      headline.color = '#ffffff'
      if (c.cardType === 'standard' && c.highlight) {
        headline.runs = highlightRuns(c.headline, c.highlight, accent)
      }
    }
    headline.bgPill = {
      color: bgCol,
      alpha: c.headlineBgAlpha ?? 0.76,
      radius: c.headlineBgRadius ?? Math.round(18 * kb),
      padX: Math.round(28 * kb),
      padY: Math.round(18 * kb),
      border: accent,
    }
  }

  // --- date block, right-anchored to the margin ---
  const R = W - 56 * kh
  const num = settle(F.text('date-num', 'Date number', 'Date', 0, 52.5 * kh, { text: dp.num, size: r2(112 * kh), weight: 800, ls: -2 * kh }))
  const month = settle(F.text('date-month', 'Month + year', 'Date', 0, 80 * kh, { text: dp.monthYear, size: r2(32 * kh), weight: 800, ls: 3 * kh }))
  const wk = settle(F.text('date-weekday', 'Weekday', 'Date', 0, 127 * kh, { text: dp.weekday, size: r2(28 * kh), weight: 700, ls: 5 * kh, color: WEEKDAY_RED }))
  const stackW = Math.max(month.w, wk.w)
  const stackX = R - stackW
  month.x = stackX
  wk.x = stackX
  const rule = F.rect('date-rule', 'Date rule', 'Date', stackX - 30 * kh, 78.34 * kh, 8 * kh, 84.32 * kh, accent, 4 * kh)
  num.x = rule.x - 22 * kh - num.w

  // --- category chip ---
  const chipText = settle(F.text('chip-text', 'Category', 'Category', 0, 208 * kh, { text: cat.chip, size: r2(24 * kh), weight: 800, ls: 1.2 * kh, color: cat.chipText }))
  const chipW = chipText.w + 84 * kh
  const chipX = R - chipW
  chipText.x = chipX + 60 * kh
  const chip = F.rect('chip', 'Category chip', 'Category', chipX, 200.5 * kh, chipW, 44 * kh, accent, 22 * kh)
  const chipIcon = F.icon('chip-icon', 'Category icon', 'Category', chipX + 24 * kh, 209.5 * kh, 26 * kh, { vw: 26, vh: 26, paths: cat.icon }, cat.chipText)

  const logo: ImageEl = { kind: 'image', id: 'logo', name: 'Logo', group: 'Header', x: 56 * kh, y: 51 * kh, w: 560 * kh, h: 195 * kh, visible: true, locked: false, opacity: 1, src: 'logo', fit: 'contain' }
  // on a card the accent edge rides on the band's top, wherever the editor moved it
  const edgeDy = c.cardType === 'quote' || c.cardType === 'stat' ? (F.ov('band').dy ?? 0) : 0
  const edge = F.rect('edge-line', 'Edge line', 'Decor', 0, bandTop - 10 * kh + edgeDy, W, 10 * kh, accent)
  const footerLine = F.rect('footer-line', 'Footer line', 'Footer', 0, footTop, W, 6 * kf, accent)
  const fy = (v: number) => footTop + (v - 1341) * kf
  const ft = (id: string, name: string, x: number, t: string) => settle(F.text(id, name, 'Footer', x * kf, fy(1364), { text: t, size: r2(36 * kf), weight: 500, color: footInk }))

  // faded, blurred category icon behind the headline (hidden by default on the legacy Figma size, which has none)
  const wmArt = Math.round(sp.bandH * 1.5)
  const watermark: WatermarkEl = {
    kind: 'watermark', id: 'watermark', name: 'Headline icon', group: 'Decor', x: 0, y: bandTop, w: W, h: sp.bandH, visible: format !== 'social', locked: false, opacity: 1,
    paths: cat.icon.map((p) => ({ ...p })), color: accent, size: wmArt, ox: Math.round(W - wmArt * 0.72), oy: Math.round((sp.bandH - wmArt) / 2), strokeWidth: wmArt * 0.0625,
    mask: { stops: [{ p: 0, c: '#000000', a: 0 }, { p: 0.5, c: '#000000', a: 0 }, { p: 0.9, c: '#000000', a: 1 }, { p: 1, c: '#000000', a: 1 }], tf: [[0.7071067690849304, 0.7071067690849304, -0.2071067839860916], [-0.7071067690849304, 0.7071067690849304, 0.5]] },
    maxOpacity: 0.18, blur: 14,
  }
  const sx = [0, W / 3, (W * 2) / 3]
  const sw = [W / 3 + 1, W / 3 + 1, W / 3 + 1]
  const bandOp = c.bandOpacity ?? 1
  const actualPhotoH = bandOp < 1 ? (footTop - headerH) : photoH
  const bandRect = noPhoto
    ? F.rect('band', 'Card background', 'Headline', 0, headerH, W, footTop - headerH, cardFill ?? cat.band)
    : F.rect('band', 'Headline band', 'Headline', 0, bandTop, W, sp.bandH, cardFill ?? cat.band)
  if (noPhoto) edge.visible = false  // the band's top line has no band edge to sit on
  if (noPhoto) { watermark.y = headerH; watermark.h = footTop - headerH; watermark.oy = Math.round((watermark.h - wmArt) / 2) }
  if (card) watermark.y += F.ov('band').dy ?? 0  // the faded icon stays with the band
  const photoLayer = photosEl(F, 'photos', 0, headerH, W, actualPhotoH, doc, format, cat.band)
  if (noPhoto) photoLayer.visible = false
  if (bandOp < 1) {
    bandRect.opacity = bandOp
    edge.opacity = bandOp
  }
  els.push(
    F.rect('header-bg', 'Header background', 'Header', 0, 0, W, headerH, cd?.headerColor ?? SOCIAL_BG),
    photoLayer,
    bandRect,
    watermark,
    ...stripes(F, [0], stripeH, sw, sx, 'stripe-top', 'Decor'),
    F.rect('footer-bg', 'Footer background', 'Footer', 0, footTop, W, footH, cd?.footerColor ?? cat.footer),
    ...stripes(F, [headerH - stripeH], stripeH, sw, sx, 'stripe-head', 'Decor'),
    logo, edge, ...(cardBoxEl ? [cardBoxEl] : []), headline, ...extraBandEls, num, month, wk, rule, footerLine,
  )
  if (!noPhoto) {
    if (c.credit.trim()) els.push(...creditLine(F, c, { x: 0, y: headerH, w: W, h: photoH }))
    els.push(...labelPill(F, c, { x: 0, y: headerH, w: W, h: photoH }, W, { x: 0, y: stripeH, w: W, h: headerH - stripeH * 2 }))
  }
  if (c.showLinkPill && pill && pillIcon && pillLabel) els.push(pill, pillIcon, pillLabel)
  els.push(
    chip,
    F.icon('web-icon', 'Website icon', 'Footer', 601 * kf, fy(1354), 64 * kf, SOCIAL_ICONS.website),
    F.icon('fb-icon', 'Facebook icon', 'Footer', 56 * kf, fy(1356), 60 * kf, SOCIAL_ICONS.facebook),
    F.icon('yt-icon', 'YouTube icon', 'Footer', 1192 * kf, fy(1362.5), 66 * kf, SOCIAL_ICONS.youtube),
    ft('fb-text', 'Facebook handle', 132, 'esbpowerlineofficial'),
    ft('web-text', 'Website', 681, 'esbpowerline.com'),
    ft('yt-text', 'YouTube', 1274, 'ESB Power Line'),
    chipIcon, chipText,
  )
  return els
}

/**
 * "Split" layouts: header / photo + side panel / footer. Every coordinate is the 1920 x 1080 Figma value times k (= width / 1920),
 * so 16:9 formats share one design. At k = 1 this is the Figma web template exactly (golden test).
 */
function buildWeb(format: FormatId, doc: Doc, cat: Category): El[] {
  const F = makeFactory(format, doc)
  const c = doc.content
  const dp = dateParts(c.date)
  const { w: W } = FORMATS[format]
  const k = W / 1920
  const r2 = (v: number) => Math.round(v * 100) / 100
  const accent = cat.accent
  const els: El[] = []

  let headline: TextEl
  const extraPanelEls: El[] = []
  const panelW = 552 * k
  const panelX = 1328 * k

  let cardFill: RectEl['fill'] | undefined
  let cardBoxEl: RectEl | null = null
  const card = c.cardType === 'quote' || c.cardType === 'stat' ? c.cardType : null
  const cd = card ? cardDesign(c, card) : null
  // a light footer the editor picked reads with dark text
  const footInk = cd?.footerColor && luminance(cd.footerColor) > 0.45 ? INK : FOOTER_TEXT
  const noPhoto = !!card && !cardDesign(c, card).photo
  if (card) {
    const panelBase = noPhoto ? { x: 0, y: 200 * k, w: W, h: 800 * k } : { x: 1280 * k, y: 200 * k, w: 640 * k, h: 800 * k }
    const box = boxInBand(noPhoto ? { x: 200 * k, w: W - 400 * k, top: 200 * k, h: 800 * k } : { x: panelX, w: panelW, top: 200 * k, h: 800 * k }, panelBase, F.ov('panel'))
    const boost = noPhoto ? 1.4 : 1
    const tb = cardTextBox(F, box, k)
    cardBoxEl = tb.el
    const blk = card === 'quote' ? quoteBlock(F, c, accent, cat.panel[0], tb.live, k * 0.92, boost, r2) : statBlock(F, c, accent, cat.panel[0], tb.live, k * 0.92, boost, r2)
    headline = blk.headline
    extraPanelEls.push(...blk.extras)
    cardFill = blk.fill
  } else {
    const hSize = headlineSize(format, c.headline.length)
    headline = settle(F.text('headline', 'Headline', 'Headline', panelX, 0, {
      text: c.headline, size: hSize, weight: 800, lh: 118, align: 'center', fit: 'box', w: panelW, color: INK,
      runs: highlightRuns(c.headline, c.highlight, darkAccent(accent)),
    }))
    headline.y = 600 * k - headline.h / 2
  }

  if (c.headlineBg) {
    const bgCol = c.headlineBgColor ?? '#0b0f19'
    const isDarkPill = bgCol.startsWith('#0') || bgCol.startsWith('#1') || bgCol.startsWith('#2')
    if (!F.ov('headline').color && isDarkPill) {
      headline.color = '#ffffff'
      if (c.cardType === 'standard' && c.highlight) {
        headline.runs = highlightRuns(c.headline, c.highlight, accent)
      }
    }
    headline.bgPill = {
      color: bgCol,
      alpha: c.headlineBgAlpha ?? 0.76,
      radius: c.headlineBgRadius ?? Math.round(16 * k),
      padX: Math.round(24 * k),
      padY: Math.round(16 * k),
      border: accent,
    }
  }

  const R = W - 56 * k
  const num = settle(F.text('date-num', 'Date number', 'Date', 0, 13.95 * k, { text: dp.num, size: r2(86 * k), weight: 800, ls: -1.5 * k }))
  const month = settle(F.text('date-month', 'Month + year', 'Date', 0, 29.5 * k, { text: dp.monthYear, size: r2(30 * k), weight: 800, ls: 3 * k }))
  const wk = settle(F.text('date-weekday', 'Weekday', 'Date', 0, 73.5 * k, { text: dp.weekday, size: r2(24 * k), weight: 700, ls: 4.8 * k, color: WEEKDAY_RED }))
  const stackX = R - Math.max(month.w, wk.w)
  month.x = stackX
  wk.x = stackX
  const rule = F.rect('date-rule', 'Date rule', 'Date', stackX - 28 * k, 34.74 * k, 8 * k, 62.52 * k, accent, 3.5 * k)
  num.x = rule.x - 20 * k - num.w

  const chipText = settle(F.text('chip-text', 'Category', 'Category', 0, 129.76 * k, { text: cat.chip, size: r2(22 * k), weight: 800, ls: 1.1 * k, color: cat.chipText }))
  const chipW = chipText.w + 76 * k
  const chipX = R - chipW
  chipText.x = chipX + 54 * k
  const chip = F.rect('chip', 'Category chip', 'Category', chipX, 121.26 * k, chipW, 44 * k, accent, 22 * k)
  const chipIcon = F.icon('chip-icon', 'Category icon', 'Category', chipX + 22 * k, 132.26 * k, 22 * k, { vw: 26, vh: 26, paths: cat.icon }, cat.chipText)

  const logo: ImageEl = { kind: 'image', id: 'logo', name: 'Logo', group: 'Header', x: 56 * k, y: 36 * k, w: 368 * k, h: 128 * k, visible: true, locked: false, opacity: 1, src: 'logo', fit: 'contain' }
  const ft = (id: string, name: string, x: number, t: string) => settle(F.text(id, name, 'Footer', x * k, 1025 * k, { text: t, size: r2(28 * k), weight: 500, color: footInk }))

  const panelFill: GradientFill = { stops: [{ p: 0, c: cat.panel[0] }, { p: 1, c: cat.panel[1] }], tf: GRADIENT_DOWN }
  const mask: GradientFill = {
    stops: [{ p: 0, c: '#000000', a: 0 }, { p: 0.5, c: '#000000', a: 0 }, { p: 0.9, c: '#000000', a: 1 }, { p: 1, c: '#000000', a: 1 }],
    tf: [[0.7071067690849304, 0.7071067690849304, -0.2071067839860916], [-0.7071067690849304, 0.7071067690849304, 0.5]],
  }
  const watermark: WatermarkEl = {
    kind: 'watermark', id: 'watermark', name: 'Headline icon', group: 'Decor', x: 1288 * k, y: 200 * k, w: 632 * k, h: 800 * k, visible: true, locked: false, opacity: 1,
    paths: cat.icon.map((p) => ({ ...p })), color: accent, size: 900 * k, ox: 110 * k, oy: 305 * k, strokeWidth: 56.25 * k, mask, maxOpacity: 0.2, blur: 30 * k,
  }

  const sx = [0, 640 * k, 1280 * k]
  const sw = [641 * k, 641 * k, 641 * k]
  const bandOp = c.bandOpacity ?? 1
  const actualPhotoW = bandOp < 1 ? W : 1280 * k
  const panelRect = noPhoto
    ? F.rect('panel', 'Card background', 'Headline', 0, 200 * k, W, 800 * k, cardFill ?? panelFill)
    : F.rect('panel', 'Panel', 'Headline', 1280 * k, 200 * k, 640 * k, 800 * k, cardFill ?? panelFill)
  const panelEdgeRect = F.rect('panel-edge', 'Panel edge', 'Decor', 1280 * k, 200 * k, 8 * k, 800 * k, accent)
  if (noPhoto) panelEdgeRect.visible = false
  if (card) { const po = F.ov('panel'); panelEdgeRect.x += po.dx ?? 0; panelEdgeRect.y += po.dy ?? 0; if (po.h != null) panelEdgeRect.h = po.h }  // the edge rides on the panel
  const photoLayer = photosEl(F, 'photos', 0, 200 * k, actualPhotoW, 800 * k, doc, format, cat.panel[0])
  if (noPhoto) photoLayer.visible = false
  if (bandOp < 1) {
    panelRect.opacity = bandOp
    panelEdgeRect.opacity = bandOp
  }
  els.push(
    F.rect('header-bg', 'Header background', 'Header', 0, 0, W, 200 * k, cd?.headerColor ?? WEB_HEADER),
    ...stripes(F, [0, 186 * k], 14 * k, sw, sx, 'stripe', 'Decor'),
    logo, num, month, wk, rule, chip,
    photoLayer,
    panelRect,
    panelEdgeRect,
    F.rect('footer-bg', 'Footer background', 'Footer', 0, 1000 * k, W, 80 * k, cd?.footerColor ?? cat.footer),
    F.rect('footer-line', 'Footer line', 'Footer', 0, 1000 * k, W, 5 * k, accent),
    ft('fb-text', 'Facebook handle', 118, 'esbpowerlineofficial'),
    ft('web-text', 'Website', 868, 'esbpowerline.com'),
    ft('yt-text', 'YouTube', 1656, 'ESB Power Line'),
    F.icon('fb-icon', 'Facebook icon', 'Footer', 56 * k, 1018 * k, 48 * k, SOCIAL_ICONS.facebook),
    F.icon('web-icon', 'Website icon', 'Footer', 806 * k, 1018 * k, 48 * k, SOCIAL_ICONS.website),
    F.icon('yt-icon', 'YouTube icon', 'Footer', 1588 * k, 1023 * k, 54 * k, SOCIAL_ICONS.youtube),
    watermark, ...(cardBoxEl ? [cardBoxEl] : []), headline, ...extraPanelEls, chipIcon, chipText,
  )
  if (!noPhoto) {
    if (c.credit.trim()) els.push(...creditLine(F, c, { x: 0, y: 200 * k, w: 1280 * k, h: 800 * k }))
    els.push(...labelPill(F, c, { x: 0, y: 200 * k, w: 1280 * k, h: 800 * k }, W, { x: 0, y: 14 * k, w: W, h: 172 * k }))
  }
  return els
}

/** Apply the user's manual per-element overrides (moves, sizes, visibility…). */
function applyOverrides(format: FormatId, doc: Doc, els: El[]): El[] {
  for (const el of els) {
    const o = doc.overrides[`${format}:${el.id}`]
    if (!o) continue
    if (o.dx) el.x += o.dx
    if (o.dy) el.y += o.dy
    if (o.w != null) el.w = o.w
    if (o.h != null) el.h = o.h
    if (o.visible != null) el.visible = o.visible
    if (o.locked != null) el.locked = o.locked
    if (o.opacity != null) el.opacity = o.opacity
    if (el.kind === 'icon' && (o.w != null || o.h != null)) {
      if (o.w != null && o.h == null) el.h = (o.w * el.vh) / el.vw
    }
    if (o.shadow) el.dropShadow = o.shadow
    if (o.stroke) el.stroke = o.stroke
    if (o.bgPill !== undefined && el.kind === 'text') el.bgPill = o.bgPill ?? undefined
    if (el.id.startsWith('x-')) applyStyle(el, o)
    if (o.color && el.kind === 'icon') el.ink = o.color
    if (o.color && el.kind === 'watermark') el.color = o.color
    if (el.kind === 'watermark') {
      const base = el.size
      el.ox += o.iconDx ?? 0
      el.oy += o.iconDy ?? 0
      if (o.iconSize != null) { el.strokeWidth *= o.iconSize / base; el.size = o.iconSize } // stroke scales with the icon
      if (o.iconStroke != null) el.strokeWidth = o.iconStroke
      if (o.blur != null) el.blur = o.blur
      if (o.iconOpacity != null) el.maxOpacity = o.iconOpacity
    }
    if (el.kind === 'text' && o.w != null) el.fit = 'box'
    if (el.kind === 'text') settleAfterOverride(el)
  }
  return els
}

/** Layers added in the editor carry their own base style; overrides restyle them like template elements. */
function applyStyle(el: El, o: Override) {
  if (el.kind === 'text') {
    if (o.text != null) el.text = o.text
    if (o.size != null) el.size = o.size
    if (o.color) el.color = o.color
    if (o.weight) el.weight = o.weight
    if (o.font) el.font = o.font
    if (o.ls != null) el.ls = o.ls
    if (o.lh != null) el.lh = o.lh
    if (o.align) el.align = o.align
  } else if (el.kind === 'rect') {
    if (o.fill) el.fill = o.fill
    if (o.radius != null) el.radius = o.radius
  }
}

function settleAfterOverride(el: TextEl) {
  const lay = layoutText(getMeasureCtx(), el)
  if (el.fit === 'hug') el.w = lay.width
  el.h = lay.height
}

function buildLowerThird(format: FormatId, doc: Doc, cat: Category): El[] {
  const F = makeFactory(format, doc)
  const c = doc.content
  const accent = cat.accent
  const els: El[] = []

  const barX = 80
  const barY = 840
  const barW = 1120
  const barH = 160

  els.push(F.rect('lt-bg', 'Lower third background', 'Overlay', barX, barY, barW, barH, '#15171c', 8))
  els.push(F.rect('lt-accent', 'Category accent line', 'Overlay', barX, barY, 8, barH, accent, 4))

  const chipW = 200
  const chipH = 24
  els.push(F.rect('lt-chip-bg', 'Category chip', 'Decor', barX + 24, barY + 18, chipW, chipH, accent, 4))
  const chipText = settle(F.text('lt-chip-text', 'Category text', 'Decor', barX + 32, barY + 22, {
    text: cat.chip, size: 12, weight: 800, color: cat.chipText, ls: 1,
  }))
  els.push(chipText)

  const primaryText = (c.speakerName || c.headline || 'Speaker Name').trim()
  const primaryEl = settle(F.text('headline', 'Speaker / Primary headline', 'Headline', barX + 24, barY + 50, {
    text: primaryText, size: 36, weight: 800, color: '#ffffff', fit: 'box', w: barW - 320,
  }))
  els.push(primaryEl)

  const secondaryText = (c.speakerTitle || c.statLabel || cat.name).trim()
  const secondaryEl = settle(F.text('speaker-title', 'Speaker title / Subtitle', 'Headline', barX + 24, barY + 104, {
    text: secondaryText, size: 20, weight: 500, color: '#94a3b8', fit: 'box', w: barW - 320,
  }))
  els.push(secondaryEl)

  const logoW = 230
  const logoH = 80
  const logo: ImageEl = {
    kind: 'image', id: 'logo', name: 'Logo', group: 'Header',
    x: barX + barW - logoW - 24, y: barY + (barH - logoH) / 2,
    w: logoW, h: logoH, visible: true, locked: false, opacity: 1,
    src: 'logo', fit: 'contain',
  }
  els.push(logo)

  const wmSize = 140
  const mask: GradientFill = {
    stops: [{ p: 0, c: '#000000', a: 0 }, { p: 0.5, c: '#000000', a: 0 }, { p: 0.9, c: '#000000', a: 1 }, { p: 1, c: '#000000', a: 1 }],
    tf: [[0.7071067690849304, 0.7071067690849304, -0.2071067839860916], [-0.7071067690849304, 0.7071067690849304, 0.5]],
  }
  const watermark: WatermarkEl = {
    kind: 'watermark', id: 'watermark', name: 'Headline icon', group: 'Decor',
    x: barX + barW - logoW - wmSize - 20, y: barY + 10, w: wmSize, h: wmSize,
    visible: true, locked: false, opacity: 1,
    paths: cat.icon.map((p) => ({ ...p })), color: accent, size: wmSize,
    ox: 0, oy: 0, strokeWidth: wmSize * 0.0625, mask,
    maxOpacity: 0.12, blur: 4,
  }
  els.push(watermark)

  return els
}

function buildTitleCard(format: FormatId, doc: Doc, cat: Category): El[] {
  const F = makeFactory(format, doc)
  const c = doc.content
  const dp = dateParts(c.date)
  const { w: W, h: H } = FORMATS[format]
  const accent = cat.accent
  const els: El[] = []

  els.push(F.rect('card-bg', 'Card background', 'Header', 0, 0, W, H, '#15171c'))

  const sx = [0, W / 3, (W * 2) / 3]
  const sw = [W / 3 + 1, W / 3 + 1, W / 3 + 1]
  els.push(...stripes(F, [0, 14], 14, sw, sx, 'stripe', 'Decor'))

  const logo: ImageEl = {
    kind: 'image', id: 'logo', name: 'Logo', group: 'Header',
    x: 96, y: 72, w: 368, h: 128, visible: true, locked: false, opacity: 1,
    src: 'logo', fit: 'contain',
  }
  els.push(logo)

  const chipW = 280
  const chipH = 36
  els.push(F.rect('chip-bg', 'Category chip', 'Decor', 96, 240, chipW, chipH, accent, 6))
  const chipText = settle(F.text('chip-text', 'Category text', 'Decor', 110, 246, {
    text: cat.chip, size: 15, weight: 800, color: cat.chipText, ls: 1.2,
  }))
  els.push(chipText)

  const headline = settle(F.text('headline', 'Title headline', 'Headline', 96, 320, {
    text: c.headline, size: 64, weight: 800, color: '#ffffff', fit: 'box', w: 1400, lh: 120,
    runs: highlightRuns(c.headline, c.highlight, accent),
  }))
  els.push(headline)

  const deckText = (c.quoteText || c.speakerTitle || c.statLabel || 'BANGLADESH ENERGY & POWER SECTOR REPORT').trim()
  const deck = settle(F.text('deck', 'Deck subtitle', 'Headline', 96, 320 + headline.h + 24, {
    text: deckText, size: 26, weight: 500, color: '#94a3b8', fit: 'box', w: 1400,
  }))
  els.push(deck)

  const wmSize = 700
  const mask: GradientFill = {
    stops: [{ p: 0, c: '#000000', a: 0 }, { p: 0.5, c: '#000000', a: 0 }, { p: 0.9, c: '#000000', a: 1 }, { p: 1, c: '#000000', a: 1 }],
    tf: [[0.7071067690849304, 0.7071067690849304, -0.2071067839860916], [-0.7071067690849304, 0.7071067690849304, 0.5]],
  }
  const watermark: WatermarkEl = {
    kind: 'watermark', id: 'watermark', name: 'Headline icon', group: 'Decor',
    x: W - wmSize - 80, y: H - wmSize - 80, w: wmSize, h: wmSize,
    visible: true, locked: false, opacity: 1,
    paths: cat.icon.map((p) => ({ ...p })), color: accent, size: wmSize,
    ox: 0, oy: 0, strokeWidth: wmSize * 0.05, mask,
    maxOpacity: 0.15, blur: 20,
  }
  els.push(watermark)

  els.push(F.rect('footer-line', 'Footer line', 'Footer', 96, H - 100, W - 192, 2, '#2d333b'))
  const dateEl = settle(F.text('date-text', 'Published date', 'Footer', 96, H - 76, {
    text: `${dp.weekday} · ${dp.num} ${dp.monthYear}`, size: 18, weight: 700, color: '#64748b', ls: 0.8,
  }))
  const footerBrand = settle(F.text('footer-brand', 'Footer branding', 'Footer', W - 320, H - 76, {
    text: 'ESB POWER LINE STUDIO', size: 18, weight: 700, color: accent, ls: 1,
  }))
  els.push(dateEl, footerBrand)

  return els
}

function buildEndCard(format: FormatId, doc: Doc, cat: Category): El[] {
  const F = makeFactory(format, doc)
  const { w: W, h: H } = FORMATS[format]
  const accent = cat.accent
  const els: El[] = []

  els.push(F.rect('card-bg', 'Card background', 'Header', 0, 0, W, H, '#15171c'))

  const logoW = 460
  const logoH = 160
  const logo: ImageEl = {
    kind: 'image', id: 'logo', name: 'Logo', group: 'Header',
    x: (W - logoW) / 2, y: 260, w: logoW, h: logoH, visible: true, locked: false, opacity: 1,
    src: 'logo', fit: 'contain',
  }
  els.push(logo)

  els.push(F.rect('accent-rule', 'Accent rule', 'Decor', (W - 320) / 2, 460, 320, 4, accent, 2))

  const cta = settle(F.text('headline', 'Call to action', 'Headline', (W - 1200) / 2, 500, {
    text: 'SUBSCRIBE FOR ENERGY INSIGHTS & ANALYSIS', size: 36, weight: 800, color: '#ffffff', align: 'center', fit: 'box', w: 1200, ls: 1.2,
  }))
  els.push(cta)

  const link = settle(F.text('web-link', 'Website link', 'Headline', (W - 800) / 2, 565, {
    text: 'esbpowerline.com', size: 28, weight: 700, color: accent, align: 'center', fit: 'box', w: 800, ls: 1,
  }))
  els.push(link)

  const footerText = settle(F.text('social-handles', 'Social channels', 'Footer', (W - 1000) / 2, H - 120, {
    text: 'FACEBOOK: @esbpowerline  ·  YOUTUBE: ESB Power Line  ·  LINKEDIN: Energy Sector Bangladesh',
    size: 18, weight: 700, color: '#64748b', align: 'center', fit: 'box', w: 1000, ls: 0.8,
  }))
  els.push(footerText)

  const sx = [0, W / 3, (W * 2) / 3]
  const sw = [W / 3 + 1, W / 3 + 1, W / 3 + 1]
  els.push(...stripes(F, [H - 14], 14, sw, sx, 'stripe', 'Decor'))

  return els
}

/** Quote / Stats cards: the header and footer are blocks the editor may drag over the photo, so they are drawn above
 *  it (background first, then what sits inside it, in their own order). Membership is by the template position. */
function bandsOnTop(els: El[]): El[] {
  const lifted: El[] = []
  for (const bgId of ['header-bg', 'footer-bg']) {
    const bg = els.find((e) => e.id === bgId)
    if (!bg) continue
    const inBand = (e: El) => e.id === bgId || (e.kind !== 'photos' && e.kind !== 'watermark' && e.x >= bg.x - 1 && e.y >= bg.y - 1 && e.x + e.w <= bg.x + bg.w + 1 && e.y + e.h <= bg.y + bg.h + 1)
    lifted.push(...els.filter((e) => !lifted.includes(e) && inBand(e)))
  }
  return [...els.filter((e) => !lifted.includes(e)), ...lifted]
}

export function buildScene(format: FormatId, doc: Doc): Scene {
  const cat = getCategory(doc.content.categoryId)
  const fmt = getFormat(format)
  let base: El[]
  if (format === 'lower-third') base = buildLowerThird(format, doc, cat)
  else if (format === 'title-card') base = buildTitleCard(format, doc, cat)
  else if (format === 'end-card') base = buildEndCard(format, doc, cat)
  else if (fmt.family === 'stack') base = buildStack(format, doc, cat)
  else base = buildWeb(format, doc, cat)
  if ((doc.content.cardType ?? 'standard') !== 'standard' && fmt.family !== 'card' && format !== 'lower-third') base = bandsOnTop(base)

  const extras = (doc.extras?.[format] ?? []).map((e) => structuredClone(e))
  for (const e of extras) if (e.kind === 'text') settleAfterOverride(e)
  let els = applyOverrides(format, doc, [...base, ...extras])
  const ord = doc.order?.[format]
  if (ord?.length) {
    const idx = new Map(ord.map((id, i) => [id, i]))
    els = els
      .map((e, i) => ({ e, k: idx.has(e.id) ? idx.get(e.id)! : ord.length + i }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.e)
  }
  const f = FORMATS[format]
  const bg = format === 'lower-third' ? 'transparent' : (fmt.family === 'stack' ? SOCIAL_BG : (fmt.family === 'card' ? '#15171c' : '#ffffff'))
  return { format, w: f.w, h: f.h, background: bg, elements: els }
}

/** One independent value per format (overrides, photo framing, layers, guides are all per format). */
export function perFormat<T>(make: () => T): Record<FormatId, T> {
  return Object.fromEntries(FORMAT_IDS.map((f) => [f, make()])) as Record<FormatId, T>
}

export function defaultDoc(): Doc {
  const today = new Date()
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  return {
    content: {
      categoryId: '01',
      date: iso,
      headline: 'Your headline goes here: type the exact article title',
      highlight: '',
      showLinkPill: true,
      highlightOnSocial: false,
      credit: '',
      creditPos: 'bl',
      creditSize: 24,
      creditColor: '#ffffff',
      creditFont: 'inter',
      creditChip: false,
      label: 'none',
      labelText: '',
      labelPos: 'tl',
      labelScale: 1,
      labelColor: '#dc2828',
      caption: null,
      cardType: 'standard',
      quoteText: '',
      speakerName: '',
      speakerTitle: '',
      statNumber: '',
      statLabel: '',
      statDelta: '',
      statNote: '',
    },
    overrides: {},
    photos: {
      collage: 'single',
      gap: 8,
      gapColor: '#ffffff',
      backdrop: 'blur',
      slots: perFormat(() => []),
    },
    extras: perFormat(() => []),
    order: perFormat(() => []),
    guides: perFormat(() => []),
  }
}

export { lineHeightPx, measureWidth }
