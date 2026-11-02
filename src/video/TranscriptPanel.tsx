// Transcript + text-based editing for one footage clip. Every transcript is an AI draft until reviewed; nothing touches
// the timeline until the editor presses Cut. Cuts are one undo step (videoStore.applyTextCuts).
import { useMemo, useRef, useState } from 'react'
import { useVideoStore, viewOf } from './videoStore'
import { AI_DRAFT_LABEL, makeTranscript, type Transcript } from './ai/transcript'
import { geminiEngine } from './ai/transcribe'
import { cutsForDeletedWords } from './ai/textEdit'
import { fillerPlan, silencePlan, type CutPlan } from './ai/cutPlan'
import { captionClipsFor } from './ai/captionPlan'
import { findHighlights, type HighlightCandidate } from './ai/highlights'
import { shortClips } from './ai/shortPlan'
import { ReframePanel } from './ReframePanel'
import { sourceAudio } from './ai/sourceAudio'
import type { Clip } from './timeline'
import { formatShortTime } from './timeline'

const FPS_FALLBACK = 30

export function TranscriptPanel() {
  const project = useVideoStore((s) => viewOf(s))
  const selectedClipId = useVideoStore((s) => s.selectedClipId)
  const selectedIds = useVideoStore((s) => s.selectedIds)
  const applyTextCuts = useVideoStore((s) => s.applyTextCuts)
  const addClips = useVideoStore((s) => s.addClips)

  const clip: Clip | undefined = useMemo(() => {
    const pick = [selectedClipId, ...selectedIds].map((id) => project.clips.find((c) => c.id === id && c.kind === 'video' && !c.still))
    return pick.find(Boolean) ?? undefined
  }, [project, selectedClipId, selectedIds])

  const [transcript, setTranscript] = useState<{ clipId: string; t: Transcript } | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [notice, setNotice] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const words = transcript && clip && transcript.clipId === clip.id ? transcript.t.words : []
  const fps = project.fps || FPS_FALLBACK

  const transcribe = async () => {
    if (!clip) return
    setError(''); setNotice(''); setBusy(true); setProgress('Reading the sound…')
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const asset = clip.sourceUrl
      if (!asset) throw new Error('This clip has no source file to read.')
      const audio = await sourceAudio(asset, clip.in, clip.out)
      if ('error' in audio) throw new Error(audio.error)
      setProgress('Sending to Gemini…')
      const res = await geminiEngine().transcribe(audio, {
        signal: ctrl.signal,
        onProgress: (done, total) => setProgress(`Transcribing part ${done} of ${total}…`),
      })
      // the audio began at the clip's in-point, so word times are relative to it: shift them to source seconds
      const shifted = res.transcript.words.map((w) => ({ ...w, start: w.start + clip.in, end: w.end + clip.in }))
      setTranscript({ clipId: clip.id, t: makeTranscript(shifted, res.transcript.origin, { lang: res.transcript.lang, duration: clip.out }) })
      setPicked(new Set())
      if (!res.complete) setNotice('Some parts did not come back. The words shown are the parts that did; check the gaps before you cut.')
    } catch (e) {
      if (!ctrl.signal.aborted) setError((e as Error).message)
    } finally {
      setBusy(false); setProgress(''); abortRef.current = null
    }
  }

  // ---- silence and filler removal: plan first, show every cut, apply on the editor's press
  const [thr, setThr] = useState(-45)
  const [minSil, setMinSil] = useState(0.5)
  const [plan, setPlan] = useState<{ kind: 'silence' | 'filler'; clipId: string; cut: CutPlan } | null>(null)
  const [planBusy, setPlanBusy] = useState(false)

  const findSilences = async () => {
    if (!clip) return
    setError(''); setNotice(''); setPlanBusy(true)
    try {
      const audio = await sourceAudio(clip.sourceUrl ?? '', clip.in, clip.out)
      if ('error' in audio) throw new Error(audio.error)
      const cut = silencePlan(audio.channels, audio.sampleRate, clip.in, fps, clip.out, { threshold: thr, minDuration: minSil, handle: 0.1 })
      setPlan({ kind: 'silence', clipId: clip.id, cut })
      if (!cut.ranges.length) setNotice('No silence found at this threshold.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPlanBusy(false)
    }
  }

  const findHesitations = () => {
    if (!clip || !words.length) return
    setError(''); setNotice('')
    const { plan: cut } = fillerPlan(words, fps, clip.out)
    setPlan({ kind: 'filler', clipId: clip.id, cut })
    if (!cut.ranges.length) setNotice('No hesitations (um, উম) found in the transcript.')
  }

  const applyPlan = () => {
    if (!plan || !clip || plan.clipId !== clip.id || !plan.cut.ranges.length) return
    const r = applyTextCuts(plan.clipId, plan.cut.ranges)
    if (r.refused) {
      setError(refusalText(r.refused))
    } else {
      setError('')
      setNotice(`Removed ${r.removed} ${plan.kind === 'silence' ? 'silence' : 'hesitation'} cut${r.removed === 1 ? '' : 's'}. Undo (Ctrl+Z) brings them back.`)
      setPlan(null)
    }
  }

  // ---- highlight finder: candidate excerpts from the transcript; the editor picks, nothing is posted
  const [shorts, setShorts] = useState<HighlightCandidate[]>([])
  const findShorts = () => {
    if (!words.length) return
    setShorts(findHighlights(words, { top: 8 }))
    setNotice('')
    setError('')
  }
  const addShort = (c: HighlightCandidate) => {
    if (!clip) return
    const clips = shortClips(project, clip, c)
    if (!clips.length) { setError('That excerpt is empty.'); return }
    addClips(clips)
    setNotice(`Added “${c.text.slice(0, 40)}…” at the end of the timeline. Review it before you export.`)
  }

  const addCaptions = () => {
    if (!clip || !words.length) return
    const capTrack = project.tracks.find((t) => t.kind === 'caption')?.id
    if (!capTrack) { setError('There is no caption track to add to.'); return }
    const caps = captionClipsFor(project, { mediaAssetId: clip.mediaAssetId, sourceUrl: clip.sourceUrl }, words, capTrack, { maxDuration: 6 })
    if (!caps.length) { setError('No words are left on the timeline to caption.'); return }
    addClips(caps)
    setError('')
    setNotice(`Added ${caps.length} caption${caps.length === 1 ? '' : 's'} from the transcript (AI draft). Undo (Ctrl+Z) removes them.`)
  }

  const cutPicked = () => {
    if (!clip || !picked.size) return
    const proposal = cutsForDeletedWords(words, [...picked], { fps, duration: clip.srcDuration })
    const ranges = proposal.cuts.map((c) => ({ from: c.start, to: c.end }))
    const r = applyTextCuts(clip.id, ranges)
    if (r.refused) setError(refusalText(r.refused))
    else { setError(''); setPicked(new Set()); setNotice(`Cut ${r.removed} place${r.removed === 1 ? '' : 's'}. Undo (Ctrl+Z) brings the words back.`) }
  }

  const toggle = (i: number) => setPicked((p) => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n })

  if (!clip) {
    return <p className="vw-hint">Select a footage clip on V1 to read its words. Transcripts are AI drafts: check them before you cut.</p>
  }

  return (
    <div className="vw-transcript">
      <div className="vw-transcript-head">
        <span className="vw-tag" data-tag="caption">AI draft</span>
        <button type="button" className="btn xs" onClick={transcribe} disabled={busy} aria-busy={busy}>
          {busy ? 'Working…' : words.length ? 'Transcribe again' : 'Transcribe with Gemini'}
        </button>
      </div>
      {busy && <p className="vw-hint" role="status">{progress}</p>}
      {error && <p className="vw-hint vw-error" role="alert">{error}</p>}
      {notice && <p className="vw-hint" role="status">{notice}</p>}
      {!words.length && !busy && !error && (
        <p className="vw-hint">{AI_DRAFT_LABEL}. Gemini hears the clip’s sound; it is sent to Google with your key. Nothing changes until you press Cut.</p>
      )}
      <div className="vw-cut-tools">
        <label className="vw-cut-row">
          Silence threshold <input type="range" min={-60} max={-25} step={1} value={thr} onChange={(e) => setThr(Number(e.target.value))} aria-label="Silence threshold in decibels" /> <span>{thr} dB</span>
        </label>
        <label className="vw-cut-row">
          Shortest silence <input type="range" min={0.3} max={2} step={0.1} value={minSil} onChange={(e) => setMinSil(Number(e.target.value))} aria-label="Shortest silence in seconds" /> <span>{minSil.toFixed(1)} s</span>
        </label>
        <div className="vw-transcript-actions">
          <button type="button" className="btn xs" onClick={findSilences} disabled={busy || planBusy}>{planBusy ? 'Listening…' : 'Find silences'}</button>
          {words.length > 0 && <button type="button" className="btn xs" onClick={findHesitations} disabled={busy}>Find hesitations</button>}
        </div>
        {plan && plan.clipId === clip.id && (
          <div className="vw-cut-plan" role="region" aria-label="Proposed cuts">
            <p className="vw-hint">{plan.kind === 'silence' ? 'Silence' : 'Hesitation'} cuts: {plan.cut.ranges.length}, {plan.cut.seconds.toFixed(1)} s in total. Nothing is removed until you press Remove.</p>
            <ul className="vw-cut-list">
              {plan.cut.ranges.map((r, i) => (
                <li key={i}>{formatShortTime(r.from)} – {formatShortTime(r.to)} <span className="vw-hint">{(r.to - r.from).toFixed(2)} s</span></li>
              ))}
            </ul>
            <div className="vw-transcript-actions">
              <button type="button" className="btn xs" onClick={() => setPlan(null)}>Discard</button>
              <button type="button" className="btn xs primary" onClick={applyPlan} disabled={!plan.cut.ranges.length}>Remove these cuts</button>
            </div>
          </div>
        )}
      </div>
      {notice && !words.length && <p className="vw-hint" role="status">{notice}</p>}
      <ReframePanel clip={clip} />
      {words.length > 0 && (
        <>
          <p className="vw-hint">{AI_DRAFT_LABEL}. Click words to mark them, then cut. {picked.size} marked.</p>
          <div className="vw-transcript-words" aria-label="Transcript words">
            {words.map((w, i) => (
              <button
                key={`${i}-${w.start}`}
                type="button"
                className={`vw-word${picked.has(i) ? ' is-cut' : ''}`}
                aria-pressed={picked.has(i)}
                title={`${formatShortTime(w.start)} · confidence ${Math.round(w.confidence * 100)}%`}
                onClick={() => toggle(i)}
              >
                {w.text}
              </button>
            ))}
          </div>
          {shorts.length > 0 && (
            <div className="vw-cut-plan" role="region" aria-label="Short candidates">
              <p className="vw-hint">Short candidates (the transcript’s own words, 15–60 s). Pick one to add it to the timeline.</p>
              <ul className="vw-cut-list">
                {shorts.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="vw-word" onClick={() => addShort(c)}>
                      {formatShortTime(c.start)} – {formatShortTime(c.end)} · {(c.end - c.start).toFixed(0)} s
                    </button>
                    <div className="vw-hint">{c.text}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="vw-transcript-actions">
            <button type="button" className="btn xs" onClick={addCaptions}>Add captions</button>
            <button type="button" className="btn xs" onClick={findShorts}>Find Short candidates</button>
            <button type="button" className="btn xs" onClick={() => setPicked(new Set())} disabled={!picked.size}>Clear marks</button>
            <button type="button" className="btn xs primary" onClick={cutPicked} disabled={!picked.size}>Cut marked words</button>
          </div>
        </>
      )}
    </div>
  )
}

function refusalText(r: string): string {
  switch (r) {
    case 'speed': return 'This clip is speed-changed. Set its speed to 100% before cutting words.'
    case 'not-footage': return 'Only footage clips can be cut by words.'
    case 'compound': return 'Open the compound clip to cut its footage.'
    case 'locked': return 'This track is locked, or the cut would pull a linked clip apart.'
    case 'outside-source': return 'These words are outside the clip’s trimmed source.'
    case 'no-clip': return 'The clip is gone.'
    default: return 'Could not cut.'
  }
}
