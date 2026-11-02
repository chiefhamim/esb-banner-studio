// Package templates: the structure of a finished ESB video (shape, length cap, cut style, safe zone, music level, loudness,
// close, export defaults), applied to the story on the Editorial desk. Everything stays editable after it is applied.
// A template never writes words of its own into a video: text comes from the story, or stays an empty field whose label is
// drawn in the editor only and which blocks the export until the editor fills it.
import type { AspectRatio, Clip, VideoProject } from './timeline'
import { ASPECT_CONFIGS } from './timeline'
import { buildStoryTimeline, MAX_PHOTOS, QUOTE_SECONDS, type StoryStyle, type StoryVideoInput } from './storyVideo'
import type { LoudnessTarget } from './audioModel'
import type { Platform } from './titles/brand'
import { accentFor, type BrandKit } from './brandKit'

export type TemplateId = 'news-short' | 'reel' | 'youtube-report' | 'facebook-feed' | 'grid-daily' | 'quote-video' | 'explainer-data'

export interface ExportPreset { container: 'mp4' | 'webm'; fps: number; /** Where it is meant to go (shown in the export sheet). */ for: string }

export interface TemplateSpec {
  id: TemplateId
  name: string
  blurb: string
  aspect: AspectRatio
  /** The longest the finished video may be, seconds (a template that would run over it says so). */
  maxSeconds: number
  style: StoryStyle
  /** A quote with a named speaker is required (the story must carry one). */
  needsQuote?: boolean
  /** Empty data-card slots the editor fills from the Data tab (the template cannot fetch figures itself). */
  dataSlots?: number
  /** Platform UI zones to show as guides while editing (null: title-safe only). */
  safeZone: Platform | null
  /** Captions keep clear of the platform UI (true for portrait feeds). */
  captionsInSafeZone: boolean
  /** Music bus level, dB (the voice stays at 0). */
  musicDb: number
  loudness: LoudnessTarget
  /** Opens on: the banner, or the quote card. */
  intro: 'banner' | 'quote'
  /** Closes on the ESB end card when the brand kit has it on. */
  outro: 'end-card'
  export: ExportPreset
}

export const TEMPLATES: readonly TemplateSpec[] = [
  { id: 'news-short', name: 'News Short', blurb: '9:16, 60 s at most, for Shorts and Reels', aspect: '9:16', maxSeconds: 60, style: 'short', safeZone: 'shorts', captionsInSafeZone: true, musicDb: -18, loudness: -14, intro: 'banner', outro: 'end-card', export: { container: 'mp4', fps: 30, for: 'YouTube Shorts, Facebook Reels' } },
  { id: 'reel', name: 'Reel', blurb: '9:16, 90 s at most, the whole story', aspect: '9:16', maxSeconds: 90, style: 'standard', safeZone: 'reels', captionsInSafeZone: true, musicDb: -18, loudness: -14, intro: 'banner', outro: 'end-card', export: { container: 'mp4', fps: 30, for: 'Facebook Reels, Instagram Reels' } },
  { id: 'youtube-report', name: 'YouTube report', blurb: '16:9, the whole story with every photo', aspect: '16:9', maxSeconds: 600, style: 'standard', safeZone: null, captionsInSafeZone: false, musicDb: -20, loudness: -14, intro: 'banner', outro: 'end-card', export: { container: 'mp4', fps: 30, for: 'YouTube' } },
  { id: 'facebook-feed', name: 'Facebook feed', blurb: '4:5, sound-off friendly, captions on screen', aspect: '4:5', maxSeconds: 120, style: 'standard', safeZone: null, captionsInSafeZone: false, musicDb: -18, loudness: -16, intro: 'banner', outro: 'end-card', export: { container: 'mp4', fps: 30, for: 'Facebook feed' } },
  { id: 'grid-daily', name: 'Grid daily update', blurb: '16:9, banner then Grid figure cards you fill from the Data tab', aspect: '16:9', maxSeconds: 90, style: 'standard', dataSlots: 3, safeZone: null, captionsInSafeZone: false, musicDb: -20, loudness: -14, intro: 'banner', outro: 'end-card', export: { container: 'mp4', fps: 30, for: 'YouTube, website' } },
  { id: 'quote-video', name: 'Quote video', blurb: '9:16, opens on a quote from the story with its named speaker', aspect: '9:16', maxSeconds: 60, style: 'quote-first', needsQuote: true, safeZone: 'reels', captionsInSafeZone: true, musicDb: -18, loudness: -14, intro: 'quote', outro: 'end-card', export: { container: 'mp4', fps: 30, for: 'Facebook Reels, Instagram Reels' } },
  { id: 'explainer-data', name: 'Explainer with data cards', blurb: '16:9, story points with Grid figure cards you fill from the Data tab', aspect: '16:9', maxSeconds: 180, style: 'standard', dataSlots: 2, safeZone: null, captionsInSafeZone: false, musicDb: -20, loudness: -14, intro: 'banner', outro: 'end-card', export: { container: 'mp4', fps: 30, for: 'YouTube, website' } },
]

