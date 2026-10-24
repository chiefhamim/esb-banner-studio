// The desk's AI jobs after translation: SEO fields and social captions, written by the editor's chosen provider from
// the English story — then held to the same rules the hand-built fields follow. A model's answer is a draft, never
// the last word: a title over 60 characters, a description outside 120–160, a slug with a site name or a date, a
// keyphrase the story never uses, or a caption that drops the article link is corrected or replaced here, so nothing
// the SEO panel would grade "bad" and nothing the site would print differently gets in.

import { aiJson, listModels, resolveModel } from './aiProviders'
import type { AiProviderId, AiSchema } from './aiProviders'
import { countPhrase, suggestKeyphrases } from './seo'
import { buildSlug } from './seo'
import { TAGS } from '../core/newsroom'
import { cleanSlug, seoFields, stripSiteSuffix } from './translator'

export const SITE_ORIGIN = 'https://esbpowerline.com'
/** The article's public address — esbpowerline.com serves every story at /articles/{slug}. */
export const articleUrl = (slug: string) => `${SITE_ORIGIN}/articles/${slug.trim() || 'story-slug'}`

type Ai = { provider: AiProviderId; key: string; model: string }
interface Story { headline: string; deck: string; body: string }

const storyText = (s: Story) => `Headline: ${s.headline}\n\nDeck: ${s.deck}\n\nStory:\n${s.body}`

async function modelFor(ai: Ai) {
  let listed: Awaited<ReturnType<typeof listModels>> = []
  try { listed = await listModels(ai.provider, ai.key) } catch { /* the call reports the real error */ }
  return resolveModel(ai.provider, ai.model, listed)
}

// ------------------------------------------------------------------ SEO

const SEO_SYSTEM = `You are the SEO editor of esbpowerline.com, a Bangladesh energy and power news site. From the English story you are given, write the fields that decide how the article appears in Google.
Rules:
- Use only what the story says. Do not add figures, names or claims.
- The focus keyphrase is 2 to 4 words a reader would actually search, and it must appear in the story as written.
- The meta title is at most 60 characters, names the keyphrase early, reads as a headline, and carries no site name.
- The meta description is 120 to 160 characters, states the news in one or two plain sentences, and contains the keyphrase.
- The slug is lowercase words joined by hyphens, at most 75 characters, built around the keyphrase: no dates, amounts, stop words or site name.
- Tags are 4 to 6 short phrases (organisations, projects, places, topic), most important first.`

export const SEO_SCHEMA: AiSchema = {
  type: 'object',
  properties: {
    focusKeyphrase: { type: 'string', description: '2 to 4 words a reader would search; must appear in the story.' },
    tags: { type: 'string', description: '4 to 6 comma-separated tags, most important first.' },
    metaTitle: { type: 'string', description: 'At most 60 characters, keyphrase early, no site name.' },
    metaDescription: { type: 'string', description: '120 to 160 characters, states the news, contains the keyphrase.' },
    slug: { type: 'string', description: 'kebab-case, at most 75 characters, keyphrase words, no dates or amounts.' },
  },
  required: ['focusKeyphrase', 'tags', 'metaTitle', 'metaDescription', 'slug'],
}

export interface SeoResult { focusKeyphrase: string; focusKeywords: string; metaTitle: string; metaDescription: string; slug: string }

