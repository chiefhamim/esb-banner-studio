// AI providers for the Editorial desk: one call shape — a system prompt, the story, a JSON schema — answered by
// whichever service the editor has a key for. Gemini (Google AI Studio), Claude (Anthropic), OpenAI and OpenRouter
// (which reaches most other model families with one key).
//
// The editor keeps a key per provider and gives each job one provider: the main one translates and writes the story,
// and SEO and social captions can each use another. A job only ever calls the provider chosen for it — never a
// substitute. Every call goes from this app straight to the provider's own API host with the editor's own key; nothing
// passes through esbpowerline.com or a relay, and keys live only in this machine's local storage. Claude is called
// through the official @anthropic-ai/sdk; the others through their documented REST endpoints.
//
// A reply that stopped early (token limit, safety stop) is an error, never a shorter answer: a cut-off translation
// is a story without its last paragraphs.

import Anthropic from '@anthropic-ai/sdk'
import { create } from 'zustand'
import type { DiscrepancyFlag } from './facts'

/** What the provider reported for each call this session: tokens read (fresh and from cache), written to cache, and produced. */
export interface AiUsageEntry { at: number; provider: string; model: string; input: number; cacheRead: number; cacheWrite: number; output: number }
export const useAiUsage = create<{ calls: AiUsageEntry[]; add: (e: AiUsageEntry) => void; reset: () => void }>((set) => ({
  calls: [],
  add: (e) => set((s) => ({ calls: [...s.calls.slice(-199), e] })),
  reset: () => set({ calls: [] }),
}))
/** Totals for the Engine panel. Claude's `input_tokens` excludes cached tokens, so the real prompt size is input + cacheRead + cacheWrite. */
export function usageTotals(calls: AiUsageEntry[]) {
  const t = { calls: calls.length, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
  for (const c of calls) { t.input += c.input; t.cacheRead += c.cacheRead; t.cacheWrite += c.cacheWrite; t.output += c.output }
  const prompt = t.input + t.cacheRead + t.cacheWrite
  return { ...t, prompt, hitRate: prompt ? t.cacheRead / prompt : 0 }
}

/**
 * List prices in US dollars per million tokens, used ONLY for an estimate that is always labelled as one. Source:
 * Anthropic's published first-party API prices (the claude-api reference, table cached 2026-10-06); a 5-minute cache
 * write is billed at 1.25x the input price, a cache read at the price shown. Only Claude is priced: no verified list
 * price for Gemini, OpenAI or OpenRouter models was available when this was written, so their calls show tokens and
 * "no price on file" rather than a guessed figure. Update this table when prices change.
 */
export const AI_PRICE_TABLE: { provider: AiProviderId; match: RegExp; label: string; input: number; output: number; cacheRead: number }[] = [
  { provider: 'anthropic', match: /^claude-opus-5-5/, label: 'Opus 5.5', input: 4, output: 20, cacheRead: 0.2 },
  { provider: 'anthropic', match: /^claude-opus-(5|4-[678])(?!-5)/, label: 'Opus 5 / 4.6-4.8', input: 5, output: 25, cacheRead: 0.5 },
  { provider: 'anthropic', match: /^claude-sonnet-5/, label: 'Sonnet 5 / 5.5', input: 2, output: 10, cacheRead: 0.2 },
  { provider: 'anthropic', match: /^claude-sonnet-4-6/, label: 'Sonnet 4.6', input: 3, output: 15, cacheRead: 0.3 },
  { provider: 'anthropic', match: /^claude-haiku-5-5/, label: 'Haiku 5.5', input: 0.1, output: 0.5, cacheRead: 0.01 },
  { provider: 'anthropic', match: /^claude-haiku-4-5/, label: 'Haiku 4.5', input: 1, output: 5, cacheRead: 0.1 },
]
export const CACHE_WRITE_FACTOR = 1.25

/** Estimated cost of one call in dollars, or null when the model has no price on file (never a guess). */
export function estimateCallCost(c: Pick<AiUsageEntry, 'provider' | 'model' | 'input' | 'cacheRead' | 'cacheWrite' | 'output'>): number | null {
  const p = AI_PRICE_TABLE.find((r) => r.provider === c.provider && r.match.test(c.model))
  if (!p) return null
  return (c.input * p.input + c.cacheWrite * p.input * CACHE_WRITE_FACTOR + c.cacheRead * p.cacheRead + c.output * p.output) / 1e6
}

/** Estimated cost of many calls: the priced total plus how many calls had no price. */
export function estimateCost(calls: AiUsageEntry[]): { dollars: number; priced: number; unpriced: number } {
  let dollars = 0, priced = 0, unpriced = 0
  for (const c of calls) { const d = estimateCallCost(c); if (d == null) unpriced++; else { dollars += d; priced++ } }
  return { dollars, priced, unpriced }
}

/** "$0.0123" under a cent shows four places, otherwise two. */
export const fmtDollars = (d: number) => '$' + (d < 0.01 ? d.toFixed(4) : d.toFixed(2))

/** Per-story usage: a call belongs to the story whose story/SEO/social job was running when it answered; anything else
 *  (the launch key check, Outreach) is story ''. Newest story first, '' last. */
export function usageByStory(calls: AiUsageEntry[], jobs: { story: string; kind: string; start: number; end?: number }[], now = Date.now()) {
  const work = jobs.filter((j) => j.kind !== 'publish')
  const rows = new Map<string, { story: string; calls: AiUsageEntry[]; last: number }>()
  for (const c of calls) {
    const j = work.find((x) => c.at >= x.start && c.at <= (x.end ?? now))
    const story = j?.story ?? ''
    const r = rows.get(story) ?? { story, calls: [], last: 0 }
    r.calls.push(c)
    r.last = Math.max(r.last, c.at)
    rows.set(story, r)
  }
  return [...rows.values()]
    .sort((a, b) => (a.story === '' ? 1 : b.story === '' ? -1 : b.last - a.last))
    .map((r) => ({ story: r.story, ...usageTotals(r.calls), cost: estimateCost(r.calls) }))
}

// ------------------------------------------------------------------ escalation (W6)

/**
 * Name/date flags needed to escalate when no figure is off. Three, because one or two unmatched names are usually a
 * transliteration the editor fixes in seconds, while three or more mean the draft drifted from the source. Quote flags
 * never count: a translated quote can never match the Bengali verbatim, so they fire on almost every story.
 */
export const ESCALATE_MIN_FLAGS = 3

export interface EscalationDecision { escalate: boolean; why: string; figures: number; others: number }

/** Pure: escalate when any figure/currency in the draft is not in the source, or on ESCALATE_MIN_FLAGS name/date flags. Never when clean or not opted in. */
export function decideEscalation(flags: DiscrepancyFlag[], opts: { enabled: boolean; minFlags?: number }): EscalationDecision {
  const figures = flags.filter((f) => f.kind === 'unverified_number' || f.kind === 'unverified_currency').length
  const others = flags.filter((f) => f.kind === 'unverified_entity' || f.kind === 'unverified_date').length
  const min = opts.minFlags ?? ESCALATE_MIN_FLAGS
  if (!opts.enabled) return { escalate: false, why: 'escalation is off', figures, others }
  if (figures) return { escalate: true, why: `${figures} ${figures === 1 ? 'figure' : 'figures'} not in the source`, figures, others }
  if (others >= min) return { escalate: true, why: `${others} names or dates not in the source`, figures, others }
  return { escalate: false, why: flags.length ? 'only quote flags (a translation never matches the source verbatim)' : 'every figure matches the source', figures, others }
}

/** Claude: Opus over Sonnet over Haiku, then the newer version. */
function rankClaude(id: string): number {
  const m = /^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?/.exec(id)
  if (!m) return 0
  return ({ opus: 300, sonnet: 200, haiku: 100 } as Record<string, number>)[m[1]] + Number(m[2]) + Number(m[3] ?? 0) / 10
}
/** The Opus asked for when the key's model list is not at hand. */
export const CLAUDE_STRONG = 'claude-opus-5-5'

/** The provider's strongest model by the desk's own rankings, or null when `current` already is it (or nothing ranks: OpenRouter, an empty list). */
export function strongerModel(provider: AiProviderId, current: string, listed: AiModelInfo[]): string | null {
  const ids = listed.map((m) => m.id)
  if (provider === 'anthropic') {
    if (/^claude-opus-/.test(current)) return null
    return ids.filter((id) => /^claude-opus-/.test(id)).sort((a, b) => rankClaude(b) - rankClaude(a))[0] ?? CLAUDE_STRONG
  }
  const rank = provider === 'gemini' ? rankGemini : provider === 'openai' ? rankOpenAi : null
  if (!rank || !ids.length) return null
  const best = [...ids].sort((a, b) => rank(b) - rank(a))[0]
  return rank(best) > rank(current) ? best : null
}

export type AiProviderId = 'gemini' | 'anthropic' | 'openai' | 'openrouter'

export interface AiProviderMeta {
  id: AiProviderId
  name: string
  /** The page where the editor creates a key. */
  keyUrl: string
  keyPlaceholder: string
  /** The company colour: a swatch in menus; the chip and "Write with AI" buttons are filled from it (studio.css). */
  color: string
  help: string
  autoLabel: string
}

export const AI_PROVIDERS: AiProviderMeta[] = [
  { id: 'gemini', name: 'Gemini', keyUrl: 'https://aistudio.google.com/apikey', keyPlaceholder: 'AIza…', color: '#4285f4', autoLabel: 'Auto — newest Flash (fast)', help: 'Google AI Studio → Get API key. Pro models translate most carefully; Flash is fastest.' },
  { id: 'anthropic', name: 'Claude', keyUrl: 'https://console.anthropic.com/settings/keys', keyPlaceholder: 'sk-ant-…', color: '#d97757', autoLabel: 'Auto — Claude Sonnet 5.5', help: 'Anthropic Console → API keys. Billed to that Console account, separate from a Claude.ai subscription.' },
  { id: 'openai', name: 'OpenAI', keyUrl: 'https://platform.openai.com/api-keys', keyPlaceholder: 'sk-…', color: '#10a37f', autoLabel: 'Auto — newest GPT', help: 'OpenAI Platform → API keys. Billed to the Platform account, separate from ChatGPT Plus.' },
  { id: 'openrouter', name: 'OpenRouter', keyUrl: 'https://openrouter.ai/keys', keyPlaceholder: 'sk-or-…', color: '#6467f2', autoLabel: 'Auto — OpenRouter picks', help: 'One key for many model families (Llama, Mistral, DeepSeek, Qwen and more). openrouter.ai → Keys.' },
]

export const providerMeta = (id: AiProviderId) => AI_PROVIDERS.find((p) => p.id === id)!

export interface AiModelInfo { id: string; label: string; hint?: string }

/** The jobs the desk gives a provider. */
export type AiRole = 'main' | 'seo' | 'social' | 'outreach' | 'research' | 'review'

export interface AiSettings {
  /** The main provider: translation and the whole story, and the provider SEO and social use unless given their own. */
  provider: AiProviderId
  /** A provider just for "Write with AI" on the SEO tab; '' follows the main one. */
  seo: AiProviderId | ''
  /** A provider just for the social captions; '' follows the main one. */
  social: AiProviderId | ''
  /** Outreach desk, three jobs like Editorial's: the letter, research on sources, the pre-send review; '' follows main. */
  outreach: AiProviderId | ''
  research: AiProviderId | ''
  review: AiProviderId | ''
  keys: Record<AiProviderId, string>
  /** 'auto' or a model id, per provider. */
  models: Record<AiProviderId, string>
  /** The editor's own translation prompt; empty means the built-in newsroom prompt. */
  prompt: string
  /** The master switch. While true no AI company is contacted for anything: not translation, SEO, captions, PDF reading, the
   *  launch health check, model lists or key tests. The free translation service is used instead. */
  paused: boolean
  /** Opt-in per job: when the first answer's figures disagree with the source, ask again once on a stronger model
   *  (`decideEscalation`). Off unless set; only the Story job (translation) is wired today. */
  escalate?: Partial<Record<AiRole, boolean>>
}

const SETTINGS_KEY = 'esb-banner-studio/ai-settings'

const emptyRecord = (v: string): Record<AiProviderId, string> => ({ gemini: v, anthropic: v, openai: v, openrouter: v })
const isProvider = (v: unknown): v is AiProviderId => AI_PROVIDERS.some((p) => p.id === v)

export function loadAiSettings(): AiSettings {
  const base: AiSettings = { provider: 'gemini', seo: '', social: '', outreach: '', research: '', review: '', keys: emptyRecord(''), models: emptyRecord('auto'), prompt: '', paused: false }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      const s = JSON.parse(raw) as Partial<AiSettings>
      return {
        provider: isProvider(s.provider) ? s.provider : 'gemini',
        seo: isProvider(s.seo) ? s.seo : '',
        social: isProvider(s.social) ? s.social : '',
        outreach: isProvider(s.outreach) ? s.outreach : '',
        research: isProvider(s.research) ? s.research : '',
        review: isProvider(s.review) ? s.review : '',
        keys: { ...base.keys, ...(s.keys ?? {}) },
        models: { ...base.models, ...(s.models ?? {}) },
        prompt: typeof s.prompt === 'string' ? s.prompt : '',
        paused: s.paused === true,
        ...(s.escalate && typeof s.escalate === 'object' ? { escalate: Object.fromEntries(Object.entries(s.escalate).filter(([k, v]) => ROLE_IDS.includes(k as AiRole) && typeof v === 'boolean')) as AiSettings['escalate'] } : {}),
      }
    }
  } catch { /* storage blocked: defaults */ }
  return base
}

