// Phase 2 — Part A: edit operations, keyframes and speed (pure functions) and the store's one-step-per-gesture rule.
import { beforeEach, describe, expect, it } from 'vitest'
import {
  addMarker, breakCompound, clearRange, compoundView, contentEnd, createDefaultTimeline, deserializeVideoProject, editPointAt,
  extractRange, flattenCompounds, groupClips, insertClips, layersAt, liftRange, magnetize, makeCompound, markerNear, moveClip,
  deleteClip, overwriteClips, pasteAttributes, removeMarker, retimeClip, rippleDelete, rippleTrim, rollEdit, serializeVideoProject,
  slideClip, slipClip, splitClip, trimClipLeft, trimClipRight, ungroupClips, updateMarker, writeCompoundView,
} from '../../src/video/timeline'
import type { Clip, VideoProject } from '../../src/video/timeline'
import { applyEase, cubicBezier, cutKeyframes, keyAt, moveKey, removeKey, sampleProp, setKey, setKeyEase, toggleKey, valueAt } from '../../src/video/keyframes'
import { REVERSE_EPS, audioPlaybackAt, audioRateAt, clipDurationFor, progressAt, sourceTimeAt, withConstantSpeed, withFreeze, withRampPreset, withReverse, withoutFreeze } from '../../src/video/speed'
import { useVideoStore, viewOf } from '../../src/video/videoStore'

const clip = (o: Partial<Clip> & Pick<Clip, 'id' | 'trackId' | 'kind'>): Clip => ({ title: o.id, start: 0, duration: 5, in: 0, out: 5, color: '#000', ...o })
const media = (o: Partial<Clip> & Pick<Clip, 'id' | 'trackId' | 'kind'>): Clip => clip({ srcDuration: 30, sourceUrl: `blob:${o.id}`, ...o })
const get = (p: VideoProject, id: string) => p.clips.find((c) => c.id === id)!
const end = (c: Clip) => c.start + c.duration

/** V1: a (0–5) b (5–10) c (10–15), each linked to its sound on A1; a title on V2 at 12–14. */
function cut(): VideoProject {
  const p = createDefaultTimeline()
  const pair = (id: string, start: number, inn: number) => [
    media({ id, trackId: 'v1', kind: 'video', start, in: inn, out: inn + 5, linkId: `L${id}` }),
    media({ id: `${id}s`, trackId: 'a1', kind: 'audio', start, in: inn, out: inn + 5, linkId: `L${id}` }),
  ]
  return { ...p, clips: [...pair('a', 0, 2), ...pair('b', 5, 10), ...pair('c', 10, 1), clip({ id: 't', trackId: 'v2', kind: 'overlay', start: 12, duration: 2, out: 2, overlayType: 'card' })] }
}
const inSync = (p: VideoProject) => p.clips.filter((c) => c.kind === 'video' && c.linkId).every((v) => {
  const a = p.clips.find((x) => x.linkId === v.linkId && x.id !== v.id)!
  return Math.abs(a.start - v.start) < 1e-9 && Math.abs(a.duration - v.duration) < 1e-9 && Math.abs(a.in - v.in) < 1e-9 && Math.abs(a.out - v.out) < 1e-9
})

describe('ripple', () => {
  it('ripple delete closes the gap on every track and keeps linked footage and sound in sync', () => {
    const p = rippleDelete(cut(), 'b')
    expect(p.clips.some((c) => c.id === 'b' || c.id === 'bs')).toBe(false)
    expect([get(p, 'c').start, get(p, 'cs').start, get(p, 't').start]).toEqual([5, 5, 7])
    expect(inSync(p)).toBe(true)
    expect(contentEnd(p)).toBe(10)
  })

  it('ripple delete is refused on a locked track (and through a link to one)', () => {
    const p0 = cut()
    const p = { ...p0, tracks: p0.tracks.map((t) => (t.id === 'a1' ? { ...t, locked: true } : t)) }
    expect(rippleDelete(p, 'b')).toBe(p)
    // a later clip on a locked track stays; its linked footage would come apart, so the ripple is refused too
    expect(rippleDelete(p, 'a')).toBe(p)
  })

  it('ripple trim of the tail moves everything after, linked sound trims with it', () => {
    const p = rippleTrim(cut(), 'b', 'right', -2)
    expect([get(p, 'b').duration, get(p, 'bs').duration, get(p, 'b').out]).toEqual([3, 3, 13])
    expect([get(p, 'c').start, get(p, 'cs').start, get(p, 't').start]).toEqual([8, 8, 10])
    expect(inSync(p)).toBe(true)
  })

  it('ripple trim of the head keeps the clip start and pulls the rest up', () => {
    const p = rippleTrim(cut(), 'b', 'left', 1.5)
    expect([get(p, 'b').start, get(p, 'b').in, get(p, 'b').duration]).toEqual([5, 11.5, 3.5])
    expect(get(p, 'c').start).toBe(8.5)
    expect(inSync(p)).toBe(true)
    // extending the head is limited by the media before the in point (10 s for b at 1×)
    const q = rippleTrim(cut(), 'b', 'left', -50)
    expect([get(q, 'b').in, get(q, 'b').duration, get(q, 'c').start]).toEqual([0, 15, 20])
  })
})

