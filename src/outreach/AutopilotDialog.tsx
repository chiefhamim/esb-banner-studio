import { useEffect, useState } from 'react'
import { useEngineStore } from './engineStore'
import { engineClient } from './engineClient'
import { ask, useOutreachUi } from './outreachUi'
import { Dialog, Field, Switch, Seg } from '../ui/controls'
import type { AutopilotSettings } from '../esb'

const TIMEZONES = [
  { value: 'Asia/Dhaka', label: 'Asia/Dhaka (UTC+6)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata (UTC+5:30)' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai (UTC+4)' },
  { value: 'Europe/London', label: 'Europe/London (UTC+0/+1)' },
  { value: 'America/New_York', label: 'America/New_York (UTC-5/-4)' },
]

const DOW = [
  { day: 0, label: 'Sun' },
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' },
  { day: 6, label: 'Sat' },
]

export function AutopilotDialog({ onClose }: { onClose?: () => void }) {
  const ui = useOutreachUi()
  const engine = useEngineStore()
  const initial = engine.settings

  const [winEnabled, setWinEnabled] = useState(initial?.window?.enabled ?? true)
  const [days, setDays] = useState<number[]>(initial?.window?.days ?? [0, 1, 2, 3, 4])
  const [fromTime, setFromTime] = useState(initial?.window?.from ?? '09:00')
  const [toTime, setToTime] = useState(initial?.window?.to ?? '17:00')
  const [tz, setTz] = useState(initial?.window?.tz ?? 'Asia/Dhaka')
  const [customTz, setCustomTz] = useState('')
  const [isOtherTz, setIsOtherTz] = useState(!TIMEZONES.some((x) => x.value === (initial?.window?.tz ?? 'Asia/Dhaka')))

  const [pace, setPace] = useState<'auto' | 'manual'>(initial?.pace ?? 'auto')
  const [warmupRamp, setWarmupRamp] = useState(initial?.ramp ?? true)
  const [domainMax, setDomainMax] = useState(initial?.domainMaxPerDay ?? 3)
  const [domainGapMin, setDomainGapMin] = useState(Math.round((initial?.domainMinGapSec ?? 1200) / 60))
  const [cooldownDays, setCooldownDays] = useState(initial?.contactCooldownDays ?? 30)
  const [traySending, setTraySending] = useState(initial?.traySending ?? true)
  const [autonomy, setAutonomy] = useState<'suggest' | 'confirm' | 'auto-safe'>(initial?.aiAutonomy ?? 'suggest')
  const [readReplies, setReadReplies] = useState(initial?.aiReadsReply ?? false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!initial) {
      void engineClient.settings()
    }
  }, [initial])

  const close = () => {
    if (onClose) onClose()
    else ui.set({ sheet: null })
  }

  const toggleDay = (d: number) => {
    if (days.includes(d)) {
      if (days.length > 1) setDays(days.filter((x) => x !== d))
    } else {
      setDays([...days, d].sort((a, b) => a - b))
    }
  }

  const validateTz = (t: string): boolean => {
    try {
      new Intl.DateTimeFormat(undefined, { timeZone: t })
      return true
    } catch {
      return false
    }
  }

  const effectiveTz = isOtherTz ? customTz.trim() : tz

  const save = async () => {
    setError(null)
    if (isOtherTz && !validateTz(customTz.trim())) {
      setError(`"${customTz}" is not a valid IANA time zone name.`)
      return
    }
    if (fromTime >= toTime) {
      setError('Window end time must be after start time.')
      return
    }

    setSaving(true)
    const patch: Partial<AutopilotSettings> = {
      window: {
        enabled: winEnabled,
        days,
        from: fromTime,
        to: toTime,
        tz: effectiveTz || 'Asia/Dhaka',
      },
      pace,
      ramp: warmupRamp,
      domainMaxPerDay: Math.max(1, Math.min(50, Number(domainMax) || 3)),
      domainMinGapSec: Math.max(0, Math.min(240, Number(domainGapMin) || 20)) * 60,
      contactCooldownDays: Math.max(7, Math.min(365, Number(cooldownDays) || 30)),
      traySending,
      aiAutonomy: autonomy,
      aiReadsReply: readReplies,
    }

    const res = await engineClient.saveSettings(patch)
    setSaving(false)
    if (!res.ok) {
      setError(res.error || 'Could not save settings')
      return
    }
    close()
  }

  const restoreDefaults = async () => {
    if (
      await ask({
        title: 'Restore Autopilot defaults?',
        body: 'This resets the send window, domain spacing, warmup ramp and tray sending to their original settings.',
        ok: 'Restore defaults',
      })
    ) {
      setWinEnabled(true)
      setDays([0, 1, 2, 3, 4])
      setFromTime('09:00')
      setToTime('17:00')
      setTz('Asia/Dhaka')
      setIsOtherTz(false)
      setPace('auto')
      setWarmupRamp(true)
      setDomainMax(3)
      setDomainGapMin(20)
      setCooldownDays(30)
      setTraySending(true)
      setAutonomy('suggest')
      setReadReplies(false)
      setError(null)
    }
  }

  return (
    <Dialog
      title="Autopilot settings"
      kicker="OUTREACH"
      width={640}
      onClose={close}
      footer={
        <>
          <button type="button" className="btn" onClick={restoreDefaults}>
            Restore defaults
          </button>
          <div className="spacer" />
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={save} disabled={saving}>
            {saving ? 'Saving' : 'Save'}
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 16 }}>
        {error && (
          <div className="callout bad" role="alert">
            <span>{error}</span>
          </div>
        )}

        <section className="or-dialog-section">
          <h4 style={{ margin: '0 0 6px 0', fontSize: 13, fontWeight: 600 }}>When to send</h4>
          <p className="or-muted" style={{ marginBottom: 10 }}>
            Only send emails during business hours so they arrive when people read their mail.
          </p>

          <Switch
            checked={winEnabled}
            onChange={setWinEnabled}
            label="Only send in a time window"
          />

          {winEnabled && (
            <div className="stack" style={{ gap: 10, marginTop: 10 }}>
              <Field label="Days">
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {DOW.map(({ day, label }) => {
                    const active = days.includes(day)
                    return (
                      <button
                        key={day}
                        type="button"
                        className={`btn xs ${active ? 'primary' : ''}`}
                        onClick={() => toggleDay(day)}
                        aria-pressed={active}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              </Field>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="From">
                  <input
                    type="time"
                    className="input"
                    value={fromTime}
                    onChange={(e) => setFromTime(e.target.value)}
                  />
                </Field>
                <Field label="To">
                  <input
                    type="time"
                    className="input"
                    value={toTime}
                    onChange={(e) => setToTime(e.target.value)}
                  />
                </Field>
              </div>

              <Field label="Time zone">
                <div className="stack" style={{ gap: 8 }}>
                  <select
                    className="input"
                    value={isOtherTz ? 'other' : tz}
                    onChange={(e) => {
                      if (e.target.value === 'other') {
                        setIsOtherTz(true)
                      } else {
                        setIsOtherTz(false)
                        setTz(e.target.value)
                      }
                    }}
                  >
                    {TIMEZONES.map((x) => (
                      <option key={x.value} value={x.value}>
                        {x.label}
                      </option>
                    ))}
                    <option value="other">Other</option>
                  </select>

                  {isOtherTz && (
                    <input
                      type="text"
                      className="input"
                      placeholder="e.g. Europe/Berlin"
                      value={customTz}
                      onChange={(e) => setCustomTz(e.target.value)}
                    />
                  )}
                </div>
              </Field>
            </div>
          )}
        </section>

        <section className="or-dialog-section">
          <h4 style={{ margin: '0 0 6px 0', fontSize: 13, fontWeight: 600 }}>How fast</h4>
          <Seg<'auto' | 'manual'>
            value={pace}
            onChange={setPace}
            options={[
              { value: 'auto', label: 'Automatic' },
              { value: 'manual', label: 'My own gaps' },
            ]}
          />
          {pace === 'auto' ? (
            <p className="or-muted" style={{ marginTop: 6 }}>
              Spreads today’s emails evenly across the window.
            </p>
          ) : (
            <div style={{ marginTop: 8 }}>
              <p className="or-muted">Uses the min/max gaps configured in your sender account.</p>
              <button
                type="button"
                className="btn xs or-link-btn"
                style={{ marginTop: 4 }}
                onClick={() => {
                  close()
                  ui.set({ sheet: 'sender' })
                }}
              >
                Set the gaps in the sender account →
              </button>
            </div>
          )}
        </section>

        <section className="or-dialog-section">
          <h4 style={{ margin: '0 0 6px 0', fontSize: 13, fontWeight: 600 }}>Protect the account</h4>
          <div className="stack" style={{ gap: 10 }}>
            <Switch
              checked={warmupRamp}
              onChange={setWarmupRamp}
              label="Start slowly (warm-up)"
            />

            <Field label="Domain throttling">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <span>At most</span>
                <input
                  type="number"
                  className="input"
                  min={1}
                  max={50}
                  style={{ width: 60 }}
                  value={domainMax}
                  onChange={(e) => setDomainMax(Number(e.target.value))}
                />
                <span>emails a day to one company,</span>
                <input
                  type="number"
                  className="input"
                  min={0}
                  max={240}
                  style={{ width: 60 }}
                  value={domainGapMin}
                  onChange={(e) => setDomainGapMin(Number(e.target.value))}
                />
                <span>minutes apart</span>
              </div>
            </Field>

            <Field label="Contact cooldown">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <span>Don’t write to the same person again within</span>
                <input
                  type="number"
                  className="input"
                  min={7}
                  max={365}
                  style={{ width: 70 }}
                  value={cooldownDays}
                  onChange={(e) => setCooldownDays(Number(e.target.value))}
                />
                <span>days</span>
              </div>
            </Field>
          </div>
        </section>

        <section className="or-dialog-section">
          <h4 style={{ margin: '0 0 6px 0', fontSize: 13, fontWeight: 600 }}>Background</h4>
          <Switch
            checked={traySending}
            onChange={setTraySending}
            label="Keep sending from the tray when I close the window"
          />
        </section>

        <section className="or-dialog-section">
          <h4 style={{ margin: '0 0 6px 0', fontSize: 13, fontWeight: 600 }}>Assistant</h4>
          <Seg<'suggest' | 'confirm' | 'auto-safe'>
            value={autonomy}
            onChange={setAutonomy}
            options={[
              { value: 'suggest', label: 'Suggest only' },
              { value: 'confirm', label: 'Ask me first' },
              { value: 'auto-safe', label: 'Do safe things by itself' },
            ]}
          />
          <div style={{ marginTop: 10 }}>
            <Switch
              checked={readReplies}
              onChange={setReadReplies}
              label="Let the assistant read replies to sort them"
            />
            <p className="or-muted" style={{ marginTop: 4 }}>
              Reply text is sent to your AI provider. Off by default.
            </p>
          </div>
        </section>

        <p className="or-muted" style={{ fontStyle: 'italic', fontSize: 11.5 }}>
          Changes apply from the next email.
        </p>
      </div>
    </Dialog>
  )
}
