import { createPortal } from 'react-dom'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import { CATEGORIES, INK, LINK_PILL, STRIPE_COLORS, WEEKDAY_RED } from '../core/tokens'

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

// ------------------------------------------------------------------ Popover
type Anchor = { el: HTMLElement } | { x: number; y: number }

/** Open popovers, oldest first. A click inside a popover opened *from* another one (a dropdown inside the calendar) is "inside" both. */
const popStack: (HTMLElement | null)[] = []

export function Popover({ anchor, onClose, children, align = 'start', gap = 6, className = '', minWidth }: {
  anchor: Anchor; onClose: () => void; children: ReactNode; align?: 'start' | 'center' | 'end'; gap?: number; className?: string; minWidth?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const pop = ref.current
    if (!pop) return
    const pw = pop.offsetWidth, ph = pop.offsetHeight
    let left: number, top: number
    if ('el' in anchor) {
      const r = anchor.el.getBoundingClientRect()
      left = align === 'end' ? r.right - pw : align === 'center' ? Math.round(r.left + r.width / 2 - pw / 2) : r.left
      // open below unless there is more room above; either way the list scrolls inside the room it has, so a
      // long menu (a provider's 40 models) never runs off the window or pins itself to the top edge
      const below = window.innerHeight - r.bottom - gap - 8, above = r.top - gap - 8
      const up = ph > below && above > below
      const room = Math.min(540, up ? above : below)
      pop.style.maxHeight = Math.max(96, room) + 'px'
      top = up ? r.top - gap - Math.min(ph, room) : r.bottom + gap
      if (minWidth === undefined) pop.style.minWidth = r.width + 'px'
    } else {
      left = align === 'center' ? Math.round(anchor.x - pw / 2) : align === 'end' ? anchor.x - pw : anchor.x
      top = anchor.y
      if (top + ph > window.innerHeight - 8) top = Math.max(8, anchor.y - ph)
    }
    left = clamp(left, 8, window.innerWidth - pw - 8)
    setPos({ left, top })
  }, [anchor, align, gap, minWidth])

  // register once per popover (mount / unmount) so re-renders never reshuffle the stack order
  useEffect(() => {
    const el = ref.current
    popStack.push(el)
    return () => { const i = popStack.indexOf(el); if (i >= 0) popStack.splice(i, 1) }
  }, [])

  useEffect(() => {
    const el = ref.current
    const down = (e: PointerEvent) => {
      const t = e.target as Node
      const mine = popStack.indexOf(el)
      if (popStack.slice(Math.max(0, mine)).some((p) => p?.contains(t))) return // inside me, or inside a popover opened from me
      if ('el' in anchor && anchor.el.contains(t)) return
      onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || popStack[popStack.length - 1] !== el) return // only the top-most popover reacts
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [anchor, onClose])

  return createPortal(
    <div ref={ref} className={'popover ' + className} style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, minWidth, visibility: pos ? 'visible' : 'hidden' }}>
      {children}
    </div>,
    document.body,
  )
}

