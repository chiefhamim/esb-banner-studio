// Inspector sections for Phase 2 — Part B: "Effects" (blend mode, masks, chroma key, blur, sharpen, vignette) and the
// Titles-tab card that adds an adjustment layer. Colour and LUTs have their own section (ColourPanel.tsx). The panel
// only edits `clip.effects` / `clip.blendMode` through the inspector's onChange (one undo step per edit; a slider drag
// is one step, as for every inspector slider); the engine draws them (engine/fxResolve.ts, engine/glCompositor.ts).

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { IconButton, MenuButton, Seg, Select, Slider, Switch, Toggle } from '../ui/controls'
import type { Clip, ClipEffect } from './timeline'
import { trackForKind } from './timeline'
import type { BlendMode, EffectType, NumParam, ParamDef } from './effects'
import { BLEND_LABEL, BLEND_MODES, EFFECT_DEFS, newEffect, paramValue, rgbToHex, setParam, withEffect } from './effects'
import { useVideoStore } from './videoStore'
import { fxEditor } from './engine/fxResolve'
import { previewEngine } from './engine/previewEngine'
import '../styles/video-fx.css'

/** Which sections are open (for the session; every launch starts closed). */
const openState: Record<string, boolean> = {}

export function FxSection({ id, title, icon, count, children }: { id: string; title: string; icon: IconName; count?: number; children: ReactNode }) {
  const [open, setOpen] = useState(!!openState[id])
  return (
    <section className={`vw-fx-section vw-${id}-panel${open ? ' open' : ''}`}>
      <button type="button" className="vw-fx-head" aria-expanded={open} onClick={() => { openState[id] = !open; setOpen(!open) }}>
        <Icon name={icon} size={13} />
        <span className="vw-fx-title">{title}</span>
        {!!count && <span className="vw-fx-count">{count}</span>}
        <Icon name="chevDown" size={13} className="vw-fx-chev" />
      </button>
      {open && <div className="vw-fx-body">{children}</div>}
    </section>
  )
}

const fmt = (p: NumParam, v: number) => {
  if (p.unit === '%') return `${Math.round(v * 100)}%`
  if (p.unit === 'px') return `${Math.round(v * 10) / 10} px`
  if (p.unit === 'stops') return `${v > 0 ? '+' : ''}${v.toFixed(2)}`
  return String(Math.round(v * 100) / 100)
}

/** One numeric parameter as a labelled slider (double-click the label: back to its default). */
export function ParamSlider({ p, value, onChange, cls }: { p: NumParam; value: number; onChange: (v: number) => void; cls: string }) {
  return (
    <div className="vw-field vw-fx-field">
      <label onDoubleClick={() => onChange(p.def)} data-tip="Double-click to reset">{p.label} <em>{fmt(p, value)}</em></label>
      <Slider className={cls} min={p.min} max={p.max} step={p.step} value={value} onChange={onChange} />
    </div>
  )
}

const ADDABLE: { type: EffectType; icon: IconName; hint: string; footageOnly?: boolean }[] = [
  { type: 'mask', icon: 'crop', hint: 'Rectangle or ellipse, feathered, inverted' },
  { type: 'chromaKey', icon: 'droplet', hint: 'Remove a green or blue screen', footageOnly: true },
  { type: 'blur', icon: 'eyeOff', hint: 'Gaussian, radius in export pixels' },
  { type: 'sharpen', icon: 'sparkle', hint: 'Crisper edges' },
  { type: 'vignette', icon: 'sun', hint: 'Darker corners' },
]

/** Pick the key colour from the monitor: the key is left out while picking, so the screen colour shows. */
const monitorCanvas = () => document.querySelector<HTMLCanvasElement>('.video-workspace .vw-canvas')