export function saveAiSettings(s: AiSettings) {
  const clean: AiSettings = { ...s, keys: Object.fromEntries(Object.entries(s.keys).map(([k, v]) => [k, v.trim()])) as AiSettings['keys'] }
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(clean)) } catch { /* ignore */ }
}

/** The provider a job uses: its own choice, or the main one. */
export const roleProvider = (s: AiSettings, role: AiRole): AiProviderId => (role === 'main' ? s.provider : s[role] || s.provider)

export const AI_OFF_MESSAGE = 'AI is OFF. Turn it ON in the Engine panel or your account sheet.'
/** True while the master switch is off. Read from storage so every caller sees a change at once. */
export const aiPaused = () => loadAiSettings().paused

const ROLE_IDS: AiRole[] = ['main', 'seo', 'social', 'outreach', 'research', 'review']

// A one-call model override for escalation: set only while `fn` runs synchronously, so it reaches exactly the aiFor()
// the callee makes before its first await (translateNewsArticle reads aiFor('main') on its first line) and nothing else.
let modelOverride: { role: AiRole; model: string } | null = null
export function runWithModel<T>(role: AiRole, model: string, fn: () => T): T {
  const prev = modelOverride
  modelOverride = { role, model }
  try { return fn() } finally { modelOverride = prev }
}

