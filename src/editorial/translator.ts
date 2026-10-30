// Bilingual journalistic translation and CMS story compilation engine for ESB Power Line.
// Strictly adheres to the professional newsroom translator prompt specification.

import { polishJournalisticEnglish, translateBengaliToEnglish } from '../core/newsroom'
import { FACEBOOK_FIELD, sanitizeFacebook } from './facebookCaption'
import { bengaliToAsciiDigits } from './bengali'
import { GTX_MAX, translateComplete } from './translateNet'
import { aiFor, aiJson, geminiLabel, listModels, loadAiSettings, providerMeta, resolveModel } from './aiProviders'
import type { AiProviderId, AiSchema, AiSettings } from './aiProviders'
import { DESCRIPTION_MAX, buildMetaDescription, buildMetaTitle, buildSlug, countPhrase, headlineGram, suggestKeyphrases } from './seo'

import { storyFromMarkup, hasStoryMarks } from './blocks'
import { validateChartIdeas } from './chart'
import type { ChartSpec } from './chart'

export interface EditorialTranslationResult {
  headline: string          // strictly <= 104 characters
  deck: string              // strictly <= 200 characters
  slug: string              // strictly <= 80 characters
  focusKeywords: string     // comma-separated SEO focus keyphrases
  metaTitle: string         // SEO meta title
  metaDescription: string   // SEO meta description
  body: string              // full English story body
  /** The same story as the site's HTML when the AI structured it (headings, bullets, tables…); `body` is then exactly its plain text. */
  bodyHtml?: string
  /** Charts the AI suggests from numbers the source prints; the editor adds one on request. */
  charts?: ChartSpec[]
  /** The Facebook Page caption the same AI call wrote (no link; text, then one line of hashtags). Absent for free translation. */
  facebook?: string
  /** Which AI provider wrote it, or the free machine translation ('neural'), or nothing reachable ('offline'). */
  provider: AiProviderId | 'neural' | 'offline'
  modelUsed?: string
  /** True when Bengali source text could not be machine-translated (no network/API reachable) and still needs a human translator's review. */
  translationFailed?: boolean
  /** Set when the translation looks shorter than the source (paragraphs missing), so the desk can say so. */
  coverageWarning?: string
}

/** True when the renderer has no network path at all; skip remote translation attempts immediately instead of waiting out their timeouts. */
function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/** Test seam shared with core/newsroom.ts: an injected translator replaces every remote call. */
function injectedTranslator(): ((text: string) => Promise<string>) | null {
  if (typeof window === 'undefined') return null
  const fn = (window as unknown as { __customTranslator?: (text: string) => Promise<string> }).__customTranslator
  return typeof fn === 'function' ? fn : null
}

