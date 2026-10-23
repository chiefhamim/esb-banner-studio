// DOMParser-based offline article extractor.
// Extracts clean article headline, deck, body paragraphs, byline, publisher, date, and media from HTML.

export interface ExtractedImage {
  src: string
  alt: string
  caption?: string
  credit?: string
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
  /(?:বাড়ি|রোড|প্লট|সেক্টর|লেন|ব্লক)\s*নং/i,
  /\b(?:house|road|plot|sector|lane|block|avenue|street|bhaban|tower)\b/i,
  /(?:কারওয়ান|কারওয়ান|কাওরান|মতিঝিল|তেজগাঁও|গুলশান|বনানী|ধানমন্ডি|উত্তরা|পল্টন|বিজয়নগর|আগ্রাবাদ)\s*(?:বাজার)?/i,
  /(?:বিডিবিএল|ওয়াসা|সেনা|বসুন্ধরা|যমুনা|কনকর্ড|নাভানা|শান্তা)\s*(?:ভবন|টাওয়ার|টাওয়ার|প্লাজা|সেন্টার)/i,
  /(?:কাজী\s*নজরুল\s*ইসলাম|বীর\s*উত্তম|বঙ্গবন্ধু)\s*(?:এভিনিউ|সড়ক|সরণি|রোড)/i,
  /(?:লেভেল|তলা|ফ্লোর|level|floor)\s*\d+/i,
  /(?:ঢাকা|চট্টগ্রাম|সিলেট|রাজশাহী|খুলনা|বরিশাল|রংপুর)[- ]?\d{4}/i,
  /বার্তা\s*ও\s*(?:সম্পাদকীয়|বাণিজ্যিক)\s*বিভাগ/i,
  /বিজ্ঞাপন\s*ও\s*সার্কুলেশন\s*বিভাগ/i,
  /(?:The\s+Daily\s+)?Bonik\s*Barta/i,
  /বণিক\s*বার্তা/i,
  /(?:Dewan\s+Hanif\s+Mahmud|দেওয়ান\s+হানিফ\s+মাহমুদ)/i,
  /(?:is\s*a\s*bangla\s*newspaper|newspaper\s*of\s*bangladesh|circulated\s*business\s*daily|circulation\s*of\s*the\s*newspaper|name\s*of\s*the\s*editor)/i,
  /E-paper|ই[- ]?পেপার|অনলাইন\s*সংস্করণ/i,
  /^(?:E-paper\s*English|শুক্রবার|শনিবার|রবিবার|সোমবার|মঙ্গলবার|বুধবার|বৃহস্পতিবার)/i,
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

export function isBoilerplateParagraph(text: string): boolean {
  const t = text.trim()
  if (t.length < 20) return true
  for (const pat of BOILERPLATE_PATTERNS) {
    if (pat.test(t)) return true
  }
  return false
}

/** Strips datelines, reporter leads, agency tags, and noise prefixes from an article paragraph. */
export function cleanParagraphLead(text: string): string {
  let t = text.trim()
  // 1. Strip reporter / agency leads:
  // e.g. "নিজস্ব প্রতিবেদক, ঢাকা:" or "অনলাইন ডেস্ক —" or "বিশেষ প্রতিনিধি, ঢাকা (২৩ অক্টোবর):"
  t = t.replace(/^(?:(?:নিজস্ব\s*প্রতিবেদক|বিশেষ\s*প্রতিনিধি|স্টাফ\s*রিপোর্টার|অনলাইন\s*ডেস্ক|ডেস্ক\s*রিপোর্ট|জেলা\s*প্রতিনিধি|সংবাদদাতা|অর্থনৈতিক\s*প্রতিবেদক)(?:,\s*[\u0980-\u09FF\s\d,()]+)?)\s*[:—–-]\s*/i, '')

  // 2. Strip bracketed dateline leads:
  // e.g. "(ঢাকা, ২৩ অক্টোবর) —" or "(বাসস) —" or "(ইউএনবি) —"
  t = t.replace(/^\([^\)]{2,40}\)\s*[:—–-]\s*/i, '')

