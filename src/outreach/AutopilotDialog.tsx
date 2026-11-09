// Sending settings — the ONE place that decides how fast the desk sends (2026-11-02 simplification).
//
// On top, the three things that set the pace: emails per day, the gap between emails, the sending hours. Under them a
// LIVE PLAN line that the engine computes with its own rules (outreach-schedule.cjs livePlan via esb:outreach-plan,
// with the unsaved values), so what it says is what will happen — and it warns when the settings hold each other
// back (100 a day but only 6 fit in the hours; most contacts in four organisations). Everything else that touches the
// pace is under Advanced, each with one line saying what it does to it. The Sender dialog keeps only the account.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useEngineStore } from './engineStore'
import { engineClient } from './engineClient'
import { ask, useOutreachUi } from './outreachUi'
import { useDesk } from './outreachStore'
import { eligible } from './campaign'
import { Dialog, Field, Switch, Seg } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { fmtWallClock, useClockFormat } from '../ui/time'
import { fmtGapRange, parseDomainOverrides, planLine, warningText } from './activityFormat'
import type { AutopilotSettings, LivePlan } from '../esb'

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

const domainOf = (email: string) => {
  const at = email.lastIndexOf('@')
  return at >= 0 ? email.slice(at + 1).trim().toLowerCase() : ''
}

/** The form starts from the engine's saved settings — never from defaults that a Save would then write over them. */
export function AutopilotDialog({ onClose }: { onClose?: () => void }) {
  const initial = useEngineStore((x) => x.settings)
  const ui = useOutreachUi()
  useEffect(() => {
    if (!initial) void engineClient.settings()
  }, [initial])
  if (!initial) {
    return (
      <Dialog title="Sending settings" kicker="OUTREACH" width={640} onClose={() => (onClose ? onClose() : ui.set({ sheet: null }))}>
        <p className="or-muted">Reading the saved settings…</p>
      </Dialog>
    )
  }
  return <SendingForm initial={initial} onClose={onClose} />
}

