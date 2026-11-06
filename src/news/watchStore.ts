// EnergyWatch on the desktop: the office watcher's news part, run by ESB AI Studio itself. Copied from ESB Studio Phone
// (src/mobile/watch/watchStore.ts, 2026-11-06), which ported it from EnergyWatch's src/watcher.js (Yeasin Fiyaz).
// Read every portal's feed, keep headlines the matcher accepts and that are recent (24 h by default), skip what was
// already seen. Differences from the phone copy, and only these:
//   - Feeds are fetched through the desktop bridge (window.esb.fetchUrl → electron/net-guard.cjs), as the Wire does: the
//     renderer's own fetch would hit CORS. At most 6 at a time, the main process's own limit (MAX_FETCHES).
//   - Its data lives under esb-banner-studio/news/... (the phone keeps its own under esb-phone/watch/...).
//   - A check is shown live: headlines are merged into the list as each portal answers (at most every 250 ms), and
//     `progress` counts the feeds read, so the desk fills while the check runs instead of all at once at the end.
//   - Every feed EnergyWatch has switched on is read, Bing News included (77 feeds from 53 portals): Bing answers this
//     computer with RSS (checked 2026-11-06), it only sent the phone a web page. Bing's click-through links are unpacked
//     to the article's own address, so its stories can start a story like a portal's own feed.
// Google News links are encoded and open in the browser; a portal's own copy of the same story wins.
// Tenders, press releases and research stay on the office server (they need a computer that is always on).
import { create } from 'zustand'
import { buildMatcher, type EwKeyword } from './matcher'
import { EW_FEEDS, EW_KEYWORDS } from './ewSources'
import { parseFeed, parseDate } from './feedparse'

export type WatchCat = 'energy' | 'leadership'
export interface WatchItem {
  key: string
  title: string
  link: string
  /** true when the only link is an encoded Google News one (opens in the browser) */
  google: boolean
  source: string
  feedId: number
  published: string | null
  foundAt: number
  categories: string[]
  matched: string[]
}
export interface FeedState { ok: boolean; at: number; count: number; error?: string }
export interface WatchPrefs {
  /** portal names switched off on this computer */
  portalsOff: string[]
  /** extra "always keep" words (energy news) */
  keep: string[]
  /** extra "never show" words */
  never: string[]
  show: Record<WatchCat, boolean>
  maxAgeH: number
  /** minutes between automatic checks while the News desk is open; 0 = only Check now */
  autoMin: number
}

export const DEFAULT_PREFS: WatchPrefs = { portalsOff: [], keep: [], never: [], show: { energy: true, leadership: true }, maxAgeH: 24, autoMin: 10 }
const PREFS_KEY = 'esb-banner-studio/news/prefs/v1'
const DATA_KEY = 'esb-banner-studio/news/data/v1'
const ITEM_CAP = 2500 // about a week of matched headlines: what a date range can reuse
const CONCURRENCY = 6
const TIMEOUT_MS = 20000

const load = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? { ...d, ...JSON.parse(v) } : d } catch { return d } }
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* storage full: the list is rebuilt on the next check */ } }

/** A feed this computer reads: every one EnergyWatch has switched on, Bing News included (see the header). The name is
 *  the phone's, kept so the copied modules (rangeSearch) stay in step with it. */
export const isPhoneFeed = (f: { on: boolean; url: string }) => {
  if (!f.on) return false
  try { return /^https?:$/.test(new URL(f.url).protocol) } catch { return false }
}
/** How many feeds are read (77 with EnergyWatch's list): the count EnergyWatch itself shows. */
export const FEED_COUNT = EW_FEEDS.filter((f) => isPhoneFeed(f)).length

/** Every portal (feeds grouped by name), in EnergyWatch's order. */
export const PORTALS: { name: string; feeds: number }[] = (() => {
  const m = new Map<string, number>()
  for (const f of EW_FEEDS) if (isPhoneFeed(f)) m.set(f.name, (m.get(f.name) ?? 0) + 1)
  return [...m].map(([name, feeds]) => ({ name, feeds }))
})()

