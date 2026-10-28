// Right column: who sends, how many went out today, the batch, the selected contact and a test email. Every figure
// is read from the main process's ledger or the list itself; nothing here is a placeholder. In the browser preview
// (no desktop bridge) the column says sending needs the desktop app instead of pretending to send.

import { useEffect, useState } from 'react'
import { useOutreachStore } from './outreachStore'
import { eligible, pauseBatch, resumeBatch, sendTest, startBatch, stopBatch } from './campaign'
import { skipReason } from './compose'
import { STATUS_LABEL } from './directory'
import { SenderDialog } from './SenderDialog'
import { Icon } from '../ui/Icon'
import { Switch } from '../ui/controls'

const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

export function OutreachInspector() {
  const s = useOutreachStore()
  const desktop = !!window.esb?.outreachSend
  const [showSender, setShowSender] = useState(false)
  const [testTo, setTestTo] = useState('')
  const [testing, setTesting] = useState(false)
  const [, tick] = useState(0)

  // the countdown re-renders once a second while a wait is running
  useEffect(() => {
    if (!s.nextAt) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [s.nextAt])
  useEffect(() => { void s.refreshMail() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const set = s.mail?.settings
  const ready = s.mail?.hasPassword && !!set
  const limit = set?.dailyLimit ?? 0
  const used = s.mail?.sent24h ?? 0
  const queue = eligible(s.contacts, s.subject, s.body)
  const active = s.contacts.find((c) => c.id === s.activeId)
  const reason = active ? skipReason(active, s.subject, s.body) : null
  const willSend = Math.min(queue.length, Math.max(0, limit - used))

  return (
    <aside className="or-right" aria-label="Sending">
      <section className="or-card">
        <header><Icon name="mail" size={14} /><h3>Sender</h3>
          <button type="button" className="btn sm" onClick={() => setShowSender(true)} disabled={!desktop} data-tip={desktop ? 'Account, app password and pacing' : 'Sending needs the ESB Studio desktop app'}>
            <Icon name="sliders" size={13} /><span>Settings</span>
          </button>
        </header>
        {!desktop ? (
          <p className="or-muted">Sending needs the ESB Studio desktop app. Here you can prepare the list and the letter.</p>
        ) : set ? (
          <div className="or-sender">
            <b>{set.name}</b><span>{set.user}</span>
            <span className={'or-chip ' + (ready ? 'good' : 'warn')}>{ready ? 'Ready' : 'No app password'}</span>
          </div>
        ) : (
          <p className="or-muted">No sender yet. Add the Gmail or Workspace account that sends, with a Google app password.</p>
        )}
      </section>

      {desktop && set && (
        <section className="or-card">
          <header><Icon name="clock" size={14} /><h3>Last 24 hours</h3><span className="or-figure">{used} <small>of {limit}</small></span></header>
          <div className="or-meter" role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used}><i style={{ width: `${limit ? Math.min(100, (used / limit) * 100) : 0}%` }} /></div>
          <p className="or-muted">{Math.max(0, limit - used)} more can go today · {set.minDelaySec / 60 >= 1 ? `${Math.round(set.minDelaySec / 60)}–${Math.round(set.maxDelaySec / 60)} min` : `${set.minDelaySec}–${set.maxDelaySec} s`} apart</p>
        </section>
      )}

      <section className="or-card">
        <header><Icon name="send" size={14} /><h3>Batch</h3>{s.campaign !== 'idle' && <span className={'or-chip ' + (s.campaign === 'running' ? 'busy' : 'warn')}>{s.campaign === 'running' ? 'Running' : 'Paused'}</span>}</header>
        {s.campaign === 'idle' ? (
          <>
            <p className="or-muted">{queue.length ? `${queue.length} ready on this sheet${desktop && set ? ` · ${willSend} can go today` : ''}` : s.contacts.length ? 'Nobody on this sheet is ready — see Skip in the list' : 'Import a list to start'}</p>
            <button type="button" className="btn primary or-wide" onClick={() => void startBatch()} disabled={!desktop || !ready || !willSend}>
              <Icon name="play" size={13} /><span>{willSend ? `Send to ${willSend}` : 'Send'}</span>
            </button>
          </>
        ) : (
          <>
            <div className="or-progress"><span>{s.runSent} of {s.runTotal} sent</span>{s.current ? <span>Sending to {s.current}</span> : s.nextAt ? <span>Next in <b>{mmss(s.nextAt - Date.now())}</b></span> : null}</div>
            <div className="or-meter"><i style={{ width: `${s.runTotal ? (s.runSent / s.runTotal) * 100 : 0}%` }} /></div>
            <div className="or-actions">
              {s.campaign === 'running'
                ? <button type="button" className="btn sm" onClick={pauseBatch}><Icon name="pause" size={13} /><span>Pause</span></button>
                : <button type="button" className="btn sm primary" onClick={resumeBatch}><Icon name="play" size={13} /><span>Resume</span></button>}
              <button type="button" className="btn sm" onClick={stopBatch}><Icon name="x" size={13} /><span>Stop</span></button>
            </div>
          </>
        )}
      </section>

      {active && (
        <section className="or-card">
          <header><Icon name="user" size={14} /><h3>Contact</h3></header>
          <div className="or-contact">
            <b>{active.personName || active.email}</b>
            {(active.designation || active.organization) && <span>{[active.designation, active.organization].filter(Boolean).join(', ')}</span>}
            <span>{active.email}</span>
            {active.sectorGroup && <span>{active.sectorGroup}</span>}
          </div>
          <dl className="or-facts">
            <dt>Sheet status</dt><dd>{STATUS_LABEL[active.mxStatus]}</dd>
            <dt>This batch</dt><dd>{active.status === 'SENT' ? `Sent ${active.sentAt ? new Date(active.sentAt).toLocaleString() : ''}` : active.status === 'FAILED' ? `Failed: ${active.error}` : reason ?? 'Will be sent'}</dd>
          </dl>
          {active.mxStatus !== 'SAFE_TO_SEND' && active.mxStatus !== 'EXCLUDED' && (
            <Switch checked={active.approved} onChange={(v) => s.approve(active.email, v)} label="I checked this address — include it" />
          )}
          <Switch checked={active.status === 'OPTED_OUT'} onChange={(v) => s.optOut(active.email, v)} label="Asked not to be emailed" />
        </section>
      )}

      <section className="or-card">
        <header><Icon name="inbox" size={14} /><h3>Test email</h3></header>
        <p className="or-muted">Sends the letter to you first, filled with the selected contact's details. Does not count toward today.</p>
        <div className="or-test">
          <input type="email" className="or-input" placeholder="your@address" value={testTo} onChange={(e) => setTestTo(e.target.value)} aria-label="Test address" />
          <button type="button" className="btn sm" disabled={!desktop || !ready || testing || !/^\S+@\S+\.\S+$/.test(testTo)} onClick={async () => { setTesting(true); await sendTest(testTo.trim(), active); setTesting(false) }}>
            <Icon name="send" size={13} /><span>{testing ? 'Sending…' : 'Send test'}</span>
          </button>
        </div>
      </section>

      {showSender && <SenderDialog onClose={() => setShowSender(false)} />}
    </aside>
  )
}
