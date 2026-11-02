import { describe, expect, it } from 'vitest'
import {
  addClip,
  clipsForAsset,
  clipsMissingMedia,
  contentEnd,
  createDefaultTimeline,
  deleteClip,
  deserializeVideoProject,
  footageRect,
  formatShortTime,
  formatTimecode,
  freeStart,
  getClipsAtTime,
  layersAt,
  linkedIds,
  moveClip,
  parseTimecode,
  relinkClips,
  serializeVideoProject,
  snapTime,
  splitClip,
  trimClip,
  trimClipLeft,
  trimClipRight,
  unlinkClip,
} from '../../src/video/timeline'
import type { Clip, MediaAsset, VideoProject } from '../../src/video/timeline'

// a synthetic timeline for the edit tests (neutral names; the app itself starts empty)
const clip = (o: Partial<Clip> & Pick<Clip, 'id' | 'trackId' | 'kind'>): Clip => ({ title: o.id, start: 0, duration: 5, in: 0, out: 5, color: '#000', ...o })
function testTimeline(): VideoProject {
  const tl = createDefaultTimeline('16:9')
  return {
    ...tl,
    duration: 30,
    clips: [
      clip({ id: 'va', trackId: 'v1', kind: 'video', start: 0, duration: 8.5, out: 8.5, sourceUrl: 'blob:a' }),
      clip({ id: 'vb', trackId: 'v1', kind: 'video', start: 8.5, duration: 9.5, out: 9.5, sourceUrl: 'blob:b' }),
      clip({ id: 'ov', trackId: 'v2', kind: 'overlay', start: 1.5, duration: 5, overlayType: 'lower-third', overlayText: '' }),
      clip({ id: 'cap', trackId: 'c1', kind: 'caption', start: 0.5, duration: 7.5, captionText: '' }),
      clip({ id: 'aud', trackId: 'a1', kind: 'audio', start: 0, duration: 16, out: 16, sourceUrl: 'blob:c' }),
    ],
  }
}

