// Story → video: a first cut of a news video built from the Editorial draft, for the desk to trim and re-time.
//
// Shape of the cut (each piece is an ordinary clip the editor can move, trim or delete):
//   title    the banner rendered for this aspect, held while the headline reads
//   points   the story's photo with a slow move, one caption per key sentence, a lower third naming the desk
//   close    the photo again with "Read the full story on esbpowerline.com"
// Every word on screen comes from the draft. Nothing is summarised or invented here: the points are the deck and
// the opening sentences of the body, in order, cut at sentence ends.

import type { AspectRatio, Clip, VideoProject } from './timeline'
import { ASPECT_CONFIGS, createDefaultTimeline } from './timeline'

export interface StoryVideoInput {
  aspect: AspectRatio
  headline: string
  deck: string
  body: string
  desk: string
  credit?: string
  /** The banner rendered for this aspect (same-origin URL). */
  bannerUrl: string | null
  /** The story's photo without text (same-origin URL). */
  photoUrl: string | null
}

const MAX_POINTS = 4
const READ_WPS = 2.6 // a caption is held long enough to read aloud at a news pace

/** The sentences the video will caption: the deck, then the body's opening sentences, without repeats. */
export function storyPoints(deck: string, body: string, max = MAX_POINTS): string[] {
  const sentences = [deck, ...body.split(/\n+/)]
    .flatMap((p) => p.replace(/\s+/g, ' ').trim().match(/[^.!?।]+[.!?।]+["”’)]*|[^.!?।]+$/g) ?? [])
    .map((s) => s.trim())
    .filter((s) => s.split(' ').length >= 5)
  const out: string[] = []
  for (const s of sentences) {
    const key = s.toLowerCase().replace(/[^a-z0-9ঀ-৿]+/g, ' ').trim()
    if (out.some((o) => o.toLowerCase().replace(/[^a-z0-9ঀ-৿]+/g, ' ').trim() === key)) continue
    out.push(s.length > 220 ? s.slice(0, 217).replace(/\s+\S*$/, '') + ' …' : s)
    if (out.length >= max) break
  }
  return out
}

/** Seconds to hold a caption: its words at reading pace plus a beat, between 4 and 9 s. */
export function holdFor(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  return Math.round(Math.min(9, Math.max(4, words / READ_WPS + 1.2)) * 10) / 10
}

export function buildStoryTimeline(input: StoryVideoInput): VideoProject {
  const cfg = ASPECT_CONFIGS[input.aspect]
  const base = createDefaultTimeline(input.aspect)
  const clips: Clip[] = []
  let t = 0
  const id = (k: string) => `story-${k}-${clips.length}`
  const still = (url: string | null, start: number, duration: number, title: string, kenBurns: 'in' | 'out' = 'in'): Clip | null =>
    url ? { id: id('v'), trackId: 'v1', title, kind: 'video', start, duration, in: 0, out: duration, color: '#2563eb', sourceUrl: url, still: true, kenBurns } : null

  // 1. title: the banner carries the headline itself
  const titleHold = Math.max(4, Math.min(7, holdFor(input.headline)))
  const banner = still(input.bannerUrl ?? input.photoUrl, t, titleHold, 'Banner')
  if (banner) clips.push(banner)
  if (!input.bannerUrl) clips.push({ id: id('h'), trackId: 'v2', title: 'Headline', kind: 'overlay', start: t, duration: titleHold, in: 0, out: titleHold, color: '#dc2626', overlayType: 'headline', overlayText: input.headline })
  t += titleHold

  // 2. points
  const points = storyPoints(input.deck, input.body)
  const pointsStart = t
  points.forEach((p, k) => {
    const d = holdFor(p)
    clips.push({ id: id('c'), trackId: 'c1', title: `Point ${k + 1}`, kind: 'caption', start: t, duration: d, in: 0, out: d, color: '#f59e0b', captionText: p })
    t += d
  })
  if (points.length) {
    const photo = still(input.photoUrl ?? input.bannerUrl, pointsStart, t - pointsStart, 'Photo', 'out')
    if (photo) clips.push(photo)
    const lt = Math.min(5, t - pointsStart)
    clips.push({ id: id('l'), trackId: 'v2', title: 'Lower third', kind: 'overlay', start: pointsStart, duration: lt, in: 0, out: lt, color: '#059669', overlayType: 'lower-third', overlayText: input.desk, overlaySub: input.credit ? `Photo: ${input.credit}` : 'ESB PowerLine' })
  }

  // 3. close
  const close = 4
  const end = still(input.photoUrl ?? input.bannerUrl, t, close, 'Close')
  if (end) clips.push(end)
  clips.push({ id: id('c'), trackId: 'c1', title: 'Read more', kind: 'caption', start: t, duration: close, in: 0, out: close, color: '#f59e0b', captionText: 'Read the full story on esbpowerline.com' })
  t += close

  return {
    ...base,
    id: `story-${Date.now().toString(36)}`,
    name: input.headline.slice(0, 80) || 'Story video',
    width: cfg.width,
    height: cfg.height,
    duration: Math.ceil(t * 10) / 10,
    clips,
  }
}
