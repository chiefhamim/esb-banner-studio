// EnergyWatch's headline matcher, copied from EnergyWatch (Yeasin, src/matcher.js, office copy of 2026-11-05) and typed for
// this app. The rules are unchanged; only the types and the KwKind union are new. Its own test cases (scripts/test-matcher.mjs)
// are in matcher.test.ts and run against the keyword list bundled in ewSources.ts.
//
// Keyword kinds:
//   strong  - always keep (Bangladesh-specific names: BPDB, Tarique Rahman ...)
//   general - keep unless the headline is about another country (see rules)
//   bd      - Bangladesh context words (Bangladesh, Dhaka, import, থেকে ...)
//   foreign - foreign places (India, ভারত, US ...)
//   person  - foreign leaders (Modi, Trump, মোদি ...)
//   block   - always drop (tear gas ...)
//
// Rules, in order:
//   1. Fewer than 3 words (tag pages like "এলপিজি দাম"), or any block word -> drop.
//   2. Any strong keyword -> keep.
//   3. Energy general keyword -> keep (energy news from abroad is wanted too).
//   4. PM / President keyword -> keep, unless every occurrence is a foreign or non-government one and there is no Bangladesh
//      context word.
//
// Matching:
//   English - whole word. ALL-CAPS acronyms (PM, LNG, US) are case-sensitive. Foreign / BD words also match simple endings.
//   Bangla  - substring, so inflections match (বিদ্যুৎ -> বিদ্যুতের; ৎ also matches ত). Foreign / BD / leader words must start a word.

export type KwKind = 'strong' | 'general' | 'bd' | 'foreign' | 'person' | 'block'
export interface EwKeyword { term: string; kind: KwKind | string; category?: string | null }
export interface EwFeed { id: number; name: string; url: string; on: boolean }
export interface MatchResult { categories: string[]; matched: string[] }

const BN_LETTER = '[\\u0980-\\u09FF]'
const ASCII = /^[\x00-\x7F]+$/
const ACRONYM = /^[A-Z0-9]{2,}$/
const ENDINGS = '(?:n|ns|i|is|ian|ians|ese)?'
const MIN_WORDS = 3

