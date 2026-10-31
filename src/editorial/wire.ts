// The Wire desk: inbound story discovery. An editor keeps a short list of feeds (RSS 2.0, Atom or a news sitemap);
// each is polled through the desktop app's guarded fetch (window.esb.fetchUrl → electron/net-guard.cjs, which already
// accepts the XML feed content types), parsed here with the renderer's DOMParser, deduplicated against what the inbox
// already holds by normalized-title similarity (a pure function — no AI), and listed so one click hands a link to the
// existing URL intake. Feed text is data, never markup: titles are reduced to plain text, links must be http(s).
//
// Everything stays on this machine (localStorage, two keys below). Nothing is fetched unless a source is due.

import { create } from 'zustand'
import { bengaliToAsciiDigits } from './bengali'
import type { EsbFetchUrlResult } from '../esb'

export type WireKind = 'rss' | 'atom' | 'sitemap' | 'auto'

export interface WireError {
  /** net-guard's code (private_address, timeout, bad_type, http_error…) or one of ours (malformed, not_feed, no_bridge). */
  code: string
  message: string
}

export interface WireSource {
  id: string
  url: string
  name: string
  kind: WireKind
  /** Minutes between polls, MIN_INTERVAL…MAX_INTERVAL. */
  intervalMin: number
  enabled: boolean
  lastFetchedAt: number | null
  lastOkAt: number | null
  /** Consecutive failed polls; 0 after any success. */
  failures: number
  /** Epoch ms when the source is next due. 0 = due now. */
  nextAt: number
  lastError: WireError | null
}

export interface FeedItem {
  title: string
  /** Absolute http(s) URL. */
  link: string
  /** ISO 8601, or null when the feed gave no usable date. */
  date: string | null
  /** The feed's own title (or the source URL's host when it has none). */
  source: string
}

export interface WireItem extends FeedItem {
  /** The link is the identity: dismissing hides that link for good. */
  id: string
  sourceId: string
  fetchedAt: number
}

export type ParseResult =
  | { items: FeedItem[]; kind: Exclude<WireKind, 'auto'>; error?: undefined }
  | { items: []; kind?: undefined; error: WireError }

export const SOURCES_KEY = 'esb-banner-studio/wire/sources/v1'
export const INBOX_KEY = 'esb-banner-studio/wire/inbox/v1'
export const MIN_INTERVAL = 15
export const MAX_INTERVAL = 360
export const DEFAULT_INTERVAL = 30
export const BACKOFF_CAP_MS = 6 * 60 * 60 * 1000
export const INBOX_CAP = 300
export const DISMISSED_CAP = 2000
export const MAX_ITEMS_PER_FEED = 200
export const MAX_SOURCES = 40
export const CHECK_EVERY_MS = 60 * 1000
const MIN_MS = 60 * 1000

// ---------------------------------------------------------------- parsing (pure apart from DOMParser)

const kids = (el: Element, name: string): Element[] => Array.from(el.children).filter((c) => c.localName === name)
const kid = (el: Element, ...names: string[]): Element | null => {
  for (const n of names) { const k = kids(el, n)[0]; if (k) return k }
  return null
}
const txt = (el: Element | null): string => (el?.textContent ?? '').trim()

/** Plain text from a feed string that may hold escaped or CDATA-wrapped HTML. Never returns markup. */
export function plainText(raw: string): string {
  let s = raw
  if (/[<&]/.test(s)) {
    if (typeof DOMParser !== 'undefined') {
      // an inert HTML document: nothing in it runs or loads, and only its text is read
      s = new DOMParser().parseFromString(`<!doctype html><body>${s}`, 'text/html').body.textContent ?? ''
    } else {
      s = s.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    }
  }
  return s.replace(/\s+/g, ' ').trim()
}

/** An absolute http(s) URL, or null. */
export function absoluteLink(raw: string, base: string): string | null {
  const s = raw.trim()
  if (!s) return null
  try {
    const u = new URL(s, base)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    u.hash = ''
    return u.href
  } catch { return null }
}

export function isoDate(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }

