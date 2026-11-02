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
import { migrateOverlayClip } from './titleModel'

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
  /** Bin entries for the banner and the photo, so a saved story video finds its stills again. */
  bannerAssetId?: string
  photoAssetId?: string
  /** The story's category colour, for the title card's accent. */
  accent?: string
  /** Story → video v2: every photo the desk has (up to MAX_PHOTOS); each key sentence gets the next one. Without it, `photoUrl` alone. */
  photos?: StoryPhoto[]
  /** The cut: standard (the whole story), short (a Short of 60 s at most), quote-first (opens on a quote card). */
  style?: StoryStyle
  /** A quote word for word from the story WITH its named speaker (never invented); adds a quote card. */
  quote?: StoryQuote | null
}

export interface StoryPhoto { url: string; assetId?: string }
export type StoryStyle = 'standard' | 'short' | 'quote-first'
export const STORY_STYLES: { id: StoryStyle; label: string; hint: string }[] = [
  { id: 'standard', label: 'Standard', hint: 'Banner, one caption per key sentence, close card' },
  { id: 'short', label: 'Short (60 s at most)', hint: 'For 9:16 Shorts and Reels: fewer points, a shorter close' },
  { id: 'quote-first', label: 'Quote first', hint: 'Opens on the quote card when the story has a named speaker' },
]
export interface StoryQuote { quote: string; speaker: string; role?: string }
export const MAX_PHOTOS = 4
export const SHORT_MAX_SECONDS = 60
export const QUOTE_SECONDS = 8

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

const NAME = String.raw`[A-Z][\p{L}'.-]+(?:\s+(?:[A-Z][\p{L}'.-]+|bin|ibn|al|de|van|von|ur|ul|e)){0,4}`
const SAID = String.raw`(?:said|says|told [A-Za-z ]{0,30}?|added|noted|explained|stated|according to|commented)`

/** The named speaker of a quote, taken from the story's own words next to it ("," said Name / Name said, "…"). Null when the story does not name one. */
export function speakerOfQuote(body: string, quote: string): { speaker: string; role?: string } | null {
  const flat = body.replace(/\s+/g, ' ')
  const at = flat.indexOf(quote)
  if (at < 0) return null
  const after = flat.slice(at + quote.length, at + quote.length + 140)
  const before = flat.slice(Math.max(0, at - 140), at)
  const afterM = after.match(new RegExp(`^[,.]?[”"']?\\s*,?\\s*(?:${SAID})\\s+(${NAME})(?:,\\s*(?:the\\s+)?([a-z][^.,;”"]{3,70}))?`, 'u'))
  if (afterM) return { speaker: afterM[1].trim(), ...(afterM[2] ? { role: afterM[2].trim() } : {}) }
  const afterM2 = after.match(new RegExp(`^[,.]?[”"']?\\s*,?\\s*(${NAME})\\s+(?:${SAID})\\b`, 'u'))
  if (afterM2) return { speaker: afterM2[1].trim() }
  const beforeM = before.match(new RegExp(`(${NAME})(?:,\\s*(?:the\\s+)?([a-z][^.,;”"]{3,70}),)?\\s+(?:${SAID})[,:]?\\s*[“"']?\\s*$`, 'u'))
  if (beforeM) return { speaker: beforeM[1].trim(), ...(beforeM[2] ? { role: beforeM[2].trim() } : {}) }
  return null
}

/** Quotes in the story (four words or more, word for word) whose speaker the story names; the rest are counted, never given a made-up speaker. */
export function quotesWithSpeakers(body: string, max = 3): { named: StoryQuote[]; unnamed: number } {
  const named: StoryQuote[] = []
  let unnamed = 0
  const seen = new Set<string>()
  for (const m of body.matchAll(/[“"]([^”"]{8,600})[”"]/g)) {
    const q = m[1].replace(/\s+/g, ' ').trim()
    if (q.split(' ').length < 4 || q.length > 260 || seen.has(q)) continue
    seen.add(q)
    const s = speakerOfQuote(body, q)
    if (s) { if (named.length < max) named.push({ quote: q, ...s }) } else unnamed++
  }
  return { named, unnamed }
}

/** Bin items whose FILE NAME shares a word with the story (a guess for the editor to accept, never added by itself). */
export function suggestBroll<A extends { id: string; name: string; type: string; removed?: boolean; missing?: boolean }>(assets: A[], storyText: string, max = 6): { asset: A; matched: string[] }[] {
  const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'will', 'said', 'new', 'mp4', 'mov', 'mkv', 'jpg', 'jpeg', 'png', 'webm', 'clip', 'video', 'sample', 'final', 'copy'])
  const words = (s: string) => (s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((w) => !STOP.has(w) && !/^\d+$/.test(w))
  const story = new Set(words(storyText))
  return assets
    .filter((a) => (a.type === 'video' || a.type === 'image') && !a.removed && !a.missing)
    .map((asset) => ({ asset, matched: [...new Set(words(asset.name.replace(/\.[a-z0-9]+$/i, '')))].filter((w) => story.has(w)) }))
    .filter((r) => r.matched.length)
    .sort((a, b) => b.matched.length - a.matched.length)
    .slice(0, max)
}

