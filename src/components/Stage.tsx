import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { deskIs } from '../shell/shellStore'
import { drawElement, renderScene, slotRects } from '../core/render'
import type { Assets } from '../core/render'
import { getFontDef } from '../core/fonts'
import { lineHeightPx } from '../core/text'
import { CATEGORIES, FORMATS, getFormat, OPTIMAL_IMAGE_SPACES, formatRatio } from '../core/tokens'
import type { El, Override, PhotosEl, TextEl } from '../core/types'
import { allAssets } from '../export'
import { hint, imageAssets, isBackdrop, pointer, useStore } from '../store'
import { ELEMENT_DEFS } from '../core/elements'
import { LABEL_PRESETS, suggestHighlight } from '../core/newsroom'
import { balanceHeadlineBreaks } from '../editorial/translator'
import { ContextMenu, DatePopover, Popover, Switch } from '../ui/controls'
import type { MenuEntry } from '../ui/controls'
import { Icon, KIND_ICON } from '../ui/Icon'
import { Quickbar } from './Quickbar'

/** The words of a Quote / Stats card: they move and re-wrap with its text box ('card-box'). */
const CARD_TEXT_IDS = new Set(['headline', 'speaker-name', 'speaker-title', 'quote-mark', 'quote-rule', 'stat-label', 'stat-delta', 'stat-note', 'stat-rule', 'card-bar', 'card-frame', 'speaker-photo', 'quote-source', 'stat-unit', 'stat-unit-2', 'stat-unit-3', 'stat-num-2', 'stat-num-3', 'stat-label-2', 'stat-label-3', 'stat-rule-2'])

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
type Box = { x: number; y: number; w: number; h: number }
type Pt = { x: number; y: number }
type SnapLine = { axis: 'x' | 'y'; at: number }

type Mv = { clientX: number; clientY: number; shiftKey: boolean; altKey: boolean }

type Drag =
  | { kind: 'move'; p0: Pt; starts: { id: string; box: Box }[]; union: Box; started: boolean }
  | { kind: 'resize'; id: string; handle: Handle; p0: Pt; box: Box; el: El; ov: Override; started: boolean }
  | { kind: 'pan'; slot: number; p0: Pt; pan: Pt; ox: number; oy: number; started: boolean }
  | { kind: 'marquee'; p0: Pt; base: string[]; started: boolean }
  | { kind: 'scroll'; x: number; y: number; sl: number; st: number }
  | { kind: 'guide'; id: string; axis: 'x' | 'y'; started: boolean }
  | { kind: 'icon'; id: string; p0: Pt; dx0: number; dy0: number; started: boolean }

const RULER = 24

const inside = (p: Pt, b: Box) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h
const hits = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

const HANDLE_POS: Record<Handle, [number, number]> = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] }
const HANDLE_CURSOR: Record<Handle, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' }

function handlesFor(el: El): Handle[] {
  switch (el.kind) {
    case 'rect': case 'photos': case 'image': return ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
    case 'icon': return ['nw', 'ne', 'se', 'sw']
    case 'watermark': return ['nw', 'ne', 'se', 'sw']
    case 'text': return el.align === 'center' || el.fit === 'box' ? ['nw', 'ne', 'se', 'sw', 'e', 'w'] : ['nw', 'ne', 'se', 'sw']
    default: return []
  }
}

/** Resize a box from a handle. `uniform` keeps the aspect ratio, `center` resizes about the centre (Shift / Alt / both). */
function resizeBox(box: Box, handle: Handle, dx: number, dy: number, uniform: boolean, center: boolean, min = 8): Box {
  const left = handle.includes('w'), right = handle.includes('e'), top = handle.includes('n'), bottom = handle.includes('s')
  const m = center ? 2 : 1
  let w = Math.max(min, box.w + (right ? dx * m : left ? -dx * m : 0))
  let h = Math.max(min, box.h + (bottom ? dy * m : top ? -dy * m : 0))
  if (uniform) {
    const horiz = left || right, vert = top || bottom
    const f = horiz && vert ? Math.max(w / box.w, h / box.h) : horiz ? w / box.w : h / box.h
    w = Math.max(min, box.w * f)
    h = Math.max(min, box.h * f)
  }
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2
  if (center) return { x: cx - w / 2, y: cy - h / 2, w, h }
  return {
    x: left ? box.x + box.w - w : right ? box.x : cx - w / 2,
    y: top ? box.y + box.h - h : bottom ? box.y : cy - h / 2,
    w, h,
  }
}

const unionOf = (boxes: Box[]): Box => {
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y))
  const x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Interactive popover on the canvas to select words or phrases in the headline to highlight directly on the banner. */
