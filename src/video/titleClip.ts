// Title clip → TitleSpec (titles/kit.ts), and the export checks for every title on a timeline.
//
// The monitor builds a clip's spec with `editor: true` (an empty field is drawn as its dimmed label); the export builds
// it with `editor: false` and is refused while any title has an empty required field, placeholder or filler text, or
// words cut by their line limit (`titleProblems`, used by exportBlocker). The inspector's style and animation choices
// apply to the title's own words (text from the editor's fields); boxes, bars and brand words keep the kit's motion.

import { getCategory } from '../core/tokens'
import type { Clip, VideoProject } from './timeline'
import { allClips, formatShortTime } from './timeline'
import { CLASSIC_FIELDS, TITLE_TEMPLATES, fieldsOf, titleDuration, type AnimOverride, type TitleData } from './titleModel'
import { blurIn, fade, lineByLine, maskReveal, scaleIn, slide, typeOn, wordByWord, type AnimPhase } from './titles/anim'
import type { Easing } from './titles/easing'
import { breakingStrap, endCard, headlineCard, lowerThird, nameStrap, quoteCard, sourceLine, type KitOptions } from './titles/kit'
import { canvasMeasurer, type Measurer } from './titles/layout'
import type { TextElement, TitleSpec } from './titles/spec'
import { looksLikeFiller, validateTitleSpec } from './titles/validate'

/** The accent a title's strap takes: its own site category, else the clip's accent (a story's), else null (stripes). */
export function titleAccent(clip: Pick<Clip, 'accent' | 'titleData'>): string | null {
  const id = clip.titleData?.categoryId
  if (id) return getCategory(id).accent
  return clip.accent && /^#[0-9a-f]{3,8}$/i.test(clip.accent) ? clip.accent : null
}

/** An anim phase for an inspector override (null = no phase: the words cut in / out). */
export function phaseOf(o: AnimOverride): AnimPhase | null {
  const easing: Easing = o.ease
  const d = Math.max(0, o.duration)
  let p: AnimPhase
  switch (o.preset) {
    case 'none': return null
    case 'fade': p = fade(d, o.delay); break
    case 'type-on': p = typeOn(o.stagger > 0 ? 1 / o.stagger : 28, o.delay); return p
    case 'word': p = wordByWord(o.stagger, o.delay); p.duration = d; break
    case 'line': p = lineByLine(o.stagger, o.delay); p.duration = d; break
    case 'slide-up': p = slide('up', 40, d, o.delay); break
    case 'slide-left': p = slide('left', 60, d, o.delay); break
    case 'slide-right': p = slide('right', 60, d, o.delay); break
    case 'scale': p = scaleIn(0.86, d, o.delay); break
    case 'mask': p = maskReveal('right', d, o.delay, 'line', o.stagger); break
    case 'blur': p = blurIn(14, d, o.delay); break
  }
  return { ...p, easing }
}

const f = (td: TitleData, k: string) => td.fields[k] ?? ''

/** Build a title clip's spec for a frame of w × h. `editor` draws empty fields as labels; an export never does. */
export function buildTitleSpec(clip: Clip, w: number, h: number, editor: boolean, measure: Measurer): TitleSpec | null {
  const td = clip.titleData
  if (!td || td.look === 'classic' || td.template === 'sticker' || td.template === 'text-card') return null
  const o: KitOptions = {
    frame: { w, h }, measure, editor,
    platform: td.platform === 'none' ? null : td.platform === 'reels' || td.platform === 'shorts' ? td.platform : undefined,
    accent: titleAccent(clip), duration: titleDuration(clip),
  }
  let spec: TitleSpec
  switch (td.template) {
    case 'lower-third': spec = lowerThird({ name: f(td, 'name'), role: f(td, 'role') }, o); break
    case 'name-strap': spec = nameStrap({ name: f(td, 'name') }, o); break
    case 'headline': spec = headlineCard({ headline: f(td, 'headline'), kicker: f(td, 'kicker') }, o); break
    case 'breaking': spec = breakingStrap({ headline: f(td, 'headline'), sub: f(td, 'sub') }, o); break
    case 'quote': spec = quoteCard({ quote: f(td, 'quote'), speaker: f(td, 'speaker'), speakerRole: f(td, 'speakerRole') }, o); break
    case 'source': spec = sourceLine({ source: f(td, 'source') }, o); break
    case 'end-card': spec = endCard(o); break
  }
  return applyOverrides(spec, td, Math.min(w, h) / 1080)
}

