import { describe, it, expect, vi, afterEach } from 'vitest'
import { aiJson, loadAiSettings, saveAiSettings, aiFor, resolveModel, rankOpenAi, modelLabel } from '../../src/editorial/aiProviders'
import { aiSeo } from '../../src/editorial/aiDesk'
import { translateNewsArticle } from '../../src/editorial/translator'
import type { AiSchema } from '../../src/editorial/aiProviders'
import { sanitizeSeo, sanitizeCaptions, xLength, articleUrl, relinkCaptions, storyCaptions } from '../../src/editorial/aiDesk'
import { sanitizeFacebook } from '../../src/editorial/facebookCaption'

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
  it('a fresh install has no keys, so no AI job runs', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    const s = loadAiSettings()
    expect(s.keys).toEqual({ gemini: '', anthropic: '', openai: '', openrouter: '', custom: '' })
    for (const role of ['main', 'seo', 'social'] as const) expect(aiFor(role, s)).toBeNull()
  })

  it('settings saved before roles existed load with SEO and Social following the main provider', () => {
    vi.stubGlobal('localStorage', memoryStorage({ 'esb-banner-studio/ai-settings': JSON.stringify({ provider: 'anthropic', keys: { anthropic: 'sk-ant-1' } }) }))
    const s = loadAiSettings()
    expect(s).toMatchObject({ provider: 'anthropic', seo: '', social: '' })
    expect(aiFor('seo', s)).toEqual({ provider: 'anthropic', key: 'sk-ant-1', model: 'auto' })
  })

  it('keys are kept per provider', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    const s = loadAiSettings()
    saveAiSettings({ ...s, provider: 'anthropic', keys: { ...s.keys, gemini: ' AIza ', anthropic: 'sk-ant-1 ' } })
    expect(loadAiSettings().keys).toMatchObject({ gemini: 'AIza', anthropic: 'sk-ant-1' })
  })

  it('each job calls only the provider chosen for it — never a substitute', () => {
    const s = { ...loadAiSettings(), provider: 'anthropic' as const, seo: 'gemini' as const, social: '' as const, keys: { gemini: 'AIza', anthropic: 'sk-ant-1', openai: 'sk-oa', openrouter: '' } }
    expect(aiFor('main', s)?.provider).toBe('anthropic')
    expect(aiFor('seo', s)?.provider).toBe('gemini')
    expect(aiFor('social', s)?.provider).toBe('anthropic')
    // SEO's provider loses its key: SEO is off, it does not borrow the main provider's
    expect(aiFor('seo', { ...s, keys: { ...s.keys, gemini: '' } })).toBeNull()
    // main has no key: nothing else translates, even though other providers have keys
    expect(aiFor('main', { ...s, keys: { ...s.keys, anthropic: '' } })).toBeNull()
  })

  it('"auto" picks a real default per provider', () => {
    expect(resolveModel('anthropic', 'auto', [])).toBe('claude-sonnet-5-5')
    expect(resolveModel('gemini', 'auto', [{ id: 'gemini-3-pro', label: '' }, { id: 'gemini-3-flash', label: '' }])).toBe('gemini-3-flash')
    expect(resolveModel('openrouter', 'auto', [])).toBe('openrouter/auto')
    expect(resolveModel('openai', 'gpt-x', [])).toBe('gpt-x')
    expect(['gpt-5-mini', 'gpt-4o', 'gpt-5'].sort((a, b) => rankOpenAi(b) - rankOpenAi(a))[0]).toBe('gpt-5')
  })
})

describe('Model names in the activity strip', () => {
  it('reads as people say it', () => {
    expect(modelLabel('claude-sonnet-5-5')).toBe('Sonnet 5.5')
    expect(modelLabel('claude-opus-5')).toBe('Opus 5')
    expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(modelLabel('gemini-3-flash')).toBe('Gemini 3 Flash')
    expect(modelLabel('gpt-5')).toBe('gpt-5')
  })
})

