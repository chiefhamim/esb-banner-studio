// @vitest-environment jsdom
// W6 — AI efficiency: escalate a translation to a stronger model only when its figures disagree with the source,
// pick that model from the existing rankings, keep Claude's cache breakpoint, and record/price token usage honestly.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiscrepancyFlag } from '../../src/editorial/facts'

vi.mock('../../src/editorial/translator', () => ({ translateNewsArticle: vi.fn() }))

import {
  ESCALATE_MIN_FLAGS, aiFor, aiJson, decideEscalation, estimateCallCost, estimateCost, loadAiSettings, runWithModel, saveAiSettings,
  strongerModel, useAiUsage, usageByStory,
} from '../../src/editorial/aiProviders'
import { escalateTranslation } from '../../src/editorial/automation'
import { translateNewsArticle } from '../../src/editorial/translator'

const flag = (kind: DiscrepancyFlag['kind'], text = 'x'): DiscrepancyFlag => ({ field: 'draft', text, kind, severity: kind === 'unverified_quote' ? 'warning' : 'error', message: text })

beforeEach(() => { localStorage.clear(); useAiUsage.getState().reset() })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('decideEscalation', () => {
  it('escalates on any figure that is not in the source', () => {
    expect(decideEscalation([flag('unverified_number', '592')], { enabled: true })).toMatchObject({ escalate: true, figures: 1 })
    expect(decideEscalation([flag('unverified_currency', 'Tk 50 crore')], { enabled: true }).why).toMatch(/1 figure not in the source/)
  })
  it(`escalates on ${ESCALATE_MIN_FLAGS}+ name/date flags, never on quotes alone`, () => {
    expect(decideEscalation([flag('unverified_entity'), flag('unverified_date')], { enabled: true }).escalate).toBe(false)
    expect(decideEscalation([flag('unverified_entity'), flag('unverified_date'), flag('unverified_entity')], { enabled: true }).escalate).toBe(true)
    expect(decideEscalation(Array.from({ length: 10 }, () => flag('unverified_quote')), { enabled: true }).escalate).toBe(false)
  })
  it('never escalates a clean draft, and never when the editor has not opted in', () => {
    expect(decideEscalation([], { enabled: true })).toMatchObject({ escalate: false })
    expect(decideEscalation([flag('unverified_number')], { enabled: false })).toMatchObject({ escalate: false })
  })
})

describe('strongerModel', () => {
  it('Gemini: the top of rankGemini from the listed models (Pro over Flash), none when already there', () => {
    const listed = ['gemini-2.5-flash', 'gemini-3-flash', 'gemini-3-pro', 'gemini-3-pro-preview'].map((id) => ({ id, label: id }))
    expect(strongerModel('gemini', 'gemini-3-flash', listed)).toBe('gemini-3-pro')
    expect(strongerModel('gemini', 'gemini-3-pro', listed)).toBeNull()
    expect(strongerModel('gemini', 'gemini-3-flash', [])).toBeNull()
  })
  it('OpenAI: the top of rankOpenAi (full over mini)', () => {
    const listed = ['gpt-5-mini', 'gpt-5', 'gpt-5-nano'].map((id) => ({ id, label: id }))
    expect(strongerModel('openai', 'gpt-5-mini', listed)).toBe('gpt-5')
    expect(strongerModel('openai', 'gpt-5', listed)).toBeNull()
  })
  it('Claude: Opus over Sonnet (the newest Opus listed, else Opus 5.5); none from Opus', () => {
    expect(strongerModel('anthropic', 'claude-sonnet-5-5', [])).toBe('claude-opus-5-5')
    expect(strongerModel('anthropic', 'claude-sonnet-5-5', ['claude-opus-4-8', 'claude-opus-5', 'claude-sonnet-5-5'].map((id) => ({ id, label: id })))).toBe('claude-opus-5')
    expect(strongerModel('anthropic', 'claude-opus-5-5', [])).toBeNull()
  })
  it('OpenRouter: no ranking exists, so no escalation is offered', () => {
    expect(strongerModel('openrouter', 'openrouter/auto', [{ id: 'x', label: 'x' }])).toBeNull()
  })
})

describe('settings and the model override', () => {
  it('escalation is off by default and saved per role', () => {
    expect(loadAiSettings().escalate?.main ?? false).toBe(false)
    saveAiSettings({ ...loadAiSettings(), escalate: { main: true } })
    expect(loadAiSettings().escalate).toEqual({ main: true })
  })
  it('runWithModel changes the model aiFor gives that role, for the synchronous call only', () => {
    saveAiSettings({ ...loadAiSettings(), keys: { ...loadAiSettings().keys, gemini: 'test-key-not-real' } })
    expect(runWithModel('main', 'gemini-3-pro', () => aiFor('main')?.model)).toBe('gemini-3-pro')
    expect(runWithModel('main', 'gemini-3-pro', () => aiFor('seo')?.model)).toBe('auto')
    expect(aiFor('main')?.model).toBe('auto')
  })
})

