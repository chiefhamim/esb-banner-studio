// Pages built in the browser arrive without their story; a site adapter reads it from the publisher's own JSON feed.
// The sample below is synthetic (invented words), shaped like the feed's reply — no publisher text is kept in the repo.
import { describe, expect, it } from 'vitest'
import { adapterFor } from '../../src/editorial/siteAdapters'

const PAGE = 'https://www.channel24bd.tv/economy/article/354814/%E0%A6%A8%E0%A6%AE%E0%A7%81%E0%A6%A8%E0%A6%BE'

const FEED = {
  contentDetails: [{
    ContentID: 354814,
    ContentHeading: 'নমুনা শিরোনাম: একটি কাল্পনিক প্রকল্প',
    ContentBrief: 'এটি একটি কাল্পনিক সারসংক্ষেপ, যা শুধু পরীক্ষার জন্য লেখা হয়েছে।',
    ContentDetails: '<p style="text-align:justify"><strong>প্রথম অনুচ্ছেদের কাল্পনিক লেখা এখানে আছে এবং এটি যথেষ্ট দীর্ঘ।</strong></p><p>দ্বিতীয় অনুচ্ছেদের কাল্পনিক লেখা এখানে আছে এবং এটিও যথেষ্ট দীর্ঘ।</p><p>&nbsp;</p>',
    WriterName: 'পরীক্ষা লেখক',
    ImageBgPath: '2026October/sample.jpg',
    ImageBgPathCaption: 'নমুনা ছবি',
    create_date: '2026-10-25 11:06:12',
  }],
}

describe('site adapters', () => {
  it('finds the JSON feed for a Channel 24 article page, however the slug is spelled', () => {
    const hit = adapterFor(PAGE)
    expect(hit?.apiUrl).toBe('https://backoffice.channel24bd.tv/api/v2/content-details/economy/354814')
    expect(adapterFor('https://www.channel24bd.tv/economy/article/354814')?.apiUrl).toBe(hit?.apiUrl)
    expect(adapterFor('https://www.channel24bd.tv/economy/article/354814/১২৩-নমুনা')?.apiUrl).toBe(hit?.apiUrl)
  })

  it('leaves every other site, and non-article pages, to the normal extractor', () => {
    expect(adapterFor('https://www.prothomalo.com/business/abc')).toBeNull()
    expect(adapterFor('https://www.channel24bd.tv/')).toBeNull()
    expect(adapterFor('https://www.channel24bd.tv/economy')).toBeNull()
    expect(adapterFor('https://evil.example/channel24bd.tv/economy/article/1')).toBeNull()
    expect(adapterFor('not a url')).toBeNull()
  })

  it('builds the article from the feed: headline, deck, paragraphs without empty blocks, byline, photo', () => {
    const hit = adapterFor(PAGE)!
    const a = hit.adapter.build(FEED, PAGE, 100)!
    expect(a.title).toContain('নমুনা শিরোনাম')
    expect(a.paragraphs).toHaveLength(2)
    expect(a.paragraphs[0]).toContain('প্রথম অনুচ্ছেদ')
    expect(a.byline).toBe('পরীক্ষা লেখক')
    expect(a.publisher).toBe('Channel 24')
    expect(a.images[0].src).toBe('https://backoffice.channel24bd.tv/media/imgAll/2026October/sample.jpg')
    expect(a.publishedAt).toBe('2026-10-25T11:06:12+06:00')
    expect(a.meta?.language).toBe('bn')
  })

  it('returns null, not a half-empty article, when the feed has no story', () => {
    const hit = adapterFor(PAGE)!
    expect(hit.adapter.build({}, PAGE, 0)).toBeNull()
    expect(hit.adapter.build({ contentDetails: [{ ContentHeading: 'x', ContentDetails: '' }] }, PAGE, 0)).toBeNull()
    expect(hit.adapter.build(null, PAGE, 0)).toBeNull()
  })
})
