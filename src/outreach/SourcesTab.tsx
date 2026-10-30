// What the campaign may say. Material comes from the Editorial story on the desk, a web page, a PDF or Word file, or
// pasted text; the Research AI turns each into talking points, every one carrying the source's own sentence (checked
// to be in it). The Letter AI may use only the points that are ticked here, and the Review flags any figure in the
// letter that no source contains.

import { useRef, useState } from 'react'
import { useOutreachStore, uid } from './outreachStore'
import { researchSource } from './outreachAi'
import { OUTREACH_BLUEPRINTS } from './outreachAi'
import { useEditorialStore } from '../editorial/editorialStore'
import { useStoryQueue } from '../editorial/storyQueue'
import { parseArticleDocument } from '../editorial/extract'
import { readDocument } from '../editorial/importDocument'
import { aiFor, aiPaused, providerMeta, loadAiSettings, roleProvider } from '../editorial/aiProviders'
import { ProviderMark } from '../editorial/ProviderMark'
import { Icon } from '../ui/Icon'
import { Seg } from '../ui/controls'
import { FileTypePair, FileTypeIcon } from '../editorial/FileTypeIcon'
import type { Source } from './types'

const CAP = 24_000
const KIND_ICON = { story: 'newspaper', link: 'link', file: 'filePlus', text: 'text' } as const

