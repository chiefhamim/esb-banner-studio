// Plans for silence and filler removal, in SOURCE seconds, ready for applyTextCuts. Nothing is applied here.
import { detectSilences, fillerCuts, findFillers, silenceCuts, type FillerEntry, type FillerSuggestion, type SilenceOptions } from './textEdit'
import type { Word } from './transcript'
import type { SourceRange } from './applyCuts'

export interface CutPlan { ranges: SourceRange[]; seconds: number; items: string[] }

const total = (r: SourceRange[]) => r.reduce((s, x) => s + (x.to - x.from), 0)

/** Silent spans of the clip's audio, shifted by the clip's in-point to source time. */
export function silencePlan(channels: Float32Array[], sampleRate: number, clipIn: number, fps: number, duration: number, opts: SilenceOptions & { handle?: number } = {}): CutPlan {
  const spans = detectSilences(channels, sampleRate, opts)
  const proposal = silenceCuts(spans.map(([s, e]) => [s + clipIn, e + clipIn] as [number, number]), { fps, handle: opts.handle, duration })
  const ranges = proposal.cuts.map((c) => ({ from: c.start, to: c.end }))
  return { ranges, seconds: total(ranges), items: proposal.cuts.map((c) => c.label) }
}

/** Filler words (EN + BN) found in the transcript, as cuts over those words. */
/** Hesitations (um, উম) by default; discourse markers (so, মানে) only when the editor asks, since they are often real words. */
export function fillerPlan(words: Word[], fps: number, duration: number, kinds: FillerEntry['kind'][] = ['hesitation']): { plan: CutPlan; found: FillerSuggestion[] } {
  const found = findFillers(words, { langs: ['en', 'bn'], kinds })
  const proposal = fillerCuts(words, found, { fps, duration })
  const ranges = proposal.cuts.map((c) => ({ from: c.start, to: c.end }))
  return { plan: { ranges, seconds: total(ranges), items: found.map((f) => f.text) }, found }
}
