// Charts for the story body. The site's article editor has no chart component, so a chart is drawn here, in the ESB type
// guideline (Inter, ink #2E1F1F, the story's category colour), and goes into the story as an uploaded picture with alt
// text that spells out the numbers. `ChartSpec` is plain data so the AI can fill one in later.

export type ChartType = 'bar' | 'hbar' | 'line' | 'pie'

export interface ChartSeries { name: string; values: number[] }
export interface ChartSpec {
  type: ChartType
  title: string
  subtitle?: string
  /** Printed after the numbers, e.g. "Tk", "%", "MW". */
  unit?: string
  source?: string
  labels: string[]
  series: ChartSeries[]
}

export const CHART_W = 1600
export const CHART_H = 900
const INK = '#2E1F1F'
const MUTED = '#6b6370'
const GRID = '#e7e3dc'
const BG = '#ffffff'
/** After the category colour: the guideline's other category hues, so a second series never looks like the first. */
const EXTRA = ['#0EA5E9', '#F59E0B', '#10B981', '#EC4899', '#6366F1', '#14B8A6', '#EF4444', '#8A1820']

export const MAX_ROWS = 24

const num = (t: string): number | null => {
  const c = t.replace(/[,\s৳$%]|Tk/gi, '').replace(/[−–]/g, '-')
  if (!c || !/^-?\d*\.?\d+$/.test(c)) return null
  return Number(c)
}

/** Read pasted data: one row per line, label then one or more numbers, separated by tab, comma or semicolon. A first line without numbers names the series. */
export function parseChartData(text: string): { labels: string[]; series: ChartSeries[]; error?: string } {
  const rows = text.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => (l.includes('\t') ? l.split('\t') : l.includes(';') ? l.split(';') : l.split(',')).map((c) => c.trim()))
  if (!rows.length) return { labels: [], series: [], error: 'Add at least two rows: a label, then a number.' }
  let header: string[] | null = null
  if (rows[0].slice(1).some((c) => c) && rows[0].slice(1).every((c) => num(c) === null) && rows.length > 1) header = rows.shift() ?? null
  const cols = Math.max(...rows.map((r) => r.length)) - 1
  if (cols < 1) return { labels: [], series: [], error: 'Each row needs a label and a number, like “2025, 18.4”.' }
  const labels: string[] = []
  const series: ChartSeries[] = Array.from({ length: Math.min(cols, 4) }, (_, i) => ({ name: header?.[i + 1] || (cols > 1 ? `Series ${i + 1}` : ''), values: [] }))
  for (const r of rows) {
    labels.push(r[0] || '')
    for (let i = 0; i < series.length; i++) {
      const v = num(r[i + 1] ?? '')
      if (v === null) return { labels: [], series: [], error: `“${r[i + 1] ?? ''}” on the row “${r[0]}” is not a number.` }
      series[i].values.push(v)
    }
  }
  if (labels.length < 2) return { labels, series, error: 'Add at least two rows.' }
  if (labels.length > MAX_ROWS) return { labels, series, error: `Use ${MAX_ROWS} rows or fewer so the chart stays readable.` }
  return { labels, series }
}

const fmt = (v: number, unit = '') => {
  const a = Math.abs(v)
  const s = a >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 1 }) : String(Math.round(v * 100) / 100)
  return unit === '%' || unit === 'Tk' ? (unit === '%' ? `${s}%` : `Tk ${s}`) : unit ? `${s} ${unit}` : s
}

/** Round the axis maximum up to a tidy number and return ticks from min to max. */
function niceScale(min: number, max: number): { lo: number; hi: number; ticks: number[] } {
  const lo = Math.min(0, min), hi0 = Math.max(0, max) || 1
  const span = hi0 - lo
  const step0 = Math.pow(10, Math.floor(Math.log10(span / 4)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * step0).find((s) => span / s <= 5) ?? step0 * 10
  const hi = Math.ceil(hi0 / step) * step
  const l = Math.floor(lo / step) * step
  const ticks: number[] = []
  for (let t = l; t <= hi + step / 2; t += step) ticks.push(Math.round(t * 1e6) / 1e6)
  return { lo: l, hi, ticks }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w } else cur = t
  }
  if (cur) lines.push(cur)
  return lines
}