/** A readable title from a sitemap URL that carries none: the last path segment, dashes to spaces. */
function titleFromUrl(url: string): string {
  try {
    const seg = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '')
    const words = seg.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[-_+]+/g, ' ').trim()
    return words ? words[0].toUpperCase() + words.slice(1) : hostOf(url)
  } catch { return url }
}

/** The base relative links resolve against: xml:base up the tree, else the fallback. */
function baseFor(el: Element, fallback: string): string {
  const chain: string[] = []
  for (let n: Element | null = el; n; n = n.parentElement) {
    const b = n.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'base') ?? n.getAttribute('xml:base')
    if (b) chain.unshift(b)
  }
  let base = fallback
  for (const b of chain) { try { base = new URL(b, base).href } catch { /* keep */ } }
  return base
}

/**
 * Parse RSS 2.0 (and RSS 1.0/RDF), Atom 1.0 or a sitemap `urlset` into plain items. Never throws: malformed or
 * unrecognised input returns `{ items: [], error }`.
 */
export function parseFeed(xml: string, sourceUrl: string): ParseResult {
  if (typeof xml !== 'string' || !xml.trim()) return { items: [], error: { code: 'empty', message: 'The feed was empty.' } }
  if (typeof DOMParser === 'undefined') return { items: [], error: { code: 'no_parser', message: 'No XML parser available.' } }
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(xml.replace(/^﻿/, ''), 'application/xml')
  } catch (e) {
    return { items: [], error: { code: 'malformed', message: `Not well-formed XML: ${String((e as Error)?.message ?? e)}` } }
  }
  const perr = doc.getElementsByTagName('parsererror')[0]
  if (perr) {
    const detail = plainText(perr.textContent ?? '').slice(0, 160)
    return { items: [], error: { code: 'malformed', message: `Not well-formed XML${detail ? `: ${detail}` : '.'}` } }
  }
  const root = doc.documentElement
  if (!root) return { items: [], error: { code: 'malformed', message: 'Not well-formed XML.' } }
  try {
    const name = root.localName
    if (name === 'rss' || name === 'RDF') return parseRss(root, sourceUrl)
    if (name === 'feed') return parseAtom(root, sourceUrl)
    if (name === 'urlset') return parseSitemap(root, sourceUrl)
    if (name === 'sitemapindex') return { items: [], error: { code: 'not_feed', message: 'This is a sitemap index. Add one of the sitemaps it lists instead.' } }
    if (name === 'html') return { items: [], error: { code: 'not_feed', message: 'This address returned a web page, not a feed.' } }
    return { items: [], error: { code: 'not_feed', message: `Not an RSS, Atom or sitemap document (root <${name.slice(0, 40)}>).` } }
  } catch (e) {
    return { items: [], error: { code: 'malformed', message: `Could not read the feed: ${String((e as Error)?.message ?? e)}` } }
  }
}

function finish(raw: { title: string; link: string | null; date: string | null }[], source: string): FeedItem[] {
  const seen = new Set<string>()
  const out: FeedItem[] = []
  for (const r of raw) {
    if (!r.link || !r.title || seen.has(r.link)) continue
    seen.add(r.link)
    out.push({ title: r.title.slice(0, 400), link: r.link, date: r.date, source })
    if (out.length >= MAX_ITEMS_PER_FEED) break
  }
  return out
}

function parseRss(root: Element, sourceUrl: string): ParseResult {
  const channel = kid(root, 'channel') ?? root
  const chLink = absoluteLink(txt(kid(channel, 'link')), sourceUrl)
  const base = chLink ?? sourceUrl
  const source = plainText(txt(kid(channel, 'title'))) || hostOf(sourceUrl)
  // RSS 2.0 keeps items in <channel>; RSS 1.0 keeps them beside it
  const items = [...kids(channel, 'item'), ...(channel === root ? [] : kids(root, 'item'))]
  const raw = items.map((it) => {
    const guid = kid(it, 'guid')
    const guidLink = guid && guid.getAttribute('isPermaLink') !== 'false' ? txt(guid) : ''
    const linkEl = kids(it, 'link').find((l) => !l.getAttribute('rel') || l.getAttribute('rel') === 'alternate')
    const link = absoluteLink(txt(linkEl ?? null) || linkEl?.getAttribute('href') || guidLink, baseFor(it, base))
    return {
      title: plainText(txt(kid(it, 'title'))),
      link,
      date: isoDate(txt(kid(it, 'pubDate', 'date', 'published', 'updated'))),
    }
  })
  return { items: finish(raw, source), kind: 'rss' }
}

