// Desktop only: the merge the News desk runs while a check is still reading (watchStore.mergeFound).
import { describe, expect, it } from 'vitest'
import { mergeFound, type WatchItem } from './watchStore'

const T = Date.parse('2026-11-06T12:00:00Z')
const item = (key: string, title: string, o: Partial<WatchItem> = {}): WatchItem => ({
  key, title, link: `https://example.com/${key}`, google: false, source: 'Example', feedId: 1,
  published: new Date(T - 3600_000).toISOString(), foundAt: T, categories: ['energy'], matched: ['power'], ...o,
})

describe('mergeFound (live merge during a check)', () => {
  it('adds only rows that were not in the list, and says which', () => {
    const prev = [item('a', 'Old one')]
    const r = mergeFound(prev, [item('a', 'Old one'), item('b', 'New one')], T)
    expect(r.items.map((x) => x.key).sort()).toEqual(['a', 'b'])
    expect(r.addedKeys).toEqual(['b'])
  })
  it('keeps one row per headline per portal, and a direct link beats a Google one', () => {
    const prev = [item('g', 'Same story', { google: true, link: 'https://news.google.com/rss/articles/x' })]
    const r = mergeFound(prev, [item('d', 'Same  story!', { link: 'https://portal.example/story' })], T)
    expect(r.items).toHaveLength(1)
    expect(r.items[0]).toMatchObject({ key: 'g', google: false, link: 'https://portal.example/story' })
    expect(r.addedKeys).toEqual([])
  })
  it('lists newest first and drops what is older than a week', () => {
    const old = item('old', 'Last month', { published: new Date(T - 30 * 86400_000).toISOString() })
    const newer = item('n', 'Newer', { published: new Date(T - 60_000).toISOString() })
    const r = mergeFound([], [item('o', 'Older'), newer, old], T)
    expect(r.items.map((x) => x.key)).toEqual(['n', 'o'])
  })
  it('gives the same answer however often it is run on a growing list', () => {
    const found = [item('x', 'One')]
    const first = mergeFound([], found, T)
    found.push(item('y', 'Two'))
    const second = mergeFound([], found, T)
    expect(first.addedKeys).toEqual(['x'])
    expect(second.addedKeys.sort()).toEqual(['x', 'y'])
  })
})
