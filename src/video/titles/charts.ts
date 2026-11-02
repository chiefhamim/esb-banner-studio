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

export function drawChart(ctx: Ctx, rect: { x: number; y: number; w: number; h: number }, spec: ChartSpec, t: number, measure: Measurer): void {
  const p = chartProgress(spec, t)
  const ink = spec.ink ?? '#f4f4f5'
  const labelFont = fontFor(spec.items.map((i) => i.label).join(' '), 'body', Math.round(spec.size * 0.8))
  const valueFont = fontFor('0', 'label', Math.round(spec.size * 0.8))
  ctx.save()
  ctx.translate(rect.x, rect.y)
  ctx.textBaseline = 'middle'
  const values = chartValueLabels(spec)
  if (spec.kind === 'bar') {
    const n = spec.items.length
    const max = Math.max(0, ...spec.items.map((i) => i.value))
    const labelW = Math.min(rect.w * 0.34, Math.max(...spec.items.map((i) => measure(i.label, labelFont))) + spec.size * 0.6)
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
    const xs = (i: number) => (n <= 1 ? rect.w / 2 : (rect.w * i) / (n - 1))
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
    const r = Math.min(rect.h / 2, rect.w * 0.24)
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
    // legend: label and exact value
    const lx = r * 2 + spec.size
    const rowH = Math.min(spec.size * 1.5, rect.h / Math.max(1, spec.items.length))
    const y0 = cy - (rowH * spec.items.length) / 2 + rowH / 2
    spec.items.forEach((it, i) => {
      const y = y0 + i * rowH
      ctx.globalAlpha = 1; ctx.fillStyle = colorOf(spec, i)
      ctx.fillRect(lx, y - spec.size * 0.3, spec.size * 0.6, spec.size * 0.6)
      ctx.fillStyle = ink; ctx.font = cssFont(labelFont); ctx.textAlign = 'left'; ctx.globalAlpha = 0.86
      ctx.fillText(it.label, lx + spec.size, y)
      ctx.globalAlpha = p; ctx.font = cssFont(valueFont); ctx.textAlign = 'right'
      ctx.fillText(values[i], rect.w, y)
    })
  }
  ctx.restore()
}
