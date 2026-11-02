// Caption translation EN <-> BN as a SEPARATE reviewed track: the source captions are never touched, the translated
// clips are labelled AI drafts, and a line whose figures changed is left out and reported instead of added.
import { numbersIn, runTextAi, type AiSchema, type TextAiDeps } from './aiText'
import type { Clip, VideoProject } from '../timeline'

export type Lang = 'en' | 'bn'
const NAME: Record<Lang, string> = { en: 'English', bn: 'Bangla (Bengali script)' }

export const TRANSLATE_SCHEMA: AiSchema = {
  type: 'object',
  properties: { lines: { type: 'string', description: 'One line per input caption, in the same order, formatted "N|translated text" with the same N.' } },
  required: ['lines'],
}

export const translateSystem = (to: Lang) => `You are a news translator for ESB Power Line, a Bangladesh energy newsroom. Translate each numbered video caption into ${NAME[to]}.
Rules:
- Translate faithfully. Add nothing, drop nothing, do not explain.
- Keep every number, unit, currency, date, name and place exactly (names are transliterated, never changed). Do not convert units or currencies.
- Keep each caption as one entry; a caption may contain a line break, written as " / ".
- Reply with one line per caption, "N|translation", the same N as the input, in the same order, and nothing else.`

export function numberedInput(lines: string[]): string {
  return lines.map((l, i) => `${i + 1}|${l.replace(/\s*\n\s*/g, ' / ')}`).join('\n')
}

/** "N|text" lines back to a list (null where a caption is missing). A repeated number is ignored after the first. */
export function parseNumbered(text: string, count: number): (string | null)[] {
  const out: (string | null)[] = Array.from({ length: count }, () => null)
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^\s*(\d{1,5})\s*[|:]\s*(.*\S)\s*$/)
    if (!m) continue
    const i = Number(m[1]) - 1
    if (i >= 0 && i < count && out[i] === null) out[i] = m[2].replace(/\s+\/\s+/g, '\n').trim()
  }
  return out
}

export interface TranslateResult { lines: (string | null)[]; problems: { index: number; why: string }[]; model: string }

export async function translateCaptionLines(lines: string[], to: Lang, deps: Partial<TextAiDeps> = {}, signal?: AbortSignal): Promise<TranslateResult> {
  if (!lines.length) return { lines: [], problems: [], model: '' }
  const { data, model } = await runTextAi({ system: translateSystem(to), user: numberedInput(lines), schema: TRANSLATE_SCHEMA, maxTokens: Math.min(16000, 800 + lines.join('').length * 4), signal }, deps)
  const got = parseNumbered(String(data.lines ?? ''), lines.length)
  const problems: { index: number; why: string }[] = []
  const kept = got.map((t, i) => {
    if (t === null) { problems.push({ index: i, why: 'The translation left this caption out.' }); return null }
    const a = numbersIn(lines[i]).join(',')
    const b = numbersIn(t).join(',')
    if (a !== b) { problems.push({ index: i, why: `The figures changed (${a || 'none'} became ${b || 'none'}), so this caption was not added.` }); return null }
    return t
  })
  return { lines: kept, problems, model }
}

/** The caption clips on the timeline, in time order. */
export const captionSources = (project: VideoProject): Clip[] => project.clips.filter((c) => c.kind === 'caption' && (c.captionText ?? '').trim()).sort((a, b) => a.start - b.start)

/** Translated clips with the source clips' timing, labelled as an AI draft; null lines are skipped. */
export function translatedClips(sources: Clip[], lines: (string | null)[], to: Lang, trackId: string, stamp = Date.now().toString(36)): Clip[] {
  const out: Clip[] = []
  sources.forEach((c, i) => {
    const text = lines[i]
    if (!text) return
    out.push({ ...c, id: `clip-tr-${to}-${stamp}-${i.toString(36)}`, trackId, title: `${to.toUpperCase()} (AI draft) · ${text.replace(/\s+/g, ' ').slice(0, 28)}`, captionText: text, color: '#a855f7', linkId: undefined, groupId: undefined })
  })
  return out
}
