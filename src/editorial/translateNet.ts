// Shared network translation race: tries Google GTX and MyMemory concurrently
// under one short deadline and returns whichever succeeds first, or null if
// neither does. Racing (instead of trying them one after another) halves the
// worst-case latency before falling back to the offline path.
//
// Long text is never sent whole. MyMemory accepts 500 characters, and the race used to hand it a paragraph cut to
// its first 500: whenever MyMemory answered first, the rest of the paragraph vanished from the translation without a
// trace — "the bottom few sentences are missing". Text is now split at sentence ends into chunks each service can
// take in full, every chunk is translated, and MyMemory is only asked about text it can translate completely.

/** MyMemory's free endpoint translates at most 500 characters per request. */
export const MYMEMORY_MAX = 500
/**
 * GTX is a GET: every Bengali character becomes nine URL characters (three UTF-8 bytes, percent-encoded), and Google
 * refuses very long request lines. 900 Bengali characters keeps the URL near 8 kB.
 */
export const GTX_MAX = 900

const SENTENCE_END = /(?<=[।?!.৷॥])\s+|(?<=[।?!৷॥])(?=\S)/

/**
 * Splits text into pieces no longer than `max`, cutting at sentence ends (Bengali danda, ?, !, .) and only falling back
 * to word boundaries for a single sentence longer than `max`. Joining the pieces with a space gives back the text.
 */
export function chunkForTranslation(text: string, max = MYMEMORY_MAX - 20): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  if (clean.length <= max) return [clean]
  const sentences = clean.split(SENTENCE_END).map((s) => s.trim()).filter(Boolean)
  const out: string[] = []
  let cur = ''
  const push = (s: string) => { if (s) out.push(s) }
  for (const s of sentences) {
    if (s.length > max) {
      push(cur); cur = ''
      // one very long sentence: break between words
      let piece = ''
      for (const w of s.split(' ')) {
        if (piece && piece.length + 1 + w.length > max) { push(piece); piece = w } else piece = piece ? `${piece} ${w}` : w
      }
      cur = piece
      continue
    }
    if (cur && cur.length + 1 + s.length > max) { push(cur); cur = s } else cur = cur ? `${cur} ${s}` : s
  }
  push(cur)
  return out
}

async function gtxTranslate(text: string, signal: AbortSignal): Promise<string | null> {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=bn&tl=en&dt=t&q=${encodeURIComponent(text)}`
  const res = await fetch(url, { signal })
  if (!res.ok) return null
  const data = await res.json()
  if (!Array.isArray(data?.[0])) return null
  const joined = data[0].map((seg: unknown[]) => (typeof seg?.[0] === 'string' ? seg[0] : '')).join('')
  return joined.trim() || null
}

async function myMemoryTranslate(text: string, signal: AbortSignal): Promise<string | null> {
  // never truncate: a partial translation presented as a whole one is worse than none
  if (text.length > MYMEMORY_MAX) return null
  const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=bn|en`, { signal })
  if (!res.ok) return null
  const data = await res.json()
  if (data?.responseStatus && Number(data.responseStatus) !== 200) return null
  const tr = data.responseData?.translatedText
  return typeof tr === 'string' && tr.trim() ? tr : null
}

/** Races both translation endpoints under one deadline; returns as soon as either succeeds, or null once both are exhausted. */
export function raceTranslate(text: string, budgetMs = 2200): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), budgetMs)
  const attempts = [gtxTranslate(text, controller.signal), myMemoryTranslate(text, controller.signal)]

  return new Promise<string | null>((resolve) => {
    let pending = attempts.length
    const finish = (value: string | null) => {
      clearTimeout(timer)
      resolve(value)
    }
    for (const attempt of attempts) {
      attempt
        .then((value) => {
          if (value) finish(value)
          else if (--pending === 0) finish(null)
        })
        .catch(() => {
          if (--pending === 0) finish(null)
        })
    }
  })
}

/**
 * Translates text of any length completely: sentence-sized chunks, each raced across both services, in parallel.
 * A chunk neither service answered stays in Bengali, in place, so the draft is visibly incomplete (and the desk flags
 * it) instead of quietly shorter. Returns null only when nothing at all could be translated.
 */
export async function translateComplete(text: string, budgetMs = 4000): Promise<string | null> {
  const chunks = chunkForTranslation(text)
  if (!chunks.length) return ''
  const parts = await Promise.all(chunks.map((c) => raceTranslate(c, budgetMs)))
  if (parts.every((p) => !p)) return null
  return parts.map((p, i) => (p ?? chunks[i]).trim()).join(' ')
}
