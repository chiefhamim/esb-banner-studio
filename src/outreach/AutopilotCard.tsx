import { useEffect, useState } from 'react'
import { useEngineStore } from './engineStore'
import { useDesk } from './outreachStore'
import { ask, useOutreachUi } from './outreachUi'
import { describeRun } from './activityFormat'
import { eligible, pauseBatch, resumeBatch, stopBatch } from './campaign'
import { Icon } from '../ui/Icon'
import { useClockFormat } from '../ui/time'

export function AutopilotCard() {
  useClockFormat() // re-render when Home → Settings → Time format changes
  const ui = useOutreachUi()
  const s = useDesk()
  const engine = useEngineStore()
  const c = s.campaign()
  const [, setTick] = useState(0)

  // 1-second interval tick when active to refresh countdowns and meters
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const job = engine.jobForCampaign(c?.id)
  const settings = engine.settings
  const desc = describeRun(job, settings, Date.now())

  const queue = c ? eligible(s.contacts, c.subject, c.body, c.audience) : []
  const dailyLimit = settings?.dailyLimit ?? 100
  const estimatedDays = Math.max(1, Math.ceil(queue.length / Math.max(1, dailyLimit)))
  const anyHour = <AnyHourWarning />

  if (desc.status === 'idle') {
    return (
      <section className="or-card or-autopilot-card" aria-label="Autopilot status">
        <header className="or-autopilot-header">
          <Icon name="refresh" size={14} />
          <h3>Autopilot</h3>
        </header>
        <p className="or-muted">{desc.sentence}</p>
        <p className="or-muted" data-tip="Your first days send fewer emails so Gmail learns to trust the account.">
          {desc.summary}
        </p>
        {queue.length > 0 && (
          <p className="or-muted">Takes about {estimatedDays} sending {estimatedDays === 1 ? 'day' : 'days'}.</p>
        )}
        {anyHour}
        <div className="or-autopilot-actions">
          <button
            type="button"
            className="btn xs"
            onClick={() => ui.set({ sheet: 'assistant' })}
          >
            <Icon name="sparkle" size={12} />
            <span>Ask the assistant</span>
          </button>
          <button
            type="button"
            className="btn xs"
            onClick={() => ui.set({ sheet: 'autopilot' })}
          >
            <Icon name="sliders" size={12} />
            <span>Sending settings</span>
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="or-card or-autopilot-card" aria-label="Autopilot status">
      <header className="or-autopilot-header">
        <Icon name="refresh" size={14} />
        <h3>Autopilot</h3>
        <span className={`or-chip ${desc.chipClass}`}>{desc.label}</span>
      </header>

      <div className="or-autopilot-progress">
        <div className="or-autopilot-meter-row">
          <span>{desc.countText}</span>
          <span className="or-percent">{desc.percent}%</span>
        </div>
        <div
          className="or-meter"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={desc.percent}
        >
          <i style={{ width: `${desc.percent}%` }} />
        </div>
      </div>

      <div className="or-autopilot-meta">
        {/* the precise reason replaces the generic sentence ("Same company just emailed") when the engine gave one */}
        {!(desc.reason && desc.nextInText) && <p className="or-muted">{desc.sentence}</p>}
        {desc.nextInText && <p className="or-muted" data-testid="or-wait-reason">{desc.nextInText}{desc.reason ? ` — ${desc.reason}` : ''}</p>}
      </div>

      <div className="or-autopilot-actions">
        {desc.status === 'sending' || desc.status === 'waiting' ? (
          <button type="button" className="btn sm" onClick={() => void pauseBatch()}>
            <Icon name="pause" size={13} />
            <span>Pause</span>
          </button>
        ) : desc.status === 'paused' ? (
          <button type="button" className="btn sm primary" onClick={() => void resumeBatch()}>
            <Icon name="play" size={13} />
            <span>Resume</span>
          </button>
        ) : null}

        {desc.status !== 'done' && desc.status !== 'stopped' && (
          <button
            type="button"
            className="btn sm"
            onClick={async () => {
              if (
                await ask({
                  title: 'Stop sending?',
                  body: 'Nobody else is emailed from this campaign. Everyone already emailed stays recorded. You can start a new run for the rest.',
                  ok: 'Stop sending',
                  danger: true,
                })
              ) {
                void stopBatch()
              }
            }}
          >
            <Icon name="x" size={13} />
            <span>Stop</span>
          </button>
        )}

        <button
          type="button"
          className="btn xs"
          onClick={() => ui.set({ sheet: 'assistant' })}
        >
          <Icon name="sparkle" size={12} />
          <span>Ask the assistant</span>
        </button>

        <button
          type="button"
          className="btn xs or-right-link"
          onClick={() => ui.set({ desk: 'activity' })}
        >
          <span>Activity →</span>
        </button>
      </div>
    </section>
  )
}

/** "Only send in a time window" is off: say so where sending is watched (the idle Autopilot card; the Send footer
 *  while a batch runs), so night-time sends are never a surprise. */
export function AnyHourWarning() {
  const ui = useOutreachUi()
  const off = useEngineStore((x) => x.settings?.window?.enabled === false)
  if (!off) return null
  return (
    <p className="or-any-hour" role="status" data-testid="or-any-hour">
      <Icon name="info" size={12} />
      <span>Sending at any hour — </span>
      <button type="button" className="or-link-btn" onClick={() => ui.set({ sheet: 'autopilot' })}>set hours in Sending settings</button>
    </p>
  )
}
