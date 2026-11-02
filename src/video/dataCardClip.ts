// Grid data-card clips (Phase 3, Part B): a clip that carries the published figure (or series) it shows, with the
// day, the field it was read from, the unit, when it was fetched and from where — so the card is reproducible from the
// project file alone and an export never fetches anything. The card is drawn by the prebuild's dataCards.ts.
//
// Rules (VIDEO_PRO_PLAN non-negotiable 1, CLAUDE.md §2.4/2.5): the value is the file's, never typed, never rounded
// beyond the source (formatExact); a computed value is labelled "Derived" with its formula; the Source line with the
// date is always on the card; a refresh shows what changed and asks before it updates the clip.

import type { Clip } from './timeline'
import type { ChartSpec } from './titles/charts'
import { gridChartCard, gridNumberCard } from './titles/dataCards'
import { GRID_METRICS, GRID_UNITS, fuelMix, hourlySeries, readMetric, sharesOf, zoneSeries, zoneShedPct, type GridDay, type GridFigure, type GridMetricId, type GridSeries, type GridUnit } from './titles/grid'
import { blurIn, fade, maskReveal, scaleIn, slide, type AnimPhase, type TextAnimSpec } from './titles/anim'
import type { Measurer } from './titles/layout'
import { formatExact } from './titles/numbers'
import type { TitleSpec } from './titles/spec'

export type DataSeriesId =
  | 'fuelMix' | 'fuelMix:share' | 'zone:demand' | 'zone:loadShed' | 'zone:pct' | 'zoneGeneration'
  | 'hourly:generation' | 'hourly:demand' | 'hourly:loadShed'
export const DATA_SERIES: DataSeriesId[] = ['fuelMix', 'fuelMix:share', 'zone:demand', 'zone:loadShed', 'zone:pct', 'zoneGeneration', 'hourly:generation', 'hourly:demand', 'hourly:loadShed']
export type ChartKind = ChartSpec['kind']

export type DataAnimIn = 'esb' | 'fade' | 'slide' | 'scale' | 'blur' | 'mask'
export type DataAnimOut = 'fade' | 'slide' | 'blur' | 'none'
export const DATA_ANIM_IN: { value: DataAnimIn; label: string }[] = [
  { value: 'esb', label: 'ESB' }, { value: 'fade', label: 'Fade' }, { value: 'slide', label: 'Slide' }, { value: 'scale', label: 'Scale' }, { value: 'blur', label: 'Blur' }, { value: 'mask', label: 'Wipe' },
]
export const DATA_ANIM_OUT: { value: DataAnimOut; label: string }[] = [
  { value: 'fade', label: 'Fade' }, { value: 'slide', label: 'Slide' }, { value: 'blur', label: 'Blur' }, { value: 'none', label: 'Cut' },
]

export interface DataCardStyle {
  lang: 'en' | 'bn'
  digits: 'latin' | 'bn'
  /** An explicit accent colour (#rrggbb); null = the ESB default. */
  accent: string | null
  /** Chart cards: bar, line or donut. */
  chart?: ChartKind
  animIn: DataAnimIn
  animOut: DataAnimOut
}

export interface DataCardRef {
  v: 1
  kind: 'number' | 'chart'
  /** The energy day (YYYY-MM-DD) and the date as the file states it (what the Source line shows). */
  date: string
  dateLabel: string
  /** A GridMetricId (number) or a DataSeriesId (chart). */
  metric: string
  /** The figure exactly as stored (number cards). Chart cards carry their values in `series.items`. */
  value: number | null
  unit: GridUnit
  figure?: GridFigure
  series?: GridSeries
  /** When the day's file was fetched (ISO time) and the URL it came from. */
  fetchedAt: string
  source: string
  style: DataCardStyle
}

export const DEFAULT_STYLE: DataCardStyle = { lang: 'en', digits: 'latin', accent: null, animIn: 'esb', animOut: 'fade' }

