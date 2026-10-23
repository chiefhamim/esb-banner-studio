// Design tokens extracted 1:1 from the ESB News Banner templates in Figma.
// Everything colour-related that changes per category lives in CATEGORIES; everything else is constant.

export type FormatId = 'fb45' | 'sq' | 'social' | 'web' | 'yt' | 'story' | 'lower-third' | 'title-card' | 'end-card'

export interface IconPathDef {
  d: string
  stroke?: string // '$ink' is replaced by the chip text colour at build time
  strokeWidth?: number
  fill?: string
  fillOpacity?: number
}

export interface Category {
  id: string // '01'..'10'
  name: string
  chip: string // text shown in the category chip (upper case)
  accent: string // chip, edge line, rules, footer lines, panel edge
  band: string // social headline band tint
  footer: string // footer background
  chipText: string // text + icon colour on the chip
  panel: [string, string] // web panel gradient (top -> bottom)
  icon: IconPathDef[] // 26 x 26 viewBox, stroke icons
}

const S = 2.05833 // icon stroke width in the 26px viewBox
const ink = '$ink'
const p = (d: string): IconPathDef => ({ d, stroke: ink, strokeWidth: S })

export const CATEGORIES: Category[] = [
  {
    id: '01', name: 'Energy Policy & Regulators', chip: 'ENERGY POLICY & REGULATORS',
    accent: '#4f46e5', band: '#eae9fc', footer: '#262268', chipText: '#ffffff', panel: ['#efeefd', '#d5d3f9'],
    icon: [
      p('M3.25 10.8333L13 4.33325L22.75 10.8333H3.25Z'),
      p('M5.95837 10.8333V19.4999M10.6167 10.8333V19.4999M15.3834 10.8333V19.4999M20.0417 10.8333V19.4999'),
      p('M3.25 22.2083H22.75'),
    ],
  },
  {
    id: '02', name: 'Power Generation', chip: 'POWER GENERATION',
    accent: '#1e40af', band: '#e4e8f5', footer: '#111f51', chipText: '#ffffff', panel: ['#ebeef8', '#c9d1ec'],
    icon: [
      p('M3.25 22.7499V10.8333L9.75 15.1666V10.8333L16.25 15.1666V4.33325H20.5833V22.7499H3.25Z'),
      p('M3.25 22.75H22.75'),
    ],
  },
  {
    id: '03', name: 'Fossil Fuels & Commodities', chip: 'FOSSIL FUELS & COMMODITIES',
    accent: '#f59e0b', band: '#fef3e2', footer: '#6b470c', chipText: '#2e1f1f', panel: ['#fef6e9', '#fde8c4'],
    icon: [
      p('M13 3.25C16.4667 7.58333 19.5 10.8333 19.5 15.1667C19.5 16.8906 18.8152 18.5439 17.5962 19.7629C16.3772 20.9818 14.7239 21.6667 13 21.6667C11.2761 21.6667 9.62279 20.9818 8.40381 19.7629C7.18482 18.5439 6.5 16.8906 6.5 15.1667C6.5 10.8333 9.53333 7.58333 13 3.25Z'),
    ],
  },
  {
    id: '04', name: 'Renewables & Nuclear', chip: 'RENEWABLES & NUCLEAR',
    accent: '#10b981', band: '#e2f7f0', footer: '#0b523e', chipText: '#2e1f1f', panel: ['#e9f9f4', '#c6eee1'],
    icon: [
      p('M12.9998 17.3334C15.3931 17.3334 17.3332 15.3933 17.3332 13.0001C17.3332 10.6068 15.3931 8.66675 12.9998 8.66675C10.6066 8.66675 8.6665 10.6068 8.6665 13.0001C8.6665 15.3933 10.6066 17.3334 12.9998 17.3334Z'),
      p('M13 3.25V5.95833M13 20.5833V23.2917M3.25 13H5.95833M20.5833 13H23.2917M6.06667 6.06667L8.01667 8.01667M17.9833 17.9833L19.9333 19.9333M6.06667 19.9333L8.01667 17.9833M17.9833 8.01667L19.9333 6.06667'),
    ],
  },
  {
    id: '05', name: 'Grid & Transmission', chip: 'GRID & TRANSMISSION',
    accent: '#0ea5e9', band: '#e2f4fc', footer: '#0a4a69', chipText: '#ffffff', panel: ['#e9f7fd', '#c5e9fa'],
    icon: [
      p('M7.04102 22.75L12.9993 3.25L18.9577 22.75'),
      p('M8.88301 16.2499H17.1163M10.6163 10.8333H15.383M4.33301 7.58325H21.6663'),
    ],
  },
  {
    id: '06', name: 'Distribution & Utilities', chip: 'DISTRIBUTION & UTILITIES',
    accent: '#14b8a6', band: '#e3f6f4', footer: '#0d524d', chipText: '#2e1f1f', panel: ['#eaf9f7', '#c7eeea'],
    icon: [
      p('M9.75 3.25V8.66667M16.25 3.25V8.66667'),
      p('M7.04163 8.66663H18.9583V11.9166C18.9583 13.4969 18.3305 15.0124 17.2131 16.1298C16.0957 17.2472 14.5802 17.875 13 17.875C11.4197 17.875 9.90419 17.2472 8.78678 16.1298C7.66938 15.0124 7.04163 13.4969 7.04163 11.9166V8.66663Z'),
      p('M13 17.875V22.75'),
    ],
  },
  {
    id: '07', name: 'Consumers & Tariffs', chip: 'CONSUMERS & TARIFFS',
    accent: '#ef4444', band: '#fde9e9', footer: '#692124', chipText: '#ffffff', panel: ['#feeeee', '#fbd2d2'],
    icon: [
      p('M3.25 13.5417V4.33337H12.4583L22.75 14.625L14.0833 23.2917L3.25 13.5417Z'),
      p('M8.12495 10.5083C8.84292 10.5083 9.42495 9.9263 9.42495 9.20833C9.42495 8.49035 8.84292 7.90833 8.12495 7.90833C7.40698 7.90833 6.82495 8.49035 6.82495 9.20833C6.82495 9.9263 7.40698 10.5083 8.12495 10.5083Z'),
    ],
  },
  {
    id: '08', name: 'Market, Finance & Subsidies', chip: 'MARKET, FINANCE & SUBSIDIES',
    accent: '#ec4899', band: '#fde9f3', footer: '#682348', chipText: '#ffffff', panel: ['#fdeff6', '#fad3e7'],
    icon: [
      p('M3.25 22.75H22.75'),
      p('M6.5 22.75V16.25M11.9167 22.75V10.8334M17.3333 22.75V13'),
      p('M4.3335 8.66671L9.75016 4.33337L14.0835 7.58337L20.5835 2.70837'),
    ],
  },
  {
    id: '09', name: 'International & Cross-Border', chip: 'INTERNATIONAL & CROSS-BORDER',
    accent: '#6366f1', band: '#ecedfd', footer: '#2e2f6d', chipText: '#ffffff', panel: ['#f1f1fe', '#dadafc'],
    icon: [
      p('M13 22.75C18.3848 22.75 22.75 18.3848 22.75 13C22.75 7.61522 18.3848 3.25 13 3.25C7.61522 3.25 3.25 7.61522 3.25 13C3.25 18.3848 7.61522 22.75 13 22.75Z'),
      p('M3.25 13H22.75'),
      p('M12.9998 3.25C15.8165 6.06667 17.3332 9.31667 17.3332 13C17.3332 16.6833 15.8165 19.9333 12.9998 22.75C10.1832 19.9333 8.6665 16.6833 8.6665 13C8.6665 9.31667 10.1832 6.06667 12.9998 3.25Z'),
    ],
  },
  {
    id: '10', name: 'Environment & Efficiency', chip: 'ENVIRONMENT & EFFICIENCY',
    accent: '#0d9488', band: '#e2f2f1', footer: '#0a4341', chipText: '#ffffff', panel: ['#e9f5f4', '#c5e5e2'],
    icon: [
      p('M5.41699 20.5833C5.41699 11.9166 10.8337 6.49996 21.667 5.41663C21.667 16.25 16.2503 21.6666 7.58366 21.6666L5.41699 20.5833Z'),
      p('M5.41699 20.5833C8.66699 15.1667 11.917 11.9167 16.2503 9.75'),
    ],
  },
]

