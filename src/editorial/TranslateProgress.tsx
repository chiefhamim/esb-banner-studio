// Live progress for the long jobs (fetch, translate, verify…): a running clock plus a checklist of the steps so far,
// each with the time it took, so the editor can see exactly what is slow. Fed only by the status text the desk already emits.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../ui/Icon'

interface Step { label: string; start: number; end?: number }
interface Run { steps: Step[]; start: number; end?: number }

const fmt = (ms: number) => (ms < 10_000 ? (ms / 1000).toFixed(1) : String(Math.round(ms / 1000))) + ' s'

export function TranslateProgress({ status }: { status: string | null }) {
  const [run, setRun] = useState<Run | null>(null)
  const [open, setOpen] = useState(true)
  const [, tick] = useState(0)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chipRef = useRef<HTMLButtonElement>(null)
  const [at, setAt] = useState<{ top: number; right: number } | null>(null)

  // status text drives the run: a new text closes the previous step and opens the next; null finishes the run
  useEffect(() => {
    const now = Date.now()
    setRun((r) => {
      if (status) {
        if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null }
        if (!r || r.end) { setOpen(true); return { start: now, steps: [{ label: status, start: now }] } }
        const last = r.steps[r.steps.length - 1]
        if (last.label === status) return r
        return { ...r, steps: [...r.steps.slice(0, -1), { ...last, end: now }, { label: status, start: now }] }
      }
      if (r && !r.end) {
        const last = r.steps[r.steps.length - 1]
        return { ...r, end: now, steps: [...r.steps.slice(0, -1), { ...last, end: now }] }
      }
      return r
    })
  }, [status])

  // the summary stays for a while after the run ends, then clears itself
  useEffect(() => {
    if (!run?.end) return
    hideTimer.current = setTimeout(() => setRun(null), 25_000)
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current) }
  }, [run?.end])

  // the clock only ticks while a run is live
  useEffect(() => {
    if (!run || run.end) return
    const id = setInterval(() => tick((n) => n + 1), 200)
    return () => clearInterval(id)
  }, [run])

  // the list floats above the whole window (portal + fixed), anchored under the chip, so no panel can cover or clip it
  useLayoutEffect(() => {
    if (!open || !run) return
    const place = () => { const r = chipRef.current?.getBoundingClientRect(); if (r) setAt({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) }) }
    place(); window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, run])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!run) return null
  const running = !run.end
  const now = Date.now()
  const total = (run.end ?? now) - run.start
  const current = run.steps[run.steps.length - 1]
  const slowest = run.steps.reduce((m, s) => Math.max(m, (s.end ?? now) - s.start), 0)

  return (
    <div className={'ed-topbar-progress ed-tp' + (running ? '' : ' done')}>
      <button ref={chipRef} type="button" className="ed-tp-chip" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Translation progress">
        {running ? <span className="pulse-dot" /> : <Icon name="check" size={13} />}
        <span className="ed-tp-label">{running ? current.label : `Done in ${fmt(total)}`}</span>
        <span className="ed-tp-time mono">{fmt(total)}</span>
      </button>
      {open && at && createPortal(
        <ol className="ed-tp-pop" role="status" aria-live="polite" style={{ top: at.top, right: at.right }}>
          {run.steps.map((s, i) => {
            const ms = (s.end ?? now) - s.start
            const live = !s.end
            return (
              <li key={i} className={(live ? 'live ' : 'ok ') + (!live && ms === slowest && run.steps.length > 1 ? 'slow' : '')}>
                <span className="ed-tp-mark">{live ? <span className="pulse-dot" /> : <Icon name="check" size={12} />}</span>
                <span className="ed-tp-step">{s.label}</span>
                <span className="ed-tp-ms mono">{fmt(ms)}</span>
              </li>
            )
          })}
          <li className="total"><span className="ed-tp-step">{running ? 'Elapsed' : 'Total'}</span><span className="ed-tp-ms mono">{fmt(total)}</span></li>
        </ol>,
        document.body,
      )}
    </div>
  )
}
