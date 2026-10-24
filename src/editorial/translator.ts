// Bilingual journalistic translation and CMS story compilation engine for ESB PowerLine.
// Strictly adheres to the professional newsroom translator prompt specification.

import { polishJournalisticEnglish, translateBengaliToEnglish } from '../core/newsroom'
import { bengaliToAsciiDigits } from './bengali'
import { GTX_MAX, translateComplete } from './translateNet'
import { aiFor, aiJson, geminiLabel, listModels, loadAiSettings, providerMeta, resolveModel } from './aiProviders'
import type { AiProviderId, AiSchema, AiSettings } from './aiProviders'
import { DESCRIPTION_MAX, buildMetaDescription, buildMetaTitle, buildSlug, countPhrase, suggestKeyphrases } from './seo'

export interface EditorialTranslationResult {
  headline: string          // strictly <= 104 characters
  deck: string              // strictly <= 200 characters
  slug: string              // strictly <= 80 characters
  focusKeywords: string     // comma-separated SEO focus keyphrases
  metaTitle: string         // SEO meta title
  metaDescription: string   // SEO meta description
  body: string              // full English story body
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

export const JOURNALISTIC_TRANSLATOR_PROMPT = `You are a professional bilingual news editor and translator specializing in Bengali-to-English journalism.

Your task is to translate the provided Bengali news article into clear, natural, professional English while strictly preserving the original meaning, facts, context, tone, intent, and journalistic integrity.

Translation Requirements:
1. Preserve all facts, quotes, names, dates, numbers, locations, and contextual details exactly as they appear in the source.
2. Do not add, remove, speculate, exaggerate, simplify, or reinterpret information.
3. Maintain the original message, narrative structure, and editorial neutrality.
4. Translate idioms, expressions, and culturally specific phrases into their closest natural English equivalents while preserving their intended meaning.
5. Write in the style of a reputable international news publication, using clear, polished, and professional journalistic English.
6. Ensure the text remains human-sounding, readable, and engaging rather than robotic or overly literal.
7. Avoid sensationalism, clickbait language, editorial opinions, or unnecessary embellishment.
8. Keep paragraph structure similar to the original whenever practical.
9. Preserve direct quotations faithfully while making them grammatically natural in English.
10. If a phrase is ambiguous, choose the most contextually accurate translation rather than inventing meaning.
11. Do not summarize or condense the article. Provide a complete translation.
12. Do not explain your translation choices unless explicitly asked.
13. Retain the original headline's intent and tone while adapting it into professional English news style.

Before providing the final translation, internally verify that:
- No factual information has been altered.
- No important details have been omitted.
- The translation reads naturally to an English-speaking news audience.
- The journalistic tone remains faithful to the source article.
- The end of the translation shall show meta title, meta description and meta focus keywords as well.

Output Format:
HEADLINE: <English Headline under 104 characters>
DECK: <Catchy summary sentence under 200 characters>
SLUG: <kebab-case-url-slug-under-80-characters>
FOCUS_KEYWORDS: <5 to 7 high-value comma-separated SEO focus keyphrases>
META_TITLE: <Compelling SEO meta headline between 50 and 60 characters>
META_DESCRIPTION: <Engaging SEO meta description between 120 and 160 characters>
BODY:
<English Article Body paragraphs separated by double newlines>`

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

// Where each part of the answer goes. The editor's prompt (or the newsroom default) decides how to translate and write;
// this only maps the answer onto the desk's fields — and says so, because the built-in prompt still describes a labelled
// text layout and a meta block "at the end", which the structured reply replaces.
const REPLY_RULES = 'Reply format (this replaces any "Output Format" or labelled layout in the instructions above): answer only with the requested JSON fields, with no HEADLINE:/BODY: labels and no commentary. The meta title, meta description and keywords go in their own fields, never at the end of the body; the body is the complete article and nothing else. Follow every instruction above exactly: the field descriptions only add the site\'s character limits. Translate the whole article without summarising, merging or omitting any paragraph, including the last ones. No site name in any field.'

/** The model's body as written: trailing spaces and runs of blank lines tidied, no word of it rewritten. */
const tidyBody = (t: string) => t.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim()

export const TRANSLATION_SCHEMA: AiSchema = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'Clear, natural, professional international English news headline strictly under 104 characters.' },
    deck: { type: 'string', description: 'One-sentence standfirst strictly under 200 characters.' },
    slug: { type: 'string', description: 'kebab-case URL slug under 75 characters from the English headline: meaning words only, no dates or amounts.' },
    focusKeywords: { type: 'string', description: '4 to 6 comma-separated search phrases a reader would type to find this story: named organisations, projects, places and the topic, most important first. No bare numbers, no generic words.' },
    metaTitle: { type: 'string', description: 'Search result title of at most 60 characters that names the main keyphrase early. No site name: esbpowerline.com prints none.' },
    metaDescription: { type: 'string', description: 'Search snippet of 120 to 160 characters that states the news and contains the main keyphrase.' },
    body: { type: 'string', description: 'The COMPLETE English article: every paragraph and every sentence of the source, in order, paragraphs separated by blank lines. Never summarise or drop the ending.' },
  },
  required: ['headline', 'deck', 'slug', 'focusKeywords', 'metaTitle', 'metaDescription', 'body'],
}

async function translateWithAi(
  articleText: string,
  ai: { provider: AiProviderId; key: string; model: string },
  onProgress?: (status: string) => void,
): Promise<Partial<EditorialTranslationResult> & { modelUsed?: string }> {
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
        body: String(data.body).trim(),
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
        const outParas = parsed.body.split(/\n\s*\n/).filter((p) => p.trim()).length
        const srcParas = input.paragraphs.filter((p) => p.trim()).length
        const incomplete = srcParas >= 4 && outParas < Math.ceil(srcParas * 0.6)
        const headline = enforceHeadlineLength(parsed.headline, 104)
        const deck = enforceDeckLength(parsed.deck || input.deck || '', 200)
        const body = tidyBody(parsed.body)
        const focusKeywords = parsed.focusKeywords || extractFocusKeywords(headline, `${deck} ${body}`)
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
