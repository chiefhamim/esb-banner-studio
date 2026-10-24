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
export type AiRole = 'main' | 'seo' | 'social'

export interface AiSettings {
  /** The main provider: translation and the whole story, and the provider SEO and social use unless given their own. */
  provider: AiProviderId
  /** A provider just for "Write with AI" on the SEO tab; '' follows the main one. */
  seo: AiProviderId | ''
  /** A provider just for the social captions; '' follows the main one. */
  social: AiProviderId | ''
  keys: Record<AiProviderId, string>
  /** 'auto' or a model id, per provider. */
  models: Record<AiProviderId, string>
  /** The editor's own translation prompt; empty means the built-in newsroom prompt. */
  prompt: string
}

const SETTINGS_KEY = 'esb-banner-studio/ai-settings'

const emptyRecord = (v: string): Record<AiProviderId, string> => ({ gemini: v, anthropic: v, openai: v, openrouter: v })
const isProvider = (v: unknown): v is AiProviderId => AI_PROVIDERS.some((p) => p.id === v)

export function loadAiSettings(): AiSettings {
  const base: AiSettings = { provider: 'gemini', seo: '', social: '', keys: emptyRecord(''), models: emptyRecord('auto'), prompt: '' }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      const s = JSON.parse(raw) as Partial<AiSettings>
      return {
        provider: isProvider(s.provider) ? s.provider : 'gemini',
        seo: isProvider(s.seo) ? s.seo : '',
        social: isProvider(s.social) ? s.social : '',
        keys: { ...base.keys, ...(s.keys ?? {}) },
        models: { ...base.models, ...(s.models ?? {}) },
        prompt: typeof s.prompt === 'string' ? s.prompt : '',
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

/** The provider, key and model a job should call: the one chosen for it when it has a key, else nothing — no substitute. */
export function aiFor(role: AiRole = 'main', s: AiSettings = loadAiSettings()): { provider: AiProviderId; key: string; model: string } | null {
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
  const { provider, key, system, user, schema } = req
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
          contents: [{ parts: [{ text: user }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: Math.max(maxTokens, 8192), responseMimeType: 'application/json', responseSchema: toGeminiSchema(schema) },
        }),
      })
      if (!res.ok) throw new Error(`${geminiLabel(model)}: ${await errorText(res)}`)
      const data = await res.json() as { candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[] }
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
        messages: [{ role: 'user', content: user }],
        output_config: { ...(CLAUDE_EFFORT.test(model) ? { effort: req.effort ?? 'medium' } : {}), format: { type: 'json_schema', schema: strictSchema(schema) } },
      }, { signal: t.signal })
      const msg = await stream.finalMessage()
      if (msg.stop_reason === 'refusal') throw new Error('Claude declined this request')
      if (msg.stop_reason === 'max_tokens') throw new Error('Claude ran out of room before finishing — the story may be too long for one reply')
      const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
      return { data: parseJson(text) as T, model: msg.model || model }
    }

    // OpenAI and OpenRouter share the chat-completions shape
    const url = provider === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions'
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }
    if (provider === 'openrouter') { headers['X-Title'] = 'ESB Studio'; headers['HTTP-Referer'] = 'https://esbpowerline.com' }
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
    const data = await res.json() as { model?: string; choices?: { finish_reason?: string; message?: { content?: string; refusal?: string } }[] }
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