/** Bing's click-through link carries the article address in its url parameter. */
export function unwrapLink(link: string): { link: string; google: boolean } {
  try {
    const u = new URL(link)
    if (/(^|\.)bing\.com$/i.test(u.hostname) && /apiclick/i.test(u.pathname)) {
      const real = u.searchParams.get('url')
      if (real && /^https?:\/\//i.test(real)) return { link: real, google: false }
    }
    if (/(^|\.)news\.google\.com$/i.test(u.hostname)) return { link, google: true }
  } catch { /* not a URL: kept as it is */ }
  return { link, google: false }
}

export const norm = (t: string) => t.toLowerCase().replace(/[\s"'‘’“”()[\],:;.!?–—|-]+/g, ' ').trim()

export function keywordsFor(p: WatchPrefs): EwKeyword[] {
  return [
    ...EW_KEYWORDS,
    ...p.keep.map((term) => ({ term, kind: 'strong', category: 'energy' })),
    ...p.never.map((term) => ({ term, kind: 'block', category: null })),
  ]
}

export async function fetchText(url: string): Promise<string> {
  const esb = typeof window !== 'undefined' ? window.esb : undefined
  if (!esb?.fetchUrl) throw new Error('Feeds are fetched by the desktop app')
  let last: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await esb.fetchUrl(url, { timeoutMs: TIMEOUT_MS })
      if (!res.ok) {
        const e = new Error(res.error || res.code || 'Feed did not answer')
        // a 4xx or a refused content type will not change on a retry; timeouts and 5xx might
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
  /** newest foundAt the editor has looked at: rows found after it are marked new */
  seenAt: number
  /** headlines the latest refresh added (empty after the very first check): they carry the NEW tag until the next refresh */
  newKeys: string[]
  running: boolean
  /** portals read so far in the running check (null when no check runs) */
  progress: { done: number; total: number } | null
  setPrefs: (p: Partial<WatchPrefs>) => void
  resetPrefs: () => void
  hide: (key: string) => void
  unhide: (key: string) => void
  markSeen: () => void
  markRead: (key: string) => void
  markAllRead: () => void
  run: () => Promise<{ checked: number; added: number; failed: number } | null>
}

const initial = load(DATA_KEY, { items: [] as WatchItem[], hidden: [] as string[], feeds: {} as Record<number, FeedState>, lastRun: null as number | null, seenAt: 0, newKeys: [] as string[] })

export const useWatch = create<WatchState>((set, get) => {
  const persist = () => { const s = get(); save(DATA_KEY, { items: s.items, hidden: s.hidden, feeds: s.feeds, lastRun: s.lastRun, seenAt: s.seenAt, newKeys: s.newKeys }) }
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
    markSeen: () => { const top = get().items.reduce((m, x) => Math.max(m, x.foundAt), 0); if (top > get().seenAt) { set({ seenAt: top }); persist() } },
    run: async () => {
      if (get().running) return null
      set({ running: true })
      const started = Date.now()
      const { prefs } = get()
      const match = buildMatcher(keywordsFor(prefs))
      const off = new Set(prefs.portalsOff)
      const feeds = EW_FEEDS.filter((f) => isPhoneFeed(f) && !off.has(f.name))
      const maxAge = prefs.maxAgeH * 3600_000
      const states: Record<number, FeedState> = { ...get().feeds }
      const found: WatchItem[] = []
      let failed = 0
      const prev = get().items
      let done = 0
      let flushAt = 0
      let timer: ReturnType<typeof setTimeout> | null = null
      // the list as it stands with what has come in so far; the first check of all marks nothing new
      const publish = () => {
        timer = null
        flushAt = Date.now()
        const m = mergeFound(prev, found, started)
        set({ items: m.items, feeds: { ...states }, newKeys: prev.length ? m.addedKeys : [], progress: { done, total: feeds.length } })
      }
      const soon = () => { if (!timer) timer = setTimeout(publish, Math.max(0, 250 - (Date.now() - flushAt))) }
      set({ progress: { done: 0, total: feeds.length } })
      await pool(feeds, CONCURRENCY, async (f) => {
        try {
          const list = parseFeed(await fetchText(f.url))
          states[f.id] = { ok: true, at: Date.now(), count: list.length }
          for (const it of list) {
            const published = parseDate(it.date)
            if (published && started - Date.parse(published) > maxAge) continue
            const m = match(it.title)
            if (!m) continue
            const { link, google } = unwrapLink(it.link || '')
            if (!/^https?:\/\//i.test(link)) continue
            found.push({ key: it.key, title: it.title, link, google, source: f.name, feedId: f.id, published, foundAt: started, categories: m.categories, matched: m.matched })
          }
        } catch (e) {
          failed++
          states[f.id] = { ok: false, at: Date.now(), count: 0, error: e instanceof Error ? e.message : String(e) }
        }
        done++
        soon()
      })
      if (timer) clearTimeout(timer)
      const { items, addedKeys } = mergeFound(prev, found, started)
      const added = addedKeys.length
      set({ items, feeds: states, lastRun: started, running: false, progress: null, seenAt: prev.length ? get().seenAt : started, newKeys: prev.length ? addedKeys : [] })
      persist()
      return { checked: feeds.length, added, failed }
    },
  }
})

/** Merge a check's finds into the list: one row per headline per portal (a direct link beats a Google one for the same
 *  story), a week kept, newest first. `addedKeys` = rows that were not in `prev`. */
export function mergeFound(prev: WatchItem[], found: WatchItem[], started: number): { items: WatchItem[]; addedKeys: string[] } {
  const byTwin = new Map<string, WatchItem>()
  const keys = new Set<string>()
  for (const x of prev) { byTwin.set(x.source + '\n' + norm(x.title), x); keys.add(x.key) }
  const addedKeys: string[] = []
  for (const x of [...found].sort((a, b) => (a.published || '').localeCompare(b.published || ''))) {
    const twin = x.source + '\n' + norm(x.title)
    const had = byTwin.get(twin)
    if (had) {
      if (had.google && !x.google) byTwin.set(twin, { ...had, link: x.link, google: false })
      continue
    }
    if (keys.has(x.key)) continue
    keys.add(x.key)
    byTwin.set(twin, x)
    addedKeys.push(x.key)
  }
  const cutoff = started - 7 * 24 * 3600_000
  const items = [...byTwin.values()]
    .filter((x) => (x.published ? Date.parse(x.published) : x.foundAt) >= cutoff)
    .sort((a, b) => (b.published || '').localeCompare(a.published || '') || b.foundAt - a.foundAt)
    .slice(0, ITEM_CAP)
  return { items, addedKeys }
}

/** Rows to show: the kinds switched on, not hidden, and (optionally) a search and a category filter. */
export function visibleItems(items: WatchItem[], hidden: string[], prefs: WatchPrefs, q: string, cat: 'all' | WatchCat): WatchItem[] {
  const h = new Set(hidden)
  const needle = q.trim().toLowerCase()
  const maxAge = Date.now() - prefs.maxAgeH * 3600_000
  return items.filter((x) =>
    !h.has(x.key) &&
    !prefs.portalsOff.includes(x.source) &&
    x.categories.some((c) => prefs.show[c as WatchCat] !== false) &&
    (cat === 'all' || x.categories.includes(cat)) &&
    (!x.published || Date.parse(x.published) >= maxAge) &&
    (!needle || x.title.toLowerCase().includes(needle) || x.source.toLowerCase().includes(needle)))
}