/** The provider, key and model a job should call: the one chosen for it when it has a key, else nothing — no substitute. Nothing at all while AI is switched off. */
export function aiFor(role: AiRole = 'main', s: AiSettings = loadAiSettings()): { provider: AiProviderId; key: string; model: string } | null {
  if (s.paused) return null
  if (modelOverride?.role === role) {
    const provider = roleProvider(s, role)
    const key = s.keys[provider]?.trim()
    return key ? { provider, key, model: modelOverride.model } : null
  }
  const provider = roleProvider(s, role)
  const key = s.keys[provider]?.trim()
  return key ? { provider, key, model: s.models[provider] || 'auto' } : null
}

// ------------------------------------------------------------------ model lists

const cache = new Map<string, AiModelInfo[]>()

function timeout(ms: number, outer?: AbortSignal) {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), ms)
  outer?.addEventListener('abort', () => c.abort(), { once: true })
  return { signal: c.signal, done: () => clearTimeout(t) }
}

async function errorText(res: Response): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: { message?: string } | string; message?: string } | null
  const e = body?.error
  return (typeof e === 'string' ? e : e?.message) || body?.message || `HTTP ${res.status}`
}

/** Gemini: newest first — version, then Pro over Flash over Flash-Lite, stable over preview. */
export function rankGemini(id: string): number {
  const v = Number(/gemini-(\d+(?:\.\d+)?)/.exec(id)?.[1] ?? 0)
  const tier = /pro/.test(id) ? 3 : /flash-lite/.test(id) ? 1 : /flash/.test(id) ? 2 : 0
  const stable = /preview|exp|latest/.test(id) ? 0 : 0.5
  return v * 10 + tier + stable
}
export const geminiLabel = (id: string) => id.replace(/^gemini-/, 'Gemini ').replace(/-/g, ' ').replace(/\bpro\b/, 'Pro').replace(/\bflash\b/, 'Flash').replace(/\blite\b/, 'Lite').replace(/\bpreview\b/, '(preview)')

