import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import avatarUrl from '../assets/images/esb-avatar.png'
import { getCategory, getFormat } from '../core/tokens'
import { defaultCaption } from '../core/newsroom'
import { renderScene } from '../core/render'
import type { Assets } from '../core/render'
import { allAssets } from '../export'
import { useStore } from '../store'
import { IconButton, Seg } from '../ui/controls'
import { Icon } from '../ui/Icon'

type Device = 'phone' | 'desktop' | 'link'
const NATURAL: Record<Device, number> = { phone: 414, desktop: 760, link: 414 }

/** The banner itself, rendered live from the current document (same renderer as the editor and the export). Supports direct drag-anywhere positioning of the headline! */
export function BannerCanvas({ base, cssWidth, crop, interactive = true }: { base: Assets; cssWidth: number; crop?: number; interactive?: boolean }) {
  const format = useStore((s) => s.format)
  const doc = useStore((s) => s.doc)
  const images = useStore((s) => s.images)
  const ref = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; initDx: number; initDy: number; raf: number } | null>(null)
  const scene = useMemo(() => useStore.getState().scene(format), [format, doc])
  useLayoutEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const k = Math.min(1.6, (cssWidth * dpr) / scene.w) // enough pixels for the size it is shown at
    const bw = Math.round(scene.w * k), bh = Math.round(scene.h * k)
    const ctx = c.getContext('2d')!
    if (c.width !== bw || c.height !== bh) { c.width = bw; c.height = bh } else { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, bw, bh) }
    ctx.setTransform(k, 0, 0, k, 0, 0)
    renderScene(ctx, scene, allAssets(base))
  }, [scene, images, base, cssWidth])

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactive) return
    e.stopPropagation()
    const st = useStore.getState()
    const ov = st.doc.overrides[`${st.format}:headline`]
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initDx: ov?.dx ?? 0,
      initDy: ov?.dy ?? 0,
      raf: 0,
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current
    if (!d || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const scaleX = scene.w / rect.width
    const scaleY = scene.h / rect.height
    const nextDx = Math.round(d.initDx + (e.clientX - d.startX) * scaleX)
    const nextDy = Math.round(d.initDy + (e.clientY - d.startY) * scaleY)
    if (!d.raf) {
      d.raf = requestAnimationFrame(() => {
        if (dragRef.current) dragRef.current.raf = 0
        useStore.getState().setOverride('headline', { dx: nextDx, dy: nextDy })
      })
    }
  }

  const onPointerUp = () => {
    if (dragRef.current?.raf) cancelAnimationFrame(dragRef.current.raf)
    dragRef.current = null
  }

  return (
    <canvas
      ref={ref}
      className="fb-img"
      title={interactive ? 'Drag anywhere on preview to move the headline' : undefined}
      style={{ aspectRatio: String(crop ?? scene.w / scene.h), cursor: interactive ? 'grab' : undefined }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  )
}

const Svg = ({ d, size = 18, fill = false }: { d: string; size?: number; fill?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d.split(' M').map((p, i) => <path key={i} d={(i ? 'M' : '') + p} />)}</svg>
)
const ICON = {
  like: 'M7 10v12 M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z',
  comment: 'M7.9 20A9 9 0 1 0 4 16.1L2 22Z',
  share: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8 M16 6l-4-4-4 4 M12 2v13',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M2 12h20 M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
  more: 'M12 12h.01 M19 12h.01 M5 12h.01',
  close: 'M18 6L6 18 M6 6l12 12',
  home: 'M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z',
  friends: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  video: 'M5 3l14 9-14 9z',
  shop: 'M3 9l1-5h16l1 5 M3 9v11h18V9 M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M10.3 21a1.94 1.94 0 0 0 3.4 0',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3',
  plus: 'M5 12h14 M12 5v14',
  chat: 'M12 2a10 10 0 0 0-8.6 15.1L2 22l5.1-1.4A10 10 0 1 0 12 2z',
  wifi: 'M5 12.55a11 11 0 0 1 14.08 0 M1.42 9a16 16 0 0 1 21.16 0 M8.53 16.11a6 6 0 0 1 6.95 0 M12 20h.01',
}

