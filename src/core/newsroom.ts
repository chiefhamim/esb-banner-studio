// Small newsroom helpers: highlight suggestion, article scraper, translation & tone polisher, multi-platform captions, and editorial label pills.
import { getCategory } from './tokens'
import type { Content } from './types'
import type { IconPathDef } from './tokens'
import { bengaliToAsciiDigits } from '../editorial/bengali'
import { translateComplete } from '../editorial/translateNet'

const CURRENCY = /(?:\$|Tk\.?\s?|BDT\s?|USD\s?)\d[\d,]*(?:\.\d+)?(?:\s?(?:billion|million|crore|lakh))?(?:\s+per\s+\w+)?/i
const WITH_UNIT = /\d[\d,]*(?:\.\d+)?\s?(?:MMCFD|MMcf|bcf|MW|GW|kW|kWh|percent|%|billion|million|crore|lakh|Tk|BDT|USD|tonnes?|MT|days?|months?|years?)\b/i
const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'for', 'and', 'or', 'with', 'by', 'from', 'as', 'is', 'are', 'after', 'amid', 'over'])

/** Pick the phrase a reader's eye should land on: an amount or a figure with its unit; otherwise two words from the middle of the headline. */
export function suggestHighlight(headline: string): string {
  const text = headline.replace(/\s+/g, ' ').trim()
  if (!text) return ''
  for (const re of [CURRENCY, WITH_UNIT]) {
    const m = text.match(re)
    if (m) return m[0].replace(/[,.;:]+$/, '').trim()
  }
  const words = text.split(' ')
  if (words.length <= 2) return text
  const start = Math.max(1, Math.floor(words.length * 0.4))
  let pick = words.slice(start, start + 2)
  if (STOP.has(pick[0].toLowerCase())) pick = words.slice(start + 1, start + 3)
  return pick.join(' ').replace(/[,.;:]+$/, '')
}

export const TAGS: Record<string, string[]> = {
  '01': ['EnergyPolicy', 'PowerSector', 'BERC'],
  '02': ['PowerGeneration', 'Electricity', 'BPDB'],
  '03': ['FossilFuels', 'EnergyPrices', 'LNG', 'Petrobangla', 'TitasGas'],
  '04': ['Renewables', 'CleanEnergy', 'SolarEnergy', 'Nuclear'],
  '05': ['PowerGrid', 'Transmission', 'PGCB'],
  '06': ['PowerDistribution', 'Utilities', 'DPDC', 'DESCO'],
  '07': ['EnergyTariffs', 'ElectricityBill', 'Consumers'],
  '08': ['EnergyFinance', 'Subsidy', 'PowerArrears'],
  '09': ['CrossBorderEnergy', 'EnergyTrade', 'PowerImport'],
  '10': ['Environment', 'EnergyEfficiency', 'ClimateAction'],
}

export type SocialPlatform = 'facebook' | 'linkedin' | 'twitter' | 'telegram'

