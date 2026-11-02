// Timeline model (v2) and pure algorithms for ESB Studio Video Desk.
//
// Any number of tracks of five kinds: video (footage and stills), overlay (titles and pictures over the picture),
// text (titles and captions), caption and audio. Visual tracks are drawn in list order from the bottom up: the track
// at the top of the list covers the ones below it. A clip and its own sound share a link group (`linkId`): they move,
// trim, split and delete together until unlinked. Phase 2: clips may be grouped (`groupId`: they move and delete
// together), be compound clips (a nested timeline, `compound`), carry keyframes (keyframes.ts) and speed (speed.ts);
// the project has markers and an optional magnetic main track. Every edit is a pure function of the project.

import type { Keyframe as Key } from './keyframes'
import { cutKeyframes, sampleKeys, sanitizeKeyframes } from './keyframes'
import { clipDurationFor, cutFreezes, isRetimed, rampOf, sanitizeFreezes, sanitizeSpeed, sourceTimeUnclamped, speedAt } from './speed'

import type { BlendMode } from './effects'
import type { Transcript } from './ai/transcript'
import { sanitizeSavedTranscripts } from './ai/transcript'
import { BLEND_MODES, LUT_MAX_CHARS, lutText, lutsUsed, registerLut, sanitizeEffects } from './effects'
import type { TitleData } from './titleModel'
import { migrateOverlayClip, sanitizeTitleData, titleDuration } from './titleModel'
import { sanitizeDataCard, type DataCardRef } from './dataCardClip'
import type { Bus, ClipDenoise, ClipFade, DuckingSettings, LoudnessTarget, MasterSettings } from './audioModel'
import { rebaseDenoise, sanitizeClipAudio, sanitizeProjectAudio, sanitizeTrackAudio, soloActive } from './audioModel'

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
  /** Phase 4 Part B: a track from the music library: its path inside the owner's chosen music folder, and the editor's licence note. */
  musicRel?: string
  licence?: string
}

export interface Track {
  id: string
  name: string
  kind: TrackKind
  muted: boolean
  locked: boolean
  /** A visual track switched off: not drawn in the preview or the export (its clips stay). */
  hidden?: boolean
  /** Phase 4 (audio tracks): the bus the track's sound goes to; unset = automatic (a footage clip's own sound on 'voice',
   * everything else on 'music'; audioModel.ts busOf). */
  bus?: Bus
  /** Phase 4: the track fader, dB (default 0), and its pan −1..1. `muted` above is the mixer's mute. */
  volume?: number
  pan?: number
  /** Phase 4: solo — while any audio track is soloed the others are silent. */
  solo?: boolean
}

/** The shape of a keyframe segment (keyframes.ts). The hyphenated spellings are read as the same eases. */
export type Ease = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'bezier' | 'hold' | 'ease-in' | 'ease-out' | 'ease-in-out'
/** An animated value: `v` at clip-local timeline second `t`; `ease` shapes the segment to the next key (a named ease,
 * or 'bezier' with `bezier` = [x1, y1, x2, y2], or those four numbers directly). */
export interface Keyframe { t: number; v: number; ease?: Ease | [number, number, number, number]; bezier?: [number, number, number, number] }
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
  /** Phase 4 fix: the bus an audio clip is heard on when its track is on automatic. Set when the clip is made (the sound
   * of footage is 'voice'); old projects get it once on load. A track's own bus still wins. */
  bus?: Bus
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
  /** Phase 2 (effects, Part B): how the layer combines with what is below it (effects.ts BLEND_MODES; normal when unset). */
  blendMode?: BlendMode
  /** Phase 2 (effects, Part B): an overlay clip that draws nothing itself; its effects apply to everything below it. */
  adjustment?: boolean
  // ---- Phase 2
  /** Playback speed (speed.ts): a constant 0.1–10 (1 = normal, the default) or a ramp of speed over clip-local time. */
  speed?: number | { ramp: Keyframe[] }
  /** Freeze frames (speed.ts): the picture holds for `dur` seconds from clip-local second `at`. */
  freezes?: { at: number; dur: number }[]
  /** Play the source span backwards (speed.ts). */
  reverse?: boolean
  /** Keep the sound's pitch when the speed is not 1 (default true). */
  preservePitch?: boolean
  /** Animated properties (keyframes.ts): property name → keys in clip-local timeline seconds. */
  keyframes?: Record<string, Keyframe[]>
  /** Clips that share a group id move and delete together (unlike a link, each trims on its own). */
  groupId?: string
  /** A compound clip: a nested timeline played as one clip ([in, out] of the nested time). Drawn and heard through
   * `flattenCompounds`; opened in place on the timeline to edit. */
  compound?: CompoundTimeline
  effects?: ClipEffect[]
  /** Phase 3: a title clip (an overlay with no file): the kit template, the editor's words and its look/motion
   * (titleModel.ts). Phase 0–2 text overlays are migrated to this with `look: 'classic'` when a file is opened. */
  titleData?: TitleData
  transitionIn?: ClipTransition
  transitionOut?: ClipTransition
  /** Phase 3 (Part B): a Grid data card — the published figure or series it shows, with its day, source and fetch
   * time (dataCardClip.ts). Drawn from these stored values only; an export never fetches. */
  dataCard?: DataCardRef
  /** Title and data-card clips: the whole title's length in seconds when a split cut it (titleModel.ts titleDuration).
   * Both halves keep it, so the out animation plays once, at the title's true end, never at the cut. */
  titleLen?: number
  /** Phase 4 (audio clips): clip gain in dB (default 0; multiplies `volume`), fades, pan −1..1, noise reduction. */
  gain?: number
  fadeIn?: ClipFade
  fadeOut?: ClipFade
  pan?: number
  denoise?: ClipDenoise
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
  /** Timeline markers (Phase 2). */
  markers?: Marker[]
  /** Magnetic main track: the main footage track closes its gaps after every edit (Phase 2). */
  magnetic?: boolean
  /** Ripple edits (ripple delete/trim, insert, extract, speed changes) move the markers after the edit too. On unless
   * false. */
  rippleMarkers?: boolean
  /** Transcripts of the source files used here (AI drafts until reviewed), keyed by media id, in source seconds. Saved with the project so a paid transcription is never lost. */
  transcripts?: Record<string, Transcript>
  /** Phase 4: master fader (dB) and limiter; ducking of the music bus under the voice bus; the loudness an export is
   * normalised to (null/unset = not normalised); bus faders (dB). All unset = the sound of a Phase 0–3 project. */
  master?: MasterSettings
  ducking?: DuckingSettings
  loudnessTarget?: LoudnessTarget
  busVolume?: Partial<Record<Bus, number>>
}

/** A marker on the timeline: a named, coloured point the editor can jump to (chapters later come from these). */
export interface Marker { id: string; t: number; name: string; color: string }

/** The inside of a compound clip: its own tracks and clips, in its own time from 0. */
export interface CompoundTimeline { tracks: Track[]; clips: Clip[]; markers?: Marker[] }

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
  const solo = soloActive(project)
  const soloed = new Set(project.tracks.filter((t) => t.solo === true).map((t) => t.id))
  return project.clips.filter((c) => c.kind === 'audio' && !!c.sourceUrl && !c.muted && (c.volume ?? 1) > 0 && !mutedTracks.has(c.trackId) && (!solo || soloed.has(c.trackId)))
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
  if (!target) return timeline
  // a clip moves with its linked partner and with every clip grouped with it
  const group = moveSet(timeline, clipId)
  if (setLocked(timeline, group)) return timeline
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

let splitSeq = 0
export function splitClip(timeline: VideoProject, clipId: string, atTime: number): VideoProject {
  const target = timeline.clips.find((c) => c.id === clipId)
  if (!target || groupLocked(timeline, clipId)) return timeline
  if (atTime <= target.start || atTime >= target.start + target.duration) return timeline
  const group = linkedIds(timeline, clipId)
  // unique per call: two splits in the same millisecond used to mint the same id (Phase 5 cut loop found it)
  const stamp = `${Date.now().toString(36)}${(++splitSeq).toString(36)}`
  // the second halves of a linked pair stay linked to each other, and no longer to the first halves
  const newLink = target.linkId ? `${target.linkId}-${stamp}` : undefined
  const out: Clip[] = []
  for (const c of timeline.clips) {
    if (!group.has(c.id) || atTime <= c.start || atTime >= c.start + c.duration) { out.push(c); continue }
    const first = atTime - c.start
    // a title or data card keeps its whole length: the first half is not "the end" of the title
    const whole = c.titleData || c.dataCard ? { titleLen: titleDuration(c) } : {}
    out.push({ ...subClip(c, 0, first), ...whole })
    out.push({ ...subClip(c, first, c.duration), ...whole, id: `${c.id}-split-${stamp}`, title: c.title.replace(/ \(Part \d+\)$/, '') + ' (Part 2)', start: atTime, linkId: newLink })
  }
  return { ...timeline, clips: out }
}

