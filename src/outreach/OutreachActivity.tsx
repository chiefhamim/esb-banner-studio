// What the desk did — imports, sends, replies, refusals, AI drafts — in the same Activity panel the Editorial desk
// uses (the `ed-tp-*` look: one clock button in the header, a panel floating under it). It was a full-width strip
// that opened under the header and pushed all three columns down; now it covers nothing until asked and closes with
// Esc or a click elsewhere.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useOutreachStore, type LogEntry } from './outreachStore'
import { Icon, type IconName } from '../ui/Icon'

type Kind = 'all' | 'ok' | 'info' | 'problem'
const KINDS: { kind: Kind; label: string }[] = [{ kind: 'all', label: 'All' }, { kind: 'ok', label: 'Sent' }, { kind: 'info', label: 'Notes' }, { kind: 'problem', label: 'Problems' }]
const kindOf = (l: LogEntry): Kind => (l.level === 'ok' ? 'ok' : l.level === 'info' ? 'info' : 'problem')
const ICON: Record<LogEntry['level'], IconName> = { ok: 'check', info: 'info', warn: 'info', error: 'x' }
const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export function OutreachActivity() {
  const log = useOutreachStore((s) => s.log)
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<Kind>('all')
  const [at, setAt] = useState<{ top: number; right: number } | null>(null)
  const chip = useRef<HTMLDivElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const problems = log.filter((l) => l.level === 'error').length

  useLayoutEffect(() => {
    if (!open) return
    const place = () => { const r = chip.current?.getBoundingClientRect(); if (r) setAt({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) }) }
    place(); window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onDown = (e: PointerEvent) => { const t = e.target as Node; if (!pop.current?.contains(t) && !chip.current?.contains(t)) setOpen(false) }
    window.addEventListener('keydown', onKey); window.addEventListener('pointerdown', onDown)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown) }
  }, [open])

  const shown = [...log].reverse().filter((l) => kind === 'all' || kindOf(l) === kind)

  return (
    <div ref={chip} className="ed-topbar-progress ed-tp" role="group" aria-label="Activity">
      <button type="button" className={'ed-tp-history' + (open ? ' on' : '')} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Activity"
        data-tip={log.length ? `Activity — ${log.length} ${log.length === 1 ? 'entry' : 'entries'}${problems ? `, ${problems} problem${problems === 1 ? '' : 's'}` : ''}` : 'Activity — imports, sends, replies and refusals are listed here'}>
        <Icon name="activity" size={16} />
        {log.length > 0 && <span className={'ed-tp-count' + (problems ? ' or-tp-bad' : '')}>{log.length > 99 ? '99+' : log.length}</span>}
      </button>
      {open && at && createPortal(
        <div ref={pop} className="ed-tp-pop or-tp-pop" role="log" aria-label="Outreach activity" style={{ top: at.top, right: at.right }}>
          <div className="ed-tp-head">
            <span className="ed-tp-head-ic"><Icon name="activity" size={15} /></span>
            <div className="ed-tp-head-t"><b>Activity</b><span>This session · {log.length} {log.length === 1 ? 'entry' : 'entries'}</span></div>
            {log.length > 0 && <button type="button" className="btn xs ghost" onClick={() => useOutreachStore.setState({ log: [] })}>Clear</button>}
          </div>
          {log.length > 1 && (
            <div className="ed-tp-kinds" role="tablist" aria-label="Filter">
              {KINDS.map(({ kind: k, label }) => {
                const n = k === 'all' ? log.length : log.filter((l) => kindOf(l) === k).length
                if (k !== 'all' && !n) return null
                return <button key={k} type="button" role="tab" aria-selected={kind === k} className={'ed-tp-kind-btn' + (kind === k ? ' on' : '')} onClick={() => setKind(k)}>{label}<span className="mono">{n}</span></button>
              })}
            </div>
          )}
          {!log.length && <p className="ed-tp-empty">Nothing yet. Importing a list, sending, a reply or a bounce read from the inbox, and anything the mail server refuses is listed here.</p>}
          <ul className="or-tp-list">
            {shown.map((l, i) => (
              <li key={`${l.t}-${i}`} className={'or-tp-row ' + l.level}>
                <span className="or-tp-mark"><Icon name={ICON[l.level]} size={12} /></span>
                <span className="or-tp-text">{l.text}</span>
                <time>{time(l.t)}</time>
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  )
}
