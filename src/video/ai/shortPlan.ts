// A highlight candidate as clips: the footage range (and its linked sound) placed after the current end of the
// timeline, so the editor can review it and reframe it. Nothing is published or rendered here.
import { contentEnd, type Clip, type VideoProject } from '../timeline'
import type { HighlightCandidate } from './highlights'

export function shortClips(project: VideoProject, clip: Clip, cand: HighlightCandidate, stamp = Date.now().toString(36)): Clip[] {
  if (!(cand.end > cand.start)) return []
  const dur = cand.end - cand.start
  const at = contentEnd(project) + 0.5
  const shift = (c: Clip, id: string, linkId?: string): Clip => ({
    ...c,
    id,
    linkId,
    start: at,
    in: c.in + (cand.start - clip.in),
    out: c.in + (cand.start - clip.in) + dur,
    duration: dur,
    title: `Short · ${cand.text.slice(0, 32)}`,
  })
  const linked = clip.linkId ? project.clips.filter((c) => c.linkId === clip.linkId && c.id !== clip.id) : []
  const newLink = clip.linkId ? `${clip.linkId}-short-${stamp}` : undefined
  const id = `clip-short-${stamp}`
  return [shift(clip, id, newLink), ...linked.map((c, i) => shift(c, `${c.id}-short-${stamp}-${i}`, newLink))]
}
