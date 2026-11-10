// YouTube + Facebook copy for the video: an AI draft the editor reads and edits. Kept with the project for the publish
// sheet (Phase 7). Writing it sends the story text to the editor's AI provider; nothing is posted from here.
import { useState } from 'react'
import { useEditorialStore } from '../editorial/editorialStore'
import { useVideoStore } from './videoStore'
import { writeVideoCopy, YT_TITLE_MAX } from './ai/videoCopy'
import type { VideoCopy } from './ai/savedCopy'

const FB_SOFT = 125

export function VideoCopyPanel() {
  const draft = useEditorialStore((s) => s.draft)
  const project = useVideoStore((s) => s.project)
  const copy = project.videoCopy
  const setVideoCopy = useVideoStore((s) => s.setVideoCopy)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [problems, setProblems] = useState<string[]>([])
  const [copied, setCopied] = useState('')

  const hasStory = !!draft.headline.trim() && !!draft.body.trim()

  const write = async () => {
    setBusy(true); setError(''); setProblems([])
    try {
      const r = await writeVideoCopy({ headline: draft.headline, deck: draft.deck, body: draft.body, slug: draft.slug }, { markers: project.markers, duration: project.duration })
      setVideoCopy(r.copy)
      setProblems(r.problems)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const edit = (patch: Partial<VideoCopy>) => {
    const base: VideoCopy = copy ?? { youtubeTitle: '', description: '', tags: [], facebook: '', model: '', at: 0 }
    // once the editor changes a field it is theirs, not the model's
    setVideoCopy({ ...base, ...patch, model: '', at: Date.now() })
  }

  const copyText = async (key: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); window.setTimeout(() => setCopied((c) => (c === key ? '' : c)), 1500) } catch { setError('The clipboard is not available here.') }
  }

  return (
    <section className="vw-sec vw-copy" aria-label="Video copy">
      <div className="vw-sec-head">
        <h4 className="vw-sec-title">YouTube and Facebook copy</h4>
        {copy?.model ? <span className="vw-tag" data-tag="caption">AI draft</span> : copy ? <span className="vw-tag">Your text</span> : null}
      </div>
      <p className="vw-hint">Written from the story on the Editorial desk, using only its facts. Sending it to your AI provider is the only thing this does; nothing is posted.</p>
      <div className="vw-transcript-actions">
        <button type="button" className="btn xs" onClick={write} disabled={busy || !hasStory} aria-busy={busy}>{busy ? 'Writing' : copy ? 'Write again' : 'Write with AI'}</button>
      </div>
      {!hasStory && <p className="vw-hint">Open a story with a headline and body on the Editorial desk first.</p>}
      {error && <p className="vw-hint vw-error" role="alert">{error}</p>}
      {problems.map((p) => <p key={p} className="vw-hint vw-warn" role="status">{p}</p>)}
      {copy && (
        <div className="vw-copy-fields">
          <label className="vw-copy-field">
            <span className="vw-copy-label">YouTube title <em className={copy.youtubeTitle.length > YT_TITLE_MAX ? 'over' : ''}>{copy.youtubeTitle.length}/{YT_TITLE_MAX}</em></span>
            <input type="text" value={copy.youtubeTitle} maxLength={YT_TITLE_MAX} onChange={(e) => edit({ youtubeTitle: e.target.value })} />
            <button type="button" className="btn xs" onClick={() => void copyText('title', copy.youtubeTitle)}>{copied === 'title' ? 'Copied' : 'Copy'}</button>
          </label>
          <label className="vw-copy-field">
            <span className="vw-copy-label">Description</span>
            <textarea rows={7} value={copy.description} onChange={(e) => edit({ description: e.target.value })} />
            <button type="button" className="btn xs" onClick={() => void copyText('desc', copy.description)}>{copied === 'desc' ? 'Copied' : 'Copy'}</button>
          </label>
          <label className="vw-copy-field">
            <span className="vw-copy-label">Tags <em>{copy.tags.length}</em></span>
            <input type="text" value={copy.tags.join(', ')} onChange={(e) => edit({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} />
            <button type="button" className="btn xs" onClick={() => void copyText('tags', copy.tags.join(', '))}>{copied === 'tags' ? 'Copied' : 'Copy'}</button>
          </label>
          <label className="vw-copy-field">
            <span className="vw-copy-label">Facebook caption <em className={copy.facebook.split('\n')[0].length > FB_SOFT ? 'over' : ''}>{copy.facebook.split('\n')[0].length}/{FB_SOFT}</em></span>
            <textarea rows={4} value={copy.facebook} onChange={(e) => edit({ facebook: e.target.value })} />
            <button type="button" className="btn xs" onClick={() => void copyText('fb', copy.facebook)}>{copied === 'fb' ? 'Copied' : 'Copy'}</button>
          </label>
        </div>
      )}
    </section>
  )
}
