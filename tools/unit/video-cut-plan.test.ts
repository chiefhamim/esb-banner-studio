import { describe, it, expect } from 'vitest'
import { silencePlan, fillerPlan } from '../../src/video/ai/cutPlan'
import type { Word } from '../../src/video/ai/transcript'

const sr = 1000
function tone(seconds: number, amp = 0.5) { return new Float32Array(Math.round(seconds * sr)).map((_, i) => amp * Math.sin(i * 0.3)) }
const silence = (s: number) => new Float32Array(Math.round(s * sr))

describe('silence plan', () => {
  it('removes exactly the silent span (±1 frame) and shifts it by the clip in-point', () => {
    const audio = new Float32Array([...tone(1), ...silence(2), ...tone(1)])
    const plan = silencePlan([audio, audio], sr, 10, 30, 60, { threshold: -40, minDuration: 0.5, handle: 0.1 })
    expect(plan.ranges.length).toBe(1)
    const r = plan.ranges[0]
    // silence is source 11..13 (clip in 10 + 1..3); the 0.1 s handle keeps a breath at both ends
    expect(Math.abs(r.from - 11.1)).toBeLessThanOrEqual(1 / 30)
    expect(Math.abs(r.to - 12.9)).toBeLessThanOrEqual(1 / 30)
  })

  it('finds nothing in continuous speech', () => {
    const audio = tone(3)
    expect(silencePlan([audio, audio], sr, 0, 30, 60).ranges).toEqual([])
  })
})

describe('filler plan', () => {
  it('cuts English and Bangla filler words and reports them', () => {
    const words: Word[] = [
      { text: 'So', start: 1, end: 1.2, confidence: 1 },
      { text: 'um', start: 1.3, end: 1.5, confidence: 1 },
      { text: 'we', start: 1.6, end: 1.8, confidence: 1 },
      { text: 'উম', start: 2.5, end: 2.8, confidence: 1 },
      { text: 'drill', start: 3, end: 3.4, confidence: 1 },
    ]
    const { plan, found } = fillerPlan(words, 30, 60)
    expect(found.map((f) => f.text)).toEqual(['um', 'উম'])
    expect(plan.ranges.length).toBe(2)
    // 'so' is a discourse marker: only offered when the editor asks
    expect(fillerPlan(words, 30, 60, ['hesitation', 'discourse']).found.length).toBe(3)
    expect(plan.seconds).toBeGreaterThan(0.2)
  })
})
