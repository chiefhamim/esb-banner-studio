// The footer's Engine entry. Closed, it is one short word — Working / Checking / needs attention — because the detail
// lives in the panel it opens: the three AI jobs (Main · SEO · Social), the company each one uses (changeable right
// there), and — from one tiny real request per distinct key — whether it works now and how long it took.
// Results are kept by provider + key + model, so a setting that did not change is not re-tested, and three jobs on
// one provider cost one request.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { Icon } from '../ui/Icon'
import { Select } from '../ui/controls'
import { AI_PROVIDERS, aiFor, modelLabel, providerMeta, roleProvider, testAiKey, useAiUsage, usageTotals } from './aiProviders'
import type { AiProviderId, AiRole, AiSettings } from './aiProviders'
import { useEditorialStore } from './editorialStore'
import { fmtDuration } from './jobLog'

type Check = { state: 'busy' } | { state: 'ok'; ms: number; model: string } | { state: 'bad'; error: string }
type Active = { provider: AiProviderId; key: string; model: string }
const ROLES: { role: AiRole; label: string }[] = [{ role: 'main', label: 'Main' }, { role: 'seo', label: 'SEO' }, { role: 'social', label: 'Social' }, { role: 'outreach', label: 'Letter' }, { role: 'research', label: 'Research' }, { role: 'review', label: 'Review' }]

/** Health of each distinct (provider, key, model) — shared by the footer word and the panel. */
const useHealth = create<{ byKey: Record<string, Check>; set: (k: string, c: Check) => void }>((set) => ({
  byKey: {},
  set: (k, c) => set((s) => ({ byKey: { ...s.byKey, [k]: c } })),
}))

const sig = (a: Active) => `${a.provider}|${a.model}|${a.key.length}:${a.key.slice(-6)}`

async function check(a: Active) {
  const k = sig(a)
  const h = useHealth.getState()
  if (h.byKey[k]?.state === 'busy') return
  h.set(k, { state: 'busy' })
  const t0 = performance.now()
  const r = await testAiKey(a.provider, a.key, a.model)
  useHealth.getState().set(k, r.ok ? { state: 'ok', ms: Math.round(performance.now() - t0), model: r.model ?? a.model } : { state: 'bad', error: r.error ?? 'It did not answer.' })
}

const fmt = fmtDuration

