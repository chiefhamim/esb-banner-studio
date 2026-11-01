// Per-word timing for karaoke captions: given each word's spoken start/end (from a reviewed transcript, Phase 5), say
// which layout word is being spoken at time t. Timings are matched to the layout's words in order; a mismatch in
// count or text is reported rather than guessed.

import type { KaraokeFrame } from './draw'
import type { TitleLayout } from './layout'

export interface WordTiming { text: string; start: number; end: number }

const norm = (s: string) => s.normalize('NFC').replace(/[\p{P}\p{S}]/gu, '').toLowerCase()

/** Check the timings belong to this layout: same number of words, same words (punctuation and case ignored). */
export function matchTimings(layout: TitleLayout, timings: WordTiming[]): { ok: true } | { ok: false; reason: string } {
  if (timings.length !== layout.words.length) return { ok: false, reason: `${timings.length} timings for ${layout.words.length} words` }
  for (let i = 0; i < timings.length; i++) {
    if (norm(timings[i].text) !== norm(layout.words[i].text)) return { ok: false, reason: `word ${i + 1}: "${timings[i].text}" ≠ "${layout.words[i].text}"` }
    if (!(timings[i].end >= timings[i].start) || (i > 0 && timings[i].start < timings[i - 1].start)) return { ok: false, reason: `word ${i + 1}: times out of order` }
  }
  return { ok: true }
}

/** The karaoke frame at time `t` (same clock as the timings). Between two words the last spoken one stays active;
 * before the first nothing is active; after the last, every word is past. */
export function karaokeState(timings: WordTiming[], t: number): KaraokeFrame & { progress: number } {
  let active = -1
  for (let i = 0; i < timings.length; i++) if (t >= timings[i].start) active = i
  if (active >= 0 && t >= timings[active].end && active === timings.length - 1) {
    return { active: -1, past: () => true, progress: 1 }
  }
  const w = timings[active]
  const progress = w ? Math.min(1, Math.max(0, w.end > w.start ? (t - w.start) / (w.end - w.start) : 1)) : 0
  return { active, past: (i) => i < active, progress }
}