function parseAtom(root: Element, sourceUrl: string): ParseResult {
  const source = plainText(txt(kid(root, 'title'))) || hostOf(sourceUrl)
  const raw = kids(root, 'entry').map((en) => {
    const links = kids(en, 'link')
    const pick = links.find((l) => (l.getAttribute('rel') ?? 'alternate') === 'alternate') ?? links.find((l) => l.getAttribute('rel') !== 'enclosure' && l.getAttribute('rel') !== 'self')
    return {
      title: plainText(txt(kid(en, 'title'))),
      link: pick ? absoluteLink(pick.getAttribute('href') ?? '', baseFor(pick, sourceUrl)) : null,
      date: isoDate(txt(kid(en, 'published'))) ?? isoDate(txt(kid(en, 'updated'))),
    }
  })
  return { items: finish(raw, source), kind: 'atom' }
}

function parseSitemap(root: Element, sourceUrl: string): ParseResult {
  const source = hostOf(sourceUrl)
  const raw = kids(root, 'url').map((u) => {
    const link = absoluteLink(txt(kid(u, 'loc')), sourceUrl)
    const news = kid(u, 'news')
    const newsTitle = news ? plainText(txt(kid(news, 'title'))) : ''
    const date = (news && isoDate(txt(kid(news, 'publication_date')))) || isoDate(txt(kid(u, 'lastmod')))
    return { title: newsTitle || (link ? titleFromUrl(link) : ''), link, date }
  })
  return { items: finish(raw, source), kind: 'sitemap' }
}

// ---------------------------------------------------------------- dedupe (pure)

/** Lower-case, Bengali digits to ASCII, punctuation and symbols to spaces, whitespace collapsed. */
export function normalizeTitle(t: string): string {
  return bengaliToAsciiDigits(String(t ?? '').normalize('NFKC'))
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const tokens = (norm: string) => new Set(norm.split(' ').filter(Boolean))

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

export const SIMILAR_THRESHOLD = 0.8

/** Same story: equal after normalization, or word-set Jaccard ≥ 0.8. Empty titles are never similar. */
export function similar(a: string, b: string): boolean {
  const na = normalizeTitle(a)
  const nb = normalizeTitle(b)
  if (!na || !nb) return false
  if (na === nb) return true
  return jaccard(tokens(na), tokens(nb)) >= SIMILAR_THRESHOLD
}

/**
 * The incoming items that are new: not the same link as, and not a similar title to, anything in `existing` or an
 * earlier incoming item. Order is kept.
 */
export function dedupe<T extends { title: string; link: string }>(items: T[], existing: { title: string; link: string }[]): T[] {
  const links = new Set(existing.map((e) => e.link))
  const known = existing.map((e) => normalizeTitle(e.title)).filter(Boolean).map((n) => ({ n, t: tokens(n) }))
  const out: T[] = []
  for (const it of items) {
    if (links.has(it.link)) continue
    const n = normalizeTitle(it.title)
    if (!n) continue
    const t = tokens(n)
    if (known.some((k) => k.n === n || jaccard(k.t, t) >= SIMILAR_THRESHOLD)) continue
    links.add(it.link)
    known.push({ n, t })
    out.push(it)
  }
  return out
}

// ---------------------------------------------------------------- schedule (pure)

export const clampInterval = (m: number) => Math.round(Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, Number.isFinite(m) ? m : DEFAULT_INTERVAL)))

/**
 * When a source is next due. Success: one interval from now. Failure: `source.failures` is the count *including* this
 * failure, so the first failure waits 2 × interval, the second 4 ×, … never more than 6 h.
 */
export function nextDue(source: Pick<WireSource, 'intervalMin' | 'failures'>, now: number, ok: boolean): number {
  const base = clampInterval(source.intervalMin) * MIN_MS
  if (ok) return now + base
  return now + Math.min(BACKOFF_CAP_MS, base * 2 ** Math.max(0, source.failures))
}

