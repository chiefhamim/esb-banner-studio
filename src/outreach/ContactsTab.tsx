// The campaign's audience. Import an .xlsx or .csv, pick a sheet, narrow it to a group and a purpose, search, and see
// for every contact whether the batch will send to them — and if not, why (skipReason). Each row carries its state as
// a coloured edge, like the Editorial story queue. Nothing here is invented: a contact with no name shows its
// address, a row with no status says so.

import { useMemo, useRef } from 'react'
import { useOutreachStore } from './outreachStore'
import { skipReason } from './compose'
import { inAudience } from './campaign'
import { STATUS_LABEL, purposeLabel } from './directory'
import { Icon } from '../ui/Icon'
import { Select, Seg } from '../ui/controls'
import type { Contact } from './types'

type Row = { c: Contact; skip: string | null }
export type RowState = 'ready' | 'skip' | 'sent' | 'failed' | 'out' | 'busy'

export const rowState = ({ c, skip }: Row): { st: RowState; text: string; tip: string } => {
  if (c.status === 'SENDING') return { st: 'busy', text: 'Sending', tip: 'Being sent now' }
  if (c.status === 'SENT') return { st: 'sent', text: 'Sent', tip: c.sentAt ? `Sent ${new Date(c.sentAt).toLocaleString()}` : 'Sent' }
  if (c.status === 'FAILED') return { st: 'failed', text: 'Failed', tip: c.error || 'The server refused it' }
  if (c.status === 'OPTED_OUT') return { st: 'out', text: 'Opted out', tip: 'Asked not to be emailed' }
  if (skip) return { st: 'skip', text: 'Skipped', tip: skip }
  return { st: 'ready', text: 'Ready', tip: c.approved && c.mxStatus !== 'SAFE_TO_SEND' ? 'Approved by you' : STATUS_LABEL[c.mxStatus] }
}

