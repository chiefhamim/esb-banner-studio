import { useCallback, useEffect, useRef, useState } from 'react'
import type { El, Override, PhotosEl, TextEl } from '../core/types'
import { useStore } from '../store'
import { ColorField, IconButton, MenuList, Popover } from '../ui/controls'
import type { MenuEntry } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { balanceHeadlineBreaks } from '../editorial/translator'

/** Size field that commits on Enter / blur and steps with the arrow keys. */
function Stepper({ value, onChange, onReset, min, max, unit, label }: { value: number; onChange: (v: number) => void; onReset?: () => void; min: number; max: number; unit?: string; label: string }) {
  const [text, setText] = useState(String(Math.round(value * 10) / 10))
  useEffect(() => setText(String(Math.round(value * 10) / 10)), [value])
  const commit = () => { const n = parseFloat(text); if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n))); else setText(String(value)) }
  return (
    <span className={'qb-step' + (onReset ? ' modified' : '')} role="group" aria-label={label}>
      <button type="button" aria-label={`${label} smaller`} data-tip={`${label} −`} onClick={() => onChange(Math.max(min, Math.round(value) - 1))}><Icon name="minus" size={12} strokeWidth={2.2} /></button>
      <input value={text} inputMode="decimal" aria-label={label}
        onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur() }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); onChange(Math.min(max, Math.max(min, value + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1)))) }
        }} />
      {unit && <em>{unit}</em>}
      <button type="button" aria-label={`${label} bigger`} data-tip={`${label} +`} onClick={() => onChange(Math.min(max, Math.round(value) + 1))}><Icon name="plus" size={12} strokeWidth={2.2} /></button>
      {onReset && (
        <button type="button" className="qb-step-rst" aria-label={`Reset ${label.toLowerCase()}`} data-tip={`Reset ${label.toLowerCase()} to default`} onClick={onReset}>
          <Icon name="reset" size={11} strokeWidth={2.2} />
        </button>
      )}
    </span>
  )
}

/**
 * The floating toolbar that follows the selected layer, so the common edits happen right on the banner:
 * type size, weight, alignment and colour for text; colour for shapes and icons; zoom for photos; plus granular reset / duplicate / lock / hide / delete.
 */
