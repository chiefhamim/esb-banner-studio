// News engine (shared, identical in both apps): English lines under Bangla headlines.
import { describe, expect, it } from 'vitest'
import { applyHeadlineCache, batchHeadlines, headlinesToTranslate, translateHeadlines } from './headlineEn'

const rows: { key: string; title: string; titleEn?: string }[] = [
  { key: 'a', title: 'বিদ্যুতের দাম বাড়ছে না' },
  { key: 'b', title: 'Petrobangla buys LNG' },
  { key: 'c', title: 'গ্যাস সংকটে বন্ধ সার কারখানা' },
]

describe('headline translation', () => {
  it('asks only for Bangla headlines without a line yet', () => {
    expect(headlinesToTranslate(rows, { c: 'x' }).map((r) => r.key)).toEqual(['a'])
  })
  it('batches under the size limit', () => {
    expect(batchHeadlines(rows, 30).length).toBe(3)
    expect(batchHeadlines(rows, 800).length).toBe(1)
  })
  it('sends a batch as one request and keeps lines with their stories', async () => {
    const calls: string[] = []
    const out = await translateHeadlines([rows[0], rows[2]], async (t) => { calls.push(t); return 'Power price not rising\nFertiliser factory shut by gas crisis' })
    expect(calls).toHaveLength(1)
    expect(out).toEqual({ a: 'Power price not rising', c: 'Fertiliser factory shut by gas crisis' })
  })
  it('falls back to one by one when the line count does not match, and skips failures', async () => {
    const out = await translateHeadlines([rows[0], rows[2]], async (t) => (t.includes('\n') ? 'one line only' : t.startsWith('বিদ্যু') ? 'Power price' : null))
    expect(out).toEqual({ a: 'Power price' })
  })
  it('applies the cache without changing untouched arrays', () => {
    expect(applyHeadlineCache(rows, {})).toBe(rows)
    expect(applyHeadlineCache(rows, { a: 'X' })[0].titleEn).toBe('X')
  })
})
