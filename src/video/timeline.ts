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
  /** The file on disk (desktop app). Saved in the project, so a reopened project finds its media again. */
  path?: string
  /** Modified time of the file when it was imported (with `size`, tells a replaced file from the original). */
  mtimeMs?: number
  /** The footage carries its own sound (read from the file's tracks when it was imported). */
  hasAudio?: boolean
  /** The file could not be found when the project was opened: clips using it show "Media offline" until relinked. */
  missing?: boolean
  /** Made by the app (a rendered banner or photo for Story → video), not imported by the editor. */
  generated?: boolean
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
  /** Footage/still: size on top of fill/fit (default 1). Image overlay: size multiplier. */
  scale?: number
  posX?: number      // image overlay: left edge as a fraction of the frame width
  posY?: number      // image overlay: top edge as a fraction of the frame height
  /** Footage/still: fill the frame (crop the overflow, default) or fit inside it (bars). */
  fit?: 'fill' | 'fit'
  /** Footage/still: shift as a fraction of the frame width / height (-1..1). */
  offX?: number
  offY?: number
  /** Footage/still: crop from each edge of the source, as a fraction of its width / height (0..0.45). */
  cropL?: number
  cropR?: number
  cropT?: number
  cropB?: number
  /** A video clip and its own sound share one link id: they move, trim, split and delete together until unlinked. */
  linkId?: string
  /** Length of the source file in seconds (footage and sound): a trim cannot run past it. */
  srcDuration?: number
  /** Overlay accent colour (a story's category colour); the ESB three stripes when unset. */
  accent?: string
  /** A V1 clip that is a still picture (a photo, a rendered banner), not footage; drawn with a slow push-in. */
  still?: boolean
  /** Direction of the still's slow move: push in (default) or pull out. */
  kenBurns?: 'in' | 'out'
  /** The picture already carries the ESB masthead (a rendered banner), so the station bug is not drawn over it. */
  branded?: boolean
}

export interface VideoProject {
  id: string
  name: string
  aspect: AspectRatio
  width: number
  height: number
  fps: number
  duration: number   // Length of the timeline view in seconds (an export runs to contentEnd)
  tracks: Track[]
  clips: Clip[]
  mediaAssets?: MediaAsset[]
  /** The ESB bug in the top-right corner (default on). */
  bug?: boolean
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

/** A new project is empty: no demo clips, no sample names or figures. The editor imports media or builds from a story. */
export function createDefaultTimeline(aspect: AspectRatio = '16:9'): VideoProject {
  const cfg = ASPECT_CONFIGS[aspect]
  const tracks: Track[] = [
    { id: 'v2', name: 'V2 · Overlays', kind: 'overlay', muted: false, locked: false },
    { id: 'v1', name: 'V1 · Footage', kind: 'video', muted: false, locked: false },
    { id: 'c1', name: 'C1 · Captions', kind: 'caption', muted: false, locked: false },
    { id: 'a1', name: 'A1 · Audio', kind: 'audio', muted: false, locked: false },
  ]
  return {
    id: 'proj-' + Date.now(),
    name: 'Untitled video',
    aspect,
    width: cfg.width,
    height: cfg.height,
    fps: 30,
    duration: EMPTY_VIEW_SECONDS,
    tracks,
    clips: [],
    bug: true,
  }
}

/** The ruler length of an empty project (a view length only; an export runs to the last clip's end). */
export const EMPTY_VIEW_SECONDS = 30

/** Where the last clip ends: the length of an export. 0 for an empty timeline. */
export function contentEnd(project: VideoProject): number {
  let end = 0
  for (const c of project.clips) end = Math.max(end, c.start + c.duration)
  return end
}

/** A clip is on screen (or audible) at `time`. One rule for the preview, the export and the frame planner. */
export const isActive = (c: Clip, time: number) => time >= c.start && time < c.start + c.duration

/** The ids of every clip that moves with `clipId` (itself, plus its linked video/audio partner). */
export function linkedIds(project: VideoProject, clipId: string): Set<string> {
  const c = project.clips.find((x) => x.id === clipId)
  const ids = new Set<string>([clipId])
  if (c?.linkId) for (const x of project.clips) if (x.linkId === c.linkId) ids.add(x.id)
  return ids
}

/** Detach a video clip from its own audio (both stay on the timeline, each edited on its own). */
export function unlinkClip(project: VideoProject, clipId: string): VideoProject {
  const c = project.clips.find((x) => x.id === clipId)
  if (!c?.linkId) return project
  const link = c.linkId
  return { ...project, clips: project.clips.map((x) => (x.linkId === link ? { ...x, linkId: undefined } : x)) }
}

/** The first start at or after `at` on `trackId` where a clip of `duration` does not overlap another. */
export function freeStart(project: VideoProject, trackId: string, at: number, duration: number): number {
  const onTrack = project.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start)
  let t = Math.max(0, at)
  for (const c of onTrack) {
    if (t + duration <= c.start + 1e-6) break
    if (t < c.start + c.duration - 1e-6) t = c.start + c.duration
  }
  return t
}

