// The campaign's audience. Import an .xlsx or .csv, pick a sheet, narrow it to a group and a purpose, search, and see
// for every contact whether the batch will send to them — and if not, why (skipReason). Each row carries its state as
// a coloured edge, like the Editorial story queue. Nothing here is invented: a contact with no name shows its
// address, a row with no status says so.

import { useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useOutreachStore } from './outreachStore'
import { skipReason } from './compose'
import { inAudience } from './campaign'
import { STATUS_LABEL, purposeLabel } from './directory'
import { domainOf, roleMailbox, disposableDomain, summarizeChecks } from './addressCheck'
import { ask } from './outreachUi'
import { Icon } from '../ui/Icon'
import { Select } from '../ui/controls'
import type { Contact } from './types'

type Row = { c: Contact; skip: string | null }
export type RowState = 'ready' | 'skip' | 'sent' | 'failed' | 'out' | 'busy' | 'replied' | 'bounced'

export const rowState = ({ c, skip }: Row): { st: RowState; text: string; tip: string } => {
  if (c.status === 'SENDING') return { st: 'busy', text: 'Sending', tip: 'Being sent now' }
  if (c.status === 'REPLIED') return { st: 'replied', text: 'Replied', tip: c.repliedAt ? `Replied ${new Date(c.repliedAt).toLocaleString()}` : 'Replied' }
  if (c.status === 'BOUNCED') return { st: 'bounced', text: 'Bounced', tip: c.error || 'The mail system returned the letter' }
  if (c.status === 'SENT') return { st: 'sent', text: 'Sent', tip: c.sentAt ? `Sent ${new Date(c.sentAt).toLocaleString()}` : 'Sent' }
  if (c.status === 'FAILED') return { st: 'failed', text: 'Failed', tip: c.error || 'The server refused it' }
  if (c.status === 'OPTED_OUT') return { st: 'out', text: 'Opted out', tip: 'Asked not to be emailed' }
  if (skip) return { st: 'skip', text: 'Skipped', tip: skip }
  return { st: 'ready', text: 'Ready', tip: c.approved && c.mxStatus !== 'SAFE_TO_SEND' ? 'Approved by you' : STATUS_LABEL[c.mxStatus] }
}

// a list of thousands renders a page at a time; filtering and search still run over all of it
const PAGE = 200

