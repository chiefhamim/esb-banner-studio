// Timeline model and pure algorithms for ESB Studio Video Desk.
// Supports multi-track editing: Video (V1), Graphics Overlays (V2), Captions (C1), and Audio (A1).

export type TrackKind = 'video' | 'overlay' | 'caption' | 'audio'
export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5'
export type OverlayTemplate = 'lower-third' | 'headline' | 'breaking' | 'card' | 'logo'

export interface MediaAsset {
  id: string
  name: string
  type: 'video' | 'audio' | 'image'
  url: string
  duration: number   // 0 for images
  width?: number
  height?: number
  size: number       // bytes
  thumbnailUrl?: string
}

export interface Track {
  id: string
  name: string
  kind: TrackKind
  muted: boolean
  locked: boolean
}

export interface Clip {
  id: string
  trackId: string
  title: string
  kind: TrackKind
  start: number      // Timeline in-seconds (e.g. 0.0)
  duration: number   // Active duration on timeline in seconds
  in: number         // Source trim start
  out: number        // Source trim end
  color: string      // UI block tint
  sourceUrl?: string
  mediaAssetId?: string
  thumbnailUrl?: string
  overlayType?: OverlayTemplate
  overlayText?: string
  overlaySub?: string
  captionText?: string
  volume?: number    // 0 to 1 (default 1)
  muted?: boolean
  opacity?: number   // 0 to 1 (default 1)
  scale?: number     // default 1
  posX?: number      // offset X
  posY?: number      // offset Y
}

export interface VideoProject {
  id: string
  name: string
  aspect: AspectRatio
  width: number
  height: number
  fps: number
  duration: number   // Total project length in seconds
  tracks: Track[]
  clips: Clip[]
  mediaAssets?: MediaAsset[]
}

export const ASPECT_CONFIGS: Record<AspectRatio, { name: string; width: number; height: number; ratio: string }> = {
  '16:9': { name: '16:9 Broadcast Landscape', width: 1920, height: 1080, ratio: '16:9' },
  '9:16': { name: '9:16 Shorts & Reels', width: 1080, height: 1920, ratio: '9:16' },
  '1:1': { name: '1:1 Square Feed', width: 1080, height: 1080, ratio: '1:1' },
  '4:5': { name: '4:5 Facebook Feed', width: 1080, height: 1350, ratio: '4:5' },
}