describe('roll, slip, slide', () => {
  it('roll moves the edit point and keeps the total length', () => {
    const p0 = cut()
    const before = contentEnd(p0)
    const p = rollEdit(p0, 'a', 'b', 1.25)
    expect([end(get(p, 'a')), get(p, 'b').start, get(p, 'b').in]).toEqual([6.25, 6.25, 11.25])
    expect(get(p, 'a').duration + get(p, 'b').duration).toBe(10)
    expect(contentEnd(p)).toBe(before)
    expect(get(p, 'c').start).toBe(10)
    expect(inSync(p)).toBe(true)
    // limited by the right clip's minimum length
    const q = rollEdit(p0, 'a', 'b', 99)
    expect(get(q, 'b').duration).toBeCloseTo(0.2, 9)
    expect(editPointAt(p0, 'v1', 5.1, 0.2)).toMatchObject({ left: { id: 'a' }, right: { id: 'b' } })
  })

  it('slip changes the content but keeps the timeline position and length', () => {
    const p = slipClip(cut(), 'b', 3)
    expect([get(p, 'b').start, get(p, 'b').duration, get(p, 'b').in, get(p, 'b').out]).toEqual([5, 5, 13, 18])
    expect(inSync(p)).toBe(true)
    // limited by the file: in cannot go below 0, out not past the end (30 s)
    expect(get(slipClip(cut(), 'b', -99), 'b').in).toBe(0)
    expect(get(slipClip(cut(), 'b', 99), 'b').out).toBe(30)
    // titles have no source to slip
    const p0 = cut()
    expect(slipClip(p0, 't', 1)).toBe(p0)
  })

  it('slide moves a clip between its neighbours and keeps their total', () => {
    const p0 = cut()
    const total = get(p0, 'a').duration + get(p0, 'c').duration
    const p = slideClip(p0, 'b', 1)
    expect([get(p, 'b').start, get(p, 'b').in, get(p, 'b').duration]).toEqual([6, 10, 5])
    expect([get(p, 'a').duration, get(p, 'c').start, get(p, 'c').duration, get(p, 'c').in]).toEqual([6, 11, 4, 2])
    expect(get(p, 'a').duration + get(p, 'c').duration).toBe(total)
    expect(contentEnd(p)).toBe(contentEnd(p0))
    expect(inSync(p)).toBe(true)
    // limited by the next clip's media before its in point (c starts 1 s into its file) and by minimum lengths
    expect(get(slideClip(p0, 'b', -99), 'a').duration).toBeCloseTo(4, 9)
    expect(get(slideClip(p0, 'b', 99), 'c').duration).toBeCloseTo(0.2, 9)
  })
})