/** Drawing order of the visual tracks: footage first, then overlays, then captions; within a kind, the track shown
 * lower in the list is drawn first, so a higher track covers it. */
export function visualTrackOrder(project: VideoProject): string[] {
  const rank = { video: 0, overlay: 1, caption: 2, audio: 3 } as const
  return project.tracks
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.kind !== 'audio')
    .sort((a, b) => rank[a.t.kind] - rank[b.t.kind] || b.i - a.i)
    .map(({ t }) => t.id)
}

export interface Layer { clip: Clip; alpha: number }

/** Every visual clip under `time`, in drawing order, with its opacity. Where two clips overlap on a footage track the
 * later one fades in across the overlap (a crossfade); a later clip on the same track is drawn over an earlier one. */
export function layersAt(project: VideoProject, time: number): Layer[] {
  const out: Layer[] = []
  for (const trackId of visualTrackOrder(project)) {
    const track = project.tracks.find((t) => t.id === trackId)!
    const here = project.clips.filter((c) => c.trackId === trackId && isActive(c, time)).sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1))
    here.forEach((c, k) => {
      let alpha = c.opacity ?? 1
      if (track.kind === 'video' && k > 0) {
        const prev = here[k - 1]
        const overlapEnd = Math.min(prev.start + prev.duration, c.start + c.duration)
        const span = overlapEnd - c.start
        if (span > 0) alpha *= Math.min(1, Math.max(0, (time - c.start) / span))
      }
      out.push({ clip: c, alpha })
    })
  }
  return out
}

export interface DrawRect { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number }

/** Where a footage frame or still lands in a w×h frame: crop the source, then fill (cover) or fit (contain), scale,
 * and offset (offX/offY are fractions of the frame). `zoom` is the still's slow move on top of the editor's scale. */
export function footageRect(srcW: number, srcH: number, w: number, h: number, clip: Pick<Clip, 'fit' | 'scale' | 'offX' | 'offY' | 'cropL' | 'cropR' | 'cropT' | 'cropB'>, zoom = 1): DrawRect {
  const c = (v: number | undefined) => Math.min(0.45, Math.max(0, v ?? 0))
  const sx = c(clip.cropL) * srcW
  const sy = c(clip.cropT) * srcH
  const sw = Math.max(1, srcW * (1 - c(clip.cropL) - c(clip.cropR)))
  const sh = Math.max(1, srcH * (1 - c(clip.cropT) - c(clip.cropB)))
  const base = clip.fit === 'fit' ? Math.min(w / sw, h / sh) : Math.max(w / sw, h / sh)
  const s = base * Math.min(8, Math.max(0.05, clip.scale ?? 1)) * zoom
  const dw = sw * s
  const dh = sh * s
  return { sx, sy, sw, sh, dx: (w - dw) / 2 + (clip.offX ?? 0) * w, dy: (h - dh) / 2 + (clip.offY ?? 0) * h, dw, dh }
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
  const target = timeline.clips.find((c) => c.id === clipId)
  if (!target) return timeline
  const group = linkedIds(timeline, clipId)
  // a linked pair moves together; the earliest of them may not go before 0
  const minStart = Math.min(...timeline.clips.filter((c) => group.has(c.id)).map((c) => c.start))
  const delta = Math.max(newStart - target.start, -minStart)
  const updatedClips = timeline.clips.map((c) => {
    if (!group.has(c.id)) return c
    return { ...c, start: c.start + delta, trackId: c.id === clipId && newTrackId ? newTrackId : c.trackId }
  })
  const maxEnd = Math.max(timeline.duration, ...updatedClips.map((c) => c.start + c.duration))
  return { ...timeline, duration: maxEnd, clips: updatedClips }
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
  const group = linkedIds(timeline, clipId)
  const stamp = Date.now().toString(36)
  // the second halves of a linked pair stay linked to each other, and no longer to the first halves
  const newLink = target.linkId ? `${target.linkId}-${stamp}` : undefined
  const out: Clip[] = []
  for (const c of timeline.clips) {
    if (!group.has(c.id) || atTime <= c.start || atTime >= c.start + c.duration) { out.push(c); continue }
    const first = atTime - c.start
    out.push({ ...c, duration: first, out: c.in + first })
    out.push({ ...c, id: `${c.id}-split-${stamp}`, title: c.title.replace(/ \(Part \d+\)$/, '') + ' (Part 2)', start: atTime, duration: c.duration - first, in: c.in + first, out: c.out, linkId: newLink })
  }
  return { ...timeline, clips: out }
}