function SendingForm({ initial, onClose }: { initial: AutopilotSettings; onClose?: () => void }) {
  useClockFormat()
  const ui = useOutreachUi()
  const desk = useDesk()
  const camp = desk.campaign()

  const [winEnabled, setWinEnabled] = useState(initial?.window?.enabled ?? true)
  const [days, setDays] = useState<number[]>(initial?.window?.days ?? [0, 1, 2, 3, 4])
  const [fromTime, setFromTime] = useState(initial?.window?.from ?? '09:00')
  const [toTime, setToTime] = useState(initial?.window?.to ?? '17:00')
  const [tz, setTz] = useState(initial?.window?.tz ?? 'Asia/Dhaka')
  const [customTz, setCustomTz] = useState('')
  const [isOtherTz, setIsOtherTz] = useState(!TIMEZONES.some((x) => x.value === (initial?.window?.tz ?? 'Asia/Dhaka')))

  const [minMin, setMinMin] = useState(Math.round(((initial?.minDelaySec ?? 180) / 60) * 10) / 10)
  const [maxMin, setMaxMin] = useState(Math.round(((initial?.maxDelaySec ?? 480) / 60) * 10) / 10)
  const [dailyLimit, setDailyLimit] = useState(initial?.dailyLimit ?? 100)
  const [warmupRamp, setWarmupRamp] = useState(initial?.ramp ?? true)
  const [domainMax, setDomainMax] = useState(initial?.domainMaxPerDay ?? 3)
  const [domainGapMin, setDomainGapMin] = useState(Math.round((initial?.domainMinGapSec ?? 1200) / 60))
  // per-organisation exceptions, edited as "domain = N" lines
  const [overridesText, setOverridesText] = useState(() => Object.entries(initial?.domainOverrides ?? {}).map(([d, n]) => `${d} = ${n}`).join('\n'))
  const overrides = useMemo(() => parseDomainOverrides(overridesText), [overridesText])
  const [cooldownDays, setCooldownDays] = useState(initial?.contactCooldownDays ?? 30)
  const [traySending, setTraySending] = useState(initial?.traySending ?? true)
  const [autonomy, setAutonomy] = useState<'suggest' | 'confirm' | 'auto-safe'>(initial?.aiAutonomy ?? 'suggest')
  const [readReplies, setReadReplies] = useState(initial?.aiReadsReply ?? false)
  const [advanced, setAdvanced] = useState(false)

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

  // what would be saved — also what the live plan is computed from
  const patch: Partial<AutopilotSettings> = useMemo(() => ({
    window: { enabled: winEnabled, days, from: fromTime, to: toTime, tz: effectiveTz || 'Asia/Dhaka' },
    pace: 'manual' as const,
    minDelaySec: Math.round(Number(minMin) * 60),
    maxDelaySec: Math.round(Number(maxMin) * 60),
    dailyLimit: Math.round(Number(dailyLimit)),
    ramp: warmupRamp,
    domainMaxPerDay: Math.max(1, Math.min(50, Number(domainMax) || 3)),
    domainOverrides: overrides.map,
    // 0 is a real choice (no spacing per organisation) — `|| 20` turned it back into 20
    domainMinGapSec: Math.max(0, Math.min(240, Number.isFinite(Number(domainGapMin)) ? Math.round(Number(domainGapMin)) : 20)) * 60,
    contactCooldownDays: Math.max(7, Math.min(365, Number(cooldownDays) || 30)),
    traySending,
    aiAutonomy: autonomy,
    aiReadsReply: readReplies,
  }), [winEnabled, days, fromTime, toTime, effectiveTz, minMin, maxMin, dailyLimit, warmupRamp, domainMax, domainGapMin, overrides, cooldownDays, traySending, autonomy, readReplies])

  // the open campaign's queue: how many are left and in which organisations (the per-organisation limit)
  const queue = useMemo(() => (camp ? eligible(desk.contacts, camp.subject, camp.body, camp.audience) : []), [camp, desk.contacts])
  const domains = useMemo(() => queue.map((c) => domainOf(c.email || '')), [queue])

  // the live plan, from the engine (debounced; an answer older than the newest request is dropped)
  const [plan, setPlan] = useState<LivePlan | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)
  const seq = useRef(0)
  // "next email in about 3 min" is re-worded against the clock every 30 s
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    const my = ++seq.current
    const timer = setTimeout(() => {
      void engineClient.plan({ count: queue.length, domains: queue.length ? domains : undefined, draft: patch }).then((p) => {
        if (my !== seq.current) return
        setPlan(p?.live ?? null)
        setPlanError(p?.error ?? null)
      }).catch(() => { if (my === seq.current) setPlan(null) })
    }, 150)
    return () => clearTimeout(timer)
  }, [patch, queue.length, domains])

  const save = async () => {
    setError(null)
    if (isOtherTz && !validateTz(customTz.trim())) {
      setError(`"${customTz}" is not a valid IANA time zone name.`)
      return
    }
    if (winEnabled && fromTime >= toTime) {
      setError('Sending hours: “to” must be after “from”.')
      return
    }
    const { minDelaySec = 0, maxDelaySec = 0, dailyLimit: limit = 0 } = patch
    if (!(minDelaySec >= 30 && minDelaySec <= 3600)) {
      setError('The shortest gap must be between 0.5 and 60 minutes.')
      return
    }
    if (!(maxDelaySec >= minDelaySec && maxDelaySec <= 3600)) {
      setError('The longest gap must be at least the shortest and at most 60 minutes.')
      return
    }
    if (!(limit >= 10 && limit <= 500)) {
      setError('Emails per day must be between 10 and 500.')
      return
    }
    setSaving(true)
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
        title: 'Restore the default sending settings?',
        body: 'Emails per day, gaps, sending hours and the advanced options go back to their original values. Nothing is saved until you press Save.',
        ok: 'Restore defaults',
      })
    ) {
      setWinEnabled(true)
      setDays([0, 1, 2, 3, 4])
      setFromTime('09:00')
      setToTime('17:00')
      setTz('Asia/Dhaka')
      setIsOtherTz(false)
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

  const live = plan ? { ...plan, now: Math.max(plan.now, nowTick) } : null

  return (
    <Dialog
      title="Sending settings"
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
      <div className="stack or-sending" style={{ gap: 14 }}>
        {error && (
          <div className="callout bad" role="alert">
            <span>{error}</span>
          </div>
        )}

        <section className="or-dialog-section or-pace" aria-label="Pace">
          <div className="or-pace-grid">
            <Field label="Emails per day">
              <input className="input" type="number" min={10} max={500} value={dailyLimit} onChange={(e) => setDailyLimit(Number(e.target.value))} data-testid="or-daily" />
            </Field>
            <Field label="Gap between emails (min)">
              <div className="or-range">
                <input className="input" type="number" min={0.5} max={60} step={0.5} value={minMin} onChange={(e) => setMinMin(Number(e.target.value))} aria-label="Shortest gap (min)" data-testid="or-gap-min" />
                <span aria-hidden>–</span>
                <input className="input" type="number" min={0.5} max={60} step={0.5} value={maxMin} onChange={(e) => setMaxMin(Number(e.target.value))} aria-label="Longest gap (min)" data-testid="or-gap-max" />
              </div>
            </Field>
          </div>
          <p className="or-muted or-pace-note">
            A new day starts at midnight ({(effectiveTz || 'Asia/Dhaka').split('/').pop()?.replace(/_/g, ' ')} time). Each email waits a random {fmtGapRange(patch.minDelaySec, patch.maxDelaySec) || '–'} after the one before.
          </p>

          <div className="or-hours">
            <Switch checked={winEnabled} onChange={setWinEnabled} label="Only send during sending hours" />
            {winEnabled && (
              <div className="or-hours-row">
                <input type="time" className="input" value={fromTime} onChange={(e) => setFromTime(e.target.value)} aria-label="From" />
                <span aria-hidden>to</span>
                <input type="time" className="input" value={toTime} onChange={(e) => setToTime(e.target.value)} aria-label="To" />
                <div className="or-days" role="group" aria-label="Days">
                  {DOW.map(({ day, label }) => {
                    const active = days.includes(day)
                    return (
                      <button key={day} type="button" className={`btn xs ${active ? 'primary' : ''}`} onClick={() => toggleDay(day)} aria-pressed={active}>
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            {winEnabled && (
              <div className="or-tz-row">
                <select
                  className="input"
                  aria-label="Time zone"
                  value={isOtherTz ? 'other' : tz}
                  onChange={(e) => {
                    if (e.target.value === 'other') setIsOtherTz(true)
                    else {
                      setIsOtherTz(false)
                      setTz(e.target.value)
                    }
                  }}
                >
                  {TIMEZONES.map((x) => (
                    <option key={x.value} value={x.value}>{x.label}</option>
                  ))}
                  <option value="other">Other</option>
                </select>
                {isOtherTz && <input type="text" className="input" placeholder="e.g. Europe/Berlin" value={customTz} onChange={(e) => setCustomTz(e.target.value)} aria-label="Other time zone" />}
              </div>
            )}
          </div>

          <div className="or-plan" role="status" aria-live="polite" data-testid="or-plan">
            <span className="or-plan-ic" aria-hidden><Icon name="clock" size={14} /></span>
            <div className="or-plan-body">
              {live ? <p className="or-plan-line" data-testid="or-plan-line">{planLine(live, { campaign: !!camp })}</p> : <p className="or-plan-line or-muted">{window.esb?.outreachPlan ? 'Working out the plan…' : 'The plan needs the desktop app.'}</p>}
              {planError && <p className="or-plan-warn bad">{planError}</p>}
              {live?.warnings.map((w, i) => (
                <p key={i} className={'or-plan-warn' + (w.kind === 'anyHour' || w.kind === 'ramp' ? ' soft' : '')} data-testid={`or-plan-warn-${w.kind}`}>
                  <Icon name="info" size={12} />
                  <span>{warningText(w)}</span>
                </p>
              ))}
            </div>
          </div>
        </section>

        <section className={'or-dialog-section or-advanced' + (advanced ? ' open' : '')}>
          <button type="button" className="or-adv-toggle" aria-expanded={advanced} onClick={() => setAdvanced((v) => !v)} data-testid="or-advanced">
            <Icon name={advanced ? 'chevDown' : 'chevRight'} size={14} />
            <span>Advanced</span>
            {!advanced && <span className="or-adv-sum">{`${patch.domainMaxPerDay} a day per organisation, ${domainGapMin} min apart · cooldown ${patch.contactCooldownDays} days · warm-up ${warmupRamp ? 'on' : 'off'} · tray ${traySending ? 'on' : 'off'}`}</span>}
          </button>
          {advanced && (
            <div className="or-adv-body">
              <div className="or-adv-row">
                <div className="or-adv-ctl">
                  <span>At most</span>
                  <input type="number" className="input" min={1} max={50} value={domainMax} onChange={(e) => setDomainMax(Number(e.target.value))} aria-label="Emails a day per organisation" />
                  <span>a day per organisation,</span>
                  <input type="number" className="input" min={0} max={240} value={domainGapMin} onChange={(e) => setDomainGapMin(Number(e.target.value))} aria-label="Minutes between emails to one organisation" />
                  <span>min apart</span>
                </div>
                <p className="or-adv-why">Keeps one office from getting several emails in a row. Slows the pace when many remaining contacts share an organisation (the plan above shows how much).</p>
              </div>
              <div className="or-adv-row">
                <label className="or-adv-ctl" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  <span>Exceptions per organisation (one per line, <code>domain = emails a day</code>)</span>
                  <textarea className="input" rows={3} value={overridesText} onChange={(e) => setOverridesText(e.target.value)} placeholder="bpdb.gov.bd = 10" aria-label="Per-organisation daily limits" spellCheck={false} />
                </label>
                <p className="or-adv-why">{overrides.bad.length ? `Not understood: ${overrides.bad.slice(0, 3).join(', ')} — write “domain = number” (1–500).` : 'A large organisation with many separate offices can take more a day than the default; a sensitive one fewer.'}</p>
              </div>
              <div className="or-adv-row">
                <div className="or-adv-ctl">
                  <span>Don’t write to the same person again within</span>
                  <input type="number" className="input" min={7} max={365} value={cooldownDays} onChange={(e) => setCooldownDays(Number(e.target.value))} aria-label="Contact cooldown (days)" />
                  <span>days</span>
                </div>
                <p className="or-adv-why">Skips anyone who got a first letter recently. Does not change the pace; it takes people out of the queue.</p>
              </div>
              <div className="or-adv-row">
                <Switch checked={warmupRamp} onChange={setWarmupRamp} label="Start slowly (warm-up)" />
                <p className="or-adv-why">For a new address: the first sending days allow 30, 50, 70… emails until your daily number is reached. Lowers today’s limit while it lasts.</p>
              </div>
              <div className="or-adv-row">
                <Switch checked={traySending} onChange={setTraySending} label="Keep sending from the tray when I close the window" />
                <p className="or-adv-why">Off: closing the window pauses sending until the app is open again.</p>
              </div>
              <div className="or-adv-row">
                <span className="or-adv-label">Assistant</span>
                <Seg<'suggest' | 'confirm' | 'auto-safe'>
                  value={autonomy}
                  onChange={setAutonomy}
                  options={[
                    { value: 'suggest', label: 'Suggest only' },
                    { value: 'confirm', label: 'Ask me first' },
                    { value: 'auto-safe', label: 'Do safe things' },
                  ]}
                />
                <Switch checked={readReplies} onChange={setReadReplies} label="Let the assistant read replies to sort them" />
                <p className="or-adv-why">The assistant never changes the pace. Reply text goes to your AI provider only when reading replies is on.</p>
              </div>
            </div>
          )}
        </section>

        <p className="or-muted or-sending-foot">
          Changes apply from the next email, also to a batch that is waiting. Hours shown as {fmtWallClock(fromTime)}–{fmtWallClock(toTime)}.
        </p>
      </div>
    </Dialog>
  )
}

