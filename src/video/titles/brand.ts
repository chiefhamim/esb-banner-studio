// ESB brand constants for video titles: the only fixed words a title may carry (the brand's own name and handles),
// the category palette, the brand stripes, type roles and safe areas.

import { hasBanglaText } from './segment'
import type { FontSpec } from './layout'

/** The brand's own name and handles (VIDEO_PRO_PLAN Phase 3). These, and the fixed labels below, are the only text a
 * template supplies itself; everything else comes from the editor's fields or the published data. */
export const ESB_BRAND = {
  name: 'ESB Power Line',
  kicker: 'ESB POWER LINE',
  site: 'esbpowerline.com',
  facebook: 'esbpowerlineofficial',
  youtube: '@esbplbd',
} as const

/** Fixed strap labels (words of the format, not content). */
export const FIXED_LABELS = {
  breaking: { en: 'BREAKING', bn: 'ব্রেকিং' },
  source: { en: 'Source:', bn: 'সূত্র:' },
  facebook: 'Facebook',
  youtube: 'YouTube',
} as const

/** The decorative opening quote mark on a quote card (typography, not words). */
export const QUOTE_MARK = '“'

/** Every fixed string a template may emit (tests check template output against this and the inputs). */
export const BRAND_TEXT: ReadonlySet<string> = new Set<string>([
  ESB_BRAND.name, ESB_BRAND.kicker, ESB_BRAND.site, ESB_BRAND.facebook, ESB_BRAND.youtube,
  FIXED_LABELS.breaking.en, FIXED_LABELS.breaking.bn, FIXED_LABELS.facebook, FIXED_LABELS.youtube,
  `${FIXED_LABELS.facebook} ${ESB_BRAND.facebook}`, `${FIXED_LABELS.youtube} ${ESB_BRAND.youtube}`,
  QUOTE_MARK,
])

/** The sector palette 01–08 (CLAUDE.md §6). NOTE: Editorial/Graphics stories carry the site's 10 categories
 * (src/core/tokens.ts CATEGORIES, different ids and colours); Phase 3 decides which one a story's strap follows —
 * `resolveAccent` takes an explicit colour first, so a story's own accent always wins. */
export const CATEGORY_PALETTE: Record<string, { name: string; color: string }> = {
  '01': { name: 'Power Generation', color: '#00E5FF' },
  '02': { name: 'Gas & Petroleum', color: '#FF9100' },
  '03': { name: 'Transmission & Grid', color: '#FFEA00' },
  '04': { name: 'Renewable Energy', color: '#00E676' },
  '05': { name: 'Energy Finance & Economy', color: '#7C4DFF' },
  '06': { name: 'Policy & Regulation', color: '#FF1744' },
  '07': { name: 'Regional Energy Trade', color: '#2979FF' },
  '08': { name: 'Technology & Efficiency', color: '#E040FB' },
}

/** The ESB three stripes (green, red, orange), used when no category is set — same as compositor.ts. */
export const ESB_STRIPES = ['#1e9b4a', '#e52d2d', '#ec8e3c'] as const

/** An explicit hex wins, then a 01–08 category id, else null (= the ESB stripes). */
export function resolveAccent(a: { accent?: string | null; categoryId?: string | null }): string | null {
  if (a.accent && /^#[0-9a-f]{3,8}$/i.test(a.accent)) return a.accent
  if (a.categoryId && CATEGORY_PALETTE[a.categoryId]) return CATEGORY_PALETTE[a.categoryId].color
  return null
}

/** Ink that reads on a given accent (WCAG relative luminance; the bright palette colours take near-black). */
export function inkOn(hex: string): string {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6)
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return L > 0.36 ? '#0b0b0e' : '#ffffff'
}

// ------------------------------------------------------------------ type roles (CLAUDE.md §8)

export type TypeRole = 'headline' | 'label' | 'body' | 'number' | 'kicker'

const LATIN = '"ESB Sans", Inter, sans-serif'
const BANGLA = '"Hind Siliguri", "ESB Sans", Inter, sans-serif'