export const JOURNALISTIC_TRANSLATOR_PROMPT = `You are the senior editor of ESB Power Line, an English-language news site on Bangladesh's power, gas and energy sector. Your readers are energy professionals, investors, policymakers and Bangladeshis abroad. They read quickly, distrust hype and judge a publication by whether its numbers are right.

Turn the Bengali (or English) source report into one finished English news story. You are an editor, not a translator: restructure for clarity, but never change what the source says.

FACTS
- Every figure, name, date, quote and claim must come from the source. Never add, infer, round, convert or estimate. If the source is silent, leave it out; do not fill the gap.
- Keep every fact. You may reorder, merge or split paragraphs, but nothing is dropped.
- Quotes stay in quotation marks, translated faithfully and attributed to the same person.

STRUCTURE
- Headline: the strongest fact, active voice, ideally under 90 characters.
- Opening paragraph, under 40 words: who did what, the key number, and why it matters to the sector, using only facts in the source.
- Then context in order of importance, one idea per short paragraph. Close on what happens next only if the source says so.

RICH LAYOUT (use it when it helps the reader, never as decoration)
- A news story of up to four paragraphs stays plain paragraphs. In a longer story with clearly separate parts, add short sub-headings.
- When the source lists three or more parallel items (projects, conditions, figures, demands), set them as bullet points; use a numbered list only when the order matters.
- When the source gives the same measure for three or more years, places or companies, present it as a small table, and also offer a chart idea. The numbers are copied exactly from the source; you never calculate a total, a change or a percentage the source does not print.
- Feature at most one direct quotation as a block quote when it is a full, newsworthy sentence; otherwise keep quotes inside the paragraphs.
- Make at most two key figures bold and at most one key phrase highlighted. Keep bold and highlight rare so they still mean something.
- Layout never changes the facts: every number, name and quote still comes from the source, and nothing is dropped to make room for it. The exact marks to write are given in the reply format below.

ENERGY PRECISION
- Keep units with every figure, with a space between number and unit (40 MW, not 40MW). Never mix up power (MW) and energy (MWh). Say whether a number is capacity or actual output. Write "million" in full instead of "M".
- On first use, spell out units and acronyms (million cubic feet per day, mmcfd). Give lakh and crore a plain gloss, for example "Tk 592 crore (5.92 billion taka)". Do not convert currencies or energy units unless the source does.
- State a project's stage exactly as the source does: proposed, approved, under construction, operating.
- Explain an institution or term in a half-sentence clause, only as a definition (for example "Petrobangla, the state gas company"). A definition is not a new fact about the event.

ATTRIBUTION AND STYLE
- Name the person and institution ("said Petrobangla's chairman"). If the source names nobody, say what the report did not state.
- Newspaper names shouldn't be stated in our version, it should be removed, or mentioned as "sources" etc.
- British spelling, except that official names of companies, institutions and projects stay exactly as they style themselves (for example Jamuna Fertilizer Factory). Plain, active, specific. Write a weekday with its date.
- Avoid hype, stock phrases, em dashes, exclamation marks, rhetorical questions and opinion.

FIELDS TO RETURN (the limits are final)
- headline: at most 104 characters. deck: one sentence, at most 200. slug: lowercase words, at most 75 characters, no dates or amounts. focus keywords: 4 to 6 specific phrases the story really uses; the first is the main keyphrase, 2 to 4 words, taken from your own headline, and the SEO title and description must contain it.
- SEO title: at most 60 characters, keyphrase early, no site name. SEO description: aim for 140 to 155 characters (never above 160), states the news, contains the keyphrase naturally.
- Facebook caption: one complete sentence of at most 110 characters (it must end cleanly, never trail off), the most striking fact first and stated precisely (for example "below the JKM benchmark", not "below market"), human voice, no link, no em dashes; then a blank line and one line of 3 to 5 CamelCase hashtags ending #ESBPowerLine.

Before answering, check: every number matches the source, units are right, the first paragraph answers who, what and why it matters, and nothing was added.`

/** Kebab-case URL slug strictly under maxLen characters (default 80). */
export function generateSlug(headline: string, maxLen = 80): string {
  const clean = headline
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
  if (clean.length <= maxLen) return clean
  const sub = clean.slice(0, maxLen)
  const lastHyphen = sub.lastIndexOf('-')
  return lastHyphen > 25 ? sub.slice(0, lastHyphen) : sub
}

const HEADLINE_TAIL_WORDS = new Set([
  'a', 'an', 'the', 'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'and', 'or', 'as', 'into',
  'will', 'be', 'is', 'are', 'has', 'have', 'was', 'were', 'its', 'their', 'that', 'which', 'amid', 'over',
])

/**
 * Enforce headline length under maxLen characters (default 104), preserving manual line breaks (\n).
 * Over-long headlines are shortened at a natural clause break (comma / colon / dash) when possible,
 * otherwise at a word boundary with dangling function words ("…added to the") removed.
 */
export function enforceHeadlineLength(headline: string, maxLen = 104): string {
  const lines = headline.split('\n').map((l) => l.trim().replace(/[^\S\r\n]+/g, ' '))
  const clean = lines.join('\n').trim()
  if (clean.length <= maxLen) return clean

  const head = clean.slice(0, maxLen + 1)
  // 1. Prefer the last clause break that still leaves a substantial headline
  const clause = Math.max(head.lastIndexOf(', '), head.lastIndexOf(': '), head.lastIndexOf(' — '), head.lastIndexOf(' – '))
  if (clause >= 45) return clean.slice(0, clause).replace(/[,:;—–\s]+$/, '')

  // 2. Word boundary, then drop dangling function words
  const sub = clean.slice(0, maxLen)
  const lastSpace = sub.lastIndexOf(' ')
  const words = (lastSpace > 40 ? sub.slice(0, lastSpace) : sub).split(' ')
  while (words.length > 4 && HEADLINE_TAIL_WORDS.has(words[words.length - 1].toLowerCase().replace(/[^a-z]/g, ''))) {
    words.pop()
  }
  return words.join(' ').replace(/[,:;—–\s]+$/, '')
}