/** A model id as people say it: claude-sonnet-5-5 → "Sonnet 5.5", gemini-3-flash → "Gemini 3 Flash"; anything else as is. */
export function modelLabel(id: string): string {
  const c = /^claude-(sonnet|opus|haiku|fable|mythos)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id)
  if (c) return `${c[1][0].toUpperCase()}${c[1].slice(1)} ${c[2]}${c[3] ? '.' + c[3] : ''}`
  return /^gemini-\d/.test(id) ? geminiLabel(id) : id
}

/** OpenAI: chat models only, newest GPT first, full models ahead of mini / nano. */
export function rankOpenAi(id: string): number {
  const v = Number(/^gpt-(\d+(?:\.\d+)?)/.exec(id)?.[1] ?? /^o(\d+)/.exec(id)?.[1] ?? 0)
  const size = /nano/.test(id) ? 0 : /mini/.test(id) ? 1 : 2
  const dated = /-\d{4}-\d{2}-\d{2}$/.test(id) ? 0 : 0.5
  return v * 10 + size + dated
}

/** Claude's "Auto" model: Sonnet 5.5 — fast and accurate enough for a whole article, at a fraction of Opus's price. */
const CLAUDE_AUTO = 'claude-sonnet-5-5'
// the Claude models that take an effort setting (older ones reject it)
const CLAUDE_EFFORT = /^claude-(sonnet-5|opus-5|haiku-5|fable-5|opus-4-[678]|sonnet-4-6)/