// ------------------------------------------------------------------ Tooltips
/** One tooltip for the whole app, drawn in the top layer so no card / panel can clip or cover it. Any element with data-tip gets one. */
export function Tooltips() {
  const [tip, setTip] = useState<{ text: string; r: DOMRect; pos: string } | null>(null)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let timer = 0
    let cur: HTMLElement | null = null
    const hide = () => { window.clearTimeout(timer); cur = null; setTip(null); setAt(null) }
    const over = (e: PointerEvent) => {
      // A plain title="" shows the operating system's own grey tooltip — the generic hover on the site pill and
      // Re-translate. Any title met under the pointer becomes this tooltip instead (aria-label keeps it for readers).
      const titled = (e.target as Element | null)?.closest?.('[title]:not(iframe):not(svg *)') as HTMLElement | null
      if (titled && titled.title) {
        if (!titled.dataset.tip) {
          if (!titled.hasAttribute('aria-label') && !titled.textContent?.trim()) titled.setAttribute('aria-label', titled.title)
          titled.dataset.tip = titled.title
        }
        titled.removeAttribute('title')
      }
      const el = (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null
      if (el === cur) return
      hide()
      if (!el || !el.dataset.tip) return
      cur = el
      timer = window.setTimeout(() => setTip({ text: el.dataset.tip!, r: el.getBoundingClientRect(), pos: el.dataset.tipPos ?? 'bottom' }), 420)
    }
    window.addEventListener('pointerover', over, true)
    window.addEventListener('pointerdown', hide, true)
    window.addEventListener('keydown', hide, true)
    window.addEventListener('scroll', hide, true)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointerover', over, true)
      window.removeEventListener('pointerdown', hide, true)
      window.removeEventListener('keydown', hide, true)
      window.removeEventListener('scroll', hide, true)
    }
  }, [])
  useLayoutEffect(() => {
    if (!tip || !ref.current) return
    const w = ref.current.offsetWidth, h = ref.current.offsetHeight, r = tip.r
    let left = r.left + r.width / 2 - w / 2
    let top = r.bottom + 8
    if (tip.pos === 'top') top = r.top - h - 8
    if (tip.pos === 'right') { left = r.right + 10; top = r.top + r.height / 2 - h / 2 }
    if (top + h > window.innerHeight - 6) top = r.top - h - 8
    setAt({ left: clamp(left, 6, window.innerWidth - w - 6), top: clamp(top, 6, window.innerHeight - h - 6) })
  }, [tip])
  // "Undo (Ctrl+Z)" → the label, then the shortcut as a key chip; other parentheses stay part of the text
  const m = tip?.text.match(/^(.*?)\s*\(((?:Ctrl|Shift|Alt|⌘|Cmd|Esc|Del|Home|End|Space|Enter|Tab|←|→|↑|↓|[A-Z0-9]|F\d+)(?:\s*[+/]\s*[^)]+)?)\)$/)
  return tip ? createPortal(
    <div ref={ref} className="tooltip" role="tooltip" style={{ left: at?.left ?? -9999, top: at?.top ?? -9999 }}>
      {m ? <><span>{m[1]}</span><kbd className="tip-key">{m[2]}</kbd></> : tip.text}
    </div>, document.body) : null
}

// ------------------------------------------------------------------ Select
export interface Opt<T> { value: T; label: string; hint?: string; icon?: IconName; swatch?: string }

export function Select<T extends string | number>({ value, options, onChange, className = '', align, title, prefix }: {
  value: T; options: Opt<T>[]; onChange: (v: T) => void; className?: string; align?: 'start' | 'end'; title?: string; prefix?: string
}) {
  const btn = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const cur = options.find((o) => o.value === value)
  const close = useCallback(() => setOpen(false), [])
  const openMenu = () => { setActive(Math.max(0, options.findIndex((o) => o.value === value))); setOpen(true) }
  const pick = (o: Opt<T>) => { onChange(o.value); setOpen(false); btn.current?.focus() }

  return (
    <>
      <button ref={btn} type="button" title={title} className={'select ' + className + (open ? ' open' : '')}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); openMenu(); return }
          if (!open) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % options.length) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + options.length) % options.length) }
          else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(options[active]) }
        }}>
        {cur?.icon && <Icon name={cur.icon} size={14} />}
        {cur?.swatch && <i className="swatch-dot" style={{ background: cur.swatch }} />}
        <span className="select-label">{prefix && <small>{prefix}</small>}{cur?.label ?? '—'}</span>
        <Icon name="chevDown" size={14} className="chev" />
      </button>
      {open && btn.current && (
        <Popover anchor={{ el: btn.current }} onClose={close} align={align} className="menu">
          {options.map((o, i) => (
            <button key={String(o.value)} type="button" className={'menu-item' + (o.value === value ? ' current' : '') + (i === active ? ' active' : '')}
              onPointerEnter={() => setActive(i)} onClick={() => pick(o)}>
              <span className="mi-check">{o.value === value && <Icon name="check" size={13} />}</span>
              {o.icon && <Icon name={o.icon} size={14} />}
              {o.swatch && <i className="swatch-dot" style={{ background: o.swatch }} />}
              <span className="mi-label">{o.label}</span>
              {o.hint && <span className="mi-hint">{o.hint}</span>}
            </button>
          ))}
        </Popover>
      )}
    </>
  )
}

// ------------------------------------------------------------------ Menus
export interface MenuEntry { label?: string; icon?: IconName; shortcut?: string; onClick?: () => void; disabled?: boolean; danger?: boolean; divider?: boolean; hint?: string; checked?: boolean; heading?: string }

