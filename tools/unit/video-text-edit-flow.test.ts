import { describe, it, expect } from 'vitest'
import { addClip, createDefaultTimeline, type Clip, type VideoProject } from '../../src/video/timeline'
import { applyCutsToClip } from '../../src/video/ai/applyCuts'
import { cutsForDeletedWords } from '../../src/video/ai/textEdit'
import type { Word } from '../../src/video/ai/transcript'

// Words are in source seconds (the transcript panel shifts them by the clip's in-point before cutting).
const words: Word[] = [
  { text: 'Petrobangla', start: 2.0, end: 2.6, confidence: 0.9 },
  { text: 'উম', start: 2.7, end: 3.1, confidence: 0.8 },
  { text: 'will', start: 3.2, end: 3.5, confidence: 0.9 },
  { text: 'drill', start: 3.6, end: 4.0, confidence: 0.9 },
  { text: 'wells', start: 4.1, end: 4.6, confidence: 0.9 },
]

function project(): VideoProject {
  const clip: Clip = { id: 'f1', trackId: 'v1', title: 'Interview', kind: 'video', start: 0, duration: 6, in: 1.5, out: 7.5, color: '#000', srcDuration: 60 }
  return addClip(createDefaultTimeline('16:9'), clip)
}

describe('text edit → cut on the timeline', () => {
  it('deleting a word removes its source span from the clip and keeps the rest contiguous', () => {
    const proposal = cutsForDeletedWords(words, [1], { fps: 30, duration: 60 })
    expect(proposal.cuts.length).toBe(1)
    const ranges = proposal.cuts.map((c) => ({ from: c.start, to: c.end }))
    const r = applyCutsToClip(project(), 'f1', ranges)
    expect(r.refused).toBeUndefined()
    expect(r.removed).toBe(1)
    const pieces = r.project.clips.filter((c) => c.trackId === 'v1').sort((a, b) => a.start - b.start)
    for (let i = 1; i < pieces.length; i++) expect(pieces[i].start).toBeCloseTo(pieces[i - 1].start + pieces[i - 1].duration, 6)
    const total = pieces.reduce((s, c) => s + c.duration, 0)
    expect(total).toBeLessThan(6)
    expect(total).toBeGreaterThan(5.4)
  })

  it('a word outside the trimmed source is refused, not cut', () => {
    const far: Word[] = [{ text: 'late', start: 20, end: 21, confidence: 1 }]
    const proposal = cutsForDeletedWords(far, [0], { fps: 30, duration: 60 })
    const r = applyCutsToClip(project(), 'f1', proposal.cuts.map((c) => ({ from: c.start, to: c.end })))
    expect(r.refused).toBe('outside-source')
  })
})
