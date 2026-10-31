// @vitest-environment jsdom
// Wire desk: feed parsing, dedupe, backoff, inbox and polling. Fixtures are synthetic example.com feeds.

import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  parseFeed, normalizeTitle, relTime, sourceStatus, filterItems, similar, dedupe, nextDue, afterPoll, capInbox, pollSources, checkSourceUrl, clampInterval,
  useWire, loadInbox, loadSources, INBOX_KEY, SOURCES_KEY, INBOX_CAP, BACKOFF_CAP_MS,
  type WireSource, type WireItem, type FetchFn,
} from '../../src/editorial/wire'

const fx = (name: string) => readFileSync(resolve(__dirname, '../fixtures/feeds', name), 'utf8')
const RSS = fx('rss2.xml')
const ATOM = fx('atom.xml')
const SITEMAP = fx('sitemap.xml')
const BROKEN = fx('malformed.xml')
const MIN = 60_000

const src = (over: Partial<WireSource> = {}): WireSource => ({
  id: 's1', url: 'https://news.example.com/feed.xml', name: '', kind: 'auto', intervalMin: 30, enabled: true,
  lastFetchedAt: null, lastOkAt: null, failures: 0, nextAt: 0, lastError: null, ...over,
})

describe('Wire — parseFeed', () => {
  it('parses RSS 2.0: 5 items with title, absolute link, ISO date, source', () => {
    const r = parseFeed(RSS, 'https://news.example.com/feed.xml')
    expect(r.error).toBeUndefined()
    expect(r.kind).toBe('rss')
    expect(r.items).toHaveLength(5)
    for (const i of r.items) {
      expect(i.title.length).toBeGreaterThan(0)
      expect(i.link).toMatch(/^https:\/\/news\.example\.com\//)
      expect(i.source).toBe('Example Desk Wire')
    }
    expect(r.items[0]).toEqual({ title: 'Port authority opens second container terminal', link: 'https://news.example.com/economy/port-terminal-opens', date: '2026-10-31T09:30:00.000Z', source: 'Example Desk Wire' })
  })

  it('RSS: CDATA title becomes plain text (no markup), timezone offsets normalise to UTC', () => {
    const it2 = parseFeed(RSS, 'https://news.example.com/feed.xml').items[1]
    expect(it2.title).toBe('Rice prices fall 5% after record harvest & imports')
    expect(it2.title).not.toMatch(/[<>]/)
    expect(it2.date).toBe('2026-10-31T02:00:00.000Z')
  })

  it('RSS: relative link resolved against the channel link; missing date is null; dc:date read', () => {
    const items = parseFeed(RSS, 'https://feeds.example.com/x/rss').items
    expect(items[2].link).toBe('https://news.example.com/city/river-bus-routes')
    expect(items[3].date).toBeNull()
    expect(items[4].date).toBe('2026-10-30T06:00:00.000Z')
    expect(items[4].title).toBe('বাজেট ২০২৬: নতুন কর হার ঘোষণা')
  })

  it('parses Atom: alternate link, xml:base resolution, CDATA html title, published before updated', () => {
    const r = parseFeed(ATOM, 'https://wire.example.com/feed.atom')
    expect(r.kind).toBe('atom')
    expect(r.items).toHaveLength(5)
    expect(r.items.every((i) => i.source === 'Example Wire Service')).toBe(true)
    expect(r.items[1].title).toBe('Central bank holds policy rate at 8.5%')
    expect(r.items[1].date).toBe('2026-10-31T01:45:00.000Z')
    expect(r.items[2].link).toBe('https://wire.example.com/stories/monsoon-ends')
    expect(r.items[3].date).toBeNull()
    expect(r.items[4].link).toBe('https://wire.example.com/stories/budget-tax') // the enclosure is skipped
  })

  it('parses a news sitemap urlset: news:title, else a title from the URL; publication_date, else lastmod', () => {
    const r = parseFeed(SITEMAP, 'https://news.example.com/sitemap-news.xml')
    expect(r.kind).toBe('sitemap')
    expect(r.items.map((i) => i.title)).toEqual(['National side clinches cricket series', 'Startup funding round', 'Summit ends'])
    expect(r.items[0].date).toBe('2026-10-31T04:30:00.000Z')
    expect(r.items[1].date).toBe('2026-10-30T00:00:00.000Z')
    expect(r.items[2].date).toBeNull()
    expect(r.items[0].source).toBe('news.example.com')
  })

  it('malformed or non-feed input never throws and returns a structured error', () => {
    for (const bad of [BROKEN, '', '   ', 'not xml at all', '<html><body>hi</body></html>', '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>', '<foo/>']) {
      const r = parseFeed(bad, 'https://broken.example.com/feed')
      expect(r.items).toEqual([])
      expect(r.error?.code).toMatch(/^(malformed|empty|not_feed)$/)
      expect(typeof r.error?.message).toBe('string')
    }
    expect(parseFeed(BROKEN, 'https://broken.example.com/feed').error?.code).toBe('malformed')
    // @ts-expect-error — non-string input from a bad bridge answer
    expect(parseFeed(undefined, 'x').error?.code).toBe('empty')
  })

  it('drops items whose link is not http(s) and never returns markup in titles', () => {
    const xml = `<rss><channel><title>T</title><item><title>a</title><link>javascript:alert(1)</link></item><item><title>&lt;img src=x onerror=alert(1)&gt;Hello</title><link>https://a.example.com/1</link></item><item><title>dup</title><link>https://a.example.com/1</link></item></channel></rss>`
    const r = parseFeed(xml, 'https://a.example.com/feed')
    expect(r.items).toHaveLength(1)
    expect(r.items[0].title).toBe('Hello')
  })
})

describe('Wire — similar / dedupe', () => {
  it('normalizeTitle lower-cases, maps Bengali digits, strips punctuation', () => {
    expect(normalizeTitle('  Port Authority — opens “second” terminal!  ')).toBe('port authority opens second terminal')
    expect(normalizeTitle('বাজেট ২০২৬: নতুন কর।')).toBe('বাজেট 2026 নতুন কর')
  })

  it('similar: equal after normalization, or token Jaccard ≥ 0.8', () => {
    expect(similar('Port authority opens second container terminal', 'Port Authority opens second container terminal!')).toBe(true)
    expect(similar('বাজেট ২০২৬: নতুন কর হার ঘোষণা', 'বাজেট 2026: নতুন কর হার ঘোষণা')).toBe(true)
    // 6 shared of 7 distinct words = 0.857
    expect(similar('Port authority opens second container terminal', 'Port authority opens new second container terminal')).toBe(true)
    // 4 shared of 6 = 0.67
    expect(similar('Rice prices fall after harvest', 'Rice prices rise after drought')).toBe(false)
    expect(similar('', '')).toBe(false)
  })

  it('dedupe across two sources drops near-duplicate titles (incl. Bengali digits) and repeated links', () => {
    const rss = parseFeed(RSS, 'https://news.example.com/feed.xml').items
    const atom = parseFeed(ATOM, 'https://wire.example.com/feed.atom').items
    const fresh = dedupe(atom, rss)
    // the port terminal story and the Bengali budget story are already in from RSS
    expect(fresh.map((i) => i.link)).toEqual([
      'https://wire.example.com/stories/policy-rate',
      'https://wire.example.com/stories/monsoon-ends',
      'https://wire.example.com/stories/admission-schedule',
    ])
    expect(dedupe(rss, rss)).toEqual([])
    // duplicates inside one batch: the first wins
    expect(dedupe([...rss, ...rss], [])).toHaveLength(5)
  })
})

describe('Wire — backoff', () => {
  const now = 1_800_000_000_000
  it('success: one interval later, failures reset', () => {
    expect(nextDue({ intervalMin: 30, failures: 0 }, now, true)).toBe(now + 30 * MIN)
    const failed = src({ failures: 3, lastError: { code: 'timeout', message: 'x' } })
    const ok = afterPoll(failed, now, null)
    expect(ok.failures).toBe(0)
    expect(ok.lastError).toBeNull()
    expect(ok.lastOkAt).toBe(now)
    expect(ok.nextAt).toBe(now + 30 * MIN)
  })

  it('failures double the wait and cap at 6 h', () => {
    let s = src({ intervalMin: 15 })
    const waits: number[] = []
    for (let k = 0; k < 6; k++) { s = afterPoll(s, now, { code: 'timeout', message: 't' }); waits.push((s.nextAt - now) / MIN) }
    expect(waits).toEqual([30, 60, 120, 240, 360, 360])
    expect(s.failures).toBe(6)
    expect(nextDue({ intervalMin: 360, failures: 1 }, now, false) - now).toBe(BACKOFF_CAP_MS)
  })

  it('interval is clamped to 15…360 minutes', () => {
    expect(clampInterval(1)).toBe(15)
    expect(clampInterval(9999)).toBe(360)
    expect(clampInterval(NaN)).toBe(30)
  })
})

describe('Wire — inbox and polling', () => {
  beforeEach(() => { localStorage.clear(); useWire.getState().reload() })
  const now = 1_800_000_000_000

  it('capInbox keeps the newest 300, newest first', () => {
    const items: WireItem[] = Array.from({ length: 350 }, (_, k) => ({ id: `https://a.example.com/${k}`, link: `https://a.example.com/${k}`, title: `Story ${k}`, date: new Date(now - k * MIN).toISOString(), source: 'A', sourceId: 's1', fetchedAt: now }))
    const shuffled = [...items].reverse()
    const capped = capInbox(shuffled)
    expect(capped).toHaveLength(INBOX_CAP)
    expect(capped[0].title).toBe('Story 0')
    expect(capped[INBOX_CAP - 1].title).toBe('Story 299')
  })

  it('pollSources polls only sources with nextAt ≤ now, one at a time', async () => {
    const calls: string[] = []
    let inFlight = 0
    let maxInFlight = 0
    const fetchFn: FetchFn = async (url) => {
      calls.push(url); inFlight++; maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return { ok: true, html: url.includes('wire') ? ATOM : RSS, url }
    }
    const sources = [
      src({ id: 'a', url: 'https://news.example.com/feed.xml', nextAt: now - 1 }),
      src({ id: 'b', url: 'https://wire.example.com/feed.atom', nextAt: now }),
      src({ id: 'c', url: 'https://later.example.com/feed', nextAt: now + 1 }),
      src({ id: 'd', url: 'https://off.example.com/feed', enabled: false, nextAt: 0 }),
    ]
    const r = await pollSources({ sources, items: [], dismissed: [] }, now, fetchFn)
    expect(calls).toEqual(['https://news.example.com/feed.xml', 'https://wire.example.com/feed.atom'])
    expect(maxInFlight).toBe(1)
    expect(r.report).toMatchObject({ polled: 2, ok: 2, failed: 0, added: 8 })
    expect(r.sources.find((s) => s.id === 'a')!.nextAt).toBe(now + 30 * MIN)
    expect(r.sources.find((s) => s.id === 'c')!.lastFetchedAt).toBeNull()
  })

  it('store: add → poll → dismiss persists; a second poll within the interval fetches nothing', async () => {
    let count = 0
    const fetchFn: FetchFn = async (url) => { count++; return { ok: true, html: RSS, url } }
    const add = useWire.getState().addSource({ url: 'news.example.com/feed.xml', name: 'Example' })
    expect(add.ok).toBe(true)
    expect(loadSources()[0].url).toBe('https://news.example.com/feed.xml')
    expect(useWire.getState().addSource({ url: 'https://news.example.com/feed.xml' }).ok).toBe(false)

    await useWire.getState().pollDue(now, fetchFn)
    expect(count).toBe(1)
    expect(useWire.getState().items).toHaveLength(5)
    expect(useWire.getState().items.every((i) => i.source === 'Example')).toBe(true)

    const victim = useWire.getState().items[0].id
    useWire.getState().dismiss(victim)
    useWire.getState().reload()
    expect(useWire.getState().items.map((i) => i.id)).not.toContain(victim)
    expect(loadInbox().dismissed).toContain(victim)
    expect(JSON.parse(localStorage.getItem(INBOX_KEY)!).dismissed).toContain(victim)

    const again = await useWire.getState().pollDue(now + 10 * MIN, fetchFn)
    expect(count).toBe(1)
    expect(again?.polled).toBe(0)

    // after the interval it polls again, and the dismissed item does not come back
    await useWire.getState().pollDue(now + 31 * MIN, fetchFn)
    expect(count).toBe(2)
    expect(useWire.getState().items.map((i) => i.id)).not.toContain(victim)
    expect(useWire.getState().items).toHaveLength(4)
  })

  it('store: a net-guard error is kept as text and pushes nextAt out', async () => {
    const fetchFn: FetchFn = async () => ({ ok: false, code: 'private_address', error: 'Host feed.example.com resolved to private/restricted IP: 10.0.0.5' })
    useWire.getState().addSource({ url: 'https://feed.example.com/rss', intervalMin: 15 })
    await useWire.getState().pollDue(now, fetchFn)
    const s = useWire.getState().sources[0]
    expect(s.failures).toBe(1)
    expect(s.lastError).toEqual({ code: 'private_address', message: 'Host feed.example.com resolved to private/restricted IP: 10.0.0.5' })
    expect(s.nextAt).toBe(now + 30 * MIN)
    expect(JSON.parse(localStorage.getItem(SOURCES_KEY)!)[0].lastError.code).toBe('private_address')
  })

  it('store: a fetch that throws or returns unparseable XML is a structured failure', async () => {
    useWire.getState().addSource({ url: 'https://a.example.com/rss' })
    await useWire.getState().pollDue(now, async () => { throw new Error('boom') })
    expect(useWire.getState().sources[0].lastError).toEqual({ code: 'network_error', message: 'boom' })
    await useWire.getState().pollDue(now + 365 * MIN, async (url) => ({ ok: true, html: BROKEN, url }))
    expect(useWire.getState().sources[0].lastError?.code).toBe('malformed')
    expect(useWire.getState().sources[0].failures).toBe(2)
  })

  it('store: without the desktop bridge a poll records no_bridge instead of fetching', async () => {
    useWire.getState().addSource({ url: 'https://a.example.com/rss' })
    await useWire.getState().pollDue(now)
    expect(useWire.getState().sources[0].lastError?.code).toBe('no_bridge')
  })

  it('store: removing a source drops its items; corrupt storage loads empty', async () => {
    useWire.getState().addSource({ url: 'https://news.example.com/feed.xml' })
    await useWire.getState().pollDue(now, async (url) => ({ ok: true, html: RSS, url }))
    useWire.getState().removeSource(useWire.getState().sources[0].id)
    expect(useWire.getState().items).toEqual([])
    localStorage.setItem(SOURCES_KEY, '{nope'); localStorage.setItem(INBOX_KEY, '[1,2')
    expect(loadSources()).toEqual([])
    expect(loadInbox()).toEqual({ items: [], dismissed: [] })
    localStorage.setItem(SOURCES_KEY, JSON.stringify([{ id: 'x', url: 'javascript:alert(1)' }, { id: 'y', url: 'https://ok.example.com/f', intervalMin: 2 }]))
    expect(loadSources().map((s) => [s.id, s.intervalMin])).toEqual([['y', 15]])
  })

  it('checkSourceUrl rejects non-web addresses', () => {
    expect(checkSourceUrl('')).toHaveProperty('error')
    expect(checkSourceUrl('ftp://a.example.com/x')).toHaveProperty('error')
    expect(checkSourceUrl('file:///C:/x')).toHaveProperty('error')
    expect(checkSourceUrl('example.com/rss')).toEqual({ url: 'https://example.com/rss' })
  })
})

describe('Wire — wording', () => {
  const now = 1_800_000_000_000
  it('relTime reads past and future spans', () => {
    expect(relTime(now, now)).toBe('just now')
    expect(relTime(now - 5 * MIN, now)).toBe('5 min ago')
    expect(relTime(now - 3 * 60 * MIN, now)).toBe('3 h ago')
    expect(relTime(now - 72 * 60 * MIN, now)).toBe('3 d ago')
    expect(relTime(now + 28 * MIN, now)).toBe('in 28 min')
  })
  it('sourceStatus: paused, retrying with the error text, checked', () => {
    expect(sourceStatus(src({ enabled: false }), now)).toEqual({ tone: 'idle', text: 'Paused' })
    expect(sourceStatus(src(), now).text).toBe('Not checked yet')
    const bad = afterPoll(src(), now, { code: 'private_address', message: 'Host x resolved to private/restricted IP: 10.0.0.5' })
    expect(sourceStatus(bad, now)).toEqual({ tone: 'warn', text: 'Retrying in 1 h · Host x resolved to private/restricted IP: 10.0.0.5' })
    expect(sourceStatus(afterPoll(src(), now, null), now + MIN).text).toBe('Checked 1 min ago · next in 29 min')
  })
  it('filterItems matches title or source, ignoring case and digit script', () => {
    const items = parseFeed(RSS, 'https://news.example.com/feed.xml').items.map((i) => ({ ...i, id: i.link, sourceId: 's', fetchedAt: now }))
    expect(filterItems(items, 'RICE')).toHaveLength(1)
    expect(filterItems(items, '2026')).toHaveLength(1)
    expect(filterItems(items, 'example desk')).toHaveLength(5)
    expect(filterItems(items, '  ')).toHaveLength(5)
  })
})
