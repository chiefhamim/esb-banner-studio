// Mini charts for data cards (Canvas 2D, ESB palette): horizontal bars, a line, a donut. They grow with an eased
// progress; at progress 1 every bar, point and arc is at its exact value and every value label shows the exact
// source string (formatExact). Values are drawn as given — no rounding here.

import { ease, type Easing } from './easing'
import { ESB_STRIPES, fontFor } from './brand'
import { cssFont, type Measurer } from './layout'
import { formatExact, type NumberFormat } from './numbers'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** Chart colours: the ESB stripes first, then the category palette (CLAUDE.md §6). */
export const ESB_CHART_PALETTE = [ESB_STRIPES[0], ESB_STRIPES[2], '#2979FF', ESB_STRIPES[1], '#7C4DFF', '#00E5FF', '#E040FB', '#FFEA00', '#00E676'] as const

export interface ChartItem { label: string; value: number; color?: string }

export interface ChartSpec {
  kind: 'bar' | 'line' | 'donut'
  items: ChartItem[]
  unit: string
  /** Growth animation (element-local seconds). */
  grow?: { delay?: number; duration: number; easing?: Easing }
  /** One colour for every bar / the line (e.g. the category accent); else the palette per item. */
  accent?: string
  /** Use each item's own `color` (e.g. the site's fuel colours) when it has one. */
  itemColors?: boolean
  format?: NumberFormat
  /** Text colour. */
  ink?: string
  /** Base type size in px. */
  size: number
  /** Show "(derived)" after the unit. */
  derived?: boolean
}

export function chartProgress(spec: ChartSpec, t: number): number {
  if (!spec.grow) return 1
  const d = spec.grow.duration
  return d <= 0 ? 1 : ease(spec.grow.easing ?? 'esb', (t - (spec.grow.delay ?? 0)) / d)
}

const colorOf = (spec: ChartSpec, i: number) => (spec.itemColors && spec.items[i].color) || spec.accent || ESB_CHART_PALETTE[i % ESB_CHART_PALETTE.length]

/** The value labels a chart shows at its end: exact source strings. */
export const chartValueLabels = (spec: ChartSpec) => spec.items.map((it) => formatExact(it.value, spec.format))

const fontsOf = (spec: ChartSpec) => ({
  labelFont: fontFor(spec.items.map((i) => i.label).join(' '), 'body', Math.round(spec.size * 0.8)),
  valueFont: fontFor('0', 'label', Math.round(spec.size * 0.8)),
})

/** "19:30" → minutes since midnight; null when a label is not a clock time. */
export function clockMinutes(label: string): number | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(label)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** x positions (0..1) of a line chart's points: by the actual clock time when every label is a time in order (a 19:30
 * row between 19:00 and 20:00 sits halfway, not a whole slot), else evenly by index. */
export function linePositions(labels: string[]): number[] {
  const n = labels.length
  if (n <= 1) return labels.map(() => 0.5)
  const mins = labels.map(clockMinutes)
  if (mins.every((m): m is number => m !== null) && mins.every((m, i) => i === 0 || m > (mins[i - 1] as number))) {
    const lo = mins[0] as number, hi = mins[n - 1] as number
    return mins.map((m) => ((m as number) - lo) / (hi - lo))
  }
  return labels.map((_, i) => i / (n - 1))
}

/** A donut's legend rows (a zero is left out: it has no arc and no colour to explain) and where things sit. The value
 * stands right after its label, in one column. */
export function donutMetrics(spec: ChartSpec, rect: { w: number; h: number }, measure: Measurer) {
  const { labelFont, valueFont } = fontsOf(spec)
  const values = chartValueLabels(spec)
  const rows = spec.items.map((it, i) => ({ it, i })).filter(({ it }) => it.value !== 0)
  const labelW = Math.max(0, ...rows.map(({ it }) => measure(it.label, labelFont)))
  const valueW = Math.max(0, ...rows.map(({ i }) => measure(values[i], valueFont)))
  const rowsW = spec.size + labelW + spec.size * 0.6 + valueW
  const rMax = Math.min(rect.h / 2, rect.w * 0.24)
  const rFit = (rect.w - rowsW - spec.size) / 2
  const r = Math.min(rMax, Math.max(rect.h * 0.2, rFit))
  const lx = r * 2 + spec.size
  const rowH = Math.min(spec.size * 1.5, rect.h / Math.max(1, rows.length))
  return { r, lx, rowH, rows, labelW, valueW, values, labelFont, valueFont, fits: lx + rowsW <= rect.w + 0.5 && rowH >= spec.size * 0.95 }
}

/** Null when the chart's labels and values fit in `rect` at their sizes; else why not (nothing is cut or shrunk below
 * the chart's own size silently). */
export function chartFit(rect: { w: number; h: number }, spec: ChartSpec, measure: Measurer): string | null {
  const { labelFont, valueFont } = fontsOf(spec)
  const values = chartValueLabels(spec)
  if (spec.kind === 'bar') {
    const rowH = rect.h / Math.max(1, spec.items.length)
    const labelW = Math.max(...spec.items.map((i) => measure(i.label, labelFont))) + spec.size * 0.6
    const valueW = Math.max(...values.map((v) => measure(v, valueFont))) + spec.size * 0.5
    if (rowH < spec.size * 1.1) return 'too many rows for the chart at this size'
    if (labelW + valueW > rect.w * 0.8) return 'labels and values are too wide for the chart'
  } else if (spec.kind === 'donut') {
    if (!donutMetrics(spec, rect, measure).fits) return 'the legend does not fit beside the donut'
  }
  return null
}

