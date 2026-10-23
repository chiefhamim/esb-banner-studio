import { describe, expect, it } from 'vitest'
import {
  addClip,
  createDefaultTimeline,
  deleteClip,
  deserializeVideoProject,
  formatShortTime,
  formatTimecode,
  getClipsAtTime,
  moveClip,
  parseTimecode,
  serializeVideoProject,
  snapTime,
  splitClip,
  trimClip,
  trimClipLeft,
  trimClipRight,
} from '../../src/video/timeline'
import type { Clip } from '../../src/video/timeline'

describe('Video Timeline Engine', () => {
  it('creates default timeline with standard broadcast tracks and aspect ratio', () => {
    const tl = createDefaultTimeline('16:9')
    expect(tl.width).toBe(1920)
    expect(tl.height).toBe(1080)
    expect(tl.fps).toBe(30)
    expect(tl.tracks.map((t) => t.id)).toEqual(['v2', 'v1', 'c1', 'a1'])
    expect(tl.clips.length).toBeGreaterThanOrEqual(4)
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
    const tl = createDefaultTimeline('16:9')
    const initialDuration = tl.duration
    const newClip: Clip = {
      id: 'custom-clip-1',
      trackId: 'v1',
      title: 'Interview Clip',
      kind: 'video',
      start: initialDuration + 5,
      duration: 10,
      in: 0,
      out: 10,
      color: '#3b82f6',
    }

    const updated = addClip(tl, newClip)
    expect(updated.clips.find((c) => c.id === 'custom-clip-1')).toBeDefined()
    expect(updated.duration).toBeGreaterThan(initialDuration)
  })

  it('moves clip cleanly and clamps start to >= 0', () => {
    const tl = createDefaultTimeline('16:9')
    const clipId = tl.clips[0].id

    const moved = moveClip(tl, clipId, 12.0)
    const found = moved.clips.find((c) => c.id === clipId)
    expect(found?.start).toBe(12.0)

    const clamped = moveClip(tl, clipId, -10.0)
    const foundClamped = clamped.clips.find((c) => c.id === clipId)
    expect(foundClamped?.start).toBe(0)
  })

  it('trims clip start and duration', () => {
    const tl = createDefaultTimeline('16:9')
    const clipId = tl.clips[0].id

    const trimmed = trimClip(tl, clipId, 2.0, 4.0)
    const found = trimmed.clips.find((c) => c.id === clipId)
    expect(found?.start).toBe(2.0)
    expect(found?.duration).toBe(4.0)
  })

  it('splits clip at playhead into two continuous segments', () => {
    const tl = createDefaultTimeline('16:9')
    const target = tl.clips.find((c) => c.id === 'clip-video-1')!
    expect(target).toBeDefined()

    // target start is 0, duration is 8.5. Split at 3.0:
    const split = splitClip(tl, target.id, 3.0)
    expect(split.clips.length).toBe(tl.clips.length + 1)

    const part1 = split.clips.find((c) => c.id === target.id)
    const part2 = split.clips.find((c) => c.start === 3.0 && c.trackId === target.trackId)

    expect(part1?.duration).toBe(3.0)
    expect(part2?.duration).toBe(5.5)
    expect(part2?.in).toBe(3.0)
  })

  it('deletes clips properly', () => {
    const tl = createDefaultTimeline('16:9')
    const targetId = tl.clips[0].id
    const updated = deleteClip(tl, targetId)
    expect(updated.clips.find((c) => c.id === targetId)).toBeUndefined()
  })

  it('finds all active clips at a given point in time', () => {
    const tl = createDefaultTimeline('16:9')
    // At t=2.0s, we have video-1 (0-8.5), overlay-1 (1.5-6.5), caption-1 (0.5-8.0), and audio-1 (0-16.0)
    const activeClips = getClipsAtTime(tl, 2.0)
    const activeTracks = activeClips.map((c) => c.trackId)
    expect(activeTracks).toContain('v1')
    expect(activeTracks).toContain('v2')
    expect(activeTracks).toContain('c1')
    expect(activeTracks).toContain('a1')
  })

  it('snaps time to clip boundaries within threshold', () => {
    const tl = createDefaultTimeline('16:9')
    // clip-overlay-1 starts at 1.5
    expect(snapTime(1.55, tl, 0.2)).toBe(1.5)
    expect(snapTime(3.8, tl, 0.1)).toBe(3.8) // does not snap outside threshold
  })

  it('trims left edge and adjusts in-point and duration', () => {
    const tl = createDefaultTimeline('16:9')
    const target = tl.clips.find((c) => c.id === 'clip-video-1')!
    const trimmed = trimClipLeft(tl, target.id, 1.5)
    const after = trimmed.clips.find((c) => c.id === target.id)!
    expect(after.start).toBe(target.start + 1.5)
    expect(after.duration).toBe(target.duration - 1.5)
    expect(after.in).toBe(target.in + 1.5)
  })

  it('trims right edge and adjusts out-point and duration', () => {
    const tl = createDefaultTimeline('16:9')
    const target = tl.clips.find((c) => c.id === 'clip-video-1')!
    const trimmed = trimClipRight(tl, target.id, 2.0)
    const after = trimmed.clips.find((c) => c.id === target.id)!
    expect(after.duration).toBe(target.duration + 2.0)
    expect(after.out).toBe(target.out + 2.0)
  })

  it('serializes and deserializes video project preserving tracks and clips', () => {
    const tl = createDefaultTimeline('9:16')
    tl.name = 'Test Reels Story'
    const json = serializeVideoProject(tl)
    expect(typeof json).toBe('string')

    const restored = deserializeVideoProject(json)
    expect(restored).not.toBeNull()
    expect(restored?.name).toBe('Test Reels Story')
    expect(restored?.aspect).toBe('9:16')
    expect(restored?.width).toBe(1080)
    expect(restored?.height).toBe(1920)
    expect(restored?.tracks.length).toBe(tl.tracks.length)
    expect(restored?.clips.length).toBe(tl.clips.length)
  })
})
