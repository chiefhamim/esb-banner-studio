// News engine (shared, identical in ESB Studio PC src/news and ESB Studio Phone src/mobile/watch; tools/sync-pc.mjs news).
// An English line under each Bangla headline, from the free machine translation, so a desk that reads English can scan the
// list. Never in the way: the list shows at once and lines fill in as they arrive; headlines are sent in a few batched
// requests (one line per headline), each answer is kept per item key, and nothing is sent twice. The translate function
// is passed in (each app has its own network path); this file only batches, splits and caches.

export type HeadlineCache = Record<string, string>

export const hasBangla = (s: string) => /[ঀ-৿]/.test(s)

interface Row { key: string; title: string; titleEn?: string }

/** Rows (newest first, as given) whose Bangla headline has no English line yet, at most `limit`. */
export function headlinesToTranslate(items: Row[], cache: HeadlineCache, limit = 120): Row[] {
  const out: Row[] = []
  for (const x of items) {
    if (out.length >= limit) break
    if (!x.titleEn && !cache[x.key] && hasBangla(x.title)) out.push(x)
  }
  return out
}

/** Headlines in groups whose joined text (one per line) stays under maxChars. */
export function batchHeadlines(rows: Row[], maxChars = 800): Row[][] {
  const batches: Row[][] = []
  let cur: Row[] = []
  let len = 0
  for (const r of rows) {
    const t = r.title.replace(/\s+/g, ' ').trim()
    if (cur.length && len + t.length + 1 > maxChars) { batches.push(cur); cur = []; len = 0 }
    cur.push(r)
    len += t.length + 1
  }
  if (cur.length) batches.push(cur)
  return batches
}

/**
 * English for each row, by key. A batch is one request with one headline per line; when the answer does not come back as
 * the same number of lines, that batch is asked headline by headline instead (never a line given to the wrong story).
 */
export async function translateHeadlines(
  rows: Row[],
  translate: (text: string) => Promise<string | null>,
  opts: { concurrency?: number; maxChars?: number } = {},
): Promise<HeadlineCache> {
  const out: HeadlineCache = {}
  const batches = batchHeadlines(rows, opts.maxChars)
  const one = async (r: Row) => {
    try {
      const en = (await translate(r.title.replace(/\s+/g, ' ').trim()))?.trim()
      if (en && !hasBangla(en)) out[r.key] = en
    } catch { /* left without an English line */ }
  }
  let i = 0
  const worker = async () => {
    while (i < batches.length) {
      const batch = batches[i++]
      if (batch.length === 1) { await one(batch[0]); continue }
      let lines: string[] = []
      try {
        const res = await translate(batch.map((r) => r.title.replace(/\s+/g, ' ').trim()).join('\n'))
        lines = (res ?? '').split(/\n+/).map((l) => l.trim()).filter(Boolean)
      } catch { /* fall through to one by one */ }
      if (lines.length === batch.length) {
        batch.forEach((r, j) => { if (!hasBangla(lines[j])) out[r.key] = lines[j] })
      } else {
        for (const r of batch) await one(r)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 2, batches.length) }, worker))
  return out
}

/** The items with their English lines from the cache; the same array when nothing changed (no re-render). */
export function applyHeadlineCache<T extends Row>(items: T[], cache: HeadlineCache): T[] {
  let changed = false
  const next = items.map((x) => {
    const en = cache[x.key]
    if (!en || x.titleEn === en) return x
    changed = true
    return { ...x, titleEn: en }
  })
  return changed ? next : items
}

/** The cache cut to the keys still listed (and at most `cap` entries), so storage does not grow without end. */
export function trimHeadlineCache(cache: HeadlineCache, keep: Iterable<string>, cap = 3000): HeadlineCache {
  const out: HeadlineCache = {}
  let n = 0
  for (const k of keep) {
    if (n >= cap) break
    if (cache[k]) { out[k] = cache[k]; n++ }
  }
  return out
}
