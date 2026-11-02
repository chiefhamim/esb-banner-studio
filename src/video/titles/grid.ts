// Typed reader for esbpowerline.com's published daily grid JSON (PGCB daily report, one file per energy day).
//
// Where it lives (verified in the site repo, lib/data/grid/date-utils.ts `dailyReportPath`/`runtimeDailyReportPath`):
//   https://esbpowerline.com/data/daily/<YYYY-MM-DD>.json      (static archive, shipped with the build)
//   https://esbpowerline.com/api/data/daily/<YYYY-MM-DD>.json  (days published since the last deploy; same shape)
// Access (site middleware.ts + lib/data/grid/daily-access.ts): in production the request needs a same-site Referer or
// Origin, a non-bot user agent (node-fetch, curl, axios, headless… are refused), and the date inside the caller's tier
// window (visitor: the latest 7 days; member 30; paid plans longer). A plain fetch from the Studio is refused (403);
// Phase 3 must fetch through main with the staff session (or read a copy the owner exports) — not decided here.
//
// Shape: the site's `GridDailyData` (lib/data/grid/types.ts). Units are not in the file; they are the site's documented
// ones, carried here with each figure: MW for peaks and zone demand/shed, MKWh for energy (P1 totals, fuel mix,
// zone generation), MMCFD for gas to power, °C for temperature. A missing or null figure is "not published", never 0.
//
// Nothing here rounds or computes a figure. The few values that are computed are flagged `derived` with the formula.

import { MAX_FIGURE, isShowableNumber } from './numbers'

export const GRID_DAILY_PATH = (iso: string) => `/data/daily/${iso}.json`
export const GRID_DAILY_URL = (iso: string) => `https://esbpowerline.com${GRID_DAILY_PATH(iso)}`
export const GRID_DAILY_RUNTIME_URL = (iso: string) => `https://esbpowerline.com/api${GRID_DAILY_PATH(iso)}`

export class GridDataError extends Error {}

export interface GridSystemStats {
  date: string
  dayPeakGen: number
  eveningPeakGen: number
  dayPeakDemand: number | null
  eveningPeakDemand: number
  minGen: number | null
  maxGen: number | null
  totalEnergyGen: number | null
  totalEnergyUnserved: number | null
  totalEnergyDemand: number | null
  maxTemp: number | null
  totalGasSuppliedPower: number
  /** Derived by the site's parser (totalDailyCost ÷ totalEnergyGen), not printed by PGCB. */
  avgProductionCost: number
  totalDailyCost: number
  peakTimes?: Partial<Record<'dayPeakGen' | 'dayPeakDemand' | 'eveningPeakGen' | 'eveningPeakDemand' | 'minGen' | 'maxGen', string>>
}
export interface GridGenerationItem { name: string; gen: number; cost: number | null; unitCost: number | null; color: string }
export interface ZoneGenerationItem { zone: string; fuels: Record<string, number>; total: number }
export interface RegionalDemandItem { zone: string; loadShed: number; demand: number; pct: number }
export interface HourlyLoadItem { time: string; generation: number; loadShed: number | null; demand: number | null }
export interface BorderImportItem { source: string; energy: number; peakFlow: number | null; type: string }

