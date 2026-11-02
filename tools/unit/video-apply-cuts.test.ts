import { describe, it, expect } from 'vitest'
import { addClip, createDefaultTimeline, type Clip, type VideoProject } from '../../src/video/timeline'
import { applyCutsToClip, mergeSourceRanges } from '../../src/video/ai/applyCuts'

function footage(over: Partial<Clip> = {}): Clip {
  return { id: 'f1', trackId: 'v1', title: 'Interview', kind: 'video', start: 0, duration: 10, in: 0, out: 10, color: '#000', ...over }
}
function project(clip: Clip = footage()): VideoProject {
  return addClip(createDefaultTimeline('16:9'), clip)
}
const onV1 = (p: VideoProject) => p.clips.filter((c) => c.trackId === 'v1').sort((a, b) => a.start - b.start)

describe('applyCutsToClip', () => {
  it('removes two source ranges and ripples the rest up with no gap', () => {
    const r = applyCutsToClip(project(), 'f1', [{ from: 2, to: 3 }, { from: 5, to: 6.5 }])
    expect(r.refused).toBeUndefined()
    expect(r.removed).toBe(2)
    const pieces = onV1(r.project)
    expect(pieces.reduce((s, c) => s + c.duration, 0)).toBeCloseTo(7.5, 6)
    // contiguous: each piece starts where the previous one ends
    for (let i = 1; i < pieces.length; i++) expect(pieces[i].start).toBeCloseTo(pieces[i - 1].start + pieces[i - 1].duration, 6)
    expect(pieces[0].start).toBe(0)
  })

  it('maps source time to timeline time for a clip that starts later and trims in', () => {
    const r = applyCutsToClip(project(footage({ start: 4, in: 1, out: 9, duration: 8 })), 'f1', [{ from: 2, to: 3 }])
    expect(r.refused).toBeUndefined()
    const pieces = onV1(r.project)
    expect(pieces[0].start).toBeCloseTo(4, 6)
    expect(pieces[0].duration).toBeCloseTo(1, 6) // source 1..2
    expect(pieces[1].start).toBeCloseTo(5, 6)    // source 3 now at timeline 5
    expect(pieces[1].duration).toBeCloseTo(6, 6)
  })

  it('refuses a range outside the clip’s source, without changing the project', () => {
    const p = project()
    const r = applyCutsToClip(p, 'f1', [{ from: 9, to: 12 }])
    expect(r.refused).toBe('outside-source')
    expect(r.project).toBe(p)
  })

  it('refuses speed-changed, still and compound clips', () => {
    expect(applyCutsToClip(project(footage({ speed: 2 })), 'f1', [{ from: 1, to: 2 }]).refused).toBe('speed')
    expect(applyCutsToClip(project(footage({ still: true })), 'f1', [{ from: 1, to: 2 }]).refused).toBe('not-footage')
  })

  it('leaves the project alone when there is nothing to cut', () => {
    const p = project()
    expect(applyCutsToClip(p, 'f1', []).project).toBe(p)
  })

  it('merges overlapping and touching ranges first', () => {
    expect(mergeSourceRanges([{ from: 2, to: 3 }, { from: 2.5, to: 4 }, { from: 4, to: 5 }, { from: 7, to: 7 }])).toEqual([{ from: 2, to: 5 }])
    const r = applyCutsToClip(project(), 'f1', [{ from: 2, to: 3 }, { from: 2.5, to: 4 }])
    expect(r.removed).toBe(1)
    expect(onV1(r.project).reduce((s, c) => s + c.duration, 0)).toBeCloseTo(8, 6)
  })
})