export const SERIES_LABEL: Record<DataSeriesId, string> = {
  fuelMix: 'Fuel mix (MKWh)',
  'fuelMix:share': 'Fuel mix share (%)',
  'zone:demand': 'Demand by zone (MW)',
  'zone:loadShed': 'Load shedding by zone (MW)',
  'zone:pct': 'Load shedding share by zone (%)',
  zoneGeneration: 'Generation by zone (MKWh)',
  'hourly:generation': 'Hourly generation (MW)',
  'hourly:demand': 'Hourly demand (MW)',
  'hourly:loadShed': 'Hourly load shedding (MW)',
}

export const defaultChartKind = (id: DataSeriesId): ChartKind => (id.startsWith('fuelMix') ? 'donut' : id.startsWith('hourly') ? 'line' : 'bar')

/** One series of the day by id, or null when the file does not publish it. */
export function readSeries(day: GridDay, id: DataSeriesId): GridSeries | null {
  switch (id) {
    case 'fuelMix': return fuelMix(day)
    case 'fuelMix:share': { const f = fuelMix(day); return f ? sharesOf(f) : null }
    case 'zone:demand': return zoneSeries(day, 'demand')
    case 'zone:loadShed': return zoneSeries(day, 'loadShed')
    case 'zone:pct': return zoneShedPct(day)
    case 'zoneGeneration': return zoneSeries(day, 'generation')
    case 'hourly:generation': return hourlySeries(day, 'generation')
    case 'hourly:demand': return hourlySeries(day, 'demand')
    case 'hourly:loadShed': return hourlySeries(day, 'loadShed')
  }
}

export const isMetricId = (s: string): s is GridMetricId => (GRID_METRICS as string[]).includes(s)
export const isSeriesId = (s: string): s is DataSeriesId => (DATA_SERIES as string[]).includes(s)

export interface FetchedDay { day: GridDay; fetchedAt: string; source: string }

/** The card for a metric or series of a fetched day, or null when the file does not publish it. */
export function dataCardFor(f: FetchedDay, metric: string, style: Partial<DataCardStyle> = {}): DataCardRef | null {
  const base = { v: 1 as const, date: f.day.isoDate, dateLabel: f.day.dateLabel, metric, fetchedAt: f.fetchedAt, source: f.source }
  if (isMetricId(metric)) {
    const fig = readMetric(f.day, metric)
    if (!fig) return null
    return { ...base, kind: 'number', value: fig.value, unit: fig.unit, figure: fig, style: { ...DEFAULT_STYLE, ...style } }
  }
  if (isSeriesId(metric)) {
    const s = readSeries(f.day, metric)
    if (!s) return null
    return { ...base, kind: 'chart', value: null, unit: s.unit, series: s, style: { ...DEFAULT_STYLE, chart: defaultChartKind(metric), ...style } }
  }
  return null
}

/** The clip on the overlay track: titled by its metric and date, as long as the card's animation needs. */
export function dataCardClip(card: DataCardRef, trackId: string, start: number, stamp = Date.now().toString(36)): Clip {
  const duration = card.kind === 'number' ? 6 : 7
  return {
    id: `clip-data-${stamp}`, trackId, kind: 'overlay', start: Math.max(0, start), duration, in: 0, out: duration, color: '#0e7490',
    title: `${cardLabel(card)} · ${card.date}`,
    dataCard: card,
  }
}

export function cardLabel(card: DataCardRef): string {
  if (card.kind === 'number' && card.figure) return card.figure.label.en
  if (card.series) return card.series.title.en
  return card.metric
}

/** What the card shows, as text: the exact value(s) with the unit. */
export function cardValueText(card: DataCardRef): string {
  const fmt = { digits: card.style.digits }
  if (card.kind === 'number' && card.value !== null) return `${formatExact(card.value, fmt)} ${card.unit}${card.figure?.time ? ` · ${card.figure.time}` : ''}`
  return (card.series?.items ?? []).map((i) => `${i.label} ${formatExact(i.value, fmt)}`).join(' · ') + ` (${card.unit})`
}

/** The formula when the value is computed rather than read (shares, the site parser's own derived fields). */
export const derivedFormula = (card: DataCardRef): string | null => card.figure?.derived?.formula ?? card.series?.derived?.formula ?? null

