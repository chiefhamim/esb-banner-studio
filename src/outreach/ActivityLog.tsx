// src/outreach/ActivityLog.tsx
// Activity Desk Log tab: filterable, searchable, expandable transaction log (§3.5, §5.7).
// Drawn like the rest of Outreach: quiet card rows (`or-row`) with a coloured icon badge and a status chip, grouped by day,
// filters as the same pills the Contacts list uses.

import { Fragment, memo, useCallback, useMemo, useState } from 'react'
import type { OutreachEvent } from '../esb'
import { useActivityStore, type LogChip } from './activityStore'
import { eventView, fmtClock, fmtDay } from './activityFormat'
import { useOutreachStore } from './outreachStore'
import { dayHeading, eventMeta } from './activityMeta'
import { Icon, type IconName } from '../ui/Icon'
import { useClockFormat } from '../ui/time'

interface ChipDef {
  id: LogChip
  label: string
  icon: IconName
  tone: string
}

const CHIPS: ChipDef[] = [
  { id: 'all', label: 'All', icon: 'listBullet', tone: 'all' },
  { id: 'sent', label: 'Sent', icon: 'send', tone: 'sent' },
  { id: 'opens', label: 'Opens & clicks', icon: 'eye', tone: 'reply' },
  { id: 'failed', label: 'Failed', icon: 'alert', tone: 'bad' },
  { id: 'replies', label: 'Replies', icon: 'mail', tone: 'reply' },
  { id: 'bounces', label: 'Bounces', icon: 'undo', tone: 'bounce' },
  { id: 'optouts', label: 'Opt-outs', icon: 'hand', tone: 'optout' },
  { id: 'skipped', label: 'Skipped', icon: 'skipForward', tone: 'skip' },
  { id: 'control', label: 'Control', icon: 'sliders', tone: 'control' },
  { id: 'assistant', label: 'Assistant', icon: 'sparkle', tone: 'assistant' },
]

