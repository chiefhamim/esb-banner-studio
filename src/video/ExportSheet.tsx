// Export: choose the file, watch it render, get the file. Three steps in one sheet, every figure in it measured:
// the frame count and time left come from the encoder's own progress, and the result reports the container,
// codecs, length and size of the file actually written. In the desktop app the place is chosen first and the file is
// streamed there while it renders (no copy of it is kept in memory); in the browser it downloads at the end.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog, Select, Seg } from '../ui/controls'
import { Icon } from '../ui/Icon'
import type { VideoProject } from './timeline'
import { contentEnd, formatShortTime } from './timeline'
import { audibleClips, downloadVideoBlob, exportLoudnessReport, emptyTextClips, exportBlocker, exportDuration, exportFilename, exportTimelineVideo, pickCodecs } from './exportVideo'
import type { ExportContainer, ExportResult } from './exportVideo'
import { useVideoStore } from './videoStore'
import { videoBridge } from './media'
import { canvasMeasure, measureNow, titleProblems } from './titleClip'
import type { LoudnessTarget } from './audioAdapter'
import { LOUDNESS_CHOICES, PENDING_NOTE, capabilities, projectTarget, writeTarget } from './audioAdapter'

const DRAFT_SECONDS = 10

/** What to do about one title problem, in the editor's words (the problem text itself comes from titleProblems). */
export function fixFor(message: string): string {
  const empty = /^“(.+)” is empty$/.exec(message)
  if (empty) return /^speaker name$/i.test(empty[1]) ? 'Type the speaker’s name.' : `Type the words for “${empty[1]}”.`
  if (/placeholder|filler|TBD|still says/i.test(message)) return 'Replace it with the real text.'
  if (/does not fit|too long|cut/i.test(message)) return 'Shorten the text until it fits.'
  if (/source line/i.test(message)) return 'Add the card again from the Data tab: it carries its Source line.'
  if (/saved data|not a number/i.test(message)) return 'Delete this card and add it again from the Data tab.'
  return 'Open the clip and check its fields.'
}

const mb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

/** Progress reaches React at most this often (every frame re-rendered the sheet and the desk under it). */
const PROGRESS_MS = 100