export function MenuList({ items, onDone }: { items: MenuEntry[]; onDone: () => void }) {
  return (
    <>
      {items.map((m, i) => m.divider
        ? <hr key={i} />
        : m.heading
          ? <div key={i} className="menu-head">{m.heading}</div>
          : (
            <button key={i} type="button" disabled={m.disabled} className={'menu-item' + (m.danger ? ' danger' : '') + (m.checked ? ' checked' : '')} onClick={() => { onDone(); m.onClick?.() }}>
              <span className="mi-check">{m.checked ? <Icon name="check" size={14} strokeWidth={2.4} /> : m.icon && <Icon name={m.icon} size={14} />}</span>
              <span className="mi-label">{m.label}{m.hint && <small>{m.hint}</small>}</span>
              {m.shortcut && <span className="mi-hint">{m.shortcut}</span>}
            </button>
          ))}
    </>
  )
}

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuEntry[]; onClose: () => void }) {
  return <Popover anchor={{ x, y }} onClose={onClose} className="menu ctx" minWidth={200}><MenuList items={items} onDone={onClose} /></Popover>
}

export interface MenuDef { label: string; items: MenuEntry[] }

/** Desktop-style menu bar: click to open, hover another title to switch while open. */
export function MenuBar({ menus }: { menus: MenuDef[] }) {
  const [open, setOpen] = useState<number | null>(null)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const close = useCallback(() => setOpen(null), [])
  return (
    <div className="menubar" role="menubar">
      {menus.map((m, i) => (
        <button key={m.label} ref={(el) => { refs.current[i] = el }} type="button" role="menuitem" className={'mb-item' + (open === i ? ' open' : '')}
          onClick={() => setOpen(open === i ? null : i)} onPointerEnter={() => { if (open !== null) setOpen(i) }}>{m.label}</button>
      ))}
      {open !== null && refs.current[open] && (
        <Popover anchor={{ el: refs.current[open]! }} onClose={close} className="menu menubar-pop" minWidth={248}>
          <MenuList items={menus[open].items} onDone={close} />
        </Popover>
      )}
    </div>
  )
}

export function MenuButton({ label, icon, items, align = 'start', className = '', title }: { label?: string; icon?: IconName; items: MenuEntry[]; align?: 'start' | 'end'; className?: string; title?: string }) {
  const btn = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  return (
    <>
      <button ref={btn} type="button" title={title} className={'btn ' + className + (open ? ' open' : '')} onClick={() => setOpen((o) => !o)}>
        {icon && <Icon name={icon} size={15} />}{label}<Icon name="chevDown" size={13} className="chev" />
      </button>
      {open && btn.current && <Popover anchor={{ el: btn.current }} onClose={close} align={align} className="menu" minWidth={210}><MenuList items={items} onDone={close} /></Popover>}
    </>
  )
}

// ------------------------------------------------------------------ Buttons
export function IconButton({ icon, tip, onClick, active, disabled, size = 15, tipPos = 'bottom', className = '' }: {
  icon: IconName; tip: string; onClick?: (e: React.MouseEvent) => void; active?: boolean; disabled?: boolean; size?: number; tipPos?: 'bottom' | 'right' | 'top'; className?: string
}) {
  return (
    <button type="button" className={'ibtn ' + className + (active ? ' on' : '')} disabled={disabled} data-tip={tip} data-tip-pos={tipPos} aria-label={tip} onClick={onClick}>
      <Icon name={icon} size={size} />
    </button>
  )
}

/** Measures the active button so a single "thumb" can glide between options instead of the highlight jumping. */
/**
 * The chip behind the selected tab. When the choice changes it does not just slide: it stretches toward the new option
 * (the leading edge arrives first, the trailing edge is pulled after it), overshoots a few pixels, settles, and a soft ring
 * ripples out where it lands. Hovering a tab also tugs it a couple of pixels toward the pointer (--mag-x/--mag-y, applied
 * with the `translate` property so it never fights the press-scale transform). All of it is skipped under reduced motion.
 */