/** Format platform-specific copy: headline, summary/quote, link, and targeted hashtags. */
export function generatePlatformCaption(platform: SocialPlatform, c: Pick<Content, 'headline' | 'categoryId' | 'cardType' | 'quoteText' | 'speakerName' | 'speakerTitle' | 'statNumber' | 'statLabel' | 'statDelta' | 'statNote'>): string {
  const tags = ['ESBPowerLine', 'Bangladesh', ...(TAGS[c.categoryId] ?? [])].map((t) => '#' + t)
  const head = c.headline.trim() || getCategory(c.categoryId).name

  if (c.cardType === 'quote' && (c.quoteText || c.headline)) {
    const quote = (c.quoteText || c.headline).trim()
    const speaker = [c.speakerName?.trim(), c.speakerTitle?.trim()].filter(Boolean).join(' · ')
    const attribution = speaker ? `\n— ${speaker}` : ''

    switch (platform) {
      case 'twitter': {
        const shortQuote = quote.length > 170 ? quote.slice(0, 167) + '…' : quote
        return `“${shortQuote}”${attribution}\n\nRead full story: https://esbpowerline.com\n#ESBPowerLine #Bangladesh`
      }
      case 'linkedin':
        return `“${quote}”${attribution}\n\nEnergy and power sector statement covered by ESB Power Line.\n\nRead the full report: https://esbpowerline.com\n\n${tags.slice(0, 4).join(' ')}`
      case 'telegram':
        return `*“${quote}”*${attribution ? `\n_${attribution}_` : ''}\n\n📰 *ESB Power Line*\n🔗 https://esbpowerline.com`
      case 'facebook':
      default:
        return `“${quote}”${attribution}\n\nRead the full coverage on ESB Power Line: https://esbpowerline.com\n\n${tags.slice(0, 4).join(' ')}`
    }
  }

  // a stat card needs a figure: a highlighted phrase ("the Sylhet") read as one opened captions with "⚡ the Sylhet —"
  if (c.cardType === 'stat' && /\d/.test(c.statNumber ?? '')) {
    const num = (c.statNumber ?? '').trim()
    const label = (c.statLabel || head).trim()
    const delta = c.statDelta?.trim() ? ` (${c.statDelta.trim()})` : ''
    const note = c.statNote?.trim() ? `\n${c.statNote.trim()}` : ''

    switch (platform) {
      case 'twitter':
        return `⚡ ${num} — ${label}${delta}${note}\n\nRead more at https://esbpowerline.com\n#ESBPowerLine #EnergyData`
      case 'linkedin':
        return `📊 Key Industry Metric: ${num}\n${label}${delta}${note}\n\nFollow ESB Power Line for daily Bangladesh power & energy sector intelligence.\n\n🔗 https://esbpowerline.com\n\n${tags.join(' ')}`
      case 'telegram':
        return `📊 *${num}* — ${label}${delta}${note}\n\n🔗 https://esbpowerline.com\n#ESBPowerLine`
      case 'facebook':
      default:
        return `${num} — ${label}${delta}${note}\n\nRead the detailed breakdown: https://esbpowerline.com\n\n${tags.slice(0, 4).join(' ')}`
    }
  }

  // Standard news headline
  switch (platform) {
    case 'twitter': {
      const shortHead = head.length > 200 ? head.slice(0, 197) + '…' : head
      return `${shortHead}\n\nRead more: https://esbpowerline.com\n#ESBPowerLine #Bangladesh`
    }
    case 'linkedin':
      return `${head}\n\nExplore in-depth analysis and reporting on Bangladesh's power and energy sector.\n\nRead the complete story: https://esbpowerline.com\n\n${tags.join(' ')}`
    case 'telegram':
      return `📰 *${head}*\n\nRead more: https://esbpowerline.com\n\n#ESBPowerLine`
    case 'facebook':
    default:
      return `${head}\n\nRead more: https://esbpowerline.com\n\n${tags.slice(0, 4).join(' ')}`
  }
}

/** Default Facebook caption: headline, a link line and category hashtags. Editable in the app. */
export function defaultCaption(c: Pick<Content, 'headline' | 'categoryId' | 'cardType' | 'quoteText' | 'speakerName' | 'speakerTitle' | 'statNumber' | 'statLabel' | 'statDelta' | 'statNote'>): string {
  return generatePlatformCaption('facebook', c)
}

// ---------------------------------------------------------------- label pills (as on esbpowerline.com)
export type LabelPresetId =
  | 'breaking'
  | 'exclusive'
  | 'special'
  | 'analysis'
  | 'opinion'
  | 'trending'
  | 'featured'
  | 'developing'
  | 'factcheck'