describe('Video timeline', () => {
  it('a new project is empty: standard tracks, no demo clips, the ESB bug on', () => {
    const tl = createDefaultTimeline('16:9')
    expect(tl.width).toBe(1920)
    expect(tl.height).toBe(1080)
    expect(tl.fps).toBe(30)
    expect(tl.tracks.map((t) => t.id)).toEqual(['c1', 'v2', 'v1', 'a1']) // v2: the top of the list is drawn on top
    expect(tl.clips).toEqual([])
    expect(tl.bug).toBe(true)
    expect(contentEnd(tl)).toBe(0)
  })

  it('formats and parses SMPTE timecode accurately', () => {
    expect(formatTimecode(0)).toBe('00:00:00:00')
    expect(formatTimecode(1.5, 30)).toBe('00:00:01:15')
    expect(formatTimecode(65.1, 30)).toBe('00:01:05:03')
    expect(formatTimecode(3661.0, 30)).toBe('01:01:01:00')
    expect(parseTimecode('00:01:05:15', 30)).toBeCloseTo(65.5, 2)
    expect(formatShortTime(85.4)).toBe('1:25.4')
  })

  it('adds clips and expands project duration when needed', () => {
    const tl = testTimeline()
    const updated = addClip(tl, clip({ id: 'x', trackId: 'v1', kind: 'video', start: tl.duration + 5, duration: 10 }))
    expect(updated.clips.find((c) => c.id === 'x')).toBeDefined()
    expect(updated.duration).toBeGreaterThan(tl.duration)
  })

  it('moves a clip and clamps its start to >= 0', () => {
    const tl = testTimeline()
    expect(moveClip(tl, 'va', 12).clips.find((c) => c.id === 'va')?.start).toBe(12)
    expect(moveClip(tl, 'va', -10).clips.find((c) => c.id === 'va')?.start).toBe(0)
  })

  it('trims clip start and duration', () => {
    const found = trimClip(testTimeline(), 'va', 2, 4).clips.find((c) => c.id === 'va')
    expect(found?.start).toBe(2)
    expect(found?.duration).toBe(4)
  })

  it('splits a clip at the playhead into two continuous parts', () => {
    const tl = testTimeline()
    const split = splitClip(tl, 'va', 3)
    expect(split.clips.length).toBe(tl.clips.length + 1)
    const part2 = split.clips.find((c) => c.start === 3 && c.trackId === 'v1')
    expect(split.clips.find((c) => c.id === 'va')?.duration).toBe(3)
    expect(part2?.duration).toBe(5.5)
    expect(part2?.in).toBe(3)
  })

  it('deletes clips', () => {
    expect(deleteClip(testTimeline(), 'va').clips.find((c) => c.id === 'va')).toBeUndefined()
  })

  it('finds all clips under a time', () => {
    const tracks = getClipsAtTime(testTimeline(), 2).map((c) => c.trackId)
    expect(tracks).toEqual(expect.arrayContaining(['v1', 'v2', 'c1', 'a1']))
  })

  it('snaps time to clip boundaries within the threshold', () => {
    const tl = testTimeline()
    expect(snapTime(1.55, tl, 0.2)).toBe(1.5)
    expect(snapTime(3.8, tl, 0.1)).toBe(3.8)
  })

  it('trims the left edge: in-point and duration follow', () => {
    const after = trimClipLeft(testTimeline(), 'va', 1.5).clips.find((c) => c.id === 'va')!
    expect(after.start).toBe(1.5)
    expect(after.duration).toBe(7)
    expect(after.in).toBe(1.5)
  })

  it('trims the right edge: out-point follows, but never past the end of the file', () => {
    const after = trimClipRight(testTimeline(), 'va', 2).clips.find((c) => c.id === 'va')!
    expect(after.duration).toBe(10.5)
    expect(after.out).toBe(10.5)
    const tl = { ...testTimeline(), clips: [clip({ id: 'f', trackId: 'v1', kind: 'video', duration: 4, out: 4, srcDuration: 6, sourceUrl: 'blob:f' })] }
    expect(trimClipRight(tl, 'f', 10).clips[0].duration).toBe(6)
  })
})

