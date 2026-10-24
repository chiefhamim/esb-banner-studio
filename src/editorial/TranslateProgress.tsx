// The desk's activity: a clock chip in the header and, under it, the history of timed jobs — story translation, SEO and
// social captions — each with the provider and model that did it, the steps it went through and the time each step took,
// so the editor can see exactly what is slow. Story jobs are fed by the status text the desk already emits; SEO and
// social jobs report their own steps (aiDesk.ts). The history stays until the editor clears it.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../ui/Icon'
import { useEditorialStore } from './editorialStore'
import { modelLabel, providerMeta } from './aiProviders'
import type { AiProviderId } from './aiProviders'
import { useJobLog } from './jobLog'
import type { Job, JobKind } from './jobLog'

const fmt = (ms: number) => (ms < 10_000 ? (ms / 1000).toFixed(1) : String(Math.round(ms / 1000))) + ' s'
const storyJob = (first: string): { kind: JobKind; title: string } =>
  /upload/i.test(first) ? { kind: 'publish', title: 'Publishing' } : /re-translat/i.test(first) ? { kind: 'story', title: 'Re-translation' } : { kind: 'story', title: 'Story translation' }
// the strip beside the header's tools: the latest job of each kind, with its model and time
const SLOTS: { kind: JobKind; label: string }[] = [{ kind: 'story', label: 'Story' }, { kind: 'seo', label: 'SEO' }, { kind: 'social', label: 'Social' }, { kind: 'publish', label: 'Publish' }]
/** "Claude · claude-sonnet-5-5" → "Sonnet 5.5"; a job with no model ("Machine translation") shows what it has. */
const modelOf = (by: string) => { const i = by.indexOf(' · '); return i < 0 ? by : modelLabel(by.slice(i + 3)) }
const isAiProvider = (p: string | null): p is AiProviderId => !!p && p !== 'neural' && p !== 'offline'

export function TranslateProgress({ status }: { status: string | null }) {
  const jobs = useJobLog((s) => s.jobs)
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [, tick] = useState(0)
  const chipRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const storyId = useRef<number | null>(null)
  const [at, setAt] = useState<{ top: number; right: number } | null>(null)

  // the desk's status text drives the story job: a new text closes the previous step and opens the next; null finishes it
  useEffect(() => {
    const log = useJobLog.getState()
    const live = storyId.current != null && log.jobs.some((j) => j.id === storyId.current && !j.end)
    if (status) {
      if (live) log.step(storyId.current!, status)
      else { const j = storyJob(status); storyId.current = log.begin(j.kind, j.title, status) }
    } else if (live) {
      const st = useEditorialStore.getState()
      const job = log.jobs.find((j) => j.id === storyId.current)
      const by = job?.kind === 'story' ? (isAiProvider(st.translationProvider) ? `${providerMeta(st.translationProvider).name}${st.modelUsed ? ` · ${st.modelUsed}` : ''}` : 'Machine translation') : ''
      log.finish(storyId.current!, { by })
      storyId.current = null
    }
  }, [status])

  // a job that starts opens the panel on itself; the editor closes it with Esc, a click elsewhere, or the chip
  const newest = jobs[0]?.id
  const seen = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (newest == null || newest === seen.current) return
    seen.current = newest
    setOpen(true)
    setExpanded(new Set([newest]))
  }, [newest])

  const running = jobs.some((j) => !j.end)
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => tick((n) => n + 1), 200)
    return () => clearInterval(id)
  }, [running])

  // the panel floats above the whole window (portal + fixed), anchored under the chip, so no column can cover or clip it
  useLayoutEffect(() => {
    if (!open || !jobs.length) return
    const place = () => { const r = chipRef.current?.getBoundingClientRect(); if (r) setAt({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) }) }
    place(); window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, jobs.length])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!popRef.current?.contains(t) && !chipRef.current?.contains(t)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown) }
  }, [open])

  if (!jobs.length) return null
  const now = Date.now()
  const live = jobs.find((j) => !j.end)
  const newestId = (live ?? jobs[0]).id
  const total = (j: Job) => (j.end ?? now) - j.start
  const toggle = (id: number) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <div ref={chipRef} className={'ed-topbar-progress ed-tp'} role="group" aria-label="Task times">
      {SLOTS.map(({ kind, label }) => {
        const j = jobs.find((x) => x.kind === kind)
        if (!j) return null
        const isLive = !j.end
        const model = modelOf(j.by)
        return (
          <button key={kind} type="button" className={'ed-tp-item ' + kind + (j.id === newestId ? ' latest' : '') + (isLive ? ' live' : j.error ? ' bad' : ' ok')}
            onClick={() => setOpen((o) => !o)} aria-expanded={open} data-tip={`${j.title}${j.by ? ' · ' + j.by : ''} — ${isLive ? 'running' : j.error ? 'failed' : 'done'} in ${fmt(total(j))}. Click for the history`}>
            {isLive ? <span className="pulse-dot" /> : <Icon name={j.error ? 'info' : 'check'} size={12} />}
            <span className="ed-tp-kind">{label}</span>
            {model && <span className="ed-tp-model">{model}</span>}
            <span className="ed-tp-time mono">{fmt(total(j))}</span>
          </button>
        )
      })}
      {open && at && createPortal(
        <div ref={popRef} className="ed-tp-pop" role="status" aria-live="polite" style={{ top: at.top, right: at.right }}>
          <div className="ed-tp-head">
            <b>Activity</b>
            <span className="hint">{jobs.length} {jobs.length === 1 ? 'job' : 'jobs'}</span>
            <div className="spacer" />
            {jobs.some((j) => j.end) && <button type="button" className="btn-link" onClick={() => useJobLog.getState().clear()}>Clear history</button>}
          </div>
          <div className="ed-tp-jobs">
            {jobs.map((j) => {
              const isLive = !j.end
              const slowest = j.steps.reduce((m, s) => Math.max(m, (s.end ?? now) - s.start), 0)
              const isOpen = expanded.has(j.id)
              return (
                <section key={j.id} className={'ed-tp-job ' + j.kind + (isLive ? ' live' : j.error ? ' bad' : ' ok')}>
                  <button type="button" className="ed-tp-job-head" onClick={() => toggle(j.id)} aria-expanded={isOpen}>
                    <span className="ed-tp-mark">{isLive ? <span className="pulse-dot" /> : <Icon name={j.error ? 'info' : 'check'} size={12} />}</span>
                    <span className="ed-tp-job-title"><b>{j.title}</b>{j.by && <span className="ed-tp-by">{j.by}</span>}</span>
                    <span className="ed-tp-ms mono">{fmt(total(j))}</span>
                    <Icon name="chevDown" size={12} className={'ed-tp-chev' + (isOpen ? ' open' : '')} />
                  </button>
                  {j.error && <p className="ed-tp-err">{j.error}</p>}
                  {isOpen && (
                    <ol className="ed-tp-steps">
                      {j.steps.map((s, i) => {
                        const ms = (s.end ?? now) - s.start
                        const stepLive = !s.end
                        return (
                          <li key={i} className={(stepLive ? 'live ' : 'ok ') + (!stepLive && ms === slowest && j.steps.length > 1 ? 'slow' : '')}>
                            <span className="ed-tp-mark">{stepLive ? <span className="pulse-dot" /> : <Icon name="check" size={11} />}</span>
                            <span className="ed-tp-step">{s.label}</span>
                            <span className="ed-tp-ms mono">{fmt(ms)}</span>
                          </li>
                        )
                      })}
                    </ol>
                  )}
                </section>
              )
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