/** Colours read from the live website and editorial guidelines: white uppercase text on a solid pill with a darker 1 px border and a soft tinted shadow. */
export const LABEL_PRESETS: Record<LabelPresetId, { name: string; text: string; bg: string; border: string; icon: 'flame' | 'star' | 'trending' }> = {
  breaking: { name: 'Breaking News', text: 'BREAKING', bg: '#dc2828', border: '#c52020', icon: 'flame' },
  exclusive: { name: 'Exclusive', text: 'EXCLUSIVE', bg: '#b45309', border: '#92400e', icon: 'star' },
  special: { name: 'Special Report', text: 'SPECIAL REPORT', bg: '#1e3a8a', border: '#172554', icon: 'flame' },
  analysis: { name: 'Analysis', text: 'ANALYSIS', bg: '#0f766e', border: '#115e59', icon: 'trending' },
  opinion: { name: 'Opinion / কলাম', text: 'OPINION', bg: '#6d28d9', border: '#5b21b6', icon: 'star' },
  trending: { name: 'Trending', text: 'TRENDING', bg: '#1041c6', border: '#0c33a0', icon: 'trending' },
  featured: { name: 'Featured', text: 'FEATURED', bg: '#956004', border: '#7c5003', icon: 'star' },
  developing: { name: 'Developing', text: 'DEVELOPING', bg: '#b91c1c', border: '#991b1b', icon: 'flame' },
  factcheck: { name: 'Fact Check', text: 'FACT CHECK', bg: '#15803d', border: '#166534', icon: 'star' },
}

const stroke = (d: string): IconPathDef => ({ d, stroke: '$ink', strokeWidth: 2 })
/** 24 x 24 outline icons the website uses on these pills. */
export const LABEL_ICONS: Record<'flame' | 'star' | 'trending', IconPathDef[]> = {
  flame: [stroke('M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z')],
  star: [stroke('M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z')],
  trending: [stroke('M16 7h6v6'), stroke('M22 7l-8.5 8.5-5-5L2 17')],
}

// ---------------------------------------------------------------- Sector Photo Library Suggestions
export interface SectorImage {
  title: string
  url: string
  note: string
}

