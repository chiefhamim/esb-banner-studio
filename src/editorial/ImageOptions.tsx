// One destination's picture settings, in the publish sheet: size, format, quality, and what that makes (pixels and file
// size, measured). The same choices Export has.

import { Chip, Slider } from '../ui/controls'
import { WEB_LIMIT, SCALES, TYPES_FOR, humanSize, pixelSize, useImageBytes, usePublishImage } from './publishImage'
import type { Dest } from './publishImage'
import type { Assets } from '../core/render'

export function ImageOptions({ dest, base }: { dest: Dest; base: Assets | null }) {
  const o = usePublishImage((s) => s.opts[dest])
  const set = usePublishImage((s) => s.set)
  const bytes = useImageBytes(base, dest, o)
  const px = pixelSize(dest, o)
  const over = dest === 'web' && bytes != null && bytes > WEB_LIMIT
  return (
    <div className="io">
      <div className="io-row">
        <span className="io-k">Size</span>
        <div className="io-chips">{SCALES.map((v) => <Chip key={v} on={o.scale === v} onClick={() => set(dest, { scale: v })} title={`${v}× — ${pixelSize(dest, { ...o, scale: v }).w}×${pixelSize(dest, { ...o, scale: v }).h}`}>{v}×</Chip>)}</div>
        <span className="io-k">Format</span>
        <div className="io-chips">{TYPES_FOR[dest].map((t) => <Chip key={t.id} on={o.type === t.id} onClick={() => set(dest, { type: t.id })}>{t.name}</Chip>)}</div>
      </div>
      {o.type !== 'png' && (
        <div className="io-row">
          <span className="io-k">Quality</span>
          <Slider value={o.quality} min={0.5} max={1} step={0.01} onChange={(v) => set(dest, { quality: v })} className="io-slider" />
          <b className="io-q">{Math.round(o.quality * 100)}%</b>
        </div>
      )}
      <div className={'io-out' + (over ? ' bad' : '')}>
        <span>{px.w} × {px.h} px</span>
        <span>{bytes == null ? 'measuring…' : '≈ ' + humanSize(bytes)}</span>
        {over && <em>Over the site's 4 MB limit — lower the size or quality.</em>}
      </div>
    </div>
  )
}