function claudeClient(key: string) {
  // The editor's own key, in their own desktop app: the browser warning the SDK guards against (a key shipped to
  // strangers' browsers) does not apply. The SDK then sends the header Anthropic's CORS policy requires.
  return new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1 })
}

export async function listModels(provider: AiProviderId, apiKey: string, signal?: AbortSignal): Promise<AiModelInfo[]> {
  if (aiPaused()) return []
  const key = apiKey.trim()
  if (!key) return []
  const ck = `${provider}:${key}`
  if (cache.has(ck)) return cache.get(ck)!
  const t = timeout(10_000, signal)
  try {
    let out: AiModelInfo[] = []
    if (provider === 'gemini') {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=200`, { signal: t.signal })
      if (!res.ok) throw new Error(await errorText(res))
      const data = await res.json() as { models?: { name?: string; supportedGenerationMethods?: string[] }[] }
      const ids = (data.models ?? [])
        .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
        .map((m) => (m.name ?? '').replace(/^models\//, ''))
        // text-in/text-out Gemini models only: no embeddings, image, audio, TTS or live variants
        .filter((id) => /^gemini-\d/.test(id) && !/(embedding|image|vision|audio|tts|live|native|thinking-exp|learnlm|aqa)/.test(id))
      out = [...new Set(ids)].sort((a, b) => rankGemini(b) - rankGemini(a)).map((id) => ({ id, label: geminiLabel(id), hint: /pro/.test(id) ? 'most careful' : undefined }))
    } else if (provider === 'anthropic') {
      const client = claudeClient(key)
      for await (const m of client.models.list({ limit: 100 }, { signal: t.signal })) {
        if (m.id.startsWith('claude-')) out.push({ id: m.id, label: m.display_name || m.id })
      }
    } else if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` }, signal: t.signal })
      if (!res.ok) throw new Error(await errorText(res))
      const data = await res.json() as { data?: { id: string }[] }
      const ids = (data.data ?? []).map((m) => m.id)
        .filter((id) => /^(gpt-\d|o\d)/.test(id) && !/(audio|realtime|tts|transcribe|image|search|embedding|instruct|moderation|codex|computer)/.test(id))
      out = ids.sort((a, b) => rankOpenAi(b) - rankOpenAi(a)).map((id) => ({ id, label: id }))
    } else {
      const res = await fetch('https://openrouter.ai/api/v1/models', { headers: { Authorization: `Bearer ${key}` }, signal: t.signal })
      if (!res.ok) throw new Error(await errorText(res))
      const data = await res.json() as { data?: { id: string; name?: string; supported_parameters?: string[]; architecture?: { output_modalities?: string[] } }[] }
      out = (data.data ?? [])
        // models that can be asked for JSON and answer in text
        .filter((m) => (m.supported_parameters ?? []).some((p) => p === 'response_format' || p === 'structured_outputs'))
        .filter((m) => !m.architecture?.output_modalities || m.architecture.output_modalities.includes('text'))
        .map((m) => ({ id: m.id, label: m.name || m.id }))
        .sort((a, b) => a.label.localeCompare(b.label))
    }
    cache.set(ck, out)
    return out
  } catch (e) {
    throw new Error(describeError(provider, e, t.signal.aborted))
  } finally {
    t.done()
  }
}