/** Intelligently breaks a headline into 2 balanced, natural journalistic lines. */
export function balanceHeadlineBreaks(text: string): string {
  const clean = text.replace(/\r/g, '').replace(/\n+/g, ' ').trim()
  if (clean.length < 24 || !clean.includes(' ')) return clean

  // 1. Natural syntactic breaks: after colon ':', em-dash '—' or hyphen '-', or comma ','
  const match = clean.match(/^([^:—,]+[:—,])\s+(.+)$/)
  if (match && match[1].length > 10 && match[2].length > 10) {
    return `${match[1]}\n${match[2]}`
  }

  // 2. Middle space break for balanced two-line display
  const words = clean.split(' ')
  if (words.length < 3) return clean

  let bestDiff = Infinity
  let bestIdx = 1
  let lenSoFar = 0
  const totalLen = clean.length

  for (let i = 0; i < words.length - 1; i++) {
    lenSoFar += words[i].length + (i > 0 ? 1 : 0)
    const remaining = totalLen - lenSoFar - 1
    const diff = Math.abs(lenSoFar - remaining)
    if (diff < bestDiff) {
      bestDiff = diff
      bestIdx = i + 1
    }
  }

  const line1 = words.slice(0, bestIdx).join(' ')
  const line2 = words.slice(bestIdx).join(' ')
  return `${line1}\n${line2}`
}

/** Enforce deck length strictly under maxLen characters (default 200). */
export function enforceDeckLength(deck: string, maxLen = 200): string {
  const clean = deck.trim().replace(/\s+/g, ' ')
  if (clean.length <= maxLen) return clean
  const sub = clean.slice(0, maxLen - 1)
  const lastSpace = sub.lastIndexOf(' ')
  return lastSpace > 50 ? sub.slice(0, lastSpace) + '…' : sub + '…'
}

/** Polish article body with Bangladesh energy newsroom idioms & international terminology. */
export function polishJournalisticBody(text: string): string {
  const t = text
    .replace(/\bRs\.?\s?/gi, 'Tk ')
    .replace(/\brupees?\b/gi, 'Taka')
    .replace(/\bDigging\b/gi, 'Drilling')
    .replace(/\bdigging\b/gi, 'drilling')
    .replace(/\bdig\b/gi, 'drill')
    .replace(/\bworth of\b/gi, 'at an estimated cost of')
    .replace(/\bin the grid\b/gi, 'to the national grid')
    .replace(/\binto the grid\b/gi, 'into the national grid')
    .replace(/\badding to grid\b/gi, 'delivering to the national grid')
    .replace(/\b30 million cubic feet of gas per day\b/gi, '30 MMCFD gas')
    .replace(/\bmillion cubic feet of gas per day\b/gi, 'MMCFD gas')
    .replace(/\bmillion cubic feet\b/gi, 'MMCFD')
    .replace(/\bBangladesh Government\b/gi, 'Government of Bangladesh')
    .replace(/\benergy secretary\b/gi, 'Energy Secretary')
    .replace(/\bpower division\b/gi, 'Power Division')
    .replace(/\benergy and mineral resources division\b/gi, 'Energy and Mineral Resources Division')
    .replace(/\bministry of power, energy and mineral resources\b/gi, 'Ministry of Power, Energy and Mineral Resources')
    .replace(/\bpetrobangla\b/gi, 'Petrobangla')
    .replace(/\bbapex\b/gi, 'BAPEX')
    .replace(/\bbpdb\b/gi, 'BPDB')
    .replace(/\bberc\b/gi, 'BERC')
    .replace(/\bpgcb\b/gi, 'PGCB')
    .replace(/\bdesco\b/gi, 'DESCO')
    .replace(/\bdpdc\b/gi, 'DPDC')
    .replace(/\breb\b/gi, 'BREB')
    .replace(/\bbpc\b/gi, 'BPC')
    .replace(/\bsreda\b/gi, 'SREDA')
    .replace(/\brpgcl\b/gi, 'RPGCL')
    .replace(/[ \t]+/g, ' ')
    .trim()

  return t
}