/** Facebook shows the first few lines of a caption, then "… See more". */
function fbTruncate(text: string, desktop: boolean): { shown: string; more: boolean } {
  const maxLines = desktop ? 5 : 3
  const maxChars = desktop ? 260 : 130
  const lines = text.split('\n')
  let shown = lines.slice(0, maxLines).join('\n')
  let more = lines.length > maxLines
  if (shown.length > maxChars) { shown = shown.slice(0, maxChars - 3).trimEnd(); more = true }
  return { shown, more }
}

function Post({ base, device, zoom }: { base: Assets; device: Device; zoom: number }) {
  const content = useStore((s) => s.doc.content)
  const format = useStore((s) => s.format)
  const caption = (content.caption ?? defaultCaption(content)).trim()
  const cat = getCategory(content.categoryId)
  const link = device === 'link'
  const t = fbTruncate(caption, device === 'desktop')
  const width = (device === 'desktop' ? 500 : 390) * zoom
  return (
    <div className="fb-card">
      <div className="fb-head">
        <img src={avatarUrl} alt="" className="fb-avatar" />
        <div className="fb-who">
          <b>ESB Power Line</b>
          <span>Just now · <Svg d={ICON.globe} size={12} /></span>
        </div>
        <span className="fb-more"><Svg d={ICON.more} size={22} /></span>
        <span className="fb-more"><Svg d={ICON.close} size={20} /></span>
      </div>
      <p className="fb-text">{t.shown}{t.more && <>… <b className="fb-seemore">See more</b></>}</p>
      {link ? (
        <div className="fb-link">
          <BannerCanvas base={base} cssWidth={width} crop={1.91} />
          <div className="fb-link-meta">
            <small>ESBPOWERLINE.COM</small>
            <b>{content.headline.trim() || cat.name}</b>
            <span>{cat.name} — ESB PowerLine</span>
          </div>
        </div>
      ) : (
        <BannerCanvas base={base} cssWidth={width} />
      )}
      <div className="fb-counts">
        <span className="fb-bubbles"><i className="b1"><Svg d={ICON.like} size={10} /></i><i className="b2">♥</i><em>24</em></span>
        <span>3 comments · 2 shares</span>
      </div>
      <div className="fb-actions">
        <span><Svg d={ICON.like} size={20} />Like</span>
        <span><Svg d={ICON.comment} size={20} />Comment</span>
        <span><Svg d={ICON.share} size={20} />Share</span>
      </div>
      <p className="fb-note">{link ? 'Facebook crops link images to 1.91 : 1 from the centre.' : `Shown ${getFormat(format).ratio === '4:5' ? 'in full — 4:5 is the tallest the feed allows' : 'uncropped'}.`}</p>
    </div>
  )
}

