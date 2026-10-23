// Video bin → Story: turn the story on the Editorial desk into a first cut. Shows what the cut will hold before it
// replaces the timeline (the headline, each captioned point with its hold, the total length), and builds it from the
// banner and photo the desk already has. All media is rendered here to same-origin object URLs, so the export
// canvas never draws a cross-origin image.

import { useMemo, useState } from 'react'
import { useEditorialStore } from '../editorial/editorialStore'
import { useStore, imageAssets } from '../store'
import { useShellStore } from '../shell/shellStore'
import { renderBanner } from '../export'
import { loadBaseAssets } from '../core/assets'
import { CATEGORIES } from '../core/tokens'
import type { FormatId } from '../core/tokens'
import { Icon } from '../ui/Icon'
import { useVideoStore } from './videoStore'
import { buildStoryTimeline, holdFor, storyPoints } from './storyVideo'
import { formatShortTime } from './timeline'
import type { AspectRatio } from './timeline'

const FORMAT_FOR: Record<AspectRatio, FormatId> = { '16:9': 'web', '9:16': 'story', '1:1': 'sq', '4:5': 'fb45' }

async function photoUrl(): Promise<string | null> {
  const first = useStore.getState().images[0]
  const img = first ? imageAssets[first.id] : undefined
  if (!img || !img.naturalWidth) return null
  const scale = Math.min(1, 2560 / Math.max(img.naturalWidth, img.naturalHeight))
  const c = document.createElement('canvas')
  c.width = Math.round(img.naturalWidth * scale)
  c.height = Math.round(img.naturalHeight * scale)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.92))
  return blob ? URL.createObjectURL(blob) : null
}

export function StoryVideoPanel() {
  const draft = useEditorialStore((s) => s.draft)
  const categoryId = useStore((s) => s.doc.content.categoryId)
  const hasPhoto = useStore((s) => s.images.length > 0)
  const project = useVideoStore((s) => s.project)
  const loadProject = useVideoStore((s) => s.loadProject)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const points = useMemo(() => storyPoints(draft.deck, draft.body), [draft.deck, draft.body])
  const desk = CATEGORIES.find((c) => c.id === categoryId)?.name ?? 'ESB PowerLine'
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
      const base = await loadBaseAssets()
      const banner = await renderBanner(useStore.getState().doc, FORMAT_FOR[project.aspect], base, 1, 'jpeg', 0.92)
      const tl = buildStoryTimeline({
        aspect: project.aspect,
        headline: draft.headline,
        deck: draft.deck,
        body: draft.body,
        desk,
        credit: draft.credit || useStore.getState().doc.content.credit,
        bannerUrl: URL.createObjectURL(banner),
        photoUrl: await photoUrl(),
      })
      loadProject({ ...tl, fps: project.fps })
      setNote(`Built a ${formatShortTime(tl.duration)} cut — ${tl.clips.length} clips. Trim, re-time or add sound, then Export.`)
    } catch (e) {
      setNote('Could not build the cut: ' + ((e as Error).message || 'unknown error'))
    } finally {
      setBusy(false)
      setConfirm(false)
    }
  }

  return (
    <div className="vw-story">
      <div className="vw-story-head">
        <span className="vw-story-kicker">{desk}</span>
        <b>{draft.headline}</b>
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
    </div>
  )
}
