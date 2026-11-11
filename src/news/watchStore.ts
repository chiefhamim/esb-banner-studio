// EnergyWatch on the desktop: the office watcher's news & official government press release part, run by ESB AI Studio itself.
// Reads every portal's feed + official Bangladesh government ministry/division/commission/utility press wings,
// keeps headlines the matcher accepts (and all official press releases from energy/power ministries & utilities, plus
// energy/leadership press releases from PMO, Bangabhaban & PID), and exposes category-aware canonical Trending topics
// and relevance-scored headline sorting.
import { deskMoving } from '../shell/shellStore'
// the moment of the editor's last click or key: a scan publish waits half a second after it, because a click usually
// starts something that moves (a fold, a desk change, a menu)
let lastInputAt = -1e9
if (typeof window !== 'undefined') for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => { lastInputAt = performance.now() }, { capture: true, passive: true })
const busyOnScreen = () => typeof document !== 'undefined' && (performance.now() - lastInputAt < 500 || !!document.querySelector('.col-anim, .is-scrolling, .resizing') || deskMoving())
/** Resolves once nothing on screen is moving (checked every 100 ms): the scan's parsing and publishing wait for it. */
const whenCalm = () => new Promise<void>((res) => { const check = () => (busyOnScreen() ? setTimeout(check, 100) : res()); check() })
import { create } from 'zustand'
import { buildMatcher, type EwKeyword } from './matcher'
import { EW_FEEDS, EW_KEYWORDS, EW_PRESS_SOURCES, type EwPressSource } from './ewSources'
import { parseFeed, parseDate } from './feedparse'
import { itemTimeMs, olderThan, sortTimeMs } from './dates'
import { mergeFound as mergeRows, norm, normUrlKey, redirectTarget } from './dedupe'
import { NOT_PRESS, parseGovPressTable, resolveGovOfficeName } from './pressParse'

export { itemTimeMs, norm, normUrlKey, parseGovPressTable, resolveGovOfficeName }

export type WatchCat = 'energy' | 'leadership' | 'press'
export interface WatchItem {
  key: string
  title: string
  link: string
  /** true when the only link is an encoded Google News one (opens in the browser or resolves on demand) */
  google: boolean
  source: string
  feedId: number
  published: string | null
  foundAt: number
  categories: string[]
  matched: string[]
  /** the feed gave no readable date: shown as "time not given", aged from when it was first found */
  timeUnknown?: boolean
}
export interface FeedState { ok: boolean; at: number; count: number; error?: string }
export interface WatchPrefs {
  /** portal or press office names switched off on this computer */
  portalsOff: string[]
  /** extra "always keep" words (energy news) */
  keep: string[]
  /** extra "never show" words */
  never: string[]
  show: Record<WatchCat, boolean>
  maxAgeH: number
  /** minutes between automatic checks while the News desk is open; 0 = only Check now */
  autoMin: number
  /** show an English line under Bangla headlines (free translation, in the background); default on */
}

export const DEFAULT_PREFS: WatchPrefs = {
  portalsOff: [],
  keep: [],
  never: [],
  show: { energy: true, leadership: true, press: true },
  maxAgeH: 24,
  autoMin: 10,
}
const PREFS_KEY = 'esb-banner-studio/news/prefs/v1'
const DATA_KEY = 'esb-banner-studio/news/data/v1'
const ITEM_CAP = 2800
const CONCURRENCY = 6
const TIMEOUT_MS = 20000
const PRESS_RETENTION_MS = 60 * 24 * 3600_000 // Keep official government press releases for 60 days

const load = <T extends object>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k)
    if (!v) return d
    const parsed = JSON.parse(v)
    if (parsed && typeof parsed === 'object' && 'show' in d && parsed.show) {
      parsed.show = { ...(d as unknown as WatchPrefs).show, ...parsed.show }
    }
    return { ...d, ...parsed }
  } catch {
    return d
  }
}
const save = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {
    // Quota exceeded: if this is the large news items key, trim items progressively so localStorage doesn't freeze drafts
    if (k === DATA_KEY && v && typeof v === 'object' && 'items' in v && Array.isArray((v as { items: unknown[] }).items)) {
      const data = v as { items: unknown[] }
      try {
        localStorage.setItem(k, JSON.stringify({ ...data, items: data.items.slice(0, 1000) }))
      } catch {
        try {
          localStorage.setItem(k, JSON.stringify({ ...data, items: data.items.slice(0, 400) }))
        } catch { /* storage full */ }
      }
    }
  }
}

