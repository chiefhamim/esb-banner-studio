import { describe, it, expect } from 'vitest'
import { shortClips } from '../../src/video/ai/shortPlan'
import { addClip, createDefaultTimeline, type Clip } from '../../src/video/timeline'
import type { HighlightCandidate } from '../../src/video/ai/highlights'

const footage: Clip = { id: 'f1', trackId: 'v1', title: 'I', kind: 'video', start: 0, duration: 60, in: 0, out: 60, color: '#000', linkId: 'L1' }
const sound: Clip = { id: 'a1', trackId: 'a1', title: 'I sound', kind: 'audio', start: 0, duration: 60, in: 0, out: 60, color: '#000', linkId: 'L1' }
const cand: HighlightCandidate = { id: 'h1', start: 12, end: 40, from: 0, to: 0, text: 'Two new wells will add gas', score: 1, parts: { completeness: 1, density: 1, fillers: 0, confidence: 1, length: 1 } }

describe('highlight → short clips', () => {
  it('copies the footage range and its linked sound together, after the timeline end', () => {
    const p = addClip(addClip(createDefaultTimeline('16:9'), footage), sound)
    const out = shortClips(p, footage, cand, 'x')
    expect(out.length).toBe(2)
    const [v, a] = out
    expect(v.in).toBe(12); expect(v.out).toBe(40); expect(v.duration).toBe(28)
    expect(a.in).toBe(12); expect(a.duration).toBe(28)
    expect(v.linkId).toBeDefined(); expect(v.linkId).toBe(a.linkId)
    expect(v.start).toBeGreaterThanOrEqual(60)
    expect(v.title.startsWith('Short')).toBe(true)
  })

  it('refuses an empty range', () => {
    const p = addClip(createDefaultTimeline('16:9'), footage)
    expect(shortClips(p, footage, { ...cand, end: 12 }, 'x')).toEqual([])
  })
})
