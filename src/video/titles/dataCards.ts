// Grid data cards from esbpowerline.com's published daily data (grid.ts). The number is the stored value exactly
// (count-up lands on formatExact(value)); the unit is the site's documented one; the card always carries
// "Source: esbpowerline.com Grid data, <date as the file states it>"; a derived figure says "Derived" and its formula.

import { fade, lineByLine, maskReveal, scaleIn } from './anim'
import { fontFor } from './brand'
import type { ChartSpec } from './charts'
import { gridSourceLine, type GridFigure, type GridSeries } from './grid'
import { INK, INK_2, PANEL, accentBar, ctxOf, heightOf, spec, textEl, timing, type KitCtx, type KitOptions } from './kit'
import { layoutTitle, type Measurer } from './layout'
import { formatExact, type NumberFormat } from './numbers'
import type { TextElement, TitleElement, TitleSpec } from './spec'

export interface DataCardOptions extends KitOptions {
  lang?: 'en' | 'bn'
  /** Bangla digits on the figure (a different script, the same digits). */
  digits?: NumberFormat['digits']
  /** Seconds the count-up / chart growth takes (default 1.4). */
  countUp?: number
}

/** Seconds the out fade takes, and the least a settled figure is held before it: a count-up must land inside what is
 * left, so the exact value is always on screen (a 1.2 s card counts faster, it never ends mid-count). */
export const CARD_OUT = 0.35
export const CARD_HOLD = 0.3

/** The count-up's delay and duration for a card `d` seconds long: the natural ones, shortened to land `CARD_OUT +
 * CARD_HOLD` before the end. A card too short for any count shows the figure at once. */
export function fitCount(d: number, delay: number, duration: number): { delay: number; duration: number } {
  const avail = d - CARD_OUT - CARD_HOLD
  if (delay + duration <= avail) return { delay, duration }
  if (avail < 0.3) return { delay: 0, duration: 0 }
  const dl = Math.min(delay, avail * 0.15)
  return { delay: dl, duration: avail - dl }
}

const dataText = (c: KitCtx, id: string, text: string, x: number, y: number, w: number, t: Parameters<typeof textEl>[7], data?: TextElement['data']): TextElement => {
  const el = textEl(c, id, { text, placeholder: false }, null, x, y, w, t)
  el.origin = 'data'
  if (data) el.data = data
  return el
}

/** What a derived card says about its figure. The full formula stays in the clip data (and the editor's tooltip); the
 * card shows its short form. A formula with no short form is shown whole when it fits three lines, else the card
 * says it is derived and points to the formula: a disclosure is never cut by an ellipsis. */
export function derivedLine(derived: { formula: string; short?: string }, c: KitCtx, w: number, size: number): string {
  if (derived.short) return `Derived: ${derived.short} (see tooltip)`
  const full = `Derived: ${derived.formula}`
  const lay = layoutTitle({ text: full, font: fontFor(full, 'body', Math.round(size)), maxWidth: w, maxLines: 3 }, c.o.measure)
  return lay.truncated ? 'Derived: computed value (see tooltip)' : full
}

function frame(c: KitCtx, d: number, inner: (x: number, w: number) => { els: TitleElement[]; h: number }, isoDate: string, dateLabel: string, derived?: { formula: string; short?: string }): TitleSpec {
  const { s, safe } = c
  // the card fills the safe width; on a narrow (portrait) frame the padding is smaller so the text gets the room
  const cardW = Math.min(safe.w, 1100 * s)
  const x = safe.x + (safe.w - cardW) / 2
  const pad = (cardW < 960 * s ? 32 : 48) * s
  const { els, h } = inner(x + pad, cardW - pad * 2)
  let y = h + 24 * s
  const tail: TextElement[] = []
  if (derived) {
    const dn = dataText(c, 'derived', derivedLine(derived, c, cardW - pad * 2, 24 * s), x + pad, y, cardW - pad * 2, { role: 'body', size: 24 * s, maxLines: 3, color: INK_2, anim: timing(d, fade(0.3, 0.8)) }, { isoDate, sourceField: '', derived: derived.formula })
    tail.push(dn); y += heightOf(c, dn) + 10 * s
  }
  const src = dataText(c, 'source', gridSourceLine(dateLabel), x + pad, y, cardW - pad * 2, { role: 'body', size: 24 * s, maxLines: 2, color: INK_2, anim: timing(d, fade(0.3, 0.6)) })
  tail.push(src); y += heightOf(c, src)
  const cardH = y + pad * 2
  const top = safe.y + (safe.h - cardH) / 2
  for (const e of [...els, ...tail]) (e as { y: number }).y += top + pad
  const out = spec(c, 'data-number', [
    { type: 'rect', id: 'card', x, y: top, w: cardW, h: cardH, radius: 18 * s, fill: PANEL, anim: timing(d, scaleIn(0.95, 0.4)) },
    accentBar(c, 'accent', x + pad, top + 22 * s, 72 * s, 7 * s, timing(d, maskReveal('right', 0.4, 0.1, 'all'))),
    ...els,
    ...tail,
  ], d)
  out.data = { isoDate, dateLabel, sourceLine: gridSourceLine(dateLabel), ...(derived ? { derived: derived.formula } : {}) }
  return out
}

