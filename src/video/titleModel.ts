// Title clips (Phase 3): the data a title clip carries on the timeline, how a project file's copy of it is cleaned,
// and how the Phase 0–2 overlay titles (lower third, headline, text card, breaking) become title clips.
//
// Pure and dependency-light (timeline.ts imports it for the file sanitizer). Building the picture from this data is
// titleClip.ts (the ESB kit in titles/kit.ts) and engine/titleRaster.ts (the compositor's texture).
//
// A title clip is an overlay clip (kind 'overlay', no file) with `titleData`. Its words are the editor's fields, word
// for word; the kit adds only the brand's fixed words (titles/brand.ts). A migrated Phase 0–2 overlay keeps its
// classic look (`look: 'classic'`), drawn by the same code as before, so an old project looks exactly as it did.

import { CATEGORIES } from '../core/tokens'

export type TitleTemplate = 'lower-third' | 'name-strap' | 'headline' | 'breaking' | 'quote' | 'source' | 'end-card' | 'text-card' | 'sticker' | 'data-number' | 'data-chart'
export type ClassicType = 'lower-third' | 'headline' | 'breaking' | 'card'
export type PlatformChoice = 'auto' | 'reels' | 'shorts' | 'none'
export type AnimPresetId = 'none' | 'fade' | 'type-on' | 'word' | 'line' | 'slide-up' | 'slide-left' | 'slide-right' | 'scale' | 'mask' | 'blur'
export type EaseId = 'esb' | 'easeOut' | 'easeInOut' | 'linear' | 'easeOutBack'
export type StickerShape = 'arrow' | 'circle' | 'highlight' | 'underline' | 'box' | 'callout'
export type StickerColor = 'red' | 'orange' | 'green' | 'yellow' | 'white' | 'ink' | 'accent'

/** An in or out animation chosen in the inspector, replacing the kit's own for the title's words. */
export interface AnimOverride {
  preset: AnimPresetId
  /** Seconds each unit takes (type-on: ignored, its pace is the stagger). */
  duration: number
  delay: number
  /** Seconds between units (words, lines, letters). */
  stagger: number
  ease: EaseId
}

/** The look of the title's words (the kit's own when a value is unset). Colours are #rrggbb. */
export interface StyleOverride {
  fill?: string
  /** A second colour: the words get a left-to-right gradient from `fill` to this. */
  fill2?: string
  stroke?: string
  /** Outline width in px at 1080 (scaled with the frame). */
  strokeWidth?: number
  shadow?: boolean
  /** A box behind the words. */
  box?: string
}

export interface StickerData {
  shape: StickerShape
  color: StickerColor
  /** Centre, as fractions of the frame. */
  x: number
  y: number
  /** Length (arrow, underline, highlight) or width, as a fraction of the frame's short side. */
  size: number
  /** Degrees. */
  rotation: number
}

export interface TitleData {
  template: TitleTemplate
  /** The editor's words, by field key (see TITLE_TEMPLATES). Never filled in by the app. */
  fields: Record<string, string>
  /** A Phase 0–2 overlay title, drawn exactly as before (no animation). */
  look?: 'classic'
  /** For look 'classic': which of the old overlays. */
  classic?: ClassicType
  /** The site's story category (src/core/tokens.ts, '01'–'10'): its accent colours the strap. Unset: the clip's own
   * accent (a story's), else the ESB three stripes. */
  categoryId?: string
  /** 9:16 feeds: which platform's UI zones the title keeps clear of ('auto' = Reels on a portrait frame). */
  platform?: PlatformChoice
  animIn?: AnimOverride
  animOut?: AnimOverride
  style?: StyleOverride
  sticker?: StickerData
}

export interface TitleFieldDef {
  key: string
  label: string
  required: boolean
  multiline?: boolean
}

export interface TemplateDef {
  label: string
  /** One line for the Titles tab. */
  desc: string
  fields: TitleFieldDef[]
  /** Offered in the Titles tab (the classic text card is not: it exists only in older projects). */
  kit: boolean
  /** Timeline tint. */
  color: string
  /** Default seconds on screen. */
  seconds: number
}

/** The kit. Field labels are the kit's editor-only labels (titles/kit.ts KIT_LABELS): what an empty field shows on the
 * monitor, never in an export. */
