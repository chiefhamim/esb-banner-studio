// Brand kit: the few choices that make a video look like ESB Power Line. Fonts are fixed by the design system (Inter for
// English, Hind Siliguri for Bangla), so they are shown, not edited. Saved on this PC; applied when a template builds a
// video, and the logo-bug corner is stored in the project so the export draws it where the editor chose.
export type BugCorner = 'tr' | 'tl' | 'br' | 'bl'
export const BUG_CORNERS: { id: BugCorner; label: string }[] = [
  { id: 'tr', label: 'Top right' },
  { id: 'tl', label: 'Top left' },
  { id: 'br', label: 'Bottom right' },
  { id: 'bl', label: 'Bottom left' },
]

export interface BrandKit {
  /** 'stripes' (the three ESB stripes), 'auto' (the story's category colour) or a category id '01'..'08'. */
  accent: string
  bugOn: boolean
  bugCorner: BugCorner
  /** Close with the ESB end card (logo, esbpowerline.com, handles) instead of a caption. */
  endCard: boolean
}

export const DEFAULT_BRAND: BrandKit = { accent: 'auto', bugOn: true, bugCorner: 'tr', endCard: true }
export const BRAND_FONTS = { english: 'Inter (ESB Sans)', bangla: 'Hind Siliguri' } as const
const KEY = 'esb-banner-studio/video/brand/v1'
const CATEGORY_IDS = ['01', '02', '03', '04', '05', '06', '07', '08']

export function sanitizeBrand(raw: unknown): BrandKit {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const accent = typeof o.accent === 'string' && (o.accent === 'stripes' || o.accent === 'auto' || CATEGORY_IDS.includes(o.accent)) ? o.accent : DEFAULT_BRAND.accent
  const corner = BUG_CORNERS.some((c) => c.id === o.bugCorner) ? (o.bugCorner as BugCorner) : DEFAULT_BRAND.bugCorner
  return { accent, bugOn: o.bugOn !== false, bugCorner: corner, endCard: o.endCard !== false }
}

export function loadBrand(storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage !== 'undefined' ? localStorage : undefined): BrandKit {
  try { return sanitizeBrand(JSON.parse(storage?.getItem(KEY) ?? 'null')) } catch { return { ...DEFAULT_BRAND } }
}

export function saveBrand(b: BrandKit, storage: Pick<Storage, 'setItem'> | undefined = typeof localStorage !== 'undefined' ? localStorage : undefined) {
  try { storage?.setItem(KEY, JSON.stringify(sanitizeBrand(b))) } catch { /* storage full or off: the kit just is not remembered */ }
}

/** The accent a title or banner uses for a story: undefined = the three ESB stripes. */
export function accentFor(brand: BrandKit, storyCategory: string | null): string | undefined {
  if (brand.accent === 'stripes') return undefined
  if (brand.accent === 'auto') return storyCategory ?? undefined
  return brand.accent
}