export function ContactsTab() {
  const s = useOutreachStore()
  const c = s.campaign()
  const file = useRef<HTMLInputElement>(null)
  const idle = s.run === 'idle'
  const listMeta = s.lists.find((l) => l.id === c?.listId)

  const inAud = useMemo(() => s.contacts.filter((x) => inAudience(x, c?.audience)), [s.contacts, c?.audience])
  const rows: Row[] = useMemo(() => inAud.map((x) => ({ c: x, skip: c ? skipReason(x, c.subject, c.body) : null })), [inAud, c?.subject, c?.body]) // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => [...new Map(s.contacts.filter((x) => x.groupNo != null).map((x) => [x.groupNo!, x.sectorGroup])).entries()].sort((a, b) => a[0] - b[0]), [s.contacts])
  const purposes = useMemo(() => {
    const m = new Map<string, number>()
    for (const x of s.contacts) if (c?.audience.group == null || x.groupNo === c.audience.group) for (const p of x.purposes) m.set(p, (m.get(p) ?? 0) + 1)
    return [...m].sort((a, b) => b[1] - a[1])
  }, [s.contacts, c?.audience.group])
  const counts = useMemo(() => ({
    ready: rows.filter((r) => !r.skip && r.c.status === 'QUEUED').length,
    skipped: rows.filter((r) => r.skip && r.c.status === 'QUEUED').length,
    sent: rows.filter((r) => r.c.status === 'SENT').length,
    failed: rows.filter((r) => r.c.status === 'FAILED').length,
  }), [rows])
  const shown = useMemo(() => {
    const q = s.query.trim().toLowerCase()
    return rows.filter(({ c: x, skip }) => {
      if (s.view === 'ready' && (skip || x.status !== 'QUEUED')) return false
      if (s.view === 'skipped' && !(skip && x.status === 'QUEUED')) return false
      if (s.view === 'sent' && x.status !== 'SENT') return false
      if (s.view === 'failed' && x.status !== 'FAILED') return false
      return !q || [x.personName, x.organization, x.email, x.designation].some((v) => v.toLowerCase().includes(q))
    })
  }, [rows, s.view, s.query])

  const direct = c?.kind === 'direct'
  const pick = () => file.current?.click()

  return (
    <div className="or-tab">
      <div className="or-left-head">
        {direct ? (
          <div className="or-file">
            <span className="or-file-icon"><Icon name="mail" size={15} /></span>
            <div className="or-file-text"><b>Typed addresses</b><span>{s.contacts.length ? `${s.contacts.length} recipient${s.contacts.length === 1 ? '' : 's'} · from the To line` : 'Type addresses in the To line of the letter'}</span></div>
          </div>
        ) : (
          <div className="or-file">
            <span className="or-file-icon"><Icon name="users" size={15} /></span>
            <div className="or-file-text">
              <b title={listMeta?.fileName}>{listMeta?.fileName ?? 'No list loaded'}</b>
              <span>{s.contacts.length ? `${inAud.length} of ${s.contacts.length} in the audience · ${counts.ready} ready` : 'Excel (.xlsx) or CSV with an Email column'}</span>
            </div>
            <button type="button" className="btn sm" onClick={pick} disabled={!idle} data-tip={!idle ? 'Stop the batch to load another list' : 'Load a mailing list from this computer'}>
              <Icon name="upload" size={13} /><span>{listMeta ? 'Replace' : 'Import'}</span>
            </button>
          </div>
        )}
        <input ref={file} type="file" accept=".xlsx,.csv,.xls" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void s.importList(f); e.target.value = '' }} />
        {!direct && s.sheets.length > 1 && (
          <Select value={c?.sheet ?? ''} prefix="Sheet" onChange={(v) => s.setSheet(String(v))}
            options={(listMeta?.sheets ?? s.sheets.map((x) => ({ name: x.name, contacts: 0 }))).filter((x) => x.contacts || x.name === c?.sheet).map((x) => ({ value: x.name, label: x.name.replace(/_/g, ' '), hint: x.contacts ? String(x.contacts) : '' }))} />
        )}
        {!direct && groups.length > 1 && (
          <Select<number> value={c?.audience.group ?? -1} prefix="Group" onChange={(v) => s.setAudience({ group: v < 0 ? null : v, purposes: [] })}
            options={[{ value: -1, label: 'All groups' }, ...groups.map(([n, name]) => ({ value: n, label: name || `Group ${n}`, hint: String(n) }))]} />
        )}
        {!direct && purposes.length > 1 && (
          <Select<string> value={c?.audience.purposes[0] ?? ''} prefix="Purpose" onChange={(v) => s.setAudience({ purposes: v ? [v] : [] })}
            options={[{ value: '', label: 'Any purpose' }, ...purposes.map(([p, n]) => ({ value: p, label: purposeLabel(p), hint: String(n) }))]} />
        )}
        {s.contacts.length > 0 && (
          <>
            <label className="or-search">
              <Icon name="search" size={13} />
              <input type="search" placeholder="Search name, organisation, email" value={s.query} onChange={(e) => s.setQuery(e.target.value)} aria-label="Search contacts" />
            </label>
            <Seg<typeof s.view>
              className="or-filter"
              value={s.view}
              onChange={s.setView}
              options={[
                { value: 'all', label: 'All', tip: `${inAud.length} in the audience` },
                { value: 'ready', label: `Ready ${counts.ready}`, tip: 'The batch will send to these' },
                { value: 'skipped', label: `Skip ${counts.skipped}`, tip: 'Not sent until you fix or approve them' },
                { value: 'sent', label: `Sent ${counts.sent}` },
                ...(counts.failed ? [{ value: 'failed' as const, label: `Failed ${counts.failed}` }] : []),
              ]}
            />
          </>
        )}
        {s.importNote && <p className="or-note">{s.importNote}</p>}
      </div>

      <div className="or-list" role="listbox" aria-label="Contacts">
        {!s.contacts.length ? (
          direct ? <div className="or-empty"><Icon name="mail" size={22} /><b>An ordinary email</b><p>Type one or more addresses in the To line. Each gets their own copy — nobody sees the others.</p></div> : (
            <div className="or-empty">
              <Icon name="inbox" size={22} />
              <b>Import your mailing list</b>
              <p>One row per contact, with an Email column. Person Name, Designation, Organization, Sector Group, Purpose and Deliverability Status are read when present. A row that is not marked safe is only sent after you approve it.</p>
              <button type="button" className="btn primary sm" onClick={pick}><Icon name="upload" size={13} /><span>Import list</span></button>
            </div>
          )
        ) : !shown.length ? (
          <div className="or-empty"><p>No contact matches.</p></div>
        ) : shown.map((r) => {
          const st = rowState(r)
          const on = r.c.id === s.activeContact
          return (
            <button key={r.c.id} type="button" role="option" aria-selected={on} className={'or-row st-' + st.st + (on ? ' on' : '')} onClick={() => s.setActiveContact(r.c.id)}>
              <span className="or-row-main">
                <b>{r.c.personName || r.c.email}</b>
                <span>{[r.c.designation, r.c.organization].filter(Boolean).join(' · ') || 'No designation or organisation in the sheet'}</span>
                {r.c.personName && <span className="or-row-mail">{r.c.email}</span>}
              </span>
              <span className={'or-chip st-' + st.st} data-tip={st.tip}>{st.text}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
