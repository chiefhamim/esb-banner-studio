import { useEffect, useMemo, useRef, useState } from 'react'
import { FormatIcon } from './FormatPicker'
import type { Assets } from '../core/render'
import { FORMAT_LIST, getFormat } from '../core/tokens'
import type { FormatId } from '../core/types'
import { DEFAULT_SETTINGS, PRESETS, SCALE_CHOICES, copyToClipboard, dims, humanBytes, planJobs, preflight, runExport, tooBig } from '../export'
import type { ExportResult, ExportSettings, ExportType } from '../export'
import { useStore } from '../store'
import { Check, Chip, Dialog, Scrub, Slider } from '../ui/controls'
import { Icon } from '../ui/Icon'

const TOKENS = ['cat', 'category', 'date', 'format', 'ratio', 'w', 'h', 'scale', 'headline']
const TYPES: { id: ExportType; name: string; note: string }[] = [
  { id: 'png', name: 'PNG', note: 'Lossless · sharpest text' },
  { id: 'jpeg', name: 'JPG', note: 'Smaller · great for chat apps' },
  { id: 'webp', name: 'WebP', note: 'Smallest · modern browsers' },
]

export function ExportDialog({ base, settings, setSettings, onClose }: { base: Assets; settings: ExportSettings; setSettings: (s: ExportSettings) => void; onClose: () => void }) {
  const doc = useStore((s) => s.doc)
  const format = useStore((s) => s.format)
  const [running, setRunning] = useState<{ done: number; total: number; label: string } | null>(null)
  const [result, setResult] = useState<ExportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [customScale, setCustomScale] = useState(2.5)
  const [copied, setCopied] = useState(false)
  const cancel = useRef({ cancelled: false })
  const patternRef = useRef<HTMLInputElement>(null)
  const native = !!window.esb?.saveImage

  const s = settings
  const patch = (p: Partial<ExportSettings>) => setSettings({ ...s, ...p })
  const jobs = useMemo(() => planJobs(doc, s), [doc, s])
  const checks = useMemo(() => preflight(doc, s.formats), [doc, s.formats])
  const totalPx = jobs.reduce((a, j) => a + j.w * j.h, 0)
  const scaleChoices = [...new Set([...SCALE_CHOICES, ...s.scales])].sort((a, b) => a - b)

  const toggleScale = (v: number) => patch({ scales: s.scales.includes(v) ? s.scales.filter((x) => x !== v) : [...s.scales, v].sort((a, b) => a - b) })
  const toggleFormat = (f: FormatId) => patch({ formats: s.formats.includes(f) ? s.formats.filter((x) => x !== f) : [...s.formats, f] })
  const applyPreset = (id: string) => { const p = PRESETS.find((x) => x.id === id)!; setSettings({ ...s, ...p.settings }) }
  const activePreset = PRESETS.find((p) => Object.entries(p.settings).every(([k, v]) => JSON.stringify((s as unknown as Record<string, unknown>)[k]) === JSON.stringify(v)))?.id
  const insertToken = (t: string) => {
    const el = patternRef.current
    const at = el?.selectionStart ?? s.pattern.length
    patch({ pattern: s.pattern.slice(0, at) + `{${t}}` + s.pattern.slice(el?.selectionEnd ?? at) })
  }

  const go = async () => {
    setError(null); setResult(null)
    cancel.current = { cancelled: false }
    setRunning({ done: 0, total: jobs.length, label: 'Starting…' })
    try {
      const r = await runExport(doc, base, s, (done, total, label) => setRunning({ done, total, label }), cancel.current)
      setResult(r)
      if (native && s.openAfter && r.saved[0]) void window.esb?.reveal?.(r.saved[0])
      if (r.dir && r.dir !== s.dir) patch({ dir: r.dir })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(null)
    }
  }

  const pickFolder = async () => { const p = await window.esb?.pickFolder?.(); if (p) patch({ dir: p }) }
  const copy = async () => {
    try { await copyToClipboard(doc, format, base); setCopied(true); setTimeout(() => setCopied(false), 1800) }
    catch (e) { setError('Could not copy: ' + (e instanceof Error ? e.message : String(e))) }
  }

  useEffect(() => () => { cancel.current.cancelled = true }, [])

  return (
    <Dialog title="Export banners" kicker="Deliver" onClose={() => (running ? undefined : onClose())} width={940}
      footer={
        <>
          <button className="btn" onClick={copy} title={`Copy the current ${getFormat(format).name} banner (PNG, 1×) to the clipboard`}><Icon name={copied ? 'check' : 'copy'} size={15} />{copied ? 'Copied' : 'Copy image'}</button>
          <div className="spacer" />
          {running ? (
            <button className="btn" onClick={() => { cancel.current.cancelled = true }}>Cancel</button>
          ) : (
            <>
              <button className="btn ghost" onClick={onClose}>{result ? 'Close' : 'Cancel'}</button>
              <button className="btn primary" disabled={!jobs.length} onClick={go}><Icon name="download" size={15} />{result ? 'Export again' : `Export ${jobs.length} file${jobs.length === 1 ? '' : 's'}${s.zip ? ' as ZIP' : ''}`}</button>
            </>
          )}
        </>
      }>
      <div className="ex-grid">
        <div className="ex-main">
          <div className="ex-sec">
            <div className="ex-title">Presets</div>
            <div className="ex-presets">
              {PRESETS.map((p) => (
                <button key={p.id} type="button" className={'preset' + (activePreset === p.id ? ' on' : '')} onClick={() => applyPreset(p.id)}>
                  <b>{p.label}</b><span>{p.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="ex-sec">
            <div className="ex-title">Banners</div>
            <div className="ex-cards">
              {FORMAT_LIST.map((c) => {
                const on = s.formats.includes(c.id)
                                return (
                  <button key={c.id} type="button" className={'fcard' + (on ? ' on' : '')} onClick={() => toggleFormat(c.id)}>
                    <FormatIcon f={c} size={44} />
                    <span className="ftext"><b>{c.name}{c.tag && <em className={'tag-' + c.tag.toLowerCase()}>{c.tag}</em>}</b><small>{c.ratio} · {c.w} × {c.h}</small></span>
                    <i className="ftick"><Icon name="check" size={12} strokeWidth={3} /></i>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="ex-sec">
            <div className="ex-title">Resolution <small>same layout, more pixels — pick as many as you need</small></div>
            <div className="ex-chips">
              {scaleChoices.map((v) => {
                const big = s.formats.some((f) => tooBig(f, v))
                return <Chip key={v} on={s.scales.includes(v)} onClick={() => !big && toggleScale(v)} title={big ? 'Too large for the browser engine' : `${v}× — ${s.formats.map((f) => { const d = dims(f, v); return `${d.w}×${d.h}` }).join(' / ')}`}>{v}×{v === 1 && <em>native</em>}</Chip>
              })}
              <div className="ex-custom">
                <Scrub label="Custom" value={customScale} min={0.25} max={6} step={0.25} decimals={2} unit="×" onChange={setCustomScale} />
                <button className="btn sm" onClick={() => { if (!s.scales.includes(customScale)) toggleScale(customScale) }}><Icon name="plus" size={13} />Add</button>
              </div>
            </div>
          </div>

          <div className="ex-sec">
            <div className="ex-title">File type</div>
            <div className="ex-types">
              {TYPES.map((t) => (
                <button key={t.id} type="button" className={'tcard' + (s.type === t.id ? ' on' : '')} onClick={() => patch({ type: t.id })}><b>{t.name}</b><span>{t.note}</span></button>
              ))}
            </div>
            {s.type !== 'png' && (
              <label className="range">
                <span>Quality <b>{Math.round(s.quality * 100)}%</b></span>
                <Slider value={s.quality} min={0.5} max={1} step={0.01} onChange={(v) => patch({ quality: v })} />
              </label>
            )}
          </div>

          <div className="ex-sec">
            <div className="ex-title">File names</div>
            <input ref={patternRef} className="input mono-in" value={s.pattern} spellCheck={false} onChange={(e) => patch({ pattern: e.target.value })} />
            <div className="ex-tokens">{TOKENS.map((t) => <button key={t} type="button" className="token" onClick={() => insertToken(t)}>{`{${t}}`}</button>)}
              <button type="button" className="token reset" onClick={() => patch({ pattern: DEFAULT_SETTINGS.pattern })}>reset</button></div>
            <Check checked={s.zip} onChange={(v) => patch({ zip: v })} label="Bundle everything into one ZIP" hint="Easy to share or attach" />
            {native && (
              <div className="ex-dest">
                <Icon name="folder" size={15} />
                <span title={s.dir ?? ''}>{s.dir ?? 'Ask where to save each time'}</span>
                <button className="btn sm" onClick={pickFolder}>{s.dir ? 'Change' : 'Choose folder'}</button>
                {s.dir && <button className="btn sm ghost" onClick={() => patch({ dir: null })}>Forget</button>}
              </div>
            )}
            {native && <Check checked={s.saveProject} onChange={(v) => patch({ saveProject: v })} label="Also save an editable project (.esb)" hint="Reopen the banner later and change anything" />}
            {native && <Check checked={s.openAfter} onChange={(v) => patch({ openAfter: v })} label="Show the files in their folder when finished" />}
          </div>
        </div>

        <aside className="ex-side">
          <div className="ex-title">Preflight</div>
          <div className="ex-checks">
            {checks.map((c, i) => <div key={i} className={'callout ' + (c.level === 'warn' ? 'warn' : 'note')}><Icon name="info" size={15} /><span>{c.text}</span></div>)}
            {!checks.length && <div className="callout good"><Icon name="check" size={15} /><span>Preflight passed — nothing to fix.</span></div>}
          </div>
          <div className="ex-title">Files <span className="count">{jobs.length}</span></div>
          <div className="ex-files">
            {jobs.map((j) => (
              <div key={j.name} className="ex-file">
                <span className="ex-ico"><Icon name="image" size={15} /></span>
                <div><b title={j.name}>{j.name}</b><small>{j.w} × {j.h} px · {j.scale}×</small></div>
              </div>
            ))}
            {!jobs.length && <p className="hint">Pick at least one banner and one resolution.</p>}
          </div>
          <div className="ex-total">
            <span>{s.zip ? '1 ZIP · ' : ''}{(totalPx / 1e6).toFixed(1)} megapixels in total</span>
          </div>

          {running && (
            <div className="progress">
              <div className="bar"><i style={{ width: (running.total ? (running.done / running.total) * 100 : 0) + '%' }} /></div>
              <small>{running.done}/{running.total} · {running.label}</small>
            </div>
          )}
          {error && <div className="callout bad"><Icon name="info" size={15} /><span>{error}</span></div>}
          {result && (
            <div className="callout good">
              <Icon name="check" size={15} />
              <span>Saved {result.saved.length} file{result.saved.length === 1 ? '' : 's'} · {humanBytes(result.bytes)}
                {result.project && <small className="proj-note">Editable project saved too.</small>}
                {window.esb?.reveal && result.saved[0] && <button className="linkbtn" onClick={() => window.esb!.reveal!(result.saved[0])}>Show in folder</button>}</span>
            </div>
          )}
        </aside>
      </div>
    </Dialog>
  )
}
