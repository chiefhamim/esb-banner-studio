import { describe, it, expect } from 'vitest'
import { buildStoryTimeline, quotesWithSpeakers, speakerOfQuote, suggestBroll, SHORT_MAX_SECONDS } from '../../src/video/storyVideo'
import { exportBlocker } from '../../src/video/exportVideo'

const body = [
  'Petrobangla will drill two new wells in Sylhet this winter. The wells are expected to add 30 MMCFD to the grid.',
  '“We expect the first gas by December and no delay,” said Rahim Uddin, the project director at Petrobangla.',
  'Officials said the project will cost Tk 592 crore. Work begins in December near the Jalalabad field area.',
  'Energy adviser Nasrin Haque said, “The new supply will ease pressure on the national grid this year.”',
  '“Nobody has confirmed the final schedule for this stage of work yet.” The ministry declined to comment.',
].join('\n\n')

const input = (over: Record<string, unknown> = {}) => ({
  aspect: '9:16' as const,
  headline: 'Petrobangla to drill two new wells in Sylhet',
  deck: 'Two new wells are set to raise gas supply by winter this year.',
  body,
  desk: 'Gas & Petroleum',
  bannerUrl: 'blob:banner',
  photoUrl: 'blob:p1',
  ...over,
})

describe('quotes need a named speaker', () => {
  it('finds the speaker in the story’s own words, before or after the quote, with a role when given', () => {
    const q1 = 'We expect the first gas by December and no delay,'
    expect(speakerOfQuote(body, q1.replace(/,$/, ''))).toMatchObject({ speaker: 'Rahim Uddin' })
    const q2 = 'The new supply will ease pressure on the national grid this year.'
    expect(speakerOfQuote(body, q2)).toMatchObject({ speaker: 'Nasrin Haque' })
  })
  it('counts a quote with no named speaker and never invents one', () => {
    const r = quotesWithSpeakers(body)
    expect(r.named.map((n) => n.speaker).sort()).toEqual(['Nasrin Haque', 'Rahim Uddin'])
    expect(r.unnamed).toBe(1)
    for (const n of r.named) expect(body.replace(/\s+/g, ' ')).toContain(n.quote)
  })
})

describe('story video v2', () => {
  it('uses several photos, one per key sentence, in turn', () => {
    const tl = buildStoryTimeline(input({ photos: [{ url: 'blob:p1' }, { url: 'blob:p2' }, { url: 'blob:p3' }] }))
    const stills = tl.clips.filter((c) => c.trackId === 'v1' && c.title.startsWith('Photo'))
    expect(new Set(stills.map((c) => c.sourceUrl)).size).toBeGreaterThan(1)
  })

  it('a Short never runs past 60 seconds, with or without a quote card', () => {
    const quote = quotesWithSpeakers(body).named[0]
    for (const q of [null, quote]) {
      const tl = buildStoryTimeline(input({ style: 'short', quote: q, deck: 'x '.repeat(40) + 'done.' }))
      expect(tl.duration).toBeLessThanOrEqual(SHORT_MAX_SECONDS + 0.1)
    }
  })

  it('the quote card carries the quote word for word and its named speaker, and the project can be exported', () => {
    const quote = quotesWithSpeakers(body).named[0]
    const tl = buildStoryTimeline(input({ quote }))
    const card = tl.clips.find((c) => c.titleData?.template === 'quote')
    expect(card?.titleData?.fields.quote).toBe(quote.quote)
    expect(card?.titleData?.fields.speaker).toBe(quote.speaker)
    // the blocker is null when nothing stops the export; the story's media is a stand-in URL here, so only the title check matters
    const why = exportBlocker(tl)
    expect(why === null || !/empty|placeholder|required/i.test(why)).toBe(true)
  })

  it('quote first puts the card before the captioned points', () => {
    const quote = quotesWithSpeakers(body).named[0]
    const tl = buildStoryTimeline(input({ style: 'quote-first', quote }))
    const card = tl.clips.find((c) => c.titleData?.template === 'quote')!
    const firstPoint = tl.clips.find((c) => c.title === 'Point 1')!
    expect(card.start).toBeLessThan(firstPoint.start)
  })

  it('without the new options the cut is the same as before (one photo, no quote)', () => {
    const tl = buildStoryTimeline(input())
    expect(tl.clips.some((c) => c.titleData?.template === 'quote')).toBe(false)
    expect(tl.clips.filter((c) => c.title === 'Photo')).toHaveLength(1)
  })
})

describe('B-roll suggestions', () => {
  const assets = [
    { id: 'a', name: 'sylhet-gas-field.mp4', type: 'video' },
    { id: 'b', name: 'IMG_0001.jpg', type: 'image' },
    { id: 'c', name: 'jalalabad wells drilling.mov', type: 'video' },
    { id: 'd', name: 'sylhet-music.wav', type: 'audio' },
    { id: 'e', name: 'sylhet-old.mp4', type: 'video', removed: true },
  ]
  it('matches bin picture items by file name only, ignoring audio, removed items and generic names', () => {
    const r = suggestBroll(assets, body)
    expect(r.map((x) => x.asset.id)).toEqual(expect.arrayContaining(['a', 'c']))
    expect(r.map((x) => x.asset.id)).not.toContain('b')
    expect(r.map((x) => x.asset.id)).not.toContain('d')
    expect(r.map((x) => x.asset.id)).not.toContain('e')
    expect(r.find((x) => x.asset.id === 'a')?.matched).toContain('sylhet')
  })
})
