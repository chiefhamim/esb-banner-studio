// Shared network translation race: tries Google GTX and MyMemory concurrently
// under one short deadline and returns whichever succeeds first, or null if
// neither does. Racing (instead of trying them one after another) halves the
// worst-case latency before falling back to the offline path.

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
  const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 500))}&langpair=bn|en`, { signal })
  if (!res.ok) return null
  const data = await res.json()
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
