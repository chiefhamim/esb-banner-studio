// Renders: queue the sizes of the open video, watch each one, cancel, show it in its folder, publish it.
import { useEffect, useState } from 'react'
import { useVideoStore } from '../videoStore'
import { SIZE_ASPECTS } from '../sizes'
import { useRenderQueue, type QueueOutput } from './renderQueue'
import type { AspectRatio } from '../timeline'

interface RenderEntry { id: string; name: string; size: number; at: number; exists: boolean }
const esb = () => (window as unknown as { esb?: { vpubRenders?: () => Promise<{ renders?: RenderEntry[] }>; vpubRenderShow?: (id: string) => Promise<{ ok?: boolean; error?: string }> } }).esb
const mb = (n?: number) => (n ? `${(n / 1048576).toFixed(1)} MB` : '')

const STATUS: Record<QueueOutput['status'], string> = { queued: 'Waiting', running: 'Rendering', done: 'Done', failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted' }

export function PublishRenders({ onPublish }: { onPublish: (renderId: string) => void }) {
  const project = useVideoStore((s) => s.project)
  const jobs = useRenderQueue((s) => s.jobs)
  const enqueue = useRenderQueue((s) => s.enqueue)
  const cancel = useRenderQueue((s) => s.cancel)
  const remove = useRenderQueue((s) => s.remove)
  const clearFinished = useRenderQueue((s) => s.clearFinished)
  const [sizes, setSizes] = useState<Set<AspectRatio>>(() => new Set([project.aspect]))
  const [msg, setMsg] = useState('')
  const [renders, setRenders] = useState<RenderEntry[]>([])
  const [err, setErr] = useState('')

  const refresh = () => { void esb()?.vpubRenders?.().then((r) => setRenders(r?.renders ?? [])).catch(() => {}) }
  useEffect(refresh, [jobs])

  const toggle = (a: AspectRatio) => setSizes((s) => { const n = new Set(s); if (n.has(a)) n.delete(a); else n.add(a); return n })
  const add = () => {
    setMsg('')
    const r = enqueue(project, SIZE_ASPECTS.filter((a) => sizes.has(a)))
    if (r.refused) setMsg(r.refused)
    else setMsg(`${r.queued} render${r.queued === 1 ? '' : 's'} queued. They run one after another while you keep working.`)
  }
  const show = async (id?: string) => { if (!id) return; const r = await esb()?.vpubRenderShow?.(id); if (r && r.ok === false) setErr(r.error ?? 'Could not open the folder.') }

  const queuedIds = new Set(jobs.flatMap((j) => j.outputs.map((o) => o.renderId).filter(Boolean)))
  const older = renders.filter((r) => !queuedIds.has(r.id))

  return (
    <div className="vw-pub-renders">
      <section className="vw-sec" aria-label="Queue a render">
        <div className="vw-sec-head"><h4 className="vw-sec-title">Render sizes</h4></div>
        <p className="vw-hint">Renders the open video as it is now, in each shape you tick (each shape keeps its own crop; see All sizes in the Story tab). Files go to Pictures → ESB Banners → Video renders.</p>
        <div className="vw-size-row" role="group" aria-label="Sizes to render">
          {SIZE_ASPECTS.map((a) => (
            <label key={a} className={`vw-size${sizes.has(a) ? ' on' : ''}`}>
              <input type="checkbox" className="vw-visually-hidden" checked={sizes.has(a)} onChange={() => toggle(a)} />
              <b>{a}</b><span>{a === '16:9' ? 'YouTube, website' : a === '9:16' ? 'Shorts, Reels' : 'Facebook feed'}</span>
            </label>
          ))}
        </div>
        <div className="vw-transcript-actions">
          <button type="button" className="btn xs primary" onClick={add} disabled={!sizes.size}>Add to the queue</button>
          {jobs.some((j) => j.outputs.every((o) => o.status !== 'queued' && o.status !== 'running')) && <button type="button" className="btn xs" onClick={clearFinished}>Clear finished</button>}
        </div>
        {msg && <p className="vw-hint" role="status">{msg}</p>}
      </section>

      <section className="vw-sec" aria-label="Render queue">
        <div className="vw-sec-head"><h4 className="vw-sec-title">Queue</h4></div>
        {!jobs.length && <p className="vw-hint">Nothing queued.</p>}
        <ul className="vw-q-list">
          {jobs.map((j) => (
            <li key={j.id} className="vw-q-job">
              <div className="vw-q-head"><b>{j.name}</b><span className="vw-hint">{new Date(j.at).toLocaleString()}</span></div>
              {j.outputs.map((o) => (
                <div key={o.id} className={`vw-q-out st-${o.status}`}>
                  <div className="vw-q-line">
                    <span className="vw-q-aspect">{o.aspect}</span>
                    <span className="vw-q-status">{STATUS[o.status]}{o.status === 'running' ? ` ${o.progress}%` : o.size ? ` · ${mb(o.size)}` : ''}</span>
                    <span className="vw-q-actions">
                      {(o.status === 'queued' || o.status === 'running') && <button type="button" className="btn xs" onClick={() => cancel(o.id)}>Cancel</button>}
                      {o.status === 'done' && o.renderId && <>
                        <button type="button" className="btn xs" onClick={() => void show(o.renderId)}>Show in folder</button>
                        <button type="button" className="btn xs primary" onClick={() => onPublish(o.renderId!)}>Publish…</button>
                      </>}
                    </span>
                  </div>
                  {o.status === 'running' && <div className="vw-q-bar" role="progressbar" aria-valuenow={o.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${o.aspect} render progress`}><i style={{ width: `${o.progress}%` }} /></div>}
                  {o.error && <p className="vw-hint vw-error" role="alert">{o.error}</p>}
                </div>
              ))}
              {j.outputs.every((o) => o.status !== 'queued' && o.status !== 'running') && <div className="vw-transcript-actions"><button type="button" className="btn xs" onClick={() => remove(j.id)}>Remove from the list</button></div>}
            </li>
          ))}
        </ul>
        {err && <p className="vw-hint vw-error" role="alert">{err}</p>}
      </section>

      {older.length > 0 && (
        <section className="vw-sec" aria-label="Earlier renders">
          <div className="vw-sec-head"><h4 className="vw-sec-title">Earlier renders</h4></div>
          <ul className="vw-q-list">
            {older.slice(0, 12).map((r) => (
              <li key={r.id} className="vw-q-out">
                <div className="vw-q-line">
                  <span className="vw-q-aspect" title={r.name}>{r.name}</span>
                  <span className="vw-q-status">{r.exists ? mb(r.size) : 'File moved or deleted'}</span>
                  {r.exists && <span className="vw-q-actions">
                    <button type="button" className="btn xs" onClick={() => void show(r.id)}>Show in folder</button>
                    <button type="button" className="btn xs primary" onClick={() => onPublish(r.id)}>Publish…</button>
                  </span>}
                </div>
                <span className="vw-hint">{new Date(r.at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
