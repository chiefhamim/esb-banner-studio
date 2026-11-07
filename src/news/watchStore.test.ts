import { describe, expect, it } from 'vitest'
import { unwrapLink, PORTALS } from './watchStore'
import { parseFeed } from './feedparse'

describe('EnergyWatch on the phone', () => {
  it('unpacks the article address from a Bing News link', () => {
    const bing = 'http://www.bing.com/news/apiclick.aspx?ref=FexRss&aid=&tid=6aec&url=https%3a%2f%2fbangla.bdnews24.com%2flifestyle%2fsh23994dte&c=157&mkt=en-ww'
    expect(unwrapLink(bing)).toEqual({ link: 'https://bangla.bdnews24.com/lifestyle/sh23994dte', google: false })
  })
  it('marks a Google News link (it opens in the browser)', () => {
    expect(unwrapLink('https://news.google.com/rss/articles/CBMiabc?oc=5').google).toBe(true)
  })
  it('leaves a portal link alone', () => {
    expect(unwrapLink('https://www.tbsnews.net/economy/energy/x')).toEqual({ link: 'https://www.tbsnews.net/economy/energy/x', google: false })
  })
  it('groups the feeds into portals', () => {
    expect(PORTALS.length).toBeGreaterThan(30)
    expect(new Set(PORTALS.map((p) => p.name)).size).toBe(PORTALS.length)
  })
  it('reads an RSS item and drops the Google " - Source" suffix', () => {
    const xml = '<rss><channel><item><title>Load shedding returns as gas supply falls - The Daily Star</title><link>https://news.google.com/rss/articles/X</link><guid>g1</guid><pubDate>Thu, 05 Nov 2026 10:00:00 GMT</pubDate><source url="https://www.thedailystar.net">The Daily Star</source></item></channel></rss>'
    expect(parseFeed(xml)).toEqual([{ key: 'g1', title: 'Load shedding returns as gas supply falls', link: 'https://news.google.com/rss/articles/X', date: 'Thu, 05 Nov 2026 10:00:00 GMT' }])
  })
})

describe('phone feeds', () => {
  it('keeps Bing News feeds on PC and skips disabled feeds', async () => {
    const { isPhoneFeed } = await import('./watchStore')
    expect(isPhoneFeed({ on: true, url: 'https://www.bing.com/news/search?q=site%3Abdnews24.com&format=rss' })).toBe(true)
    expect(isPhoneFeed({ on: true, url: 'https://www.tbsnews.net/rss.xml' })).toBe(true)
    expect(isPhoneFeed({ on: false, url: 'https://www.tbsnews.net/rss.xml' })).toBe(false)
  })

  it('provides official government press release sources and canonical trending topics', async () => {
    const { PRESS_OFFICES, trendingTopics, visibleItems, useWatch } = await import('./watchStore')
    expect(PRESS_OFFICES.length).toBeGreaterThanOrEqual(25)
    expect(PRESS_OFFICES.some((o) => o.name === 'Power Division')).toBe(true)
    expect(PRESS_OFFICES.some((o) => o.name === 'EMRD')).toBe(true)
    expect(PRESS_OFFICES.some((o) => o.name.startsWith('PID'))).toBe(true)

    const nowIso1 = new Date(Date.now() - 2 * 3600_000).toISOString()
    const nowIso2 = new Date(Date.now() - 1 * 3600_000).toISOString()
    const nowIso3 = new Date(Date.now() - 3 * 3600_000).toISOString()
    const sampleItems = [
      { key: '1', title: 'Petrobangla to import two LNG cargoes from Qatar', link: 'https://example.com/1', source: 'The Daily Star', feedId: 1, categories: ['energy' as const], matched: ['lng', 'petrobangla'], published: nowIso1, foundAt: Date.now() - 2000, google: false },
      { key: '2', title: 'কাতার থেকে এলএনজি আমদানি বাড়াচ্ছে পেট্রোবাংলা', link: 'https://example.com/2', source: 'Prothom Alo', feedId: 2, categories: ['energy' as const], matched: ['এলএনজি', 'পেট্রোবাংলা'], published: nowIso2, foundAt: Date.now() - 1000, google: false },
      { key: '3', title: 'Power Division issues press release on summer generation', link: 'https://powerdivision.gov.bd/site/page/p1', source: 'Power Division', feedId: 901, categories: ['press' as const, 'energy' as const], matched: ['press release', 'power division'], published: nowIso3, foundAt: Date.now() - 3000, google: false },
    ]
    const trends = trendingTopics(sampleItems, 'energy')
    expect(trends.some(([label, count]) => label === 'LNG' && count === 2)).toBe(true)
    expect(trends.some(([label, count]) => label === 'Petrobangla' && count === 2)).toBe(true)

    const prefs = useWatch.getState().prefs
    // Querying "LNG" matches both English "LNG" and Bangla "এলএনজি" via canonical topic expansion
    const filtered = visibleItems(sampleItems, [], prefs, 'LNG', 'energy')
    expect(filtered.map((x) => x.key)).toEqual(['2', '1'])

    // Official Press category filters press items
    const pressItems = visibleItems(sampleItems, [], prefs, '', 'press')
    expect(pressItems.map((x) => x.key)).toEqual(['3'])
  })

  it('cleans published story from watch items when Back to News runs', async () => {
    const { useWatch } = await import('./watchStore')
    useWatch.setState({
      items: [
        { key: 'k1', title: 'BPDB sets new generation record', link: 'https://www.tbsnews.net/energy/bpdb-record', source: 'The Business Standard', feedId: 1, categories: ['energy'], matched: ['bpdb'], published: '2026-11-07T10:00:00Z', foundAt: Date.now(), google: false },
        { key: 'k2', title: 'Other headline', link: 'https://www.tbsnews.net/energy/other', source: 'The Business Standard', feedId: 1, categories: ['energy'], matched: ['power'], published: '2026-11-07T09:00:00Z', foundAt: Date.now(), google: false },
      ],
      newKeys: ['k1', 'k2'],
    })
    useWatch.getState().cleanPublishedStory('https://www.tbsnews.net/energy/bpdb-record?utm_source=rss', 'BPDB sets new generation record')
    expect(useWatch.getState().items.map((x) => x.key)).toEqual(['k2'])
    expect(useWatch.getState().newKeys).toEqual(['k2'])
  })
})
