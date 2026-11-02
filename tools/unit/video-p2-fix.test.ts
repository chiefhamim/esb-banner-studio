// Phase 2 fix round: the reviewers' findings (security S1–S6, correctness C1–C10, the paste-attributes gap, perf P1/P2/P6
// on the model side), each as a regression test. Reviewers' probes reused where they measured something.
import { describe, expect, it } from 'vitest'
import type { Clip, VideoProject } from '../../src/video/timeline'
import * as T from '../../src/video/timeline'
import * as S from '../../src/video/speed'
import * as K from '../../src/video/keyframes'
import * as E from '../../src/video/effects'
import { buildProjectDoc, parseProjectText } from '../../src/video/projectFolder'
import { fallbackOffset, srcAt } from '../../src/video/engine/animation'

const base: Clip = { id: 'v', trackId: 'v1', title: 'x', kind: 'video', start: 0, duration: 10, in: 0, out: 10, srcDuration: 30, color: '#000' }
const proj = (clips: Clip[], extra: Partial<VideoProject> = {}): VideoProject => ({ ...T.createDefaultTimeline('16:9'), clips, ...extra })
const fileWith = (clipExtra: Record<string, unknown>) => JSON.stringify({ id: 'p', tracks: [{ id: 'v1', kind: 'video' }], clips: [{ id: 'c1', trackId: 'v1', kind: 'video', start: 0, duration: 5, in: 0, out: 5, srcDuration: 5, ...clipExtra }] })
const maxDiff = (f: (t: number) => number, g: (t: number) => number, a: number, b: number, n = 400) => {
  let m = 0
  for (let i = 0; i <= n; i++) { const t = a + ((b - a) * i) / n; m = Math.max(m, Math.abs(f(t) - g(t))) }
  return m
}

describe('S1/S5: crafted keyframes, ramps and freezes are cleaned on open', () => {
  const cases: Record<string, Record<string, unknown>> = {
    rampNull: { speed: { ramp: [null] } },
    freezesNull: { freezes: [null] },
    freezesObj: { freezes: { a: 1 } },
    kfNull: { keyframes: { opacity: [null, null] } },
    kfNum: { keyframes: { x: 5 } },
    speedStr: { speed: 'fast' },
    rampNaN: { speed: { ramp: [{ t: 'x', v: 2 }, { t: 1e308, v: 0.1 }] }, out: 1e300 },
    proto: { keyframes: JSON.parse('{"__proto__":[{"t":0,"v":1}],"constructor":[{"t":0,"v":1}],"opacity":[{"t":2,"v":0.5},{"t":1,"v":"x"},{"t":0,"v":1,"ease":"nope"}]}') },
  }
  for (const [name, extra] of Object.entries(cases)) {
    it(`${name}: loads, and nothing the inspector, the engine or an edit calls throws`, () => {
      const p = T.deserializeVideoProject(fileWith(extra))!
      expect(p).toBeTruthy()
      const c = p.clips[0]
      expect(() => {
        S.sourceTimeAt(c, 1); S.clipDurationFor(c); S.constantSpeed(c); S.isFrozenAt(c, 1); S.speedAt(c, 0.5)
        K.valueAt(c, 'opacity', 1); K.keyTimes(c); K.keyTimes(c, 'x')
        T.layersAt(p, 1); T.flattenCompounds(p); T.serializeVideoProject(p)
        T.splitClip(p, 'c1', 2); T.trimClipLeft(p, 'c1', 1); T.trimClipRight(p, 'c1', -1)
        srcAt(c, 1)
      }).not.toThrow()
      for (const ks of Object.values(c.keyframes ?? {})) for (const k of ks) { expect(Number.isFinite(k.t)).toBe(true); expect(Number.isFinite(k.v)).toBe(true) }
      expect(({} as Record<string, unknown>).t).toBeUndefined()
    })
  }
  it('only known property names survive (PROPS, fx.<own effect>.<numeric param>); keys sorted, capped, deduped', () => {
    const p = T.deserializeVideoProject(fileWith({
      effects: [{ id: 'b1', type: 'blur', params: { radius: 4 } }],
      keyframes: { opacity: [{ t: 2, v: 0.5 }, { t: 0, v: 1 }, { t: 2, v: 0.25 }], 'fx.b1.radius': [{ t: 0, v: 2 }], 'fx.b1.nope': [{ t: 0, v: 2 }], 'fx.zz.radius': [{ t: 0, v: 1 }], hack: [{ t: 0, v: 1 }], x: Array.from({ length: 5000 }, (_, i) => ({ t: i, v: i })) },
    }))!
    const kf = p.clips[0].keyframes!
    expect(Object.keys(kf).sort()).toEqual(['fx.b1.radius', 'opacity', 'x'])
    expect(kf.opacity.map((k) => [k.t, k.v])).toEqual([[0, 1], [2, 0.25]])
    expect(kf.x.length).toBe(K.MAX_KEYS)
  })
  it('speed and freezes: finite, clamped, capped, merged', () => {
    expect(S.sanitizeSpeed(50)).toBe(10)
    expect(S.sanitizeSpeed(1)).toBeUndefined()
    expect(S.sanitizeSpeed(NaN)).toBeUndefined()
    expect(S.sanitizeSpeed({ ramp: [{ t: 1, v: 99 }, { t: 0, v: -3 }] })).toEqual({ ramp: [{ t: 0, v: 0.1 }, { t: 1, v: 10 }] })
    expect(S.sanitizeFreezes([{ at: 2, dur: 1 }, { at: 0, dur: 1 }, { at: 2.5, dur: 1 }, { at: 5, dur: -1 }])).toEqual([{ at: 0, dur: 1 }, { at: 2, dur: 1.5 }])
    expect(S.sanitizeFreezes(Array.from({ length: 200000 }, (_, i) => ({ at: i * 0.001, dur: 0.0001 })))!.length).toBeLessThanOrEqual(S.MAX_FREEZES)
  })
})

