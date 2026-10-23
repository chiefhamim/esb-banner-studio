import { useCallback, useRef } from 'react'
import type { KeyboardEvent, PointerEvent as RPointerEvent } from 'react'

/** Panel sizes the user dragged, kept between launches. Widths are in px (4 px grid: 312 = 13 × 24). */
export interface LayoutState { lw: number; rw: number; dock: number }
export const DEFAULT_LAYOUT: LayoutState = { lw: 312, rw: 312, dock: 336 }
export const LIMITS = { lw: [264, 480], rw: [264, 480], dock: [120, 640] } as const
const KEY = 'esb-banner-studio/layout'

export function loadLayout(): LayoutState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<LayoutState>
    const pick = (k: keyof LayoutState) => (typeof raw[k] === 'number' ? Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], raw[k] as number)) : DEFAULT_LAYOUT[k])
    return { lw: pick('lw'), rw: pick('rw'), dock: pick('dock') }
  } catch { return DEFAULT_LAYOUT }
}
export function saveLayout(l: LayoutState) { try { localStorage.setItem(KEY, JSON.stringify(l)) } catch { /* ignore */ } }

/**
 * A drag handle. While dragging it reports through `onLive` (apply to a CSS variable directly — no React render per frame,
 * one write per animation frame), and calls `onCommit` once on release. Double-click or Home resets; arrow keys nudge.
 */
export function Splitter({ axis, side, value, min, max, onLive, onCommit, reset, label, root }: {
  axis: 'vert' | 'horz'
  /** Which edge of its parent the handle sits on. For a vertical handle on the left panel that's 'r'. */
  side?: 'l' | 'r'
  value: number
  min: number
  max: number
  onLive: (v: number) => void
  onCommit: (v: number) => void
  reset: number
  label: string
  /** Element that gets the `resizing` class so nothing underneath reacts during the drag. */
  root: () => HTMLElement | null
}) {
  const ref = useRef<HTMLDivElement>(null)
  const st = useRef({ start: 0, from: 0, v: value, raf: 0 })
  // Dragging the right-hand handle of the left panel to the right grows it; the right panel's left handle works the other way round, and the dock's top handle grows it upward.
  const sign = axis === 'horz' || side === 'l' ? -1 : 1
  const clamp = useCallback((v: number) => Math.round(Math.min(max, Math.max(min, v))), [min, max])

  const down = (e: RPointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    ref.current?.setPointerCapture(e.pointerId)
    st.current = { start: axis === 'vert' ? e.clientX : e.clientY, from: value, v: value, raf: 0 }
    ref.current?.classList.add('drag')
    const r = root(); r?.classList.add('resizing'); if (axis === 'horz') r?.classList.add('v')
  }
  const move = (e: RPointerEvent) => {
    if (!ref.current?.hasPointerCapture(e.pointerId)) return
    const s = st.current
    s.v = clamp(s.from + sign * ((axis === 'vert' ? e.clientX : e.clientY) - s.start))
    if (!s.raf) s.raf = requestAnimationFrame(() => { s.raf = 0; onLive(s.v) })
  }
  const up = (e: RPointerEvent) => {
    if (!ref.current?.hasPointerCapture(e.pointerId)) return
    ref.current.releasePointerCapture(e.pointerId)
    ref.current.classList.remove('drag')
    const r = root(); r?.classList.remove('resizing', 'v')
    cancelAnimationFrame(st.current.raf); st.current.raf = 0
    onLive(st.current.v)
    onCommit(st.current.v)
  }
  const key = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 48 : 16
    const dir = axis === 'vert' ? (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0) : (e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0)
    if (e.key === 'Home') { e.preventDefault(); e.stopPropagation(); onLive(reset); onCommit(reset); return }
    if (!dir) return
    e.preventDefault(); e.stopPropagation() // arrows resize the panel here, they must not also nudge the selected layer
    const v = clamp(value + sign * dir * step)
    onLive(v); onCommit(v)
  }

  return (
    <div ref={ref} className={`splitter ${axis}${axis === 'vert' ? ' ' + (side ?? 'r') : ''}`} role="separator" aria-orientation={axis === 'vert' ? 'vertical' : 'horizontal'}
      aria-label={label} aria-valuenow={value} aria-valuemin={min} aria-valuemax={max} tabIndex={0} data-tip={`Drag to resize · double-click to reset`} data-tip-pos={axis === 'vert' ? (side === 'l' ? 'right' : 'right') : 'top'}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onDoubleClick={() => { onLive(reset); onCommit(reset) }} onKeyDown={key}>
      <i className="grab" />
    </div>
  )
}