/** The model a call will use: the editor's choice, or for "auto" the provider's best listed default. */
export function resolveModel(provider: AiProviderId, chosen: string, listed: AiModelInfo[]): string {
  if (chosen && chosen !== 'auto') return chosen
  const ids = listed.map((m) => m.id)
  if (provider === 'gemini') return ids.find((id) => /flash/.test(id) && !/lite/.test(id)) ?? 'gemini-2.5-flash'
  if (provider === 'anthropic') return CLAUDE_AUTO
  if (provider === 'openai') return ids.find((id) => /^gpt-/.test(id) && !/mini|nano/.test(id)) ?? ids[0] ?? ''
  return 'openrouter/auto'
}

function describeError(provider: AiProviderId, e: unknown, timedOut = false): string {
  const name = providerMeta(provider).name
  if (timedOut) return `${name} took too long to answer`
  if (e instanceof Anthropic.AuthenticationError) return 'Claude rejected this key'
  if (e instanceof Anthropic.PermissionDeniedError) return 'This key may not use that Claude model'
  if (e instanceof Anthropic.NotFoundError) return 'Claude does not know that model'
  if (e instanceof Anthropic.RateLimitError) return 'Claude rate limit reached — try again in a minute'
  if (e instanceof Anthropic.APIError) return `Claude: ${e.message}`
  return e instanceof Error ? e.message : String(e)
}

// ------------------------------------------------------------------ one structured call

/** A JSON Schema object with string fields — the only shape the desk asks for. */
export interface AiSchema { type: 'object'; properties: Record<string, { type: 'string'; description: string }>; required: string[] }

