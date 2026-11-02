// Post: pick a render, choose where it goes, check it against the platforms' rules (facts read from the file), review the
// copy, then Approve. Approving is a native dialog in the main process; nothing is posted before it, and the post can only be
// started with the single-use token that dialog hands back. A failed step turns the job red with the platform's own words.
import { useEffect, useMemo, useState } from 'react'
import { useVideoStore } from '../videoStore'
import { useEditorialStore } from '../../editorial/editorialStore'
import { useStore } from '../../store'
import { renderBanner } from '../../export'
import { loadBaseAssets } from '../../core/assets'
import { buildCues, toSrt } from '../ai/transcript'
import { probeRender } from './probeRender'
import { checkFacebookPost, validateReel, validateYouTubeMedia, buildYouTubeResource, type CheckResult, type MediaFacts } from '../../../electron/video-publish/validators.mjs'
import { usePublishStatus } from './PublishConnections'

interface RenderEntry { id: string; name: string; size: number; at: number; exists: boolean }
interface Step { name: string; status: string; error: string | null }
interface Dest { kind: string; state: string; error: string | null; steps: Step[]; result: { url?: string } | null; privacyStatus?: string; postState?: string }
interface Job { id: string; status: string; createdAt: number; title: string; file?: string; destinations: Dest[]; schedule: { at: string | null }; dryRun?: boolean }
type Api = { vpubRenders?: () => Promise<{ renders?: RenderEntry[] }>; vpubApprove?: (i: unknown) => Promise<{ ok: boolean; problems?: { message: string }[]; cancelled?: boolean; approvalToken?: string; error?: string }>; vpubStart?: (i: unknown) => Promise<{ ok: boolean; jobId?: string; error?: string }>; vpubJobs?: () => Promise<{ jobs?: Job[] }>; vpubRetry?: (id: string) => Promise<unknown>; vpubCancel?: (id: string) => Promise<unknown>; onVpubUpdate?: (cb: (j: Job) => void) => () => void }
const esb = () => (window as unknown as { esb?: Api }).esb
const KIND: Record<string, string> = { youtube: 'YouTube', facebook_reel: 'Facebook Reel', facebook_video: 'Facebook video' }
const STEP_DONE: Record<string, string> = { done: '✓', running: '…', failed: '✕', pending: '·', waiting: '⏳' }