/** `roles` = the jobs this desk runs (Editorial: Main · SEO · Social; Outreach: Letter · Research · Review). */
export function EngineStatus({ ai, offline, onAddKey, roles = ['main', 'seo', 'social'] }: { ai: AiSettings; offline: boolean; onAddKey: () => void; roles?: AiRole[] }) {
  const setAiSettings = useEditorialStore((s) => s.setAiSettings)
  const setAiPaused = useEditorialStore((s) => s.setAiPaused)
  const byKey = useHealth((s) => s.byKey)
  const usageCalls = useAiUsage((s) => s.calls)
  const usage = usageTotals(usageCalls)
  const k = (n: number) => (n >= 10_000 ? Math.round(n / 1000) + 'k' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n))
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState<{ bottom: number; left: number } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)

  const roleKey = roles.join(',')
  const rows = useMemo(() => ROLES.filter((r) => roleKey.split(',').includes(r.role)).map((r) => ({ ...r, chosen: roleProvider(ai, r.role), a: aiFor(r.role, ai) })), [ai, roleKey])
  const distinct = useMemo(() => {
    const m = new Map<string, Active>()
    for (const r of rows) if (r.a) m.set(sig(r.a), r.a)
    return [...m.values()]
  }, [rows])

  // a new or changed key/model is tested as soon as it is set; an unchanged one is not tested again
  useEffect(() => { for (const a of distinct) if (!useHealth.getState().byKey[sig(a)]) void check(a) }, [distinct])

  const refresh = useCallback((only?: Active) => { for (const a of only ? [only] : distinct) void check(a) }, [distinct])

  useLayoutEffect(() => {
    if (!open) return
    const place = () => { const r = btn.current?.getBoundingClientRect(); if (r) setAt({ bottom: window.innerHeight - r.top + 8, left: Math.max(8, Math.min(r.left, window.innerWidth - 620)) }) }
    place(); window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onDown = (e: PointerEvent) => { const t = e.target as Node; if (!pop.current?.contains(t) && !btn.current?.contains(t) && !(t as Element).closest?.('.popover')) setOpen(false) }
    window.addEventListener('keydown', onKey); window.addEventListener('pointerdown', onDown)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown) }
  }, [open])

  const stateOf = (a: Active | null): Check | null => (a ? byKey[sig(a)] ?? null : null)
  const busy = distinct.some((a) => { const s = byKey[sig(a)]; return !s || s.state === 'busy' })
  const bad = rows.filter((r) => stateOf(r.a)?.state === 'bad').length
  const noKey = rows.filter((r) => !r.a).length
  const summary = ai.paused ? { cls: 'off', text: 'AI OFF' }
    : offline ? { cls: 'bad', text: 'Offline' }
    : !distinct.length ? { cls: 'free', text: roles.includes('main') ? 'Free translation' : 'No AI key' }
    : busy ? { cls: 'busy', text: 'Checking…' }
    : bad ? { cls: 'bad', text: `${bad} of ${rows.length} need attention` }
    : noKey ? { cls: 'warn', text: `Working · ${noKey} on free` }
    : { cls: 'ok', text: 'Working' }

  const setRole = (role: AiRole, v: string) => {
    setAiSettings(role === 'main' ? { ...ai, provider: v as AiProviderId } : { ...ai, [role]: v as AiProviderId | '' })
  }

  return (
    <>
      <button ref={btn} type="button" className={'sb-engine-btn ' + summary.cls + (open ? ' on' : '')} onClick={() => setOpen((o) => !o)} aria-expanded={open} data-tip="AI engines — see, test and change the company behind each job">
        <span className="sb-k">Engine</span>
        <span className="sb-eng-state"><i className="sb-dot" aria-hidden />{summary.text}</span>
        <Icon name="chevUp" size={12} className="sb-engine-chev" />
      </button>
      {open && at && createPortal(
        <div ref={pop} className="eng-pop" role="dialog" aria-label="AI engines" style={{ bottom: at.bottom, left: at.left }}>
          <div className="eng-head">
            <span className="eng-head-ic"><Icon name="chip" size={16} /></span>
            <div className="eng-head-t"><b>AI engines</b><span>{busy ? 'Checking each key…' : 'Each key is tested with one tiny request'}</span></div>
            <button type="button" className="btn sm" onClick={() => refresh()} disabled={ai.paused || busy || !distinct.length}><Icon name="refresh" size={13} /><span>Refresh all</span></button>
            <button type="button" role="switch" aria-checked={!ai.paused} className={'eng-power' + (ai.paused ? '' : ' on')} onClick={() => setAiPaused(!ai.paused)} data-tip={ai.paused ? 'Turn AI ON' : 'Turn AI OFF: nothing is sent to any AI company'}><Icon name="power" size={13} /><span>{ai.paused ? 'OFF' : 'ON'}</span></button>
          </div>
          {ai.paused && <p className="eng-off"><Icon name="power" size={13} /><span>AI is OFF. Nothing is sent to Gemini, Claude, OpenAI or OpenRouter, not even the check when the app starts. Translation uses the free service until you turn it on.</span></p>}
          <div className="eng-cols" aria-hidden><span>Job</span><span>Company</span><span>Model</span><span className="c">Status</span><span /></div>
          {rows.map(({ role, label, chosen, a }) => {
            const c = stateOf(a)
            return (
              <div key={role} className={'eng-row ' + (a ? c?.state ?? 'busy' : 'free')}>
                <span className="eng-role">{label}</span>
                <Select<string> className="eng-select" value={role === 'main' ? ai.provider : ai[role]} title={`${label} company`} onChange={(v) => setRole(role, v)}
                  options={[
                    ...(role !== 'main' ? [{ value: '', label: 'Same as main', hint: providerMeta(ai.provider).name }] : []),
                    ...AI_PROVIDERS.map((p) => ({ value: p.id as string, label: p.name, swatch: p.color, hint: ai.keys[p.id]?.trim() ? '' : 'no key' })),
                  ]} />
                <span className="eng-model" data-provider={chosen}>
                  {ai.paused ? <span className="eng-nokey">{providerMeta(chosen).name} · paused</span> : a ? <><i className="sb-pdot" aria-hidden /><span>{providerMeta(chosen).name} · {c?.state === 'ok' ? modelLabel(c.model) : ai.models[chosen] === 'auto' ? 'Auto' : modelLabel(ai.models[chosen])}</span></> : <span className="eng-nokey">No {providerMeta(chosen).name} key</span>}
                </span>
                <div className="eng-state">
                  {ai.paused && <span className="eng-tag off"><Icon name="power" size={11} />OFF</span>}
                  {!ai.paused && !a && <button type="button" className="btn xs" onClick={() => { setOpen(false); onAddKey() }}>Add key</button>}
                  {!ai.paused && a && (!c || c.state === 'busy') && <span className="eng-tag busy"><span className="pulse-dot" />Checking</span>}
                  {!ai.paused && a && c?.state === 'ok' && <span className="eng-tag ok"><Icon name="check" size={11} />Working · {fmt(c.ms)}</span>}
                  {!ai.paused && a && c?.state === 'bad' && <span className="eng-tag bad"><Icon name="info" size={11} />Failed</span>}
                </div>
                <button type="button" className="ibtn" aria-label={`Check ${label} again`} data-tip="Check again" disabled={ai.paused || !a || c?.state === 'busy'} onClick={() => a && refresh(a)}><Icon name="refresh" size={13} /></button>
                {!ai.paused && a && c?.state === 'bad' && <p className="eng-err">{c.error}</p>}
              </div>
            )
          })}
          <div className="eng-usage" aria-label="Tokens used this session">
            <span className="eng-usage-k">This session</span>
            {usage.calls ? (
              <span className="eng-usage-v">{usage.calls} {usage.calls === 1 ? 'call' : 'calls'} · {k(usage.prompt)} in{usage.cacheRead ? ` (${k(usage.cacheRead)} from cache, ${Math.round(usage.hitRate * 100)}%)` : ''} · {k(usage.output)} out</span>
            ) : <span className="eng-usage-v">no calls yet</span>}
          </div>
          <p className="hint eng-foot">Keys and models are set from the AI button in the header.</p>
        </div>,
        document.body,
      )}
    </>
  )
}