export function deleteClip(timeline: VideoProject, clipId: string): VideoProject {
  const group = linkedIds(timeline, clipId)
  return { ...timeline, clips: timeline.clips.filter((c) => !group.has(c.id)) }
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
  const group = linkedIds(timeline, clipId)
  const members = timeline.clips.filter((c) => group.has(c.id))
  // one delta for the whole linked pair, limited so none of them goes before 0 s, under 0.2 s, or before its source start
  const lo = Math.max(...members.map((c) => Math.max(-c.start, c.srcDuration != null ? -c.in : -Infinity)))
  const hi = Math.min(...members.map((c) => c.duration - 0.2))
  const dt = Math.max(lo, Math.min(hi, deltaSeconds))
  const updatedClips = timeline.clips.map((c) => {
    if (!group.has(c.id)) return c
    return { ...c, start: Math.max(0, c.start + dt), duration: Math.max(0.2, c.duration - dt), in: Math.max(0, c.in + dt) }
  })
  return { ...timeline, clips: updatedClips }
}

export function trimClipRight(timeline: VideoProject, clipId: string, deltaSeconds: number): VideoProject {
  const target = timeline.clips.find((c) => c.id === clipId)
  if (!target) return timeline
  const group = linkedIds(timeline, clipId)
  const members = timeline.clips.filter((c) => group.has(c.id))
  // footage and sound cannot run past the end of their file
  const hi = Math.min(...members.map((c) => (c.srcDuration != null ? c.srcDuration - c.in - c.duration : Infinity)))
  const lo = Math.max(...members.map((c) => 0.2 - c.duration))
  const dt = Math.max(lo, Math.min(hi, deltaSeconds))
  const updatedClips = timeline.clips.map((c) => {
    if (!group.has(c.id)) return c
    const d = Math.max(0.2, c.duration + dt)
    return { ...c, duration: d, out: c.in + d }
  })
  const maxEnd = Math.max(timeline.duration, ...updatedClips.map((c) => c.start + c.duration))
  return { ...timeline, duration: maxEnd, clips: updatedClips }
}

/** A URL that only means something in this run of the app (an object URL or the media protocol): never saved. */
const isRuntimeUrl = (u: string | undefined) => !!u && /^(blob:|esb-media:)/i.test(u)

export const PROJECT_VERSION = 2

/** The project as a file. Media are kept by their real file path (with size and modified time, to notice a changed or
 * moved file); object URLs and media-protocol URLs are dropped, since they mean nothing after a restart. */
export function serializeVideoProject(project: VideoProject, bin: MediaAsset[] = project.mediaAssets ?? []): string {
  const assets = bin.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    duration: a.duration,
    width: a.width,
    height: a.height,
    size: a.size,
    path: a.path,
    mtimeMs: a.mtimeMs,
    hasAudio: a.hasAudio,
    generated: a.generated,
    url: isRuntimeUrl(a.url) ? '' : a.url,
  }))
  const clips = project.clips.map((c) => ({
    ...c,
    sourceUrl: isRuntimeUrl(c.sourceUrl) ? undefined : c.sourceUrl,
    thumbnailUrl: isRuntimeUrl(c.thumbnailUrl) ? undefined : c.thumbnailUrl,
  }))
  return JSON.stringify({ ...project, clips, mediaAssets: assets, version: PROJECT_VERSION }, null, 2)
}

