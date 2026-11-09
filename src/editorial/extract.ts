// DOMParser-based offline article extractor.
// Extracts clean article headline, deck, body paragraphs, byline, publisher, date, and media from HTML.
import { sanitizeBodyHtml } from './richBody'

export interface ExtractedImage {
  src: string
  alt: string
  caption?: string
  credit?: string
}

/** How the story was recovered from the page, so the desk can see what it is working from. */
export interface ExtractionMeta {
  /** structured = schema.org NewsArticle JSON-LD · markup = scored article block · page-data = embedded app state · metadata-only = title/description only */
  method: 'structured' | 'markup' | 'page-data' | 'metadata-only'
  language: 'bn' | 'en' | 'mixed' | 'unknown'
  warnings: string[]
  /** CSS path of the block the paragraphs came from (markup method). */
  contentSelector?: string
}

export interface ExtractedArticle {
  title: string
  deck?: string
  byline?: string
  publisher?: string
  publishedAt?: string
  canonicalUrl?: string
  paragraphs: string[]
  images: ExtractedImage[]
  rawHtmlLength: number
  sha256?: string
  meta?: ExtractionMeta
}

/** Comprehensive filter for editorial noise, publisher/editor names, commercial office addresses, disclaimers, and ads. */
const BOILERPLATE_PATTERNS = [
  /সম্পাদক\s*ও\s*প্রকাশক/i,
  /ভারপ্রাপ্ত\s*সম্পাদক/i,
  /প্রধান\s*সম্পাদক/i,
  /উপদেষ্টা\s*সম্পাদক/i,
  /বার্তা\s*সম্পাদক/i,
  /নির্বাহী\s*সম্পাদক/i,
  /ব্যবস্থাপনা\s*সম্পাদক/i,
  /সহ[- ]?সম্পাদক/i,
  /প্রধান\s*বার্তা\s*সম্পাদক/i,
  /যুগ্ম\s*বার্তা\s*সম্পাদক/i,
  /নগর\s*সম্পাদক/i,
  /মফস্বল\s*সম্পাদক/i,
  /অনলাইন\s*ইনচার্জ/i,
  /প্রকাশক\s*কর্তৃক/i,
  /মুদ্রিত\s*ও\s*প্রকাশিত/i,
  /প্রকাশিত\s*ও\s*প্রচারিত/i,
  /ঢাকা\s*থেকে\s*প্রকাশিত/i,
  /অনলাইন\s*(?:সংস্করণ|ভার্সন|এডিশন)/i,
  /ডিজিটাল\s*(?:সংস্করণ|এডিশন)/i,
  /কাগজের\s*সংস্করণ/i,
  /মুদ্রণ\s*(?:সংস্করণ|লাইন)/i,
  /প্রিন্টার্স\s*লাইন/i,
  /প্রেস\s*থেকে\s*মুদ্রিত/i,
  /আল[- ]ফালাহ\s*প্রিন্টিং/i,
  /বিজি\s*প্রেস/i,
  /editor\s*(?:&|and)\s*publisher/i,
  /editor-in-chief/i,
  /executive\s*editor/i,
  /managing\s*editor/i,
  /published\s*by/i,
  /printed\s*by/i,
  /বার্তা\s*ও\s*বাণিজ্যিক\s*কার্যালয়/i,
  /সম্পাদকীয়\s*ও\s*বাণিজ্যিক/i,
  /বাণিজ্যিক\s*কার্যালয়/i,
  /কর্পোরেট\s*অফিস/i,
  /প্রগতি\s*সরণি/i,
  /তেজগাঁও\s*শিল্প\s*এলাকা/i,
  /যোগাযোগ\s*:\s*/i,
  /(?:ফোন|ইমেইল|ফ্যাক্স|পিএবিএক্স|মোবাইল|হটলাইন|টেলিফোন)\s*:\s*/i,
  /\b(?:phone|email|tel|fax|pabx|hotline|mobile)\s*:\s*/i,
  /(?:বিডিবিএল|ওয়াসা|সেনা|বসুন্ধরা|যমুনা|কনকর্ড|নাভানা|শান্তা)\s*(?:ভবন|টাওয়ার|টাওয়ার|প্লাজা|সেন্টার)/i,
  /(?:কাজী\s*নজরুল\s*ইসলাম|বীর\s*উত্তম|বঙ্গবন্ধু)\s*(?:এভিনিউ|সড়ক|সরণি|রোড)/i,
  /(?:লেভেল|তলা|ফ্লোর|level|floor)[- ]?[\d০-৯]+\s*,/i,
  /(?:ঢাকা|চট্টগ্রাম|সিলেট|রাজশাহী|খুলনা|বরিশাল|রংপুর)[- ]?\d{4}/i,
  /বার্তা\s*ও\s*(?:সম্পাদকীয়|বাণিজ্যিক)\s*বিভাগ/i,
  /বিজ্ঞাপন\s*ও\s*সার্কুলেশন\s*বিভাগ/i,
  /(?:The\s+Daily\s+)?Bonik\s*Barta/i,
  /বণিক\s*বার্তা/i,
  /(?:Dewan\s+Hanif\s+Mahmud|দেওয়ান\s+হানিফ\s+মাহমুদ)/i,
  /(?:is\s*a\s*bangla\s*newspaper|newspaper\s*of\s*bangladesh|circulated\s*business\s*daily|circulation\s*of\s*the\s*newspaper|name\s*of\s*the\s*editor)/i,
  /E-paper|ই[- ]?পেপার|অনলাইন\s*সংস্করণ/i,
  /পোস্ট\s*কোড|জিপিও\s*বক্স/i,
  /সর্বস্বত্ব\s*সংরক্ষিত/i,
  /কপিরাইট\s*©?/i,
  /স্বত্ব\s*©/i,
  /অনুমতি\s*ছাড়া\s*(?:কোনো\s*সংবাদ\s*বা\s*ছবির\s*)?ব্যবহার\s*নিষিদ্ধ/i,
  /all\s*rights\s*reserved/i,
  /copyright\s*©?/i,
  /\bdisclaimer\s*:/i,
  /বিজ্ঞাপন(?:\s*ও\s*সার্কুলেশন)?\s*:/i,
  /বিজ্ঞাপনের\s*জন্য\s*যোগাযোগ/i,
  /বিজ্ঞাপন\s*(?:মূল্যতালিকা|দর|বিভাগ|শাখা)/i,
  /সার্কুলেশন\s*(?:বিভাগ|শাখা|যোগাযোগ)/i,
  /\badvertisement\b/i,
  /\bsponsored\s*content\b/i,
  /ফেসবুক\s*(?:গ্রুপে|পেজে)\s*(?:যুক্ত\s*হন|লাইক\s*দিন|ফলো\s*করুন)/i,
  /টেলিগ্রাম\s*(?:গ্রুপে|চ্যানেলে)/i,
  /হোয়াটসঅ্যাপ\s*(?:গ্রুপে|চ্যানেলে)/i,
  /ইউটিউব\s*(?:চ্যানেলে|চ্যানেল)/i,
  /অ্যাপ\s*ডাউনলোড\s*করুন/i,
  /নিউজলেটার\s*সাবস্ক্রাইব/i,
  /গুগল\s*নিউজ\s*(?:-এ\s*ফলো|চ্যানেলে)/i,
  /গুগল\s*প্লে\s*(?:স্টোর)?/i,
  /অ্যাপ\s*স্টোর/i,
  /\bfollow\s*us\s*on\b/i,
  /\bsubscribe\s*to\b/i,
  /\bdownload\s*our\s*app\b/i,
  /^(?:আরও\s*পড়ুন|আরও\s*দেখুন|সম্পর্কিত\s*(?:সংবাদ|খবর)|পড়ুন|রিলেটেড\s*নিউজ|বিশেষ\s*সংবাদ|অন্যান্য\s*খবর|সর্বশেষ\s*সংবাদ)\s*[:—–-]/i,
  /^(?:read\s*more|also\s*read|related\s*stories|related\s*news|see\s*also)\s*[:—–-]/i,
  /^(?:ছবি\s*:\s*|ছবি\s*সংগৃহীত|ফাইল\s*ছবি|ভিডিও\s*:\s*|গ্রাফিক্স\s*:\s*|ইলাস্ট্রেশন\s*:\s*)/i,
  /^(?:জাতীয়|রাজনীতি|অর্থনীতি|আন্তর্জাতিক|সারাদেশ|খেলা|বিনোদন|মতামত|বাণিজ্য|প্রবাস)\s*$/i,
  /^(?:নিজস্ব\s*প্রতিবেদক|বিশেষ\s*প্রতিনিধি|স্টাফ\s*রিপোর্টার|অনলাইন\s*ডেস্ক|ডেস্ক\s*রিপোর্ট|জেলা\s*প্রতিনিধি|উপজেলা\s*প্রতিনিধি|সংবাদ\s*বিজ্ঞপ্তি|প্রেস\s*বিজ্ঞপ্তি)(?:,\s*[\u0980-\u09FF\s]+)?$/i,
  /^(?:বাসস|ইউএনবি|রয়টার্স|এএফপি|এপি|বিবিসি|বিডিনিউজ\s*২৪)(?:,\s*[\u0980-\u09FF\s]+)?$/i,
]

