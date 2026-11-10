import { useRef } from 'react'
import type { KeyboardEvent, PointerEvent as RPointerEvent, ReactNode } from 'react'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import { RAIL_W, clampW, resolveDrag, resolveKey, setColumnState } from './sideColumnState'
import type { ColState, SideColumn } from './sideColumnState'

/**
 * The drag handle on a side column's inner edge (shares `.splitter` with the other resize handles). Drag to resize;
 * past `collapseAt` it snaps to the icon rail, and a rail pulled outward opens again. Double-click or Enter toggles,
 * arrows resize (Shift = bigger steps), Home returns to the default width.
 *
 * While dragging it writes the width through `apply` (a CSS variable or grid template — no React render per frame) and
 * only touches the column's state when the rail flips, so the content swaps for the rail as you cross the line.
 */
export function ColumnHandle({ col, label, root, apply, max }: {
  col: SideColumn
  label: string
  /** Element that gets `resizing` (no transitions, no hover under the pointer) during the drag. */
  root: () => HTMLElement | null
  /** Write a width straight to the layout. */
  apply: (px: number) => void
  /** A tighter maximum for this window (e.g. 38 % of it). */
  max?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const spec = max ? { ...col.spec, max: Math.max(col.spec.min, Math.min(col.spec.max, max)) } : col.spec
  const st = useRef<{ start: number; from: number; fromCollapsed: boolean; cur: ColState; raf: number; moved: boolean }>({ start: 0, from: 0, fromCollapsed: false, cur: col, raf: 0, moved: false })
  // the left column's handle is on its right edge, so moving right grows it; the right column's the other way round
  const sign = col.side === 'left' ? 1 : -1

  const down = (e: RPointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    ref.current?.setPointerCapture(e.pointerId)
    // start from the width on screen: a desk's CSS may clamp the saved width, or not use it until the editor drags
    const onScreen = ref.current?.parentElement?.getBoundingClientRect().width
    st.current = { start: e.clientX, from: col.collapsed ? RAIL_W : Math.round(onScreen || col.px), fromCollapsed: col.collapsed, cur: { w: col.w, collapsed: col.collapsed }, raf: 0, moved: false }
  }
  const move = (e: RPointerEvent) => {
    if (!ref.current?.hasPointerCapture(e.pointerId)) return
    const s = st.current
    const dx = e.clientX - s.start
    if (!s.moved && Math.abs(dx) < 3) return
    if (!s.moved) { ref.current.classList.add('drag'); root()?.classList.add('resizing') }
    s.moved = true
    // folding keeps the width it had on screen, so pulling it open again lands exactly there
    const next = resolveDrag(s.from + sign * dx, spec, s.fromCollapsed ? col.w : s.from, s.fromCollapsed)
    const flipped = next.collapsed !== s.cur.collapsed
    s.cur = next
    // crossing the line swaps content and rail at once; the saved width stays until release
    if (flipped) setColumnState(col.id, { w: col.w, collapsed: next.collapsed }, false)
    if (!s.raf) s.raf = requestAnimationFrame(() => { s.raf = 0; apply(s.cur.collapsed ? RAIL_W : s.cur.w) })
  }
  const up = (e: RPointerEvent) => {
    if (!ref.current?.hasPointerCapture(e.pointerId)) return
    ref.current.releasePointerCapture(e.pointerId)
    ref.current.classList.remove('drag')
    cancelAnimationFrame(st.current.raf); st.current.raf = 0
    const s = st.current
    if (s.moved) {
      apply(s.cur.collapsed ? RAIL_W : s.cur.w)
      setColumnState(col.id, s.cur)
      // let the final width land before transitions come back
      requestAnimationFrame(() => root()?.classList.remove('resizing'))
    }
  }
  /** Fold or open; folding remembers the width on screen (a desk's CSS may show less than the saved width). */
  const toggle = () => {
    if (col.collapsed) { col.expand(); return }
    const onScreen = ref.current?.parentElement?.getBoundingClientRect().width
    col.set({ w: onScreen ? clampW(onScreen, spec) : col.w, collapsed: true })
  }
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggle(); return }
    if (e.key === 'Home') { e.preventDefault(); e.stopPropagation(); col.set({ w: col.spec.def, collapsed: false }); return }
    const raw = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!raw) return
    e.preventDefault(); e.stopPropagation() // arrows resize the column here, they must not also nudge a selected layer
    col.set(resolveKey({ w: clampW(col.w, spec), collapsed: col.collapsed }, (raw * sign) as 1 | -1, e.shiftKey ? 48 : 16, spec))
  }

  const edge = col.side === 'left' ? 'r' : 'l'
  return (
    <div ref={ref} className={`splitter vert ${edge} col-handle`} role="separator" aria-orientation="vertical" aria-label={label}
      aria-valuenow={col.px} aria-valuemin={RAIL_W} aria-valuemax={spec.max} aria-expanded={!col.collapsed} tabIndex={0}
      data-tip={col.collapsed ? 'Drag or double-click to expand' : 'Drag to resize · double-click to collapse'} data-tip-pos={col.side === 'left' ? 'right' : 'left'}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onDoubleClick={toggle} onKeyDown={key}>
      <i className="grab" />
      {!col.collapsed && (
        <button type="button" className="col-fold" aria-label={`Collapse ${label}`} data-tip={`Collapse ${label}`} data-tip-pos={col.side === 'left' ? 'right' : 'left'} tabIndex={-1}
          onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); toggle() }}>
          <Icon name={col.side === 'left' ? 'chevLeft' : 'chevRight'} size={12} strokeWidth={2.4} />
        </button>
      )}
    </div>
  )
}