  // 3. Strip city datelines:
  // e.g. "ঢাকা, ২৩ অক্টোবর (বাসস) :" or "ঢাকা:" or "সিলেট:"
  t = t.replace(/^(?:ঢাকা|চট্টগ্রাম|সিলেট|রাজশাহী|খুলনা|বরিশাল|রংপুর|ময়মনসিংহ|কক্সবাজার|গাজীপুর|নারায়ণগঞ্জ)(?:,\s*[\u0980-\u09FF\s\d,()]+)?\s*[:—–-]\s*/i, '')

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
  const sentenceMatch = clean.match(/^([^।!?\.]+[।!?\.])/i)
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

  // 1. Title
  const ogTitle = doc.querySelector('meta[property="og:title"], meta[name="og:title"]')?.getAttribute('content')?.trim()
  const twitterTitle = doc.querySelector('meta[name="twitter:title"], meta[property="twitter:title"]')?.getAttribute('content')?.trim()
  const docTitle = doc.querySelector('title')?.textContent?.trim()
  const h1 = doc.querySelector('h1')?.textContent?.trim()
  const rawTitle = ogTitle || twitterTitle || h1 || docTitle || 'Untitled Article'
  const title = rawTitle.replace(/\s*[-|–—•]\s*(?:বণিক\s*বার্তা|Bonik\s*Barta|প্রথম\s*আলো|Prothom\s*Alo|The\s*Daily\s*Star|ডেইলি\s*স্টার|TBS\s*News|কালবেলা|সমকাল|ইত্তেফাক|নয়া\s*দিগন্ত|যুগান্তর|মানবজমিন|কালের\s*কণ্ঠ|বিডিনিউজ\s*২৪).*$/i, '').trim()

  // 2. Body Paragraphs (excluding header, nav, footer, script, style, comments, and boilerplate)
  const contentArea = doc.querySelector('article, .article-content, .story-content, .entry-content, .news-details, .details-content, main') || doc.body
  const pEls = contentArea.querySelectorAll('p')
  const paragraphs: string[] = []
  pEls.forEach((p) => {
    const text = p.textContent?.trim()
    if (
      text &&
      text.length > 20 &&
      !p.closest('header, nav, footer, aside, .advertisement, .comment, .footer, .site-footer, .author-box, .copyright, .address-box, .print-info, .sidebar, .related-news, .hidden, [hidden], [class*="print:"], [class*="hidden"], [style*="display: none"], [style*="display:none"], [class*="footer"]') &&
      !isBoilerplateParagraph(text)
    ) {
      const cleaned = cleanParagraphLead(text)
      if (cleaned && cleaned.length > 20 && !isBoilerplateParagraph(cleaned)) {
        paragraphs.push(cleaned)
      }
    }
  })

  // Deduplicate paragraphs & drop truncated prefixes
  const dedupedParagraphs: string[] = []
  for (const p of paragraphs) {
    const isRedundant = dedupedParagraphs.some((existing) => existing === p || existing.startsWith(p))
    if (!isRedundant) {
      const longerIdx = dedupedParagraphs.findIndex((existing) => p.startsWith(existing))
      if (longerIdx !== -1) {
        dedupedParagraphs[longerIdx] = p
      } else {
        dedupedParagraphs.push(p)
      }
    }
  }

  // 3. Deck / Description (punchy catch sentence under 200 characters)
  const deckEl = doc.querySelector('.sub-title, .subtitle, .news-sub-title, .story-deck, .article-subtitle, .lead-text, .standfirst, .excerpt, h2.subtitle, h3.subtitle')
  const elDeck = deckEl?.textContent?.trim()
  const ogDesc = doc.querySelector('meta[property="og:description"], meta[name="og:description"]')?.getAttribute('content')?.trim()
  const metaDesc = doc.querySelector('meta[name="description"], meta[name="twitter:description"]')?.getAttribute('content')?.trim()

  let deck: string | undefined
  if (elDeck && !isBoilerplateParagraph(elDeck) && elDeck.length > 15) {
    deck = extractCatchSentence(elDeck, 200)
  } else if (ogDesc && !isBoilerplateParagraph(ogDesc) && ogDesc.length > 15) {
    deck = extractCatchSentence(ogDesc, 200)
  } else if (metaDesc && !isBoilerplateParagraph(metaDesc) && metaDesc.length > 15) {
    deck = extractCatchSentence(metaDesc, 200)
  } else if (dedupedParagraphs[0]) {
    deck = extractCatchSentence(dedupedParagraphs[0], 200)
  }