/** Office-address and masthead lines: dropped only when they look like an address block, never a sentence that merely mentions a road, a block or Gulshan. */
const ADDRESS_HINT = /(?:ঢাকা|চট্টগ্রাম|সিলেট|dhaka|chattogram|chittagong)[- ]?\d{4}\b|(?:ফোন|ইমেইল|ফ্যাক্স|পিএবিএক্স|phone|email|fax|pabx|tel)\b|(?:বাড়ি|প্লট|house|plot)\s*(?:#|নং|no\.?|number)?\s*[0-9০-৯]|(?:ভবন|টাওয়ার|প্লাজা|bhaban|plaza)\b/i
const ADDRESS_WORDS = /\b(?:house|road|plot|sector|lane|block|avenue|street|bhaban|tower)\b|(?:বাড়ি|রোড|প্লট|সেক্টর|লেন|ব্লক)\s*নং|(?:কারওয়ান|কাওরান|মতিঝিল|তেজগাঁও|গুলশান|বনানী|ধানমন্ডি|উত্তরা|পল্টন|বিজয়নগর|আগ্রাবাদ)\s*(?:বাজার)?/i
const DATELINE_ONLY = /^(?:E-paper\s*English|শুক্রবার|শনিবার|রবিবার|সোমবার|মঙ্গলবার|বুধবার|বৃহস্পতিবার)/i

/** Longest line an unanchored boilerplate hint may drop (mastheads, footers and CTAs are short). */
const BOILERPLATE_SHORT = 160
/** Bangla letters such as ড় and য় exist precomposed and as letter + nukta; pages use both, so patterns and text are
 *  compared in one Unicode form (NFC) or a "read more" line typed the other way slips through. */
const BOILERPLATE_NFC = BOILERPLATE_PATTERNS.map((p) => new RegExp(p.source.normalize('NFC'), p.flags))

export function isBoilerplateParagraph(text: string): boolean {
  const t = text.trim().normalize('NFC')
  if (t.length < 20) return true
  // A pattern anchored at the start describes the whole line ("Read more:", a bare section name), so it can judge any
  // paragraph. An unanchored one ("published by", "বণিক বার্তা", "copyright") is a masthead/footer HINT: real story
  // sentences use the same words ("…বণিক বার্তাকে বলেন", "a report published by IEEFA"), so it only drops a SHORT line.
  const short = t.length < BOILERPLATE_SHORT
  for (const pat of BOILERPLATE_NFC) {
    if ((short || pat.source.startsWith('^')) && pat.test(t)) return true
  }
  if (ADDRESS_WORDS.test(t) && t.length < 240 && ADDRESS_HINT.test(t)) return true
  if (DATELINE_ONLY.test(t) && t.length <= 70) return true
  return false
}

/** Strips datelines, reporter leads, agency tags, and noise prefixes from an article paragraph. */
export function cleanParagraphLead(text: string): string {
  let t = text.trim()
  // 1. Strip reporter / agency leads:
  // e.g. "নিজস্ব প্রতিবেদক, ঢাকা:" or "অনলাইন ডেস্ক —" or "বিশেষ প্রতিনিধি, ঢাকা (২৩ অক্টোবর):"
  t = t.replace(/^(?:(?:নিজস্ব\s*প্রতিবেদক|বিশেষ\s*প্রতিনিধি|স্টাফ\s*রিপোর্টার|অনলাইন\s*ডেস্ক|ডেস্ক\s*রিপোর্ট|জেলা\s*প্রতিনিধি|সংবাদদাতা|অর্থনৈতিক\s*প্রতিবেদক)(?:,\s*[\u0980-\u09FF\s\d,()]{1,40}?)?)\s*(?::|[—–-](?=\s))\s*/i, '')

  // 2. Strip bracketed dateline leads:
  // e.g. "(ঢাকা, ২৩ অক্টোবর) —" or "(বাসস) —" or "(ইউএনবি) —"
  t = t.replace(/^\([^\)]{2,40}\)\s*(?::|[—–-](?=\s))\s*/i, '')

  // 3. Strip city datelines:
  // e.g. "ঢাকা, ২৩ অক্টোবর (বাসস) :" or "ঢাকা:" or "সিলেট:"
  t = t.replace(/^(?:ঢাকা|চট্টগ্রাম|সিলেট|রাজশাহী|খুলনা|বরিশাল|রংপুর|ময়মনসিংহ|কক্সবাজার|গাজীপুর|নারায়ণগঞ্জ)(?:,\s*[\u0980-\u09FF\s\d,()]{1,40}?)?\s*(?::|[—–-](?=\s))\s*/i, '')

  // 4. Strip inline trailing boilerplate ("বিস্তারিত আসছে..." / "আরও পড়ুন...")
  t = t.replace(/\s*[-—–|•]\s*(?:আরও\s*পড়ুন|বিস্তারিত\s*আসছে|বিস্তারিত\s*জানতে|ছবি\s*:).*$/i, '')

  return t.trim()
}

