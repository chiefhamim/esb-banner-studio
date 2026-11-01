// Timeline model v2 (Phase 1 — Part B): unlimited tracks, track edits, list-order drawing and the v1 migration.
import { describe, expect, it } from 'vitest'
import {
  addTrack,
  canPlaceOn,
  createDefaultTimeline,
  deserializeVideoProject,
  ensureTracksFor,
  layersAt,
  migrateTimeline,
  moveClip,
  moveTrack,
  nextTrackId,
  removeTrack,
  renameTrack,
  serializeVideoProject,
  setTrackHidden,
  TIMELINE_VERSION,
  trackAccepts,
  trackForKind,
  v1VisualOrder,
  visualTrackOrder,
} from '../../src/video/timeline'
import type { Clip, Track, VideoProject } from '../../src/video/timeline'

const clip = (o: Partial<Clip> & Pick<Clip, 'id' | 'trackId' | 'kind'>): Clip => ({ title: o.id, start: 0, duration: 5, in: 0, out: 5, color: '#000', ...o })
const V1_TRACKS: Track[] = [
  { id: 'v2', name: 'V2 · Overlays', kind: 'overlay', muted: false, locked: false },
  { id: 'v1', name: 'V1 · Footage', kind: 'video', muted: false, locked: false },
  { id: 'c1', name: 'C1 · Captions', kind: 'caption', muted: false, locked: false },
  { id: 'a1', name: 'A1 · Audio', kind: 'audio', muted: false, locked: false },
]

