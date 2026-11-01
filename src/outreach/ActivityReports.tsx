// src/outreach/ActivityReports.tsx
// Activity Desk Reports tab: By Day & By Run tables, side panel inspector, formula-safe CSV export (§3.6, §5.7).

import { useState } from 'react'
import { useActivityStore } from './activityStore'
import { fmtDuration, fmtClock, fmtShortDay, reportSummary } from './activityFormat'

/** "2026-10-29" (already a Dhaka calendar day) → "Thu 29 Oct"; anything else is shown as it came. */
function dayLabel(day: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? fmtShortDay(Date.parse(day + 'T12:00:00Z'), 'UTC') : day
}
import { downloadText } from './campaign'
import { Icon } from '../ui/Icon'
import { Seg } from '../ui/controls'
import type { JobSnapshot } from '../esb'
import { useClockFormat } from '../ui/time'

export function safeCsvCell(val: string | number | null | undefined): string {
  if (val == null) return '""'
  let str = String(val)
  if (/^[=+\-@]/.test(str)) {
    str = `'${str}`
  }
  return `"${str.replace(/"/g, '""')}"`
}

export function buildDayCsv(byDay: Array<{ day: string; sent: number; failed: number; bounced: number; replied: number }>): string {
  const head = ['Date', 'Sent', 'Failed', 'Bounced', 'Replied', 'First email', 'Last email', 'Time sending']
  const rows = byDay.map((d) => [
    safeCsvCell(d.day),
    safeCsvCell(d.sent),
    safeCsvCell(d.failed),
    safeCsvCell(d.bounced),
    safeCsvCell(d.replied),
    safeCsvCell('—'),
    safeCsvCell('—'),
    safeCsvCell('—'),
  ].join(','))
  return [head.join(','), ...rows].join('\r\n') + '\r\n'
}

export function buildRunCsv(jobs: JobSnapshot[]): string {
  const head = ['Campaign', 'Started', 'Finished', 'Sent', 'Failed', 'Skipped', 'Took', 'Average gap s', 'Result']
  const rows = jobs.map((j) => [
    safeCsvCell(j.name || j.campaignId),
    safeCsvCell(j.startedAt ? new Date(j.startedAt).toISOString() : '—'),
    safeCsvCell(j.endedAt ? new Date(j.endedAt).toISOString() : '—'),
    safeCsvCell(j.sent),
    safeCsvCell(j.failed),
    safeCsvCell(j.skipped),
    safeCsvCell(j.endedAt && j.startedAt ? fmtDuration(Math.round((j.endedAt - j.startedAt) / 1000)) : '—'),
    safeCsvCell('—'),
    safeCsvCell(j.status),
  ].join(','))
  return [head.join(','), ...rows].join('\r\n') + '\r\n'
}