const font = (w: number, px: number) => `${w} ${px}px "ESB Sans", Inter, system-ui, sans-serif`

/** Spell the chart out for screen readers and search: the alt text. */
export function chartAlt(spec: ChartSpec): string {
  const kind = { bar: 'Bar chart', hbar: 'Bar chart', line: 'Line chart', pie: 'Pie chart' }[spec.type]
  const body = spec.labels.map((l, i) => `${l}: ${spec.series.map((s) => fmt(s.values[i], spec.unit)).join(' / ')}`).join('; ')
  return `${kind}${spec.title ? ` — ${spec.title}` : ''}. ${spec.series.length > 1 ? spec.series.map((s) => s.name).join(' / ') + '. ' : ''}${body}.`.slice(0, 480)
}

export function renderChart(spec: ChartSpec, accent: string): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = CHART_W; c.height = CHART_H
  const ctx = c.getContext('2d')!
  ctx.fillStyle = BG; ctx.fillRect(0, 0, CHART_W, CHART_H)
  const colors = [accent, ...EXTRA.filter((x) => x.toLowerCase() !== accent.toLowerCase())]
  const M = 56
  ctx.fillStyle = accent; ctx.fillRect(0, 0, CHART_W, 12)

  // headline (Extra Bold 800, 118% leading, sentence case) and the unit/subtitle line
  let y = 40 + 12
  ctx.textBaseline = 'top'; ctx.textAlign = 'left'
  ctx.font = font(800, 46); ctx.fillStyle = INK
  const title = wrap(ctx, spec.title || 'Chart', CHART_W - 2 * M).slice(0, 2)
  for (const l of title) { ctx.fillText(l, M, y); y += 54 }
  const sub = [spec.subtitle, spec.unit && spec.unit !== '%' ? `in ${spec.unit}` : ''].filter(Boolean).join(' · ')
  if (sub) { ctx.font = font(500, 26); ctx.fillStyle = MUTED; ctx.fillText(sub, M, y + 6); y += 40 }
  y += 16

  // footer: source and the site
  const footY = CHART_H - 52
  ctx.font = font(500, 22); ctx.fillStyle = MUTED; ctx.textBaseline = 'alphabetic'
  ctx.fillText(spec.source ? `Source: ${spec.source}` : '', M, footY + 24)
  ctx.textAlign = 'right'; ctx.font = font(700, 22); ctx.fillStyle = INK; ctx.fillText('ESB Power Line · esbpowerline.com', CHART_W - M, footY + 24)
  ctx.textAlign = 'left'
  const legendNeeded = spec.series.length > 1 && spec.type !== 'pie'
  if (legendNeeded) {
    let lx = M
    ctx.font = font(700, 24)
    for (let i = 0; i < spec.series.length; i++) {
      ctx.fillStyle = colors[i]; ctx.fillRect(lx, y + 4, 22, 22)
      ctx.fillStyle = INK; ctx.fillText(spec.series[i].name, lx + 32, y + 24)
      lx += 32 + ctx.measureText(spec.series[i].name).width + 40
    }
    y += 48
  }
  const top = y, bottom = footY - 24, left = M, right = CHART_W - M
  ctx.textBaseline = 'alphabetic'
  const n = spec.labels.length

  if (spec.type === 'pie') {
    const vals = spec.series[0].values.map((v) => Math.max(0, v))
    const total = vals.reduce((a, b) => a + b, 0) || 1
    const r = Math.min((bottom - top) / 2, 300)
    const cx = left + r + 40, cy = (top + bottom) / 2
    let a = -Math.PI / 2
    vals.forEach((v, i) => {
      const da = (v / total) * Math.PI * 2
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a, a + da); ctx.closePath()
      ctx.fillStyle = colors[i % colors.length]; ctx.fill(); ctx.strokeStyle = BG; ctx.lineWidth = 4; ctx.stroke()
      a += da
    })
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2); ctx.fillStyle = BG; ctx.fill()
    ctx.textAlign = 'center'; ctx.fillStyle = INK; ctx.font = font(800, 44); ctx.fillText(fmt(total, spec.unit), cx, cy + 10)
    ctx.font = font(500, 22); ctx.fillStyle = MUTED; ctx.fillText('total', cx, cy + 40); ctx.textAlign = 'left'
    const rowH = Math.min(52, (bottom - top) / n)
    let ly = cy - (rowH * n) / 2 + rowH * 0.7
    const lx = cx + r + 90
    vals.forEach((v, i) => {
      ctx.fillStyle = colors[i % colors.length]; ctx.fillRect(lx, ly - 22, 26, 26)
      ctx.fillStyle = INK; ctx.font = font(700, 28); ctx.fillText(spec.labels[i], lx + 42, ly)
      ctx.textAlign = 'right'; ctx.font = font(800, 28); ctx.fillText(`${fmt(v, spec.unit)}  ·  ${Math.round((v / total) * 100)}%`, right, ly); ctx.textAlign = 'left'
      ly += rowH
    })
    return c
  }

  const all = spec.series.flatMap((s) => s.values)
  const { lo, hi, ticks } = niceScale(Math.min(...all), Math.max(...all))
  const horizontal = spec.type === 'hbar'

  if (horizontal) {
    ctx.font = font(500, 26)
    const lw = Math.min(380, Math.max(...spec.labels.map((l) => ctx.measureText(l).width)) + 24)
    const x0 = left + lw, x1 = right - 90
    const X = (v: number) => x0 + ((v - lo) / (hi - lo)) * (x1 - x0)
    ticks.forEach((t) => { ctx.strokeStyle = GRID; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X(t), top); ctx.lineTo(X(t), bottom - 34); ctx.stroke(); ctx.fillStyle = MUTED; ctx.textAlign = 'center'; ctx.font = font(500, 22); ctx.fillText(fmt(t, spec.unit === '%' ? '%' : ''), X(t), bottom - 6) })
    ctx.textAlign = 'left'
    const bandH = (bottom - 34 - top) / n
    const bh = Math.min(48, (bandH * 0.7) / spec.series.length)
    spec.labels.forEach((l, i) => {
      const by = top + i * bandH + (bandH - bh * spec.series.length) / 2
      ctx.fillStyle = INK; ctx.font = font(500, 26); ctx.textAlign = 'right'; ctx.fillText(l, x0 - 16, by + bh * spec.series.length / 2 + 9); ctx.textAlign = 'left'
      spec.series.forEach((s, k) => {
        const v = s.values[i]
        ctx.fillStyle = colors[k]; ctx.fillRect(Math.min(X(0), X(v)), by + k * bh, Math.abs(X(v) - X(0)), bh - 4)
        ctx.fillStyle = INK; ctx.font = font(800, 24); ctx.fillText(fmt(v, spec.unit), Math.max(X(0), X(v)) + 10, by + k * bh + bh / 2 + 6)
      })
    })
    return c
  }

  // vertical bar / line share axes
  ctx.font = font(500, 22)
  const yl = Math.max(...ticks.map((t) => ctx.measureText(fmt(t, spec.unit === '%' ? '%' : '')).width)) + 16
  const x0 = left + yl, x1 = right
  const Y = (v: number) => bottom - 56 - ((v - lo) / (hi - lo)) * (bottom - 56 - top - 24)
  ticks.forEach((t) => { ctx.strokeStyle = t === 0 ? INK : GRID; ctx.lineWidth = t === 0 ? 3 : 2; ctx.beginPath(); ctx.moveTo(x0, Y(t)); ctx.lineTo(x1, Y(t)); ctx.stroke(); ctx.fillStyle = MUTED; ctx.textAlign = 'right'; ctx.fillText(fmt(t, spec.unit === '%' ? '%' : ''), x0 - 14, Y(t) + 8) })
  ctx.textAlign = 'center'
  const bandW = (x1 - x0) / n
  const labelSize = bandW < 90 ? 18 : bandW < 140 ? 22 : 26
  ctx.font = font(500, labelSize)
  spec.labels.forEach((l, i) => {
    const text = ctx.measureText(l).width > bandW - 6 ? l.slice(0, Math.max(3, Math.floor((bandW - 6) / (labelSize * 0.55)))) + '…' : l
    ctx.fillStyle = INK; ctx.fillText(text, x0 + bandW * (i + 0.5), bottom - 18)
  })
  if (spec.type === 'bar') {
    const bw = Math.min(110, (bandW * 0.72) / spec.series.length)
    spec.series.forEach((s, k) => s.values.forEach((v, i) => {
      const cx = x0 + bandW * (i + 0.5) - (bw * spec.series.length) / 2 + k * bw
      ctx.fillStyle = colors[k]; ctx.fillRect(cx, Math.min(Y(v), Y(0)), bw - 4, Math.abs(Y(v) - Y(0)))
      ctx.fillStyle = INK; ctx.font = font(800, bandW < 110 ? 18 : 24); ctx.fillText(fmt(v, spec.unit), cx + (bw - 4) / 2, (v >= 0 ? Y(v) - 12 : Y(v) + 30))
    }))
  } else {
    spec.series.forEach((s, k) => {
      ctx.strokeStyle = colors[k]; ctx.lineWidth = 6; ctx.lineJoin = 'round'; ctx.beginPath()
      s.values.forEach((v, i) => { const px = x0 + bandW * (i + 0.5); if (i) ctx.lineTo(px, Y(v)); else ctx.moveTo(px, Y(v)) })
      ctx.stroke()
      s.values.forEach((v, i) => {
        const px = x0 + bandW * (i + 0.5)
        ctx.beginPath(); ctx.arc(px, Y(v), 9, 0, Math.PI * 2); ctx.fillStyle = BG; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = colors[k]; ctx.stroke()
        if (n <= 14) { ctx.fillStyle = INK; ctx.font = font(800, 22); ctx.fillText(fmt(v, spec.unit), px, Y(v) - 20) }
      })
    })
  }
  return c
}