export const templateById = (id: string): TemplateSpec | undefined => TEMPLATES.find((t) => t.id === id)

export interface AppliedTemplate {
  project: VideoProject
  /** What the editor should know (cards to fill, a length over the cap). */
  notes: string[]
  /** Set when the template cannot be built from this story; no project is made then. */
  refused?: string
  /** The guides platform to show while editing (the UI applies it). */
  guides: Platform | null
}

export interface TemplateStory extends Omit<StoryVideoInput, 'aspect' | 'style' | 'accent' | 'photos' | 'quote'> {
  photos?: StoryInputPhotos
  quote?: StoryVideoInput['quote']
  /** The story's category id, for the brand kit's automatic accent. */
  category: string | null
}
type StoryInputPhotos = NonNullable<StoryVideoInput['photos']>

/** An empty kit title the editor fills (its labels draw in the editor only; export is blocked while it is empty). */
function emptyCard(id: string, start: number, duration: number, label: string): Clip {
  return { id, trackId: 'v2', title: label, kind: 'overlay', start, duration, in: 0, out: duration, color: '#0ea5e9', titleData: { template: 'headline', fields: { headline: '', kicker: '' } } }
}

export function applyTemplate(spec: TemplateSpec, story: TemplateStory, brand: BrandKit): AppliedTemplate {
  const notes: string[] = []
  const quote = story.quote ?? null
  if (spec.needsQuote && !quote) {
    return { project: undefined as unknown as VideoProject, notes, guides: spec.safeZone, refused: 'This template opens on a quote, and no quote in the story names its speaker. Pick another template, or add the speaker to the quote in the story.' }
  }
  const base = buildStoryTimeline({
    aspect: spec.aspect,
    headline: story.headline,
    deck: story.deck,
    body: story.body,
    desk: story.desk,
    credit: story.credit,
    bannerUrl: story.bannerUrl,
    photoUrl: story.photoUrl,
    bannerAssetId: story.bannerAssetId,
    photoAssetId: story.photoAssetId,
    accent: accentFor(brand, story.category),
    photos: story.photos?.slice(0, MAX_PHOTOS),
    style: spec.style,
    quote: spec.id === 'news-short' || spec.id === 'reel' || spec.id === 'youtube-report' || spec.id === 'facebook-feed' ? null : quote,
  })
  let clips = base.clips

  // the close: the ESB end card (when the brand kit has it) replaces the "read more" caption, on the same slot
  const readMore = clips.find((c) => c.title === 'Read more')
  if (brand.endCard && readMore) {
    clips = clips.filter((c) => c !== readMore)
    clips.push({ id: 'tpl-endcard', trackId: 'v2', title: 'End card', kind: 'overlay', start: readMore.start, duration: readMore.duration, in: 0, out: readMore.duration, color: '#0ea5e9', titleData: { template: 'end-card', fields: {} } })
  }

  // data-card slots: empty cards after the points, before the close
  let duration = base.duration
  if (spec.dataSlots) {
    const close = clips.find((c) => c.title === 'End card' || c.title === 'Read more')
    const at = close ? close.start : base.duration
    const per = 5
    const shift = per * spec.dataSlots
    clips = clips.map((c) => (c.start >= at - 1e-6 ? { ...c, start: c.start + shift } : c))
    for (let i = 0; i < spec.dataSlots; i++) clips.push(emptyCard(`tpl-slot-${i}`, at + i * per, per, `Figure card ${i + 1}`))
    // the photo behind the cards: the first photo, held across them
    const behind = clips.find((c) => c.trackId === 'v1' && c.still && c.start < at && c.start + c.duration > at - 1e-6)
    if (behind) clips = clips.map((c) => (c === behind ? { ...c, duration: c.duration + shift, out: c.out + shift } : c))
    duration += shift
    notes.push(`Fill the ${spec.dataSlots} figure cards from the Data tab (a figure with its source line) or type them. The video cannot be exported while a card is empty.`)
  }

  const total = Math.max(duration, ...clips.map((c) => c.start + c.duration))
  if (total > spec.maxSeconds + 0.05) notes.push(`This cut runs ${Math.round(total)} s, over the ${spec.maxSeconds} s a ${spec.name} should not pass. Trim it before you export.`)

  const cfg = ASPECT_CONFIGS[spec.aspect]
  const project: VideoProject = {
    ...base,
    name: story.headline.slice(0, 80) || spec.name,
    aspect: spec.aspect,
    width: cfg.width,
    height: cfg.height,
    fps: spec.export.fps,
    duration: Math.ceil(total * 10) / 10,
    clips,
    bug: brand.bugOn,
    ...(brand.bugCorner !== 'tr' ? { bugCorner: brand.bugCorner } : {}),
    ...(spec.captionsInSafeZone && spec.safeZone ? { safeZone: spec.safeZone } : {}),
    loudnessTarget: spec.loudness,
    busVolume: { ...(base.busVolume ?? {}), music: spec.musicDb },
    template: { id: spec.id, name: spec.name },
    exportPreset: spec.export,
  }
  return { project, notes, guides: spec.safeZone }
}

export { QUOTE_SECONDS }
