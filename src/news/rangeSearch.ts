// Copied unchanged from ESB Studio Phone (src/mobile/watch/rangeSearch.ts, 2026-11-06). Keep the two copies in step.
// EnergyWatch for a chosen time range ("1 Nov 9 AM to 3 Nov 4 PM"): every energy and PM & President headline the portals
// published in between.
//
// Portal feeds only reach back a day, so a past range is searched on Google News, one portal at a time, with Google's own
// date operators (site:portal (words) after:YYYY-MM-DD before:YYYY-MM-DD). Tested 2026-11-05: a Prothom Alo search for
// 1 Nov returned 1 Nov stories only. Google returns at most 100 stories per search, so a search that comes back full is split
// (first the days in half, then the words in half) until each part fits: nothing is cut off silently.
// The words only narrow the search; every story still goes through EnergyWatch's matcher, and only stories published inside
// the exact range (to the minute) are kept. Headlines this phone already collected in the range are added (with their
// direct links). Google links are encoded, so stories found only this way open in the browser.
import { create } from 'zustand'
import { buildMatcher } from './matcher'
import { EW_FEEDS } from './ewSources'
import { parseFeed, parseDate } from './feedparse'
import { fetchText, isPhoneFeed, keywordsFor, norm, unwrapLink, useWatch, type WatchItem, type WatchPrefs } from './watchStore'

export const MAX_RANGE_DAYS = 7
const CAP = 100
const CONCURRENCY = 6

const BN_ENERGY = ['বিদ্যুৎ', 'বিদ্যুতের', 'গ্যাস', 'জ্বালানি', 'এলএনজি', 'এলপিজি', 'লোডশেডিং', 'পেট্রোবাংলা', 'তেল', 'সৌরবিদ্যুৎ', 'কয়লা', 'বিপিসি']
const BN_LEAD = ['প্রধানমন্ত্রী', 'রাষ্ট্রপতি']
const EN_ENERGY = ['electricity', 'power', 'energy', 'gas', 'LNG', 'LPG', 'fuel', '"load shedding"', 'Petrobangla', 'BPDB', 'solar', 'coal', 'oil']
const EN_LEAD = ['"Prime Minister"', 'PM', 'President']

/** Each portal's site(s) for a site: search: from its Google News feed, else from its own feed's address. */
export function portalSites(): { name: string; sites: string[]; lang: 'bn' | 'en' | 'both' }[] {
  const by = new Map<string, { sites: Set<string>; langs: Set<string> }>()
  for (const f of EW_FEEDS) {
    if (!isPhoneFeed(f)) continue
    const e = by.get(f.name) ?? { sites: new Set<string>(), langs: new Set<string>() }
    by.set(f.name, e)
    try {
      const u = new URL(f.url)
      if (/news\.google\./.test(u.hostname)) {
        const site = (u.searchParams.get('q') ?? '').match(/site:(\S+)/)?.[1]
        if (site) e.sites.add(site.replace(/^www\./, ''))
        const hl = u.searchParams.get('hl')
        if (hl) e.langs.add(hl.startsWith('bn') ? 'bn' : 'en')
      } else e.sites.add(u.hostname.replace(/^www\./, ''))
    } catch { /* skip */ }
  }
  return [...by].map(([name, e]) => {
    // prothomalo.com covers en.prothomalo.com: keep the shortest of nested sites
    const sites = [...e.sites].filter((s, _, all) => !all.some((o) => o !== s && (s.endsWith('.' + o) || (s.startsWith(o + '/') ))))
    const lang = e.langs.size === 1 ? ([...e.langs][0] as 'bn' | 'en') : 'both'
    return { name, sites, lang }
  })
}

const ymd = (t: number) => new Date(t).toISOString().slice(0, 10)
const DAY = 86400_000