describe('One structured call, four providers', () => {
  it('Claude: official SDK, browser header, strict schema, no sampling parameters', async () => {
    const fetch = vi.fn(async () => claudeStream('{"headline":"Petrobangla to drill two wells"}'))
    vi.stubGlobal('fetch', fetch)
    const r = await aiJson<{ headline: string }>({ provider: 'anthropic', key: 'sk-ant-test', model: 'claude-sonnet-5-5', system: 'sys', user: 'story', schema })
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
    // the system prompt is a cache breakpoint; effort is medium unless a short job asks for low
    expect(body.system).toEqual([{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }])
    expect(body.output_config.effort).toBe('medium')
  })

  it('Claude: short jobs run at low effort, and models that take no effort setting are not sent one', async () => {
    const fetch = vi.fn(async () => claudeStream('{"headline":"x"}'))
    vi.stubGlobal('fetch', fetch)
    await aiJson({ provider: 'anthropic', key: 'k', model: 'claude-sonnet-5-5', system: 's', user: 'u', schema, effort: 'low' })
    await aiJson({ provider: 'anthropic', key: 'k', model: 'claude-haiku-4-5', system: 's', user: 'u', schema, effort: 'low' })
    const bodies = fetch.mock.calls.map((c) => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)))
    expect(bodies[0].output_config.effort).toBe('low')
    expect(bodies[1].output_config).not.toHaveProperty('effort')
  })

  it('Claude: a reply cut off at max_tokens is an error, not a shorter answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => claudeStream('{"headline":"Petro', 'max_tokens')))
    await expect(aiJson({ provider: 'anthropic', key: 'k', model: 'claude-sonnet-5-5', system: 's', user: 'u', schema })).rejects.toThrow(/ran out of room/)
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

describe('The translation prompt is followed', () => {
  const reply = JSON.stringify({ headline: 'Grid expansion', deck: 'Two new lines.', slug: 'grid-expansion', focusKeywords: 'grid expansion', metaTitle: 'Grid expansion', metaDescription: 'x'.repeat(130), body: 'Officials will dig into the numbers at Rs. 40 crore.\n\nSecond paragraph.' })

  it("sends the editor's own prompt as the system prompt, ahead of the reply format, and rewrites none of the answer", async () => {
    const custom = 'Translate like a wire-service sub-editor. Spell out every acronym on first use.'
    vi.stubGlobal('localStorage', memoryStorage({ 'esb-banner-studio/ai-settings': JSON.stringify({ provider: 'anthropic', keys: { anthropic: 'sk-ant-1' }, prompt: custom }) }))
    const calls: { url: string; body: Record<string, unknown> }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes('/v1/models')) return new Response(JSON.stringify({ error: { message: 'no' } }), { status: 404 })
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) })
      return claudeStream(reply)
    }))
    const r = await translateNewsArticle({ title: 'শিরোনাম', paragraphs: ['এক', 'দুই'] })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages')
    const system = (calls[0].body.system as { text: string }[])[0].text
    expect(system.startsWith(custom)).toBe(true)
    expect(system).toContain('Reply format')
    expect(system).not.toContain('professional bilingual news editor') // the built-in prompt is not mixed in
    // the model's wording reaches the desk exactly as written: no "dig" to "drill", no "Rs." to "Tk"
    expect(r.body).toBe('Officials will dig into the numbers at Rs. 40 crore.\n\nSecond paragraph.')
    expect(r.provider).toBe('anthropic')
  })

  it('with no key for the main provider, no AI provider is called at all', async () => {
    vi.stubGlobal('localStorage', memoryStorage({ 'esb-banner-studio/ai-settings': JSON.stringify({ provider: 'anthropic', seo: 'gemini', keys: { gemini: 'AIza' } }) }))
    const hosts: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => { hosts.push(new URL(String(url)).host); return new Response('{}', { status: 500 }) }))
    await translateNewsArticle({ title: 'শিরোনাম', paragraphs: ['এক'] }).catch(() => {})
    expect(hosts).not.toContain('api.anthropic.com')
    expect(hosts).not.toContain('generativelanguage.googleapis.com')
  })
})

