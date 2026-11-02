// Highlight finder: proposes 15–60 s Short candidates from a long interview's transcript. Deterministic first:
// windows that start and end on sentence boundaries, scored by completeness (a whole thought, not starting on "and…"),
// speech density, absence of fillers, confidence and length. An optional AI rerank (behind aiFor, respecting
// aiPaused) may only REORDER the existing candidates by id — it never writes or changes their text or times
// (non-negotiable 1). The editor picks; nothing is cut or published by this module.

import type { AiJsonRequest, AiSchema } from '../../editorial/aiProviders'
import { findFillers } from './textEdit'
import { isSentenceEnd } from './transcript'
import type { Word } from './transcript'

export interface Sentence { from: number; to: number; start: number; end: number; complete: boolean }

/** Sentences: split after terminal punctuation (. ! ? । …) or a pause over `maxGap`. */
export function sentences(words: Word[], opts: { maxGap?: number } = {}): Sentence[] {
  const gap = opts.maxGap ?? 1.2
  const out: Sentence[] = []
  let from = 0
  for (let i = 0; i < words.length; i++) {
    const end = isSentenceEnd(words[i].text)
    const pause = i + 1 < words.length && words[i + 1].start - words[i].end > gap
    if (end || pause || i === words.length - 1) {
      out.push({ from, to: i + 1, start: words[from].start, end: words[i].end, complete: end })
      from = i + 1
    }
  }
  return out
}

const CONTINUATIONS = new Set(['and', 'but', 'so', 'because', 'or', 'which', 'that', 'then', 'also', 'এবং', 'কিন্তু', 'তাই', 'আর', 'যে', 'তবে', 'কারণ', 'ফলে', 'তাহলে'])
const firstWord = (s: string) => s.normalize('NFC').toLocaleLowerCase().replace(/[\p{P}\p{S}]/gu, '')

export interface HighlightScore { completeness: number; density: number; fillers: number; confidence: number; length: number }

export interface HighlightCandidate {
  /** Stable id within one run ("h1", "h2", … in heuristic order). */
  id: string
  start: number
  end: number
  /** Words [from, to). */
  from: number
  to: number
  /** The transcript's own words, joined — never rewritten. */
  text: string
  score: number
  parts: HighlightScore
}

export interface HighlightOptions {
  minSec?: number
  maxSec?: number
  /** Lengths that score full marks. Default [25, 45]. */
  ideal?: [number, number]
  /** How many to return. Default 8. */
  top?: number
  /** Highest overlap (intersection over the shorter) two returned candidates may share. Default 0.3. */
  maxOverlap?: number
}

export function scoreWindow(words: Word[], from: number, to: number, complete: boolean, opts: Required<Pick<HighlightOptions, 'minSec' | 'maxSec' | 'ideal'>>): { score: number; parts: HighlightScore } {
  const ws = words.slice(from, to)
  const dur = ws[ws.length - 1].end - ws[0].start
  const speech = ws.reduce((s, w) => s + Math.max(0, w.end - w.start), 0)
  const startsClean = !CONTINUATIONS.has(firstWord(ws[0].text))
  const completeness = (complete ? 0.6 : 0) + (startsClean ? 0.4 : 0)
  const density = 0.5 * Math.min(1, speech / Math.max(1e-6, dur)) + 0.5 * Math.min(1, ws.length / dur / 2.5)
  const fill = findFillers(ws).reduce((n, f) => n + (f.kind === 'hesitation' ? 1 : 0.5) * (f.to - f.from), 0)
  const fillers = 1 - Math.min(1, (fill / ws.length) * 10)
  const confidence = ws.reduce((s, w) => s + w.confidence, 0) / ws.length
  const [a, b] = opts.ideal
  const length = dur >= a && dur <= b ? 1 : dur < a ? 0.5 + (0.5 * (dur - opts.minSec)) / Math.max(1e-6, a - opts.minSec) : 0.5 + (0.5 * (opts.maxSec - dur)) / Math.max(1e-6, opts.maxSec - b)
  const parts = { completeness, density, fillers, confidence, length: Math.max(0, Math.min(1, length)) }
  const score = 0.35 * parts.completeness + 0.25 * parts.density + 0.2 * parts.fillers + 0.1 * parts.confidence + 0.1 * parts.length
  return { score: Math.round(score * 10000) / 10000, parts }
}

export function findHighlights(words: Word[], opts: HighlightOptions = {}): HighlightCandidate[] {
  const o = { minSec: opts.minSec ?? 15, maxSec: opts.maxSec ?? 60, ideal: opts.ideal ?? [25, 45] as [number, number] }
  const top = opts.top ?? 8
  const maxOv = opts.maxOverlap ?? 0.3
  const sent = sentences(words)
  const all: Omit<HighlightCandidate, 'id'>[] = []
  for (let i = 0; i < sent.length; i++) {
    for (let j = i; j < sent.length; j++) {
      const dur = sent[j].end - sent[i].start
      if (dur > o.maxSec) break
      if (dur < o.minSec) continue
      const from = sent[i].from
      const to = sent[j].to
      const { score, parts } = scoreWindow(words, from, to, sent[j].complete, o)
      all.push({ start: sent[i].start, end: sent[j].end, from, to, text: words.slice(from, to).map((w) => w.text).join(' '), score, parts })
    }
  }
  all.sort((a, b) => b.score - a.score || a.start - b.start || a.end - b.end)
  const kept: Omit<HighlightCandidate, 'id'>[] = []
  for (const c of all) {
    if (kept.length >= top) break
    const clash = kept.some((k) => {
      const inter = Math.max(0, Math.min(k.end, c.end) - Math.max(k.start, c.start))
      return inter / Math.min(k.end - k.start, c.end - c.start) > maxOv
    })
    if (!clash) kept.push(c)
  }
  return kept.map((c, i) => ({ id: `h${i + 1}`, ...c }))
}

