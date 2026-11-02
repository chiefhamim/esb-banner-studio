// The ESB title kit as data-driven templates. Each function takes the editor's fields and returns a TitleSpec. It
// never supplies words of its own: text comes from the fields (word for word; a kicker may be upper-cased) or from the
// brand's fixed set (brand.ts: name, site, handles, "BREAKING", "Source:"). An empty field is drawn as its label in
// the editor only (`placeholder: true`) and left out of an export; validate.ts refuses an export with an empty
// required field.
//
// Layout is safe-area aware: everything critical sits inside title-safe (90 %) and, for 9:16 feeds, outside the
// platform UI zones (brand.ts DEFAULT_SAFE_ZONES: bottom ~20 %, right edge strip, top band).

import { fade, lineByLine, maskReveal, scaleIn, slide, wordByWord, type TextAnimSpec } from './anim'
import { BRAND_TEXT, ESB_BRAND, ESB_STRIPES, FIXED_LABELS, QUOTE_MARK, fontFor, inkOn, kickerCase, resolveAccent, safeRect, type Platform, type Rect, type SafeZoneConfig, type TypeRole } from './brand'
import type { TitleStyle } from './draw'
import { layoutTitle, type Align, type Measurer } from './layout'
import { hasBanglaText } from './segment'
import type { RectElement, TextElement, TitleElement, TitleField, TitleSpec, TemplateKind } from './spec'

export interface KitOptions {
  frame: { w: number; h: number }
  measure: Measurer
  /** Build for the editor (empty fields drawn as dimmed labels). Default false = export. */
  editor?: boolean
  /** 9:16 feed whose UI zones to keep clear (null = none). Default: 'reels' for a portrait frame, else none. */
  platform?: Platform | null
  safeZones?: SafeZoneConfig
  /** The story's accent: an explicit colour, or a 01–08 category id. */
  accent?: string | null
  categoryId?: string | null
  /** Seconds on screen. */
  duration?: number
}

export const PLACEHOLDER_INK = 'rgba(255, 255, 255, 0.38)'
export const PANEL = 'rgba(16, 16, 20, 0.92)'
export const INK = '#f4f4f5'
export const INK_2 = '#c9c9cf'

/** The editor-only labels of each template's fields. */
export const KIT_LABELS = {
  name: 'Speaker name',
  role: 'Role or organisation',
  headline: 'Headline',
  kicker: 'Kicker (optional)',
  breaking: 'Breaking headline',
  breakingSub: 'Supporting line (optional)',
  quote: 'Quote, word for word from the story',
  speaker: 'Speaker name',
  speakerRole: 'Speaker role (optional)',
  source: 'Source',
} as const

export const ALL_PLACEHOLDER_LABELS: ReadonlySet<string> = new Set(Object.values(KIT_LABELS))

// ------------------------------------------------------------------ helpers (shared with dataCards.ts)

export interface KitCtx { o: KitOptions; s: number; safe: Rect; editor: boolean; accent: string | null; fields: Record<string, TitleField> }

export function ctxOf(o: KitOptions): KitCtx {
  const { w, h } = o.frame
  const platform = o.platform === undefined ? (h > w * 1.3 ? 'reels' : null) : o.platform
  return { o, s: Math.min(w, h) / 1080, safe: safeRect(w, h, { platform, config: o.safeZones }), editor: !!o.editor, accent: resolveAccent({ accent: o.accent, categoryId: o.categoryId }), fields: {} }
}

const clean = (v: string | null | undefined) => (v ?? '').replace(/\s+/g, ' ').trim()

/** Register a field and give what it shows: its value, its label (editor), or null (export, empty). */
export function take(c: KitCtx, key: string, value: string | null | undefined, label: string, required: boolean): { text: string; placeholder: boolean } | null {
  const v = clean(value)
  c.fields[key] = { value: v, label, required }
  if (v) return { text: v, placeholder: false }
  return c.editor ? { text: label, placeholder: true } : null
}

export interface TextOpts { role: TypeRole; size: number; style?: Partial<TitleStyle>; align?: Align; maxLines?: number; anim?: TextAnimSpec; transform?: 'upper'; prefix?: string; italic?: boolean; color?: string }