/** A feed this computer reads: every one EnergyWatch has switched on, Bing News included. */
export const isPhoneFeed = (f: { on: boolean; url: string }) => {
  if (!f.on) return false
  try { return /^https?:$/.test(new URL(f.url).protocol) } catch { return false }
}

/** How many media feeds are read. */
export const FEED_COUNT = EW_FEEDS.filter((f) => isPhoneFeed(f)).length

/** Every media portal (feeds grouped by name), in EnergyWatch's order. */
export const PORTALS: { name: string; feeds: number }[] = (() => {
  const m = new Map<string, number>()
  for (const f of EW_FEEDS) if (isPhoneFeed(f)) m.set(f.name, (m.get(f.name) ?? 0) + 1)
  return [...m].map(([name, feeds]) => ({ name, feeds }))
})()

/** Official Bangladesh Government Ministries, Divisions, Commissions & State Offices scanned for Official Press. */
export const PRESS_OFFICES: { name: string; office: string; feeds: number }[] = (() => {
  const m = new Map<string, { office: string; feeds: number }>()
  for (const s of EW_PRESS_SOURCES) {
    if (!s.on) continue
    const cur = m.get(s.name)
    m.set(s.name, { office: s.office, feeds: (cur?.feeds ?? 0) + 1 })
  }
  return [...m].map(([name, v]) => ({ name, office: v.office, feeds: v.feeds }))
})()

/** Unwrap feed click-through URLs (Bing News, Google /url) and detect encoded Google News links. */
export function unwrapLink(link: string): { link: string; google: boolean } {
  const unwrapped = redirectTarget(link)
  if (unwrapped !== link) return { link: unwrapped, google: false }
  try {
    const u = new URL(link)
    if (/(^|\.)news\.google\.com$/i.test(u.hostname)) return { link, google: true }
  } catch { /* not a URL: kept as it is */ }
  return { link, google: false }
}

/** A word the editor added, as the headline check should look for it: "Tanker" also finds "tankers". */
const keepTerms = (term: string): string[] => (/^[A-Za-z][A-Za-z -]*$/.test(term) && !/^[A-Z0-9]{2,}$/.test(term) && !/s$/i.test(term) ? [term, `${term}s`] : [term])

export function keywordsFor(p: WatchPrefs): EwKeyword[] {
  return [
    ...EW_KEYWORDS,
    ...p.keep.flatMap(keepTerms).map((term) => ({ term, kind: 'strong', category: 'energy' })),
    ...p.never.map((term) => ({ term, kind: 'block', category: null })),
  ]
}

// ============================================================================
// Canonical Topics & Intelligent Headline Sorting
// ============================================================================
export interface CanonicalTopic {
  id: string
  label: string
  cat: 'energy' | 'leadership'
  terms: string[]
}

