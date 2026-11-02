// Captions from a reviewed transcript: one caption clip per cue, placed where the words sit on the timeline NOW
// (after any cuts), so words removed by text editing do not come back as captions.
import { buildCues, type CueOptions } from './transcript'
import type { Word } from './transcript'
import type { Clip, VideoProject } from '../timeline'

/** The V1 pieces of this source file on the timeline, as (sourceIn, sourceEnd, timelineStart). */
function piecesOf(project: VideoProject, sourceKey: { mediaAssetId?: string; sourceUrl?: string }, trackId: string) {
  return project.clips
    .filter((c) => c.trackId === trackId && c.kind === 'video' && !c.still
      && (sourceKey.mediaAssetId ? c.mediaAssetId === sourceKey.mediaAssetId : c.sourceUrl === sourceKey.sourceUrl))
    .map((c) => ({ from: c.in, to: c.in + c.duration * (c.speed && typeof c.speed === 'number' ? c.speed : 1), start: c.start, speed: c.speed }))
    .filter((p) => p.speed === undefined || p.speed === 1)
    .map(({ from, to, start }) => ({ from, to, start }))
}

/** Caption clips for `words` (source seconds of the footage with that key). Words outside the clip's remaining pieces are dropped. */
export function captionClipsFor(project: VideoProject, sourceKey: { mediaAssetId?: string; sourceUrl?: string }, words: Word[], trackId: string, opts: CueOptions = {}, stamp = Date.now().toString(36)): Clip[] {
  const pieces = piecesOf(project, sourceKey, project.tracks.find((t) => t.kind === 'video')?.id ?? 'v1')
  const timeline: Word[] = []
  for (const w of words) {
    const mid = (w.start + w.end) / 2
    const p = pieces.find((x) => mid >= x.from && mid < x.to)
    if (!p) continue
    const s = p.start + (w.start - p.from)
    const e = p.start + (w.end - p.from)
    timeline.push({ ...w, start: Math.max(0, s), end: Math.max(s + 0.01, e) })
  }
  const cues = buildCues(timeline, opts)
  return cues.map((c, i) => ({
    id: `clip-cap-tr-${stamp}-${i.toString(36)}`,
    trackId,
    title: c.lines.join(' ').slice(0, 40) || 'Caption',
    kind: 'caption' as const,
    start: c.start,
    duration: Math.max(0.1, c.end - c.start),
    in: 0,
    out: Math.max(0.1, c.end - c.start),
    color: '#ffffff',
    captionText: c.lines.join('\n'),
  }))
}
