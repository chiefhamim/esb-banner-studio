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

// Barta24: same shape of problem, a different endpoint. Synthetic words only.
const B24_PAGE = 'https://barta24.com/details/economics/344562'
const B24_FEED = {
  version: '1',
  data: [{
    ContentID: 344562,
    ContentHeading: null,
    DetailsHeading: 'নমুনা শিরোনাম: একটি কাল্পনিক কারখানা',
    ContentBrief: 'এটি একটি কাল্পনিক সারসংক্ষেপ, যা শুধু পরীক্ষার জন্য লেখা হয়েছে।',
    ContentDetails: ['<p style="text-align: justify;">প্রথম অনুচ্ছেদের কাল্পনিক লেখা এখানে আছে।</p>', '<p>দ্বিতীয় অনুচ্ছেদের কাল্পনিক লেখা এখানে আছে।</p>'],
    WriterName: 'পরীক্ষা প্রতিনিধি',
    ImageBgPath: 'barta/media/bangla/imgAll/2026October/sample.jpg',
    ImageBgPathCaption: 'নমুনা ছবি',
    created_at: '2026-10-25T08:31:53.000000Z',
  }],
}

describe('Barta24 adapter', () => {
  it('finds the JSON endpoint from the article id, and leaves other pages alone', () => {
    expect(adapterFor(B24_PAGE)?.apiUrl).toBe('https://backoffice.barta24.com/api/content-details/344562')
    expect(adapterFor('https://www.barta24.com/details/national/12/slug-here')?.apiUrl).toBe('https://backoffice.barta24.com/api/content-details/12')
    expect(adapterFor('https://barta24.com/')).toBeNull()
    expect(adapterFor('https://evil.example/barta24.com/details/economics/1')).toBeNull()
  })
  it('builds the story from a body given as a list of paragraphs, with the headline from DetailsHeading', () => {
    const a = adapterFor(B24_PAGE)!.adapter.build(B24_FEED, B24_PAGE, 100)!
    expect(a.title).toContain('নমুনা শিরোনাম')
    expect(a.paragraphs).toHaveLength(2)
    expect(a.byline).toBe('পরীক্ষা প্রতিনিধি')
    expect(a.publisher).toBe('Barta24')
    expect(a.images[0].src).toBe('https://cdn.barta24.com/barta/media/bangla/imgAll/2026October/sample.jpg')
    expect(a.meta?.language).toBe('bn')
  })
  it('also accepts the body as one HTML string, and returns null when there is no story', () => {
    const one = { data: [{ ...B24_FEED.data[0], ContentDetails: '<p>প্রথম লেখা এখানে আছে।</p><p>দ্বিতীয় লেখা এখানে আছে।</p>' }] }
    expect(adapterFor(B24_PAGE)!.adapter.build(one, B24_PAGE, 0)!.paragraphs).toHaveLength(2)
    expect(adapterFor(B24_PAGE)!.adapter.build({ data: [] }, B24_PAGE, 0)).toBeNull()
    expect(adapterFor(B24_PAGE)!.adapter.build({ data: [{ DetailsHeading: 'x', ContentDetails: [] }] }, B24_PAGE, 0)).toBeNull()
  })
})

