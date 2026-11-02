// Phase 5 pre-build: transcript model, caption cues (≤ 42 clusters, ≤ 2 lines, Bangla-safe wrapping), SRT/VTT
// export and import.
import { describe, expect, it } from 'vitest'
import { buildCues, buildSegments, cuesToWords, glen, graphemes, importCaptions, makeTranscript, parseCaptions, parseTimecode, timecode, toSrt, toVtt, wrapLines } from '../../src/video/ai/transcript'
import type { Word } from '../../src/video/ai/transcript'

/** Words spaced evenly from `t0`, `dur` seconds each with `gap` between. */
function timed(text: string, t0 = 0, dur = 0.3, gap = 0.05): Word[] {
  let t = t0
  return text.split(/\s+/).filter(Boolean).map((w) => { const x = { text: w, start: +t.toFixed(3), end: +(t + dur).toFixed(3), confidence: 0.9 }; t += dur + gap; return x })
}

const BN = 'বিদ্যুৎ বিভাগের সচিব বলেছেন, আগামী গ্রীষ্মে লোডশেডিং কমাতে নতুন কেন্দ্রগুলো সময়মতো উৎপাদনে আসবে। তবে গ্যাসের সরবরাহ নিয়ে অনিশ্চয়তা রয়ে গেছে এবং আমদানি করা এলএনজির দাম বাড়ছে।'
const EN = 'The minister said the new plant would reach full output before the summer peak. Engineers are still testing the second unit, and the grid operator expects it to join the network next month.'

describe('graphemes', () => {
  it('never splits a Bangla conjunct, vowel sign or hasanta from its base', () => {
    for (const w of ['ক্ষ', 'বিদ্যুৎ', 'স্ত্রী', 'উৎপাদনে']) {
      const g = graphemes(w)
      expect(g.join('')).toBe(w)
      for (const c of g) expect(/^\p{M}/u.test(c)).toBe(false) // no cluster starts with a vowel sign, the hasanta or another mark
    }
    expect(glen('ক্ষমতা')).toBeLessThan('ক্ষমতা'.length)
  })
})

describe('segments', () => {
  it('splits at sentence ends (incl. the danda), long pauses and speaker changes', () => {
    const w = [...timed('প্রথম বাক্য। দ্বিতীয় বাক্য'), ...timed('after a pause', 10)]
    w[w.length - 1].speaker = 'S2'
    const s = buildSegments(w)
    expect(s.map((x) => x.text)).toEqual(['প্রথম বাক্য।', 'দ্বিতীয় বাক্য', 'after a', 'pause'])
    expect(s[0]).toMatchObject({ from: 0, to: 2 })
  })

  it('a machine transcript is a draft until reviewed; an import is not', () => {
    const ai = makeTranscript(timed('hello world'), { kind: 'ai', engine: 'gemini', model: 'm', at: 1 })
    expect(ai).toMatchObject({ draft: true, reviewed: false })
    expect(makeTranscript([], { kind: 'import', format: 'srt', at: 1 })).toMatchObject({ draft: false, reviewed: true })
  })
})

