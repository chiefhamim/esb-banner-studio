// Transcription engines behind one interface. Gemini (audio as inlineData through the existing AI layer, on the
// editor's own key) is implemented; a local whisper.cpp engine has its interface and an honest "not installed" state
// only. Every result is a DRAFT marked as AI (non-negotiable 2): Phase 5 shows it in a review panel before anything
// reaches the timeline. With AI paused (`aiPaused()`), nothing is sent and the engine says so.
//
// Long audio is cut into chunks (≤ 10 min, and small enough that the WAV fits Gemini's inline request limit), each
// overlapping the next by a few seconds; the words of each overlap are taken from whichever chunk has that moment
// nearer its middle. A chunk whose timings are out of order or run past its length is REJECTED (asked again once),
// never silently repaired: the result says which stretch has no transcript.

import type { AiJsonRequest, AiSchema } from '../../editorial/aiProviders'
import { downmix } from '../audio/fft'
import { makeTranscript } from './transcript'
import type { Transcript, Word } from './transcript'

export interface AudioInput { channels: Float32Array[]; sampleRate: number }

export type EngineState =
  | { state: 'ready'; detail: string }
  | { state: 'off'; why: string }
  | { state: 'no-key'; why: string }
  | { state: 'not-installed'; why: string }

export interface ChunkReport {
  start: number
  end: number
  state: 'ok' | 'rejected' | 'failed'
  /** Why a chunk was rejected or failed (validation problems or the error text). */
  why?: string
  words: number
  attempts: number
}

export interface TranscriptionResult {
  transcript: Transcript
  chunks: ChunkReport[]
  /** Every chunk came back valid. */
  complete: boolean
}

export interface TranscribeOptions {
  /** Language spoken: 'bn', 'en' or 'auto' (default). */
  lang?: 'bn' | 'en' | 'auto'
  signal?: AbortSignal
  onProgress?: (done: number, total: number) => void
  /** Longest chunk, seconds (default: 10 min, or less so the WAV fits the inline limit — about 5.4 min). */
  maxChunkSec?: number
}

export interface TranscriptionEngine {
  id: 'gemini' | 'whisper-local'
  label: string
  /** Runs on this PC (nothing leaves it). */
  local: boolean
  status(): Promise<EngineState>
  transcribe(audio: AudioInput, opts?: TranscribeOptions): Promise<TranscriptionResult>
}

// ---------------------------------------------------------------- audio → WAV → base64

/** Resample mono PCM (windowed-sinc low-pass when going down, then linear interpolation). */
export function resample(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return x
  let src = x
  if (to < from) {
    const fc = (0.45 * to) / from // cut-off as a fraction of the source rate
    const half = 24
    const h = new Float64Array(2 * half + 1)
    let sum = 0
    for (let k = -half; k <= half; k++) {
      const s = k === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * k) / (Math.PI * k)
      const w = 0.42 + 0.5 * Math.cos((Math.PI * k) / half) + 0.08 * Math.cos((2 * Math.PI * k) / half)
      h[k + half] = s * w
      sum += h[k + half]
    }
    src = new Float32Array(x.length)
    for (let i = 0; i < x.length; i++) {
      let acc = 0
      for (let k = -half; k <= half; k++) { const j = i + k; if (j >= 0 && j < x.length) acc += x[j] * h[k + half] }
      src[i] = acc / sum
    }
  }
  const n = Math.floor((x.length * to) / from)
  const out = new Float32Array(n)
  const r = from / to
  for (let i = 0; i < n; i++) {
    const p = i * r
    const j = Math.floor(p)
    const f = p - j
    out[i] = (src[j] ?? 0) * (1 - f) + (src[j + 1] ?? src[j] ?? 0) * f
  }
  return out
}

/** 16-bit PCM mono WAV. */
export function encodeWav(x: Float32Array, sampleRate: number): Uint8Array {
  const buf = new ArrayBuffer(44 + x.length * 2)
  const dv = new DataView(buf)
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); dv.setUint32(4, 36 + x.length * 2, true); str(8, 'WAVE')
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true)
  dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true)
  str(36, 'data'); dv.setUint32(40, x.length * 2, true)
  for (let i = 0; i < x.length; i++) dv.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), true)
  return new Uint8Array(buf)
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
export function base64(bytes: Uint8Array): string {
  const parts: string[] = []
  let line = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    line += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)] + (b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]) + (c === undefined ? '=' : B64[c & 63])
    if (line.length >= 65536) { parts.push(line); line = '' }
  }
  parts.push(line)
  return parts.join('')
}

