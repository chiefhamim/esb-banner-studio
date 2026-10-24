import { describe, it, expect } from 'vitest'
import { buildStoryTimeline, holdFor, storyPoints } from '../../src/video/storyVideo'

const body = 'Petrobangla will drill two new wells in Sylhet this winter. The wells are expected to add 30 MMCFD to the grid. Officials said the project will cost Tk 592 crore.\n\nOfficials said the project will cost Tk 592 crore. Work begins in December.'

describe('story → video', () => {
  it('takes the deck then the body’s sentences, in order, without repeats or fragments', () => {
    const p = storyPoints('Two new wells in Sylhet are set to raise gas supply.', body)
    expect(p).toEqual([
      'Two new wells in Sylhet are set to raise gas supply.',
      'Petrobangla will drill two new wells in Sylhet this winter.',
      'The wells are expected to add 30 MMCFD to the grid.',
      'Officials said the project will cost Tk 592 crore.',
    ])
    expect(p.join(' ')).not.toMatch(/Work begins/) // capped at four points; "Work begins in December." is too short anyway
  })

  it('every caption word comes from the draft', () => {
    const deck = 'Two new wells in Sylhet are set to raise gas supply.'
    const words = new Set(`${deck} ${body}`.split(/\s+/))
    for (const p of storyPoints(deck, body)) for (const w of p.split(/\s+/)) expect(words.has(w)).toBe(true)
  })

  it('holds each caption long enough to read, between 4 and 9 seconds', () => {
    expect(holdFor('Short line here')).toBe(4)
    expect(holdFor(Array(40).fill('word').join(' '))).toBe(9)
    expect(holdFor(Array(13).fill('word').join(' '))).toBeCloseTo(6.2, 1)
  })

  it('builds a contiguous cut: banner, photo under the captions, close; the duration covers every clip', () => {
    const tl = buildStoryTimeline({ aspect: '9:16', headline: 'Two new wells to add 30 MMCFD of gas', deck: 'Two new wells in Sylhet are set to raise gas supply.', body, desk: 'Fossil Fuels & Commodities', credit: 'Petrobangla', bannerUrl: 'blob:banner', photoUrl: 'blob:photo' })
    expect([tl.width, tl.height]).toEqual([1080, 1920])
    const v1 = tl.clips.filter((c) => c.trackId === 'v1').sort((a, b) => a.start - b.start)
    expect(v1.map((c) => c.sourceUrl)).toEqual(['blob:banner', 'blob:photo', 'blob:photo'])
    expect(v1.every((c) => c.still)).toBe(true)
    expect(v1.map((c) => !!c.branded)).toEqual([true, false, false]) // no station bug over the banner's own masthead
    for (let i = 1; i < v1.length; i++) expect(v1[i].start).toBeCloseTo(v1[i - 1].start + v1[i - 1].duration, 5)
    const end = Math.max(...tl.clips.map((c) => c.start + c.duration))
    expect(tl.duration).toBeGreaterThanOrEqual(end - 1e-9)
    expect(tl.clips.find((c) => c.trackId === 'v2')?.overlayText).toBe('Fossil Fuels & Commodities')
    expect(tl.clips.filter((c) => c.trackId === 'c1').at(-1)?.captionText).toBe('Read the full story on esbpowerline.com')
  })

  it('without a banner the headline is set as an overlay instead', () => {
    const tl = buildStoryTimeline({ aspect: '16:9', headline: 'H', deck: '', body, desk: 'D', bannerUrl: null, photoUrl: 'blob:p' })
    expect(tl.clips.some((c) => c.overlayType === 'headline' && c.overlayText === 'H')).toBe(true)
  })
})
