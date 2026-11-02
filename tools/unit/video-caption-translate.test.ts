import { describe, it, expect } from 'vitest'
import { numberedInput, parseNumbered, translateCaptionLines, translatedClips, captionSources } from '../../src/video/ai/captionTranslate'
import { numbersIn, numbersNotIn, TEXT_AI_OFF, TEXT_AI_NO_KEY, runTextAi } from '../../src/video/ai/aiText'
import { addClip, createDefaultTimeline, type Clip } from '../../src/video/timeline'
import type { TextAiDeps } from '../../src/video/ai/aiText'

const deps = (reply: string, over: Partial<TextAiDeps> = {}): TextAiDeps => ({
  paused: () => false,
  pick: () => ({ provider: 'gemini', key: 'k', model: 'auto' }),
  call: async () => ({ data: { lines: reply }, model: 'm' }),
  resolve: async (_p, _k, m) => m,
  ...over,
})

describe('numbers across scripts', () => {
  it('reads Bangla and English digits the same, ignoring thousands commas', () => {
    expect(numbersIn('১২০ মেগাওয়াট এবং 1,200 crore')).toEqual(['1200', '120'].sort())
    expect(numbersNotIn('We add 30 MW and 99 wells', 'Add 30 MW')).toEqual(['99'])
  })
})

describe('numbered caption lines', () => {
  it('round-trips, keeping a line break as " / "', () => {
    expect(numberedInput(['One\ntwo', 'Three'])).toBe('1|One / two\n2|Three')
    expect(parseNumbered('1|এক / দুই\n2|তিন', 2)).toEqual(['এক\nদুই', 'তিন'])
  })
  it('marks missing captions null and ignores repeats and noise', () => {
    expect(parseNumbered('Sure!\n1|a\n1|b\n3|c', 3)).toEqual(['a', null, 'c'])
  })
})

describe('translateCaptionLines', () => {
  it('keeps good lines and refuses one whose figures changed or went missing', async () => {
    const src = ['Output is 30 MW', 'Work begins in 2027', 'Officials said so']
    const r = await translateCaptionLines(src, 'bn', deps('1|উৎপাদন ৩০ মেগাওয়াট\n2|কাজ শুরু ২০২৮ সালে'))
    expect(r.lines[0]).toBe('উৎপাদন ৩০ মেগাওয়াট')
    expect(r.lines[1]).toBeNull() // 2027 became 2028
    expect(r.lines[2]).toBeNull() // left out
    expect(r.problems.map((p) => p.index)).toEqual([1, 2])
  })

  it('sends nothing while AI is paused, and says why when there is no key', async () => {
    let called = 0
    const call: TextAiDeps['call'] = async () => { called++; return { data: {}, model: '' } }
    await expect(translateCaptionLines(['a'], 'en', deps('', { paused: () => true, call }))).rejects.toThrow(TEXT_AI_OFF)
    await expect(runTextAi({ system: '', user: '', schema: { type: 'object', properties: {}, required: [] } }, deps('', { pick: () => null }))).rejects.toThrow(TEXT_AI_NO_KEY)
    expect(called).toBe(0)
  })
})

describe('translated clips', () => {
  it('copy the source timing onto the given track, labelled as an AI draft, without touching the source', () => {
    const cap: Clip = { id: 'c1', trackId: 'c1', title: 'Point 1', kind: 'caption', start: 2, duration: 4, in: 0, out: 4, color: '#f59e0b', captionText: 'Output is 30 MW' }
    const p = addClip(createDefaultTimeline('16:9'), cap)
    const src = captionSources(p)
    const out = translatedClips(src, ['উৎপাদন ৩০ মেগাওয়াট'], 'bn', 'c2', 'x')
    expect(out).toHaveLength(1)
    expect(out[0].start).toBe(2)
    expect(out[0].duration).toBe(4)
    expect(out[0].trackId).toBe('c2')
    expect(out[0].title).toContain('AI draft')
    expect(src[0].captionText).toBe('Output is 30 MW')
  })
})
