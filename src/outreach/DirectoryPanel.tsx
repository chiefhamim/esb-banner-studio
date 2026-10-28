import { useMemo, useRef } from 'react'
import { useOutreachStore } from './outreachStore'
import { Icon } from '../ui/Icon'

export function DirectoryPanel() {
  const contacts = useOutreachStore((s) => s.contacts)
  const activeContactId = useOutreachStore((s) => s.activeContactId)
  const setActiveContactId = useOutreachStore((s) => s.setActiveContactId)
  const selectedSheet = useOutreachStore((s) => s.selectedSheet)
  const sheetNames = useOutreachStore((s) => s.sheetNames)
  const filterGroup = useOutreachStore((s) => s.filterGroup)
  const setFilterGroup = useOutreachStore((s) => s.setFilterGroup)
  const filterStatus = useOutreachStore((s) => s.filterStatus)
  const setFilterStatus = useOutreachStore((s) => s.setFilterStatus)
  const searchQuery = useOutreachStore((s) => s.searchQuery)
  const setSearchQuery = useOutreachStore((s) => s.setSearchQuery)
  const loadWorkbookData = useOutreachStore((s) => s.loadWorkbookData)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const buffer = ev.target?.result as ArrayBuffer
      if (buffer) loadWorkbookData(buffer)
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ''
  }

  // Auto-extract unique groups
  const availableGroups = useMemo(() => {
    const set = new Set<string>()
    for (const c of contacts) {
      if (c.sectorGroup) set.add(c.sectorGroup)
    }
    return ['ALL', ...Array.from(set).sort()]
  }, [contacts])

  // Filtered contacts
  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()
    return contacts.filter((c) => {
      if (filterGroup !== 'ALL' && c.sectorGroup !== filterGroup) return false
      if (filterStatus !== 'ALL') {
        if (filterStatus === 'QUEUED' && c.trackingStatus !== 'QUEUED') return false
        if (filterStatus === 'SENT' && c.trackingStatus !== 'SENT') return false
        if (filterStatus === 'OPENED' && c.trackingStatus !== 'OPENED') return false
        if (filterStatus === 'FAILED' && c.trackingStatus !== 'FAILED') return false
      }
      if (!q) return true
      return (
        c.personName.toLowerCase().includes(q) ||
        c.organization.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.designation.toLowerCase().includes(q)
      )
    })
  }, [contacts, filterGroup, filterStatus, searchQuery])

  return (
    <aside className="left ed-left outreach-left" aria-label="Directory & Contacts">
      {/* Top action bar */}
      <div className="outreach-dir-head">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="row" style={{ gap: 6, alignItems: 'center' }}>
            <Icon name="users" size={14} />
            <strong className="text-xs uppercase tracking-wider" style={{ fontSize: 11 }}>Directory Census</strong>
          </div>
          <button
            type="button"
            className="btn xs"
            data-tip="Import custom Excel or CSV list"
            onClick={() => fileInputRef.current?.click()}
          >
            <Icon name="upload" size={12} />
            <span>Import</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>

        {/* Sheet picker & count pill */}
        <div className="row" style={{ gap: 6, marginTop: 8 }}>
          <select
            className="select xs"
            style={{ flex: 1, height: 26, fontSize: 11 }}
            value={selectedSheet}
            onChange={(e) => {
              // trigger reload if workbook loaded
              const file = (window as unknown as { __lastWb?: ArrayBuffer }).__lastWb
              if (file) loadWorkbookData(file, e.target.value)
            }}
          >
            {sheetNames.map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
            ))}
          </select>
          <span className="pill xs" style={{ fontSize: 10, padding: '2px 6px' }}>
            {filtered.length} / {contacts.length}
          </span>
        </div>

        {/* Sector Group Filter */}
        {availableGroups.length > 2 && (
          <div className="row" style={{ marginTop: 4 }}>
            <select
              className="select xs"
              style={{ width: '100%', height: 24, fontSize: 10 }}
              value={filterGroup}
              onChange={(e) => setFilterGroup(e.target.value)}
            >
              {availableGroups.map((g) => (
                <option key={g} value={g}>{g === 'ALL' ? 'All Groups / Sectors' : g}</option>
              ))}
            </select>
          </div>
        )}

        {/* Search bar */}
        <div className="row search-box" style={{ marginTop: 6, position: 'relative' }}>
          <input
            type="text"
            className="input xs"
            style={{ width: '100%', paddingLeft: 24, fontSize: 11 }}
            placeholder="Search name, org, email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <span style={{ position: 'absolute', left: 7, top: 6, opacity: 0.5, pointerEvents: 'none' }}>
            <Icon name="globe" size={12} />
          </span>
        </div>

        {/* Status filter chips */}
        <div className="row" style={{ gap: 4, marginTop: 6, overflowX: 'auto', paddingBottom: 2 }}>
          {(['ALL', 'QUEUED', 'SENT', 'OPENED', 'FAILED'] as const).map((st) => (
            <button
              key={st}
              type="button"
              className={'pill xs' + (filterStatus === st ? ' on' : '')}
              style={{ fontSize: 10, padding: '1px 6px', cursor: 'pointer' }}
              onClick={() => setFilterStatus(st)}
            >
              {st === 'OPENED' ? '✓✓ Opened' : st === 'SENT' ? '✓ Sent' : st}
            </button>
          ))}
        </div>
      </div>

      {/* Contact list */}
      <div className="scroll custom-scroll" style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <div className="outreach-empty" style={{ padding: 24, textAlign: 'center', opacity: 0.6, fontSize: 12 }}>
            <Icon name="users" size={24} />
            <p style={{ marginTop: 8 }}>No contacts match filter.</p>
          </div>
        ) : (
          <div className="stack" style={{ gap: 2, padding: '4px 6px' }}>
            {filtered.map((c) => {
              const active = c.id === activeContactId
              return (
                <div
                  key={c.id}
                  className={'outreach-contact-card' + (active ? ' active' : '')}
                  onClick={() => setActiveContactId(c.id)}
                >
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span className="contact-name" title={c.personName}>{c.personName}</span>
                    {/* Mailtrack / delivery badge */}
                    {c.trackingStatus === 'OPENED' ? (
                      <span className="receipt-badge opened" title={`Opened ${c.openCount}×`}>
                        <Icon name="checkDouble" size={12} />
                        <span style={{ fontSize: 9, marginLeft: 2 }}>{c.openCount}×</span>
                      </span>
                    ) : c.trackingStatus === 'SENT' ? (
                      <span className="receipt-badge sent" title="Sent"><Icon name="check" size={11} /></span>
                    ) : c.mxStatus === 'SAFE_TO_SEND' ? (
                      <span className="mx-badge safe" title="MX Verified Safe"><Icon name="shield" size={10} /></span>
                    ) : (
                      <span className="mx-badge review" title="Review Required">?</span>
                    )}
                  </div>

                  <div className="contact-org" title={`${c.designation} · ${c.organization}`}>
                    {c.designation ? `${c.designation} · ` : ''}{c.organization}
                  </div>

                  <div className="row contact-meta" style={{ justifyContent: 'space-between', marginTop: 2 }}>
                    <span className="contact-email">{c.email}</span>
                    <span className="contact-grp">{c.sectorGroup ? c.sectorGroup.replace(/^GROUP\s+/i, 'G') : ''}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </aside>
  )
}
