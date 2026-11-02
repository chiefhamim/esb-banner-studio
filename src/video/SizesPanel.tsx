// Make all sizes: one timeline, framed for 16:9, 9:16 and 4:5. Auto reframe follows the face in each footage clip for the
// other shapes; the framing is kept per shape, so opening a shape shows its own crop, and a timing or caption edit is in
// every size. Local only. Exporting each size is one export per shape (the render queue in Phase 7 batches them).
import { useState } from 'react'
import { useVideoStore, viewOf } from './videoStore'
import { SIZE_ASPECTS, type SizeFraming } from './sizes'
import { reframeClip } from './ai/reframeClip'
import type { TargetAspect } from './ai/reframe'
import type { AspectRatio } from './timeline'

const LABEL: Record<AspectRatio, string> = { '16:9': '16:9 YouTube, website', '9:16': '9:16 Shorts, Reels', '4:5': '4:5 Facebook feed', '1:1': '1:1 Square' }

export function SizesPanel() {
  const project = useVideoStore((s) => viewOf(s))
  const setAspect = useVideoStore((s) => s.setAspect)
  const setSizeFraming = useVideoStore((s) => s.setSizeFraming)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [report, setReport] = useState<string[]>([])
  const [error, setError] = useState('')
  const [abort, setAbort] = useState<AbortController | null>(null)

  const footage = project.clips.filter((c) => c.kind === 'video' && !c.still && !c.compound && !!c.sourceUrl)

  const run = async () => {
    setBusy(true); setError(''); setReport([])
    const c = new AbortController()
    setAbort(c)
    const lines: string[] = []
    try {
      const others = SIZE_ASPECTS.filter((a) => a !== project.aspect)
      for (const aspect of others) {
        const framing: SizeFraming = {}
        let followed = 0
        let centred = 0
        for (let i = 0; i < footage.length; i++) {
          if (c.signal.aborted) throw new Error('Cancelled')
          const clip = footage[i]
          // a wider shape than the footage needs no face tracking: the picture simply fills it
          if (aspect === '16:9') { framing[clip.id] = { fit: 'fill' }; centred++; continue }
          setProgress(`${aspect}: clip ${i + 1} of ${footage.length}`)
          const r = await reframeClip(clip, aspect as TargetAspect, { signal: c.signal })
          if (r.ok) {
            framing[clip.id] = { fit: 'fill', scale: r.plan.clip.scale, kfX: r.plan.keyframes.offX, kfY: r.plan.keyframes.offY }
            followed++
          } else {
            framing[clip.id] = { fit: 'fill' }
            centred++
          }
        }
        setSizeFraming(aspect, framing)
        lines.push(`${aspect}: ${followed} clip${followed === 1 ? '' : 's'} follow a face${centred ? `, ${centred} kept centred` : ''}.`)
      }
      setReport(lines)
    } catch (e) {
      if (!c.signal.aborted) setError((e as Error).message)
      if (lines.length) setReport(lines)
    } finally {
      setBusy(false); setProgress(''); setAbort(null)
    }
  }

  return (
    <section className="vw-sec" aria-label="Sizes">
      <div className="vw-sec-head"><h4 className="vw-sec-title">All sizes</h4></div>
      <p className="vw-hint">One timeline in three shapes. Captions, titles and timing are shared; each shape keeps its own crop. Open a shape to check or adjust its crop.</p>
      <div className="vw-size-row" role="group" aria-label="Open a shape">
        {SIZE_ASPECTS.map((a) => (
          <button key={a} type="button" className={`vw-size${project.aspect === a ? ' on' : ''}`} aria-pressed={project.aspect === a} onClick={() => setAspect(a)}>
            <b>{a}</b><span>{LABEL[a].slice(a.length + 1)}</span>
          </button>
        ))}
      </div>
      <div className="vw-transcript-actions">
        {busy
          ? <button type="button" className="btn xs" onClick={() => abort?.abort()}>Stop</button>
          : <button type="button" className="btn xs" onClick={() => void run()} disabled={!footage.length}>Make all sizes</button>}
      </div>
      {!footage.length && <p className="vw-hint">Add footage first. Pictures and titles resize on their own.</p>}
      {progress && <p className="vw-hint" role="status">{progress}</p>}
      {error && <p className="vw-hint vw-error" role="alert">{error}</p>}
      {report.map((l) => <p key={l} className="vw-hint" role="status">{l}</p>)}
    </section>
  )
}