export function drawChart(ctx: Ctx, rect: { x: number; y: number; w: number; h: number }, spec: ChartSpec, t: number, measure: Measurer): void {
  const p = chartProgress(spec, t)
  const ink = spec.ink ?? '#f4f4f5'
  const { labelFont, valueFont } = fontsOf(spec)
  ctx.save()
  ctx.translate(rect.x, rect.y)
  ctx.textBaseline = 'middle'
  const values = chartValueLabels(spec)
  if (spec.kind === 'bar') {
    const n = spec.items.length
    const max = Math.max(0, ...spec.items.map((i) => i.value))
    const labelW = Math.min(rect.w * 0.45, Math.max(...spec.items.map((i) => measure(i.label, labelFont))) + spec.size * 0.6)
    const valueW = Math.max(...values.map((v) => measure(v, valueFont))) + spec.size * 0.5
    const rowH = rect.h / Math.max(1, n)
    const barH = Math.min(rowH * 0.62, spec.size * 1.1)
    const trackW = Math.max(0, rect.w - labelW - valueW)
    spec.items.forEach((it, i) => {
      const cy = i * rowH + rowH / 2
      ctx.font = cssFont(labelFont); ctx.fillStyle = ink; ctx.globalAlpha = 0.86; ctx.textAlign = 'left'
      ctx.fillText(it.label, 0, cy)
      ctx.globalAlpha = 0.14; ctx.fillStyle = ink
      ctx.fillRect(labelW, cy - barH / 2, trackW, barH)
      ctx.globalAlpha = 1; ctx.fillStyle = colorOf(spec, i)
      const bw = max > 0 ? (trackW * Math.max(0, it.value) / max) * p : 0
      ctx.fillRect(labelW, cy - barH / 2, bw, barH)
      ctx.globalAlpha = p; ctx.fillStyle = ink; ctx.font = cssFont(valueFont); ctx.textAlign = 'right'
      ctx.fillText(values[i], rect.w, cy)
    })
  } else if (spec.kind === 'line') {
    const n = spec.items.length
    const vals = spec.items.map((i) => i.value)
    const lo = Math.min(...vals), hi = Math.max(...vals)
    const span = hi - lo || 1
    const top = spec.size * 1.2, bottom = rect.h - spec.size * 1.4
    const pos = linePositions(spec.items.map((i) => i.label))
    const xs = (i: number) => rect.w * pos[i]
    const ys = (v: number) => bottom - ((v - lo) / span) * (bottom - top)
    const upto = (n - 1) * p
    ctx.strokeStyle = spec.accent ?? ESB_CHART_PALETTE[0]
    ctx.lineWidth = Math.max(2, spec.size * 0.14)
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      if (i > upto) {
        const a = Math.floor(upto), f = upto - a
        if (a + 1 < n) ctx.lineTo(xs(a) + (xs(a + 1) - xs(a)) * f, ys(vals[a]) + (ys(vals[a + 1]) - ys(vals[a])) * f)
        break
      }
      if (i === 0) ctx.moveTo(xs(0), ys(vals[0])); else ctx.lineTo(xs(i), ys(vals[i]))
    }
    ctx.stroke()
    // first and last labels, and the highest point with its exact value, once drawn
    ctx.font = cssFont(labelFont); ctx.fillStyle = ink; ctx.globalAlpha = 0.8
    ctx.textAlign = 'left'; ctx.fillText(spec.items[0].label, 0, rect.h - spec.size * 0.5)
    ctx.textAlign = 'right'; ctx.fillText(spec.items[n - 1].label, rect.w, rect.h - spec.size * 0.5)
    const iMax = vals.indexOf(hi)
    if (p >= 1 || iMax <= upto) {
      ctx.globalAlpha = 1; ctx.fillStyle = spec.accent ?? ESB_CHART_PALETTE[0]
      ctx.beginPath(); ctx.arc(xs(iMax), ys(hi), spec.size * 0.22, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = ink; ctx.font = cssFont(valueFont)
      ctx.textAlign = xs(iMax) > rect.w * 0.7 ? 'right' : xs(iMax) < rect.w * 0.3 ? 'left' : 'center'
      ctx.fillText(`${values[iMax]} ${spec.unit} · ${spec.items[iMax].label}`, xs(iMax), ys(hi) - spec.size * 0.7)
    }
  } else {
    const total = spec.items.reduce((a, i) => a + Math.max(0, i.value), 0)
    const m = donutMetrics(spec, rect, measure)
    const r = m.r
    const cx = r, cy = rect.h / 2
    const thick = r * 0.36
    let a0 = -Math.PI / 2
    ctx.lineWidth = thick
    spec.items.forEach((it, i) => {
      if (total <= 0 || it.value <= 0) return
      const a1 = a0 + (Math.PI * 2 * it.value / total) * p
      ctx.strokeStyle = colorOf(spec, i)
      ctx.beginPath(); ctx.arc(cx, cy, r - thick / 2, a0, a1); ctx.stroke()
      a0 = a1
    })
    // legend: swatch, label, then its exact value right after it (one column); zero rows are left out
    const y0 = cy - (m.rowH * m.rows.length) / 2 + m.rowH / 2
    const vx = m.lx + spec.size + m.labelW + spec.size * 0.6
    m.rows.forEach(({ it, i }, k) => {
      const y = y0 + k * m.rowH
      ctx.globalAlpha = 1; ctx.fillStyle = colorOf(spec, i)
      ctx.fillRect(m.lx, y - spec.size * 0.3, spec.size * 0.6, spec.size * 0.6)
      ctx.fillStyle = ink; ctx.font = cssFont(labelFont); ctx.textAlign = 'left'; ctx.globalAlpha = 0.86
      ctx.fillText(it.label, m.lx + spec.size, y)
      ctx.globalAlpha = p; ctx.font = cssFont(valueFont)
      ctx.fillText(values[i], vx, y)
    })
  }
  ctx.restore()
}
