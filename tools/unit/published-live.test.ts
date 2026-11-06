// Published read from the site's database (src/editorial/publishedLive.ts): rows become the desk's summaries, the
// query asks only for published stories, newest first, and the change signature moves when the newest change or the
// count does. Synthetic rows only; no network.
import { describe, expect, it } from 'vitest'
import { fetchPublishedFromDatabase, publishedSignature, toSummary, PUBLISHED_LIMIT } from '../../src/editorial/publishedLive'

const row = (o: Partial<{ title: string; slug: string; category: string | null; publishedAt: string | null }>) => ({
  title: 'Grid output rises', slug: 'grid-output-rises', category: 'Power Generation', publishedAt: '2026-11-06 07:10:00', excerpt: null, imageUrl: null, postAsNewsDesk: false, ...o,
})

const fakeFetch = (body: unknown, headers: Record<string, string> = {}, status = 200) => {
  const calls: string[] = []
  const f = (async (url: string) => {
    calls.push(String(url))
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
  }) as unknown as typeof fetch
  return { f, calls }
}

describe('published from the database', () => {
  it('reads a zone-less timestamp as UTC and builds the article link', () => {
    const s = toSummary(row({}))!
    expect(s.publishedAt).toBe('Fri, 06 Nov 2026 07:10:00 GMT')
    expect(s.link).toBe('https://esbpowerline.com/articles/grid-output-rises')
    expect(toSummary(row({ category: null }))!.category).toBe('General')
  })

  it('drops rows without a title or slug', () => {
    expect(toSummary(row({ slug: '' }))).toBeNull()
    expect(toSummary(row({ title: '' }))).toBeNull()
  })

  it('asks for published stories only, newest first, and returns null when the site refuses', async () => {
    const { f, calls } = fakeFetch([row({}), row({ slug: 'b', title: 'B' })])
    const list = await fetchPublishedFromDatabase(null, f)
    expect(list?.map((a) => a.slug)).toEqual(['grid-output-rises', 'b'])
    expect(calls[0]).toContain('status=eq.PUBLISHED')
    expect(calls[0]).toContain('order=publishedAt.desc')
    expect(calls[0]).toContain(`limit=${PUBLISHED_LIMIT}`)
    expect(await fetchPublishedFromDatabase(null, fakeFetch({}, {}, 503).f)).toBeNull()
  })

  it('the change signature carries the count and the newest change', async () => {
    const a = await publishedSignature(null, fakeFetch([{ slug: 'x', updatedAt: '2026-11-06 07:00:00' }], { 'content-range': '0-0/412' }).f)
    const b = await publishedSignature(null, fakeFetch([{ slug: 'x', updatedAt: '2026-11-06 07:05:00' }], { 'content-range': '0-0/412' }).f)
    const c = await publishedSignature(null, fakeFetch([{ slug: 'x', updatedAt: '2026-11-06 07:00:00' }], { 'content-range': '0-0/411' }).f)
    expect(a).toBe('412|x|2026-11-06 07:00:00')
    expect(new Set([a, b, c]).size).toBe(3)
  })
})