/** Pick a clean, punchy catch sentence under 200 characters from a deck or lead text. */
export function extractCatchSentence(text: string, maxLen = 200): string {
  if (!text) return ''
  const clean = cleanParagraphLead(text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
  if (!clean || isBoilerplateParagraph(clean)) return ''

  // Split into sentences using Bengali and English sentence terminals
  const sentenceMatch = clean.match(/^(.+?(?:[।!?]|\.(?=\s|$)))/)
  const firstSentence = sentenceMatch ? sentenceMatch[1].trim() : clean

  if (firstSentence.length <= maxLen) return firstSentence

  // Truncate cleanly at a word boundary
  const sub = firstSentence.slice(0, maxLen - 1)
  const lastSpace = sub.lastIndexOf(' ')
  return lastSpace > 40 ? sub.slice(0, lastSpace) + '…' : sub + '…'
}

/** Resolve relative, protocol-relative, or HTML-escaped image URLs into clean absolute URLs. */
export function resolveImageUrl(raw: string | null | undefined, baseUrl?: string): string | null {
  if (!raw) return null
  let s = raw.trim().replace(/&amp;/gi, '&')
  if (!s) return null
  // Take first URL if srcset format ("https://.../img.jpg 1200w, ...")
  if (s.includes(' ') && (s.includes('w') || s.includes('x') || s.includes(','))) {
    const parts = s.split(',').map((p) => p.trim().split(/\s+/)[0]).filter(Boolean)
    s = parts[parts.length - 1] || parts[0] || s
  }
  const lower = s.toLowerCase()
  if (
    lower.startsWith('data:image/gif') ||
    lower.startsWith('data:image/svg') ||
    lower.startsWith('about:') ||
    lower.startsWith('javascript:') ||
    lower.includes('1x1') ||
    lower.includes('pixel.') ||
    lower.includes('placeholder') ||
    lower.includes('spinner') ||
    lower.includes('loading.') ||
    lower.includes('avatar') ||
    lower.includes('favicon') ||
    lower.endsWith('.svg')
  ) {
    return null
  }
  if (s.startsWith('data:image/')) return s
  try {
    if (baseUrl) {
      return new URL(s, baseUrl).href
    }
    if (s.startsWith('//')) return `https:${s}`
    return s
  } catch {
    return s.startsWith('http') ? s : null
  }
}

export function cleanAndDedupeParagraphs(rawList: string[]): string[] {
  const cleaned: string[] = []
  for (const item of rawList) {
    const t = cleanParagraphLead(item.replace(/<[^>]+>/g, '').trim())
    if (!t || t.length < 20 || isBoilerplateParagraph(t)) continue
    cleaned.push(t)
  }

  const deduped: string[] = []
  for (const p of cleaned) {
    const isPrefixOfExisting = deduped.some((ex) => ex === p || ex.startsWith(p) || ex.includes(p))
    if (isPrefixOfExisting) continue

    const prefixIdx = deduped.findIndex((ex) => p.startsWith(ex) || p.includes(ex))
    if (prefixIdx !== -1) {
      deduped[prefixIdx] = p
    } else {
      deduped.push(p)
    }
  }
  return deduped
}

export function parseArticleDocument(html: string, url?: string): ExtractedArticle {
  let doc: Document | null = null

  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser()
    doc = parser.parseFromString(html, 'text/html')
    unwrapNextStreamingChunks(doc)
    unwrapNationalPortalEncodedContent(doc)
  }

  // Fallback for Node test environments if DOMParser is unavailable
  if (!doc) {
    const ogTitleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)
    const titleMatch = ogTitleMatch || html.match(/<title[^>]*>([^<]+)<\/title>/i)
    const rawTitle = (titleMatch ? titleMatch[1].trim() : '').replace(/\s*[-|–—•]\s*(?:বণিক\s*বার্তা|Bonik\s*Barta|প্রথম\s*আলো|Prothom\s*Alo|The\s*Daily\s*Star|ডেইলি\s*স্টার|TBS\s*News|কালবেলা|সমকাল|ইত্তেফাক|নয়া\s*দিগন্ত|যুগান্তর|মানবজমিন|কালের\s*কণ্ঠ|বিডিনিউজ\s*২৪).*$/i, '').trim()

    const ogDescMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i)

    const ogImgMatch = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/i)

    const pRaw = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => m[1])
    const pMatches = cleanAndDedupeParagraphs(pRaw)
    const images: ExtractedImage[] = []
    const seen = new Set<string>()
    if (ogImgMatch) {
      const resolved = resolveImageUrl(ogImgMatch[1], url)
      if (resolved) {
        seen.add(resolved)
        images.push({ src: resolved, alt: rawTitle, caption: 'Lead editorial image' })
      }
    }
    const ldMatches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    for (const lm of ldMatches) {
      try {
        const parsed = JSON.parse(lm[1].trim())
        const items = Array.isArray(parsed) ? parsed : [parsed]
        for (const item of items) {
          const rawImg = item?.image || item?.thumbnailUrl
          const candidates = Array.isArray(rawImg) ? rawImg : rawImg ? [rawImg] : []
          for (const c of candidates) {
            const u = typeof c === 'string' ? c : (c?.url || c?.contentUrl)
            const resolved = u ? resolveImageUrl(String(u), url) : null
            if (resolved && !seen.has(resolved)) {
              seen.add(resolved)
              images.push({ src: resolved, alt: rawTitle, caption: 'Lead editorial image' })
            }
          }
        }
      } catch { /* ignore */ }
    }
    const imgMatches = [...html.matchAll(/<img[^>]+(?:data-src|data-lazy-src|data-original|src)=["']([^"']+)["'][^>]*>/gi)]
    for (const m of imgMatches) {
      const resolved = resolveImageUrl(m[1], url)
      if (resolved && !seen.has(resolved) && !resolved.toLowerCase().includes('logo') && !resolved.toLowerCase().includes('icon')) {
        seen.add(resolved)
        images.push({ src: resolved, alt: '' })
      }
    }

    const rawDeck = ogDescMatch ? ogDescMatch[1].trim() : ''
    const cleanDeck = rawDeck && !isBoilerplateParagraph(rawDeck) && rawDeck.length > 15
      ? extractCatchSentence(rawDeck, 200)
      : (pMatches[0] ? extractCatchSentence(pMatches[0], 200) : undefined)

    return {
      title: rawTitle,
      deck: cleanDeck,
      paragraphs: pMatches,
      images,
      rawHtmlLength: html.length,
    }
  }

  // 1. Structured data first: schema.org NewsArticle is the most reliable signal a publisher gives.
  const ld = readJsonLdArticle(doc)
  const ogSiteName = doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim()

  // 2. Title
  const ogTitle = doc.querySelector('meta[property="og:title"], meta[name="og:title"]')?.getAttribute('content')?.trim()
  const twitterTitle = doc.querySelector('meta[name="twitter:title"], meta[property="twitter:title"]')?.getAttribute('content')?.trim()
  const docTitle = doc.querySelector('title')?.textContent?.trim()
  const h1 = doc.querySelector('h1')?.textContent?.trim()
  const rawTitle = ld?.headline || ogTitle || twitterTitle || h1 || docTitle || ''
  const title = stripSiteSuffix(rawTitle, ogSiteName) || 'Untitled Article'

  // 3. Body: the highest-scoring text block in the markup, else the JSON-LD articleBody, else embedded page data.
  const warnings: string[] = []
  const picked = pickContentRoot(doc)
  let paragraphs = picked ? paragraphsFromRoot(picked.root) : []
  let method: ExtractionMeta['method'] = 'markup'
  const ldParagraphs = ld?.articleBody ? cleanAndDedupeParagraphs(splitBodyText(ld.articleBody)) : []
  if (ldParagraphs.length > paragraphs.length) {
    paragraphs = ldParagraphs
    method = 'structured'
  }
  if (paragraphs.length < 2) {
    const fromData = cleanAndDedupeParagraphs(extractPageDataParagraphs(doc))
    if (fromData.length > paragraphs.length) {
      paragraphs = fromData
      method = 'page-data'
      warnings.push("Story text was recovered from the page's embedded data, not its markup — check paragraph order against the page.")
    }
  }
  const deckEl = doc.querySelector('.sub-title, .subtitle, .news-sub-title, .story-deck, .article-subtitle, .lead-text, .standfirst, .excerpt, h2.subtitle, h3.subtitle')
  const elDeck = deckEl?.textContent?.trim()
  const ogDesc = doc.querySelector('meta[property="og:description"], meta[name="og:description"]')?.getAttribute('content')?.trim()
  const metaDesc = doc.querySelector('meta[name="description"], meta[name="twitter:description"]')?.getAttribute('content')?.trim()

  if (paragraphs.length === 0) {
    method = 'metadata-only'
    for (const c of [ld?.description, ogDesc, metaDesc]) {
      if (c && c.length >= 60 && !isBoilerplateParagraph(c) && stripSiteSuffix(c, ogSiteName) !== title) {
        const metaParas = cleanAndDedupeParagraphs(splitBodyText(c))
        if (metaParas.length > 0) {
          paragraphs = metaParas
          break
        }
      }
    }
    if (paragraphs.length > 0) {
      warnings.push('Only the lead summary was in the HTML (this site renders the full body in the browser).')
    } else {
      warnings.push('No article text found on the page (it may render the story in the browser). Use "Paste Text or File".')
    }
  } else if (paragraphs.length < 3) {
    warnings.push(`Only ${paragraphs.length} paragraph${paragraphs.length === 1 ? '' : 's'} extracted — compare the source pane with the page.`)
  }
  const bodyProbe = (picked?.root ?? doc.body).textContent || ''
  if (paragraphs.length < 3 && /subscribe to (?:continue|read)|paywall|premium (?:content|article)|সাবস্ক্রাইব করুন|প্রিমিয়াম/i.test(bodyProbe)) {
    warnings.push('The page shows subscription-wall text; the full story may not be in the HTML.')
  }
  const dedupedParagraphs = paragraphs

  // 4. Deck / Description (punchy catch sentence under 200 characters)
  let deck: string | undefined
  for (const c of [elDeck, ld?.description, ogDesc, metaDesc]) {
    if (c && c.length > 15 && !isBoilerplateParagraph(c) && stripSiteSuffix(c, ogSiteName) !== title) { deck = extractCatchSentence(c, 200); break }
  }
  if (!deck && dedupedParagraphs[0]) deck = extractCatchSentence(dedupedParagraphs[0], 200)

  // 5. Byline
  const metaAuthor = doc.querySelector('meta[name="author"], meta[property="article:author"]')?.getAttribute('content')?.trim()
  const bylineEl = doc.querySelector('.byline, .author, [rel="author"], .reporter-name, .author-name')?.textContent?.trim()
  const byline = cleanByline(ld?.author || metaAuthor || bylineEl)

  // 6. Publisher / Site Name
  const publisher = ld?.publisher || ogSiteName || (url ? (() => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return undefined } })() : undefined)

  // 7. Published Date
  const pubTime = ld?.datePublished
    || doc.querySelector('meta[property="article:published_time"], meta[name="publish-date"], meta[itemprop="datePublished"]')?.getAttribute('content')?.trim()
    || doc.querySelector('time[datetime]')?.getAttribute('datetime')?.trim()
    || doc.querySelector('time')?.textContent?.trim()
    || undefined

  // 8. Canonical URL
  const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute('href')?.trim() || url || undefined
  const baseUrl = canonical || url

  // 9. Images: lead image from structured data / OpenGraph, then photos inside the story block (sized, captioned)
  const images: ExtractedImage[] = []
  const seenSrc = new Set<string>()
  const pushImg = (rawSrc: string | null | undefined, alt = '', caption?: string, credit?: string) => {
    const resolved = resolveImageUrl(rawSrc, baseUrl)
    if (!resolved || seenSrc.has(resolved)) return
    const lower = resolved.toLowerCase()
    if (/\/logo|site-logo|\/icons?\/|brand-icon|\/ads?\/|advert|\/default[-_.]|no-image|blank\./.test(lower)) return
    seenSrc.add(resolved)
    images.push({ src: resolved, alt: alt || title, caption, credit: credit ?? creditFromCaption(caption) })
  }
  for (const img of ld?.images ?? []) pushImg(img.url, img.caption || title, img.caption)
  const metaImgSelectors = [
    'meta[property="og:image:secure_url"]', 'meta[property="og:image"]', 'meta[name="og:image"]',
    'meta[name="twitter:image:src"]', 'meta[name="twitter:image"]', 'meta[property="twitter:image"]', 'link[rel="image_src"]',
  ]
  for (const sel of metaImgSelectors) {
    const el = doc.querySelector(sel)
    const val = el?.getAttribute('content') || el?.getAttribute('href')
    if (val) pushImg(val, title, 'Lead editorial image')
  }
  const contentArea = picked?.root ?? doc.body
  const imgContainers = [
    ...Array.from(doc.querySelectorAll('.featured-image img, .post-thumbnail img, .lead-image img, .article-hero img, figure img')),
    ...Array.from(contentArea.querySelectorAll('img')),
  ]
  imgContainers.forEach((img) => {
    if (img.closest('header, nav, footer, .advertisement, .related-news, .sidebar, .comment, [class*="related"], [class*="recommend"], [class*="trending"]')) return
    const w = parseInt(img.getAttribute('width') || '', 10), h = parseInt(img.getAttribute('height') || '', 10)
    if ((w && w < 160) || (h && h < 120)) return
    const pictureSource = img.closest('picture')?.querySelector('source[srcset]')?.getAttribute('srcset')
    const rawSrc = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original') || pictureSource || img.getAttribute('srcset') || img.getAttribute('src')
    const figure = img.closest('figure')
    const caption = figure?.querySelector('figcaption')?.textContent?.trim() || img.getAttribute('title')?.trim()
    pushImg(rawSrc, img.getAttribute('alt')?.trim() || '', caption)
  })
  if (images.length === 0) warnings.push('No photo found on the page.')

  const meta: ExtractionMeta = {
    method,
    language: detectLanguage(`${title} ${dedupedParagraphs.slice(0, 4).join(' ')}`),
    warnings,
    contentSelector: method === 'markup' ? picked?.selector : undefined,
  }

  return {
    title,
    deck,
    byline,
    publisher,
    publishedAt: pubTime,
    canonicalUrl: canonical,
    paragraphs: dedupedParagraphs,
    images,
    rawHtmlLength: html.length,
    meta,
  }
}