/**
 * Tags for the story: the keyphrases it is actually about (organisations, places, projects, sector topics), from
 * seo.ts. The previous picker returned money amounts and any capitalised pair in the headline, which read as random.
 */
export function extractFocusKeywords(headline: string, bodyText: string): string {
  const paras = bodyText.split(/\n\s*\n/)
  return suggestKeyphrases(headline, '', paras.join('\n\n'), 6).map((k) => k.phrase).join(', ')
}

/** Strictly generates SEO metadata (slug, keywords, meta title, meta desc) ONLY from the translated English story. */
const firstKeyphrase = (focusKeywords: string) => focusKeywords.split(',')[0]?.trim() ?? ''
/**
 * The first focus keyword is the main keyphrase, and it must sit in the headline and the SEO title. The model's list is
 * kept, but reordered: the first phrase found in both, else in the title, else in the headline; failing all of those, a
 * headline phrase the story really uses goes first. Without this a title is rebuilt around a phrase the headline lacks.
 */
export function alignKeywords(headline: string, body: string, modelTitle: string | undefined, keywords: string): string {
  const list = keywords.split(',').map((t) => t.trim()).filter(Boolean)
  const title = modelTitle ?? ''
  const okLen = (k: string) => k.split(/\s+/).length <= 4
  const pick = list.find((k) => okLen(k) && countPhrase(title, k) > 0 && countPhrase(headline, k) > 0)
    ?? list.find((k) => okLen(k) && countPhrase(headline, k) > 0)
    ?? list.find((k) => okLen(k) && countPhrase(title, k) > 0)
    ?? headlineGram(headline, body)
  if (!pick) return keywords
  return [pick, ...list.filter((k) => k.toLowerCase() !== pick.toLowerCase())].slice(0, 6).join(', ')
}

/** A " | ESB PowerLine" (or " - ESB PowerLine") a model or an old draft added: the site prints no site name. */
export const stripSiteSuffix = (t: string) => t.replace(/\s*[|–—-]\s*ESB\s*PowerLine\s*$/i, '').trim()

/** A model's slug made safe for the site: lowercase ASCII words joined by hyphens, at most 75 characters, cut at a word. */
export function cleanSlug(raw: string): string {
  let x = raw.toLowerCase().normalize('NFKD').replace(/_/g, '-').replace(/[^a-z0-9\s-]/g, '').trim().replace(/[\s-]+/g, '-').replace(/^-+|-+$/g, '')
  while (x.length > 75 && x.includes('-')) x = x.slice(0, x.lastIndexOf('-'))
  return x.slice(0, 75)
}

/**
 * The SEO title and description every path produces: a model's own suggestion when it fits the site's limits (60
 * characters, 160 for the description) and names the keyphrase, else the seo.ts builders — so a translated story
 * arrives with fields the SEO panel already grades as good, and none carries a site-name suffix.
 */
export function seoFields(headline: string, deck: string, body: string, focusKeywords: string, modelTitle?: string, modelDesc?: string) {
  const kp = firstKeyphrase(focusKeywords)
  const t = stripSiteSuffix(modelTitle?.trim() ?? '')
  const d = (modelDesc ?? '').replace(/\s+/g, ' ').trim()
  const named = (x: string) => !kp || countPhrase(x, kp) > 0
  const metaTitle = t && t.length <= 60 && named(t) ? t : buildMetaTitle(headline, kp)
  const metaDescription = d && d.length >= 100 && d.length <= DESCRIPTION_MAX && named(d) ? d : buildMetaDescription(deck, body, kp)
  return { metaTitle, metaDescription }
}