describe('insert, overwrite, lift, extract', () => {
  it('insert splits at the point and pushes every track later, in sync', () => {
    const add = media({ id: 'n', trackId: 'v1', kind: 'video', start: 7, duration: 2, out: 2 })
    const p = insertClips(cut(), [add])
    const v1 = p.clips.filter((c) => c.trackId === 'v1').sort((x, y) => x.start - y.start)
    expect(v1.map((c) => [c.start, c.duration])).toEqual([[0, 5], [5, 2], [7, 2], [9, 3], [12, 5]])
    expect(get(p, 't').start).toBe(14)
    expect(inSync(p)).toBe(true)
  })

  it('overwrite replaces what is under the new clip, cutting its linked sound the same way', () => {
    const add = media({ id: 'n', trackId: 'v1', kind: 'video', start: 7, duration: 2, out: 2 })
    const p = overwriteClips(cut(), [add])
    const v1 = p.clips.filter((c) => c.trackId === 'v1').sort((x, y) => x.start - y.start)
    expect(v1.map((c) => [c.id.startsWith('b') ? 'b' : c.id, c.start, c.duration])).toEqual([['a', 0, 5], ['b', 5, 2], ['n', 7, 2], ['b', 9, 1], ['c', 10, 5]])
    const right = v1[3]
    expect(right.in).toBe(14)
    const a1 = p.clips.filter((c) => c.trackId === 'a1').sort((x, y) => x.start - y.start)
    expect(a1.map((c) => [c.start, c.duration])).toEqual([[0, 5], [5, 2], [9, 1], [10, 5]])
    expect(a1[2].linkId).toBe(right.linkId)
    expect(contentEnd(p)).toBe(15)
  })

  it('lift leaves the gap; extract closes it on every track', () => {
    const l = liftRange(cut(), 6, 8)
    expect(l.clips.filter((c) => c.trackId === 'v1').map((c) => [c.start, c.duration]).sort((x, y) => x[0] - y[0])).toEqual([[0, 5], [5, 1], [8, 2], [10, 5]])
    const e = extractRange(cut(), 6, 8)
    expect(e.clips.filter((c) => c.trackId === 'v1').map((c) => [c.start, c.duration]).sort((x, y) => x[0] - y[0])).toEqual([[0, 5], [5, 1], [6, 2], [8, 5]])
    expect(get(e, 't').start).toBe(10)
    expect(inSync(e)).toBe(true)
    const p0 = cut()
    const locked = { ...p0, tracks: p0.tracks.map((t) => (t.id === 'a1' ? { ...t, locked: true } : t)) }
    expect(clearRange(locked, 6, 8, ['v1'])).toBe(locked)
  })
})

describe('magnetic main track, markers, groups', () => {
  it('magnetize closes V1 gaps, moving linked sound along; an overlap (crossfade) stays', () => {
    const p0 = cut()
    const gapped = { ...p0, clips: p0.clips.map((c) => (c.id === 'c' || c.id === 'cs' ? { ...c, start: 13 } : c.id === 'a' || c.id === 'as' ? { ...c, start: 1 } : c)) }
    const p = magnetize(gapped)
    expect([get(p, 'a').start, get(p, 'b').start, get(p, 'c').start, get(p, 'cs').start]).toEqual([0, 5, 10, 10])
    expect(get(p, 'as').start).toBe(0)
    expect(magnetize(p)).toBe(p)
    const fade = { ...p0, clips: p0.clips.map((c) => (c.id === 'b' || c.id === 'bs' ? { ...c, start: 4 } : c)) }
    expect(get(magnetize(fade), 'b').start).toBe(4)
  })

  it('markers: add, name, colour, move, jump, remove; saved with the project', () => {
    let p = addMarker(cut(), 3, { id: 'm1' })
    p = addMarker(p, 9, { id: 'm2' })
    expect(addMarker(p, 3.001)).toBe(p)
    p = updateMarker(p, 'm2', { name: 'Interview starts', color: '#22c55e', t: 8 })
    expect(p.markers).toEqual([{ id: 'm1', t: 3, name: '', color: '#f59e0b' }, { id: 'm2', t: 8, name: 'Interview starts', color: '#22c55e' }])
    expect(markerNear(p, 3, 1)?.id).toBe('m2')
    expect(markerNear(p, 8, -1)?.id).toBe('m1')
    const back = deserializeVideoProject(serializeVideoProject(p))!
    expect(back.markers).toEqual(p.markers)
    expect(removeMarker(p, 'm1').markers?.map((m) => m.id)).toEqual(['m2'])
  })

  it('groups move and delete as one; ungroup separates them', () => {
    const g = groupClips(cut(), ['a', 't'], 'k')
    expect(get(g, 'as').groupId).toBe('grp-k')
    const m = moveClip(g, 'a', 3)
    expect([get(m, 'a').start, get(m, 'as').start, get(m, 't').start, get(m, 'b').start]).toEqual([3, 3, 15, 5])
    expect(deleteClip(g, 't').clips.map((c) => c.id).sort()).toEqual(['b', 'bs', 'c', 'cs'])
    const u = ungroupClips(g, ['t'])
    expect(get(moveClip(u, 'a', 3), 't').start).toBe(12)
  })
})

