// @vitest-environment jsdom
// Insights desk data layer: Graph answers -> typed metrics and error states, the 15-minute cache, the weekly table,
// CSV and the AI summary prompt. Every Graph call is a mocked fetch; the token is a fixture that is not a real token.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PUBLISHED_EVENT, PUBLISH_LOG_CAP, PUBLISH_LOG_KEY, STALE_MS, appendPublishLog, blockedReason, cacheAge, emptyCache, fetchPageInsights,
  fetchPostInsights, fmtAge, noteOutcome, postIdFromUrl, readPublishLog, recordPublish, refreshInsights, startOfWeek, summaryPrompt,
  categoryName, toCsv, tokenHash, trackPublish, unsupportedNumbers, weeklyTable, writeWeeklySummary,
} from '../../src/editorial/insights'
import type { InsightsCache, PublishRecord } from '../../src/editorial/insights'
import * as ai from '../../src/editorial/aiProviders'

const TOKEN = 'test-token-not-real'
const cfg = { pageId: '100000000000001', token: TOKEN }

const POST_FIXTURE = {
  data: [
    { name: 'post_impressions', period: 'lifetime', values: [{ value: 1520 }] },
    { name: 'post_impressions_unique', period: 'lifetime', values: [{ value: 1200 }] },
    { name: 'post_engaged_users', period: 'lifetime', values: [{ value: 88 }] },
    { name: 'post_clicks', period: 'lifetime', values: [{ value: 41 }] },
    { name: 'post_reactions_by_type_total', period: 'lifetime', values: [{ value: { like: 30, love: 4, wow: 1 } }] },
  ],
}
const PAGE_FIXTURE = {
  data: [
    { name: 'page_impressions', period: 'day', values: [{ value: 900, end_time: '2026-10-30T07:00:00+0000' }, { value: 1100, end_time: '2026-10-31T07:00:00+0000' }] },
    { name: 'page_post_engagements', period: 'day', values: [{ value: 50, end_time: '2026-10-30T07:00:00+0000' }, { value: 70, end_time: '2026-10-31T07:00:00+0000' }] },
  ],
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const graphErr = (status: number, code: number, message = 'Synthetic error') => json(status, { error: { message, code, type: 'OAuthException' } })

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  localStorage.clear()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

const rec = (over: Partial<PublishRecord> = {}): PublishRecord => ({
  storyId: 's1', slug: 'grid-adds-400mw', url: 'https://esbpowerline.com/articles/grid-adds-400mw', headline: 'Grid operator adds 400 MW of evening peak capacity',
  categoryId: '03', format: 'fb45', publishedAt: '2026-10-28T09:30:00.000Z', facebookPostId: '100000000000001_200000000000001', dryRun: false, ...over,
})

describe('Graph post and page insights', () => {
  it('maps a post insights answer to typed metrics, with the token only in the Authorization header', async () => {
    fetchMock.mockResolvedValueOnce(json(200, POST_FIXTURE))
    const r = await fetchPostInsights(cfg, '100000000000001_200000000000001')
    expect(r).toEqual({ ok: true, metrics: { impressions: 1520, reach: 1200, engaged: 88, clicks: 41, reactions: 35, reactionsByType: { like: 30, love: 4, wow: 1 } } })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://graph.facebook.com/v26.0/100000000000001_200000000000001/insights?metric=post_impressions,post_impressions_unique,post_engaged_users,post_clicks,post_reactions_by_type_total')
    expect(String(url)).not.toContain(TOKEN)
    expect(init.method ?? 'GET').toBe('GET')
    expect(init.headers).toEqual({ Authorization: `Bearer ${TOKEN}` })
  })

  it('keeps a metric Graph left out as null, never 0', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { data: [POST_FIXTURE.data[0]] }))
    const r = await fetchPostInsights(cfg, '1_2')
    expect(r.ok && r.metrics).toMatchObject({ impressions: 1520, clicks: null, reactions: null })
  })

  it('maps page insights day by day with totals', async () => {
    fetchMock.mockResolvedValueOnce(json(200, PAGE_FIXTURE))
    const r = await fetchPageInsights(cfg)
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://graph.facebook.com/v26.0/100000000000001/insights?metric=page_impressions,page_post_engagements&period=day&date_preset=last_28d')
    expect(r.ok && r.metrics).toEqual({ days: [{ day: '2026-10-30', impressions: 900, engagements: 50 }, { day: '2026-10-31', impressions: 1100, engagements: 70 }], impressions: 2000, engagements: 120 })
  })

  it.each([
    ['expired token (190)', graphErr(400, 190), 'expired-token'],
    ['rate limit (4)', graphErr(400, 4), 'rate-limited'],
    ['rate limit (17)', graphErr(400, 17), 'rate-limited'],
    ['rate limit (32)', graphErr(400, 32), 'rate-limited'],
    ['bad request (100)', graphErr(400, 100), 'bad-request'],
    ['permission (10)', graphErr(403, 10), 'denied'],
  ])('maps %s to its typed state', async (_n, res, kind) => {
    fetchMock.mockResolvedValueOnce(res)
    const r = await fetchPostInsights(cfg, '1_2')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error.kind).toBe(kind)
  })

  it('a malformed body is "malformed", a network failure is "offline"', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>not json</html>', { status: 200 }))
    const a = await fetchPostInsights(cfg, '1_2')
    expect(!a.ok && a.error.kind).toBe('malformed')
    fetchMock.mockResolvedValueOnce(json(200, { data: 'nope' }))
    const b = await fetchPostInsights(cfg, '1_2')
    expect(!b.ok && b.error.kind).toBe('malformed')
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const c = await fetchPostInsights(cfg, '1_2')
    expect(!c.ok && c.error.kind).toBe('offline')
  })

  it('never puts the token in an error string, even when Facebook echoes it', async () => {
    fetchMock.mockResolvedValueOnce(graphErr(400, 1, `Bad token ${TOKEN} in request`))
    const r = await fetchPostInsights(cfg, '1_2')
    expect(!r.ok && r.error.message).not.toContain(TOKEN)
    expect(!r.ok && r.error.message).toContain('[token]')
  })
})