describe('escalateTranslation (the automation hook)', () => {
  const src = { title: 'শিরোনাম', deck: '', paragraphs: ['প্রকল্পে ৫৯২ কোটি টাকা ব্যয় হবে।'] }
  const cheap = { headline: 'Project to cost Tk 529 crore', deck: '', slug: 's', focusKeywords: '', metaTitle: '', metaDescription: '', body: 'The project will cost Tk 529 crore.', provider: 'anthropic' as const, modelUsed: 'claude-sonnet-5-5' }
  const strong = { ...cheap, headline: 'Project to cost Tk 592 crore', body: 'The project will cost Tk 592 crore.', modelUsed: 'claude-opus-5-5' }
  // the model list is never fetched for real: any network attempt is refused
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network disabled in tests') })) })
  const setUp = (escalate: boolean) => saveAiSettings({ ...loadAiSettings(), provider: 'anthropic', keys: { ...loadAiSettings().keys, anthropic: 'test-key-not-real' }, escalate: { main: escalate } })

  it('re-runs on the stronger model when a figure is off, keeps the better draft and logs "Escalated to …"', async () => {
    setUp(true)
    vi.mocked(translateNewsArticle).mockImplementationOnce(async () => { expect(aiFor('main')?.model).toBe('claude-opus-5-5'); return strong })
    const steps: string[] = []
    const out = await escalateTranslation(cheap, src, (s) => steps.push(s))
    expect(out).toBe(strong)
    expect(steps[0]).toMatch(/^Escalated to Opus 5\.5: 2 figures not in the source/) // Tk 529 in the headline and the body
    expect(vi.mocked(translateNewsArticle).mock.calls[0][0]).toMatchObject({ throwOnAiFailure: true })
  })
  it('does nothing when off, when clean, or for the free translation', async () => {
    setUp(false)
    expect(await escalateTranslation(cheap, src)).toBe(cheap)
    setUp(true)
    expect(await escalateTranslation(strong, src)).toBe(strong)
    expect(await escalateTranslation({ ...cheap, provider: 'neural' }, src)).toMatchObject({ provider: 'neural' })
    expect(translateNewsArticle).not.toHaveBeenCalled()
  })
  it('keeps the first draft when the stronger model fails', async () => {
    setUp(true)
    vi.mocked(translateNewsArticle).mockRejectedValueOnce(new Error('Claude rate limit reached'))
    const steps: string[] = []
    expect(await escalateTranslation(cheap, src, (s) => steps.push(s))).toBe(cheap)
    expect(steps[1]).toMatch(/kept the first translation/i)
  })
})

describe('Claude request keeps its cache breakpoint; usage is recorded and priced', () => {
  const sse = (events: [string, unknown][]) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('')
  it('sends cache_control on the system prompt, with the story after the cached prefix', async () => {
    let body: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body))
      const stream = sse([
        ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 900, output_tokens: 1, cache_read_input_tokens: 1200, cache_creation_input_tokens: 0 } } }],
        ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{"ok":"yes"}' } }],
        ['content_block_stop', { type: 'content_block_stop', index: 0 }],
        ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 40 } }],
        ['message_stop', { type: 'message_stop' }],
      ])
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream', 'request-id': 'req_1' } })
    }))
    await aiJson({ provider: 'anthropic', key: 'test-key-not-real', model: 'claude-sonnet-5-5', system: 'SYSTEM PROMPT', user: 'Bengali news article to translate:\n\nSTORY', schema: { type: 'object', properties: { ok: { type: 'string', description: 'yes' } }, required: ['ok'] } })
    expect(body.system).toEqual([{ type: 'text', text: 'SYSTEM PROMPT', cache_control: { type: 'ephemeral' } }])
    expect(JSON.stringify(body.messages)).toContain('STORY')
    expect(JSON.stringify(body.messages)).not.toContain('SYSTEM PROMPT')
    const calls = useAiUsage.getState().calls
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ provider: 'anthropic', input: 900, cacheRead: 1200, output: 40 })
    // Sonnet 5.5: 900 x $2 + 1200 x $0.20 + 40 x $10 per million
    expect(estimateCallCost(calls[0])).toBeCloseTo((900 * 2 + 1200 * 0.2 + 40 * 10) / 1e6, 10)
  })

  it('records Gemini usage (cached tokens split out) but does not price it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"ok":"yes"}' }] } }], usageMetadata: { promptTokenCount: 1000, cachedContentTokenCount: 400, candidatesTokenCount: 50, thoughtsTokenCount: 30 } }), { status: 200 })))
    await aiJson({ provider: 'gemini', key: 'test-key-not-real', model: 'gemini-3-flash', system: 's', user: 'u', schema: { type: 'object', properties: { ok: { type: 'string', description: 'yes' } }, required: ['ok'] } })
    const c = useAiUsage.getState().calls[0]
    expect(c).toMatchObject({ provider: 'gemini', input: 600, cacheRead: 400, output: 80 })
    expect(estimateCost([c])).toEqual({ dollars: 0, priced: 0, unpriced: 1 })
  })

  it('splits usage per story by the job that was running', () => {
    const jobs = [
      { id: 1, story: 'a', kind: 'story' as const, title: '', by: '', start: 100, end: 200, steps: [] },
      { id: 2, story: 'b', kind: 'seo' as const, title: '', by: '', start: 300, end: 400, steps: [] },
    ]
    const c = (at: number) => ({ at, provider: 'anthropic', model: 'claude-sonnet-5-5', input: 10, cacheRead: 0, cacheWrite: 0, output: 5 })
    const rows = usageByStory([c(150), c(160), c(350), c(500)], jobs)
    expect(rows.map((r) => [r.story, r.calls])).toEqual([['b', 1], ['a', 2], ['', 1]])
    expect(rows[1].prompt).toBe(20)
  })
})
