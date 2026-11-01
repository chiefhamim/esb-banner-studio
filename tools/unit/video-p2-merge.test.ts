// Phase 2 merge (Part A edit model + Part B engine): the seams between them.
import { describe, expect, it } from 'vitest'
import type { Clip, VideoProject } from '../../src/video/timeline'
import { createDefaultTimeline, flattenCompounds } from '../../src/video/timeline'
import * as A from '../../src/video/speed'
import { animationSource, audioRateAt, isPlainSpeed, sampleProp, sourceTimeAt } from '../../src/video/engine/animation'

const clip = (o: Partial<Clip>): Clip => ({ id: 'c', trackId: 'v1', title: 'c', kind: 'video', start: 0, duration: 4, in: 0, out: 4, color: '#000', ...o })

describe('engine adapter uses Part A', () => {
  it('both models are live', () => expect(animationSource).toEqual({ keyframes: 'part-a', speed: 'part-a' }))
  it('reverse: the adapter returns speed.ts unchanged (no extra offset) and frame k shows N−1−k', () => {
    const c = clip({ in: 1, out: 5, reverse: true })
    for (const t of [0, 0.5, 1.7, 3.99, 4]) expect(sourceTimeAt(c, t)).toBeCloseTo(A.sourceTimeAt(c, t), 9)
    const fps = 30
    for (let k = 0; k < 120; k++) expect(Math.floor((sourceTimeAt(c, k / fps) - 1) * fps + 1e-3)).toBe(119 - k)
  })
  it('a clip with only freezes is retimed (not the 1:1 fast path) and holds its picture', () => {
    const f = clip({ in: 0, out: 2, duration: 3, freezes: [{ at: 0.5, dur: 1 }] })
    expect(isPlainSpeed(f)).toBe(false)
    expect(sourceTimeAt(f, 1.2)).toBeCloseTo(0.5, 9)
    expect(sourceTimeAt(f, 2.2)).toBeCloseTo(1.2, 9)
    expect(audioRateAt(f, 1)).toBe(0)
    expect(audioRateAt(f, 2)).toBe(1)
  })
})

describe('compounds after flattening', () => {
  const inner: Clip[] = [
    clip({ id: 'pic', trackId: 'v1', effects: [{ id: 'fx1', type: 'blur', enabled: true, params: { radius: 4 } }], blendMode: 'screen', keyframes: { opacity: [{ t: 0, v: 1 }, { t: 4, v: 0.5 }] } }),
    clip({ id: 'adj', trackId: 'v2', kind: 'overlay', adjustment: true, effects: [{ id: 'fx2', type: 'colour', enabled: true, params: { saturation: -1 } }] }),
    clip({ id: 'snd', trackId: 'a1', kind: 'audio', volume: 0.8 }),
  ]
  const base = createDefaultTimeline()
  const X = clip({ id: 'X', trackId: 'v1', start: 2, duration: 4, in: 0, out: 4, opacity: 0.5, volume: 0.5, compound: { tracks: base.tracks, clips: inner } })
  const flat = flattenCompounds({ ...base, clips: [X] } as VideoProject)
  const get = (id: string) => flat.clips.find((c) => c.id === `X/${id}`)!
  it('the engine sees no compound', () => expect(flat.clips.some((c) => c.compound)).toBe(false))
  it('effects, blend mode and the adjustment flag survive', () => {
    expect(get('pic').effects?.[0].type).toBe('blur')
    expect(get('pic').blendMode).toBe('screen')
    expect(get('adj').adjustment).toBe(true)
    expect(get('adj').effects?.[0].type).toBe('colour')
    expect(get('pic').start).toBe(2)
  })
  it('the compound’s opacity reaches keyed and plain opacity; its volume the sound', () => {
    expect(sampleProp(get('pic'), 'opacity', 0, 1)).toBeCloseTo(0.5)
    expect(sampleProp(get('pic'), 'opacity', 4, 1)).toBeCloseTo(0.25)
    expect(get('adj').opacity).toBeCloseTo(0.5)
    expect(get('snd').volume).toBeCloseTo(0.4)
  })
})