describe('linked footage and sound', () => {
  const linked = (): VideoProject => ({
    ...createDefaultTimeline(),
    clips: [
      clip({ id: 'v', trackId: 'v1', kind: 'video', start: 2, duration: 6, out: 6, linkId: 'L', srcDuration: 6, sourceUrl: 'blob:s' }),
      clip({ id: 'a', trackId: 'a1', kind: 'audio', start: 2, duration: 6, out: 6, linkId: 'L', srcDuration: 6, sourceUrl: 'blob:s' }),
      clip({ id: 'other', trackId: 'a1', kind: 'audio', start: 20, duration: 3, sourceUrl: 'blob:o' }),
    ],
  })
  const get = (p: VideoProject, id: string) => p.clips.find((c) => c.id === id)!

  it('a footage clip and its sound move together (and keep their own tracks)', () => {
    const p = moveClip(linked(), 'v', 5)
    expect([get(p, 'v').start, get(p, 'a').start]).toEqual([5, 5])
    expect(get(p, 'a').trackId).toBe('a1')
    expect(get(p, 'other').start).toBe(20)
    expect([...linkedIds(linked(), 'a')].sort()).toEqual(['a', 'v'])
  })

  it('trims, splits and deletes together, keeping sync', () => {
    let p = trimClipLeft(linked(), 'a', 1)
    expect([get(p, 'v').start, get(p, 'v').in, get(p, 'a').start, get(p, 'a').in]).toEqual([3, 1, 3, 1])
    p = trimClipRight(p, 'v', -2)
    expect([get(p, 'v').duration, get(p, 'a').duration]).toEqual([3, 3])
    const s = splitClip(linked(), 'v', 4)
    const second = s.clips.filter((c) => c.start === 4)
    expect(second.map((c) => c.trackId).sort()).toEqual(['a1', 'v1'])
    expect(second[0].linkId).toBe(second[1].linkId)
    expect(second[0].linkId).not.toBe('L')
    expect(second.every((c) => c.in === 2)).toBe(true)
    expect(deleteClip(linked(), 'v').clips.map((c) => c.id)).toEqual(['other'])
  })

  it('unlinking lets each move on its own', () => {
    const p = moveClip(unlinkClip(linked(), 'v'), 'v', 10)
    expect([get(p, 'v').start, get(p, 'a').start]).toEqual([10, 2])
    expect(get(p, 'a').linkId).toBeUndefined()
  })

  it('footage with sound becomes a V1 clip plus a linked A1 clip; a picture a V1 still or a V2 overlay', () => {
    const p = createDefaultTimeline()
    const video: MediaAsset = { id: 'm1', name: 'interview.mp4', type: 'video', url: 'blob:m1', duration: 12, size: 1, hasAudio: true }
    const [v, a] = clipsForAsset(p, video, 0, 'auto', 'k')
    expect(v).toMatchObject({ trackId: 'v1', kind: 'video', duration: 12, mediaAssetId: 'm1', srcDuration: 12 })
    expect(a).toMatchObject({ trackId: 'a1', kind: 'audio', sourceUrl: 'blob:m1', linkId: v.linkId, start: v.start })
    expect(clipsForAsset(p, { ...video, hasAudio: false }, 0)).toHaveLength(1)
    const pic: MediaAsset = { id: 'm2', name: 'photo.jpg', type: 'image', url: 'blob:m2', duration: 0, size: 1 }
    expect(clipsForAsset(p, pic, 0)[0]).toMatchObject({ trackId: 'v1', kind: 'video', still: true })
    expect(clipsForAsset(p, pic, 0, 'overlay')[0]).toMatchObject({ trackId: 'v2', kind: 'overlay' })
  })

  it('a new clip lands after the clips already at the playhead, never on top of them', () => {
    const p = linked()
    expect(freeStart(p, 'v1', 3, 2)).toBe(8)
    expect(freeStart(p, 'v1', 0, 2)).toBe(0)
    expect(freeStart(p, 'v1', 0, 3)).toBe(8)
  })
})

describe('layers and crossfade', () => {
  it('draws every clip under the playhead: footage, then overlays, then captions; two overlays both', () => {
    const p: VideoProject = { ...createDefaultTimeline(), clips: [
      clip({ id: 'cap', trackId: 'c1', kind: 'caption', captionText: 'x' }),
      clip({ id: 'o1', trackId: 'v2', kind: 'overlay', start: 0 }),
      clip({ id: 'o2', trackId: 'v2', kind: 'overlay', start: 1 }),
      clip({ id: 'v', trackId: 'v1', kind: 'video' }),
    ] }
    expect(layersAt(p, 2).map((l) => l.clip.id)).toEqual(['v', 'o1', 'o2', 'cap'])
  })

  it('two overlapping V1 clips crossfade across the overlap', () => {
    const p: VideoProject = { ...createDefaultTimeline(), clips: [
      clip({ id: 'a', trackId: 'v1', kind: 'video', start: 0, duration: 2 }),
      clip({ id: 'b', trackId: 'v1', kind: 'video', start: 1.5, duration: 2 }),
    ] }
    const at = (t: number) => Object.fromEntries(layersAt(p, t).map((l) => [l.clip.id, l.alpha]))
    expect(at(1)).toEqual({ a: 1 })
    expect(at(1.75).b).toBeCloseTo(0.5, 5)
    expect(at(1.75).a).toBe(1)
    expect(at(2.5)).toEqual({ b: 1 })
  })
})

