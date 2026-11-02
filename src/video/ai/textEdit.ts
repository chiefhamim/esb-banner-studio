// Text-based editing: deleted transcript words → timeline cut ranges (frame-snapped, with short handles so a cut
// never clips a kept word), filler-word SUGGESTIONS (English and Bangla), and silence detection from PCM → a cut
// list. Everything here returns a proposed edit list that is never applied: Phase 5 previews every cut and the editor
// accepts, changes or drops each one, with undo.

import { downmix } from '../audio/fft'
import type { Word } from './transcript'

export interface ProposedCut {
  /** Source seconds, frame-snapped. */
  start: number
  end: number
  reason: 'deleted-words' | 'silence' | 'filler'
  /** Transcript words the cut removes [from, to), when it comes from words. */
  from?: number
  to?: number
  /** The words or a description, for the review list. */
  label: string
}

export interface EditProposal {
  kind: 'proposal'
  applied: false
  /** Machine-made suggestions are labelled; deletions the editor typed are not AI. */
  source: 'editor' | 'detector'
  cuts: ProposedCut[]
}

export interface CutOptions {
  fps: number
  /** Kept around neighbouring words, seconds (default 0.06). */
  handle?: number
  /** Media length (cuts are clamped to it). */
  duration?: number
  /** Cuts shorter than this after snapping are dropped. Default one frame. */
  minLength?: number
}

export const snapToFrame = (t: number, fps: number) => Math.round(t * fps) / fps

/** Merge overlapping or touching cuts (sorted by start). */
export function mergeCuts(cuts: ProposedCut[], eps = 1e-6): ProposedCut[] {
  const s = [...cuts].sort((a, b) => a.start - b.start)
  const out: ProposedCut[] = []
  for (const c of s) {
    const last = out[out.length - 1]
    if (last && c.start <= last.end + eps) {
      last.end = Math.max(last.end, c.end)
      if (c.to != null) last.to = Math.max(last.to ?? c.to, c.to)
      if (last.reason !== c.reason || last.label !== c.label) last.label = `${last.label} · ${c.label}`
    } else out.push({ ...c })
  }
  return out
}

/** Cut ranges for deleted words. A run of deleted words is cut from just after the previous kept word (+ handle) to
 * just before the next kept one (− handle), so the pauses around it go too, but never into a kept word. */
export function cutsForDeletedWords(words: Word[], deleted: Iterable<number>, opts: CutOptions): EditProposal {
  const del = new Set(deleted)
  const handle = opts.handle ?? 0.06
  const dur = opts.duration ?? (words.length ? words[words.length - 1].end : 0)
  const minLen = opts.minLength ?? 1 / opts.fps
  const cuts: ProposedCut[] = []
  let i = 0
  while (i < words.length) {
    if (!del.has(i)) { i++; continue }
    let j = i
    while (j + 1 < words.length && del.has(j + 1)) j++
    const prev = i > 0 ? words[i - 1] : null
    const next = j + 1 < words.length ? words[j + 1] : null
    let start = prev ? Math.min(words[i].start, prev.end + handle) : Math.max(0, words[i].start - handle)
    let end = next ? Math.max(words[j].end, next.start - handle) : Math.min(dur, words[j].end + handle)
    // a handle never reaches back into a kept word
    if (prev) start = Math.max(start, prev.end)
    if (next) end = Math.min(end, next.start)
    start = snapToFrame(start, opts.fps)
    end = snapToFrame(end, opts.fps)
    if (end - start >= minLen - 1e-9) cuts.push({ start, end, reason: 'deleted-words', from: i, to: j + 1, label: words.slice(i, j + 1).map((w) => w.text).join(' ') })
    i = j + 1
  }
  return { kind: 'proposal', applied: false, source: 'editor', cuts: mergeCuts(cuts) }
}

/** What stays after the cuts: [start, end) ranges of the source, in order. */
export function keepRanges(duration: number, cuts: ProposedCut[]): [number, number][] {
  const out: [number, number][] = []
  let t = 0
  for (const c of mergeCuts(cuts)) {
    if (c.start > t) out.push([t, Math.min(c.start, duration)])
    t = Math.max(t, c.end)
  }
  if (t < duration) out.push([t, duration])
  return out
}

/** Source time → time after the cuts (ripple); null when the moment is inside a cut. */
export function rippleTime(t: number, cuts: ProposedCut[]): number | null {
  let removed = 0
  for (const c of mergeCuts(cuts)) {
    if (t < c.start) break
    if (t < c.end) return null
    removed += c.end - c.start
  }
  return t - removed
}

// ---------------------------------------------------------------- fillers

export interface FillerEntry { words: string[]; kind: 'hesitation' | 'discourse' }

/** Hesitations are almost always removable; discourse markers are real words most of the time, so they are weaker
 * suggestions (the editor decides). Bangla entries are matched after NFC normalisation. */