// ---------------------------------------------------------------- chunks

/** Transcription sample rate (speech needs no more) and the inline request budget Gemini allows (~20 MB). */
export const TRANSCRIBE_RATE = 16000
export const MAX_INLINE_BASE64 = 14 * 1024 * 1024
export const MAX_CHUNK_SEC = 600
export const CHUNK_OVERLAP_SEC = 4

/** Chunk windows over `duration`: each ≤ maxSec, overlapping the next by `overlap`. */
export function planChunks(duration: number, opts: { maxSec?: number; overlap?: number } = {}): { start: number; end: number }[] {
  const max = opts.maxSec ?? MAX_CHUNK_SEC
  const ov = Math.min(opts.overlap ?? CHUNK_OVERLAP_SEC, max / 4)
  if (duration <= max) return [{ start: 0, end: duration }]
  const n = Math.ceil((duration - ov) / (max - ov))
  const step = (duration - ov) / n // equal chunks, each ov + step ≤ max long
  return Array.from({ length: n }, (_, i) => ({ start: round3(i * step), end: round3(Math.min(duration, i * step + step + ov)) }))
}

/** Longest chunk whose 16-bit 16 kHz mono WAV fits the inline budget as base64. */
export const chunkSecForBudget = (budget = MAX_INLINE_BASE64, rate = TRANSCRIBE_RATE) => Math.min(MAX_CHUNK_SEC, Math.floor(((budget / 4) * 3 - 44) / (rate * 2)))

/** Keep the words of each chunk whose midpoint lies in its own share (cut at the middle of each overlap). */
export function stitchChunks(chunks: { start: number; end: number; words: Word[] | null }[]): Word[] {
  const out: Word[] = []
  chunks.forEach((c, i) => {
    if (!c.words) return
    const lo = i > 0 ? (chunks[i - 1].end + c.start) / 2 : -Infinity
    const hi = i + 1 < chunks.length ? (c.end + chunks[i + 1].start) / 2 : Infinity
    for (const w of c.words) { const m = (w.start + w.end) / 2; if (m >= lo && m < hi) out.push(w) }
  })
  return out
}

// ---------------------------------------------------------------- prompt, parse, validate

export const TRANSCRIBE_SYSTEM = `You are a verbatim transcriber for a newsroom. The attached audio is an interview, a speech or a report, in Bangla, English or both.

Rules:
- Write down exactly what is said, word for word, in the language spoken: Bangla in Bangla script (Unicode), English in English. Never translate.
- Do not summarise, correct grammar, reorder, or tidy the speech. Keep hesitations and fillers as spoken (um, uh, উম, মানে, আসলে).
- Never add a word that is not in the audio. If a word cannot be made out, write [inaudible] in its place with confidence 0.
- Times are seconds from the start of THIS audio, with millisecond precision; words are in the order spoken and never overlap.
- If there is no speech, return an empty "words" field.`

export const TRANSCRIBE_SCHEMA: AiSchema = {
  type: 'object',
  properties: {
    language: { type: 'string', description: 'Main language spoken: "bn", "en" or "mixed".' },
    words: { type: 'string', description: 'One spoken word per line, in order, five fields separated by a TAB: start seconds, end seconds, confidence 0-1, speaker label (S1, S2… or empty), the word with its punctuation attached.' },
  },
  required: ['language', 'words'],
}

export function transcribeUserPrompt(chunk: { start: number; end: number }, lang: TranscribeOptions['lang']) {
  const l = lang === 'bn' ? 'The speech is mainly Bangla.' : lang === 'en' ? 'The speech is mainly English.' : 'Detect the language yourself.'
  return `Transcribe this audio verbatim with word timings. It is ${(chunk.end - chunk.start).toFixed(1)} seconds long. ${l}`
}