describe('S2: the engine fallback and speed.ts stay fast on crafted input', () => {
  it('a ramp with freezes is integrated analytically (no 240 Hz step loop)', () => {
    const ramp = Array.from({ length: 200 }, (_, i) => ({ t: (i * 600) / 200, v: 1 + (i % 3) }))
    const c: Clip = { ...base, duration: 600, out: 600, srcDuration: 600, speed: { ramp }, freezes: [{ at: 1, dur: 0.5 }] }
    const t0 = performance.now()
    for (let i = 0; i < 100; i++) fallbackOffset(c, 540)
    expect((performance.now() - t0) / 100).toBeLessThan(10) // was 72–881 ms (generous: the suite runs 83 files at once)
    // exact against a fine midpoint sum
    let acc = 0
    const n = 200000
    const h = 10 / n
    for (let i = 0; i < n; i++) { const m = (i + 0.5) * h; if (!(m >= 1 && m < 1.5)) { const r = ramp; let v = r[r.length - 1].v; for (let j = 1; j < r.length; j++) if (m < r[j].t) { v = r[j - 1].v + ((r[j].v - r[j - 1].v) * (m - r[j - 1].t)) / (r[j].t - r[j - 1].t); break } acc += v * h } }
    expect(fallbackOffset(c, 10)).toBeCloseTo(acc, 5)
  })
  it('a 200,000-freeze file opens and one look-up is quick', () => {
    const freezes = Array.from({ length: 200000 }, (_, i) => ({ at: i * 0.001, dur: 0.0001 }))
    const p = T.deserializeVideoProject(fileWith({ freezes, speed: { ramp: [{ t: 0, v: 1 }, { t: 1, v: 2 }] } }))!
    const t0 = performance.now()
    S.sourceTimeAt(p.clips[0], 1)
    expect(performance.now() - t0).toBeLessThan(1000)
  })
})

