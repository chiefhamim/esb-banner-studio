import { useEffect, useRef, useState } from 'react'
import { Dialog, Seg } from '../ui/controls'
import { Icon, type IconName } from '../ui/Icon'
import { aiFor, aiPaused } from '../editorial/aiProviders'
import { useEngineStore } from './engineStore'
import { useDesk } from './outreachStore'
import { useOutreachUi } from './outreachUi'
import { engineClient } from './engineClient'
import { askAssistant, applyAssistantAction, type AssistantActionItem } from './operator'
import { fmtTime, useClockFormat } from '../ui/time'

interface MessageItem {
  id: string
  role: 'user' | 'assistant'
  text: string
  actions?: AssistantActionItem[]
  timestamp: number
}

interface RecentAction {
  id: string
  command?: string
  status?: string
  text: string
  t: number
}

function commandIcon(cmd: string): IconName {
  if (cmd.startsWith('pause')) return 'pause'
  if (cmd.startsWith('resume') || cmd.startsWith('start')) return 'play'
  if (cmd.startsWith('stop')) return 'x'
  if (cmd.includes('Window') || cmd.includes('Schedule')) return 'clock'
  if (cmd.includes('Cooldown')) return 'sliders'
  if (cmd.includes('Address') || cmd.includes('Approve')) return 'check'
  if (cmd.includes('Note')) return 'edit'
  if (cmd.includes('Plan') || cmd.includes('Summary')) return 'chart'
  return 'sparkle'
}

const AUTONOMY_NOTE: Record<'suggest' | 'confirm' | 'auto-safe', string> = {
  suggest: 'Actions are shown as advice. Nothing runs on its own.',
  confirm: 'Actions are listed for you to apply one by one.',
  'auto-safe': 'Look-ups and safe actions run at once; anything bigger waits for you.',
}

const PROMPTS: Array<{ q: string; icon: IconName }> = [
  { q: 'What is today’s schedule?', icon: 'clock' },
  { q: 'Why were contacts skipped?', icon: 'info' },
  { q: 'Show campaign summary', icon: 'chart' },
  { q: 'Pause all sending', icon: 'pause' },
]

