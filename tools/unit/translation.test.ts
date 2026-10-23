import { describe, it, expect, vi, afterEach } from 'vitest'
import { chunkForTranslation, translateComplete, MYMEMORY_MAX } from '../../src/editorial/translateNet'
import { translateNewsArticle } from '../../src/editorial/translator'

const sentence = (n: number) => `পেট্রোবাংলা জানিয়েছে যে প্রকল্প ${n} এর কাজ নির্ধারিত সময়ে শেষ হবে এবং দৈনিক গ্যাস সরবরাহ বাড়বে।`
const longParagraph = Array.from({ length: 14 }, (_, i) => sentence(i + 1)).join(' ')

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('Translation completeness', () => {
  it('splits long Bengali at sentence ends into pieces MyMemory accepts whole', () => {
    expect(longParagraph.length).toBeGreaterThan(MYMEMORY_MAX)
    const chunks = chunkForTranslation(longParagraph)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(MYMEMORY_MAX)
    // every chunk ends a sentence, and nothing is lost or reordered
    for (const c of chunks) expect(c.endsWith('।')).toBe(true)
    expect(chunks.join(' ')).toBe(longParagraph)
  })

  it('translates every chunk — the last sentences of a long paragraph survive', async () => {
    // A fake MyMemory that answers fastest; GTX never answers. The old code sent MyMemory the first 500 characters
    // and returned its answer as the whole paragraph.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('mymemory')) {
        const q = decodeURIComponent(/q=([^&]*)/.exec(url)![1])
        if (q.length > MYMEMORY_MAX) return new Response('{"responseStatus":403}', { status: 200 })
        const nums = [...q.matchAll(/প্রকল্প (\d+)/g)].map((m) => `Project ${m[1]} will finish on time.`)
        return new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: nums.join(' ') } }), { status: 200 })
      }
      return new Promise<Response>(() => {})
    }))
    const out = await translateComplete(longParagraph, 500)
    expect(out).toContain('Project 1 will')
    expect(out).toContain('Project 14 will finish on time.')
  })

  it('a Gemini reply cut off by the token limit is not accepted as the article', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'gemini-2.5-flash', setItem: () => {} })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/models?')) return new Response(JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }), { status: 200 })
      if (url.includes(':generateContent')) {
        const half = JSON.stringify({ headline: 'Petrobangla to drill two wells', deck: 'd', slug: 's', focusKeywords: 'k', metaTitle: 'm', metaDescription: 'm', body: 'First paragraph only.' })
        return new Response(JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: half }] } }] }), { status: 200 })
      }
      // the free services are unreachable in this test
      return new Response('', { status: 503 })
    }))
    await expect(translateNewsArticle({ title: 'শিরোনাম', paragraphs: ['প্রথম অনুচ্ছেদ।'], apiKey: 'test-key', throwOnAiFailure: true })).rejects.toThrow(/stopped early/)
  })
})