export const chartToBlob = (spec: ChartSpec, accent: string): Promise<Blob> =>
  new Promise((resolve, reject) => renderChart(spec, accent).toBlob((b) => (b ? resolve(b) : reject(new Error('The chart could not be drawn.'))), 'image/png'))

const BN_DIGITS = '০১২৩৪৫৬৭৮৯'
const asciiDigits = (s: string) => s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)))

/** Every number written in the source, as plain numbers (commas and Bengali digits normalised). */
function sourceNumbers(text: string): Set<number> {
  const out = new Set<number>()
  for (const m of asciiDigits(text).matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ''))
    if (Number.isFinite(n)) out.add(n)
  }
  return out
}

const TYPES: ChartType[] = ['bar', 'hbar', 'line', 'pie']

/**
 * The AI's chart ideas (JSON text) → charts that are safe to offer. A chart is kept only when it is well formed and every
 * number in it is a number the source article itself prints: the AI may choose what to chart, never invent or work out a value.
 */
export function validateChartIdeas(json: string, sourceText: string): ChartSpec[] {
  let raw: unknown
  try { raw = JSON.parse(json || '[]') } catch { return [] }
  if (!Array.isArray(raw)) return []
  const known = sourceNumbers(sourceText)
  const out: ChartSpec[] = []
  for (const r of raw.slice(0, 2)) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const type = TYPES.includes(o.type as ChartType) ? (o.type as ChartType) : 'bar'
    const labels = Array.isArray(o.labels) ? o.labels.map((l) => String(l).trim()).filter(Boolean) : []
    const series = (Array.isArray(o.series) ? o.series : []).slice(0, 3).map((s) => {
      const so = (s ?? {}) as Record<string, unknown>
      return { name: String(so.name ?? '').trim(), values: Array.isArray(so.values) ? so.values.map(Number) : [] }
    })
    const title = String(o.title ?? '').trim()
    if (!title || labels.length < 2 || labels.length > 12 || !series.length) continue
    if (series.some((s) => s.values.length !== labels.length || s.values.some((v) => !Number.isFinite(v)))) continue
    if (series.some((s) => s.values.some((v) => !known.has(Math.abs(v))))) continue
    out.push({ type, title: title.slice(0, 110), subtitle: o.subtitle ? String(o.subtitle).slice(0, 120) : undefined, unit: o.unit ? String(o.unit).slice(0, 16) : undefined, source: o.source ? String(o.source).slice(0, 80) : undefined, labels, series })
  }
  return out
}
