// Video bin → Story: turn the story on the Editorial desk into a first cut. Shows what the cut will hold before it
// replaces the timeline (the headline, each captioned point with its hold, the total length), and builds it from the
// banner and photo the desk already has. All media is rendered here to same-origin object URLs, so the export
// canvas never draws a cross-origin image.

import { useMemo, useRef, useState } from 'react'
import { useEditorialStore } from '../editorial/editorialStore'
import { useStore, imageAssets } from '../store'
import { useShellStore } from '../shell/shellStore'
import { renderBanner } from '../export'
import { loadBaseAssets } from '../core/assets'
import { CATEGORIES } from '../core/tokens'
import type { FormatId } from '../core/tokens'
import { Icon } from '../ui/Icon'
import { useVideoStore } from './videoStore'
import { MAX_PHOTOS, STORY_STYLES, buildStoryTimeline, holdFor, quotesWithSpeakers, storyPoints, suggestBroll } from './storyVideo'
import type { StoryPhoto, StoryStyle } from './storyVideo'
import { VideoCopyPanel } from './VideoCopyPanel'
import { clipsForAsset, formatShortTime } from './timeline'
import type { AspectRatio, MediaAsset } from './timeline'
import { assetFromEntry, newAssetId, videoBridge } from './media'

const FORMAT_FOR: Record<AspectRatio, FormatId> = { '16:9': 'web', '9:16': 'story', '1:1': 'sq', '4:5': 'fb45' }

/** Keep a rendered still for the bin: in the desktop app it is written to userData through main (so a saved story
 * video finds it again after a restart); in the browser it stays an object URL for the session. */
async function keepStill(blob: Blob, name: string, w: number, h: number): Promise<MediaAsset> {
  const b = videoBridge()
  if (b?.videoStoreStill) {
    const entry = await b.videoStoreStill(name, new Uint8Array(await blob.arrayBuffer()))
    const asset = entry ? await assetFromEntry(entry, true) : null
    if (asset) return { ...asset, name }
  }
  const url = URL.createObjectURL(blob)
  return { id: newAssetId(), name, type: 'image', url, thumbnailUrl: url, duration: 0, size: blob.size, width: w, height: h, generated: true }
}

async function photoBlob(index = 0): Promise<{ blob: Blob; w: number; h: number } | null> {
  const first = useStore.getState().images[index]
  const img = first ? imageAssets[first.id] : undefined
  if (!img || !img.naturalWidth) return null
  const scale = Math.min(1, 2560 / Math.max(img.naturalWidth, img.naturalHeight))
  const c = document.createElement('canvas')
  c.width = Math.round(img.naturalWidth * scale)
  c.height = Math.round(img.naturalHeight * scale)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.92))
  return blob ? { blob, w: c.width, h: c.height } : null
}

