import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { renderBanner } from '../export'
import type { Assets } from '../core/render'
import type { FormatId } from '../core/types'

/**
 * A live object URL of the banner rendered in one format, for previews that show the banner as a picture (the web
 * article's hero is the 16:9 Web banner, as the Facebook post shows the 4:5 one). Re-rendered a moment after the
 * banner stops changing, at a preview scale, and the previous URL is released.
 */
export function useBannerImage(base: Assets | null, format: FormatId, scale = 0.5): string | null {
  const doc = useStore((s) => s.doc)
  const images = useStore((s) => s.images)
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!base) return
    let live = true
    let made: string | null = null
    const t = setTimeout(() => {
      renderBanner(doc, format, base, scale, 'jpeg', 0.88)
        .then((blob) => {
          if (!live) return
          made = URL.createObjectURL(blob)
          setUrl(made)
        })
        .catch(() => { /* keep the last good render */ })
    }, 250)
    return () => {
      live = false
      clearTimeout(t)
      // release this render once the next one has replaced it
      if (made) { const old = made; setTimeout(() => URL.revokeObjectURL(old), 1000) }
    }
  }, [base, doc, images, format, scale])
  return url
}