export const CANONICAL_TOPICS: CanonicalTopic[] = [
  {
    id: 'lng',
    label: 'LNG',
    cat: 'energy',
    terms: ['lng', 'এলএনজি', 'তরলীকৃত প্রাকৃতিক গ্যাস', 'spot lng', 'fsru', 'floating storage'],
  },
  {
    id: 'lpg',
    label: 'LPG',
    cat: 'energy',
    terms: ['lpg', 'এলপিজি', 'সিলিন্ডার গ্যাস', 'গ্যাস সিলিন্ডার', 'অটোগ্যাস', 'autogas'],
  },
  {
    id: 'loadshedding',
    label: 'Load Shedding',
    cat: 'energy',
    terms: ['load shedding', 'loadshedding', 'লোডশেডিং', 'লোড শেডিং', 'বিদ্যুৎ বিভ্রাট', 'বিদ্যুৎ সংকট', 'বিদ্যুৎ ঘাটতি', 'power outage', 'power cut', 'blackout', 'বিদ্যুৎ থাকবে না', 'বিদ্যুৎ বন্ধ'],
  },
  {
    id: 'tariff',
    label: 'Tariff & Price',
    cat: 'energy',
    terms: ['বিদ্যুতের দাম', 'গ্যাসের দাম', 'জ্বালানি তেলের দাম', 'তেলের দাম', 'এলপিজির দাম', 'power tariff', 'electricity tariff', 'gas price', 'gas tariff', 'fuel price', 'energy price', 'দাম বাড়', 'দাম কম', 'মূল্য সমন্বয়', 'ভর্তুকি', 'subsidy'],
  },
  {
    id: 'bpdb',
    label: 'BPDB',
    cat: 'energy',
    terms: ['bpdb', 'পিডিবি', 'বিপিডিবি', 'বিদ্যুৎ উন্নয়ন বোর্ড', 'power development board'],
  },
  {
    id: 'petrobangla',
    label: 'Petrobangla',
    cat: 'energy',
    terms: ['petrobangla', 'পেট্রোবাংলা'],
  },
  {
    id: 'berc',
    label: 'BERC',
    cat: 'energy',
    terms: ['berc', 'বিইআরসি', 'এনার্জি রেগুলেটরি কমিশন', 'energy regulatory commission', 'গণশুনানি'],
  },
  {
    id: 'bpc',
    label: 'BPC & Fuel Oil',
    cat: 'energy',
    terms: ['bpc', 'বিপিসি', 'পেট্রোলিয়াম কর্পোরেশন', 'petroleum corporation', 'ডিজেল', 'অকটেন', 'পেট্রোল', 'কেরোসিন', 'ফার্নেস অয়েল', 'জ্বালানি তেল', 'diesel', 'octane', 'kerosene', 'furnace oil', 'fuel oil', 'পদ্মা অয়েল', 'মেঘনা পেট্রোলিয়াম', 'যমুনা অয়েল', 'ইস্টার্ন রিফাইনারি', 'padma oil', 'meghna petroleum', 'jamuna oil', 'eastern refinery'],
  },
  {
    id: 'solar',
    label: 'Solar & Renewable',
    cat: 'energy',
    terms: ['সৌর বিদ্যুৎ', 'সৌরবিদ্যুৎ', 'নবায়নযোগ্য জ্বালানি', 'নবায়নযোগ্য শক্তি', 'solar power', 'solar energy', 'solar park', 'solar plant', 'rooftop solar', 'renewable energy', 'clean energy', 'green energy', 'বায়ু বিদ্যুৎ', 'wind power', 'sreda', 'স্রেডা', 'নেট মিটারিং', 'net metering'],
  },
  {
    id: 'nuclear',
    label: 'Rooppur Nuclear',
    cat: 'energy',
    terms: ['রূপপুর', 'পারমাণবিক বিদ্যুৎ', 'পারমাণবিক কেন্দ্র', 'rooppur', 'nuclear power', 'nuclear plant'],
  },
  {
    id: 'grid',
    label: 'Grid & PGCB',
    cat: 'energy',
    terms: ['pgcb', 'পিজিসিবি', 'পাওয়ার গ্রিড', 'জাতীয় গ্রিড', 'গ্রিড বিপর্যয়', 'national grid', 'power grid', 'grid failure', 'সঞ্চালন লাইন', 'transmission line', 'সাবস্টেশন', 'substation'],
  },
  {
    id: 'reb',
    label: 'Palli Bidyut',
    cat: 'energy',
    terms: ['পল্লী বিদ্যুৎ', 'পল্লী বিদ্যুতায়ন বোর্ড', 'বিআরইবি', 'palli bidyut', 'breb', 'reb', 'rural electrification'],
  },
  {
    id: 'titas',
    label: 'Titas & Gas Supply',
    cat: 'energy',
    terms: ['তিতাস গ্যাস', 'তিতাস', 'titas gas', 'গ্যাস সংকট', 'গ্যাস সরবরাহ', 'গ্যাসের চাপ', 'অবৈধ গ্যাস', 'গ্যাস সংযোগ', 'বাখরাবাদ', 'জালালাবাদ গ্যাস', 'কর্ণফুলী গ্যাস', 'জিটিসিএল', 'gtcl', 'gas supply', 'gas shortage', 'gas connection'],
  },
  {
    id: 'desco_dpdc',
    label: 'DESCO & DPDC',
    cat: 'energy',
    terms: ['ডেসকো', 'ডিপিডিসি', 'নেসকো', 'ওজোপাডিকো', 'desco', 'dpdc', 'nesco', 'wzpdcl', 'প্রিপেইড মিটার', 'prepaid meter'],
  },
  {
    id: 'bapex',
    label: 'BAPEX & Gas Fields',
    cat: 'energy',
    terms: ['বাপেক্স', 'bapex', 'গ্যাসক্ষেত্র', 'gas field', 'কূপ খনন', 'বিবিয়ানা', 'তিতাস গ্যাসক্ষেত্র', 'ভোলা গ্যাস', 'রশিদপুর', 'হরিপুর', 'কৈলাশটিলা', 'সিলেট গ্যাস ফিল্ড', 'বাংলাদেশ গ্যাস ফিল্ডস', 'bibiyana', 'bhola gas', 'sgfl', 'bgfcl', 'অফশোর বিডিং', 'offshore bidding'],
  },
  {
    id: 'coal_plant',
    label: 'Coal & Power Plants',
    cat: 'energy',
    terms: ['কয়লা বিদ্যুৎ', 'কয়লাভিত্তিক', 'রামপাল', 'পায়রা বিদ্যুৎ', 'মাতারবাড়ী', 'বাঁশখালী', 'বড়পুকুরিয়া', 'সামিট পাওয়ার', 'ইউনাইটেড পাওয়ার', 'কুইক রেন্টাল', 'ক্যাপাসিটি চার্জ', 'বিদ্যুৎকেন্দ্র', 'বিদ্যুৎ কেন্দ্র', 'rampal', 'payra power', 'matarbari', 'barapukuria', 'coal power', 'power plant', 'capacity charge', 'quick rental'],
  },
  {
    id: 'import_adani',
    label: 'Power Import & Adani',
    cat: 'energy',
    terms: ['আদানি', 'adani', 'বিদ্যুৎ আমদানি', 'ভারত থেকে বিদ্যুৎ', 'নেপাল থেকে বিদ্যুৎ', 'power import', 'cross-border power'],
  },
  {
    id: 'ministry_policy',
    label: 'Ministry & Policy',
    cat: 'energy',
    terms: ['বিদ্যুৎ বিভাগ', 'জ্বালানি ও খনিজ সম্পদ', 'বিদ্যুৎ মন্ত্রণালয়', 'জ্বালানি মন্ত্রণালয়', 'বিদ্যুৎ উপদেষ্টা', 'জ্বালানি উপদেষ্টা', 'বিদ্যুৎ প্রতিমন্ত্রী', 'জ্বালানি প্রতিমন্ত্রী', 'বিদ্যুৎ মন্ত্রী', 'জ্বালানি মন্ত্রী', 'power division', 'energy division', 'emrd', 'energy ministry', 'power ministry', 'energy adviser', 'power adviser'],
  },
  {
    id: 'pm_tarique',
    label: 'PM Tarique Rahman',
    cat: 'leadership',
    terms: ['প্রধানমন্ত্রী', 'তারেক রহমান', 'প্রধানমন্ত্রীর কার্যালয়', 'প্রধানমন্ত্রীর নির্দেশ', 'prime minister', 'pm tarique', 'tarique rahman', 'pmo'],
  },
  {
    id: 'president_shahabuddin',
    label: 'President & Bangabhaban',
    cat: 'leadership',
    terms: ['রাষ্ট্রপতি', 'সাহাবুদ্দিন', 'বঙ্গভবন', 'president shahabuddin', 'mohammed shahabuddin', 'bangabhaban', 'president'],
  },
]