describe('caption cues', () => {
  for (const [name, text] of [['English', EN], ['Bangla', BN]] as const) {
    it(`${name}: every line ≤ 42 clusters, ≤ 2 lines, words in order and complete, times ordered`, () => {
      const words = timed(text)
      const cues = buildCues(words)
      expect(cues.length).toBeGreaterThan(1)
      for (const c of cues) {
        expect(c.lines.length).toBeLessThanOrEqual(2)
        for (const l of c.lines) expect(glen(l)).toBeLessThanOrEqual(42)
        expect(c.end).toBeGreaterThan(c.start)
        expect(c.end - c.start).toBeLessThanOrEqual(7 + 1e-9)
      }
      for (let i = 1; i < cues.length; i++) expect(cues[i].start).toBeGreaterThanOrEqual(cues[i - 1].end)
      expect(cues.flatMap((c) => c.lines).join(' ')).toBe(words.map((w) => w.text).join(' '))
    })
  }

  it('ends a cue at a sentence end, and balances two lines', () => {
    const cues = buildCues(timed(EN))
    expect(cues[0].lines.join(' ')).toMatch(/peak\.$/)
    const two = cues.find((c) => c.lines.length === 2)!
    expect(Math.abs(glen(two.lines[0]) - glen(two.lines[1]))).toBeLessThan(12)
  })

  it('cuts a single word longer than a line by clusters, not code units', () => {
    const long = 'বিদ্যুৎ'.repeat(10) // 30 clusters × … > 42
    const cues = buildCues([{ text: long, start: 0, end: 3, confidence: 1 }], { maxChars: 12 })
    const parts = cues.flatMap((c) => c.lines.flatMap((l) => l.split(' ')))
    expect(parts.join('')).toBe(long)
    for (const p of parts) expect(glen(p)).toBeLessThanOrEqual(12)
  })

  it('wrapLines refuses what cannot fit', () => {
    expect(wrapLines(['a'.repeat(43)], 42)).toBeNull()
    expect(wrapLines(Array(30).fill('word'), 42, 2)).toBeNull()
  })

  it('a too-short cue is lengthened into the silence, never over the next cue', () => {
    const cues = buildCues([{ text: 'Yes.', start: 1, end: 1.2, confidence: 1 }, { text: 'No.', start: 1.5, end: 1.7, confidence: 1 }, { text: 'Maybe.', start: 5, end: 5.2, confidence: 1 }])
    expect(cues[0]).toMatchObject({ start: 1, end: 1.5 })
    expect(cues[1].end).toBeCloseTo(2.3, 6)
  })
})

describe('SRT / VTT', () => {
  it('formats timecodes', () => {
    expect(timecode(0)).toBe('00:00:00,000')
    expect(timecode(3725.5)).toBe('01:02:05,500')
    expect(timecode(59.9996, '.')).toBe('00:01:00.000')
    expect(parseTimecode('01:02:05,500')).toBe(3725.5)
    expect(parseTimecode('02:05.5')).toBe(125.5)
    expect(parseTimecode('bad')).toBeNaN()
  })

  it('writes SRT and VTT that read back to the same cues', () => {
    const cues = buildCues(timed(BN + ' ' + EN))
    const srt = toSrt(cues)
    expect(srt.startsWith('1\n00:00:00,000 --> ')).toBe(true)
    const vtt = toVtt(cues)
    expect(vtt.startsWith('WEBVTT\n\n00:00:00.000 --> ')).toBe(true)
    for (const text of [srt, vtt]) {
      const back = parseCaptions(text)
      expect(back.cues.length).toBe(cues.length)
      back.cues.forEach((c, i) => {
        expect(c.lines).toEqual(cues[i].lines)
        expect(c.start).toBeCloseTo(cues[i].start, 3)
        expect(c.end).toBeCloseTo(cues[i].end, 3)
      })
    }
    expect(parseCaptions(vtt).format).toBe('vtt')
  })

  it('imports messy files: BOM, CRLF, ids, settings, NOTE blocks and tags', () => {
    const vtt = '﻿WEBVTT\r\n\r\nNOTE made elsewhere\r\n\r\nintro\r\n00:01.000 --> 00:03.000 align:start\r\n<v Speaker>Hello <b>there</b></v>\r\n\r\n00:00:04.000 --> 00:00:05.000\r\nনমস্কার।\r\n'
    const r = parseCaptions(vtt)
    expect(r.cues).toEqual([{ start: 1, end: 3, lines: ['Hello there'] }, { start: 4, end: 5, lines: ['নমস্কার।'] }])
    const t = importCaptions(vtt, 5)
    expect(t.origin).toEqual({ kind: 'import', format: 'vtt', at: 5 })
    expect(t.words.map((w) => w.text)).toEqual(['Hello', 'there', 'নমস্কার।'])
    expect(t.words.every((w) => w.estimated)).toBe(true)
    expect(t.words[1].end).toBeCloseTo(3, 6)
  })

  it('spreads imported cue time over its words by length', () => {
    const w = cuesToWords([{ start: 0, end: 10, lines: ['aaaa b'] }])
    expect(w[0]).toMatchObject({ start: 0, end: 8 })
    expect(w[1]).toMatchObject({ start: 8, end: 10 })
  })
})
