// Video copy: the YouTube title, description, tags and the Facebook caption for a story video. An AI draft the editor
// reads and edits; nothing here posts anything. Figures must come from the story (a field with a figure the story does
// not carry is replaced by the story's own words and the problem is reported); the Facebook caption goes through the
// same sanitiser as Editorial's.
import { sanitizeFacebook, FACEBOOK_STYLE } from '../../editorial/facebookCaption'
import { numbersNotIn, runTextAi, type AiSchema, type TextAiDeps } from './aiText'
import type { Marker } from '../timeline'
import type { VideoCopy } from './savedCopy'

export type { VideoCopy }

export interface CopyStory { headline: string; deck: string; body: string; slug?: string }

export const YT_TITLE_MAX = 100
export const YT_TAGS_CHARS = 400 // YouTube allows 500 in all; a margin for separators
export const COPY_SCHEMA: AiSchema = {
  type: 'object',
  properties: {
    youtubeTitle: { type: 'string', description: 'At most 100 characters, the news first, no clickbait, no all caps, no site name.' },
    summary: { type: 'string', description: 'Two or three plain sentences summarising the story for the video description. Only facts and figures the story states.' },
    tags: { type: 'string', description: '6 to 12 comma-separated search tags (organisations, projects, places, topic), most important first.' },
    facebook: { type: 'string', description: 'The Facebook caption, in the style given.' },
  },
  required: ['youtubeTitle', 'summary', 'tags', 'facebook'],
}

export const COPY_SYSTEM = `You are the video editor of ESB Power Line, a Bangladesh energy and power news site. From the story you are given, write the copy that goes with its news video.
Rules:
- Use only what the story says. Never add a figure, name, place, date or claim that the story does not contain.
- YouTube title: at most 100 characters, the news first, plain sentence case, no clickbait, no all-caps words, no emoji, no site name.
- Summary: two or three plain sentences for the video description.
- Tags: 6 to 12 short search phrases, most important first.
- ${FACEBOOK_STYLE}`

const storyText = (s: CopyStory) => `Headline: ${s.headline}\n\nDeck: ${s.deck}\n\nStory:\n${s.body}`
const LINKS = /(?:https?:\/\/|www\.)\S+/gi
/** No link of the model's own: the only link in the copy is the article's, added by `buildDescription`. */
const noLinks = (s: string) => s.replace(LINKS, ' ').replace(/\s{2,}/g, ' ').trim()
const cut = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '').replace(/[,:;\-–—\s]+$/, '') + '…')

/** A title the platform accepts: one line, no quotes around it, no em dashes, within 100 characters. */
export function sanitizeYoutubeTitle(raw: string, fallback: string): string {
  let t = noLinks(raw ?? '').replace(/[\r\n]+/g, ' ').replace(/\s*[—–]\s*/g, ' - ').replace(/\s+/g, ' ').trim().replace(/^["“”'‘’]+|["“”'‘’]+$/g, '').replace(/\.$/, '')
  if (!t) t = (fallback ?? '').replace(/\s+/g, ' ').trim()
  return cut(t, YT_TITLE_MAX)
}

/** Tags: trimmed, no hashes or commas inside, de-duplicated, as many as fit in YT_TAGS_CHARS, at most 15. */
export function sanitizeTags(raw: string): string[] {
  const out: string[] = []
  let used = 0
  for (const piece of noLinks(raw ?? '').split(/[,\n]/)) {
    const t = piece.replace(/^#+/, '').replace(/[<>"]/g, '').replace(/\s+/g, ' ').trim()
    if (t.length < 2 || t.length > 60 || out.some((o) => o.toLowerCase() === t.toLowerCase())) continue
    if (used + t.length + 1 > YT_TAGS_CHARS || out.length >= 15) break
    out.push(t)
    used += t.length + 1
  }
  return out
}

const clock = (t: number) => {
  const s = Math.max(0, Math.floor(t))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

/** YouTube chapters from the project's markers: needs 0:00, at least three chapters, each at least 10 s long. Empty when it cannot be honest. */
export function chaptersFromMarkers(markers: Pick<Marker, 't' | 'name'>[] | undefined, duration: number): string {
  const ms = [...(markers ?? [])].filter((m) => m.name.trim() && m.t >= 0 && m.t < duration).sort((a, b) => a.t - b.t)
  if (!ms.length) return ''
  if (ms[0].t > 0.5) return '' // a chapter list must start at 0:00; a name is not invented for the start
  const kept: { t: number; name: string }[] = []
  for (const m of ms) {
    const last = kept[kept.length - 1]
    if (last && m.t - last.t < 10) continue
    kept.push({ t: kept.length ? m.t : 0, name: m.name.trim() })
  }
  if (kept.length < 3) return ''
  if (duration - kept[kept.length - 1].t < 10) kept.pop()
  if (kept.length < 3) return ''
  return kept.map((c) => `${clock(c.t)} ${c.name}`).join('\n')
}

export const articleLink = (slug: string | undefined, campaign = 'video') =>
  slug ? `https://esbpowerline.com/articles/${slug}?utm_source=youtube&utm_medium=video&utm_campaign=${encodeURIComponent(campaign)}` : ''

/** The description: summary, the article link (with UTM), chapters, the site line. */
export function buildDescription(o: { summary: string; slug?: string; chapters?: string }): string {
  const parts = [o.summary.trim()]
  const link = articleLink(o.slug, o.slug)
  if (link) parts.push(`Read the full story: ${link}`)
  if (o.chapters) parts.push(`Chapters\n${o.chapters}`)
  parts.push('ESB Power Line · esbpowerline.com')
  return parts.filter(Boolean).join('\n\n')
}

export interface CopyResult { copy: VideoCopy; problems: string[] }

export async function writeVideoCopy(story: CopyStory, opts: { markers?: Marker[]; duration: number; signal?: AbortSignal }, deps: Partial<TextAiDeps> = {}): Promise<CopyResult> {
  const { data, model } = await runTextAi({ system: COPY_SYSTEM, user: storyText(story), schema: COPY_SCHEMA, maxTokens: 2000, signal: opts.signal }, deps)
  const source = storyText(story)
  const problems: string[] = []
  const guard = (label: string, text: string, fallback: string) => {
    const extra = numbersNotIn(text, source)
    if (extra.length) { problems.push(`${label}: the figure${extra.length > 1 ? 's' : ''} ${extra.join(', ')} ${extra.length > 1 ? 'are' : 'is'} not in the story, so the story's own words were used instead.`); return fallback }
    return text
  }
  const title = guard('YouTube title', sanitizeYoutubeTitle(String(data.youtubeTitle ?? ''), story.headline), sanitizeYoutubeTitle(story.headline, story.headline))
  const summary = guard('Summary', noLinks(String(data.summary ?? '')).replace(/\s+/g, ' ').trim(), story.deck.trim() || story.headline.trim())
  const fbRaw = sanitizeFacebook(String(data.facebook ?? ''), story.headline)
  const facebook = guard('Facebook caption', fbRaw, sanitizeFacebook('', story.headline))
  const tags = sanitizeTags(String(data.tags ?? ''))
  if (!tags.length) problems.push('Tags: none came back that could be used.')
  const description = buildDescription({ summary, slug: story.slug, chapters: chaptersFromMarkers(opts.markers, opts.duration) })
  return { copy: { youtubeTitle: title, description, tags, facebook, model, at: Date.now() }, problems }
}
