// @vitest-environment jsdom
// "Fix all with AI" (outreachAi.ts fixLetterWithAi) — the Letter job told exactly which problems a checklist found,
// mirroring Editorial's seoFix.ts: fix only what's named, same facts-locked guard as every other Letter call.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadAiSettings, saveAiSettings } from '../../src/editorial/aiProviders'
import { STAND_IN } from '../../src/outreach/campaign'
import { fixLetterWithAi, type LetterContext, type LetterProblem } from '../../src/outreach/outreachAi'

const geminiOk = (data: Record<string, string>) =>
  new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(data) }] } }] }), { status: 200 })

const ctx: LetterContext = { blueprint: 'blank', lang: 'en', housePrompt: '', sources: [] }
const problems: LetterProblem[] = [{ text: 'Long subject: 82 characters.' }, { text: 'Figures not in any source: 1,200' }]

describe('fixLetterWithAi', () => {
  beforeEach(() => {
    localStorage.clear()
    const s = loadAiSettings()
    saveAiSettings({ ...s, keys: { ...s.keys, gemini: 'test-key' } })
  })

  it('refuses with nothing to fix rather than spending a call', async () => {
    await expect(fixLetterWithAi({ subject: 'S', body: 'B' }, [], ctx)).rejects.toThrow('Nothing to fix')
  })

  it('sends exactly the given problems and applies the sanitised result', async () => {
    const fetch = vi.fn(async () => geminiOk({ subject: 'Fixed subject', body: 'Fixed body text', variants: 'A\nB\nC' }))
    vi.stubGlobal('fetch', fetch)
    const r = await fixLetterWithAi({ subject: 'Old subject that runs far too long for a letter', body: 'Old body' }, problems, ctx)
    expect(r.subject).toBe('Fixed subject')
    expect(r.body).toBe('Fixed body text')
    const body = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    const sent = JSON.stringify(body)
    expect(sent).toContain('Long subject: 82 characters.')
    expect(sent).toContain('Figures not in any source: 1,200')
    expect(sent).toContain('Fix ONLY the problems listed below')
    vi.unstubAllGlobals()
  })

  it('still refuses a draft that names the example recipient instead of a placeholder', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({ subject: 'S', body: 'Dear Mr. Kamal Hossain, thank you.', variants: '' })))
    const withExample: LetterContext = { ...ctx, example: { ...STAND_IN, email: 'kamal@example.com', personName: 'Kamal Hossain' } }
    await expect(fixLetterWithAi({ subject: 'S', body: 'B' }, problems, withExample)).rejects.toThrow(/Kamal Hossain/)
    vi.unstubAllGlobals()
  })
})