export function StoryVideoPanel() {
  const draft = useEditorialStore((s) => s.draft)
  const categoryId = useStore((s) => s.doc.content.categoryId)
  const photoCount = useStore((s) => s.images.length)
  const hasPhoto = photoCount > 0
  const mediaAssets = useVideoStore((s) => s.mediaAssets)
  const addClips = useVideoStore((s) => s.addClips)
  const playhead = useVideoStore((s) => s.currentTime)
  const [style, setStyle] = useState<StoryStyle>('standard')
  const [quoteIdx, setQuoteIdx] = useState(-1)
  const project = useVideoStore((s) => s.project)
  const loadProject = useVideoStore((s) => s.loadProject)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)

  const points = useMemo(() => storyPoints(draft.deck, draft.body, style === 'short' ? 3 : undefined), [draft.deck, draft.body, style])
  const quotes = useMemo(() => quotesWithSpeakers(draft.body), [draft.body])
  const broll = useMemo(() => suggestBroll(mediaAssets, `${draft.headline} ${draft.deck} ${draft.body}`), [mediaAssets, draft.headline, draft.deck, draft.body])
  const desk = CATEGORIES.find((c) => c.id === categoryId)?.name ?? 'ESB Power Line'
  const total = Math.max(4, Math.min(7, holdFor(draft.headline))) + points.reduce((n, p) => n + holdFor(p), 0) + 4

  if (!draft.headline.trim()) {
    return (
      <div className="vw-story-empty">
        <Icon name="newspaper" size={20} />
        <p>Open a story on the Editorial desk and it can be cut into a video here: the banner, the photo and one caption per key sentence.</p>
        <button type="button" className="btn sm" onClick={() => useShellStore.getState().setWorkspace('editorial')}>Go to Editorial</button>
      </div>
    )
  }

  const build = async () => {
    setBusy(true)
    setNote(null)
    try {
      // the banner carries the headline; if it cannot be rendered, the title card sets the headline itself
      let banner: Blob | null = null
      try { banner = await renderBanner(useStore.getState().doc, FORMAT_FOR[project.aspect], await loadBaseAssets(), 1, 'jpeg', 0.92) } catch { banner = null }
      const slug = draft.headline.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'story'
      const bannerAsset = banner ? await keepStill(banner, `${slug}-banner-${project.aspect.replace(':', 'x')}.jpg`, project.width, project.height) : null
      const photo = await photoBlob()
      const photoAsset = photo ? await keepStill(photo.blob, `${slug}-photo.jpg`, photo.w, photo.h) : null
      // every other photo the desk has (v2): one still each, up to MAX_PHOTOS
      const extraAssets: MediaAsset[] = []
      for (let i = 1; i < Math.min(MAX_PHOTOS, useStore.getState().images.length); i++) {
        const pb = await photoBlob(i)
        if (pb) extraAssets.push(await keepStill(pb.blob, `${slug}-photo-${i + 1}.jpg`, pb.w, pb.h))
      }
      const photos: StoryPhoto[] = [photoAsset, ...extraAssets].filter((a): a is MediaAsset => !!a).map((a) => ({ url: a.url, assetId: a.id }))
      const tl = buildStoryTimeline({
        aspect: project.aspect,
        headline: draft.headline,
        deck: draft.deck,
        body: draft.body,
        desk,
        credit: draft.credit || useStore.getState().doc.content.credit,
        bannerUrl: bannerAsset?.url ?? null,
        photoUrl: photoAsset?.url ?? null,
        bannerAssetId: bannerAsset?.id,
        photoAssetId: photoAsset?.id,
        accent: CATEGORIES.find((c) => c.id === categoryId)?.accent,
        photos,
        style,
        quote: quoteIdx >= 0 ? quotes.named[quoteIdx] ?? null : null,
      })
      const bin = useVideoStore.getState().mediaAssets
      loadProject({ ...tl, fps: project.fps }, { assets: [...bin, ...[bannerAsset, photoAsset, ...extraAssets].filter((a): a is MediaAsset => !!a)], path: null, dirty: true })
      setNote(`Built a ${formatShortTime(tl.duration)} cut — ${tl.clips.length} clips. Trim, re-time or add sound, then Export.`)
      // the outline was scrolled down to the Build button: bring its headline back into view
      requestAnimationFrame(() => root.current?.closest('.vw-bin-content')?.scrollTo({ top: 0 }))
    } catch (e) {
      setNote('Could not build the cut: ' + ((e as Error).message || 'unknown error'))
    } finally {
      setBusy(false)
      setConfirm(false)
    }
  }

  return (
    <div className="vw-story" ref={root}>
      <div className="vw-story-head">
        <span className="vw-story-kicker">{desk}</span>
        <b>{draft.headline}</b>
      </div>
      <div className="vw-sec vw-story-style-sec">
        <div className="vw-sec-head"><h4 className="vw-sec-title">Cut style</h4></div>
        <div className="vw-story-styles" role="radiogroup" aria-label="Cut style">
          {STORY_STYLES.map((s) => (
            <button key={s.id} type="button" role="radio" aria-checked={style === s.id} className={`vw-story-style${style === s.id ? ' on' : ''}`} onClick={() => setStyle(s.id)}>
              <b>{s.label}</b>
              <span>{s.hint}</span>
            </button>
          ))}
        </div>
        {style === 'short' && project.aspect !== '9:16' && <p className="vw-hint">A Short is 9:16. This project is {project.aspect}; switch it in the shape menu above the monitor.</p>}
        {photoCount > 1 && <p className="vw-hint">{Math.min(photoCount, MAX_PHOTOS)} photos from the desk, one per key sentence.</p>}
      </div>
      <ol className="vw-story-points">
        <li><span>Title · banner</span><em>{formatShortTime(Math.max(4, Math.min(7, holdFor(draft.headline))))}</em></li>
        {points.map((p, k) => <li key={k}><span>{p}</span><em>{formatShortTime(holdFor(p))}</em></li>)}
        <li><span>Close · “Read the full story on esbpowerline.com”</span><em>{formatShortTime(4)}</em></li>
      </ol>
      <div className="vw-story-sum">
        <span>{project.aspect} · about {formatShortTime(total)}</span>
        <span>{hasPhoto ? 'Banner + photo' : 'Banner only (no photo on the desk)'}</span>
      </div>
      <div className="vw-sec vw-story-opts">
        <div className="vw-sec-head"><h4 className="vw-sec-title">Quote card</h4></div>
        {quotes.named.length ? (
          <label className="vw-story-quote">
            <select value={quoteIdx} onChange={(e) => setQuoteIdx(Number(e.target.value))} aria-label="Quote card">
              <option value={-1}>No quote card</option>
              {quotes.named.map((q, i) => <option key={q.quote} value={i}>{q.speaker}: “{q.quote.length > 60 ? q.quote.slice(0, 57) + '…' : q.quote}”</option>)}
            </select>
          </label>
        ) : <p className="vw-hint">No quote in this story names its speaker, so no quote card is offered.</p>}
        {quotes.unnamed > 0 && quotes.named.length > 0 && <p className="vw-hint">{quotes.unnamed} more quote{quotes.unnamed === 1 ? '' : 's'} with no named speaker are not offered.</p>}
        <div className="vw-sec-head"><h4 className="vw-sec-title">B-roll in your media</h4></div>
        {broll.length ? (
          <ul className="vw-cut-list vw-short-list">
            {broll.map(({ asset, matched }) => (
              <li key={asset.id}>
                <button type="button" className="vw-word" onClick={() => addClips(clipsForAsset(useVideoStore.getState().project, asset, playhead))}>Add {asset.name}</button>
                <div className="vw-hint">matches “{matched.join('”, “')}” in the story (by file name)</div>
              </li>
            ))}
          </ul>
        ) : <p className="vw-hint">No file in the media bin has a name that matches the story. Name files for what they show (for example sylhet-gas-field.mp4).</p>}
        <div className="vw-sec-head"><h4 className="vw-sec-title">Grid data card</h4></div>
        <p className="vw-hint">A figure from esbpowerline.com Grid data can be added from the Data tab, with its source line.</p>
      </div>
      {confirm ? (
        <div className="vw-story-confirm">
          <span>This replaces the current timeline.</span>
          <button type="button" className="btn sm" onClick={() => setConfirm(false)}>Keep it</button>
          <button type="button" className="btn sm primary" onClick={() => void build()} disabled={busy}>{busy ? 'Building…' : 'Replace'}</button>
        </div>
      ) : (
        <button type="button" className="btn primary vw-story-build" onClick={() => setConfirm(true)} disabled={busy}>
          <Icon name="video" size={14} /><span>Build story video</span>
        </button>
      )}
      {note && <p className="vw-story-note">{note}</p>}
      <VideoCopyPanel />
    </div>
  )
}
