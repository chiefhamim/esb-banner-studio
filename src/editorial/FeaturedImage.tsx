// Featured image for the Editorial desk: the CMS "Featured image" card, wired to the same photo slot the banner uses.
// Framing and tone edits here are the banner's own slot edits (one store, no copy), so a change made in Graphics shows
// up here and a change made here shows up on the banner. The preview is drawn with the renderer's own drawSlotImage,
// so it is the same pixels Graphics paints.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as RPointerEvent } from 'react'
import { imageAssets, useStore } from '../store'
import { useEditorialStore } from './editorialStore'
import { useShellStore } from '../shell/shellStore'
import { drawSlotImage, slotRects } from '../core/render'
import type { PhotosEl } from '../core/types'
import { Icon } from '../ui/Icon'
import { Field, Scrub, Slider } from '../ui/controls'
import { bannerImageIdForUrl, importImageToBanner } from './automation'

interface PhotoChoice { key: string; thumb: string; title: string; active: boolean; pick: () => void }

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v))

export function FeaturedImage({ onToast }: { onToast: (msg: string) => void }) {
  const format = useStore((s) => s.format)
  const slot = useStore((s) => s.doc.photos.slots[s.format][0])
  const backdrop = useStore((s) => s.doc.photos.backdrop)
  const images = useStore((s) => s.images)
  const doc = useStore((s) => s.doc)
  const source = useEditorialStore((s) => s.source)
  const credit = useEditorialStore((s) => s.draft.credit)
  const imageAlt = useEditorialStore((s) => s.draft.imageAlt)
  const imageCaption = useEditorialStore((s) => s.draft.imageCaption)
  const setDraftField = useEditorialStore((s) => s.setDraftField)

  // The banner's photo element for this format: its first slot is the featured photo and sets the preview's shape.
  const photosEl = useMemo(
    () => useStore.getState().scene().elements.find((e): e is PhotosEl => e.kind === 'photos') ?? null,
    // the scene depends on the doc and format; recompute when either moves
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, format],
  )
  const rect = photosEl ? slotRects(photosEl)[0] : null
  const aspect = rect ? rect.h / rect.w : 0.66

  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [w, setW] = useState(280)
  const [dropping, setDropping] = useState(false)
  const [loadTick, setLoadTick] = useState(0)

  useEffect(() => {
    const el = hostRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const record = slot?.src ? images.find((i) => i.id === slot.src) : undefined
  // imageAssets fills as photos decode; if this one is not there yet, decode it here and redraw when it lands
  useEffect(() => {
    if (!slot?.src || imageAssets[slot.src] || !record?.url) return
    const im = new Image()
    im.onload = () => { if (slot.src && !imageAssets[slot.src]) imageAssets[slot.src] = im; setLoadTick((t) => t + 1) }
    im.src = record.url
  }, [slot?.src, record?.url])

  const h = Math.round(w * aspect)
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = Math.round(w * dpr)
    cv.height = Math.round(h * dpr)
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const img = slot?.src ? imageAssets[slot.src] : undefined
    if (!img || !slot) return
    drawSlotImage(ctx, img, slot, { x: 0, y: 0, w, h }, backdrop ?? 'blur', photosEl?.tint ?? '#e4e4e7')
  }, [w, h, slot, backdrop, photosEl?.tint, loadTick])

  // Drag to reframe: pan is -1..1 across the overflow, the same units the banner uses.
  const drag = useRef<{ x: number; y: number; panX: number; panY: number; ox: number; oy: number } | null>(null)
  const onDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    const img = slot?.src ? imageAssets[slot.src] : undefined
    if (!img || !slot) return
    const s = Math.max(w / img.width, h / img.height) * (slot.zoom || 1)
    drag.current = { x: e.clientX, y: e.clientY, panX: slot.panX, panY: slot.panY, ox: img.width * s - w, oy: img.height * s - h }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current
    if (!d) return
    const panX = d.ox > 0.5 ? clamp1(d.panX - (2 * (e.clientX - d.x)) / d.ox) : d.panX
    const panY = d.oy > 0.5 ? clamp1(d.panY - (2 * (e.clientY - d.y)) / d.oy) : d.panY
    useStore.getState().setSlot(0, { panX, panY }, true)
  }
  const onUp = () => {
    const cur = useStore.getState().doc.photos.slots[useStore.getState().format][0]
    if (drag.current && cur) useStore.getState().setSlot(0, { panX: cur.panX, panY: cur.panY })
    drag.current = null
  }

  // Photo choices: story photos first, then the banner's library.
  const choices: PhotoChoice[] = useMemo(() => {
    const out: PhotoChoice[] = []
    const used = new Set<string>()
    ;(source?.images ?? []).slice(0, 8).forEach((img, i) => {
      const id = bannerImageIdForUrl(img.src)
      if (id) used.add(id)
      out.push({
        key: 'src-' + img.src,
        thumb: img.src,
        title: img.caption || (i === 0 ? 'Story lead photo' : `Story photo ${i + 1}`),
        active: !!id && slot?.src === id,
        pick: () => { void importImageToBanner(img.src, `story-photo-${i + 1}.jpg`, { slotIndex: 0 }) },
      })
    })
    for (const im of images) {
      if (used.has(im.id)) continue
      out.push({
        key: im.id,
        thumb: im.url,
        title: im.name,
        active: slot?.src === im.id,
        pick: () => {
          const st = useStore.getState()
          if (st.doc.photos.collage !== 'single') st.setCollage('single')
          st.assignImage(0, im.id)
        },
      })
    }
    return out
  }, [source?.images, images, slot?.src])

  const addFiles = async (files: File[]) => {
    const pics = files.filter((f) => f.type.startsWith('image/'))
    if (!pics.length) { onToast('Drop an image file (JPG, PNG, WebP)'); return }
    const before = useStore.getState().images.length
    await useStore.getState().addImages(pics.slice(0, 1))
    const st = useStore.getState()
    const added = st.images[st.images.length - 1]
    if (added && st.images.length > before) {
      if (st.doc.photos.collage !== 'single') st.setCollage('single')
      st.assignImage(0, added.id)
      onToast('Featured photo set')
    }
  }

  const containZoom = () => {
    const img = slot?.src ? imageAssets[slot.src] : undefined
    if (!img || !rect) return 1
    return Math.min(rect.w / img.width, rect.h / img.height) / Math.max(rect.w / img.width, rect.h / img.height)
  }

  const set = (patch: Parameters<ReturnType<typeof useStore.getState>['setSlot']>[1]) => useStore.getState().setSlot(0, patch)
  const toned = !!(slot && (slot.brightness || slot.contrast || slot.saturation || slot.warmth || slot.vignette))
  const framed = !!(slot && (slot.zoom !== 1 || slot.panX || slot.panY))
  const hasPhoto = !!(slot?.src && record)

  const editInGraphics = () => {
    useShellStore.getState().openGraphicsFrom('editorial', 'photos')
  }

  return (
    <div className="fi">
      <div
        ref={hostRef}
        className={'fi-frame' + (dropping ? ' dropping' : '') + (hasPhoto ? '' : ' empty')}
        style={{ height: hasPhoto ? h : undefined }}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true) } }}
        onDragLeave={() => setDropping(false)}
        onDrop={(e) => { e.preventDefault(); setDropping(false); void addFiles(Array.from(e.dataTransfer.files)) }}
      >
        {hasPhoto ? (
          <canvas
            ref={canvasRef}
            className="fi-canvas"
            style={{ width: w, height: h }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onWheel={(e) => { if (!slot) return; const z = Math.exp(Math.log(slot.zoom || 1) - e.deltaY * 0.0015); set({ zoom: Math.max(0.1, Math.min(6, z)) }) }}
            aria-label="Featured photo. Drag to reframe, scroll to zoom."
          />
        ) : (
          <button type="button" className="fi-empty" onClick={() => fileRef.current?.click()}>
            <Icon name="image" size={20} />
            <b>Add a featured photo</b>
            <span>Drop an image here, or pick one of the story photos below</span>
          </button>
        )}
        {dropping && <div className="fi-drop"><Icon name="upload" size={18} /><span>Drop to set the featured photo</span></div>}
      </div>

      {hasPhoto && (
        <div className="fi-meta">
          <span title={record?.name}>{record?.name}</span>
          <span>{rect ? `${Math.round(rect.w)}×${Math.round(rect.h)} on the banner` : ''}</span>
        </div>
      )}

      {choices.length > 0 && (
        <div className="fi-thumbs" role="listbox" aria-label="Photos to feature">
          {choices.map((c) => (
            <button key={c.key} type="button" role="option" aria-selected={c.active} className={'fi-thumb' + (c.active ? ' on' : '')} title={c.title} onClick={c.pick}>
              <img src={c.thumb} alt={c.title} loading="lazy" />
            </button>
          ))}
          <button type="button" className="fi-thumb add" title="Add a photo from disk" onClick={() => fileRef.current?.click()}>
            <Icon name="plus" size={16} />
          </button>
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; void addFiles(f) }} />

      {hasPhoto && slot && (
        <>
          <Field label={`Zoom · ${slot.zoom.toFixed(2)}×`}>
            <Slider value={Math.log(slot.zoom)} min={Math.log(0.1)} max={Math.log(6)} step={0.01} onChange={(v) => set({ zoom: Math.exp(v) })} />
          </Field>
          <div className="fi-row">
            <button type="button" className="btn sm" onClick={() => set({ zoom: 1, panX: 0, panY: 0 })} title="Fill the frame (crops the edges)">Fill</button>
            <button type="button" className="btn sm" onClick={() => set({ zoom: containZoom(), panX: 0, panY: 0 })} title="Show the whole photo">Fit whole</button>
            {framed && <button type="button" className="btn-link" onClick={() => set({ zoom: 1, panX: 0, panY: 0 })}>Reset framing</button>}
          </div>
          <div className="grid2">
            <Scrub label="Exposure" value={slot.brightness ?? 0} min={-100} max={100} unit="%" decimals={0} onChange={(v) => set({ brightness: v })} />
            <Scrub label="Contrast" value={slot.contrast ?? 0} min={-100} max={100} unit="%" decimals={0} onChange={(v) => set({ contrast: v })} />
          </div>
          <div className="grid2">
            <Scrub label="Saturation" value={slot.saturation ?? 0} min={-100} max={100} unit="%" decimals={0} onChange={(v) => set({ saturation: v })} />
            <Scrub label="Warmth" value={slot.warmth ?? 0} min={-100} max={100} unit="°" decimals={0} onChange={(v) => set({ warmth: v })} />
          </div>
          {toned && (
            <button type="button" className="btn-link fi-reset" onClick={() => set({ brightness: 0, contrast: 0, saturation: 0, warmth: 0, vignette: 0 })}>
              <Icon name="reset" size={11} /> Reset tone
            </button>
          )}
        </>
      )}

      <Field label="Image credit">
        <input type="text" className="input" value={credit} placeholder="e.g. Reuters / Jane Doe" onChange={(e) => setDraftField('credit', e.target.value)} />
      </Field>
      <Field label="Alt text">
        <textarea className="input fi-text" rows={2} maxLength={160} value={imageAlt} placeholder="What the photo shows — e.g. Drilling rig at a Sylhet gas field well site" onChange={(e) => setDraftField('imageAlt', e.target.value)} />
      </Field>
      <Field label="Caption">
        <textarea className="input fi-text" rows={2} maxLength={240} value={imageCaption} placeholder="Printed under the photo on the site — leave empty for none" onChange={(e) => setDraftField('imageCaption', e.target.value)} />
      </Field>

      <button type="button" className="btn block fi-open" onClick={editInGraphics} disabled={!hasPhoto} title="Open this photo in Graphics: layers, collage, vignette and the full banner">
        <Icon name="layers" size={14} />
        <span>Edit in Graphics</span>
        <Icon name="chevRight" size={13} />
      </button>
      <p className="hint">Framing and tone shape the banner. Publishing from the desktop app uploads the Web banner as the article image; alt text and caption go with it.</p>
    </div>
  )
}