export const TITLE_TEMPLATES: Record<TitleTemplate, TemplateDef> = {
  'lower-third': { label: 'Lower third', desc: 'Names the person speaking: name and role on a dark panel, with the ESB kicker.', kit: true, color: '#10b981', seconds: 6, fields: [{ key: 'name', label: 'Speaker name', required: true }, { key: 'role', label: 'Role or organisation', required: false }] },
  'name-strap': { label: 'Name strap', desc: 'A name alone on a compact strap.', kit: true, color: '#14b8a6', seconds: 5, fields: [{ key: 'name', label: 'Speaker name', required: true }] },
  headline: { label: 'Headline card', desc: 'The headline over the lower half on a dark ramp, with an optional kicker.', kit: true, color: '#dc2626', seconds: 6, fields: [{ key: 'headline', label: 'Headline', required: true, multiline: true }, { key: 'kicker', label: 'Kicker (optional)', required: false }] },
  breaking: { label: 'Breaking strap', desc: 'The fixed BREAKING chip over a strap with one headline.', kit: true, color: '#ef4444', seconds: 7, fields: [{ key: 'headline', label: 'Breaking headline', required: true }, { key: 'sub', label: 'Supporting line (optional)', required: false }] },
  quote: { label: 'Quote card', desc: 'A quote word for word from the story, with the speaker.', kit: true, color: '#7c3aed', seconds: 8, fields: [{ key: 'quote', label: 'Quote, word for word from the story', required: true, multiline: true }, { key: 'speaker', label: 'Speaker name', required: true }, { key: 'speakerRole', label: 'Speaker role (optional)', required: false }] },
  source: { label: 'Source line', desc: '“Source:” and the source you type, small at the bottom.', kit: true, color: '#64748b', seconds: 5, fields: [{ key: 'source', label: 'Source', required: true }] },
  'end-card': { label: 'End card', desc: 'The ESB logo, esbpowerline.com and the Facebook and YouTube handles.', kit: true, color: '#0ea5e9', seconds: 5, fields: [] },
  'text-card': { label: 'Text card', desc: 'A centred title and text (older projects).', kit: false, color: '#7c3aed', seconds: 5, fields: [{ key: 'title', label: 'Card title', required: false }, { key: 'text', label: 'Card text', required: false, multiline: true }] },
  // Grid data cards (Phase 3 Part B): the clip carries `dataCard` (dataCardClip.ts), never `titleData`, and the words
  // are built from it when the spec is built (titleClip.ts), so the template here only names the card for the UI.
  'data-number': { label: 'Data card', desc: 'A Grid figure from esbpowerline.com, counted up (Data tab).', kit: false, color: '#0ea5e9', seconds: 6, fields: [] },
  'data-chart': { label: 'Data chart', desc: 'A Grid chart from esbpowerline.com (Data tab).', kit: false, color: '#0ea5e9', seconds: 7, fields: [] },
  sticker: { label: 'Sticker', desc: 'An arrow, circle, highlight or callout, drawn in code.', kit: false, color: '#f59e0b', seconds: 4, fields: [{ key: 'text', label: 'Callout text', required: true }] },
}

/** The fields a classic (migrated) title shows: the old overlay's two text fields, under their old labels. Nothing is
 * required, as before: an old title with nothing typed in is left out of the export. */
export const CLASSIC_FIELDS: Record<ClassicType, [TitleFieldDef, TitleFieldDef]> = {
  'lower-third': [{ key: 'name', label: 'Speaker name', required: false }, { key: 'role', label: 'Role or organisation', required: false }],
  headline: [{ key: 'headline', label: 'Headline', required: false }, { key: 'kicker', label: 'Kicker (optional)', required: false }],
  breaking: [{ key: 'headline', label: 'Breaking headline', required: false }, { key: 'sub', label: 'Supporting line (optional)', required: false }],
  card: [{ key: 'title', label: 'Card title', required: false }, { key: 'text', label: 'Card text', required: false, multiline: true }],
}

const CLASSIC_TEMPLATE: Record<ClassicType, TitleTemplate> = { 'lower-third': 'lower-third', headline: 'headline', breaking: 'breaking', card: 'text-card' }

/** The fields the inspector shows for a title. */
export function fieldsOf(td: TitleData): TitleFieldDef[] {
  if (td.look === 'classic' && td.classic) return CLASSIC_FIELDS[td.classic]
  if (td.template === 'sticker') return td.sticker?.shape === 'callout' ? TITLE_TEMPLATES.sticker.fields : []
  return TITLE_TEMPLATES[td.template].fields
}

export const STICKER_SHAPES: { shape: StickerShape; label: string }[] = [
  { shape: 'arrow', label: 'Arrow' },
  { shape: 'circle', label: 'Circle' },
  { shape: 'highlight', label: 'Highlight' },
  { shape: 'underline', label: 'Underline' },
  { shape: 'box', label: 'Box' },
  { shape: 'callout', label: 'Callout' },
]