describe('S4: compound nesting is capped', () => {
  const open = '{"tracks":[{"id":"v1","kind":"video"}],"clips":[{"id":"c","trackId":"v1","kind":"video","start":0,"duration":5,"in":0,"out":5,"compound":'
  const leaf = '{"tracks":[],"clips":[]}'
  it('3000 levels open, cut to MAX_COMPOUND_DEPTH, and save', () => {
    const depth = 3000
    const text = '{"id":"p",' + open.slice(1) + open.repeat(depth - 1) + leaf + '}]}'.repeat(depth)
    const p = T.deserializeVideoProject(text)!
    expect(T.compoundDepth(p.clips)).toBeLessThanOrEqual(T.MAX_COMPOUND_DEPTH)
    const json = T.serializeVideoProject(p)
    expect(json.length).toBeLessThan(200_000)
  })
  it('makeCompound refuses past the cap', () => {
    let p = proj([{ ...base, id: 'a' }])
    for (let i = 0; i < T.MAX_COMPOUND_DEPTH; i++) p = T.makeCompound(p, [p.clips[0].id], `s${i}`)
    expect(T.compoundDepth(p.clips)).toBe(T.MAX_COMPOUND_DEPTH)
    expect(T.makeCompound(p, [p.clips[0].id], 'over')).toBe(p)
    expect(T.compoundProblem(p, [p.clips[0].id])).toMatch(/levels deep/)
  })
  it('a big project is written compactly, a small one indented', () => {
    expect(T.serializeVideoProject(proj([base]))).toContain('\n  ')
    expect(T.projectJson({ a: 'x'.repeat(T.PRETTY_JSON_MAX + 10), b: [1, 2] })).not.toContain('\n')
  })
})

describe('S6: a crafted project never makes the app fetch a URL on open', () => {
  it('clip and asset URLs other than this run’s media are dropped (→ Relink)', () => {
    const text = JSON.stringify({ id: 'p', tracks: [{ id: 'v1', kind: 'video' }], clips: [{ id: 'c1', trackId: 'v1', kind: 'video', start: 0, duration: 5, in: 0, out: 5, sourceUrl: 'https://evil.example/x.mp4', thumbnailUrl: 'https://evil.example/t.jpg' }, { id: 'c2', trackId: 'v1', kind: 'video', start: 5, duration: 5, in: 0, out: 5, sourceUrl: 'file:///C:/x.mp4', thumbnailUrl: 'data:image/png;base64,AAAA' }], mediaAssets: [{ id: 'm', name: 'm', type: 'video', url: 'https://evil.example/m.mp4', thumbnailUrl: 'https://evil.example/m.jpg', duration: 5, size: 1 }] })
    const p = T.deserializeVideoProject(text)!
    expect(p.clips.map((c) => c.sourceUrl)).toEqual([undefined, undefined])
    expect(p.clips.map((c) => c.thumbnailUrl)).toEqual([undefined, 'data:image/png;base64,AAAA'])
    expect(p.mediaAssets![0].url).toBe('')
    expect(p.mediaAssets![0].thumbnailUrl).toBeUndefined()
  })
})

