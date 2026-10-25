// Build a chart for the story: pick the kind, paste the numbers, see it drawn, insert. It is uploaded as a picture.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog, Field, Seg } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { parseChartData, renderChart } from './chart'
import type { ChartSpec, ChartType } from './chart'

const toText = (c: Partial<ChartSpec>) => (c.labels && c.series?.length ? [['Label', ...c.series.map((x, i) => x.name || `Series ${i + 1}`)].join(', '), ...c.labels.map((l, i) => [l, ...c.series!.map((x) => x.values[i])].join(', '))].join('\n') : '')
const SAMPLE = 'Year, Generation\n2022, 14.2\n2023, 15.8\n2024, 16.9\n2025, 18.4'

export function ChartDialog({ accent, initial, busy, error, onInsert, onClose }: { accent: string; initial?: Partial<ChartSpec>; busy: boolean; error: string | null; onInsert: (spec: ChartSpec) => void; onClose: () => void }) {
  const [type, setType] = useState<ChartType>(initial?.type ?? 'bar')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [subtitle, setSubtitle] = useState(initial?.subtitle ?? '')
  const [unit, setUnit] = useState(initial?.unit ?? '')
  const [source, setSource] = useState(initial?.source ?? '')
  const [data, setData] = useState(toText(initial ?? {}) || SAMPLE)
  const canvasRef = useRef<HTMLDivElement>(null)

  const parsed = useMemo(() => parseChartData(data), [data])
  const spec: ChartSpec | null = parsed.error || !title.trim() ? null : { type, title: title.trim(), subtitle: subtitle.trim() || undefined, unit: unit.trim() || undefined, source: source.trim() || undefined, labels: parsed.labels, series: type === 'pie' ? parsed.series.slice(0, 1) : parsed.series }

  useEffect(() => {
    const host = canvasRef.current
    if (!host) return
    let live = true
    void document.fonts.load('800 40px "ESB Sans"').then(() => document.fonts.load('500 20px "ESB Sans"')).then(() => {
      if (!live || !host) return
      const sample: ChartSpec = { type, title: title.trim() || 'Chart headline', unit: unit.trim() || undefined, labels: ['A', 'B', 'C', 'D'], series: [{ name: '', values: [3, 5, 4, 6] }] }
      const c = renderChart(spec ?? sample, accent)
      c.className = 'cd-canvas'
      host.replaceChildren(c)
    })
    return () => { live = false }
  }, [spec, parsed.error, type, title, unit, accent])

  return (
    <Dialog
      title="Chart for the story"
      kicker="BODY IMAGE"
      width={880}
      onClose={onClose}
      footer={
        <>
          <span className="hint">{error ?? 'The chart is drawn as a picture and uploaded to the site.'}</span>
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={!spec || busy} onClick={() => spec && onInsert(spec)}>
            <Icon name={busy ? 'refresh' : 'check'} size={14} className={busy ? 'spin' : ''} />
            <span>{busy ? 'Uploading…' : 'Insert chart'}</span>
          </button>
        </>
      }
    >
      <div className="cd">
        <div className="cd-form">
          <Seg<ChartType> value={type} onChange={setType} options={[{ value: 'bar', label: 'Columns' }, { value: 'hbar', label: 'Bars' }, { value: 'line', label: 'Line' }, { value: 'pie', label: 'Pie' }]} />
          <Field label="Headline"><input className="input" value={title} placeholder="Gas output rises 30% in three years" onChange={(e) => setTitle(e.target.value)} /></Field>
          <div className="cd-row">
            <Field label="Unit"><input className="input" value={unit} placeholder="MMCFD, Tk, %" onChange={(e) => setUnit(e.target.value)} /></Field>
            <Field label="Source"><input className="input" value={source} placeholder="Petrobangla" onChange={(e) => setSource(e.target.value)} /></Field>
          </div>
          <Field label="Subtitle (optional)"><input className="input" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} /></Field>
          <Field label="Numbers — one row each: label, then number(s). Paste from Excel works.">
            <textarea className="input cd-data" spellCheck={false} rows={7} value={data} onChange={(e) => setData(e.target.value)} />
          </Field>
          {parsed.error && <p className="hint cd-err">{parsed.error}</p>}
          {!title.trim() && !parsed.error && <p className="hint">Add a headline to enable Insert.</p>}
        </div>
        <div className="cd-prev" ref={canvasRef} aria-label="Chart preview" />
      </div>
    </Dialog>
  )
}