export function ActivityReports() {
  useClockFormat() // re-render when Home → Settings → Time format changes
  const store = useActivityStore()
  const stats = store.stats
  const [subTab, setSubTab] = useState<'day' | 'run'>('day')
  const [copied, setCopied] = useState(false)

  const byDay = stats?.byDay || []
  const jobs = stats?.jobs || []

  const selectedDay = store.selectedDay
  const selectedJobId = store.selectedJobId
  const selectedType = store.selectedReportType

  const selectedDayData = byDay.find((d) => d.day === selectedDay)
  const selectedJobData = jobs.find((j) => j.jobId === selectedJobId)

  const copySummaryText = () => {
    if (!stats) return
    const text = reportSummary(stats, selectedJobData?.name || 'Campaign Report')
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const exportSelectedCsv = () => {
    if (subTab === 'day') {
      const csv = buildDayCsv(byDay)
      downloadText(`outreach-daily-report-${new Date().toISOString().slice(0, 10)}.csv`, csv)
    } else {
      const csv = buildRunCsv(jobs)
      downloadText(`outreach-runs-report-${new Date().toISOString().slice(0, 10)}.csv`, csv)
    }
  }

  const stat = (label: string, value: number, tone = '') => (
    <span className={'oa-rstat' + (tone ? ' ' + tone : '')}>
      <i>{label}</i>
      <b>{value.toLocaleString()}</b>
    </span>
  )

  return (
    <div className={`oa-reports ${selectedType ? 'has-sidebar' : ''}`}>
      <div className="oa-reports-main">
        {/* Sub tab toggles */}
        <div className="oa-reports-subnav">
          <Seg<'day' | 'run'>
            value={subTab}
            onChange={(v) => {
              setSubTab(v)
              if (v === 'day') store.setSelectedJobId(null)
              else store.setSelectedDay(null)
            }}
            className="oa-report-seg"
            options={[
              { value: 'day', label: 'By day', icon: 'calendar' },
              { value: 'run', label: 'By run', icon: 'send' },
            ]}
          />
        </div>

        {/* List view */}
        {subTab === 'day' ? (
          byDay.length === 0 ? (
            <div className="oa-empty-card oa-card-empty">
              <span className="oa-empty-mark"><Icon name="calendar" size={20} /></span>
              <h3>No days yet</h3>
              <p>No days recorded in this range.</p>
            </div>
          ) : (
            <div className="oa-report-list">
              {byDay.map((d) => (
                <button
                  key={d.day}
                  type="button"
                  className={'or-row oa-rrow' + (selectedDay === d.day ? ' on' : '')}
                  aria-pressed={selectedDay === d.day}
                  onClick={() => store.setSelectedDay(d.day)}
                >
                  <span className="oa-rrow-main">
                    <b title={d.day}>{dayLabel(d.day)}</b>
                    <span>{d.sent.toLocaleString()} sent{d.replied > 0 ? ` · ${d.replied.toLocaleString()} replied` : ''}</span>
                  </span>
                  {stat('Sent', d.sent, 'sent')}
                  {stat('Failed', d.failed, d.failed > 0 ? 'bad' : '')}
                  {stat('Bounced', d.bounced, d.bounced > 0 ? 'warn' : '')}
                  {stat('Replied', d.replied, d.replied > 0 ? 'reply' : '')}
                </button>
              ))}
            </div>
          )
        ) : jobs.length === 0 ? (
          <div className="oa-empty-card oa-card-empty">
            <span className="oa-empty-mark"><Icon name="send" size={20} /></span>
            <h3>No runs yet</h3>
            <p>No sending runs recorded yet.</p>
          </div>
        ) : (
          <div className="oa-report-list">
            {jobs.map((j) => (
              <button
                key={j.jobId}
                type="button"
                className={'or-row oa-rrow' + (selectedJobId === j.jobId ? ' on' : '')}
                aria-pressed={selectedJobId === j.jobId}
                onClick={() => store.setSelectedJobId(j.jobId)}
              >
                <span className="oa-rrow-main">
                  <b>{j.name || j.campaignId}</b>
                  <span>
                    {j.startedAt ? fmtClock(j.startedAt) : '—'} → {j.endedAt ? fmtClock(j.endedAt) : '—'}
                    {j.endedAt && j.startedAt ? ` · took ${fmtDuration(Math.round((j.endedAt - j.startedAt) / 1000))}` : ''}
                  </span>
                </span>
                {stat('Sent', j.sent, 'sent')}
                {stat('Failed', j.failed, j.failed > 0 ? 'bad' : '')}
                {stat('Skipped', j.skipped, j.skipped > 0 ? 'warn' : '')}
                <span className={'or-chip oa-rchip ' + (j.status === 'done' ? 'good' : j.status === 'stopped' ? 'warn' : '')}>{j.status}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Inspector panel */}
      {selectedType && (
        <aside className="oa-report-sidebar" aria-label="Report Inspector">
          <header className="oa-card-head">
            <Icon name={selectedType === 'day' ? 'calendar' : 'send'} size={14} />
            <h3>{selectedType === 'day' ? (selectedDay ? dayLabel(selectedDay) : '') : selectedJobData?.name || 'Run Summary'}</h3>
            <button
              type="button"
              className="ibtn sm"
              aria-label="Close details"
              onClick={() => {
                store.setSelectedDay(null)
                store.setSelectedJobId(null)
              }}
            >
              <Icon name="x" size={14} />
            </button>
          </header>

          <div className="oa-sidebar-body">
            {selectedType === 'day' && selectedDayData && (
              <div className="or-stats oa-sidebar-stats">
                <span><i>Sent</i><b>{selectedDayData.sent.toLocaleString()}</b></span>
                <span className={selectedDayData.failed > 0 ? 'bad' : ''}><i>Failed</i><b>{selectedDayData.failed.toLocaleString()}</b></span>
                <span><i>Bounced</i><b>{selectedDayData.bounced.toLocaleString()}</b></span>
                <span className={selectedDayData.replied > 0 ? 'good' : ''}><i>Replied</i><b>{selectedDayData.replied.toLocaleString()}</b></span>
              </div>
            )}

            {selectedType === 'run' && selectedJobData && (
              <div className="or-stats oa-sidebar-stats">
                <span><i>Sent</i><b>{selectedJobData.sent.toLocaleString()}</b></span>
                <span className={selectedJobData.failed > 0 ? 'bad' : ''}><i>Failed</i><b>{selectedJobData.failed.toLocaleString()}</b></span>
                <span><i>Total</i><b>{selectedJobData.total.toLocaleString()}</b></span>
                <span><i>Status</i><b className="oa-status-word">{selectedJobData.status}</b></span>
              </div>
            )}

            {stats && (
              <div className="oa-summary-preview">
                <p>{reportSummary(stats, selectedJobData?.name || `Day ${selectedDay}`)}</p>
              </div>
            )}

            <div className="oa-sidebar-actions">
              <button type="button" className="btn sm primary" onClick={copySummaryText}>
                <Icon name="copy" size={13} />
                <span>{copied ? 'Copied!' : 'Copy summary'}</span>
              </button>
              <button type="button" className="btn sm" onClick={exportSelectedCsv}>
                <Icon name="download" size={13} />
                <span>Export CSV</span>
              </button>
            </div>
          </div>
        </aside>
      )}
    </div>
  )
}