/** The font for `text` in a role at `size` px. Latin: Inter (ESB Sans) — 800 headlines and numbers, 700 labels and
 * uppercase kickers (tracking .09em), 500 body; headlines 118 % leading, numbers −.02em. Bangla: Hind Siliguri, no
 * letter spacing (it would pull conjuncts apart), +2 px leading (CLAUDE.md §8). */
export function fontFor(text: string, role: TypeRole, size: number, opts: { italic?: boolean; leading?: number } = {}): FontSpec {
  const bn = hasBanglaText(text)
  const weight = role === 'body' ? 500 : role === 'label' || role === 'kicker' ? 700 : 800
  const leading = opts.leading ?? (role === 'body' ? 1.4 : role === 'number' ? 1.05 : role === 'label' || role === 'kicker' ? 1.25 : 1.18)
  const ls = bn ? 0 : role === 'kicker' ? 0.09 * size : role === 'number' ? -0.02 * size : 0
  return {
    family: bn ? BANGLA : LATIN,
    weight: bn && weight === 800 ? 700 : weight, // Hind Siliguri ships up to 700
    size,
    letterSpacing: ls,
    lineHeight: Math.round(size * leading) + (bn ? 2 : 0),
    italic: opts.italic,
    metrics: bn ? 'bengali' : 'inter',
  }
}

/** Upper-case a kicker only for Latin text (Bangla has no case). */
export const kickerCase = (s: string) => (hasBanglaText(s) ? s : s.toUpperCase())

// ------------------------------------------------------------------ frames and safe areas

export type Aspect = '16:9' | '9:16' | '4:5' | '1:1'
export const FRAME_SIZES: Record<Aspect, { w: number; h: number }> = {
  '16:9': { w: 1920, h: 1080 },
  '9:16': { w: 1080, h: 1920 },
  '4:5': { w: 1080, h: 1350 },
  '1:1': { w: 1080, h: 1080 },
}

export function aspectOf(w: number, h: number): Aspect {
  const r = w / h
  const best = (Object.keys(FRAME_SIZES) as Aspect[]).map((a) => ({ a, d: Math.abs(FRAME_SIZES[a].w / FRAME_SIZES[a].h - r) })).sort((x, y) => x.d - y.d)
  return best[0].a
}

export type Platform = 'reels' | 'shorts'

/** Fractions of the frame kept clear of critical text. */
export interface Zone { top: number; right: number; bottom: number; left: number }

export interface SafeZoneConfig {
  /** Title-safe share of the frame (0.9 = 5 % margin each side). */
  titleSafe: number
  /** Platform UI zones (9:16 feeds): caption, buttons, handle. Applied on top of title-safe. */
  platforms: Record<Platform, Zone>
}

/** Defaults: bottom ~20 % (caption, music line, handle) and a right-edge strip (like / comment / share column) clear
 * on 9:16 Reels and Shorts; a small top band for the header icons. Config, not law: the editor can change it. */
export const DEFAULT_SAFE_ZONES: SafeZoneConfig = {
  titleSafe: 0.9,
  platforms: {
    reels: { top: 0.08, right: 0.13, bottom: 0.2, left: 0 },
    shorts: { top: 0.08, right: 0.14, bottom: 0.2, left: 0 },
  },
}

export interface Rect { x: number; y: number; w: number; h: number }

/** The rectangle critical text must stay inside. */
export function safeRect(w: number, h: number, opts: { platform?: Platform | null; config?: SafeZoneConfig } = {}): Rect {
  const cfg = opts.config ?? DEFAULT_SAFE_ZONES
  const m = (1 - cfg.titleSafe) / 2
  let x0 = w * m, y0 = h * m, x1 = w * (1 - m), y1 = h * (1 - m)
  const z = opts.platform ? cfg.platforms[opts.platform] : null
  if (z) {
    x0 = Math.max(x0, w * z.left); y0 = Math.max(y0, h * z.top)
    x1 = Math.min(x1, w * (1 - z.right)); y1 = Math.min(y1, h * (1 - z.bottom))
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
