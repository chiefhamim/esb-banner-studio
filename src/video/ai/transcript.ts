// The transcript model shared by transcription, text-based editing, captions and the highlight finder: timed words
// (text, start, end, confidence, speaker) grouped into segments, with where it came from. An AI transcript is a DRAFT
// (non-negotiable 2) until the editor marks it reviewed. Captions: SRT / WebVTT export with correct timecodes, at most
// 42 characters a line and 2 lines a cue, wrapped by grapheme clusters (Intl.Segmenter) so a Bangla conjunct or a
// vowel sign is never split from its consonant; and import of either format.

export interface Word {
  text: string
  /** Seconds from the start of the media. */
  start: number
  end: number
  /** 0..1 as the engine reported it (1 for typed or imported text). */
  confidence: number
  speaker?: string
  /** Timing spread evenly over a caption by import, not measured. */
  estimated?: boolean
}

export interface Segment {
  start: number
  end: number
  text: string
  /** Words [from, to) of the transcript. */
  from: number
  to: number
  speaker?: string
}

export type TranscriptOrigin =
  | { kind: 'ai'; engine: string; model: string; at: number }
  | { kind: 'local'; engine: string; model: string; at: number }
  | { kind: 'import'; format: 'srt' | 'vtt'; at: number }
  | { kind: 'typed'; at: number }

export interface Transcript {
  /** BCP-47 tag as detected or chosen ('bn', 'en', …); '' when unknown. */
  lang: string
  duration: number
  words: Word[]
  segments: Segment[]
  origin: TranscriptOrigin
  /** True for anything a machine produced, until the editor reviews it. */
  draft: boolean
  reviewed: boolean
}

/** The label every surface shows on a machine transcript that is not reviewed yet. */
export const AI_DRAFT_LABEL = 'AI transcript — draft, check before use'

// ---------------------------------------------------------------- graphemes

let seg: Intl.Segmenter | null = null
/** Grapheme clusters of a string (a Bangla conjunct with its vowel signs is one or a few clusters, never cut inside). */
export function graphemes(s: string): string[] {
  seg ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  return Array.from(seg.segment(s), (x) => x.segment)
}
export const glen = (s: string) => graphemes(s).length

// ---------------------------------------------------------------- segments

/** Sentence-ending punctuation: . ! ? … and the Bangla danda । (and double danda ॥), before closing quotes/brackets. */
export const SENTENCE_END = /[.!?…।॥][\s"'”’»)\]]*$/u
export const isSentenceEnd = (w: string) => SENTENCE_END.test(w)

/** Group words into segments: a new one after a sentence end, a pause over `maxGap` or a change of speaker. */
export function buildSegments(words: Word[], opts: { maxGap?: number } = {}): Segment[] {
  const maxGap = opts.maxGap ?? 1
  const out: Segment[] = []
  let from = 0
  const close = (to: number) => {
    if (to <= from) return
    const ws = words.slice(from, to)
    out.push({ start: ws[0].start, end: ws[ws.length - 1].end, text: ws.map((w) => w.text).join(' '), from, to, ...(ws[0].speaker ? { speaker: ws[0].speaker } : {}) })
    from = to
  }
  for (let i = 0; i < words.length; i++) {
    if (i > from) {
      const prev = words[i - 1]
      if (words[i].start - prev.end > maxGap || words[i].speaker !== prev.speaker) close(i)
    }
    if (isSentenceEnd(words[i].text)) close(i + 1)
  }
  close(words.length)
  return out
}

export function makeTranscript(words: Word[], origin: TranscriptOrigin, opts: { lang?: string; duration?: number } = {}): Transcript {
  const machine = origin.kind === 'ai' || origin.kind === 'local'
  return {
    lang: opts.lang ?? '',
    duration: opts.duration ?? (words.length ? words[words.length - 1].end : 0),
    words,
    segments: buildSegments(words),
    origin,
    draft: machine,
    reviewed: !machine,
  }
}

// ---------------------------------------------------------------- caption cues

export interface Cue { start: number; end: number; lines: string[] }

export interface CueOptions {
  /** Most grapheme clusters on a line. Default 42. */
  maxChars?: number
  /** Most lines in a cue. Default 2. */
  maxLines?: number
  /** Longest cue, seconds. Default 7. */
  maxDuration?: number
  /** Shortest cue, seconds (extended into silence when there is room). Default 0.8. */
  minDuration?: number
  /** A pause longer than this starts a new cue. Default 1. */
  maxGap?: number
}

/** Split one over-long word into pieces of at most `max` grapheme clusters. */
function splitLong(text: string, max: number): string[] {
  const g = graphemes(text)
  if (g.length <= max) return [text]
  const out: string[] = []
  for (let i = 0; i < g.length; i += max) out.push(g.slice(i, i + max).join(''))
  return out
}

/** Wrap tokens into lines of at most `max` clusters; two-line results are balanced (the break nearest the middle). */
export function wrapLines(tokens: string[], max: number, maxLines = 2): string[] | null {
  const lines: string[] = []
  let cur = ''
  for (const t of tokens) {
    const next = cur ? cur + ' ' + t : t
    if (glen(next) <= max) { cur = next; continue }
    if (cur) lines.push(cur)
    cur = t
    if (glen(t) > max) return null
  }
  if (cur) lines.push(cur)
  if (lines.length > maxLines) return null
  if (lines.length === 2) {
    // balance: try every break and keep the most even one that fits
    let best = lines
    let bestDiff = Math.abs(glen(lines[0]) - glen(lines[1]))
    for (let k = 1; k < tokens.length; k++) {
      const a = tokens.slice(0, k).join(' ')
      const b = tokens.slice(k).join(' ')
      const la = glen(a)
      const lb = glen(b)
      if (la <= max && lb <= max && Math.abs(la - lb) < bestDiff) { best = [a, b]; bestDiff = Math.abs(la - lb) }
    }
    return best
  }
  return lines
}

/** Caption cues from timed words. */
export function buildCues(words: Word[], opts: CueOptions = {}): Cue[] {
  const max = opts.maxChars ?? 42
  const maxLines = opts.maxLines ?? 2
  const maxDur = opts.maxDuration ?? 7
  const minDur = opts.minDuration ?? 0.8
  const maxGap = opts.maxGap ?? 1
  // over-long words become several timed pieces
  const toks: Word[] = []
  for (const w of words) {
    const parts = splitLong(w.text, max)
    if (parts.length === 1) { toks.push(w); continue }
    const total = glen(w.text)
    let t = w.start
    for (const p of parts) {
      const d = ((w.end - w.start) * glen(p)) / total
      toks.push({ ...w, text: p, start: t, end: t + d })
      t += d
    }
  }
  const cues: Cue[] = []
  let cur: Word[] = []
  const flush = () => {
    if (!cur.length) return
    const lines = wrapLines(cur.map((w) => w.text), max, maxLines)!
    cues.push({ start: cur[0].start, end: cur[cur.length - 1].end, lines })
    cur = []
  }
  for (const w of toks) {
    if (cur.length) {
      const prev = cur[cur.length - 1]
      const tooLong = w.end - cur[0].start > maxDur
      const gap = w.start - prev.end > maxGap
      const speaker = w.speaker !== prev.speaker
      if (tooLong || gap || speaker || !wrapLines([...cur, w].map((x) => x.text), max, maxLines)) flush()
    }
    cur.push(w)
    if (isSentenceEnd(w.text)) flush()
  }
  flush()
  // minimum duration where the gap allows; never overlap the next cue
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i]
    const limit = i + 1 < cues.length ? cues[i + 1].start : Infinity
    if (c.end - c.start < minDur) c.end = Math.min(limit, c.start + minDur)
    if (c.end > limit) c.end = limit
    if (c.end <= c.start) c.end = c.start + 0.001
  }
  return cues
}