export const SECTOR_IMAGE_SUGGESTIONS: Record<string, SectorImage[]> = {
  '01': [
    { title: 'Energy Ministry & Policy Hall', url: 'https://images.unsplash.com/photo-1541872703-74c5e44368f9?auto=format&fit=crop&w=1600&q=80', note: 'Policy & Regulatory Hall' },
    { title: 'Corporate Power Governance', url: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1600&q=80', note: 'Energy Sector Tower' },
  ],
  '02': [
    { title: 'Thermal Power Generation Station', url: 'https://images.unsplash.com/photo-1473341304170-971dccb5ac1e?auto=format&fit=crop&w=1600&q=80', note: 'Power Station & Turbines' },
    { title: 'Combined Cycle Gas Power Plant', url: 'https://images.unsplash.com/photo-1513828583688-c52646db42da?auto=format&fit=crop&w=1600&q=80', note: 'Industrial Energy Station' },
  ],
  '03': [
    { title: 'Natural Gas Exploration & Drilling Rig', url: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1600&q=80', note: 'Gas Field & Exploration' },
    { title: 'LNG Processing & Terminal Tanker', url: 'https://images.unsplash.com/photo-1578328819058-b69f3a3b0f6b?auto=format&fit=crop&w=1600&q=80', note: 'LNG Terminal & Fuel Storage' },
    { title: 'Gas Transmission Pipeline System', url: 'https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&w=1600&q=80', note: 'Pipeline Infrastructure' },
  ],
  '04': [
    { title: 'Utility-Scale Solar PV Power Farm', url: 'https://images.unsplash.com/photo-1509391365360-2e959784a276?auto=format&fit=crop&w=1600&q=80', note: 'Clean Solar Energy' },
    { title: 'Modern Clean Wind Turbine Array', url: 'https://images.unsplash.com/photo-1466611653911-95081537e5b7?auto=format&fit=crop&w=1600&q=80', note: 'Renewable Wind Farm' },
  ],
  '05': [
    { title: 'High-Voltage PGCB Transmission Towers', url: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?auto=format&fit=crop&w=1600&q=80', note: 'National Power Grid' },
    { title: 'Electrical Substation Transformers', url: 'https://images.unsplash.com/photo-1516937941344-00b4e0337589?auto=format&fit=crop&w=1600&q=80', note: 'Grid Substation' },
  ],
  '06': [
    { title: 'Urban Power Distribution Network', url: 'https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?auto=format&fit=crop&w=1600&q=80', note: 'Distribution & Linemen' },
    { title: 'Utility Substation Infrastructure', url: 'https://images.unsplash.com/photo-1497435334941-8c899ee9e8e9?auto=format&fit=crop&w=1600&q=80', note: 'Utility Power Feed' },
  ],
  '07': [
    { title: 'Smart Prepaid Electricity Meter', url: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=1600&q=80', note: 'Consumer Tariff & Metering' },
    { title: 'Consumer Energy Control System', url: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=1600&q=80', note: 'Industrial Metering' },
  ],
  '08': [
    { title: 'Energy Finance & Investment Review', url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1600&q=80', note: 'Financial Analytics' },
    { title: 'Power Sector Subsidies & Banking', url: 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=1600&q=80', note: 'Budget & Subsidies' },
  ],
  '09': [
    { title: 'Cross-Border Transmission Corridor', url: 'https://images.unsplash.com/photo-1509391365360-2e959784a276?auto=format&fit=crop&w=1600&q=80', note: 'Cross-Border Interconnection' },
  ],
  '10': [
    { title: 'Green Energy & Climate Conservation', url: 'https://images.unsplash.com/photo-1511497584788-87676104235f?auto=format&fit=crop&w=1600&q=80', note: 'Environmental Efficiency' },
  ],
}

// ---------------------------------------------------------------- Translation & Journalistic Polishing
/** Clean literal translation into natural, copyright-free Bangladesh energy journalism tone. */
export function polishJournalisticEnglish(text: string): string {
  let t = text
    .replace(/\bRs\.?\s?/gi, 'Tk ')
    .replace(/\brupees?\b/gi, 'Taka')
    .replace(/\bDigging\b/gi, 'Drilling')
    .replace(/\bdig\b/gi, 'drill')
    .replace(/\b30 million cubic feet of gas per day\b/gi, '30 MMCFD Gas')
    .replace(/\bmillion cubic feet of gas per day\b/gi, 'MMCFD Gas')
    .replace(/\bmillion cubic feet\b/gi, 'MMCFD')
    .replace(/\bin the grid\b/gi, 'to National Grid')
    .replace(/\bworth\b/gi, 'for')
    .replace(/\bBangladesh Government\b/gi, 'Govt')
    .replace(/\bgovernment\b/gi, 'Govt')
    .replace(/\s+/g, ' ')
    .trim()

  if (t.length > 0) {
    t = t.charAt(0).toUpperCase() + t.slice(1)
  }
  return t
}

export type TranslatorFn = (text: string) => Promise<string>
let customTranslator: TranslatorFn | null = null

export function setCustomTranslator(fn: TranslatorFn | null) {
  customTranslator = fn
}

/** Translate Bengali text into natural English with zero setup/keys required. */
export async function translateBengaliToEnglish(text: string): Promise<string> {
  const clean = text.trim()
  if (!clean) return ''
  // If not Bengali characters, return as-is
  if (!/[\u0980-\u09FF]/.test(clean)) return clean

  if (customTranslator) {
    return customTranslator(clean)
  }

  if (typeof window !== 'undefined' && (window as unknown as { __customTranslator?: TranslatorFn }).__customTranslator) {
    return (window as unknown as { __customTranslator: TranslatorFn }).__customTranslator(clean)
  }

  if (typeof navigator === 'undefined' || navigator.onLine !== false) {
    const translated = await translateComplete(clean)
    if (translated) return polishJournalisticEnglish(translated)
  }
  // Last resort: digits and units normalised only. The Bengali prose is left as-is rather than fabricated, and the
  // caller flags it for review. (A hard-coded answer for one test headline used to sit here; tests now use the
  // __customTranslator seam above, and the app never returns a canned translation.)
  return bengaliToAsciiDigits(clean)
}

// ---------------------------------------------------------------- Article URL Scraper / Parser
export interface ParsedArticle {
  headline?: string
  rawHeadline?: string
  date?: string
  imageUrl?: string
  images: string[]
  suggestedImages: SectorImage[]
  categoryId?: string
  description?: string
  author?: string
}

/** Match text or URL keywords against ESB Power Line's 10 desks (Bengali and English). */
export function detectCategory(text: string): string | undefined {
  const t = text.toLowerCase()
  if (/\b(policy|regulat|berc|ministry|power division|act|reform|guideline)\b|নীতিমালা|নিয়ন্ত্রক|বিইআরসি|মন্ত্রণালয়/i.test(t)) return '01'
  if (/\b(generation|power plant|turbin|megawatt|\bmw\b|unit|bpdb|independent power|ipp|coal plant|rampal|payra|matarbari)\b|বিদ্যুৎ কেন্দ্র|উৎপাদন|মেগাওয়াট|পিডিবি|কয়লা/i.test(t)) return '02'
  if (/\b(gas|lng|petrobangla|fossil|fuel|oil|diesel|bapex|drill|well|exploration|cylinder|lpg|titas|bgfcl)\b|গ্যাস|জ্বালানি|কূপ|খনন|তেল|পেট্রোবাংলা|তিতাস|বাপেক্স|এলএনজি/i.test(t)) return '03'
  if (/\b(solar|renewab|wind|nuclear|roospp|rooppur|clean energy|photovoltaic|green energy|sreda)\b|সৌর|নবায়নযোগ্য|বায়ু|পারমাণবিক|রূপপুর|গ্রিন/i.test(t)) return '04'
  if (/\b(grid|transmission|pgcb|substation|high voltage|blackout|tripping|tower|interconnect)\b|গ্রিড|সঞ্চালন|পিজিসিবি|সাবস্টেশন|ব্ল্যাকআউট/i.test(t)) return '05'
  if (/\b(distribution|dpdc|desco|reb|breb|wzpdcl|nesco|utility|substation|load shedding|feeder)\b|বিতরণ|ডিপিডিসি|ডেসকো|পল্লী বিদ্যুৎ|লোডশেডিং/i.test(t)) return '06'
  if (/\b(tariff|price|rate|hike|consumer|electricity bill|meter|prepaid|unit price|berc hearing)\b|ট্যারিফ|দাম|মূল্যবৃদ্ধি|গ্রাহক|বিল|মিটার|প্রিপেইড/i.test(t)) return '07'
  if (/\b(subsidy|finance|arrear|dues|payment|loan|bonds|deficit|budget|fund|bank)\b|ভর্তুকি|অর্থায়ন|বকেয়া|ঋণ|ঘাটতি|বাজেট/i.test(t)) return '08'
  if (/\b(cross-border|india|adani|nepal|bhutan|import|trade|regional grid)\b|আমদানি|ভারত|আদানি|নেপাল|ভুটান|সীমান্ত/i.test(t)) return '09'
  if (/\b(environment|climate|efficiency|emission|carbon|cop|conservation|energy saving)\b|পরিবেশ|জলবায়ু|কার্বন|দক্ষতা/i.test(t)) return '10'
  return undefined
}

/** Parse an article's raw HTML to extract OpenGraph, images, dates and text. */
export function parseArticleHtml(html: string, fallbackUrl?: string): ParsedArticle {
  const getMeta = (prop: string): string | undefined => {
    const re = new RegExp(`<meta\\s+[^>]*(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i')
    const m = html.match(re)
    if (m) return m[1]
    const reRev = new RegExp(`<meta\\s+[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, 'i')
    const mRev = html.match(reRev)
    return mRev ? mRev[1] : undefined
  }

  // 1. Headline
  let headline = getMeta('og:title') || getMeta('twitter:title')
  if (!headline) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    if (titleMatch) headline = titleMatch[1]
  }
  const rawHeadline = headline ?? ''
  if (headline) {
    headline = headline
      .replace(/\s*[-–|]\s*(?:ESB PowerLine|ESB Power Line|PowerLine|বণিক বার্তা|Bonik Barta|Daily Star|Prothom Alo|TBS|News).*$/i, '')
      .replace(/&amp;/g, '&')
      .replace(/&#8217;/g, "'")
      .replace(/&#8220;/g, '"')
      .replace(/&#8221;/g, '"')
      .replace(/&#8211;/g, '–')
      .replace(/&#8212;/g, '—')
      .trim()
  }

  // 2. Images Extraction (og:image + all article in-body photos)
  const imageSet = new Set<string>()
  const resolve = (src: string): string => {
    if (!src) return ''
    if (src.startsWith('http://') || src.startsWith('https://')) return src
    if (fallbackUrl) {
      try { return new URL(src, fallbackUrl).href } catch {}
    }
    return src
  }

  const isArticlePhoto = (src: string): boolean => {
    const s = src.toLowerCase()
    if (s.includes('logo') || s.includes('icon') || s.includes('advertisement') || s.includes('banner') || s.includes('ads') || s.includes('avatar') || s.includes('tracker') || s.includes('epaper') || s.endsWith('.svg')) return false
    return true
  }

  const ogImg = getMeta('og:image:secure_url') || getMeta('og:image') || getMeta('twitter:image')
  if (ogImg) {
    const resolved = resolve(ogImg)
    if (isArticlePhoto(resolved)) imageSet.add(resolved)
  }

  // Extract from <img> and <source srcset>
  const imgRe = /<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/gi
  let match
  while ((match = imgRe.exec(html))) {
    const r = resolve(match[1])
    if (r && isArticlePhoto(r)) imageSet.add(r)
  }

  const srcRe = /<source[^>]+srcset=["']([^"']+)["'][^>]*>/gi
  while ((match = srcRe.exec(html))) {
    const first = match[1].split(',')[0].trim().split(' ')[0]
    const r = resolve(first)
    if (r && isArticlePhoto(r)) imageSet.add(r)
  }

  const images = Array.from(imageSet).slice(0, 12)
  const imageUrl = images[0]

  // 3. Description
  const description = getMeta('og:description') || getMeta('twitter:description') || getMeta('description')

  // 4. Date (ISO yyyy-mm-dd)
  let date: string | undefined
  const rawDate = getMeta('article:published_time') || getMeta('publish-date') || getMeta('date')
  if (rawDate) {
    const parsed = new Date(rawDate)
    if (!isNaN(parsed.getTime())) {
      date = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`
    }
  }
  if (!date) {
    // Check JSON-LD or embedded date strings (like last_published_at:"2026-10-12")
    const jsonDate = html.match(/(?:datePublished|published_at|publish_date|date)["']?\s*:\s*["'](\d{4}-\d{2}-\d{2})/i)
    if (jsonDate) date = jsonDate[1]
  }
  if (!date) {
    const timeMatch = html.match(/<time[^>]*datetime=["']([^"']+)["']/i)
    if (timeMatch) {
      const parsed = new Date(timeMatch[1])
      if (!isNaN(parsed.getTime())) {
        date = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`
      }
    }
  }

  // 5. Category
  const categoryId = detectCategory([fallbackUrl, headline, description, html.slice(0, 3000)].filter(Boolean).join(' ')) ?? '01'
  const suggestedImages = SECTOR_IMAGE_SUGGESTIONS[categoryId] ?? []

  return { headline, rawHeadline, date, imageUrl, images, suggestedImages, categoryId, description }
}