const GENERIC_UMBRELLA_TERMS = new Set([
  'বিদ্যুৎ', 'জ্বালানি', 'গ্যাস', 'তেল', 'শক্তি',
  'energy', 'power', 'electricity', 'gas', 'oil', 'fuel',
  'প্রধানমন্ত্রী', 'রাষ্ট্রপতি', 'pm', 'president', 'prime minister',
])

const BN_CHAR = /[\u0980-\u09FF]/

function expandBanglaTermVariants(term: string): string[] {
  const t = term.toLowerCase().trim()
  if (!BN_CHAR.test(t)) return [t]
  const out = new Set<string>([t])
  if (t.endsWith('ৎ')) {
    const stem = t.slice(0, -1) + 'ত'
    out.add(stem)
    out.add(stem + 'ে')
    out.add(stem + 'ের')
  }
  return [...out]
}

export function matchQueryScore(item: WatchItem, query: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 1

  const titleLow = item.title.toLowerCase()
  const srcLow = item.source.toLowerCase()
  const matchedLow = item.matched.map((m) => m.toLowerCase())

  const topic = CANONICAL_TOPICS.find((t) => t.label.toLowerCase() === q || t.id.toLowerCase() === q)
  const searchTerms = topic
    ? topic.terms.flatMap(expandBanglaTermVariants)
    : expandBanglaTermVariants(q)

  let score = 0
  if (srcLow === q) score += 10
  else if (srcLow.includes(q)) score += 4

  for (const rawTerm of searchTerms) {
    const term = rawTerm.toLowerCase()
    if (!term) continue
    if (matchedLow.includes(term)) score += 5

    const idx = titleLow.indexOf(term)
    if (idx >= 0) {
      if (!BN_CHAR.test(term) && term.length <= 4) {
        const re = new RegExp(`(?<![a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`, 'i')
        if (!re.test(titleLow)) continue
      }
      score += 6
      if (idx < 35) score += 3
      const secondIdx = titleLow.indexOf(term, idx + term.length)
      if (secondIdx >= 0) score += 2
    }
  }

  if (score === 0 && !topic && q.includes(' ')) {
    const words = q.split(/\s+/).filter((w) => w.length >= 2)
    if (words.length > 1 && words.every((w) => titleLow.includes(w) || srcLow.includes(w))) {
      score += 4
    }
  }

  return score
}