export function ExportSheet({ project, onClose, onShowMedia }: { project: VideoProject; onClose: () => void; onShowMedia?: () => void }) {
  const setExporting = useVideoStore((s) => s.setExporting)
  const [container, setContainer] = useState<ExportContainer>('mp4')
  const [length, setLength] = useState<'full' | 'draft'>('full')
  const [support, setSupport] = useState<{ mp4: boolean; audio: string | null } | null>(null)
  const [step, setStep] = useState<'setup' | 'running' | 'done' | 'error'>('setup')
  const [frames, setFrames] = useState({ cur: 0, total: 1 })
  const [startedAt, setStartedAt] = useState(0)
  const [result, setResult] = useState<(ExportResult & { savedTo: string | null; chosen: string | null }) | null>(null)
  const [error, setError] = useState('')
  const [audioStatus, setAudioStatus] = useState('')
  const abort = useRef<AbortController | null>(null)
  const lastTick = useRef(0)

  useEffect(() => {
    let live = true
    pickCodecs(project.width, project.height, project.fps, 'mp4')
      .then((c) => { if (live) { setSupport({ mp4: c.container === 'mp4', audio: c.audio }); if (c.container !== 'mp4') setContainer('webm') } })
      .catch(() => live && setSupport({ mp4: false, audio: null }))
    return () => { live = false }
  }, [project.width, project.height, project.fps])

  const audio = useMemo(() => audibleClips(project), [project])
  const target = projectTarget(project)
  const canTarget = capabilities().target
  // the title check measures with the real fonts once the canvas measurer exists (made on first use)
  const [measured, setMeasured] = useState(!!measureNow())
  useEffect(() => { if (!measured) void canvasMeasure().then(() => setMeasured(true)) }, [measured])
  const blocked = useMemo(() => (measured ? exportBlocker(project) : exportBlocker(project)), [project, measured])
  const titleIssues = useMemo(() => (measured ? titleProblems(project, measureNow()) : titleProblems(project)), [project, measured])
  const empties = useMemo(() => emptyTextClips(project), [project])
  const end = contentEnd(project)
  // a draft is offered only when the video is longer than the draft
  const draftable = end > DRAFT_SECONDS + 0.05
  const useDraft = length === 'draft' && draftable
  const duration = exportDuration(project, useDraft ? DRAFT_SECONDS : undefined)
  const busy = step === 'running'
  const kind: ExportContainer = container === 'mp4' && support?.mp4 !== false ? 'mp4' : 'webm'

  const run = async () => {
    const b = videoBridge()
    // desktop: choose the place first, then the render streams into it
    let job: { id: string; path: string } | null = null
    if (b?.videoExportBegin && b.videoExportWrite && b.videoExportEnd) {
      try { job = await b.videoExportBegin(exportFilename(project, kind), kind) } catch (e) {
        setError(String((e as Error).message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
        setStep('error')
        return
      }
      if (!job) return
    }
    abort.current = new AbortController()
    setStep('running')
    setStartedAt(performance.now())
    setFrames({ cur: 0, total: Math.round(duration * project.fps) })
    setExporting(true, 0)
    const id = job?.id
    try {
      const writable = job && id ? new WritableStream<{ type: 'write'; data: Uint8Array; position: number }>({ write: async (chunk) => { await b!.videoExportWrite!(id, chunk.position, chunk.data) } }) : undefined
      lastTick.current = 0
      setAudioStatus('')
      const res = await exportTimelineVideo(project, (cur, total) => {
        const now = performance.now()
        if (cur < total && now - lastTick.current < PROGRESS_MS) return
        lastTick.current = now
        setFrames({ cur, total })
        setExporting(true, Math.round((cur / total) * 100))
      }, { container: kind, maxDuration: useDraft ? DRAFT_SECONDS : undefined, signal: abort.current.signal, writable, onAudioStatus: (t) => setAudioStatus(t) })
      let savedTo: string | null = null
      if (id) {
        savedTo = await b!.videoExportEnd!(id, true)
        if (!savedTo) throw new Error('The file could not be finished on disk.')
      } else if (res.blob) downloadVideoBlob(res.blob, res.filename)
      setResult({ ...res, savedTo, chosen: job?.path ?? null })
      setStep('done')
    } catch (err) {
      if (id) await b!.videoExportEnd!(id, false).catch(() => null)
      if ((err as Error).name === 'AbortError') { setStep('setup'); return }
      setError((err as Error).message || 'The render failed.')
      setStep('error')
    } finally {
      setExporting(false, 100)
    }
  }

  const loudRep = result ? exportLoudnessReport(result) : null
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
              {draftable
                ? <Seg<'full' | 'draft'> value={length} onChange={setLength} options={[{ value: 'full', label: `Full · ${formatShortTime(end)}` }, { value: 'draft', label: `First ${DRAFT_SECONDS} s` }]} />
                : <span className="vx-value">{formatShortTime(end)} · the whole video</span>}
            </div>
            <div className="vx-row vx-loud-row">
              <span className="vx-label">Loudness</span>
              <Select<string>
                value={String(target)}
                options={LOUDNESS_CHOICES.map((c) => ({ value: String(c.value), label: c.label, hint: c.hint }))}
                onChange={(v) => writeTarget((v === 'off' ? 'off' : Number(v)) as LoudnessTarget)}
                className="compact vx-loud-target"
                title={canTarget ? 'The mix is normalised to this when exported' : PENDING_NOTE}
              />
            </div>
            {!canTarget && <p className="vx-loud-note">Loudness normalising switches on when the audio engine is merged; until then the mix is exported as it plays.</p>}
            {canTarget && <p className="vx-loud-note">The target is applied to the exported file, not to the preview. Noise reduction, ducking, a target and the limiter add a sound-processing stage before the picture starts (about 14 s for 10 minutes of plain sound, up to about 90 s with all of them).</p>}
            <dl className="vx-facts">
              <div><dt>Frame</dt><dd>{project.width} × {project.height} · {project.fps} fps</dd></div>
              <div><dt>Duration</dt><dd>{formatShortTime(duration)} · {Math.round(duration * project.fps)} frames</dd></div>
              <div><dt>Sound</dt><dd>{audio.length ? `${audio.length} clip${audio.length === 1 ? '' : 's'} mixed${support?.audio ? ` · ${support.audio === 'aac' ? 'AAC' : 'Opus'}` : ''}` : 'Silent — nothing on the audio track'}</dd></div>
              <div><dt>ESB bug</dt><dd>{project.bug !== false ? 'On (top right)' : 'Off'}</dd></div>
            </dl>
            {blocked && (
              <div className="signin-error vx-blocked" role="alert">
                <Icon name="info" size={14} />
                {titleIssues.length && blocked.includes('cannot be exported yet') ? (
                  <div className="vx-title-issues">
                    <span>{titleIssues.length} title{titleIssues.length === 1 ? '' : 's'} cannot be exported yet:</span>
                    <ul>
                      {titleIssues.map((p) => (
                        <li key={p.clipId} data-clip={p.clipId}>
                          <div className="vx-issue">
                            <b>{p.label} at {formatShortTime(p.at)}</b>
                            {p.messages.map((m) => (
                              <p key={m} className="vx-problem"><span className="vx-what">{m}</span><span className="vx-fix"><Icon name="chevRight" size={11} />{fixFor(m)}</span></p>
                            ))}
                          </div>
                          <button type="button" className="btn sm vx-show-title" onClick={() => { useVideoStore.getState().seek(p.at); useVideoStore.getState().selectClip(p.clipId); onClose() }}>Show clip</button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : <span>{blocked}</span>}
                {onShowMedia && !blocked.includes('cannot be exported yet') && /media/i.test(blocked) && !/empty/i.test(blocked) && <button type="button" className="btn sm vx-show-media" onClick={onShowMedia}>Show missing files</button>}
              </div>
            )}
            {!blocked && empties.length > 0 && <p className="vx-note">{empties.length} title{empties.length === 1 ? '' : 's'} with nothing typed in {empties.length === 1 ? 'is' : 'are'} left out of the file.</p>}
            {container === 'mp4' && support && !support.mp4 && <p className="vx-note">This system has no H.264 encoder; the file will be WebM.</p>}
            <div className="vx-actions">
              <button type="button" className="btn ghost vx-cancel-setup" onClick={onClose}>Cancel</button>
              <button type="button" className="btn primary vx-go" onClick={() => void run()} disabled={!support || !!blocked}>
                <Icon name="download" size={14} /><span>Export {kind === 'mp4' ? 'MP4' : 'WebM'}</span>
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
            {audioStatus && <p className="vx-note vx-audio-status" role="status">Sound: {audioStatus}</p>}
            <p className="vx-note">Every frame is drawn once its footage is at that exact instant, and stamped with its own time, so the file plays at true speed.</p>
            <div className="vx-actions">
              <button type="button" className="btn vx-cancel" onClick={() => abort.current?.abort()}>Stop</button>
            </div>
          </>
        )}

        {step === 'done' && result && (
          <div className="vw-export-success">
            <div className="vw-success-icon"><Icon name="check" size={24} /></div>
            <h4>Video exported</h4>
            <p className="mono vx-file">{result.savedTo ?? result.filename}</p>
            {result.savedTo && result.chosen && result.savedTo !== result.chosen && (
              <p className="vx-note vx-renamed">The file you chose was in use (open in a player?), so the video was saved under this name instead.</p>
            )}
            <dl className="vx-facts">
              <div><dt>File</dt><dd>{result.container.toUpperCase()} · {mb(result.size)}</dd></div>
              <div><dt>Length</dt><dd>{formatShortTime(result.duration)}</dd></div>
              <div><dt>Codecs</dt><dd>{result.videoCodec}{result.audioCodec ? ` + ${result.audioCodec}` : ' · no sound'}</dd></div>
              <div className={`vx-loud-report${loudRep ? (loudRep.ok ? ' ok' : ' off') : ''}`}><dt>Loudness</dt><dd>{loudRep ? loudRep.lines.join(' · ') : result.audioCodec ? 'Not measured' : 'No sound'}{loudRep && <em className="vx-loud-verdict">{loudRep.ok ? ' · on target' : ' · check'}</em>}</dd></div>
            </dl>
            <div className="vx-actions">
              {result.savedTo && videoBridge()?.reveal && <button type="button" className="btn" onClick={() => void videoBridge()!.reveal!(result.savedTo!)}>Show in folder</button>}
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