export function textEl(_c: KitCtx, id: string, shown: { text: string; placeholder: boolean }, field: string | null, x: number, y: number, w: number, t: TextOpts): TextElement {
  const body = t.transform === 'upper' && !shown.placeholder ? kickerCase(shown.text) : shown.text
  const text = t.prefix && !shown.placeholder ? `${t.prefix} ${body}` : body
  const el: TextElement = {
    type: 'text', id, text, origin: field ? 'input' : 'brand', font: fontFor(text, t.role, Math.round(t.size), { italic: t.italic }),
    style: { fill: shown.placeholder ? PLACEHOLDER_INK : t.color ?? INK, ...t.style }, x, y, w, align: t.align ?? 'left', maxLines: t.maxLines, anim: t.anim,
  }
  if (field) el.field = field
  if (shown.placeholder) el.placeholder = true
  if (t.transform && !hasBanglaText(body)) el.transform = t.transform
  if (t.prefix && !shown.placeholder) el.prefix = t.prefix
  return el
}

export const brandText = (s: string) => {
  if (!BRAND_TEXT.has(s)) throw new Error(`not a brand string: ${s}`)
  return { text: s, placeholder: false }
}

export function heightOf(c: KitCtx, el: TextElement): number {
  return layoutTitle({ text: el.text, font: el.font, maxWidth: el.w, align: el.align, maxLines: el.maxLines }, c.o.measure).height
}

export function accentBar(c: KitCtx, id: string, x: number, y: number, w: number, h: number, anim?: TextAnimSpec): RectElement {
  return c.accent ? { type: 'rect', id, x, y, w, h, fill: c.accent, anim } : { type: 'rect', id, x, y, w, h, fill: ESB_STRIPES[0], stripes: ESB_STRIPES, anim }
}

export function spec(c: KitCtx, kind: TemplateKind, elements: TitleElement[], duration: number): TitleSpec {
  return { kind, frame: { ...c.o.frame }, duration, fields: c.fields, elements, editor: c.editor }
}

export const timing = (d: number, inPhase: TextAnimSpec['in'], outDur = 0.35): TextAnimSpec => ({ duration: d, in: inPhase, out: fade(outDur) })

// ------------------------------------------------------------------ templates

/** Lower third: name + role, with the optional ESB kicker above. */
export function lowerThird(f: { name?: string; role?: string; esbKicker?: boolean }, o: KitOptions): TitleSpec {
  const c = ctxOf(o)
  const d = o.duration ?? 6
  const { s, safe } = c
  const name = take(c, 'name', f.name, KIT_LABELS.name, true)
  const role = take(c, 'role', f.role, KIT_LABELS.role, false)
  const boxW = Math.min(safe.w, 900 * s)
  const pad = 26 * s
  const textX = safe.x + pad + 16 * s
  const textW = boxW - pad * 2 - 16 * s
  const els: TextElement[] = []
  let y = 0
  if (f.esbKicker !== false) { const k = textEl(c, 'kicker', brandText(ESB_BRAND.kicker), null, textX, y, textW, { role: 'kicker', size: 17 * s, color: c.accent ?? '#a1a1aa', anim: timing(d, fade(0.3, 0.1)) }); els.push(k); y += heightOf(c, k) + 4 * s }
  if (name) { const n = textEl(c, 'name', name, 'name', textX, y, textW, { role: 'headline', size: 44 * s, maxLines: 2, anim: timing(d, wordByWord(0.07, 0.15)) }); els.push(n); y += heightOf(c, n) + 2 * s }
  if (role) { const r = textEl(c, 'role', role, 'role', textX, y, textW, { role: 'body', size: 27 * s, maxLines: 2, color: role.placeholder ? undefined : INK_2, anim: timing(d, fade(0.35, 0.35)) }); els.push(r); y += heightOf(c, r) }
  if (!name && !role) return spec(c, 'lower-third', [], d)
  const boxH = y + pad * 2
  const boxY = safe.y + safe.h - boxH
  for (const e of els) e.y += boxY + pad
  const boxAnim = timing(d, slide('right', 80 * s, 0.5))
  return spec(c, 'lower-third', [
    { type: 'rect', id: 'panel', x: safe.x, y: boxY, w: boxW, h: boxH, radius: 12 * s, fill: PANEL, anim: boxAnim },
    accentBar(c, 'accent', safe.x + pad * 0.5, boxY + pad * 0.6, 7 * s, boxH - pad * 1.2, boxAnim),
    ...els,
  ], d)
}