export function deleteClip(timeline: VideoProject, clipId: string): VideoProject {
  const group = moveSet(timeline, clipId)
  if (setLocked(timeline, group)) return timeline
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
  // one delta for the whole linked pair, limited so none of them goes before 0 s, under 0.2 s, or before its source
  // start (at its speed: a 2× clip has half as much timeline room as source room)
  const lo = Math.max(...members.map((c) => Math.max(-c.start, -headroom(c, 'left'))))
  const hi = Math.min(...members.map((c) => c.duration - 0.2))
  const dt = Math.max(lo, Math.min(hi, deltaSeconds))
  if (!dt) return timeline
  const updatedClips = timeline.clips.map((c) => {
    if (!group.has(c.id)) return c
    return { ...subClip(c, dt, c.duration, true), start: Math.max(0, c.start + dt) }
  })
  return { ...timeline, clips: updatedClips }
}

export function trimClipRight(timeline: VideoProject, clipId: string, deltaSeconds: number): VideoProject {
  const target = timeline.clips.find((c) => c.id === clipId)
  if (!target || groupLocked(timeline, clipId)) return timeline
  const group = linkedIds(timeline, clipId)
  const members = timeline.clips.filter((c) => group.has(c.id))
  // footage and sound cannot run past the end of their file
  const hi = Math.min(...members.map((c) => headroom(c, 'right')))
  const lo = Math.max(...members.map((c) => 0.2 - c.duration))
  const dt = Math.max(lo, Math.min(hi, deltaSeconds))
  if (!dt) return timeline
  const updatedClips = timeline.clips.map((c) => {
    if (!group.has(c.id)) return c
    return subClip(c, 0, Math.max(0.2, c.duration + dt), true)
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
  const used = new Set(allClips(project).map((c) => c.mediaAssetId).filter(Boolean))
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
    musicRel: a.musicRel,
    licence: a.licence,
    url: isRuntimeUrl(a.url) ? '' : a.url,
  }))
  const strip = (c: Clip): Clip => ({
    ...c,
    sourceUrl: isRuntimeUrl(c.sourceUrl) ? undefined : c.sourceUrl,
    thumbnailUrl: isRuntimeUrl(c.thumbnailUrl) ? undefined : c.thumbnailUrl,
    ...(c.compound ? { compound: { ...c.compound, clips: c.compound.clips.map(strip) } } : {}),
  })
  const clips = project.clips.map(strip)
  // each distinct LUT text once, keyed by its content id (clips carry only the id)
  const luts: Record<string, string> = {}
  for (const id of lutsUsed(allClips(project))) { const t = lutText(id); if (t) luts[id] = t }
  return projectJson({ ...project, clips, mediaAssets: assets, ...(Object.keys(luts).length ? { luts } : {}), version: PROJECT_VERSION, timelineVersion: TIMELINE_VERSION })
}

/** Project JSON: indented while it is small enough to read by eye, compact above that (a deep or LUT-heavy project
 * indented was several times its compact size). */
export const PRETTY_JSON_MAX = 1024 * 1024
export function projectJson(value: unknown): string {
  const compact = JSON.stringify(value)
  return compact.length <= PRETTY_JSON_MAX ? JSON.stringify(value, null, 2) : compact
}

/** A URL a clip may play when a project is opened: only this run's own media URLs (the media protocol or an object
 * URL) — and those are never saved, so in practice clips get their URLs from their media again (relinkClips). An
 * https:// or file: URL from a crafted file would make the decoder or the sound reader fetch it on open. */
const isLoadableUrl = (u: unknown): u is string => typeof u === 'string' && /^(blob:|esb-media:)/i.test(u)
/** A thumbnail may also be an inline picture (drawn by an <img>, which a data: URL cannot make fetch anything). */
const isThumbUrl = (u: unknown): u is string => isLoadableUrl(u) || (typeof u === 'string' && /^data:image\/(png|jpeg|webp);base64,/i.test(u) && u.length < 2_000_000)

export function deserializeVideoProject(json: string): VideoProject | null {
  try {
    const parsed = JSON.parse(json)
    if (!parsed || !Array.isArray(parsed.tracks) || !Array.isArray(parsed.clips)) return null
    // the file's LUT texts: each registered once (parsed once), the file's keys mapped to their content ids
    const lutRefs = new Map<string, string>()
    if (parsed.luts && typeof parsed.luts === 'object' && !Array.isArray(parsed.luts)) {
      for (const [k, v] of Object.entries(parsed.luts as Record<string, unknown>).slice(0, 16)) {
        if (typeof v === 'string' && v.length <= LUT_MAX_CHARS) { const id = registerLut(v); if (id) lutRefs.set(k, id) }
      }
    }
    const tl = migrateTimeline(parsed, { lutRef: (r) => lutRefs.get(r) ?? (lutText(r) ? r : undefined) })
    // URLs are this run's, from the media (relinkClips); a URL written in the file is never opened
    const clean = (c: Clip): Clip => ({ ...c, sourceUrl: isLoadableUrl(c.sourceUrl) && !isRuntimeUrl(c.sourceUrl) ? c.sourceUrl : undefined, thumbnailUrl: isThumbUrl(c.thumbnailUrl) && !isRuntimeUrl(c.thumbnailUrl) ? c.thumbnailUrl : undefined, ...(c.compound ? { compound: { ...c.compound, clips: c.compound.clips.map(clean) } } : {}) })
    const clips: Clip[] = tl.clips.map(clean)
    const mediaAssets: MediaAsset[] = (Array.isArray(parsed.mediaAssets) ? parsed.mediaAssets : [])
      .filter((a: unknown) => !!a && typeof a === 'object')
      .map((a: MediaAsset) => ({ ...a, licence: typeof a.licence === 'string' ? a.licence.slice(0, 600) : undefined, musicRel: typeof a.musicRel === 'string' ? a.musicRel.slice(0, 400) : undefined, url: isLoadableUrl(a.url) && !isRuntimeUrl(a.url) ? a.url : '', thumbnailUrl: isThumbUrl(a.thumbnailUrl) && !isRuntimeUrl(a.thumbnailUrl) ? a.thumbnailUrl : undefined }))
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
      ...(parsed.magnetic === true ? { magnetic: true } : {}),
      ...(parsed.rippleMarkers === false ? { rippleMarkers: false } : {}),
      ...(cleanMarkers(parsed.markers) ? { markers: cleanMarkers(parsed.markers) } : {}),
      ...(sanitizeSavedTranscripts(parsed.transcripts) ? { transcripts: sanitizeSavedTranscripts(parsed.transcripts) } : {}),
      ...sanitizeProjectAudio(parsed),
    }
  } catch {
    return null
  }
}

/** Point every clip at its media's URL for this run (none while the file is missing), by media id. Clips without a
 * media id (an older project) keep what they have. */
export function relinkClips(project: VideoProject, assets: MediaAsset[]): VideoProject {
  const byId = new Map(assets.map((a) => [a.id, a]))
  const fix = (c: Clip): Clip => {
    if (c.compound) return { ...c, compound: { ...c.compound, clips: c.compound.clips.map(fix) } }
    const a = c.mediaAssetId ? byId.get(c.mediaAssetId) : undefined
    if (!a) return c
    return { ...c, sourceUrl: a.missing || !a.url ? undefined : a.url, thumbnailUrl: a.thumbnailUrl ?? c.thumbnailUrl }
  }
  return { ...project, clips: project.clips.map(fix) }
}

/** Clips that play a file and have none this run (the file is missing or was never kept): an export would draw a
 * hole or drop sound, so it is refused until they are relinked. Titles, captions and the ESB logo need no file. */
