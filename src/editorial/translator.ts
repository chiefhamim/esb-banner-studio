// Bilingual journalistic translation and CMS story compilation engine for ESB PowerLine.
// Strictly adheres to the professional newsroom translator prompt specification.

import { polishJournalisticEnglish, translateBengaliToEnglish } from '../core/newsroom'
import { bengaliToAsciiDigits } from './bengali'
import { raceTranslate } from './translateNet'

export interface EditorialTranslationResult {
  headline: string          // strictly <= 104 characters
  deck: string              // strictly <= 200 characters
  slug: string              // strictly <= 80 characters
  focusKeywords: string     // comma-separated SEO focus keyphrases
  metaTitle: string         // SEO meta title
  metaDescription: string   // SEO meta description
  body: string              // full English story body
  provider: 'gemini' | 'neural' | 'offline'
  modelUsed?: string
  /** True when Bengali source text could not be machine-translated (no network/API reachable) and still needs a human translator's review. */
  translationFailed?: boolean
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

/** Extract top focus keywords & high-value keyphrases from headline, deck, and English body. */
export function extractFocusKeywords(headline: string, bodyText: string): string {
  const candidates: string[] = []
  const seen = new Set<string>()
  const addCandidate = (kw: string) => {
    const clean = kw.trim().replace(/^[,.;:!?]+|[,.;:!?]+$/g, '')
    if (!clean || clean.length < 3) return
    const key = clean.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      candidates.push(clean)
    }
  }

  const text = `${headline} ${bodyText}`

  const knownEntities = [
    'Petrobangla',
    'BAPEX',
    'BPDB',
    'BERC',
    'PGCB',
    'Power Division',
    'EMRD',
    'BREB',
    'DESCO',
    'DPDC',
    'NESCO',
    'WZPDCO',
    'BPC',
    'RPGCL',
    'SREDA',
    'Sylhet Gas Field',
    'SGFL',
    'BGFCL',
    'Titas Gas',
    'Bakhrabad Gas',
    'Jalalabad Gas',
    'Karnaphuli Gas',
    'Bibiyana Gas Field',
    'Rashidpur Gas Field',
    'Kailashtila Gas Field',
    'Bhola Gas Field',
    'Rooppur Nuclear Power Plant',
    'Matarbari Power Plant',
    'Payra Power Plant',
    'Rampal Power Plant',
    'Kaptai Hydroelectric',
    'Barapukuria Coal',
    'Adani Power',
    'Summit Power',
    'Chevron Bangladesh',
    'QatarEnergy',
    'National Grid',
    'Gas Exploration',
    'Well Drilling',
    'Power Generation',
    'Electricity Tariff',
    'Power Import',
    'Cross-Border Energy Trade',
    'Renewable Energy',
    'Solar Power',
    'Rooftop Solar',
    'Wind Energy',
    'Spot LNG',
    'LNG Terminal',
    'FSRU',
    'LPG Market',
    'Fuel Oil',
    'Energy Security',
    'Load Shedding',
    'Peak Electricity Demand',
  ]