/** "start\tend\tconf\tspeaker\tword" lines → words, offset by the chunk start. Lines that do not parse are reported. */
export function parseWordLines(text: string, offset = 0): { words: Word[]; bad: number } {
  const words: Word[] = []
  let bad = 0
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const f = line.split('\t')
    if (f.length < 5) { bad++; continue }
    const [s, e, c, sp] = f
    const word = f.slice(4).join(' ').trim()
    const start = Number(s)
    const end = Number(e)
    const conf = Number(c)
    if (!word || !Number.isFinite(start) || !Number.isFinite(end)) { bad++; continue }
    words.push({ text: word, start: round3(start + offset), end: round3(end + offset), confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0, ...(sp.trim() ? { speaker: sp.trim() } : {}) })
  }
  return { words, bad }
}

/** Problems with a chunk's words (relative to the chunk: 0..duration). Empty = valid. */
export function validateWords(words: Word[], duration: number, opts: { tolerance?: number } = {}): string[] {
  const tol = opts.tolerance ?? 0.25
  const out: string[] = []
  let prevStart = -Infinity
  let prevEnd = -Infinity
  words.forEach((w, i) => {
    const at = `word ${i + 1} "${w.text}"`
    if (!(w.start >= 0)) out.push(`${at} starts before 0`)
    if (!(w.end >= w.start)) out.push(`${at} ends before it starts`)
    if (w.end > duration + tol) out.push(`${at} ends at ${w.end.toFixed(2)} s, past the audio's ${duration.toFixed(2)} s`)
    if (w.start < prevStart - 0.05) out.push(`${at} is out of order (starts ${w.start.toFixed(2)} s, before the previous word)`)
    if (w.start < prevEnd - tol) out.push(`${at} overlaps the previous word`)
    prevStart = Math.max(prevStart, w.start)
    prevEnd = Math.max(prevEnd, w.end)
  })
  return out
}

// ---------------------------------------------------------------- Gemini engine

export interface GeminiDeps {
  paused: () => boolean
  /** The Gemini key and model to use, or null (no key). */
  gemini: () => { key: string; model: string } | null
  /** One structured call (aiJson). */
  call: (req: AiJsonRequest) => Promise<{ data: Record<string, unknown>; model: string }>
  /** 'auto' → a real model id. */
  resolve: (key: string, model: string) => Promise<string>
}

async function defaultDeps(): Promise<GeminiDeps> {
  const ai = await import('../../editorial/aiProviders')
  return {
    paused: ai.aiPaused,
    gemini: () => {
      const s = ai.loadAiSettings()
      if (s.paused) return null
      const main = ai.aiFor('main', s)
      if (main?.provider === 'gemini') return { key: main.key, model: main.model }
      const key = s.keys.gemini?.trim()
      return key ? { key, model: s.models.gemini || 'auto' } : null
    },
    call: (req) => ai.aiJson(req),
    resolve: async (key, model) => {
      let listed: Awaited<ReturnType<typeof ai.listModels>> = []
      try { listed = await ai.listModels('gemini', key) } catch { /* the call reports the real error */ }
      return ai.resolveModel('gemini', model, listed)
    },
  }
}

export const AI_OFF = 'AI is OFF. Transcription by Gemini sends the audio to Google, so it waits until AI is turned on.'
export const NO_GEMINI = 'Transcription needs a Gemini key (Gemini listens to audio; the other providers here cannot). Add one in the AI dialog.'