export function trendingTopics(items: WatchItem[], cat: 'all' | WatchCat = 'all', max = 10): [string, number][] {
  const scoped = cat === 'all' ? items : items.filter((x) => x.categories.includes(cat))
  if (!scoped.length) return []

  if (cat === 'press') {
    const byOffice = new Map<string, number>()
    for (const it of scoped) {
      byOffice.set(it.source, (byOffice.get(it.source) ?? 0) + 1)
    }
    const officeTopics = [...byOffice.entries()]
      .filter(([, n]) => n >= 1)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, max)
    if (officeTopics.length > 0) return officeTopics
  }

  const results: [string, number][] = []
  for (const topic of CANONICAL_TOPICS) {
    if (cat === 'energy' && topic.cat !== 'energy') continue
    if (cat === 'leadership' && topic.cat !== 'leadership') continue
    let count = 0
    for (const it of scoped) {
      if (matchQueryScore(it, topic.label) > 0) count++
    }
    if (count >= 1) results.push([topic.label, count])
  }

  const coveredTerms = new Set(CANONICAL_TOPICS.flatMap((t) => t.terms.map((s) => s.toLowerCase())))
  const extraCounts = new Map<string, number>()
  for (const it of scoped) {
    for (const m of new Set(it.matched)) {
      const low = m.toLowerCase()
      if (GENERIC_UMBRELLA_TERMS.has(low) || coveredTerms.has(low)) continue
      extraCounts.set(m, (extraCounts.get(m) ?? 0) + 1)
    }
  }
  for (const [term, n] of extraCounts.entries()) {
    if (n >= 2) results.push([term, n])
  }

  return results
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
}

// ============================================================================
// Network & Official Press Release Scraper
// ============================================================================
export async function fetchText(url: string): Promise<string> {
  const esb = typeof window !== 'undefined' ? window.esb : undefined
  if (!esb?.fetchUrl) throw new Error('Feeds are fetched by the desktop app')
  let last: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await esb.fetchUrl(url, { timeoutMs: TIMEOUT_MS })
      if (!res.ok) {
        const e = new Error(res.error || res.code || 'Feed did not answer')
        if (/\b4\d\d\b|type|blocked|private/i.test(e.message)) throw e
        last = e; continue
      }
      const xml = res.body ?? res.html ?? ''
      if (!/<(rss|feed|rdf:RDF)\b/i.test(xml)) throw new Error('Not a news feed')
      return xml
    } catch (e) {
      last = e
      if (e instanceof Error && /^(Not a news)|\b4\d\d\b|type|blocked|private|desktop app/i.test(e.message)) break
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}

