// Caption translation EN <-> BN onto a SEPARATE caption track, labelled AI draft; the original captions are untouched.
import { useState } from 'react'
import { useVideoStore, viewOf } from './videoStore'
import { captionSources, translateCaptionLines, translatedClips, type Lang } from './ai/captionTranslate'

export function CaptionTranslatePanel() {
  const project = useVideoStore((s) => viewOf(s))
  const addTrack = useVideoStore((s) => s.addTrack)
  const addClips = useVideoStore((s) => s.addClips)
  const renameTrack = useVideoStore((s) => s.renameTrack)
  const [busy, setBusy] = useState<Lang | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [problems, setProblems] = useState<string[]>([])

  // translated tracks are not sources again (a draft is never translated back as if it were the original)
  const sources = captionSources(project).filter((c) => !c.id.startsWith('clip-tr-'))

  const run = async (to: Lang) => {
    setBusy(to); setError(''); setNotice(''); setProblems([])
    try {
      const r = await translateCaptionLines(sources.map((c) => c.captionText ?? ''), to)
      const trackId = addTrack('caption')
      renameTrack(trackId, `C · ${to === 'en' ? 'English' : 'Bangla'} (AI draft)`)
      const clips = translatedClips(sources, r.lines, to, trackId)
      if (clips.length) addClips(clips)
      setProblems(r.problems.map((p) => `Caption ${p.index + 1}: ${p.why}`))
      setNotice(`${clips.length} of ${sources.length} captions translated to ${to === 'en' ? 'English' : 'Bangla'} on their own track. Read them before you export. Undo (Ctrl+Z) removes the track.`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="vw-sec" aria-label="Translate captions">
      <div className="vw-sec-head"><h4 className="vw-sec-title">Translate captions</h4><span className="vw-tag" data-tag="caption">AI draft</span></div>
      <p className="vw-hint">Makes a second caption track in the other language. Your captions stay as they are, and a caption whose figures change is left out.</p>
      <div className="vw-transcript-actions">
        <button type="button" className="btn xs" onClick={() => void run('en')} disabled={!!busy || !sources.length} aria-busy={busy === 'en'}>{busy === 'en' ? 'Translating' : 'To English'}</button>
        <button type="button" className="btn xs" onClick={() => void run('bn')} disabled={!!busy || !sources.length} aria-busy={busy === 'bn'}>{busy === 'bn' ? 'Translating' : 'To বাংলা'}</button>
      </div>
      {!sources.length && <p className="vw-hint">Add captions first (type one above, or make them from a transcript).</p>}
      {error && <p className="vw-hint vw-error" role="alert">{error}</p>}
      {notice && <p className="vw-hint" role="status">{notice}</p>}
      {problems.map((p) => <p key={p} className="vw-hint vw-warn" role="status">{p}</p>)}
    </section>
  )
}