describe('C1/P1/P8: a LUT is stored once per project, by content id', () => {
  const cube65 = E.compactCube(E.makeCube(65, (r, g, b) => [r * 0.987654, g * 0.876543, b * 0.765432]))
  it('a 65-point LUT on a clip split four times saves well under the 25 MB cap, with one copy of the text', () => {
    let p = proj([{ ...base, duration: 40, out: 40, srcDuration: 40 }])
    p = { ...p, clips: [{ ...p.clips[0], effects: [{ id: 'fx-lut-1', type: 'lut', enabled: true, params: { lut: E.registerLut(cube65)!, intensity: 1 } }] }] }
    for (const at of [8, 16, 24, 32]) p = T.splitClip(p, p.clips.find((c) => c.start < at && c.start + c.duration > at)!.id, at)
    expect(p.clips.length).toBe(5)
    const doc = buildProjectDoc(p, [], {})
    expect(doc.length).toBeLessThan(cube65.length * 1.2)
    expect(doc.split('LUT_3D_SIZE').length - 1).toBe(1)
    // and it opens again with every clip pointing at the same LUT
    const back = parseProjectText(doc)!.project
    const ids = new Set(back.clips.map((c) => c.effects![0].params!.lut))
    expect(ids.size).toBe(1)
    expect(E.lutText([...ids][0])).toBe(cube65)
  })
  it('an older project with the text inline in each clip is migrated to one id', () => {
    const cube = E.compactCube(E.makeCube(9, (r, g, b) => [r * 0.9, g, b]))
    const fx = { id: 'l', type: 'lut', params: { cube, intensity: 0.5 } }
    const text = JSON.stringify({ id: 'p', tracks: [{ id: 'v1', kind: 'video' }], clips: [{ ...base, id: 'a', effects: [fx] }, { ...base, id: 'b', start: 10, effects: [fx] }] })
    const p = T.deserializeVideoProject(text)!
    const id = E.lutId(cube)
    expect(p.clips.map((c) => c.effects![0].params)).toEqual([{ lut: id, intensity: 0.5 }, { lut: id, intensity: 0.5 }])
    const saved = JSON.parse(T.serializeVideoProject(p))
    expect(Object.keys(saved.luts)).toEqual([id])
    expect(saved.clips[0].effects[0].params.cube).toBeUndefined()
  })
  it('a file LUT that does not parse is dropped, and the parse runs once per distinct text', () => {
    const p = T.deserializeVideoProject(JSON.stringify({ id: 'p', tracks: [{ id: 'v1', kind: 'video' }], luts: { k: 'garbage' }, clips: [{ ...base, effects: [{ id: 'l', type: 'lut', params: { lut: 'k', intensity: 1 } }] }] }))!
    expect(p.clips[0].effects![0].params).toEqual({ intensity: 1 })
    const t = E.compactCube(E.makeCube(17, (r, g, b) => [g, b, r]))
    const a = E.registerLut(t)
    expect(E.registerLut(t)).toBe(a)
    expect(E.cachedCube(a!)).toBe(E.cachedCube(a!))
  })
  it('the project-wide LUT budget refuses with a reason', () => {
    const used = new Set([E.registerLut(cube65)!, E.registerLut(E.compactCube(E.makeCube(65, (r, g, b) => [r * 0.5, g, b])))!])
    expect(E.lutBudgetProblem(used, E.compactCube(E.makeCube(65, (r, g, b) => [r, g * 0.5, b])))).toMatch(/MB/)
    expect(E.lutBudgetProblem(used, cube65)).toBeNull()
    expect(E.lutBudgetProblem(new Set(), E.compactCube(E.makeCube(33, (r, g, b) => [r, g, b])))).toBeNull()
  })
})

describe('C2: splits and trims keep eased keyframes and ramps exactly', () => {
  it('insertKeyAt splits every ease (named and custom, overshoot too) without changing a sample', () => {
    for (const ease of ['easeIn', 'easeOut', 'easeInOut'] as const) {
      const ks = [{ t: 0, v: 0, ease }, { t: 10, v: 1 }]
      for (const tc of [0.7, 3, 5, 9.2]) {
        const r = K.insertKeyAt(ks, tc)
        expect(r.exact).toBe(true)
        expect(maxDiff((t) => K.sampleKeys(ks, t)!, (t) => K.sampleKeys(r.keys, t)!, 0, 10)).toBeLessThan(1e-6)
      }
    }
    const custom = [{ t: 1, v: 10, ease: 'bezier' as const, bezier: [0.3, -0.4, 0.6, 1.5] as [number, number, number, number] }, { t: 4, v: 30 }]
    const r = K.insertKeyAt(custom, 2.2)
    expect(maxDiff((t) => K.sampleKeys(custom, t)!, (t) => K.sampleKeys(r.keys, t)!, 0, 5)).toBeLessThan(1e-6)
  })
  it('an easeInOut opacity split at 3 s: both parts sample as the original', () => {
    let c: Clip = { ...base }
    c = K.setKey(c, 'opacity', 0, 0, 'easeInOut'); c = K.setKey(c, 'opacity', 10, 1)
    const [a, b] = T.splitClip(proj([c]), 'v', 3).clips.sort((x, y) => x.start - y.start)
    expect(maxDiff((t) => K.valueAt(c, 'opacity', t), (t) => K.valueAt(a, 'opacity', t), 0, 3)).toBeLessThan(1e-6)
    expect(maxDiff((t) => K.valueAt(c, 'opacity', t + 3), (t) => K.valueAt(b, 'opacity', t), 0, 7)).toBeLessThan(1e-6)
  })
  for (const preset of ['rampUp', 'hero', 'bullet', 'montage'] as const) {
    it(`a "${preset}" ramp split at 2 s and trimmed: the same source time at every moment, ending at out`, () => {
      const c = S.withRampPreset({ ...base }, preset)
      const [a, b] = T.splitClip(proj([c]), 'v', 2).clips.sort((x, y) => x.start - y.start)
      expect(maxDiff((t) => S.sourceTimeAt(c, t), (t) => S.sourceTimeAt(a, t), 0, 2 - 1e-9)).toBeLessThan(1e-6)
      expect(maxDiff((t) => S.sourceTimeAt(c, t + 2), (t) => S.sourceTimeAt(b, t), 0, b.duration)).toBeLessThan(1e-6)
      expect(Math.abs(S.clipDurationFor(b) - b.duration)).toBeLessThan(1e-6)
      expect(S.sourceTimeAt(b, b.duration + 5)).toBeLessThanOrEqual(b.out)
      const tr = T.trimClipRight(proj([c]), 'v', -2).clips[0]
      expect(maxDiff((t) => S.sourceTimeAt(c, t), (t) => S.sourceTimeAt(tr, t), 0, tr.duration)).toBeLessThan(1e-6)
      const sub = T.subClip(c, 1, c.duration)
      expect(maxDiff((t) => S.sourceTimeAt(c, t + 1), (t) => S.sourceTimeAt(sub, t), 0, sub.duration)).toBeLessThan(1e-6)
    })
  }
  it('forward sourceTimeAt never passes out (a retimed clip shown past its content)', () => {
    const c = { ...S.withConstantSpeed({ ...base }, 2), duration: 7 }
    expect(S.sourceTimeAt(c, 7)).toBe(10)
  })
})

