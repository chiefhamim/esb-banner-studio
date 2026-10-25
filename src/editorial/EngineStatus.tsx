// The footer's Engine entry: one button that opens a small panel with the three AI jobs (Main · SEO · Social), the
// provider and model each is set to, and — by actually making one tiny call with that key — whether it works right
// now and how long it took. Refresh checks one row or all of them. A job with no key shows the free machine service.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../ui/Icon'
import { aiFor, modelLabel, providerMeta, testAiKey } from './aiProviders'
import type { AiRole, AiSettings } from './aiProviders'

type Check = { state: 'idle' } | { state: 'busy' } | { state: 'ok'; ms: number; model: string } | { state: 'bad'; error: string }
const ROLES: { role: AiRole; label: string }[] = [{ role: 'main', label: 'Main' }, { role: 'seo', label: 'SEO' }, { role: 'social', label: 'Social' }]

export function EngineStatus({ ai, offline }: { ai: AiSettings; offline: boolean }) {
  const [open, setOpen] = useState(false)
  const [res, setRes] = useState<Record<AiRole, Check>>({ main: { state: 'idle' }, seo: { state: 'idle' }, social: { state: 'idle' } })
  const [at, setAt] = useState<{ bottom: number; left: number } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)

  const rows = ROLES.map((r) => ({ ...r, a: aiFor(r.role, ai) }))

  const run = useCallback(async (role: AiRole) => {
    const a = aiFor(role, ai)
    if (!a) return
    setRes((s) => ({ ...s, [role]: { state: 'busy' } }))
    const t0 = performance.now()
    const r = await testAiKey(a.provider, a.key, a.model)
    setRes((s) => ({ ...s, [role]: r.ok ? { state: 'ok', ms: Math.round(performance.now() - t0), model: r.model ?? a.model } : { state: 'bad', error: r.error ?? 'It did not answer.' } }))
  }, [ai])

  const runAll = useCallback(() => { for (const r of ROLES) void run(r.role) }, [run])

  // opening the panel checks every key that is set
  useEffect(() => { if (open) runAll() }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!open) return
    const place = () => { const r = btn.current?.getBoundingClientRect(); if (r) setAt({ bottom: window.innerHeight - r.top + 8, left: Math.max(8, Math.min(r.left, window.innerWidth - 440)) }) }
    place(); window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onDown = (e: PointerEvent) => { const t = e.target as Node; if (!pop.current?.contains(t) && !btn.current?.contains(t)) setOpen(false) }
    window.addEventListener('keydown', onKey); window.addEventListener('pointerdown', onDown)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown) }
  }, [open])

  const anyBad = rows.some((r) => res[r.role].state === 'bad')
  const busy = rows.some((r) => res[r.role].state === 'busy')

  return (
    <>
      <button ref={btn} type="button" className={'sb-engine-btn' + (open ? ' on' : '')} onClick={() => setOpen((o) => !o)} aria-expanded={open} data-tip="AI engines — check that each one is connected and working">
        <span className="sb-k">Engine</span>
        {offline ? (
          <b>Offline — manual translation needed</b>
        ) : (
          rows.map(({ role, label, a }, i) => (
            <span key={role} className="sb-role">
              {i > 0 && <i className="sb-chev" aria-hidden>›</i>}
              <span className="sb-rname">{label}</span>
              {a ? <b data-provider={a.provider}><i className="sb-pdot" aria-hidden />{providerMeta(a.provider).name} · {a.model === 'auto' ? 'Auto' : modelLabel(a.model)}</b> : <b className="free">Neural GTX</b>}
            </span>
          ))
        )}
        <Icon name="chevUp" size={12} className="sb-engine-chev" />
      </button>
      {open && at && createPortal(
        <div ref={pop} className="eng-pop" role="dialog" aria-label="AI engines" style={{ bottom: at.bottom, left: at.left }}>
          <div className="eng-head">
            <b>AI engines</b>
            <span className="hint">{busy ? 'Checking…' : anyBad ? 'A key needs attention' : 'Each key is tested with one tiny request'}</span>
            <div className="spacer" />
            <button type="button" className="btn xs" onClick={runAll} disabled={busy}><Icon name="refresh" size={12} /><span>Refresh all</span></button>
          </div>
          {rows.map(({ role, label, a }) => {
            const c = res[role]
            return (
              <div key={role} className={'eng-row ' + (a ? c.state : 'free')}>
                <span className="eng-role">{label}</span>
                <div className="eng-who">
                  {a ? (
                    <b data-provider={a.provider}><i className="sb-pdot" aria-hidden />{providerMeta(a.provider).name}</b>
                  ) : (
                    <b className="free">Neural GTX</b>
                  )}
                  <span className="eng-model">{a ? (c.state === 'ok' ? modelLabel(c.model) : a.model === 'auto' ? 'Auto' : modelLabel(a.model)) : 'free machine translation · no key set'}</span>
                </div>
                <div className="eng-state">
                  {!a && <span className="eng-tag">Free</span>}
                  {a && c.state === 'idle' && <span className="eng-tag">Not checked</span>}
                  {a && c.state === 'busy' && <span className="eng-tag busy"><span className="pulse-dot" />Checking</span>}
                  {a && c.state === 'ok' && <span className="eng-tag ok"><Icon name="check" size={11} />Working · {c.ms < 10_000 ? (c.ms / 1000).toFixed(1) : Math.round(c.ms / 1000)} s</span>}
                  {a && c.state === 'bad' && <span className="eng-tag bad"><Icon name="info" size={11} />Failed</span>}
                </div>
                <button type="button" className="ibtn" aria-label={`Check ${label} again`} data-tip="Check again" disabled={!a || c.state === 'busy'} onClick={() => void run(role)}><Icon name="refresh" size={13} /></button>
                {a && c.state === 'bad' && <p className="eng-err">{c.error}</p>}
              </div>
            )
          })}
          <p className="hint eng-foot">Change a provider, key or model from the AI button in the header.</p>
        </div>,
        document.body,
      )}
    </>
  )
}