describe('refresh and the cache', () => {
  const now = Date.parse('2026-10-29T12:00:00Z')

  it('reads the page and each post once, then serves the cache inside 15 minutes', async () => {
    fetchMock.mockImplementation(async (url: string) => json(200, String(url).includes('/100000000000001/insights') ? PAGE_FIXTURE : POST_FIXTURE))
    const first = await refreshInsights(cfg, [rec()], emptyCache(), now)
    expect(first.requests).toBe(2)
    expect(first.cache.posts['100000000000001_200000000000001'].metrics?.impressions).toBe(1520)
    expect(cacheAge(first.cache.posts['100000000000001_200000000000001'], now + 4 * 60_000)).toBe(4 * 60_000)
    const again = await refreshInsights(cfg, [rec()], first.cache, now + STALE_MS - 1)
    expect(again.requests).toBe(0)
    const later = await refreshInsights(cfg, [rec()], first.cache, now + STALE_MS)
    expect(later.requests).toBe(2)
  })

  it('never retries a 190: the token is remembered by hash and no request goes out with it again', async () => {
    fetchMock.mockResolvedValue(graphErr(400, 190))
    const r = await refreshInsights(cfg, [rec()], emptyCache(), now)
    expect(r.requests).toBe(1)
    expect(r.cache.expiredToken).toBe(tokenHash(TOKEN))
    expect(JSON.stringify(r.cache)).not.toContain(TOKEN)
    expect(blockedReason(r.cache, cfg, now + 24 * 3600_000)).toBe('expired-token')
    const again = await refreshInsights(cfg, [rec()], r.cache, now + 24 * 3600_000)
    expect(again.requests).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // a different token may be tried
    expect(blockedReason(r.cache, { ...cfg, token: 'another-test-token-not-real' }, now)).toBeNull()
  })

  it('backs off a rate limit for 15 minutes with no request at all', async () => {
    fetchMock.mockResolvedValue(graphErr(400, 4))
    const r = await refreshInsights(cfg, [rec(), rec({ facebookPostId: '1_3', slug: 'b' })], emptyCache(), now)
    expect(r.requests).toBe(1)
    expect(r.cache.rateLimitedUntil).toBe(now + STALE_MS)
    expect(blockedReason(r.cache, cfg, now + STALE_MS - 1)).toBe('rate-limited')
    expect((await refreshInsights(cfg, [rec()], r.cache, now + 60_000)).requests).toBe(0)
    expect(blockedReason(r.cache, cfg, now + STALE_MS)).toBeNull()
  })

  it('makes no request without a token, and none for a test publish or a story not on Facebook', async () => {
    expect((await refreshInsights(null, [rec()], emptyCache(), now)).requests).toBe(0)
    fetchMock.mockResolvedValue(json(200, PAGE_FIXTURE))
    const r = await refreshInsights(cfg, [rec({ dryRun: true }), rec({ facebookPostId: undefined })], emptyCache(), now)
    expect(r.requests).toBe(1) // the page only
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('formats cache ages', () => {
    expect(fmtAge(20_000)).toBe('just now')
    expect(fmtAge(4 * 60_000)).toBe('4 min ago')
    expect(fmtAge(3 * 3600_000)).toBe('3 h ago')
    expect(fmtAge(3 * 86_400_000)).toBe('3 d ago')
    expect(cacheAge(undefined, now)).toBeNull()
  })
})

describe('publish log (D9)', () => {
  it('appends newest first, caps at 400, and drops records that are not records', () => {
    for (let i = 0; i < PUBLISH_LOG_CAP + 5; i++) appendPublishLog(rec({ slug: 's' + i }))
    const log = readPublishLog()
    expect(log).toHaveLength(PUBLISH_LOG_CAP)
    expect(log[0].slug).toBe('s' + (PUBLISH_LOG_CAP + 4))
    localStorage.setItem(PUBLISH_LOG_KEY, JSON.stringify([{ nope: 1 }, rec()]))
    expect(readPublishLog()).toHaveLength(1)
  })

  it('recordPublish dispatches esb:story-published with the same record', () => {
    const got: unknown[] = []
    const on = (e: Event) => got.push((e as CustomEvent).detail)
    window.addEventListener(PUBLISHED_EVENT, on)
    recordPublish(rec())
    window.removeEventListener(PUBLISHED_EVENT, on)
    expect(got).toEqual([rec()])
    expect(readPublishLog()).toEqual([rec()])
  })

  it('logs a PUBLISHED outcome once, with the Facebook post id; never a draft', () => {
    const draft = { headline: 'Grid operator adds 400 MW', slug: 'grid-adds-400mw' }
    const publish = trackPublish(() => {})
    publish('DRAFT')
    noteOutcome({ url: 'https://esbpowerline.com/articles/grid-adds-400mw' }, draft, { storyId: 's1', categoryId: '03' })
    expect(readPublishLog()).toHaveLength(0)
    publish('PUBLISHED')
    const outcome = { url: 'https://esbpowerline.com/articles/grid-adds-400mw', fbUrl: 'https://www.facebook.com/100000000000001_200000000000001' }
    noteOutcome(outcome, draft, { storyId: 's1', categoryId: '03' })
    noteOutcome(outcome, draft, { storyId: 's1', categoryId: '03' })
    const log = readPublishLog()
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ storyId: 's1', slug: 'grid-adds-400mw', format: 'fb45', facebookPostId: '100000000000001_200000000000001', dryRun: false, categoryId: '03' })
    expect(postIdFromUrl('https://www.facebook.com/123_456')).toBe('123_456')
  })
})

