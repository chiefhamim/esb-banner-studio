// Left column: the mailing list. Import an .xlsx or .csv, pick a sheet and a group, search, and see for every
// contact whether the batch will send to them — and if not, why (skipReason). Nothing here is invented: a contact
// with no name shows its address, a row with no status says so.

import { useMemo, useRef } from 'react'
import { useOutreachStore } from './outreachStore'
import { skipReason } from './compose'
import { STATUS_LABEL } from './directory'
import { Icon } from '../ui/Icon'
import { Select, Seg } from '../ui/controls'
import type { Contact } from './types'

type Row = { c: Contact; skip: string | null }

const chipOf = ({ c, skip }: Row): { cls: string; text: string; tip: string } => {
  if (c.status === 'SENDING') return { cls: 'busy', text: 'Sending', tip: 'Being sent now' }
  if (c.status === 'SENT') return { cls: 'good', text: 'Sent', tip: c.sentAt ? `Sent ${new Date(c.sentAt).toLocaleString()}` : 'Sent' }
  if (c.status === 'FAILED') return { cls: 'bad', text: 'Failed', tip: c.error || 'The server refused it' }
  if (c.status === 'OPTED_OUT') return { cls: 'muted', text: 'Opted out', tip: 'Asked not to be emailed' }
  if (skip) return { cls: 'warn', text: 'Skipped', tip: skip }
  return { cls: 'ready', text: 'Ready', tip: c.approved ? 'Approved by you' : STATUS_LABEL[c.mxStatus] }
}

export function DirectoryPanel() {
  const s = useOutreachStore()
  const file = useRef<HTMLInputElement>(null)

  const rows: Row[] = useMemo(() => s.contacts.map((c) => ({ c, skip: skipReason(c, s.subject, s.body) })), [s.contacts, s.subject, s.body])
  const groups = useMemo(() => [...new Set(s.contacts.map((c) => c.sectorGroup).filter(Boolean))].sort(), [s.contacts])
  const counts = useMemo(() => ({
    ready: rows.filter((r) => !r.skip && r.c.status === 'QUEUED').length,
    skipped: rows.filter((r) => r.skip && r.c.status === 'QUEUED').length,
    sent: rows.filter((r) => r.c.status === 'SENT').length,
    failed: rows.filter((r) => r.c.status === 'FAILED').length,
  }), [rows])
  const shown = useMemo(() => {
    const q = s.query.trim().toLowerCase()
    return rows.filter(({ c, skip }) => {
      if (s.group && c.sectorGroup !== s.group) return false
      if (s.filter === 'ready' && (skip || c.status !== 'QUEUED')) return false
      if (s.filter === 'skipped' && !(skip && c.status === 'QUEUED')) return false
      if (s.filter === 'sent' && c.status !== 'SENT') return false
      if (s.filter === 'failed' && c.status !== 'FAILED') return false
      return !q || [c.personName, c.organization, c.email, c.designation].some((x) => x.toLowerCase().includes(q))
    })
  }, [rows, s.group, s.filter, s.query])

  return (
    <aside className="or-left" aria-label="Mailing list">
      <div className="or-left-head">
        <div className="or-file">
          <span className="or-file-icon"><Icon name="users" size={15} /></span>
          <div className="or-file-text">
            <b title={s.fileName || undefined}>{s.fileName || 'No list loaded'}</b>
            <span>{s.contacts.length ? `${s.contacts.length} contacts · ${counts.ready} ready` : 'Excel (.xlsx) or CSV with an Email column'}</span>
          </div>
          <button type="button" className="btn sm" onClick={() => file.current?.click()} disabled={s.campaign !== 'idle'} data-tip={s.campaign !== 'idle' ? 'Stop the batch to load another list' : 'Load a mailing list from this computer'}>
            <Icon name="upload" size={13} /><span>{s.fileName ? 'Replace' : 'Import'}</span>
          </button>
          <input ref={file} type="file" accept=".xlsx,.csv,.xls" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void s.loadFile(f); e.target.value = '' }} />
        </div>
        {s.sheets.length > 1 && (
          <Select value={s.sheet} options={s.sheets.map((x) => ({ value: x.name, label: x.name.replace(/_/g, ' ') }))} onChange={(v) => s.setSheet(String(v))} prefix="Sheet" />
        )}
        {groups.length > 1 && (
          <Select value={s.group} options={[{ value: '', label: 'All groups' }, ...groups.map((g) => ({ value: g, label: g }))]} onChange={(v) => s.setGroup(String(v))} prefix="Group" />
        )}
        {s.contacts.length > 0 && (
          <>
            <label className="or-search">
              <Icon name="search" size={13} />
              <input type="search" placeholder="Search name, organisation, email" value={s.query} onChange={(e) => s.setQuery(e.target.value)} aria-label="Search contacts" />
            </label>
            <Seg<typeof s.filter>
              className="or-filter"
              value={s.filter}
              onChange={s.setFilter}
              options={[
                { value: 'all', label: 'All', tip: `${s.contacts.length} contacts` },
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
          <div className="or-empty">
            <Icon name="inbox" size={22} />
            <b>Import your mailing list</b>
            <p>One row per contact. The columns read are Email (required), Person Name, Designation, Organization, Sector Group and Deliverability Status. A row whose status is not SAFE is only sent after you approve it.</p>
            <button type="button" className="btn primary sm" onClick={() => file.current?.click()}><Icon name="upload" size={13} /><span>Import list</span></button>
          </div>
        ) : !shown.length ? (
          <div className="or-empty"><p>No contact matches.</p></div>
        ) : shown.map((r) => {
          const chip = chipOf(r)
          const on = r.c.id === s.activeId
          return (
            <button key={r.c.id} type="button" role="option" aria-selected={on} className={'or-row' + (on ? ' on' : '')} onClick={() => s.setActive(r.c.id)}>
              <span className="or-row-main">
                <b>{r.c.personName || r.c.email}</b>
                <span>{[r.c.designation, r.c.organization].filter(Boolean).join(' · ') || 'No designation or organisation in the sheet'}</span>
                {r.c.personName && <span className="or-row-mail">{r.c.email}</span>}
              </span>
              <span className={'or-chip ' + chip.cls} data-tip={chip.tip}>{chip.text}</span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