/** Name strap: one name on a compact strap. */
export function nameStrap(f: { name?: string }, o: KitOptions): TitleSpec {
  const c = ctxOf(o)
  const d = o.duration ?? 5
  const { s, safe } = c
  const name = take(c, 'name', f.name, KIT_LABELS.name, true)
  if (!name) return spec(c, 'name-strap', [], d)
  const padX = 24 * s, padY = 14 * s
  const el = textEl(c, 'name', name, 'name', safe.x + padX + 14 * s, 0, Math.min(safe.w, 760 * s) - padX * 2 - 14 * s, { role: 'headline', size: 38 * s, maxLines: 1, anim: timing(d, maskReveal('right', 0.55, 0.12, 'all')) })
  const lay = layoutTitle({ text: el.text, font: el.font, maxWidth: el.w, maxLines: 1 }, o.measure)
  const h = lay.height + padY * 2
  const y = safe.y + safe.h - h
  el.y = y + padY
  const boxAnim = timing(d, maskReveal('right', 0.45, 0, 'all'))
  return spec(c, 'name-strap', [
    { type: 'rect', id: 'panel', x: safe.x, y, w: lay.width + padX * 2 + 14 * s, h, radius: 8 * s, fill: PANEL, anim: boxAnim },
    accentBar(c, 'accent', safe.x, y, 7 * s, h, boxAnim),
    el,
  ], d)
}

/** Headline card: the headline (up to 4 lines) in the lower half over a dark ramp, with an optional kicker. */
export function headlineCard(f: { headline?: string; kicker?: string }, o: KitOptions): TitleSpec {
  const c = ctxOf(o)
  const d = o.duration ?? 6
  const { s, safe } = c
  const { w, h } = o.frame
  const head = take(c, 'headline', f.headline, KIT_LABELS.headline, true)
  const kick = take(c, 'kicker', f.kicker, KIT_LABELS.kicker, false)
  if (!head && !kick) return spec(c, 'headline', [], d)
  const left = safe.x + 30 * s
  const width = safe.w - 30 * s
  const els: TextElement[] = []
  let y = 0
  if (kick) { const k = textEl(c, 'kicker', kick, 'kicker', left, y, width, { role: 'kicker', size: 22 * s, transform: 'upper', color: kick.placeholder ? undefined : c.accent ?? '#e4e4e7', anim: timing(d, fade(0.3)) }); els.push(k); y += heightOf(c, k) + 10 * s }
  if (head) { const t = textEl(c, 'headline', head, 'headline', left, y, width, { role: 'headline', size: 66 * s, maxLines: 4, anim: timing(d, lineByLine(0.14, 0.1)) }); els.push(t); y += heightOf(c, t) }
  const top = safe.y + safe.h - y
  for (const e of els) e.y += top
  const rampTop = Math.max(0, top - 180 * s)
  return spec(c, 'headline', [
    { type: 'rect', id: 'ramp', x: 0, y: rampTop, w, h: h - rampTop, fill: 'rgba(0,0,0,0.7)', gradient: { type: 'linear', angle: 90, stops: [[0, 'rgba(0,0,0,0)'], [0.45, 'rgba(0,0,0,0.62)'], [1, 'rgba(0,0,0,0.84)']] }, anim: timing(d, fade(0.4)) },
    accentBar(c, 'accent', safe.x, top + 6 * s, 9 * s, y - 12 * s, timing(d, maskReveal('down', 0.45, 0, 'all'))),
    ...els,
  ], d)
}