function usePicker(onPick: (hex: string) => void) {
  const [picking, setPicking] = useState<string | null>(null)
  const pickRef = useRef(onPick)
  useEffect(() => { pickRef.current = onPick })
  useEffect(() => {
    if (!picking) return
    const canvas = monitorCanvas()
    if (!canvas) return
    fxEditor.skipEffect = picking
    previewEngine().onFrame()
    canvas.classList.add('vw-picking')
    const done = () => { fxEditor.skipEffect = ''; canvas.classList.remove('vw-picking'); previewEngine().onFrame(); setPicking(null) }
    const down = (e: PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const r = canvas.getBoundingClientRect()
      const sx = canvas.width / Math.max(1, r.width)
      const sy = canvas.height / Math.max(1, r.height)
      const x = Math.round((e.clientX - r.left) * sx)
      const y = Math.round((e.clientY - r.top) * sy)
      // a 5×5 average (a single pixel of a noisy screen is a poor key)
      const c2 = document.createElement('canvas')
      c2.width = 5
      c2.height = 5
      const ctx = c2.getContext('2d', { willReadFrequently: true })
      if (ctx) {
        ctx.drawImage(canvas, Math.max(0, x - 2), Math.max(0, y - 2), 5, 5, 0, 0, 5, 5)
        const d = ctx.getImageData(0, 0, 5, 5).data
        let rr = 0, gg = 0, bb = 0
        for (let i = 0; i < d.length; i += 4) { rr += d[i]; gg += d[i + 1]; bb += d[i + 2] }
        pickRef.current(rgbToHex(rr / 25, gg / 25, bb / 25))
      }
      done()
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); done() } }
    canvas.addEventListener('pointerdown', down, { capture: true })
    window.addEventListener('keydown', key, { capture: true })
    return () => { canvas.removeEventListener('pointerdown', down, { capture: true }); window.removeEventListener('keydown', key, { capture: true }); fxEditor.skipEffect = ''; canvas.classList.remove('vw-picking') }
  }, [picking])
  return { picking, setPicking }
}

