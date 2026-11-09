// News engine (shared, identical in ESB Studio PC src/news and ESB Studio Phone src/mobile/watch; tools/sync-pc.mjs news).
// One row per story. A story reaches the list through several doors: a portal's own feed and its Google News feed, two of
// its section feeds, a Bing click-through, a tracking-tagged link. Rows are merged when they are
//   - the same address once tracking, www., trailing slashes and click-through wrappers are removed (any feed), or
//   - the same portal and a near-identical headline (a portal edits "…" to "…, says minister" between two feeds).
// A direct link beats an encoded Google News one; categories and matched words are united; a known date beats none.
import { itemTimeMs } from './dates'

export interface DedupeItem {
  key: string
  title: string
  link: string
  google: boolean
  source: string
  published: string | null
  foundAt: number
  categories: string[]
  matched: string[]
}

export const norm = (t: string) => t.normalize('NFC').toLowerCase().replace(/[\s"'‘’“”()[\],:;.!?–—|-]+/g, ' ').trim()

/** The target of a feed click-through (Bing apiclick, Google /url), or the address as it is. */
export function redirectTarget(rawUrl: string): string {
  try {
    const u = new URL(rawUrl)
    if (/(^|\.)bing\.com$/i.test(u.hostname) && /apiclick/i.test(u.pathname)) {
      const target = u.searchParams.get('url')
      if (target && /^https?:\/\//i.test(target)) return target
    }
    if (/(^|\.)google\.[a-z.]+$/i.test(u.hostname) && u.pathname === '/url') {
      const target = u.searchParams.get('q') || u.searchParams.get('url')
      if (target && /^https?:\/\//i.test(target)) return target
    }
  } catch { /* not a URL */ }
  return rawUrl
}

const TRACKING = /^(?:utm_|fbclid$|gclid$|oc$|ref$|ref_src$|aid$|tid$|mkt$|c$|amp$|from$|share$)/i

/** A URL as a matching key: no scheme, www., hash, tracking parameters, trailing slash or /amp suffix; host lower-cased. */
export function normUrlKey(raw: string | null | undefined): string {
  if (!raw) return ''
  try {
    const u = new URL(redirectTarget(raw.trim()))
    const host = u.hostname.toLowerCase().replace(/^(?:www|m|amp)\./, '')
    const path = u.pathname.replace(/\/amp\/?$/i, '').replace(/\/+$/, '') || '/'
    const kept = new URLSearchParams()
    for (const [k, v] of u.searchParams.entries()) if (!TRACKING.test(k)) kept.append(k, v)
    kept.sort()
    const qs = kept.toString()
    return `${host}${path}${qs ? '?' + qs : ''}`
  } catch {
    return raw.trim().toLowerCase()
  }
}

const tokens = (title: string) => new Set(norm(title).split(' ').filter(Boolean))

/** Same headline give or take a word or two: at least four words, 85 % shared both ways round. */
export function nearSameTitle(a: string, b: string): boolean {
  const x = tokens(a)
  const y = tokens(b)
  const small = Math.min(x.size, y.size)
  if (small < 4) return norm(a) === norm(b)
  let shared = 0
  for (const w of x) if (y.has(w)) shared++
  return shared / small >= 0.9 && shared / Math.max(x.size, y.size) >= 0.8
}

export interface MergeOptions {
  /** keys the editor hid: never added again */
  hidden?: Iterable<string>
  /** most rows kept (newest first) */
  itemCap?: number
  /** media rows older than this are dropped (default 7 days) */
  mediaRetentionMs?: number
  /** official press rows older than this are dropped (default 60 days) */
  pressRetentionMs?: number
}

export const ITEM_CAP = 2800
export const MEDIA_RETENTION_MS = 7 * 24 * 3600_000
export const PRESS_RETENTION_MS = 60 * 24 * 3600_000

function combine<T extends DedupeItem>(had: T, x: T): T {
  return {
    ...had,
    link: had.google && !x.google ? x.link : had.link,
    google: had.google && x.google,
    published: had.published ?? x.published,
    categories: [...new Set([...had.categories, ...x.categories])].sort(),
    matched: [...new Set([...had.matched, ...x.matched])],
  }
}

/**
 * Merge a check's finds into the list: one row per story (see the top of this file), the editor's hidden rows left out,
 * old rows dropped, newest first. Pure and repeatable: run it on a growing `found` while a check is still reading.
 */
export function mergeFound<T extends DedupeItem>(prev: T[], found: T[], started: number, opts: MergeOptions = {}): { items: T[]; addedKeys: string[] } {
  const hidden = new Set(opts.hidden ?? [])
  const rows = new Map<string, T>() // key -> row
  const byTwin = new Map<string, string>() // source + title -> key
  const byUrl = new Map<string, string>() // normalised link -> key
  const bySource = new Map<string, string[]>() // source -> keys, for near-identical titles
  const index = (x: T) => {
    rows.set(x.key, x)
    byTwin.set(x.source + '\n' + norm(x.title), x.key)
    const u = normUrlKey(x.link)
    if (u && !byUrl.has(u)) byUrl.set(u, x.key)
    const list = bySource.get(x.source) ?? []
    list.push(x.key)
    bySource.set(x.source, list)
  }
  for (const x of prev) if (!hidden.has(x.key)) index(x)

  const addedKeys: string[] = []
  const order = [...found].sort((a, b) => itemTimeMs(a) - itemTimeMs(b))
  for (const x of order) {
    if (hidden.has(x.key)) continue
    const u = normUrlKey(x.link)
    let twinKey = byTwin.get(x.source + '\n' + norm(x.title)) ?? (u ? byUrl.get(u) : undefined) ?? (rows.has(x.key) ? x.key : undefined)
    if (!twinKey) twinKey = (bySource.get(x.source) ?? []).find((k) => nearSameTitle(rows.get(k)!.title, x.title))
    if (twinKey) {
      const had = rows.get(twinKey)!
      const merged = combine(had, x)
      rows.set(twinKey, merged)
      if (u && !byUrl.has(u)) byUrl.set(u, twinKey)
      continue
    }
    index(x)
    addedKeys.push(x.key)
  }

  const mediaCutoff = started - (opts.mediaRetentionMs ?? MEDIA_RETENTION_MS)
  const pressCutoff = started - (opts.pressRetentionMs ?? PRESS_RETENTION_MS)
  const items = [...rows.values()]
    .filter((x) => itemTimeMs(x) >= (x.categories.includes('press') ? pressCutoff : mediaCutoff))
    .sort((a, b) => itemTimeMs(b) - itemTimeMs(a) || b.foundAt - a.foundAt)
    .slice(0, opts.itemCap ?? ITEM_CAP)
  const kept = new Set(items.map((x) => x.key))
  return { items, addedKeys: addedKeys.filter((k) => kept.has(k)) }
}
