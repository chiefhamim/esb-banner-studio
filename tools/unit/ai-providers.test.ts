import { describe, it, expect, vi, afterEach } from 'vitest'
import { aiJson, loadAiSettings, saveAiSettings, activeAi, resolveModel, rankOpenAi } from '../../src/editorial/aiProviders'
import type { AiSchema } from '../../src/editorial/aiProviders'
import { sanitizeSeo, sanitizeCaptions, xLength, articleUrl, relinkCaptions, storyCaptions } from '../../src/editorial/aiDesk'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

const schema: AiSchema = { type: 'object', properties: { headline: { type: 'string', description: 'h' } }, required: ['headline'] }

function memoryStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }
}

/** A Messages API stream, as Anthropic sends it, carrying one text block. */
function claudeStream(text: string, stop = 'end_turn') {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  const body = [
    ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } }),
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
    ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } }),
    ev('content_block_stop', { index: 0 }),
    ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 20 } }),
    ev('message_stop', {}),
  ].join('')
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

describe('AI settings', () => {
  it('a Gemini key saved by an older build carries over as the active provider', () => {
    vi.stubGlobal('localStorage', memoryStorage({ 'esb-banner-studio/ai-key': 'AIzaOLD', 'esb-banner-studio/ai-model': 'gemini-2.5-pro' }))
    const s = loadAiSettings()
    expect(s.provider).toBe('gemini')
    expect(s.keys.gemini).toBe('AIzaOLD')
    expect(activeAi(s)).toEqual({ provider: 'gemini', key: 'AIzaOLD', model: 'gemini-2.5-pro' })
  })

  it('keys are kept per provider, and only the chosen provider is active', () => {
    const store = memoryStorage()
    vi.stubGlobal('localStorage', store)
    const s = loadAiSettings()
    saveAiSettings({ ...s, provider: 'anthropic', keys: { ...s.keys, gemini: ' AIza ', anthropic: 'sk-ant-1 ' } })
    const back = loadAiSettings()
    expect(back.keys).toMatchObject({ gemini: 'AIza', anthropic: 'sk-ant-1' })
    expect(activeAi(back)?.provider).toBe('anthropic')
    expect(activeAi({ ...back, provider: 'openai' })).toBeNull()
  })

  it('"auto" picks a real default per provider', () => {
    expect(resolveModel('anthropic', 'auto', [])).toBe('claude-opus-5-5')
    expect(resolveModel('gemini', 'auto', [{ id: 'gemini-3-pro', label: '' }, { id: 'gemini-3-flash', label: '' }])).toBe('gemini-3-flash')
    expect(resolveModel('openrouter', 'auto', [])).toBe('openrouter/auto')
    expect(resolveModel('openai', 'gpt-x', [])).toBe('gpt-x')
    expect(['gpt-5-mini', 'gpt-4o', 'gpt-5'].sort((a, b) => rankOpenAi(b) - rankOpenAi(a))[0]).toBe('gpt-5')
  })
})

describe('One structured call, four providers', () => {
  it('Claude: official SDK, browser header, strict schema, no sampling parameters', async () => {
    const fetch = vi.fn(async () => claudeStream('{"headline":"Petrobangla to drill two wells"}'))
    vi.stubGlobal('fetch', fetch)
    const r = await aiJson<{ headline: string }>({ provider: 'anthropic', key: 'sk-ant-test', model: 'claude-opus-5-5', system: 'sys', user: 'story', schema })
    expect(r.data.headline).toBe('Petrobangla to drill two wells')
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(url)).toBe('https://api.anthropic.com/v1/messages')
    const h = new Headers(init.headers)
    expect(h.get('authorization')).toBe('Bearer sk-ant-test')
    expect(h.get('anthropic-dangerous-direct-browser-access')).toBe('true')
    const body = JSON.parse(String(init.body))
    expect(body.stream).toBe(true)
    expect(body.output_config.format).toEqual({ type: 'json_schema', schema: { ...schema, additionalProperties: false } })
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('thinking')
  })

  it('Claude: a reply cut off at max_tokens is an error, not a shorter answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => claudeStream('{"headline":"Petro', 'max_tokens')))
    await expect(aiJson({ provider: 'anthropic', key: 'k', model: 'claude-opus-5-5', system: 's', user: 'u', schema })).rejects.toThrow(/ran out of room/)
  })

  it('OpenAI: strict json_schema, and a length stop is refused', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ model: 'gpt-5', choices: [{ finish_reason: 'length', message: { content: '{"headline":"x"' } }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await expect(aiJson({ provider: 'openai', key: 'sk-1', model: 'gpt-5', system: 's', user: 'u', schema })).rejects.toThrow(/stopped early/)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    const body = JSON.parse(String(init.body))
    expect(body.response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true, schema: { additionalProperties: false } } })
    expect(body.max_completion_tokens).toBeGreaterThan(0)
  })

  it('OpenRouter: retries in JSON mode when a model takes no schema', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'response_format json_schema not supported' } }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '```json\n{"headline":"Grid"}\n```' } }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const r = await aiJson<{ headline: string }>({ provider: 'openrouter', key: 'sk-or', model: 'meta-llama/x', system: 's', user: 'u', schema })
    expect(r.data.headline).toBe('Grid')
    expect(JSON.parse(String((fetch.mock.calls[1] as [string, RequestInit])[1].body)).response_format).toEqual({ type: 'json_object' })
  })

  it('Gemini: OpenAPI schema dialect, and a safety stop is refused', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await expect(aiJson({ provider: 'gemini', key: 'AIza', model: 'gemini-3-flash', system: 's', user: 'u', schema })).rejects.toThrow(/stopped early \(SAFETY\)/)
    const body = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(body.generationConfig.responseSchema).toEqual({ type: 'OBJECT', properties: { headline: { type: 'STRING', description: 'h' } }, required: ['headline'] })
  })
})

