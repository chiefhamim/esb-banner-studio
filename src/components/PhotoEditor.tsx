// src/components/PhotoEditor.tsx
// The photo editor in the Photos panel: looks previewed on the photo itself, Light · Colour · Finish sliders, black &
// white, flips, hold-to-compare, copy the edit to every photo, and save the edited photo at full size for use elsewhere.
// Edits are non-destructive (core/photoEdit.ts) and belong to the photo, so every banner format shows the same edit.

import { useEffect, useMemo, useState } from 'react'
import { LOOKS, drawVignette, editedPhotoCanvas, renderEdit, slotAdjust } from '../core/photoEdit'
import type { PhotoAdjust } from '../core/types'
import { imageAssets, useStore } from '../store'
import { Scrub, Seg, Switch } from '../ui/controls'
import { Icon } from '../ui/Icon'

type Tab = 'light' | 'colour' | 'finish'

const SLIDERS: Record<Tab, { key: keyof PhotoAdjust; label: string; min: number; max: number }[]> = {
  light: [
    { key: 'exposure', label: 'Exposure', min: -100, max: 100 },
    { key: 'contrast', label: 'Contrast', min: -100, max: 100 },
    { key: 'highlights', label: 'Highlights', min: -100, max: 100 },
    { key: 'shadows', label: 'Shadows', min: -100, max: 100 },
    { key: 'whites', label: 'Whites', min: -100, max: 100 },
    { key: 'blacks', label: 'Blacks', min: -100, max: 100 },
  ],
  colour: [
    { key: 'temp', label: 'Temperature', min: -100, max: 100 },
    { key: 'tint', label: 'Tint', min: -100, max: 100 },
    { key: 'vibrance', label: 'Vibrance', min: -100, max: 100 },
    { key: 'saturation', label: 'Saturation', min: -100, max: 100 },
  ],
  finish: [
    { key: 'sharpen', label: 'Sharpen', min: 0, max: 100 },
    { key: 'grain', label: 'Grain', min: 0, max: 100 },
    { key: 'fade', label: 'Fade', min: 0, max: 100 },
    { key: 'vignette', label: 'Vignette', min: 0, max: 100 },
    { key: 'blur', label: 'Blur', min: 0, max: 20 },
  ],
}

/** Small previews of every look, drawn from the photo itself (once per photo). */
function useLookThumbs(src: string | null): Record<string, string> {
  // keyed by the photo, so another photo never shows the last one's previews (and nothing is reset in the effect)
  const [thumbs, setThumbs] = useState<{ src: string | null; map: Record<string, string> }>({ src: null, map: {} })
  useEffect(() => {
    const img = src ? imageAssets[src] : null
    if (!img) return
    // let the panel paint first; the previews are a nicety, never in the way
    const id = window.setTimeout(() => {
      const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height
      const s = 120 / Math.min(w0, h0)
      // halve in steps with high-quality smoothing: one big jump to 120 px aliases into noise
      let step: HTMLCanvasElement | HTMLImageElement = img, sw = w0, sh = h0
      const tw = Math.max(1, Math.round(w0 * s)), th = Math.max(1, Math.round(h0 * s))
      while (sw / 2 > tw) {
        const c = document.createElement('canvas'); c.width = Math.round(sw / 2); c.height = Math.round(sh / 2)
        const x = c.getContext('2d')!; x.imageSmoothingQuality = 'high'; x.drawImage(step, 0, 0, c.width, c.height)
        step = c; sw = c.width; sh = c.height
      }
      const small = document.createElement('canvas'); small.width = tw; small.height = th
      const sx = small.getContext('2d')!; sx.imageSmoothingQuality = 'high'; sx.drawImage(step, 0, 0, tw, th)
      const out: Record<string, string> = {}
      for (const l of LOOKS) {
        const cv = renderEdit(small, l.a)
        drawVignette(cv.getContext('2d')!, { x: 0, y: 0, w: cv.width, h: cv.height }, l.a.vignette ?? 0)
        out[l.id] = cv.toDataURL('image/jpeg', 0.8)
      }
      setThumbs({ src, map: out })
    }, 60)
    return () => window.clearTimeout(id)
  }, [src])
  return thumbs.src === src ? thumbs.map : {}
}

