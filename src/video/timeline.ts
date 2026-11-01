// Timeline model (v2) and pure algorithms for ESB Studio Video Desk.
//
// Any number of tracks of five kinds: video (footage and stills), overlay (titles and pictures over the picture),
// text (titles and captions), caption and audio. Visual tracks are drawn in list order from the bottom up: the track
// at the top of the list covers the ones below it. A clip and its own sound share a link group (`linkId`): they move,
// trim, split and delete together until unlinked. Fields Phase 2 will use (speed, keyframes, effects, transitions) are
// typed here but optional, and nothing reads them yet. Every edit is a pure function of the project.

export type TrackKind = 'video' | 'overlay' | 'text' | 'caption' | 'audio'
export const TRACK_KINDS: readonly TrackKind[] = ['video', 'overlay', 'text', 'caption', 'audio']
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
  /** Made by the app (a rendered banner or photo for Story → video, a recorded voiceover), not imported by the editor. */
  generated?: boolean
  /** Taken out of the bin by the editor, but kept (hidden) while a clip on the timeline or in the undo history still
   * plays it, so the project file can still find the file and Relink still works. Undo brings it back to the bin. */
  removed?: boolean
}

export interface Track {
  id: string
  name: string
  kind: TrackKind
  muted: boolean
  locked: boolean
  /** A visual track switched off: not drawn in the preview or the export (its clips stay). */
  hidden?: boolean
}

