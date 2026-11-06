// Copied from ESB Studio Phone (src/mobile/watch/watchStore.test.ts, 2026-11-06). Keep the two copies in step. Desktop
// difference: Bing News feeds are read here (the phone skips them).
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

describe('desktop feeds', () => {
  it('reads every switched-on feed, Bing News included: 77 feeds from 53 portals', async () => {
    const { isPhoneFeed, FEED_COUNT } = await import('./watchStore')
    expect(FEED_COUNT).toBeGreaterThan(PORTALS.length)
    expect(isPhoneFeed({ on: true, url: 'https://www.bing.com/news/search?q=site%3Abdnews24.com&format=rss' })).toBe(true)
    expect(isPhoneFeed({ on: true, url: 'https://www.tbsnews.net/rss.xml' })).toBe(true)
    expect(isPhoneFeed({ on: false, url: 'https://www.tbsnews.net/rss.xml' })).toBe(false)
  })
})
