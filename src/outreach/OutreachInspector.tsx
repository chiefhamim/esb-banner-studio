import { useState } from 'react'
import { useOutreachStore } from './outreachStore'
import { Icon } from '../ui/Icon'

export function OutreachInspector() {
  const campaignState = useOutreachStore((s) => s.campaignState)
  const setCampaignState = useOutreachStore((s) => s.setCampaignState)
  const rolling24hCount = useOutreachStore((s) => s.rolling24hCount)
  const countdownSec = useOutreachStore((s) => s.countdownSec)
  const batchTotal = useOutreachStore((s) => s.batchTotal)
  const batchSent = useOutreachStore((s) => s.batchSent)
  const config = useOutreachStore((s) => s.config)
  const saveConfig = useOutreachStore((s) => s.saveConfig)
  const contacts = useOutreachStore((s) => s.contacts)
  const addLog = useOutreachStore((s) => s.addLog)

  const [testEmail, setTestEmail] = useState('')
  const [isTesting, setIsTesting] = useState(false)
  const [showConfig, setShowConfig] = useState(false)

  // Local config form states
  const [senderName, setSenderName] = useState(config.senderName)
  const [senderEmail, setSenderEmail] = useState(config.senderEmail)
  const [senderPassword, setSenderPassword] = useState(config.senderPassword || '')
  const [dailyLimit, setDailyLimit] = useState(config.dailyLimit)
  const [minDelaySec, setMinDelaySec] = useState(config.minDelaySec)
  const [maxDelaySec, setMaxDelaySec] = useState(config.maxDelaySec)

  const quotaPercent = Math.min(100, Math.round((rolling24hCount / config.dailyLimit) * 100))
  const remainingQuota = Math.max(0, config.dailyLimit - rolling24hCount)

  // Active opened contacts
  const openedContacts = contacts.filter((c) => c.trackingStatus === 'OPENED' || c.openCount > 0)

  const handleStartCampaign = () => {
    if (!config.senderEmail) {
      addLog('error', 'Please configure your Gmail sender email in Settings first.')
      setShowConfig(true)
      return
    }
    const unsent = contacts.filter((c) => c.trackingStatus === 'QUEUED' || c.trackingStatus === 'FAILED')
    if (unsent.length === 0) {
      addLog('warning', 'No unsent contacts remaining in the active queue.')
      return
    }
    setCampaignState('RUNNING')
    addLog('info', `Starting daily outreach batch (${Math.min(unsent.length, remainingQuota)} emails)...`)
  }

  const handlePause = () => {
    setCampaignState('PAUSED')
    addLog('warning', 'Outreach campaign paused by user.')
  }

  const handleResume = () => {
    setCampaignState('RUNNING')
    addLog('info', 'Outreach campaign resumed.')
  }

  const handleStop = () => {
    setCampaignState('IDLE')
    addLog('warning', 'Outreach campaign stopped.')
  }

  const handleSendTest = async () => {
    if (!testEmail || !testEmail.includes('@')) {
      addLog('error', 'Please provide a valid test email address.')
      return
    }
    setIsTesting(true)
    addLog('info', `Transmitting isolated test message to ${testEmail}...`)

    try {
      // If running inside Electron, call window.esb.sendOutreachEmail
      const esbApi = (window as unknown as { esb?: { sendOutreachEmail?: (cfg: unknown, mail: unknown) => Promise<{ success: boolean; error?: string }> } }).esb
      if (esbApi?.sendOutreachEmail) {
        const res = await esbApi.sendOutreachEmail(config, {
          to: testEmail,
          subject: useOutreachStore.getState().subject.replace(/{name}/g, 'Test Recipient'),
          html: useOutreachStore.getState().bodyHtml.replace(/{name}/g, 'Test Recipient'),
          isTest: true,
        })
        if (res.success) {
          addLog('success', `Test email delivered successfully to ${testEmail}!`)
        } else {
          addLog('error', `Test email delivery failed: ${res.error}`)
        }
      } else {
        // Mock simulation in browser mode
        setTimeout(() => {
          addLog('success', `[MOCK] Test email sent to ${testEmail} (Launch in Electron app for live SMTP transmission).`)
        }, 1200)
      }
    } catch (err) {
      addLog('error', `Test send error: ${String(err)}`)
    } finally {
      setIsTesting(false)
    }
  }

  const handleSaveSettings = () => {
    saveConfig({
      senderName,
      senderEmail,
      senderPassword: senderPassword || config.senderPassword,
      dailyLimit,
      minDelaySec,
      maxDelaySec,
    })
    setShowConfig(false)
  }

  const formatCountdown = (sec: number) => {
    if (sec <= 0) return '--:--'
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  return (
    <aside className="right ed-right outreach-right" aria-label="Inspector & Controls">
      <div className="scroll custom-scroll" style={{ flex: 1, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* 1. Rolling 24-Hour Quota Dial Card */}
        <div className="inspector-card">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="card-kicker">Rolling 24h Quota</span>
            <span className="pill xs" style={{ fontSize: 9, color: '#10b981', background: 'rgba(16,185,129,0.1)' }}>
              Gmail Safe
            </span>
          </div>

          <div className="row" style={{ alignItems: 'baseline', gap: 6, marginTop: 4 }}>
            <span style={{ fontSize: 26, fontWeight: 800, fontFamily: 'monospace' }}>{rolling24hCount}</span>
            <span style={{ fontSize: 13, opacity: 0.6 }}>/ {config.dailyLimit}</span>
          </div>

          <div className="quota-bar" style={{ height: 4, background: '#1e293b', borderRadius: 2, overflow: 'hidden', margin: '8px 0 4px 0' }}>
            <div style={{ width: `${quotaPercent}%`, height: '100%', background: '#38bdf8', transition: 'width 0.4s ease' }} />
          </div>

          <div className="row" style={{ justifyContent: 'space-between', fontSize: 10, opacity: 0.7 }}>
            <span>{remainingQuota} slots safe today</span>
            <span>State: <strong style={{ color: campaignState === 'RUNNING' ? '#10b981' : campaignState === 'PAUSED' ? '#f59e0b' : 'inherit' }}>{campaignState}</strong></span>
          </div>
        </div>

        {/* 2. Pacing & Random Jitter Countdown */}
        <div className="inspector-card">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="card-kicker">Pacing Ticker</span>
            <span style={{ fontSize: 10, opacity: 0.6 }}>Jitter: {Math.round(config.minDelaySec / 60)}m–{Math.round(config.maxDelaySec / 60)}m</span>
          </div>

          <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
            <div>
              <div className="row" style={{ alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 20, fontWeight: 700, fontFamily: 'monospace', color: '#f59e0b' }}>
                  {formatCountdown(countdownSec)}
                </span>
                {batchTotal > 0 && (
                  <span className="pill xs" style={{ fontSize: 9 }}>Batch: {batchSent}/{batchTotal}</span>
                )}
              </div>
              <p style={{ margin: 0, fontSize: 10, opacity: 0.6 }}>Next dispatch at random interval</p>
            </div>
            <button
              type="button"
              className="btn xs subtle"
              onClick={() => setShowConfig(true)}
              data-tip="Configure SMTP & Pacing sliders"
            >
              <Icon name="sliders" size={13} />
            </button>
          </div>
        </div>

        {/* 3. Campaign Dispatch Actions */}
        <div className="inspector-card">
          <span className="card-kicker">Campaign Dispatcher</span>
          <div className="stack" style={{ gap: 6, marginTop: 6 }}>
            {campaignState === 'IDLE' ? (
              <button
                type="button"
                className="btn primary"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={handleStartCampaign}
              >
                <Icon name="play" size={13} />
                <span>Start Daily Batch (100)</span>
              </button>
            ) : campaignState === 'RUNNING' ? (
              <div className="row" style={{ gap: 6 }}>
                <button type="button" className="btn warning" style={{ flex: 1, justifyContent: 'center' }} onClick={handlePause}>
                  <Icon name="pause" size={13} /> Pause
                </button>
                <button type="button" className="btn danger" style={{ flex: 1, justifyContent: 'center' }} onClick={handleStop}>
                  <Icon name="x" size={13} /> Stop
                </button>
              </div>
            ) : (
              <div className="row" style={{ gap: 6 }}>
                <button type="button" className="btn primary" style={{ flex: 1, justifyContent: 'center' }} onClick={handleResume}>
                  <Icon name="play" size={13} /> Resume
                </button>
                <button type="button" className="btn danger" style={{ flex: 1, justifyContent: 'center' }} onClick={handleStop}>
                  <Icon name="x" size={13} /> Stop
                </button>
              </div>
            )}

            {/* Isolated Test Send */}
            <div className="row test-send-row" style={{ marginTop: 6, gap: 4 }}>
              <input
                type="email"
                className="input xs"
                style={{ flex: 1, fontSize: 11 }}
                placeholder="Send isolated test to..."
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
              />
              <button
                type="button"
                className={'btn xs' + (isTesting ? ' loading' : '')}
                disabled={isTesting}
                onClick={handleSendTest}
                data-tip="Test SMTP delivery without touching quota"
              >
                <Icon name="send" size={11} />
                <span>Test</span>
              </button>
            </div>
          </div>
        </div>

        {/* 4. Mailtrack Telemetry Stream */}
        <div className="inspector-card" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="card-kicker">Live Read Receipts</span>
            <span className="pill xs" style={{ fontSize: 9 }}>{openedContacts.length} Opened</span>
          </div>

          <div className="scroll custom-scroll" style={{ flex: 1, maxHeight: 180, overflowY: 'auto', marginTop: 6 }}>
            {openedContacts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '16px 0', opacity: 0.5, fontSize: 11 }}>
                <Icon name="checkDouble" size={18} />
                <p style={{ margin: '4px 0 0 0' }}>No opens recorded yet today.</p>
              </div>
            ) : (
              <div className="stack" style={{ gap: 4 }}>
                {openedContacts.map((c) => (
                  <div key={c.id} className="telemetry-item">
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <strong className="text-white" style={{ fontSize: 11 }}>{c.personName}</strong>
                      <span className="open-count-badge">{c.openCount}×</span>
                    </div>
                    <div style={{ fontSize: 10, opacity: 0.6 }}>{c.organization}</div>
                    <div className="row" style={{ justifyContent: 'space-between', fontSize: 9, opacity: 0.5, marginTop: 2 }}>
                      <span>{c.email}</span>
                      <span>✓✓ Viewed</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Settings Modal */}
      {showConfig && (
        <div className="modal-backdrop" onClick={() => setShowConfig(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 14 }}>Outreach & SMTP Settings</h3>
              <button type="button" className="btn xs" onClick={() => setShowConfig(false)}>&times;</button>
            </div>

            <div className="stack" style={{ gap: 10 }}>
              <div>
                <label className="lbl-sm">Sender Display Name</label>
                <input type="text" className="input xs" value={senderName} onChange={(e) => setSenderName(e.target.value)} />
              </div>

              <div>
                <label className="lbl-sm">Sender Gmail / Workspace Address</label>
                <input type="email" className="input xs" value={senderEmail} onChange={(e) => setSenderEmail(e.target.value)} />
              </div>

              <div>
                <label className="lbl-sm">16-Character Google App Password</label>
                <input
                  type="password"
                  className="input xs"
                  placeholder="•••• •••• •••• ••••"
                  value={senderPassword}
                  onChange={(e) => setSenderPassword(e.target.value)}
                />
              </div>

              <div className="row" style={{ gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label className="lbl-sm">Daily Limit</label>
                  <input type="number" className="input xs" value={dailyLimit} onChange={(e) => setDailyLimit(Number(e.target.value))} />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="lbl-sm">Min Delay (sec)</label>
                  <input type="number" className="input xs" value={minDelaySec} onChange={(e) => setMinDelaySec(Number(e.target.value))} />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="lbl-sm">Max Delay (sec)</label>
                  <input type="number" className="input xs" value={maxDelaySec} onChange={(e) => setMaxDelaySec(Number(e.target.value))} />
                </div>
              </div>

              <button type="button" className="btn primary" style={{ marginTop: 8 }} onClick={handleSaveSettings}>
                Save Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
