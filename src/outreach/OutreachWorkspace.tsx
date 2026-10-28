import { useEffect, useState } from 'react'
import { WorkspaceSwitcher } from '../shell/WorkspaceRail'
import { DirectoryPanel } from './DirectoryPanel'
import { OutreachComposer } from './OutreachComposer'
import { OutreachInspector } from './OutreachInspector'
import { useOutreachStore } from './outreachStore'
import { Icon } from '../ui/Icon'
import { DEFAULT_MAILING_LIST_PATH } from './directoryStore'

export function OutreachWorkspace() {
  const contacts = useOutreachStore((s) => s.contacts)
  const rolling24hCount = useOutreachStore((s) => s.rolling24hCount)
  const config = useOutreachStore((s) => s.config)
  const campaignState = useOutreachStore((s) => s.campaignState)
  const loadWorkbookData = useOutreachStore((s) => s.loadWorkbookData)
  const addLog = useOutreachStore((s) => s.addLog)
  const logs = useOutreachStore((s) => s.logs)
  const [showLogDrawer, setShowLogDrawer] = useState(false)

  // Auto-attempt loading the Master Directory from disk in Electron environment
  useEffect(() => {
    if (contacts.length > 0) return

    const loadDefaultMailingList = async () => {
      try {
        const esbApi = (window as unknown as { esb?: { loadMailingList?: (path: string) => Promise<{ success: boolean; data?: Uint8Array; error?: string }> } }).esb
        if (esbApi?.loadMailingList) {
          const res = await esbApi.loadMailingList(DEFAULT_MAILING_LIST_PATH)
          if (res.success && res.data) {
            loadWorkbookData(res.data)
            return
          }
        }
      } catch {
        /* browser fallback: user can click Import */
      }
    }
    void loadDefaultMailingList()
  }, [contacts.length, loadWorkbookData, addLog])

  return (
    <div className="workspace outreach-workspace" aria-label="Outreach Desk">
      {/* 1. Header Topbar */}
      <header className="topbar ed-head outreach-topbar">
        <WorkspaceSwitcher />
        <i className="head-sep" aria-hidden />

        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
          <strong className="text-white" style={{ fontSize: 13, letterSpacing: '0.2px' }}>
            Outreach & Promotional Desk
          </strong>
          <span className="pill xs" style={{ fontSize: 10, background: 'rgba(56,189,248,0.1)', color: '#38bdf8' }}>
            Consolidated Energy Intelligence
          </span>
        </div>

        <div className="spacer" />

        {/* Campaign Activity / Log button */}
        <div className="row" style={{ alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            className={'btn xs subtle' + (campaignState === 'RUNNING' ? ' pulse' : '')}
            onClick={() => setShowLogDrawer(!showLogDrawer)}
            data-tip="Toggle Live Dispatch Logs"
          >
            <Icon name="activity" size={13} />
            <span style={{ fontSize: 11, marginLeft: 4 }}>Logs ({logs.length})</span>
          </button>
        </div>
      </header>

      {/* 2. Main 3-Column Desk Stage */}
      <div className="ed-body outreach-body">
        <DirectoryPanel />
        <OutreachComposer />
        <OutreachInspector />
      </div>

      {/* 3. 28px Bottom Statusbar */}
      <footer className="statusbar vw-statusbar outreach-statusbar">
        <div className="row" style={{ gap: 12, alignItems: 'center' }}>
          <span><Icon name="users" size={12} /> {contacts.length} Leads Indexed</span>
          <span>•</span>
          <span>MX Verified Safe: {contacts.filter((c) => c.mxStatus === 'SAFE_TO_SEND').length}</span>
          <span>•</span>
          <span>Opened: {contacts.filter((c) => c.openCount > 0).length}</span>
        </div>

        <div className="spacer" />

        <div className="row" style={{ gap: 12, alignItems: 'center', fontFamily: 'monospace' }}>
          <span>Quota: {rolling24hCount} / {config.dailyLimit} (24h)</span>
          <span>•</span>
          <span>Status: <strong style={{ color: campaignState === 'RUNNING' ? '#10b981' : '#f59e0b' }}>{campaignState}</strong></span>
        </div>
      </footer>

      {/* Slide-out Activity Log Drawer */}
      {showLogDrawer && (
        <div className="outreach-log-drawer custom-scroll">
          <div className="row" style={{ justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>Activity & Telemetry Stream</span>
            <button type="button" className="btn xs" onClick={() => setShowLogDrawer(false)}>&times;</button>
          </div>
          <div className="scroll custom-scroll" style={{ padding: '8px 12px', maxHeight: 240, overflowY: 'auto', fontFamily: 'monospace', fontSize: 11 }}>
            {logs.map((l) => (
              <div key={l.id} className={'log-line ' + l.level} style={{ margin: '3px 0' }}>
                <span style={{ opacity: 0.5 }}>[{l.timestamp}]</span> {l.message}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