export interface GridDay {
  /** The energy day (file name). */
  isoDate: string
  /** The date as the file states it ("21 Oct 2026"): what the card shows. */
  dateLabel: string
  systemStats: GridSystemStats
  generationData: GridGenerationItem[]
  zoneGenerationData: ZoneGenerationItem[] | null
  regionalDemandData: RegionalDemandItem[] | null
  regionalDemandSource: string | null
  hourlyLoadData: HourlyLoadItem[] | null
  borderImportsData: BorderImportItem[] | null
  sourceFile: string | null
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "21 Oct 2026" → "2026-10-21" (the site's legacy date label), else null. */
export function labelToIso(label: string): string | null {
  const m = /^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/.exec(label.trim())
  if (!m) return null
  const mi = MONTHS.indexOf(m[2])
  return mi < 0 ? null : `${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown, path: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new GridDataError(`${path} is not a number`)
  if (Math.abs(v) >= MAX_FIGURE) throw new GridDataError(`${path} is out of range`)
  return v
}
const numOrNull = (v: unknown, path: string): number | null => (v === null || v === undefined ? null : num(v, path))
const str = (v: unknown, path: string): string => {
  if (typeof v !== 'string') throw new GridDataError(`${path} is not text`)
  return v
}

/** Parse and check one day's JSON. Throws GridDataError on a wrong shape or when the file is not for `isoDate`. */
export function parseGridDay(raw: unknown, isoDate: string): GridDay {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new GridDataError(`bad date ${isoDate}`)
  if (!isObj(raw) || !isObj(raw.systemStats)) throw new GridDataError('not a daily grid report (no systemStats)')
  const s = raw.systemStats
  const dateLabel = str(s.date, 'systemStats.date')
  const labelIso = labelToIso(dateLabel)
  if (labelIso !== isoDate) throw new GridDataError(`the file is for ${dateLabel}, not ${isoDate}`)
  const pt = isObj(s.peakTimes) ? Object.fromEntries(Object.entries(s.peakTimes).filter(([, v]) => typeof v === 'string')) as GridSystemStats['peakTimes'] : undefined
  const systemStats: GridSystemStats = {
    date: dateLabel,
    dayPeakGen: num(s.dayPeakGen, 'dayPeakGen'),
    eveningPeakGen: num(s.eveningPeakGen, 'eveningPeakGen'),
    dayPeakDemand: numOrNull(s.dayPeakDemand, 'dayPeakDemand'),
    eveningPeakDemand: num(s.eveningPeakDemand, 'eveningPeakDemand'),
    minGen: numOrNull(s.minGen, 'minGen'),
    maxGen: numOrNull(s.maxGen, 'maxGen'),
    totalEnergyGen: numOrNull(s.totalEnergyGen, 'totalEnergyGen'),
    totalEnergyUnserved: numOrNull(s.totalEnergyUnserved, 'totalEnergyUnserved'),
    totalEnergyDemand: numOrNull(s.totalEnergyDemand, 'totalEnergyDemand'),
    maxTemp: numOrNull(s.maxTemp, 'maxTemp'),
    totalGasSuppliedPower: num(s.totalGasSuppliedPower, 'totalGasSuppliedPower'),
    avgProductionCost: num(s.avgProductionCost, 'avgProductionCost'),
    totalDailyCost: num(s.totalDailyCost, 'totalDailyCost'),
    peakTimes: pt,
  }
  const arr = (v: unknown, path: string): unknown[] | null => {
    if (v === undefined || v === null) return null
    if (!Array.isArray(v)) throw new GridDataError(`${path} is not a list`)
    return v
  }
  const gen = arr(raw.generationData, 'generationData') ?? []
  const generationData = gen.map((g, i) => {
    if (!isObj(g)) throw new GridDataError(`generationData[${i}]`)
    return { name: str(g.name, `generationData[${i}].name`), gen: num(g.gen, `generationData[${i}].gen`), cost: numOrNull(g.cost, 'cost'), unitCost: numOrNull(g.unitCost, 'unitCost'), color: typeof g.color === 'string' ? g.color : '' }
  })
  const zoneGenerationData = arr(raw.zoneGenerationData, 'zoneGenerationData')?.map((z, i) => {
    if (!isObj(z) || !isObj(z.fuels)) throw new GridDataError(`zoneGenerationData[${i}]`)
    return { zone: str(z.zone, 'zone'), fuels: Object.fromEntries(Object.entries(z.fuels).map(([k, v]) => [k, num(v, `zone ${String(z.zone)} ${k}`)])), total: num(z.total, 'zone total') }
  }) ?? null
  const regionalDemandData = arr(raw.regionalDemandData, 'regionalDemandData')?.map((r, i) => {
    if (!isObj(r)) throw new GridDataError(`regionalDemandData[${i}]`)
    return { zone: str(r.zone, 'zone'), loadShed: num(r.loadShed, 'loadShed'), demand: num(r.demand, 'demand'), pct: num(r.pct, 'pct') }
  }) ?? null
  const hourlyLoadData = arr(raw.hourlyLoadData, 'hourlyLoadData')?.map((h, i) => {
    if (!isObj(h)) throw new GridDataError(`hourlyLoadData[${i}]`)
    return { time: str(h.time, 'time'), generation: num(h.generation, 'generation'), loadShed: numOrNull(h.loadShed, 'loadShed'), demand: numOrNull(h.demand, 'demand') }
  }) ?? null
  const borderImportsData = arr(raw.borderImportsData, 'borderImportsData')?.map((b, i) => {
    if (!isObj(b)) throw new GridDataError(`borderImportsData[${i}]`)
    return { source: str(b.source, 'source'), energy: num(b.energy, 'energy'), peakFlow: numOrNull(b.peakFlow, 'peakFlow'), type: typeof b.type === 'string' ? b.type : '' }
  }) ?? null
  const sf = isObj(raw.sourceFiles) && typeof raw.sourceFiles.pgcb === 'string' ? raw.sourceFiles.pgcb : null
  return {
    isoDate,
    dateLabel,
    systemStats,
    generationData,
    zoneGenerationData,
    regionalDemandData,
    regionalDemandSource: typeof raw.regionalDemandSource === 'string' ? raw.regionalDemandSource : null,
    hourlyLoadData,
    borderImportsData,
    sourceFile: sf,
  }
}

// ------------------------------------------------------------------ figures

export type GridUnit = 'MW' | 'MKWh' | 'MMCFD' | '°C' | '%' | 'Tk/kWh'
/** Every unit a grid figure may carry (the project-file sanitiser checks against it). */
export const GRID_UNITS: readonly GridUnit[] = ['MW', 'MKWh', 'MMCFD', '°C', '%', 'Tk/kWh']

export interface GridFigure {
  id: string
  label: { en: string; bn: string }
  /** Exactly as stored. */
  value: number
  unit: GridUnit
  /** The clock time PGCB stamps against the figure, when it does. */
  time?: string
  /** Where it was read: a JSON path into the day's file. */
  sourceField: string
  /** Set when the value is computed rather than read; the card must say "derived". */
  derived?: { formula: string; short?: string }
  isoDate: string
  dateLabel: string
}

export type GridMetricId =
  | 'eveningPeakGen' | 'eveningPeakDemand' | 'dayPeakGen' | 'dayPeakDemand' | 'maxGen' | 'minGen'
  | 'totalEnergyGen' | 'totalEnergyDemand' | 'totalEnergyUnserved' | 'totalGasSuppliedPower' | 'maxTemp'
  | 'peakLoadShed' | 'eveningPeakLoadShed'

const STAT_META: Record<Exclude<GridMetricId, 'peakLoadShed' | 'eveningPeakLoadShed'>, { en: string; bn: string; unit: GridUnit }> = {
  eveningPeakGen: { en: 'Evening peak generation', bn: 'সান্ধ্য পিক উৎপাদন', unit: 'MW' },
  eveningPeakDemand: { en: 'Evening peak demand', bn: 'সান্ধ্য পিক চাহিদা', unit: 'MW' },
  dayPeakGen: { en: 'Day peak generation', bn: 'দিনের পিক উৎপাদন', unit: 'MW' },
  dayPeakDemand: { en: 'Day peak demand', bn: 'দিনের পিক চাহিদা', unit: 'MW' },
  maxGen: { en: 'Highest generation', bn: 'সর্বোচ্চ উৎপাদন', unit: 'MW' },
  minGen: { en: 'Lowest generation', bn: 'সর্বনিম্ন উৎপাদন', unit: 'MW' },
  totalEnergyGen: { en: 'Energy generated', bn: 'মোট উৎপাদিত বিদ্যুৎ', unit: 'MKWh' },
  totalEnergyDemand: { en: 'Energy demand', bn: 'মোট বিদ্যুৎ চাহিদা', unit: 'MKWh' },
  totalEnergyUnserved: { en: 'Energy not served', bn: 'অসরবরাহকৃত বিদ্যুৎ', unit: 'MKWh' },
  totalGasSuppliedPower: { en: 'Gas supplied to power plants', bn: 'বিদ্যুৎকেন্দ্রে গ্যাস সরবরাহ', unit: 'MMCFD' },
  maxTemp: { en: 'Highest temperature', bn: 'সর্বোচ্চ তাপমাত্রা', unit: '°C' },
}

export const GRID_METRICS: GridMetricId[] = [...(Object.keys(STAT_META) as GridMetricId[]), 'peakLoadShed', 'eveningPeakLoadShed']

/** What a metric's figure must look like (the project-file check compares a stored card against it): the site's
 * label and unit, and where in the day's file it is read. The two load-shed metrics name the hour or zone in the
 * label, so they match by prefix. */
export function metricMeta(id: GridMetricId): { en: string; bn: string; unit: GridUnit; labelPrefix: boolean; field: RegExp } {
  if (id === 'peakLoadShed') return { en: 'Highest ', bn: 'সর্বোচ্চ ', unit: 'MW', labelPrefix: true, field: /^(hourlyLoadData|regionalDemandData)\[\d+\]\.loadShed$/ }
  if (id === 'eveningPeakLoadShed') return { en: 'Load shedding at evening peak', bn: 'সান্ধ্য পিকে লোডশেডিং', unit: 'MW', labelPrefix: false, field: /^hourlyLoadData\[\d+\]\.loadShed$/ }
  const m = STAT_META[id]
  return { en: m.en, bn: m.bn, unit: m.unit, labelPrefix: false, field: new RegExp(`^systemStats\\.${id}$`) }
}

/** One figure of the day, or null when the file does not publish it (never 0 in its place). */
export function readMetric(day: GridDay, id: GridMetricId): GridFigure | null {
  const fig = readMetricRaw(day, id)
  // a figure that cannot be shown exactly (more than 12 decimals) is "not published" here, never rounded
  return fig && isShowableNumber(fig.value) ? fig : null
}

function readMetricRaw(day: GridDay, id: GridMetricId): GridFigure | null {
  const base = { isoDate: day.isoDate, dateLabel: day.dateLabel }
  if (id === 'peakLoadShed') {
    // the day's highest hourly load shed (P4), as the site's home tile reads it; else the highest zone figure.
    // A choice among published values, not a computation — but say which hour it is.
    const hours = (day.hourlyLoadData ?? []).filter((h) => h.loadShed !== null)
    if (hours.length) {
      let best = hours[0]
      for (const h of hours) if ((h.loadShed as number) > (best.loadShed as number)) best = h
      const i = day.hourlyLoadData!.indexOf(best)
      return { ...base, id, label: { en: 'Highest hourly load shedding', bn: 'সর্বোচ্চ ঘণ্টাভিত্তিক লোডশেডিং' }, value: best.loadShed as number, unit: 'MW', time: best.time, sourceField: `hourlyLoadData[${i}].loadShed` }
    }
    const zones = day.regionalDemandData ?? []
    if (!zones.length) return null
    let bz = zones[0]
    for (const z of zones) if (z.loadShed > bz.loadShed) bz = z
    return { ...base, id, label: { en: `Highest zone load shedding (${bz.zone})`, bn: `সর্বোচ্চ অঞ্চলভিত্তিক লোডশেডিং (${bz.zone})` }, value: bz.loadShed, unit: 'MW', sourceField: `regionalDemandData[${zones.indexOf(bz)}].loadShed` }
  }
  if (id === 'eveningPeakLoadShed') {
    // load shed in the hour PGCB stamps as the evening DEMAND peak (shed = demand not served, so the demand peak's
    // hour is where it matters); the generation-peak stamp is used only when the file has no demand-peak stamp
    const t = day.systemStats.peakTimes?.eveningPeakDemand ?? day.systemStats.peakTimes?.eveningPeakGen
    const i = t ? (day.hourlyLoadData ?? []).findIndex((h) => h.time === t) : -1
    const h = i >= 0 ? day.hourlyLoadData![i] : null
    if (!h || h.loadShed === null) return null
    return { ...base, id, label: { en: 'Load shedding at evening peak', bn: 'সান্ধ্য পিকে লোডশেডিং' }, value: h.loadShed, unit: 'MW', time: h.time, sourceField: `hourlyLoadData[${i}].loadShed` }
  }
  const meta = STAT_META[id]
  const v = day.systemStats[id]
  if (v === null || v === undefined) return null
  const time = (day.systemStats.peakTimes as Record<string, string> | undefined)?.[id]
  return { ...base, id, label: { en: meta.en, bn: meta.bn }, value: v, unit: meta.unit, ...(time ? { time } : {}), sourceField: `systemStats.${id}` }
}

export interface SeriesItem { label: string; value: number; sourceField: string; color?: string }
export interface GridSeries {
  id: string
  title: { en: string; bn: string }
  unit: GridUnit
  items: SeriesItem[]
  isoDate: string
  dateLabel: string
  /** `short` is the card's one-line form (the full formula stays in the clip data and its tooltip). */
  derived?: { formula: string; short?: string }
}

/** The day's fuel mix (energy by fuel, MKWh), in the file's order; the site's own colour per fuel is kept. */
export function fuelMix(day: GridDay): GridSeries | null {
  if (!day.generationData.length) return null
  return {
    id: 'fuelMix', title: { en: 'Generation by fuel', bn: 'জ্বালানিভিত্তিক উৎপাদন' }, unit: 'MKWh',
    items: day.generationData.map((g, i) => ({ label: g.name, value: g.gen, sourceField: `generationData[${i}].gen`, color: g.color || undefined })),
    isoDate: day.isoDate, dateLabel: day.dateLabel,
  }
}

/** Shares of a series in %, DERIVED: share_i = value_i ÷ Σ values × 100, rounded to `decimals` (default 1). The
 * total is the sum of the listed items (for the fuel mix, Σ generationData.gen), not a published total. */
export function sharesOf(series: GridSeries, decimals = 1): GridSeries {
  const total = series.items.reduce((a, it) => a + it.value, 0)
  const f = 10 ** decimals
  return {
    ...series,
    id: `${series.id}:share`,
    title: { en: `${series.title.en} (share)`, bn: `${series.title.bn} (অংশ)` },
    unit: '%',
    items: series.items.map((it) => ({ ...it, value: total > 0 ? Math.round((it.value / total) * 100 * f) / f : 0 })),
    derived: { short: 'share of total', formula: `share = value ÷ Σ values (${series.items.map((i) => i.sourceField).join(' + ')}) × 100, rounded to ${decimals} decimal${decimals === 1 ? '' : 's'}` },
  }
}

/** Zone figures: evening demand or load shed per zone (MW), or each zone's generation total (MKWh). */
export function zoneSeries(day: GridDay, metric: 'demand' | 'loadShed' | 'generation'): GridSeries | null {
  if (metric === 'generation') {
    const z = day.zoneGenerationData
    if (!z?.length) return null
    return { id: 'zoneGeneration', title: { en: 'Generation by zone', bn: 'অঞ্চলভিত্তিক উৎপাদন' }, unit: 'MKWh', items: z.map((r, i) => ({ label: r.zone, value: r.total, sourceField: `zoneGenerationData[${i}].total` })), isoDate: day.isoDate, dateLabel: day.dateLabel }
  }
  const r = day.regionalDemandData
  if (!r?.length) return null
  const s: GridSeries = {
    id: `zone:${metric}`,
    title: metric === 'demand' ? { en: 'Demand by zone', bn: 'অঞ্চলভিত্তিক চাহিদা' } : { en: 'Load shedding by zone', bn: 'অঞ্চলভিত্তিক লোডশেডিং' },
    unit: 'MW',
    items: r.map((z, i) => ({ label: z.zone, value: z[metric], sourceField: `regionalDemandData[${i}].${metric}` })),
    isoDate: day.isoDate, dateLabel: day.dateLabel,
  }
  // zone demand is PGCB's printed figure only when the file says so; otherwise the parser rebuilt it as served + shed
  if (metric === 'demand' && day.regionalDemandSource !== 'p1-published') s.derived = { short: 'area served + load shed', formula: 'zone demand = area served + area load shed (rebuilt by the site parser; PGCB printed no zone demand)' }
  return s
}

/** Zone load-shed share as stored (`pct`), which the site's parser DERIVES: loadShed ÷ demand × 100, rounded to 1. */
export function zoneShedPct(day: GridDay): GridSeries | null {
  const r = day.regionalDemandData
  if (!r?.length) return null
  return { id: 'zone:pct', title: { en: 'Load shedding share by zone', bn: 'অঞ্চলভিত্তিক লোডশেডিংয়ের হার' }, unit: '%', items: r.map((z, i) => ({ label: z.zone, value: z.pct, sourceField: `regionalDemandData[${i}].pct` })), isoDate: day.isoDate, dateLabel: day.dateLabel, derived: { short: 'load shed ÷ demand', formula: 'pct = loadShed ÷ demand × 100, rounded to 1 decimal (computed by the site parser, stored in the file)' } }
}

/** An hourly line (MW) of generation, demand or load shed; hours the file leaves null are dropped, never zeroed. */
export function hourlySeries(day: GridDay, metric: 'generation' | 'demand' | 'loadShed'): GridSeries | null {
  const h = day.hourlyLoadData
  if (!h?.length) return null
  const items = h.map((r, i) => ({ r, i })).filter(({ r }) => r[metric] !== null).map(({ r, i }) => ({ label: r.time, value: r[metric] as number, sourceField: `hourlyLoadData[${i}].${metric}` }))
  if (!items.length) return null
  const title = { generation: { en: 'Hourly generation', bn: 'ঘণ্টাভিত্তিক উৎপাদন' }, demand: { en: 'Hourly demand', bn: 'ঘণ্টাভিত্তিক চাহিদা' }, loadShed: { en: 'Hourly load shedding', bn: 'ঘণ্টাভিত্তিক লোডশেডিং' } }[metric]
  return { id: `hourly:${metric}`, title, unit: 'MW', items, isoDate: day.isoDate, dateLabel: day.dateLabel }
}

/** The card's source line: "Source: esbpowerline.com Grid data, <date as the file states it>". */
export const gridSourceLine = (dateLabel: string) => `Source: esbpowerline.com Grid data, ${dateLabel}`
