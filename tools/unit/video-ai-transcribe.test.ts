// @vitest-environment jsdom
// Phase 5 pre-build: transcription through the AI layer with a fake provider (no network): chunking, stitching,
// validation that rejects bad timings, the draft label, aiPaused(), the whisper.cpp "not installed" state, and
// the highlight rerank's rule that the AI can only reorder.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_OFF, NO_GEMINI, base64, chunkSecForBudget, encodeWav, geminiEngine, parseWordLines, planChunks, resample, stitchChunks, validateWords, whisperCppEngine, WHISPER_NOT_INSTALLED } from '../../src/video/ai/transcribe'
import type { GeminiDeps } from '../../src/video/ai/transcribe'
import { applyOrder, findHighlights, rerankHighlights } from '../../src/video/ai/highlights'
import type { AiJsonRequest } from '../../src/editorial/aiProviders'
import { aiJson, loadAiSettings, saveAiSettings } from '../../src/editorial/aiProviders'
import type { Word } from '../../src/video/ai/transcript'

const RATE = 16000

/** The "truth": a word every 0.5 s (0.35 s long) over `seconds`. */
const truth = (seconds: number): Word[] => Array.from({ length: Math.floor(seconds / 0.5) - 1 }, (_, i) => ({ text: `w${i}`, start: +(0.1 + i * 0.5).toFixed(3), end: +(0.45 + i * 0.5).toFixed(3), confidence: 0.95 }))

/** A fake Gemini that "hears" the truth inside each chunk it is sent, with ±`jitter` s timing error. */
function fakeGemini(seconds: number, maxChunkSec: number, hooks: { bad?: (call: number, chunk: number) => string | null } = {}) {
  const plan = planChunks(seconds, { maxSec: maxChunkSec })
  const all = truth(seconds)
  const calls: AiJsonRequest[] = []
  let chunk = -1
  let attempts = 0
  let retryNext = false
  const deps: GeminiDeps = {
    paused: () => false,
    gemini: () => ({ key: 'k', model: 'auto' }),
    resolve: async () => 'gemini-test',
    call: async (req) => {
      calls.push(req)
      if (!retryNext) { chunk++; attempts = 0 }
      attempts++
      const c = plan[Math.min(chunk, plan.length - 1)]
      const bad = hooks.bad?.(calls.length, chunk) ?? null
      retryNext = bad != null && attempts < 2 // the engine asks once more after a rejected answer
      if (bad != null) return { data: { language: 'en', words: bad }, model: 'gemini-test' }
      const lines = all.filter((w) => w.start >= c.start && w.end <= c.end).map((w, i) => {
        const j = ((i * 7919) % 21) / 100 - 0.1 // deterministic jitter in [−0.1, 0.1]
        return `${(w.start - c.start + j).toFixed(3)}\t${(w.end - c.start + j).toFixed(3)}\t0.9\tS1\t${w.text}`
      })
      return { data: { language: 'en', words: lines.join('\n') }, model: 'gemini-test' }
    },
  }
  return { deps, calls, plan, all }
}

describe('audio packaging', () => {
  it('encodes a valid 16-bit WAV and base64 that matches the platform encoder', () => {
    const x = new Float32Array([0, 0.5, -0.5, 1, -1])
    const wav = encodeWav(x, 16000)
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF')
    expect(new DataView(wav.buffer).getUint32(24, true)).toBe(16000)
    expect(new DataView(wav.buffer).getInt16(44 + 2, true)).toBe(16384)
    for (const n of [0, 1, 2, 3, 44, 1000]) {
      const b = wav.length >= n ? wav.subarray(0, n) : wav
      expect(base64(b)).toBe(Buffer.from(b).toString('base64'))
    }
  })

  it('resamples to 16 kHz keeping a speech tone and the length', () => {
    const sr = 48000
    const x = new Float32Array(sr)
    for (let i = 0; i < sr; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr)
    const y = resample(x, sr, 16000)
    expect(y.length).toBe(16000)
    let s = 0
    for (let i = 100; i < y.length - 100; i++) s += y[i] * y[i]
    expect(Math.sqrt(s / (y.length - 200))).toBeCloseTo(0.5 / Math.SQRT2, 2)
  })

  it('chunks fit the inline budget, are ≤ 10 min and overlap', () => {
    expect(chunkSecForBudget()).toBeLessThanOrEqual(600)
    expect(chunkSecForBudget()).toBeGreaterThan(300)
    const p = planChunks(3600, { maxSec: 600, overlap: 4 })
    expect(p[0].start).toBe(0)
    expect(p[p.length - 1].end).toBe(3600)
    for (const c of p) expect(c.end - c.start).toBeLessThanOrEqual(600 + 1e-6)
    for (let i = 1; i < p.length; i++) expect(p[i - 1].end - p[i].start).toBeCloseTo(4, 3)
    expect(planChunks(100)).toEqual([{ start: 0, end: 100 }])
  })
})