  // 4. Byline
  const metaAuthor = doc.querySelector('meta[name="author"], meta[property="article:author"]')?.getAttribute('content')?.trim()
  const bylineEl = doc.querySelector('.byline, .author, [rel="author"], .reporter-name, .author-name')?.textContent?.trim()
  const byline = metaAuthor || bylineEl || undefined

  // 5. Publisher / Site Name
  const ogSite = doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim()
  const publisher = ogSite || (url ? (() => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return undefined } })() : undefined)

  // 6. Published Date
  const pubTime = doc.querySelector('meta[property="article:published_time"], meta[name="publish-date"]')?.getAttribute('content')?.trim()
    || doc.querySelector('time[datetime]')?.getAttribute('datetime')?.trim()
    || doc.querySelector('time')?.textContent?.trim()
    || undefined

  // 7. Canonical URL
  const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute('href')?.trim() || url || undefined
  const baseUrl = canonical || url

  // 8. Images with alt and captions (comprehensive multi-source extraction)
  const images: ExtractedImage[] = []
  const seenSrc = new Set<string>()

  const pushImg = (rawSrc: string | null | undefined, alt = '', caption?: string, credit?: string) => {
    const resolved = resolveImageUrl(rawSrc, baseUrl)
    if (!resolved || seenSrc.has(resolved)) return
    const lower = resolved.toLowerCase()
    if (lower.includes('/logo') || lower.includes('site-logo') || lower.includes('/icons/') || lower.includes('brand-icon')) return
    seenSrc.add(resolved)
    images.push({ src: resolved, alt: alt || title, caption, credit })
  }

  // 8a. OpenGraph & Twitter Card lead images
  const metaImgSelectors = [
    'meta[property="og:image:secure_url"]',
    'meta[property="og:image"]',
    'meta[name="og:image"]',
    'meta[name="twitter:image:src"]',
    'meta[name="twitter:image"]',
    'meta[property="twitter:image"]',
    'link[rel="image_src"]',
  ]
  for (const sel of metaImgSelectors) {
    const val = doc.querySelector(sel)?.getAttribute('content') || doc.querySelector(sel)?.getAttribute('href')
    if (val) pushImg(val, title, 'Lead editorial image')
  }

  // 8b. JSON-LD Schema.org NewsArticle image extraction
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((sc) => {
    try {
      const data = JSON.parse(sc.textContent || '')
      const items = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data]
      for (const item of items) {
        if (!item || typeof item !== 'object') continue
        const imgField = item.image || item.thumbnailUrl
        if (typeof imgField === 'string') pushImg(imgField, title, 'Article schema image')
        else if (Array.isArray(imgField)) {
          for (const sub of imgField) {
            if (typeof sub === 'string') pushImg(sub, title)
            else if (sub?.url) pushImg(sub.url, sub.caption || title, sub.caption)
          }
        } else if (imgField?.url) {
          pushImg(imgField.url, imgField.caption || title, imgField.caption)
        }
      }
    } catch {
      // ignore malformed JSON-LD
    }
  })

  // 8c. Featured / Hero image containers + Article body images
  const imgContainers = [
    ...Array.from(doc.querySelectorAll('.featured-image img, .post-thumbnail img, .lead-image img, .article-hero img, figure img')),
    ...Array.from(contentArea.querySelectorAll('img')),
  ]
  imgContainers.forEach((img) => {
    if (img.closest('header, nav, footer, .advertisement, .related-news, .sidebar, .comment')) return
    const pictureSource = img.closest('picture')?.querySelector('source[srcset]')?.getAttribute('srcset')
    const rawSrc =
      img.getAttribute('data-src') ||
      img.getAttribute('data-lazy-src') ||
      img.getAttribute('data-original') ||
      pictureSource ||
      img.getAttribute('srcset') ||
      img.getAttribute('src')
    const figure = img.closest('figure')
    const caption = figure?.querySelector('figcaption')?.textContent?.trim() || img.getAttribute('title')?.trim()
    pushImg(rawSrc, img.getAttribute('alt')?.trim() || '', caption)
  })

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
  }
}
