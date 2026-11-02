// Apply source-time cuts (from text editing, filler or silence removal) to a footage clip on the timeline.
// Pure: returns a new project. Each cut is split out and rippled away, so no gap is left and later clips move up.
// Only constant-speed, non-compound clips are handled; anything else is refused with a reason, never guessed.
import { rippleDelete, splitClip, type Clip, type VideoProject } from '../timeline'

export interface SourceRange { from: number; to: number } // seconds in the source file

export type CutRefusal = 'no-clip' | 'not-footage' | 'speed' | 'compound' | 'outside-source' | 'locked'

export interface CutResult { project: VideoProject; removed: number; refused?: undefined }
export interface CutRefused { project: VideoProject; removed: 0; refused: CutRefusal }

const EPS = 1e-6

/** Merge overlapping or touching source ranges, dropping empty ones, sorted by start. */
export function mergeSourceRanges(ranges: SourceRange[], minLen = 0): SourceRange[] {
  const sorted = ranges
    .filter((r) => Number.isFinite(r.from) && Number.isFinite(r.to) && r.to - r.from > Math.max(minLen, EPS))
    .map((r) => ({ from: r.from, to: r.to }))
    .sort((a, b) => a.from - b.from)
  const out: SourceRange[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r.from <= last.to + EPS) last.to = Math.max(last.to, r.to)
    else out.push({ ...r })
  }
  return out
}

/** Cut the given source ranges out of one footage clip. The clip keeps its track, link and effects on the pieces that remain. */
export function applyCutsToClip(project: VideoProject, clipId: string, ranges: SourceRange[]): CutResult | CutRefused {
  const refuse = (refused: CutRefusal): CutRefused => ({ project, removed: 0, refused })
  const clip = project.clips.find((c) => c.id === clipId)
  if (!clip) return refuse('no-clip')
  if (clip.kind !== 'video' || clip.still) return refuse('not-footage')
  if (clip.speed !== undefined && clip.speed !== 1) return refuse('speed')
  if (clip.compound) return refuse('compound')
  const track = project.tracks.find((t) => t.id === clip.trackId)
  if (track?.locked) return refuse('locked')

  const merged = mergeSourceRanges(ranges)
  if (!merged.length) return { project, removed: 0 }
  for (const r of merged) {
    if (r.from < clip.in - 1e-3 || r.to > clip.out + 1e-3) return refuse('outside-source')
  }

  // Work from the end so earlier timeline times stay valid after each ripple.
  let next = project
  let removed = 0
  for (let i = merged.length - 1; i >= 0; i--) {
    const r = merged[i]
    const a = clip.start + (r.from - clip.in)
    const b = clip.start + (r.to - clip.in)
    next = splitClip(next, pieceAt(next, clip.trackId, b, clipId), b)
    next = splitClip(next, pieceAt(next, clip.trackId, a, clipId), a)
    const middle = next.clips.find((c) => c.trackId === clip.trackId && Math.abs(c.start - a) < 1e-4 && Math.abs(c.duration - (b - a)) < 1e-3)
    if (!middle) return refuse('locked')
    const before = next.clips.length
    next = rippleDelete(next, middle.id)
    if (next === project || next.clips.length >= before) return refuse('locked')
    removed++
  }
  return { project: next, removed }
}

/** The clip on this track that covers time t (split point). Falls back to the original clip id. */
function pieceAt(project: VideoProject, trackId: string, t: number, fallback: string): string {
  const hit = project.clips.find((c) => c.trackId === trackId && t > c.start + EPS && t < c.start + c.duration - EPS)
  return hit?.id ?? fallback
}

/** Timeline seconds for a source time on a clip (speed 1). */
export function timelineTimeOf(clip: Pick<Clip, 'start' | 'in'>, sourceTime: number): number {
  return clip.start + (sourceTime - clip.in)
}