export const getCategory = (id: string): Category => CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[0]

// ---- constants shared by every template ----
export const INK = '#2e1f1f'
export const WEEKDAY_RED = '#8a1820'
export const FOOTER_TEXT = '#ffffff'
export const STRIPE_COLORS = ['#1e9b4a', '#e52d2d', '#ec8e3c'] as const
export const SOCIAL_BG = '#fdfbdc' // social header + page background
export const WEB_HEADER = '#fffce1'
export const LINK_PILL = '#e52d2d'

/** Headline accent used for the highlighted key phrase: the category accent darkened to 72.5 %. */
export function darkAccent(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const f = 0.725
  const r = Math.round(((n >> 16) & 255) * f)
  const g = Math.round(((n >> 8) & 255) * f)
  const b = Math.round((n & 255) * f)
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
}

export interface FormatDef {
  id: FormatId
  /** menu name */
  name: string
  /** short name for tight spaces / file names */
  short: string
  ratio: string
  w: number
  h: number
  /** stack = header / photo / headline band / footer;  split = photo + side panel; overlay = broadcast transparent overlay; card = full-bleed title/end card */
  family: 'stack' | 'split' | 'overlay' | 'card'
  tag?: string
  note: string
  file: string
}

/** Facebook 4:5 and 1:1 are the sizes the team already publishes (the YoY grid cards); 1598 x 1431 is the original Figma template. */
export const FORMAT_LIST: FormatDef[] = [
  { id: 'fb45', name: 'Facebook Feed', short: 'Facebook', ratio: '4:5', w: 1080, h: 1350, family: 'stack', tag: 'Recommended', note: 'Biggest footprint in the mobile feed — same size as the YoY cards', file: 'facebook-4x5' },
  { id: 'story', name: 'Story / Reel', short: 'Story', ratio: '9:16', w: 1080, h: 1920, family: 'stack', tag: 'Vertical', note: 'Vertical 9:16 for Facebook Stories, Instagram Stories & WhatsApp', file: 'story-9x16' },
  { id: 'sq', name: 'Square', short: 'Square', ratio: '1:1', w: 1080, h: 1080, family: 'stack', note: 'Facebook, Instagram, WhatsApp, X — same size as the YoY square card', file: 'square' },
  { id: 'social', name: 'Facebook Classic', short: 'Classic', ratio: '8:7', w: 1598, h: 1431, family: 'stack', tag: 'Legacy', note: 'Original Figma template — an unusual ratio Facebook has to resample', file: 'facebook-classic' },
  { id: 'web', name: 'Web Hero', short: 'Web', ratio: '16:9', w: 1920, h: 1080, family: 'split', note: 'Website hero and presentations', file: 'web' },
  { id: 'yt', name: 'YouTube Thumbnail', short: 'YouTube', ratio: '16:9', w: 1280, h: 720, family: 'split', tag: 'New', note: 'Video thumbnail — YouTube’s recommended 1280 × 720', file: 'youtube-thumbnail' },
  { id: 'lower-third', name: 'Lower Third', short: 'Lower 3rd', ratio: '16:9', w: 1920, h: 1080, family: 'overlay', tag: 'Overlay', note: 'Transparent 1920 × 1080 video overlay with speaker/topic card', file: 'lower-third' },
  { id: 'title-card', name: 'Title Card', short: 'Title Card', ratio: '16:9', w: 1920, h: 1080, family: 'card', tag: 'Video', note: 'Opening title card for video packages (1920 × 1080)', file: 'title-card' },
  { id: 'end-card', name: 'End Card', short: 'End Card', ratio: '16:9', w: 1920, h: 1080, family: 'card', tag: 'Video', note: 'Closing card with subscribe & social links (1920 × 1080)', file: 'end-card' },
]