/** The source after a poll: counters, error and next due time. */
export function afterPoll(source: WireSource, now: number, error: WireError | null): WireSource {
  if (!error) {
    const s = { ...source, lastFetchedAt: now, lastOkAt: now, failures: 0, lastError: null }
    return { ...s, nextAt: nextDue(s, now, true) }
  }
  const s = { ...source, lastFetchedAt: now, failures: source.failures + 1, lastError: error }
  return { ...s, nextAt: nextDue(s, now, false) }
}

export const isDue = (s: WireSource, now: number) => s.enabled && s.nextAt <= now

// ---------------------------------------------------------------- inbox (pure)

const itemTime = (i: WireItem) => (i.date ? Date.parse(i.date) : NaN) || i.fetchedAt

/** Newest first, at most `cap`. */
export function capInbox(items: WireItem[], cap = INBOX_CAP): WireItem[] {
  return [...items].sort((a, b) => itemTime(b) - itemTime(a)).slice(0, cap)
}

/** Validate a user-typed source URL. Returns the normalized URL or an error message. */
export function checkSourceUrl(raw: string): { url: string } | { error: string } {
  let s = raw.trim()
  if (!s) return { error: 'Enter the feed address.' }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s
  try {
    const u = new URL(s)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'Only http and https addresses can be polled.' }
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return { error: 'That does not look like a web address.' }
    return { url: u.href }
  } catch { return { error: 'That does not look like a web address.' } }
}

// ---------------------------------------------------------------- storage

function readJson<T>(key: string, fallback: T): T {
  try { const v = JSON.parse(localStorage.getItem(key) ?? 'null'); return v ?? fallback } catch { return fallback }
}
function writeJson(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* quota: keep in memory */ } }

