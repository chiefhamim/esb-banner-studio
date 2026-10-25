// One destination's picture settings, in the publish sheet. Closed it is one line - what will be sent (size, format,
// quality, pixels, measured file size); a click opens the controls (the same choices Export has).

import { useState } from 'react'
import { Icon } from '../ui/Icon'
import { Chip, Slider } from '../ui/controls'
import { WEB_LIMIT, SCALES, TYPES_FOR, humanSize, pixelSize, useImageBytes, usePublishImage } from './publishImage'
import type { Dest } from './publishImage'
import type { Assets } from '../core/render'

export function ImageOptions({ dest, base }: { dest: Dest; base: Assets | null }) {
  const o = usePublishImage((s) => s.opts[dest])
  const set = usePublishImage((s) => s.set)
  const [open, setOpen] = useState(false)
  const bytes = useImageBytes(base, dest, o)
  const px = pixelSize(dest, o)
  const over = dest === 'web' && bytes != null && bytes > WEB_LIMIT
  const kind = TYPES_FOR[dest].find((t) => t.id === o.type)?.name ?? ''
  return (
    <div className={'io' + (open ? ' open' : '') + (over ? ' bad' : '')}>
      <button type="button" className="io-sum" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="io-sum-main">{o.scale}× · {kind}{o.type === 'jpeg' ? ` · ${Math.round(o.quality * 100)}%` : ''}</span>
        <span className="io-sum-px">{px.w} × {px.h}</span>
        <span className="io-sum-size">{bytes == null ? 'measuring…' : '≈ ' + humanSize(bytes)}</span>
        <Icon name="chevDown" size={13} className="io-chev" />
      </button>
      {open && (
        <div className="io-body">
          <div className="io-row">
            <span className="io-k">Size</span>
            <div className="io-chips">{SCALES.map((v) => <Chip key={v} on={o.scale === v} onClick={() => set(dest, { scale: v })} title={`${v}× — ${pixelSize(dest, { ...o, scale: v }).w}×${pixelSize(dest, { ...o, scale: v }).h}`}>{v}×</Chip>)}</div>
          </div>
          <div className="io-row">
            <span className="io-k">Format</span>
            <div className="io-chips">{TYPES_FOR[dest].map((t) => <Chip key={t.id} on={o.type === t.id} onClick={() => set(dest, { type: t.id })}>{t.name}</Chip>)}</div>
          </div>
          {o.type === 'jpeg' ? (
            <div className="io-row">
              <span className="io-k">Quality</span>
              <Slider value={o.quality} min={0.5} max={1} step={0.01} onChange={(v) => set(dest, { quality: v })} className="io-slider" />
              <b className="io-q">{Math.round(o.quality * 100)}%</b>
            </div>
          ) : (
            <p className="io-note">{o.type === 'webp' ? 'WebP goes up as it is: highest quality, no extra compression. Only JPG is compressed.' : 'PNG is lossless: no compression.'}</p>
          )}
          {over && <p className="io-note bad">Over the site's 4 MB limit — lower the size or quality.</p>}
        </div>
      )}
    </div>
  )
}