/** Breaking strap: the fixed "BREAKING" chip over a strap with the headline and an optional supporting line. */
export function breakingStrap(f: { headline?: string; sub?: string }, o: KitOptions): TitleSpec {
  const c = ctxOf(o)
  const d = o.duration ?? 7
  const { s, safe } = c
  const head = take(c, 'headline', f.headline, KIT_LABELS.breaking, true)
  const sub = take(c, 'sub', f.sub, KIT_LABELS.breakingSub, false)
  if (!head) return spec(c, 'breaking', [], d)
  const red = c.accent ?? '#c8102e'
  const bn = hasBanglaText(head.placeholder ? '' : head.text)
  const pad = 22 * s
  const els: TextElement[] = []
  let y = 0
  const t = textEl(c, 'headline', head, 'headline', safe.x + pad, y, safe.w - pad * 2, { role: 'headline', size: 42 * s, maxLines: 2, anim: timing(d, slide('left', 40 * s, 0.45, 0.2)) }); els.push(t); y += heightOf(c, t)
  if (sub) { const u = textEl(c, 'sub', sub, 'sub', safe.x + pad, y + 6 * s, safe.w - pad * 2, { role: 'body', size: 26 * s, maxLines: 1, color: sub.placeholder ? undefined : INK_2, anim: timing(d, fade(0.3, 0.4)) }); els.push(u); y += heightOf(c, u) + 6 * s }
  const strapH = y + pad * 2
  const strapY = safe.y + safe.h - strapH
  for (const e of els) e.y += strapY + pad
  const label = brandText(bn ? FIXED_LABELS.breaking.bn : FIXED_LABELS.breaking.en)
  const chip = textEl(c, 'label', label, null, safe.x + 16 * s, 0, safe.w - 32 * s, { role: 'kicker', size: 20 * s, color: inkOn(red), anim: timing(d, scaleIn(0.8, 0.35)) })
  const chipLay = layoutTitle({ text: chip.text, font: chip.font, maxWidth: chip.w }, o.measure)
  const chipH = chipLay.height + 10 * s
  chip.y = strapY - chipH - 6 * s + 5 * s
  return spec(c, 'breaking', [
    { type: 'rect', id: 'chip', x: safe.x, y: strapY - chipH - 6 * s, w: chipLay.width + 32 * s, h: chipH, radius: 6 * s, fill: red, anim: timing(d, scaleIn(0.8, 0.35)) },
    chip,
    { type: 'rect', id: 'strap', x: safe.x, y: strapY, w: safe.w, h: strapH, radius: 10 * s, fill: 'rgba(14, 14, 18, 0.95)', anim: timing(d, maskReveal('right', 0.45, 0.05, 'all')) },
    { type: 'rect', id: 'edge', x: safe.x, y: strapY, w: 8 * s, h: strapH, fill: red, anim: timing(d, fade(0.2, 0.05)) },
    ...els,
  ], d)
}

/** Quote card: the quote word for word, the speaker, an optional role, an optional speaker photo (the editor's own). */
export function quoteCard(f: { quote?: string; speaker?: string; speakerRole?: string; photoUrl?: string | null }, o: KitOptions): TitleSpec {
  const c = ctxOf(o)
  const d = o.duration ?? 8
  const { s, safe } = c
  const quote = take(c, 'quote', f.quote, KIT_LABELS.quote, true)
  const speaker = take(c, 'speaker', f.speaker, KIT_LABELS.speaker, true)
  const role = take(c, 'speakerRole', f.speakerRole, KIT_LABELS.speakerRole, false)
  if (!quote && !speaker) return spec(c, 'quote', [], d)
  const cardW = Math.min(safe.w, 1300 * s)
  const pad = 48 * s
  const x = safe.x + (safe.w - cardW) / 2
  const photo = clean(f.photoUrl) || null
  const photoD = photo ? 150 * s : 0
  const textX = x + pad
  const textW = cardW - pad * 2
  const els: TitleElement[] = []
  let y = 0
  const mark = textEl(c, 'mark', brandText(QUOTE_MARK), null, textX, y, textW, { role: 'headline', size: 110 * s, color: c.accent ?? ESB_STRIPES[2], anim: timing(d, scaleIn(0.7, 0.4)) })
  els.push(mark); y += 70 * s
  if (quote) { const q = textEl(c, 'quote', quote, 'quote', textX, y, textW, { role: 'body', size: 44 * s, maxLines: 7, style: {}, anim: timing(d, wordByWord(0.05, 0.25)) }); q.font = { ...q.font, weight: 600 }; els.push(q); y += heightOf(c, q) + 28 * s }
  const nameX = textX + (photo ? photoD + 24 * s : 0)
  const nameW = textW - (photo ? photoD + 24 * s : 0)
  const byTop = y
  if (photo) els.push({ type: 'image', id: 'photo', x: textX, y: byTop, w: photoD, h: photoD, radius: photoD / 2, src: photo, field: 'photoUrl', anim: timing(d, fade(0.4, 0.5)) })
  let by = byTop + (photo ? photoD * 0.22 : 0)
  if (speaker) { const n = textEl(c, 'speaker', speaker, 'speaker', nameX, by, nameW, { role: 'label', size: 30 * s, maxLines: 2, color: speaker.placeholder ? undefined : c.accent ?? INK, anim: timing(d, fade(0.35, 0.6)) }); els.push(n); by += heightOf(c, n) }
  if (role) { const r = textEl(c, 'speakerRole', role, 'speakerRole', nameX, by + 4 * s, nameW, { role: 'body', size: 24 * s, maxLines: 2, color: role.placeholder ? undefined : INK_2, anim: timing(d, fade(0.35, 0.7)) }); els.push(r); by += heightOf(c, r) + 4 * s }
  y = Math.max(by, byTop + photoD)
  const cardH = y + pad * 2
  const top = safe.y + (safe.h - cardH) / 2
  for (const e of els) e.y += top + pad
  return spec(c, 'quote', [
    { type: 'rect', id: 'card', x, y: top, w: cardW, h: cardH, radius: 18 * s, fill: 'rgba(14, 14, 18, 0.93)', anim: timing(d, scaleIn(0.94, 0.45)) },
    accentBar(c, 'accent', x + pad, top + 22 * s, 72 * s, 7 * s, timing(d, maskReveal('right', 0.4, 0.15, 'all'))),
    ...els,
  ], d)
}