export function geminiEngine(override: Partial<GeminiDeps> = {}): TranscriptionEngine {
  const deps = async (): Promise<GeminiDeps> => (override.paused && override.gemini && override.call && override.resolve ? (override as GeminiDeps) : { ...(await defaultDeps()), ...override })
  return {
    id: 'gemini',
    label: 'Gemini (cloud, your key)',
    local: false,
    async status() {
      const d = await deps()
      if (d.paused()) return { state: 'off', why: AI_OFF }
      return d.gemini() ? { state: 'ready', detail: 'Audio is sent to Google Gemini with your key.' } : { state: 'no-key', why: NO_GEMINI }
    },
    async transcribe(audio, opts = {}) {
      const d = await deps()
      if (d.paused()) throw new Error(AI_OFF)
      const g = d.gemini()
      if (!g) throw new Error(NO_GEMINI)
      const mono = resample(downmix(audio.channels), audio.sampleRate, TRANSCRIBE_RATE)
      const duration = mono.length / TRANSCRIBE_RATE
      const plan = planChunks(duration, { maxSec: Math.min(chunkSecForBudget(), opts.maxChunkSec ?? MAX_CHUNK_SEC) })
      const model = await d.resolve(g.key, g.model)
      const results: { start: number; end: number; words: Word[] | null }[] = []
      const reports: ChunkReport[] = []
      let lang = ''
      for (let i = 0; i < plan.length; i++) {
        if (opts.signal?.aborted) throw new Error('Transcription was cancelled')
        if (d.paused()) throw new Error(AI_OFF) // switched off mid-way: stop sending
        const c = plan[i]
        const pcm = mono.subarray(Math.round(c.start * TRANSCRIBE_RATE), Math.round(c.end * TRANSCRIBE_RATE))
        const data = base64(encodeWav(pcm, TRANSCRIBE_RATE))
        const report: ChunkReport = { start: c.start, end: c.end, state: 'failed', words: 0, attempts: 0 }
        let words: Word[] | null = null
        for (let attempt = 0; attempt < 2 && !words; attempt++) {
          report.attempts++
          try {
            const { data: out } = await d.call({
              provider: 'gemini', key: g.key, model,
              system: TRANSCRIBE_SYSTEM,
              user: transcribeUserPrompt(c, opts.lang),
              attachment: { mime: 'audio/wav', data },
              schema: TRANSCRIBE_SCHEMA,
              maxTokens: 60000,
              timeoutMs: 300_000,
              signal: opts.signal,
            })
            const parsed = parseWordLines(String(out.words ?? ''), 0)
            const problems = validateWords(parsed.words, c.end - c.start)
            if (parsed.bad) problems.unshift(`${parsed.bad} line(s) were not "start, end, confidence, speaker, word"`)
            if (problems.length) { report.state = 'rejected'; report.why = problems.slice(0, 5).join('; ') + (problems.length > 5 ? ` (+${problems.length - 5} more)` : ''); continue }
            words = parsed.words.map((w) => ({ ...w, start: round3(w.start + c.start), end: round3(w.end + c.start) }))
            if (!lang && typeof out.language === 'string') lang = out.language
          } catch (e) {
            if (opts.signal?.aborted) throw e
            report.state = 'failed'
            report.why = (e as Error).message
          }
        }
        if (words) { report.state = 'ok'; report.why = undefined; report.words = words.length }
        results.push({ start: c.start, end: c.end, words })
        reports.push(report)
        opts.onProgress?.(i + 1, plan.length)
      }
      const words = stitchChunks(results)
      const transcript = makeTranscript(words, { kind: 'ai', engine: 'gemini', model, at: Date.now() }, { lang: lang === 'mixed' ? '' : lang, duration })
      return { transcript, chunks: reports, complete: reports.every((r) => r.state === 'ok') }
    },
  }
}

// ---------------------------------------------------------------- local whisper.cpp (interface only)

/** Where a local whisper.cpp install would be found (main process, Phase 5). */
export interface WhisperInstall { binary: string; model: string }

export const WHISPER_NOT_INSTALLED = 'Local transcription (whisper.cpp) is not installed on this PC. It is planned: once the owner installs whisper.cpp and a model, transcripts can be made without sending audio anywhere.'

/** The local engine. `probe` asks main whether whisper.cpp and a model are installed; until Phase 5 wires that, it is
 * always "not installed" and transcribe() refuses — never a fake result. */
export function whisperCppEngine(probe: () => Promise<WhisperInstall | null> = async () => null): TranscriptionEngine {
  return {
    id: 'whisper-local',
    label: 'whisper.cpp (on this PC)',
    local: true,
    async status() {
      const found = await probe()
      return found ? { state: 'not-installed', why: 'whisper.cpp was found, but running it is not built yet (planned).' } : { state: 'not-installed', why: WHISPER_NOT_INSTALLED }
    },
    async transcribe() {
      throw new Error(WHISPER_NOT_INSTALLED)
    },
  }
}

const round3 = (v: number) => Math.round(v * 1000) / 1000