function ParamControl({ clip, e, p, onChange, onPick, picking }: { clip: Clip; e: ClipEffect; p: ParamDef; onChange: (c: Clip) => void; onPick: (id: string) => void; picking: boolean }) {
  const v = paramValue(e, p)
  const set = (x: number | string | boolean) => onChange(setParam(clip, e.id, p.key, x))
  switch (p.kind) {
    case 'num': return <ParamSlider p={p} value={v as number} onChange={set} cls={`vw-s-fx-${e.type}-${p.key}`} />
    case 'choice': return <div className="vw-field vw-field-row"><label>{p.label}</label><Seg<string> value={v as string} onChange={set} options={p.options} label={p.label} /></div>
    case 'bool': return <Switch checked={v as boolean} onChange={set} label={p.label} />
    case 'colour': return (
      <div className="vw-field vw-field-row vw-fx-colour">
        <label>{p.label}</label>
        <span className="vw-fx-swatch" style={{ background: v as string }} aria-hidden />
        <input type="text" className="vw-fx-hex" value={v as string} spellCheck={false} aria-label={`${p.label} (hex)`} onChange={(ev) => { const t = ev.target.value.trim(); if (/^#[0-9a-f]{6}$/i.test(t)) set(t.toLowerCase()) }} />
        <button type="button" className={`btn xs vw-fx-pick${picking ? ' on' : ''}`} aria-pressed={picking} onClick={() => onPick(e.id)} data-tip="Click the monitor to pick the screen colour (Esc cancels)"><Icon name="droplet" size={12} />{picking ? 'Click monitor' : 'Pick'}</button>
      </div>
    )
    default: return null
  }
}

export function EffectsPanel({ clip, onChange }: { clip: Clip; onChange: (c: Clip) => void }) {
  const adjustment = !!clip.adjustment
  const footage = clip.kind === 'video' && !clip.still
  const list = (clip.effects ?? []).filter((e) => e.type !== 'colour' && e.type !== 'lut')
  const all = clip.effects ?? []
  const [pickFor, setPickFor] = useState<string | null>(null)
  const { picking, setPicking } = usePicker((hex) => { if (pickFor) onChange(setParam(clip, pickFor, 'color', hex)) })
  const add = (type: EffectType) => onChange({ ...clip, effects: [...all, newEffect(type, all)] })
  const remove = (id: string) => onChange({ ...clip, effects: all.filter((e) => e.id !== id) })
  const items = ADDABLE.filter((a) => (!a.footageOnly || footage) && !(adjustment && !EFFECT_DEFS[a.type].adjustment)).map((a) => {
    const n = all.filter((e) => e.type === a.type).length
    return { label: EFFECT_DEFS[a.type].label, icon: a.icon, hint: n >= EFFECT_DEFS[a.type].max ? `Already on this clip (at most ${EFFECT_DEFS[a.type].max})` : a.hint, disabled: n >= EFFECT_DEFS[a.type].max, onClick: () => add(a.type) }
  })
  return (
    <FxSection id="fx" title="Effects" icon="sliders" count={list.length + (clip.blendMode && clip.blendMode !== 'normal' ? 1 : 0)}>
      {adjustment && <p className="vw-hint">An adjustment layer draws nothing itself: its effects and colour apply to every track below it while it lasts.</p>}
      {!adjustment && (
        <div className="vw-field vw-field-row">
          <label>Blend</label>
          <Select<BlendMode> className="vw-fx-blend" value={clip.blendMode ?? 'normal'} align="end" onChange={(m) => onChange({ ...clip, blendMode: m === 'normal' ? undefined : m })} options={BLEND_MODES.map((m) => ({ value: m, label: BLEND_LABEL[m] }))} />
        </div>
      )}
      {list.map((e) => {
        const def = EFFECT_DEFS[e.type as EffectType]
        if (!def) return null
        const n = all.filter((x) => x.type === e.type).indexOf(e)
        return (
          <div key={e.id} className={`vw-fx-item${e.enabled === false ? ' off' : ''}`} data-fx={e.type}>
            <div className="vw-fx-item-head">
              <span className="vw-fx-item-name">{def.label}{def.max > 1 ? ` ${n + 1}` : ''}</span>
              <Toggle small checked={e.enabled !== false} label={e.enabled === false ? `Turn ${def.label.toLowerCase()} on` : `Turn ${def.label.toLowerCase()} off`} onChange={(on) => onChange(withEffect(clip, e.id, (x) => ({ ...x, enabled: on })))} />
              <IconButton icon="trash" size={13} tip={`Remove ${def.label.toLowerCase()}`} className="vw-fx-remove" onClick={() => remove(e.id)} />
            </div>
            {e.enabled !== false && def.params.map((p) => <ParamControl key={p.key} clip={clip} e={e} p={p} onChange={onChange} picking={picking === e.id} onPick={(id) => { setPickFor(id); setPicking(picking === id || !monitorCanvas() ? null : id) }} />)}
          </div>
        )
      })}
      <MenuButton label="Add effect" icon="plus" className="sm vw-fx-add" menuClassName="vw-solid" items={items} />
    </FxSection>
  )
}

/** The Titles tab card: an adjustment layer at the playhead on the top overlay track, 5 s, with a neutral colour. */
export function AdjustmentPresetCard() {
  const addClip = useVideoStore((s) => s.addClip)
  const onAdd = () => {
    const st = useVideoStore.getState()
    const trackId = trackForKind(st.project, 'overlay') ?? st.addTrack('overlay')
    const t = st.currentTime
    const clip: Clip = { id: `clip-adj-${Date.now().toString(36)}`, trackId, title: 'Adjustment layer', kind: 'overlay', start: Math.max(0, t), duration: 5, in: 0, out: 5, color: '#64748b', adjustment: true, effects: [newEffect('colour')] }
    addClip(clip)
  }
  return (
    <div className="vw-preset-card" data-preset="adjustment">
      <div className="vw-preset-header">
        <span className="vw-tag" data-tag="adjustment">Adjustment layer</span>
        <button type="button" className="btn xs vw-adjust-add" onClick={onAdd}><Icon name="plus" size={12} />Add</button>
      </div>
      <p className="vw-preset-desc">Colour, LUT, blur or a mask over every track below it, for as long as it lasts.</p>
    </div>
  )
}