describe('C3/C9: freeze frames', () => {
  it('a freeze on a ramped clip changes no frame before or after it', () => {
    for (const preset of ['rampUp', 'hero'] as const) {
      const c = S.withRampPreset({ ...base }, preset)
      const f = S.withFreeze(c, 2, 1)
      expect(f.duration).toBeCloseTo(c.duration + 1, 6)
      expect(maxDiff((t) => S.sourceTimeAt(c, t), (t) => S.sourceTimeAt(f, t), 0, 2)).toBeLessThan(1e-6)
      expect(maxDiff((t) => S.sourceTimeAt(c, t), (t) => S.sourceTimeAt(f, t + 1), 2, c.duration)).toBeLessThan(1e-6)
      for (const t of [2.1, 2.5, 2.99]) expect(S.sourceTimeAt(f, t)).toBeCloseTo(S.sourceTimeAt(c, 2), 6)
      // removing it gives the same mapping back
      const g = S.withoutFreeze(f, 0)
      expect(g.duration).toBeCloseTo(c.duration, 6)
      expect(maxDiff((t) => S.sourceTimeAt(c, t), (t) => S.sourceTimeAt(g, t), 0, c.duration)).toBeLessThan(1e-6)
    }
  })
  it('a freeze at the clip end holds the last frame (the clip grows), constant and ramped', () => {
    const c = S.withFreeze({ ...base }, 10, 2)
    expect(c.duration).toBe(12)
    expect(S.isFrozenAt(c, 10.5)).toBe(true)
    expect(S.sourceTimeAt(c, 11)).toBe(10)
    const r = S.withRampPreset({ ...base }, 'rampUp')
    const rf = S.withFreeze(r, r.duration, 1.5)
    expect(rf.duration).toBeCloseTo(r.duration + 1.5, 6)
  })
})

describe('C4: retime with a locked partner is refused (nothing overlaps)', () => {
  const A: Clip = { ...base, id: 'A', duration: 5, out: 5 }
  const B: Clip = { ...base, id: 'B', start: 5, duration: 5, in: 5, out: 10, linkId: 'L' }
  const Ba: Clip = { ...base, id: 'Ba', trackId: 'a1', kind: 'audio', start: 5, duration: 5, in: 5, out: 10, linkId: 'L' }
  const p = (() => { const q = proj([A, B, Ba]); return { ...q, tracks: q.tracks.map((t) => (t.id === 'a1' ? { ...t, locked: true } : t)) } })()
  it('retimeClip returns the project unchanged', () => {
    expect(T.retimeClip(p, 'A', (c) => S.withConstantSpeed(c, 0.5))).toBe(p)
  })
  it('paste attributes reports the clip whose speed could not change', () => {
    const src = S.withConstantSpeed({ ...base, id: 's', start: 30 }, 0.5)
    const report = { refused: [] as string[] }
    const next = T.pasteAttributes({ ...p, clips: [...p.clips, src] }, src, ['A'], ['speed'], report)
    expect(report.refused).toEqual(['A'])
    expect(next.clips.find((c) => c.id === 'A')!.duration).toBe(5)
  })
})