describe('timeline v2: tracks', () => {
  it('a new project lists captions, overlays, footage, then sound (top of the list is drawn on top)', () => {
    const p = createDefaultTimeline()
    expect(p.tracks.map((t) => t.id)).toEqual(['c1', 'v2', 'v1', 'a1'])
    expect(visualTrackOrder(p)).toEqual(['v1', 'v2', 'c1'])
  })

  it('adds any number of tracks of every kind with free ids', () => {
    let p = createDefaultTimeline()
    p = addTrack(p, 'video')
    p = addTrack(p, 'video')
    p = addTrack(p, 'text')
    p = addTrack(p, 'audio')
    p = addTrack(p, 'caption')
    const ids = p.tracks.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(expect.arrayContaining(['v3', 'v4', 't1', 'a2', 'c2']))
    // a new video track goes above the top video track (it covers it); a sound track goes last
    expect(ids.indexOf('v4')).toBeLessThan(ids.indexOf('v3'))
    expect(ids.indexOf('v3')).toBeLessThan(ids.indexOf('v1'))
    expect(ids[ids.length - 1]).toBe('a2')
    expect(nextTrackId(p, 'overlay')).toBe('v5')
    const many = Array.from({ length: 40 }).reduce<VideoProject>((q) => addTrack(q, 'video'), createDefaultTimeline())
    expect(many.tracks.filter((t) => t.kind === 'video')).toHaveLength(41)
  })

  it('draws visual tracks bottom-up in list order; moving a track changes what covers what', () => {
    let p: VideoProject = { ...addTrack(createDefaultTimeline(), 'video'), clips: [] }
    p = { ...p, clips: [clip({ id: 'low', trackId: 'v1', kind: 'video' }), clip({ id: 'high', trackId: 'v3', kind: 'video' }), clip({ id: 'title', trackId: 'v2', kind: 'overlay' })] }
    expect(layersAt(p, 1).map((l) => l.clip.id)).toEqual(['low', 'high', 'title'])
    const moved = moveTrack(p, 'v1', 0)
    expect(moved.tracks[0].id).toBe('v1')
    expect(layersAt(moved, 1).map((l) => l.clip.id)).toEqual(['high', 'title', 'low'])
    expect(moveTrack(p, 'nope', 0)).toBe(p)
    expect(moveTrack(p, 'v1', p.tracks.findIndex((t) => t.id === 'v1'))).toBe(p)
  })

  it('a hidden track is not drawn; sound tracks cannot be hidden', () => {
    const p: VideoProject = { ...createDefaultTimeline(), clips: [clip({ id: 'o', trackId: 'v2', kind: 'overlay' }), clip({ id: 'v', trackId: 'v1', kind: 'video' })] }
    const h = setTrackHidden(p, 'v2', true)
    expect(layersAt(h, 1).map((l) => l.clip.id)).toEqual(['v'])
    expect(setTrackHidden(h, 'v2', false).tracks.find((t) => t.id === 'v2')?.hidden).toBeUndefined()
    expect(setTrackHidden(p, 'a1', true).tracks.find((t) => t.id === 'a1')?.hidden).toBeUndefined()
  })

  it('removes a track with its clips, unlinking partners elsewhere; refuses a locked one', () => {
    const p: VideoProject = { ...createDefaultTimeline(), clips: [
      clip({ id: 'v', trackId: 'v1', kind: 'video', linkId: 'L' }),
      clip({ id: 'a', trackId: 'a1', kind: 'audio', linkId: 'L' }),
      clip({ id: 'o', trackId: 'v2', kind: 'overlay' }),
    ] }
    const r = removeTrack(p, 'v1')
    expect(r.tracks.some((t) => t.id === 'v1')).toBe(false)
    expect(r.clips.map((c) => c.id)).toEqual(['a', 'o'])
    expect(r.clips.find((c) => c.id === 'a')?.linkId).toBeUndefined()
    const locked = { ...p, tracks: p.tracks.map((t) => (t.id === 'v1' ? { ...t, locked: true } : t)) }
    expect(removeTrack(locked, 'v1')).toBe(locked)
    // a clip linked to a clip on a locked track is protected too
    const lockedA = { ...p, tracks: p.tracks.map((t) => (t.id === 'a1' ? { ...t, locked: true } : t)) }
    expect(removeTrack(lockedA, 'v1')).toBe(lockedA)
  })

  it('renames a track (trimmed, never empty)', () => {
    const p = createDefaultTimeline()
    expect(renameTrack(p, 'v1', '  Interview  ').tracks.find((t) => t.id === 'v1')?.name).toBe('Interview')
    expect(renameTrack(p, 'v1', '   ')).toBe(p)
  })

  it('clips go only to tracks that take their kind; text tracks take titles and captions', () => {
    const p = addTrack(createDefaultTimeline(), 'text')
    const title = clip({ id: 't', trackId: 'v2', kind: 'overlay', overlayType: 'lower-third' })
    const pic = clip({ id: 'p', trackId: 'v2', kind: 'overlay', sourceUrl: 'blob:x' })
    const cap = clip({ id: 'c', trackId: 'c1', kind: 'caption' })
    expect(trackAccepts('text', title)).toBe(true)
    expect(trackAccepts('text', cap)).toBe(true)
    expect(trackAccepts('text', pic)).toBe(false)
    expect(trackAccepts('audio', title)).toBe(false)
    const withClips: VideoProject = { ...p, clips: [title, clip({ id: 'v', trackId: 'v1', kind: 'video' })] }
    expect(canPlaceOn(withClips, title, 't1')).toBe(true)
    expect(moveClip(withClips, 't', 2, 't1').clips.find((c) => c.id === 't')?.trackId).toBe('t1')
    // a footage clip dragged onto a sound track keeps its track (the time still moves)
    const m = moveClip(withClips, 'v', 3, 'a1').clips.find((c) => c.id === 'v')!
    expect([m.trackId, m.start]).toEqual(['v1', 3])
  })

  it('finds the track new clips go to, and makes a missing one for clips that name it', () => {
    const p = createDefaultTimeline()
    expect(trackForKind(p, 'video')).toBe('v1')
    expect(trackForKind(p, 'text')).toBeUndefined()
    const noV1 = removeTrack(p, 'v1')
    expect(trackForKind(noV1, 'video')).toBeUndefined()
    const fixed = ensureTracksFor(noV1, [clip({ id: 'x', trackId: 'v1', kind: 'video' })])
    expect(fixed.tracks.find((t) => t.id === 'v1')?.kind).toBe('video')
    expect(trackForKind(addTrack(noV1, 'video'), 'video')).toBe('v3')
  })
})