export function ActivityLog() {
  const clock = useClockFormat() // re-render when Home → Settings → Time format changes
  const store = useActivityStore()
  const events = store.logEvents
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // one day heading per row, worked out once per page of events (not twice per row per render)
  const headings = useMemo(() => events.map((ev) => dayHeading(ev.t)), [events])

  const toggleExpand = useCallback((id: string) => setExpandedId((prev) => (prev === id ? null : id)), [])

  const activeChipDef = CHIPS.find((c) => c.id === store.activeChip)
  const rangeLabel =
    store.range === 'today'
      ? 'today'
      : store.range === '7d'
      ? 'the last 7 days'
      : store.range === '30d'
      ? 'the last 30 days'
      : 'all time'

  return (
    <div className="oa-log">
      <div className="oa-log-toolbar">
        <div className="or-chips oa-filter-chips" role="group" aria-label="Log category filters">
          {CHIPS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`or-fchip oa-chip oa-chip-${c.tone}${store.activeChip === c.id ? ' on' : ''}`}
              aria-pressed={store.activeChip === c.id}
              onClick={() => store.setActiveChip(c.id)}
            >
              <Icon name={c.icon} size={14} className="oa-chip-ic" />
              <span>{c.label}</span>
            </button>
          ))}
        </div>

        <div className="oa-search-wrap">
          <label className="or-search oa-log-search">
            <Icon name="search" size={14} className="oa-search-ic" />
            <input
              type="search"
              placeholder="Search address, name, company"
              aria-label="Search the log"
              value={store.searchQuery}
              onChange={(e) => store.setSearchQuery(e.target.value)}
            />
            {store.searchQuery && (
              <button
                type="button"
                className="oa-search-clear"
                onClick={() => store.setSearchQuery('')}
                aria-label="Clear search"
                title="Clear search"
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </label>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="oa-empty-card oa-card-empty">
          {store.searchQuery ? (
            <>
              <span className="oa-empty-mark oa-empty-mark-search"><Icon name="search" size={20} /></span>
              <h3>No matching events</h3>
              <p>No activity records matched “{store.searchQuery}”.</p>
              <div className="oa-empty-actions">
                <button type="button" className="btn sm" onClick={() => store.setSearchQuery('')}>
                  <Icon name="x" size={12} />
                  <span>Clear search</span>
                </button>
              </div>
            </>
          ) : store.activeChip === 'bounces' ? (
            <>
              <span className="oa-empty-mark tone-good"><Icon name="check" size={20} /></span>
              <h3>No bounces recorded</h3>
              <p>Zero bounced messages in {rangeLabel}. Every email reached its recipient server without refusal.</p>
              <div className="oa-empty-actions">
                <button type="button" className="btn sm" onClick={() => store.setActiveChip('all')}>
                  <span>View all activity</span>
                </button>
              </div>
            </>
          ) : store.activeChip === 'failed' ? (
            <>
              <span className="oa-empty-mark tone-good"><Icon name="check" size={20} /></span>
              <h3>No delivery failures</h3>
              <p>Zero send failures or SMTP connection problems recorded in {rangeLabel}.</p>
              <div className="oa-empty-actions">
                <button type="button" className="btn sm" onClick={() => store.setActiveChip('all')}>
                  <span>View all activity</span>
                </button>
              </div>
            </>
          ) : store.activeChip !== 'all' ? (
            <>
              <span className={`oa-empty-mark tone-${activeChipDef?.tone || 'quiet'}`}>
                <Icon name={activeChipDef?.icon || 'activity'} size={20} />
              </span>
              <h3>No {activeChipDef?.label.toLowerCase()} events</h3>
              <p>No matching {activeChipDef?.label.toLowerCase()} entries were found in {rangeLabel}.</p>
              <div className="oa-empty-actions">
                <button type="button" className="btn sm" onClick={() => store.setActiveChip('all')}>
                  <span>View all activity</span>
                </button>
                {store.range !== 'all' && (
                  <button type="button" className="btn sm subtle" onClick={() => store.setRange('all')}>
                    <span>Switch to All time</span>
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <span className="oa-empty-mark"><Icon name="activity" size={20} /></span>
              <h3>No activity in this range</h3>
              <p>No email sends, replies, or engine events were recorded in {rangeLabel}.</p>
              {store.range !== 'all' && (
                <div className="oa-empty-actions">
                  <button type="button" className="btn sm" onClick={() => store.setRange('all')}>
                    <span>Switch to All time</span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="oa-events">
          {events.map((ev, i) => (
            <LogRow key={ev.id} ev={ev} open={expandedId === ev.id} heading={headings[i] !== headings[i - 1] ? headings[i] : null} onToggle={toggleExpand} clock={clock} />
          ))}
        </div>
      )}

      {store.hasMoreEvents && (
        <div className="oa-load-more-row">
          <button type="button" className="btn sm" onClick={() => store.loadMoreLog()}>
            Show more (next 200 rows)
          </button>
        </div>
      )}
    </div>
  )
}

/** One log row. Memoised: a live push or "Show more" re-renders only rows that changed. Every field was made
 *  printable by `displaySafe` (activityStore) before it got here. */
const LogRow = memo(function LogRow({ ev, open, heading, onToggle }: { ev: OutreachEvent; open: boolean; heading: string | null; onToggle: (id: string) => void; clock: unknown }) {
  // the campaign's own name, not its id (send events carry the name; tracker hits only the id)
  const campaign = useOutreachStore((s) => (ev.campaignId ? s.campaigns.find((c) => c.id === ev.campaignId)?.name : undefined)) || ev.campaignName || ''
  const v = eventView(ev, campaign)
  const base = eventMeta(ev.type)
  const meta = v.chip ? { ...base, label: v.chip.label, tone: v.chip.tone } : base
  const isTest = ev.dry === true || ev.test === true
  const when = fmtDay(ev.t)
  return (
    <Fragment>
      {heading && <div className="oa-day-head">{heading}</div>}
      <button
        type="button"
        className={'or-row oa-ev tone-' + meta.tone + (open ? ' on' : '')}
        aria-expanded={open}
        onClick={() => onToggle(ev.id)}
      >
        <span className="oa-ev-badge" aria-hidden><Icon name={meta.icon} size={16} /></span>

        <span className="oa-ev-main">
          <b>{v.title}</b>
          {v.meta.length > 0 && (
            <span className="oa-ev-sub oa-meta">
              {v.meta.map((m, k) => <span key={k} className="oa-meta-item" data-tip={m.tip}><Icon name={m.icon} size={12} />{m.text}</span>)}
            </span>
          )}
          {v.note && v.note.text && <span className={'oa-ev-note ' + v.note.tone}>{v.note.text}</span>}

          {open && (
            <span className="oa-ev-detail">
              {v.detail.map(([k, val]) => <span key={k} className="oa-kv"><em>{k}</em>{val}</span>)}
            </span>
          )}
        </span>

        <span className="oa-ev-side">
          {isTest && <span className="or-chip warn">Test</span>}
          <span className={'or-chip oa-tone-' + meta.tone}>{meta.label}</span>
          <span className="oa-ev-time" data-tip={when} aria-label={when}>{fmtClock(ev.t)}</span>
        </span>
      </button>
    </Fragment>
  )
})
