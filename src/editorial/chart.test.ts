import { describe, expect, it } from 'vitest'
import { chartAlt, parseChartData } from './chart'

describe('parseChartData', () => {
  it('reads label, number rows and a header line', () => {
    const r = parseChartData('Year, Output\n2023, 15.8\n2024, 16.9')
    expect(r.error).toBeUndefined()
    expect(r.labels).toEqual(['2023', '2024'])
    expect(r.series).toEqual([{ name: 'Output', values: [15.8, 16.9] }])
  })
  it('reads tab-separated Excel rows with several series and thousands separators', () => {
    const r = parseChartData('Month\tA\tB\nJan\t1,200\t3\nFeb\t900\t4')
    expect(r.series.map((s) => s.values)).toEqual([[1200, 900], [3, 4]])
    expect(r.series.map((s) => s.name)).toEqual(['A', 'B'])
  })
  it('explains a bad number and too few rows', () => {
    expect(parseChartData('a, 1\nb, x').error).toMatch(/not a number/)
    expect(parseChartData('a, 1').error).toMatch(/at least two/)
    expect(parseChartData('').error).toBeTruthy()
  })
})

describe('chartAlt', () => {
  it('spells out the numbers for screen readers', () => {
    const alt = chartAlt({ type: 'bar', title: 'Gas output', unit: 'MMCFD', labels: ['2024', '2025'], series: [{ name: '', values: [16.9, 18.4] }] })
    expect(alt).toBe('Bar chart — Gas output. 2024: 16.9 MMCFD; 2025: 18.4 MMCFD.')
  })
})