/** A recognisable Facebook screen around the post: phone (status bar, app bar, tabs) or desktop (navbar + feed column). */
export function FacebookMock({ base, device, dark, zoom = 1 }: { base: Assets; device: Device; dark: boolean; zoom?: number }) {
  if (device === 'desktop') {
    return (
      <div className={'fb fb-desktop' + (dark ? ' dark' : '')}>
        <div className="fbd-nav">
          <div className="fbd-left"><i className="fbd-logo">f</i><span className="fbd-search"><Svg d={ICON.search} size={16} />Search</span></div>
          <div className="fbd-tabs">
            {[ICON.home, ICON.video, ICON.shop, ICON.friends].map((d, i) => <span key={i} className={i === 0 ? 'on' : ''}><Svg d={d} size={24} /></span>)}
          </div>
          <div className="fbd-right"><span className="fbd-circle"><Svg d={ICON.menu} size={18} /></span><span className="fbd-circle"><Svg d={ICON.chat} size={18} /></span><span className="fbd-circle"><Svg d={ICON.bell} size={18} /></span><img src={avatarUrl} alt="" className="fb-avatar" /></div>
        </div>
        <div className="fbd-feed"><Post base={base} device={device} zoom={zoom} /></div>
      </div>
    )
  }
  return (
    <div className={'fb fb-phone' + (dark ? ' dark' : '')}>
      <div className="fb-screen">
        <div className="fb-status">
          <b>9:41</b>
          <i className="fb-island" />
          <span className="fb-sys">
            <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor" aria-hidden><rect x="0" y="8" width="3" height="4" rx="1" /><rect x="5" y="5" width="3" height="7" rx="1" /><rect x="10" y="2.5" width="3" height="9.5" rx="1" /><rect x="15" y="0" width="3" height="12" rx="1" /></svg>
            <Svg d={ICON.wifi} size={16} />
            <svg width="26" height="12" viewBox="0 0 26 12" aria-hidden><rect x="0.5" y="0.5" width="22" height="11" rx="3.5" fill="none" stroke="currentColor" opacity=".45" /><rect x="2" y="2" width="19" height="8" rx="2.2" fill="currentColor" /><rect x="23.5" y="4" width="2" height="4" rx="1" fill="currentColor" opacity=".5" /></svg>
          </span>
        </div>
        <div className="fbp-bar">
          <span className="fbp-word">facebook</span>
          <span className="fbp-icons"><i><Svg d={ICON.plus} size={19} /></i><i><Svg d={ICON.search} size={18} /></i><i><Svg d={ICON.chat} size={18} /></i></span>
        </div>
        <div className="fbp-tabs">
          {[ICON.home, ICON.friends, ICON.video, ICON.shop, ICON.bell, ICON.menu].map((d, i) => <span key={i} className={i === 0 ? 'on' : ''}><Svg d={d} size={24} /></span>)}
        </div>
        <div className="fb-feed"><Post base={base} device={device} zoom={zoom} /><div className="fb-peek"><img src={avatarUrl} alt="" className="fb-avatar" /><span /></div></div>
        <i className="fb-home" />
      </div>
    </div>
  )
}

const KEY = 'esb-banner-studio/preview-window'
interface Saved { device: Device; dark: boolean; zoom: number; x: number; y: number }
const loadSaved = (): Saved => {
  try { const s = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (s) return { device: 'phone', dark: false, zoom: 1, x: -1, y: 72, ...s } } catch { /* ignore */ }
  return { device: 'phone', dark: false, zoom: 1, x: -1, y: 72 }
}

