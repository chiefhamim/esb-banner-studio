// Phase 2 — Part A: the pro-editing pieces of the timeline and the inspector (tools, markers, the keyframe lane, the
// ease and speed curve editors, the speed panel, paste attributes, the shortcuts sheet, the compound breadcrumb).
// Everything edits through the store, so every gesture is one undo step (beginGesture on press, endGesture on release
// anywhere: VideoWorkspace's window pointerup).

import { memo, useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { Check, Dialog, IconButton, MenuButton, MenuList, Popover, Slider, Switch } from '../ui/controls'
import type { MenuEntry } from '../ui/controls'
import type { AttrGroup, Clip, Keyframe, Marker } from './timeline'
import { ATTR_LABEL, MARKER_COLORS, attrGroupsFor, formatShortTime } from './timeline'
import type { EditMode, EditTool } from './videoStore'
import { useVideoStore, viewOf } from './videoStore'
import type { BezierPoints, ClipProp } from './keyframes'
import { DEFAULT_BEZIER, EASE_LABEL, KEY_EPS, PROPS, PROP_FIELD, PROP_LABEL, easeName, easePoints, keyAt, keyTimes, moveKey, removeKey, setKey, setKeyEase, toggleKey, valueAt } from './keyframes'
import { RAMP_PRESETS, SPEED_MAX, SPEED_MIN, constantSpeed, isFrozenAt, rampOf, speedAt, withConstantSpeed, withFreeze, withRamp, withRampPreset, withReverse, withoutFreeze } from './speed'

const getState = useVideoStore.getState

// ---------------------------------------------------------------- tools

export const TOOLS: { id: EditTool; label: string; key: string; icon: IconName; hint: string }[] = [
  { id: 'select', label: 'Select', key: 'V', icon: 'select', hint: 'Move and trim clips' },
  { id: 'ripple', label: 'Ripple', key: 'B', icon: 'swap', hint: 'Trims move every clip after it' },
  { id: 'roll', label: 'Roll', key: 'N', icon: 'dimension', hint: 'Drag a cut between two clips' },
  { id: 'slip', label: 'Slip', key: 'Y', icon: 'hand', hint: 'Show another part of the clip in place' },
  { id: 'slide', label: 'Slide', key: 'U', icon: 'distH', hint: 'Move a clip between its neighbours' },
]

/** The tool picker in the timeline toolbar, with the drop/paste mode in the same menu. */
export function ToolMenu() {
  const tool = useVideoStore((s) => s.tool)
  const mode = useVideoStore((s) => s.editMode)
  const t = TOOLS.find((x) => x.id === tool) ?? TOOLS[0]
  const items: MenuEntry[] = [
    { heading: 'Tool' },
    ...TOOLS.map((x) => ({ label: x.label, hint: x.hint, shortcut: x.key, checked: x.id === tool, icon: x.icon, onClick: () => getState().setTool(x.id) })),
    { divider: true },
    { heading: 'Drop and paste' },
    ...(['overwrite', 'insert'] as EditMode[]).map((m) => ({
      label: m === 'overwrite' ? 'Overwrite' : 'Insert', checked: m === mode,
      hint: m === 'overwrite' ? 'Replaces what is under it' : 'Pushes later clips along, every track in sync',
      onClick: () => getState().setEditMode(m),
    })),
  ]
  return <MenuButton label={t.label} icon={t.icon} items={items} className={`sm subtle vw-tool-menu${tool !== 'select' ? ' on' : ''}`} menuClassName="vw-solid vw-tool-pop" title={`Tool: ${t.label} (${t.key}) · ${mode === 'insert' ? 'Insert' : 'Overwrite'}`} />
}

// ---------------------------------------------------------------- markers

/** Flags on the ruler (and the in/out range). Drag a flag to move it, click to jump, double-click to name it. */
export const RulerMarkers = memo(function RulerMarkers({ markers, zoom, range, onOpen }: { markers: Marker[]; zoom: number; range: { in: number | null; out: number | null }; onOpen: (id: string) => void }) {
  const drag = useRef<{ id: string; x: number; t: number; moved: boolean } | null>(null)
  return (
    <>
      {range.in != null && <div className="vw-range-edge in" style={{ left: `${range.in * zoom}px` }} data-tip="In point (I)" />}
      {range.out != null && <div className="vw-range-edge out" style={{ left: `${range.out * zoom}px` }} data-tip="Out point (O)" />}
      {range.in != null && range.out != null && <div className="vw-range-band" style={{ left: `${range.in * zoom}px`, width: `${(range.out - range.in) * zoom}px` }} />}
      {markers.map((m) => (
        <button
          key={m.id}
          type="button"
          className="vw-marker"
          data-marker-id={m.id}
          style={{ left: `${m.t * zoom}px`, '--mk': m.color } as React.CSSProperties}
          aria-label={`Marker ${m.name || 'unnamed'} at ${formatShortTime(m.t)}`}
          data-tip={`${m.name || 'Unnamed marker'} · ${formatShortTime(m.t)} (drag to move, double-click to name)`}
          onPointerDown={(e) => {
            e.stopPropagation()
            e.currentTarget.setPointerCapture(e.pointerId)
            drag.current = { id: m.id, x: e.clientX, t: m.t, moved: false }
          }}
          onPointerMove={(e) => {
            const d = drag.current
            if (!d) return
            if (!d.moved && Math.abs(e.clientX - d.x) < 3) return
            if (!d.moved) { d.moved = true; getState().beginGesture() }
            const fps = viewOf(getState()).fps || 30
            getState().updateMarker(d.id, { t: Math.round(Math.max(0, d.t + (e.clientX - d.x) / zoom) * fps) / fps })
          }}
          onPointerUp={() => { const d = drag.current; drag.current = null; if (d && !d.moved) getState().seek(m.t) }}
          onDoubleClick={() => onOpen(m.id)}
        >
          <i />{m.name && zoom >= 30 && <span>{m.name}</span>}
        </button>
      ))}
    </>
  )
})

/** The markers list (toolbar button + popover): add at the playhead, name, colour, jump, delete. */
export function MarkersButton({ focusId, onFocusDone }: { focusId: string | null; onFocusDone: () => void }) {
  const markers = useVideoStore((s) => viewOf(s).markers) ?? []
  const btn = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => { if (focusId) setOpen(true) }, [focusId])
  return (
    <>
      <button ref={btn} type="button" className={`btn sm subtle vw-markers-btn${open ? ' open' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} data-tip="Markers (M adds one at the playhead)">
        <Icon name="star" size={13} /><span className="vw-lbl">Markers</span>{markers.length > 0 && <span className="vw-count">{markers.length}</span>}
      </button>
      {open && btn.current && (
        <Popover anchor={{ el: btn.current }} onClose={() => { setOpen(false); onFocusDone() }} align="end" className="menu vw-solid vw-markers-pop" minWidth={320}>
          <MarkerList markers={markers} focusId={focusId} />
        </Popover>
      )}
    </>
  )
}

/** A marker's name: typed into a draft and committed once (Enter or leaving the field = one undo step; Esc puts the
 * name back). It used to write every keystroke, and the pointer-up that ends any gesture split them into one step
 * per key. */
function MarkerName({ m, inputRef }: { m: Marker; inputRef: (el: HTMLInputElement | null) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const cancelled = useRef(false)
  const commit = () => {
    // Enter commits and then blurs (a second commit in the same tick): compare with the stored name, not the render's
    const now = viewOf(getState()).markers?.find((x) => x.id === m.id)?.name
    if (!cancelled.current && draft != null && now != null && draft !== now) getState().updateMarker(m.id, { name: draft })
    cancelled.current = false
    setDraft(null)
  }
  return (
    <input
      ref={inputRef}
      type="text"
      className="vw-ml-name"
      value={draft ?? m.name}
      placeholder="Marker name"
      aria-label="Marker name"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); e.currentTarget.blur() }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelled.current = true; e.currentTarget.blur() }
      }}
    />
  )
}

function MarkerList({ markers, focusId }: { markers: Marker[]; focusId: string | null }) {
  const fps = useVideoStore((s) => viewOf(s).fps)
  const ripple = useVideoStore((s) => s.project.rippleMarkers !== false)
  const inputs = useRef(new Map<string, HTMLInputElement>())
  useEffect(() => { if (focusId) inputs.current.get(focusId)?.focus() }, [focusId])
  return (
    <div className="vw-marker-list">
      <div className="vw-ml-head">
        <span>Markers</span>
        <button type="button" className="btn xs vw-ml-add" onClick={() => { const id = getState().addMarker(); if (id) setTimeout(() => inputs.current.get(id)?.focus(), 0) }}><Icon name="plus" size={12} />Add at playhead<kbd>M</kbd></button>
      </div>
      {!markers.length && <p className="vw-ml-empty">No markers yet. Press M to drop one at the playhead, then name it here.</p>}
      {markers.map((m) => (
        <div key={m.id} className="vw-ml-row" data-marker-id={m.id}>
          <button type="button" className="vw-ml-dot" style={{ background: m.color }} aria-label="Change the colour" data-tip="Colour (click for the next one)"
            onClick={() => { const i = MARKER_COLORS.indexOf(m.color as (typeof MARKER_COLORS)[number]); getState().updateMarker(m.id, { color: MARKER_COLORS[(i + 1) % MARKER_COLORS.length] }) }} />
          <MarkerName m={m} inputRef={(el) => { if (el) inputs.current.set(m.id, el); else inputs.current.delete(m.id) }} />
          <button type="button" className="vw-ml-time mono" onClick={() => getState().seek(m.t)} data-tip="Jump to it">{formatShortTime(m.t)}</button>
          <span className="vw-ml-frame mono" aria-hidden="true">{Math.round(m.t * fps) % fps}f</span>
          <IconButton icon="trash" size={13} tip="Delete marker" onClick={() => getState().removeMarker(m.id)} />
        </div>
      ))}
      {markers.length > 1 && <p className="vw-ml-foot">Shift+M next marker · Alt+M previous</p>}
      <div className="vw-ml-ripple" data-tip="Ripple delete, ripple trim, insert, extract and speed changes move the markers after the edit with the clips"><Switch checked={ripple} onChange={() => getState().toggleRippleMarkers()} label="Markers follow ripple edits" /></div>
    </div>
  )
}

// ---------------------------------------------------------------- the keyframe lane under the selected clip

/** Which property the keyframe lane shows ('all' = every animated one), and the key the editor picked. */
export const useKfUi = create<{ prop: string; menu: { t: number; x: number; y: number } | null; curve: { t: number; x: number; y: number } | null }>(() => ({ prop: 'all', menu: null, curve: null }))

const animatedProps = (c: Clip) => Object.keys(c.keyframes ?? {}).filter((p) => c.keyframes![p]?.length)
/** The props a lane action applies to: the chosen one, or every animated one with a key at `t` (for 'all'). */
const propsAt = (c: Clip, prop: string, t?: number) => (prop === 'all' ? animatedProps(c).filter((p) => t == null || keyAt(c, p, t)) : [prop])

/** The header cell beside the keyframe lane: which property to show. */
export function KeyframeHead({ clip }: { clip: Clip }) {
  const prop = useKfUi((s) => s.prop)
  const props = animatedProps(clip)
  const current = prop !== 'all' && !props.includes(prop) ? 'all' : prop
  const label = current === 'all' ? 'All keys' : PROP_LABEL[current as ClipProp] ?? current
  return (
    <div className="vw-track-head vw-kf-head" aria-label="Keyframes of the selected clip">
      <i className="vw-diamond" aria-hidden="true" />
      <MenuButton label={label} items={[{ label: 'All keys', checked: current === 'all', onClick: () => useKfUi.setState({ prop: 'all' }) }, { divider: true }, ...props.map((p) => ({ label: PROP_LABEL[p as ClipProp] ?? p, checked: p === current, onClick: () => useKfUi.setState({ prop: p }) }))]} className="xs subtle vw-kf-prop" menuClassName="vw-solid" />
    </div>
  )
}

/** The lane: a diamond per key time over the clip's span. Drag a diamond to move it (one undo step), click it to put
 * the playhead there, right-click (or Enter) for its ease, Delete removes it; double-click the lane to add a key. */
export function KeyframeLane({ clip, zoom }: { clip: Clip; zoom: number }) {
  const prop = useKfUi((s) => s.prop)
  const props = animatedProps(clip)
  const current = prop !== 'all' && !props.includes(prop) ? 'all' : prop
  const times = current === 'all' ? keyTimes(clip) : keyTimes(clip, current)
  const drag = useRef<{ props: string[]; cur: number; from: number; x: number; moved: boolean } | null>(null)
  const fps = useVideoStore((s) => viewOf(s).fps) || 30
  const edit = (f: (c: Clip) => Clip) => { const c = viewOf(getState()).clips.find((x) => x.id === clip.id); if (c) getState().updateClip(f(c)) }
  const openMenu = (t: number, x: number, y: number) => useKfUi.setState({ menu: { t, x, y }, curve: null })
  // the value curve of one property, drawn across the clip (normalised to the lane height)
  let curve: string | null = null
  if (current !== 'all' && clip.keyframes?.[current]?.length) {
    const n = Math.max(2, Math.min(240, Math.round(clip.duration * zoom / 4)))
    const vals = Array.from({ length: n + 1 }, (_, i) => valueAt(clip, current, (i / n) * clip.duration))
    const lo = Math.min(...vals)
    const hi = Math.max(...vals)
    const span = hi - lo || 1
    curve = vals.map((v, i) => `${((i / n) * clip.duration * zoom).toFixed(1)},${(20 - ((v - lo) / span) * 14).toFixed(1)}`).join(' ')
  }
  return (
    <div className="vw-kf-lane" data-kf-clip={clip.id}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('.vw-kf-key')) return
        const r = e.currentTarget.getBoundingClientRect()
        const t = Math.round(((e.clientX - r.left) / zoom - clip.start) * fps) / fps
        if (t < 0 || t > clip.duration) return
        edit((c) => (current === 'all' ? animatedProps(c) : [current]).reduce((acc, p) => setKey(acc, p, t, valueAt(acc, p, t)), c))
      }}
    >
      <div className="vw-kf-span" style={{ left: `${clip.start * zoom}px`, width: `${clip.duration * zoom}px` }}>
        {curve && <svg className="vw-kf-curve" width={clip.duration * zoom} height={24} aria-hidden="true"><polyline points={curve} /></svg>}
      </div>
      {times.map((t) => {
        const ref = keyAt(clip, (propsAt(clip, current, t)[0] ?? current), t)
        const ease = ref ? easeName(ref) : 'linear'
        return (
          <button
            key={t}
            type="button"
            className={`vw-kf-key ease-${ease}`}
            style={{ left: `${(clip.start + t) * zoom}px` }}
            data-kf-t={t.toFixed(4)}
            aria-label={`Keyframe at ${formatShortTime(clip.start + t)}`}
            data-tip={`${formatShortTime(clip.start + t)} · ${EASE_LABEL[ease]} · drag to move, right-click for the ease, Del removes`}
            onPointerDown={(e) => {
              if (e.button !== 0) return
              e.stopPropagation()
              e.currentTarget.setPointerCapture(e.pointerId)
              drag.current = { props: propsAt(clip, current, t), cur: t, from: t, x: e.clientX, moved: false }
            }}
            onPointerMove={(e) => {
              const d = drag.current
              if (!d) return
              if (!d.moved && Math.abs(e.clientX - d.x) < 3) return
              if (!d.moved) { d.moved = true; getState().beginGesture() }
              const to = Math.max(0, Math.min(clip.duration, Math.round((d.from + (e.clientX - d.x) / zoom) * fps) / fps))
              if (Math.abs(to - d.cur) < KEY_EPS) return
              const from = d.cur
              d.cur = to
              edit((c) => d.props.reduce((acc, p) => moveKey(acc, p, from, to), c))
            }}
            onPointerUp={() => { const d = drag.current; drag.current = null; if (d && !d.moved) getState().seek(clip.start + t) }}
            onContextMenu={(e) => { e.preventDefault(); openMenu(t, e.clientX, e.clientY) }}
            onKeyDown={(e) => {
              if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); edit((c) => propsAt(c, current, t).reduce((acc, p) => removeKey(acc, p, t), c)) }
              else if (e.key === 'Enter') { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); openMenu(t, r.left, r.bottom + 4) }
            }}
          />
        )
      })}
      <EaseMenus clip={clip} prop={current} />
    </div>
  )
}

/** The ease menu of a key (and the custom-curve editor it opens). */
function EaseMenus({ clip, prop }: { clip: Clip; prop: string }) {
  const menu = useKfUi((s) => s.menu)
  const curve = useKfUi((s) => s.curve)
  const edit = (f: (c: Clip) => Clip) => { const c = viewOf(getState()).clips.find((x) => x.id === clip.id); if (c) getState().updateClip(f(c)) }
  const at = menu ?? curve
  const ref = at ? keyAt(clip, propsAt(clip, prop, at.t)[0] ?? prop, at.t) : undefined
  if (menu) {
    const cur = ref ? easeName(ref) : 'linear'
    const items: MenuEntry[] = [
      { heading: `Ease after ${formatShortTime(clip.start + menu.t)}` },
      ...(['linear', 'easeIn', 'easeOut', 'easeInOut'] as const).map((e) => ({ label: EASE_LABEL[e], checked: cur === e, onClick: () => edit((c) => propsAt(c, prop, menu.t).reduce((acc, p) => setKeyEase(acc, p, menu.t, e), c)) })),
      { label: 'Custom curve…', checked: cur === 'bezier', onClick: () => { edit((c) => propsAt(c, prop, menu.t).reduce((acc, p) => (easeName(keyAt(acc, p, menu.t) ?? {}) === 'bezier' ? acc : setKeyEase(acc, p, menu.t, 'bezier', ref ? easePoints(ref) : DEFAULT_BEZIER)), c)); setTimeout(() => useKfUi.setState({ curve: { ...menu }, menu: null }), 0) } },
      { divider: true },
      { label: 'Delete keyframe', icon: 'trash', danger: true, onClick: () => edit((c) => propsAt(c, prop, menu.t).reduce((acc, p) => removeKey(acc, p, menu.t), c)) },
    ]
    return <Popover anchor={{ x: menu.x, y: menu.y }} onClose={() => useKfUi.setState({ menu: null })} className="menu ctx vw-solid vw-ease-menu" minWidth={210}><MenuList items={items} onDone={() => useKfUi.setState({ menu: null })} /></Popover>
  }
  if (curve && ref) {
    return (
      <Popover anchor={{ x: curve.x, y: curve.y }} onClose={() => useKfUi.setState({ curve: null })} className="vw-solid vw-curve-pop" minWidth={236}>
        <BezierEditor value={easePoints(ref)} onChange={(b) => edit((c) => propsAt(c, prop, curve.t).reduce((acc, p) => setKeyEase(acc, p, curve.t, 'bezier', b), c))} />
      </Popover>
    )
  }
  return null
}

/** A small cubic-bezier editor: drag the two handles; the curve is the shape of the segment after the key. */
export function BezierEditor({ value, onChange }: { value: BezierPoints; onChange: (b: BezierPoints) => void }) {
  const svg = useRef<SVGSVGElement>(null)
  const S = 160 // the unit square in px
  const PAD = 12
  const OVER = 40 // room for overshoot above 1 and below 0
  const W = S + PAD * 2
  const H = S + OVER * 2
  const px = (x: number) => PAD + x * S
  const py = (y: number) => OVER + (1 - y) * S
  const [x1, y1, x2, y2] = value
  const drag = useRef<0 | 1 | null>(null)
  const move = (e: React.PointerEvent) => {
    if (drag.current == null || !svg.current) return
    const r = svg.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, ((e.clientX - r.left) * (W / r.width) - PAD) / S))
    const y = Math.max(-OVER / S, Math.min(1 + OVER / S, 1 - ((e.clientY - r.top) * (H / r.height) - OVER) / S))
    const round = (v: number) => Math.round(v * 100) / 100
    onChange(drag.current === 0 ? [round(x), round(y), x2, y2] : [x1, y1, round(x), round(y)])
  }
  const path = `M${px(0)},${py(0)} C${px(x1)},${py(y1)} ${px(x2)},${py(y2)} ${px(1)},${py(1)}`
  return (
    <div className="vw-bezier">
      <div className="vw-bezier-head"><span>Custom curve</span><span className="mono">{value.map((v) => v.toFixed(2)).join(', ')}</span></div>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="vw-bezier-svg" onPointerMove={move} onPointerUp={() => { drag.current = null }} role="group" aria-label="Ease curve: drag the two handles">
        <rect x={px(0)} y={py(1)} width={S} height={S} className="vw-bz-box" />
        <line x1={px(0)} y1={py(0)} x2={px(1)} y2={py(1)} className="vw-bz-diag" />
        <line x1={px(0)} y1={py(0)} x2={px(x1)} y2={py(y1)} className="vw-bz-arm" />
        <line x1={px(1)} y1={py(1)} x2={px(x2)} y2={py(y2)} className="vw-bz-arm" />
        <path d={path} className="vw-bz-curve" />
        {([[x1, y1], [x2, y2]] as const).map(([x, y], i) => (
          <circle key={i} cx={px(x)} cy={py(y)} r={7} className={`vw-bz-handle h${i + 1}`}
            onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId); drag.current = i as 0 | 1; getState().beginGesture() }} />
        ))}
      </svg>
      <div className="vw-bezier-presets">
        {([['Ease in', [0.42, 0, 1, 1]], ['Ease out', [0, 0, 0.58, 1]], ['S-curve', [0.65, 0, 0.35, 1]], ['Overshoot', [0.34, 1.56, 0.64, 1]]] as [string, BezierPoints][]).map(([l, b]) => (
          <button key={l} type="button" className="btn xs subtle" onClick={() => onChange(b)}>{l}</button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- inspector: keyframable property rows

/** The playhead in the clip's own time (rounded to the frame), followed only while the clip is animated, so an
 * unanimated inspector does not redraw on every frame of playback. */
export function useLocalTime(clip: Clip): number {
  return useVideoStore((s) => {
    if (!clip.keyframes) return 0
    const fps = viewOf(s).fps || 30
    return Math.max(0, Math.min(clip.duration, Math.round((s.currentTime - clip.start) * fps) / fps))
  })
}

/** One numeric property in the inspector with its keyframe diamond. Animated, the slider shows the value at the
 * playhead and a change sets (or adds) the key there; not animated, it edits the clip's own value. */
export function PropRow({ clip, prop, min, max, step, format, className, onChange, disabled }: {
  clip: Clip; prop: ClipProp; min: number; max: number; step: number; format: (v: number) => string; className: string; onChange: (c: Clip) => void; disabled?: boolean
}) {
  const t = useLocalTime(clip)
  // the playhead read when the editor acts (useLocalTime follows it only while the clip is animated)
  const now = () => { const st = getState(); const fps = viewOf(st).fps || 30; return Math.max(0, Math.min(clip.duration, Math.round((st.currentTime - clip.start) * fps) / fps)) }
  const playheadIn = useVideoStore((s) => s.currentTime >= clip.start - 1e-6 && s.currentTime <= clip.start + clip.duration + 1e-6)
  const animated = !!clip.keyframes?.[prop]?.length
  const v = valueAt(clip, prop, t)
  const onKey = animated && !!keyAt(clip, prop, t)
  const set = (nv: number) => {
    if (animated) onChange(setKey(clip, prop, now(), nv))
    else onChange({ ...clip, [PROP_FIELD[prop]]: prop === 'rotation' ? nv || undefined : nv })
  }
  return (
    <div className={`vw-field vw-prop${animated ? ' animated' : ''}`} data-prop={prop}>
      <label>
        <button
          type="button"
          className={`vw-kf-toggle${onKey ? ' on' : animated ? ' between' : ''}`}
          disabled={disabled || (!playheadIn && !onKey)}
          aria-pressed={onKey}
          aria-label={onKey ? `Remove the ${PROP_LABEL[prop]} keyframe at the playhead` : `Add a ${PROP_LABEL[prop]} keyframe at the playhead`}
          data-tip={!playheadIn ? 'Put the playhead over the clip to add a keyframe' : onKey ? 'Remove the keyframe at the playhead' : animated ? 'Add a keyframe at the playhead (animated)' : 'Animate: add a keyframe at the playhead'}
          onClick={() => onChange(toggleKey(clip, prop, now()))}
        ><i className="vw-diamond" aria-hidden="true" /></button>
        {PROP_LABEL[prop].replace(/^Crop /, '').replace(/^\w/, (c) => c.toUpperCase())} <em>{format(v)}</em>
      </label>
      <Slider className={className} min={min} max={max} step={step} value={v} onChange={set} />
    </div>
  )
}

export const PROP_RANGES: Record<ClipProp, { min: number; max: number; step: number }> = {
  x: { min: -1, max: 1, step: 0.005 }, y: { min: -1, max: 1, step: 0.005 }, scale: { min: 0.1, max: 4, step: 0.01 },
  rotation: { min: -180, max: 180, step: 1 }, opacity: { min: 0, max: 1, step: 0.05 },
  cropL: { min: 0, max: 0.45, step: 0.005 }, cropR: { min: 0, max: 0.45, step: 0.005 }, cropT: { min: 0, max: 0.45, step: 0.005 }, cropB: { min: 0, max: 0.45, step: 0.005 },
  volume: { min: 0, max: 1, step: 0.05 },
}
export { PROPS }

// ---------------------------------------------------------------- inspector: speed

const fmtSpeed = (v: number) => `${v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(2).replace(/\.?0+$/, '') : v.toFixed(2)}×`

/** Speed: a constant (0.1–10×), a ramp (presets, then an editable curve), freeze frames at the playhead, reverse and
 * keep pitch. Every change keeps the clip's sound with it and moves the clips after it by the change in length. */
export function SpeedSection({ clip, locked, flash }: { clip: Clip; locked: boolean; flash: (s: string) => void }) {
  const ramp = rampOf(clip)
  const speed = constantSpeed(clip)
  // a boolean, so the panel does not redraw on every frame of playback; the time itself is read on the click
  const canFreeze = useVideoStore((s) => { const l = s.currentTime - clip.start; return l > 1e-3 && l < clip.duration - 1e-3 && !isFrozenAt(clip, l) })
  const [draft, setDraft] = useState<string | null>(null)
  const retime = (f: (c: Clip) => Clip) => { if (!getState().retime(clip.id, f)) flash('That change would move a clip on a locked track. Unlock it first.') }
  const commit = (raw: string) => {
    setDraft(null)
    const v = Number(raw.replace(/[×x]/g, '').trim())
    if (Number.isFinite(v) && v > 0) retime((c) => withConstantSpeed(c, v))
  }
  const span = Math.max(0, clip.out - clip.in)
  const audio = clip.kind === 'audio' || !!clip.linkId
  return (
    <div className="vw-speed" aria-label="Speed">
      <div className="vw-subhead">Speed</div>
      <div className="vw-speed-row">
        <input
          type="text"
          inputMode="decimal"
          className="vw-speed-input mono"
          aria-label="Speed (0.1 to 10)"
          disabled={locked || !!ramp}
          value={draft ?? (ramp ? 'Ramp' : fmtSpeed(speed))}
          onFocus={(e) => { setDraft(String(speed)); requestAnimationFrame(() => e.target.select()) }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); else if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur() } }}
        />
        <div className="vw-speed-chips" role="group" aria-label="Speed presets">
          {[0.5, 1, 2, 4].map((v) => (
            <button key={v} type="button" className={`btn xs subtle${!ramp && Math.abs(speed - v) < 1e-6 ? ' on' : ''}`} disabled={locked} onClick={() => retime((c) => withConstantSpeed(c, v))}>{v}×</button>
          ))}
        </div>
      </div>
      <div className="vw-speed-row">
        <MenuButton
          label={ramp ? 'Ramp' : 'Speed ramp'}
          icon="trendingUp"
          className="xs subtle vw-ramp-menu"
          menuClassName="vw-solid"
          items={[
            ...Object.entries(RAMP_PRESETS).map(([k, p]) => ({ label: p.label, hint: p.hint, onClick: () => retime((c) => withRampPreset(c, k)) })),
            { divider: true },
            { label: 'No ramp (constant speed)', disabled: !ramp, onClick: () => retime((c) => withConstantSpeed({ ...c, speed: undefined }, ramp ? ramp[0].v : 1)) },
          ]}
        />
        <button type="button" className="btn xs subtle vw-freeze" disabled={locked || !canFreeze} onClick={() => { const local = getState().currentTime - clip.start; retime((c) => withFreeze(c, Math.round(local * 30) / 30, 2)) }} data-tip={canFreeze ? 'Hold the frame at the playhead for 2 s (the clip gets 2 s longer)' : 'Put the playhead inside the clip'}>
          <Icon name="pause" size={12} />Freeze frame
        </button>
      </div>
      {ramp && <RampEditor clip={clip} disabled={locked} onChange={(keys) => retime((c) => withRamp(c, keys))} />}
      {!!clip.freezes?.length && (
        <ul className="vw-freezes">
          {clip.freezes.map((f, i) => (
            <li key={`${f.at}-${i}`}>
              <span>Freeze {f.dur.toFixed(1)} s at {formatShortTime(clip.start + f.at)}</span>
              <IconButton icon="x" size={12} tip="Remove this freeze" disabled={locked} onClick={() => retime((c) => withoutFreeze(c, i))} />
            </li>
          ))}
        </ul>
      )}
      <Switch checked={!!clip.reverse} onChange={(on) => retime((c) => withReverse(c, on))} label="Reverse" />
      {audio && <Switch checked={clip.preservePitch !== false} onChange={(on) => retime((c) => ({ ...c, preservePitch: on ? undefined : false }))} label="Keep the voice's pitch" />}
      <p className="vw-hint vw-speed-sum">Plays {span.toFixed(1)} s of the file in {clip.duration.toFixed(1)} s{clip.linkId ? '; its sound follows' : ''}. Clips after it move with the change.</p>
    </div>
  )
}

/** The speed ramp as a curve: speed (log scale, 0.1–10×) over the clip. Drag a point; double-click to add one;
 * right-click a point to remove it. */
function RampEditor({ clip, onChange, disabled }: { clip: Clip; onChange: (keys: Keyframe[]) => void; disabled?: boolean }) {
  const ramp = rampOf(clip) ?? []
  const svg = useRef<SVGSVGElement>(null)
  const W = 260
  const H = 116
  const PADX = 10
  const GUTTER = 30 // the speed labels sit right of the plot, clear of the points
  const PADY = 10
  // the time scale is held while dragging (the clip's length changes with the ramp)
  const scale = useRef<number | null>(null)
  const D = scale.current ?? Math.max(0.1, clip.duration, ...ramp.map((k) => k.t))
  const lg = (v: number) => Math.log10(Math.max(SPEED_MIN, Math.min(SPEED_MAX, v)))
  const xOf = (t: number) => PADX + (t / D) * (W - PADX - GUTTER)
  const yOf = (v: number) => PADY + ((1 - lg(v)) / 2) * (H - PADY * 2)
  const at = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect()
    const x = (e.clientX - r.left) * (W / r.width)
    const y = (e.clientY - r.top) * (H / r.height)
    const t = Math.max(0, Math.min(D, ((x - PADX) / (W - PADX - GUTTER)) * D))
    let v = 10 ** (1 - ((y - PADY) / (H - PADY * 2)) * 2)
    if (Math.abs(v - 1) < 0.06) v = 1
    return { t: Math.round(t * 100) / 100, v: Math.round(Math.max(SPEED_MIN, Math.min(SPEED_MAX, v)) * 100) / 100 }
  }
  const drag = useRef<number | null>(null)
  const n = 80
  const pts = Array.from({ length: n + 1 }, (_, i) => { const t = (i / n) * D; return `${xOf(t).toFixed(1)},${yOf(speedAt(clip, t)).toFixed(1)}` }).join(' ')
  return (
    <div className="vw-ramp">
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className="vw-ramp-svg"
        role="group"
        aria-label="Speed ramp: speed over the clip"
        onPointerMove={(e) => {
          const i = drag.current
          if (i == null) return
          const p = at(e)
          onChange(ramp.map((k, j) => (j === i ? { ...k, t: p.t, v: p.v } : k)))
        }}
        onPointerUp={() => { drag.current = null; scale.current = null }}
        onDoubleClick={(e) => { if (disabled) return; const p = at(e); onChange([...ramp, { t: p.t, v: p.v, ease: 'easeInOut' }]) }}
      >
        {[0.25, 0.5, 1, 2, 4].map((v) => (
          <g key={v}>
            <line x1={PADX} x2={W - GUTTER + 4} y1={yOf(v)} y2={yOf(v)} className={`vw-ramp-grid${v === 1 ? ' one' : ''}`} />
            <text x={W - 4} y={yOf(v) + 3} className="vw-ramp-label">{v}×</text>
          </g>
        ))}
        <polyline points={pts} className="vw-ramp-curve" />
        {ramp.map((k, i) => (
          <circle key={i} cx={xOf(k.t)} cy={yOf(k.v)} r={6} className="vw-ramp-pt"
            onPointerDown={(e) => { if (disabled) return; e.stopPropagation(); (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId); drag.current = i; scale.current = D; getState().beginGesture() }}
            onContextMenu={(e) => { e.preventDefault(); if (!disabled && ramp.length > 2) onChange(ramp.filter((_, j) => j !== i)) }}
          ><title>{`${fmtSpeed(k.v)} at ${k.t.toFixed(2)} s`}</title></circle>
        ))}
      </svg>
      <p className="vw-hint">Drag a point · double-click to add one · right-click a point to remove it</p>
    </div>
  )
}

// ---------------------------------------------------------------- paste attributes

export function PasteAttributesDialog({ onClose, flash }: { onClose: () => void; flash: (s: string) => void }) {
  const source = useVideoStore((s) => s.clipboard?.[0])
  const targets = useVideoStore(useShallow((s) => { const v = viewOf(s); return s.selectedIds.map((id) => v.clips.find((c) => c.id === id)).filter((c): c is Clip => !!c) }))
  const offered = source ? attrGroupsFor(source).filter((g) => targets.some((t) => attrGroupsFor(t).includes(g))) : []
  const [pick, setPick] = useState<Set<AttrGroup>>(() => new Set(offered.filter((g) => g !== 'speed')))
  return (
    <Dialog
      title="Paste attributes"
      kicker={source ? `From ${source.title}` : 'Nothing copied'}
      onClose={onClose}
      width={420}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn primary vw-paste-attrs-go" disabled={!pick.size || !targets.length} onClick={() => { const r = getState().pasteAttributes([...pick]); const kept = r.refused ? ` ${r.refused} kept ${r.refused === 1 ? 'its' : 'their'} speed: the change would move a clip linked to one on a locked track.` : ''; flash(r.ok ? `Pasted onto ${targets.length} clip${targets.length === 1 ? '' : 's'}.${kept}` : r.refused ? `Nothing pasted.${kept}` : 'Nothing changed (locked, or the same values)'); onClose() }}>Paste</button>
      </>}
    >
      {!source || !targets.length ? <p className="vw-confirm-body">Copy a clip (Ctrl+C), select the clips to change, then paste its attributes (Ctrl+Alt+V).</p> : (
        <div className="vw-paste-attrs">
          <p className="vw-confirm-body">Onto {targets.length} selected clip{targets.length === 1 ? '' : 's'}. Each takes the parts that apply to it.</p>
          {offered.map((g) => <Check key={g} checked={pick.has(g)} onChange={(on) => setPick((s) => { const n = new Set(s); if (on) n.add(g); else n.delete(g); return n })} label={ATTR_LABEL[g]} hint={g === 'speed' ? 'changes the clip’s length; later clips move' : undefined} />)}
        </div>
      )}
    </Dialog>
  )
}

// ---------------------------------------------------------------- the keyboard map

export const VIDEO_SHORTCUTS: { group: string; rows: [string, string][] }[] = [
  { group: 'Play', rows: [['Space', 'Play / pause'], ['J / K / L', 'Back / stop / forward (press again: 2×, 4×)'], ['← / →', 'One frame (Shift: 10)'], ['Home / End', 'Start / end'], ['Shift + M  /  Alt + M', 'Next / previous marker']] },
  { group: 'Tools', rows: [['V', 'Select'], ['B', 'Ripple trim'], ['N', 'Roll'], ['Y', 'Slip'], ['U', 'Slide'], ['Ctrl + M', 'Magnetic main track on / off']] },
  { group: 'Edit', rows: [['S', 'Split at the playhead'], ['Del', 'Delete (leave the gap)'], ['Shift + Del', 'Ripple delete (close the gap)'], ['I / O', 'Set in / out'], ['Alt + X', 'Clear in and out'], [';', 'Lift the in–out range (or the selection)'], ["'", 'Extract it (close the gap)']] },
  { group: 'Clipboard and groups', rows: [['Ctrl + C / V', 'Copy / paste at the playhead (insert or overwrite)'], ['Ctrl + Alt + V', 'Paste attributes'], ['Shift / Ctrl + click', 'Add to the selection'], ['Ctrl + G', 'Group'], ['Ctrl + Shift + G', 'Ungroup'], ['Ctrl + Alt + G', 'Make a compound clip'], ['Enter / double-click', 'Open a compound clip'], ['Esc', 'Close it / deselect']] },
  { group: 'Markers and keyframes', rows: [['M', 'Add a marker at the playhead'], ['Double-click a flag', 'Name it'], ['◆ in the inspector', 'Keyframe at the playhead'], ['Drag a ◆ on the lane', 'Move a keyframe'], ['Right-click a ◆', 'Ease and custom curve'], ['Double-click the lane', 'Add a keyframe']] },
  { group: 'Project', rows: [['Ctrl + S', 'Save'], ['Ctrl + Shift + S', 'Save as'], ['Ctrl + Z', 'Undo'], ['Ctrl + Y  /  Ctrl + Shift + Z', 'Redo'], ['?', 'This list']] },
]

export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Video keyboard shortcuts" kicker="Reference" onClose={onClose} width={900}>
      <div className="keys-groups vw-keys">
        {VIDEO_SHORTCUTS.map((g) => (
          <section key={g.group}>
            <h4>{g.group}</h4>
            {g.rows.map(([k, d]) => <div key={k} className="krow"><span>{d}</span><kbd>{k}</kbd></div>)}
          </section>
        ))}
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------- compound breadcrumb

export function CompoundBar() {
  const path = useVideoStore((s) => s.compoundPath)
  const project = useVideoStore((s) => s.project)
  if (!path.length) return null
  // the names along the path
  const names: string[] = []
  let clips = project.clips
  for (const id of path) {
    const c = clips.find((x) => x.id === id)
    names.push(c?.title ?? 'Compound clip')
    clips = c?.compound?.clips ?? []
  }
  return (
    <nav className="vw-compound-bar" aria-label="Open compound clip">
      <button type="button" className="btn xs subtle vw-cb-back" onClick={() => getState().closeCompound(path.length - 1)} data-tip="Close the compound (Esc)"><Icon name="chevLeft" size={12} />Back</button>
      <button type="button" className="vw-cb-crumb" onClick={() => getState().closeCompound(0)}>Main timeline</button>
      {names.map((n, i) => (
        <span key={i} className="vw-cb-step"><Icon name="chevRight" size={11} />{i < names.length - 1 ? <button type="button" className="vw-cb-crumb" onClick={() => getState().closeCompound(i + 1)}>{n}</button> : <b>{n}</b>}</span>
      ))}
      <span className="vw-cb-note">Editing inside the compound: the monitor plays it on its own.</span>
    </nav>
  )
}
