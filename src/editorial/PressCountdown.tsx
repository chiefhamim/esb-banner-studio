// "Going to press": the publish countdown, the desktop sibling of the phone's hold-to-publish card
// (esb-studio-phone src/mobile/editorial/HoldToPublish.tsx). Publish arms it; a card rises over the sheet with the ESB
// masthead stripe filling across the top, a seconds badge with an exact progress ring, and the things that are about to
// go live ticking off one by one. Cancel, Esc or a click outside stops it. At zero the badge turns into a green check,
// the title becomes "Publishing…", the card settles away and the publish starts — never before.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../ui/Icon'

export interface PressItem { label: string; sub?: string }

const GO_MS = 620
// the rows tick across the first 88 % of the countdown, so the last one lands just before zero
const TICK_SPAN = 0.88

export function PressCountdown({ ms, items, verb, sub, onFire, onCancel }: {
  ms: number; items: PressItem[]; verb: string; sub: string; onFire: () => void; onCancel: () => void
}) {
  const [p, setP] = useState(0)
  const [go, setGo] = useState(false)
  const t0 = useRef(performance.now())
  const raf = useRef(0)
  const fired = useRef(false)
  const n = Math.max(1, items.length)

  useEffect(() => {
    const tick = (now: number) => {
      const v = ms <= 0 ? 1 : Math.min(1, (now - t0.current) / ms)
      setP(v)
      if (v >= 1) {
        if (fired.current) return
        fired.current = true
        setGo(true)
        // paint the "go" frame, then start the work; the card settles away on its own
        requestAnimationFrame(() => window.setTimeout(onFire, 0))
        window.setTimeout(onCancel, GO_MS)
        return
      }
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !fired.current) { e.stopPropagation(); onCancel() } }
    window.addEventListener('keydown', key, true)
    return () => { cancelAnimationFrame(raf.current); window.removeEventListener('keydown', key, true) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const done = go ? n : Math.min(n, Math.floor((p / TICK_SPAN) * n + 1e-6))
  const left = Math.max(1, Math.ceil((1 - p) * (ms / 1000)))
  return createPortal(
    <div className={'gp-overlay' + (go ? ' is-go' : '')} style={{ ['--hold' as string]: go ? 1 : p }} onPointerDown={(e) => { if (e.target === e.currentTarget && !fired.current) onCancel() }} role="presentation">
      <section className="gp-card" role="alertdialog" aria-live="assertive" aria-label={`${verb} in ${left} seconds`}>
        <div className="gp-rule" aria-hidden><i /></div>
        <header className="gp-head">
          <span key={go ? 'go' : 'hold'} className={'gp-badge' + (go ? ' is-go' : '')} aria-hidden>
            <i className="gp-ring" />
            {go ? <Icon name="check" size={20} strokeWidth={2.6} /> : <b key={left}>{left}</b>}
          </span>
          <span className="gp-head-t">
            <b>{go ? `${verb === 'Update' ? 'Updating' : 'Publishing'}` : 'Going to press'}</b>
            <small>{go ? sub : 'Esc or Cancel stops it'}</small>
          </span>
        </header>
        <ul className="gp-list">
          {items.map((it, i) => (
            <li key={it.label} className={i < done ? 'is-done' : ''}>
              <span className="gp-tick" aria-hidden><Icon name="check" size={13} strokeWidth={3} /></span>
              <span className="gp-it"><b>{it.label}</b>{it.sub && <small>{it.sub}</small>}</span>
            </li>
          ))}
        </ul>
        <footer className="gp-foot">
          <button type="button" className="btn" disabled={go} onClick={onCancel}>Cancel</button>
        </footer>
      </section>
    </div>,
    document.body,
  )
}