interface Job { site: string; portal: string; lang: 'bn' | 'en'; words: string[]; from: number; to: number }
const gnUrl = (j: Job) => {
  const q = `site:${j.site} (${j.words.join(' OR ')}) after:${ymd(j.from)} before:${ymd(j.to + DAY)}`
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}` + (j.lang === 'bn' ? '&hl=bn&gl=BD&ceid=BD:bn' : '&hl=en&gl=BD&ceid=BD:en')
}

export interface RangeState {
  from: number
  to: number
  running: boolean
  done: number
  total: number
  failed: number
  items: WatchItem[]
  /** searches that stayed full even after splitting (some stories may be missing) */
  capped: number
}

interface RangeStore {
  range: RangeState | null
  search: (from: number, to: number) => Promise<void>
  clear: () => void
}

let runId = 0

export const useRange = create<RangeStore>((set) => ({
  range: null,
  clear: () => { runId++; set({ range: null }) },
  search: async (from, to) => {
    const id = ++runId
    const prefs: WatchPrefs = useWatch.getState().prefs
    const match = buildMatcher(keywordsFor(prefs))
    const off = new Set(prefs.portalsOff)
    const extra = prefs.keep.map((w) => (/\s/.test(w) ? `"${w}"` : w))
    // Google's dates are whole days: search from the day before (time zones) to the end day, then keep the exact minutes
    const qFrom = Date.UTC(new Date(from).getUTCFullYear(), new Date(from).getUTCMonth(), new Date(from).getUTCDate()) - DAY
    const qTo = Date.UTC(new Date(to).getUTCFullYear(), new Date(to).getUTCMonth(), new Date(to).getUTCDate())
    const queue: Job[] = []
    for (const p of portalSites()) {
      if (off.has(p.name)) continue
      const langs: ('bn' | 'en')[] = p.lang === 'both' ? ['bn', 'en'] : [p.lang]
      for (const site of p.sites) for (const lang of langs) {
        const energy = [...(lang === 'bn' ? BN_ENERGY : EN_ENERGY), ...extra]
        if (prefs.show.energy) queue.push({ site, portal: p.name, lang, words: energy, from: qFrom, to: qTo })
        if (prefs.show.leadership) queue.push({ site, portal: p.name, lang, words: lang === 'bn' ? BN_LEAD : EN_LEAD, from: qFrom, to: qTo })
      }
    }
    const st: RangeState = { from, to, running: true, done: 0, total: queue.length, failed: 0, items: [], capped: 0 }
    set({ range: { ...st } })
    const found = new Map<string, WatchItem>()
    const now = Date.now()
    const add = (x: WatchItem) => {
      const twin = x.source + '\n' + norm(x.title)
      const had = found.get(twin)
      if (!had || (had.google && !x.google)) found.set(twin, had ? { ...had, link: x.link, google: x.google } : x)
    }
    // what this phone already collected in the range
    for (const x of useWatch.getState().items) {
      const t = x.published ? Date.parse(x.published) : x.foundAt
      if (t >= from && t <= to && !off.has(x.source)) add(x)
    }
    const publish = () => { if (id === runId) set({ range: { ...st, items: [...found.values()].sort((a, b) => (b.published || '').localeCompare(a.published || '')) } }) }
    publish()

    let i = 0
    const worker = async () => {
      while (i < queue.length) {
        if (id !== runId) return
        const j = queue[i++]
        try {
          const list = parseFeed(await fetchText(gnUrl(j)))
          if (list.length >= CAP) {
            // full: split the days, or (one day) the words, and search the parts instead
            if (j.to > j.from) {
              const mid = j.from + Math.floor((j.to - j.from) / DAY / 2) * DAY
              queue.push({ ...j, to: mid }, { ...j, from: mid + DAY })
              st.total += 2; st.done++; continue
            }
            if (j.words.length > 1) {
              const h = Math.ceil(j.words.length / 2)
              queue.push({ ...j, words: j.words.slice(0, h) }, { ...j, words: j.words.slice(h) })
              st.total += 2; st.done++; continue
            }
            st.capped++
          }
          for (const it of list) {
            const published = parseDate(it.date)
            if (!published) continue
            const t = Date.parse(published)
            if (t < from || t > to) continue
            const m = match(it.title)
            if (!m) continue
            const { link, google } = unwrapLink(it.link || '')
            add({ key: it.key, title: it.title, link, google, source: j.portal, feedId: -1, published, foundAt: now, categories: m.categories, matched: m.matched })
          }
        } catch {
          st.failed++
        }
        st.done++
        publish()
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    if (id !== runId) return
    st.running = false
    publish()
  },
}))

/** A range the editor can search: both ends set, from before to, at most a week, not in the future. */
export function checkRange(from: number, to: number): string | null {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 'Pick both a start and an end.'
  if (to <= from) return 'The end must be after the start.'
  if (to - from > MAX_RANGE_DAYS * DAY) return `Pick ${MAX_RANGE_DAYS} days or less.`
  if (from > Date.now()) return 'The start is in the future.'
  return null
}

export const _test = { gnUrl }
