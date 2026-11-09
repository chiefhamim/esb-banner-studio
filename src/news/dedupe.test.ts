// News engine (shared, identical in both apps): one row per story across feeds.
import { describe, expect, it } from 'vitest'
import { mergeFound, nearSameTitle, normUrlKey, type DedupeItem } from './dedupe'

const T = Date.parse('2026-11-06T12:00:00Z')
const item = (key: string, title: string, o: Partial<DedupeItem> = {}): DedupeItem => ({
  key, title, link: `https://example.com/${key}`, google: false, source: 'Example',
  published: new Date(T - 3600_000).toISOString(), foundAt: T, categories: ['energy'], matched: ['power'], ...o,
})

describe('normUrlKey', () => {
  it('drops scheme, www, tracking, trailing slash, amp and click-throughs', () => {
    const k = 'portal.example/news/123'
    expect(normUrlKey('https://www.portal.example/news/123/?utm_source=x&fbclid=y')).toBe(k)
    expect(normUrlKey('http://portal.example/news/123/amp')).toBe(k)
    expect(normUrlKey('https://www.bing.com/news/apiclick.aspx?url=' + encodeURIComponent('https://portal.example/news/123'))).toBe(k)
    expect(normUrlKey('https://portal.example/news/123?id=5')).not.toBe(k)
  })
})

describe('nearSameTitle', () => {
  it('matches an edited headline, not a different story', () => {
    expect(nearSameTitle('গ্যাস সংকটে বন্ধ তিন সার কারখানা', 'গ্যাস সংকটে বন্ধ তিন সার কারখানা, উৎপাদন ব্যাহত')).toBe(false)
    expect(nearSameTitle('Petrobangla to buy two more LNG cargoes from spot market', 'Petrobangla to buy two more LNG cargoes from the spot market')).toBe(true)
    expect(nearSameTitle('Gas price up', 'Gas price down')).toBe(false)
  })
})

describe('mergeFound across feeds', () => {
  it('merges the same story reached through two feeds by its address', () => {
    const a = item('a', 'Rooppur unit two starts', { link: 'https://portal.example/n/1?utm_source=rss', source: 'Portal' })
    const b = item('b', 'Rooppur 2nd unit begins trial run', { link: 'https://www.portal.example/n/1/', source: 'Portal English' })
    const r = mergeFound([a], [b], T)
    expect(r.items).toHaveLength(1)
    expect(r.addedKeys).toEqual([])
  })
  it('merges a near-identical headline from the same portal and keeps both categories', () => {
    const a = item('a', 'Petrobangla to buy two more LNG cargoes from spot market', { link: 'https://p.example/1' })
    const b = item('b', 'Petrobangla to buy two more LNG cargoes from the spot market', { link: 'https://p.example/2', categories: ['leadership'] })
    const r = mergeFound([], [a, b], T)
    expect(r.items).toHaveLength(1)
    expect(r.items[0].categories).toEqual(['energy', 'leadership'])
  })
  it('keeps the same headline from two different portals', () => {
    const r = mergeFound([], [item('a', 'Load shedding returns in Dhaka today', { source: 'A' }), item('b', 'Load shedding returns in Dhaka today', { source: 'B' })], T)
    expect(r.items).toHaveLength(2)
  })
  it('never brings back a hidden row and fills in a missing date', () => {
    const undated = item('u', 'Undated story about the grid', { published: null })
    const r = mergeFound([undated], [item('u2', 'Undated story about the grid', { link: 'https://example.com/u' })], T, { hidden: ['h'] })
    expect(r.items[0].published).not.toBeNull()
    expect(mergeFound([], [item('h', 'Hidden one here today')], T, { hidden: ['h'] }).items).toHaveLength(0)
  })
})
