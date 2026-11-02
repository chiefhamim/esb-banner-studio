// Auto reframe: track the face through one footage clip and write the crop as editable keyframes.
// The project must already be the target shape (9:16 for a Short); nothing is written until the editor presses Apply.
import { useState } from 'react'
import { useVideoStore, viewOf } from './videoStore'
import { previewUrl } from './engine/mediaSource'
import { planReframe, type ReframePlan, type TargetAspect } from './ai/reframe'
import { sampleTimes, trackFaces } from './ai/faceTrack'
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
  const [target, setTarget] = useState<TargetAspect>('9:16')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [plan, setPlan] = useState<{ clipId: string; plan: ReframePlan; frames: SubjectFrame[] } | null>(null)
  const [ctrl, setCtrl] = useState<AbortController | null>(null)

  const projectAspect = project.aspect
  const aspectMismatch = projectAspect !== target

  const analyse = async () => {
    setError(''); setBusy(true); setProgress('Opening the clip…')
    const c = new AbortController()
    setCtrl(c)
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    video.src = previewUrl(clip) || clip.sourceUrl || ''
    try {
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve()
        video.onerror = () => reject(new Error('This clip’s picture could not be opened for analysis.'))
      })
      const srcW = video.videoWidth
      const srcH = video.videoHeight
      if (!srcW || !srcH) throw new Error('This clip has no picture to analyse.')
      const times = sampleTimes(clip.in, clip.out, 4)
      if (!times.length) throw new Error('The clip has no length to analyse.')
      const frames = await trackFaces(video, times, {
        signal: c.signal,
        onProgress: (d, t) => setProgress(`Finding the face… ${Math.round((d / t) * 100)}%`),
      })
      const found = frames.filter((f) => f.box).length
      if (!found) throw new Error('No face was found in this clip, so no crop was made. Try a clip with a face in view.')
      // frame times are source seconds; planReframe wants keyframe times relative to the clip's in-point
      const reframe = planReframe(frames, { srcW, srcH, target, clipIn: clip.in })
      setPlan({ clipId: clip.id, plan: reframe, frames })
      setProgress('')
    } catch (e) {
      if (!c.signal.aborted) setError((e as Error).message)
    } finally {
      video.removeAttribute('src')
      video.load()
      setBusy(false); setProgress(''); setCtrl(null)
    }
  }

  const apply = () => {
    if (!plan || plan.clipId !== clip.id || aspectMismatch) return
    const keyframes = { ...(clip.keyframes ?? {}), offX: plan.plan.keyframes.offX, offY: plan.plan.keyframes.offY }
    updateClip({ ...clip, fit: 'fill', scale: plan.plan.clip.scale, keyframes })
    setPlan(null)
  }

  return (
    <div className="vw-reframe">
      <p className="vw-hint">Auto reframe follows the face through this clip and writes the crop as keyframes you can edit. It needs a project in the same shape.</p>
      <label className="vw-cut-row">
        Shape
        <select value={target} onChange={(e) => setTarget(e.target.value as TargetAspect)} aria-label="Reframe target shape" disabled={busy}>
          {TARGETS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </label>
      {aspectMismatch && <p className="vw-hint vw-error" role="note">The project is {projectAspect}. Set the project to {target} first (Project → Aspect), then reframe.</p>}
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
    </div>
  )
}