// ---------------------------------------------------------------- SRT / VTT

/** 3725.5 → "01:02:05,500" (SRT) or "01:02:05.500" (VTT). */
export function timecode(t: number, sep: ',' | '.' = ','): string {
  const ms = Math.max(0, Math.round(t * 1000))
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const r = ms % 1000
  const p = (v: number, n = 2) => String(v).padStart(n, '0')
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(r, 3)}`
}

export function toSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${timecode(c.start)} --> ${timecode(c.end)}\n${c.lines.join('\n')}\n`).join('\n')
}

export function toVtt(cues: Cue[]): string {
  return 'WEBVTT\n\n' + cues.map((c) => `${timecode(c.start, '.')} --> ${timecode(c.end, '.')}\n${c.lines.join('\n')}\n`).join('\n')
}

/** "01:02:05,500", "01:02:05.500" or VTT's short "02:05.500" → seconds; NaN if malformed. */
export function parseTimecode(s: string): number {
  const m = s.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})$/)
  if (!m) return NaN
  return (Number(m[1] ?? 0) * 3600) + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000
}

/** Read SRT or WebVTT (BOM, CRLF, cue numbers / ids, VTT settings, NOTE/STYLE blocks and inline tags tolerated). */
export function parseCaptions(text: string): { format: 'srt' | 'vtt'; cues: Cue[] } {
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const format = /^WEBVTT/.test(src) ? 'vtt' : 'srt'
  const cues: Cue[] = []
  for (const block of src.split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l) => l.length)
    const ti = lines.findIndex((l) => l.includes('-->'))
    if (ti < 0) continue
    const [a, rest] = lines[ti].split('-->')
    const start = parseTimecode(a)
    const end = parseTimecode(rest.trim().split(/\s+/)[0])
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue
    const body = lines.slice(ti + 1).map((l) => l.replace(/<[^>]*>/g, '').trim()).filter(Boolean)
    if (body.length) cues.push({ start, end, lines: body })
  }
  return { format, cues }
}

/** Words from imported cues: each cue's text split at spaces, its time spread by grapheme length (marked estimated). */
export function cuesToWords(cues: Cue[]): Word[] {
  const out: Word[] = []
  for (const c of cues) {
    const toks = c.lines.join(' ').split(/\s+/).filter(Boolean)
    const total = toks.reduce((n, t) => n + glen(t), 0) || 1
    let t = c.start
    for (const tok of toks) {
      const d = ((c.end - c.start) * glen(tok)) / total
      out.push({ text: tok, start: round3(t), end: round3(t + d), confidence: 1, estimated: true })
      t += d
    }
  }
  return out
}

export function importCaptions(text: string, at = Date.now()): Transcript {
  const { format, cues } = parseCaptions(text)
  return makeTranscript(cuesToWords(cues), { kind: 'import', format, at })
}

const round3 = (v: number) => Math.round(v * 1000) / 1000