export const FILLERS: Record<'en' | 'bn', FillerEntry[]> = {
  en: [
    ...['um', 'umm', 'uh', 'uhh', 'er', 'erm', 'ah', 'eh', 'hmm', 'mm', 'mhm'].map((w) => ({ words: [w], kind: 'hesitation' as const })),
    ...[['you', 'know'], ['i', 'mean'], ['sort', 'of'], ['kind', 'of'], ['like'], ['basically'], ['actually'], ['so'], ['well'], ['right']].map((w) => ({ words: w, kind: 'discourse' as const })),
  ],
  bn: [
    ...['উম', 'উমম', 'উ', 'আ', 'আম', 'হুম', 'অ্যা', 'ইয়ে'].map((w) => ({ words: [w], kind: 'hesitation' as const })),
    ...[['মানে'], ['আসলে'], ['তো'], ['বলতে', 'গেলে'], ['কী', 'বলব'], ['কি', 'বলব'], ['বুঝলেন'], ['বুঝছেন'], ['আর', 'কি'], ['যেমন']].map((w) => ({ words: w, kind: 'discourse' as const })),
  ],
}

/** Lower case, NFC, punctuation (incl. the danda) stripped. */
export const normWord = (s: string) => s.normalize('NFC').toLocaleLowerCase().replace(/[\p{P}\p{S}।॥]/gu, '').trim()

export interface FillerSuggestion { from: number; to: number; text: string; kind: FillerEntry['kind']; lang: 'en' | 'bn' }

/** Every filler in the transcript, longest match first; suggestions only. */
export function findFillers(words: Word[], opts: { langs?: ('en' | 'bn')[]; kinds?: FillerEntry['kind'][] } = {}): FillerSuggestion[] {
  const langs = opts.langs ?? ['en', 'bn']
  const kinds = opts.kinds ?? ['hesitation', 'discourse']
  const list = langs.flatMap((l) => FILLERS[l].filter((f) => kinds.includes(f.kind)).map((f) => ({ ...f, lang: l, norm: f.words.map(normWord) })))
  list.sort((a, b) => b.norm.length - a.norm.length)
  const norm = words.map((w) => normWord(w.text))
  const out: FillerSuggestion[] = []
  for (let i = 0; i < words.length; ) {
    const m = list.find((f) => f.norm.every((w, k) => norm[i + k] === w))
    if (m) { out.push({ from: i, to: i + m.norm.length, text: words.slice(i, i + m.norm.length).map((w) => w.text).join(' '), kind: m.kind, lang: m.lang }); i += m.norm.length } else i++
  }
  return out
}

/** Filler suggestions as a proposed cut list (same handles and snapping as deleted words). */
export function fillerCuts(words: Word[], fillers: FillerSuggestion[], opts: CutOptions): EditProposal {
  const del: number[] = []
  for (const f of fillers) for (let i = f.from; i < f.to; i++) del.push(i)
  const p = cutsForDeletedWords(words, del, opts)
  return { ...p, source: 'detector', cuts: p.cuts.map((c) => ({ ...c, reason: 'filler' as const })) }
}

// ---------------------------------------------------------------- silence

export interface SilenceOptions {
  /** Level under which sound counts as silence, dBFS (RMS over `window`). Default −45. */
  threshold?: number
  /** Shortest silence reported, seconds. Default 0.5. */
  minDuration?: number
  /** Analysis window, seconds. Default 0.005 (well under a frame). */
  window?: number
}

/** Silent spans [start, end) in seconds. */
export function detectSilences(channels: Float32Array[], sampleRate: number, opts: SilenceOptions = {}): [number, number][] {
  const x = downmix(channels)
  const thr = Math.pow(10, (opts.threshold ?? -45) / 20)
  const thr2 = thr * thr
  const win = Math.max(1, Math.round((opts.window ?? 0.005) * sampleRate))
  const minDur = opts.minDuration ?? 0.5
  const out: [number, number][] = []
  let runStart = -1
  const blocks = Math.ceil(x.length / win)
  for (let b = 0; b <= blocks; b++) {
    let quiet = false
    if (b < blocks) {
      let s = 0
      const a = b * win
      const e = Math.min(x.length, a + win)
      for (let i = a; i < e; i++) s += x[i] * x[i]
      quiet = s / (e - a) < thr2
    }
    if (quiet && runStart < 0) runStart = b
    if (!quiet && runStart >= 0) {
      const s = (runStart * win) / sampleRate
      const e = Math.min(x.length, b * win) / sampleRate
      if (e - s >= minDur) out.push([s, e])
      runStart = -1
    }
  }
  return out
}

/** Silences → proposed cuts: each shrunk by `handle` at both ends (a breath of room tone stays), frame-snapped. */
export function silenceCuts(silences: [number, number][], opts: CutOptions): EditProposal {
  const handle = opts.handle ?? 0.1
  const minLen = opts.minLength ?? 1 / opts.fps
  const cuts: ProposedCut[] = []
  for (const [s, e] of silences) {
    const a = snapToFrame(s + handle, opts.fps)
    const b = snapToFrame(e - handle, opts.fps)
    if (b - a >= minLen - 1e-9) cuts.push({ start: a, end: b, reason: 'silence', label: `silence ${(e - s).toFixed(2)} s` })
  }
  return { kind: 'proposal', applied: false, source: 'detector', cuts: mergeCuts(cuts) }
}