describe('compound clips', () => {
  it('a compound holds its clips as a nested timeline, flattens back to the same layers, and breaks apart', () => {
    const p0 = cut()
    const p = makeCompound(p0, ['b', 'c'], 'k')
    const X = get(p, 'clip-cmp-k')
    expect([X.start, X.duration, X.trackId, X.kind, X.compound!.clips.length]).toEqual([5, 10, 'v1', 'video', 4])
    expect(p.clips.some((c) => c.id === 'b')).toBe(false)
    const flat = flattenCompounds(p)
    // the same footage under the playhead as before, at the same source time
    for (const t of [6, 9.5, 12, 14.9]) {
      const want = layersAt(p0, t).filter((l) => l.clip.kind === 'video').map((l) => [l.clip.in + (t - l.clip.start)])
      const got = layersAt(flat, t).filter((l) => l.clip.kind === 'video').map((l) => [l.clip.in + (t - l.clip.start)])
      expect(got).toEqual(want)
    }
    expect(flat.clips.filter((c) => c.kind === 'audio').length).toBe(3)
    expect(flattenCompounds(p0)).toBe(p0)
    // a trimmed compound shows only its window
    const trimmed = trimClipLeft(p, X.id, 2)
    expect(flattenCompounds(trimmed).clips.find((c) => c.id === 'clip-cmp-k/b')).toMatchObject({ start: 7, duration: 3, in: 12 })
    const back = breakCompound(p, X.id)
    expect(back.clips.filter((c) => c.trackId === 'v1').map((c) => [c.start, c.duration]).sort((x, y) => x[0] - y[0])).toEqual([[0, 5], [5, 5], [10, 5]])
  })

  it('opens in place: edits inside write back into the compound; saved and reopened intact', () => {
    const p = makeCompound(cut(), ['b'], 'k')
    const view = compoundView(p, ['clip-cmp-k'])!
    expect(view.clips.map((c) => c.id).sort()).toEqual(['b', 'bs'])
    const edited = writeCompoundView(p, ['clip-cmp-k'], trimClipRight(view, 'b', -1))
    expect(get(edited, 'clip-cmp-k').compound!.clips.find((c) => c.id === 'b')!.duration).toBe(4)
    expect(get(edited, 'clip-cmp-k').srcDuration).toBe(4)
    expect(edited.tracks).toEqual(p.tracks)
    const re = deserializeVideoProject(serializeVideoProject(edited))!
    expect(get(re, 'clip-cmp-k').compound!.clips.length).toBe(2)
    expect(get(re, 'clip-cmp-k').compound!.clips.every((c) => c.sourceUrl === undefined)).toBe(true)
  })
})

