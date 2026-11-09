// What the desk did this session — imports, sends, replies, refusals, AI drafts. It was a pulse button in the header
// with a floating panel, a second door beside the Compose · Activity switch; it is now the Activity desk's
// "This session" tab (ActivityDesk.tsx), with the same filters (All · Sent · Notes · Problems) and Clear.

import { useState } from 'react'
import { useOutreachStore, type LogEntry } from './outreachStore'
import { Icon, type IconName } from '../ui/Icon'
import { fmtTime, useClockFormat } from '../ui/time'

type Kind = 'all' | 'ok' | 'info' | 'problem'
const KINDS: { kind: Kind; label: string }[] = [{ kind: 'all', label: 'All' }, { kind: 'ok', label: 'Sent' }, { kind: 'info', label: 'Notes' }, { kind: 'problem', label: 'Problems' }]
const kindOf = (l: LogEntry): Kind => (l.level === 'ok' ? 'ok' : l.level === 'info' ? 'info' : 'problem')
const ICON: Record<LogEntry['level'], IconName> = { ok: 'check', info: 'info', warn: 'info', error: 'x' }

export function SessionLog() {
  useClockFormat() // re-render when Home → Settings → Time format changes
  const log = useOutreachStore((s) => s.log)
  const [kind, setKind] = useState<Kind>('all')
  const shown = [...log].reverse().filter((l) => kind === 'all' || kindOf(l) === kind)

  return (
    <section className="oa-session" role="log" aria-label="This session">
      <div className="ed-tp-head">
        <span className="ed-tp-head-ic"><Icon name="activity" size={15} /></span>
        <div className="ed-tp-head-t"><b>This session</b><span>{log.length} {log.length === 1 ? 'entry' : 'entries'} · imports, sends, replies and refusals</span></div>
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
            <time>{fmtTime(l.t)}</time>
          </li>
        ))}
      </ul>
    </section>
  )
}