async function fetchHtml(url: string): Promise<{ html: string; finalUrl: string }> {
  const esb = typeof window !== 'undefined' ? window.esb : undefined
  if (!esb?.fetchUrl) throw new Error('Pages are fetched by the desktop app')
  const res = await esb.fetchUrl(url, { timeoutMs: TIMEOUT_MS })
  if (!res.ok) throw new Error(res.error || res.code || 'Press page did not answer')
  const html = res.body ?? res.html ?? ''
  if (!html || html.length < 100) throw new Error('Empty press page')
  return { html, finalUrl: res.url || url }
}

async function fetchPressSource(src: EwPressSource, match: ReturnType<typeof buildMatcher>, started: number): Promise<WatchItem[]> {
  if (src.kind === 'portal-table') {
    const { html, finalUrl } = await fetchHtml(src.url)
    const parsed = parseGovPressTable(html, finalUrl)
    const items: WatchItem[] = []
    for (const p of parsed) {
      if (p.published && started - Date.parse(p.published) > PRESS_RETENTION_MS) continue
      const m = match(p.title)
      const cats = new Set<string>(['press'])
      if (m) for (const c of m.categories) cats.add(c)
      items.push({
        key: p.key,
        title: p.title,
        link: p.link,
        google: false,
        source: src.name,
        feedId: src.id,
        published: p.published,
        timeUnknown: !p.published || undefined,
        foundAt: started,
        categories: [...cats],
        matched: m ? m.matched : [src.name],
      })
    }
    return items
  }
  const list = parseFeed(await fetchText(src.url))
  const items: WatchItem[] = []
  for (const it of list) {
    const published = parseDate(it.date)
    if (published && started - Date.parse(published) > PRESS_RETENTION_MS) continue
    const cleanTitle = it.title.replace(/\s*\|\s*(?:খবর|সংবাদ|প্রেস\s*রিলিজ|সংবাদ\s*বিজ্ঞপ্তি|Press\s*Release|News|Notice|নোটিশ)\s*\|.*$/i, '').trim()
    if (!cleanTitle || NOT_PRESS.test(cleanTitle)) continue
    const { link, google } = unwrapLink(it.link || '')
    if (!/^https?:\/\//i.test(link)) continue
    const officeName = google ? src.name : resolveGovOfficeName(link, src.name)
    if (!officeName) continue
    const m = match(cleanTitle)
    const cats = new Set<string>(['press'])
    if (m) for (const c of m.categories) cats.add(c)
    items.push({
      key: it.key,
      title: cleanTitle,
      link,
      google,
      source: officeName,
      feedId: src.id,
      published,
      timeUnknown: !published || undefined,
      foundAt: started,
      categories: [...cats],
      matched: m ? m.matched : [officeName],
    })
  }
  return items
}

async function pool<T>(list: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) await fn(list[i++]) }))
}

interface WatchState {
  prefs: WatchPrefs
  items: WatchItem[]
  hidden: string[]
  feeds: Record<number, FeedState>
  lastRun: number | null
  seenAt: number
  newKeys: string[]
  running: boolean
  progress: { done: number; total: number } | null
  setPrefs: (p: Partial<WatchPrefs>) => void
  resetPrefs: () => void
  hide: (key: string) => void
  unhide: (key: string) => void
  markSeen: () => void
  markRead: (key: string) => void
  markAllRead: () => void
  cleanPublishedStory: (url?: string | null, title?: string | null) => void
  run: () => Promise<{ checked: number; added: number; failed: number } | null>
}

const initial = load(DATA_KEY, {
  items: [] as WatchItem[],
  hidden: [] as string[],
  feeds: {} as Record<number, FeedState>,
  lastRun: null as number | null,
  seenAt: 0,
  newKeys: [] as string[],
})

/** The list after a check (or during one): one row per story across feeds (dedupe.ts), hidden rows never return. */
export function mergeFound(prev: WatchItem[], found: WatchItem[], started: number, hidden: Iterable<string> = []): { items: WatchItem[]; addedKeys: string[] } {
  return mergeRows(prev, found, started, { hidden, itemCap: ITEM_CAP, pressRetentionMs: PRESS_RETENTION_MS })
}