// ---------------------------------------------------------------- structured data, scoring and page-data helpers

interface JsonLdArticle {
  headline?: string
  description?: string
  articleBody?: string
  datePublished?: string
  author?: string
  publisher?: string
  images: { url: string; caption?: string }[]
}

const ARTICLE_TYPES = /^(?:NewsArticle|Article|ReportageNewsArticle|AnalysisNewsArticle|BackgroundNewsArticle|OpinionNewsArticle|BlogPosting)$/

function nameOf(v: unknown): string | undefined {
  if (!v) return undefined
  if (typeof v === 'string') return v.trim() || undefined
  if (Array.isArray(v)) return v.map(nameOf).filter(Boolean).join(', ') || undefined
  if (typeof v === 'object') return nameOf((v as { name?: unknown }).name)
  return undefined
}

/** First schema.org article object in any ld+json block (also inside @graph). */
export function readJsonLdArticle(doc: Document): JsonLdArticle | null {
  const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))
  for (const sc of scripts) {
    let data: unknown
    try { data = JSON.parse(sc.textContent || '') } catch { continue }
    const queue: unknown[] = Array.isArray(data) ? [...data] : [data]
    while (queue.length) {
      const item = queue.shift()
      if (!item || typeof item !== 'object') continue
      const obj = item as Record<string, unknown>
      if (Array.isArray(obj['@graph'])) queue.push(...(obj['@graph'] as unknown[]))
      const type = Array.isArray(obj['@type']) ? (obj['@type'] as string[]).find((t) => ARTICLE_TYPES.test(t)) : obj['@type']
      if (typeof type !== 'string' || !ARTICLE_TYPES.test(type)) continue
      const images: JsonLdArticle['images'] = []
      const rawImg = obj.image ?? obj.thumbnailUrl
      for (const c of Array.isArray(rawImg) ? rawImg : rawImg ? [rawImg] : []) {
        if (typeof c === 'string') images.push({ url: c })
        else if (c && typeof c === 'object') {
          const o = c as { url?: string; contentUrl?: string; caption?: string }
          const u = o.url || o.contentUrl
          if (u) images.push({ url: u, caption: o.caption })
        }
      }
      const text = (v: unknown) => (typeof v === 'string' ? decodeEntities(v).trim() : undefined)
      return {
        headline: text(obj.headline) || text(obj.name),
        description: text(obj.description),
        articleBody: text(obj.articleBody),
        datePublished: text(obj.datePublished) || text(obj.dateCreated),
        author: nameOf(obj.author),
        publisher: nameOf(obj.publisher),
        images,
      }
    }
  }
  return null
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
}