export function clipsMissingMedia(project: VideoProject): Clip[] {
  return allClips(project).filter((c) => !c.compound && (c.kind === 'video' || c.kind === 'audio' || !!c.mediaAssetId) && !c.sourceUrl)
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
    return [video, { ...base, id: `clip-aud-${stamp}`, trackId: A, title: `${asset.name} · sound`, kind: 'audio', start, duration: d, out: d, color: '#7c3aed', volume: 1, srcDuration: video.srcDuration, linkId: link, bus: 'voice', thumbnailUrl: undefined }]
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
/** No time in a project goes past this (seconds; 27 hours). */
const MAX_TIME = 1e5
/** Compound clips nest at most this deep (a file may carry more: the deeper insides are emptied on open). */
export const MAX_COMPOUND_DEPTH = 16
export interface MigrateContext {
  /** Nesting level (0 = the project's own timeline). */
  depth?: number
  /** Maps a LUT reference in the file to a registered LUT id (deserializeVideoProject). */
  lutRef?: (ref: string) => string | undefined
}

/** The timeline part of any project file as v2 (pure). A v1 timeline (no `timelineVersion`) has its visual tracks put
 * in the order that makes the v2 drawing rule draw exactly what v1 drew (v1 drew footage, then overlays, then
 * captions, whatever their place in the list); nothing else about its clips changes. Both versions are cleaned the
 * same way: tracks without an id or a known kind are repaired, duplicate track ids renamed, a clip whose track is gone
 * gets a track of its kind (never dropped), and numbers that are not numbers get safe values. */
export function migrateTimeline(raw: { timelineVersion?: unknown; tracks?: unknown; clips?: unknown }, ctx: MigrateContext = {}): TimelineData {
  const depth = ctx.depth ?? 0
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
      if (kind === 'audio') Object.assign(track, sanitizeTrackAudio(t))
      return track
    })
  const clips: Clip[] = []
  for (const c of Array.isArray(raw.clips) ? raw.clips : []) {
    if (!c || typeof c !== 'object' || typeof (c as Clip).id !== 'string') continue
    const o = c as Clip
    let track = tracks.find((t) => t.id === o.trackId)
    let kind: TrackKind = TRACK_KINDS.includes(o.kind) ? o.kind : track ? track.kind : 'video'
    if (kind === 'text') kind = 'overlay'
    const clip: Clip = { ...o, kind, start: Math.min(MAX_TIME, Math.max(0, num(o.start, 0))), duration: Math.min(MAX_TIME, Math.max(0.05, num(o.duration, 1))), in: Math.min(MAX_TIME, Math.max(0, num(o.in, 0))) }
    clip.out = Math.min(MAX_TIME, Math.max(clip.in, num(o.out, clip.in + clip.duration)))
    if (o.srcDuration !== undefined) { if (typeof o.srcDuration === 'number' && Number.isFinite(o.srcDuration) && o.srcDuration >= 0) clip.srcDuration = Math.min(MAX_TIME, o.srcDuration); else delete clip.srcDuration }
    for (const f of ['linkId', 'groupId'] as const) if (o[f] !== undefined && !(typeof o[f] === 'string' && o[f]!.length <= 120)) delete clip[f]
    if (typeof clip.title !== 'string') clip.title = String(clip.title ?? '')
    if (typeof clip.color !== 'string') clip.color = '#2563eb'
    if (o.compound !== undefined) {
      // a compound's inside is cleaned by the same rules (it is always v2: compounds came with Phase 2); past
      // MAX_COMPOUND_DEPTH levels it is emptied (thousands of levels once overflowed the stack on save)
      const deep = depth + 1 >= MAX_COMPOUND_DEPTH
      const inner = o.compound && typeof o.compound === 'object' && !Array.isArray(o.compound)
        ? deep ? { tracks: [], clips: [] } : migrateTimeline({ timelineVersion: TIMELINE_VERSION, tracks: o.compound.tracks, clips: o.compound.clips }, { ...ctx, depth: depth + 1 })
        : null
      if (inner) clip.compound = { tracks: inner.tracks, clips: inner.clips, ...(!deep && cleanMarkers(o.compound.markers) ? { markers: cleanMarkers(o.compound.markers) } : {}) }
      else delete clip.compound
    }
    // effects (Part B): known types and safe values only; a blend mode or adjustment flag only when valid
    const renames: { from: string; to: string }[] = []
    if (o.effects !== undefined) { const fx = sanitizeEffects(o.effects, ctx.lutRef, renames); if (fx) clip.effects = fx; else delete clip.effects }
    // keyframes, speed, freezes: plain finite values, known property names, capped and sorted (a crafted value once
    // threw inside React render and blanked the app, or made every frame look-up take hundreds of ms)
    if (o.keyframes !== undefined) { const kf = sanitizeKeyframes(o.keyframes, clip.effects ?? [], renames); if (kf) clip.keyframes = kf; else delete clip.keyframes }
    if (o.speed !== undefined) { const sp = sanitizeSpeed(o.speed); if (sp !== undefined) clip.speed = sp; else delete clip.speed }
    if (o.freezes !== undefined) { const fz = sanitizeFreezes(o.freezes); if (fz) clip.freezes = fz; else delete clip.freezes }
    delete clip.gain; delete clip.fadeIn; delete clip.fadeOut; delete clip.pan; delete clip.denoise; delete clip.bus
    if (kind === 'audio') Object.assign(clip, sanitizeClipAudio(o as unknown as Record<string, unknown>))
    if (o.reverse !== undefined && o.reverse !== true) delete clip.reverse
    if (o.preservePitch !== undefined && o.preservePitch !== false) delete clip.preservePitch
    if (o.blendMode !== undefined && (!BLEND_MODES.includes(o.blendMode as BlendMode) || o.blendMode === 'normal')) delete clip.blendMode
    if (o.adjustment !== undefined && !(o.adjustment === true && kind === 'overlay')) delete clip.adjustment
    // titles (Phase 3): known templates and safe values only; a Phase 0–2 text overlay becomes a classic title clip
    if (o.titleData !== undefined) { const td = kind === 'overlay' && !o.sourceUrl ? sanitizeTitleData(o.titleData) : null; if (td) clip.titleData = td; else delete clip.titleData }
    if (kind === 'overlay' && !clip.titleData) { const m = migrateOverlayClip({ ...clip, overlayText: typeof clip.overlayText === 'string' ? clip.overlayText : '', overlaySub: typeof clip.overlaySub === 'string' ? clip.overlaySub : '' }); if (m.titleData) clip.titleData = m.titleData }
    if (clip.titleData) { delete clip.overlayType; delete clip.overlayText; delete clip.overlaySub }
    if (o.dataCard !== undefined) { const dc = kind === 'overlay' ? sanitizeDataCard(o.dataCard) : undefined; if (dc) clip.dataCard = dc; else delete clip.dataCard }
    if (o.titleLen !== undefined) { const tl = o.titleLen; if (typeof tl === 'number' && Number.isFinite(tl) && tl > 0 && tl <= MAX_TIME && (clip.titleData || clip.dataCard)) clip.titleLen = tl; else delete clip.titleLen }
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
  // once, for projects made before clips carried their origin: footage sound (still linked to its picture) is voice
  const picLinks = new Set(clips.filter((c) => c.kind === 'video' && c.linkId).map((c) => c.linkId))
  for (const c of clips) if (c.kind === 'audio' && !c.bus && c.linkId && picLinks.has(c.linkId)) c.bus = 'voice'
  if (version === 1) {
    // v1 drew by kind; order the visual tracks so the list, read bottom-up, draws the same
    const order = v1VisualOrder(tracks) // drawn first → last
    const byId = new Map(tracks.map((t) => [t.id, t]))
    const visualTopDown = [...order].reverse().map((id) => byId.get(id)!)
    tracks = [...visualTopDown, ...tracks.filter((t) => t.kind === 'audio')]
  }
  return { version: TIMELINE_VERSION, tracks, clips }
}

// ---------------------------------------------------------------- Phase 2: pro editing (pure; one undo step each in the store)

const EPS = 1e-6
/** Two clip edges closer than this (seconds) touch: an edit point. */
export const EDIT_POINT_EPS = 1e-3
const end = (c: Clip) => c.start + c.duration

/** Every clip of the project, the insides of compound clips included (any depth). */
export function allClips(project: Pick<VideoProject, 'clips'>): Clip[] {
  const out: Clip[] = []
  const walk = (cs: Clip[]) => { for (const c of cs) { out.push(c); if (c.compound) walk(c.compound.clips) } }
  walk(project.clips)
  return out
}

/** The clips that move and delete with `clipId`: itself, its linked partners, and every clip grouped with any of
 * them (followed to a fixed point, so a group of linked pairs moves whole). */
export function moveSet(project: Pick<VideoProject, 'clips'>, clipId: string): Set<string> {
  const ids = new Set<string>([clipId])
  const links = new Set<string>()
  const groups = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const c of project.clips) {
      if (!ids.has(c.id) && !(c.linkId && links.has(c.linkId)) && !(c.groupId && groups.has(c.groupId))) continue
      if (!ids.has(c.id)) { ids.add(c.id); changed = true }
      if (c.linkId && !links.has(c.linkId)) { links.add(c.linkId); changed = true }
      if (c.groupId && !groups.has(c.groupId)) { groups.add(c.groupId); changed = true }
    }
  }
  return ids
}

/** Any of the clips sits on a locked track. */
export function setLocked(project: Pick<VideoProject, 'clips' | 'tracks'>, ids: Set<string>): boolean {
  const locked = new Set(project.tracks.filter((t) => t.locked).map((t) => t.id))
  return !!locked.size && project.clips.some((c) => ids.has(c.id) && locked.has(c.trackId))
}