/** Gemini's responseSchema dialect: OpenAPI type names, no additionalProperties. */
export function toGeminiSchema(s: AiSchema) {
  return {
    type: 'OBJECT',
    properties: Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, { type: 'STRING', description: v.description }])),
    required: s.required,
  }
}
/** Strict JSON Schema (Claude, OpenAI): every object closed, every field required. */
export const strictSchema = (s: AiSchema) => ({ ...s, additionalProperties: false })

export interface AiJsonRequest {
  provider: AiProviderId
  key: string
  model: string
  system: string
  user: string
  /** A file the model reads itself (a PDF). Only Claude and Gemini take one here; the others raise a plain error. */
  attachment?: { mime: 'application/pdf'; data: string }
  schema: AiSchema
  /** Long for a whole article, short for captions and SEO. */
  maxTokens?: number
  /** How hard Claude thinks: medium for a whole article, low for short structured jobs. Other providers ignore it. */
  effort?: 'low' | 'medium'
  timeoutMs?: number
  signal?: AbortSignal
}

function parseJson(text: string): Record<string, unknown> {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(t) } catch { /* fall through */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1))
  throw new Error('The model did not answer in JSON')
}

export async function aiJson<T extends Record<string, unknown>>(req: AiJsonRequest): Promise<{ data: T; model: string }> {
  if (aiPaused()) throw new Error(AI_OFF_MESSAGE)
  const { provider, key, system, user, schema, attachment } = req
  if (attachment && provider !== 'gemini' && provider !== 'anthropic') throw new Error(`${providerMeta(provider).name} cannot read a PDF file here — choose Claude or Gemini as the main AI.`)
  const maxTokens = req.maxTokens ?? 16000
  const t = timeout(req.timeoutMs ?? 120_000, req.signal)
  const model = req.model
  try {
    if (provider === 'gemini') {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: t.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ parts: [...(attachment ? [{ inlineData: { mimeType: attachment.mime, data: attachment.data } }] : []), { text: user }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: Math.max(maxTokens, 8192), responseMimeType: 'application/json', responseSchema: toGeminiSchema(schema) },
        }),
      })
      if (!res.ok) throw new Error(`${geminiLabel(model)}: ${await errorText(res)}`)
      const data = await res.json() as { candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; cachedContentTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } }
      const um = data.usageMetadata
      // Gemini's prompt count includes the cached part; thinking tokens are billed as output
      if (um) useAiUsage.getState().add({ at: Date.now(), provider: 'gemini', model, input: Math.max(0, (um.promptTokenCount ?? 0) - (um.cachedContentTokenCount ?? 0)), cacheRead: um.cachedContentTokenCount ?? 0, cacheWrite: 0, output: (um.candidatesTokenCount ?? 0) + (um.thoughtsTokenCount ?? 0) })
      const cand = data.candidates?.[0]
      if (cand?.finishReason && cand.finishReason !== 'STOP') throw new Error(`${geminiLabel(model)} stopped early (${cand.finishReason})`)
      return { data: parseJson((cand?.content?.parts ?? []).map((p) => p.text ?? '').join('')) as T, model }
    }

    if (provider === 'anthropic') {
      // Streamed so a long article never hits a request timeout; finalMessage() gives the whole reply. No sampling
      // parameters and no thinking setting (Sonnet 5.5 rejects the former and thinks adaptively by default). The
      // system prompt carries a cache breakpoint, so the newsroom prompt is read from cache on every call after the
      // first within five minutes; the story sits after it, so it never disturbs the cached prefix.
      const stream = claudeClient(key).messages.stream({
        model,
        max_tokens: maxTokens,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: attachment ? [{ type: 'document' as const, source: { type: 'base64' as const, media_type: attachment.mime, data: attachment.data } }, { type: 'text' as const, text: user }] : user }],
        output_config: { ...(CLAUDE_EFFORT.test(model) ? { effort: req.effort ?? 'medium' } : {}), format: { type: 'json_schema', schema: strictSchema(schema) } },
      }, { signal: t.signal })
      const msg = await stream.finalMessage()
      if (msg.stop_reason === 'refusal') throw new Error('Claude declined this request')
      if (msg.stop_reason === 'max_tokens') throw new Error('Claude ran out of room before finishing — the story may be too long for one reply')
      const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
      const u = msg.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } | undefined
      if (u) useAiUsage.getState().add({ at: Date.now(), provider: 'anthropic', model: msg.model || model, input: u.input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, output: u.output_tokens ?? 0 })
      return { data: parseJson(text) as T, model: msg.model || model }
    }

    // OpenAI and OpenRouter share the chat-completions shape
    const url = provider === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions'
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }
    if (provider === 'openrouter') { headers['X-Title'] = 'ESB AI Studio'; headers['HTTP-Referer'] = 'https://esbpowerline.com' }
    const send = (format: Record<string, unknown> | null) => fetch(url, {
      method: 'POST',
      headers,
      signal: t.signal,
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        ...(provider === 'openai' ? { max_completion_tokens: /^gpt-4/.test(model) ? Math.min(maxTokens, 16000) : maxTokens } : { max_tokens: maxTokens }),
        ...(format ? { response_format: format } : {}),
      }),
    })
    let res = await send({ type: 'json_schema', json_schema: { name: 'esb_result', strict: true, schema: strictSchema(schema) } })
    // some OpenRouter models take JSON mode but not a schema: ask again with the schema written into the prompt
    if (res.status === 400 && provider === 'openrouter') res = await send({ type: 'json_object' })
    if (!res.ok) throw new Error(`${providerMeta(provider).name} (${model}): ${await errorText(res)}`)
    const data = await res.json() as { model?: string; choices?: { finish_reason?: string; message?: { content?: string; refusal?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } }
    const ou = data.usage
    // prompt_tokens includes the cached part
    if (ou) useAiUsage.getState().add({ at: Date.now(), provider, model: data.model || model, input: Math.max(0, (ou.prompt_tokens ?? 0) - (ou.prompt_tokens_details?.cached_tokens ?? 0)), cacheRead: ou.prompt_tokens_details?.cached_tokens ?? 0, cacheWrite: 0, output: ou.completion_tokens ?? 0 })
    const choice = data.choices?.[0]
    if (choice?.message?.refusal) throw new Error(`${model} declined: ${choice.message.refusal}`)
    if (choice?.finish_reason && !['stop', 'end_turn'].includes(choice.finish_reason)) throw new Error(`${model} stopped early (${choice.finish_reason})`)
    return { data: parseJson(choice?.message?.content ?? '') as T, model: data.model || model }
  } catch (e) {
    throw new Error(describeError(provider, e, t.signal.aborted && !req.signal?.aborted))
  } finally {
    t.done()
  }
}

/** Check a key: list its models, then make one tiny structured call on the model the desk would use. */
export async function testAiKey(provider: AiProviderId, apiKey: string, chosen: string): Promise<{ ok: boolean; model?: string; error?: string; models?: AiModelInfo[] }> {
  if (aiPaused()) return { ok: false, error: AI_OFF_MESSAGE }
  const key = apiKey.trim()
  if (!key) return { ok: false, error: 'Please enter an API key.' }
  for (const k of [...cache.keys()]) if (k.startsWith(provider + ':')) cache.delete(k)
  let models: AiModelInfo[] = []
  try {
    models = await listModels(provider, key)
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
  const model = resolveModel(provider, chosen, models)
  if (!model) return { ok: false, error: 'This key lists no chat models.', models }
  try {
    await aiJson({ provider, key, model, system: 'Answer with the requested JSON only.', user: 'Reply with ok set to "yes".', schema: { type: 'object', properties: { ok: { type: 'string', description: 'yes' } }, required: ['ok'] }, maxTokens: 2048, timeoutMs: 60_000, effort: 'low' })
    return { ok: true, model, models }
  } catch (e) {
    return { ok: false, error: (e as Error).message, models }
  }
}
