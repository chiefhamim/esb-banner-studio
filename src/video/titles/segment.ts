// Text segmentation for titles: grapheme clusters (for type-on) and break tokens (for line breaking and word-by-word
// animation), both safe for Bangla.
//
// Graphemes come from Intl.Segmenter. ICU 74+ (Unicode 15.1, rule GB9c) keeps a Bangla conjunct such as ক্ষ or স্ত্র in
// one cluster; an older engine splits it after the hasanta (্, U+09CD), so `graphemes` joins a cluster that ends with
// the hasanta to the consonant cluster after it. A ZWNJ after the hasanta (an explicit visible hasanta) is an Extend
// character, so it stays in the first cluster, which then no longer ends with the hasanta: no join.

const HASANTA = '্'
// consonants ক..হ, ড় ঢ় য় (precomposed), ৰ ৱ
const BN_CONSONANT = /^[ক-হড়ঢ়য়ৰৱ]/

const hasSegmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
const graphemeSeg = hasSegmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null
const wordSegCache = new Map<string, Intl.Segmenter>()
function wordSeg(locale: string | undefined): Intl.Segmenter | null {
  if (!hasSegmenter) return null
  const k = locale ?? ''
  let s = wordSegCache.get(k)
  if (!s) { s = new Intl.Segmenter(locale, { granularity: 'word' }); wordSegCache.set(k, s) }
  return s
}

export const hasBanglaText = (s: string) => /[ঀ-৿]/.test(s)

export interface Piece { text: string; start: number }

function withOffsets(parts: string[]): Piece[] {
  let at = 0
  return parts.map((text) => { const p = { text, start: at }; at += text.length; return p })
}

/** Grapheme clusters of `text` with their UTF-16 start offsets. A conjunct is never split. */
export function graphemes(text: string): Piece[] {
  return joinConjuncts(graphemeSeg ? [...graphemeSeg.segment(text)].map((s) => ({ text: s.segment, start: s.index })) : withOffsets(Array.from(text)))
}

/** Join a cluster ending in the hasanta to the consonant cluster after it (engines without GB9c split conjuncts). */
export function joinConjuncts(raw: Piece[]): Piece[] {
  const out: Piece[] = []
  for (const p of raw) {
    const prev = out[out.length - 1]
    if (prev && prev.text.endsWith(HASANTA) && BN_CONSONANT.test(p.text)) prev.text += p.text
    else out.push({ ...p })
  }
  return out
}

/** A break token: text that is never broken across lines (a word with the punctuation that clings to it).
 * `spaceBefore` is true when whitespace separates it from the previous token in the same paragraph. */
export interface Token { text: string; start: number; spaceBefore: boolean }

/** Split one paragraph (no newlines) into break tokens using Intl.Segmenter words: a segment starts a new token only
 * after whitespace (or after a hyphen / en dash ending the previous token, so "Battery-" / "Powered" may break);
 * punctuation stays glued to the token before it, so a line never starts with "," or "।". */
export function breakTokens(para: string, locale?: string): Token[] {
  const seg = wordSeg(locale ?? (hasBanglaText(para) ? 'bn' : undefined))
  const parts: Piece[] = seg ? [...seg.segment(para)].map((s) => ({ text: s.segment, start: s.index })) : withOffsets(para.match(/\s+|[^\s]+/g) ?? [])
  const out: Token[] = []
  let sawSpace = false
  for (const p of parts) {
    if (/^\s+$/.test(p.text)) { sawSpace = true; continue }
    const cur = out[out.length - 1]
    const afterDash = !!cur && /[-–]$/.test(cur.text) && !/^[-–]+$/.test(cur.text)
    if (cur && !sawSpace && !afterDash) cur.text += p.text
    else out.push({ text: p.text, start: p.start, spaceBefore: sawSpace && !!cur })
    sawSpace = false
  }
  return out
}