export function deserializeVideoProject(json: string): VideoProject | null {
  try {
    const parsed = JSON.parse(json)
    if (!parsed || !Array.isArray(parsed.tracks) || !Array.isArray(parsed.clips)) return null
    const clips: Clip[] = parsed.clips
      .filter((c: unknown) => !!c && typeof c === 'object')
      .map((c: Clip) => ({ ...c, sourceUrl: isRuntimeUrl(c.sourceUrl) ? undefined : c.sourceUrl }))
    const mediaAssets: MediaAsset[] = (Array.isArray(parsed.mediaAssets) ? parsed.mediaAssets : [])
      .filter((a: unknown) => !!a && typeof a === 'object')
      .map((a: MediaAsset) => ({ ...a, url: isRuntimeUrl(a.url) ? '' : a.url || '' }))
    return {
      id: parsed.id || `proj-${Date.now()}`,
      name: parsed.name || 'Restored video',
      aspect: parsed.aspect || '16:9',
      width: parsed.width || 1920,
      height: parsed.height || 1080,
      fps: parsed.fps || 30,
      duration: parsed.duration || EMPTY_VIEW_SECONDS,
      tracks: parsed.tracks,
      clips,
      mediaAssets,
      bug: parsed.bug !== false,
    }
  } catch {
    return null
  }
}

/** Point every clip at its media's URL for this run (none while the file is missing), by media id. Clips without a
 * media id (an older project) keep what they have. */
export function relinkClips(project: VideoProject, assets: MediaAsset[]): VideoProject {
  const byId = new Map(assets.map((a) => [a.id, a]))
  return {
    ...project,
    clips: project.clips.map((c) => {
      const a = c.mediaAssetId ? byId.get(c.mediaAssetId) : undefined
      if (!a) return c
      return { ...c, sourceUrl: a.missing || !a.url ? undefined : a.url, thumbnailUrl: a.thumbnailUrl ?? c.thumbnailUrl }
    }),
  }
}

/** Clips that play a file and have none this run (the file is missing or was never kept): an export would draw a
 * hole or drop sound, so it is refused until they are relinked. Titles, captions and the ESB logo need no file. */
export function clipsMissingMedia(project: VideoProject): Clip[] {
  return project.clips.filter((c) => (c.kind === 'video' || c.kind === 'audio' || !!c.mediaAssetId) && !c.sourceUrl)
}

/** The clips a bin item becomes on the timeline. Footage goes to V1, with its own sound as a linked clip on A1 when the
 * file has sound; a picture goes to V1 as a full-frame still with a slow move, or to V2 as a picture overlay when the
 * editor asks for that; sound goes to A1. Each lands at `at`, or after the clips already there if it would overlap. */
export function clipsForAsset(project: VideoProject, asset: MediaAsset, at: number, as: 'auto' | 'overlay' = 'auto', stamp = Date.now().toString(36)): Clip[] {
  const base = { mediaAssetId: asset.id, sourceUrl: asset.url || undefined, thumbnailUrl: asset.thumbnailUrl, in: 0 }
  if (asset.type === 'video') {
    const d = asset.duration > 0 ? asset.duration : 5
    // footage and its sound start together, at a place free on both tracks
    let start = freeStart(project, 'v1', at, d)
    if (asset.hasAudio) {
      for (let k = 0; k < 8; k++) {
        const a = freeStart(project, 'a1', start, d)
        const v = freeStart(project, 'v1', a, d)
        if (a === start && v === start) break
        start = Math.max(a, v)
      }
    }
    const link = asset.hasAudio ? `link-${stamp}` : undefined
    const video: Clip = { ...base, id: `clip-vid-${stamp}`, trackId: 'v1', title: asset.name, kind: 'video', start, duration: d, out: d, color: '#2563eb', srcDuration: asset.duration > 0 ? asset.duration : undefined, linkId: link }
    if (!asset.hasAudio) return [video]
    return [video, { ...base, id: `clip-aud-${stamp}`, trackId: 'a1', title: `${asset.name} · sound`, kind: 'audio', start, duration: d, out: d, color: '#7c3aed', volume: 1, srcDuration: video.srcDuration, linkId: link, thumbnailUrl: undefined }]
  }
  if (asset.type === 'audio') {
    const d = asset.duration > 0 ? asset.duration : 5
    return [{ ...base, id: `clip-aud-${stamp}`, trackId: 'a1', title: asset.name, kind: 'audio', start: freeStart(project, 'a1', at, d), duration: d, out: d, color: '#8b5cf6', volume: 1, srcDuration: asset.duration > 0 ? asset.duration : undefined, thumbnailUrl: undefined }]
  }
  if (as === 'overlay') {
    return [{ ...base, id: `clip-img-${stamp}`, trackId: 'v2', title: asset.name, kind: 'overlay', start: Math.max(0, at), duration: 5, out: 5, color: '#059669' }]
  }
  const d = 5
  return [{ ...base, id: `clip-still-${stamp}`, trackId: 'v1', title: asset.name, kind: 'video', start: freeStart(project, 'v1', at, d), duration: d, out: d, color: '#2563eb', still: true, kenBurns: 'in' }]
}