function HighlightPopover({ anchor, onClose }: { anchor: { x: number; y: number }; onClose: () => void }) {
  const content = useStore((s) => s.doc.content)
  const format = useStore((s) => s.format)
  const setContent = useStore((s) => s.setContent)
  const isStack = getFormat(format).family === 'stack'
  const [dragStart, setDragStart] = useState<number | null>(null)
  const [dragEnd, setDragEnd] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const words = useMemo(() => {
    const out: { word: string; start: number; end: number }[] = []
    const re = /\S+/g
    let m: RegExpExecArray | null
    while ((m = re.exec(content.headline))) {
      out.push({ word: m[0], start: m.index, end: m.index + m[0].length })
    }
    return out
  }, [content.headline])

  const applyPhrase = (phrase: string) => {
    const clean = phrase.trim().replace(/^[“"‘']+|[”"’',.;:!?]+$/g, '') || phrase.trim()
    setContent({ highlight: clean, ...(clean && isStack ? { highlightOnSocial: true } : {}) })
  }

  const commitRange = (a: number, b: number) => {
    const lo = Math.min(a, b), hi = Math.max(a, b)
    if (!words[lo] || !words[hi]) return
    const phrase = content.headline.slice(words[lo].start, words[hi].end)
    applyPhrase(phrase)
  }

  const hlLower = content.highlight.trim().toLowerCase()
  const hlRange = useMemo(() => {
    if (!hlLower) return null
    const idx = content.headline.toLowerCase().indexOf(hlLower)
    if (idx < 0) return null
    return { start: idx, end: idx + hlLower.length }
  }, [content.headline, hlLower])

  return (
    <Popover anchor={anchor} align="center" onClose={onClose} className="hl-pop" minWidth={380}>
      <div className="hl-head">
        <span><Icon name="sparkle" size={14} />Highlight in headline</span>
        <small>Click or drag across words below to highlight on the banner</small>
      </div>
      {words.length > 0 ? (
        <div className="hl-words" onPointerUp={() => { if (dragStart !== null && dragEnd !== null) commitRange(dragStart, dragEnd); setDragStart(null); setDragEnd(null) }} onPointerLeave={() => { if (dragStart !== null && dragEnd !== null) commitRange(dragStart, dragEnd); setDragStart(null); setDragEnd(null) }}>
          {words.map((w, i) => {
            const inDrag = dragStart !== null && dragEnd !== null && i >= Math.min(dragStart, dragEnd) && i <= Math.max(dragStart, dragEnd)
            const inActive = !inDrag && hlRange !== null && w.end > hlRange.start && w.start < hlRange.end
            return (
              <button key={i} type="button" className={'hl-word' + (inActive ? ' on' : '') + (inDrag ? ' selecting' : '')}
                onPointerDown={(e) => {
                  e.preventDefault()
                  if (e.shiftKey && hlRange) {
                    const firstIdx = words.findIndex((x) => x.end > hlRange.start)
                    if (firstIdx >= 0) { commitRange(firstIdx, i); return }
                  }
                  setDragStart(i); setDragEnd(i); commitRange(i, i)
                }}
                onPointerEnter={() => { if (dragStart !== null) { setDragEnd(i); commitRange(dragStart, i) } }}>
                {w.word}
              </button>
            )
          })}
        </div>
      ) : (
        <p className="hint">Type a headline first to pick words to highlight.</p>
      )}
      <div className="hl-custom">
        <input ref={inputRef} type="text" className="input" value={content.highlight} placeholder="Or type exact phrase to highlight…"
          onChange={(e) => setContent({ highlight: e.target.value, ...(e.target.value.trim() && isStack ? { highlightOnSocial: true } : {}) })} />
        <button type="button" className="btn sm" disabled={!content.headline.trim()} onClick={() => applyPhrase(suggestHighlight(content.headline))} title="Auto-pick figure or number">
          <Icon name="sparkle" size={13} />Suggest
        </button>
        <button type="button" className="btn sm ghost" disabled={!content.highlight} onClick={() => setContent({ highlight: '' })}>
          Clear
        </button>
      </div>
      <div className="hl-foot">
        <Switch checked={content.highlightOnSocial} onChange={(v) => setContent({ highlightOnSocial: v })} label="Show highlight on Facebook & Square banners too" />
      </div>
    </Popover>
  )
}

export function Stage({ base }: { base: Assets }) {
  const doc = useStore((s) => s.doc)
  const format = useStore((s) => s.format)
  const selectedIds = useStore((s) => s.selectedIds)
  const selectedSlot = useStore((s) => s.selectedSlot)
  const images = useStore((s) => s.images)
  const snapOn = useStore((s) => s.snap)
  const tool = useStore((s) => s.tool)
  const rulers = useStore((s) => s.rulers)
  const canvasGrid = useStore((s) => s.canvasGrid)
  const zoom = useStore((s) => s.zoom)
  const theme = useStore((s) => s.theme)
  const cropGuides = useStore((s) => s.cropGuides)
  const showDimensions = useStore((s) => s.showDimensions)
  const select = useStore((s) => s.select)
  const selectSlot = useStore((s) => s.selectSlot)
  const selectMany = useStore((s) => s.selectMany)

  const scroller = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const rulerTop = useRef<HTMLCanvasElement>(null)
  const rulerLeft = useRef<HTMLCanvasElement>(null)
  const drag = useRef<Drag | null>(null)
  const altClick = useRef<Pt | null>(null)
  const moveQ = useRef<Mv | null>(null)
  const moveRaf = useRef(0)
  const anchor = useRef<{ cx: number; cy: number; dx: number; dy: number } | null>(null)

  const [avail, setAvail] = useState({ w: 800, h: 600 })
  const [snapLines, setSnapLines] = useState<SnapLine[]>([])
  const [hover, setHover] = useState<string | null>(null)
  const photoOriginal = useStore((s) => s.photoOriginal)
  const [marquee, setMarquee] = useState<Box | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null)
  const [editing, setEditing] = useState<{ id: string; value: string; content?: 'headline' | 'credit' } | null>(null)
  const [inlineSel, setInlineSel] = useState('')
  const inlineRef = useRef<HTMLTextAreaElement>(null)
  const [space, setSpace] = useState(false)
  const [draftGuide, setDraftGuide] = useState<{ axis: 'x' | 'y'; at: number } | null>(null)
  const [scrollTick, setScrollTick] = useState(0)
  const [dragKind, setDragKind] = useState<'move' | 'resize' | 'icon' | 'pan' | null>(null)
  const [linked, setLinked] = useState<string | null>(null)
  const [pop, setPop] = useState<{ kind: 'date' | 'category' | 'label' | 'highlight'; x: number; y: number } | null>(null)
  const content = useStore((s) => s.doc.content)
  const curX = useRef<HTMLDivElement>(null)
  const curY = useRef<HTMLDivElement>(null)
  const areaRef = useRef<HTMLDivElement>(null)
  const rulerColors = useRef<{ key: string; bg1: string; bg2: string; t2: string; t3: string; sel: string } | null>(null)

  const { w: W, h: H } = FORMATS[format]
  const fit = Math.max(0.05, Math.min((avail.w - 80) / W, (avail.h - 80) / H))
  const scale = zoom === 'fit' ? fit : zoom
  // no scrollbars while the banner (plus its 40 px margin) fits the window
  const fitsWindow = W * scale + 80 <= avail.w + 0.5 && H * scale + 80 <= avail.h + 0.5
  const scene = useMemo(() => useStore.getState().scene(format), [format, doc])
  const guides = doc.guides[format]
  // centre-crop rectangles for the other ratios Facebook / link previews cut this banner to
  const crops = useMemo(() => {
    if (!cropGuides) return []
    const out: { label: string; box: Box }[] = []
    for (const [r, label] of [[1, '1:1 · grid & profile crop'], [1.91, '1.91:1 · link preview'], [0.8, '4:5 · mobile feed']] as const) {
      const cr = W / H
      if (Math.abs(cr - r) < 0.02) continue
      const w = cr > r ? H * r : W
      const h = cr > r ? H : W / r
      out.push({ label, box: { x: (W - w) / 2, y: (H - h) / 2, w, h } })
    }
    return out
  }, [cropGuides, W, H])

  const layoutZones = useMemo(() => {
    const list: { id: string; name: string; box: Box; role: 'header' | 'photo' | 'headline' | 'footer' }[] = []
    const hBg = scene.elements.find((e) => e.id === 'header-bg')
    if (hBg) list.push({ id: 'header', name: 'Header', box: { x: hBg.x, y: hBg.y, w: hBg.w, h: hBg.h }, role: 'header' })
    const ph = scene.elements.find((e) => e.id === 'photos')
    if (ph) list.push({ id: 'photo', name: 'Photo Body', box: { x: ph.x, y: ph.y, w: ph.w, h: ph.h }, role: 'photo' })
    const bnd = scene.elements.find((e) => e.id === 'band' || e.id === 'panel')
    if (bnd) list.push({ id: 'band', name: bnd.id === 'panel' ? 'Side Panel' : 'Headline Band', box: { x: bnd.x, y: bnd.y, w: bnd.w, h: bnd.h }, role: 'headline' })
    const ft = scene.elements.find((e) => e.id === 'footer-bg')
    if (ft) list.push({ id: 'footer', name: 'Footer', box: { x: ft.x, y: ft.y, w: ft.w, h: ft.h }, role: 'footer' })
    return list
  }, [scene])

  useEffect(() => { useStore.getState().setScale(scale) }, [scale])

  // ----- size tracking
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setAvail({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setAvail({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [rulers])

  // ----- render the banner synchronously in the same VSync frame (zero double-RAF lag on 120Hz/144Hz/240Hz displays)
  // While something is being dragged, everything underneath and above it is frozen into two bitmaps, so each frame
  // only redraws the moving layers (two image blits + a few shapes instead of the whole template with its blurred icon).
  const frozen = useRef<{ d: Drag; k: number; n: number; below: HTMLCanvasElement; above: HTMLCanvasElement } | null>(null)
  useLayoutEffect(() => {
    const c = canvas.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const k = scale * dpr
    // Assigning width/height reallocates the backing store (and flashes), so only do it when the size really changed.
    const bw = Math.round(W * k), bh = Math.round(H * k)
    const ctx = c.getContext('2d')!
    if (c.width !== bw || c.height !== bh) { c.width = bw; c.height = bh } else { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, bw, bh) }
    ctx.setTransform(k, 0, 0, k, 0, 0)
    const assets = allAssets(base)
    // test hook: a from-scratch render of the current scene, to compare against the incremental one
    if (import.meta.env.DEV) (window as unknown as { __fullRender?: () => string }).__fullRender = () => { const o = document.createElement('canvas'); o.width = bw; o.height = bh; const x = o.getContext('2d')!; x.setTransform(k, 0, 0, k, 0, 0); renderScene(x, scene, assets); return o.toDataURL() }
    const d = drag.current
    const moving = d && 'started' in d && d.started ? (d.kind === 'move' ? d.starts.map((x) => x.id) : d.kind === 'resize' || d.kind === 'icon' ? [d.id] : d.kind === 'pan' ? ['photos'] : null) : null
    const els = scene.elements
    let lo = Infinity, hi = -1
    if (moving) els.forEach((e, i) => { if (moving.includes(e.id)) { lo = Math.min(lo, i); hi = Math.max(hi, i) } })
    if (d && hi >= 0) {
      let f = frozen.current
      if (!f || f.d !== d || f.k !== k || f.n !== els.length) {
        const layer = (from: number, to: number, bg: boolean) => {
          const cv = document.createElement('canvas'); cv.width = bw; cv.height = bh
          const cx = cv.getContext('2d')!; cx.setTransform(k, 0, 0, k, 0, 0)
          if (bg) { cx.fillStyle = scene.background; cx.fillRect(0, 0, W, H) }
          for (let i = from; i < to; i++) drawElement(cx, els[i], assets)
          return cv
        }
        f = frozen.current = { d, k, n: els.length, below: layer(0, lo, true), above: layer(hi + 1, els.length, false) }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(f.below, 0, 0)
      ctx.setTransform(k, 0, 0, k, 0, 0)
      for (let i = lo; i <= hi; i++) drawElement(ctx, els[i], assets)
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(f.above, 0, 0)
      return
    }
    frozen.current = null
    let liveScene = editing ? { ...scene, elements: scene.elements.map((e) => (e.id === editing.id ? { ...e, visible: false } : e)) } : scene
    // photo editor's "hold to see the original": the same scene with every photo's edit left out
    if (photoOriginal) liveScene = { ...liveScene, elements: liveScene.elements.map((e) => (e.kind === 'photos' ? { ...e, slots: e.slots.map((sl) => ({ ...sl, adjust: undefined, brightness: 0, contrast: 0, saturation: 0, warmth: 0, vignette: 0 })) } : e)) }
    renderScene(ctx, liveScene, assets)
  }, [scene, scale, W, H, base, images, editing, photoOriginal])

  // keep the design point under the cursor fixed while zooming with Ctrl+wheel
  useLayoutEffect(() => {
    const a = anchor.current, sc = scroller.current, wrap = wrapRef.current
    if (!a || !sc || !wrap) return
    const r = wrap.getBoundingClientRect()
    sc.scrollLeft += r.left + a.dx * scale - a.cx
    sc.scrollTop += r.top + a.dy * scale - a.cy
    anchor.current = null
  }, [scale])

  const toDesign = useCallback((e: { clientX: number; clientY: number }): Pt => {
    const r = overlay.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }
  }, [scale])

  const photos = scene.elements.find((e): e is PhotosEl => e.kind === 'photos' && e.visible)
  const slotBoxes = useMemo(() => (photos ? slotRects(photos) : []), [photos])
  const selEls = selectedIds.map((id) => scene.elements.find((e) => e.id === id)).filter((e): e is El => !!e)
  const single = selEls.length === 1 ? selEls[0] : null

  /** On Quote and Stats cards the header and footer are bands that move as one: the band's background plus every
   *  visible element lying inside it (logo, date, category chip, stripes, handles…). Null for anything else. */
  const bandBlock = (el: El): El[] | null => {
    for (const bgId of ['header-bg', 'footer-bg']) {
      const bg = scene.elements.find((x) => x.id === bgId && x.visible)
      if (!bg) continue
      const within = (x: El) => x.x >= bg.x - 1 && x.y >= bg.y - 1 && x.x + x.w <= bg.x + bg.w + 1 && x.y + x.h <= bg.y + bg.h + 1
      if (el.id === bgId || within(el)) return scene.elements.filter((x) => x.visible && x.kind !== 'photos' && x.kind !== 'watermark' && (x.id === bgId || within(x)))
    }
    return null
  }

  /** The empty-photo placeholder is a page overlay above the canvas; on Quote / Stats cards a header or footer the editor
   *  dragged over the photo is drawn above the photo, so the placeholder stops at the band's edge instead of hiding it. */
  const clearOfBands = (b: { x: number; y: number; w: number; h: number }) => {
    if ((content.cardType ?? 'standard') === 'standard') return b
    let top = b.y, bottom = b.y + b.h
    const hb = scene.elements.find((x) => x.id === 'header-bg' && x.visible)
    if (hb && hb.y + hb.h > top && hb.y < top + 1) top = Math.min(bottom, hb.y + hb.h)
    const fb = scene.elements.find((x) => x.id === 'footer-bg' && x.visible)
    if (fb && fb.y < bottom && fb.y + fb.h > bottom - 1) bottom = Math.max(top, fb.y)
    return { x: b.x, y: top, w: b.w, h: bottom - top }
  }

  /** Topmost element under the point. Backdrops (panels, the headline icon's big clip area) only count when asked for (double-click, Alt+click, context menu). */
  const hitTest = (p: Pt, includeLocked = false, includeBackdrops = false): El | null => {
    for (let i = scene.elements.length - 1; i >= 0; i--) {
      const e = scene.elements[i]
      if (!e.visible || (!includeLocked && e.locked) || e.opacity === 0) continue
      if (!includeBackdrops && isBackdrop(e)) continue
      if (inside(p, e)) return e
    }
    return null
  }

  // a Story panel that has focus lights up the banner element it edits
  useEffect(() => {
    const on = (e: Event) => setLinked((e as CustomEvent).detail ?? null)
    window.addEventListener('esb:panel-focus', on)
    return () => window.removeEventListener('esb:panel-focus', on)
  }, [])

  // cursor position follows along both rulers (written straight to the DOM — no React render per mouse move)
  useEffect(() => {
    const place = () => {
      const p = pointer.get(), wrap = wrapRef.current, area = areaRef.current, cx = curX.current, cy = curY.current
      if (!cx || !cy) return
      if (!p || !wrap || !area) { cx.style.opacity = cy.style.opacity = '0'; return }
      const w = wrap.getBoundingClientRect(), a = area.getBoundingClientRect()
      cx.style.opacity = cy.style.opacity = '1'
      cx.style.transform = `translateX(${Math.round(w.left - a.left + p.x * scale)}px)`
      cy.style.transform = `translateY(${Math.round(w.top - a.top + p.y * scale)}px)`
      cx.dataset.v = String(Math.round(p.x)); cy.dataset.v = String(Math.round(p.y))
    }
    place()
    return pointer.subscribe(place)
  }, [scale])

  // ----- zoom to selection (View menu / Ctrl+2)
  useEffect(() => {
    const onZoomSel = () => {
      const st = useStore.getState()
      const els = st.scene().elements.filter((x) => st.selectedIds.includes(x.id))
      const sc = scroller.current
      if (!els.length || !sc) { st.setZoom('fit'); return }
      const u = unionOf(els)
      const r = sc.getBoundingClientRect()
      const target = clamp(Math.min((r.width * 0.7) / Math.max(u.w, 40), (r.height * 0.7) / Math.max(u.h, 40)), 0.1, 4)
      anchor.current = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, dx: u.x + u.w / 2, dy: u.y + u.h / 2 }
      st.setZoom(target)
    }
    window.addEventListener('esb:zoom-selection', onZoomSel)
    return () => window.removeEventListener('esb:zoom-selection', onZoomSel)
  }, [])

  // ----- space = temporary hand tool
  useEffect(() => {
    const isTyping = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement
    const down = (e: KeyboardEvent) => { if (!deskIs('graphics')) return; if (e.code === 'Space' && !isTyping(e.target) && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); setSpace(true) } }
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpace(false) }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])
  const handMode = tool === 'hand' || space

  // ----- pointer interaction
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return
    overlay.current!.setPointerCapture(e.pointerId)
    if (e.button === 1 || handMode) {
      const sc = scroller.current!
      drag.current = { kind: 'scroll', x: e.clientX, y: e.clientY, sl: sc.scrollLeft, st: sc.scrollTop }
      return
    }
    const p = toDesign(e)
    // Ctrl / Cmd + drag = marquee anywhere, even over elements
    if (e.ctrlKey || e.metaKey) {
      const base = e.shiftKey ? selectedIds : []
      if (!e.shiftKey) select(null)
      drag.current = { kind: 'marquee', p0: p, base, started: false }
      hint.set('Release to select everything inside the box')
      return
    }
    const card = content.cardType ?? 'standard'
    // Quote and Stats cards: the header and footer bands are blocks — a click on their background picks them up too
    let hit = hitTest(p)
    // …and so is the band behind the words: a click on it (anywhere but on the words themselves, which belong to the
    // text box) picks the band up, so it can be dragged or pulled taller from its top edge like any layer
    const bandAt = () => scene.elements.find((x) => (x.id === 'band' || x.id === 'panel') && x.visible && !x.locked && inside(p, x)) ?? null
    if (card !== 'standard' && !e.altKey) {
      if (!hit) {
        const bg = hitTest(p, false, true)
        if (bg && (bg.id === 'header-bg' || bg.id === 'footer-bg')) hit = bg
        else hit = bandAt() ?? hit
      } else if (hit.id === 'card-box' && !selectedIds.includes('card-box')) hit = bandAt() ?? hit
    }
    // …and the words of the card belong to its text box: a click on any of them picks the box up, so one drag moves
    // the whole block and its handles resize it (the text re-wraps). Double-click still edits a line; Alt+click picks it.
    if (hit && card !== 'standard' && !e.altKey && CARD_TEXT_IDS.has(hit.id) && !selectedIds.includes(hit.id)) {
      const box = scene.elements.find((x) => x.id === 'card-box' && x.visible && !x.locked)
      if (box) hit = box
    }
    altClick.current = e.altKey ? p : null

    // inside a photo: drag pans the picture (Alt + drag moves the whole photo block)
    if (hit?.kind === 'photos' && !e.altKey) {
      const i = slotBoxes.findIndex((b) => inside(p, b))
      select(hit.id)
      if (i >= 0) {
        selectSlot(i)
        const slot = hit.slots[i]
        const img = slot?.src ? imageAssets[slot.src] : null
        if (slot && img) {
          const b = slotBoxes[i]
          const s = Math.max(b.w / img.width, b.h / img.height) * (slot.zoom || 1)
          drag.current = { kind: 'pan', slot: i, p0: p, pan: { x: slot.panX, y: slot.panY }, ox: img.width * s - b.w, oy: img.height * s - b.h, started: false }
          hint.set('Dragging pans the photo · scroll to zoom · Alt+drag moves the whole photo block')
        }
      }
      return
    }
    if (!hit) {
      const base = e.shiftKey ? selectedIds : []
      if (!e.shiftKey) select(null)
      drag.current = { kind: 'marquee', p0: p, base, started: false }
      hint.set('Release to select everything inside the box')
      return
    }
    if (e.shiftKey) { useStore.getState().toggleSelect(hit.id); return }
    if (hit.kind === 'watermark' && !hit.locked) {
      // the faded icon moves inside its clip area; the clip area itself stays put
      if (!selectedIds.includes(hit.id)) select(hit.id)
      const o = useStore.getState().doc.overrides[`${format}:${hit.id}`]
      drag.current = { kind: 'icon', id: hit.id, p0: p, dx0: o?.iconDx ?? 0, dy0: o?.iconDy ?? 0, started: false }
      hint.set('Dragging moves the icon · corners resize it · Shift locks the axis')
      return
    }
    // …and everything in that band moves with it: one drag moves the whole header or footer. A double-click selects
    // one element inside it (the date, a handle) and Alt+click the single layer under the pointer, as anywhere else.
    const block = card !== 'standard' && !e.altKey && !selectedIds.includes(hit.id) ? bandBlock(hit) : null
    if (block) {
      const ids = block.map((x) => x.id)
      selectMany(ids)
      const starts = block.filter((x) => !x.locked).map((x) => ({ id: x.id, box: { x: x.x, y: x.y, w: x.w, h: x.h } }))
      drag.current = { kind: 'move', p0: p, starts, union: unionOf(starts.map((s) => s.box)), started: false }
      hint.set(`Moving the whole ${hit.id === 'footer-bg' || block.some((x) => x.id === 'footer-bg') ? 'footer' : 'header'} · double-click to pick one element · Alt+click for a single layer`)
      return
    }
    const ids = selectedIds.includes(hit.id) ? selectedIds : [hit.id]
    if (!selectedIds.includes(hit.id)) select(hit.id)
    const starts = ids
      .map((id) => scene.elements.find((x) => x.id === id))
      .filter((x): x is El => !!x && !x.locked)
      .map((x) => ({ id: x.id, box: { x: x.x, y: x.y, w: x.w, h: x.h } }))
    if (starts.length) {
      drag.current = { kind: 'move', p0: p, starts, union: unionOf(starts.map((s) => s.box)), started: false }
      hint.set('Shift locks the axis · Alt turns snapping off')
    }
  }

  /** The tag above a selected layer drags it: this is how a background or the headline icon moves, since plain clicks never grab them. */
  const startTagDrag = (e: React.PointerEvent, x: El) => {
    if (x.locked || e.button !== 0) return
    e.stopPropagation()
    overlay.current!.setPointerCapture(e.pointerId)
    const p = toDesign(e)
    if (x.kind === 'watermark') {
      const o = useStore.getState().doc.overrides[`${format}:${x.id}`]
      drag.current = { kind: 'icon', id: x.id, p0: p, dx0: o?.iconDx ?? 0, dy0: o?.iconDy ?? 0, started: false }
      hint.set('Dragging moves the icon · Shift locks the axis')
    } else {
      const starts = [{ id: x.id, box: { x: x.x, y: x.y, w: x.w, h: x.h } }]
      drag.current = { kind: 'move', p0: p, starts, union: starts[0].box, started: false }
      hint.set('Shift locks the axis · Alt turns snapping off')
    }
  }

  const startResize = (e: React.PointerEvent, handle: Handle) => {
    if (!single || single.locked) return
    e.stopPropagation()
    overlay.current!.setPointerCapture(e.pointerId)
    const ov = useStore.getState().doc.overrides[`${format}:${single.id}`] ?? {}
    const art = single.kind === 'watermark' ? { x: single.x + single.ox, y: single.y + single.oy, w: single.size, h: single.size } : { x: single.x, y: single.y, w: single.w, h: single.h }
    drag.current = { kind: 'resize', id: single.id, handle, p0: toDesign(e), box: art, el: single, ov, started: false }
    hint.set(single.kind === 'text' ? 'Corners scale the text · sides change the wrap width · Alt = from the centre' : 'Shift keeps proportions · Alt resizes from the centre · Shift+Alt does both')
  }

  const snapTargets = (skip: string[]) => {
    const xs = [0, 56, W / 2, W - 56, W]
    const ys = [0, 56, H / 2, H - 56, H]
    for (const g of guides) (g.axis === 'x' ? xs : ys).push(g.at)
    for (const e of scene.elements) {
      if (skip.includes(e.id) || !e.visible || e.kind === 'watermark' || e.kind === 'photos') continue
      xs.push(e.x, e.x + e.w / 2, e.x + e.w)
      ys.push(e.y, e.y + e.h / 2, e.y + e.h)
    }
    return { xs, ys }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    moveQ.current = { clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey, altKey: e.altKey }
    if (!moveRaf.current) {
      moveRaf.current = requestAnimationFrame(() => {
        moveRaf.current = 0
        const m = moveQ.current
        moveQ.current = null
        if (m) processMove(m)
      })
    }
  }
  const flushMove = () => {
    cancelAnimationFrame(moveRaf.current)
    moveRaf.current = 0
    const m = moveQ.current
    moveQ.current = null
    if (m) processMove(m)
  }

  const processMove = (e: Mv) => {
    const p = toDesign(e)
    pointer.set(p)
    const d = drag.current
    if (d && (d.kind === 'move' || d.kind === 'resize' || d.kind === 'marquee')) {
      const sc = scroller.current
      if (sc) {
        const r = sc.getBoundingClientRect()
        const edge = 28, v = 14
        if (e.clientX < r.left + edge) sc.scrollLeft -= v; else if (e.clientX > r.right - edge) sc.scrollLeft += v
        if (e.clientY < r.top + edge) sc.scrollTop -= v; else if (e.clientY > r.bottom - edge) sc.scrollTop += v
      }
    }
    if (!d) {
      if (handMode) return
      const h = hitTest(p)
      setHover(h ? h.id : null)
      return
    }
    if (d.kind === 'scroll') {
      const sc = scroller.current!
      sc.scrollLeft = d.sl - (e.clientX - d.x)
      sc.scrollTop = d.st - (e.clientY - d.y)
      return
    }
    if (d.kind === 'guide') {
      useStore.getState().moveGuide(d.id, Math.round(d.axis === 'x' ? p.x : p.y), true)
      return
    }
    const dx = p.x - d.p0.x
    const dy = p.y - d.p0.y
    if (!d.started) {
      if (Math.hypot(dx, dy) * scale < 3) return
      d.started = true
      if (d.kind === 'move' || d.kind === 'resize' || d.kind === 'icon' || d.kind === 'pan') setDragKind(d.kind)
      if (d.kind !== 'marquee') useStore.getState().record('drag' + Date.now())
    }
    const st = useStore.getState()

    if (d.kind === 'marquee') {
      const box: Box = { x: Math.min(d.p0.x, p.x), y: Math.min(d.p0.y, p.y), w: Math.abs(dx), h: Math.abs(dy) }
      setMarquee(box)
      const ids = scene.elements.filter((x) => x.visible && !x.locked && x.kind !== 'photos' && !isBackdrop(x) && hits(box, x)).map((x) => x.id)
      selectMany([...new Set([...d.base, ...ids])])
      return
    }

    if (d.kind === 'pan') {
      st.setSlot(d.slot, {
        panX: Math.abs(d.ox) > 0.5 ? clamp(d.pan.x - (2 * dx) / d.ox, -1, 1) : 0,
        panY: Math.abs(d.oy) > 0.5 ? clamp(d.pan.y - (2 * dy) / d.oy, -1, 1) : 0,
      }, true)
      return
    }

    if (d.kind === 'icon') {
      let ix = dx, iy = dy
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) iy = 0; else ix = 0 }
      st.setOverride(d.id, { iconDx: Math.round(d.dx0 + ix), iconDy: Math.round(d.dy0 + iy) }, { silent: true })
      return
    }

    if (d.kind === 'move') {
      let ox = dx, oy = dy
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) oy = 0; else ox = 0 }
      const lines: SnapLine[] = []
      let snappedX = false, snappedY = false
      if (snapOn && !e.altKey) {
        const thr = 7 / scale
        const { xs, ys } = snapTargets(d.starts.map((s) => s.id))
        const u = d.union
        let bx = thr, by = thr, ax = 0, ay = 0
        for (const off of [0, u.w / 2, u.w]) for (const t of xs) { const diff = t - (u.x + ox + off); if (Math.abs(diff) < Math.abs(bx)) { bx = diff; ax = t } }
        for (const off of [0, u.h / 2, u.h]) for (const t of ys) { const diff = t - (u.y + oy + off); if (Math.abs(diff) < Math.abs(by)) { by = diff; ay = t } }
        if (Math.abs(bx) < thr) { ox += bx; snappedX = true; lines.push({ axis: 'x', at: ax }) }
        if (Math.abs(by) < thr) { oy += by; snappedY = true; lines.push({ axis: 'y', at: ay }) }
      }
      if (!snappedX) ox = Math.round(ox)
      if (!snappedY) oy = Math.round(oy)
      setSnapLines(lines)
      st.moveElements(d.starts.map((s) => ({ id: s.id, x: s.box.x + ox, y: s.box.y + oy })), true)
      return
    }

    // resize — Shift keeps proportions, Alt resizes from the centre, Shift+Alt does both
    const { handle, box, el } = d
    if (el.kind === 'watermark') {
      const nb = resizeBox(box, handle, dx, dy, true, e.altKey, 40)
      const baseOx = el.ox - (d.ov.iconDx ?? 0)
      const baseOy = el.oy - (d.ov.iconDy ?? 0)
      st.setOverride(d.id, { iconSize: Math.round(nb.w), iconDx: Math.round(nb.x - el.x - baseOx), iconDy: Math.round(nb.y - el.y - baseOy) }, { silent: true })
      return
    }
    const left = handle.includes('w'), top = handle.includes('n')
    const corner = (left || handle.includes('e')) && (top || handle.includes('s'))
    const fromCenter = e.altKey
    if (el.kind === 'text' && !corner) {
      // side handles on text change the wrapping width only
      const dw = (left ? -dx : dx) * (fromCenter ? 2 : 1)
      const w = Math.max(20, box.w + dw)
      st.placeElement(d.id, { x: fromCenter ? box.x + box.w / 2 - w / 2 : left ? box.x + box.w - w : box.x, w }, true)
      return
    }
    const nb = resizeBox(box, handle, dx, dy, el.kind === 'icon' || el.kind === 'text' || e.shiftKey, fromCenter)
    if (el.kind === 'icon') {
      st.placeElement(d.id, { x: nb.x, y: nb.y, w: nb.w }, true)
      return
    }
    if (el.kind === 'text') {
      const f = clamp(nb.w / box.w, 0.25, 8)
      const size = Math.max(6, Math.round((el as TextEl).size * f * 2) / 2)
      const patch: Partial<Override> = { size }
      if ((el as TextEl).fit === 'box' || d.ov.w != null) patch.w = box.w * f
      st.setOverride(d.id, patch, { silent: true })
      const now = useStore.getState().scene().elements.find((x) => x.id === d.id)
      if (now) {
        const cx = box.x + box.w / 2, cy = box.y + box.h / 2
        st.placeElement(d.id, fromCenter
          ? { x: cx - now.w / 2, y: cy - now.h / 2 }
          : { x: left ? box.x + box.w - now.w : box.x, y: top ? box.y + box.h - now.h : box.y }, true)
      }
      return
    }
    st.placeElement(d.id, { x: Math.round(nb.x), y: Math.round(nb.y), w: Math.round(nb.w), h: Math.round(nb.h) }, true)
  }

  const endDrag = (e?: React.PointerEvent) => {
    flushMove()
    const d = drag.current
    // Alt + click (no drag) selects the layer underneath the current selection
    if (e && altClick.current && d && 'started' in d && !d.started && d.kind !== 'pan') {
      const p = altClick.current
      const stack = scene.elements.filter((x) => x.visible && !x.locked && x.opacity !== 0 && inside(p, x)).reverse()
      const cur = stack.findIndex((x) => selectedIds.includes(x.id))
      const next = stack[(cur + 1) % Math.max(1, stack.length)]
      if (next) select(next.id)
    }
    altClick.current = null
    drag.current = null
    setDragKind(null)
    hint.set(null)
    setSnapLines([])
    setMarquee(null)
  }

  // ----- wheel: photo zoom (photo block selected) / Ctrl = zoom stage at the cursor
  useEffect(() => {
    const o = overlay.current
    if (!o) return
    const onWheel = (e: WheelEvent) => {
      const st = useStore.getState()
      if (e.ctrlKey) {
        e.preventDefault()
        const r = o.getBoundingClientRect()
        const cur = st.scale
        anchor.current = { cx: e.clientX, cy: e.clientY, dx: (e.clientX - r.left) / cur, dy: (e.clientY - r.top) / cur }
        st.setZoom(clamp(cur * Math.exp(-e.deltaY * 0.0015), 0.1, 4))
        return
      }
      const photoEl = st.scene().elements.find((x): x is PhotosEl => x.kind === 'photos')
      if (!photoEl || st.selectedId !== photoEl.id) return
      const r = o.getBoundingClientRect()
      const p = { x: (e.clientX - r.left) / st.scale, y: (e.clientY - r.top) / st.scale }
      const i = slotRects(photoEl).findIndex((b) => inside(p, b))
      const slot = photoEl.slots[i]
      if (i < 0 || !slot?.src) return
      e.preventDefault()
      st.selectSlot(i)
      st.setSlot(i, { zoom: clamp((slot.zoom || 1) * Math.exp(-e.deltaY * 0.0015), 0.1, 6) })
    }
    o.addEventListener('wheel', onWheel, { passive: false })
    return () => o.removeEventListener('wheel', onWheel)
  }, [])

  // ----- context menu
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    const st = useStore.getState()
    const p = toDesign(e)
    const hit = hitTest(p) ?? hitTest(p, true)
    const near = { x: e.clientX, y: e.clientY }
    if (!hit) {
      const bg = hitTest(p, false, true)
      const hasFormatOv = Object.keys(st.doc.overrides).some((k) => k.startsWith(format + ':'))
      setMenu({ ...near, items: [
        ...(bg ? [{ label: `Select “${bg.name}”`, icon: 'layers' as const, onClick: () => st.select(bg.id) }, { divider: true } as const] : []),
        { label: 'Add text', icon: 'text', onClick: () => st.addText() },
        { label: 'Add rectangle', icon: 'square', onClick: () => st.addRect() },
        { divider: true },
        { label: 'Clear guides', icon: 'ruler', disabled: !guides.length, onClick: () => st.clearGuides() },
        { label: 'Reset all layers on this banner', icon: 'reset', disabled: !hasFormatOv, onClick: () => st.resetAllOverrides() },
      ] })
      return
    }
    if (!selectedIds.includes(hit.id)) st.select(hit.id)
    const isExtra = hit.id.startsWith('x-')
    const ov = st.doc.overrides[`${format}:${hit.id}`]
    const hasPos = ov?.dx !== undefined || ov?.dy !== undefined || ov?.iconDx !== undefined || ov?.iconDy !== undefined
    const hasSize = ov?.size !== undefined || ov?.w !== undefined || ov?.h !== undefined || ov?.iconSize !== undefined || ov?.radius !== undefined
    const hasColor = ov?.color !== undefined || ov?.fill !== undefined
    setMenu({ ...near, items: [
      ...(hit.id === 'headline' ? [
        { label: 'Edit headline text', icon: 'type' as const, onClick: () => startEdit(hit) },
        { label: 'Highlight words in headline', icon: 'sparkle' as const, onClick: () => startHighlight(hit) },
        ...(content.highlight.trim() ? [{ label: `Clear highlight (“${content.highlight.trim()}”)`, onClick: () => st.setContent({ highlight: '' }) }] : []),
        { divider: true } as const,
      ] : []),
      { label: 'Bring to front', icon: 'front', shortcut: 'Ctrl+Shift+]', onClick: () => st.moveLayer(hit.id, 'front') },
      { label: 'Bring forward', icon: 'forward', shortcut: 'Ctrl+]', onClick: () => st.moveLayer(hit.id, 'up') },
      { label: 'Send backward', icon: 'backward', shortcut: 'Ctrl+[', onClick: () => st.moveLayer(hit.id, 'down') },
      { label: 'Send to back', icon: 'back', shortcut: 'Ctrl+Shift+[', onClick: () => st.moveLayer(hit.id, 'back') },
      { divider: true },
      { label: 'Duplicate', icon: 'copy', shortcut: 'Ctrl+D', disabled: hit.kind === 'photos', onClick: () => st.duplicateSelected() },
      { label: hit.visible ? 'Hide' : 'Show', icon: hit.visible ? 'eyeOff' : 'eye', onClick: () => st.setOverride(hit.id, { visible: !hit.visible }) },
      { label: hit.locked ? 'Unlock' : 'Lock', icon: hit.locked ? 'unlock' : 'lock', onClick: () => st.setOverride(hit.id, { locked: !hit.locked }) },
      { divider: true },
      { label: 'Reset position', disabled: !hasPos, onClick: () => st.clearOverrideFields(hit.id, ['dx', 'dy', 'iconDx', 'iconDy']) },
      { label: 'Reset size', disabled: !hasSize, onClick: () => st.clearOverrideFields(hit.id, ['size', 'w', 'h', 'iconSize', 'radius']) },
      { label: 'Reset colour', disabled: !hasColor, onClick: () => st.clearOverrideFields(hit.id, ['color', 'fill']) },
      { label: 'Reset this layer', icon: 'reset', disabled: !ov, onClick: () => st.resetOverride(hit.id) },
      { divider: true },
      { label: isExtra ? 'Delete' : 'Hide (template element)', icon: 'trash', danger: true, shortcut: 'Del', onClick: () => st.deleteSelected() },
    ] })
  }

  /** Which kind of direct edit a layer offers on the banner itself. */
  const editKindOf = (el: El): 'text' | 'date' | 'category' | 'label' | null => {
    if (el.id.startsWith('date-')) return 'date'
    if (el.id === 'chip' || el.id.startsWith('chip-')) return 'category'
    if (el.id.startsWith('label')) return 'label'
    if (el.kind === 'text') return 'text'
    return null
  }
  const startEdit = (el: El) => {
    const k = editKindOf(el)
    if (!k) return
    if (k === 'text') {
      setInlineSel('')
      if (el.id === 'headline') setEditing({ id: el.id, value: content.headline, content: 'headline' })
      else if (el.id === 'credit') setEditing({ id: el.id, value: content.credit, content: 'credit' })
      else setEditing({ id: el.id, value: (el as TextEl).text })
      return
    }
    const r = overlay.current!.getBoundingClientRect()
    setPop({ kind: k, x: r.left + px(el.x), y: r.top + px(el.y + el.h) + 8 })
  }
  const startHighlight = (el: El) => {
    const r = overlay.current!.getBoundingClientRect()
    const topY = r.top + px(el.y)
    setPop({ kind: 'highlight', x: r.left + px(el.x + el.w / 2), y: topY > 240 ? topY - 12 : r.top + px(el.y + el.h) + 12 })
  }
  const onDoubleClick = (e: React.MouseEvent) => {
    const p0 = toDesign(e)
    const hit = hitTest(p0)
    if (!hit) {
      // double-click on bare canvas picks the background / icon layer under the cursor
      const bg = hitTest(p0, false, true)
      if (bg) select(bg.id)
      return
    }
    if (hit.kind === 'photos') { window.dispatchEvent(new CustomEvent('esb:add-photos')); return }
    select(hit.id)
    startEdit(hit)
  }

  const commitEdit = (save: boolean) => {
    if (editing && save) {
      if (editing.content === 'headline') useStore.getState().setContent({ headline: editing.value })
      else if (editing.content === 'credit') useStore.getState().setContent({ credit: editing.value })
      else useStore.getState().setOverride(editing.id, { text: editing.value })
    }
    setInlineSel('')
    setEditing(null)
  }

  const selSpan = useMemo(() => {
    if (!selEls.length) return null
    const u = unionOf(selEls.map((x) => (x.kind === 'watermark' ? { x: x.x + x.ox, y: x.y + x.oy, w: x.size, h: x.size } : x)))
    return { x: Math.round(u.x * 10) / 10, y: Math.round(u.y * 10) / 10, w: Math.round(u.w * 10) / 10, h: Math.round(u.h * 10) / 10 }
  }, [selEls])
  const selSpanKey = selSpan ? `${selSpan.x},${selSpan.y},${selSpan.w},${selSpan.h}` : ''

  // ----- rulers: adaptive 1-2-5 ticks growing from the edge that faces the banner, selection span with its end values, guide notches
  const drawRuler = useCallback((cv: HTMLCanvasElement | null, axis: 'x' | 'y') => {
    const sc = scroller.current, wrap = wrapRef.current
    if (!cv || !sc || !wrap) return
    const r = sc.getBoundingClientRect(), w = wrap.getBoundingClientRect()
    const len = axis === 'x' ? r.width : r.height
    const origin = axis === 'x' ? w.left - r.left : w.top - r.top
    const dpr = window.devicePixelRatio || 1
    cv.width = Math.round((axis === 'x' ? len : RULER) * dpr)
    cv.height = Math.round((axis === 'x' ? RULER : len) * dpr)
    const ctx = cv.getContext('2d')!
    ctx.scale(dpr, dpr)
    // resolved once per theme / desk colour (reading computed styles on every frame would force a layout each time)
    const ckey = theme + '|' + content.categoryId
    if (rulerColors.current?.key !== ckey) {
      const probe = document.createElement('i'); sc.appendChild(probe)
      const col = (v: string) => { probe.style.color = `var(${v})`; return getComputedStyle(probe).color }
      rulerColors.current = { key: ckey, bg1: col('--bg-1'), bg2: col('--bg-3'), t2: col('--text-2'), t3: col('--text-3'), sel: col('--ruler-sel') }
      probe.remove()
    }
    const { bg1, bg2, t2, t3, sel } = rulerColors.current
    const A = (c: string, a: number) => `color-mix(in srgb, ${c} ${a * 100}%, transparent)`
    const W_ = axis === 'x' ? len : RULER, H_ = axis === 'x' ? RULER : len
    // outside the banner reads one step darker than the banner's own span
    ctx.fillStyle = bg2; ctx.fillRect(0, 0, W_, H_)
    const lo = Math.max(0, origin), hi = Math.min(len, origin + (axis === 'x' ? W : H) * scale)
    ctx.fillStyle = bg1
    if (axis === 'x') ctx.fillRect(lo, 0, hi - lo, RULER); else ctx.fillRect(0, lo, RULER, hi - lo)
    // helper: draw in a frame where "along" runs along the ruler and "across" is the thickness (edge facing the banner = RULER)
    const at = (along: number, across: number): [number, number] => (axis === 'x' ? [along, across] : [across, along])
    const line = (along: number, from: number, to: number, color: string) => {
      const [x0, y0] = at(Math.round(along) + 0.5, from), [x1, y1] = at(Math.round(along) + 0.5, to)
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke()
    }
    const text = (s: string, along: number, across: number, color: string, weight = 500, align: CanvasTextAlign = 'left') => {
      ctx.save(); ctx.font = `${weight} 10px "ESB Sans", Inter, system-ui, sans-serif`; ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.textAlign = align
      if (axis === 'x') ctx.fillText(s, along, across)
      else { ctx.translate(across, along); ctx.rotate(-Math.PI / 2); ctx.fillText(s, 0, 0) }
      ctx.restore()
    }

    const nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]
    const major = nice.find((n) => n * scale >= 72) ?? 5000
    const sub = [10, 5, 2].map((d) => major / d).find((m) => Number.isInteger(m) && m * scale >= 7) ?? 0
    const start = Math.floor((0 - origin) / scale / (sub || major)) * (sub || major)
    const end = (len - origin) / scale
    const step = sub || major
    for (let v = start; v <= end + 1e-6; v += step) {
      const pos = v * scale + origin
      if (pos < -1 || pos > len + 1) continue
      const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6
      const isHalf = !isMajor && Math.abs(v / (major / 2) - Math.round(v / (major / 2))) < 1e-6
      line(pos, RULER, isMajor ? RULER - 11 : isHalf ? RULER - 8 : RULER - 5, isMajor ? t2 : A(t3, 0.75))
    }
    for (let v = Math.ceil(start / major) * major; v <= end + 1e-6; v += major) {
      const pos = Math.round(v * scale + origin)
      text(String(Math.round(v)), pos + 4, 8, t3)
    }
    // the banner's own edges
    for (const edge of [0, axis === 'x' ? W : H]) line(edge * scale + origin, 0, RULER, t2)
    // guides
    for (const g of guides) {
      if ((g.axis === 'x') !== (axis === 'x')) continue
      const pos = Math.round(g.at * scale + origin) + 0.5
      ctx.fillStyle = '#19c3d6'; ctx.beginPath()
      const [ax, ay] = at(pos, RULER), [bx, by] = at(pos - 4, RULER - 6), [cx2, cy2] = at(pos + 4, RULER - 6)
      ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx2, cy2); ctx.closePath(); ctx.fill()
    }
    // the selection's span, with its start and end values written on the ruler
    if (selSpan) {
      const u = selSpan
      const a = (axis === 'x' ? u.x : u.y) * scale + origin, b = (axis === 'x' ? u.x + u.w : u.y + u.h) * scale + origin
      ctx.fillStyle = A(sel, 0.16)
      if (axis === 'x') ctx.fillRect(a, 0, b - a, RULER); else ctx.fillRect(0, a, RULER, b - a)
      line(a, 0, RULER, sel); line(b, 0, RULER, sel)
      const va = String(Math.round(axis === 'x' ? u.x : u.y)), vb = String(Math.round(axis === 'x' ? u.x + u.w : u.y + u.h))
      ctx.save(); ctx.font = '600 10px "ESB Sans", Inter, system-ui, sans-serif'
      const wa = ctx.measureText(va).width, wb = ctx.measureText(vb).width; ctx.restore()
      const room = b - a
      // value labels sit just outside the span (start before it, end after it), on a patch of ruler colour
      const valueTag = (v: string, tw: number, edge: number, before: boolean) => {
        const from = before ? edge - tw - 8 : edge + 1, to = from + tw + 7
        ctx.fillStyle = bg1
        if (axis === 'x') ctx.fillRect(from, 2, to - from, RULER - 4); else ctx.fillRect(2, from, RULER - 4, to - from)
        // horizontal text reads left-to-right; vertical text is rotated to read upward, so its anchor flips
        const along = before ? edge - 4 : edge + 4
        if (axis === 'x') text(v, along, RULER / 2, sel, 600, before ? 'right' : 'left')
        else text(v, before ? edge - 4 : edge + 4, RULER / 2, sel, 600, before ? 'left' : 'right')
      }
      valueTag(va, wa, a, true)
      if (room > wa + wb + 24) valueTag(vb, wb, b, false)
    }
  }, [scale, W, H, selSpanKey, guides, theme, content.categoryId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!rulers) return
    const id = requestAnimationFrame(() => { drawRuler(rulerTop.current, 'x'); drawRuler(rulerLeft.current, 'y') })
    return () => cancelAnimationFrame(id)
  }, [rulers, drawRuler, avail, scrollTick, theme])

  const startRulerGuide = (e: React.PointerEvent, axis: 'x' | 'y') => {
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      const r = overlay.current!.getBoundingClientRect()
      const at = axis === 'x' ? (ev.clientX - r.left) / scale : (ev.clientY - r.top) / scale
      setDraftGuide({ axis, at })
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const r = overlay.current!.getBoundingClientRect()
      const at = axis === 'x' ? (ev.clientX - r.left) / scale : (ev.clientY - r.top) / scale
      const lim = axis === 'x' ? W : H
      const sr = scroller.current!.getBoundingClientRect()
      const overScroller = ev.clientX >= sr.left && ev.clientY >= sr.top
      if (overScroller && at > 0 && at < lim) useStore.getState().addGuide(axis, Math.round(at))
      setDraftGuide(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    move(e.nativeEvent)
  }

  const startGuideDrag = (e: React.PointerEvent, g: { id: string; axis: 'x' | 'y' }) => {
    if (handMode) return
    e.stopPropagation()
    // capture on the guide itself (its events still bubble to the overlay) so double-click reaches it
    e.currentTarget.setPointerCapture(e.pointerId)
    useStore.getState().record('guide' + g.id + Date.now())
    drag.current = { kind: 'guide', id: g.id, axis: g.axis, started: true }
  }

  const px = (v: number) => v * scale
  const dpr = window.devicePixelRatio || 1
  const rx = (v: number) => Math.round(v * scale * dpr) / dpr // selection boxes snap to device pixels so 1 px lines stay razor sharp
  const boxRect = (b: Box) => ({ left: rx(b.x), top: rx(b.y), width: Math.max(1 / dpr, rx(b.x + b.w) - rx(b.x)), height: Math.max(1 / dpr, rx(b.y + b.h) - rx(b.y)) })
  const boxStyle = (b: Box) => boxRect(b)
  // keep the floating toolbar inside the visible canvas area
  const clampBar = (cx: number) => {
    const sc = scroller.current, wrap = wrapRef.current
    if (!sc || !wrap) return cx
    const origin = wrap.getBoundingClientRect().left - sc.getBoundingClientRect().left
    const half = 200, lo = half + 8 - origin, hi = sc.clientWidth - half - 8 - origin
    return hi < lo ? cx : Math.min(hi, Math.max(lo, cx))
  }
  const linkedEls = linked ? scene.elements.filter((e) => e.visible && ELEMENT_DEFS.find((d) => d.key === linked)?.match(e.id)) : []
  const hovered = hover && !selectedIds.includes(hover) ? scene.elements.find((x) => x.id === hover && x.kind !== 'photos') : null
  const editEl = editing ? (scene.elements.find((x) => x.id === editing.id) as TextEl | undefined) : undefined
  const group = selEls.length > 1 ? unionOf(selEls) : null
  const cursor = handMode ? (drag.current?.kind === 'scroll' ? 'grabbing' : 'grab') : hover && selectedIds.includes(hover) && scene.elements.find((x) => x.id === hover)?.kind !== 'photos' ? 'move' : 'default'

  const syncInlineSelection = () => {
    const el = inlineRef.current
    if (!el) return
    const sel = el.value.slice(el.selectionStart, el.selectionEnd).trim()
    setInlineSel(sel && sel.length < el.value.trim().length ? sel : sel)
  }

  const highlightInlineSelection = (phrase: string) => {
    const clean = phrase.trim().replace(/^[“"‘']+|[”"’',.;:!?]+$/g, '') || phrase.trim()
    if (!clean) return
    const isStack = getFormat(format).family === 'stack'
    useStore.getState().setContent({
      ...(editing?.content === 'headline' ? { headline: editing.value } : {}),
      highlight: clean,
      ...(isStack ? { highlightOnSocial: true } : {}),
    })
  }

  return (
    <div ref={areaRef} className={'stage-area' + (rulers ? ' with-rulers' : '') + (canvasGrid ? '' : ' no-grid')}>
      {rulers && (
        <>
          <div className="ruler-corner" title="Rulers: drag from a ruler to create a guide" />
          <canvas ref={rulerTop} className="ruler ruler-x" onPointerDown={(e) => startRulerGuide(e, 'y')} />
          <canvas ref={rulerLeft} className="ruler ruler-y" onPointerDown={(e) => startRulerGuide(e, 'x')} />
          <div ref={curX} className="ruler-cursor x" aria-hidden />
          <div ref={curY} className="ruler-cursor y" aria-hidden />
        </>
      )}
      <div className={'stage-scroll' + (fitsWindow ? ' fits' : '')} ref={scroller} onScroll={() => setScrollTick((t) => t + 1)}>
        <div className="stage-wrap" ref={wrapRef} style={{ width: px(W), height: px(H) }}>
          <canvas ref={canvas} style={{ width: px(W), height: px(H) }} className="stage-canvas" />
          <div
            ref={overlay}
            className="stage-overlay"
            style={{ cursor }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={() => endDrag()}
            onPointerLeave={() => { setHover(null); pointer.set(null) }}
            onContextMenu={onContextMenu}
            onDoubleClick={onDoubleClick}
          >
            {photos?.visible && slotBoxes.map((b, i) => {
              const s = photos.slots[i]
              const empty = !s?.src || !imageAssets[s.src]
              const active = selectedIds.includes(photos.id)
              const opt = OPTIMAL_IMAGE_SPACES[format]
              const slotW = Math.round(b.w)
              const slotH = Math.round(b.h)
              const isMulti = slotBoxes.length > 1
              const ratio = formatRatio(slotW, slotH)
              const deductionText = isMulti
                ? `Collage slot ${i + 1} (${slotBoxes.length} slots) · ${slotW} × ${slotH} px`
                : opt.deduction

              return (
                <div key={i} className={'slot-box' + (active ? ' active' : '') + (active && i === selectedSlot ? ' current' : '') + (empty ? ' empty' : '') + (empty && (content.cardType ?? 'standard') !== 'standard' ? ' see-through' : '')}
                  style={(() => { const v = empty ? clearOfBands(b) : b; return { left: px(v.x), top: px(v.y), width: px(v.w), height: Math.max(0, px(v.h)) } })()}>
                  {!empty && active && i === selectedSlot && dragKind === 'pan' && (
                    <div className="thirds-grid" aria-hidden="true">
                      <div className="tg-line tg-v1" />
                      <div className="tg-line tg-v2" />
                      <div className="tg-line tg-h1" />
                      <div className="tg-line tg-h2" />
                    </div>
                  )}
                  {empty ? (
                    <div
                      className="slot-empty-card"
                      role="button"
                      tabIndex={0}
                      title="Click to choose a photo (or drop image files)"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        window.dispatchEvent(new CustomEvent('esb:add-photos'))
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          window.dispatchEvent(new CustomEvent('esb:add-photos'))
                        }
                      }}
                    >
                      <div className="slot-empty-icon">
                        <Icon name="image" size={24} strokeWidth={1.4} />
                      </div>
                      <div className="slot-empty-header">
                        <span className="slot-empty-title">Insert Photo</span>
                        <span className="slot-empty-dim">{slotW} × {slotH} px</span>
                      </div>
                      <button
                        type="button"
                        className="slot-choose-btn"
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation()
                          window.dispatchEvent(new CustomEvent('esb:add-photos'))
                        }}
                      >
                        <Icon name="plus" size={13} strokeWidth={2.4} />
                        <span>Choose Photo</span>
                      </button>
                      <span className="slot-action-hint">or drop image file here</span>
                      <div className={'slot-deduct-spec' + (showDimensions ? ' visible' : ' sr-only')}>
                        <span className="slot-fit-label">Corner-to-corner fit</span>
                        <span className="slot-dot">·</span>
                        <span className="slot-deduct-info">{deductionText}</span>
                      </div>
                    </div>
                  ) : showDimensions ? (
                    <div className="slot-dim-pill" title={`${opt.deduction}\nExact fit without crop: ${slotW}×${slotH} px`}>
                      <Icon name="dimension" size={11} strokeWidth={2} />
                      <span>Photo: <b>{slotW} × {slotH} px</b> ({ratio})</span>
                    </div>
                  ) : null}
                </div>
              )
            })}
            {crops.map((c) => <div key={c.label} className="crop-guide" style={{ left: px(c.box.x), top: px(c.box.y), width: px(c.box.w), height: px(c.box.h) }}><span>{c.label}</span></div>)}
            {showDimensions && (
              <div className="dimension-overlay" aria-hidden="true">
                <div className="canvas-dim-badge">
                  <Icon name="dimension" size={11} strokeWidth={2} />
                  <span>Canvas · {W} × {H} px ({getFormat(format).ratio})</span>
                </div>
                {layoutZones.map((z) => (
                  <div key={z.id} className={`layout-dim-box zone-${z.role}`} style={boxRect(z.box)}>
                    <div className="layout-dim-tag">
                      <span className="ldt-name">{z.name}</span>
                      <span className="ldt-sep">·</span>
                      <span className="ldt-dim">{Math.round(z.box.w)} × {Math.round(z.box.h)} px</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {showDimensions && hovered && (
              <div className="hover-dim-tag" style={{ left: px(hovered.x), top: Math.max(0, px(hovered.y) - 22) }}>
                <span className="hdt-pill">{hovered.name} · {Math.round(hovered.w)} × {Math.round(hovered.h)} px</span>
              </div>
            )}
            {linkedEls.map((x) => <div key={'l' + x.id} className="el-box linked" style={boxStyle(x)} />)}
            {hovered && <div className="el-box hover" style={boxStyle(hovered)} />}
            {selEls.filter((x) => x.visible).map((x) => {
              // the faded icon is edited as its own box (inside a dashed clip area), not as the clip area
              const b = x.kind === 'watermark' ? { x: x.x + x.ox, y: x.y + x.oy, w: x.size, h: x.size } : x
              const badge = dragKind === 'resize' ? `${Math.round(b.w)} × ${Math.round(b.h)}` : dragKind === 'move' || dragKind === 'icon' ? `${Math.round(b.x)}, ${Math.round(b.y)}` : null
              return (
              <div key={x.id} className={'el-box selected' + (x.locked ? ' locked' : '') + (selEls.length > 1 ? ' multi' : '') + (dragKind ? ' dragging' : '')} style={boxStyle(b)}>
                {x.kind === 'watermark' && <div className="clip-area" style={{ left: px(x.x - b.x), top: px(x.y - b.y), width: px(x.w), height: px(x.h) }} />}
                {single && !dragKind && <span className="el-tag" title="Drag to move" onPointerDown={(e) => startTagDrag(e, x)}><Icon name={KIND_ICON[x.kind]} size={11} strokeWidth={2} />{x.name}{x.locked && <Icon name="lock" size={10} strokeWidth={2.2} />}</span>}
                {single && !x.locked && handlesFor(x).map((h) => (
                  <i key={h} className={'handle ' + (h.length === 2 ? 'corner' : h === 'n' || h === 's' ? 'edge-h' : 'edge-v')} style={{ left: `${HANDLE_POS[h][0] * 100}%`, top: `${HANDLE_POS[h][1] * 100}%`, cursor: HANDLE_CURSOR[h] }} onPointerDown={(e) => startResize(e, h)} />
                ))}
                {single && badge && <span className="size-badge">{badge}</span>}
              </div>
              )
            })}
            {single && single.visible && !dragKind && !editing && !pop && (() => {
              const b = single.kind === 'watermark' ? { x: single.x + single.ox, y: single.y + single.oy, w: single.size, h: single.size } : single
              const r = boxRect(b)
              const pill = single.id === 'headline' ? scene.elements.find((e) => e.id === 'link-pill' && e.visible) : null
              const pr = pill && pill.y < b.y && b.y - (pill.y + pill.h) < 64 ? boxRect(pill) : null
              const topEdge = pr ? pr.top : r.top
              const above = topEdge > 96
              const k = editKindOf(single)
              return (
                <div className={'qbar-anchor' + (above ? '' : ' below')} style={{ left: clampBar(r.left + r.width / 2), top: above ? (pr ? pr.top - 10 : r.top - 34) : r.top + r.height + 12 }}>
                  <Quickbar el={single} onEdit={k ? () => startEdit(single) : undefined} editLabel={k === 'date' ? 'Change date' : k === 'category' ? 'Change category' : k === 'label' ? 'Change label' : 'Edit text'} onHighlight={single.id === 'headline' ? () => startHighlight(single) : undefined} />
                </div>
              )
            })()}
            {group && <div className="el-box group" style={boxStyle(group)}><span className="el-tag">{selEls.length} layers</span></div>}
            {marquee && <div className="marquee" style={{ left: px(marquee.x), top: px(marquee.y), width: px(marquee.w), height: px(marquee.h) }} />}
            {snapLines.map((g, i) => <div key={i} className={'snap ' + g.axis} style={g.axis === 'x' ? { left: px(g.at) } : { top: px(g.at) }} />)}
            {guides.map((g) => (
              <div key={g.id} className={'ug ' + g.axis} style={g.axis === 'x' ? { left: px(g.at) } : { top: px(g.at) }}
                onPointerDown={(e) => startGuideDrag(e, g)} onDoubleClick={(e) => { e.stopPropagation(); useStore.getState().removeGuide(g.id) }} title="Drag to move · double-click to remove"><i /></div>
            ))}
            {draftGuide && <div className={'ug draft ' + draftGuide.axis} style={draftGuide.axis === 'x' ? { left: px(draftGuide.at) } : { top: px(draftGuide.at) }}><i /></div>}
            {editing && editEl && (
              <>
                {editing.content === 'headline' && (
                  <div className="canvas-hl-bar" style={{ left: clampBar(px(editEl.x + editEl.w / 2)), top: Math.max(8, px(editEl.y) - 14) }}
                    onPointerDown={(e) => { e.preventDefault(); e.stopPropagation() }}>
                    {inlineSel ? (
                      <button type="button" className="chl-btn primary" onClick={() => highlightInlineSelection(inlineSel)}>
                        <Icon name="sparkle" size={13} />Highlight “{inlineSel.length > 26 ? inlineSel.slice(0, 26) + '…' : inlineSel}”
                      </button>
                    ) : (
                      <span className="chl-tip"><Icon name="sparkle" size={12} />Select text to highlight</span>
                    )}
                    <button type="button" className="chl-btn" disabled={!editing.value.trim()} onClick={() => highlightInlineSelection(suggestHighlight(editing.value))}>
                      Suggest
                    </button>
                    {content.highlight.trim() && (
                      <button type="button" className="chl-btn clear" onClick={() => useStore.getState().setContent({ highlight: '' })} title={`Highlighted: ${content.highlight.trim()}`}>
                        <Icon name="x" size={11} />Clear “{content.highlight.trim().slice(0, 16)}”
                      </button>
                    )}
                    <i className="qb-sep" />
                    <button
                      type="button"
                      className="chl-btn"
                      title="Insert line break at cursor (or press Enter)"
                      onClick={() => {
                        const area = inlineRef.current
                        if (!area) return
                        const start = area.selectionStart ?? editing.value.length
                        const end = area.selectionEnd ?? start
                        const next = editing.value.slice(0, start) + '\n' + editing.value.slice(end)
                        setEditing({ ...editing, value: next })
                        setTimeout(() => {
                          area.focus()
                          area.setSelectionRange(start + 1, start + 1)
                        }, 0)
                      }}
                    >
                      Break ↵
                    </button>
                    <button
                      type="button"
                      className="chl-btn"
                      title="Intelligently balance headline into 2 lines at punctuation or natural word break"
                      onClick={() => {
                        const balanced = balanceHeadlineBreaks(editing.value)
                        setEditing({ ...editing, value: balanced })
                      }}
                    >
                      Auto-Balance
                    </button>
                    {editing.value.includes('\n') && (
                      <button
                        type="button"
                        className="chl-btn clear"
                        title="Remove all line breaks into a single line"
                        onClick={() => {
                          const flat = editing.value.replace(/\r?\n+/g, ' ')
                          setEditing({ ...editing, value: flat })
                        }}
                      >
                        1-Line
                      </button>
                    )}
                    <i className="qb-sep" />
                    <button type="button" className="chl-btn done" onClick={() => commitEdit(true)}>Done</button>
                  </div>
                )}
                <textarea ref={inlineRef} className="inline-edit" autoFocus value={editing.value}
                  style={{ left: px(editEl.x) - 4, top: px(editEl.y) - 4, minWidth: Math.max(120, px(editEl.w) + 8), height: px(editEl.h) + 8, fontFamily: `"${getFontDef(editEl.font).family}", Inter, sans-serif`, fontSize: px(editEl.size), fontWeight: editEl.weight, letterSpacing: px(editEl.ls), lineHeight: px(lineHeightPx(editEl)) + 'px', color: editEl.color, textAlign: editEl.align }}
                  onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                  onSelect={syncInlineSelection}
                  onKeyUp={syncInlineSelection}
                  onPointerUp={syncInlineSelection}
                  onBlur={() => commitEdit(true)}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Escape') {
                      commitEdit(false)
                    } else if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      commitEdit(true)
                    }
                    // Shift+Enter inserts a line break (\n) natively in the textarea
                  }}
                  onPointerDown={(e) => e.stopPropagation()} />
              </>
            )}
          </div>
        </div>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {pop?.kind === 'date' && <DatePopover value={content.date} onChange={(d) => useStore.getState().setContent({ date: d })} anchor={{ x: pop.x, y: pop.y }} onClose={() => setPop(null)} />}
      {pop?.kind === 'category' && <ContextMenu x={pop.x} y={pop.y} onClose={() => setPop(null)} items={[{ heading: 'Desk' } as MenuEntry, ...CATEGORIES.map((c) => ({ label: c.name, checked: c.id === content.categoryId, onClick: () => useStore.getState().setContent({ categoryId: c.id }) }))]} />}
      {pop?.kind === 'label' && <ContextMenu x={pop.x} y={pop.y} onClose={() => setPop(null)} items={[{ heading: 'Label pill' } as MenuEntry, { label: 'None', checked: content.label === 'none', onClick: () => useStore.getState().setContent({ label: 'none' }) }, ...(Object.keys(LABEL_PRESETS) as (keyof typeof LABEL_PRESETS)[]).map((id) => ({ label: LABEL_PRESETS[id].name, checked: content.label === id, onClick: () => useStore.getState().setContent({ label: id }) })), { label: 'Custom', checked: content.label === 'custom', onClick: () => useStore.getState().setContent({ label: 'custom' }) }]} />}
      {pop?.kind === 'highlight' && <HighlightPopover anchor={{ x: pop.x, y: pop.y }} onClose={() => setPop(null)} />}
    </div>
  )
}