export function useSlidingThumb(value: unknown) {
  const wrap = useRef<HTMLDivElement>(null)
  const pill = useRef<HTMLElement | null>(null)
  const last = useRef<{ x: number; w: number } | null>(null)
  const moved = useRef(false)
  const [pos, setPos] = useState<{ x: number; w: number } | null>(null)
  const [ready, setReady] = useState(false)
  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    moved.current = true // this run follows a change of choice (a resize alone must not replay the motion)
    const measure = () => {
      const b = el.querySelector<HTMLElement>('button.on')
      const next = b ? { x: b.offsetLeft, w: b.offsetWidth } : null
      setPos((cur) => (cur && next && cur.x === next.x && cur.w === next.w ? cur : next))  // same place: no new state, so nothing re-runs
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    const id = requestAnimationFrame(() => setReady(true)) // no glide on first paint
    return () => { ro.disconnect(); cancelAnimationFrame(id) }
  }, [value])

  useLayoutEffect(() => {
    const from = last.current
    last.current = pos
    const el = pill.current
    if (!pos || !from || !el || !moved.current || !ready) return
    moved.current = false
    if (from.x === pos.x && from.w === pos.w) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || typeof el.animate !== 'function') return
    const dir = pos.x >= from.x ? 1 : -1
    const left = Math.min(from.x, pos.x)
    const stretch = Math.abs(pos.x - from.x) + Math.max(from.w, pos.w)
    const at = (x: number, w: number, offset: number) => ({ transform: `translateX(${x}px)`, width: `${w}px`, offset })
    const anim = el.animate([
      at(from.x, from.w, 0),
      at(left, stretch, 0.42),                       // stretched across both options, leading edge already there
      at(pos.x + dir * 3, pos.w, 0.76),              // trailing edge catches up and overshoots
      at(pos.x, pos.w, 1),
    ], { duration: 620, easing: 'cubic-bezier(.33, 0, .2, 1)' })
    anim.finished.then(() => {
      el.classList.remove('ripple'); void el.offsetWidth; el.classList.add('ripple')
      window.setTimeout(() => el.classList.remove('ripple'), 700)
    }).catch(() => { /* interrupted by the next change */ })
  }, [pos, ready])

  // magnetic tug: the tab under the pointer leans toward it
  useLayoutEffect(() => {
    const el = wrap.current
    if (!el || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    let cur: HTMLButtonElement | null = null
    const reset = (b: HTMLButtonElement | null) => { b?.style.removeProperty('--mag-x'); b?.style.removeProperty('--mag-y') }
    const move = (e: PointerEvent) => {
      const b = (e.target as Element).closest?.('button') as HTMLButtonElement | null
      if (b !== cur) { reset(cur); cur = b }
      if (!b || reduce.matches || b.disabled) return
      const r = b.getBoundingClientRect()
      const dx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2)))
      const dy = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height / 2)))
      b.style.setProperty('--mag-x', `${(dx * 3).toFixed(2)}px`)
      b.style.setProperty('--mag-y', `${(dy * 1.5).toFixed(2)}px`)
    }
    const leave = () => { reset(cur); cur = null }
    el.addEventListener('pointermove', move); el.addEventListener('pointerleave', leave)
    return () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); reset(cur) }
  }, [])

  const thumb = pos && <i ref={(node) => { pill.current = node }} className={'pill-slide' + (ready ? ' ready' : '')} style={{ width: pos.w, transform: `translateX(${pos.x}px)` }} />
  return { wrap, thumb }
}

export function Seg<T extends string | number>({ value, options, onChange, className = '' }: {
  value: T; options: { value: T; icon?: IconName; label?: string; tip?: string }[]; onChange: (v: T) => void; className?: string
}) {
  const { wrap, thumb } = useSlidingThumb(value)
  return (
    <div ref={wrap} className={'seg-ctl ' + className} role="group">
      {thumb}
      {options.map((o) => (
        <button key={String(o.value)} type="button" className={o.value === value ? 'on' : ''} data-tip={o.tip} onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} size={14} />}{o.label}
        </button>
      ))}
    </div>
  )
}