/** The ESB palette for stickers: the three brand stripes, caption yellow, white, ink, and the title's accent. */
export const STICKER_COLORS: Record<StickerColor, { label: string; hex: string | null }> = {
  red: { label: 'ESB red', hex: '#e52d2d' },
  orange: { label: 'ESB orange', hex: '#ec8e3c' },
  green: { label: 'ESB green', hex: '#1e9b4a' },
  yellow: { label: 'Caption yellow', hex: '#fef08a' },
  white: { label: 'White', hex: '#ffffff' },
  ink: { label: 'Ink', hex: '#0e0e12' },
  accent: { label: 'Story accent', hex: null },
}

export const ANIM_PRESETS: { id: AnimPresetId; label: string }[] = [
  { id: 'none', label: 'None (cut)' },
  { id: 'fade', label: 'Fade' },
  { id: 'type-on', label: 'Type on' },
  { id: 'word', label: 'Word by word' },
  { id: 'line', label: 'Line by line' },
  { id: 'slide-up', label: 'Slide up' },
  { id: 'slide-left', label: 'Slide left' },
  { id: 'slide-right', label: 'Slide right' },
  { id: 'scale', label: 'Scale in' },
  { id: 'mask', label: 'Mask reveal' },
  { id: 'blur', label: 'Blur in' },
]
export const EASES: { id: EaseId; label: string }[] = [
  { id: 'esb', label: 'ESB (smooth stop)' },
  { id: 'easeOut', label: 'Ease out' },
  { id: 'easeInOut', label: 'Ease in-out' },
  { id: 'linear', label: 'Linear' },
  { id: 'easeOutBack', label: 'Overshoot' },
]

/** The starting values of an override for a preset (what the inspector shows when one is picked). */
export function defaultOverride(preset: AnimPresetId, out = false): AnimOverride {
  const stagger = preset === 'type-on' ? 0.035 : preset === 'word' ? 0.08 : preset === 'line' ? 0.15 : preset === 'mask' ? 0.12 : 0
  const duration = preset === 'type-on' || preset === 'none' ? 0 : out ? 0.35 : preset === 'word' ? 0.42 : 0.5
  return { preset, duration, delay: 0, stagger, ease: preset === 'fade' ? 'easeInOut' : 'esb' }
}

/** Seconds of title time a clip covers: its local time runs from `in` (a split's second half starts later) to here. */
export const titleDuration = (c: { in: number; out: number; duration: number }) => Math.max(c.out, c.in + c.duration)
/** The template name for a data card clip (UI labels). */
export const dataTemplateOf = (card: { kind: string }): 'data-number' | 'data-chart' => (card.kind === 'number' ? 'data-number' : 'data-chart')
/** A title clip's local time at timeline time t. */
export const titleLocal = (c: { in: number; start: number }, t: number) => c.in + (t - c.start)

// ------------------------------------------------------------------ project files

const HEX = /^#[0-9a-f]{6}$/i
// data-number / data-chart belong to `clip.dataCard`, never to a project file's titleData
const TEMPLATES: TitleTemplate[] = (Object.keys(TITLE_TEMPLATES) as TitleTemplate[]).filter((t) => t !== 'data-number' && t !== 'data-chart')
const CLASSICS: ClassicType[] = ['lower-third', 'headline', 'breaking', 'card']
const PLATFORMS: PlatformChoice[] = ['auto', 'reels', 'shorts', 'none']
const PRESETS = ANIM_PRESETS.map((p) => p.id)
const EASE_IDS = EASES.map((e) => e.id)
const SHAPES = STICKER_SHAPES.map((s) => s.shape)
const COLORS = Object.keys(STICKER_COLORS) as StickerColor[]
/** No field holds more than this (a quote is a few sentences; a crafted file cannot make layout run for seconds). */
export const MAX_FIELD_CHARS = 1200

const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)
const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

function cleanAnim(v: unknown): AnimOverride | undefined {
  const o = rec(v)
  if (!o || !PRESETS.includes(o.preset as AnimPresetId)) return undefined
  return {
    preset: o.preset as AnimPresetId,
    duration: clamp(o.duration, 0, 5, 0.5),
    delay: clamp(o.delay, 0, 10, 0),
    stagger: clamp(o.stagger, 0, 1, 0),
    ease: EASE_IDS.includes(o.ease as EaseId) ? (o.ease as EaseId) : 'esb',
  }
}