describe('footage transform', () => {
  it('fill covers the frame from the centre; fit shows all of it', () => {
    expect(footageRect(1280, 720, 1920, 1080, {})).toMatchObject({ sx: 0, sy: 0, sw: 1280, sh: 720, dx: 0, dy: 0, dw: 1920, dh: 1080 })
    const fill = footageRect(1080, 1080, 1920, 1080, {})
    expect([fill.dw, fill.dh, fill.dy]).toEqual([1920, 1920, -420])
    const fit = footageRect(1080, 1080, 1920, 1080, { fit: 'fit' })
    expect([fit.dw, fit.dh, fit.dx, fit.dy]).toEqual([1080, 1080, 420, 0])
  })

  it('scale, offset and crop move the picture where the editor put it', () => {
    const r = footageRect(1920, 1080, 1920, 1080, { scale: 0.5, offX: 0.25, offY: -0.1 })
    expect([r.dw, r.dh, r.dx, r.dy]).toEqual([960, 540, 480 + 480, 270 - 108])
    const c = footageRect(1000, 1000, 1000, 1000, { cropL: 0.1, cropR: 0.1, cropT: 0.2, cropB: 0, fit: 'fit' })
    expect([c.sx, c.sy, c.sw, c.sh]).toEqual([100, 200, 800, 800])
    expect(footageRect(1000, 1000, 1000, 1000, { cropL: 0.9 }).sx).toBe(450) // crop is capped at 45 % per edge
  })
})

describe('saving and reopening', () => {
  it('keeps media by path, drops run-time URLs, and relinks clips by media id', () => {
    const asset: MediaAsset = { id: 'm1', name: 'clip.mp4', type: 'video', url: 'esb-media://m/abc', duration: 6, size: 10, path: 'C:\\Footage\\clip.mp4', mtimeMs: 5, hasAudio: true }
    const p: VideoProject = { ...createDefaultTimeline('9:16'), name: 'Reels test', clips: clipsForAsset(createDefaultTimeline(), asset, 0, 'auto', 'k') }
    const json = serializeVideoProject(p, [asset])
    expect(json).not.toContain('esb-media:')
    const back = deserializeVideoProject(json)!
    expect(back.name).toBe('Reels test')
    expect(back.aspect).toBe('9:16')
    expect(back.mediaAssets?.[0]).toMatchObject({ path: 'C:\\Footage\\clip.mp4', size: 10, mtimeMs: 5, hasAudio: true, url: '' })
    expect(back.clips.every((c) => !c.sourceUrl)).toBe(true)
    expect(clipsMissingMedia(back)).toHaveLength(2)
    const relinked = relinkClips(back, [{ ...asset, url: 'esb-media://m/new' }])
    expect(relinked.clips.map((c) => c.sourceUrl)).toEqual(['esb-media://m/new', 'esb-media://m/new'])
    expect(clipsMissingMedia(relinked)).toHaveLength(0)
    expect(clipsMissingMedia(relinkClips(back, [{ ...asset, missing: true }]))).toHaveLength(2)
  })

  it('opens a version 1 project (no paths) unchanged', () => {
    const v1 = JSON.stringify({ version: 1, id: 'p', name: 'Old', aspect: '16:9', width: 1920, height: 1080, fps: 30, duration: 12, tracks: createDefaultTimeline().tracks, clips: [clip({ id: 'o', trackId: 'v2', kind: 'overlay', overlayType: 'lower-third', overlayText: 'A' })], mediaAssets: [] })
    const p = deserializeVideoProject(v1)!
    // Phase 3: the old lower third opens as a classic title clip with the same words (drawn exactly as before)
    expect(p.clips[0].titleData).toMatchObject({ look: 'classic', classic: 'lower-third', fields: { name: 'A', role: '' } })
    expect(p.clips[0].overlayType).toBeUndefined()
    expect(p.bug).toBe(true)
  })
})