/** camelCase key -> "Camel case" */
function human(k: string): string {
  const w = k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
  return w.charAt(0).toUpperCase() + w.slice(1)
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'number') return v.toLocaleString()
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.length ? v.map(fmt).join(', ') : 'None'
  return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${human(k)}: ${fmt(x)}`).join(' · ')
}

/** What a read command returned, as plain rows (before, Apply only said "Applied" and the answer was dropped). */
function ResultView({ result }: { result: unknown }) {
  if (result === undefined || result === null) return null
  if (typeof result !== 'object') return <div className="or-asst-result"><span>{fmt(result)}</span></div>
  const rows: Array<[string, unknown]> = []
  // internal ids (campaignId, activeCampaignId…) mean nothing to the editor; the name beside them says it
  for (const [k, v] of Object.entries(result as Record<string, unknown>).filter(([k]) => !/(^id|Id)$/.test(k))) {
    if (Array.isArray(v) && v.length && typeof v[0] === 'object') {
      v.slice(0, 12).forEach((item, i) => {
        const o = item as Record<string, unknown>
        const name = String(o.name ?? o.label ?? o.id ?? `${human(k)} ${i + 1}`)
        const rest = Object.fromEntries(Object.entries(o).filter(([kk]) => !['name', 'label'].includes(kk) && !/(^id|Id)$/.test(kk)))
        rows.push([name, rest])
      })
      if (v.length > 12) rows.push(['…', `${v.length - 12} more`])
    } else rows.push([human(k), v])
  }
  if (!rows.length) return null
  return (
    <dl className="or-asst-result">
      {rows.map(([k, v], i) => <div key={i}><dt>{k}</dt><dd>{fmt(v)}</dd></div>)}
    </dl>
  )
}

export function AssistantDialog({ onClose }: { onClose: () => void }) {
  useClockFormat() // re-render when Home → Settings → Time format changes
  const ui = useOutreachUi()
  const outreach = useDesk()
  const engine = useEngineStore()
  const camp = outreach.campaign()

  const aiAvailable = !aiPaused() && !!aiFor('outreach')
  const settings = engine.settings
  const autonomy = settings?.aiAutonomy || 'suggest'

  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState<MessageItem[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: 'Hello! I can help you monitor sending status, check delivery plans, adjust windows, or execute safe actions. What would you like to do?',
      timestamp: Date.now(),
    },
  ])
  const [recentActions, setRecentActions] = useState<RecentAction[]>([])
  const [showRecent, setShowRecent] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const chatBottomRef = useRef<HTMLDivElement>(null)

  // Focus input on mount
  useEffect(() => {
    if (aiAvailable) {
      inputRef.current?.focus()
    }
  }, [aiAvailable])

  // Scroll chat bottom on new messages
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Load recent assistant actions
  const loadRecent = async () => {
    try {
      const res = await engineClient.events({ types: ['ai.action'], limit: 20 })
      if (res && res.events) {
        setRecentActions(
          res.events.map((e) => ({
            id: e.id,
            command: (e as any).command,
            status: (e as any).status,
            text: (e as any).text || '',
            t: e.t,
          }))
        )
      }
    } catch {}
  }

  useEffect(() => {
    loadRecent()
  }, [])

  const handleSend = async (queryText?: string) => {
    const q = (queryText ?? input).trim()
    if (!q || busy) return

    setInput('')
    const userMsg: MessageItem = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: q,
      timestamp: Date.now(),
    }
    setMessages((prev) => [...prev, userMsg])
    setBusy(true)

    try {
      const res = await askAssistant(q)
      const assistantMsg: MessageItem = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        text: res.say,
        actions: res.actions,
        timestamp: Date.now(),
      }
      setMessages((prev) => [...prev, assistantMsg])
      void loadRecent()
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          text: `An error occurred while consulting the assistant: ${err?.message || 'Error'}`,
          timestamp: Date.now(),
        },
      ])
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  const handleApply = async (messageId: string, action: AssistantActionItem) => {
    const updated = await applyAssistantAction(action)
    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.id !== messageId || !msg.actions) return msg
        return {
          ...msg,
          actions: msg.actions.map((act) => (act.id === action.id ? updated : act)),
        }
      })
    )
    void loadRecent()
  }

  const handleDismiss = (messageId: string, actionId: string) => {
    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.id !== messageId || !msg.actions) return msg
        return {
          ...msg,
          actions: msg.actions.filter((act) => act.id !== actionId),
        }
      })
    )
  }

  const empty = messages.length === 1 && !busy

  return (
    <Dialog
      title="Outreach Assistant"
      kicker={camp?.name ? camp.name.toUpperCase() : 'AUTOPILOT'}
      width={740}
      onClose={onClose}
      footer={
        <div className="or-asst-foot">
          <button type="button" className="btn ghost sm" aria-expanded={showRecent} onClick={() => setShowRecent((prev) => !prev)}>
            <Icon name="activity" size={13} />
            <span>{showRecent ? 'Hide recent actions' : 'Recent actions'}</span>
            {!showRecent && recentActions.length > 0 && <em className="or-asst-count">{recentActions.length}</em>}
          </button>
          <button type="button" className="btn" onClick={onClose}>Done</button>
        </div>
      }
    >
      <div className="or-asst">
        <div className="or-asst-mode">
          <span className="or-asst-mode-ico"><Icon name="sliders" size={15} /></span>
          <div className="or-asst-mode-txt">
            <b>Autonomy</b>
            <span>{AUTONOMY_NOTE[autonomy]}</span>
          </div>
          <Seg<'suggest' | 'confirm' | 'auto-safe'>
            value={autonomy}
            onChange={(val) => { void engineClient.saveSettings({ aiAutonomy: val }) }}
            options={[
              { value: 'suggest', label: 'Suggest', tip: 'Actions shown as advice; nothing runs automatically' },
              { value: 'confirm', label: 'Ask me first', tip: 'Actions listed for approval before running' },
              { value: 'auto-safe', label: 'Do safe things', tip: 'Read & safe actions run immediately; confirm needs approval' },
            ]}
          />
        </div>

        {!aiAvailable ? (
          <div className="or-asst-pane or-asst-empty">
            <span className="or-asst-hero"><Icon name="sparkle" size={20} /></span>
            <h3>Connect an AI to use the assistant</h3>
            <p>It answers questions about your campaigns, works out sending plans and can run safe actions for you.</p>
            <button type="button" className="btn primary" onClick={() => { onClose(); ui.set({ sheet: 'ai' }) }}>
              <Icon name="link" size={13} /><span>Connect AI</span>
            </button>
          </div>
        ) : (
          <>
            <div className={'or-asst-pane or-asst-chat' + (empty ? ' is-empty' : '')} aria-live="polite">
              {empty ? (
                <div className="or-asst-empty">
                  <span className="or-asst-hero"><Icon name="sparkle" size={20} /></span>
                  <h3>What would you like to know?</h3>
                  <p>Ask about sending, schedules or skipped contacts, or start with one of these.</p>
                  <div className="or-asst-prompts">
                    {PROMPTS.map((p) => (
                      <button key={p.q} type="button" className="or-asst-prompt" onClick={() => void handleSend(p.q)}>
                        <Icon name={p.icon} size={14} /><span>{p.q}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {messages.slice(1).map((m) => (
                    <div key={m.id} className={'or-asst-msg ' + m.role}>
                      {m.role === 'assistant' && <span className="or-asst-av"><Icon name="sparkle" size={13} /></span>}
                      <div className="or-asst-bubble">
                        <div className="or-asst-text">{m.text}</div>
                        {m.actions && m.actions.length > 0 && (
                          <div className="or-asst-actions">
                            <span className="or-asst-label">Recommended actions</span>
                            {m.actions.map((act) => (
                              <div key={act.id} className={'or-asst-act st-' + act.status}>
                                <div className="or-asst-act-row">
                                  <Icon name={commandIcon(act.command)} size={14} />
                                  <span className="or-asst-act-name">{act.describe}</span>
                                  <em className={'or-asst-risk ' + act.risk}>{act.risk}</em>
                                  <div className="or-asst-act-do">
                                    {act.status === 'proposed' && (
                                      <>
                                        <button type="button" className="btn sm primary" onClick={() => void handleApply(m.id, act)}>Apply</button>
                                        <button type="button" className="btn sm ghost" onClick={() => handleDismiss(m.id, act.id)}>Dismiss</button>
                                      </>
                                    )}
                                    {act.status === 'executed' && <span className="or-asst-state good"><Icon name="check" size={12} />Done</span>}
                                    {act.status === 'refused' && <span className="or-asst-state bad">Refused</span>}
                                    {act.status === 'failed' && <span className="or-asst-state bad">Failed</span>}
                                  </div>
                                </div>
                                {act.status === 'executed' && <ResultView result={act.result} />}
                                {(act.status === 'refused' || act.status === 'failed') && act.error && <p className="or-asst-err">{act.error}</p>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {busy && (
                    <div className="or-asst-msg assistant">
                      <span className="or-asst-av"><Icon name="sparkle" size={13} /></span>
                      <div className="or-asst-bubble thinking" role="status" aria-label="The assistant is thinking"><i /><i /><i /></div>
                    </div>
                  )}
                </>
              )}
              <div ref={chatBottomRef} />
            </div>

            <form className="or-asst-input" onSubmit={(e) => { e.preventDefault(); void handleSend() }}>
              <input
                ref={inputRef}
                type="text"
                className="input"
                placeholder="Ask the assistant — e.g. “What is the schedule?” or “Pause sending”"
                value={input}
                disabled={busy}
                onChange={(e) => setInput(e.target.value)}
              />
              <button type="submit" className="btn primary" disabled={busy || !input.trim()}>
                <Icon name="send" size={13} /><span>Send</span>
              </button>
            </form>
          </>
        )}

        {showRecent && (
          <div className="or-asst-recent">
            <span className="or-asst-label">Recent assistant actions</span>
            {recentActions.length === 0 ? (
              <p className="or-asst-none">No assistant actions logged yet.</p>
            ) : (
              <ul>
                {recentActions.map((ev) => (
                  <li key={ev.id}>
                    <span>{ev.text}</span>
                    <time>{fmtTime(ev.t)}</time>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Dialog>
  )
}