/** Sidebar tabs: same glide, full-width, with proper tab semantics. */
export function Tabs<T extends string>({ value, options, onChange, className = '' }: {
  value: T; options: { value: T; icon?: IconName; label: string }[]; onChange: (v: T) => void; className?: string
}) {
  const { wrap, thumb } = useSlidingThumb(value)
  return (
    <div ref={wrap} className={'side-tabs ' + className} role="tablist">
      {thumb}
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} aria-label={o.label} data-tip={o.icon ? o.label : undefined} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} size={15} />}<span className="tab-label">{o.label}</span>
        </button>
      ))}
    </div>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  const labelStr = typeof label === 'string' ? label : undefined
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} aria-label={labelStr} onChange={(e) => onChange(e.target.checked)} />
      <i /><span>{label}</span>
    </label>
  )
}

/** Stand-alone on/off switch for list rows (the labelled version is `Switch`). */
export function Toggle({ checked, onChange, label, small, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; small?: boolean; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} data-tip={label} disabled={disabled} className={'tgl' + (small ? ' sm' : '')} onClick={(e) => { e.stopPropagation(); onChange(!checked) }} />
}

// ------------------------------------------------------------------ Number scrubber
export function Scrub({ label, value, onChange, step = 1, min, max, unit, decimals = 1, className = '', title }: {
  label: ReactNode; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; unit?: string; decimals?: number; className?: string; title?: string
}) {
  const fmt = (v: number) => String(Math.round(v * 10 ** decimals) / 10 ** decimals)
  const [text, setText] = useState(fmt(value))
  const focused = useRef(false)
  useEffect(() => { if (!focused.current) setText(fmt(value)) }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  const lim = (v: number) => clamp(v, min ?? -Infinity, max ?? Infinity)
  const commit = (raw: string) => {
    const v = parseFloat(raw)
    if (Number.isFinite(v)) onChange(lim(v))
    else setText(fmt(value))
  }
  const drag = useRef<{ x: number; v: number } | null>(null)
  return (
    <label className={'scrub ' + className} title={title}>
      <span className="scrub-label"
        onPointerDown={(e) => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, v: value } }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const k = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
          onChange(lim(Math.round((drag.current.v + (e.clientX - drag.current.x) * step * k) * 10 ** decimals) / 10 ** decimals))
        }}
        onPointerUp={() => { drag.current = null }}>{label}</span>
      <input value={text} inputMode="decimal" spellCheck={false}
        onFocus={(e) => { focused.current = true; e.target.select() }}
        onBlur={() => { focused.current = false; commit(text); setText(fmt(value)) }}
        onChange={(e) => { setText(e.target.value); const v = parseFloat(e.target.value); if (Number.isFinite(v) && /^-?\d*\.?\d*$/.test(e.target.value.trim())) onChange(lim(v)) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { (e.target as HTMLInputElement).blur() }
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const k = (e.shiftKey ? 10 : e.altKey ? 0.1 : 1) * (e.key === 'ArrowUp' ? 1 : -1)
            const v = lim(Math.round((value + step * k) * 10 ** decimals) / 10 ** decimals)
            onChange(v); setText(fmt(v))
          }
        }} />
      {unit && <em>{unit}</em>}
    </label>
  )
}

// ------------------------------------------------------------------ Slider
export function Slider({ value, min, max, step = 1, onChange, className = '' }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; className?: string }) {
  const p = ((value - min) / (max - min)) * 100
  return <input type="range" className={'slider ' + className} min={min} max={max} step={step} value={value} style={{ ['--p' as string]: p + '%' } as CSSProperties} onChange={(e) => onChange(parseFloat(e.target.value))} />
}

// ------------------------------------------------------------------ Colour
const PALETTE = [
  '#ffffff', '#f1f5f9', '#94a3b8', '#475569', '#0f172a', '#000000', INK, WEEKDAY_RED,
  LINK_PILL, STRIPE_COLORS[0], STRIPE_COLORS[2], '#0e75dd', '#047857', '#be2d2d', '#f59e0b', '#8b5cf6',
  ...CATEGORIES.map((c) => c.accent),
]
const RECENT_KEY = 'esb-banner-studio/recent-colours'
const readRecent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') } catch { return [] } }
const pushRecent = (c: string) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([c, ...readRecent().filter((x) => x !== c)].slice(0, 10))) } catch { /* ignore */ } }
const hex6 = (c: unknown) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null)

function hexToHsv(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [((h * 60) + 360) % 360, max ? d / max : 0, max]
}
function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)) }
  const to = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0')
  return '#' + to(f(5)) + to(f(3)) + to(f(1))
}

function HsvPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const [hsv, setHsv] = useState<[number, number, number]>(() => hexToHsv(value))
  const lastOut = useRef(value)
  // follow outside changes (e.g. clicking a swatch) without losing hue when saturation is 0
  useEffect(() => { if (value !== lastOut.current) { setHsv(hexToHsv(value)); lastOut.current = value } }, [value])
  const emit = (n: [number, number, number]) => { setHsv(n); const c = hsvToHex(...n); lastOut.current = c; onChange(c) }
  const drag = (el: HTMLElement, e: React.PointerEvent, fn: (x: number, y: number) => void) => {
    el.setPointerCapture(e.pointerId)
    const run = (ev: { clientX: number; clientY: number }) => { const r = el.getBoundingClientRect(); fn(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1)) }
    run(e)
    const move = (ev: PointerEvent) => run(ev)
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up) }
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up)
  }
  const [h, s, v] = hsv
  return (
    <div className="hsv">
      <div className="hsv-sv" style={{ background: `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,hsl(${h},100%,50%))` }}
        onPointerDown={(e) => drag(e.currentTarget, e, (x, y) => emit([h, x, 1 - y]))}>
        <i style={{ left: s * 100 + '%', top: (1 - v) * 100 + '%', background: hsvToHex(h, s, v) }} />
      </div>
      <div className="hsv-hue" onPointerDown={(e) => drag(e.currentTarget, e, (x) => emit([x * 359.9, s || 0.01, v || 0.01]))}>
        <i style={{ left: (h / 360) * 100 + '%', background: `hsl(${h},100%,50%)` }} />
      </div>
    </div>
  )
}