export function buildSeoFromEnglishStory(headline: string, deck = '', bodyText = '') {
  const cleanHeadline = enforceHeadlineLength(headline, 104)
  const cleanDeck = enforceDeckLength(deck, 200)
  const focusKeywords = extractFocusKeywords(cleanHeadline, `${cleanDeck} ${bodyText}`)
  const slug = buildSlug(cleanHeadline, firstKeyphrase(focusKeywords)) || generateSlug(cleanHeadline, 80)

  const { metaTitle, metaDescription } = seoFields(cleanHeadline, cleanDeck, bodyText, focusKeywords)
  return { slug, focusKeywords, metaTitle, metaDescription }
}


/** Translate single Bengali paragraph via Neural GTX API, MyMemory fallback, or offline engine. */
async function translateParagraph(p: string): Promise<string> {
  const clean = p.trim()
  if (!clean) return ''
  if (!/[\u0980-\u09FF]/.test(clean)) {
    return polishJournalisticBody(clean)
  }

  const injected = injectedTranslator()
  if (injected) return polishJournalisticBody(await injected(clean))

  if (!isOffline()) {
    // Sentence-sized chunks, each raced across GTX and MyMemory, so no service ever gets (or returns) a cut-off paragraph.
    const translated = await translateComplete(clean)
    if (translated) return polishJournalisticBody(translated)
  }

  // Offline fallback: digits and entity normalization only — the Bengali prose itself
  // is left untranslated (never fabricated); callers must flag this for human review.
  return polishJournalisticBody(bengaliToAsciiDigits(clean))
}

/**
 * Translates an array of Bengali paragraphs into English in high-speed batches.
 * Preserves \n\n paragraph separation and processes all paragraphs in a single
 * Google GTX roundtrip (or parallel chunks if > 3,500 characters).
 */
