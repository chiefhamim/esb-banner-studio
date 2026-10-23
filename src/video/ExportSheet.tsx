// Export: choose the file, watch it render, get the file. Three steps in one sheet, every figure in it measured:
// the frame count and time left come from the encoder's own progress, and the result reports the container,
// codecs, length and size of the file actually written.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog, Seg } from '../ui/controls'
import { Icon } from '../ui/Icon'
import type { VideoProject } from './timeline'
import { formatShortTime } from './timeline'
import { audibleClips, downloadVideoBlob, exportDuration, exportTimelineVideo, pickCodecs } from './exportVideo'
import type { ExportContainer, ExportResult } from './exportVideo'
import { useVideoStore } from './videoStore'

type Bridge = { saveVideo?: (name: string, bytes: Uint8Array) => Promise<string | null>; reveal?: (p: string) => Promise<unknown> }
const bridge = (): Bridge | undefined => (window as unknown as { esb?: Bridge }).esb

const DRAFT_SECONDS = 10

const mb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

export function ExportSheet({ project, onClose }: { project: VideoProject; onClose: () => void }) {
  const setExporting = useVideoStore((s) => s.setExporting)
  const [container, setContainer] = useState<ExportContainer>('mp4')
  const [length, setLength] = useState<'full' | 'draft'>('full')
  const [support, setSupport] = useState<{ mp4: boolean; audio: string | null } | null>(null)
  const [step, setStep] = useState<'setup' | 'running' | 'done' | 'error'>('setup')
  const [frames, setFrames] = useState({ cur: 0, total: 1 })
  const [startedAt, setStartedAt] = useState(0)
  const [result, setResult] = useState<(ExportResult & { savedTo: string | null }) | null>(null)
  const [error, setError] = useState('')
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    let live = true
    pickCodecs(project.width, project.height, project.fps, 'mp4')
      .then((c) => { if (live) { setSupport({ mp4: c.container === 'mp4', audio: c.audio }); if (c.container !== 'mp4') setContainer('webm') } })
      .catch(() => live && setSupport({ mp4: false, audio: null }))
    return () => { live = false }
  }, [project.width, project.height, project.fps])

  const audio = useMemo(() => audibleClips(project), [project])
  const duration = exportDuration(project, length === 'draft' ? DRAFT_SECONDS : undefined)
  const busy = step === 'running'

  const run = async () => {
    abort.current = new AbortController()
    setStep('running')
    setStartedAt(performance.now())
    setFrames({ cur: 0, total: Math.round(duration * project.fps) })
    setExporting(true, 0)
    try {
      const res = await exportTimelineVideo(project, (cur, total) => {
        setFrames({ cur, total })
        setExporting(true, Math.round((cur / total) * 100))
      }, { container, maxDuration: length === 'draft' ? DRAFT_SECONDS : undefined, signal: abort.current.signal })
      let savedTo: string | null = null
      const b = bridge()
      if (b?.saveVideo) savedTo = await b.saveVideo(res.filename, new Uint8Array(await res.blob.arrayBuffer()))
      else downloadVideoBlob(res.blob, res.filename)
      setResult({ ...res, savedTo })
      setStep('done')
    } catch (err) {
      if ((err as Error).name === 'AbortError') { setStep('setup'); return }
      setError((err as Error).message || 'The render failed.')
      setStep('error')
    } finally {
      setExporting(false, 100)
    }
  }

  const elapsed = (performance.now() - startedAt) / 1000
  const left = frames.cur > 5 ? (elapsed / frames.cur) * (frames.total - frames.cur) : null
  const pct = Math.round((frames.cur / Math.max(1, frames.total)) * 100)

  return (
    <Dialog title="Export video" kicker="RENDER" onClose={() => !busy && onClose()} width={520}>
      <div className="vw-export-modal vx">
        {step === 'setup' && (
          <>
            <div className="vx-row">
              <span className="vx-label">Format</span>
              <Seg<ExportContainer> value={container} onChange={setContainer} options={[{ value: 'mp4', label: 'MP4 · H.264' }, { value: 'webm', label: 'WebM · VP9' }]} />
            </div>
            <div className="vx-row">
              <span className="vx-label">Length</span>
              <Seg<'full' | 'draft'> value={length} onChange={setLength} options={[{ value: 'full', label: `Full timeline · ${formatShortTime(project.duration)}` }, { value: 'draft', label: `${DRAFT_SECONDS}s draft` }]} />
            </div>
            <dl className="vx-facts">
              <div><dt>Frame</dt><dd>{project.width} × {project.height} · {project.fps} fps</dd></div>
              <div><dt>Duration</dt><dd>{formatShortTime(duration)} · {Math.round(duration * project.fps)} frames</dd></div>
              <div><dt>Sound</dt><dd>{audio.length ? `${audio.length} clip${audio.length === 1 ? '' : 's'} from A1, mixed${support?.audio ? ` · ${support.audio === 'aac' ? 'AAC' : 'Opus'}` : ''}` : 'Silent — no clips on A1'}</dd></div>
            </dl>
            {container === 'mp4' && support && !support.mp4 && <p className="vx-note">This system has no H.264 encoder; the file will be WebM.</p>}
            <div className="vx-actions">
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button type="button" className="btn primary vx-go" onClick={() => void run()} disabled={!support}>
                <Icon name="download" size={14} /><span>Export {container === 'mp4' && support?.mp4 !== false ? 'MP4' : 'WebM'}</span>
              </button>
            </div>
          </>
        )}

        {step === 'running' && (
          <>
            <div className="vx-progress-head">
              <b>{pct}%</b>
              <span>Frame {frames.cur} of {frames.total}{left != null ? ` · about ${left < 60 ? `${Math.ceil(left)} s` : `${Math.ceil(left / 60)} min`} left` : ''}</span>
            </div>
            <div className="vw-progress-bar-bg"><div className="vw-progress-bar-fill" style={{ width: `${pct}%` }} /></div>
            <p className="vx-note">Every frame is drawn once its footage has seeked, and stamped with its own time, so the file plays at true speed.</p>
            <div className="vx-actions">
              <button type="button" className="btn vx-cancel" onClick={() => abort.current?.abort()}>Stop</button>
            </div>
          </>
        )}

        {step === 'done' && result && (
          <div className="vw-export-success">
            <div className="vw-success-icon"><Icon name="check" size={24} /></div>
            <h4>{result.savedTo === null && bridge()?.saveVideo ? 'Rendered — not saved' : 'Video exported'}</h4>
            <p className="mono vx-file">{result.savedTo ?? result.filename}</p>
            <dl className="vx-facts">
              <div><dt>File</dt><dd>{result.container.toUpperCase()} · {mb(result.size)}</dd></div>
              <div><dt>Length</dt><dd>{formatShortTime(result.duration)}</dd></div>
              <div><dt>Codecs</dt><dd>{result.videoCodec}{result.audioCodec ? ` + ${result.audioCodec}` : ' · no sound'}</dd></div>
            </dl>
            <div className="vx-actions">
              {result.savedTo && bridge()?.reveal && <button type="button" className="btn" onClick={() => void bridge()!.reveal!(result.savedTo!)}>Show in folder</button>}
              <button type="button" className="btn primary" onClick={onClose}>Done</button>
            </div>
          </div>
        )}

        {step === 'error' && (
          <>
            <div className="signin-error" role="alert"><Icon name="info" size={14} /><span>{error}</span></div>
            <div className="vx-actions">
              <button type="button" className="btn" onClick={onClose}>Close</button>
              <button type="button" className="btn primary" onClick={() => setStep('setup')}>Try again</button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}
