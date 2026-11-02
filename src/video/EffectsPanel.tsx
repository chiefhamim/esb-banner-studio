// Inspector sections for Phase 2 — Part B: "Effects" (blend mode, masks, chroma key, blur, sharpen, vignette) and the
// Titles-tab card that adds an adjustment layer. Colour and LUTs have their own section (ColourPanel.tsx). The panel
// only edits `clip.effects` / `clip.blendMode` through the inspector's onChange (one undo step per edit; a slider drag
// is one step, as for every inspector slider); the engine draws them (engine/fxResolve.ts, engine/glCompositor.ts).
//
// The inspector's sections (Transform · Speed · Colour · Effects · Keys) are one accordion (FxSection + useInspectorUi):
// opening one closes the others and scrolls ITS OWN column (the inspector's scroller, never the app shell) so the
// section's header sits under the sticky inspector header. The mask being edited draws its outline and handles over
// the monitor (MaskOverlay); picking a key colour shows a loupe over the monitor (usePicker).

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { IconButton, MenuButton, Seg, Select, Slider, Switch, Toggle } from '../ui/controls'
import type { Clip, ClipEffect } from './timeline'
import { footageRect, trackForKind } from './timeline'
import type { BlendMode, EffectType, NumParam, ParamDef } from './effects'
import { BLEND_LABEL, BLEND_MODES, EFFECT_DEFS, newEffect, paramValue, rgbToHex, setParam, withEffect } from './effects'
import { useVideoStore, viewOf } from './videoStore'
import { fxEditor } from './engine/fxResolve'
import { previewEngine } from './engine/previewEngine'
import { loadPersonMatte, matteState, retryPersonMatte } from './engine/personMatte'
import { kenBurnsZoom, poseAt } from './engine/render'
import '../styles/video-fx.css'

// ---------------------------------------------------------------- the inspector's accordion

/** Which inspector section is open (one at a time, for the session; a launch starts on Transform), the mask whose
 * handles the monitor shows, and a counter that asks the open section to scroll itself into view. */
export const useInspectorUi = create<{ open: string | null; reveal: number; mask: string | null }>(() => ({ open: 'transform', reveal: 0, mask: null }))

/** The sections the current clip has, and which of them is open (the stored one, or the first when the stored one is
 * not on this clip). Provided by the inspector. */
export const InspectorSections = createContext<{ ids: string[]; open: string | null } | null>(null)

/** Open a section (closing the others) and bring it to the top of the inspector's own scroller. */
export function openSection(id: string) { useInspectorUi.setState((s) => ({ open: id, reveal: s.reveal + 1 })) }

function useSectionOpen(id: string): boolean {
  const ctx = useContext(InspectorSections)
  const stored = useInspectorUi((s) => s.open)
  if (!ctx) return stored === id
  return ctx.open === id
}