export function Quickbar({ el, onEdit, editLabel, onHighlight }: { el: El; onEdit?: () => void; editLabel?: string; onHighlight?: () => void }) {
  const st = useStore.getState
  const format = useStore((s) => s.format)
  const selectedSlot = useStore((s) => s.selectedSlot)
  const ov: Override | undefined = useStore((s) => s.doc.overrides[`${s.format}:${el.id}`])
  const highlight = useStore((s) => s.doc.content.highlight)
  const headlineBg = useStore((s) => s.doc.content.headlineBg)
  const headlineBgAlpha = useStore((s) => s.doc.content.headlineBgAlpha ?? 0.76)
  const bandOpacity = useStore((s) => s.doc.content.bandOpacity ?? 1)
  const set = (p: Record<string, unknown>) => st().setOverride(el.id, p)
  const clear = (fields: (keyof Override)[]) => st().clearOverrideFields(el.id, fields)
  const text = el.kind === 'text' ? (el as TextEl) : null
  const photos = el.kind === 'photos' ? (el as PhotosEl) : null
  const slot = photos?.slots[selectedSlot] ?? null
  const isExtra = el.id.startsWith('x-')

  const [resetOpen, setResetOpen] = useState(false)
  const resetCaretRef = useRef<HTMLButtonElement>(null)
  const closeReset = useCallback(() => setResetOpen(false), [])

  const hasPos = ov?.dx !== undefined || ov?.dy !== undefined || ov?.iconDx !== undefined || ov?.iconDy !== undefined
  const hasSize = ov?.size !== undefined || ov?.w !== undefined || ov?.h !== undefined || ov?.iconSize !== undefined || ov?.radius !== undefined
  const hasColor = ov?.color !== undefined || ov?.fill !== undefined
  const hasStyle = ov?.weight !== undefined || ov?.align !== undefined || ov?.font !== undefined || ov?.ls !== undefined || ov?.lh !== undefined
  const hasFx = ov?.opacity !== undefined || ov?.iconOpacity !== undefined || ov?.iconStroke !== undefined || ov?.blur !== undefined || ov?.shadow !== undefined || ov?.stroke !== undefined
  const hasText = ov?.text !== undefined
  const hasPhotoFraming = !!(photos && slot?.src && (Math.abs((slot.zoom || 1) - 1) > 1e-3 || Math.abs(slot.panX) > 1e-3 || Math.abs(slot.panY) > 1e-3))
  const hasHighlight = el.id === 'headline' && !!highlight.trim()
  const hasAny = !!ov || hasPhotoFraming || hasHighlight

  const resetAllOnLayer = () => {
    if (ov) st().resetOverride(el.id)
    if (hasPhotoFraming) st().setSlot(selectedSlot, { zoom: 1, panX: 0, panY: 0 })
    void format
  }

  const resetItems: MenuEntry[] = [
    { label: 'Reset everything to default', icon: 'reset', disabled: !ov && !hasPhotoFraming, onClick: resetAllOnLayer },
    { divider: true },
    { label: 'Reset position (X, Y)', disabled: !hasPos, onClick: () => clear(['dx', 'dy', 'iconDx', 'iconDy']) },
    { label: 'Reset size & dimensions', disabled: !hasSize, onClick: () => clear(['size', 'w', 'h', 'iconSize', 'radius']) },
    { label: 'Reset colour', disabled: !hasColor, onClick: () => clear(['color', 'fill']) },
    ...(text ? [{ label: 'Reset text style & align', disabled: !hasStyle, onClick: () => clear(['weight', 'align', 'font', 'ls', 'lh']) }] : []),
    { label: 'Reset opacity & effects', disabled: !hasFx, onClick: () => clear(['opacity', 'iconOpacity', 'iconStroke', 'blur', 'shadow', 'stroke']) },
    ...(hasText ? [{ label: 'Reset text wording', onClick: () => clear(['text']) }] : []),
    ...(el.id === 'headline' ? [{ divider: true }, { label: 'Clear headline highlight', icon: 'sparkle' as const, disabled: !hasHighlight, onClick: () => st().setContent({ highlight: '' }) }] : []),
    ...(photos ? [{ divider: true }, { label: `Reset slot ${selectedSlot + 1} framing`, disabled: !hasPhotoFraming, onClick: () => st().setSlot(selectedSlot, { zoom: 1, panX: 0, panY: 0 }) }] : []),
  ]

  return (
    <div className="qbar" role="toolbar" aria-label={`Edit ${el.name}`} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
      {onEdit && (
        <>
          <button type="button" className="qb-text" onClick={onEdit}>
            <Icon name={editLabel === 'Change date' ? 'calendar' : editLabel === 'Change category' ? 'palette' : editLabel === 'Change label' ? 'sparkle' : 'type'} size={14} />
            {editLabel ?? 'Edit text'}
          </button>
          {el.id === 'headline' && onHighlight && (
            <span className="qb-hl-split">
              <button type="button" className={'qb-text' + (hasHighlight ? ' on' : '')} data-tip="Select words in the headline to highlight" onClick={onHighlight}>
                <Icon name="sparkle" size={13} />Highlight
              </button>
              {hasHighlight && (
                <button type="button" className="qb-i qb-hl-clear" aria-label="Clear highlight" data-tip={`Clear highlight (“${highlight.trim()}”)`} onClick={() => st().setContent({ highlight: '' })}>
                  <Icon name="x" size={11} strokeWidth={2.3} />
                </button>
              )}
            </span>
          )}
          <i className="qb-sep" />
        </>
      )}

      {text && (
        <>
          <Stepper label="Size" value={text.size} min={6} max={600} unit="px" onChange={(v) => set({ size: v })} onReset={ov?.size !== undefined ? () => clear(['size']) : undefined} />
          <button type="button" className={'qb-i' + (text.weight >= 700 ? ' on' : '')} aria-pressed={text.weight >= 700} data-tip="Bold" onClick={() => set({ weight: text.weight >= 700 ? 500 : 700 })}><b>B</b></button>
          <span className="qb-grp">
            {(['left', 'center', 'right'] as const).map((a) => (
              <button key={a} type="button" className={'qb-i' + (text.align === a ? ' on' : '')} aria-pressed={text.align === a} data-tip={`Align ${a}`} onClick={() => st().setAlignText(el.id, a)}>
                <Icon name={a === 'left' ? 'alignTextLeft' : a === 'center' ? 'alignTextCenter' : 'alignTextRight'} size={14} />
              </button>
            ))}
          </span>
          <ColorField value={text.color} onChange={(c) => set({ color: c })} onReset={ov?.color !== undefined ? () => clear(['color']) : undefined} className="qb-color" />
          {el.id === 'headline' && (
            <>
              {st().doc.content.headline.includes('\n') ? (
                <button
                  type="button"
                  className="qb-text on"
                  data-tip="Line break active — click to remove breaks into 1 line"
                  onClick={() => st().setContent({ headline: st().doc.content.headline.replace(/\r?\n+/g, ' ') })}
                >
                  <Icon name="type" size={13} />1-Line
                </button>
              ) : (
                <button
                  type="button"
                  className="qb-text"
                  data-tip="Auto-balance headline across 2 lines at punctuation or natural word break"
                  onClick={() => st().setContent({ headline: balanceHeadlineBreaks(st().doc.content.headline) })}
                >
                  <Icon name="type" size={13} />Auto-Break ↵
                </button>
              )}
              <button
                type="button"
                className={'qb-text' + (headlineBg ? ' on' : '')}
                data-tip="Translucent glass backdrop — drag headline anywhere over the photo"
                onClick={() => {
                  const next = !headlineBg
                  st().setContent({
                    headlineBg: next,
                    bandOpacity: next && bandOpacity === 1 ? 0 : (!next && bandOpacity === 0 ? 1 : bandOpacity),
                  })
                }}
              >
                <Icon name="layers" size={13} />Translucent
              </button>
              {headlineBg && (
                <Stepper
                  label="Glass"
                  value={Math.round(headlineBgAlpha * 100)}
                  min={15}
                  max={98}
                  unit="%"
                  onChange={(v) => st().setContent({ headlineBgAlpha: v / 100 })}
                />
              )}
            </>
          )}
          <i className="qb-sep" />
        </>
      )}
      {el.kind === 'rect' && typeof el.fill === 'string' && (
        <>
          <ColorField value={el.fill} onChange={(c) => set({ fill: c })} onReset={ov?.fill !== undefined ? () => clear(['fill']) : undefined} className="qb-color" />
          <Stepper label="Radius" value={el.radius} min={0} max={400} onChange={(v) => set({ radius: v })} onReset={ov?.radius !== undefined ? () => clear(['radius']) : undefined} />
          <i className="qb-sep" />
        </>
      )}
      {(el.kind === 'icon' && el.ink) && (
        <>
          <ColorField value={el.ink} onChange={(c) => set({ color: c })} onReset={ov?.color !== undefined ? () => clear(['color']) : undefined} className="qb-color" />
          <i className="qb-sep" />
        </>
      )}
      {el.kind === 'watermark' && (
        <>
          <ColorField value={el.color} onChange={(c) => set({ color: c })} onReset={ov?.color !== undefined ? () => clear(['color']) : undefined} className="qb-color" />
          <Stepper label="Opacity" value={Math.round(el.maxOpacity * 100)} min={0} max={100} unit="%" onChange={(v) => set({ iconOpacity: v / 100 })} onReset={ov?.iconOpacity !== undefined ? () => clear(['iconOpacity']) : undefined} />
          <i className="qb-sep" />
        </>
      )}
      {photos && (
        <>
          {slot?.src
            ? <><Stepper label="Zoom" value={Math.round((slot.zoom || 1) * 100)} min={10} max={600} unit="%" onChange={(v) => st().setSlot(selectedSlot, { zoom: v / 100 })} onReset={hasPhotoFraming ? () => st().setSlot(selectedSlot, { zoom: 1, panX: 0, panY: 0 }) : undefined} />
              <button type="button" className="qb-text" onClick={() => st().setSlot(selectedSlot, { zoom: 1, panX: 0, panY: 0 })}>Fill</button></>
            : <span className="qb-note">Slot {selectedSlot + 1} is empty</span>}
          <button type="button" className="qb-text" onClick={() => window.dispatchEvent(new CustomEvent('esb:add-photos'))}><Icon name="plus" size={13} strokeWidth={2.2} />Photo</button>
          <i className="qb-sep" />
        </>
      )}
      {el.kind !== 'text' && el.kind !== 'rect' && el.kind !== 'icon' && el.kind !== 'watermark' && el.kind !== 'photos' && (
        <Stepper label="Opacity" value={Math.round(el.opacity * 100)} min={0} max={100} unit="%" onChange={(v) => set({ opacity: v / 100 })} onReset={ov?.opacity !== undefined ? () => clear(['opacity']) : undefined} />
      )}

      <span className={'qb-reset-grp' + (hasAny ? ' active' : '')}>
        <button type="button" className="qb-text qb-reset-btn" disabled={!ov && !hasPhotoFraming} aria-label="Reset to default" data-tip="Reset layer to default" onClick={resetAllOnLayer}>
          <Icon name="reset" size={13} />Reset
        </button>
        <button ref={resetCaretRef} type="button" className="qb-i qb-reset-caret" disabled={!hasAny} aria-label="Reset options" data-tip="Reset specific property (position, size, colour…)" onClick={() => setResetOpen((o) => !o)}>
          <Icon name="chevDown" size={11} />
        </button>
      </span>
      {resetOpen && resetCaretRef.current && (
        <Popover anchor={{ el: resetCaretRef.current }} align="center" gap={8} onClose={closeReset} className="menu" minWidth={228}>
          <MenuList items={resetItems} onDone={closeReset} />
        </Popover>
      )}
      <i className="qb-sep" />

      {el.kind !== 'photos' && <IconButton icon="copy" tip="Duplicate (Ctrl+D)" size={14} onClick={() => st().duplicateSelected()} />}
      <IconButton icon={el.locked ? 'lock' : 'unlock'} tip={el.locked ? 'Unlock' : 'Lock in place'} size={14} active={el.locked} onClick={() => set({ locked: !el.locked })} />
      <IconButton icon="eyeOff" tip="Hide (switch it back on in Elements)" size={14} onClick={() => set({ visible: false })} />
      <IconButton icon="trash" tip={isExtra ? 'Delete layer (Del)' : 'Hide template element (Del)'} size={14} onClick={() => st().deleteSelected()} />
    </div>
  )
}
