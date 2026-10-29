// src/outreach/charts.tsx
// Token-tracked, accessible SVG charts for the Activity Desk (§3.3).
// Strictly uses CSS variables for all colours — no literal hex/rgb strings.

import { useState } from 'react'
import { Switch } from '../ui/controls'

export interface BarSeriesItem {
  key: string
  label: string
  colorVar: string
}

export interface BarDatum {
  label: string
  tooltip?: string
  [key: string]: number | string | undefined
}

export interface BarChartProps {
  title?: string
  summary?: string
  data: BarDatum[]
  series: BarSeriesItem[]
  stacked?: boolean
  height?: number
  band?: { fromIndex: number; toIndex: number; label?: string }
  rule?: { value: number; label?: string }
  lineSeries?: { key: string; label: string; colorVar: string }
  emptyText?: string
  rows?: Array<Record<string, string | number>>
}

export function BarChart({
  title,
  summary,
  data = [],
  series = [],
  stacked = false,
  height = 180,
  band,
  rule,
  lineSeries,
  emptyText = 'Nothing sent in this range.',
  rows,
}: BarChartProps) {
  const [showTable, setShowTable] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)

  const n = data.length
  const totalCount = data.reduce((sum, d) => {
    let s = 0
    for (const ser of series) {
      s += typeof d[ser.key] === 'number' ? (d[ser.key] as number) : 0
    }
    return sum + s
  }, 0)

  if (n === 0 || totalCount === 0) {
    return (
      <div className="oa-chart-box" role="region" aria-label={title || 'Chart'}>
        {title && <div className="oa-chart-head">{title}</div>}
        {summary && <div className="oa-chart-summary">{summary}</div>}
        <div className="oa-chart-empty">{emptyText}</div>
      </div>
    )
  }

  // Calculate scales
  let maxValue = 1
  for (const d of data) {
    if (stacked) {
      let stackSum = 0
      for (const ser of series) {
        stackSum += typeof d[ser.key] === 'number' ? (d[ser.key] as number) : 0
      }
      if (stackSum > maxValue) maxValue = stackSum
    } else {
      for (const ser of series) {
        const v = typeof d[ser.key] === 'number' ? (d[ser.key] as number) : 0
        if (v > maxValue) maxValue = v
      }
    }
  }

  if (rule && rule.value > maxValue) {
    maxValue = rule.value * 1.1
  }

  const paddingLeft = 32
  const paddingRight = 16
  const paddingTop = 20
  const paddingBottom = 28
  const chartWidth = 560
  const chartHeight = height
  const plotWidth = chartWidth - paddingLeft - paddingRight
  const plotHeight = chartHeight - paddingTop - paddingBottom

  const stepX = plotWidth / Math.max(1, n)
  const barWidth = Math.max(2, Math.min(24, (stepX * 0.7) / (stacked ? 1 : series.length)))

  const getY = (val: number) => {
    return paddingTop + plotHeight - (val / maxValue) * plotHeight
  }

  // Line points if lineSeries exists
  let linePoints = ''
  if (lineSeries) {
    let maxLineVal = 1
    for (const d of data) {
      const v = typeof d[lineSeries.key] === 'number' ? (d[lineSeries.key] as number) : 0
      if (v > maxLineVal) maxLineVal = v
    }
    linePoints = data
      .map((d, i) => {
        const x = paddingLeft + i * stepX + stepX / 2
        const v = typeof d[lineSeries.key] === 'number' ? (d[lineSeries.key] as number) : 0
        const y = paddingTop + plotHeight - (v / Math.max(1, maxLineVal)) * plotHeight
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  }

  // Support rows prop for accessible table
  const tableData = rows || data

  return (
    <div className="oa-chart-box" role="region" aria-label={title || 'Chart'}>
      {title && <div className="oa-chart-head">{title}</div>}
      {summary && <div className="oa-chart-summary">{summary}</div>}

      <div className="oa-chart-stage">
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="oa-svg-chart"
          role="img"
          aria-label={title || 'Chart graphic'}
        >
          {/* Soft send window band */}
          {band && (
            <rect
              x={paddingLeft + band.fromIndex * stepX}
              y={paddingTop}
              width={Math.max(0, (band.toIndex - band.fromIndex + 1) * stepX)}
              height={plotHeight}
              fill="var(--or-sent-soft)"
              className="oa-chart-band"
            >
              {band.label && <title>{band.label}</title>}
            </rect>
          )}

          {/* Grid lines */}
          <line
            x1={paddingLeft}
            y1={paddingTop + plotHeight}
            x2={chartWidth - paddingRight}
            y2={paddingTop + plotHeight}
            stroke="var(--border)"
            strokeWidth="1"
          />
          <line
            x1={paddingLeft}
            y1={paddingTop + plotHeight / 2}
            x2={chartWidth - paddingRight}
            y2={paddingTop + plotHeight / 2}
            stroke="var(--border)"
            strokeWidth="0.5"
            strokeDasharray="3 3"
          />

          {/* Cap rule line */}
          {rule && (
            <g className="oa-rule-line">
              <line
                x1={paddingLeft}
                y1={getY(rule.value)}
                x2={chartWidth - paddingRight}
                y2={getY(rule.value)}
                stroke="var(--danger)"
                strokeWidth="1.5"
                strokeDasharray="4 3"
              />
              {rule.label && (
                <text
                  x={chartWidth - paddingRight}
                  y={getY(rule.value) - 4}
                  textAnchor="end"
                  fill="var(--danger)"
                  fontSize="10"
                >
                  {rule.label}
                </text>
              )}
            </g>
          )}

          {/* Bars */}
          {data.map((d, i) => {
            const groupX = paddingLeft + i * stepX
            const barCenterX = groupX + stepX / 2

            if (stacked) {
              let currentBottom = 0
              return (
                <g
                  key={d.label || i}
                  className={`oa-bar-group ${focusedIndex === i ? 'focused' : ''}`}
                  tabIndex={0}
                  role="graphics-symbol"
                  aria-label={d.tooltip || `${d.label}: ${totalCount}`}
                  onFocus={() => setFocusedIndex(i)}
                  onBlur={() => setFocusedIndex(null)}
                >
                  <title>{d.tooltip || `${d.label}`}</title>
                  {series.map((ser) => {
                    const val = typeof d[ser.key] === 'number' ? (d[ser.key] as number) : 0
                    if (val <= 0) return null
                    const barHeight = (val / maxValue) * plotHeight
                    const y = paddingTop + plotHeight - ((currentBottom + val) / maxValue) * plotHeight
                    currentBottom += val

                    return (
                      <rect
                        key={ser.key}
                        x={barCenterX - barWidth / 2}
                        y={y}
                        width={barWidth}
                        height={Math.max(1, barHeight)}
                        rx="1"
                        fill={ser.colorVar}
                      />
                    )
                  })}
                </g>
              )
            }

            // Grouped bars
            const totalGroupWidth = series.length * barWidth
            const startX = barCenterX - totalGroupWidth / 2
            return (
              <g
                key={d.label || i}
                className={`oa-bar-group ${focusedIndex === i ? 'focused' : ''}`}
                tabIndex={0}
                role="graphics-symbol"
                aria-label={d.tooltip || d.label}
                onFocus={() => setFocusedIndex(i)}
                onBlur={() => setFocusedIndex(null)}
              >
                <title>{d.tooltip || d.label}</title>
                {series.map((ser, sIdx) => {
                  const val = typeof d[ser.key] === 'number' ? (d[ser.key] as number) : 0
                  const barHeight = (val / maxValue) * plotHeight
                  const y = paddingTop + plotHeight - barHeight
                  const x = startX + sIdx * barWidth

                  return (
                    <rect
                      key={ser.key}
                      x={x}
                      y={y}
                      width={barWidth - 1}
                      height={Math.max(1, barHeight)}
                      rx="1"
                      fill={ser.colorVar}
                    />
                  )
                })}
              </g>
            )
          })}

          {/* Line overlay */}
          {lineSeries && linePoints && (
            <polyline
              points={linePoints}
              fill="none"
              stroke={lineSeries.colorVar}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* X axis labels (sparse if many items) */}
          {data.map((d, i) => {
            const skip = n > 16 ? i % 4 !== 0 : n > 8 ? i % 2 !== 0 : false
            if (skip && i !== 0 && i !== n - 1) return null
            const x = paddingLeft + i * stepX + stepX / 2
            return (
              <text
                key={i}
                x={x}
                y={chartHeight - 8}
                textAnchor="middle"
                fill="var(--muted)"
                fontSize="10"
              >
                {d.label}
              </text>
            )
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="oa-chart-legend">
        {series.map((ser) => (
          <div key={ser.key} className="oa-legend-item">
            <span className="oa-legend-dot" style={{ backgroundColor: ser.colorVar }} />
            <span className="oa-legend-label">{ser.label}</span>
          </div>
        ))}
        {lineSeries && (
          <div className="oa-legend-item">
            <span className="oa-legend-line" style={{ borderColor: lineSeries.colorVar }} />
            <span className="oa-legend-label">{lineSeries.label}</span>
          </div>
        )}
      </div>

      {/* Show as table switch */}
      <div className="oa-table-switch-row">
        <label className="oa-table-toggle">
          <Switch checked={showTable} onChange={setShowTable} label="Show as table" />
        </label>
      </div>

      {/* Accessible Table representation */}
      {showTable && (
        <div className="oa-chart-table-wrap">
          <table className="oa-chart-table" aria-label={title || 'Chart data table'}>
            <thead>
              <tr>
                <th>Time / Date</th>
                {series.map((s) => (
                  <th key={s.key}>{s.label}</th>
                ))}
                {lineSeries && <th>{lineSeries.label}</th>}
              </tr>
            </thead>
            <tbody>
              {tableData.map((d, i) => (
                <tr key={i}>
                  <td>{d.label}</td>
                  {series.map((s) => (
                    <td key={s.key}>{typeof d[s.key] === 'number' ? (d[s.key] as number).toLocaleString() : d[s.key] ?? 0}</td>
                  ))}
                  {lineSeries && (
                    <td>
                      {typeof d[lineSeries.key] === 'number'
                        ? (d[lineSeries.key] as number).toLocaleString()
                        : d[lineSeries.key] ?? 0}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