describe('parse and validate', () => {
  it('parses word lines and counts the bad ones', () => {
    const r = parseWordLines('0.10\t0.40\t0.9\tS1\tনমস্কার,\n0.5\t0.9\t1\t\tbye\nnonsense\n', 10)
    expect(r.words).toEqual([{ text: 'নমস্কার,', start: 10.1, end: 10.4, confidence: 0.9, speaker: 'S1' }, { text: 'bye', start: 10.5, end: 10.9, confidence: 1 }])
    expect(r.bad).toBe(1)
  })

  it('rejects timings out of order, reversed, negative or beyond the duration', () => {
    const w = (start: number, end: number, text = 'x'): Word => ({ text, start, end, confidence: 1 })
    expect(validateWords([w(0, 1), w(1.1, 2)], 2)).toEqual([])
    expect(validateWords([w(0, 1), w(0.5, 0.7)], 2).join()).toMatch(/out of order|overlaps/)
    expect(validateWords([w(1, 0.5)], 2).join()).toMatch(/ends before it starts/)
    expect(validateWords([w(-0.5, 0.5)], 2).join()).toMatch(/before 0/)
    expect(validateWords([w(1, 2.6)], 2).join()).toMatch(/past the audio/)
  })

  it('stitches overlapping chunks without doubles or gaps', () => {
    const words = truth(30)
    const chunks = [{ start: 0, end: 16 }, { start: 14, end: 30 }].map((c) => ({ ...c, words: words.filter((x) => x.start >= c.start && x.end <= c.end) }))
    expect(stitchChunks(chunks).map((x) => x.text)).toEqual(words.map((x) => x.text))
  })
})

describe('Gemini engine (fake provider, no network)', () => {
  const audio = (seconds: number) => ({ channels: [new Float32Array(seconds * RATE)], sampleRate: RATE })

  it('transcribes long audio in chunks: every word once, timings within 150 ms, a DRAFT marked as AI', async () => {
    const f = fakeGemini(70, 30)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const progress: number[] = []
    const r = await geminiEngine(f.deps).transcribe(audio(70), { maxChunkSec: 30, onProgress: (d) => progress.push(d) })
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
    expect(f.calls.length).toBe(f.plan.length)
    expect(f.plan.length).toBe(3)
    expect(progress).toEqual([1, 2, 3])
    expect(r.complete).toBe(true)
    expect(r.transcript.words.map((w) => w.text)).toEqual(f.all.map((w) => w.text))
    r.transcript.words.forEach((w, i) => { expect(Math.abs(w.start - f.all[i].start)).toBeLessThanOrEqual(0.15); expect(Math.abs(w.end - f.all[i].end)).toBeLessThanOrEqual(0.15) })
    expect(r.transcript).toMatchObject({ draft: true, reviewed: false, origin: { kind: 'ai', engine: 'gemini', model: 'gemini-test' }, lang: 'en' })
    const req = f.calls[0]
    expect(req.provider).toBe('gemini')
    expect(req.attachment?.mime).toBe('audio/wav')
    expect(req.system).toMatch(/verbatim/i)
    expect(req.system).toMatch(/Never translate/)
    expect(req.schema.required).toEqual(['language', 'words'])
  })

  it('asks again once when a chunk comes back with bad timings, and accepts the good second answer', async () => {
    const f = fakeGemini(70, 30, { bad: (call) => (call === 2 ? '5\t4\t1\t\tbackwards' : null) })
    const r = await geminiEngine(f.deps).transcribe(audio(70), { maxChunkSec: 30 })
    expect(f.calls.length).toBe(4)
    expect(r.complete).toBe(true)
    expect(r.chunks[1]).toMatchObject({ state: 'ok', attempts: 2 })
  })

  it('a chunk that stays invalid is REJECTED and reported, never repaired; the rest is kept', async () => {
    const f = fakeGemini(70, 30, { bad: (_call, chunk) => (chunk === 1 ? '0\t1\t1\t\ta\n0.5\t0.8\t1\t\tb\n99\t100\t1\t\tc' : null) })
    const r = await geminiEngine(f.deps).transcribe(audio(70), { maxChunkSec: 30 })
    expect(r.complete).toBe(false)
    expect(r.chunks.map((c) => c.state)).toEqual(['ok', 'rejected', 'ok'])
    expect(r.chunks[1].why).toMatch(/out of order|overlaps/)
    expect(r.chunks[1].why).toMatch(/past the audio/)
    const texts = r.transcript.words.map((w) => w.text)
    expect(texts).not.toContain('a')
    expect(texts).not.toContain('c')
    // words in the rejected chunk's own share are missing, the others are all there
    const lo = (r.chunks[0].end + r.chunks[1].start) / 2
    const hi = (r.chunks[1].end + r.chunks[2].start) / 2
    expect(texts).toEqual(f.all.filter((w) => (w.start + w.end) / 2 < lo || (w.start + w.end) / 2 >= hi).map((w) => w.text))
  })

  it('reports no key and refuses without sending', async () => {
    const f = fakeGemini(10, 30)
    const e = geminiEngine({ ...f.deps, gemini: () => null })
    expect(await e.status()).toEqual({ state: 'no-key', why: NO_GEMINI })
    await expect(e.transcribe(audio(10))).rejects.toThrow(NO_GEMINI)
    expect(f.calls.length).toBe(0)
  })
})