/** Formats fractional seconds into professional SMPTE timecode HH:MM:SS:FF */
export function formatTimecode(seconds: number, fps = 30): string {
  const s = Math.max(0, seconds)
  const hrs = Math.floor(s / 3600)
  const mins = Math.floor((s % 3600) / 60)
  const secs = Math.floor(s % 60)
  const frames = Math.round((s - Math.floor(s)) * fps) % fps
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(frames).padStart(2, '0')}`
}

/** Formats compact display time M:SS.f */
export function formatShortTime(seconds: number): string {
  const s = Math.max(0, seconds)
  const mins = Math.floor(s / 60)
  const secs = Math.floor(s % 60)
  const tenths = Math.floor((s - Math.floor(s)) * 10)
  return `${mins}:${String(secs).padStart(2, '0')}.${tenths}`
}

export function parseTimecode(code: string, fps = 30): number {
  const parts = code.split(':').map(Number)
  if (parts.length === 4) {
    const [h, m, s, f] = parts
    return h * 3600 + m * 60 + s + (f / fps)
  }
  if (parts.length === 3) {
    const [m, s, f] = parts
    return m * 60 + s + (f / fps)
  }
  return 0
}

export function createDefaultTimeline(aspect: AspectRatio = '16:9'): VideoProject {
  const cfg = ASPECT_CONFIGS[aspect]
  const tracks: Track[] = [
    { id: 'v2', name: 'V2 · Broadcast Overlays', kind: 'overlay', muted: false, locked: false },
    { id: 'v1', name: 'V1 · Video Footage', kind: 'video', muted: false, locked: false },
    { id: 'c1', name: 'C1 · Captions & Ticker', kind: 'caption', muted: false, locked: false },
    { id: 'a1', name: 'A1 · Audio & Voiceover', kind: 'audio', muted: false, locked: false },
  ]

  // Demo seed clips so editor immediately shows live broadcasting timeline
  const clips: Clip[] = [
    {
      id: 'clip-video-1',
      trackId: 'v1',
      title: 'Power Substation Footage',
      kind: 'video',
      start: 0,
      duration: 8.5,
      in: 0,
      out: 8.5,
      color: '#3b82f6',
    },
    {
      id: 'clip-video-2',
      trackId: 'v1',
      title: 'Gas Drilling Rig B-Roll',
      kind: 'video',
      start: 8.5,
      duration: 9.5,
      in: 0,
      out: 9.5,
      color: '#2563eb',
    },
    {
      id: 'clip-overlay-1',
      trackId: 'v2',
      title: 'Lower Third: Rezwanul Khan',
      kind: 'overlay',
      start: 1.5,
      duration: 5.0,
      in: 0,
      out: 5.0,
      color: '#10b981',
      overlayType: 'lower-third',
      overlayText: 'Engr. Rezwanul Khan',
      overlaySub: 'Chairman, Power Development Board',
    },
    {
      id: 'clip-overlay-2',
      trackId: 'v2',
      title: 'Breaking Banner: 30 MMCFD Gas',
      kind: 'overlay',
      start: 9.0,
      duration: 6.0,
      in: 0,
      out: 6.0,
      color: '#ef4444',
      overlayType: 'breaking',
      overlayText: 'গ্রিডে দৈনিক ৩০ মিলিয়ন ঘনফুট গ্যাস সংযোজন',
      overlaySub: 'Energy Sector Bangladesh · Live Update',
    },
    {
      id: 'clip-caption-1',
      trackId: 'c1',
      title: 'Bengali Ticker',
      kind: 'caption',
      start: 0.5,
      duration: 7.5,
      in: 0,
      out: 7.5,
      color: '#f59e0b',
      captionText: 'জাতীয় গ্রিডে নতুন কূপ থেকে যুক্ত হচ্ছে দৈনিক ৩০ মিলিয়ন ঘনফুট গ্যাস',
    },
    {
      id: 'clip-audio-1',
      trackId: 'a1',
      title: 'Voiceover Take 01',
      kind: 'audio',
      start: 0,
      duration: 16.0,
      in: 0,
      out: 16.0,
      color: '#8b5cf6',
    },
  ]

  return {
    id: 'proj-' + Date.now(),
    name: 'Untitled Broadcast Video',
    aspect,
    width: cfg.width,
    height: cfg.height,
    fps: 30,
    duration: 30.0,
    tracks,
    clips,
  }
}

export function addClip(timeline: VideoProject, clip: Clip): VideoProject {
  const existing = timeline.clips.filter((c) => c.id !== clip.id)
  const newDuration = Math.max(timeline.duration, clip.start + clip.duration + 5)
  return {
    ...timeline,
    duration: newDuration,
    clips: [...existing, clip],
  }
}

export function moveClip(timeline: VideoProject, clipId: string, newStart: number, newTrackId?: string): VideoProject {
  const clampedStart = Math.max(0, newStart)
  const updatedClips = timeline.clips.map((c) => {
    if (c.id !== clipId) return c
    const trackId = newTrackId || c.trackId
    return {
      ...c,
      start: clampedStart,
      trackId,
    }
  })
  const maxEnd = Math.max(timeline.duration, ...updatedClips.map((c) => c.start + c.duration))
  return {
    ...timeline,
    duration: maxEnd,
    clips: updatedClips,
  }
}

export function trimClip(timeline: VideoProject, clipId: string, newStart: number, newDuration: number): VideoProject {
  const clampedStart = Math.max(0, newStart)
  const clampedDuration = Math.max(0.2, newDuration)
  const updatedClips = timeline.clips.map((c) => {
    if (c.id !== clipId) return c
    return {
      ...c,
      start: clampedStart,
      duration: clampedDuration,
      out: c.in + clampedDuration,
    }
  })
  return {
    ...timeline,
    clips: updatedClips,
  }
}

export function splitClip(timeline: VideoProject, clipId: string, atTime: number): VideoProject {
  const target = timeline.clips.find((c) => c.id === clipId)
  if (!target) return timeline
  if (atTime <= target.start || atTime >= target.start + target.duration) return timeline

  const firstDuration = atTime - target.start
  const secondDuration = target.duration - firstDuration

  const firstClip: Clip = {
    ...target,
    duration: firstDuration,
    out: target.in + firstDuration,
  }

  const secondClip: Clip = {
    ...target,
    id: `${target.id}-split-${Date.now()}`,
    title: `${target.title} (Part 2)`,
    start: atTime,
    duration: secondDuration,
    in: target.in + firstDuration,
    out: target.out,
  }

  const otherClips = timeline.clips.filter((c) => c.id !== clipId)
  return {
    ...timeline,
    clips: [...otherClips, firstClip, secondClip],
  }
}

export function deleteClip(timeline: VideoProject, clipId: string): VideoProject {
  return {
    ...timeline,
    clips: timeline.clips.filter((c) => c.id !== clipId),
  }
}

export function getClipsAtTime(timeline: VideoProject, time: number): Clip[] {
  return timeline.clips.filter((c) => time >= c.start && time < c.start + c.duration)
}

/** Snaps playhead to nearest clip start/end or zero */
export function snapTime(time: number, timeline: VideoProject, threshold = 0.25): number {
  const points = [0, timeline.duration]
  for (const c of timeline.clips) {
    points.push(c.start)
    points.push(c.start + c.duration)
  }
  for (const pt of points) {
    if (Math.abs(time - pt) <= threshold) {
      return pt
    }
  }
  return time
}

export function trimClipLeft(timeline: VideoProject, clipId: string, deltaSeconds: number): VideoProject {
  const target = timeline.clips.find((c) => c.id === clipId)
  if (!target) return timeline
  const maxDelta = target.duration - 0.2
  const dt = Math.max(-target.start, Math.min(maxDelta, deltaSeconds))
  const newStart = Math.max(0, target.start + dt)
  const newDuration = Math.max(0.2, target.duration - dt)
  const newIn = Math.max(0, target.in + dt)

  const updatedClips = timeline.clips.map((c) => {
    if (c.id !== clipId) return c
    return {
      ...c,
      start: newStart,
      duration: newDuration,
      in: newIn,
    }
  })
  return { ...timeline, clips: updatedClips }
}

export function trimClipRight(timeline: VideoProject, clipId: string, deltaSeconds: number): VideoProject {
  const target = timeline.clips.find((c) => c.id === clipId)
  if (!target) return timeline
  const newDuration = Math.max(0.2, target.duration + deltaSeconds)
  const newOut = target.in + newDuration

  const updatedClips = timeline.clips.map((c) => {
    if (c.id !== clipId) return c
    return {
      ...c,
      duration: newDuration,
      out: newOut,
    }
  })
  const maxEnd = Math.max(timeline.duration, ...updatedClips.map((c) => c.start + c.duration))
  return { ...timeline, duration: maxEnd, clips: updatedClips }
}

export function serializeVideoProject(project: VideoProject): string {
  // Exclude non-serializable blob URLs from mediaAssets, persist filenames and metadata
  const cleanAssets = project.mediaAssets?.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    duration: a.duration,
    width: a.width,
    height: a.height,
    size: a.size,
    url: '', // transient
  }))
  return JSON.stringify({ ...project, mediaAssets: cleanAssets, version: 1 }, null, 2)
}

export function deserializeVideoProject(json: string): VideoProject | null {
  try {
    const parsed = JSON.parse(json)
    if (!parsed || !Array.isArray(parsed.tracks) || !Array.isArray(parsed.clips)) return null
    return {
      id: parsed.id || `proj-${Date.now()}`,
      name: parsed.name || 'Restored Video Project',
      aspect: parsed.aspect || '16:9',
      width: parsed.width || 1920,
      height: parsed.height || 1080,
      fps: parsed.fps || 30,
      duration: parsed.duration || 30,
      tracks: parsed.tracks,
      clips: parsed.clips,
      mediaAssets: parsed.mediaAssets || [],
    }
  } catch {
    return null
  }
}