describe('keyframes: sampleProp (the contract for the engine)', () => {
  const c = (keys: Clip['keyframes']) => clip({ id: 'k', trackId: 'v1', kind: 'video', duration: 10, out: 10, keyframes: keys })

  it('is exact at every keyframe, held outside them, and falls back when a property is not animated', () => {
    const k = c({ x: [{ t: 1, v: -0.25 }, { t: 4, v: 0.5, ease: 'easeIn' }, { t: 9, v: 0.1, ease: 'easeOut' }] })
    expect([sampleProp(k, 'x', 1, 0), sampleProp(k, 'x', 4, 0), sampleProp(k, 'x', 9, 0)]).toEqual([-0.25, 0.5, 0.1])
    expect([sampleProp(k, 'x', 0, 0), sampleProp(k, 'x', 10, 0)]).toEqual([-0.25, 0.1])
    expect(sampleProp(k, 'y', 3, 0.33)).toBe(0.33)
    expect(sampleProp(k, 'fx.blur1.radius', 3, 7)).toBe(7)
    expect(sampleProp(c({ 'fx.blur1.radius': [{ t: 0, v: 0 }, { t: 2, v: 10 }] }), 'fx.blur1.radius', 1, 0)).toBe(5)
  })

  it('linear, ease in, ease out, ease in-out and bezier are correct mid-way (CSS cubic-bezier reference values)', () => {
    const seg = (ease: Clip['keyframes'] extends infer _ ? unknown : never, bezier?: [number, number, number, number]) =>
      c({ s: [{ t: 0, v: 0, ease: ease as never, bezier }, { t: 2, v: 100 }] })
    expect(sampleProp(seg('linear'), 's', 1, 0)).toBeCloseTo(50, 9)
    expect(sampleProp(seg('easeIn'), 's', 1, 0)).toBeCloseTo(31.53568, 4)
    expect(sampleProp(seg('easeOut'), 's', 1, 0)).toBeCloseTo(68.46432, 4)
    expect(sampleProp(seg('easeInOut'), 's', 1, 0)).toBeCloseTo(50, 6)
    expect(sampleProp(seg('easeInOut'), 's', 0.5, 0)).toBeCloseTo(12.91619, 4)
    expect(sampleProp(seg('bezier', [0.25, 0.1, 0.25, 1]), 's', 0.6, 0)).toBeCloseTo(51.33152, 4)
    expect(sampleProp(seg([0.25, 0.1, 0.25, 1] as never), 's', 0.6, 0)).toBeCloseTo(51.33152, 4)
    // the older hyphenated spelling reads the same
    expect(sampleProp(seg('ease-in'), 's', 1, 0)).toBeCloseTo(31.53568, 4)
    expect(cubicBezier(0.5, [0.42, 0, 0.58, 1])).toBeCloseTo(0.5, 9)
    expect(applyEase({ ease: 'linear' }, 0.3)).toBe(0.3)
  })

  it('set, toggle, move, ease and remove keys (removing the last leaves the value it had)', () => {
    let k = c(undefined)
    k = setKey(k, 'scale', 2, 1.5)
    k = setKey(k, 'scale', 6, 2)
    expect(valueAt(k, 'scale', 4)).toBeCloseTo(1.75, 9)
    k = setKeyEase(k, 'scale', 2, 'bezier', [0.1, 0.8, 0.2, 1])
    expect(keyAt(k, 'scale', 2)?.bezier).toEqual([0.1, 0.8, 0.2, 1])
    k = moveKey(k, 'scale', 6, 8)
    expect(k.keyframes!.scale.map((x) => x.t)).toEqual([2, 8])
    k = toggleKey(k, 'scale', 8)
    k = removeKey(k, 'scale', 2)
    expect(k.keyframes).toBeUndefined()
    expect(k.scale).toBe(1.5)
  })

  it('trims and splits keep the animation where it was on screen', () => {
    const k = c({ x: [{ t: 0, v: 0 }, { t: 10, v: 1 }] })
    const p = { ...createDefaultTimeline(), clips: [{ ...k, start: 3 }] }
    const t = get(trimClipLeft(p, 'k', 4), 'k')
    expect(t.start).toBe(7)
    expect(sampleProp(t, 'x', 0, -1)).toBeCloseTo(0.4, 9)
    expect(sampleProp(t, 'x', 6, -1)).toBeCloseTo(1, 9)
    const s = splitClip(p, 'k', 8)
    const [a, b] = s.clips.sort((x, y) => x.start - y.start)
    expect(sampleProp(a, 'x', 5, -1)).toBeCloseTo(0.5, 9)
    expect(sampleProp(b, 'x', 0, -1)).toBeCloseTo(0.5, 9)
    expect(sampleProp(b, 'x', 2.5, -1)).toBeCloseTo(0.75, 9)
    expect(cutKeyframes(undefined, 0, 1)).toBeUndefined()
  })
})