describe('with AI paused (real settings, default wiring)', () => {
  beforeEach(() => {
    localStorage.clear()
    const s = loadAiSettings()
    saveAiSettings({ ...s, keys: { ...s.keys, gemini: 'test-key' }, paused: true })
  })
  afterEach(() => vi.restoreAllMocks())

  it('the Gemini engine says AI is off and nothing leaves the app', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const e = geminiEngine()
    expect(await e.status()).toEqual({ state: 'off', why: AI_OFF })
    await expect(e.transcribe({ channels: [new Float32Array(16000)], sampleRate: 16000 })).rejects.toThrow(AI_OFF)
    await expect(aiJson({ provider: 'gemini', key: 'k', model: 'm', system: '', user: '', attachment: { mime: 'audio/wav', data: '' }, schema: { type: 'object', properties: {}, required: [] } })).rejects.toThrow(/AI is OFF/)
    const words = Array.from({ length: 200 }, (_, i) => ({ text: i % 12 === 11 ? 'end.' : `w${i}`, start: i * 0.4, end: i * 0.4 + 0.3, confidence: 1 }))
    const c = findHighlights(words)
    const rr = await rerankHighlights(c)
    expect(rr).toMatchObject({ state: 'off', rankedBy: 'heuristic' })
    expect(rr.candidates).toBe(c)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('a ready engine with AI on is ready (key present)', async () => {
    saveAiSettings({ ...loadAiSettings(), paused: false })
    expect((await geminiEngine().status()).state).toBe('ready')
  })

  it('audio is Gemini only in the AI layer', async () => {
    saveAiSettings({ ...loadAiSettings(), paused: false })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(aiJson({ provider: 'anthropic', key: 'k', model: 'm', system: '', user: '', attachment: { mime: 'audio/wav', data: '' }, schema: { type: 'object', properties: {}, required: [] } })).rejects.toThrow(/cannot listen to audio/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('local whisper.cpp engine', () => {
  it('is "not installed" and refuses, never fakes a result', async () => {
    const e = whisperCppEngine()
    expect(e.local).toBe(true)
    expect(await e.status()).toEqual({ state: 'not-installed', why: WHISPER_NOT_INSTALLED })
    await expect(e.transcribe({ channels: [new Float32Array(10)], sampleRate: 16000 })).rejects.toThrow(/not installed/)
  })
})

describe('highlight rerank: the AI can only reorder', () => {
  const words: Word[] = []
  let t = 0
  for (let s = 0; s < 30; s++) for (let k = 0; k < 10; k++) { words.push({ text: k === 9 ? `s${s}end.` : `s${s}w${k}`, start: +t.toFixed(3), end: +(t + 0.35).toFixed(3), confidence: 1 }); t += 0.4 }
  const cands = findHighlights(words, { top: 4 })

  it('applies the order by id; unknown ids dropped, missing ones kept', () => {
    const o = applyOrder(cands, 'H3, h3, "h1", h99, invented text')
    expect(o.map((c) => c.id)).toEqual(['h3', 'h1', 'h2', 'h4'])
    expect(o.every((c, _i, arr) => cands.includes(c) && arr.indexOf(c) === arr.lastIndexOf(c))).toBe(true)
  })

  it('with a fake provider: same candidates, same text, new order, labelled ai', async () => {
    const before = JSON.stringify(cands)
    const calls: AiJsonRequest[] = []
    const r = await rerankHighlights(cands, {
      deps: {
        paused: () => false,
        ai: () => ({ provider: 'anthropic', key: 'k', model: 'auto' }),
        resolve: async () => 'claude-test',
        call: async (req) => { calls.push(req); return { data: { order: 'h4,h2', why: 'It is a complete statement. NEW TEXT HERE' }, model: 'claude-test' } },
      },
    })
    expect(r.rankedBy).toBe('ai')
    expect(r.candidates.map((c) => c.id)).toEqual(['h4', 'h2', 'h1', 'h3'])
    expect(JSON.stringify(cands)).toBe(before)
    for (const c of r.candidates) expect(cands).toContain(c)
    expect(calls[0].user).toContain(cands[0].text)
  })

  it('a provider error leaves the heuristic order and says why', async () => {
    const r = await rerankHighlights(cands, { deps: { paused: () => false, ai: () => ({ provider: 'gemini', key: 'k', model: 'm' }), resolve: async () => 'm', call: async () => { throw new Error('boom') } } })
    expect(r).toMatchObject({ state: 'failed', rankedBy: 'heuristic', why: 'boom' })
    expect(r.candidates).toBe(cands)
  })
})