/** The part [a, b] of a clip's local time as a clip of its own (b − a long; the caller sets `start`). Source in/out
 * follow the clip's speed, freezes and direction (speed.ts); keyframes, a speed ramp and freezes are cut and re-based
 * so the kept part looks and plays exactly as it did. a < 0 or b > duration extend the clip at its edge speed. */
export function subClip(c: Clip, a: number, b: number, trim = false): Clip {
  const r = subClipCore(c, a, b)
  if (c.kind !== 'audio') return r
  // Phase 4 fix: a fade belongs to the clip's true edge. A cut inside the clip (split, extract, a window) has no fade
  // on its new edge: half A keeps the fade-in only, half B the fade-out only (both halves keeping both made a dip at
  // every split). A trim keeps its fades: the trimmed edge is the clip's new true end.
  const D = c.duration
  if (!trim) {
    if (a > EPS && r.fadeIn) { r.fadeIn = undefined; delete r.fadeIn }
    if (b < D - EPS && r.fadeOut) { r.fadeOut = undefined; delete r.fadeOut }
  }
  if (r.denoise?.noiseRange) {
    // the noise sample is clip-local seconds: it moves with the sound it was taken from
    const dn = rebaseDenoise(r.denoise, -a, r.duration)
    if (dn) r.denoise = dn; else delete r.denoise
  }
  return r
}

function subClipCore(c: Clip, a: number, b: number): Clip {
  const D = c.duration
  const d = Math.max(0.05, b - a)
  const keyframes = a === 0 && b >= D - EPS ? c.keyframes : cutKeyframes(c.keyframes, a, b)
  // a changed tail is a new end for a title: its carried whole length no longer holds (a split sets it again)
  if (c.titleLen !== undefined && Math.abs(b - D) > EPS) { c = { ...c }; delete c.titleLen }
  if (!isRetimed(c)) {
    // a clip at normal speed: exactly the Phase 0 arithmetic (in follows the head, out the tail)
    return { ...c, duration: d, in: Math.max(0, c.in + a), out: Math.abs(b - D) < EPS ? c.out : c.in + b, ...(c.keyframes ? { keyframes } : {}) }
  }
  const sa = sourceTimeUnclamped(c, a)
  const sb = sourceTimeUnclamped(c, b)
  const ramp = rampOf(c)
  const speed = ramp ? { ramp: cutKeyframes({ r: ramp }, a, b)!.r } : c.speed
  return { ...c, duration: d, in: Math.max(0, Math.min(sa, sb)), out: Math.max(sa, sb), speed, freezes: cutFreezes(c.freezes, a, b), ...(c.keyframes ? { keyframes } : {}) }
}

/** Timeline seconds a clip can grow at one edge before it runs out of source (Infinity for titles, which have no
 * file). At the clip's speed at that edge; a reversed clip runs out at the other end of its file. */
export function headroom(c: Clip, side: 'left' | 'right'): number {
  if (c.srcDuration == null) return Infinity
  const s = side === 'left' ? speedAt(c, 0) : speedAt(c, c.duration)
  const room = side === 'left' ? (c.reverse ? c.srcDuration - c.out : c.in) : (c.reverse ? c.in : c.srcDuration - c.out)
  return Math.max(0, room) / s
}

/** Shift every clip that starts at or after `from` by `amount`, on every track: the ripple behind ripple delete,
 * ripple trim, insert, extract and speed changes. Clips on locked tracks stay where they are; if one of them is
 * linked or grouped with a clip that would move, the ripple is refused (null), since it would pull a pair apart. A
 * negative amount is limited per track so nothing lands on a clip that stays (an existing crossfade overlap is not a
 * limit). Returns the clips and the amount actually used. */
export function rippleShift(project: VideoProject, from: number, amount: number, skip: Set<string> = new Set()): { clips: Clip[]; amount: number; markers: Marker[] | undefined } | null {
  if (Math.abs(amount) < EPS) return { clips: project.clips, amount: 0, markers: project.markers }
  const locked = new Set(project.tracks.filter((t) => t.locked).map((t) => t.id))
  const isMover = (c: Clip) => !skip.has(c.id) && c.start >= from - EPS && !locked.has(c.trackId)
  const movers = project.clips.filter(isMover)
  if (!movers.length) return { clips: project.clips, amount, markers: rippleMarkers(project, from, amount) }
  const moving = new Set(movers.map((c) => c.id))
  for (const m of movers) for (const id of moveSet(project, m.id)) if (!moving.has(id) && !skip.has(id)) {
    const other = project.clips.find((c) => c.id === id)
    // a partner that does not move with it (on a locked track, or starting before the ripple point) would come apart
    if (other && (locked.has(other.trackId) || other.start < from - EPS)) return null
  }
  let amt = amount
  if (amt < 0) {
    for (const m of movers) amt = Math.max(amt, -m.start)
    const byTrack = new Map<string, number>()
    for (const m of movers) byTrack.set(m.trackId, Math.min(byTrack.get(m.trackId) ?? Infinity, m.start))
    for (const [trackId, first] of byTrack) {
      let stayEnd = 0
      for (const c of project.clips) if (c.trackId === trackId && !moving.has(c.id) && !skip.has(c.id) && end(c) <= first + EPS) stayEnd = Math.max(stayEnd, end(c))
      amt = Math.max(amt, stayEnd - first)
    }
    if (amt > 0) amt = 0
  }
  return { clips: project.clips.map((c) => (moving.has(c.id) ? { ...c, start: Math.max(0, c.start + amt) } : c)), amount: amt, markers: rippleMarkers(project, from, amt) }
}

/** The markers after a ripple of `amount` at `from` (when the project ripples markers, the default): those at or after
 * `from` move with the content; a marker inside a span that closed lands where it closed (never dropped). */
export function rippleMarkers(project: Pick<VideoProject, 'markers' | 'rippleMarkers'>, from: number, amount: number): Marker[] | undefined {
  const ms = project.markers
  if (!ms?.length || project.rippleMarkers === false || Math.abs(amount) < EPS) return ms
  const floor = from + Math.min(0, amount)
  let changed = false
  const out = ms.map((m) => {
    let t = m.t
    if (m.t >= from - EPS) t = Math.max(0, m.t + amount)
    else if (amount < 0 && m.t > floor) t = Math.max(0, floor)
    if (t === m.t) return m
    changed = true
    return { ...m, t }
  })
  return changed ? sortMarkers(out) : ms
}

/** Ripple delete: the clip (with its linked partner and group) goes and everything after it on every track moves up
 * by its length, so linked footage and sound stay in sync. Refused (unchanged) on a locked track. */
export function rippleDelete(project: VideoProject, clipId: string): VideoProject {
  const ids = moveSet(project, clipId)
  if (!project.clips.some((c) => c.id === clipId) || setLocked(project, ids)) return project
  const gone = project.clips.filter((c) => ids.has(c.id))
  const a = Math.min(...gone.map((c) => c.start))
  const b = Math.max(...gone.map(end))
  const rest = { ...project, clips: project.clips.filter((c) => !ids.has(c.id)) }
  const r = rippleShift(rest, b, a - b)
  return r ? { ...rest, clips: r.clips, markers: r.markers } : project
}

/** Ripple trim: trim one edge and move everything after the clip by the change, so no gap opens or closes by hand.
 * The left edge keeps the clip's start (its first frame changes); the right edge keeps its first frame. Linked
 * partners trim together. */
export function rippleTrim(project: VideoProject, clipId: string, side: 'left' | 'right', delta: number): VideoProject {
  const target = project.clips.find((c) => c.id === clipId)
  if (!target || groupLocked(project, clipId)) return project
  const group = linkedIds(project, clipId)
  const members = project.clips.filter((c) => group.has(c.id))
  const oldEnd = end(target)
  let dt: number
  let clips: Clip[]
  if (side === 'right') {
    const hi = Math.min(...members.map((c) => headroom(c, 'right')))
    const lo = Math.max(...members.map((c) => 0.2 - c.duration))
    dt = Math.max(lo, Math.min(hi, delta))
    clips = project.clips.map((c) => (group.has(c.id) ? subClip(c, 0, c.duration + dt, true) : c))
  } else {
    const hi = Math.min(...members.map((c) => c.duration - 0.2))
    const lo = Math.max(...members.map((c) => -headroom(c, 'left')))
    dt = Math.max(lo, Math.min(hi, delta))
    clips = project.clips.map((c) => (group.has(c.id) ? { ...subClip(c, dt, c.duration, true), start: c.start } : c))
    dt = -dt
  }
  if (Math.abs(dt) < EPS) return project
  const r = rippleShift({ ...project, clips }, oldEnd, dt, group)
  return r ? { ...project, clips: r.clips, markers: r.markers } : project
}