describe('speed: sourceTimeAt and clipDurationFor (the contract for the engine)', () => {
  const src = (o: Partial<Clip>) => media({ id: 's', trackId: 'v1', kind: 'video', in: 0, out: 10, duration: 10, ...o })

  it('a clip without speed maps exactly as before (in + t)', () => {
    const c = src({ in: 2.5, out: 7.5, duration: 5 })
    expect([sourceTimeAt(c, 0), sourceTimeAt(c, 1.234), sourceTimeAt(c, 5)]).toEqual([2.5, 3.734, 7.5])
  })

  it('2× plays the source in half the length; 0.5× in twice', () => {
    const c = withConstantSpeed(src({}), 2)
    expect(c.duration).toBe(5)
    expect([sourceTimeAt(c, 0), sourceTimeAt(c, 2.5), sourceTimeAt(c, 5)]).toEqual([0, 5, 10])
    expect(withConstantSpeed(src({}), 0.5).duration).toBe(20)
    expect(withConstantSpeed(src({}), 50).duration).toBe(1) // clamped to 10×
    expect(withConstantSpeed(src({}), 1).speed).toBeUndefined()
  })

  it('a ramp integrates speed over clip time (1× → 3× linear over 4 s plays 8 s of source)', () => {
    const c = { ...src({ out: 8 }), speed: { ramp: [{ t: 0, v: 1 }, { t: 4, v: 3 }] } }
    expect(clipDurationFor(c)).toBeCloseTo(4, 4)
    const r = { ...c, duration: clipDurationFor(c) }
    // P(t) = t + t²/4
    expect(sourceTimeAt(r, 2)).toBeCloseTo(3, 4)
    expect(sourceTimeAt(r, 1)).toBeCloseTo(1.25, 4)
    expect(sourceTimeAt(r, 4)).toBeCloseTo(8, 4)
    expect(progressAt(r, 6)).toBeCloseTo(8 + 3 * 2, 4) // held at 3× past the last key
    const hero = withRampPreset(src({}), 'hero')
    expect(sourceTimeAt(hero, hero.duration)).toBeCloseTo(10, 3)
    // monotone: never plays backwards
    let last = -1
    for (let t = 0; t <= hero.duration; t += hero.duration / 50) { const s = sourceTimeAt(hero, t); expect(s).toBeGreaterThanOrEqual(last); last = s }
  })

  it('a freeze frame holds the picture and makes the clip longer by its length', () => {
    const c = withFreeze(src({}), 3, 2)
    expect(c.duration).toBe(12)
    expect([sourceTimeAt(c, 2), sourceTimeAt(c, 3), sourceTimeAt(c, 4), sourceTimeAt(c, 4.99), sourceTimeAt(c, 6), sourceTimeAt(c, 12)]).toEqual([2, 3, 3, 3, 4, 10])
    expect([audioRateAt(c, 4), audioRateAt(c, 6)]).toEqual([0, 1])
    expect(audioPlaybackAt(c, 4)).toEqual({ rate: 0, reverse: false, preservePitch: true })
    expect(withoutFreeze(c, 0).duration).toBe(10)
  })

  it('reverse plays the span from out back to in, at its speed', () => {
    const c = withConstantSpeed(withReverse(src({ in: 2, out: 8, duration: 6 }), true), 2)
    expect(c.duration).toBe(3)
    // out − P(t) − 1 ms (inside the span), clamped to `in` at the end
    expect([sourceTimeAt(c, 0), sourceTimeAt(c, 1), sourceTimeAt(c, 3)]).toEqual([8 - REVERSE_EPS, 6 - REVERSE_EPS, 2])
    // frame k of the reversed clip shows source frame N−1−k (30 fps, span [2, 8] = 180 frames at 2× = 90 timeline frames)
    const fps = 30
    const frame = (s: number) => Math.floor((s - 2) * fps + 1e-3)
    expect([frame(sourceTimeAt(c, 0)), frame(sourceTimeAt(c, 1 / fps)), frame(sourceTimeAt(c, 89 / fps))]).toEqual([179, 177, 1])
    const r1 = withReverse(src({ in: 0, out: 4, duration: 4 }), true)
    for (const k of [0, 1, 60, 119]) expect(Math.floor(sourceTimeAt(r1, k / fps) * fps + 1e-3)).toBe(119 - k)
    expect(audioRateAt(c, 1)).toBe(2)
    expect(audioPlaybackAt({ ...c, preservePitch: false }, 1)).toEqual({ rate: 2, reverse: true, preservePitch: false })
  })

  it('trims and splits of a 2× clip keep the source mapping', () => {
    const p = { ...createDefaultTimeline(), clips: [withConstantSpeed(src({}), 2)] }
    const s = splitClip(p, 's', 2)
    const [a, b] = s.clips.sort((x, y) => x.start - y.start)
    expect([a.in, a.out, a.duration, b.in, b.out, b.duration]).toEqual([0, 4, 2, 4, 10, 3])
    const t = get(trimClipRight(p, 's', 99), 's')
    expect([t.out, t.duration]).toEqual([30, 15]) // the file is 30 s: 20 s more source = 10 s more at 2×
    const r = { ...createDefaultTimeline(), clips: [withReverse(src({ in: 4, out: 10, duration: 6 }), true)] }
    const rl = get(trimClipLeft(r, 's', 1), 's')
    expect([rl.in, rl.out, sourceTimeAt(rl, 0)]).toEqual([4, 9, 9 - REVERSE_EPS])
  })

  it('retiming a clip retimes its linked sound and moves later clips', () => {
    const p = retimeClip(cut(), 'b', (c) => withConstantSpeed(c, 2))
    expect([get(p, 'b').duration, get(p, 'bs').duration, get(p, 'bs').speed]).toEqual([2.5, 2.5, 2])
    expect([get(p, 'c').start, get(p, 't').start]).toEqual([7.5, 9.5])
    expect(inSync(p)).toBe(true)
  })
})

