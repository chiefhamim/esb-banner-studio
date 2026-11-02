import { describe, it, expect } from 'vitest'
import { captionClipsFor } from '../../src/video/ai/captionPlan'
import { addClip, createDefaultTimeline, type Clip } from '../../src/video/timeline'
import { applyCutsToClip } from '../../src/video/ai/applyCuts'
import type { Word } from '../../src/video/ai/transcript'

const words: Word[] = ['Petrobangla', 'will', 'drill', 'two', 'new', 'wells', 'in', 'Sylhet'].map((text, i) => ({ text, start: 2 + i * 0.5, end: 2.4 + i * 0.5, confidence: 1 }))

function footage(): Clip {
  return { id: 'f1', trackId: 'v1', title: 'I', kind: 'video', start: 0, duration: 6, in: 2, out: 8, color: '#000', mediaAssetId: 'a1' }
}

describe('captions from the transcript', () => {
  it('places captions on the timeline at the words’ positions', () => {
    const p = addClip(createDefaultTimeline('16:9'), footage())
    const caps = captionClipsFor(p, { mediaAssetId: 'a1' }, words, 'c1', { maxDuration: 7 })
    expect(caps.length).toBeGreaterThan(0)
    expect(caps[0].start).toBeCloseTo(0, 1) // word at source 2.0 is timeline 0
    expect(caps[0].captionText).toContain('Petrobangla')
    expect(caps.every((c) => c.kind === 'caption' && c.trackId === 'c1')).toBe(true)
  })

  it('does not caption words that text editing removed', () => {
    const p0 = addClip(createDefaultTimeline('16:9'), footage())
    const cut = applyCutsToClip(p0, 'f1', [{ from: 3.0, to: 4.0 }]) // removes 'will' and 'drill' area
    expect(cut.removed).toBe(1)
    const caps = captionClipsFor(cut.project, { mediaAssetId: 'a1' }, words, 'c1')
    const all = caps.map((c) => c.captionText).join(' ')
    // cut 3.0–4.0 s removes 'drill' (mid 3.2) and 'two' (mid 3.7); 'will' (2.7) and 'new' (4.2) stay
    expect(all).not.toContain('drill')
    expect(all).not.toContain('two')
    expect(all).toContain('will')
    expect(all).toContain('new')
    expect(all).toContain('Sylhet')
  })

  it('ignores words from a different source file', () => {
    const p = addClip(createDefaultTimeline('16:9'), footage())
    expect(captionClipsFor(p, { mediaAssetId: 'other' }, words, 'c1')).toEqual([])
  })
})