// ------------------------------------------------------------------ spec

const IN: Record<Exclude<DataAnimIn, 'esb'>, (delay: number) => AnimPhase> = {
  fade: (d) => fade(0.4, d),
  slide: (d) => slide('up', 40, 0.5, d),
  scale: (d) => scaleIn(0.9, 0.45, d),
  blur: (d) => blurIn(14, 0.6, d),
  mask: (d) => maskReveal('right', 0.6, d, 'all'),
}
const OUT: Record<Exclude<DataAnimOut, 'none'>, () => AnimPhase> = {
  fade: () => fade(0.35),
  slide: () => slide('down', 40, 0.4),
  blur: () => blurIn(14, 0.4),
}

/** The card's animation: the template's own staggered in (ESB) or one preset for every element (keeping each
 * element's delay, so the figure still follows its label), and the chosen out over the last moments. */
function withAnim(anim: TextAnimSpec | undefined, duration: number, style: DataCardStyle): TextAnimSpec | undefined {
  if (!anim) return anim
  const inPhase = style.animIn === 'esb' || !anim.in ? anim.in : IN[style.animIn](anim.in.delay ?? 0)
  const outPhase = style.animOut === 'none' ? undefined : OUT[style.animOut]()
  return { duration, in: inPhase, out: outPhase }
}

export interface SpecOptions { frame: { w: number; h: number }; measure: Measurer; editor: boolean; duration: number }

/** The TitleSpec for a data-card clip, from the clip's stored values only. */
export function dataCardSpec(card: DataCardRef, o: SpecOptions): TitleSpec | null {
  const opts = { frame: o.frame, measure: o.measure, editor: o.editor, duration: o.duration, lang: card.style.lang, digits: card.style.digits, accent: card.style.accent }
  let spec: TitleSpec
  if (card.kind === 'number' && card.figure) spec = gridNumberCard(card.figure, opts)
  else if (card.kind === 'chart' && card.series) spec = gridChartCard(card.series, card.style.chart ?? 'bar', { ...opts, itemColors: card.series.id.startsWith('fuelMix') })
  else return null
  spec.elements = spec.elements.map((el) => ({ ...el, anim: withAnim(el.anim, o.duration, card.style) }) as typeof el)
  return spec
}

// ------------------------------------------------------------------ refresh

export interface RefreshDiff {
  /** The day no longer publishes this metric. */
  missing: boolean
  changed: boolean
  before: string
  after: string
  /** The card rebuilt from the fresh file (style kept), when it still exists. */
  next: DataCardRef | null
}

/** Compare a card with a freshly fetched copy of its day. The figure (value, unit, hour) or every series item
 * (label, value) must be equal for "unchanged"; the fetch time alone never counts as a change. */
export function refreshDiff(card: DataCardRef, fresh: FetchedDay): RefreshDiff {
  const next = dataCardFor(fresh, card.metric, card.style)
  const before = cardValueText(card)
  if (!next) return { missing: true, changed: true, before, after: '', next: null }
  const after = cardValueText(next)
  const same = card.kind === 'number'
    ? next.value === card.value && next.unit === card.unit && (next.figure?.time ?? '') === (card.figure?.time ?? '') && next.figure?.sourceField === card.figure?.sourceField
    : JSON.stringify(next.series?.items.map((i) => [i.label, i.value])) === JSON.stringify(card.series?.items.map((i) => [i.label, i.value])) && next.unit === card.unit
  return { missing: false, changed: !same || next.dateLabel !== card.dateLabel, before, after, next }
}

// ------------------------------------------------------------------ project file

const UNITS = GRID_UNITS
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const ISO = /^\d{4}-\d{2}-\d{2}$/
const HEX = /^#[0-9a-fA-F]{6}$/
const pick = <T extends string>(v: unknown, list: readonly T[], dflt: T): T => (list.includes(v as T) ? (v as T) : dflt)