describe('C5: a compound clip never covers clips that are not in it', () => {
  it('refused with a note when an unselected clip lies in its span on its track', () => {
    const A: Clip = { ...base, id: 'A', duration: 5, out: 5 }
    const B: Clip = { ...base, id: 'B', start: 5, duration: 5, in: 5, out: 10, title: 'Interview' }
    const t: Clip = { id: 'T', trackId: 'v2', kind: 'overlay', title: 't', start: 8, duration: 4, in: 0, out: 4, color: '#000' }
    const p = proj([A, B, t])
    expect(T.makeCompound(p, ['A', 'T'], 's')).toBe(p)
    expect(T.compoundProblem(p, ['A', 'T'])).toMatch(/Interview/)
    expect(T.makeCompound(p, ['A', 'B', 'T'], 's').clips.length).toBe(1)
  })
  it('titles and captions together make an overlay compound (not an empty caption)', () => {
    const ov: Clip = { id: 'o', trackId: 'v2', kind: 'overlay', title: 'o', start: 0, duration: 4, in: 0, out: 4, color: '#000', overlayType: 'lower-third' }
    const cap: Clip = { id: 'c', trackId: 'c1', kind: 'caption', title: 'c', start: 0, duration: 4, in: 0, out: 4, color: '#000', captionText: 'x' }
    const X = T.makeCompound(proj([ov, cap]), ['o', 'c'], 's').clips[0]
    expect([X.kind, X.trackId]).toEqual(['overlay', 'v2'])
  })
})

describe('C6: a compound’s opacity and volume keyframes reach its inside; unsupported groups are not offered', () => {
  it('compound opacity keys are applied to the inner clips (cut to their window)', () => {
    let p = T.makeCompound(proj([{ ...base, id: 'a', duration: 4, out: 4 }, { ...base, id: 'b', start: 4, duration: 4, in: 4, out: 8 }]), ['a', 'b'], 's')
    const X = p.clips[0]
    const keyed: Clip = { ...X, keyframes: { opacity: [{ t: 0, v: 0, ease: 'easeInOut' }, { t: 8, v: 1 }] } }
    p = { ...p, clips: [keyed] }
    const f = T.flattenCompounds(p)
    const b = f.clips.find((c) => c.id.endsWith('/b'))!
    expect(maxDiff((t) => K.valueAt(keyed, 'opacity', t + 4), (t) => K.valueAt(b, 'opacity', t), 0, 4)).toBeLessThan(1e-6)
    // keyed inside × keyed compound: sampled, close
    const inner = { ...X.compound!.clips[0], keyframes: { opacity: [{ t: 0, v: 1 }, { t: 4, v: 0.5 }] } }
    const p2 = { ...p, clips: [{ ...keyed, compound: { ...X.compound!, clips: [inner, X.compound!.clips[1]] } }] }
    const a2 = T.flattenCompounds(p2).clips.find((c) => c.id.endsWith('/a'))!
    expect(maxDiff((t) => K.valueAt(keyed, 'opacity', t) * K.valueAt(inner, 'opacity', t), (t) => K.valueAt(a2, 'opacity', t), 0, 4)).toBeLessThan(2e-3)
  })
  it('attrGroupsFor a compound: opacity, volume, keyframes only', () => {
    const X = T.makeCompound(proj([{ ...base, id: 'a' }]), ['a'], 's').clips[0]
    expect(T.attrGroupsFor(X)).toEqual(['opacity', 'volume', 'keyframes'])
  })
})

