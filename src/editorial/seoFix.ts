// "Fix with AI": the editor's AI provider repairs every failing SEO check it can — the keyphrase, tags, title,
// description, slug and image alt text, and, when a check is about the story's own structure (an opening paragraph
// that never names the topic, a 70-word lede, a 180-word paragraph), the wording and order of the story. The provider
// is told which checks fail and why, and the answer is held to the same rules as everything else: fields go through
// `sanitizeSeo`; a rewritten story is accepted only if it kept every number and name and added no new facts
// (`safeBodyRewrite`), otherwise the old story stays and the result says so. Two passes at most. A missing photo and a
// story too thin to report cannot be written away, so they are reported, never faked. The editor can undo the lot.

import { aiJson, providerMeta } from './aiProviders'
import { modelFor, sanitizeSeo } from './aiDesk'
import { analyzeSeo, countPhrase, headlineGram, suggestKeyphrases } from './seo'
import type { Ai, OnStep } from './aiDesk'
import type { AiSchema } from './aiProviders'
import type { SeoCheck } from './seo'

export interface SeoDraft {
  headline: string; deck: string; body: string; slug: string
  metaTitle: string; metaDescription: string; focusKeyphrase: string; focusKeywords: string; imageAlt: string
}

const FIX_SYSTEM = `You are the SEO editor of esbpowerline.com, a Bangladesh energy and power news site. A checklist built from Google Search Central's guidance found problems in a story's SEO. Fix ONLY the failing checks you are given; change nothing else.
Rules (Google Search Central):
- Title: concise, descriptive, unique, at most 60 characters, the focus keyphrase early, no keyword stuffing, no site name.
- Meta description: an accurate summary, 120 to 160 characters, contains the keyphrase naturally, unique, not stuffed.
- URL slug: short lowercase words joined by hyphens, built around the keyphrase, no dates or amounts, at most 75 characters.
- Image alt text: one plain sentence, at most 125 characters, describing what the photo shows; not the headline, no "image of", no keyword stuffing.
- Tags: 3 to 8 specific phrases (organisations, projects, places, topic), most important first.
- The focus keyphrase is 1 to 4 words a reader would search, and it must already appear in the story. Prefer one the headline already uses. Pick one that does not repeat another published story's title if you are told it does.
Facts are untouchable: use only what the story states. Never add or remove a figure, name, date, quote or claim.
Story body: return the COMPLETE revised body ONLY if a failing check is about the story's own structure or wording (keyphrase in the opening paragraph, a long lede, long sentences or paragraphs, keyphrase stuffing). You may split or join sentences and paragraphs, reorder sentences, and reword minimally. Keep paragraphs separated by blank lines. If no failing check needs the body, return an empty string for body.`

const FIX_SCHEMA: AiSchema = {
  type: 'object',
  properties: {
    focusKeyphrase: { type: 'string', description: '1 to 4 words, must appear in the story.' },
    tags: { type: 'string', description: '3 to 8 comma-separated specific tags, most important first.' },
    metaTitle: { type: 'string', description: 'At most 60 characters, keyphrase early, no site name.' },
    metaDescription: { type: 'string', description: '120 to 160 characters, accurate, contains the keyphrase naturally.' },
    slug: { type: 'string', description: 'kebab-case, at most 75 characters, keyphrase words.' },
    imageAlt: { type: 'string', description: 'At most 125 characters describing the photo; empty string if there is no photo.' },
    body: { type: 'string', description: 'The complete revised story ONLY if a failing check needs it, else an empty string.' },
  },
  required: ['focusKeyphrase', 'tags', 'metaTitle', 'metaDescription', 'slug', 'imageAlt', 'body'],
}