// ---------------------------------------------------------------- optional AI rerank

export interface RerankDeps {
  paused: () => boolean
  ai: () => { provider: AiJsonRequest['provider']; key: string; model: string } | null
  call: (req: AiJsonRequest) => Promise<{ data: Record<string, unknown>; model: string }>
  resolve: (provider: AiJsonRequest['provider'], key: string, model: string) => Promise<string>
}

export interface RerankResult {
  candidates: HighlightCandidate[]
  rankedBy: 'heuristic' | 'ai'
  state: 'ok' | 'off' | 'no-key' | 'failed'
  why?: string
  /** The AI's one-line reason, shown as AI text (draft) next to the order. */
  note?: string
  model?: string
}

export const RERANK_SCHEMA: AiSchema = {
  type: 'object',
  properties: {
    order: { type: 'string', description: 'Every candidate id, best first, separated by commas (e.g. "h3,h1,h2"). Ids only.' },
    why: { type: 'string', description: 'One short sentence on why the first one is strongest.' },
  },
  required: ['order', 'why'],
}

export const RERANK_SYSTEM = `You are a video producer at an energy newsroom choosing which interview excerpt makes the strongest short vertical video. You are given candidate excerpts, each with an id and the speaker's exact words. Rank them: a clear, complete, self-contained statement that a viewer understands without context ranks highest. Use only the ids given. Do not rewrite, quote differently or add anything.`

/** Apply an AI order to candidates: unknown ids dropped, repeats ignored, any id the AI left out kept in its original
 * place after the ranked ones. The candidates themselves (text, times, score) are never changed. */
export function applyOrder(cands: HighlightCandidate[], order: string): HighlightCandidate[] {
  const byId = new Map(cands.map((c) => [c.id, c]))
  const seen = new Set<string>()
  const out: HighlightCandidate[] = []
  for (const raw of order.split(/[\s,;]+/)) {
    const id = raw.trim().replace(/^["'[(]+|["')\].]+$/g, '').toLowerCase()
    const c = byId.get(id)
    if (c && !seen.has(id)) { seen.add(id); out.push(c) }
  }
  for (const c of cands) if (!seen.has(c.id)) out.push(c)
  return out
}

async function defaultRerankDeps(): Promise<RerankDeps> {
  const ai = await import('../../editorial/aiProviders')
  return {
    paused: ai.aiPaused,
    ai: () => ai.aiFor('main'),
    call: (req) => ai.aiJson(req),
    resolve: async (provider, key, model) => {
      let listed: Awaited<ReturnType<typeof ai.listModels>> = []
      try { listed = await ai.listModels(provider, key) } catch { /* the call reports the real error */ }
      return ai.resolveModel(provider, model, listed)
    },
  }
}

export async function rerankHighlights(cands: HighlightCandidate[], opts: { context?: string; signal?: AbortSignal; deps?: Partial<RerankDeps> } = {}): Promise<RerankResult> {
  const base = (r: Partial<RerankResult>): RerankResult => ({ candidates: cands, rankedBy: 'heuristic', state: 'ok', ...r })
  if (cands.length < 2) return base({})
  const given = opts.deps ?? {}
  const d: RerankDeps = given.paused && given.ai && given.call && given.resolve ? (given as RerankDeps) : { ...(await defaultRerankDeps()), ...given }
  if (d.paused()) return base({ state: 'off', why: 'AI is OFF: the candidates keep their own order.' })
  const ai = d.ai()
  if (!ai) return base({ state: 'no-key', why: 'No AI key for the main job: the candidates keep their own order.' })
  try {
    const model = await d.resolve(ai.provider, ai.key, ai.model)
    const list = cands.map((c) => `[${c.id}] (${(c.end - c.start).toFixed(0)} s) ${c.text}`).join('\n\n')
    const { data } = await d.call({
      provider: ai.provider, key: ai.key, model,
      system: RERANK_SYSTEM,
      user: (opts.context ? `The story: ${opts.context}\n\n` : '') + `Candidates:\n\n${list}`,
      schema: RERANK_SCHEMA,
      maxTokens: 2000,
      effort: 'low',
      signal: opts.signal,
    })
    return { candidates: applyOrder(cands, String(data.order ?? '')), rankedBy: 'ai', state: 'ok', note: typeof data.why === 'string' ? data.why.slice(0, 300) : undefined, model }
  } catch (e) {
    return base({ state: 'failed', why: (e as Error).message })
  }
}