describe('C8: markers ripple with the edit (option, default on)', () => {
  const A: Clip = { ...base, id: 'A', duration: 5, out: 5 }
  const B: Clip = { ...base, id: 'B', start: 5, duration: 5, in: 5, out: 10 }
  it('ripple delete, extract and insert move later markers; a marker inside a closed span lands at the cut', () => {
    let p = proj([A, B]); p = T.addMarker(p, 7, { id: 'm' }); p = T.addMarker(p, 2, { id: 'in' })
    const r = T.rippleDelete(p, 'A')
    expect(r.markers!.map((m) => [m.id, m.t])).toEqual([['in', 0], ['m', 2]])
    const x = T.extractRange(p, 1, 3)
    expect(x.markers!.find((m) => m.id === 'm')!.t).toBe(5)
    expect(x.markers!.find((m) => m.id === 'in')!.t).toBe(1)
    const ins = T.insertClips(p, [{ ...base, id: 'N', start: 5, duration: 2, out: 2 }])
    expect(ins.markers!.find((m) => m.id === 'm')!.t).toBe(9)
  })
  it('off: markers stay', () => {
    let p = proj([A, B], { rippleMarkers: false }); p = T.addMarker(p, 7, { id: 'm' })
    expect(T.rippleDelete(p, 'A').markers![0].t).toBe(7)
    expect(T.deserializeVideoProject(T.serializeVideoProject(p))!.rippleMarkers).toBe(false)
  })
})

describe('C10: an effect renamed on open keeps its keyframes', () => {
  it('a duplicate id gets a new one and its keys follow', () => {
    const p = T.deserializeVideoProject(fileWith({
      effects: [{ id: 'fx-1', type: 'blur', params: { radius: 2 } }, { id: 'fx-1', type: 'sharpen', params: { amount: 0.5 } }],
      keyframes: { 'fx.fx-1.amount': [{ t: 0, v: 1 }, { t: 2, v: 0 }], 'fx.fx-1.radius': [{ t: 0, v: 3 }] },
    }))!
    const c = p.clips[0]
    const sharpen = c.effects!.find((e) => e.type === 'sharpen')!
    expect(sharpen.id).not.toBe('fx-1')
    expect(c.keyframes![`fx.${sharpen.id}.amount`]).toHaveLength(2)
    expect(c.keyframes!['fx.fx-1.radius']).toHaveLength(1)
    expect(c.keyframes!['fx.fx-1.amount']).toBeUndefined()
  })
})

describe('GAP: paste attributes has an effects group', () => {
  it('effects, blend mode and their keyframes paste onto a visual clip', () => {
    const src: Clip = { ...base, id: 's', effects: [{ id: 'b1', type: 'blur', enabled: true, params: { radius: 6 } }], blendMode: 'screen', keyframes: { 'fx.b1.radius': [{ t: 0, v: 1 }, { t: 2, v: 9 }], opacity: [{ t: 0, v: 1 }] } }
    const tgt: Clip = { ...base, id: 't', start: 20 }
    expect(T.attrGroupsFor(tgt)).toContain('effects')
    const p = T.pasteAttributes(proj([src, tgt]), src, ['t'], ['effects'])
    const t = p.clips.find((c) => c.id === 't')!
    expect(t.effects).toEqual(src.effects)
    expect(t.blendMode).toBe('screen')
    expect(Object.keys(t.keyframes!)).toEqual(['fx.b1.radius'])
    expect(T.attrGroupsFor({ ...base, kind: 'audio' })).not.toContain('effects')
  })
})

describe('P6: one ramp table per ramp, cheap for a long clip', () => {
  it('a 600 s ramp: the table builds in a few ms and does not depend on the clip length', () => {
    const ramp = [{ t: 0, v: 1, ease: 'easeInOut' as const }, { t: 300, v: 3, ease: 'easeInOut' as const }, { t: 600, v: 1 }]
    const c: Clip = { ...base, duration: 600, out: 1000, srcDuration: 2000, speed: { ramp } }
    const t0 = performance.now()
    S.clipDurationFor(c)
    const first = performance.now() - t0
    expect(first).toBeLessThan(250)
    const t1 = performance.now()
    S.clipDurationFor({ ...c, duration: 900 })
    expect(performance.now() - t1).toBeLessThan(30)
  })
})
