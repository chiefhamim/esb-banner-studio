// The Quote & Stat Library: what the fact table already finds in a story — quoted statements and figures with their
// units — kept across stories, each with where it came from, so a later banner can reuse it word for word.
//
// Nothing here invents anything. A quote's speaker is filled only when the sentence around it names one ("…," said
// Name, title); otherwise it stays unknown. A figure keeps the spelling it had in the story and the sentence it sat in.
//
// Storage (IndexedDB through outreach/idb.ts, memory when that is unavailable): one small index record with the ids and
// the fields a search needs, and one record per entry, so a change rewrites one entry and the index — never the whole
// library. Entries are written first and the index last, and every index row is checked against its entry on load, so a
// failed write (quota) leaves an index that only names entries that exist.

import { create } from 'zustand'
import { extractFactTable, KNOWN_ENERGY_ENTITIES } from './facts'
import { bengaliToAsciiDigits, parseBengaliAmount } from './bengali'
import { TAGS } from '../core/newsroom'
import { idbGet, idbSet, idbDel } from '../outreach/idb'
import { useEditorialStore } from './editorialStore'
import { useStoryQueue } from './storyQueue'
import { useStore } from '../store'
import type { Content } from '../core/types'

export type EntryKind = 'quote' | 'stat'

export interface LibraryEntry {
  id: string
  kind: EntryKind
  /** Quote: the statement verbatim, without its quotation marks. Stat: the figure as written ("Tk 592 crore"). */
  text: string
  /** Who said it, only when the sentence names them. */
  speaker?: string
  speakerTitle?: string
  /** Registry id of the speaker, when a registry name matched at harvest time. */
  speakerId?: string
  /** Organisation named in the attribution (quotes) or in the sentence (figures). */
  org?: string
  /** Stat: the normalised amount (currency in base units) and its unit (MW, MMCFD, %, BDT, USD…). */
  value?: number
  unit?: string
  /** The sentence the quote or figure sat in, verbatim. */
  sentence: string
  /** Which text it was harvested from: the English draft or the original source. */
  from: 'draft' | 'source'
  storyId: string
  /** Published location on esbpowerline.com, when known. */
  slug?: string
  url?: string
  /** The original article the story was made from, when it was a link. */
  sourceUrl?: string
  headline: string
  categoryId: string
  harvestedAt: number
  /** Other stories the same quote / figure was later found in (the first harvest is the one kept). */
  alsoIn?: string[]
}

export interface IndexRow { id: string; kind: EntryKind; text: string; speaker?: string; org?: string; storyId: string; harvestedAt: number }
interface IndexRecord { v: 1; rows: IndexRow[] }

export interface Speaker { id: string; name: string; title: string; org: string }

export const MAX_ENTRIES = 500
export const INDEX_KEY = 'esb-banner-studio/library/index/v1'
export const SPEAKERS_KEY = 'esb-banner-studio/library/speakers/v1'
export const entryKey = (id: string) => `esb-banner-studio/library/entry/${id}/v1`

// ---------------------------------------------------------------- storage seam (tests swap in a failing store)

export interface LibraryStorage { get: <T>(key: string) => Promise<T | undefined>; set: (key: string, value: unknown) => Promise<void>; del: (key: string) => Promise<void> }
const IDB: LibraryStorage = { get: idbGet, set: idbSet, del: idbDel }
let storage: LibraryStorage = IDB
export function setLibraryStorage(s: LibraryStorage | null) { storage = s ?? IDB }

// ---------------------------------------------------------------- text helpers