export function ContactsTab() {
  // only what this tab reads: subscribing to the whole store re-rendered every row on each log line and inbox check
  const s = useOutreachStore(useShallow((x) => ({
    campaigns: x.campaigns, activeId: x.activeId, campaign: x.campaign, activeContact: x.activeContact, contacts: x.contacts,
    importList: x.importList, importNote: x.importNote, lists: x.lists, query: x.query, run: x.run, setActiveContact: x.setActiveContact,
    setAudience: x.setAudience, setQuery: x.setQuery, setSheet: x.setSheet, setView: x.setView, sheets: x.sheets, view: x.view,
    verifiedAddrs: x.verifiedAddrs, checkingAddresses: x.checkingAddresses, checkAddresses: x.checkAddresses, cancelCheckAddresses: x.cancelCheckAddresses,
    approveMany: x.approveMany, undoApproveMany: x.undoApproveMany, lastBulkApproval: x.lastBulkApproval, approved: x.approved,
  })))
  const c = s.campaign()
  const file = useRef<HTMLInputElement>(null)
  const idle = s.run === 'idle'
  const listMeta = s.lists.find((l) => l.id === c?.listId)

  const inAud = useMemo(() => s.contacts.filter((x) => inAudience(x, c?.audience)), [s.contacts, c?.audience])
  const rows: Row[] = useMemo(() => inAud.map((x) => ({ c: x, skip: c ? skipReason(x, c.subject, c.body) : null })), [inAud, c?.subject, c?.body]) // eslint-disable-line react-hooks/exhaustive-deps
  const eligibleForBulkApprove = useMemo(() => {
    return inAud.filter((x) => {
      if (x.approved) return false
      if (x.status === 'OPTED_OUT' || x.status === 'BOUNCED') return false
      if (x.mxStatus !== 'UNKNOWN' && x.mxStatus !== 'REVIEW_REQUIRED') return false
      const dom = domainOf(x.email)
      const ver = s.verifiedAddrs[dom]
      return ver && (ver.mx || ver.a)
    }).map((x) => x.email)
  }, [inAud, s.verifiedAddrs])

  const checkSummary = useMemo(() => {
    if (Object.keys(s.verifiedAddrs).length === 0) return null
    return summarizeChecks(inAud.map((x) => x.email), s.verifiedAddrs)
  }, [inAud, s.verifiedAddrs])

  const handleBulkApprove = async () => {
    const count = eligibleForBulkApprove.length
    if (!count) return
    const ok = await ask({
      title: `Approve ${count.toLocaleString()} addresses?`,
      body: 'They will be included in this and every campaign. You can undo this now.',
      ok: 'Approve',
    })
    if (ok) {
      s.approveMany(eligibleForBulkApprove)
    }
  }
  const groups = useMemo(() => [...new Map(s.contacts.filter((x) => x.groupNo != null).map((x) => [x.groupNo!, x.sectorGroup])).entries()].sort((a, b) => a[0] - b[0]), [s.contacts])
  const purposes = useMemo(() => {
    const m = new Map<string, number>()
    for (const x of s.contacts) if (c?.audience.group == null || x.groupNo === c.audience.group) for (const p of x.purposes) m.set(p, (m.get(p) ?? 0) + 1)
    return [...m].sort((a, b) => b[1] - a[1])
  }, [s.contacts, c?.audience.group])
  const counts = useMemo(() => ({
    ready: rows.filter((r) => !r.skip && r.c.status === 'QUEUED').length,
    skipped: rows.filter((r) => r.skip && r.c.status === 'QUEUED').length,
    sent: rows.filter((r) => r.c.status === 'SENT' || r.c.status === 'REPLIED').length,
    replied: rows.filter((r) => r.c.status === 'REPLIED').length,
    bounced: rows.filter((r) => r.c.status === 'BOUNCED').length,
    failed: rows.filter((r) => r.c.status === 'FAILED').length,
  }), [rows])
  const shown = useMemo(() => {
    const q = s.query.trim().toLowerCase()
    return rows.filter(({ c: x, skip }) => {
      if (s.view === 'ready' && (skip || x.status !== 'QUEUED')) return false
      if (s.view === 'skipped' && !(skip && x.status === 'QUEUED')) return false
      if (s.view === 'sent' && x.status !== 'SENT' && x.status !== 'REPLIED') return false
      if (s.view === 'failed' && x.status !== 'FAILED' && x.status !== 'BOUNCED') return false
      if (s.view === 'replied' && x.status !== 'REPLIED') return false
      if (s.view === 'has_server') {
        const ver = s.verifiedAddrs[domainOf(x.email)]
        if (!ver || (!ver.mx && !ver.a)) return false
      }
      if (s.view === 'no_server') {
        const ver = s.verifiedAddrs[domainOf(x.email)]
        if (!ver || ver.mx || ver.a) return false
      }
      if (s.view === 'role' && !roleMailbox(x.email)) return false
      if (s.view === 'disposable' && !disposableDomain(x.email)) return false
      return !q || [x.personName, x.organization, x.email, x.designation].some((v) => v.toLowerCase().includes(q))
    })
  }, [rows, s.view, s.query])
  // back to the first page whenever what is listed changes
  const [limit, setLimit] = useState(PAGE)
  const [listKey, setListKey] = useState('')
  const key = `${c?.id}|${s.view}|${s.query}`
  if (key !== listKey) { setListKey(key); setLimit(PAGE) }

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
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: '1 0 100%' }}>
              {s.contacts.length > 0 && (
                <button type="button" className="btn sm" onClick={() => void s.checkAddresses()} disabled={!idle || !!s.checkingAddresses?.active} data-tip="Check mail servers and disposable domains via DNS (no email sent)">
                  <Icon name="search" size={13} /><span>Check addresses</span>
                </button>
              )}
              <button type="button" className="btn sm" onClick={pick} disabled={!idle} data-tip={!idle ? 'Stop the batch to load another list' : 'Load a mailing list from this computer'}>
                <Icon name="upload" size={13} /><span className="or-btn-lbl">{listMeta ? 'Replace' : 'Import'}</span>
              </button>
            </div>
          </div>
        )}
        <input ref={file} type="file" accept=".xlsx,.csv,.xls" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void s.importList(f); e.target.value = '' }} />
        {!direct && s.sheets.length > 1 && (
          <Select value={c?.sheet ?? ''} prefix="Sheet" onChange={(v) => s.setSheet(String(v))}
            options={(listMeta?.sheets ?? s.sheets.map((x) => ({ name: x.name, contacts: 0 }))).filter((x) => x.contacts || x.name === c?.sheet).map((x) => ({ value: x.name, label: x.name.replace(/_/g, ' '), hint: x.contacts ? String(x.contacts) : '' }))} />
        )}
        {!direct && (groups.length > 1 || purposes.length > 1) && (
          <div className="or-pair">
            {groups.length > 1 && (
          <Select<number> value={c?.audience.group ?? -1} prefix="" onChange={(v) => s.setAudience({ group: v < 0 ? null : v, purposes: [] })}
            options={[{ value: -1, label: 'All groups' }, ...groups.map(([n, name]) => ({ value: n, label: name || `Group ${n}`, hint: String(n) }))]} />
        )}
            {purposes.length > 1 && (
          <Select<string> value={c?.audience.purposes[0] ?? ''} prefix="" onChange={(v) => s.setAudience({ purposes: v ? [v] : [] })}
            options={[{ value: '', label: 'Any purpose' }, ...purposes.map(([p, n]) => ({ value: p, label: purposeLabel(p), hint: String(n) }))]} />
        )}
          </div>
        )}
        {s.contacts.length > 0 && (
          <>
                    {s.checkingAddresses?.active && (
          <div className="or-checking-progress" role="status">
            <Icon name="refresh" size={13} className="spin" />
            <span>Checking {s.checkingAddresses.total.toLocaleString()} companies</span>
            <button type="button" className="btn xs" onClick={s.cancelCheckAddresses}>Cancel</button>
          </div>
        )}
        {checkSummary && (
          <div className="or-check-summary">
            <button type="button" className={'or-fchip' + (s.view === 'has_server' ? ' on' : '')} onClick={() => s.setView(s.view === 'has_server' ? 'all' : 'has_server')}>{checkSummary.hasMailServer.toLocaleString()} have a mail server</button>
            <span>·</span>
            <button type="button" className={'or-fchip' + (s.view === 'no_server' ? ' on' : '')} onClick={() => s.setView(s.view === 'no_server' ? 'all' : 'no_server')}>{checkSummary.noMailServer.toLocaleString()} none</button>
            <span>·</span>
            <button type="button" className={'or-fchip' + (s.view === 'role' ? ' on' : '')} onClick={() => s.setView(s.view === 'role' ? 'all' : 'role')}>{checkSummary.sharedMailboxes.toLocaleString()} shared mailboxes</button>
            <span>·</span>
            <button type="button" className={'or-fchip' + (s.view === 'disposable' ? ' on' : '')} onClick={() => s.setView(s.view === 'disposable' ? 'all' : 'disposable')}>{checkSummary.disposable.toLocaleString()} disposable</button>
          </div>
        )}
        {eligibleForBulkApprove.length > 0 && (
          <div className="or-bulk-approve-bar">
            <button type="button" className="btn sm primary or-bulk-approve-btn" onClick={handleBulkApprove}>
              <Icon name="check" size={13} /><span>Approve all that pass checks ({eligibleForBulkApprove.length})</span>
            </button>
            {s.lastBulkApproval && (
              <button type="button" className="or-link-btn" onClick={s.undoApproveMany}>Undo</button>
            )}
          </div>
        )}
        {eligibleForBulkApprove.length === 0 && s.lastBulkApproval && (
          <div className="or-bulk-approve-bar">
            <span>Bulk approval applied ({s.lastBulkApproval.added.length})</span>
            <button type="button" className="or-link-btn" onClick={s.undoApproveMany}>Undo bulk approval</button>
          </div>
        )}
<label className="or-search">
              <Icon name="search" size={13} />
              <input type="search" placeholder="Search contacts" value={s.query} onChange={(e) => s.setQuery(e.target.value)} aria-label="Search contacts" />
            </label>
            {/* a row of chips that wraps, not a six-way segmented control: the counts change length and six segments
                squeezed to 300 px left the labels touching each other and the edges */}
            <div className="or-chips" role="group" aria-label="Show">
              {([
                ['all', 'All', inAud.length, `${inAud.length} in the audience`],
                ['ready', 'Ready', counts.ready, 'The batch will send to these'],
                ['skipped', 'Skipped', counts.skipped, 'Not sent until you fix or approve them'],
                ['sent', 'Sent', counts.sent, 'Sent by this campaign'],
                ...(counts.replied ? [['replied', 'Replied', counts.replied, 'Answered — read from your inbox']] : []),
                ...(counts.failed + counts.bounced ? [['failed', 'Failed', counts.failed + counts.bounced, 'Refused when sent, or returned later by the mail system']] : []),
              ] as [typeof s.view, string, number, string][]).map(([v, label, n, tip]) => (
                <button key={v} type="button" className={'or-fchip' + (s.view === v ? ' on' : '')} aria-pressed={s.view === v} onClick={() => s.setView(v)} data-tip={tip}>
                  {label}<span>{n}</span>
                </button>
              ))}
            </div>
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
        ) : <>{shown.slice(0, limit).map((r) => {
          const st = rowState(r)
          const on = r.c.id === s.activeContact
          return (
            <button key={r.c.id} type="button" role="option" aria-selected={on} className={'or-row st-' + st.st + (on ? ' on' : '')} onClick={() => s.setActiveContact(r.c.id)}>
              <span className="or-row-main">
                <b>{r.c.personName || r.c.email}</b>
                <span className="or-row-org" title={[r.c.designation, r.c.organization].filter(Boolean).join(' · ')}>{[r.c.designation, r.c.organization].filter(Boolean).join(' · ') || 'No designation or organisation in the sheet'}</span>
                {r.c.personName && <span className="or-row-mail">{r.c.email.split('@')[0]}<wbr />@{r.c.email.split('@').slice(1).join('@')}</span>}
              </span>
              <span className={'or-chip st-' + st.st} data-tip={st.tip}>{st.text}</span>
            </button>
          )
        })}
        {shown.length > limit && (
          <button type="button" className="btn or-wide or-more" onClick={() => setLimit((n) => n + PAGE)}>
            Show {Math.min(PAGE, shown.length - limit)} more · {shown.length - limit} not shown
          </button>
        )}</>}
      </div>
    </div>
  )
}