export const FORMAT_IDS: FormatId[] = FORMAT_LIST.map((f) => f.id)
export const getFormat = (id: FormatId): FormatDef => FORMAT_LIST.find((f) => f.id === id) ?? FORMAT_LIST[0]

export const FORMATS = Object.fromEntries(
  FORMAT_LIST.map((f) => [f.id, { w: f.w, h: f.h, label: `${f.name} (${f.w} × ${f.h})`, file: f.file }]),
) as Record<FormatId, { w: number; h: number; label: string; file: string }>

export interface OptimalImageSpace {
  w: number
  h: number
  ratioStr: string
  ratioVal: number
  deduction: string
  shortDeduction: string
  tip: string
}

/** Precomputed corner-to-corner image body dimensions after deducting header, footer and headline bands for every template. */
export const OPTIMAL_IMAGE_SPACES: Record<FormatId, OptimalImageSpace> = {
  fb45: {
    w: 1080,
    h: 719,
    ratioStr: '3:2 (1.50 : 1)',
    ratioVal: 1080 / 719,
    deduction: '1080×1350 canvas − Header (220px) − Footer & Band (411px) = 1080×719 px',
    shortDeduction: '1080×1350 − 220px (header) − 411px (footer/band)',
    tip: 'Insert a 1080 × 719 px (3:2 ratio) image to fill corner-to-corner without any crop.',
  },
  sq: {
    w: 1080,
    h: 519,
    ratioStr: '2.08 : 1 (approx 2:1)',
    ratioVal: 1080 / 519,
    deduction: '1080×1080 canvas − Header (208px) − Footer & Band (353px) = 1080×519 px',
    shortDeduction: '1080×1080 − 208px (header) − 353px (footer/band)',
    tip: 'Insert a 1080 × 519 px (~2:1 panorama) image to fill corner-to-corner without any crop.',
  },
  story: {
    w: 1080,
    h: 1135,
    ratioStr: '0.95 : 1 (approx 1:1)',
    ratioVal: 1080 / 1135,
    deduction: '1080×1920 canvas − Header (244px) − Footer & Band (541px) = 1080×1135 px',
    shortDeduction: '1080×1920 − 244px (header) − 541px (footer/band)',
    tip: 'Insert a 1080 × 1135 px (near-square) image to fill corner-to-corner without any crop.',
  },
  social: {
    w: 1598,
    h: 740,
    ratioStr: '2.16 : 1 (approx 19:9)',
    ratioVal: 1598 / 740,
    deduction: '1598×1431 canvas − Header (297px) − Footer & Band (394px) = 1598×740 px',
    shortDeduction: '1598×1431 − 297px (header) − 394px (footer/band)',
    tip: 'Insert a 1598 × 740 px image to fill corner-to-corner without any crop.',
  },
  web: {
    w: 1280,
    h: 800,
    ratioStr: '16:10 (1.60 : 1)',
    ratioVal: 1280 / 800,
    deduction: '1920×1080 canvas − Side Panel (640px) − Header & Footer (280px) = 1280×800 px',
    shortDeduction: '1920×1080 − 640px (side panel) − 280px (header/footer)',
    tip: 'Insert a 1280 × 800 px (16:10 landscape) image to fill corner-to-corner without any crop.',
  },
  yt: {
    w: 853,
    h: 533,
    ratioStr: '16:10 (1.60 : 1)',
    ratioVal: 853 / 533,
    deduction: '1280×720 canvas − Side Panel (427px) − Header & Footer (187px) = 853×533 px',
    shortDeduction: '1280×720 − 427px (side panel) − 187px (header/footer)',
    tip: 'Insert an 853 × 533 px (16:10 landscape) image to fill corner-to-corner without any crop.',
  },
  'lower-third': {
    w: 160,
    h: 160,
    ratioStr: '1:1 (Square)',
    ratioVal: 1,
    deduction: '1920×1080 overlay − 160×160 speaker badge slot',
    shortDeduction: '160×160 avatar / speaker badge',
    tip: 'Transparent overlay: speaker photo badge slot is 160 × 160 px.',
  },
  'title-card': {
    w: 1280,
    h: 720,
    ratioStr: '16:9 (1.78 : 1)',
    ratioVal: 16 / 9,
    deduction: '1920×1080 card − Title header & margin deduction',
    shortDeduction: '1280×720 feature image area',
    tip: 'Insert a 16:9 image to serve as the background / feature photo.',
  },
  'end-card': {
    w: 640,
    h: 640,
    ratioStr: '1:1 (Square)',
    ratioVal: 1,
    deduction: '1920×1080 card − Channel promo and subscribe area',
    shortDeduction: '640×640 feature promo slot',
    tip: 'Insert square promo graphic or leave default channel graphics.',
  },
}

export function formatRatio(w: number, h: number): string {
  const r = w / h
  if (Math.abs(r - 1.5) < 0.04) return '3:2 (1.50 : 1)'
  if (Math.abs(r - 1.6) < 0.04) return '16:10 (1.60 : 1)'
  if (Math.abs(r - 1.777) < 0.04) return '16:9 (1.78 : 1)'
  if (Math.abs(r - 1.333) < 0.04) return '4:3 (1.33 : 1)'
  if (Math.abs(r - 1.0) < 0.05) return '1:1 (Square)'
  return `${r.toFixed(2)} : 1`
}