/** Next.js App Router streams suspense boundaries at the tail of <body> as <div hidden id="S:0"> and pairs each with
 *  <template id="B:0"> or <template id="P:0"> inside the article layout. Move them into place and drop `hidden` before scoring the DOM. */
function unwrapNextStreamingChunks(doc: Document): void {
  doc.querySelectorAll('div[hidden][id^="S:"]').forEach((chunk) => {
    chunk.removeAttribute('hidden')
    const suffix = (chunk.getAttribute('id') || '').slice(2)
    const marker = suffix ? (doc.getElementById(`B:${suffix}`) || doc.getElementById(`P:${suffix}`)) : null
    if (marker && marker.parentNode) {
      marker.parentNode.insertBefore(chunk, marker)
    }
  })
}

/** Bangladesh Government National Portal (*.gov.bd / *.org.bd) stores press release & news body HTML inside
 *  <rt-renderer encoded-content="BASE64_UTF8">. Decode it into standard article markup before scoring. */
function unwrapNationalPortalEncodedContent(doc: Document): void {
  doc.querySelectorAll('[encoded-content]').forEach((el) => {
    const b64 = (el.getAttribute('encoded-content') || '').trim()
    if (!b64) return
    try {
      const bin = atob(b64.replace(/\s+/g, ''))
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const decoded = new TextDecoder('utf-8').decode(bytes).trim()
      if (decoded) {
        const sanitized = sanitizeBodyHtml(decoded)
        if (sanitized) {
          const wrapper = doc.createElement('article')
          wrapper.setAttribute('itemprop', 'articleBody')
          wrapper.className = 'article-body'
          wrapper.innerHTML = sanitized
          el.replaceWith(wrapper)
        }
      }
    } catch { /* ignore malformed base64 */ }
  })
}