describe('Every provider receives the prompt, and each job reaches only its own provider', () => {
  const prompt = 'You are the desk. Follow this exact style: sentence case headlines.'
  const bodyOf = (init?: RequestInit) => JSON.parse(String(init?.body))

  it('the system prompt arrives in each provider\'s own system field, unaltered and first', async () => {
    const calls: Record<string, Record<string, any>> = {}
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('anthropic.com')) { calls.anthropic = bodyOf(init); return claudeStream('{"headline":"h"}') }
      if (u.includes('generativelanguage')) { calls.gemini = bodyOf(init); return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"headline":"h"}' }] } }] }), { status: 200 }) }
      const which = u.includes('openai.com') ? 'openai' : 'openrouter'
      calls[which] = bodyOf(init)
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"headline":"h"}' } }] }), { status: 200 })
    }))
    for (const [provider, model] of [['anthropic', 'claude-sonnet-5-5'], ['gemini', 'gemini-3-flash'], ['openai', 'gpt-5'], ['openrouter', 'x/y']] as const) {
      await aiJson({ provider, key: 'k', model, system: prompt, user: 'story text', schema })
    }
    expect(calls.anthropic.system[0].text).toBe(prompt)
    expect(calls.gemini.systemInstruction.parts[0].text).toBe(prompt)
    expect(calls.openai.messages[0]).toEqual({ role: 'system', content: prompt })
    expect(calls.openrouter.messages[0]).toEqual({ role: 'system', content: prompt })
    // the story is the user turn, never mixed into the instructions
    expect(calls.anthropic.messages[0].content).toBe('story text')
    expect(calls.gemini.contents[0].parts[0].text).toBe('story text')
  })

  it('main on Claude and SEO on Gemini: the translation never touches Gemini, the SEO call never touches Claude', async () => {
    vi.stubGlobal('localStorage', memoryStorage({ 'esb-banner-studio/ai-settings': JSON.stringify({ provider: 'anthropic', seo: 'gemini', keys: { anthropic: 'sk-ant-1', gemini: 'AIza-1' } }) }))
    const hosts: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
      const u = new URL(String(url))
      hosts.push(u.host)
      if (u.host === 'api.anthropic.com') return u.pathname === '/v1/models' ? new Response(JSON.stringify({ data: [], has_more: false }), { status: 200 }) : claudeStream(JSON.stringify({ headline: 'Grid expansion', deck: 'd', slug: 'grid', focusKeywords: 'grid', metaTitle: 'Grid', metaDescription: 'x'.repeat(130), body: 'One.\n\nTwo.' }))
      if (u.pathname.endsWith('/models')) return new Response(JSON.stringify({ models: [{ name: 'models/gemini-3-flash', supportedGenerationMethods: ['generateContent'] }] }), { status: 200 })
      return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ focusKeyphrase: 'grid expansion', tags: 'grid expansion', metaTitle: 'Grid expansion', metaDescription: 'x'.repeat(130), slug: 'grid-expansion' }) }] } }] }), { status: 200 })
    }))
    await translateNewsArticle({ title: 'শিরোনাম', paragraphs: ['এক', 'দুই'] })
    expect(new Set(hosts)).toEqual(new Set(['api.anthropic.com']))
    hosts.length = 0
    const seo = aiFor('seo')!
    await aiSeo(seo, { headline: 'Grid expansion', deck: 'Two new lines.', body: 'Grid expansion will add two lines.' })
    expect(new Set(hosts)).toEqual(new Set(['generativelanguage.googleapis.com']))
  })

  it('OpenAI GPT-4 class models are not asked for more output than they can give', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"headline":"h"}' } }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await aiJson({ provider: 'openai', key: 'k', model: 'gpt-4o', system: 's', user: 'u', schema, maxTokens: 32000 })
    await aiJson({ provider: 'openai', key: 'k', model: 'gpt-5', system: 's', user: 'u', schema, maxTokens: 32000 })
    const sent = fetch.mock.calls.map((c) => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)).max_completion_tokens)
    expect(sent).toEqual([16000, 32000])
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

describe('Captions link the article, except Facebook (its link is the first comment)', () => {
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
    expect(r.facebook).toBe('Two new wells.\nRead the detailed breakdown:\n\n#Energy')
    expect(r.facebook).not.toMatch(/https?:/)
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
    const { facebook, ...linked } = moved
    expect(Object.values(linked).every((v) => v.endsWith(articleUrl('new-slug')) && !v.includes('old-slug'))).toBe(true)
    expect(facebook).not.toMatch(/https?:/)
    expect(relinkCaptions(moved, '')).toEqual(moved)
  })
  it('the template captions read as news: headline, desk hashtags on one last line, the link on every post but Facebook', () => {
    const c = storyCaptions({ headline: 'Petrobangla to drill two new wells in Sylhet gas field', deck: 'BAPEX will drill the wells.', categoryId: '03', slug: 'sylhet-gas-field-two-new-wells' })
    expect(c.facebook).toBe('Petrobangla to drill two new wells in Sylhet gas field\n\n#FossilFuels #EnergyPrices #Bangladesh #ESBPowerLine')
    expect(c.facebook).not.toMatch(/⚡|https?:/)
    for (const [k, v] of Object.entries(c)) if (k !== 'facebook') expect(v.endsWith(articleUrl('sylhet-gas-field-two-new-wells'))).toBe(true)
    expect(xLength(c.x)).toBeLessThanOrEqual(280)
  })
})


describe('The Facebook caption shape', () => {
  it('drops links, keeps two short lines of text and puts every hashtag on one last line', () => {
    const r = sanitizeFacebook('Two wells for Sylhet.\nBAPEX starts drilling in March.\nThird line is cut.\nRead more https://esbpowerline.com/articles/x #LNG #Bangladesh\n#Energy #lng #ESBPowerLine #Extra #More')
    expect(r).not.toMatch(/https?:/)
    const [text, tags] = r.split('\n\n')
    expect(text.split('\n')).toHaveLength(2)
    expect(text.length).toBeLessThanOrEqual(125)
    expect(tags).not.toContain('\n')
    expect(tags.split(' ').length).toBeLessThanOrEqual(5)
    expect(tags.endsWith('#ESBPowerLine')).toBe(true)
    expect(tags.match(/#lng/gi)).toHaveLength(1)
  })
  it('never exceeds 125 characters of text, so there is no See more', () => {
    const long = 'Bangladesh has signed a very long agreement with several suppliers to bring liquefied natural gas into the country over the next fifteen years under a new deal. '.repeat(3)
    const text = sanitizeFacebook(long + '\n\n#LNG').split('\n\n')[0]
    expect(text.length).toBeLessThanOrEqual(126)
  })
  it('falls back to the headline when the caption is empty or only a link', () => {
    expect(sanitizeFacebook('https://esbpowerline.com/articles/x', 'Gas output rises 12%')).toBe('Gas output rises 12%')
  })
})
