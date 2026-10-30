// src/outreach/ActivityLog.tsx
// Activity Desk Log tab: filterable, searchable, expandable transaction log (§3.5, §5.7).

import { useState } from 'react'
import { useActivityStore, type LogChip } from './activityStore'
import { describeEvent, fmtClock, fmtDay } from './activityFormat'
import { Icon } from '../ui/Icon'

export function ActivityLog() {
  const store = useActivityStore()
  const events = store.logEvents
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const chips: { id: LogChip; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'sent', label: 'Sent' },
    { id: 'failed', label: 'Failed' },
    { id: 'replies', label: 'Replies' },
    { id: 'bounces', label: 'Bounces' },
    { id: 'optouts', label: 'Opt-outs' },
    { id: 'skipped', label: 'Skipped' },
    { id: 'control', label: 'Control' },
    { id: 'assistant', label: 'Assistant' },
  ]

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  return (
    <div className="oa-log">
      {/* Filter toolbar: chips + search input */}
      <div className="oa-log-toolbar">
        <div className="oa-chip-group" role="tablist" aria-label="Log category filters">
          {chips.map((c) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={store.activeChip === c.id}
              className={`oa-filter-chip ${store.activeChip === c.id ? 'active' : ''}`}
              onClick={() => store.setActiveChip(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="oa-search-wrap">
          <Icon name="search" size={14} />
          <input
            type="search"
            className="input xs oa-search-input"
            placeholder="Search address, name, company"
            value={store.searchQuery}
            onChange={(e) => store.setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Transaction Table */}
      <div className="oa-log-table-wrap">
        <table className="oa-log-table">
          <thead>
            <tr>
              <th className="th-time">Time</th>
              <th className="th-type">What happened</th>
              <th className="th-who">Who</th>
              <th className="th-org">Company</th>
              <th className="th-camp">Campaign</th>
              <th className="th-detail">Detail</th>
              <th className="th-took">Took</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr>
                <td colSpan={7} className="oa-log-empty">
                  No matching log events in this range.
                </td>
              </tr>
            ) : (
              events.map((ev) => {
                const isExpanded = expandedId === ev.id
                const sentence = describeEvent(ev)
                const isFail = ev.type === 'send.fail'
                const isTest = ev.dry === true

                return (
                  <tr
                    key={ev.id}
                    className={`oa-log-row ${isExpanded ? 'expanded' : ''} ${isFail ? 'row-fail' : ''}`}
                    onClick={() => toggleExpand(ev.id)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        toggleExpand(ev.id)
                      }
                    }}
                  >
                    <td className="td-time">
                      <span title={new Date(ev.t).toISOString()}>{fmtClock(ev.t)}</span>
                    </td>

                    <td className="td-type">
                      <div className="oa-type-cell">
                        {isFail && <span className="or-chip danger sm">Failed</span>}
                        {isTest && <span className="or-chip cs-waiting sm">Test</span>}
                        <span className="oa-type-text">{ev.type}</span>
                      </div>
                    </td>

                    <td className="td-who">
                      <div className="oa-who-cell" title={ev.email || ev.to || ''}>
                        <span className="oa-name">{ev.name || '—'}</span>
                        <span className="oa-addr or-muted">{ev.email || ev.to || ''}</span>
                      </div>
                    </td>

                    <td className="td-org">{ev.org || '—'}</td>

                    <td className="td-camp">{ev.campaignName || ev.campaignId || '—'}</td>

                    <td className="td-detail">
                      <div className="oa-detail-cell" title={sentence}>
                        {sentence}
                      </div>
                      {isExpanded && (
                        <div className="oa-expanded-detail">
                          {ev.error && <div className="oa-detail-line error"><b>Error:</b> {ev.error}</div>}
                          {ev.kind && <div className="oa-detail-line"><b>Kind:</b> {ev.kind}</div>}
                          {ev.attempt && <div className="oa-detail-line"><b>Attempt:</b> {ev.attempt}</div>}
                          {ev.code && <div className="oa-detail-line"><b>Code:</b> {ev.code}</div>}
                          {ev.reason && <div className="oa-detail-line"><b>Reason:</b> {ev.reason}</div>}
                          <div className="oa-detail-line mono or-muted">ID: {ev.id} · Time: {fmtDay(ev.t)}</div>
                        </div>
                      )}
                    </td>

                    <td className="td-took">
                      {ev.ms ? `${ev.ms} ms` : '—'}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Show more button */}
      {store.hasMoreEvents && (
        <div className="oa-load-more-row">
          <button className="btn sm" onClick={() => store.loadMoreLog()}>
            Show more (next 200 rows)
          </button>
        </div>
      )}
    </div>
  )
}
