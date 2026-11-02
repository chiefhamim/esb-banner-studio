// Phase 2 fix-round merge (video-p2-fix + video-p2-ui): the seams between them.
//  - the UI's `hold` ease through the logic side's file cleaner and exact splits
//  - an adjustment layer acts on the tracks below it only, never on clips beside it on its own track
import { describe, expect, it } from 'vitest'
import type { Clip, Keyframe, VideoProject } from '../../src/video/timeline'
import { createDefaultTimeline, flattenCompounds } from '../../src/video/timeline'
import { cutKeyframes, insertKeyAt, sampleKeys, sanitizeKeyframes, sanitizeKeyList } from '../../src/video/keyframes'
import { sampleProp } from '../../src/video/engine/animation'
import { renderFrame } from '../../src/video/engine/render'
import type { GLCompositor } from '../../src/video/engine/glCompositor'

const clip = (o: Partial<Clip>): Clip => ({ id: 'c', trackId: 'v1', title: 'c', kind: 'video', start: 0, duration: 4, in: 0, out: 4, color: '#000', ...o })

describe('hold ease after the merge', () => {
  const held: Keyframe[] = [{ t: 0, v: 1, ease: 'hold' }, { t: 2, v: 0, ease: 'easeInOut' }, { t: 4, v: 1 }]

  it('a project file keeps a hold ease (sanitizeKeyframes / sanitizeKeyList whitelist)', () => {
    expect(sanitizeKeyList(held)[0].ease).toBe('hold')
    const k = sanitizeKeyframes({ opacity: held })
    expect(k?.opacity[0].ease).toBe('hold')
    expect(k?.opacity[1].ease).toBe('easeInOut')
  })

  it('the engine samples a hold as a step', () => {
    const c = clip({ keyframes: { opacity: held } })
    expect(sampleProp(c, 'opacity', 0, 0.5)).toBe(1)
    expect(sampleProp(c, 'opacity', 1.999, 0.5)).toBe(1)
    expect(sampleProp(c, 'opacity', 2, 0.5)).toBe(0)
  })

  it('splitting a hold segment gives two holds and samples the same everywhere', () => {
    const { keys, exact } = insertKeyAt(held, 1.25)
    expect(exact).toBe(true)
    expect(keys.map((k) => k.t)).toEqual([0, 1.25, 2, 4])
    expect(keys[0].ease).toBe('hold')
    expect(keys[1]).toMatchObject({ t: 1.25, v: 1, ease: 'hold' })
    for (let i = 0; i <= 400; i++) {
      const t = (i / 400) * 4
      expect(sampleKeys(keys, t)!).toBeCloseTo(sampleKeys(held, t)!, 9)
    }
  })

  it('cutKeyframes (trim / split) across a hold keeps the step where it was', () => {
    const cut = cutKeyframes({ opacity: held }, 1, 3)!.opacity
    expect(cut[0]).toMatchObject({ t: 0, v: 1, ease: 'hold' })
    for (let i = 0; i <= 200; i++) {
      const t = (i / 200) * 2
      expect(sampleKeys(cut, t)!).toBeCloseTo(sampleKeys(held, t + 1)!, 6)
    }
    // the step is still at the original key (local 1 s = timeline 2 s)
    expect(sampleKeys(cut, 0.999)).toBe(1)
    expect(sampleKeys(cut, 1)).toBe(0)
  })
})

describe('hold ease in a compound', () => {
  it('a held compound opacity × a keyed inner opacity stays a step (no 1/60 s ramp before it)', () => {
    const base = createDefaultTimeline()
    const pic = clip({ id: 'pic', keyframes: { opacity: [{ t: 0, v: 1 }, { t: 4, v: 0.5 }] } })
    const X = clip({ id: 'X', duration: 4, compound: { tracks: base.tracks, clips: [pic] }, keyframes: { opacity: [{ t: 0, v: 1, ease: 'hold' }, { t: 2, v: 0 }] } })
    const flat = flattenCompounds({ ...base, clips: [X] } as VideoProject)
    const p = flat.clips.find((c) => c.id === 'X/pic')!
    const inner = (t: number) => 1 - 0.125 * t
    expect(sampleProp(p, 'opacity', 1.99, 1)).toBeCloseTo(inner(1.99), 3)
    expect(sampleProp(p, 'opacity', 2 - 1e-5, 1)).toBeCloseTo(inner(2), 3)
    expect(sampleProp(p, 'opacity', 2, 1)).toBeCloseTo(0, 9)
    expect(sampleProp(p, 'opacity', 3, 1)).toBeCloseTo(0, 9)
  })
})

// a compositor that records what it was asked to draw, in order
function recorder() {
  const calls: string[] = []
  const tex = (key: string) => ({ key })
  const comp = {
    begin: () => {},
    staticTexture: (key: string) => tex(key),
    slotTexture: (id: string) => tex(id),
    lutTexture: () => null,
    draw: (d: { tex: { key: string } }) => { calls.push('draw ' + d.tex.key.split('|')[0]) },
    adjust: () => { calls.push('adjust') },
    mix: () => { calls.push('mix') },
    pruneSlots: () => {},
  }
  return { comp: comp as unknown as GLCompositor, calls }
}

describe('adjustment layer: tracks below only', () => {
  const frame = { image: {}, width: 1920, height: 1080, live: false }
  const project = (clips: Clip[]): VideoProject => ({ ...createDefaultTimeline(), bug: false, clips } as VideoProject)
  const footage = clip({ id: 'foot', trackId: 'v1', kind: 'video', sourceUrl: 'blob:foot', duration: 10, out: 10 })
  const lower = clip({ id: 'lower', trackId: 'v2', kind: 'overlay', overlayType: 'lower-third', overlayText: 'Lower third', start: 0, duration: 6, out: 6 } as Partial<Clip>)
  const adj = clip({ id: 'adj', trackId: 'v2', kind: 'overlay', adjustment: true, start: 2, duration: 6, out: 6, effects: [{ id: 'g', type: 'colour', enabled: true, params: { saturation: -1 } }] } as Partial<Clip>)
  const order = (clips: Clip[]) => {
    const { comp, calls } = recorder()
    renderFrame(comp, project(clips), 3, 1920, 1080, { frames: () => frame as never })
    return calls
  }

  it('a lower third on the adjustment layer\'s own track (starting before it) is drawn after the adjustment, unchanged', () => {
    const calls = order([footage, lower, adj])
    expect(calls.filter((c) => c === 'adjust')).toHaveLength(1)
    const ia = calls.indexOf('adjust')
    expect(calls.findIndex((c) => c.startsWith('draw foot'))).toBeLessThan(ia)
    expect(calls.slice(ia + 1).some((c) => c.startsWith('draw') && !c.startsWith('draw foot'))).toBe(true)
  })

  it('same picture as the adjustment on its own track between V1 and V2 (the reference)', () => {
    const own = project([footage, lower, { ...adj, trackId: 'adj' }])
    own.tracks = [...own.tracks.filter((t) => t.kind !== 'audio' && t.id !== 'v1'), { id: 'adj', name: 'Adjustment', kind: 'overlay', muted: false, locked: false }, ...own.tracks.filter((t) => t.id === 'v1' || t.kind === 'audio')]
    const { comp, calls } = recorder()
    renderFrame(comp, own, 3, 1920, 1080, { frames: () => frame as never })
    expect(order([footage, lower, adj])).toEqual(calls)
  })

  it('alone on its track it still adjusts everything below', () => {
    const calls = order([footage, adj])
    expect(calls).toEqual(['draw foot', 'adjust'])
  })
})