/** A JSON-LD articleBody is one string: split on blank lines, else on line breaks, else into groups of sentences. */
export function splitBodyText(text: string): string[] {
  const clean = text.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').trim()
  let parts = clean.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean)
  if (parts.length === 1) parts = clean.split(/\n+/).map((p) => p.trim()).filter(Boolean)
  if (parts.length === 1 && clean.length > 700) {
    const sentences = clean.match(/.+?(?:[।!?]+|\.+(?=["”’]?(?:\s|$)))["”’]?\s*|.+$/g) ?? [clean]
    parts = []
    for (let i = 0; i < sentences.length; i += 3) parts.push(sentences.slice(i, i + 3).join('').trim())
  }
  return parts
}

const CONTENT_SELECTORS = [
  '[itemprop="articleBody"]', 'article', '.article-content', '.article-body', '.story-content', '.story-body', '.entry-content',
  '.news-details', '.details-content', '.post-content', '.content-body', '.news-content', '.story-element', '#article-body',
  '.jw_article_body', '.new-details .description', '.new-details', '.desktopDetailBody', '.detailBody', '.dp2-body',
  '.td-post-content', '.tdb_single_content .tdb-block-inner', '#mvp-content-main', '#mvp-content-body', '.details-main-col', 'main',
]
const NOISE_ANCESTOR = 'header, nav, footer, aside, .sidebar, .related-news, .comment, .comments, .tabArea, .tabList, [class*="tabArea"], [class*="tabList"], [class*="related"], [class*="recommend"], [class*="trending"], [class*="popular"], [class*="newsletter"], [class*="share"], [class*="social"], [class*="breadcrumb"], .footer, .site-footer, [class*="menu"]'

function textLen(s: string | null | undefined): number { return (s || '').replace(/\s+/g, ' ').trim().length }

/** Non-<p> prose inside a block for portals that format articles with <div> or <br> instead of <p>. */
function nonParagraphProseLen(el: Element): number {
  if (['BODY', 'MAIN', 'HEADER', 'NAV', 'FOOTER', 'ASIDE', 'UL', 'OL'].includes(el.tagName)) return 0
  let total = 0
  for (const child of Array.from(el.children)) {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'HEADER', 'NAV', 'FOOTER', 'ASIDE', 'UL', 'OL', 'FIGURE', 'FIGCAPTION'].includes(child.tagName)) continue
    if (child.querySelector('div, article, section, ul, ol, table')) continue
    const t = (child.textContent || '').replace(/\s+/g, ' ').trim()
    if (t.length >= 60 && /[।.!?]/.test(t)) total += t.length
  }
  if (total >= 150) return total
  const brCount = el.querySelectorAll('br').length
  if (brCount >= 2 && el.children.length <= 25) {
    const raw = (el.textContent || '').replace(/\s+/g, ' ').trim()
    if (raw.length >= 200 && raw.length <= 15000 && (raw.match(/[।.!?]/g) ?? []).length >= 2) return raw.length
  }
  return total
}

