// Auto reframe: track the face through one footage clip and write the crop as editable keyframes.
// The project must already be the target shape (9:16 for a Short); nothing is written until the editor presses Apply.
import { useState } from 'react'
import { useVideoStore, viewOf } from './videoStore'
import { reframeClip } from './ai/reframeClip'
import type { ReframePlan, TargetAspect } from './ai/reframe'
import type { SubjectFrame } from './ai/reframe'
import type { Clip } from './timeline'

const TARGETS: { id: TargetAspect; label: string }[] = [
  { id: '9:16', label: '9:16 Short / Reel' },
  { id: '4:5', label: '4:5 Facebook feed' },
  { id: '1:1', label: '1:1 Square' },
]

export function ReframePanel({ clip }: { clip: Clip }) {
  const project = useVideoStore((s) => viewOf(s))
  const updateClip = useVideoStore((s) => s.updateClip)
  const setAspect = useVideoStore((s) => s.setAspect)
  const [target, setTarget] = useState<TargetAspect>('9:16')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [plan, setPlan] = useState<{ clipId: string; plan: ReframePlan; frames: SubjectFrame[] } | null>(null)
  const [ctrl, setCtrl] = useState<AbortController | null>(null)

  const projectAspect = project.aspect
  const aspectMismatch = projectAspect !== target

  const analyse = async () => {
    setError(''); setBusy(true); setProgress('Opening the clip')
    const c = new AbortController()
    setCtrl(c)
    const r = await reframeClip(clip, target, { signal: c.signal, onProgress: (d, t) => setProgress(`Finding the face ${Math.round((d / t) * 100)}%`) })
    if (r.ok) setPlan({ clipId: clip.id, plan: r.plan, frames: r.frames })
    else if (!c.signal.aborted) setError(r.why)
    setBusy(false); setProgress(''); setCtrl(null)
  }

  const apply = () => {
    if (!plan || plan.clipId !== clip.id || aspectMismatch) return
    const keyframes = { ...(clip.keyframes ?? {}), offX: plan.plan.keyframes.offX, offY: plan.plan.keyframes.offY }
    updateClip({ ...clip, fit: 'fill', scale: plan.plan.clip.scale, keyframes })
    setPlan(null)
  }

  return (
    <section className="vw-sec vw-reframe" aria-label="Auto reframe">
      <div className="vw-sec-head"><h4 className="vw-sec-title">Auto reframe</h4></div>
      <p className="vw-hint">Follows the face through this clip and writes the crop as keyframes you can edit. The project must be in the same shape.</p>
      <label className="vw-cut-row">
        <span className="vw-cut-label">Shape</span>
        <select value={target} onChange={(e) => setTarget(e.target.value as TargetAspect)} aria-label="Reframe target shape" disabled={busy}>
          {TARGETS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </label>
      {aspectMismatch && (
        <div className="vw-reframe-note" role="note">
          <p className="vw-hint">The project is {projectAspect}, so a {target} crop would not fit it.</p>
          <button type="button" className="btn xs" onClick={() => setAspect(target)}>Switch project to {target}</button>
        </div>
      )}
      <div className="vw-transcript-actions">
        {busy
          ? <button type="button" className="btn xs" onClick={() => ctrl?.abort()}>Stop</button>
          : <button type="button" className="btn xs" onClick={analyse} disabled={aspectMismatch}>Analyse faces</button>}
        {plan && plan.clipId === clip.id && <button type="button" className="btn xs primary" onClick={apply} disabled={aspectMismatch}>Apply crop</button>}
      </div>
      {progress && <p className="vw-hint" role="status">{progress}</p>}
      {error && <p className="vw-hint vw-error" role="alert">{error}</p>}
      {plan && plan.clipId === clip.id && (
        <p className="vw-hint" role="status">
          Face in frame for {Math.round(plan.plan.insideRatio * 100)}% of the samples; {plan.plan.fastMoves} fast move{plan.plan.fastMoves === 1 ? '' : 's'}. Review the crop, then apply.
        </p>
      )}
    </section>
  )
}