  for (const ent of knownEntities) {
    if (new RegExp(`\\b${ent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) {
      addCandidate(ent)
    }
  }

  // Extract monetary and capacity phrases
  const currencyMatches = text.matchAll(/(?:Tk|BDT|\$|USD)\s*\d[\d,.]*\s*(?:crore|lakh|billion|million)?/gi)
  for (const m of currencyMatches) addCandidate(m[0])

  const capacityMatches = text.matchAll(/\d[\d,.]*\s*(?:MMCFD(?:\s+Gas)?|MW|GW|kWh|kV|metric\s+tons?)/gi)
  for (const m of capacityMatches) addCandidate(m[0])

  // Extract capitalized multi-word proper noun phrases from headline
  const properPhrases = headline.matchAll(/\b([A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+){1,2})\b/g)
  for (const m of properPhrases) {
    if (!/^(The|In|On|At|For|With|From|Into|Over|Under|After|Before)\b/.test(m[1])) {
      addCandidate(m[1])
    }
  }

  if (candidates.length < 4) {
    const stopWords = new Set(['the', 'about', 'under', 'after', 'their', 'which', 'there', 'would', 'could', 'should', 'between', 'through', 'during', 'before', 'around'])
    const words = headline
      .replace(/[^\w\s-]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 4 && !stopWords.has(w.toLowerCase()))
    for (const w of words) addCandidate(w)
  }

  return candidates.slice(0, 6).join(', ')
}

/** Strictly generates SEO metadata (slug, keywords, meta title, meta desc) ONLY from the translated English story. */
export function buildSeoFromEnglishStory(headline: string, deck = '', bodyText = '') {
  const cleanHeadline = enforceHeadlineLength(headline, 104)
  const cleanDeck = enforceDeckLength(deck, 200)
  const slug = generateSlug(cleanHeadline, 80)
  const focusKeywords = extractFocusKeywords(cleanHeadline, `${cleanDeck} ${bodyText}`)

  const suffix = ' | ESB PowerLine'
  const maxBase = 60 - suffix.length // 44 chars
  let baseTitle = cleanHeadline
  if (baseTitle.length > maxBase) {
    const sub = baseTitle.slice(0, maxBase)
    const lastSpace = sub.lastIndexOf(' ')
    baseTitle = (lastSpace > 22 ? sub.slice(0, lastSpace) : sub).replace(/[,:;–—-]+$/, '').trim()
  }
  const metaTitle = `${baseTitle}${suffix}`

  const rawDescSource = cleanDeck && cleanDeck.length >= 50
    ? cleanDeck
    : [cleanDeck, bodyText.split(/\n+/)[0] || ''].filter(Boolean).join(' — ')
  const metaDescription = enforceDeckLength(rawDescSource || cleanHeadline, 158)

  return { slug, focusKeywords, metaTitle, metaDescription }
}

let cachedWorkingGeminiModel: string | null = null
let cachedDiscoveredModels: { key: string; models: string[] } | null = null

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
    // Race GTX and MyMemory under one short deadline; take whichever answers first.
    const translated = await raceTranslate(clean)
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

  // Group into batches of <= 3,500 characters
  const batches: { indices: number[]; text: string }[] = []
  let curIdxs: number[] = []
  let curText = ''

  for (let i = 0; i < cleanList.length; i++) {
    const p = cleanList[i]
    const addedLen = p.length + (curText ? 2 : 0)
    if (curText && curText.length + addedLen > 3500) {
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
          const timer = setTimeout(() => controller.abort(), 2200)
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

/**
 * Quick validation helper to test if an API key connects to Google AI Studio.
 * Queries the active models on the key first, then tests prompt generation on the latest active Flash model.
 */
export async function testGeminiApiKey(apiKey: string): Promise<{ ok: boolean; model?: string; error?: string }> {
  const clean = apiKey.trim()
  if (!clean) return { ok: false, error: 'Please enter an API key.' }
  try {
    // 1. Check models endpoint to validate API key permissions
    const modelsRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${clean}`)
    if (!modelsRes.ok) {
      const errJson = await modelsRes.json().catch(() => null)
      const msg = errJson?.error?.message || `HTTP ${modelsRes.status} (${modelsRes.statusText})`
      return { ok: false, error: msg }
    }

    const modelsData = await modelsRes.json()
    const activeModels: string[] = Array.isArray(modelsData?.models)
      ? modelsData.models
          .map((m: { name?: string; supportedGenerationMethods?: string[] }) => {
            const name = (typeof m?.name === 'string' ? m.name.replace(/^models\//, '') : '')
            const canGen = !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent')
            return canGen ? name : ''
          })
          .filter(Boolean)
      : []

    // Try available models dynamically so deprecated models never block the user
    const candidateList = [
      ...activeModels.filter((m) => m.includes('flash') && !m.includes('thinking')),
      ...activeModels.filter((m) => m.includes('flash')),
      ...activeModels,
      'gemini-2.0-flash',
      'gemini-1.5-flash',
      'gemini-2.5-flash',
    ].filter((v, i, a) => a.indexOf(v) === i)

    let lastError = ''
    for (const modelToTest of candidateList.slice(0, 4)) {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 5000)
        const pingRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelToTest}:generateContent?key=${clean}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Ping' }] }],
            generationConfig: { maxOutputTokens: 5 },
          }),
          signal: controller.signal,
        })
        clearTimeout(timer)

        if (pingRes.ok) {
          cachedWorkingGeminiModel = modelToTest
          return { ok: true, model: modelToTest }
        }
        const pingErr = await pingRes.json().catch(() => null)
        lastError = pingErr?.error?.message || `HTTP ${pingRes.status} on model ${modelToTest}`
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
      }
    }

    if (activeModels.length > 0) {
      cachedWorkingGeminiModel = activeModels[0]
      return { ok: true, model: activeModels[0] }
    }
    return { ok: false, error: lastError || 'No active generative models found on this key.' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Helper to query active Google AI Studio models available for this user's key. */
async function getAvailableGeminiModels(apiKey: string): Promise<string[]> {
  if (cachedDiscoveredModels && cachedDiscoveredModels.key === apiKey) {
    return cachedDiscoveredModels.models
  }
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 4000)
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, { signal: controller.signal })
    clearTimeout(timer)
    if (res.ok) {
      const data = await res.json()
      if (Array.isArray(data?.models)) {
        const names: string[] = data.models
          .map((m: { name?: string; supportedGenerationMethods?: string[] }) => {
            const n = m.name?.replace(/^models\//, '') || ''
            const canGen = !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent')
            return canGen ? n : ''
          })
          .filter(Boolean)
        const flash = names.filter((n) => n.includes('flash'))
        const others = names.filter((n) => !n.includes('flash') && n.startsWith('gemini'))
        const list = [...flash, ...others]
        cachedDiscoveredModels = { key: apiKey, models: list }
        return list
      }
    }
  } catch {}
  return []
}

