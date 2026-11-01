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

/** The form starts from the engine's saved settings — never from defaults that a Save would then write over them. */
export function AutopilotDialog({ onClose }: { onClose?: () => void }) {
  const initial = useEngineStore((x) => x.settings)
  const ui = useOutreachUi()
  useEffect(() => {
    if (!initial) void engineClient.settings()
  }, [initial])
  if (!initial) {
    return (
      <Dialog title="Autopilot settings" kicker="OUTREACH" width={640} onClose={() => (onClose ? onClose() : ui.set({ sheet: null }))}>
        <p className="or-muted">Reading the saved settings…</p>
      </Dialog>
    )
  }
  return <AutopilotForm initial={initial} onClose={onClose} />
}

function AutopilotForm({ initial, onClose }: { initial: AutopilotSettings; onClose?: () => void }) {
  const ui = useOutreachUi()

  const [winEnabled, setWinEnabled] = useState(initial?.window?.enabled ?? true)
  const [days, setDays] = useState<number[]>(initial?.window?.days ?? [0, 1, 2, 3, 4])
  const [fromTime, setFromTime] = useState(initial?.window?.from ?? '09:00')
  const [toTime, setToTime] = useState(initial?.window?.to ?? '17:00')
  const [tz, setTz] = useState(initial?.window?.tz ?? 'Asia/Dhaka')
  const [customTz, setCustomTz] = useState('')
  const [isOtherTz, setIsOtherTz] = useState(!TIMEZONES.some((x) => x.value === (initial?.window?.tz ?? 'Asia/Dhaka')))

  const [pace, setPace] = useState<'auto' | 'manual'>(initial?.pace ?? 'auto')
  // the gap between emails and the daily limit: the same numbers the Sender dialog edits (one copy, in the engine)
  const [minMin, setMinMin] = useState(Math.round(((initial?.minDelaySec ?? 180) / 60) * 10) / 10)
  const [maxMin, setMaxMin] = useState(Math.round(((initial?.maxDelaySec ?? 480) / 60) * 10) / 10)
  const [dailyLimit, setDailyLimit] = useState(initial?.dailyLimit ?? 100)
  const [warmupRamp, setWarmupRamp] = useState(initial?.ramp ?? true)
  const [domainMax, setDomainMax] = useState(initial?.domainMaxPerDay ?? 3)
  const [domainGapMin, setDomainGapMin] = useState(Math.round((initial?.domainMinGapSec ?? 1200) / 60))
  const [cooldownDays, setCooldownDays] = useState(initial?.contactCooldownDays ?? 30)
  const [traySending, setTraySending] = useState(initial?.traySending ?? true)
  const [autonomy, setAutonomy] = useState<'suggest' | 'confirm' | 'auto-safe'>(initial?.aiAutonomy ?? 'suggest')
  const [readReplies, setReadReplies] = useState(initial?.aiReadsReply ?? false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

    const minDelaySec = Math.round(Number(minMin) * 60)
    const maxDelaySec = Math.round(Number(maxMin) * 60)
    if (!(minDelaySec >= 30 && minDelaySec <= 3600)) {
      setError('“Wait at least” must be between 0.5 and 60 minutes.')
      return
    }
    if (!(maxDelaySec >= minDelaySec && maxDelaySec <= 3600)) {
      setError('“Wait at most” must be at least “Wait at least” and at most 60 minutes.')
      return
    }
    const limit = Math.round(Number(dailyLimit))
    if (!(limit >= 10 && limit <= 500)) {
      setError('Emails a day must be between 10 and 500.')
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
      minDelaySec,
      maxDelaySec,
      dailyLimit: limit,
      ramp: warmupRamp,
      domainMaxPerDay: Math.max(1, Math.min(50, Number(domainMax) || 3)),
      // 0 is a real choice (no spacing per organisation) — `|| 20` turned it back into 20
      domainMinGapSec: Math.max(0, Math.min(240, Number.isFinite(Number(domainGapMin)) ? Math.round(Number(domainGapMin)) : 20)) * 60,
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
      setMinMin(3)
      setMaxMin(8)
      setDailyLimit(100)
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
          {!winEnabled && (
            <p className="or-any-hour" role="status">Off: emails go out at any hour, also at night and on weekends.</p>
          )}

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
              { value: 'manual', label: 'Fixed gap' },
              { value: 'auto', label: 'Spread over the hours' },
            ]}
          />
          <div className="or-grid3" style={{ marginTop: 10 }}>
            <Field label="Wait at least (min)">
              <input className="input" type="number" min={0.5} max={60} step={0.5} value={minMin} onChange={(e) => setMinMin(Number(e.target.value))} />
            </Field>
            <Field label="Wait at most (min)">
              <input className="input" type="number" min={0.5} max={60} step={0.5} value={maxMin} onChange={(e) => setMaxMin(Number(e.target.value))} />
            </Field>
            <Field label="Emails a day">
              <input className="input" type="number" min={10} max={500} value={dailyLimit} onChange={(e) => setDailyLimit(Number(e.target.value))} />
            </Field>
          </div>
          <p className="or-muted" style={{ marginTop: 6 }}>
            {pace === 'manual'
              ? `Each email waits a random ${minMin}–${maxMin} min after the one before.`
              : `Spreads today’s emails across the sending hours, but never closer than ${minMin} min or further apart than ${maxMin} min.`}{' '}
            Emails to the same organisation also follow the spacing below. The Sender dialog shows the same numbers.
          </p>
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