describe('timeline v1 → v2 migration', () => {
  const v1Clips = [
    clip({ id: 'cap', trackId: 'c1', kind: 'caption', captionText: 'x' }),
    clip({ id: 'o1', trackId: 'v2', kind: 'overlay', start: 0 }),
    clip({ id: 'o2', trackId: 'v2', kind: 'overlay', start: 1 }),
    clip({ id: 'v', trackId: 'v1', kind: 'video' }),
    clip({ id: 's', trackId: 'a1', kind: 'audio' }),
  ]

  it('is pure, keeps every clip as it was, and draws exactly what v1 drew', () => {
    const raw = { tracks: V1_TRACKS, clips: v1Clips }
    const frozen = JSON.stringify(raw)
    const tl = migrateTimeline(raw)
    expect(JSON.stringify(raw)).toBe(frozen)
    expect(tl.version).toBe(TIMELINE_VERSION)
    expect(tl.clips).toEqual(v1Clips)
    expect(tl.tracks.map((t) => t.id)).toEqual(['c1', 'v2', 'v1', 'a1'])
    const before = v1VisualOrder(V1_TRACKS)
    const after = visualTrackOrder({ tracks: tl.tracks })
    expect(after).toEqual(before)
    const p: VideoProject = { ...createDefaultTimeline(), tracks: tl.tracks, clips: tl.clips }
    expect(layersAt(p, 2).map((l) => l.clip.id)).toEqual(['v', 'o1', 'o2', 'cap'])
  })

  it('a v1 project with extra tracks in any order keeps its drawing order', () => {
    const tracks: Track[] = [
      { id: 'a1', name: 'A1', kind: 'audio', muted: false, locked: false },
      { id: 'c1', name: 'C1', kind: 'caption', muted: false, locked: false },
      { id: 'v1', name: 'V1', kind: 'video', muted: false, locked: false },
      { id: 'v3', name: 'V3', kind: 'overlay', muted: false, locked: false },
      { id: 'v2', name: 'V2', kind: 'overlay', muted: false, locked: false },
      { id: 'v9', name: 'V9', kind: 'video', muted: false, locked: false },
    ]
    const tl = migrateTimeline({ tracks, clips: [] })
    expect(visualTrackOrder({ tracks: tl.tracks })).toEqual(v1VisualOrder(tracks))
  })

  it('a v2 timeline is only cleaned, never reordered', () => {
    const tracks: Track[] = [V1_TRACKS[1], V1_TRACKS[0], V1_TRACKS[2], V1_TRACKS[3]] // footage on top: a v2 choice
    const tl = migrateTimeline({ timelineVersion: 2, tracks, clips: [] })
    expect(tl.tracks.map((t) => t.id)).toEqual(['v1', 'v2', 'c1', 'a1'])
  })

  it('repairs what a hand-edited file breaks, without losing a clip', () => {
    const tl = migrateTimeline({
      timelineVersion: 2,
      tracks: [{ id: 'v1', kind: 'video' }, { id: 'v1', kind: 'overlay', name: 'dup' }, null, { kind: 'bogus' }],
      clips: [
        { id: 'a', trackId: 'v1', kind: 'video', start: -3, duration: 'x' },
        { id: 'b', trackId: 'gone', kind: 'audio', start: 2, duration: 1 },
        { trackId: 'v1', kind: 'video' },
      ],
    })
    const ids = tl.tracks.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(tl.clips.map((c) => c.id)).toEqual(['a', 'b'])
    const a = tl.clips[0]
    expect([a.start, a.duration, a.in]).toEqual([0, 1, 0])
    const b = tl.clips[1]
    expect(tl.tracks.find((t) => t.id === b.trackId)?.kind).toBe('audio')
  })

  it('a Phase 0 file opens through the deserializer as v2, and saves with the timeline version', () => {
    const file = JSON.stringify({ version: 2, id: 'p', name: 'Old', aspect: '16:9', width: 1920, height: 1080, fps: 30, duration: 12, tracks: V1_TRACKS, clips: v1Clips, mediaAssets: [] })
    const p = deserializeVideoProject(file)!
    expect(p.tracks.map((t) => t.id)).toEqual(['c1', 'v2', 'v1', 'a1'])
    expect(p.clips.map((c) => c.id)).toEqual(v1Clips.map((c) => c.id))
    const again = JSON.parse(serializeVideoProject(p))
    expect(again.timelineVersion).toBe(TIMELINE_VERSION)
    // reopening the saved v2 file changes nothing
    const back = deserializeVideoProject(JSON.stringify(again))!
    expect(back.tracks).toEqual(p.tracks)
    expect(back.clips).toEqual(p.clips)
  })

  it('carries Phase 2 fields through untouched (typed, reserved)', () => {
    const c = clip({ id: 'k', trackId: 'v1', kind: 'video', speed: 2, keyframes: { opacity: [{ t: 0, v: 0 }, { t: 1, v: 1, ease: 'ease-in-out' }] }, effects: [{ id: 'e', type: 'blur', params: { r: 4 } }], transitionIn: { type: 'crossfade', duration: 0.5 } })
    const tl = migrateTimeline({ timelineVersion: 2, tracks: V1_TRACKS, clips: [c] })
    expect(tl.clips[0]).toEqual(c)
  })
})

describe('crossfade layers name their pair (for the two-input mix)', () => {
  it('the incoming clip carries the outgoing one and the progress', () => {
    const p: VideoProject = { ...createDefaultTimeline(), clips: [
      clip({ id: 'a', trackId: 'v1', kind: 'video', start: 0, duration: 2 }),
      clip({ id: 'b', trackId: 'v1', kind: 'video', start: 1.5, duration: 2, opacity: 0.5 }),
    ] }
    const l = layersAt(p, 1.75)
    expect(l.map((x) => x.clip.id)).toEqual(['a', 'b'])
    expect(l[1].mix?.from.id).toBe('a')
    expect(l[1].mix?.progress).toBeCloseTo(0.5, 6)
    expect(l[1].alpha).toBeCloseTo(0.25, 6)
    expect(l[0].mix).toBeUndefined()
  })
})