const story = {
  headline: 'Petrobangla to drill two new wells in Sylhet gas field for Tk 592 crore',
  deck: 'BAPEX will drill the wells, which are expected to add 30 MMCFD of gas to the national grid.',
  body: 'Petrobangla has taken an initiative to drill two new development wells under the Sylhet gas field, officials said on Sunday.\n\nThe project, to be implemented by BAPEX, is estimated to cost Tk 592 crore and will supply 30 MMCFD of gas per day to the national grid.',
}

describe('AI SEO is held to the site rules', () => {
  it('keeps a good answer as given', () => {
    const r = sanitizeSeo(story, { focusKeyphrase: 'Sylhet gas field', tags: 'Sylhet gas field, BAPEX, Petrobangla', metaTitle: 'Sylhet gas field: Petrobangla to drill two new wells', metaDescription: 'Petrobangla will drill two new development wells in the Sylhet gas field through BAPEX, adding 30 MMCFD of gas to the national grid, officials said.', slug: 'sylhet-gas-field-petrobangla-two-new-wells' })
    expect(r.focusKeyphrase).toBe('Sylhet gas field')
    expect(r.metaTitle).toBe('Sylhet gas field: Petrobangla to drill two new wells')
    expect(r.slug).toBe('sylhet-gas-field-petrobangla-two-new-wells')
    expect(r.focusKeywords.split(', ')[0]).toBe('Sylhet gas field')
  })

  it('strips a site name, rebuilds a long title, swaps a keyphrase the story never uses, rebuilds a dated slug', () => {
    const r = sanitizeSeo(story, { focusKeyphrase: 'LNG import crisis', tags: '#Energy', metaTitle: 'Petrobangla to drill two new wells in Sylhet gas field for Tk 592 crore | ESB PowerLine', metaDescription: 'Too short.', slug: 'esb-powerline-2026-petrobangla-wells' })
    expect(r.focusKeyphrase).not.toBe('LNG import crisis')
    expect(story.body.toLowerCase()).toContain(r.focusKeyphrase.toLowerCase())
    expect(r.metaTitle).not.toMatch(/ESB PowerLine/)
    expect(r.metaTitle.length).toBeLessThanOrEqual(60)
    expect(r.metaDescription.length).toBeLessThanOrEqual(160)
    expect(r.slug).not.toMatch(/2026|esb/)
    expect(r.slug.length).toBeLessThanOrEqual(75)
  })
})

describe('AI captions always link the article', () => {
  const url = articleUrl('sylhet-gas-field-two-new-wells')
  it('the site is served at /articles/{slug}', () => {
    expect(url).toBe('https://esbpowerline.com/articles/sylhet-gas-field-two-new-wells')
  })
  it('a bare site link becomes the article link in place; a missing one is added last; guessed paths go', () => {
    const r = sanitizeCaptions({
      facebook: 'Two new wells.\n\nRead the detailed breakdown: https://esbpowerline.com\n\n#Energy',
      x: 'Two new wells for Sylhet.',
      linkedin: 'Sector news. https://esbpowerline.com/news/made-up and again https://www.esbpowerline.com/x',
      telegram: '',
    }, url)
    expect(r.facebook).toBe(`Two new wells.\n\nRead the detailed breakdown: ${url}\n\n#Energy`)
    expect(r.x).toBe(`Two new wells for Sylhet.\n\n${url}`)
    expect(r.linkedin.match(/esbpowerline\.com/g)).toHaveLength(1)
    expect(r.linkedin).toContain(url)
    expect(r.telegram).toBe(url)
  })
  it('the X post fits 280 with the link counted as 23', () => {
    const r = sanitizeCaptions({ x: 'word '.repeat(80) }, url)
    expect(xLength(r.x)).toBeLessThanOrEqual(280)
    expect(r.x.endsWith(url)).toBe(true)
  })
  it('a new slug moves every caption link with it; an emptied slug leaves them alone', () => {
    const c = sanitizeCaptions({ facebook: 'News.', x: 'News.', linkedin: 'News.', telegram: 'News.' }, articleUrl('old-slug'))
    const moved = relinkCaptions(c, 'new-slug')
    expect(Object.values(moved).every((v) => v.endsWith(articleUrl('new-slug')) && !v.includes('old-slug'))).toBe(true)
    expect(relinkCaptions(moved, '')).toEqual(moved)
  })
  it('the template captions read as news: headline, deck, a few desk hashtags, the link — no highlight posing as a figure', () => {
    const c = storyCaptions({ headline: 'Petrobangla to drill two new wells in Sylhet gas field', deck: 'BAPEX will drill the wells.', categoryId: '03', slug: 'sylhet-gas-field-two-new-wells' })
    expect(c.facebook).toBe(`Petrobangla to drill two new wells in Sylhet gas field\n\nBAPEX will drill the wells.\n\n#ESBPowerLine #FossilFuels #EnergyPrices\n\n${articleUrl('sylhet-gas-field-two-new-wells')}`)
    expect(c.facebook).not.toMatch(/⚡/)
    for (const v of Object.values(c)) expect(v.endsWith(articleUrl('sylhet-gas-field-two-new-wells'))).toBe(true)
    expect(xLength(c.x)).toBeLessThanOrEqual(280)
  })
})