export function PhotoEditor({ slot }: { slot: number }) {
  const st = useStore.getState
  const format = useStore((s) => s.format)
  const cur = useStore((s) => s.doc.photos.slots[s.format][slot])
  const slotCount = useStore((s) => s.doc.photos.slots[s.format].filter((x) => x?.src).length)
  const [tab, setTab] = useState<Tab>('light')
  const [saving, setSaving] = useState(false)
  const a = useMemo(() => slotAdjust(cur), [cur])
  const thumbs = useLookThumbs(cur?.src ?? null)
  const edited = Object.entries(a).some(([k, v]) => k !== 'look' && v !== undefined && v !== 0 && v !== false)
  void format

  if (!cur?.src) return null
  const set = (patch: Partial<PhotoAdjust>) => st().setSlotAdjust(slot, { ...patch, look: undefined })

  const save = async (type: 'png' | 'jpeg') => {
    const img = imageAssets[cur.src!]
    if (!img) return
    setSaving(true)
    try {
      const cv = editedPhotoCanvas(img, a)
      const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, type === 'png' ? 'image/png' : 'image/jpeg', 0.95))
      if (!blob) throw new Error('Could not encode the photo')
      const name = `edited-photo-${new Date().toLocaleDateString('en-CA')}.${type === 'png' ? 'png' : 'jpg'}`
      if (window.esb?.saveImage) {
        const path = await window.esb.saveImage(name, new Uint8Array(await blob.arrayBuffer()))
        if (path) st().setNotice?.(`Saved the edited photo · ${cv.width} × ${cv.height} px`)
      } else {
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a'); link.href = url; link.download = name; link.click()
        setTimeout(() => URL.revokeObjectURL(url), 4000)
      }
    } catch (err) {
      st().setNotice?.(`Could not save the photo: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="photo-editor">
      <div className="pe-head">
        <span className="pe-title"><Icon name="sliders" size={14} />Edit photo</span>
        <button type="button" className="btn sm ghost pe-compare" disabled={!edited}
          onPointerDown={() => st().setPhotoOriginal(true)} onPointerUp={() => st().setPhotoOriginal(false)} onPointerLeave={() => st().setPhotoOriginal(false)}
          onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') st().setPhotoOriginal(true) }} onKeyUp={() => st().setPhotoOriginal(false)}
          data-tip="Hold to see the photo without the edit">
          <Icon name="eye" size={14} /><span>Original</span>
        </button>
        {edited && <button type="button" className="btn sm ghost" onClick={() => st().setSlotAdjust(slot, null)} data-tip="Remove every edit from this photo"><Icon name="reset" size={14} /><span>Reset</span></button>}
      </div>

      <div className="pe-looks" role="radiogroup" aria-label="Looks">
        {LOOKS.map((l) => (
          <button key={l.id} type="button" role="radio" aria-checked={a.look === l.id || (l.id === 'natural' && !edited)}
            className={'pe-look' + (a.look === l.id || (l.id === 'natural' && !edited) ? ' on' : '')}
            onClick={() => st().setSlotAdjust(slot, { ...l.a, look: l.id }, { replace: true })}>
            {thumbs[l.id] ? <img src={thumbs[l.id]} alt="" draggable={false} /> : <span className="pe-look-ph" />}
            <span>{l.name}</span>
          </button>
        ))}
      </div>

      <Seg<Tab> className="block pe-tabs" value={tab} onChange={setTab}
        options={[{ value: 'light', icon: 'sun', label: 'Light' }, { value: 'colour', icon: 'palette', label: 'Colour' }, { value: 'finish', icon: 'sparkle', label: 'Finish' }]} />

      <div className="pe-sliders">
        {SLIDERS[tab].map((sl) => (
          <div key={sl.key} className={'pe-slider' + (a[sl.key] ? ' changed' : '')}>
            <Scrub label={sl.label} value={(a[sl.key] as number | undefined) ?? 0} min={sl.min} max={sl.max} decimals={0} unit={sl.key === 'blur' ? 'px' : ''} onChange={(v) => set({ [sl.key]: v })} />
            <input type="range" className={'slider pe-range' + (sl.min < 0 ? ' centred' : '')} min={sl.min} max={sl.max} step={1}
              value={(a[sl.key] as number | undefined) ?? 0} aria-label={sl.label}
              style={{ ['--p' as string]: `${((((a[sl.key] as number | undefined) ?? 0) - sl.min) / (sl.max - sl.min)) * 100}%` }}
              onChange={(e) => set({ [sl.key]: Number(e.target.value) })}
              onDoubleClick={() => set({ [sl.key]: 0 })} />
          </div>
        ))}
        {tab === 'colour' && <Switch checked={!!a.mono} onChange={(v) => set({ mono: v })} label="Black & white" />}
      </div>

      <div className="pe-row">
        <button type="button" className={'btn sm' + (a.flipX ? ' on' : '')} aria-pressed={!!a.flipX} onClick={() => set({ flipX: !a.flipX })}><Icon name="swap" size={14} /><span>Flip</span></button>
        <button type="button" className={'btn sm' + (a.flipY ? ' on' : '')} aria-pressed={!!a.flipY} onClick={() => set({ flipY: !a.flipY })}><Icon name="swap" size={14} className="rot90" /><span>Flip vertical</span></button>
      </div>
      <div className="pe-row">
        {slotCount > 1 && (
          <button type="button" className="btn sm" disabled={!edited} onClick={() => { st().doc.photos.slots[st().format].forEach((x, i) => { if (x?.src && i !== slot) st().setSlotAdjust(i, a, { replace: true }) }) }}
            data-tip="Give every photo in the collage this edit"><Icon name="copy" size={14} /><span>Copy to all photos</span></button>
        )}
        <button type="button" className="btn sm" disabled={saving} onClick={() => void save('jpeg')} data-tip="The photo alone, with this edit, at full size (JPEG)"><Icon name="download" size={14} /><span>{saving ? 'Saving' : 'Save edited photo'}</span></button>
        <button type="button" className="btn sm ghost" disabled={saving} onClick={() => void save('png')} data-tip="The same as PNG (larger, lossless)">PNG</button>
      </div>
      <p className="hint">Edits never change the original photo, show in every banner format, and can be reset at any time. Double-click a slider to zero it.</p>
    </div>
  )
}
