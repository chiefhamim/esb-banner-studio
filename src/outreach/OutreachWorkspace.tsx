// The Outreach desk: the mailing list (left), the letter (centre), sending (right), the log under the header.
// The first version opened a fixed workbook path on start (W:\E-Mail Marketing\…) through a bridge that read any
// file on the PC; the list is now always picked by the editor.

import { useMemo, useState } from 'react'
import { WorkspaceSwitcher } from '../shell/WorkspaceRail'
import { DirectoryPanel } from './DirectoryPanel'
import { OutreachComposer } from './OutreachComposer'
import { OutreachInspector } from './OutreachInspector'
import { useOutreachStore } from './outreachStore'
import { eligible } from './campaign'
import { Icon } from '../ui/Icon'

export function OutreachWorkspace() {
  const s = useOutreachStore()
  const [showLog, setShowLog] = useState(false)
  const ready = useMemo(() => eligible(s.contacts, s.subject, s.body).length, [s.contacts, s.subject, s.body])
  const sent = s.contacts.filter((c) => c.status === 'SENT').length
  const failures = s.log.filter((l) => l.level === 'error').length

  return (
    <div className="outreach-workspace">
      <header className="topbar ed-head or-head">
        <WorkspaceSwitcher />
        <div className="spacer" />
        <button type="button" className={'btn sm or-log-btn' + (showLog ? ' on' : '')} aria-pressed={showLog} onClick={() => setShowLog(!showLog)} data-tip="What the desk did: imports, sends, refusals">
          <Icon name="activity" size={14} /><span>Log</span>{s.log.length > 0 && <span className={'or-badge' + (failures ? ' bad' : '')}>{s.log.length}</span>}
        </button>
      </header>

      {showLog && (
        <div className="or-log" role="log" aria-label="Outreach log">
          {s.log.length === 0 ? <p className="or-muted">Nothing yet.</p> : [...s.log].reverse().map((l, i) => (
            <div key={i} className={'or-log-line ' + l.level}><time>{new Date(l.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><span>{l.text}</span></div>
          ))}
        </div>
      )}

      <div className="or-body">
        <DirectoryPanel />
        <OutreachComposer />
        <OutreachInspector />
      </div>

      <footer className="statusbar or-status">
        <span>{s.contacts.length} contacts</span>
        <div className="sep" />
        <span>{ready} ready</span>
        <div className="sep" />
        <span>{sent} sent</span>
        <div className="spacer" />
        {s.mail?.settings && <span>{s.mail.sent24h} of {s.mail.settings.dailyLimit} in the last 24 h</span>}
        {s.campaign !== 'idle' && <><div className="sep" /><span className="or-status-run">{s.campaign === 'running' ? 'Sending' : 'Paused'} · {s.runSent}/{s.runTotal}</span></>}
      </footer>
    </div>
  )
}