/** Bengali digits to ASCII, thousands separators out of numbers, curly quotes straight, lower case, single spaces. */
export function normText(s: string): string {
  return bengaliToAsciiDigits(s)
    .replace(/(\d),(?=\d)/g, '$1')
    .replace(/[“”«»]/g, '"').replace(/[‘’]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}
const normQuote = (s: string) => normText(s).replace(/^["'\s]+|["'\s.,;:!?…-]+$/g, '')

function hash(s: string): string {
  let a = 0x811c9dc5, b = 0x9747b28c
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    a = Math.imul(a ^ c, 16777619)
    b = Math.imul(b ^ c, 2246822507) ^ (b >>> 13)
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36)
}

const ABBREV = new Set(['md', 'dr', 'mr', 'mrs', 'ms', 'engr', 'prof', 'st', 'no', 'tk', 'jr', 'sr', 'lt', 'gen', 'col', 'maj', 'capt', 'govt', 'ltd', 'co', 'inc', 'vs', 'eg', 'ie', 'approx', 'est'])
function isBoundary(text: string, i: number): boolean {
  const ch = text[i]
  if (ch === '\n') return true
  if (!'.!?।'.includes(ch)) return false
  const next = text[i + 1]
  if (next !== undefined && !/[\s"”’']/.test(next)) return false
  if (ch !== '.') return true
  const word = /([\p{L}.]+)$/u.exec(text.slice(Math.max(0, i - 12), i))?.[1] ?? ''
  if (/^\p{Lu}$/u.test(word)) return false // an initial: "A. K. Azad"
  return !ABBREV.has(word.replace(/\./g, '').toLowerCase())
}

/** The sentence holding text[start, end): from the last boundary before it to the first one after it. */
export function sentenceAround(text: string, start: number, end: number): { text: string; from: number; to: number } {
  let from = 0
  for (let i = start - 1; i >= 0; i--) if (isBoundary(text, i)) { from = i + 1; break }
  let to = text.length
  for (let i = Math.max(end - 1, start); i < text.length; i++) {
    if (i < end - 1) continue
    if (isBoundary(text, i)) { to = text[i] === '\n' ? i : i + 1; break }
  }
  // a closing mark right after the full stop belongs to the sentence
  while (to < text.length && /["”’]/.test(text[to])) to++
  return { text: text.slice(from, to).replace(/\s+/g, ' ').trim(), from, to }
}

// ---------------------------------------------------------------- speakers

const ROLE = /^(?:Chairman|Chairperson|Chair|Minister|Secretary|Director|Adviser|Advisor|Spokesperson|Spokesman|Spokeswoman|CEO|MD|Engineer|Professor|President|Chief|Officer|Member|Governor|Commissioner|Manager|Head|Executive|General|Managing|State|Deputy|Additional|Joint|Senior|Acting)$/
const NOT_A_NAME = new Set(['He', 'She', 'They', 'It', 'We', 'I', 'You', 'The', 'This', 'That', 'These', 'Those', 'Officials', 'Sources', 'Experts', 'Residents', 'Locals', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Today', 'Yesterday', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'])
const W = String.raw`(?:\p{Lu}[\p{L}'’-]*\.?)`
const NAME = String.raw`${W}(?:\s+(?:${W}|bin|al|ul|uz|ud|de|van|der)){0,5}`
const VERB = String.raw`(?:said|says|told|added|stated|noted|remarked|explained|announced|declared|insisted|observed)`
const AFTER_SAID = new RegExp(String.raw`^[\s,.:;—–-]*${VERB}\s+(${NAME})(?:\s*,\s*([^,.;"“”]{2,90}))?`, 'u')
const AFTER_NAME = new RegExp(String.raw`^[\s,.:;—–-]*(${NAME})(?:\s*,\s*([^,"“”]{2,90}?)\s*,)?\s+${VERB}\b`, 'u')
const BEFORE = new RegExp(String.raw`(${NAME})(?:\s*,\s*([^,"“”]{2,90}?)\s*,)?\s+${VERB}(?:\s+[a-z][\w ]{0,30}?)?\s*[,:]?\s*$`, 'u')

function cleanTitle(t: string | undefined): string {
  if (!t) return ''
  return t.split(/\s+(?:on|at|in a|in an|while|during|when|after|before|told|said|yesterday|today)\b/)[0].replace(/^[\s,–—-]+|[\s,.;:–—-]+$/g, '').slice(0, 90)
}

/** Split "BERC Chairman Jalal Ahmed" into a title and a name; a name with no role words is all name. */
function splitRole(words: string[]): { name: string; title: string } {
  let last = -1
  words.forEach((w, i) => { if (ROLE.test(w.replace(/\.$/, ''))) last = i })
  if (last < 0) return { name: words.join(' '), title: '' }
  return { name: words.slice(last + 1).join(' '), title: words.slice(0, last + 1).join(' ') }
}

/** Every organisation name a sentence could carry: the registry's orgs and the fact table's energy-sector entities. */
function orgNames(speakers: Speaker[]): string[] {
  const set = new Set<string>([...KNOWN_ENERGY_ENTITIES, ...speakers.map((s) => s.org).filter(Boolean)])
  return [...set].sort((a, b) => b.length - a.length)
}
export function findOrg(text: string, speakers: Speaker[] = []): string | undefined {
  let best: { at: number; name: string } | undefined
  for (const name of orgNames(speakers)) {
    const m = new RegExp(String.raw`(^|[^\p{L}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\p{L}])`, 'u').exec(text)
    if (m && (!best || m.index < best.at)) best = { at: m.index, name }
  }
  return best?.name
}

/**
 * Who a quote is attributed to, read from the words around it in its sentence. Unknown (undefined) unless the sentence
 * names someone — "he said" stays unknown rather than guessing who "he" is.
 */
export function attribute(before: string, after: string): { name: string; title: string } | undefined {
  const pick = (name: string | undefined, title: string | undefined) => {
    if (!name) return undefined
    const words = name.trim().split(/\s+/)
    const split = splitRole(words)
    const nm = split.name.replace(/[.,]+$/, '')
    if (!nm || NOT_A_NAME.has(nm.split(' ')[0])) return undefined
    const t = [split.title, cleanTitle(title)].filter(Boolean).join(', ')
    return { name: nm, title: t }
  }
  let m = AFTER_SAID.exec(after)
  if (m) { const r = pick(m[1], m[2]); if (r) return r }
  m = AFTER_NAME.exec(after)
  if (m) { const r = pick(m[1], m[2]); if (r) return r }
  m = BEFORE.exec(before)
  if (m) { const r = pick(m[1], m[2]); if (r) return r }
  return undefined
}

const splitCamel = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2')

/** The organisations among the newsroom hashtags (TAGS): a tag that names a known energy-sector body (BERC, BPDB, Petrobangla, TitasGas…). */
export function orgsFromTags(): string[] {
  const out: string[] = []
  for (const tags of Object.values(TAGS)) {
    for (const t of tags) {
      const known = KNOWN_ENERGY_ENTITIES.some((e) => !e.includes(' ') && (t === e || (e.length >= 4 && t.startsWith(e))))
      const name = splitCamel(t)
      if (known && !out.includes(name)) out.push(name)
    }
  }
  return out
}

export function seedSpeakers(): Speaker[] {
  return orgsFromTags().map((org) => ({ id: 'org-' + normText(org).replace(/[^a-z0-9]+/g, '-'), name: org, title: '', org }))
}

const nameKey = (s: string) => normText(s).replace(/[^\p{L}\p{N} ]/gu, '').trim()
/** The registry id whose name matches (case, spacing and punctuation aside). */
export function linkSpeaker(name: string | undefined, speakers: Speaker[]): string | undefined {
  if (!name) return undefined
  const k = nameKey(name)
  return k ? speakers.find((s) => nameKey(s.name) === k)?.id : undefined
}

// ---------------------------------------------------------------- harvest (pure)

export interface HarvestInput {
  storyId: string
  headline: string
  categoryId: string
  slug?: string
  url?: string
  sourceUrl?: string
  /** The English draft (headline, deck, body). */
  draftText: string
  /** The original source text, any language. */
  sourceText?: string
  now?: number
}

const PAIRS: Record<string, string> = { '"': '"”', '“': '”"', '‘': '’', "'": "'" }
/** The fact table matches any quotation mark against any other; keep only real pairs, and a straight ' only at a word edge (not an apostrophe). */
function isRealQuote(text: string, offset: number, raw: string): boolean {
  const open = raw[0], close = raw[raw.length - 1]
  if (!PAIRS[open]?.includes(close)) return false
  if (open === "'" || open === '‘') {
    const prev = text[offset - 1]
    if (prev && /[\p{L}\p{N}]/u.test(prev)) return false
  }
  const after = text[offset + raw.length]
  if ((close === "'" || close === '’') && after && /[\p{L}]/u.test(after)) return false
  return true
}

const STOP = new Set(['of', 'a', 'an', 'the', 'to', 'for', 'by', 'at', 'in', 'on', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'with', 'from', 'as', 'than', 'about', 'some', 'total', 'nearly', 'around', 'over', 'almost', 'up', 'will', 'would', 'has', 'have', 'had', 'its', 'their', 'per'])
const CONJ = /^(?:and|but|while|whereas|although|which|who|that|or)$/i

/** A short label for a stat card, taken from the words next to the figure in its own sentence (never invented). */
export function statLabelFrom(sentence: string, figure: string): string {
  const at = sentence.indexOf(figure)
  if (at < 0) return ''
  const clip = (words: string[]) => {
    let out = ''
    for (const w of words) { if ((out + ' ' + w).trim().length > 48) break; out = (out + ' ' + w).trim() }
    return out
  }
  const trim = (words: string[]) => {
    while (words.length && STOP.has(words[0].toLowerCase())) words.shift()
    while (words.length && STOP.has(words[words.length - 1].toLowerCase())) words.pop()
    return words
  }
  // a suffix glued to the figure ("৫৯২ কোটি টাকায়" matched as "৫৯২ কোটি টাকা") belongs to it, not to the label
  const rest = sentence.slice(at + figure.length).replace(/^[\p{L}\p{M}]+/u, '')
  const tail = rest.split(/[,;:()—–]|\s[-–]\s|\d/)[0].replace(/[.!?।"”]+\s*$/, '').trim().split(/\s+/).filter(Boolean)
  const cut = tail.findIndex((w) => CONJ.test(w))
  let label = clip(trim(cut >= 0 ? tail.slice(0, cut) : tail))
  if (label.split(' ').length < 2) {
    // nothing usable after the figure: the words just before it, kept from the end
    const head = trim(sentence.slice(0, at).split(/[,;:()—–]/).pop()!.trim().split(/\s+/).filter(Boolean).slice(-7))
    while (head.join(' ').length > 48) head.shift()
    label = trim(head).join(' ')
  }
  return label ? label[0].toUpperCase() + label.slice(1) : ''
}

/** Entries from one story: each quoted statement and each figure with a unit, from the draft first, then the source. */
export function harvestStory(input: HarvestInput, speakers: Speaker[] = []): LibraryEntry[] {
  const now = input.now ?? Date.now()
  const out: LibraryEntry[] = []
  const seen = new Set<string>()
  const base = {
    storyId: input.storyId,
    headline: input.headline.trim() || 'Untitled story',
    categoryId: input.categoryId || '01',
    ...(input.slug ? { slug: input.slug } : {}),
    ...(input.url ? { url: input.url } : {}),
    ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
    harvestedAt: now,
  }
  const texts: { from: 'draft' | 'source'; text: string }[] = [{ from: 'draft', text: input.draftText }]
  if (input.sourceText && normText(input.sourceText) !== normText(input.draftText)) texts.push({ from: 'source', text: input.sourceText })

  for (const { from, text } of texts) {
    if (!text?.trim()) continue
    for (const f of extractFactTable(text)) {
      const at = f.sourceOffset ?? text.indexOf(f.raw)
      if (at < 0) continue
      if (f.kind === 'quote') {
        if (!isRealQuote(text, at, f.raw)) continue
        // the words exactly as printed; only the comma English puts before "said" is dropped ("…peak," said X)
        const quote = f.normalized.trim().replace(/,$/, '')
        const key = normQuote(quote)
        const id = 'q' + hash(`${input.storyId}|quote|${key}`)
        if (!key || seen.has(id)) continue
        seen.add(id)
        const s = sentenceAround(text, at, at + f.raw.length)
        const who = attribute(text.slice(s.from, at), text.slice(at + f.raw.length, s.to))
        const org = (who && (findOrg(who.name, speakers) === who.name ? who.name : findOrg(who.title, speakers))) || undefined
        const speakerId = linkSpeaker(who?.name, speakers)
        out.push({ id, kind: 'quote', text: quote, ...(who ? { speaker: who.name, speakerTitle: who.title } : {}), ...(speakerId ? { speakerId } : {}), ...(org ? { org } : {}), sentence: s.text, from, ...base })
      } else if (f.kind === 'number' || f.kind === 'currency') {
        // the unit pattern runs over ASCII digits; a Bengali digit is one character too, so the offsets hold
        const written = text.slice(at, at + f.raw.length).trim()
        let value: number, unit: string
        if (f.kind === 'currency') {
          const amt = parseBengaliAmount(f.raw)
          if (!amt || !amt.currency) continue
          value = amt.value; unit = amt.currency
        } else {
          const m = /^([\d.,]+)\s*(.+)$/.exec(f.normalized)
          if (!m) continue
          value = parseFloat(m[1].replace(/,/g, '')); unit = m[2]
        }
        if (!Number.isFinite(value)) continue
        const id = 's' + hash(`${input.storyId}|stat|${value}|${unit}`)
        if (seen.has(id)) continue
        seen.add(id)
        const s = sentenceAround(text, at, at + f.raw.length)
        const org = findOrg(s.text, speakers)
        out.push({ id, kind: 'stat', text: written, value, unit, ...(org ? { org } : {}), sentence: s.text, from, ...base })
      }
    }
  }
  return out
}

/** What makes two entries "the same" across stories: the statement for quotes; figure, unit and sentence for stats. */
export function dedupeKey(e: Pick<LibraryEntry, 'kind' | 'text' | 'value' | 'unit' | 'sentence'>): string {
  return e.kind === 'quote' ? 'q|' + normQuote(e.text) : `s|${e.value}|${e.unit}|${normText(e.sentence)}`
}

export interface MergeResult { entries: LibraryEntry[]; changed: LibraryEntry[]; evicted: string[]; added: string[]; updated: number; merged: number }

/**
 * Fold a story's harvest into the library. The same story harvested again updates its entries in place (provenance
 * only; harvestedAt stays). An entry another story already holds is kept as first harvested, and the new story is
 * noted in its `alsoIn`. Over MAX_ENTRIES, the oldest by harvestedAt go first.
 */
export function mergeHarvest(existing: LibraryEntry[], harvested: LibraryEntry[], max = MAX_ENTRIES): MergeResult {
  const byId = new Map(existing.map((e) => [e.id, e]))
  const byKey = new Map(existing.map((e) => [dedupeKey(e), e.id]))
  const changed = new Map<string, LibraryEntry>()
  const added: string[] = []
  let updated = 0, merged = 0
  for (const h of harvested) {
    const same = byId.get(h.id)
    if (same) {
      const next: LibraryEntry = { ...same, headline: h.headline, categoryId: h.categoryId, slug: h.slug ?? same.slug, url: h.url ?? same.url, sourceUrl: h.sourceUrl ?? same.sourceUrl, sentence: h.sentence }
      if (!same.speaker && h.speaker) Object.assign(next, { speaker: h.speaker, speakerTitle: h.speakerTitle, speakerId: h.speakerId, org: h.org ?? same.org })
      if (JSON.stringify(next) !== JSON.stringify(same)) { byId.set(h.id, next); changed.set(h.id, next); updated++ }
      continue
    }
    const k = dedupeKey(h)
    const holder = byKey.get(k)
    if (holder) {
      const e = byId.get(holder)!
      if (e.storyId !== h.storyId && !(e.alsoIn ?? []).includes(h.storyId)) {
        const next = { ...e, alsoIn: [...(e.alsoIn ?? []), h.storyId].slice(-10) }
        byId.set(e.id, next); changed.set(e.id, next)
      }
      merged++
      continue
    }
    byId.set(h.id, h); byKey.set(k, h.id); changed.set(h.id, h); added.push(h.id)
  }
  let entries = [...byId.values()]
  let evicted: string[] = []
  if (entries.length > max) {
    const order = [...entries].sort((a, b) => a.harvestedAt - b.harvestedAt || (a.id < b.id ? -1 : 1))
    evicted = order.slice(0, entries.length - max).map((e) => e.id)
    const gone = new Set(evicted)
    entries = entries.filter((e) => !gone.has(e.id))
    for (const id of evicted) changed.delete(id)
  }
  entries.sort((a, b) => b.harvestedAt - a.harvestedAt)
  return { entries, changed: [...changed.values()], evicted, added: added.filter((id) => !evicted.includes(id)), updated, merged }
}

// ---------------------------------------------------------------- search (pure)

export interface SearchFilters { kind?: EntryKind; speaker?: string; org?: string }

/** Case-insensitive search over the statement or figure, its sentence, the speaker and the organisation; Bengali digits match ASCII ones. */
export function searchEntries(entries: LibraryEntry[], query: string, filters: SearchFilters = {}, speakers: Speaker[] = []): LibraryEntry[] {
  const terms = normText(query).split(' ').filter(Boolean)
  const org = filters.org ? normText(filters.org) : ''
  return entries.filter((e) => {
    if (filters.kind && e.kind !== filters.kind) return false
    const sp = speakers.find((s) => s.id === (linkSpeaker(e.speaker, speakers) ?? e.speakerId))
    if (filters.speaker && sp?.id !== filters.speaker) return false
    if (org && normText(e.org ?? '') !== org && normText(sp?.org ?? '') !== org) return false
    if (!terms.length) return true
    const hay = normText([e.text, e.sentence, e.speaker, e.speakerTitle, e.org, sp?.name, sp?.title, sp?.org].filter(Boolean).join(' \u0001 '))
    return terms.every((t) => hay.includes(t))
  })
}

// ---------------------------------------------------------------- banner hand-off (pure)

export function quoteBannerPatch(e: LibraryEntry, speakers: Speaker[] = []): Partial<Content> {
  const sp = speakers.find((s) => s.id === (linkSpeaker(e.speaker, speakers) ?? e.speakerId))
  return { cardType: 'quote', quoteText: e.text, speakerName: sp?.name || e.speaker || '', speakerTitle: sp?.title || e.speakerTitle || '' }
}

/** statDelta is cleared: a change figure left from an earlier card would read as this figure's. */
export function statBannerPatch(e: LibraryEntry): Partial<Content> {
  return { cardType: 'stat', statNumber: e.text, statLabel: statLabelFrom(e.sentence, e.text), statDelta: '', statNote: `Source: ${e.headline}` }
}

// ---------------------------------------------------------------- persistence

const indexRow = (e: LibraryEntry): IndexRow => ({ id: e.id, kind: e.kind, text: e.text.slice(0, 200), ...(e.speaker ? { speaker: e.speaker } : {}), ...(e.org ? { org: e.org } : {}), storyId: e.storyId, harvestedAt: e.harvestedAt })

const isEntry = (v: unknown, id: string): v is LibraryEntry => {
  const e = v as LibraryEntry
  return !!e && typeof e === 'object' && e.id === id && (e.kind === 'quote' || e.kind === 'stat') && typeof e.text === 'string' && typeof e.sentence === 'string' && typeof e.harvestedAt === 'number'
}

/** Read the library. Index rows whose entry is missing or malformed are dropped (and the index rewritten without them). */
export async function loadLibrary(): Promise<{ entries: LibraryEntry[]; dropped: number }> {
  const idx = await storage.get<IndexRecord>(INDEX_KEY).catch(() => undefined)
  const rows = idx && Array.isArray(idx.rows) ? idx.rows.filter((r) => r && typeof r.id === 'string' && /^[a-z0-9]+$/.test(r.id)) : []
  const got = await Promise.all(rows.map((r) => storage.get<LibraryEntry>(entryKey(r.id)).catch(() => undefined)))
  const entries = got.filter((e, i): e is LibraryEntry => isEntry(e, rows[i].id))
  const dropped = (idx?.rows?.length ?? 0) - entries.length
  if (dropped > 0) await storage.set(INDEX_KEY, { v: 1, rows: entries.map(indexRow) } satisfies IndexRecord).catch(() => {})
  entries.sort((a, b) => b.harvestedAt - a.harvestedAt)
  return { entries, dropped }
}

/**
 * Write a merge: each changed entry first, then the index (leaving out a new entry whose write failed), then delete the
 * evicted. Returns the ids that could not be written.
 */
export async function saveMerge(m: Pick<MergeResult, 'entries' | 'changed' | 'evicted'>, previous: LibraryEntry[]): Promise<{ failed: string[]; entries: LibraryEntry[] }> {
  const failed: string[] = []
  for (const e of m.changed) {
    try { await storage.set(entryKey(e.id), e) } catch { failed.push(e.id) }
  }
  const prev = new Map(previous.map((e) => [e.id, e]))
  const lost = new Set(failed.filter((id) => !prev.has(id)))
  // an update that failed keeps the version already stored
  const entries = m.entries.filter((e) => !lost.has(e.id)).map((e) => (failed.includes(e.id) ? prev.get(e.id) ?? e : e))
  try { await storage.set(INDEX_KEY, { v: 1, rows: entries.map(indexRow) } satisfies IndexRecord) } catch {
    // the index on disk is the previous one: it names only entries that exist, so nothing is corrupted
    return { failed: m.changed.map((e) => e.id), entries: previous }
  }
  for (const id of m.evicted) await storage.del(entryKey(id)).catch(() => {})
  return { failed, entries }
}

export async function loadSpeakers(): Promise<Speaker[]> {
  const saved = await storage.get<Speaker[]>(SPEAKERS_KEY).catch(() => undefined)
  if (Array.isArray(saved)) return saved.filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string').map((s) => ({ id: s.id, name: s.name, title: s.title ?? '', org: s.org ?? '' }))
  const seeded = seedSpeakers()
  await storage.set(SPEAKERS_KEY, seeded).catch(() => {})
  return seeded
}
export async function saveSpeakers(list: Speaker[]): Promise<boolean> {
  try { await storage.set(SPEAKERS_KEY, list); return true } catch { return false }
}

// ---------------------------------------------------------------- store

export interface HarvestResult { found: number; added: number; updated: number; merged: number; failed: number }

interface LibraryState {
  loaded: boolean
  busy: boolean
  entries: LibraryEntry[]
  speakers: Speaker[]
  /** The outcome of the last harvest, shown once it has been written. */
  last: (HarvestResult & { at: number; trigger: 'manual' | 'published' }) | null
  load: () => Promise<void>
  harvest: (input: HarvestInput, trigger?: 'manual' | 'published') => Promise<HarvestResult>
  /** Harvest the story on the desk; `extra` carries what a publish knows (story id, slug, URL). */
  harvestActive: (extra?: { storyId?: string; slug?: string; url?: string; headline?: string; categoryId?: string }, trigger?: 'manual' | 'published') => Promise<HarvestResult>
  remove: (id: string) => Promise<void>
  editSpeaker: (id: string, patch: Partial<Omit<Speaker, 'id'>>) => Promise<void>
  addSpeaker: (s: Omit<Speaker, 'id'>) => Promise<Speaker | null>
  removeSpeaker: (id: string) => Promise<void>
  search: (query: string, filters?: SearchFilters) => LibraryEntry[]
}

let loading: Promise<void> | null = null
let chain: Promise<unknown> = Promise.resolve()
/** One write at a time: each read-merge-write sees the previous one's result. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.catch(() => {})
  return run
}

const httpUrl = (u: unknown) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u.slice(0, 500) : undefined)
const str = (v: unknown, max = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)

/** Add a speaker the harvest named and the registry does not know yet. */
function withNewSpeakers(list: Speaker[], entries: LibraryEntry[]): Speaker[] {
  let next = list
  for (const e of entries) {
    if (!e.speaker || linkSpeaker(e.speaker, next)) continue
    next = [...next, { id: 'sp' + hash(nameKey(e.speaker)), name: e.speaker, title: e.speakerTitle ?? '', org: e.org ?? '' }]
  }
  return next
}

export const useQuoteLibrary = create<LibraryState>((set, get) => ({
  loaded: false,
  busy: false,
  entries: [],
  speakers: [],
  last: null,

  load: () => (loading ??= (async () => {
    const [lib, speakers] = await Promise.all([loadLibrary(), loadSpeakers()])
    set({ entries: lib.entries, speakers, loaded: true })
  })()),

  harvest: (input, trigger = 'manual') => serial(async () => {
    await get().load()
    set({ busy: true })
    try {
      const speakers = get().speakers
      const found = harvestStory(input, speakers)
      const prev = get().entries
      const m = mergeHarvest(prev, found)
      const { failed, entries } = await saveMerge(m, prev)
      const nextSpeakers = withNewSpeakers(speakers, m.changed.filter((e) => !failed.includes(e.id)))
      if (nextSpeakers !== speakers && (await saveSpeakers(nextSpeakers))) set({ speakers: nextSpeakers })
      const res: HarvestResult = { found: found.length, added: m.added.filter((id) => !failed.includes(id)).length, updated: m.updated, merged: m.merged, failed: failed.length }
      set({ entries, last: { ...res, at: Date.now(), trigger } })
      return res
    } finally {
      set({ busy: false })
    }
  }),

  harvestActive: (extra = {}, trigger = 'manual') => {
    const q = useStoryQueue.getState()
    q.saveActive()
    const { activeId, stories } = useStoryQueue.getState()
    const storyId = str(extra.storyId, 80) ?? activeId ?? 'desk'
    const item = stories.find((s) => s.id === storyId)
    // a publish event for a story that is no longer on the desk harvests that story's own saved copy
    const snap = item && storyId !== activeId ? item.snapshot : (() => { const e = useEditorialStore.getState(); return { draft: e.draft, source: e.source } })()
    const d = snap.draft
    return get().harvest({
      storyId,
      headline: str(extra.headline) ?? (d.headline.trim() || snap.source?.title?.trim() || 'Untitled story'),
      categoryId: str(extra.categoryId, 8) ?? useStore.getState().doc.content.categoryId,
      slug: str(extra.slug, 120) ?? item?.publishedSlug,
      url: httpUrl(extra.url) ?? httpUrl(item?.publishedUrl),
      sourceUrl: httpUrl(snap.source?.url),
      draftText: [d.headline, d.deck, d.body].filter((t) => t?.trim()).join('\n\n'),
      sourceText: snap.source?.rawText ?? '',
    }, trigger)
  },

  remove: (id) => serial(async () => {
    await get().load()
    const prev = get().entries
    const entries = prev.filter((e) => e.id !== id)
    try {
      await storage.set(INDEX_KEY, { v: 1, rows: entries.map(indexRow) } satisfies IndexRecord)
    } catch { return }
    await storage.del(entryKey(id)).catch(() => {})
    set({ entries })
  }),

  editSpeaker: (id, patch) => serial(async () => {
    await get().load()
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, (v as string).trim().slice(0, 120)]))
    const next = get().speakers.map((s) => (s.id === id ? { ...s, ...clean } : s))
    if (await saveSpeakers(next)) set({ speakers: next })
  }),

  addSpeaker: (s) => serial(async () => {
    await get().load()
    const name = s.name.trim().slice(0, 120)
    if (!name || linkSpeaker(name, get().speakers)) return null
    const sp: Speaker = { id: 'sp' + hash(nameKey(name)), name, title: s.title.trim().slice(0, 120), org: s.org.trim().slice(0, 120) }
    const next = [...get().speakers, sp]
    if (!(await saveSpeakers(next))) return null
    set({ speakers: next })
    return sp
  }),

  removeSpeaker: (id) => serial(async () => {
    await get().load()
    const next = get().speakers.filter((s) => s.id !== id)
    if (await saveSpeakers(next)) set({ speakers: next })
  }),

  search: (query, filters = {}) => searchEntries(get().entries, query, filters, get().speakers),
}))

// dev server only, for the Editorial e2e (same pattern as __editorialStore)
if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV && typeof window !== 'undefined') Object.assign(window, { __quoteLibrary: useQuoteLibrary })

let installed = false
/**
 * Harvest the story when its publish completes (DECISIONS D9: the publish flow dispatches `esb:story-published`).
 * A dry run published nothing, so it records nothing.
 */
export function installPublishHarvest() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('esb:story-published', (ev) => {
    const d = (ev as CustomEvent).detail as Record<string, unknown> | null
    if (!d || typeof d !== 'object' || d.dryRun === true) return
    void useQuoteLibrary.getState().harvestActive({ storyId: str(d.storyId, 80), slug: str(d.slug, 120), url: httpUrl(d.url), headline: str(d.headline), categoryId: str(d.categoryId, 8) }, 'published')
  })
}