/**
 * Call Gemini API with Structured JSON Schema output for direct, exact newsroom CMS field extraction.
 * Dynamically queries available models, cascading through latest Gemini Flash models with strict 6s timeout.
 */
async function translateWithGemini(
  articleText: string,
  apiKey: string,
): Promise<Partial<EditorialTranslationResult> & { modelUsed?: string }> {
  // Use cached model if verified, otherwise fast default flash models
  const initialCandidates = cachedWorkingGeminiModel
    ? [cachedWorkingGeminiModel, 'gemini-2.0-flash', 'gemini-1.5-flash']
    : ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.5-flash']

  let models = Array.from(new Set(initialCandidates))
  let lastError = ''
  let attempted = 0

  for (const model of models) {
    attempted++
    if (attempted > 2) break // Cap attempts to 2 models to prevent slow cascades

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

    // 1. Try Structured JSON Schema mode with 6s timeout
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 6500)
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: `${JOURNALISTIC_TRANSLATOR_PROMPT}\n\nStrict Rule: You must generate the response strictly conforming to the requested JSON schema. All facts, numbers, dates, quotes, and names must remain 100% faithful to the source article. Provide a complete, natural, multi-paragraph journalistic translation without summarizing or omitting any details.`,
            }],
          },
          contents: [{
            parts: [{
              text: `Bengali News Article that will have the above instructions applied:\n\n${articleText}`,
            }],
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                headline: {
                  type: 'STRING',
                  description: 'Clear, natural, professional international English news headline strictly under 104 characters.',
                },
                deck: {
                  type: 'STRING',
                  description: 'Catchy, punchy sub-headline or lead summary sentence strictly under 200 characters.',
                },
                slug: {
                  type: 'STRING',
                  description: 'Clean kebab-case URL permalink slug under 80 characters derived strictly from the English headline.',
                },
                focusKeywords: {
                  type: 'STRING',
                  description: '5 to 7 high-value comma-separated SEO focus keywords and keyphrases (entities, projects, capacities, sector topics).',
                },
                metaTitle: {
                  type: 'STRING',
                  description: 'High-CTR SEO meta headline under 60 characters ending with | ESB PowerLine.',
                },
                metaDescription: {
                  type: 'STRING',
                  description: 'Compelling SEO meta description between 120 and 158 characters for search results.',
                },
                body: {
                  type: 'STRING',
                  description: 'Full, complete English news article body with paragraphs separated by double newlines, preserving all quotes, facts, and paragraph structure.',
                },
              },
              required: ['headline', 'deck', 'slug', 'focusKeywords', 'metaTitle', 'metaDescription', 'body'],
            },
          },
        }),
      })
      clearTimeout(timer)

      if (res.ok) {
        const data = await res.json()
        const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text
        if (candidateText) {
          try {
            const parsed = JSON.parse(candidateText)
            if (parsed.headline && parsed.body) {
              cachedWorkingGeminiModel = model
              return {
                headline: parsed.headline.trim(),
                deck: parsed.deck?.trim(),
                slug: parsed.slug?.trim(),
                focusKeywords: parsed.focusKeywords?.trim(),
                metaTitle: parsed.metaTitle?.trim(),
                metaDescription: parsed.metaDescription?.trim(),
                body: parsed.body?.trim(),
                modelUsed: model,
              }
            }
          } catch {
            const out = parsePastedAiOutput(candidateText)
            cachedWorkingGeminiModel = model
            return { ...out, modelUsed: model }
          }
        }
      } else {
        const errJson = await res.json().catch(() => null)
        const msg = errJson?.error?.message || `HTTP ${res.status}`
        lastError = `${model}: ${msg}`
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
  }

  // If primary candidates failed and we haven't discovered yet, try active discovered models
  if (!cachedDiscoveredModels) {
    const discovered = await getAvailableGeminiModels(apiKey)
    if (discovered.length > 0 && !models.includes(discovered[0])) {
      const topDiscovered = discovered[0]
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 6500)
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${topDiscovered}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{
              parts: [{ text: `${JOURNALISTIC_TRANSLATOR_PROMPT}\n\nBengali News Article:\n\n${articleText}` }],
            }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
          }),
        })
        clearTimeout(timer)
        if (res.ok) {
          const fallbackData = await res.json()
          const textOutput = fallbackData.candidates?.[0]?.content?.parts?.[0]?.text
          if (textOutput) {
            cachedWorkingGeminiModel = topDiscovered
            return { ...parsePastedAiOutput(textOutput), modelUsed: topDiscovered }
          }
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
      }
    }
  }

  throw new Error(`Gemini API Error: ${lastError || 'Service temporarily unreachable'}`)
}

