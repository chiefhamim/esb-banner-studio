// src/outreach/ActivityReports.tsx
// Activity Desk Reports tab: By Day & By Run tables, side panel inspector, formula-safe CSV export (§3.6, §5.7).

import { useState } from 'react'
import { useActivityStore } from './activityStore'
import { fmtDuration, fmtClock, reportSummary } from './activityFormat'
import { downloadText } from './campaign'
import { Icon } from '../ui/Icon'
import type { JobSnapshot } from '../esb'

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

  return (
    <div className={`oa-reports ${selectedType ? 'has-sidebar' : ''}`}>
      <div className="oa-reports-main">
        {/* Sub tab toggles */}
        <div className="oa-reports-subnav">
          <button
            className={`btn sm ${subTab === 'day' ? 'primary' : ''}`}
            onClick={() => {
              setSubTab('day')
              store.setSelectedJobId(null)
            }}
          >
            By day
          </button>
          <button
            className={`btn sm ${subTab === 'run' ? 'primary' : ''}`}
            onClick={() => {
              setSubTab('run')
              store.setSelectedDay(null)
            }}
          >
            By run
          </button>
        </div>

        {/* Table view */}
        {subTab === 'day' ? (
          <div className="oa-report-table-wrap">
            <table className="oa-report-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Sent</th>
                  <th>Failed</th>
                  <th>Bounced</th>
                  <th>Replied</th>
                  <th>First email</th>
                  <th>Last email</th>
                  <th>Time sending</th>
                </tr>
              </thead>
              <tbody>
                {byDay.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="oa-report-empty">
                      No days recorded in this range.
                    </td>
                  </tr>
                ) : (
                  byDay.map((d) => (
                    <tr
                      key={d.day}
                      className={selectedDay === d.day ? 'selected' : ''}
                      onClick={() => store.setSelectedDay(d.day)}
                      tabIndex={0}
                    >
                      <td>{d.day}</td>
                      <td>{d.sent.toLocaleString()}</td>
                      <td>{d.failed.toLocaleString()}</td>
                      <td>{d.bounced.toLocaleString()}</td>
                      <td>{d.replied.toLocaleString()}</td>
                      <td>—</td>
                      <td>—</td>
                      <td>—</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="oa-report-table-wrap">
            <table className="oa-report-table">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Started</th>
                  <th>Finished</th>
                  <th>Sent</th>
                  <th>Failed</th>
                  <th>Skipped</th>
                  <th>Took</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {jobs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="oa-report-empty">
                      No sending runs recorded yet.
                    </td>
                  </tr>
                ) : (
                  jobs.map((j) => (
                    <tr
                      key={j.jobId}
                      className={selectedJobId === j.jobId ? 'selected' : ''}
                      onClick={() => store.setSelectedJobId(j.jobId)}
                      tabIndex={0}
                    >
                      <td>{j.name || j.campaignId}</td>
                      <td>{j.startedAt ? fmtClock(j.startedAt) : '—'}</td>
                      <td>{j.endedAt ? fmtClock(j.endedAt) : '—'}</td>
                      <td>{j.sent.toLocaleString()}</td>
                      <td>{j.failed.toLocaleString()}</td>
                      <td>{j.skipped.toLocaleString()}</td>
                      <td>
                        {j.endedAt && j.startedAt
                          ? fmtDuration(Math.round((j.endedAt - j.startedAt) / 1000))
                          : '—'}
                      </td>
                      <td>
                        <span className={`or-chip ${j.status === 'done' ? 'cs-done' : 'cs-stopped'} sm`}>
                          {j.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 360px Sidebar Inspector Panel */}
      {selectedType && (
        <aside className="oa-report-sidebar" aria-label="Report Inspector">
          <div className="oa-sidebar-head">
            <h3>{selectedType === 'day' ? selectedDay : selectedJobData?.name || 'Run Summary'}</h3>
            <button
              className="ibtn sm"
              aria-label="Close details"
              onClick={() => {
                store.setSelectedDay(null)
                store.setSelectedJobId(null)
              }}
            >
              <Icon name="x" size={14} />
            </button>
          </div>

          <div className="oa-sidebar-body">
            {selectedType === 'day' && selectedDayData && (
              <div className="oa-sidebar-metrics">
                <div className="oa-metric-row">
                  <span>Sent</span>
                  <b>{selectedDayData.sent.toLocaleString()}</b>
                </div>
                <div className="oa-metric-row">
                  <span>Failed</span>
                  <b>{selectedDayData.failed.toLocaleString()}</b>
                </div>
                <div className="oa-metric-row">
                  <span>Bounced</span>
                  <b>{selectedDayData.bounced.toLocaleString()}</b>
                </div>
                <div className="oa-metric-row">
                  <span>Replied</span>
                  <b>{selectedDayData.replied.toLocaleString()}</b>
                </div>
              </div>
            )}

            {selectedType === 'run' && selectedJobData && (
              <div className="oa-sidebar-metrics">
                <div className="oa-metric-row">
                  <span>Sent</span>
                  <b>{selectedJobData.sent.toLocaleString()}</b>
                </div>
                <div className="oa-metric-row">
                  <span>Failed</span>
                  <b>{selectedJobData.failed.toLocaleString()}</b>
                </div>
                <div className="oa-metric-row">
                  <span>Total</span>
                  <b>{selectedJobData.total.toLocaleString()}</b>
                </div>
                <div className="oa-metric-row">
                  <span>Status</span>
                  <b>{selectedJobData.status}</b>
                </div>
              </div>
            )}

            {stats && (
              <div className="oa-summary-preview">
                <p>{reportSummary(stats, selectedJobData?.name || `Day ${selectedDay}`)}</p>
              </div>
            )}

            <div className="oa-sidebar-actions">
              <button className="btn sm primary" onClick={copySummaryText}>
                <Icon name="copy" size={13} />
                <span>{copied ? 'Copied!' : 'Copy summary'}</span>
              </button>
              <button className="btn sm" onClick={exportSelectedCsv}>
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
