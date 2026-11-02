// Grid data cards from esbpowerline.com's published daily data (grid.ts). The number is the stored value exactly
// (count-up lands on formatExact(value)); the unit is the site's documented one; the card always carries
// "Source: esbpowerline.com Grid data, <date as the file states it>"; a derived figure says "Derived" and its formula.

import { fade, lineByLine, maskReveal, scaleIn } from './anim'
import { fontFor } from './brand'
import type { ChartSpec } from './charts'
import { gridSourceLine, type GridFigure, type GridSeries } from './grid'
import { INK, INK_2, PANEL, accentBar, ctxOf, heightOf, spec, textEl, timing, type KitCtx, type KitOptions } from './kit'
import { layoutTitle } from './layout'
import { formatExact, type NumberFormat } from './numbers'
import type { TextElement, TitleElement, TitleSpec } from './spec'

export interface DataCardOptions extends KitOptions {
  lang?: 'en' | 'bn'
  /** Bangla digits on the figure (a different script, the same digits). */
  digits?: NumberFormat['digits']
  /** Seconds the count-up / chart growth takes (default 1.4). */
  countUp?: number
}

const dataText = (c: KitCtx, id: string, text: string, x: number, y: number, w: number, t: Parameters<typeof textEl>[7], data?: TextElement['data']): TextElement => {
  const el = textEl(c, id, { text, placeholder: false }, null, x, y, w, t)
  el.origin = 'data'
  if (data) el.data = data
  return el
}

function frame(c: KitCtx, d: number, inner: (x: number, w: number) => { els: TitleElement[]; h: number }, isoDate: string, dateLabel: string, derived?: string): TitleSpec {
  const { s, safe } = c
  const cardW = Math.min(safe.w, 1100 * s)
  const x = safe.x + (safe.w - cardW) / 2
  const pad = 48 * s
  const { els, h } = inner(x + pad, cardW - pad * 2)
  let y = h + 24 * s
  const tail: TextElement[] = []
  if (derived) {
    const dn = dataText(c, 'derived', `Derived: ${derived}`, x + pad, y, cardW - pad * 2, { role: 'body', size: 18 * s, maxLines: 3, color: INK_2, anim: timing(d, fade(0.3, 0.8)) })
    tail.push(dn); y += heightOf(c, dn) + 10 * s
  }
  const src = dataText(c, 'source', gridSourceLine(dateLabel), x + pad, y, cardW - pad * 2, { role: 'body', size: 20 * s, maxLines: 2, color: INK_2, anim: timing(d, fade(0.3, 0.6)) })
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
  out.data = { isoDate, dateLabel, sourceLine: gridSourceLine(dateLabel) }
  return out
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
    const label = dataText(c, 'label', o.lang === 'bn' ? fig.label.bn : fig.label.en, x, y, w, { role: 'label', size: 30 * s, maxLines: 2, color: c.accent ?? INK, anim: timing(d, fade(0.3, 0.1)) })
    els.push(label); y += heightOf(c, label) + 12 * s
    const num = dataText(c, 'value', final, x, y, w, { role: 'number', size: 150 * s, maxLines: 1, anim: timing(d, fade(0.2, 0.2)) }, { isoDate: fig.isoDate, sourceField: fig.sourceField, ...(fig.derived ? { derived: fig.derived.formula } : {}) })
    num.countUp = { target: fig.value, duration: o.countUp ?? 1.4, delay: 0.2, easing: 'esb', format: fmt }
    els.push(num)
    const numLay = layoutTitle({ text: num.text, font: num.font, maxWidth: w, maxLines: 1 }, o.measure)
    y += numLay.height + 24 * s // room for the comma's descender
    const unit = dataText(c, 'unit', fig.time ? `${fig.unit} · ${fig.time}` : fig.unit, x, y, w, { role: 'label', size: 34 * s, maxLines: 1, color: INK_2, anim: timing(d, fade(0.3, 0.5)) })
    els.push(unit); y += heightOf(c, unit)
    return { els, h: y }
  }, fig.isoDate, fig.dateLabel, fig.derived?.formula)
}

/** A chart card for a series (fuel mix, zones, hourly): bar, line or donut. */
export function gridChartCard(series: GridSeries, kind: ChartSpec['kind'], o: DataCardOptions & { itemColors?: boolean }): TitleSpec {
  const c = ctxOf(o)
  const d = o.duration ?? 7
  const s = c.s
  const out = frame(c, d, (x, w) => {
    const els: TitleElement[] = []
    let y = 30 * s
    const title = dataText(c, 'title', o.lang === 'bn' ? series.title.bn : series.title.en, x, y, w, { role: 'label', size: 32 * s, maxLines: 2, color: c.accent ?? INK, anim: timing(d, lineByLine(0.1, 0.1)) })
    els.push(title); y += heightOf(c, title) + 4 * s
    const unit = dataText(c, 'unit', series.unit, x, y, w, { role: 'body', size: 22 * s, maxLines: 1, color: INK_2, anim: timing(d, fade(0.3, 0.2)) })
    els.push(unit); y += heightOf(c, unit) + 20 * s
    const rows = series.items.length
    const chartH = kind === 'bar' ? Math.min(rows * 58 * s, c.safe.h * 0.6) : 360 * s
    els.push({
      type: 'chart', id: 'chart', x, y, w, h: chartH,
      chart: { kind, items: series.items.map((i) => ({ label: i.label, value: i.value, color: i.color })), unit: series.unit, grow: { delay: 0.3, duration: o.countUp ?? 1.4, easing: 'esb' }, accent: kind === 'line' ? c.accent ?? undefined : undefined, itemColors: o.itemColors, format: { digits: o.digits }, size: Math.round(26 * s), derived: !!series.derived },
      anim: timing(d, fade(0.25, 0.25)),
    })
    y += chartH
    return { els, h: y }
  }, series.isoDate, series.dateLabel, series.derived?.formula)
  out.kind = 'data-chart'
  return out
}

/** The font a data card's figure uses (tests and the inspector). */
export const figureFont = (s: number) => fontFor('0', 'number', Math.round(150 * s))