/** The largest figure size (px, at most `max`) at which `text` fits `w` on one line, never below `min`. */
export function fitNumberSize(text: string, w: number, max: number, min: number, measure: Measurer): number {
  let size = Math.round(max)
  for (let i = 0; i < 4; i++) {
    const width = measure(text, fontFor(text, 'number', size))
    if (width <= w) break
    size = Math.max(Math.round(min), Math.floor(size * (w / width) * 0.995))
    if (size <= Math.round(min)) break
  }
  return size
}

/** A big-number card for one figure (count-up to the exact stored value). */
export function gridNumberCard(fig: GridFigure, o: DataCardOptions): TitleSpec {
  const c = ctxOf(o)
  const d = o.duration ?? 6
  const s = c.s
  const fmt: NumberFormat = { digits: o.digits }
  const final = formatExact(fig.value, fmt)
  return frame(c, d, (x, w) => {
    const els: TitleElement[] = []
    let y = 30 * s
    const label = dataText(c, 'label', o.lang === 'bn' ? fig.label.bn : fig.label.en, x, y, w, { role: 'label', size: 30 * s, maxLines: 2, color: c.accentText ?? INK, anim: timing(d, fade(0.3, 0.1)) })
    els.push(label); y += heightOf(c, label) + 12 * s
    // the whole exact figure always shows: the size shrinks to the card's width (never an ellipsis)
    const size = fitNumberSize(final, w, 150 * s, 40 * s, o.measure)
    const num = dataText(c, 'value', final, x, y, w, { role: 'number', size, maxLines: 1, anim: timing(d, fade(0.2, 0.2)) }, { isoDate: fig.isoDate, sourceField: fig.sourceField, ...(fig.derived ? { derived: fig.derived.formula } : {}) })
    num.countUp = { target: fig.value, ...fitCount(d, 0.2, o.countUp ?? 1.4), easing: 'esb', format: fmt }
    els.push(num)
    const numLay = layoutTitle({ text: num.text, font: num.font, maxWidth: w, maxLines: 1 }, o.measure)
    y += numLay.height + 24 * s // room for the comma's descender
    const unit = dataText(c, 'unit', fig.time ? `${fig.unit} · ${fig.time}` : fig.unit, x, y, w, { role: 'label', size: 34 * s, maxLines: 2, color: INK_2, anim: timing(d, fade(0.3, 0.5)) })
    els.push(unit); y += heightOf(c, unit)
    return { els, h: y }
  }, fig.isoDate, fig.dateLabel, fig.derived)
}

/** A chart card for a series (fuel mix, zones, hourly): bar, line or donut. */
export function gridChartCard(series: GridSeries, kind: ChartSpec['kind'], o: DataCardOptions & { itemColors?: boolean }): TitleSpec {
  const c = ctxOf(o)
  const d = o.duration ?? 7
  const s = c.s
  const out = frame(c, d, (x, w) => {
    const els: TitleElement[] = []
    let y = 30 * s
    const title = dataText(c, 'title', o.lang === 'bn' ? series.title.bn : series.title.en, x, y, w, { role: 'label', size: 32 * s, maxLines: 2, color: c.accentText ?? INK, anim: timing(d, lineByLine(0.1, 0.1)) })
    els.push(title); y += heightOf(c, title) + 4 * s
    const unit = dataText(c, 'unit', series.unit, x, y, w, { role: 'body', size: 24 * s, maxLines: 1, color: INK_2, anim: timing(d, fade(0.3, 0.2)) })
    els.push(unit); y += heightOf(c, unit) + 20 * s
    const rows = series.items.length
    const legendRows = series.items.filter((i) => i.value !== 0).length
    const chartH = kind === 'bar' ? Math.min(rows * 64 * s, c.safe.h * 0.6) : kind === 'donut' ? Math.min(Math.max(360 * s, legendRows * 46 * s), c.safe.h * 0.55) : 360 * s
    const growTiming = fitCount(d, 0.3, o.countUp ?? 1.4)
    els.push({
      type: 'chart', id: 'chart', x, y, w, h: chartH,
      chart: { kind, items: series.items.map((i) => ({ label: i.label, value: i.value, color: i.color })), unit: series.unit, grow: { ...growTiming, easing: 'esb' }, accent: kind === 'line' ? c.accent ?? undefined : undefined, itemColors: o.itemColors, format: { digits: o.digits }, size: Math.round(32 * s), derived: !!series.derived },
      anim: timing(d, fade(0.25, 0.25)),
    })
    y += chartH
    return { els, h: y }
  }, series.isoDate, series.dateLabel, series.derived)
  out.kind = 'data-chart'
  return out
}

/** The font a data card's figure uses (tests and the inspector). */
export const figureFont = (s: number) => fontFor('0', 'number', Math.round(150 * s))
