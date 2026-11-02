// Phase 4 (Part A): the pure edits behind the audio store actions. Each takes a project and returns the project with the
// change made (the same object when nothing changed, so the store leaves no undo step), every value cleaned by the
// sanitisers (a slider or a typed number can never put NaN or an out-of-range value in a project). `null` clears a
// setting back to its default.

import type { Clip, Marker, Track, VideoProject } from './timeline'
import { addMarker } from './timeline'
import type { Bus, ClipDenoise, ClipFade, DuckingSettings, LoudnessTarget, MasterSettings } from './audioModel'
import { sanitizeBusVolume, sanitizeClipAudio, sanitizeDucking, sanitizeLoudnessTarget, sanitizeMaster, sanitizeTrackAudio, BUSES } from './audioModel'

export interface ClipAudioPatch { gain?: number | null; fadeIn?: ClipFade | null; fadeOut?: ClipFade | null; pan?: number | null; denoise?: ClipDenoise | null }
export interface TrackAudioPatch { bus?: Bus | null; volume?: number | null; pan?: number | null; solo?: boolean | null; muted?: boolean }
export interface ProjectAudioPatch { master?: Partial<MasterSettings> | null; ducking?: Partial<DuckingSettings> | null; loudnessTarget?: LoudnessTarget; busVolume?: Partial<Record<Bus, number | null>> | null }

const CLIP_FIELDS = ['gain', 'fadeIn', 'fadeOut', 'pan', 'denoise'] as const
const TRACK_FIELDS = ['bus', 'volume', 'pan', 'solo'] as const
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Change a clip's audio parameters (gain dB, fades, pan, noise reduction). */
export function updateClipAudio(p: VideoProject, clipId: string, patch: ClipAudioPatch): VideoProject {
  const c = p.clips.find((x) => x.id === clipId)
  if (!c || c.kind !== 'audio') return p
  const raw: Record<string, unknown> = {}
  for (const f of CLIP_FIELDS) raw[f] = f in patch ? patch[f] ?? undefined : c[f]
  if (patch.denoise && typeof patch.denoise === 'object' && !('noiseRange' in patch.denoise)) {
    // the amount alone changed: the sample (or the note that it was lost) stays; picking or clearing a sample replaces both
    if (c.denoise?.noiseRange) raw.denoise = { ...patch.denoise, noiseRange: c.denoise.noiseRange }
    else if (c.denoise?.noiseDropped && !('noiseDropped' in patch.denoise)) raw.denoise = { ...patch.denoise, noiseDropped: true }
  }
  const clean = sanitizeClipAudio(raw)
  if (CLIP_FIELDS.every((f) => same(clean[f], c[f]))) return p
  const next: Clip = { ...c }
  for (const f of CLIP_FIELDS) delete next[f]
  Object.assign(next, clean)
  return { ...p, clips: p.clips.map((x) => (x.id === clipId ? next : x)) }
}

/** Change an audio track's bus, fader (dB), pan, solo or mute. */
export function updateTrackAudio(p: VideoProject, trackId: string, patch: TrackAudioPatch): VideoProject {
  const t = p.tracks.find((x) => x.id === trackId)
  if (!t || t.kind !== 'audio') return p
  const raw: Record<string, unknown> = {}
  for (const f of TRACK_FIELDS) raw[f] = f in patch ? patch[f] ?? undefined : t[f]
  const clean = sanitizeTrackAudio(raw)
  const muted = patch.muted === undefined ? t.muted : !!patch.muted
  if (TRACK_FIELDS.every((f) => same(clean[f], t[f])) && muted === t.muted) return p
  const next: Track = { ...t, muted }
  for (const f of TRACK_FIELDS) delete next[f]
  Object.assign(next, clean)
  return { ...p, tracks: p.tracks.map((x) => (x.id === trackId ? next : x)) }
}

/** Change the master, ducking, loudness target or bus faders. A partial master/ducking is merged into what is there. */
export function updateProjectAudio(p: VideoProject, patch: ProjectAudioPatch): VideoProject {
  const next: VideoProject = { ...p }
  if ('master' in patch) {
    const m = patch.master === null ? undefined : sanitizeMaster({ ...p.master, ...patch.master })
    if (m) next.master = m; else delete next.master
  }
  if ('ducking' in patch) {
    const d = patch.ducking === null ? undefined : sanitizeDucking({ ...p.ducking, ...patch.ducking })
    if (d) next.ducking = d; else delete next.ducking
  }
  if ('loudnessTarget' in patch) {
    const l = sanitizeLoudnessTarget(patch.loudnessTarget)
    if (l !== undefined) next.loudnessTarget = l; else delete next.loudnessTarget
  }
  if ('busVolume' in patch) {
    const merged: Record<string, unknown> = { ...p.busVolume }
    if (patch.busVolume === null) for (const b of BUSES) delete merged[b]
    else for (const [b, v] of Object.entries(patch.busVolume ?? {})) { if (v === null) delete merged[b]; else merged[b] = v }
    const bv = sanitizeBusVolume(merged)
    if (bv) next.busVolume = bv; else delete next.busVolume
  }
  const keys = ['master', 'ducking', 'loudnessTarget', 'busVolume'] as const
  return keys.every((k) => same(next[k], p[k])) ? p : next
}