export function buildStoryTimeline(input: StoryVideoInput): VideoProject {
  const cfg = ASPECT_CONFIGS[input.aspect]
  const base = createDefaultTimeline(input.aspect)
  const clips: Clip[] = []
  let t = 0
  const style: StoryStyle = input.style ?? 'standard'
  // every photo the story has (v2); without the list, the single photo as before
  const photos: StoryPhoto[] = (input.photos?.length ? input.photos : input.photoUrl ? [{ url: input.photoUrl, assetId: input.photoAssetId }] : []).slice(0, MAX_PHOTOS)
  const id = (k: string) => `story-${k}-${clips.length}`
  const assetFor = (url: string | null) => (url && url === input.bannerUrl ? input.bannerAssetId : photos.find((p) => p.url === url)?.assetId ?? (url && url === input.photoUrl ? input.photoAssetId : undefined))
  const still = (url: string | null, start: number, duration: number, title: string, kenBurns: 'in' | 'out' = 'in'): Clip | null =>
    url ? { id: id('v'), trackId: 'v1', title, kind: 'video', start, duration, in: 0, out: duration, color: '#2563eb', sourceUrl: url, mediaAssetId: assetFor(url), still: true, kenBurns } : null
  const firstPhoto = photos[0]?.url ?? null
  const quoteCard = (start: number): Clip | null => input.quote
    ? { id: id('q'), trackId: 'v2', title: 'Quote card', kind: 'overlay', start, duration: QUOTE_SECONDS, in: 0, out: QUOTE_SECONDS, color: '#7c3aed', titleData: { template: 'quote', fields: { quote: input.quote.quote, speaker: input.quote.speaker, speakerRole: input.quote.role ?? '' } } }
    : null

  // 1. title: the banner carries the headline itself
  const short = style === 'short'
  const titleHold = short ? 4 : Math.max(4, Math.min(7, holdFor(input.headline)))
  const closeLen = short ? 3 : 4
  const banner = still(input.bannerUrl ?? firstPhoto, t, titleHold, 'Banner')
  if (banner) clips.push(input.bannerUrl ? { ...banner, branded: true } : banner)
  if (!input.bannerUrl) clips.push({ id: id('h'), trackId: 'v2', title: 'Headline', kind: 'overlay', start: t, duration: titleHold, in: 0, out: titleHold, color: '#dc2626', overlayType: 'headline', overlayText: input.headline, overlaySub: input.desk, accent: input.accent })
  t += titleHold

  // 1b. quote first: the quote card right after the banner, on the first photo
  if (style === 'quote-first' && input.quote) {
    const q = still(firstPhoto ?? input.bannerUrl, t, QUOTE_SECONDS, firstPhoto ? 'Photo · quote' : 'Banner · quote', 'in')
    if (q) clips.push(q)
    const card = quoteCard(t)
    if (card) clips.push(card)
    t += QUOTE_SECONDS
  }

  // 2. points (a Short keeps what fits under 60 s with its title, quote and close)
  let points = storyPoints(input.deck, input.body, short ? 3 : MAX_POINTS)
  if (short) {
    const room = SHORT_MAX_SECONDS - t - closeLen - (input.quote ? QUOTE_SECONDS : 0)
    const kept: string[] = []
    let used = 0
    for (const p of points) { const h = holdFor(p); if (used + h > room) break; kept.push(p); used += h }
    points = kept
  }
  const pointsStart = t
  const pointStarts: number[] = []
  points.forEach((p, k) => {
    const d = holdFor(p)
    pointStarts.push(t)
    clips.push({ id: id('c'), trackId: 'c1', title: `Point ${k + 1}`, kind: 'caption', start: t, duration: d, in: 0, out: d, color: '#f59e0b', captionText: p })
    t += d
  })
  if (points.length) {
    if (photos.length > 1) {
      // each key sentence on the next photo, the slow move alternating direction
      points.forEach((p, k) => {
        const photo = still(photos[k % photos.length].url, pointStarts[k], holdFor(p), `Photo ${(k % photos.length) + 1}`, k % 2 ? 'in' : 'out')
        if (photo) clips.push(photo)
      })
    } else {
      // without a photo the banner stands in, and the clip says so
      const photo = still(firstPhoto ?? input.bannerUrl, pointsStart, t - pointsStart, firstPhoto ? 'Photo' : 'Banner (no photo)', 'out')
      if (photo) clips.push(photo)
    }
    const lt = Math.min(5, t - pointsStart)
    clips.push({ id: id('l'), trackId: 'v2', title: 'Lower third', kind: 'overlay', start: pointsStart, duration: lt, in: 0, out: lt, color: '#059669', overlayType: 'lower-third', overlayText: input.desk, overlaySub: input.credit ? `Photo: ${input.credit}` : 'ESB Power Line' })
  }

  // 2b. the quote card after the points (standard and short); quote-first already placed it
  if (input.quote && style !== 'quote-first') {
    const q = still(firstPhoto ?? input.bannerUrl, t, QUOTE_SECONDS, firstPhoto ? 'Photo · quote' : 'Banner · quote', 'in')
    if (q) clips.push(q)
    const card = quoteCard(t)
    if (card) clips.push(card)
    t += QUOTE_SECONDS
  }

  // 3. close
  const close = closeLen
  const end = still(firstPhoto ?? input.bannerUrl, t, close, firstPhoto ? 'Close · photo' : 'Close · banner')
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
    // the headline and the desk's lower third are title clips in the classic look (as the first cut always looked)
    clips: clips.map(migrateOverlayClip),
  }
}
