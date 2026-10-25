// The picture settings of a publish: for the website banner and for the Facebook banner, the size (scale), the format
// and the quality — the same choices as Export. Remembered between launches. The website's media library takes up to
// 4 MB (JPEG, PNG or WebP); Facebook takes JPEG or PNG.

import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { renderBanner } from '../export'
import { useStore } from '../store'
import type { ExportType } from '../export'
import type { Assets } from '../core/render'
import type { FormatId } from '../core/types'

export interface ImageOpts { scale: number; type: ExportType; quality: number }
export type Dest = 'web' | 'fb'

export const SCALES = [1, 1.5, 2, 3]
export const TYPES_FOR: Record<Dest, { id: ExportType; name: string }[]> = {
  web: [{ id: 'jpeg', name: 'JPG' }, { id: 'webp', name: 'WebP' }, { id: 'png', name: 'PNG' }],
  fb: [{ id: 'jpeg', name: 'JPG' }, { id: 'png', name: 'PNG' }],
}
export const FORMAT_OF: Record<Dest, FormatId> = { web: 'web', fb: 'fb45' }
export const SIZE_OF: Record<Dest, { w: number; h: number }> = { web: { w: 1920, h: 1080 }, fb: { w: 1080, h: 1350 } }
export const WEB_LIMIT = 4 * 1024 * 1024

const KEY = 'esb-banner-studio/publish-image'
const DEFAULT: Record<Dest, ImageOpts> = { web: { scale: 1, type: 'jpeg', quality: 0.9 }, fb: { scale: 1, type: 'jpeg', quality: 0.9 } }

function load(): Record<Dest, ImageOpts> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Record<Dest, Partial<ImageOpts>>> | null
    const one = (d: Dest): ImageOpts => {
      const o = v?.[d]
      const type = TYPES_FOR[d].some((t) => t.id === o?.type) ? (o!.type as ExportType) : DEFAULT[d].type
      const scale = SCALES.includes(o?.scale as number) ? (o!.scale as number) : DEFAULT[d].scale
      const quality = typeof o?.quality === 'number' && o.quality >= 0.5 && o.quality <= 1 ? o.quality : DEFAULT[d].quality
      return { scale, type, quality }
    }
    return { web: one('web'), fb: one('fb') }
  } catch {
    return DEFAULT
  }
}

interface PublishImageState { opts: Record<Dest, ImageOpts>; set: (d: Dest, patch: Partial<ImageOpts>) => void }
export const usePublishImage = create<PublishImageState>((set, get) => ({
  opts: load(),
  set: (d, patch) => {
    const opts = { ...get().opts, [d]: { ...get().opts[d], ...patch } }
    set({ opts })
    try { localStorage.setItem(KEY, JSON.stringify(opts)) } catch { /* ignore */ }
  },
}))

/** Pixel size of a banner at these settings. */
export const pixelSize = (d: Dest, o: ImageOpts) => ({ w: Math.round(SIZE_OF[d].w * o.scale), h: Math.round(SIZE_OF[d].h * o.scale) })

export const humanSize = (bytes: number) => (bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB')

/** The file size these settings produce for the banner as it is now (a real render, a moment after the settings stop changing). */
export function useImageBytes(base: Assets | null, d: Dest, o: ImageOpts): number | null {
  const doc = useStore((s) => s.doc)
  const images = useStore((s) => s.images)
  const [bytes, setBytes] = useState<number | null>(null)
  useEffect(() => {
    if (!base) return
    let live = true
    setBytes(null)
    const t = setTimeout(() => {
      renderBanner(doc, FORMAT_OF[d], base, o.scale, o.type, o.quality).then((b) => { if (live) setBytes(b.size) }).catch(() => { if (live) setBytes(null) })
    }, 450)
    return () => { live = false; clearTimeout(t) }
  }, [base, doc, images, d, o.scale, o.type, o.quality])
  return bytes
}