/** Source line: "Source: …" only when a source is given (nothing at all otherwise, even in the editor's export). */
export function sourceLine(f: { source?: string }, o: KitOptions): TitleSpec {
  const c = ctxOf(o)
  const d = o.duration ?? 5
  const { s, safe } = c
  const src = take(c, 'source', f.source, KIT_LABELS.source, false)
  if (!src) return spec(c, 'source', [], d)
  const prefix = hasBanglaText(src.text) ? FIXED_LABELS.source.bn : FIXED_LABELS.source.en
  const el = textEl(c, 'source', src, 'source', safe.x, 0, safe.w, { role: 'body', size: 22 * s, maxLines: 2, prefix, color: src.placeholder ? undefined : INK_2, style: { shadow: { color: 'rgba(0,0,0,0.6)', blur: 6 * s, dx: 0, dy: 1 * s } }, anim: timing(d, fade(0.3)) })
  el.y = safe.y + safe.h - heightOf(c, el)
  return spec(c, 'source', [el], d)
}

/** End card: the ESB logo (drawn as-is by the compositor), the site and the brand's handles. Fixed brand text only. */
export function endCard(o: KitOptions): TitleSpec {
  const c = ctxOf(o)
  const d = o.duration ?? 5
  const { s, safe } = c
  const { w, h } = o.frame
  const cx = safe.x + safe.w / 2
  const logoH = 150 * s
  const logoW = logoH * 3
  const colW = Math.min(safe.w, 900 * s)
  const els: TitleElement[] = [
    { type: 'rect', id: 'bg', x: 0, y: 0, w, h, fill: '#0e0e12', anim: { duration: d, in: fade(0.3) } },
    { type: 'image', id: 'logo', x: cx - logoW / 2, y: 0, w: logoW, h: logoH, src: null, brandAsset: 'esb-logo', anim: { duration: d, in: scaleIn(0.9, 0.5) } },
  ]
  const site = textEl(c, 'site', brandText(ESB_BRAND.site), null, cx - colW / 2, 0, colW, { role: 'headline', size: 54 * s, align: 'center', anim: { duration: d, in: wordByWord(0.08, 0.35) } })
  const fb = textEl(c, 'facebook', brandText(`${FIXED_LABELS.facebook} ${ESB_BRAND.facebook}`), null, cx - colW / 2, 0, colW, { role: 'body', size: 30 * s, align: 'center', color: INK_2, anim: { duration: d, in: fade(0.35, 0.6) } })
  const yt = textEl(c, 'youtube', brandText(`${FIXED_LABELS.youtube} ${ESB_BRAND.youtube}`), null, cx - colW / 2, 0, colW, { role: 'body', size: 30 * s, align: 'center', color: INK_2, anim: { duration: d, in: fade(0.35, 0.75) } })
  const stripeW = 120 * s
  const blockH = logoH + 40 * s + 8 * s + 40 * s + heightOf(c, site) + 18 * s + heightOf(c, fb) + 6 * s + heightOf(c, yt)
  let y = safe.y + (safe.h - blockH) / 2
  ;(els[1] as { y: number }).y = y; y += logoH + 40 * s
  els.push({ type: 'rect', id: 'stripes', x: cx - stripeW / 2, y, w: stripeW, h: 8 * s, fill: ESB_STRIPES[0], stripes: ESB_STRIPES, anim: { duration: d, in: maskReveal('right', 0.5, 0.2, 'all') } }); y += 8 * s + 40 * s
  site.y = y; y += heightOf(c, site) + 18 * s
  fb.y = y; y += heightOf(c, fb) + 6 * s
  yt.y = y
  els.push(site, fb, yt)
  return spec(c, 'end-card', els, d)
}


