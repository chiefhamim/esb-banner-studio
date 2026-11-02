// Small controls shared by the audio UI: a slider whose drag is ONE undo step, a number field that commits on
// Enter / blur, a real-waveform thumbnail (engine peaks, never a placeholder) and a level bar.

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { levelFor, onPeaks, peaksFor } from './engine/peaks'
import { waveHeight } from './engine/laneCanvas'
import { gestureEnd, gestureStart } from './audioAdapter'

/** A range slider: pressing it starts an undo gesture, releasing anywhere ends it, so a whole drag is one step. */
export function GSlider({ value, min, max, step = 1, onChange, label, disabled, className = '', onCommit, defaultValue }: {
  value: number; min: number; max: number; step?: number; onChange: (v: number) => void; label: string; disabled?: boolean; className?: string
  onCommit?: () => void
  /** Double-click resets to this value. */
  defaultValue?: number
}) {
  const down = useRef(false)
  useEffect(() => {
    const up = () => { if (down.current) { down.current = false; gestureEnd(); onCommit?.() } }
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => { window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up) }
  }, [onCommit])
  const p = ((value - min) / (max - min)) * 100
  return (
    <input
      type="range" className={`slider vw-gslider ${className}`} min={min} max={max} step={step} value={value} disabled={disabled}
      aria-label={label} style={{ ['--p' as string]: `${p}%` } as CSSProperties}
      onPointerDown={() => { if (!down.current) { down.current = true; gestureStart() } }}
      onDoubleClick={() => { if (defaultValue != null && !disabled) { gestureStart(); onChange(defaultValue); gestureEnd() } }}
      onChange={(e) => onChange(parseFloat(e.target.value))}
    />
  )
}

/** A number box with a unit: typing commits on Enter or leaving the field (one undo step), arrows step by `step`. */
export function NumField({ value, onChange, min, max, step = 1, unit, label, decimals = 1, disabled, className = '' }: {
  value: number; onChange: (v: number) => void; min: number; max: number; step?: number; unit?: string; label: string; decimals?: number; disabled?: boolean; className?: string
}) {
  const fmt = (v: number) => String(Math.round(v * 10 ** decimals) / 10 ** decimals)
  const [text, setText] = useState(fmt(value))
  const focused = useRef(false)
  useEffect(() => { if (!focused.current) setText(fmt(value)) }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  const clamp = (v: number) => Math.max(min, Math.min(max, v))
  const commit = () => {
    const v = parseFloat(text.replace('−', '-'))
    if (Number.isFinite(v)) { const c = clamp(v); if (c !== value) onChange(c); setText(fmt(c)) } else setText(fmt(value))
  }
  return (
    <span className={`vw-numfield ${className}`}>
      <input
        value={text} inputMode="decimal" spellCheck={false} aria-label={label} disabled={disabled}
        onFocus={(e) => { focused.current = true; e.target.select() }}
        onBlur={() => { focused.current = false; commit() }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          else if (e.key === 'Escape') { setText(fmt(value)); (e.target as HTMLInputElement).blur() }
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const v = clamp(Math.round((value + step * (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1)) * 10 ** decimals) / 10 ** decimals)
            onChange(v); setText(fmt(v))
          }
        }}
      />
      {unit && <em>{unit}</em>}
    </span>
  )
}

/** The waveform of a file's sound, drawn from the engine's real peaks. While they are being read it says "Reading";
 * a file with no sound at all says "Silent"; one the app cannot read shows nothing. */
export function WaveThumb({ url, identity, duration, className = '', width = 64, height = 40 }: { url: string; identity?: string; duration: number; className?: string; width?: number; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [, bump] = useState(0)
  useEffect(() => onPeaks(() => bump((n) => n + 1)), [])
  const ps = url ? peaksFor(url, identity ?? url) : ({ state: 'none', why: 'no file' } as const)
  let silent = false
  useEffect(() => {
    const c = ref.current
    if (!c || ps.state !== 'ready') return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(width * dpr)
    c.height = Math.round(height * dpr)
    const g = c.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, width, height)
    const p = ps.peaks
    const dur = p.duration || duration || 1
    const lv = levelFor(p, width / dur)
    const data = p.levels[lv]
    const rate = p.rates[lv]
    const bins = data.length / 2
    const mid = height / 2
    g.fillStyle = getComputedStyle(c).color || '#fff'
    for (let x = 0; x < width; x++) {
      const i0 = Math.max(0, Math.floor((x / width) * dur * rate))
      const i1 = Math.min(bins, Math.max(i0 + 1, Math.ceil(((x + 1) / width) * dur * rate)))
      let peak = 0
      for (let i = i0; i < i1; i++) peak = Math.max(peak, -data[i * 2], data[i * 2 + 1])
      if (peak <= 0) continue
      const hh = Math.max(0.5, waveHeight(peak / 127) * (mid - 1))
      g.fillRect(x, mid - hh, 1, hh * 2)
    }
  })
  let state: 'ready' | 'pending' | 'silent' | 'none' = ps.state
  if (ps.state === 'ready') {
    let any = false
    for (const d of ps.peaks.levels[ps.peaks.levels.length - 1]) if (d !== 0) { any = true; break }
    silent = !any
    if (silent) state = 'silent'
  }
  return (
    <div className={`vw-wave ${className}`} data-wave={state} style={{ width, height }}>
      {state === 'ready' && <canvas ref={ref} style={{ width, height }} aria-label="Waveform" role="img" />}
      {state === 'silent' && <span className="vw-wave-word">Silent</span>}
      {state === 'pending' && <span className="vw-wave-word dim">Reading</span>}
    </div>
  )
}

/** A horizontal level bar: peak in dBFS (−60..0) as a fill, with a red tail above −3 dB. */
export function LevelBar({ db, vertical = true, label, idle }: { db: number | null; vertical?: boolean; label: string; idle?: boolean }) {
  const f = db == null ? 0 : Math.max(0, Math.min(1, (db + 60) / 60))
  const hot = db != null && db > -3
  return (
    <span className={`vw-level${vertical ? ' v' : ''}${hot ? ' hot' : ''}${idle ? ' idle' : ''}`} role="meter" aria-label={label} aria-valuemin={-60} aria-valuemax={0} aria-valuenow={db == null ? undefined : Math.round(db)} data-db={db == null ? '' : db.toFixed(1)}>
      <i style={vertical ? { height: `${f * 100}%` } : { width: `${f * 100}%` }} />
    </span>
  )
}