function cleanFigure(f: unknown, date: string, dateLabel: string): GridFigure | null {
  if (!f || typeof f !== 'object') return null
  const o = f as Record<string, unknown>
  const label = o.label as Record<string, unknown> | undefined
  if (!isStr(o.id, 40) || !isNum(o.value) || !UNITS.includes(o.unit as GridUnit) || !isStr(o.sourceField, 120) || !label || !isStr(label.en, 120) || !isStr(label.bn, 120)) return null
  const fig: GridFigure = { id: o.id, label: { en: label.en, bn: label.bn }, value: o.value, unit: o.unit as GridUnit, sourceField: o.sourceField, isoDate: date, dateLabel }
  if (isStr(o.time, 12)) fig.time = o.time
  const d = o.derived as Record<string, unknown> | undefined
  if (d && isStr(d.formula, 600)) fig.derived = { formula: d.formula }
  return fig
}

function cleanSeries(s: unknown, date: string, dateLabel: string): GridSeries | null {
  if (!s || typeof s !== 'object') return null
  const o = s as Record<string, unknown>
  const title = o.title as Record<string, unknown> | undefined
  if (!isStr(o.id, 40) || !UNITS.includes(o.unit as GridUnit) || !title || !isStr(title.en, 120) || !isStr(title.bn, 120) || !Array.isArray(o.items) || o.items.length < 1 || o.items.length > 48) return null
  const items = []
  for (const it of o.items) {
    if (!it || typeof it !== 'object') return null
    const i = it as Record<string, unknown>
    if (!isStr(i.label, 80) || !isNum(i.value) || !isStr(i.sourceField, 120)) return null
    items.push({ label: i.label, value: i.value, sourceField: i.sourceField, ...(isStr(i.color, 30) && /^#[0-9a-fA-F]{3,8}$/.test(i.color) ? { color: i.color } : {}) })
  }
  const out: GridSeries = { id: o.id, title: { en: title.en, bn: title.bn }, unit: o.unit as GridUnit, items, isoDate: date, dateLabel }
  const d = o.derived as Record<string, unknown> | undefined
  if (d && isStr(d.formula, 1200)) out.derived = { formula: d.formula }
  return out
}

/** A data card read from a project file: every field checked (a crafted file must not throw in the renderer or put
 * an unlabelled figure on screen). Undefined when it is not a valid card. */
export function sanitizeDataCard(raw: unknown): DataCardRef | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  if (o.v !== 1 || (o.kind !== 'number' && o.kind !== 'chart')) return undefined
  if (!isStr(o.date, 10) || !ISO.test(o.date) || !isStr(o.dateLabel, 20) || !isStr(o.metric, 40) || !isStr(o.fetchedAt, 40) || !isStr(o.source, 200) || !UNITS.includes(o.unit as GridUnit)) return undefined
  if (!/^(https:\/\/esbpowerline\.com|http:\/\/127\.0\.0\.1:\d+)\//.test(o.source)) return undefined
  const st = (o.style ?? {}) as Record<string, unknown>
  const style: DataCardStyle = {
    lang: pick(st.lang, ['en', 'bn'] as const, 'en'),
    digits: pick(st.digits, ['latin', 'bn'] as const, 'latin'),
    accent: isStr(st.accent, 7) && HEX.test(st.accent) ? st.accent : null,
    animIn: pick(st.animIn, DATA_ANIM_IN.map((a) => a.value), 'esb'),
    animOut: pick(st.animOut, DATA_ANIM_OUT.map((a) => a.value), 'fade'),
  }
  const base = { v: 1 as const, date: o.date, dateLabel: o.dateLabel, metric: o.metric, unit: o.unit as GridUnit, fetchedAt: o.fetchedAt, source: o.source }
  if (o.kind === 'number') {
    const figure = cleanFigure(o.figure, o.date, o.dateLabel)
    if (!figure || !isMetricId(o.metric) || figure.value !== o.value) return undefined
    return { ...base, kind: 'number', value: figure.value, figure, style }
  }
  const series = cleanSeries(o.series, o.date, o.dateLabel)
  if (!series || !isSeriesId(o.metric)) return undefined
  style.chart = pick(st.chart, ['bar', 'line', 'donut'] as const, defaultChartKind(o.metric))
  return { ...base, kind: 'chart', value: null, series, style }
}