describe('weekly table, CSV and the AI summary', () => {
  const weekStart = startOfWeek(Date.parse('2026-10-28T09:30:00.000Z'))
  const log = [
    rec(),
    rec({ slug: 'lng-cargo', headline: '=HYPERLINK("x") LNG cargo, "delayed"', categoryId: '02', facebookPostId: '1_9', publishedAt: new Date(weekStart + 3600_000).toISOString() }),
    rec({ slug: 'site-only', headline: 'Site only story', facebookPostId: undefined, format: 'web', publishedAt: new Date(weekStart + 7200_000).toISOString() }),
    rec({ slug: 'old', publishedAt: new Date(weekStart - 86_400_000).toISOString() }),
    rec({ slug: 'test', dryRun: true }),
  ]
  const cache: InsightsCache = { posts: { '100000000000001_200000000000001': { attemptedAt: 1, fetchedAt: 1_700_000_000_000, metrics: { impressions: 1520, reach: 1200, engaged: 88, clicks: 41, reactions: 35, reactionsByType: {} } } } }

  it('builds one row per story in the week, newest first, unread figures null', () => {
    const rows = weeklyTable(log, cache, weekStart)
    expect(rows.map((r) => r.slug)).toEqual(['grid-adds-400mw', 'site-only', 'lng-cargo'])
    expect(rows[0]).toMatchObject({ category: categoryName('03'), format: 'fb45', impressions: 1520, reactions: 35, clicks: 41, onFacebook: true })
    expect(rows[1]).toMatchObject({ onFacebook: false, impressions: null })
    expect(rows[2]).toMatchObject({ onFacebook: true, impressions: null, reactions: null })
  })

  it('writes formula-safe CSV with empty cells for figures never read', () => {
    const csv = toCsv(weeklyTable(log, cache, weekStart))
    const lines = csv.trim().split('\r\n')
    expect(lines).toHaveLength(4)
    expect(lines[0]).toBe('"Week of","Published (ISO)","Headline","Slug","Category","Banner","On Facebook","Impressions","Reactions","Clicks","Figures read (ISO)"')
    expect(lines[1]).toContain('"1520","35","41"')
    expect(lines[3]).toContain(`"'=HYPERLINK(""x"") LNG cargo, ""delayed"""`)
    expect(lines[3]).toContain('"yes","","",""')
  })

  it('the summary prompt carries only the table — no story text, no token, inside the delimiters', () => {
    localStorage.setItem('esb-banner-studio/facebook', JSON.stringify(cfg))
    const rows = weeklyTable(log, cache, weekStart)
    const { system, user } = summaryPrompt(rows)
    const all = system + user
    expect(user.startsWith('This week\'s table:\n"""\n')).toBe(true)
    expect(user.endsWith('\n"""')).toBe(true)
    expect(user.match(/"""/g)).toHaveLength(2)
    expect(all).not.toContain(TOKEN)
    expect(all).not.toMatch(/EAA[A-Za-z0-9]{10,}/)
    expect(all).not.toContain('100000000000001')
    expect(all).not.toContain('The grid operator added') // no article body
    expect(user).toContain('Grid operator adds 400 MW of evening peak capacity | ')
    expect(user.split('\n').filter((l) => l.includes(' | '))).toHaveLength(4) // header + 3 rows
  })

  it('refuses a summary that quotes a number the table does not hold', async () => {
    const rows = weeklyTable(log, cache, weekStart)
    expect(unsupportedNumbers('The grid story drew 1,520 impressions and 35 reactions.', rows)).toEqual([])
    expect(unsupportedNumbers('It reached 9,999 people.', rows)).toEqual(['9,999'])
    vi.spyOn(ai, 'aiJson').mockResolvedValueOnce({ data: { summary: 'The grid story led with 1,520 impressions.' }, model: 'm' })
    await expect(writeWeeklySummary(rows, { provider: 'anthropic', key: 'test-key-not-real', model: 'claude-sonnet-5-5' })).resolves.toEqual({ text: 'The grid story led with 1,520 impressions.', model: 'm' })
    vi.spyOn(ai, 'aiJson').mockResolvedValueOnce({ data: { summary: 'It reached 9,999 people.' }, model: 'm' })
    await expect(writeWeeklySummary(rows, { provider: 'anthropic', key: 'test-key-not-real', model: 'claude-sonnet-5-5' })).rejects.toThrow(/not in the table/)
    await expect(writeWeeklySummary(rows, null)).rejects.toThrow(/No Review AI/)
  })
})
