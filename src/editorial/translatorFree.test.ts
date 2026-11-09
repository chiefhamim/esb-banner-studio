// The free translation path: results stay aligned with the paragraphs, requests are limited, AI fallback leaves a notice.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { translateParagraphsBatch, translationNoticeFor } from './translator'

afterEach(() => { vi.unstubAllGlobals() })

const gtx = (text: string) => new Response(JSON.stringify([[[text, 'x']]]), { status: 200 })

describe('translateParagraphsBatch', () => {
  it('keeps result i for paragraph i, empty paragraphs included', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => gtx('One.\n\nTwo.')))
    const r = await translateParagraphsBatch(['এক।', '', 'দুই।'])
    expect(r).toEqual(['One.', '', 'Two.'])
  })
  it('has at most three requests in flight', async () => {
    let live = 0
    let peak = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      live++; peak = Math.max(peak, live)
      await new Promise((r) => setTimeout(r, 5))
      live--
      return gtx('Done.')
    }))
    // each paragraph is over GTX_MAX, so each is its own batch
    const long = 'বিদ্যুৎ উৎপাদন বাড়ছে। '.repeat(45)
    const r = await translateParagraphsBatch([long, long, long, long, long, long])
    expect(r).toHaveLength(6)
    expect(peak).toBeLessThanOrEqual(3)
  })
})

describe('translationNoticeFor', () => {
  it('keeps the AI failure as a lasting notice', () => {
    expect(translationNoticeFor({ translationNote: 'Gemini could not translate this story (timeout); this is the free machine translation.' })).toMatch(/Gemini could not/)
    expect(translationNoticeFor({})).toBeNull()
  })
})