/** Phase 2 (reserved, typed but not read yet): an animated value. */
export type Ease = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'bezier'
export interface Keyframe { t: number; v: number; ease?: Ease; bezier?: [number, number, number, number] }
/** Phase 2 (reserved): one effect in a clip's chain. */
export interface ClipEffect { id: string; type: string; enabled?: boolean; params?: Record<string, number | string | boolean> }
/** Phase 2 (reserved): a transition at a clip's head or tail. */
export interface ClipTransition { type: string; duration: number }

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
  /** Layer transform: rotation in degrees around the anchor (default 0). */
  rotation?: number
  /** Layer transform: the point it rotates around, as a fraction of the layer (default 0.5, the centre). */
  anchorX?: number
  anchorY?: number
  // ---- Phase 2, reserved: typed so projects can carry them; not read by this version
  /** Playback speed: a constant (1 = normal) or a ramp. */
  speed?: number | { ramp: Keyframe[] }
  /** Animated properties: property name → keyframes. */
  keyframes?: Record<string, Keyframe[]>
  effects?: ClipEffect[]
  transitionIn?: ClipTransition
  transitionOut?: ClipTransition
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
  // the top of the list is drawn last (on top): captions over titles over footage; sound below
  const tracks: Track[] = [
    { id: 'c1', name: 'C1 · Captions', kind: 'caption', muted: false, locked: false },
    { id: 'v2', name: 'V2 · Overlays', kind: 'overlay', muted: false, locked: false },
    { id: 'v1', name: 'V1 · Footage', kind: 'video', muted: false, locked: false },
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

/** The clips whose sound goes into the file: clips on audio tracks with a source, not muted, volume above zero, on a
 * track that is not muted. A footage clip's own sound is its linked clip on A1, so it follows the same rules. */
export function audibleClips(project: VideoProject): Clip[] {
  const mutedTracks = new Set(project.tracks.filter((t) => t.muted).map((t) => t.id))
  return project.clips.filter((c) => c.kind === 'audio' && !!c.sourceUrl && !c.muted && (c.volume ?? 1) > 0 && !mutedTracks.has(c.trackId))
}

/** The ids of every clip that moves with `clipId` (itself, plus its linked video/audio partner). */
export function linkedIds(project: VideoProject, clipId: string): Set<string> {
  const c = project.clips.find((x) => x.id === clipId)
  const ids = new Set<string>([clipId])
  if (c?.linkId) for (const x of project.clips) if (x.linkId === c.linkId) ids.add(x.id)
  return ids
}

/** The clip, or any clip linked to it, sits on a locked track. A lock protects every clip on it, so an edit that
 * would move, trim, split or delete a locked clip through its linked partner is refused as a whole (the pair is never
 * split up silently); Unlink first to edit one side alone. */
export function groupLocked(project: VideoProject, clipId: string): boolean {
  const locked = new Set(project.tracks.filter((t) => t.locked).map((t) => t.id))
  if (!locked.size) return false
  const ids = linkedIds(project, clipId)
  return project.clips.some((c) => ids.has(c.id) && locked.has(c.trackId))
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

/** Drawing order of the visual tracks (v2): the list from the bottom up, so the track at the top of the list covers
 * every track below it. Hidden tracks are not drawn. */
export function visualTrackOrder(project: Pick<VideoProject, 'tracks'>): string[] {
  const out: string[] = []
  for (let i = project.tracks.length - 1; i >= 0; i--) {
    const t = project.tracks[i]
    if (t.kind !== 'audio' && !t.hidden) out.push(t.id)
  }
  return out
}

/** The v1 drawing rule (footage, then overlays, then captions; within a kind the lower track first). Kept only for the
 * migration, which orders a v1 project's tracks so that the v2 rule draws exactly what v1 drew. */
export function v1VisualOrder(tracks: Track[]): string[] {
  const rank: Record<string, number> = { video: 0, overlay: 1, text: 1, caption: 2 }
  return tracks
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.kind !== 'audio')
    .sort((a, b) => (rank[a.t.kind] ?? 1) - (rank[b.t.kind] ?? 1) || b.i - a.i)
    .map(({ t }) => t.id)
}

export interface Layer {
  clip: Clip
  alpha: number
  /** Footage crossfade: this clip fades in over `from` (the clip before it on the same track) by `progress` 0..1.
   * The compositor mixes the two in one two-input pass; `alpha` already carries progress × opacity. */
  mix?: { from: Clip; progress: number }
}

/** Every visual clip under `time`, in drawing order, with its opacity. Where two clips overlap on a footage track the
 * later one fades in across the overlap (a crossfade); a later clip on the same track is drawn over an earlier one. */
export function layersAt(project: VideoProject, time: number): Layer[] {
  const out: Layer[] = []
  const kindOf = new Map(project.tracks.map((t) => [t.id, t.kind]))
  for (const trackId of visualTrackOrder(project)) {
    const here = project.clips.filter((c) => c.trackId === trackId && isActive(c, time)).sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1))
    here.forEach((c, k) => {
      let alpha = c.opacity ?? 1
      let mix: Layer['mix']
      if (kindOf.get(trackId) === 'video' && k > 0) {
        const prev = here[k - 1]
        const overlapEnd = Math.min(prev.start + prev.duration, c.start + c.duration)
        const span = overlapEnd - c.start
        if (span > 0) {
          const progress = Math.min(1, Math.max(0, (time - c.start) / span))
          alpha *= progress
          mix = { from: prev, progress }
        }
      }
      out.push(mix ? { clip: c, alpha, mix } : { clip: c, alpha })
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
  if (!target || groupLocked(timeline, clipId)) return timeline
  const group = linkedIds(timeline, clipId)
  // a linked pair moves together; the earliest of them may not go before 0
  const minStart = Math.min(...timeline.clips.filter((c) => group.has(c.id)).map((c) => c.start))
  const delta = Math.max(newStart - target.start, -minStart)
  const updatedClips = timeline.clips.map((c) => {
    if (!group.has(c.id)) return c
    return { ...c, start: c.start + delta, trackId: c.id === clipId && newTrackId && canPlaceOn(timeline, c, newTrackId) ? newTrackId : c.trackId }
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
  if (!target || groupLocked(timeline, clipId)) return timeline
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
  if (groupLocked(timeline, clipId)) return timeline
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
  if (!target || groupLocked(timeline, clipId)) return timeline
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
  if (!target || groupLocked(timeline, clipId)) return timeline
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
  // an item taken out of the bin is still saved while a clip uses it (so the clip can find its file again)
  const used = new Set(project.clips.map((c) => c.mediaAssetId).filter(Boolean))
  const assets = bin.filter((a) => !a.removed || used.has(a.id)).map((a) => ({
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
    removed: a.removed || undefined,
    url: isRuntimeUrl(a.url) ? '' : a.url,
  }))
  const clips = project.clips.map((c) => ({
    ...c,
    sourceUrl: isRuntimeUrl(c.sourceUrl) ? undefined : c.sourceUrl,
    thumbnailUrl: isRuntimeUrl(c.thumbnailUrl) ? undefined : c.thumbnailUrl,
  }))
  return JSON.stringify({ ...project, clips, mediaAssets: assets, version: PROJECT_VERSION, timelineVersion: TIMELINE_VERSION }, null, 2)
}

export function deserializeVideoProject(json: string): VideoProject | null {
  try {
    const parsed = JSON.parse(json)
    if (!parsed || !Array.isArray(parsed.tracks) || !Array.isArray(parsed.clips)) return null
    const tl = migrateTimeline(parsed)
    const clips: Clip[] = tl.clips.map((c) => ({ ...c, sourceUrl: isRuntimeUrl(c.sourceUrl) ? undefined : c.sourceUrl }))
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
      tracks: tl.tracks,
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
  const V = trackForKind(project, 'video') ?? 'v1'
  const A = trackForKind(project, 'audio') ?? 'a1'
  const O = trackForKind(project, 'overlay') ?? 'v2'
  if (asset.type === 'video') {
    const d = asset.duration > 0 ? asset.duration : 5
    // footage and its sound start together, at a place free on both tracks
    let start = freeStart(project, V, at, d)
    if (asset.hasAudio) {
      for (let k = 0; k < 8; k++) {
        const a = freeStart(project, A, start, d)
        const v = freeStart(project, V, a, d)
        if (a === start && v === start) break
        start = Math.max(a, v)
      }
    }
    const link = asset.hasAudio ? `link-${stamp}` : undefined
    const video: Clip = { ...base, id: `clip-vid-${stamp}`, trackId: V, title: asset.name, kind: 'video', start, duration: d, out: d, color: '#2563eb', srcDuration: asset.duration > 0 ? asset.duration : undefined, linkId: link }
    if (!asset.hasAudio) return [video]
    return [video, { ...base, id: `clip-aud-${stamp}`, trackId: A, title: `${asset.name} · sound`, kind: 'audio', start, duration: d, out: d, color: '#7c3aed', volume: 1, srcDuration: video.srcDuration, linkId: link, thumbnailUrl: undefined }]
  }
  if (asset.type === 'audio') {
    const d = asset.duration > 0 ? asset.duration : 5
    return [{ ...base, id: `clip-aud-${stamp}`, trackId: A, title: asset.name, kind: 'audio', start: freeStart(project, A, at, d), duration: d, out: d, color: '#8b5cf6', volume: 1, srcDuration: asset.duration > 0 ? asset.duration : undefined, thumbnailUrl: undefined }]
  }
  if (as === 'overlay') {
    return [{ ...base, id: `clip-img-${stamp}`, trackId: O, title: asset.name, kind: 'overlay', start: Math.max(0, at), duration: 5, out: 5, color: '#059669' }]
  }
  const d = 5
  return [{ ...base, id: `clip-still-${stamp}`, trackId: V, title: asset.name, kind: 'video', start: freeStart(project, V, at, d), duration: d, out: d, color: '#2563eb', still: true, kenBurns: 'in' }]
}

// ---------------------------------------------------------------- timeline v2: tracks and the v1 migration

/** The version of the `timeline` part of a project file (tracks and clips). v1 = Phase 0 (four fixed tracks, drawn
 * by kind); v2 = any number of tracks, drawn in list order. The file's own `version` belongs to the project schema. */
export const TIMELINE_VERSION = 2

export interface TimelineData { version: number; tracks: Track[]; clips: Clip[] }

/** Which clips a track takes. Text tracks take titles (text overlays) and captions; a picture overlay needs an overlay
 * track; footage and stills a video track; sound an audio track. */
export function trackAccepts(kind: TrackKind, clip: Pick<Clip, 'kind' | 'sourceUrl' | 'overlayType' | 'mediaAssetId'>): boolean {
  if (kind === 'text') return clip.kind === 'caption' || (clip.kind === 'overlay' && clip.overlayType !== 'logo' && !clip.sourceUrl && !clip.mediaAssetId)
  return kind === clip.kind
}

/** The clip may move to `trackId` (the track exists, is not locked and takes clips of its kind). */
export function canPlaceOn(project: Pick<VideoProject, 'tracks'>, clip: Clip, trackId: string): boolean {
  const t = project.tracks.find((x) => x.id === trackId)
  return !!t && !t.locked && trackAccepts(t.kind, clip)
}

/** The track new clips of a kind go to: V1 / A1 / V2 / C1 when they are there with that kind (what Phase 0 used),
 * else the lowest track of that kind (the first one added). Undefined when the project has none. */
export function trackForKind(project: Pick<VideoProject, 'tracks'>, kind: TrackKind): string | undefined {
  const pref = { video: 'v1', audio: 'a1', overlay: 'v2', caption: 'c1', text: 't1' }[kind]
  if (project.tracks.some((t) => t.id === pref && t.kind === kind)) return pref
  for (let i = project.tracks.length - 1; i >= 0; i--) if (project.tracks[i].kind === kind) return project.tracks[i].id
  return undefined
}

const PREFIX: Record<TrackKind, string> = { video: 'v', overlay: 'v', text: 't', caption: 'c', audio: 'a' }
export const TRACK_KIND_LABEL: Record<TrackKind, string> = { video: 'Footage', overlay: 'Overlays', text: 'Text', caption: 'Captions', audio: 'Audio' }

/** A free id for a new track of `kind`: V3, T1, C2, A2… (video and overlay tracks share the V numbers). */
export function nextTrackId(project: Pick<VideoProject, 'tracks'>, kind: TrackKind): string {
  const p = PREFIX[kind]
  let n = 0
  for (const t of project.tracks) {
    const m = new RegExp(`^${p}(\\d+)$`).exec(t.id)
    if (m) n = Math.max(n, Number(m[1]))
  }
  let id = `${p}${n + 1}`
  while (project.tracks.some((t) => t.id === id)) id = `${p}${++n + 1}`
  return id
}

/** Add a track of `kind`. A visual track goes above the top track of the same kind (or at the top), so it covers what
 * is there; a sound track goes below the others. `at` puts it at that list index instead. */
export function addTrack<P extends Pick<VideoProject, 'tracks'>>(project: P, kind: TrackKind, opts: { at?: number; id?: string } = {}): P {
  const id = opts.id && !project.tracks.some((t) => t.id === opts.id) ? opts.id : nextTrackId(project, kind)
  const track: Track = { id, name: `${id.toUpperCase()} · ${TRACK_KIND_LABEL[kind]}`, kind, muted: false, locked: false }
  let at = opts.at
  if (at == null) {
    if (kind === 'audio') at = project.tracks.length
    else {
      const same = project.tracks.findIndex((t) => t.kind === kind)
      at = same >= 0 ? same : 0
    }
  }
  const tracks = [...project.tracks]
  tracks.splice(Math.max(0, Math.min(tracks.length, at)), 0, track)
  return { ...project, tracks }
}

/** Remove a track and the clips on it. Refused (the project comes back unchanged) for a locked track or one whose clips
 * are linked to a clip on a locked track. A clip's linked partner on another track stays, unlinked. */
export function removeTrack(project: VideoProject, trackId: string): VideoProject {
  const t = project.tracks.find((x) => x.id === trackId)
  if (!t || t.locked) return project
  const doomed = project.clips.filter((c) => c.trackId === trackId)
  if (doomed.some((c) => groupLocked(project, c.id))) return project
  const ids = new Set(doomed.map((c) => c.id))
  const links = new Set(doomed.map((c) => c.linkId).filter(Boolean))
  const clips = project.clips.filter((c) => !ids.has(c.id)).map((c) => (c.linkId && links.has(c.linkId) ? { ...c, linkId: undefined } : c))
  return { ...project, tracks: project.tracks.filter((x) => x.id !== trackId), clips }
}

/** Move a track to list index `to` (0 = top). Its clips go with it. */
export function moveTrack(project: VideoProject, trackId: string, to: number): VideoProject {
  const from = project.tracks.findIndex((t) => t.id === trackId)
  if (from < 0) return project
  const dest = Math.max(0, Math.min(project.tracks.length - 1, to))
  if (dest === from) return project
  const tracks = [...project.tracks]
  const [t] = tracks.splice(from, 1)
  tracks.splice(dest, 0, t)
  return { ...project, tracks }
}

export function renameTrack(project: VideoProject, trackId: string, name: string): VideoProject {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, 60)
  if (!clean) return project
  return { ...project, tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, name: clean } : t)) }
}

export function setTrackHidden(project: VideoProject, trackId: string, hidden: boolean): VideoProject {
  return { ...project, tracks: project.tracks.map((t) => (t.id === trackId && t.kind !== 'audio' ? { ...t, hidden: hidden || undefined } : t)) }
}

/** Make sure every clip's track exists (a clip added for a track the editor removed, or a story build on a project
 * without captions): missing tracks are added with the clip's kind and the id the clip names. */
export function ensureTracksFor(project: VideoProject, clips: Clip[]): VideoProject {
  let p = project
  for (const c of clips) {
    if (p.tracks.some((t) => t.id === c.trackId)) continue
    p = addTrack(p, c.kind, { id: c.trackId })
  }
  return p
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)

/** The timeline part of any project file as v2 (pure). A v1 timeline (no `timelineVersion`) has its visual tracks put
 * in the order that makes the v2 drawing rule draw exactly what v1 drew (v1 drew footage, then overlays, then
 * captions, whatever their place in the list); nothing else about its clips changes. Both versions are cleaned the
 * same way: tracks without an id or a known kind are repaired, duplicate track ids renamed, a clip whose track is gone
 * gets a track of its kind (never dropped), and numbers that are not numbers get safe values. */
export function migrateTimeline(raw: { timelineVersion?: unknown; tracks?: unknown; clips?: unknown }): TimelineData {
  const version = raw.timelineVersion === TIMELINE_VERSION ? TIMELINE_VERSION : 1
  const seen = new Set<string>()
  let tracks: Track[] = (Array.isArray(raw.tracks) ? raw.tracks : [])
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .map((t, i) => {
      const kind = TRACK_KINDS.includes(t.kind as TrackKind) ? (t.kind as TrackKind) : 'video'
      let id = typeof t.id === 'string' && /^[\w-]{1,40}$/.test(t.id) ? t.id : `${PREFIX[kind]}x${i + 1}`
      while (seen.has(id)) id = `${id}-${i}`
      seen.add(id)
      const track: Track = { id, name: typeof t.name === 'string' && t.name.trim() ? t.name : `${id.toUpperCase()} · ${TRACK_KIND_LABEL[kind]}`, kind, muted: !!t.muted, locked: !!t.locked }
      if (t.hidden === true && kind !== 'audio') track.hidden = true
      return track
    })
  const clips: Clip[] = []
  for (const c of Array.isArray(raw.clips) ? raw.clips : []) {
    if (!c || typeof c !== 'object' || typeof (c as Clip).id !== 'string') continue
    const o = c as Clip
    let track = tracks.find((t) => t.id === o.trackId)
    let kind: TrackKind = TRACK_KINDS.includes(o.kind) ? o.kind : track ? track.kind : 'video'
    if (kind === 'text') kind = 'overlay'
    const clip: Clip = { ...o, kind, start: Math.max(0, num(o.start, 0)), duration: Math.max(0.05, num(o.duration, 1)), in: Math.max(0, num(o.in, 0)) }
    clip.out = num(o.out, clip.in + clip.duration)
    if (typeof clip.title !== 'string') clip.title = String(clip.title ?? '')
    if (typeof clip.color !== 'string') clip.color = '#2563eb'
    if (!track) {
      // the clip's track is gone: give it one of its kind rather than lose the clip
      const want = typeof o.trackId === 'string' && /^[\w-]{1,40}$/.test(o.trackId) && !seen.has(o.trackId) ? o.trackId : undefined
      const before = new Set(tracks.map((t) => t.id))
      tracks = addTrack({ tracks }, kind, { id: want }).tracks
      track = tracks.find((t) => !before.has(t.id))!
      seen.add(track.id)
    }
    clip.trackId = track.id
    clips.push(clip)
  }
  if (version === 1) {
    // v1 drew by kind; order the visual tracks so the list, read bottom-up, draws the same
    const order = v1VisualOrder(tracks) // drawn first → last
    const byId = new Map(tracks.map((t) => [t.id, t]))
    const visualTopDown = [...order].reverse().map((id) => byId.get(id)!)
    tracks = [...visualTopDown, ...tracks.filter((t) => t.kind === 'audio')]
  }
  return { version: TIMELINE_VERSION, tracks, clips }
}