/** The inspector's style and animation, on the title's own words (input text, not placeholders). */
export function applyOverrides(spec: TitleSpec, td: TitleData, s: number): TitleSpec {
  const st = td.style
  if (!st && !td.animIn && !td.animOut) return spec
  const els = spec.elements.map((el) => {
    if (el.type !== 'text' || el.origin !== 'input' || el.placeholder) return el
    const out: TextElement = { ...el, style: { ...el.style } }
    if (st?.fill) out.style.fill = st.fill2 ? { type: 'linear', angle: 0, stops: [[0, st.fill], [1, st.fill2]] } : st.fill
    if (st?.stroke) out.style.stroke = { color: st.stroke, width: (st.strokeWidth ?? 3) * s }
    if (st?.shadow) out.style.shadow = { color: 'rgba(0,0,0,0.65)', blur: 10 * s, dx: 0, dy: 3 * s }
    if (st?.box) out.style.box = { fill: st.box, padX: 14 * s, padY: 6 * s, radius: 6 * s, mode: 'line' }
    if (td.animIn || td.animOut) {
      const base = el.anim ?? { duration: spec.duration }
      out.anim = {
        duration: base.duration,
        in: td.animIn ? phaseOf(td.animIn) ?? undefined : base.in,
        out: td.animOut ? phaseOf(td.animOut) ?? undefined : base.out,
      }
    }
    return out
  })
  return { ...spec, elements: els }
}

/** A rough width (no canvas: tests, workers): ~0.55 em per character. Layout only; never used for the fit check. */
export const roughMeasure: Measurer = (text, font) => text.length * font.size * 0.55 + Math.max(0, text.length - 1) * (font.letterSpacing ?? 0)

let realMeasure: Measurer | null | undefined
/** A canvas measurer when the platform has one (the browser, the app), else null. */
export async function canvasMeasure(): Promise<Measurer | null> {
  if (realMeasure !== undefined) return realMeasure
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(8, 8) : typeof document !== 'undefined' ? document.createElement('canvas') : null
  const ctx = c?.getContext('2d') as CanvasRenderingContext2D | null | undefined
  realMeasure = ctx ? canvasMeasurer(ctx) : null
  return realMeasure
}
/** The canvas measurer if it was made already (sync callers). */
export const measureNow = (): Measurer | null => realMeasure ?? null

export interface TitleProblem { clipId: string; label: string; at: number; messages: string[] }

/** Everything that stops a timeline's titles from being exported, per title (empty = all exportable). Pass a real
 * measurer to also catch words cut by their line limit. */
export function titleProblems(project: Pick<VideoProject, 'clips' | 'width' | 'height'>, measure?: Measurer | null): TitleProblem[] {
  const out: TitleProblem[] = []
  const m = measure ?? roughMeasure
  for (const c of allClips(project)) {
    const td = c.titleData
    if (c.kind !== 'overlay' || !td || c.compound) continue
    const msgs: string[] = []
    const label = TITLE_TEMPLATES[td.template].label
    if (td.look === 'classic' && td.classic) {
      // as before Phase 3: an old title with nothing typed in is left out; one with words exports them
      for (const def of CLASSIC_FIELDS[td.classic]) { const v = f(td, def.key).trim(); if (v && looksLikeFiller(v)) msgs.push(`“${def.label}” holds placeholder text: ${v}`) }
    } else if (td.template === 'sticker') {
      if (td.sticker?.shape === 'callout') { const v = f(td, 'text').trim(); if (!v) msgs.push('“Callout text” is empty'); else if (looksLikeFiller(v)) msgs.push(`“Callout text” holds placeholder text: ${v}`) }
    } else {
      for (const def of fieldsOf(td)) if (def.required && !f(td, def.key).trim()) msgs.push(`“${def.label}” is empty`)
      const spec = buildTitleSpec(c, project.width, project.height, false, m)
      if (spec) {
        for (const i of validateTitleSpec(spec, { measure: measure ?? undefined })) {
          if (i.code === 'required-empty' && msgs.some((x) => x.startsWith(`“${spec.fields[i.field!]?.label}”`))) continue
          const text = i.code === 'overflow' ? `${fieldLabel(td, i.elementId)} does not fit in its lines: shorten it` : i.message
          if (!msgs.includes(text)) msgs.push(text)
        }
      }
    }
    if (msgs.length) out.push({ clipId: c.id, label, at: c.start, messages: msgs })
  }
  return out
}

const fieldLabel = (td: TitleData, id?: string) => {
  const def = fieldsOf(td).find((d) => d.key === id)
  return def ? `“${def.label}”` : 'A line'
}

/** One sentence for the export sheet. */
export function titleProblemText(problems: TitleProblem[]): string | null {
  if (!problems.length) return null
  const n = problems.length
  const list = problems.slice(0, 3).map((p) => `${p.label} at ${formatShortTime(p.at)}: ${p.messages.join('; ')}`).join(' · ')
  return `${n} title${n === 1 ? '' : 's'} cannot be exported yet. ${list}${n > 3 ? ` · and ${n - 3} more` : ''}`
}
