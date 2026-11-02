// Export checks for titles (non-negotiable 1: no invented content). A title is exportable only when every required
// field is filled, no placeholder or template-filler text is left, every text element's words come from a field,
// the brand's fixed set or the data, and a data card carries its source line and date. Placeholders are editor-only.

import { BRAND_TEXT, kickerCase } from './brand'
import { ALL_PLACEHOLDER_LABELS } from './kit'
import { layoutOf } from './render'
import type { Measurer } from './layout'
import type { TextElement, TitleSpec } from './spec'

export interface TitleIssue { code: 'required-empty' | 'placeholder' | 'filler-text' | 'unknown-origin' | 'text-mismatch' | 'no-source-line' | 'bad-figure' | 'overflow'; message: string; elementId?: string; field?: string }

/** Text that is a template's stand-in, not content: lorem ipsum, TBD/TBC, XXX, [Name], {{field}}, <name>, "Your … here". */
const FILLER = [
  /\blorem\b|\bipsum\b/i,
  /\b(tbd|tbc|tba)\b/i,
  /\bx{3,}\b/i,
  // brackets only around a field word: a quote may carry an editor's [insertion]
  /\[\s*(name|title|role|headline|quote|speaker|source|date|text|insert[^\]]*)\s*\]/i,
  /\{\{[^}]*\}\}/,
  /<\s*(name|title|role|headline|quote|speaker|source|date|text)\s*>/i,
  /\byour (name|title|text|headline|quote)( here)?\b/i,
  /\b(placeholder|sample text|dummy)\b/i,
  /^[-–—_.…\s]+$/,
]

export function looksLikeFiller(text: string): boolean {
  return ALL_PLACEHOLDER_LABELS.has(text.trim()) || FILLER.some((re) => re.test(text))
}

/** The text an element must show given its origin (null = cannot be checked: data text is checked by its own rule). */
function expectedText(spec: TitleSpec, el: TextElement): string | null {
  if (el.origin !== 'input' || !el.field) return null
  const f = spec.fields[el.field]
  if (!f) return null
  const body = el.transform === 'upper' ? kickerCase(f.value) : f.value
  return el.prefix ? `${el.prefix} ${body}` : body
}

/** Check a title for export. An empty list = exportable. Pass a measurer to also flag text cut by its line limit. */
export function validateTitleSpec(spec: TitleSpec, opts: { measure?: Measurer } = {}): TitleIssue[] {
  const out: TitleIssue[] = []
  for (const [key, f] of Object.entries(spec.fields)) {
    if (f.required && !f.value.trim()) out.push({ code: 'required-empty', field: key, message: `“${f.label}” is empty` })
    else if (f.value.trim() && looksLikeFiller(f.value)) out.push({ code: 'filler-text', field: key, message: `“${f.label}” holds placeholder text: ${f.value}` })
  }
  for (const el of spec.elements) {
    if ('placeholder' in el && el.placeholder) out.push({ code: 'placeholder', elementId: el.id, message: `${el.id} is an editor placeholder` })
    if (el.type !== 'text') continue
    if (el.placeholder) continue
    if (el.origin === 'brand' && !BRAND_TEXT.has(el.text)) out.push({ code: 'unknown-origin', elementId: el.id, message: `${el.id}: "${el.text}" is not a brand string` })
    else if (el.origin === 'input') {
      const want = expectedText(spec, el)
      if (want === null) out.push({ code: 'unknown-origin', elementId: el.id, message: `${el.id} names no field` })
      else if (want !== el.text) out.push({ code: 'text-mismatch', elementId: el.id, message: `${el.id} shows "${el.text}", its field holds "${want}"` })
    } else if (el.origin === 'data') {
      if (el.countUp && !Number.isFinite(el.countUp.target)) out.push({ code: 'bad-figure', elementId: el.id, message: `${el.id}: not a number` })
    }
    if (opts.measure && el.maxLines && layoutOf(el, opts.measure).truncated) out.push({ code: 'overflow', elementId: el.id, message: `${el.id} does not fit in ${el.maxLines} line${el.maxLines > 1 ? 's' : ''}` })
  }
  if (spec.kind === 'data-number' || spec.kind === 'data-chart') {
    const line = spec.data?.sourceLine
    const has = !!line && spec.elements.some((e) => e.type === 'text' && e.text === line)
    if (!spec.data?.isoDate || !has) out.push({ code: 'no-source-line', message: 'a data card must show “Source: esbpowerline.com Grid data, <date>”' })
  }
  return out
}

export class TitleExportError extends Error {
  issues: TitleIssue[]
  constructor(issues: TitleIssue[]) { super(issues.map((i) => i.message).join('; ')); this.issues = issues }
}

/** Throw unless the title is exportable. */
export function assertExportable(spec: TitleSpec, opts: { measure?: Measurer } = {}): void {
  if (spec.editor) throw new TitleExportError([{ code: 'placeholder', message: 'built for the editor; rebuild with editor: false to export' }])
  const issues = validateTitleSpec(spec, opts)
  if (issues.length) throw new TitleExportError(issues)
}