const numbersOf = (t: string) => (t.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, '')).sort()
const wordsOf = (t: string) => (t.toLowerCase().match(/[a-z0-9’'-]+/g) ?? [])

/**
 * A rewritten story is accepted only if it is the same story: every number kept (none added), the same length within
 * 15%, no name that was not already in it, and no new long words beyond a little connective rewording (a handful, at
 * most 4% of the vocabulary).
 */
export function safeBodyRewrite(oldBody: string, newBody: string): boolean {
  const a = oldBody.trim(), b = newBody.trim()
  if (!b || a === b) return false
  const na = numbersOf(a), nb = numbersOf(b)
  if (na.length !== nb.length || na.some((n, i) => n !== nb[i])) return false
  const wa = wordsOf(a).length, wb = wordsOf(b).length
  if (wa === 0 || wb < wa * 0.85 || wb > wa * 1.15) return false
  const vocabA = new Set(wordsOf(a))
  const caps = (t: string) => new Set((t.match(/\b[A-Z][a-z]{2,}\b/g) ?? []).map((w) => w.toLowerCase()))
  if ([...caps(b)].some((w) => !vocabA.has(w))) return false
  const fresh = [...new Set(wordsOf(b).filter((w) => w.length >= 5 && !vocabA.has(w)))]
  return fresh.length <= Math.max(4, Math.round(vocabA.size * 0.04))
}

const cleanAlt = (t: string, headline: string) => {
  const s = t.replace(/^(an? )?(image|photo|picture) of\s+/i, '').replace(/\s+/g, ' ').trim().slice(0, 125).replace(/[,;:–—-]+$/, '')
  return s && s.toLowerCase() !== headline.trim().toLowerCase() ? s : ''
}

export interface SeoFixOutcome {
  draft: SeoDraft
  before: number
  after: number
  total: number
  remaining: SeoCheck[]
  bodyChanged: boolean
  /** The model rewrote the story in a way that changed facts or length, so the old story was kept. */
  bodySkipped: boolean
  model: string
}

const toInput = (d: SeoDraft, hasImage: boolean, publishedTitles: string[]) => ({
  headline: d.headline, deck: d.deck, body: d.body, slug: d.slug, metaTitle: d.metaTitle, metaDescription: d.metaDescription,
  keyphrase: d.focusKeyphrase, tags: d.focusKeywords.split(',').map((t) => t.trim()).filter(Boolean), hasImage, imageAlt: d.imageAlt, publishedTitles,
})

export async function fixSeoWithAi(ai: Ai, start: SeoDraft, ctx: { hasImage: boolean; publishedTitles: string[] }, onStep?: OnStep): Promise<SeoFixOutcome> {
  const run = (d: SeoDraft) => analyzeSeo(toInput(d, ctx.hasImage, ctx.publishedTitles))
  const before = run(start).filter((c) => c.status === 'good').length
  let cur = { ...start }
  let bodyChanged = false, bodySkipped = false
  let model = ''
  onStep?.('Choosing the model')
  const chosen = await modelFor(ai)
  for (let pass = 1; pass <= 2; pass++) {
    const failing = run(cur).filter((c) => c.status !== 'good' && c.fix !== 'photo' && c.fix !== 'reporting')
    if (!failing.length) break
    // the page heading must carry the keyphrase: from the second pass on, a phrase the headline and story both already use is fixed for it
    let pinned = ''
    if (failing.some((c) => c.id === 'kp-h1') && pass >= 2) {
      const cand = suggestKeyphrases(cur.headline, cur.deck, cur.body, 12).map((k) => k.phrase).find((ph) => countPhrase(cur.headline, ph) > 0 && countPhrase(cur.body, ph) > 0 && ph.split(' ').length <= 4) ?? headlineGram(cur.headline, cur.body)
      if (cand) { cur = { ...cur, focusKeyphrase: cand }; pinned = cand }
    }
    onStep?.(`Pass ${pass}: ${providerMeta(ai.provider).name} fixes ${failing.length} ${failing.length === 1 ? 'check' : 'checks'}`)
    const list = failing.map((c) => `- ${c.label}: ${c.detail}`).join('\n')
    const { data, model: used } = await aiJson<Record<string, string>>({
      provider: ai.provider, key: ai.key, model: chosen, system: FIX_SYSTEM,
      user: `Failing checks:\n${list}${pinned ? `\nThe focus keyphrase is now fixed as "${pinned}" (the headline already uses it): keep it, and rebuild the title, description and slug around it.` : ''}\n\nCurrent fields:\nFocus keyphrase: ${cur.focusKeyphrase}\nTags: ${cur.focusKeywords}\nSEO title: ${cur.metaTitle}\nMeta description: ${cur.metaDescription}\nSlug: ${cur.slug}\nImage alt: ${cur.imageAlt || '(none)'}\nPhoto on the story: ${ctx.hasImage ? 'yes' : 'no'}\nPublished stories on the site (avoid repeating a keyphrase from these titles): ${ctx.publishedTitles.slice(0, 25).join(' | ') || '(none)'}\n\nHeadline: ${cur.headline}\n\nDeck: ${cur.deck}\n\nStory:\n${cur.body}`,
      schema: FIX_SCHEMA, maxTokens: failing.some((c) => c.fix === 'body') ? 16000 : 4000, timeoutMs: 150_000, effort: 'low',
    })
    model = used
    onStep?.("Checking the answer against Google's rules")
    let body = cur.body
    if (failing.some((c) => c.fix === 'body') && (data.body ?? '').trim()) {
      const next = data.body.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim()
      if (safeBodyRewrite(cur.body, next)) { body = next; bodyChanged = true } else bodySkipped = true
    }
    const seo = sanitizeSeo({ headline: cur.headline, deck: cur.deck, body }, data)
    cur = {
      ...cur, body,
      focusKeyphrase: seo.focusKeyphrase, focusKeywords: seo.focusKeywords, metaTitle: seo.metaTitle, metaDescription: seo.metaDescription, slug: seo.slug,
      imageAlt: ctx.hasImage ? cleanAlt(data.imageAlt ?? '', cur.headline) || cur.imageAlt : cur.imageAlt,
    }
  }
  onStep?.('Re-checking all points')
  const last = run(cur)
  return { draft: cur, before, after: last.filter((c) => c.status === 'good').length, total: last.length, remaining: last.filter((c) => c.status !== 'good'), bodyChanged, bodySkipped, model }
}