export async function translateParagraphsBatch(paragraphs: string[]): Promise<string[]> {
  const cleanList = paragraphs.map((p) => p.trim()).filter(Boolean)
  if (cleanList.length === 0) return []

  const hasBengali = cleanList.some((p) => /[\u0980-\u09FF]/.test(p))
  if (!hasBengali) {
    return cleanList.map((p) => polishJournalisticBody(p))
  }
  if (injectedTranslator()) {
    return Promise.all(cleanList.map((p) => translateParagraph(p)))
  }

  // Group into batches GTX accepts in one GET (see GTX_MAX); a paragraph longer than that goes alone and is chunked
  // by translateParagraph. 3,500 characters used to be the limit here: as a URL that is ~31 kB, which Google refuses,
  // so every long story silently fell through to per-paragraph requests.
  const batches: { indices: number[]; text: string }[] = []
  let curIdxs: number[] = []
  let curText = ''

  for (let i = 0; i < cleanList.length; i++) {
    const p = cleanList[i]
    const addedLen = p.length + (curText ? 2 : 0)
    if (curText && curText.length + addedLen > GTX_MAX) {
      batches.push({ indices: curIdxs, text: curText })
      curIdxs = [i]
      curText = p
    } else {
      curIdxs.push(i)
      curText = curText ? `${curText}\n\n${p}` : p
    }
  }
  if (curIdxs.length > 0) {
    batches.push({ indices: curIdxs, text: curText })
  }

  const results: string[] = new Array(cleanList.length)

  await Promise.all(
    batches.map(async (batch) => {
      let translated = ''
      if (!isOffline()) {
        try {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), 4000)
          const gtxUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=bn&tl=en&dt=t&q=${encodeURIComponent(batch.text)}`
          const res = await fetch(gtxUrl, { signal: controller.signal })
          clearTimeout(timer)
          if (res.ok) {
            const data = await res.json()
            if (Array.isArray(data?.[0])) {
              translated = data[0].map((seg: unknown[]) => (typeof seg?.[0] === 'string' ? seg[0] : '')).join('')
            }
          }
        } catch {}
      }

      if (translated.trim()) {
        const parts = translated.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)
        if (parts.length === batch.indices.length) {
          batch.indices.forEach((origIdx, j) => {
            results[origIdx] = polishJournalisticBody(parts[j])
          })
          return
        }
      }

      // If batch count mismatched or failed, translate paragraphs of this batch concurrently
      await Promise.all(
        batch.indices.map(async (origIdx) => {
          results[origIdx] = await translateParagraph(cleanList[origIdx])
        })
      )
    })
  )

  return results.filter(Boolean)
}

// ---------------------------------------------------------------- AI translation (the editor's chosen provider)
// Gemini, Claude, OpenAI or OpenRouter — whichever the editor has a key for (aiProviders.ts). The prompt is the
// editor's own when they wrote one, else the newsroom prompt above; either way the reply must fill the same fields.

/** The translation prompt in force: the editor's own, or the built-in newsroom prompt. */
export function translationPrompt(s: AiSettings = loadAiSettings()): string {
  return s.prompt.trim() || JOURNALISTIC_TRANSLATOR_PROMPT
}

// How the body may be laid out. The marks are plain text, so a model that ignores them still returns a normal story, and
// every number in a table or chart is checked against the source afterwards.
const LAYOUT_RULES = [
  'Story layout (inside the body field only): write plain paragraphs separated by blank lines. Where the source supports it, structure the story with these line-start marks:',
  '- "## Heading" for a section sub-heading, only in a story of five or more paragraphs with clearly separate parts; never a heading on a short story.',
  '- Lines starting "- " for a list of three or more parallel items the source states (projects, figures, conditions); lines starting "1. " when the order matters.',
  '- A line starting "> " for ONE direct quotation of a full sentence or more worth featuring; the quotation then appears only there, with the speaker named in the next paragraph or on a second line "> — Name, role".',
  '- A table (rows of "| a | b |", the first row the header) only when the source gives the same figures for three or more years, projects or places, for example output by year. Never put figures in a table that the source does not state.',
  '- **bold** for at most two key figures or names and ==highlight== for at most one key phrase (a number or one to three words). Both are optional.',
  'Structure never changes the facts: every number, name and claim comes from the source, and nothing is added or dropped for the layout. Use no marks at all when the story is short or plain.',
  'charts field: a JSON array, written as text, of at most two chart ideas, or [] when the source does not give three or more comparable numbers (a time series, a split between places or companies). Shape: {"type":"bar|hbar|line|pie","title":"sentence-case headline of the chart","unit":"MMCFD","source":"who the source credits","labels":["2023","2024"],"series":[{"name":"","values":[15.8,16.9]}]}. Every value must be a number printed in the source, copied exactly: never calculate, round, convert or estimate one.',
].join('\n')

// Where each part of the answer goes. The editor's prompt (or the newsroom default) decides how to translate and write;
// this only maps the answer onto the desk's fields — and says so, because the built-in prompt still describes a labelled
// text layout and a meta block "at the end", which the structured reply replaces.
const REPLY_RULES = 'Reply format (this replaces any "Output Format" or labelled layout in the instructions above): answer only with the requested JSON fields, with no HEADLINE:/BODY: labels and no commentary. The meta title, meta description and keywords go in their own fields, never at the end of the body; the body is the complete article and nothing else. Follow every instruction above exactly: the field descriptions only add the site\'s character limits. Cover the whole story, including its last paragraphs: every fact of the source stays, in your own editing. No site name in any field.\n\n' + LAYOUT_RULES

/** The model's body as written: trailing spaces and runs of blank lines tidied, no word of it rewritten. */
const tidyBody = (t: string) => t.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim()

export const TRANSLATION_SCHEMA: AiSchema = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'The strongest fact as an active English news headline, at most 104 characters.' },
    deck: { type: 'string', description: 'One-sentence standfirst, at most 200 characters.' },
    slug: { type: 'string', description: 'kebab-case URL slug, at most 75 characters: meaning words only, no dates or amounts.' },
    focusKeywords: { type: 'string', description: '4 to 6 comma-separated specific phrases the story really uses and a reader would search: organisations, projects, places, topic; most important first. No bare numbers.' },
    metaTitle: { type: 'string', description: 'At most 60 characters, the main keyphrase early, no site name.' },
    metaDescription: { type: 'string', description: '120 to 160 characters, states the news, contains the main keyphrase naturally.' },
    facebook: { type: 'string', description: FACEBOOK_FIELD },
    body: { type: 'string', description: 'The complete finished English story: every fact of the source, edited as instructed, paragraphs separated by blank lines, with the layout marks described in the reply rules where the source supports them. Never drop the ending.' },
    charts: { type: 'string', description: 'JSON array as text of at most two chart ideas built only from numbers the source prints, or [] when there are none.' },
  },
  required: ['headline', 'deck', 'slug', 'focusKeywords', 'metaTitle', 'metaDescription', 'facebook', 'body', 'charts'],
}

async function translateWithAi(
  articleText: string,
  ai: { provider: AiProviderId; key: string; model: string },
  onProgress?: (status: string) => void,
): Promise<Partial<EditorialTranslationResult> & { modelUsed?: string; chartsJson?: string }> {
  let listed: Awaited<ReturnType<typeof listModels>> = []
  try { listed = await listModels(ai.provider, ai.key) } catch { /* the call below reports the real error */ }
  const first = resolveModel(ai.provider, ai.model, listed)
  // Gemini keeps a second chance on the best Flash model: a Pro model on a free tier is often rate-limited
  const models = ai.provider === 'gemini' ? Array.from(new Set([first, resolveModel('gemini', 'auto', listed)])) : [first]
  const name = providerMeta(ai.provider).name
  let lastError = ''
  for (const model of models) {
    const label = ai.provider === 'gemini' ? geminiLabel(model) : `${name} · ${listed.find((m) => m.id === model)?.label ?? model}`
    onProgress?.(`Translating with ${label}…`)
    try {
      // A full article takes a fast model 10–30 s and a careful one up to a minute or two.
      const { data, model: used } = await aiJson<Record<string, string>>({
        provider: ai.provider, key: ai.key, model,
        system: `${translationPrompt()}\n\n${REPLY_RULES}`,
        user: `Bengali news article to translate:\n\n${articleText}`,
        schema: TRANSLATION_SCHEMA,
        maxTokens: 32000,
        effort: 'medium',
        timeoutMs: /pro|opus/.test(model) ? 240_000 : 150_000,
      })
      if (!data.headline || !data.body) { lastError = `${label} returned no article`; continue }
      return {
        headline: String(data.headline).trim(),
        deck: data.deck?.trim(),
        slug: data.slug?.trim(),
        focusKeywords: data.focusKeywords?.trim(),
        metaTitle: data.metaTitle?.trim(),
        metaDescription: data.metaDescription?.trim(),
        facebook: data.facebook?.trim(),
        body: String(data.body).trim(),
        chartsJson: data.charts,
        modelUsed: used,
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
  }
  throw new Error(lastError || `${name} unreachable`)
}

/**
 * Main translation & CMS story compilation pipeline.
 * Translates Bengali news article into natural, professional English.
 * Strictly enforces:
 * - Headline <= 104 characters
 * - Deck <= 200 characters
 * - Slug <= 80 characters
 * - Full English story body with preserved paragraph & fact structure
 * - Focus keywords, Meta Title, and Meta Description
 */
export async function translateNewsArticle(
  input: {
    title: string
    deck?: string
    paragraphs: string[]
    throwOnAiFailure?: boolean
  },
  onProgress?: (status: string) => void,
): Promise<EditorialTranslationResult> {
  const ai = aiFor('main')

  const combinedBengaliText = [
    `Title: ${input.title}`,
    input.deck ? `Deck: ${input.deck}` : '',
    ...input.paragraphs,
  ].filter(Boolean).join('\n\n')

  // 1. The editor's AI provider, when a key is set
  if (ai) {
    try {
      const parsed = await translateWithAi(combinedBengaliText, ai, onProgress)

      if (parsed.headline && parsed.body) {
        // Completeness guard: a reply with far fewer paragraphs than the source has dropped part of the story.
        const marked = tidyBody(parsed.body)
        const rich = hasStoryMarks(marked) ? storyFromMarkup(marked) : null
        const outParas = (rich ? rich.plain : parsed.body).split(/\n\s*\n/).filter((p) => p.trim()).length
        const srcParas = input.paragraphs.filter((p) => p.trim()).length
        const incomplete = srcParas >= 4 && outParas < Math.ceil(srcParas * 0.6)
        const headline = enforceHeadlineLength(parsed.headline, 104)
        const deck = enforceDeckLength(parsed.deck || input.deck || '', 200)
        const body = rich && rich.plain ? rich.plain : marked
        const focusKeywords = alignKeywords(headline, body, parsed.metaTitle, parsed.focusKeywords || extractFocusKeywords(headline, `${deck} ${body}`))
        const slug = cleanSlug(parsed.slug ?? '') || buildSlug(headline, firstKeyphrase(focusKeywords)) || generateSlug(headline, 80)
        const { metaTitle, metaDescription } = seoFields(headline, deck, body, focusKeywords, parsed.metaTitle, parsed.metaDescription)

        return {
          headline,
          deck,
          slug,
          focusKeywords,
          metaTitle,
          metaDescription,
          body,
          bodyHtml: rich && rich.plain ? rich.html : undefined,
          charts: validateChartIdeas(parsed.chartsJson ?? '', combinedBengaliText),
          facebook: parsed.facebook ? sanitizeFacebook(parsed.facebook, headline) : undefined,
          provider: ai.provider,
          modelUsed: parsed.modelUsed,
          coverageWarning: incomplete ? `The AI returned ${outParas} paragraphs for a ${srcParas}-paragraph source — check the ending against the original.` : undefined,
        }
      }
    } catch (err) {
      if (input.throwOnAiFailure) {
        throw err
      }
      console.warn(`${providerMeta(ai.provider).name} translation failed, using built-in newsroom engine:`, err)
      onProgress?.(`${providerMeta(ai.provider).name} unavailable (${(err as Error).message}), switching to machine translation…`)
    }
  }

  // 2. Built-in High-Speed Journalistic Translation Pipeline (Concurrent Sub-Second Engine)
  onProgress?.('Translating headline, deck, and full story concurrently…')
  let usedNeural = false

  const [headline, deck, translatedParagraphs] = await Promise.all([
    // A. Headline Translation & Polish (< 104 chars)
    (async () => {
      let rawH = input.title
      if (/[\u0980-\u09FF]/.test(rawH)) {
        usedNeural = true
        rawH = await translateBengaliToEnglish(rawH)
      }
      return enforceHeadlineLength(polishJournalisticEnglish(rawH), 104)
    })(),

    // B. Deck Translation & Polish (< 200 chars)
    (async () => {
      let rawD = input.deck || input.paragraphs[0] || ''
      if (/[\u0980-\u09FF]/.test(rawD)) {
        usedNeural = true
        try {
          rawD = await translateBengaliToEnglish(rawD)
        } catch {
          rawD = bengaliToAsciiDigits(rawD)
        }
      }
      return enforceDeckLength(polishJournalisticEnglish(rawD), 200)
    })(),

    // C. High-Speed Batch Body Translation (Single GTX Call / Parallel Chunks)
    (async () => {
      if (input.paragraphs.length === 0) return []
      usedNeural = true
      return translateParagraphsBatch(input.paragraphs)
    })(),
  ])

  const body = translatedParagraphs.join('\n\n') || headline

  // SEO fields, built the way the SEO panel grades them
  const focusKeywords = extractFocusKeywords(headline, body)
  const slug = buildSlug(headline, firstKeyphrase(focusKeywords)) || generateSlug(headline, 80)
  const { metaTitle, metaDescription } = seoFields(headline, deck, body, focusKeywords)

  // Honest provenance: only claim the "neural" engine actually ran if it left no
  // untranslated Bengali behind. Otherwise report "offline" and flag for human review,
  // rather than silently presenting unconverted source text as a finished translation.
  const stillBengali = /[ঀ-৿]/.test(`${headline} ${deck} ${body}`)
  const translationFailed = usedNeural && stillBengali

  return {
    headline,
    deck,
    slug,
    translationFailed,
    focusKeywords,
    metaTitle,
    metaDescription,
    body,
    provider: usedNeural && !translationFailed ? 'neural' : 'offline',
  }
}
