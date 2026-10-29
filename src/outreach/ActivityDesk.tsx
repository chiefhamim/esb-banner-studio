// src/outreach/ActivityDesk.tsx
// Full-window Activity Desk: edge-to-edge layout, toolbar, tabs & exports (§3.7, §5.7).

import { useEffect, useState } from 'react'
import { useActivityStore, type ActivityRange, type ActivityTab } from './activityStore'
import { ActivityOverview } from './ActivityOverview'
import { ActivityLog } from './ActivityLog'
import { ActivityReports, buildDayCsv, buildRunCsv, safeCsvCell } from './ActivityReports'
import { Tabs, Seg, Switch, Select, MenuButton } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { useOutreachStore } from './outreachStore'
import { downloadText } from './campaign'

export function ActivityDesk() {
  const store = useActivityStore()
  const outreach = useOutreachStore()
  const [isPausingAll, setIsPausingAll] = useState(false)

  // Mount desk: subscribe to push events debounced to 1s
  useEffect(() => {
    const cleanup = store.mountDesk()
    return cleanup
  }, [])

  const isDesktop = typeof window !== 'undefined' && typeof window.esb?.outreachJobs === 'function'

  if (!isDesktop) {
    return (
      <div className="oa-desk oa-not-desktop">
        <div className="oa-empty-card">
          <Icon name="home" size={32} />
          <h3>Desktop app required</h3>
          <p>The Activity desk needs the ESB AI Studio desktop app.</p>
        </div>
      </div>
    )
  }

  // Active sending status for Pause all ⇄ Resume all
  const activeJobs = (store.stats?.jobs || []).filter((j) =>
    ['running', 'waiting', 'queued'].includes(j.status)
  )
  const isAnyActive = activeJobs.length > 0

  const handleTogglePauseAll = async () => {
    if (!window.esb?.outreachPauseAll) return
    setIsPausingAll(true)
    try {
      await window.esb.outreachPauseAll(isAnyActive)
      store.fetchStats()
    } finally {
      setIsPausingAll(false)
    }
  }

  // Export handlers
  const handleExportLogCsv = async () => {
    if (!window.esb?.outreachEvents) return
    const res = await window.esb.outreachEvents({ limit: 5000, includeDry: store.includeDry })
    const evs = res.events || []

    const head = ['Time (ISO)', 'Time (local)', 'Type', 'Email', 'Name', 'Company', 'Campaign', 'Detail', 'Took ms']
    const rows = evs.map((e) => [
      safeCsvCell(new Date(e.t).toISOString()),
      safeCsvCell(new Date(e.t).toLocaleString()),
      safeCsvCell(e.type),
      safeCsvCell(e.email || e.to),
      safeCsvCell(e.name),
      safeCsvCell(e.org),
      safeCsvCell(e.campaignName || e.campaignId),
      safeCsvCell(e.detail || e.error || e.reason),
      safeCsvCell(e.ms ?? ''),
    ].join(','))

    const csv = [head.map(safeCsvCell).join(','), ...rows].join('\r\n') + '\r\n'
    downloadText(`outreach-log-${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }

  const handleExportDayCsv = () => {
    if (!store.stats) return
    const csv = buildDayCsv(store.stats.byDay)
    downloadText(`outreach-daily-report-${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }

  const handleExportRunsCsv = () => {
    if (!store.stats) return
    const csv = buildRunCsv(store.stats.jobs)
    downloadText(`outreach-runs-report-${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }

  // Campaign dropdown options
  const campaignOptions = [
    { value: '', label: 'All campaigns' },
    ...outreach.campaigns.map((c) => ({ value: c.id, label: c.name })),
  ]

  return (
    <div className="oa-desk" role="main" aria-label="Activity Desk">
      {/* 40px Toolbar */}
      <header className="oa-toolbar">
        <div className="oa-toolbar-left">
          <Tabs<ActivityTab>
            value={store.tab}
            onChange={(t) => store.setTab(t)}
            className="oa-desk-tabs"
            options={[
              { value: 'overview', label: 'Overview', icon: 'chart' },
              { value: 'log', label: 'Log', icon: 'listBullet' },
              { value: 'reports', label: 'Reports', icon: 'edit' },
            ]}
          />

          <div className="oa-sep" />

          <Select
            value={store.campaignId || ''}
            options={campaignOptions}
            onChange={(v) => store.setCampaignId(v ? String(v) : null)}
            className="oa-campaign-select"
            title="Filter by campaign"
          />

          <Seg<ActivityRange>
            value={store.range}
            onChange={(r) => store.setRange(r)}
            className="oa-range-seg"
            options={[
              { value: 'today', label: 'Today' },
              { value: '7d', label: '7 days' },
              { value: '30d', label: '30 days' },
              { value: 'all', label: 'All' },
            ]}
          />

          {store.hasDryEvents && (
            <label className="oa-dry-toggle">
              <Switch checked={store.includeDry} onChange={(v) => store.setIncludeDry(v)} label="Include test runs" />
            </label>
          )}
        </div>

        <div className="oa-toolbar-right">
          <button
            className="btn sm"
            onClick={handleTogglePauseAll}
            disabled={isPausingAll}
            title={isAnyActive ? 'Pause all active campaigns' : 'Resume active campaigns'}
          >
            <Icon name={isAnyActive ? 'pause' : 'play'} size={14} />
            <span>{isAnyActive ? 'Pause all sending' : 'Resume sending'}</span>
          </button>

          <MenuButton
            label="Export"
            icon="download"
            align="end"
            className="btn sm"
            items={[
              { label: 'Export log (CSV)', onClick: handleExportLogCsv },
              { label: 'Export daily report (CSV)', onClick: handleExportDayCsv },
              { label: 'Export runs report (CSV)', onClick: handleExportRunsCsv },
            ]}
          />
        </div>
      </header>

      {/* Main Content Area */}
      <div className="oa-content-scroll">
        {store.tab === 'overview' && <ActivityOverview />}
        {store.tab === 'log' && <ActivityLog />}
        {store.tab === 'reports' && <ActivityReports />}
      </div>
    </div>
  )
}