export const useWatch = create<WatchState>((set, get) => {
  const persist = () => {
    const s = get()
    save(DATA_KEY, { items: s.items, hidden: s.hidden, feeds: s.feeds, lastRun: s.lastRun, seenAt: s.seenAt, newKeys: s.newKeys })
  }
  return {
    prefs: load(PREFS_KEY, DEFAULT_PREFS),
    ...initial,
    running: false,
    progress: null,
    setPrefs: (p) => { const prefs = { ...get().prefs, ...p }; save(PREFS_KEY, prefs); set({ prefs }) },
    resetPrefs: () => { save(PREFS_KEY, DEFAULT_PREFS); set({ prefs: DEFAULT_PREFS }) },
    hide: (key) => { set({ hidden: [...get().hidden, key].slice(-2000) }); persist() },
    unhide: (key) => { set({ hidden: get().hidden.filter((k) => k !== key) }); persist() },
    markRead: (key) => { set({ newKeys: get().newKeys.filter((k) => k !== key) }); persist() },
    markAllRead: () => { set({ newKeys: [] }); persist() },
    markSeen: () => {
      const top = get().items.reduce((m, x) => Math.max(m, x.foundAt), 0)
      if (top > get().seenAt) { set({ seenAt: top }); persist() }
    },
    cleanPublishedStory: (url, title) => {
      const targetUrlKey = normUrlKey(url)
      const targetTitleKey = title ? norm(title) : ''
      if (!targetUrlKey && !targetTitleKey) return
      const s = get()
      const matchedKeys: string[] = []
      const remaining = s.items.filter((it) => {
        const itUrlKey = normUrlKey(it.link)
        const itKeyUrl = normUrlKey(it.key)
        const itTitleKey = norm(it.title)
        const urlMatch = targetUrlKey.length > 8 && (itUrlKey === targetUrlKey || itKeyUrl === targetUrlKey)
        const titleMatch = targetTitleKey.length > 12 && itTitleKey === targetTitleKey
        if (urlMatch || titleMatch) {
          matchedKeys.push(it.key)
          return false
        }
        return true
      })
      if (matchedKeys.length > 0) {
        const rmSet = new Set(matchedKeys)
        set({
          items: remaining,
          hidden: [...new Set([...s.hidden, ...matchedKeys])].slice(-2000),
          newKeys: s.newKeys.filter((k) => !rmSet.has(k)),
        })
        persist()
      }
    },
    run: async () => {
      if (get().running) return null
      set({ running: true })
      const started = Date.now()
      const { prefs } = get()
      const match = buildMatcher(keywordsFor(prefs))
      const off = new Set(prefs.portalsOff)
      const feeds = EW_FEEDS.filter((f) => isPhoneFeed(f) && !off.has(f.name))
      const pressSources = prefs.show.press !== false
        ? EW_PRESS_SOURCES.filter((s) => s.on && !off.has(s.name))
        : []
      const totalSources = feeds.length + pressSources.length
      // always collect the longest window the desk offers (24 h): the window menu only FILTERS what was found, so
      // switching from "Last hour" to "Last 24 hours" shows the whole day at once instead of only the last hour's finds
      const maxAge = Math.max(24, prefs.maxAgeH) * 3600_000
      const states: Record<number, FeedState> = { ...get().feeds }
      const found: WatchItem[] = []
      let failed = 0
      const prev = get().items
      let done = 0
      let flushAt = 0
      let timer: ReturnType<typeof setTimeout> | null = null
      // Each publish re-renders the News desk (~25 ms with a full list). So results are published at most every 700 ms,
      // and never while something on screen is moving (a column folding, a list scrolling, a desk arriving): the publish
      // waits for the next quiet moment, so a scan in the background never costs an animation a frame.
      const publish = () => {
        if (busyOnScreen()) { timer = setTimeout(publish, 120); return }
        timer = null
        flushAt = Date.now()
        const m = mergeFound(prev, found, started, get().hidden)
        set({ items: m.items, feeds: { ...states }, newKeys: prev.length ? m.addedKeys : [], progress: { done, total: totalSources } })
      }
      const soon = () => { if (!timer) timer = setTimeout(publish, Math.max(0, 700 - (Date.now() - flushAt))) }
      set({ progress: { done: 0, total: totalSources } })

      await Promise.all([
        pool(feeds, CONCURRENCY, async (f) => {
          try {
            const text = await fetchText(f.url)
            await whenCalm()
            const list = parseFeed(text)
            states[f.id] = { ok: true, at: Date.now(), count: list.length }
            for (const it of list) {
              const published = parseDate(it.date)
              if (published && started - Date.parse(published) > maxAge) continue
              const m = match(it.title)
              if (!m) continue
              const { link, google } = unwrapLink(it.link || '')
              if (!/^https?:\/\//i.test(link)) continue
              found.push({
                key: it.key,
                title: it.title,
                link,
                google,
                source: f.name,
                feedId: f.id,
                published,
                timeUnknown: !published || undefined,
                foundAt: started,
                categories: m.categories,
                matched: m.matched,
              })
            }
          } catch (e) {
            failed++
            states[f.id] = { ok: false, at: Date.now(), count: 0, error: e instanceof Error ? e.message : String(e) }
          }
          done++
          soon()
        }),
        pool(pressSources, 4, async (ps) => {
          try {
            await whenCalm()
            const pressItems = await fetchPressSource(ps, match, started)
            states[ps.id] = { ok: true, at: Date.now(), count: pressItems.length }
            found.push(...pressItems)
          } catch (e) {
            failed++
            states[ps.id] = { ok: false, at: Date.now(), count: 0, error: e instanceof Error ? e.message : String(e) }
          }
          done++
          soon()
        }),
      ])

      if (timer) clearTimeout(timer)
      const { items, addedKeys } = mergeFound(prev, found, started, get().hidden)
      const added = addedKeys.length
      set({ items, feeds: states, lastRun: started, running: false, progress: null, seenAt: prev.length ? get().seenAt : started, newKeys: prev.length ? addedKeys : [] })
      persist()
      return { checked: totalSources, added, failed }
    },
  }
})

const wordPatterns = new Map<string, RegExp | null>()
/** Does the headline contain the editor's keyword? English words whole (LPG is not inside "ALPGA", a plural counts); Bangla anywhere in a word, so inflections count. */
export function titleHasWord(title: string, word: string): boolean {
  const w = word.normalize('NFC').toLowerCase()
  const t = title.normalize('NFC').toLowerCase()
  let re = wordPatterns.get(w)
  if (re === undefined) {
    re = /^[\x00-\x7f]+$/.test(w) ? new RegExp(`(?<![a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s|es)?(?![a-z0-9])`) : null
    wordPatterns.set(w, re)
  }
  return re ? re.test(t) : t.includes(w)
}

/** Rows to show: filtered by category, time window, and topic/search query, sorted by relevance (when querying) and true timestamp. */
export function visibleItems(
  items: WatchItem[],
  hidden: string[],
  prefs: WatchPrefs,
  q: string,
  cat: 'all' | WatchCat,
  newKeys?: Iterable<string>,
): WatchItem[] {
  const h = new Set(hidden)
  const isNew = newKeys ? new Set(newKeys) : new Set<string>()
  const now = Date.now()
  const mediaMinTime = now - prefs.maxAgeH * 3600_000
  const hasQuery = q.trim().length > 0

  const scored: { item: WatchItem; score: number; time: number; fresh: boolean }[] = []
  for (const x of items) {
    if (h.has(x.key)) continue
    if (prefs.portalsOff.includes(x.source)) continue
    if (!x.categories.some((c) => prefs.show[c as WatchCat] !== false)) continue
    if (cat !== 'all' && !x.categories.includes(cat)) continue

    // the chosen window applies to every row, official press too (the 60-day press retention is storage, not "last 24 hours");
    // a row without a date counts from when it was first found
    if (olderThan(x, now, now - mediaMinTime)) continue

    const score = hasQuery ? matchQueryScore(x, q) : 1
    if (score <= 0) continue

    scored.push({
      item: x,
      score,
      time: sortTimeMs(x),
      fresh: isNew.has(x.key),
    })
  }

  scored.sort((a, b) => {
    if (hasQuery && b.score !== a.score) return b.score - a.score
    if (!hasQuery && a.fresh !== b.fresh) return a.fresh ? -1 : 1
    return b.time - a.time || b.item.foundAt - a.item.foundAt
  })

  return scored.map((s) => s.item)
}