/** Score a block by the prose it holds: paragraph text, minus link text (navigation reads as links), minus noise ancestry. */
function scoreBlock(el: Element): number {
  let text = 0
  el.querySelectorAll('p').forEach((p) => {
    if (p.closest('header, nav, footer, aside, .sidebar, .related-news, .comment, .tabArea, .tabList, [class*="tabArea"], [class*="tabList"], [class*="related"]')) return
    const l = textLen(p.textContent)
    if (l >= 40) text += l
  })
  if (text < 200) {
    const alt = nonParagraphProseLen(el)
    if (alt > text) text = alt
  }
  if (!text) return 0
  let links = 0
  el.querySelectorAll('a').forEach((a) => { links += textLen(a.textContent) })
  const noise = el.closest(NOISE_ANCESTOR) ? 0.2 : 1
  return (text - 2 * links) * noise
}

function selectorFor(el: Element): string {
  const id = el.getAttribute('id')
  const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.')
  return `${el.tagName.toLowerCase()}${id ? `#${id}` : ''}${cls ? `.${cls}` : ''}`
}

/** The element the story most likely lives in: the best-scoring known container or dense block. */
export function pickContentRoot(doc: Document): { root: Element; selector: string; score: number } | null {
  const candidates = new Set<Element>()
  for (const sel of CONTENT_SELECTORS) doc.querySelectorAll(sel).forEach((el) => candidates.add(el))
  doc.querySelectorAll('div, section, article').forEach((el) => {
    let own = 0
    for (const child of Array.from(el.children)) if (child.tagName === 'P') own += textLen(child.textContent)
    if (own < 200) own = nonParagraphProseLen(el)
    if (own >= 200) candidates.add(el)
  })
  let best: { root: Element; selector: string; score: number } | null = null
  for (const el of candidates) {
    const score = scoreBlock(el) + (CONTENT_SELECTORS.some((sel) => el.matches(sel)) ? 150 : 0)
    if (score > 120 && (!best || score > best.score)) best = { root: el, selector: selectorFor(el), score }
  }
  return best
}

function isNoisyInnerNode(el: Element): boolean {
  if (el.hasAttribute('hidden') && !/^[SBP]:[\da-f]+$/i.test(el.getAttribute('id') || '')) return true
  if (/display\s*:\s*none/i.test(el.getAttribute('style') || '')) return true
  const cls = el.getAttribute('class') || ''
  if (!cls) return false
  // Word-bounded hidden classes so Bootstrap responsive utilities (hidden-xs, hidden-print) on desktop wrappers are kept.
  if (/\b(?:hidden|d-none|sr-only|visually-hidden|mfp-hide|advertisement|comment|comments|footer|site-footer|author-box|copyright|address-box|print-info|sidebar|related-news|tabArea|tabList)\b/i.test(cls)) return true
  if (/(?:^|[\s_-])(?:related|recommend|caption|share|social|byline|breadcrumb|post-tags|tag-list|article-tags|tabArea|tabList|paywall)(?:$|[\s_-])/i.test(cls)) return true
  return false
}

function isExcludedWithinRoot(node: Element, root: Element): boolean {
  if (node.closest('header, nav, footer, aside, figcaption')) return true
  let cur: Element | null = node
  while (cur && cur !== root) {
    if (isNoisyInnerNode(cur)) return true
    cur = cur.parentElement
  }
  return false
}

