import { useCallback, useRef, useState } from 'react'
import { FORMAT_LIST, getFormat } from '../core/tokens'
import type { FormatDef } from '../core/tokens'
import type { FormatId } from '../core/types'
import { SOCIAL_ICONS } from '../core/icons'
import { Popover } from '../ui/controls'
import { Icon } from '../ui/Icon'

/** The platform each format is made for, as a proper pictogram (brand marks for Facebook / YouTube, neutral line icons otherwise). */
export function FormatIcon({ f, size = 28 }: { f: FormatDef; size?: number }) {
  const g = Math.round(size * 0.6)
  const brand = f.id === 'fb45' || f.id === 'social' ? SOCIAL_ICONS.facebook : f.id === 'yt' ? SOCIAL_ICONS.youtube : null
  return (
    <span className={'ratio-glyph' + (f.id === 'social' ? ' legacy' : '')} style={{ width: size, height: size }} aria-hidden>
      {brand
        ? <svg width={g} height={(g * brand.vh) / brand.vw} viewBox={`0 0 ${brand.vw} ${brand.vh}`}>{brand.paths.map((p, i) => <path key={i} d={p.d} fill={p.fill ?? 'none'} />)}</svg>
        : <Icon name={f.id === 'web' ? 'globe' : 'image'} size={g} strokeWidth={1.7} />}
    </span>
  )
}

export function FormatPicker({ value, onChange }: { value: FormatId; onChange: (f: FormatId) => void }) {
  const btn = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const cur = getFormat(value)
  return (
    <>
      <button ref={btn} type="button" className={'fmtpick' + (open ? ' open' : '')} onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-label="Banner format">
        <FormatIcon f={cur} />
        <span className="fp-name">{cur.name}</span>
        <span className="fp-dims">{cur.ratio} · {cur.w}×{cur.h}</span>
        <Icon name="chevDown" size={14} className="chev" />
      </button>
      {open && btn.current && (
        <Popover anchor={{ el: btn.current }} onClose={close} align="center" gap={12} className="fmtmenu" minWidth={380}>
          <div className="fm-head">Banner format <small>each format keeps its own layout, photos and edits</small></div>
          {FORMAT_LIST.map((f) => (
            <button key={f.id} type="button" className={'fm-item' + (f.id === value ? ' on' : '')} onClick={() => { onChange(f.id); close() }}>
              <FormatIcon f={f} size={36} />
              <span className="fm-text">
                <b>{f.name}{f.tag && <em className={'tag-' + f.tag.toLowerCase()}>{f.tag}</em>}</b>
                <small>{f.note}</small>
              </span>
              <span className="fm-dims">{f.ratio}<br />{f.w}×{f.h}</span>
              {f.id === value && <Icon name="check" size={15} strokeWidth={2.4} className="fm-check" />}
            </button>
          ))}
        </Popover>
      )}
    </>
  )
}
