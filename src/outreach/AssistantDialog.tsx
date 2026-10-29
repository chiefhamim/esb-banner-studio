import { useEffect, useRef, useState } from 'react'
import { Dialog, Seg } from '../ui/controls'
import { Icon, type IconName } from '../ui/Icon'
import { aiFor, aiPaused } from '../editorial/aiProviders'
import { useEngineStore } from './engineStore'
import { useOutreachStore } from './outreachStore'
import { useOutreachUi } from './outreachUi'
import { engineClient } from './engineClient'
import { askAssistant, applyAssistantAction, type AssistantActionItem } from './operator'
import type { CommandRisk } from './commands'

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

function riskColor(risk: CommandRisk): string {
  switch (risk) {
    case 'read':
      return 'var(--color-good, #2e7d32)'
    case 'safe':
      return 'var(--color-primary, #1976d2)'
    case 'confirm':
      return 'var(--color-warn, #e65100)'
    case 'danger':
      return 'var(--color-bad, #c62828)'
  }
}

export function AssistantDialog({ onClose }: { onClose: () => void }) {
  const ui = useOutreachUi()
  const outreach = useOutreachStore()
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

  return (
    <Dialog
      title="Outreach Assistant"
      kicker={camp?.name ? camp.name.toUpperCase() : 'AUTOPILOT'}
      width={740}
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <button
            type="button"
            className="or-link-btn"
            onClick={() => setShowRecent((prev) => !prev)}
            style={{ fontSize: 12 }}
          >
            {showRecent ? 'Hide recent actions' : `Recent assistant actions (${recentActions.length})`}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Done
          </button>
        </div>
      }
    >
      <div className="or-assistant-dialog stack" style={{ gap: 14 }}>
        {/* Autonomy Setting Bar */}
        <div
          className="or-assistant-topbar"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            background: 'var(--chip-bg, rgba(0,0,0,0.03))',
            borderRadius: 6,
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="sliders" size={14} />
            <span style={{ fontSize: 12, fontWeight: 600 }}>Autonomy:</span>
          </div>
          <Seg<'suggest' | 'confirm' | 'auto-safe'>
            value={autonomy}
            onChange={(val) => {
              void engineClient.saveSettings({ aiAutonomy: val })
            }}
            options={[
              { value: 'suggest', label: 'Suggest', tip: 'Actions shown as advice; nothing runs automatically' },
              { value: 'confirm', label: 'Ask me first', tip: 'Actions listed for approval before running' },
              { value: 'auto-safe', label: 'Do safe things', tip: 'Read & safe actions run immediately; confirm needs approval' },
            ]}
          />
        </div>

        {/* AI Off Banner */}
        {!aiAvailable ? (
          <div
            className="or-ai-off-card"
            style={{
              padding: 24,
              textAlign: 'center',
              background: 'var(--card-bg)',
              border: '1px dashed var(--border)',
              borderRadius: 8,
              margin: '16px 0',
            }}
          >
            <Icon name="sparkle" size={28} className="or-muted" />
            <h3 style={{ margin: '12px 0 6px 0', fontSize: 15 }}>Connect an AI to use the assistant.</h3>
            <p className="or-muted" style={{ margin: '0 0 16px 0', fontSize: 13 }}>
              The assistant can answer questions about your campaigns, calculate deliverability plans, and execute safe actions.
            </p>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                onClose()
                ui.set({ sheet: 'ai' })
              }}
            >
              Connect AI
            </button>
          </div>
        ) : (
          <>
            {/* Conversation Flow */}
            <div
              className="or-assistant-chat"
              style={{
                height: 340,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                padding: '8px 4px',
              }}
            >
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`or-chat-bubble ${m.role}`}
                  style={{
                    alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                    maxWidth: '85%',
                    padding: '10px 14px',
                    borderRadius: 8,
                    background:
                      m.role === 'user'
                        ? 'var(--color-primary, #1976d2)'
                        : 'var(--card-bg, #f7f7f8)',
                    color: m.role === 'user' ? '#fff' : 'inherit',
                    border: m.role === 'assistant' ? '1px solid var(--border)' : 'none',
                    fontSize: 13,
                    lineHeight: 1.45,
                  }}
                >
                  <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>

                  {/* Recommended Action Rows */}
                  {m.actions && m.actions.length > 0 && (
                    <div
                      className="or-assistant-actions stack"
                      style={{
                        marginTop: 10,
                        paddingTop: 8,
                        borderTop: '1px solid var(--border)',
                        gap: 8,
                      }}
                    >
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)' }}>
                        Recommended Actions:
                      </span>
                      {m.actions.map((act) => (
                        <div
                          key={act.id}
                          className="or-action-row"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                            padding: '6px 8px',
                            background: 'var(--bg, #fff)',
                            border: '1px solid var(--border)',
                            borderRadius: 6,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                            <Icon name={commandIcon(act.command)} size={14} />
                            <span style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {act.describe}
                            </span>
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                padding: '1px 5px',
                                borderRadius: 4,
                                textTransform: 'uppercase',
                                background: 'rgba(0,0,0,0.06)',
                                color: riskColor(act.risk),
                              }}
                            >
                              {act.risk}
                            </span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {act.status === 'proposed' && (
                              <>
                                <button
                                  type="button"
                                  className="btn xs primary"
                                  onClick={() => void handleApply(m.id, act)}
                                >
                                  Apply
                                </button>
                                <button
                                  type="button"
                                  className="btn xs"
                                  onClick={() => handleDismiss(m.id, act.id)}
                                >
                                  Dismiss
                                </button>
                              </>
                            )}
                            {act.status === 'executed' && (
                              <span style={{ fontSize: 11, color: 'var(--color-good, #2e7d32)', fontWeight: 600 }}>
                                <Icon name="check" size={12} /> Applied
                              </span>
                            )}
                            {act.status === 'refused' && (
                              <span
                                style={{ fontSize: 11, color: 'var(--color-bad, #c62828)' }}
                                title={act.error}
                              >
                                Refused
                              </span>
                            )}
                            {act.status === 'failed' && (
                              <span
                                style={{ fontSize: 11, color: 'var(--color-bad, #c62828)' }}
                                title={act.error}
                              >
                                Failed
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {busy && (
                <div
                  className="or-chat-bubble assistant"
                  style={{
                    alignSelf: 'flex-start',
                    padding: '8px 12px',
                    borderRadius: 8,
                    background: 'var(--card-bg, #f7f7f8)',
                    border: '1px solid var(--border)',
                    fontSize: 12,
                    color: 'var(--text-3)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Icon name="refresh" size={12} className="spin" />
                  <span>The assistant is thinking…</span>
                </div>
              )}
              <div ref={chatBottomRef} />
            </div>

            {/* Quick Prompts (if only welcome message) */}
            {messages.length === 1 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '-4px 0 4px 0' }}>
                {[
                  'What is today’s schedule?',
                  'Why were contacts skipped?',
                  'Pause all sending',
                  'Show campaign summary',
                ].map((sugg) => (
                  <button
                    key={sugg}
                    type="button"
                    className="or-chip"
                    onClick={() => void handleSend(sugg)}
                    style={{ cursor: 'pointer', fontSize: 11 }}
                  >
                    {sugg}
                  </button>
                ))}
              </div>
            )}

            {/* Single Input Line */}
            <div className="or-assistant-input-row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                ref={inputRef}
                type="text"
                className="input"
                placeholder="Ask the assistant (e.g. 'What is the schedule?', 'Pause sending')…"
                value={input}
                disabled={busy}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void handleSend()
                  }
                }}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn primary"
                disabled={busy || !input.trim()}
                onClick={() => void handleSend()}
              >
                <Icon name="send" size={13} />
                <span>Send</span>
              </button>
            </div>
          </>
        )}

        {/* Collapsible Recent Actions Section */}
        {showRecent && (
          <div
            className="or-recent-actions-panel"
            style={{
              padding: 10,
              background: 'var(--chip-bg, rgba(0,0,0,0.02))',
              border: '1px solid var(--border)',
              borderRadius: 6,
              maxHeight: 160,
              overflowY: 'auto',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>
              Recent Assistant Audit Log (last 20 events):
            </div>
            {recentActions.length === 0 ? (
              <p className="or-muted" style={{ fontSize: 12, margin: 0 }}>
                No assistant actions logged yet.
              </p>
            ) : (
              <div className="stack" style={{ gap: 4 }}>
                {recentActions.map((ev) => (
                  <div
                    key={ev.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: 11,
                      padding: '2px 0',
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {ev.text}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--text-3)', marginLeft: 8 }}>
                      {new Date(ev.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  )
}
