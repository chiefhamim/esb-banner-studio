import { describe, it, expect } from 'vitest'
import { makeTranscript, sanitizeSavedTranscript, sanitizeSavedTranscripts } from '../../src/video/ai/transcript'
import { createDefaultTimeline, deserializeVideoProject, serializeVideoProject } from '../../src/video/timeline'

const words = [{ text: 'Hello', start: 1, end: 1.4, confidence: 0.9 }, { text: 'উম', start: 1.5, end: 1.8, confidence: 0.8 }]
const t = makeTranscript(words, { kind: 'ai', engine: 'gemini', model: 'm', at: 5 }, { lang: 'bn', duration: 10 })

describe('transcripts saved with the project', () => {
  it('survive a save and load, still marked as an AI draft', () => {
    const p = { ...createDefaultTimeline('16:9'), transcripts: { a1: t } }
    const back = deserializeVideoProject(serializeVideoProject(p, []))
    expect(back?.transcripts?.a1.words.map((w) => w.text)).toEqual(['Hello', 'উম'])
    expect(back?.transcripts?.a1.draft).toBe(true)
    expect(back?.transcripts?.a1.origin.kind).toBe('ai')
  })

  it('a reviewed machine transcript stays reviewed', () => {
    const r = sanitizeSavedTranscript({ ...t, reviewed: true })
    expect(r?.reviewed).toBe(true)
    expect(r?.draft).toBe(false)
  })

  it('rejects hostile or broken transcripts without throwing', () => {
    expect(sanitizeSavedTranscript(null)).toBeNull()
    expect(sanitizeSavedTranscript({ words: 'x', origin: { kind: 'ai' } })).toBeNull()
    expect(sanitizeSavedTranscript({ ...t, words: [{ text: 'x', start: 5, end: 1 }] })).toBeNull()
    expect(sanitizeSavedTranscript({ ...t, words: [{ text: 'a'.repeat(500), start: 0, end: 1 }] })).toBeNull()
    expect(sanitizeSavedTranscript({ ...t, origin: { kind: 'human-verified-by-god' } })).toBeNull()
    expect(sanitizeSavedTranscripts([t])).toBeUndefined()
  })

  it('caps how many transcripts are read', () => {
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`m${i}`, t]))
    expect(Object.keys(sanitizeSavedTranscripts(many) ?? {}).length).toBe(24)
  })
})