describe('paste attributes', () => {
  it('copies the chosen groups only, and speed changes the target length', () => {
    const p0 = cut()
    const srcClip = { ...get(p0, 'a'), scale: 1.4, offX: 0.1, opacity: 0.5, speed: 2, keyframes: { x: [{ t: 0, v: 0 }, { t: 1, v: 1 }] } }
    const p = pasteAttributes(p0, srcClip, ['c'], ['transform', 'speed'])
    expect([get(p, 'c').scale, get(p, 'c').offX, get(p, 'c').opacity, get(p, 'c').keyframes]).toEqual([1.4, 0.1, undefined, undefined])
    expect([get(p, 'c').duration, get(p, 'cs').duration]).toEqual([2.5, 2.5])
    const q = pasteAttributes(p0, srcClip, ['t'], ['keyframes', 'speed'])
    expect(get(q, 't').keyframes).toEqual(srcClip.keyframes)
    expect(get(q, 't').speed).toBeUndefined() // a title has no speed
  })
})

describe('store: one undo step per gesture, compound open in place, shuttle', () => {
  const st = () => useVideoStore.getState()
  beforeEach(() => { st().loadProject(cut(), { assets: [] }) })

  it('a whole ripple-trim drag is one undo step; undo restores sync', () => {
    st().beginGesture()
    for (let i = 0; i < 5; i++) st().rippleTrimDelta('b', 'right', -0.2)
    st().endGesture()
    expect(st().history.length).toBe(1)
    expect(get(st().project, 'c').start).toBeCloseTo(9, 9)
    st().undo()
    expect(get(st().project, 'c').start).toBe(10)
    expect(inSync(st().project)).toBe(true)
  })

  it('a magnetic main track closes the gap a drag leaves, in the same step', () => {
    st().toggleMagnetic()
    const steps = st().history.length
    st().beginGesture()
    st().moveClip('c', 13)
    st().endGesture()
    expect(get(st().project, 'c').start).toBe(10)
    expect(st().history.length).toBe(steps + 1) // the drag and the gap closing are one step
    st().undo()
    expect(get(st().project, 'c').start).toBe(10)
    expect(st().history.length).toBe(steps)
  })

  it('opening a compound edits its inside; undo closes back to a path that still exists', () => {
    st().selectClips(['b', 'c'])
    expect(st().compoundSelected()).toBe(true)
    const id = st().selectedClipId!
    st().seek(7)
    expect(st().openCompound(id)).toBe(true)
    expect(st().currentTime).toBe(2)
    expect(viewOf(st()).clips.length).toBe(4)
    st().trimClipRightDelta('c', -1)
    expect(get(st().project, id).compound!.clips.find((c) => c.id === 'c')!.duration).toBe(4)
    st().closeCompound(0)
    expect(st().compoundPath).toEqual([])
    expect(st().currentTime).toBe(7)
    st().openCompound(id)
    st().undo()
    st().undo()
    expect(st().compoundPath).toEqual([])
  })

  it('J/K/L shuttle: L doubles to 4×, J goes backwards, K stops', () => {
    st().shuttle('l'); expect([st().playing, st().rate]).toEqual([true, 1])
    st().shuttle('l'); st().shuttle('l'); st().shuttle('l'); expect(st().rate).toBe(4)
    st().shuttle('j'); expect([st().playing, st().rate]).toEqual([false, -1])
    st().shuttle('j'); expect(st().rate).toBe(-2)
    st().shuttle('k'); expect([st().playing, st().rate]).toEqual([false, 0])
  })

  it('copy and paste (insert) puts the clip with its sound at the playhead and moves the rest', () => {
    st().selectClip('a')
    expect(st().copySelected()).toBe(2)
    st().seek(5)
    expect(st().pasteClips('insert')).toBe(true)
    const p = st().project
    expect(p.clips.filter((c) => c.trackId === 'v1').length).toBe(4)
    expect(get(p, 'b').start).toBe(10)
    expect(inSync(p)).toBe(true)
  })
})