const PUNCT_END = /[\s"'‘’“”()[\],:;.!?–—-]+$/
const PUNCT_START = /^[\s"'‘’“”()[\],:;.!?–—-]+/
const FILLER_END = /(?:^|\s)(?:new|former|ex|late|then|the|outgoing|incoming|acting|deputy|নতুন|সাবেক|নবনির্বাচিত|তৎকালীন|প্রয়াত|ভারপ্রাপ্ত)$/i
const ACRONYM_OR_NUMBER = /^(?:[A-Z]{2,}|\d[\d:.]*)$/
const ORG_WORD = /^(?:vice|club|association|chamber|party|union|committee|federation|council|society|university|college|bank|company|league|unit|branch|district|upazila|city|bar|press|board|group|forum|foundation|chapter|wing)$/i
const BN_ORG_END = /(?:^|[\s"'‘’“”()[\],:;.!?–—-])(?:ব্যাংক|ব্যাংকের|ক্লাব|ক্লাবের|সমিতি|সমিতির|ফেডারেশন|ফেডারেশনের|চেম্বার|চেম্বারের|অ্যাসোসিয়েশন|অ্যাসোসিয়েশনের|ইউনিয়ন|ইউনিয়নের|পরিষদ|পরিষদের|বিশ্ববিদ্যালয়|বিশ্ববিদ্যালয়ের|কলেজ|কলেজের|বোর্ড|বোর্ডের|কমিটি|কমিটির|বিশ্বব্যাংক|বিশ্বব্যাংকের|এডিবি|এডিবির|আইএমএফ|ফিফা|বিসিবি|বাফুফে|বিজিএমইএ|এফবিসিসিআই)$/i

const CAPITALISED = /^[A-Z][a-z][A-Za-z.'’-]*$/
const BD_SIDE = new RegExp(
  String.raw`\b(?:envoy|envoys|ambassador|high commissioner|embassy|delegation|PMO|press wing|press secretary|advis[eo]rs?|visits?|visiting|leaves|arrives|returns|meets|meeting|talks|phone|invites?|invitation|summit|UNGA|dinner|photos?|bilateral|ties|trip|tour)\b` +
  '|হাইকমিশনার|রাষ্ট্রদূত|দূতাবাস|প্রতিনিধি|প্রেস উইং|প্রধানমন্ত্রীর কার্যালয়|উপদেষ্টা|সফর|সাক্ষাৎ|বৈঠক|আলোচনা|ফোন|আমন্ত্রণ|সম্মেলন|জাতিসংঘ|নৈশভোজ|ছবি|যাচ্ছেন|পৌঁছ|ফিরলেন|ফিরছেন|দ্বিপক্ষীয়|সম্পর্ক|চুক্তি|সমঝোতা|বলেছেন|বললেন|নির্দেশ|উদ্বোধন|করবেন|আহ্বান|আহবান', 'i')
const STARTS_WITH_TITLE = /^(?:PM|Prime Minister|President)\b/
const BN_SPEAKER = /[:：]\s*(?:প্রধানমন্ত্রী|রাষ্ট্রপতি)\s*$/
const bdSide = (title: string) => BD_SIDE.test(title) || BN_SPEAKER.test(title) || STARTS_WITH_TITLE.test(title.replace(/^[^A-Za-z]+/, ''))
const OWN_NAME = /^(?:Tarique|Tareque|Tarek|Hasina|Sheikh|Khaleda|Yunus|Zia|Ziaur|Rahman|Mujib|Mujibur|Shahabuddin|Muhammad|Md|Zubaida|Jamaat)$/i
const isTitleCase = (s: string) => { const w = s.split(/\s+/).filter((x) => x.length > 3); return w.length >= 4 && w.filter((x) => /^[A-Z]/.test(x)).length / w.length >= 0.7 }
const OWN_PREFIX = /^(?:Bangladesh|Bangladeshi|BD|Dhaka|Interim|Caretaker|Honourable|Hon|Prime|Chief|Our|Govt|Government|Cabinet|National|Today|Yesterday|Tomorrow|Live|Breaking|Watch|Exclusive|Video|Photos|Update|Updated|Report|Says|Why|How|What)$/i

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const bnVariants = (t: string) => [...new Set([t, t.replaceAll('ৎ', 'ত')])].map(escapeRe).join('|')

interface Group { any: (s: string) => boolean; atEnd: (s: string) => boolean; atStart: (s: string) => boolean }

function compileGroup(terms: string[], kind: string): Group {
  const context = kind === 'foreign' || kind === 'bd' || kind === 'person'
  const ci: string[] = []
  const cs: string[] = []
  const bn: string[] = []
  for (const raw of terms) {
    const t = raw.trim()
    if (!t) continue
    if (!ASCII.test(t)) bn.push(bnVariants(t))
    else if (ACRONYM.test(t)) cs.push(escapeRe(t))
    else ci.push(escapeRe(t) + (kind === 'foreign' || kind === 'bd' ? ENDINGS : ''))
  }
  const defs: [string, string][] = []
  if (ci.length) defs.push([`\\b(?:${ci.join('|')})\\b`, 'i'])
  if (cs.length) defs.push([`\\b(?:${cs.join('|')})\\b`, ''])
  if (bn.length) defs.push([`${context ? `(?<!${BN_LETTER})` : ''}(?:${bn.join('|')})`, ''])

  const cache: Record<string, RegExp[]> = {}
  const build = (name: string, pre: string, post: string) => (cache[name] ??= defs.map(([src, flags]) => new RegExp(pre + src + post, flags)))
  return {
    any: (s) => build('any', '', '').some((re) => re.test(s)),
    atEnd: (s) => build('end', '', '\\S*$').some((re) => re.test(s)),
    atStart: (s) => build('start', '^', '').some((re) => re.test(s)),
  }
}

interface Term { re: RegExp; source: string; flags: string; term: string; category: string; ascii: boolean }

function compileTerm(k: EwKeyword): Term {
  const t = k.term.trim()
  const ascii = ASCII.test(t)
  const source = ascii ? `\\b${escapeRe(t)}\\b` : `(?:${bnVariants(t)})`
  const flags = ascii && !ACRONYM.test(t) ? 'i' : ''
  return { re: new RegExp(source, flags), source, flags, term: k.term, category: k.category || 'energy', ascii }
}

export function buildMatcher(keywordRows: EwKeyword[]): (title: string) => MatchResult | null {
  const byKind: Record<KwKind, EwKeyword[]> = { strong: [], general: [], bd: [], foreign: [], person: [], block: [] }
  for (const k of keywordRows) if (k.kind in byKind && k.term && k.term.trim()) byKind[k.kind as KwKind].push(k)
  const group = (kind: KwKind) => compileGroup(byKind[kind].map((k) => k.term), kind)

  const block = group('block')
  const bd = group('bd')
  const foreign = group('foreign')
  const person = group('person')
  const anyKeyword = compileGroup([...byKind.strong, ...byKind.general].map((k) => k.term), 'general')
  const strong = byKind.strong.map(compileTerm)
  const general = byKind.general.map(compileTerm)

  function ownLeader(title: string, start: number, end: number, ascii: boolean, diplomaticBd = false): boolean {
    let before = title.slice(0, start).replace(PUNCT_END, '')
    const filler = before.match(FILLER_END)
    if (filler) before = before.slice(0, filler.index).replace(PUNCT_END, '')
    if (before && BN_ORG_END.test(before)) return false
    if (ascii && title.slice(start, end) === 'president') return false
    if (ascii) {
      const prev = before.split(/\s+/).pop() || ''
      if (ACRONYM_OR_NUMBER.test(prev) || ORG_WORD.test(prev)) return false
      if (!diplomaticBd && CAPITALISED.test(prev) && !OWN_PREFIX.test(prev)) return false
    }
    if (!diplomaticBd && before && (foreign.atEnd(before) || person.atEnd(before))) return false
    const after = title.slice(end).replace(/^\S*/, '').replace(PUNCT_START, '')
    if (!diplomaticBd && after && person.atStart(after)) return false
    if (ascii) {
      const rest = title.slice(end)
      const of = rest.match(/^\s+of\s+(?:the\s+)?([A-Z][A-Za-z]+)/)
      if (of && !OWN_PREFIX.test(of[1])) return false
      const nm = rest.match(/^\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)/)
      if (!diplomaticBd && nm && !OWN_NAME.test(nm[1]) && !isTitleCase(title)) return false
    }
    return true
  }

  return function match(rawTitle: string) {
    const title = (rawTitle || '').trim()
    if (!title || title.split(/\s+/).length < MIN_WORDS) return null
    if (!anyKeyword.any(title)) return null
    if (block.any(title)) return null

    const strongHits = strong.filter((x) => x.re.test(title))
    let hits = general.filter((x) => x.re.test(title))

    const hasBd = bd.any(title)
    const hasBdSide = bdSide(title)
    const diplomaticBd = hasBd && hasBdSide
    const abroad = foreign.any(title) || person.any(title)
    // Always verify general leadership keywords ("PM", "Prime Minister", "President", "প্রধানমন্ত্রী", "রাষ্ট্রপতি")
    // so foreign leaders or club/bank/chamber presidents are never misclassified under PM & President, even when
    // the headline also contains an energy keyword or a Bangladesh context word like "থেকে" or "ঢাকা".
    hits = hits.filter((x) => {
      if (x.category !== 'leadership') return true
      for (const m of title.matchAll(new RegExp(x.source, x.flags + 'g'))) {
        if (ownLeader(title, m.index!, m.index! + m[0].length, x.ascii, diplomaticBd) && (!abroad || hasBdSide || hasBd)) return true
      }
      return false
    })
    if (!strongHits.length && !hits.length) return null

    const all = [...strongHits, ...hits]
    return {
      categories: [...new Set(all.map((x) => x.category))].sort(),
      matched: [...new Set(all.map((x) => x.term))],
    }
  }
}
