import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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

  // ---- the fold choreography. The column keeps its content rendered (at the width it had) while the track travels, so it
  // slides and fades like a drawer instead of snapping blank; the rail crossfades in. `col-settled` (rail, content
  // display:none) is only set once the travel is over. All class work is on the column element, outside React's className.
  const prevCollapsed = useRef<boolean | null>(null)
  const timer = useRef(0)
  const seenW = useRef(col.w)
  useEffect(() => {
    const el = ref.current?.parentElement
    if (!el) return
    const ro = new ResizeObserver(() => { if (!col.collapsed && !el.classList.contains('col-anim')) seenW.current = el.getBoundingClientRect().width })
    ro.observe(el)
    return () => ro.disconnect()
  }, [col.collapsed])
  useLayoutEffect(() => {
    const el = ref.current?.parentElement
    if (!el) return
    const prev = prevCollapsed.current
    prevCollapsed.current = col.collapsed
    if (prev === null) return
    if (prev === col.collapsed) return
    window.clearTimeout(timer.current)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.classList.remove('col-anim', 'col-anim-in', 'col-anim-out')
    if (reduce) return
    // the content is pinned to the width it has when open (minus its own margins and the column's border), so it is
    // clipped by the shrinking column and revealed by the growing one instead of reflowing at every width in between
    const open = Math.round(col.collapsed ? seenW.current || col.w : col.w)
    const chrome = el.offsetWidth - el.clientWidth
    const kids = Array.from(el.children).filter((c): c is HTMLElement => c instanceof HTMLElement && !c.classList.contains('col-rail') && !c.classList.contains('col-handle') && !c.classList.contains('col-fold'))
    for (const k of kids) {
      const cs = getComputedStyle(k)
      k.style.width = Math.max(0, open - chrome - (parseFloat(cs.marginLeft) || 0) - (parseFloat(cs.marginRight) || 0)) + 'px'
      k.style.flex = 'none'
      k.style.minWidth = '0'
    }
    el.classList.add('col-anim', col.collapsed ? 'col-anim-in' : 'col-anim-out')
    timer.current = window.setTimeout(() => {
      el.classList.remove('col-anim', 'col-anim-in', 'col-anim-out')
      for (const k of kids) { k.style.removeProperty('width'); k.style.removeProperty('flex'); k.style.removeProperty('min-width') }
    }, 420)
  }, [col.collapsed, col.w])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const edge = col.side === 'left' ? 'r' : 'l'
  return (
    <>
      <button type="button" className={'col-fold ' + col.side} aria-label={col.collapsed ? `Expand ${label}` : `Collapse ${label}`} data-tip={col.collapsed ? 'Expand' : 'Collapse'} data-tip-pos={col.side === 'left' ? 'right' : 'left'} 
        onClick={toggle}>
        <Icon name={col.side === 'left' ? 'panelLeft' : 'panelRight'} size={16} />
      </button>
    <div ref={ref} className={`splitter vert ${edge} col-handle`} role="separator" aria-orientation="vertical" aria-label={label}
      aria-valuenow={col.px} aria-valuemin={RAIL_W} aria-valuemax={spec.max} aria-expanded={!col.collapsed} tabIndex={0}
      data-tip={col.collapsed ? 'Drag or double-click to expand' : 'Drag to resize · double-click to collapse'} data-tip-pos={col.side === 'left' ? 'right' : 'left'}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onDoubleClick={toggle} onKeyDown={key}>
      <i className="grab" />
    </div>
    </>
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
  // on expand the rail stays mounted a moment and fades out while the content fades in (it is absolutely placed, so it takes no room)
  const [present, setPresent] = useState(col.collapsed)
  useEffect(() => {
    if (col.collapsed) { setPresent(true); return }
    const t = window.setTimeout(() => setPresent(false), 220)
    return () => window.clearTimeout(t)
  }, [col.collapsed])
  if (!col.collapsed && !present) return null
  const pos = col.side === 'left' ? 'right' : 'left'
  const icon = (i: RailItem['icon']) => (typeof i === 'string' ? <Icon name={i as IconName} size={17} /> : i)
  return (
    <nav className={'col-rail ' + col.side + (col.collapsed ? '' : ' leaving')} aria-label={label} aria-hidden={!col.collapsed || undefined}>
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