/** Extract paragraphs when a portal formats story text with <div> blocks or <br> breaks instead of <p>. */
function divAndBrParagraphs(root: Element): string[] {
  const clone = root.cloneNode(true) as Element
  clone.querySelectorAll('script, style, noscript, header, nav, footer, aside, figure, figcaption, h1, h2, h3, ul, ol, form, button, .advertisement, .related-news, .sidebar, .comment, .tabArea, .tabList, [class*="tabArea"], [class*="tabList"], [class*="paywall"], [class*="related"], [class*="share"], [class*="social"]').forEach((n) => n.remove())
  const html = clone.innerHTML
    .replace(/<br\s*\/?>/gi, '\n\n')
    .replace(/<\/(?:p|div|section|article|h[1-6]|li|blockquote)>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
  const decoded = decodeEntities(html)
  const blocks: string[] = []
  for (const raw of decoded.split(/\n\s*\n+/)) {
    const t = raw.replace(/\s+/g, ' ').trim()
    if (t.length >= 25) blocks.push(t)
  }
  return cleanAndDedupeParagraphs(blocks)
}

function paragraphsFromRoot(root: Element): string[] {
  const raw: string[] = []
  root.querySelectorAll('p').forEach((p) => {
    if (isExcludedWithinRoot(p, root)) return
    const text = p.textContent?.trim()
    if (text) raw.push(text)
  })
  const fromP = cleanAndDedupeParagraphs(raw)
  if (fromP.length >= 1) return fromP
  return divAndBrParagraphs(root)
}

/** Stories that only exist in embedded app state (Next.js / Nuxt / Inertia / initial-state JSON): long prose strings, in document order. */
export function extractPageDataParagraphs(doc: Document): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const visit = (v: unknown, depth: number) => {
    if (depth > 14 || out.length > 80) return
    if (typeof v === 'string') {
      const s = decodeEntities(v)
        .replace(/<br\s*\/?>/gi, '\n\n')
        .replace(/<\/(?:p|div)>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')
        .trim()
      for (const part of s.split(/\n\s*\n+/)) {
        const t = part.replace(/\s+/g, ' ').trim()
        if (
          t.length >= 80 &&
          (t.match(/[।.!?]/g) ?? []).length >= 1 &&
          !/https?:\/\//.test(t) &&
          !/[{};]{2,}|function\s*\(|\["\$",|"className"\s*:|"children"\s*:|^\s*[\da-f]+:[A-Za-z]*[\[{"]|\/_next\/|static\/chunks\/|\.js"|"\s*,\s*"/i.test(t) &&
          !isBoilerplateParagraph(t) &&
          !seen.has(t)
        ) {
          seen.add(t)
          out.push(t)
        }
      }
    } else if (Array.isArray(v)) v.forEach((x) => visit(x, depth + 1))
    else if (v && typeof v === 'object') Object.values(v as Record<string, unknown>).forEach((x) => visit(x, depth + 1))
  }
  doc.querySelectorAll('script#__NEXT_DATA__, script[type="application/json"]').forEach((sc) => {
    try { visit(JSON.parse(sc.textContent || ''), 0) } catch { /* not JSON */ }
  })
  // Laravel Inertia.js (e.g. Sheershanews) embeds page props JSON in [data-page].
  doc.querySelectorAll('[data-page]').forEach((el) => {
    try { visit(JSON.parse(el.getAttribute('data-page') || ''), 0) } catch { /* not JSON */ }
  })
  if (out.length === 0) {
    doc.querySelectorAll('script:not([src])').forEach((sc) => {
      const txt = sc.textContent || ''
      const m = txt.match(/(?:__INITIAL_STATE__|__NUXT__|__PRELOADED_STATE__|__APOLLO_STATE__)\s*=\s*(\{[\s\S]*\})\s*;?\s*$/)
      if (m) {
        try { visit(JSON.parse(m[1]), 0) } catch { /* not plain JSON */ }
      }
      // Next.js App Router RSC payload chunks: self.__next_f.push([1, "..."])
      if (txt.includes('__next_f.push')) {
        for (const pm of txt.matchAll(/__next_f\.push\(\[\d+,\s*("(?:\\.|[^"\\])*")\]\)/g)) {
          try {
            const chunk = JSON.parse(pm[1])
            if (typeof chunk === 'string') {
              visit(chunk, 0)
            }
          } catch { /* ignore */ }
        }
      }
    })
  }
  return out
}

function stripSiteSuffix(title: string, siteName?: string): string {
  let t = title.trim()
  t = t.replace(/\s*\|\s*(?:খবর|সংবাদ|প্রেস\s*রিলিজ|সংবাদ\s*বিজ্ঞপ্তি|প্রেস\s*বিজ্ঞপ্তি|Press\s*Release|Press\s*Releases|News|Notice|নোটিশ)\s*\|.*$/i, '').trim()
  if (siteName) {
    const esc = siteName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    t = t.replace(new RegExp(`\\s*[-|–—•:]\\s*${esc}\\s*$`, 'i'), '').trim()
  }
  return t.replace(/\s*[-|–—•]\s*(?:বণিক\s*বার্তা|Bonik\s*Barta|প্রথম\s*আলো|Prothom\s*Alo|The\s*Daily\s*Star|ডেইলি\s*স্টার|TBS\s*News|The\s*Business\s*Standard|কালবেলা|সমকাল|Samakal|ইত্তেফাক|নয়া\s*দিগন্ত|যুগান্তর|মানবজমিন|কালের\s*কণ্ঠ|বিডিনিউজ\s*২৪|bdnews24|Dhaka\s*Tribune|The\s*Financial\s*Express|Energy\s*Bangla)\s*$/i, '').trim()
}

function cleanByline(raw?: string): string | undefined {
  if (!raw) return undefined
  const t = raw.replace(/^\s*(?:by|লিখেছেন|প্রতিবেদক)\s*[:：]?\s*/i, '').replace(/\s+/g, ' ').trim()
  return t && t.length <= 120 ? t : undefined
}

function creditFromCaption(caption?: string): string | undefined {
  if (!caption) return undefined
  const m = caption.match(/(?:ছবি|photo|image|pic)\s*[:：]\s*([^।.|]+)/i)
  return m ? m[1].trim() : undefined
}

export function detectLanguage(sample: string): ExtractionMeta['language'] {
  const bn = (sample.match(/[ঀ-৿]/g) ?? []).length
  const en = (sample.match(/[A-Za-z]/g) ?? []).length
  if (bn + en < 20) return 'unknown'
  const r = bn / (bn + en)
  return r > 0.8 ? 'bn' : r < 0.2 ? 'en' : 'mixed'
}