/** The edit point on a track nearest `t` (within `tolerance` seconds): a clip whose end touches the next one's start. */
export function editPointAt(project: VideoProject, trackId: string, t: number, tolerance: number): { left: Clip; right: Clip } | null {
  const on = project.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start)
  let best: { left: Clip; right: Clip } | null = null
  let bestD = tolerance
  for (const a of on) for (const b of on) {
    if (a === b || Math.abs(end(a) - b.start) > EDIT_POINT_EPS) continue
    const d = Math.abs(t - b.start)
    if (d <= bestD) { bestD = d; best = { left: a, right: b } }
  }
  return best
}

/** Roll: move the edit point between two touching clips. The left clip ends `delta` later and the right one starts
 * `delta` later, so the total length (and everything else on the timeline) stays where it is. Linked partners of
 * each side trim with it. Limited by 0.2 s minimum lengths and by the media each side has. */
export function rollEdit(project: VideoProject, leftId: string, rightId: string, delta: number): VideoProject {
  const L = project.clips.find((c) => c.id === leftId)
  const R = project.clips.find((c) => c.id === rightId)
  if (!L || !R || Math.abs(end(L) - R.start) > EDIT_POINT_EPS) return project
  if (groupLocked(project, leftId) || groupLocked(project, rightId)) return project
  const lg = linkedIds(project, leftId)
  const rg = linkedIds(project, rightId)
  if ([...lg].some((id) => rg.has(id))) return project
  const lm = project.clips.filter((c) => lg.has(c.id))
  const rm = project.clips.filter((c) => rg.has(c.id))
  const hi = Math.min(...lm.map((c) => headroom(c, 'right')), ...rm.map((c) => c.duration - 0.2))
  const lo = Math.max(...lm.map((c) => 0.2 - c.duration), ...rm.map((c) => -headroom(c, 'left')))
  const dt = Math.max(lo, Math.min(hi, delta))
  if (Math.abs(dt) < EPS) return project
  return {
    ...project,
    clips: project.clips.map((c) => {
      if (lg.has(c.id)) return subClip(c, 0, c.duration + dt, true)
      if (rg.has(c.id)) return { ...subClip(c, dt, c.duration, true), start: c.start + dt }
      return c
    }),
  }
}

/** Slip: show a different part of the source in the same place. In and out move by `delta` source seconds; the clip's
 * start and length on the timeline do not change (nor its keyframes, which are timeline time). Linked partners slip
 * together. Limited to the file's length. Titles and stills have nothing to slip. */
export function slipClip(project: VideoProject, clipId: string, delta: number): VideoProject {
  const target = project.clips.find((c) => c.id === clipId)
  if (!target || groupLocked(project, clipId) || target.srcDuration == null) return project
  const group = linkedIds(project, clipId)
  const members = project.clips.filter((c) => group.has(c.id))
  const lo = Math.max(...members.map((c) => -c.in))
  const hi = Math.min(...members.map((c) => (c.srcDuration != null ? c.srcDuration - c.out : Infinity)))
  const dt = Math.max(lo, Math.min(hi, delta))
  if (Math.abs(dt) < EPS) return project
  return {
    ...project,
    clips: project.clips.map((c) => {
      if (!group.has(c.id)) return c
      const slipped: Clip = { ...c, in: c.in + dt, out: c.out + dt }
      if (c.kind === 'audio' && c.denoise?.noiseRange) {
        // the sound under the noise sample moved: the sample follows it (source seconds → timeline seconds at the clip's mean speed)
        const mean = c.duration > 0 && c.out > c.in ? (c.out - c.in) / c.duration : 1
        const dn = rebaseDenoise(c.denoise, -(c.reverse ? -dt : dt) / mean, c.duration)
        if (dn) slipped.denoise = dn; else delete slipped.denoise
      }
      return slipped
    }),
  }
}

/** The clips touching a clip's head and tail on its track (edit points), if any. */
export function neighbours(project: VideoProject, clipId: string): { prev?: Clip; next?: Clip } {
  const c = project.clips.find((x) => x.id === clipId)
  if (!c) return {}
  const on = project.clips.filter((x) => x.trackId === c.trackId && x.id !== c.id)
  return {
    prev: on.find((x) => Math.abs(end(x) - c.start) <= EDIT_POINT_EPS),
    next: on.find((x) => Math.abs(x.start - end(c)) <= EDIT_POINT_EPS),
  }
}

/** Slide: move a clip between its neighbours. The clip keeps its content and length; the clip before it ends later
 * (or earlier) and the one after it starts later (or earlier) by the same amount, so the neighbours' total length and
 * the timeline's length stay the same. Without a neighbour on a side, the clip may slide into the empty space there. */
export function slideClip(project: VideoProject, clipId: string, delta: number): VideoProject {
  const c = project.clips.find((x) => x.id === clipId)
  if (!c || groupLocked(project, clipId)) return project
  const { prev, next } = neighbours(project, clipId)
  const cg = linkedIds(project, clipId)
  const pg = prev ? linkedIds(project, prev.id) : new Set<string>()
  const ng = next ? linkedIds(project, next.id) : new Set<string>()
  if ((prev && groupLocked(project, prev.id)) || (next && groupLocked(project, next.id))) return project
  const on = project.clips.filter((x) => x.trackId === c.trackId && !cg.has(x.id))
  let lo: number
  let hi: number
  if (prev) {
    const pm = project.clips.filter((x) => pg.has(x.id))
    lo = Math.max(...pm.map((x) => 0.2 - x.duration))
    hi = Math.min(...pm.map((x) => headroom(x, 'right')))
  } else {
    lo = -(c.start - Math.max(0, ...on.filter((x) => end(x) <= c.start + EPS).map(end)))
    hi = Infinity
  }
  if (next) {
    const nm = project.clips.filter((x) => ng.has(x.id))
    hi = Math.min(hi, ...nm.map((x) => x.duration - 0.2))
    lo = Math.max(lo, ...nm.map((x) => -headroom(x, 'left')))
  } else {
    const after = on.filter((x) => x.start >= end(c) - EPS).map((x) => x.start)
    hi = Math.min(hi, after.length ? Math.min(...after) - end(c) : Infinity)
  }
  lo = Math.max(lo, -Math.min(...project.clips.filter((x) => cg.has(x.id)).map((x) => x.start)))
  const dt = Math.max(lo, Math.min(hi, delta))
  if (Math.abs(dt) < EPS) return project
  return {
    ...project,
    clips: project.clips.map((x) => {
      if (cg.has(x.id)) return { ...x, start: x.start + dt }
      if (pg.has(x.id)) return subClip(x, 0, x.duration + dt, true)
      if (ng.has(x.id)) return { ...subClip(x, dt, x.duration, true), start: x.start + dt }
      return x
    }),
  }
}

/** Clear [a, b) on the given tracks: clips inside go, clips across an edge are trimmed, a clip across the whole range
 * becomes two. The tracks of linked partners of anything touched are cleared too (a pair is never cut on one side
 * only). Refused (unchanged) if that reaches a locked track. */
export function clearRange(project: VideoProject, a: number, b: number, trackIds: Iterable<string>, stamp = Date.now().toString(36)): VideoProject {
  if (b - a < EPS) return project
  const tracks = new Set(trackIds)
  const overlaps = (c: Clip) => tracks.has(c.trackId) && c.start < b - EPS && end(c) > a + EPS
  // follow links to a fixed point
  for (let grew = true; grew;) {
    grew = false
    for (const c of project.clips) {
      if (!overlaps(c) || !c.linkId) continue
      for (const p of project.clips) if (p.linkId === c.linkId && !tracks.has(p.trackId)) { tracks.add(p.trackId); grew = true }
    }
  }
  const touched = project.clips.filter(overlaps)
  if (!touched.length) return project
  if (setLocked(project, new Set(touched.map((c) => c.id)))) return project
  const relink = new Map<string, string>()
  const out: Clip[] = []
  for (const c of project.clips) {
    if (!overlaps(c)) { out.push(c); continue }
    const s = c.start
    const e = end(c)
    if (s >= a - EPS && e <= b + EPS) continue
    if (s < a && e > b) {
      out.push(subClip(c, 0, a - s))
      let link = c.linkId
      if (link) { if (!relink.has(link)) relink.set(link, `${link}-${stamp}`); link = relink.get(link) }
      out.push({ ...subClip(c, b - s, c.duration), id: `${c.id}-r${stamp}`, start: b, linkId: link })
    } else if (s < a) out.push(subClip(c, 0, a - s))
    else out.push({ ...subClip(c, b - s, c.duration), start: b })
  }
  return { ...project, clips: out }
}