// ---------------------------------------------------------------- beat markers

/** What beat detection found, for the editor to look at before anything is added to the timeline. Times are CLIP-RELATIVE
 * (seconds from the clip's first frame) and are turned into timeline times only when the proposal is applied, against the
 * clip as it is then: a clip that moved still gets its markers in the right place, one that was edited is refused. */
export interface BeatProposal {
  kind: 'proposal'
  applied: false
  clipId: string
  /** The clip's placement when the beats were found (clipPlacementKey): a changed clip makes the proposal stale. */
  clipKey: string
  /** Where the clip was then (information only). */
  clipStart: number
  clipDuration: number
  /** Estimated tempo of the clip (null when it is too short or too irregular). */
  tempo: { bpm: number; confidence: number } | null
  /** Strongest onsets and the beat grid, as clip-relative seconds. */
  onsets: { t: number; strength: number }[]
  beats: number[]
}

/** The most markers one apply adds. */
export const MAX_BEAT_MARKERS = 500
export const BEAT_MARKER_COLOR = '#3b82f6'

/** What a beat proposal depends on in a clip: its source and the part of it that plays (not where it sits: a move is fine). */
export const clipPlacementKey = (c: Clip) => JSON.stringify([c.sourceUrl ?? '', c.duration, c.in, c.out, c.speed ?? 1, c.freezes ?? null, c.reverse ? 1 : 0, c.preservePitch === false ? 0 : 1])

export function beatProposal(a: { clipId: string; clipStart: number; clipDuration: number; clipKey?: string; onsets: { t: number; strength: number }[]; beats: number[]; tempo: { bpm: number; confidence: number } | null }): BeatProposal {
  const inside = (t: number) => t >= 0 && t <= a.clipDuration
  const r3 = (t: number) => Math.round(t * 1000) / 1000
  return {
    kind: 'proposal', applied: false, clipId: a.clipId, clipKey: a.clipKey ?? '', clipStart: a.clipStart, clipDuration: a.clipDuration, tempo: a.tempo,
    onsets: a.onsets.filter((o) => inside(o.t)).map((o) => ({ t: r3(o.t), strength: o.strength })),
    beats: a.beats.filter(inside).map(r3),
  }
}

/** Why a proposal can no longer be applied (the clip is gone or was edited), or null when it is still good. */
export function proposalProblem(p: VideoProject, pr: BeatProposal): string | null {
  const c = p.clips.find((x) => x.id === pr.clipId)
  if (!c) return 'The clip these beats were found in is gone. Find the beats again.'
  if (pr.clipKey && clipPlacementKey(c) !== pr.clipKey) return 'The clip was edited after the beats were found. Find the beats again.'
  return null
}

/** The clip-relative times a proposal would add: the beat grid ('beats', the default), or the strongest onsets
 * ('onsets', at most `max`). */
export function proposalTimes(pr: BeatProposal, use: 'beats' | 'onsets' = 'beats', max = MAX_BEAT_MARKERS): number[] {
  if (use === 'beats' && pr.beats.length) return pr.beats.slice(0, max)
  return [...pr.onsets].sort((a, b) => b.strength - a.strength).slice(0, max).map((o) => o.t).sort((a, b) => a - b)
}

/** Add a proposal's markers at the clip's CURRENT place (a marker within half a frame of an existing one is skipped).
 * Unchanged when the proposal is stale (see proposalProblem). Names stay empty: the editor names them. */
export function applyProposal(p: VideoProject, pr: BeatProposal, use: 'beats' | 'onsets' = 'beats', idStamp = Date.now().toString(36)): VideoProject {
  if (proposalProblem(p, pr)) return p
  const c = p.clips.find((x) => x.id === pr.clipId)!
  return applyBeatMarkers(p, proposalTimes(pr, use).map((t) => Math.round((c.start + t) * 1000) / 1000), idStamp)
}

/** Add markers at timeline times (a marker within half a frame of an existing one is skipped). */
export function applyBeatMarkers(p: VideoProject, times: number[], idStamp = Date.now().toString(36)): VideoProject {
  let out = p
  times.slice(0, MAX_BEAT_MARKERS).forEach((t, i) => { out = addMarker(out, t, { id: `mk-beat-${idStamp}-${i}`, color: BEAT_MARKER_COLOR }) })
  return out
}

export type { Marker }