export function ColorField({ value, onChange, onReset, label, className = '' }: { value: string; onChange: (c: string) => void; onReset?: () => void; label?: ReactNode; className?: string }) {
  const btn = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(value)
  const close = useCallback(() => { setOpen(false); const h = hex6(value); if (h) pushRecent(h) }, [value])
  useEffect(() => setText(value), [value])
  const v = hex6(value) ?? '#000000'
  return (
    <div className={'colorfield ' + className}>
      {label && <span className="cf-label">{label}</span>}
      <button ref={btn} type="button" className="cf-swatch" style={{ background: v }} onClick={() => setOpen((o) => !o)} aria-label="Pick colour" />
      <input value={text} spellCheck={false} maxLength={7}
        onChange={(e) => { setText(e.target.value); const h = hex6(e.target.value.startsWith('#') ? e.target.value : '#' + e.target.value); if (h) onChange(h) }}
        onBlur={() => setText(value)} />
      {open && btn.current && (
        <Popover anchor={{ el: btn.current }} onClose={close} className="colorpop" minWidth={248}>
          <HsvPicker value={v} onChange={onChange} />
          <div className="cp-hex">
            <i style={{ background: v }} />
            <input value={text} spellCheck={false} maxLength={7} onChange={(e) => { setText(e.target.value); const h = hex6(e.target.value.startsWith('#') ? e.target.value : '#' + e.target.value); if (h) onChange(h) }} onBlur={() => setText(value)} />
            {onReset && <button type="button" className="ibtn" data-tip="Reset colour to default" onClick={() => { onReset(); close() }}><Icon name="reset" size={13} /></button>}
          </div>
          <div className="cp-title">Brand &amp; neutrals</div>
          <div className="cp-grid">
            {PALETTE.map((c, i) => <button key={c + i} type="button" className={'cp-sw' + (c.toLowerCase() === v ? ' on' : '')} style={{ background: c }} title={c} onClick={() => onChange(c)} />)}
          </div>
          {readRecent().length > 0 && (
            <>
              <div className="cp-title">Recent</div>
              <div className="cp-grid">{readRecent().map((c) => <button key={c} type="button" className="cp-sw" style={{ background: c }} title={c} onClick={() => onChange(c)} />)}</div>
            </>
          )}
          {onReset && (
            <button type="button" className="btn sm ghost cp-reset" onClick={() => { onReset(); close() }}>
              <Icon name="reset" size={13} />Reset to default colour
            </button>
          )}
        </Popover>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ Calendar date picker
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const parseIso = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }

/** The calendar sheet on its own, so it can open from a button or straight from a double-click on the banner. */
export function DatePopover({ value, onChange, anchor, onClose }: { value: string; onChange: (iso: string) => void; anchor: { el: HTMLElement } | { x: number; y: number }; onClose: () => void }) {
  const sel = parseIso(value)
  const [view, setView] = useState({ y: sel.getFullYear(), m: sel.getMonth() })
  const todayIso = iso(new Date())
  const first = new Date(view.y, view.m, 1)
  const start = new Date(view.y, view.m, 1 - first.getDay())
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
  const shiftMonth = (n: number) => setView((v) => { const d = new Date(v.y, v.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() } })
  const pick = (d: Date) => { onChange(iso(d)); onClose() }
  const nudge = (n: number) => { const d = parseIso(value); d.setDate(d.getDate() + n); onChange(iso(d)); setView({ y: d.getFullYear(), m: d.getMonth() }) }
  const years = Array.from({ length: 11 }, (_, i) => view.y - 5 + i)
  return (
    <Popover anchor={anchor} onClose={onClose} className="calpop" minWidth={290}>
      <div className="cal" tabIndex={-1} ref={(el) => el?.focus()}
        onKeyDown={(e) => {
          const k: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
          if (k[e.key]) { e.preventDefault(); nudge(k[e.key]) } else if (e.key === 'Enter') { e.preventDefault(); onClose() }
        }}>
        <div className="cal-head">
          <button type="button" className="ibtn" onClick={() => shiftMonth(-1)} aria-label="Previous month"><Icon name="chevRight" size={15} className="flip" /></button>
          <Select value={view.m} options={MONTHS.map((m, i) => ({ value: i, label: m }))} onChange={(m) => setView((v) => ({ ...v, m }))} className="compact plain" />
          <Select value={view.y} options={years.map((y) => ({ value: y, label: String(y) }))} onChange={(y) => setView((v) => ({ ...v, y }))} className="compact plain" />
          <button type="button" className="ibtn" onClick={() => shiftMonth(1)} aria-label="Next month"><Icon name="chevRight" size={15} /></button>
        </div>
        <div className="cal-grid cal-dow">{['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => <span key={d}>{d}</span>)}</div>
        <div className="cal-grid">
          {days.map((d) => {
            const id = iso(d)
            return (
              <button key={id} type="button" className={'cal-day' + (d.getMonth() !== view.m ? ' out' : '') + (id === value ? ' sel' : '') + (id === todayIso ? ' today' : '') + (d.getDay() === 5 ? ' fri' : '')} onClick={() => pick(d)}>{d.getDate()}</button>
            )
          })}
        </div>
        <div className="cal-foot">
          <button type="button" className="chip" onClick={() => pick(new Date(Date.now() - 864e5))}>Yesterday</button>
          <button type="button" className="chip" onClick={() => pick(new Date())}>Today</button>
          <button type="button" className="chip" onClick={() => pick(new Date(Date.now() + 864e5))}>Tomorrow</button>
        </div>
      </div>
    </Popover>
  )
}

export function DatePicker({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const btn = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const label = parseIso(value).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  return (
    <>
      <button ref={btn} type="button" className={'select datefield' + (open ? ' open' : '')} onClick={() => setOpen((o) => !o)}>
        <Icon name="calendar" size={15} />
        <span className="select-label">{label}</span>
        <Icon name="chevDown" size={14} className="chev" />
      </button>
      {open && btn.current && <DatePopover value={value} onChange={onChange} anchor={{ el: btn.current }} onClose={close} />}
    </>
  )
}

// ------------------------------------------------------------------ Checkbox / chip / dialog
export function Check({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  const labelStr = typeof label === 'string' ? label : undefined
  return (
    <label className={'check' + (disabled ? ' disabled' : '')}>
      <input type="checkbox" checked={checked} aria-label={labelStr} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <i><Icon name="check" size={12} strokeWidth={3} /></i>
      <span>{label}{hint && <small>{hint}</small>}</span>
    </label>
  )
}

export function Chip({ on, onClick, children, title }: { on?: boolean; onClick?: () => void; children: ReactNode; title?: string }) {
  return <button type="button" title={title} className={'chip' + (on ? ' on' : '')} onClick={onClick}>{children}</button>
}

export function Dialog({ title, kicker, onClose, children, footer, width = 760 }: { title: string; kicker?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    // Esc closes an open menu inside the dialog first, not the dialog under it
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.popover')) { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onClose])
  return createPortal(
    <div className="modal-bg" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="dialog" style={{ width: `min(${width}px, 94vw)` }} role="dialog" aria-label={title}>
        <header>
          <div>{kicker && <div className="kicker">{kicker}</div>}<h2>{title}</h2></div>
          <IconButton icon="x" tip="Close (Esc)" onClick={onClose} />
        </header>
        <div className="dialog-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}

// ------------------------------------------------------------------ Collapsible panel
// Panels in a side column behave as one accordion: opening a section closes its open siblings and brings its header
// to the top of the column, so there is always one obvious "where am I" — the highlighted header with its content
// directly under it. Several sections open at once, each scrolled half out of view, is what made the columns feel
// like a maze. Open/closed state lasts for the session only: every launch starts from the defaults (Category open,
// everything else closed) rather than from wherever the last session left things.
// The Inspector opts out (`accordion={false}`): its sections describe one selection and are read together.
function sessionGet(key: string): string | null { try { return sessionStorage.getItem(key) } catch { return null } }
function sessionSet(key: string, v: string) { try { sessionStorage.setItem(key, v) } catch { /* ignore */ } }

export function Panel({ title, sub, icon, actions, children, defaultOpen = true, id, persist = true, focusKey, accordion = true }: { title: string; sub?: string; icon?: IconName; actions?: ReactNode; children: ReactNode; defaultOpen?: boolean; id?: string; persist?: boolean; focusKey?: string; accordion?: boolean }) {
  const key = 'esb-banner-studio/panel/' + (id ?? title)
  const [open, setOpen] = useState(() => { if (!persist) return defaultOpen; const s = sessionGet(key); return s === null ? defaultOpen : s === '1' })
  const ref = useRef<HTMLElement>(null)
  useEffect(() => { if (persist) sessionSet(key, open ? '1' : '0') }, [open, key, persist])

  /** Open this panel: close its accordion siblings and bring it into view. */
  const reveal = useCallback(() => {
    setOpen(true)
    const el = ref.current
    if (!el) return
    if (accordion) window.dispatchEvent(new CustomEvent('esb:panel-reveal', { detail: el }))
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const scroller = el.closest('.scroll, .ed-side, .ed-src-scroll') as HTMLElement | null
      if (!scroller) return
      const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
      scroller.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    }))
  }, [accordion])

  useEffect(() => {
    const onReveal = (e: Event) => {
      const other = (e as CustomEvent<HTMLElement>).detail
      const el = ref.current
      if (accordion && el && other !== el && other.parentElement === el.parentElement) setOpen(false)
    }
    const onOpen = (e: Event) => { if ((e as CustomEvent).detail === (id ?? title)) reveal() }
    window.addEventListener('esb:panel-reveal', onReveal)
    window.addEventListener('esb:open-panel', onOpen)
    return () => { window.removeEventListener('esb:panel-reveal', onReveal); window.removeEventListener('esb:open-panel', onOpen) }
  }, [id, title, accordion, reveal])

  return (
    <section ref={ref} className={'pnl' + (open ? ' open' : '')} data-panel={id ?? title}
      // tells the banner which element this panel edits, so it can show where you are
      onFocus={focusKey ? () => window.dispatchEvent(new CustomEvent('esb:panel-focus', { detail: focusKey })) : undefined}
      onBlur={focusKey ? (e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) window.dispatchEvent(new CustomEvent('esb:panel-focus', { detail: null })) } : undefined}>
      <header onClick={() => (open ? setOpen(false) : reveal())} role="button" aria-expanded={open} tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (open) setOpen(false); else reveal() } }}>
        <Icon name="chevRight" size={13} className="pnl-chev" />
        {icon && <Icon name={icon} size={14} className="pnl-icon" />}
        <h3><span className="t">{title}</span>{sub && <small>{sub}</small>}</h3>
        <span className="pnl-actions" onClick={(e) => e.stopPropagation()}>{actions}</span>
      </header>
      {open && <div className="pnl-body">{children}</div>}
    </section>
  )
}

export function Field({ label, children, className = '' }: { label: ReactNode; children: ReactNode; className?: string }) {
  return <div className={'field ' + className}><label>{label}</label>{children}</div>
}