const unlockedTracks = (p: VideoProject) => p.tracks.filter((t) => !t.locked).map((t) => t.id)

/** Lift: take [a, b) out of every unlocked track and leave the gap. */
export function liftRange(project: VideoProject, a: number, b: number, trackIds: Iterable<string> = unlockedTracks(project)): VideoProject {
  return clearRange(project, a, b, trackIds)
}

/** Extract: take [a, b) out of every unlocked track and close the gap (a ripple), keeping every track in sync. */
export function extractRange(project: VideoProject, a: number, b: number, trackIds: Iterable<string> = unlockedTracks(project)): VideoProject {
  const cleared = clearRange(project, a, b, trackIds)
  if (cleared === project) return project
  const r = rippleShift(cleared, b, a - b)
  return r ? { ...cleared, clips: r.clips, markers: r.markers } : project
}

/** Overwrite: put clips (with their starts) on their tracks, replacing whatever was under them there. */
export function overwriteClips(project: VideoProject, clips: Clip[]): VideoProject {
  if (!clips.length) return project
  let p = ensureTracksFor(project, clips)
  if (clips.some((c) => p.tracks.find((t) => t.id === c.trackId)?.locked)) return project
  for (const c of clips) {
    const next = clearRange(p, c.start, end(c), [c.trackId])
    if (next === p && p.clips.some((x) => x.trackId === c.trackId && x.start < end(c) - EPS && end(x) > c.start + EPS)) return project
    p = next
  }
  for (const c of clips) p = addClip(p, c)
  return p
}

/** Insert: open room at the clips' start on every track (clips across that point on the target tracks are split),
 * then put the clips there. Everything after moves later by their length, in sync. */
export function insertClips(project: VideoProject, clips: Clip[]): VideoProject {
  if (!clips.length) return project
  let p = ensureTracksFor(project, clips)
  const at = Math.min(...clips.map((c) => c.start))
  const len = Math.max(...clips.map(end)) - at
  const targets = new Set(clips.map((c) => c.trackId))
  if ([...targets].some((id) => p.tracks.find((t) => t.id === id)?.locked)) return project
  for (const c of [...p.clips]) {
    const cur = p.clips.find((x) => x.id === c.id)
    if (cur && targets.has(cur.trackId) && cur.start < at - EPS && end(cur) > at + EPS) p = splitClip(p, cur.id, at)
  }
  const r = rippleShift(p, at, len)
  if (!r) return project
  p = { ...p, clips: r.clips, markers: r.markers }
  for (const c of clips) p = addClip(p, c)
  return p
}

/** The magnetic main track: the main footage track (V1) closes its gaps, so its clips sit end to end from 0 (an
 * overlap stays: it is a crossfade). Each clip's linked partners move with it; a clip linked to one on a locked track
 * stays. Returns the same project when nothing moved. */
export function magnetize(project: VideoProject): VideoProject {
  const main = trackForKind(project, 'video')
  if (!main || project.tracks.find((t) => t.id === main)?.locked) return project
  const on = project.clips.filter((c) => c.trackId === main).sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1))
  const shift = new Map<string, number>()
  let cursor = 0
  for (const c of on) {
    let start = c.start
    if (c.start > cursor + EPS && !groupLocked(project, c.id)) start = cursor
    if (Math.abs(start - c.start) > EPS) for (const id of linkedIds(project, c.id)) shift.set(id, start - c.start)
    cursor = Math.max(cursor, start + c.duration)
  }
  if (!shift.size) return project
  return { ...project, clips: project.clips.map((c) => (shift.has(c.id) ? { ...c, start: Math.max(0, c.start + shift.get(c.id)!) } : c)) }
}

/** Change a clip's timing (speed, ramp, freeze, reverse) with `retime`; its linked sound gets the same change so they
 * stay in sync, and everything after the clip moves by the change in length. */
export function retimeClip(project: VideoProject, clipId: string, retime: (c: Clip) => Clip): VideoProject {
  const target = project.clips.find((c) => c.id === clipId)
  if (!target || groupLocked(project, clipId) || target.compound) return project
  const group = linkedIds(project, clipId)
  const next = retime(target)
  const change = next.duration - target.duration
  const clips = project.clips.map((c) => (c.id === clipId ? next : group.has(c.id) ? retime(c) : c))
  const r = rippleShift({ ...project, clips }, end(target), change, group)
  // refused (a clip that would move is linked to one on a locked track): nothing changes, rather than overlap clips
  return r ? { ...project, clips: r.clips, markers: r.markers } : project
}

// ---------------------------------------------------------------- markers

export const MARKER_COLORS = ['#f59e0b', '#ef4444', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'] as const

function cleanMarkers(raw: unknown): Marker[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: Marker[] = []
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue
    const o = m as Record<string, unknown>
    if (typeof o.t !== 'number' || !Number.isFinite(o.t)) continue
    out.push({
      id: typeof o.id === 'string' && o.id ? o.id.slice(0, 60) : `mk-${out.length}`,
      t: Math.max(0, o.t),
      name: typeof o.name === 'string' ? o.name.slice(0, 120) : '',
      color: typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : MARKER_COLORS[0],
    })
  }
  return out.length ? out.sort((a, b) => a.t - b.t) : undefined
}

const sortMarkers = (ms: Marker[]) => [...ms].sort((a, b) => a.t - b.t)

/** Add a marker at `t` (a marker already within half a frame of `t` is kept instead). Its name starts empty: the
 * editor names it; nothing is invented. */
export function addMarker(project: VideoProject, t: number, opts: { id?: string; color?: string; name?: string } = {}): VideoProject {
  const ms = project.markers ?? []
  if (ms.some((m) => Math.abs(m.t - t) < 1 / (project.fps || 30) / 2)) return project
  const m: Marker = { id: opts.id ?? `mk-${Date.now().toString(36)}-${ms.length}-${Math.random().toString(36).slice(2, 6)}`, t: Math.max(0, t), name: opts.name ?? '', color: opts.color ?? MARKER_COLORS[0] }
  return { ...project, markers: sortMarkers([...ms, m]) }
}

export function updateMarker(project: VideoProject, id: string, patch: Partial<Omit<Marker, 'id'>>): VideoProject {
  const ms = project.markers ?? []
  if (!ms.some((m) => m.id === id)) return project
  const clean = { ...patch }
  if (clean.t != null) clean.t = Math.max(0, clean.t)
  if (clean.name != null) clean.name = clean.name.slice(0, 120)
  return { ...project, markers: sortMarkers(ms.map((m) => (m.id === id ? { ...m, ...clean } : m))) }
}

export function removeMarker(project: VideoProject, id: string): VideoProject {
  const ms = project.markers ?? []
  const left = ms.filter((m) => m.id !== id)
  if (left.length === ms.length) return project
  return { ...project, markers: left.length ? left : undefined }
}

/** The next marker after `t` (dir 1) or the one before it (dir −1). */
export function markerNear(project: Pick<VideoProject, 'markers'>, t: number, dir: 1 | -1): Marker | undefined {
  const ms = project.markers ?? []
  return dir > 0 ? ms.find((m) => m.t > t + 1e-3) : [...ms].reverse().find((m) => m.t < t - 1e-3)
}

// ---------------------------------------------------------------- groups

/** Group clips (and their linked partners): they move and delete as one. Clips already in groups bring those groups
 * along (the groups merge). Needs two clips or more. */
export function groupClips(project: VideoProject, ids: string[], stamp = Date.now().toString(36)): VideoProject {
  const set = new Set<string>()
  for (const id of ids) for (const x of moveSet(project, id)) set.add(x)
  if (set.size < 2 || ids.length < 2) return project
  const g = `grp-${stamp}`
  return { ...project, clips: project.clips.map((c) => (set.has(c.id) ? { ...c, groupId: g } : c)) }
}

/** Ungroup the groups any of the clips belong to. */
export function ungroupClips(project: VideoProject, ids: string[]): VideoProject {
  const groups = new Set(project.clips.filter((c) => ids.includes(c.id) && c.groupId).map((c) => c.groupId!))
  if (!groups.size) return project
  return { ...project, clips: project.clips.map((c) => (c.groupId && groups.has(c.groupId) ? { ...c, groupId: undefined } : c)) }
}

// ---------------------------------------------------------------- compound clips

/** Make one compound clip of the clips (with their partners and groups): a nested timeline holding them on copies of
 * their tracks, from 0. The compound goes on the main video track among them (or their top track when none is
 * footage) at their earliest start, as long as they spanned. */