/** Builds the complete prompt for web chat interfaces (gemini.google.com, chatgpt.com, claude.ai) */
export function buildWebChatPrompt(source: { title: string; deck?: string; paragraphs: string[] }): string {
  const cleanBody = source.paragraphs.join('\n\n')
  return `${JOURNALISTIC_TRANSLATOR_PROMPT}

Bengali News Article that will have the above instructions applied:

Headline: ${source.title}
${source.deck ? `Deck: ${source.deck}\n` : ''}
Article Body:
${cleanBody}`
}

/** Parses raw output pasted from Gemini web, ChatGPT, or Claude into structured CMS fields. */
export function parsePastedAiOutput(rawText: string): Partial<EditorialTranslationResult> {
  const text = rawText.trim()
  if (!text) return {}

  // 1. Try structured tags (HEADLINE:, **Headline:**, # Headline, etc.)
  const headlineMatch = text.match(/(?:(?:HEADLINE|\*\*Headline\*\*|Headline)\s*:\s*|^#\s+)([^\n]+)/im)
  const deckMatch = text.match(/(?:DECK|\*\*Deck\*\*|Deck|Sub-headline)\s*:\s*([^\n]+)/im)
  const slugMatch = text.match(/(?:SLUG|\*\*Slug\*\*|Slug|URL Slug)\s*:\s*([^\n]+)/im)
  const keywordsMatch = text.match(/(?:FOCUS_KEYWORDS|\*\*Focus Keywords\*\*|Focus Keywords|Keywords)\s*:\s*([^\n]+)/im)
  const metaTitleMatch = text.match(/(?:META_TITLE|\*\*Meta Title\*\*|Meta Title)\s*:\s*([^\n]+)/im)
  const metaDescMatch = text.match(/(?:META_DESCRIPTION|\*\*Meta Description\*\*|Meta Description)\s*:\s*([^\n]+)/im)

  let body = ''
  const bodyMatch = text.match(/(?:BODY|\*\*Body\*\*|Article Body|English Article Body)\s*:\s*([\s\S]+)$/i)
  if (bodyMatch) {
    body = bodyMatch[1]
      .replace(/(?:META_TITLE|Meta Title|FOCUS_KEYWORDS|Focus Keywords)[\s\S]*$/i, '')
      .trim()
  }

  // 2. Fallback heuristic if unstructured:
  let headline = headlineMatch ? headlineMatch[1].trim() : ''
  let deck = deckMatch ? deckMatch[1].trim() : ''

  if (!headline) {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length > 0) {
      headline = lines[0].replace(/^[#*-\s]+|[#*-\s]+$/g, '')
      if (!body && lines.length > 1) {
        if (!deck && lines[1].length < 200) {
          deck = lines[1]
          body = lines.slice(2).join('\n\n')
        } else {
          body = lines.slice(1).join('\n\n')
        }
      }
    }
  }

  headline = enforceHeadlineLength(headline, 104)
  deck = enforceDeckLength(deck, 200)
  const slug = generateSlug(slugMatch ? slugMatch[1].trim() : headline, 80)
  const focusKeywords = keywordsMatch ? keywordsMatch[1].trim() : extractFocusKeywords(headline, body)
  const suffix = ' | ESB PowerLine'
  const maxBase = Math.max(20, 60 - suffix.length)
  const metaTitle = metaTitleMatch ? metaTitleMatch[1].trim() : `${headline.slice(0, maxBase).trim()}${suffix}`
  const metaDescription = metaDescMatch ? metaDescMatch[1].trim() : enforceDeckLength(deck || body.slice(0, 150), 160)

  return {
    headline,
    deck,
    slug,
    focusKeywords,
    metaTitle,
    metaDescription,
    body: body || text,
  }
}

/** Parses the structured output fields from LLM response. */
export function parseLlmOutput(output: string): Partial<EditorialTranslationResult> {
  const result: Partial<EditorialTranslationResult> = {}

  const headlineMatch = output.match(/HEADLINE:\s*([^\n]+)/i)
  if (headlineMatch) result.headline = headlineMatch[1].trim()

  const deckMatch = output.match(/DECK:\s*([^\n]+)/i)
  if (deckMatch) result.deck = deckMatch[1].trim()

  const slugMatch = output.match(/SLUG:\s*([^\n]+)/i)
  if (slugMatch) result.slug = slugMatch[1].trim()

  const keywordsMatch = output.match(/FOCUS_KEYWORDS:\s*([^\n]+)/i)
  if (keywordsMatch) result.focusKeywords = keywordsMatch[1].trim()

  const metaTitleMatch = output.match(/META_TITLE:\s*([^\n]+)/i)
  if (metaTitleMatch) result.metaTitle = metaTitleMatch[1].trim()

  const metaDescMatch = output.match(/META_DESCRIPTION:\s*([^\n]+)/i)
  if (metaDescMatch) result.metaDescription = metaDescMatch[1].trim()

  const bodyMatch = output.match(/BODY:\s*([\s\S]+)$/i)
  if (bodyMatch) {
    result.body = bodyMatch[1].trim()
  }

  return result
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
    apiKey?: string
    throwOnAiFailure?: boolean
  },
  onProgress?: (status: string) => void,
): Promise<EditorialTranslationResult> {
  const apiKey = input.apiKey?.trim() || (typeof localStorage !== 'undefined' ? localStorage.getItem('esb-banner-studio/ai-key')?.trim() : '')

  const combinedBengaliText = [
    `Title: ${input.title}`,
    input.deck ? `Deck: ${input.deck}` : '',
    ...input.paragraphs,
  ].filter(Boolean).join('\n\n')

  // 1. If Gemini API Key is available, invoke Gemini model
  if (apiKey) {
    try {
      onProgress?.('Translating with Gemini Studio AI (Structured JSON Mode)…')
      const parsed = await translateWithGemini(combinedBengaliText, apiKey)

      if (parsed.headline && parsed.body) {
        const headline = enforceHeadlineLength(parsed.headline, 104)
        const deck = enforceDeckLength(parsed.deck || input.deck || '', 200)
        const slug = generateSlug(parsed.slug || headline, 80)
        const body = polishJournalisticBody(parsed.body)
        const seo = buildSeoFromEnglishStory(headline, deck, body)
        const focusKeywords = parsed.focusKeywords || seo.focusKeywords
        const metaTitle = parsed.metaTitle || seo.metaTitle
        const metaDescription = parsed.metaDescription || seo.metaDescription

        return {
          headline,
          deck,
          slug,
          focusKeywords,
          metaTitle,
          metaDescription,
          body,
          provider: 'gemini',
          modelUsed: parsed.modelUsed || 'gemini-2.0-flash',
        }
      }
    } catch (err) {
      if (input.throwOnAiFailure) {
        throw err
      }
      console.warn('Gemini translation failed, using built-in newsroom engine:', err)
      onProgress?.(`Gemini unavailable (${(err as Error).message}), switching to neural translation…`)
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

  // Generate Slug (< 80 chars)
  const slug = generateSlug(headline, 80)

  // Generate SEO Meta Fields
  const focusKeywords = extractFocusKeywords(headline, body)
  const suffix = ' | ESB PowerLine'
  const maxBase = Math.max(20, 60 - suffix.length)
  const metaTitle = `${headline.slice(0, maxBase).trim()}${suffix}`
  const metaDescription = enforceDeckLength(deck || body.slice(0, 150), 160)

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