export function SourcesTab() {
  const s = useOutreachStore()
  const c = s.campaign()
  const draft = useEditorialStore((e) => e.draft)
  const story = useStoryQueue((q) => q.stories.find((x) => x.id === q.activeId))
  const [mode, setMode] = useState<'story' | 'link' | 'file' | 'text'>('link')
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openSrc, setOpenSrc] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const ai = aiFor('research')
  const aiName = providerMeta(ai?.provider ?? roleProvider(loadAiSettings(), 'research')).name
  const desktop = !!window.esb?.fetchUrl
  const liveSlug = story?.publishedSlug || story?.publishedUrl?.match(/\/articles\/([^/?#]+)/)?.[1]

  const add = (src: Omit<Source, 'id' | 'points' | 'addedAt'>) => {
    if (!c) return
    if (src.text.trim().length < 80) { setError('That source has too little text to draw on.'); return }
    s.addSource({ ...src, text: src.text.slice(0, CAP), id: uid('src'), points: [], addedAt: Date.now() })
    s.addLog('info', `Source added: ${src.title}`)
    setError(null)
  }

  const addStory = () => {
    const body = [draft.headline, draft.deck, draft.body].filter((x) => x?.trim()).join('\n\n')
    add({ kind: 'story', title: draft.headline.trim() || 'Editorial story', url: liveSlug ? `https://esbpowerline.com/articles/${liveSlug}` : undefined, text: body })
  }
  const addLink = async () => {
    const u = url.trim()
    if (!/^https:\/\/\S+$/i.test(u)) { setError('Paste a full https:// link'); return }
    setBusy('link'); setError(null)
    try {
      const r = await window.esb!.fetchUrl(u, { timeoutMs: 20_000 })
      if (!r.ok || !(r.html ?? r.body)) throw new Error(r.error || 'The page did not answer')
      const a = parseArticleDocument(String(r.html ?? r.body), r.url || u)
      const t = [a.title, a.deck, ...a.paragraphs].filter(Boolean).join('\n\n')
      if (!a.paragraphs.length) throw new Error('No article text found on that page — paste the text instead')
      add({ kind: 'link', title: a.title || new URL(u).hostname, url: a.canonicalUrl || u, text: t })
      setUrl('')
    } catch (e) { setError((e as Error).message) } finally { setBusy(null) }
  }
  const addFile = async (f: File) => {
    setBusy('file'); setError(null)
    try {
      const d = await readDocument(f)
      if (d.needsVision || !d.text.trim()) throw new Error(`${f.name}: its text cannot be read here (a scan or an old Bangla font). Paste the text instead.`)
      add({ kind: 'file', title: f.name, text: d.text })
    } catch (e) { setError((e as Error).message) } finally { setBusy(null) }
  }
  const addText = () => { const t = text.trim(); add({ kind: 'text', title: t.split('\n')[0].slice(0, 70) || 'Pasted text', text: t }); if (t.length >= 80) setText('') }

  const research = async (src: Source) => {
    if (!c) return
    setBusy(src.id); setError(null)
    try {
      const purpose = OUTREACH_BLUEPRINTS.find((b) => b.id === c.blueprint)?.label ?? 'an ESB Power Line offer'
      const r = await researchSource(src, purpose)
      s.updateSource(src.id, { points: r.points })
      s.addLog(r.points.length ? 'ok' : 'warn', `${src.title}: ${r.points.length} talking point${r.points.length === 1 ? '' : 's'} (${r.model})${r.dropped ? ` · ${r.dropped} dropped — its quote is not in the source` : ''}`)
    } catch (e) { setError((e as Error).message); s.addLog('error', `Research: ${(e as Error).message}`) } finally { setBusy(null) }
  }

  if (!c) return <div className="or-tab"><div className="or-empty"><p>Open or create a campaign to give it sources.</p></div></div>

  return (
    <div className="or-tab">
      <div className="or-left-head">
        <Seg<typeof mode> className="or-filter" value={mode} onChange={(v) => { setMode(v); setError(null) }} options={[
          { value: 'link', label: 'Link', tip: 'A web page — read the same way Editorial reads a story' },
          { value: 'story', label: 'Story', tip: 'The story on the Editorial desk' },
          { value: 'file', label: 'File', tip: 'PDF or Word' },
          { value: 'text', label: 'Text', tip: 'Paste any text' },
        ]} />
        {mode === 'link' && (
          <div className="or-test">
            <input className="or-input" type="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addLink() }} aria-label="Source link" />
            <button type="button" className="btn" onClick={() => void addLink()} disabled={!desktop || busy === 'link' || !url.trim()} data-tip={desktop ? 'Read the page and add its text' : 'Reading web pages needs the desktop app — paste the text instead'}><Icon name={busy === 'link' ? 'refresh' : 'plus'} size={13} className={busy === 'link' ? 'spin' : ''} /><span>Add</span></button>
          </div>
        )}
        {mode === 'story' && (
          draft.headline.trim() ? (
            // the whole story as it stands on the Editorial desk, read before it is added — not just its first line
            <div className="or-story">
              <div className="or-story-scroll">
                <b>{draft.headline}</b>
                {draft.deck.trim() && <p className="or-story-deck">{draft.deck}</p>}
                {draft.body.split(/\n{2,}/).filter((p) => p.trim()).map((p, i) => <p key={i}>{p}</p>)}
              </div>
              <button type="button" className="btn primary or-wide" onClick={addStory}><Icon name="plus" size={14} /><span>Add this story</span></button>
            </div>
          ) : <p className="or-muted">No story on the Editorial desk yet. Open one there and it appears here in full.</p>
        )}
        {mode === 'file' && (
          <>
            <button type="button" className="or-drop" onClick={() => file.current?.click()} disabled={busy === 'file'}>
              <FileTypePair size={38} />
              <b>{busy === 'file' ? 'Reading the file' : 'Choose a PDF or Word file'}</b>
              <span>Read on this computer, as in Editorial — nothing is uploaded</span>
            </button>
            <input ref={file} type="file" accept=".pdf,.docx" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void addFile(f); e.target.value = '' }} />
          </>
        )}
        {mode === 'text' && (
          <>
            <textarea className="or-input or-paste" rows={4} placeholder="Paste a press release, a report summary or your notes" value={text} onChange={(e) => setText(e.target.value)} aria-label="Source text" />
            <button type="button" className="btn sm or-wide" onClick={addText} disabled={text.trim().length < 80}><Icon name="plus" size={13} /><span>Add text</span></button>
          </>
        )}
        {error && <p className="or-note">{error}</p>}
      </div>

      <div className="or-list or-sources">
        {!c.sources.length ? (
          <div className="or-empty"><Icon name="quote" size={22} /><b>No sources</b><p>Add what this campaign should draw on. The AI writes only from ticked talking points — each one quotes its source.</p></div>
        ) : c.sources.map((src) => (
          <article key={src.id} className="or-src">
            <header>
              {src.kind === 'file' && /\.(pdf|docx)$/i.test(src.title)
                ? <FileTypeIcon kind={src.title.toLowerCase().endsWith('.pdf') ? 'pdf' : 'docx'} size={30} className="or-src-file" />
                : <span className="or-src-ic"><Icon name={KIND_ICON[src.kind]} size={13} /></span>}
              <div className="or-src-t"><b title={src.title}>{src.title}</b><span>{src.url ? new URL(src.url).hostname : src.kind === 'file' ? 'File' : src.kind === 'story' ? 'Editorial' : 'Pasted'} · {src.text.split(/\s+/).length} words</span></div>
              <button type="button" className="ibtn" aria-label={`Remove ${src.title}`} data-tip="Remove" onClick={() => s.removeSource(src.id)}><Icon name="x" size={13} /></button>
            </header>
            <button type="button" className="or-src-more" aria-expanded={openSrc === src.id} onClick={() => setOpenSrc(openSrc === src.id ? null : src.id)}>
              <Icon name="chevDown" size={12} className={openSrc === src.id ? 'open' : ''} /><span>{openSrc === src.id ? 'Hide the text' : 'Read it all'}</span>
            </button>
            {openSrc === src.id && <div className="or-src-full">{src.text.split(/\n{2,}/).filter((p) => p.trim()).map((p, i) => <p key={i}>{p}</p>)}</div>}
            {src.points.length > 0 && (
              <ul className="or-points">
                {src.points.map((p) => (
                  <li key={p.id} className={p.use ? 'on' : ''}>
                    <label>
                      <input type="checkbox" checked={p.use} onChange={(e) => s.updateSource(src.id, { points: src.points.map((x) => (x.id === p.id ? { ...x, use: e.target.checked } : x)) })} />
                      <span><b>{p.text}</b><q>{p.quote}</q></span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="btn sm ai-btn or-wide" data-provider={ai?.provider} onClick={() => void research(src)} disabled={!ai || aiPaused() || !!busy}
              data-tip={aiPaused() ? 'AI is OFF' : ai ? `${aiName} lists what a letter could cite, each with the source's own sentence` : `Add a ${aiName} key for the Research job`}>
              {busy === src.id ? <Icon name="refresh" size={13} className="spin" /> : ai ? <ProviderMark id={ai.provider} size={13} /> : <Icon name="sparkle" size={13} />}
              <span>{busy === src.id ? 'Reading' : src.points.length ? 'Find talking points again' : 'Find talking points'}</span>
            </button>
          </article>
        ))}
      </div>
    </div>
  )
}