export function makeCompound(project: VideoProject, ids: string[], stamp = Date.now().toString(36), atDepth = 0): VideoProject {
  if (compoundProblem(project, ids, atDepth)) return project
  const set = new Set<string>()
  for (const id of ids) for (const x of moveSet(project, id)) set.add(x)
  const members = project.clips.filter((c) => set.has(c.id))
  const a = Math.min(...members.map((c) => c.start))
  const b = Math.max(...members.map(end))
  const used = new Set(members.map((c) => c.trackId))
  const tracks = project.tracks.filter((t) => used.has(t.id)).map((t) => ({ ...t, locked: false }))
  const inner = members.map((c) => ({ ...c, start: c.start - a, groupId: undefined }))
  const home = compoundHome(tracks)
  const kind: TrackKind = tracks.some((t) => t.kind === 'video') ? 'video' : tracks.every((t) => t.kind === 'audio') ? 'audio' : home.kind === 'text' ? 'overlay' : home.kind
  const clip: Clip = {
    id: `clip-cmp-${stamp}`, trackId: home.id, title: 'Compound clip', kind, start: a, duration: b - a, in: 0, out: b - a,
    srcDuration: b - a, color: '#475569', compound: { tracks, clips: inner },
  }
  return { ...project, clips: [...project.clips.filter((c) => !set.has(c.id)), clip] }
}

/** The track a compound of clips on `tracks` goes on: a video track among them, else an overlay track, else a text
 * track, else (captions or sound only) their top track. A compound of titles and captions once took the caption
 * track's kind (it sat first in the list) and read as an empty caption. */
const compoundHome = (tracks: Track[]) => tracks.find((t) => t.kind === 'video') ?? tracks.find((t) => t.kind === 'overlay') ?? tracks.find((t) => t.kind === 'text') ?? tracks[0]

/** How deep compound clips nest inside a clip list (0: none). */
export function compoundDepth(clips: Clip[]): number {
  let d = 0
  for (const c of clips) if (c.compound) d = Math.max(d, 1 + compoundDepth(c.compound.clips))
  return d
}

/** Why the clips cannot become one compound clip (null: they can). The compound covers [first start, last end] on
 * one track; a clip that is not part of it there would be hidden under it (or over it), so that is refused rather
 * than silently stacked — select it too, or move it. `atDepth`: how deep the timeline being edited already is. */
export function compoundProblem(project: VideoProject, ids: string[], atDepth = 0): string | null {
  const set = new Set<string>()
  for (const id of ids) for (const x of moveSet(project, id)) set.add(x)
  const members = project.clips.filter((c) => set.has(c.id))
  if (!members.length) return 'Select the clips to put in a compound clip.'
  if (setLocked(project, set)) return 'One of those clips is on a locked track (or linked to one). Unlock it first.'
  if (atDepth + 1 + compoundDepth(members) > MAX_COMPOUND_DEPTH) return `Compound clips can nest ${MAX_COMPOUND_DEPTH} levels deep at most.`
  const a = Math.min(...members.map((c) => c.start))
  const b = Math.max(...members.map(end))
  const used = new Set(members.map((c) => c.trackId))
  const home = compoundHome(project.tracks.filter((t) => used.has(t.id)))
  const covered = project.clips.find((c) => !set.has(c.id) && c.trackId === home.id && c.start < b - EPS && end(c) > a + EPS)
  if (covered) return `“${covered.title || 'A clip'}” on ${home.name.split(' ·')[0]} lies inside that span but is not selected; the compound clip would cover it. Select it too, or move it.`
  return null
}

/** Break a compound clip back into its clips on the parent timeline (the part [in, out] it shows, at its place).
 * Its tracks go to the parent's tracks of the same id and kind, or to new tracks. */
export function breakCompound(project: VideoProject, clipId: string, stamp = Date.now().toString(36)): VideoProject {
  const X = project.clips.find((c) => c.id === clipId)
  if (!X?.compound || groupLocked(project, clipId)) return project
  let p: VideoProject = { ...project, clips: project.clips.filter((c) => c.id !== clipId) }
  const map = new Map<string, string>()
  for (const t of X.compound.tracks) {
    const same = p.tracks.find((x) => x.id === t.id && x.kind === t.kind && !x.locked)
    if (same) { map.set(t.id, same.id); continue }
    const before = new Set(p.tracks.map((x) => x.id))
    p = addTrack(p, t.kind)
    map.set(t.id, p.tracks.find((x) => !before.has(x.id))!.id)
  }
  const out = windowClips(X, X.compound.clips).map((c) => ({ ...c, id: p.clips.some((x) => x.id === c.id) ? `${c.id}-${stamp}` : c.id, trackId: map.get(c.trackId) ?? c.trackId }))
  return { ...p, clips: [...p.clips, ...out] }
}

/** The inner clips of compound X cut to the part it shows ([in, in + duration] of its nested time) and placed on the
 * parent's time. */
function windowClips(X: Clip, inner: Clip[]): Clip[] {
  const a = X.in
  const b = X.in + X.duration
  const out: Clip[] = []
  for (const c of inner) {
    const s = c.start
    const e = end(c)
    if (e <= a + EPS || s >= b - EPS) continue
    const ca = Math.max(0, a - s)
    const cb = Math.min(c.duration, b - s)
    const piece = ca > EPS || cb < c.duration - EPS ? subClip(c, ca, cb) : c
    out.push({ ...piece, start: X.start + (s + ca - a) })
  }
  return out
}

/** The audio tracks of a compound's inside as they sound in the flattened project. Solo inside a compound is scoped to
 * it (its other tracks go silent; the outer tracks are not touched). The outer track the compound sits on applies to
 * everything inside: its mute, its fader (dB added) and pan (added, clamped), its bus when it has one (an override),
 * and its solo (the inside then counts as soloed). */
function compoundAudioTracks(inner: Track[], home: Track | undefined, X: Clip): Track[] {
  const audio = inner.filter((t) => t.kind === 'audio')
  const innerSolo = audio.some((t) => t.solo === true)
  const outer = home?.kind === 'audio' ? home : undefined
  return audio.map((t) => {
    const o: Track = { ...t, muted: t.muted || !!home?.muted || !!X.muted || (innerSolo && t.solo !== true) }
    delete o.solo
    if (outer?.solo === true && !o.muted) o.solo = true
    if (outer?.bus) o.bus = outer.bus
    const vol = (t.volume ?? 0) + (outer?.volume ?? 0)
    if (vol !== 0) o.volume = Math.max(-60, Math.min(12, Math.round(vol * 1000) / 1000)); else delete o.volume
    const pan = Math.max(-1, Math.min(1, (t.pan ?? 0) + (outer?.pan ?? 0)))
    if (pan !== 0) o.pan = pan; else delete o.pan
    return o
  })
}

/** The project as the preview, the sound and the export see it: every compound clip replaced by its inside (at its
 * place, to its [in, out]), on tracks placed just above the compound's own track (so they cover what it covered), its
 * sound on extra audio tracks. Ids are prefixed with the compound's (stable, so caches keyed by clip id hold). The
 * compound's opacity and volume multiply its inside's. The same object comes back when there is no compound. */
export function flattenCompounds(project: VideoProject): VideoProject {
  if (!project.clips.some((c) => c.compound)) return project
  let tracks = [...project.tracks]
  const clips: Clip[] = []
  const extraAudio: Track[] = []
  for (const X of project.clips) {
    if (!X.compound) { clips.push(X); continue }
    const home = project.tracks.find((t) => t.id === X.trackId)
    const inner = flattenCompounds({ ...project, tracks: X.compound.tracks, clips: X.compound.clips, markers: undefined })
    const pre = `${X.id}/`
    const visual = inner.tracks.filter((t) => t.kind !== 'audio').map((t) => ({ ...t, id: pre + t.id, locked: false, hidden: t.hidden || home?.hidden || undefined }))
    const audio = compoundAudioTracks(inner.tracks, home, X).map((t) => ({ ...t, id: pre + t.id, locked: false }))
    const at = Math.max(0, tracks.findIndex((t) => t.id === X.trackId))
    tracks.splice(at, 0, ...visual)
    extraAudio.push(...audio)
    for (const c of windowClips(X, inner.clips)) {
      const prop = c.kind === 'audio' ? 'volume' : 'opacity'
      clips.push({
        ...c, id: pre + c.id, trackId: pre + c.trackId,
        linkId: c.linkId ? pre + c.linkId : undefined, groupId: undefined,
        ...timesCompound(c, X, prop),
      })
    }
  }
  tracks = [...tracks, ...extraAudio]
  return { ...project, tracks, clips }
}

/** An inner clip's opacity (or volume) times the compound's, as fields of the flattened clip. The compound's own value
 * may be keyed (its keys, in its local time, are cut exactly to the inner clip's window): a keyed side times a plain
 * one is the keys scaled (exact); keyed times keyed is sampled every 1/60 s and at every key of both (linear between,
 * so between those points it is close, not exact). Without keys on either side it is the plain product, as before. */