function cleanStyle(v: unknown): StyleOverride | undefined {
  const o = rec(v)
  if (!o) return undefined
  const s: StyleOverride = {}
  for (const k of ['fill', 'fill2', 'stroke', 'box'] as const) if (typeof o[k] === 'string' && HEX.test(o[k] as string)) s[k] = o[k] as string
  if (o.strokeWidth !== undefined) s.strokeWidth = clamp(o.strokeWidth, 0.5, 12, 3)
  if (o.shadow === true) s.shadow = true
  return Object.keys(s).length ? s : undefined
}

function cleanSticker(v: unknown): StickerData | undefined {
  const o = rec(v)
  if (!o || !SHAPES.includes(o.shape as StickerShape)) return undefined
  return {
    shape: o.shape as StickerShape,
    color: COLORS.includes(o.color as StickerColor) ? (o.color as StickerColor) : 'red',
    x: clamp(o.x, 0, 1, 0.5),
    y: clamp(o.y, 0, 1, 0.5),
    size: clamp(o.size, 0.04, 1, 0.3),
    rotation: clamp(o.rotation, -360, 360, 0),
  }
}

/** A project file's title data, cleaned: a known template, string fields of the template's keys (capped), known
 * presets, eases, colours, numbers in range. Null when it is not title data at all. */
export function sanitizeTitleData(raw: unknown): TitleData | null {
  const o = rec(raw)
  if (!o || !TEMPLATES.includes(o.template as TitleTemplate)) return null
  const td: TitleData = { template: o.template as TitleTemplate, fields: {} }
  if (o.look === 'classic' && CLASSICS.includes(o.classic as ClassicType)) { td.look = 'classic'; td.classic = o.classic as ClassicType; td.template = CLASSIC_TEMPLATE[td.classic] }
  if (td.template === 'sticker') { const st = cleanSticker(o.sticker); if (!st) return null; td.sticker = st }
  const f = rec(o.fields) ?? {}
  for (const def of fieldsOf(td)) {
    const v = f[def.key]
    td.fields[def.key] = typeof v === 'string' ? v.slice(0, MAX_FIELD_CHARS) : ''
  }
  if (typeof o.categoryId === 'string' && CATEGORIES.some((c) => c.id === o.categoryId)) td.categoryId = o.categoryId
  if (PLATFORMS.includes(o.platform as PlatformChoice) && o.platform !== 'auto') td.platform = o.platform as PlatformChoice
  if (td.look !== 'classic') {
    const ai = cleanAnim(o.animIn); if (ai) td.animIn = ai
    const ao = cleanAnim(o.animOut); if (ao) td.animOut = ao
    const st = cleanStyle(o.style); if (st) td.style = st
  }
  return td
}

// ------------------------------------------------------------------ Phase 0–2 overlays

interface LegacyFields { kind: string; overlayType?: string; overlayText?: string; overlaySub?: string; sourceUrl?: string; titleData?: TitleData }

const isClassic = (t: unknown): t is ClassicType => CLASSICS.includes(t as ClassicType)

/** A Phase 0–2 text overlay (lower third, headline, text card, breaking) as a title clip with the classic look: the
 * same two fields, drawn by the same code, so the project looks exactly as before. Anything else is returned as is. */
export function migrateOverlayClip<C extends LegacyFields>(clip: C): C {
  if (clip.kind !== 'overlay' || clip.titleData || clip.sourceUrl || !isClassic(clip.overlayType)) return clip
  const type = clip.overlayType
  const [a, b] = CLASSIC_FIELDS[type]
  const out = { ...clip, titleData: { template: CLASSIC_TEMPLATE[type], look: 'classic', classic: type, fields: { [a.key]: (clip.overlayText ?? '').slice(0, MAX_FIELD_CHARS), [b.key]: (clip.overlaySub ?? '').slice(0, MAX_FIELD_CHARS) } } as TitleData }
  delete out.overlayType
  delete out.overlayText
  delete out.overlaySub
  return out
}

/** A classic title clip seen as the Phase 0–2 overlay it came from (what compositor.ts's overlay drawing reads). */
export function legacyView<C extends LegacyFields>(clip: C): C {
  const td = clip.titleData
  if (!td || td.look !== 'classic' || !td.classic) return clip
  const [a, b] = CLASSIC_FIELDS[td.classic]
  return { ...clip, overlayType: td.classic, overlayText: td.fields[a.key] ?? '', overlaySub: td.fields[b.key] ?? '' }
}

/** A title clip (kit, classic or sticker). */
export const isTitleClip = (c: { kind: string; titleData?: TitleData }) => c.kind === 'overlay' && !!c.titleData

/** The words a title shows first (its timeline label), or '' when every field is empty. */
export function titleWords(td: TitleData): string {
  for (const def of fieldsOf(td)) { const v = (td.fields[def.key] ?? '').trim(); if (v) return v }
  return ''
}