export function PublishPost({ initialRenderId }: { initialRenderId?: string }) {
  const project = useVideoStore((s) => s.project)
  const setVideoCopy = useVideoStore((s) => s.setVideoCopy)
  const draft = useEditorialStore((s) => s.draft)
  const { status } = usePublishStatus()
  const copy = project.videoCopy

  const [renders, setRenders] = useState<RenderEntry[]>([])
  const [renderId, setRenderId] = useState(initialRenderId ?? '')
  const [facts, setFacts] = useState<{ facts: MediaFacts; unreadable: string[] } | null>(null)
  const [factsErr, setFactsErr] = useState('')
  const [yt, setYt] = useState({ on: true, privacy: 'private' as 'private' | 'unlisted' | 'public' })
  const [reel, setReel] = useState({ on: false, state: 'DRAFT' as 'DRAFT' | 'PUBLISHED' })
  const [feed, setFeed] = useState({ on: false, state: 'DRAFT' as 'DRAFT' | 'PUBLISHED' })
  const [when, setWhen] = useState('')
  const [title, setTitle] = useState(copy?.youtubeTitle || project.name || '')
  const [desc, setDesc] = useState(copy?.description || '')
  const [tags, setTags] = useState((copy?.tags ?? []).join(', '))
  const [fbText, setFbText] = useState(copy?.facebook || '')
  const [thumb, setThumb] = useState(true)
  const [caps, setCaps] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [jobs, setJobs] = useState<Job[]>([])

  const loadRenders = () => { void esb()?.vpubRenders?.().then((r) => { const list = (r?.renders ?? []).filter((x) => x.exists); setRenders(list); setRenderId((cur) => cur || list[0]?.id || '') }).catch(() => {}) }
  const loadJobs = () => { void esb()?.vpubJobs?.().then((r) => setJobs((r?.jobs ?? []).slice(-6).reverse())).catch(() => {}) }
  useEffect(() => { loadRenders(); loadJobs(); return esb()?.onVpubUpdate?.((j) => setJobs((cur) => [j, ...cur.filter((x) => x.id !== j.id)].slice(0, 6))) }, [])
  useEffect(() => { if (initialRenderId) setRenderId(initialRenderId) }, [initialRenderId])

  // the facts are read from the chosen file, not from the export settings
  const chosen = renders.find((r) => r.id === renderId)
  useEffect(() => {
    setFacts(null); setFactsErr('')
    if (!chosen) return
    let live = true
    probeRender(chosen.id, chosen.size).then((f) => { if (live) setFacts(f) }).catch((e) => { if (live) setFactsErr((e as Error).message) })
    return () => { live = false }
  }, [chosen?.id, chosen?.size])

  const link = draft.slug ? `https://esbpowerline.com/articles/${draft.slug}` : ''
  const transcript = useMemo(() => Object.values(project.transcripts ?? {})[0], [project.transcripts])
  const srt = useMemo(() => (transcript ? toSrt(buildCues(transcript.words)) : ''), [transcript])
  const scheduleIso = when ? new Date(when).toISOString() : null
  const anyDest = yt.on || reel.on || feed.on

  // rules, checked here for an instant answer and again in main before the Approve dialog and again before upload
  const checks = useMemo(() => {
    const out: { label: string; res: CheckResult }[] = []
    if (!facts) return out
    const f = facts.facts
    if (yt.on) { const r = validateYouTubeMedia(f); const b = buildYouTubeResource({ title, description: desc, tags: tags.split(',').map((t) => t.trim()).filter(Boolean), privacyStatus: yt.privacy, publishAt: scheduleIso }); out.push({ label: 'YouTube', res: { ok: r.ok && b.ok, problems: [...r.problems, ...b.problems], warnings: [...r.warnings, ...b.warnings] } }) }
    if (reel.on) { const r = validateReel(f); const p = checkFacebookPost({ state: scheduleIso && reel.state !== 'DRAFT' ? 'SCHEDULED' : reel.state, scheduledAt: scheduleIso }); out.push({ label: 'Facebook Reel', res: { ok: r.ok && p.ok, problems: [...r.problems, ...p.problems], warnings: [...r.warnings, ...p.warnings] } }) }
    if (feed.on) { const p = checkFacebookPost({ state: scheduleIso && feed.state !== 'DRAFT' ? 'SCHEDULED' : feed.state, scheduledAt: scheduleIso }); out.push({ label: 'Facebook video', res: p }) }
    return out
  }, [facts, yt, reel, feed, title, desc, tags, scheduleIso])

  const unreadable = facts?.unreadable ?? []
  const problems = checks.flatMap((c) => c.res.problems.map((p) => `${c.label}: ${p.message}`))
  const warnings = [...checks.flatMap((c) => c.res.warnings.map((p) => `${c.label}: ${p.message}`)), ...unreadable.map((u) => `The ${u} of this file could not be read, so it was not checked.`)]
  const needs: string[] = []
  const cred = status?.credentials
  if (yt.on && !cred?.youtube.connected) needs.push('Connect YouTube first (Connections tab).')
  if ((reel.on || feed.on) && !cred?.facebook.connected) needs.push('Connect the Facebook Page first (Connections tab).')
  if (caps && yt.on && !cred?.youtube.scopes.some((s) => s.endsWith('/youtube.force-ssl'))) needs.push('Uploading captions needs the extra YouTube permission: tick it in Connections and connect again.')
  if (!title.trim()) needs.push('Write a title.')
  const ready = !!chosen && !!facts && anyDest && !problems.length && !needs.length

  const keepCopy = () => setVideoCopy({ youtubeTitle: title, description: desc, tags: tags.split(',').map((t) => t.trim()).filter(Boolean), facebook: fbText, model: '', at: Date.now() })

  const approveAndPost = async () => {
    if (!chosen || !facts) return
    setBusy(true); setErr(''); setNote('')
    try {
      let thumbnail: Uint8Array | undefined
      if (yt.on && thumb) {
        try { const blob = await renderBanner(useStore.getState().doc, 'yt', await loadBaseAssets(), 1, 'jpeg', 0.9); thumbnail = new Uint8Array(await blob.arrayBuffer()) } catch { /* no thumbnail: the post goes without one and says so */ }
      }
      const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean)
      const payload = {
        renderId: chosen.id,
        metadata: { title: title.trim(), description: desc, tags: tagList, categoryId: '25', defaultLanguage: transcript?.lang || 'en', link, aiVoice: false, captionsSrt: yt.on && caps ? srt : '', captionLanguage: transcript?.lang || 'en', facebookDescription: fbText },
        destinations: [
          ...(yt.on ? [{ kind: 'youtube', privacyStatus: yt.privacy }] : []),
          ...(reel.on ? [{ kind: 'facebook_reel', state: reel.state }] : []),
          ...(feed.on ? [{ kind: 'facebook_video', state: feed.state }] : []),
        ],
        schedule: { at: scheduleIso },
        facts: facts.facts,
        thumbnail,
      }
      keepCopy()
      const a = await esb()!.vpubApprove!(payload)
      if (!a.ok) {
        if (a.cancelled) setNote('Not approved. Nothing was posted.')
        else setErr(a.problems?.length ? a.problems.map((p) => p.message).join(' ') : a.error ?? 'Not approved.')
        return
      }
      const s = await esb()!.vpubStart!({ ...payload, approvalToken: a.approvalToken })
      if (!s.ok) { setErr(s.error ?? 'The post could not be started.'); return }
      setNote('Approved. The upload is running; you can keep working. Progress is below.')
      loadJobs()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (status && !status.ok && !status.credentials) return <p className="vw-hint vw-error" role="alert">{status.error ?? 'Publishing is not available.'}</p>

  return (
    <div className="vw-pub-post">
      {status?.dryRun && <p className="vw-hint vw-warn" role="note">TEST RUN: posts go to a fake local server. Nothing leaves this PC.</p>}
      <section className="vw-sec" aria-label="Render to post">
        <div className="vw-sec-head"><h4 className="vw-sec-title">Render</h4></div>
        {renders.length ? (
          <select value={renderId} onChange={(e) => setRenderId(e.target.value)} aria-label="Render to post" className="vw-pub-select">
            {renders.map((r) => <option key={r.id} value={r.id}>{r.name} · {(r.size / 1048576).toFixed(1)} MB</option>)}
          </select>
        ) : <p className="vw-hint">No render yet. Export the video, or queue sizes in the Renders tab.</p>}
        {factsErr && <p className="vw-hint vw-error" role="alert">{factsErr}</p>}
        {chosen && !facts && !factsErr && <p className="vw-hint" role="status">Reading the file…</p>}
        {facts && <p className="vw-hint">{facts.facts.width}×{facts.facts.height} · {Math.round((facts.facts.durationSec ?? 0) * 10) / 10} s · {facts.facts.fps ?? '?'} fps {facts.facts.fpsMode === 'variable' ? '(variable)' : ''} · {facts.facts.videoCodec ?? '?'} / {facts.facts.audioCodec ?? 'no sound'}</p>}
      </section>

      <section className="vw-sec" aria-label="Where to post">
        <div className="vw-sec-head"><h4 className="vw-sec-title">Where</h4></div>
        <label className="vw-cut-row vw-check"><input type="checkbox" checked={yt.on} onChange={(e) => setYt({ ...yt, on: e.target.checked })} /><span>YouTube</span></label>
        {yt.on && <label className="vw-cut-row"><span className="vw-cut-label">Visibility</span><select value={yt.privacy} onChange={(e) => setYt({ ...yt, privacy: e.target.value as typeof yt.privacy })} aria-label="YouTube visibility"><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></label>}
        <label className="vw-cut-row vw-check"><input type="checkbox" checked={reel.on} onChange={(e) => setReel({ ...reel, on: e.target.checked })} /><span>Facebook Reel (9:16, 3–90 s)</span></label>
        {reel.on && <label className="vw-cut-row"><span className="vw-cut-label">State</span><select value={reel.state} onChange={(e) => setReel({ ...reel, state: e.target.value as typeof reel.state })} aria-label="Reel state"><option value="DRAFT">Draft (not public)</option><option value="PUBLISHED">Published</option></select></label>}
        <label className="vw-cut-row vw-check"><input type="checkbox" checked={feed.on} onChange={(e) => setFeed({ ...feed, on: e.target.checked })} /><span>Facebook feed video</span></label>
        {feed.on && <label className="vw-cut-row"><span className="vw-cut-label">State</span><select value={feed.state} onChange={(e) => setFeed({ ...feed, state: e.target.value as typeof feed.state })} aria-label="Feed video state"><option value="DRAFT">Draft (not public)</option><option value="PUBLISHED">Published</option></select></label>}
        <label className="vw-cut-row"><span className="vw-cut-label">Go live at</span><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Scheduled time" /></label>
        <p className="vw-hint">{when ? 'The platform holds the post until then. Once it is scheduled, change or cancel it on YouTube Studio or Facebook (this app’s permission cannot delete it).' : 'Leave empty to post as soon as the upload finishes (private or draft where you chose that).'}</p>
      </section>

      <section className="vw-sec" aria-label="Copy">
        <div className="vw-sec-head"><h4 className="vw-sec-title">Copy</h4>{copy?.model ? <span className="vw-tag" data-tag="caption">AI draft</span> : null}</div>
        <label className="vw-copy-field"><span className="vw-copy-label">Title <em className={title.length > 100 ? 'over' : ''}>{title.length}/100</em></span><input type="text" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="vw-copy-field"><span className="vw-copy-label">Description</span><textarea rows={5} value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
        <label className="vw-copy-field"><span className="vw-copy-label">Tags</span><input type="text" value={tags} onChange={(e) => setTags(e.target.value)} /></label>
        {(reel.on || feed.on) && <label className="vw-copy-field"><span className="vw-copy-label">Facebook caption</span><textarea rows={3} value={fbText} onChange={(e) => setFbText(e.target.value)} /></label>}
        {!copy && <p className="vw-hint">Write the copy with AI in the Story tab, or type it here.</p>}
        {yt.on && <label className="vw-cut-row vw-check"><input type="checkbox" checked={thumb} onChange={(e) => setThumb(e.target.checked)} /><span>Use the story banner as the YouTube thumbnail</span></label>}
        {yt.on && <label className="vw-cut-row vw-check"><input type="checkbox" checked={caps} disabled={!srt} onChange={(e) => setCaps(e.target.checked)} /><span>{srt ? 'Upload the reviewed transcript as YouTube captions' : 'Captions: make a transcript in the Captions tab first'}</span></label>}
        {link && <p className="vw-hint">The article link goes in the Facebook first comment and the YouTube description.</p>}
      </section>

      <section className="vw-sec" aria-label="Checks">
        <div className="vw-sec-head"><h4 className="vw-sec-title">Checks</h4></div>
        {problems.map((p) => <p key={p} className="vw-hint vw-error" role="alert">{p}</p>)}
        {needs.map((p) => <p key={p} className="vw-hint vw-error" role="alert">{p}</p>)}
        {warnings.map((p) => <p key={p} className="vw-hint vw-warn" role="status">{p}</p>)}
        {ready && !warnings.length && <p className="vw-hint" role="status">Everything checks out against the platforms’ rules.</p>}
        <div className="vw-transcript-actions"><button type="button" className="btn primary" onClick={() => void approveAndPost()} disabled={!ready || busy} aria-busy={busy}>{busy ? 'Waiting for your approval…' : 'Approve…'}</button></div>
        <p className="vw-hint">A window from the app asks you to approve exactly what will be posted and where. Nothing is posted before you press “Approve and post” in it.</p>
        {note && <p className="vw-hint" role="status">{note}</p>}
        {err && <p className="vw-hint vw-error" role="alert">{err}</p>}
      </section>

      {jobs.length > 0 && (
        <section className="vw-sec" aria-label="Posts">
          <div className="vw-sec-head"><h4 className="vw-sec-title">Posts</h4></div>
          <ul className="vw-q-list">
            {jobs.map((j) => (
              <li key={j.id} className={`vw-q-job st-${j.status}`}>
                <div className="vw-q-head"><b>{j.title}</b><span className="vw-hint">{new Date(j.createdAt).toLocaleString()}{j.dryRun ? ' · test run' : ''}</span></div>
                {j.destinations.map((d) => (
                  <div key={d.kind} className="vw-q-out">
                    <div className="vw-q-line">
                      <span className="vw-q-aspect">{KIND[d.kind] ?? d.kind}</span>
                      <span className="vw-q-status">{d.state}</span>
                      <span className="vw-q-actions">
                        {d.result?.url && <a href={d.result.url} target="_blank" rel="noreferrer" className="btn xs">Open</a>}
                        {(d.state === 'failed' || d.state === 'paused') && <button type="button" className="btn xs" onClick={() => void esb()?.vpubRetry?.(j.id)}>Retry</button>}
                      </span>
                    </div>
                    <div className="vw-q-steps">{d.steps.map((s) => <span key={s.name} className={`vw-q-step st-${s.status}`} title={s.error ?? s.status}>{STEP_DONE[s.status] ?? '·'} {s.name}</span>)}</div>
                    {d.error && <p className="vw-hint vw-error" role="alert">{d.error}</p>}
                    {d.steps.filter((s) => s.error).map((s) => <p key={s.name} className="vw-hint vw-error" role="alert">{s.name}: {s.error}</p>)}
                  </div>
                ))}
                {(j.status === 'running' || j.status === 'queued') && <div className="vw-transcript-actions"><button type="button" className="btn xs" onClick={() => void esb()?.vpubCancel?.(j.id)}>Stop this post</button></div>}
              </li>
            ))}
          </ul>
          <p className="vw-hint">Views and reactions are planned: they need extra read-only permissions that you have not agreed to yet.</p>
        </section>
      )}
    </div>
  )
}