const KINDS: WireKind[] = ['rss', 'atom', 'sitemap', 'auto']
function sanitizeSource(x: unknown): WireSource | null {
  if (!x || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  const chk = typeof o.url === 'string' ? checkSourceUrl(o.url) : null
  if (!chk || !('url' in chk) || typeof o.id !== 'string') return null
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const err = o.lastError && typeof o.lastError === 'object' ? (o.lastError as Record<string, unknown>) : null
  return {
    id: o.id,
    url: chk.url,
    name: typeof o.name === 'string' ? o.name.slice(0, 120) : '',
    kind: KINDS.includes(o.kind as WireKind) ? (o.kind as WireKind) : 'auto',
    intervalMin: clampInterval(num(o.intervalMin) ?? DEFAULT_INTERVAL),
    enabled: o.enabled !== false,
    lastFetchedAt: num(o.lastFetchedAt),
    lastOkAt: num(o.lastOkAt),
    failures: Math.max(0, Math.floor(num(o.failures) ?? 0)),
    nextAt: num(o.nextAt) ?? 0,
    lastError: err && typeof err.message === 'string' ? { code: String(err.code ?? 'error'), message: err.message } : null,
  }
}

export function loadSources(): WireSource[] {
  const raw = readJson<unknown>(SOURCES_KEY, [])
  return Array.isArray(raw) ? raw.map(sanitizeSource).filter((s): s is WireSource => !!s).slice(0, MAX_SOURCES) : []
}

export function loadInbox(): { items: WireItem[]; dismissed: string[] } {
  const raw = readJson<{ items?: unknown; dismissed?: unknown }>(INBOX_KEY, {})
  const items = Array.isArray(raw.items)
    ? raw.items.filter((i): i is WireItem => !!i && typeof i === 'object' && typeof (i as WireItem).title === 'string' && typeof (i as WireItem).link === 'string' && !!absoluteLink((i as WireItem).link, 'https://invalid.example/'))
        .map((i) => ({ id: i.link, title: i.title, link: i.link, date: typeof i.date === 'string' ? i.date : null, source: String(i.source ?? ''), sourceId: String(i.sourceId ?? ''), fetchedAt: typeof i.fetchedAt === 'number' ? i.fetchedAt : 0 }))
    : []
  const dismissed = Array.isArray(raw.dismissed) ? raw.dismissed.filter((d): d is string => typeof d === 'string').slice(-DISMISSED_CAP) : []
  return { items: capInbox(items), dismissed }
}

// ---------------------------------------------------------------- polling

export type FetchFn = (url: string) => Promise<EsbFetchUrlResult>

/** The desktop bridge, or a structured error in a plain browser. The default content types already allow XML feeds. */
export const bridgeFetch: FetchFn = async (url) => {
  const esb = typeof window !== 'undefined' ? window.esb : undefined
  if (!esb?.fetchUrl) return { ok: false, code: 'no_bridge', error: 'Feeds are fetched by the desktop app. Open ESB AI Studio to check sources.' }
  return esb.fetchUrl(url, { timeoutMs: 15000 })
}

/** Fetch and parse one source. Never throws. */
export async function pollSource(source: WireSource, fetchFn: FetchFn, now: number): Promise<{ source: WireSource; items: WireItem[] }> {
  let res: EsbFetchUrlResult
  try {
    res = await fetchFn(source.url)
  } catch (e) {
    res = { ok: false, code: 'network_error', error: String((e as Error)?.message ?? e) }
  }
  if (!res || !res.ok) {
    const error = { code: String(res?.code ?? 'error'), message: String(res?.error ?? 'The feed could not be fetched.') }
    return { source: afterPoll(source, now, error), items: [] }
  }
  const body = res.html ?? res.body ?? ''
  const parsed = parseFeed(body, res.url || source.url)
  if (parsed.error) return { source: afterPoll(source, now, parsed.error), items: [] }
  if (source.kind !== 'auto' && parsed.kind !== source.kind) {
    const error = { code: 'wrong_kind', message: `Expected ${source.kind.toUpperCase()} but the address returned ${parsed.kind.toUpperCase()}. Set the kind to Auto or fix the address.` }
    return { source: afterPoll(source, now, error), items: [] }
  }
  const name = source.name.trim() || parsed.items[0]?.source || hostOf(source.url)
  const items = parsed.items.map((i) => ({ ...i, source: name, id: i.link, sourceId: source.id, fetchedAt: now }))
  return { source: afterPoll(source, now, null), items }
}

export interface PollReport {
  polled: number
  ok: number
  failed: number
  added: number
  /** When the earliest enabled source is next due, if any. */
  nextAt: number | null
}

/**
 * Poll every enabled source whose `nextAt ≤ now`, one at a time, and merge new items into the inbox. Pure apart
 * from `fetchFn`: returns the next state for the caller to keep.
 */
export async function pollSources(
  state: { sources: WireSource[]; items: WireItem[]; dismissed: string[] },
  now: number,
  fetchFn: FetchFn,
  onProgress?: (sources: WireSource[]) => void,
): Promise<{ sources: WireSource[]; items: WireItem[]; report: PollReport }> {
  let sources = state.sources
  let items = state.items
  const dismissed = new Set(state.dismissed)
  const report: PollReport = { polled: 0, ok: 0, failed: 0, added: 0, nextAt: null }
  for (const s of state.sources) {
    if (!isDue(s, now)) continue
    const r = await pollSource(s, fetchFn, now)
    report.polled++
    if (r.source.lastError) report.failed++; else report.ok++
    const fresh = dedupe(r.items.filter((i) => !dismissed.has(i.id)), items)
    report.added += fresh.length
    items = capInbox([...fresh, ...items])
    sources = sources.map((x) => (x.id === s.id ? r.source : x))
    onProgress?.(sources)
  }
  const due = sources.filter((s) => s.enabled).map((s) => s.nextAt)
  report.nextAt = due.length ? Math.min(...due) : null
  return { sources, items, report }
}

// ---------------------------------------------------------------- store

const newId = () => 'src-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)

interface WireState {
  sources: WireSource[]
  items: WireItem[]
  dismissed: string[]
  polling: boolean
  lastReport: (PollReport & { at: number }) | null
  addSource: (input: { url: string; name?: string; kind?: WireKind; intervalMin?: number }) => { ok: true; id: string } | { ok: false; error: string }
  updateSource: (id: string, patch: Partial<Pick<WireSource, 'name' | 'kind' | 'intervalMin' | 'enabled' | 'url'>>) => void
  removeSource: (id: string) => void
  dismiss: (id: string) => void
  /** Poll the sources that are due. Resolves to null when a poll is already running. */
  pollDue: (now?: number, fetchFn?: FetchFn) => Promise<PollReport | null>
  reload: () => void
}

export const useWire = create<WireState>((set, get) => {
  const saveSources = (sources: WireSource[]) => { writeJson(SOURCES_KEY, sources); set({ sources }) }
  const saveInbox = (items: WireItem[], dismissed: string[]) => { writeJson(INBOX_KEY, { items, dismissed }); set({ items, dismissed }) }
  const inbox = loadInbox()
  return {
    sources: loadSources(),
    items: inbox.items,
    dismissed: inbox.dismissed,
    polling: false,
    lastReport: null,
    reload: () => { const ib = loadInbox(); set({ sources: loadSources(), items: ib.items, dismissed: ib.dismissed }) },
    addSource: ({ url, name = '', kind = 'auto', intervalMin = DEFAULT_INTERVAL }) => {
      const chk = checkSourceUrl(url)
      if ('error' in chk) return { ok: false, error: chk.error }
      const cur = get().sources
      if (cur.some((s) => s.url === chk.url)) return { ok: false, error: 'That feed is already on the list.' }
      if (cur.length >= MAX_SOURCES) return { ok: false, error: `At most ${MAX_SOURCES} sources.` }
      const id = newId()
      const src: WireSource = { id, url: chk.url, name: name.trim().slice(0, 120), kind, intervalMin: clampInterval(intervalMin), enabled: true, lastFetchedAt: null, lastOkAt: null, failures: 0, nextAt: 0, lastError: null }
      saveSources([...cur, src])
      return { ok: true, id }
    },
    updateSource: (id, patch) => {
      saveSources(get().sources.map((s) => {
        if (s.id !== id) return s
        const n = { ...s, ...patch }
        if (patch.intervalMin !== undefined) {
          n.intervalMin = clampInterval(patch.intervalMin)
          // a shorter interval should not wait out the old, longer one (a source in backoff keeps its backoff)
          if (!s.failures && s.lastFetchedAt) n.nextAt = Math.min(s.nextAt, s.lastFetchedAt + n.intervalMin * MIN_MS)
        }
        if (patch.url !== undefined) {
          const chk = checkSourceUrl(patch.url)
          if ('error' in chk) return s
          if (chk.url !== s.url) Object.assign(n, { url: chk.url, nextAt: 0, failures: 0, lastError: null })
        }
        if (patch.name !== undefined) n.name = patch.name.slice(0, 120)
        return n
      }))
    },
    removeSource: (id) => {
      saveSources(get().sources.filter((s) => s.id !== id))
      saveInbox(get().items.filter((i) => i.sourceId !== id), get().dismissed)
    },
    dismiss: (id) => {
      const d = get().dismissed.includes(id) ? get().dismissed : [...get().dismissed, id].slice(-DISMISSED_CAP)
      saveInbox(get().items.filter((i) => i.id !== id), d)
    },
    pollDue: async (now = Date.now(), fetchFn = bridgeFetch) => {
      if (get().polling) return null
      set({ polling: true })
      try {
        const { sources, items, report } = await pollSources(
          { sources: get().sources, items: get().items, dismissed: get().dismissed },
          now,
          fetchFn,
          (progress) => set({ sources: mergeEdits(get().sources, progress) }),
        )
        // sources edited or removed while the poll ran keep the editor's change; only poll results are merged in
        saveSources(mergeEdits(get().sources, sources))
        const live = new Set(get().sources.map((s) => s.id))
        saveInbox(capInbox(items.filter((i) => live.has(i.sourceId) && !get().dismissed.includes(i.id))), get().dismissed)
        set({ lastReport: { ...report, at: now } })
        return report
      } finally {
        set({ polling: false })
      }
    },
  }
})

/** Take poll-owned fields from `polled` for sources that still exist in `current`. */
function mergeEdits(current: WireSource[], polled: WireSource[]): WireSource[] {
  const byId = new Map(polled.map((p) => [p.id, p]))
  return current.map((c) => {
    const p = byId.get(c.id)
    if (!p || p.url !== c.url) return c
    return { ...c, lastFetchedAt: p.lastFetchedAt, lastOkAt: p.lastOkAt, failures: p.failures, nextAt: p.nextAt, lastError: p.lastError }
  })
}