/** Hold a model's SEO answer to the site's rules; anything that breaks one is rebuilt by the seo.ts builders. */
export function sanitizeSeo(story: Story, raw: Partial<Record<keyof typeof SEO_SCHEMA.properties, string>>): SeoResult {
  const all = `${story.headline}\n${story.deck}\n${story.body}`
  const suggested = suggestKeyphrases(story.headline, story.deck, story.body, 6).map((k) => k.phrase)
  let kp = (raw.focusKeyphrase ?? '').replace(/\s+/g, ' ').trim()
  // a keyphrase the story never uses cannot rank the story — take the story's own best phrase instead
  if (!kp || countPhrase(all, kp) === 0 || kp.split(' ').length > 6) kp = suggested[0] ?? ''
  const tags: string[] = []
  for (const t of [kp, ...(raw.tags ?? '').split(','), ...suggested]) {
    const c = t.replace(/^#/, '').replace(/\s+/g, ' ').trim()
    if (c && c.length <= 40 && !tags.some((x) => x.toLowerCase() === c.toLowerCase())) tags.push(c)
    if (tags.length >= 6) break
  }
  const focusKeywords = tags.join(', ')
  const { metaTitle, metaDescription } = seoFields(story.headline, story.deck, story.body, focusKeywords, stripSiteSuffix(raw.metaTitle ?? ''), raw.metaDescription)
  const slugWords = new Set(cleanSlug(kp).split('-').filter(Boolean))
  const s = cleanSlug(stripSiteSuffix(raw.slug ?? '').replace(/esb-?powerline/gi, ''))
  // a slug that drops the keyphrase or carries a year is rebuilt from the keyphrase and headline
  const keeps = [...slugWords].every((w) => s.split('-').includes(w)) && !/\b(19|20)\d{2}\b/.test(s.replace(/-/g, ' '))
  const slug = s && keeps ? s : buildSlug(story.headline, kp)
  return { focusKeyphrase: kp, focusKeywords, metaTitle, metaDescription, slug }
}

export async function aiSeo(ai: Ai, story: Story): Promise<SeoResult & { model: string }> {
  const model = await modelFor(ai)
  const { data, model: used } = await aiJson<Record<string, string>>({ provider: ai.provider, key: ai.key, model, system: SEO_SYSTEM, user: storyText(story), schema: SEO_SCHEMA, maxTokens: 8000, timeoutMs: 120_000 })
  return { ...sanitizeSeo(story, data), model: used }
}

// ------------------------------------------------------------------ social captions

const SOCIAL_SYSTEM = `You write the social posts for ESB PowerLine, a Bangladesh energy and power news site, from the English story you are given.
Rules:
- Use only facts the story states: no new figures, quotes, names or claims, no opinion, no clickbait.
- Each post ends with the article link, exactly as given, on its own line.
- Facebook: a short hook line, then 2 or 3 sentences of the news, then 2 or 3 relevant hashtags, then the link. Under 600 characters.
- X: one or two sentences and at most 2 hashtags; with the link the whole post must stay under 270 characters.
- LinkedIn: professional tone for energy-sector readers, 3 to 5 sentences on what happened and why it matters to the sector, 3 hashtags, then the link. Under 1,200 characters.
- Telegram: the headline on the first line, a one- or two-sentence summary, then the link. No hashtags.
- At most one emoji per post, and only where it reads naturally.`

export const SOCIAL_SCHEMA: AiSchema = {
  type: 'object',
  properties: {
    facebook: { type: 'string', description: 'Facebook post ending with the link.' },
    x: { type: 'string', description: 'X post under 270 characters including the link.' },
    linkedin: { type: 'string', description: 'LinkedIn post ending with the link.' },
    telegram: { type: 'string', description: 'Telegram post: headline line, summary, link.' },
  },
  required: ['facebook', 'x', 'linkedin', 'telegram'],
}

export type Captions = { facebook: string; x: string; linkedin: string; telegram: string }

/** X counts every link as 23 characters, whatever its length. */
export const xLength = (text: string) => text.replace(/https?:\/\/\S+/g, 'x'.repeat(23)).length

/** Every caption carries the article link (once, at the end) and the X post fits X's 280. */
export function sanitizeCaptions(raw: Partial<Captions>, url: string): Captions {
  const site = /https?:\/\/(?:www\.)?esbpowerline\.com(?:\/[^\s)]*)?/gi
  const withLink = (t: string) => {
    // a link to the site already in the text ("Read more: https://esbpowerline.com") becomes the article's own link,
    // in place; any further site links (a model's guessed paths) go; with none, the link goes last
    let seen = false
    const body = (t ?? '').replace(site, () => (seen ? '' : ((seen = true), url))).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    return seen ? body : body ? `${body}\n\n${url}` : url
  }
  const out: Captions = { facebook: withLink(raw.facebook ?? ''), x: withLink(raw.x ?? ''), linkedin: withLink(raw.linkedin ?? ''), telegram: withLink(raw.telegram ?? '') }
  if (xLength(out.x) > 280) {
    const words = out.x.replace(url, ' ').replace(/\s+/g, ' ').trim().split(' ')
    while (words.length > 1 && xLength(`${words.join(' ')}…\n\n${url}`) > 280) words.pop()
    out.x = `${words.join(' ').replace(/[,;:–—-]+$/, '')}…\n\n${url}`
  }
  return out
}

/**
 * The desk's captions before (or without) an AI provider: the headline, the deck as the one-line summary, two or
 * three hashtags for the desk, and the article link — built only from the story's own words. The Graphics card
 * templates (newsroom.ts) are for a card; a story is not a stat card, and reading its highlight phrase as a figure
 * opened every Facebook post with "⚡ the Sylhet —".
 */
export function storyCaptions(story: { headline: string; deck: string; categoryId: string; slug: string }): Captions {
  const head = story.headline.replace(/\s+/g, ' ').trim()
  const deck = story.deck.replace(/\s+/g, ' ').trim()
  const summary = deck && deck.toLowerCase() !== head.toLowerCase() ? deck : ''
  const tags = ['ESBPowerLine', ...(TAGS[story.categoryId] ?? []).slice(0, 2)].map((t) => '#' + t).join(' ')
  const lines = (...xs: string[]) => xs.filter(Boolean).join('\n\n')
  const url = articleUrl(story.slug)
  return sanitizeCaptions({
    facebook: lines(head, summary, tags),
    x: lines(head, '#ESBPowerLine'),
    linkedin: lines(head, summary, 'Full report on ESB PowerLine, covering Bangladesh\'s power and energy sector.', tags),
    telegram: lines(`📰 *${head}*`, summary),
  }, url)
}

/** Every caption's article link pointed at the current slug. A caption only ever links this story, so any
 *  /articles/ address in it is this story's — including one left by a half-typed slug. An empty slug changes nothing. */
export function relinkCaptions(social: Captions, newSlug: string): Captions {
  if (!newSlug.trim()) return social
  const to = articleUrl(newSlug)
  return Object.fromEntries(Object.entries(social).map(([k, v]) => [k, (v ?? '').replace(/https:\/\/esbpowerline\.com\/articles\/[a-z0-9-]*/g, to)])) as Captions
}

export async function aiCaptions(ai: Ai, story: Story & { slug: string; desk: string }): Promise<Captions & { model: string }> {
  const url = articleUrl(story.slug)
  const model = await modelFor(ai)
  const { data, model: used } = await aiJson<Record<string, string>>({
    provider: ai.provider, key: ai.key, model, system: SOCIAL_SYSTEM,
    user: `${storyText(story)}\n\nDesk: ${story.desk}\nArticle link: ${url}`,
    schema: SOCIAL_SCHEMA, maxTokens: 8000, timeoutMs: 120_000,
  })
  return { ...sanitizeCaptions(data, url), model: used }
}