/** Scroll the inspector's scroller (and only it) so `el` sits just under the sticky inspector header. */
export function revealInInspector(el: HTMLElement) {
  let sc: HTMLElement | null = el.parentElement
  while (sc && !(sc.scrollHeight > sc.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement
  if (!sc || sc.classList.contains('video-workspace')) return
  const head = sc.querySelector<HTMLElement>('.vw-inspector-head')
  const top = sc.scrollTop + el.getBoundingClientRect().top - sc.getBoundingClientRect().top - (head ? head.offsetHeight : 0) - 4
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  sc.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' })
}

/** `bare`: the section is the clip's main body, always shown, with no header of its own (the jump strip still reaches it). */
export function FxSection({ id, title, icon, count, bare, children }: { id: string; title: string; icon: IconName; count?: number; bare?: boolean; children: ReactNode }) {
  const picked = useSectionOpen(id)
  const open = picked || !!bare
  const reveal = useInspectorUi((s) => s.reveal)
  const ref = useRef<HTMLElement>(null)
  const seen = useRef(reveal)
  useLayoutEffect(() => {
    if (seen.current === reveal) return
    seen.current = reveal
    if (picked && ref.current) revealInInspector(ref.current)
  }, [reveal, picked])
  return (
    <section ref={ref} className={`vw-fx-section vw-${id}-panel${open ? ' open' : ''}${bare ? ' bare' : ''}`} data-section={id}>
      {!bare && <button type="button" className="vw-fx-head" aria-expanded={open} onClick={() => { if (open) useInspectorUi.setState({ open: null }); else openSection(id) }}>
        <Icon name={icon} size={13} />
        <span className="vw-fx-title">{title}</span>
        {!!count && <span className="vw-fx-count">{count}</span>}
        <Icon name="chevDown" size={13} className="vw-fx-chev" />
      </button>}
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
  { type: 'personMatte', icon: 'image', hint: 'Cut the person out of a talking-head shot (local, no green screen)', footageOnly: true },
  { type: 'blur', icon: 'eyeOff', hint: 'Gaussian, radius in export pixels' },
  { type: 'sharpen', icon: 'sparkle', hint: 'Crisper edges' },
  { type: 'vignette', icon: 'sun', hint: 'Darker corners' },
]

// ---------------------------------------------------------------- the monitor: where a layer sits on screen

const monitorCanvas = () => document.querySelector<HTMLCanvasElement>('.video-workspace .vw-canvas')
const monitorHost = () => document.querySelector<HTMLElement>('.video-workspace .vw-monitor-container')

/** The canvas's box inside the monitor container (CSS px), kept current on resize. */
function useCanvasBox(): { left: number; top: number; width: number; height: number } | null {
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  useEffect(() => {
    const canvas = monitorCanvas()
    const host = monitorHost()
    if (!canvas || !host) return
    const measure = () => {
      const c = canvas.getBoundingClientRect()
      const h = host.getBoundingClientRect()
      setBox((b) => (b && b.left === c.left - h.left && b.top === c.top - h.top && b.width === c.width && b.height === c.height ? b : { left: c.left - h.left, top: c.top - h.top, width: c.width, height: c.height }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(canvas)
    ro.observe(host)
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [])
  return box
}

// ---------------------------------------------------------------- key colour picking (with a loupe on the monitor)

function sampleCanvas(canvas: HTMLCanvasElement, clientX: number, clientY: number): string | null {
  const r = canvas.getBoundingClientRect()
  const x = Math.round((clientX - r.left) * (canvas.width / Math.max(1, r.width)))
  const y = Math.round((clientY - r.top) * (canvas.height / Math.max(1, r.height)))
  // a 5×5 average (a single pixel of a noisy screen is a poor key)
  const c2 = document.createElement('canvas')
  c2.width = 5
  c2.height = 5
  const ctx = c2.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(canvas, Math.max(0, x - 2), Math.max(0, y - 2), 5, 5, 0, 0, 5, 5)
  const d = ctx.getImageData(0, 0, 5, 5).data
  let rr = 0, gg = 0, bb = 0
  for (let i = 0; i < d.length; i += 4) { rr += d[i]; gg += d[i + 1]; bb += d[i + 2] }
  return rgbToHex(rr / 25, gg / 25, bb / 25)
}

/** Pick the key colour from the monitor: the key is left out while picking, so the screen colour shows. */
function usePicker(onPick: (hex: string) => void) {
  const [picking, setPicking] = useState<string | null>(null)
  const [loupe, setLoupe] = useState<{ x: number; y: number; hex: string } | null>(null)
  const pickRef = useRef(onPick)
  useEffect(() => { pickRef.current = onPick })
  useEffect(() => {
    if (!picking) return
    const canvas = monitorCanvas()
    if (!canvas) return
    fxEditor.skipEffect = picking
    previewEngine().onFrame()
    canvas.classList.add('vw-picking')
    let raf = 0
    const done = () => { fxEditor.skipEffect = ''; canvas.classList.remove('vw-picking'); previewEngine().onFrame(); setPicking(null); setLoupe(null) }
    const down = (e: PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const hex = sampleCanvas(canvas, e.clientX, e.clientY)
      if (hex) pickRef.current(hex)
      done()
    }
    const move = (e: PointerEvent) => {
      if (raf) return
      const { clientX, clientY } = e
      raf = requestAnimationFrame(() => {
        raf = 0
        const host = monitorHost()?.getBoundingClientRect()
        const hex = sampleCanvas(canvas, clientX, clientY)
        if (host && hex) setLoupe({ x: clientX - host.left, y: clientY - host.top, hex })
      })
    }
    const leave = () => setLoupe(null)
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); done() } }
    canvas.addEventListener('pointerdown', down, { capture: true })
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerleave', leave)
    window.addEventListener('keydown', key, { capture: true })
    return () => {
      cancelAnimationFrame(raf)
      canvas.removeEventListener('pointerdown', down, { capture: true }); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerleave', leave)
      window.removeEventListener('keydown', key, { capture: true }); fxEditor.skipEffect = ''; canvas.classList.remove('vw-picking')
    }
  }, [picking])
  return { picking, setPicking, loupe }
}

/** Over the monitor while picking: what to do, and a loupe with the colour under the pointer. */
function PickOverlay({ loupe, current }: { loupe: { x: number; y: number; hex: string } | null; current: string }) {
  const host = monitorHost()
  const box = useCanvasBox()
  if (!host || !box) return null
  return createPortal(
    <div className="vw-pick-layer" style={{ left: box.left, top: box.top, width: box.width, height: box.height }} aria-live="polite">
      <div className="vw-pick-banner"><Icon name="droplet" size={13} />Click the screen colour<span className="vw-pick-esc">Esc cancels</span></div>
      {loupe && (
        <div className="vw-pick-loupe" style={{ left: loupe.x - box.left + 16, top: loupe.y - box.top + 16 }}>
          <span className="vw-pick-was" style={{ background: current }} aria-hidden />
          <span className="vw-pick-now" style={{ background: loupe.hex }} aria-hidden />
          <span className="vw-pick-hex">{loupe.hex}</span>
        </div>
      )}
    </div>,
    host,
  )
}

// ---------------------------------------------------------------- the mask outline and handles on the monitor

type Num4 = { x: number; y: number; w: number; h: number; feather: number }
const MASK_P = Object.fromEntries((EFFECT_DEFS.mask.params as ParamDef[]).filter((p): p is NumParam => p.kind === 'num').map((p) => [p.key, p])) as Record<keyof Num4, NumParam>
const clampP = (k: keyof Num4, v: number) => Math.min(MASK_P[k].max, Math.max(MASK_P[k].min, v))

/** The mask being edited, drawn over the monitor in the layer's frame: drag inside to move it, a corner to resize it
 * (the opposite corner stays), the round handle on the right to feather it. One undo step per drag. */
function MaskOverlay({ clip, effect, onChange }: { clip: Clip; effect: ClipEffect; onChange: (c: Clip) => void }) {
  const box = useCanvasBox()
  const t = useVideoStore((s) => s.currentTime)
  const asset = useVideoStore((s) => s.mediaAssets.find((a) => a.id === clip.mediaAssetId))
  const frame = useVideoStore((s) => { const v = viewOf(s); return `${v.width}x${v.height}` })
  const drag = useRef<{ mode: string; x: number; y: number; start: Num4 } | null>(null)
  const host = monitorHost()
  if (!host || !box || box.width < 8) return null
  const [fw, fh] = frame.split('x').map(Number)
  const W = box.width
  const H = box.height
  const inside = t >= clip.start && t <= clip.start + clip.duration
  const tt = Math.min(clip.start + clip.duration, Math.max(clip.start, t))
  const pose = poseAt(clip, tt)
  // the layer's rectangle on screen (CSS px inside the canvas box), as render.ts places it
  let L = { dx: 0, dy: 0, dw: W, dh: H }
  if (clip.kind === 'video' && !clip.adjustment) {
    const sw = asset?.width || fw
    const sh = asset?.height || fh
    L = footageRect(sw, sh, W, H, pose, clip.still ? kenBurnsZoom(clip, tt) : 1)
  } else if (!clip.adjustment) {
    L = { dx: pose.offX * W, dy: pose.offY * H, dw: W, dh: H }
  }
  const rot = clip.adjustment ? 0 : pose.rotation || 0
  const ax = clip.anchorX ?? 0.5
  const ay = clip.anchorY ?? 0.5
  const m: Num4 = { x: paramValue(effect, MASK_P.x) as number, y: paramValue(effect, MASK_P.y) as number, w: paramValue(effect, MASK_P.w) as number, h: paramValue(effect, MASK_P.h) as number, feather: paramValue(effect, MASK_P.feather) as number }
  const ellipse = effect.params?.shape !== 'rect'
  const cx = m.x * L.dw
  const cy = m.y * L.dh
  const hw = (m.w * L.dw) / 2
  const hh = (m.h * L.dh) / 2
  const f2 = (m.feather * Math.min(L.dw, L.dh)) / 2
  const set = (n: Partial<Num4>) => {
    let c = clip
    for (const k of Object.keys(n) as (keyof Num4)[]) c = setParam(c, effect.id, k, Math.round(clampP(k, n[k]!) * 1000) / 1000)
    onChange(c)
  }
  const local = (e: React.PointerEvent) => {
    // pointer delta in the layer's own (unrotated) axes, in screen px
    const a = (-rot * Math.PI) / 180
    const dx = e.clientX - drag.current!.x
    const dy = e.clientY - drag.current!.y
    return { dx: dx * Math.cos(a) - dy * Math.sin(a), dy: dx * Math.sin(a) + dy * Math.cos(a) }
  }
  const grab = (mode: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    drag.current = { mode, x: e.clientX, y: e.clientY, start: { ...m } }
    useVideoStore.getState().beginGesture()
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const { dx, dy } = local(e)
    const s = d.start
    if (d.mode === 'move') { set({ x: s.x + dx / L.dw, y: s.y + dy / L.dh }); return }
    if (d.mode === 'feather') { set({ feather: Math.max(0, (s.feather * Math.min(L.dw, L.dh) + 2 * dx) / Math.min(L.dw, L.dh)) }); return }
    // a corner: the opposite corner stays where it is
    const sx = d.mode.includes('e') ? 1 : -1
    const sy = d.mode.includes('s') ? 1 : -1
    const w = Math.max(MASK_P.w.min, s.w + (sx * dx) / L.dw)
    const h = Math.max(MASK_P.h.min, s.h + (sy * dy) / L.dh)
    set({ w, h, x: s.x + (sx * (w - s.w)) / 2, y: s.y + (sy * (h - s.h)) / 2 })
  }
  const end = () => { if (drag.current) { drag.current = null; useVideoStore.getState().endGesture() } }
  const corners: [string, number, number][] = [['nw', -1, -1], ['ne', 1, -1], ['se', 1, 1], ['sw', -1, 1]]
  return createPortal(
    <div className={`vw-mask-layer${inside ? '' : ' outside'}`} style={{ left: box.left, top: box.top, width: W, height: H }}>
      <div
        className="vw-mask-frame"
        style={{ left: L.dx, top: L.dy, width: L.dw, height: L.dh, transform: rot ? `rotate(${rot}deg)` : undefined, transformOrigin: `${ax * 100}% ${ay * 100}%` }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <svg className="vw-mask-svg" width={L.dw} height={L.dh} aria-hidden="true">
          {ellipse ? (
            <>
              {f2 > 1 && <ellipse cx={cx} cy={cy} rx={hw + f2} ry={hh + f2} className="vw-mask-feather" />}
              <ellipse cx={cx} cy={cy} rx={hw} ry={hh} className="vw-mask-halo" />
              <ellipse cx={cx} cy={cy} rx={hw} ry={hh} className="vw-mask-line" />
            </>
          ) : (
            <>
              {f2 > 1 && <rect x={cx - hw - f2} y={cy - hh - f2} width={2 * (hw + f2)} height={2 * (hh + f2)} rx={f2} className="vw-mask-feather" />}
              <rect x={cx - hw} y={cy - hh} width={2 * hw} height={2 * hh} className="vw-mask-halo" />
              <rect x={cx - hw} y={cy - hh} width={2 * hw} height={2 * hh} className="vw-mask-line" />
            </>
          )}
        </svg>
        <div className="vw-mask-body" style={{ left: cx - hw, top: cy - hh, width: 2 * hw, height: 2 * hh, borderRadius: ellipse ? '50%' : 0 }} onPointerDown={grab('move')} data-tip="Drag to move the mask" />
        {corners.map(([k, sx, sy]) => (
          <div key={k} className={`vw-mask-handle corner ${k}`} style={{ left: cx + sx * hw, top: cy + sy * hh }} onPointerDown={grab(k)} data-tip="Drag to resize" />
        ))}
        <div className="vw-mask-handle feather" style={{ left: cx + hw + Math.max(f2, 0) + 14, top: cy }} onPointerDown={grab('feather')} data-tip={`Feather ${Math.round(m.feather * 100)}% · drag sideways`} />
      </div>
    </div>,
    host,
  )
}

// ---------------------------------------------------------------- one parameter

function ParamControl({ clip, e, p, onChange, onPick, picking }: { clip: Clip; e: ClipEffect; p: ParamDef; onChange: (c: Clip) => void; onPick: (id: string) => void; picking: boolean }) {
  const v = paramValue(e, p)
  const set = (x: number | string | boolean) => onChange(setParam(clip, e.id, p.key, x))
  switch (p.kind) {
    case 'num': return <ParamSlider p={p} value={v as number} onChange={set} cls={`vw-s-fx-${e.type}-${p.key}`} />
    case 'choice': return <div className="vw-field vw-field-row"><label>{p.label}</label><Seg<string> value={v as string} onChange={set} options={p.options} label={p.label} /></div>
    case 'bool': return <Switch checked={v as boolean} onChange={set} label={p.label} />
    case 'colour': return <ColourRow label={p.label} value={v as string} onSet={set} picking={picking} onPick={() => onPick(e.id)} />
    default: return null
  }
}

/** Label · swatch · hex · Pick on one 32 px row; the hex field keeps what is typed until it is a colour. */
function ColourRow({ label, value, onSet, picking, onPick }: { label: string; value: string; onSet: (v: string) => void; picking: boolean; onPick: () => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <div className="vw-fx-colour">
      <span className="vw-fx-colour-label">{label}</span>
      <span className="vw-fx-swatch" style={{ background: value }} aria-hidden />
      <input
        type="text"
        className="vw-fx-hex"
        value={draft ?? value}
        spellCheck={false}
        maxLength={7}
        aria-label={`${label} (hex)`}
        onChange={(ev) => { const t = ev.target.value.trim(); setDraft(t); if (/^#[0-9a-f]{6}$/i.test(t)) onSet(t.toLowerCase()) }}
        onBlur={() => setDraft(null)}
      />
      <button type="button" className={`btn sm vw-fx-pick${picking ? ' on' : ''}`} aria-pressed={picking} onClick={onPick} data-tip={picking ? 'Click the monitor (Esc cancels)' : 'Pick the screen colour from the monitor'}><Icon name="droplet" size={12} />{picking ? 'Picking' : 'Pick'}</button>
    </div>
  )
}

// ---------------------------------------------------------------- the section

export function EffectsPanel({ clip, onChange }: { clip: Clip; onChange: (c: Clip) => void }) {
  const adjustment = !!clip.adjustment
  const footage = clip.kind === 'video' && !clip.still
  const list = (clip.effects ?? []).filter((e) => e.type !== 'colour' && e.type !== 'lut')
  const all = clip.effects ?? []
  const [pickFor, setPickFor] = useState<string | null>(null)
  const { picking, setPicking, loupe } = usePicker((hex) => { if (pickFor) onChange(setParam(clip, pickFor, 'color', hex)) })
  const open = useSectionOpen('fx')
  const activeMaskId = useInspectorUi((s) => s.mask)
  const masks = list.filter((e) => e.type === 'mask' && e.enabled !== false)
  const activeMask = masks.find((e) => e.id === activeMaskId) ?? masks[0]
  const add = (type: EffectType) => {
    const e = newEffect(type, all)
    onChange({ ...clip, effects: [...all, e] })
    if (type === 'mask') useInspectorUi.setState({ mask: e.id })
    if (type === 'personMatte') void loadPersonMatte().catch(() => {})
  }
  const remove = (id: string) => onChange({ ...clip, effects: all.filter((e) => e.id !== id) })
  const items = ADDABLE.filter((a) => (!a.footageOnly || footage) && !(adjustment && !EFFECT_DEFS[a.type].adjustment)).map((a) => {
    const n = all.filter((e) => e.type === a.type).length
    return { label: EFFECT_DEFS[a.type].label, icon: a.icon, hint: n >= EFFECT_DEFS[a.type].max ? `Already on this clip (at most ${EFFECT_DEFS[a.type].max})` : a.hint, disabled: n >= EFFECT_DEFS[a.type].max, onClick: () => add(a.type) }
  })
  const keyColour = list.find((e) => e.id === picking)
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
        const isMask = e.type === 'mask'
        const editing = isMask && open && activeMask?.id === e.id
        return (
          <div key={e.id} className={`vw-fx-item${e.enabled === false ? ' off' : ''}${editing && masks.length > 1 ? ' editing' : ''}`} data-fx={e.type} onPointerDown={isMask ? () => useInspectorUi.setState({ mask: e.id }) : undefined}>
            <div className="vw-fx-item-head">
              <span className="vw-fx-item-name">{def.label}{def.max > 1 ? ` ${n + 1}` : ''}</span>
              {editing && <span className="vw-fx-item-note">On the monitor</span>}
              <IconButton icon="trash" size={13} tip={`Remove ${def.label.toLowerCase()}`} className="vw-fx-remove" onClick={() => remove(e.id)} />
              <Toggle small checked={e.enabled !== false} label={e.enabled === false ? `Turn ${def.label.toLowerCase()} on` : `Turn ${def.label.toLowerCase()} off`} onChange={(on) => onChange(withEffect(clip, e.id, (x) => ({ ...x, enabled: on })))} />
            </div>
            {e.enabled !== false && e.type === 'personMatte' && <MatteNote />}
            {e.enabled !== false && def.params.map((p) => <ParamControl key={p.key} clip={clip} e={e} p={p} onChange={onChange} picking={picking === e.id} onPick={(id) => { setPickFor(id); setPicking(picking === id || !monitorCanvas() ? null : id) }} />)}
          </div>
        )
      })}
      <MenuButton label="Add effect" icon="plus" className="sm vw-fx-add" menuClassName="vw-solid" items={items} />
      {open && activeMask && !picking && <MaskOverlay clip={clip} effect={activeMask} onChange={onChange} />}
      {picking && <PickOverlay loupe={loupe} current={keyColour ? String(keyColour.params?.color ?? '#00b140') : '#00b140'} />}
    </FxSection>
  )
}

/** Remove background: says whether the local model is ready, loading or failed (with the reason and a retry). */
function MatteNote() {
  const [s, setS] = useState(matteState())
  useEffect(() => {
    void loadPersonMatte().catch(() => {})
    const id = window.setInterval(() => setS((o) => { const n = matteState(); return o.state === n.state && o.failure === n.failure ? o : n }), 400)
    return () => window.clearInterval(id)
  }, [])
  if (s.state === 'ready') return <p className="vw-hint" role="status">Ready. The cut-out is made on this PC; nothing is uploaded. Best on one person facing the camera.</p>
  if (s.state === 'failed') return <p className="vw-hint vw-error" role="alert">The background model could not be loaded: {s.failure} <button type="button" className="btn xs" onClick={() => { retryPersonMatte(); void loadPersonMatte().catch(() => {}) }}>Try again</button></p>
  return <p className="vw-hint" role="status">Loading the background model…</p>
}

/** The Titles tab card: an adjustment layer at the playhead, 5 s, with a neutral colour, on its own "Adjustment"
 * track at the top of the picture tracks (made when there is none), so it only touches what is below it. */
export function AdjustmentPresetCard() {
  const addClip = useVideoStore((s) => s.addClip)
  const onAdd = () => {
    const st = useVideoStore.getState()
    // the track and the clip are one undo step
    st.beginGesture()
    const v = viewOf(st)
    // an existing adjustment track: a top overlay track that holds only adjustment layers
    const own = v.tracks.find((tr) => tr.kind === 'overlay' && /^adjust/i.test(tr.name.replace(/^[A-Z]\d+ · /, '')))
    let trackId = own?.id
    if (!trackId) {
      const top = v.tracks.findIndex((tr) => tr.kind !== 'caption' && tr.kind !== 'audio')
      trackId = st.addTrack('overlay')
      // above every picture track (captions stay on top), named for what it holds
      const now = viewOf(useVideoStore.getState())
      const at = now.tracks.findIndex((tr) => tr.id === trackId)
      if (top >= 0 && at !== top) useVideoStore.getState().moveTrack(trackId, top)
      useVideoStore.getState().renameTrack(trackId, 'Adjustment')
    }
    const t = st.currentTime
    const clip: Clip = { id: `clip-adj-${Date.now().toString(36)}`, trackId: trackId ?? trackForKind(v, 'overlay') ?? 'v2', title: 'Adjustment layer', kind: 'overlay', start: Math.max(0, t), duration: 5, in: 0, out: 5, color: '#64748b', adjustment: true, effects: [newEffect('colour')] }
    addClip(clip)
    useVideoStore.getState().endGesture()
  }
  return (
    <div className="vw-preset-card" data-preset="adjustment">
      <div className="vw-preset-header">
        <span className="vw-tag" data-tag="adjustment">Adjustment layer</span>
        <button type="button" className="btn xs vw-adjust-add" onClick={onAdd}><Icon name="plus" size={12} />Add</button>
      </div>
      <p className="vw-preset-desc">Colour, LUT, blur or a mask over every track below it, for as long as it lasts. It gets its own track.</p>
    </div>
  )
}
