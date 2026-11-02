// One structured text call for the Video desk's AI jobs (caption translation, video copy). Same rules as the rest of
// the app: nothing leaves the PC while AI is paused, the editor's own key and provider (the Main job), a clear message
// when there is no key. Injectable for tests.
import type { AiJsonRequest, AiSchema } from '../../editorial/aiProviders'

export const TEXT_AI_OFF = 'AI is OFF. This job sends the text to your AI provider, so it waits until AI is turned on.'
export const TEXT_AI_NO_KEY = 'This job needs an AI key. Add one in the AI dialog.'

export interface TextAiDeps {
  paused: () => boolean
  pick: () => { provider: AiJsonRequest['provider']; key: string; model: string } | null
  call: (req: AiJsonRequest) => Promise<{ data: Record<string, unknown>; model: string }>
  resolve: (provider: AiJsonRequest['provider'], key: string, model: string) => Promise<string>
}

async function defaultDeps(): Promise<TextAiDeps> {
  const ai = await import('../../editorial/aiProviders')
  return {
    paused: ai.aiPaused,
    pick: () => ai.aiFor('main'),
    call: (req) => ai.aiJson(req),
    resolve: async (provider, key, model) => {
      let listed: Awaited<ReturnType<typeof ai.listModels>> = []
      try { listed = await ai.listModels(provider, key) } catch { /* the call reports the real error */ }
      return ai.resolveModel(provider, model, listed)
    },
  }
}

export interface TextJob { system: string; user: string; schema: AiSchema; maxTokens?: number; signal?: AbortSignal }

/** Run one job and return the model's fields. Throws with a plain message when AI is off or has no key. */
export async function runTextAi(job: TextJob, override: Partial<TextAiDeps> = {}): Promise<{ data: Record<string, unknown>; model: string; provider: string }> {
  const d: TextAiDeps = override.paused && override.pick && override.call && override.resolve ? (override as TextAiDeps) : { ...(await defaultDeps()), ...override }
  if (d.paused()) throw new Error(TEXT_AI_OFF)
  const ai = d.pick()
  if (!ai) throw new Error(TEXT_AI_NO_KEY)
  const model = await d.resolve(ai.provider, ai.key, ai.model)
  const out = await d.call({ provider: ai.provider, key: ai.key, model, system: job.system, user: job.user, schema: job.schema, maxTokens: job.maxTokens ?? 4000, effort: 'low', timeoutMs: 120_000, signal: job.signal })
  return { data: out.data, model: out.model, provider: ai.provider }
}

// ---------------------------------------------------------------- numbers: a translation or a caption never changes a figure

const BN_DIGITS = '০১২৩৪৫৬৭৮৯'
/** Digits as ASCII (Bangla digits converted), thousands commas dropped. */
export const asciiDigits = (s: string) => s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d))).replace(/(?<=\d),(?=\d{3}\b)/g, '')

/** The numbers in a text, as written without separators, sorted (so order and script do not matter). */
export function numbersIn(s: string): string[] {
  return (asciiDigits(s).match(/\d+(?:\.\d+)?/g) ?? []).sort()
}

/** Numbers that appear in `text` but nowhere in `source` (a model must not bring figures of its own). */
export function numbersNotIn(text: string, source: string): string[] {
  const have = new Set(numbersIn(source))
  return [...new Set(numbersIn(text))].filter((n) => !have.has(n))
}

export type { AiSchema }