export interface RailItem {
  id: string
  icon: IconName | ReactNode
  label: string
  on?: boolean
  onClick: () => void
}

/**
 * The column folded to icons: one button per section of the column (a click opens the column at its last width and
 * shows that section), then the column's own primary actions at the foot, doing exactly what their full buttons do.
 */
export function ColumnRail({ col, label, items, actions = [] }: { col: SideColumn; label: string; items: RailItem[]; actions?: (RailItem & { primary?: boolean; disabled?: boolean })[] }) {
  if (!col.collapsed) return null
  const pos = col.side === 'left' ? 'right' : 'left'
  const icon = (i: RailItem['icon']) => (typeof i === 'string' ? <Icon name={i as IconName} size={17} /> : i)
  return (
    <nav className={'col-rail ' + col.side} aria-label={label}>
      <button type="button" className="col-rail-btn col-rail-open" aria-label={`Expand ${label}`} data-tip={`Expand ${label}`} data-tip-pos={pos} onClick={col.expand}>
        <Icon name={col.side === 'left' ? 'chevRight' : 'chevLeft'} size={15} />
      </button>
      <span className="col-rail-sep" aria-hidden />
      <div className="col-rail-items">
        {items.map((it) => (
          <button key={it.id} type="button" className={'col-rail-btn' + (it.on ? ' on' : '')} aria-label={it.label} aria-current={it.on || undefined}
            data-tip={it.label} data-tip-pos={pos} onClick={() => { col.expand(); it.onClick() }}>
            {icon(it.icon)}
          </button>
        ))}
      </div>
      {actions.length > 0 && (
        <div className="col-rail-foot">
          {actions.map((a) => (
            <button key={a.id} type="button" className={'col-rail-btn' + (a.primary ? ' primary' : '')} aria-label={a.label} data-tip={a.label} data-tip-pos={pos} disabled={a.disabled} onClick={a.onClick}>
              {icon(a.icon)}
            </button>
          ))}
        </div>
      )}
    </nav>
  )
}

/** Class for the column's own element: hides everything but the rail and the handle while it is a rail. */
export const railClass = (col: SideColumn) => (col.collapsed ? ' is-railed' : '')