/** Floating live preview that stays open while editing. Dragging and corner-resizing write straight to the DOM (transform / zoom) and only commit to state on release, so both follow the display's refresh rate. */
export function PreviewWindow({ base, onClose }: { base: Assets; onClose: () => void }) {
  const [st, setSt] = useState<Saved>(loadSaved)
  const headlineBg = useStore((s) => s.doc.content.headlineBg)
  const bandOpacity = useStore((s) => s.doc.content.bandOpacity ?? 1)
  const win = useRef<HTMLDivElement>(null)
  const zoomBox = useRef<HTMLDivElement>(null)
  type Gesture = { kind: 'move' | 'size'; px: number; py: number; x: number; y: number; zoom: number; raf: number; nx?: number; ny?: number; nz?: number }
  const gesture = useRef<Gesture | null>(null)
  const frameFor = (zoom: number) => NATURAL[st.device] * zoom + 32
  const frame = frameFor(st.zoom)
  const clampPos = (x: number, y: number, w: number) => ({ x: Math.min(window.innerWidth - 120, Math.max(120 - w, x)), y: Math.min(window.innerHeight - 56, Math.max(8, y)) })
  // first open: sit just left of the right panel, so the inspector stays reachable
  const x0 = st.x < 0 ? Math.max(8, (document.querySelector('.right')?.getBoundingClientRect().left ?? window.innerWidth) - frame - 16) : st.x
  const patch = (p: Partial<Saved>) => setSt((s) => { const n = { ...s, ...p }; try { localStorage.setItem(KEY, JSON.stringify(n)) } catch { /* ignore */ } return n })

  useEffect(() => {
    const onResize = () => setSt((s) => ({ ...s })) // keep it reachable when the window shrinks
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const paint = (g: Gesture) => {
    if (g.kind === 'move' && g.nx !== undefined) win.current?.style.setProperty('transform', `translate3d(${g.nx}px, ${g.ny}px, 0)`)
    if (g.kind === 'size' && g.nz !== undefined) {
      if (win.current) win.current.style.width = frameFor(g.nz) + 'px'
      zoomBox.current?.style.setProperty('zoom', String(g.nz))
    }
  }
  const begin = (kind: 'move' | 'size') => (e: React.PointerEvent) => {
    if (kind === 'move' && (e.target as HTMLElement).closest('button, .seg-ctl, .switch, input')) return
    e.preventDefault()
    if (st.x < 0) patch({ x: x0 }) // pin it where it is, so resizing grows from the top-left corner
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    gesture.current = { kind, px: e.clientX, py: e.clientY, x: x0, y: st.y, zoom: st.zoom, raf: 0 }
  }
  const drag = (e: React.PointerEvent) => {
    const g = gesture.current
    if (!g) return
    const dx = e.clientX - g.px, dy = e.clientY - g.py
    if (g.kind === 'move') { const p = clampPos(g.x + dx, g.y + dy, win.current?.offsetWidth ?? frame); g.nx = p.x; g.ny = p.y }
    else g.nz = Math.min(1.6, Math.max(0.5, +(g.zoom + dx / NATURAL[st.device]).toFixed(3)))
    if (!g.raf) g.raf = requestAnimationFrame(() => { g.raf = 0; paint(g) })
  }
  const end = () => {
    const g = gesture.current
    gesture.current = null
    if (!g) return
    cancelAnimationFrame(g.raf)
    paint(g)
    if (g.kind === 'move' && g.nx !== undefined) patch({ x: g.nx, y: g.ny! })
    if (g.kind === 'size' && g.nz !== undefined) patch({ zoom: g.nz })
  }
  const p = clampPos(x0, st.y, frame)

  return (
    <div ref={win} className="pvw" style={{ transform: `translate3d(${p.x}px, ${p.y}px, 0)`, width: frame }} role="dialog" aria-label="Facebook preview">
      <header className="pvw-head" onPointerDown={begin('move')} onPointerMove={drag} onPointerUp={end} onPointerCancel={end}>
        <Icon name="grip" size={14} className="pvw-grip" />
        <div className="pvw-title"><b>Facebook preview</b><span><i />Live</span></div>
        <IconButton icon="x" tip="Close preview (P)" onClick={onClose} />
      </header>
      <div className="pvw-bar">
        <Seg value={st.device} onChange={(device) => patch({ device })} options={[{ value: 'phone', label: 'Phone' }, { value: 'desktop', label: 'Desktop' }, { value: 'link', label: 'Link post' }]} />
        <div className="pvw-zoom">
          <IconButton icon="minus" tip="Smaller" size={13} onClick={() => patch({ zoom: Math.max(0.5, +(st.zoom - 0.1).toFixed(2)) })} />
          <button className="pvw-pct" onClick={() => patch({ zoom: 1 })} title="Back to actual size">{Math.round(st.zoom * 100)}%</button>
          <IconButton icon="plus" tip="Bigger" size={13} onClick={() => patch({ zoom: Math.min(1.6, +(st.zoom + 0.1).toFixed(2)) })} />
          <i className="pill-sep" />
          <IconButton
            icon="layers"
            tip={headlineBg ? 'Disable translucent headline' : 'Translucent glass headline (drag anywhere on preview)'}
            size={14}
            active={Boolean(headlineBg)}
            className="toggle"
            onClick={() => {
              const next = !headlineBg
              useStore.getState().setContent({
                headlineBg: next,
                bandOpacity: next && bandOpacity === 1 ? 0 : (!next && bandOpacity === 0 ? 1 : bandOpacity),
              })
            }}
          />
          <IconButton icon={st.dark ? 'sun' : 'moon'} tip={st.dark ? 'Facebook light mode' : 'Facebook dark mode'} size={14} active={st.dark} className="toggle" onClick={() => patch({ dark: !st.dark })} />
        </div>
      </div>
      <div className="pvw-body">
        <div ref={zoomBox} style={{ zoom: st.zoom }}><FacebookMock base={base} device={st.device} dark={st.dark} zoom={st.zoom} /></div>
      </div>
      <div className="pvw-resize" role="separator" aria-label="Resize the preview" data-tip="Drag to resize" onPointerDown={begin('size')} onPointerMove={drag} onPointerUp={end} onPointerCancel={end} />
    </div>
  )
}