function timesCompound(c: Clip, X: Clip, prop: 'opacity' | 'volume'): Partial<Clip> {
  const xBase = X[prop] ?? 1
  const cBase = c[prop] ?? 1
  const xKeysAll = X.keyframes?.[prop]
  const off = c.start - X.start
  const xKeys = xKeysAll?.length ? cutKeyframes({ k: xKeysAll }, off, off + c.duration)?.k : undefined
  const cKeys = c.keyframes?.[prop]?.length ? c.keyframes[prop] : undefined
  const withKeys = (keys: Key[] | undefined): Partial<Clip> => {
    const kf = { ...(c.keyframes ?? {}) }
    if (keys?.length) kf[prop] = keys
    else delete kf[prop]
    return { [prop]: cBase * xBase, keyframes: Object.keys(kf).length ? kf : undefined }
  }
  if (!xKeys && !cKeys) return xBase === 1 ? {} : { [prop]: cBase * xBase }
  if (!xKeys) return xBase === 1 ? {} : withKeys(cKeys!.map((k) => ({ ...k, v: k.v * xBase })))
  if (!cKeys) return withKeys(xKeys.map((k) => ({ ...k, v: k.v * cBase })))
  const times = new Set<number>()
  for (let t = 0; t < c.duration; t += 1 / 60) times.add(Math.round(t * 1e6) / 1e6)
  times.add(c.duration)
  // every key, and a moment just before it, so a hold's step stays a step in the product (not a 1/60 s ramp)
  for (const k of [...xKeys, ...cKeys]) if (k.t >= 0 && k.t <= c.duration) { times.add(k.t); if (k.t > 1e-6) times.add(k.t - 1e-6) }
  const ts = [...times].sort((p, q) => p - q)
  return withKeys(ts.map((t) => ({ t, v: (sampleKeys(cKeys, t) ?? cBase) * (sampleKeys(xKeys, t) ?? xBase) })))
}

/** The timeline being edited at a compound path (ids of compound clips, outermost first): the root for []. Undefined
 * when the path no longer leads to a compound (it was deleted or undone). */
export function compoundView(root: VideoProject, path: string[]): VideoProject | undefined {
  let view = root
  for (const id of path) {
    const X = view.clips.find((c) => c.id === id && c.compound)
    if (!X?.compound) return undefined
    const inner: VideoProject = { ...root, id: X.id, name: X.title, tracks: X.compound.tracks, clips: X.compound.clips, markers: X.compound.markers, magnetic: undefined, mediaAssets: undefined }
    view = { ...inner, duration: Math.max(EMPTY_VIEW_SECONDS, Math.ceil(contentEnd(inner) + 10)) }
  }
  return view
}

/** Write an edited view back into the root at `path` (the compound clip takes the view's tracks, clips and markers;
 * its source length follows its content). */
export function writeCompoundView(root: VideoProject, path: string[], view: VideoProject): VideoProject {
  if (!path.length) return view
  const parentPath = path.slice(0, -1)
  const parent = compoundView(root, parentPath)
  if (!parent) return root
  const id = path[path.length - 1]
  const X = parent.clips.find((c) => c.id === id)
  if (!X?.compound) return root
  const len = contentEnd(view)
  const nextX: Clip = { ...X, compound: { tracks: view.tracks, clips: view.clips, ...(view.markers?.length ? { markers: view.markers } : {}) }, srcDuration: Math.max(len, 0.05) }
  const nextParent = { ...parent, clips: parent.clips.map((c) => (c.id === id ? nextX : c)) }
  // the root keeps its own view length and settings; a nested parent's are rebuilt from the root when it is read
  return writeCompoundView(root, parentPath, parentPath.length ? nextParent : { ...root, clips: nextParent.clips })
}

// ---------------------------------------------------------------- copy and paste attributes

export type AttrGroup = 'transform' | 'crop' | 'opacity' | 'volume' | 'effects' | 'speed' | 'keyframes'
export const ATTR_FIELDS: Record<AttrGroup, (keyof Clip)[]> = {
  transform: ['fit', 'scale', 'offX', 'offY', 'rotation', 'anchorX', 'anchorY'],
  crop: ['cropL', 'cropR', 'cropT', 'cropB'],
  opacity: ['opacity'],
  volume: ['volume', 'muted'],
  effects: ['effects', 'blendMode'],
  speed: ['speed', 'freezes', 'reverse', 'preservePitch'],
  keyframes: ['keyframes'],
}
export const ATTR_LABEL: Record<AttrGroup, string> = { transform: 'Position, scale and rotation', crop: 'Crop', opacity: 'Opacity', volume: 'Volume', effects: 'Effects, colour and blend', speed: 'Speed, freezes and reverse', keyframes: 'Keyframes' }

/** The attribute groups that mean something for a clip (speed only for footage and sound; crop for footage; effects
 * for anything with pixels of its own). A compound clip is flattened into its clips: it takes opacity, volume and
 * their keyframes only (its own position, scale, rotation, crop and effects are not applied — Planned). */
export function attrGroupsFor(c: Clip): AttrGroup[] {
  if (c.compound) return ['opacity', 'volume', 'keyframes']
  const media = (c.kind === 'video' && !c.still) || c.kind === 'audio'
  const out: AttrGroup[] = []
  if (c.kind !== 'audio') out.push('transform', 'opacity')
  if (c.kind === 'video') out.push('crop')
  if (c.kind === 'audio') out.push('volume')
  if (c.kind !== 'audio') out.push('effects')
  if (media && c.srcDuration != null) out.push('speed')
  out.push('keyframes')
  return out
}

/** Keyframes that may be pasted onto `t`: a compound takes opacity and volume keys only; effect keys only for effects
 * the target has. */
function keysFor(t: Clip, keys: Clip['keyframes']): Clip['keyframes'] {
  if (!keys) return undefined
  const fx = new Set((t.effects ?? []).map((e) => e.id))
  const out: Record<string, Key[]> = {}
  for (const [p, ks] of Object.entries(keys)) {
    if (t.compound ? p !== 'opacity' && p !== 'volume' : p.startsWith('fx.') && !fx.has(p.split('.')[1])) continue
    out[p] = ks
  }
  return Object.keys(out).length ? out : undefined
}

/** Paste the chosen attribute groups of `source` onto the clips `targetIds` (each takes the ones that mean something
 * for it; locked ones are skipped). Speed changes the target's length (its linked sound follows; later clips move). */
export function pasteAttributes(project: VideoProject, source: Clip, targetIds: string[], groups: AttrGroup[], report?: { refused: string[] }): VideoProject {
  let p = project
  for (const id of targetIds) {
    const t = p.clips.find((c) => c.id === id)
    if (!t || t.id === source.id || groupLocked(p, id)) continue
    const ok = new Set(attrGroupsFor(t))
    const patch: Partial<Clip> = {}
    for (const g of groups) if (g !== 'speed' && g !== 'keyframes' && ok.has(g)) for (const f of ATTR_FIELDS[g]) (patch as Record<string, unknown>)[f] = source[f]
    // effects bring their own animation (fx.<id>.* keys) along; the target's keys for effects it no longer has go
    let keys = t.keyframes
    if (groups.includes('effects') && ok.has('effects')) {
      const own = Object.fromEntries(Object.entries(t.keyframes ?? {}).filter(([k]) => !k.startsWith('fx.')))
      const theirs = Object.fromEntries(Object.entries(source.keyframes ?? {}).filter(([k]) => k.startsWith('fx.')))
      keys = Object.keys(own).length + Object.keys(theirs).length ? { ...own, ...theirs } : undefined
    }
    if (groups.includes('keyframes') && ok.has('keyframes')) keys = keysFor({ ...t, ...patch } as Clip, source.keyframes)
    if (keys !== t.keyframes) patch.keyframes = keys
    if (Object.keys(patch).length) p = { ...p, clips: p.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) }
    if (groups.includes('speed') && ok.has('speed')) {
      const before = p
      p = retimeClip(p, id, (c) => {
        const next = { ...c, speed: source.speed, freezes: source.freezes, reverse: source.reverse, preservePitch: source.preservePitch }
        return { ...next, duration: clipDurationFor(next) }
      })
      // refused (the ripple would pull a linked pair apart on a locked track): that clip keeps its speed
      if (p === before && !sameTiming(t, source)) report?.refused.push(id)
    }
  }
  return p
}

const sameTiming = (a: Clip, b: Clip) => JSON.stringify([a.speed, a.freezes, !!a.reverse, a.preservePitch]) === JSON.stringify([b.speed, b.freezes, !!b.reverse, b.preservePitch])
