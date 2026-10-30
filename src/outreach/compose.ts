// One template, many recipients: {name}, {designation}, {organization} and {sector} are filled from the contact's
// own row. A placeholder the row cannot fill keeps that contact out of the batch ("missing designation") rather than
// sending "In your capacity as  at ," — the only stand-in is the greeting, where "Sir/Madam" is ordinary courtesy.
// Every message ends with a line telling the reader how to stop further emails; the main process adds the matching
// List-Unsubscribe header.

import type { Contact, OutreachLang } from './types'
import type { KeyboardEvent } from 'react'

/** Wrap the selection in a mark, or prefix each selected line; returns the new text and selection. Shared by every
 *  editor on the desk (the body toolbar, and the Footer dialog's own) so a mark reads identically wherever it was
 *  typed — there is one parser (electron/email-html.mjs) and it must never see two dialects of the same mark. */
export function applyMark(text: string, a: number, b: number, kind: string, url = ''): [string, number, number] {
  const sel = text.slice(a, b)
  const wrap = (l: string, r: string, empty: string) => { const inner = sel || empty; return [text.slice(0, a) + l + inner + r + text.slice(b), a + l.length, a + l.length + inner.length] as [string, number, number] }
  if (kind === 'bold') return wrap('**', '**', 'bold words')
  if (kind === 'italic') return wrap('*', '*', 'words')
  if (kind === 'link') return wrap('[', `](${url})`, 'link words')
  if (kind === 'rule') { const ins = `${a && text[a - 1] !== '\n' ? '\n\n' : ''}---\n\n`; return [text.slice(0, a) + ins + text.slice(b), a + ins.length, a + ins.length] }
  // line marks: from the start of the first selected line to the end of the last
  const s0 = text.lastIndexOf('\n', a - 1) + 1
  const e0 = (() => { const i = text.indexOf('\n', b); return i < 0 ? text.length : i })()
  const lines = text.slice(s0, e0).split('\n')
  const pre = (i: number) => (kind === 'heading' ? '## ' : kind === 'bullet' ? '- ' : kind === 'number' ? `${i + 1}. ` : kind === 'center' ? '-> ' : '> ')
  const strip = (l: string) => l.replace(/^(#{2,3}\s+|[-•]\s+|\d+[.)]\s+|->\s+|>\s?)/, '')
  const all = lines.every((l) => l.startsWith(pre(0).trim()) || (kind === 'number' && /^\d+[.)]\s/.test(l)))
  const out = lines.map((l, i) => (all ? strip(l) : pre(i) + strip(l))).join('\n')
  return [text.slice(0, s0) + out + text.slice(e0), s0, s0 + out.length]
}

/** Gmail's own rule, so the plain-marks model (blank line = new paragraph) matches how the editor actually types:
 *  Enter alone starts a new paragraph; Shift+Enter is a line break within the one they're on. A bare textarea makes
 *  no such distinction — both keys insert one "\n" — so the desk's editors intercept Enter themselves. */
export function softBreakOnEnter(e: KeyboardEvent<HTMLTextAreaElement>, value: string, onChange: (v: string) => void) {
  if (e.key !== 'Enter' || e.shiftKey) return
  e.preventDefault()
  const el = e.currentTarget
  const a = el.selectionStart, b = el.selectionEnd
  // already at a paragraph break (blank line before the cursor): one more "\n" is enough, not two
  const before = value.slice(0, a)
  const ins = /\n\s*\n\s*$/.test(before) || before === '' ? '\n' : '\n\n'
  const next = value.slice(0, a) + ins + value.slice(b)
  onChange(next)
  requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = a + ins.length })
}

export const PLACEHOLDERS = ['name', 'designation', 'organization', 'sector', 'opener'] as const
export type Placeholder = (typeof PLACEHOLDERS)[number]

/** Syntax for template placeholders: {key} or {key|fallback text}. */
export const PLACEHOLDER_RE = /\{([a-z][a-z0-9_]*)(?:\|([^{}\n]*))?\}/gi

/** "GROUP 1: POWER GENERATION" → "Power Generation"; a bare "GROUP 2" names no sector. */
export function sectorName(group: string): string {
  const s = group.replace(/^GROUP\s+\d+\s*[:—–-]?\s*/i, '').trim()
  return s && s === s.toUpperCase() ? s.toLowerCase().replace(/\b\p{L}/gu, (ch) => ch.toUpperCase()).replace(/\b(And|Of|The|For|In)\b/g, (w) => w.toLowerCase()) : s
}

export function fieldValue(c: Contact, key: string, opener?: string): string {
  const k = key.toLowerCase()
  if (k === 'name') return c.personName || ''
  if (k === 'designation') return c.designation || ''
  if (k === 'organization') return c.organization || ''
  if (k === 'sector') return sectorName(c.sectorGroup) || ''
  if (k === 'opener') return opener || c.fields?.['opener'] || ''
  return c.fields?.[k] || ''
}

/** The placeholders a template uses. */
export function usedPlaceholders(...texts: string[]): string[] {
  const all = texts.join('\n')
  const found: string[] = []
  const re = new RegExp(PLACEHOLDER_RE.source, 'gi')
  for (const m of all.matchAll(re)) {
    const key = m[1].toLowerCase()
    if (!found.includes(key)) found.push(key)
  } 
  return found
}

/** The fields this contact's row leaves empty but the template needs ({name} has a courteous fallback, and any placeholder with a fallback is satisfied). */
export function missingFields(c: Contact, subject: string, body: string, opener?: string): string[] {
  const all = `${subject}\n${body}`
  const missing: string[] = []
  const re = new RegExp(PLACEHOLDER_RE.source, 'gi')
  for (const m of all.matchAll(re)) {
    const key = m[1].toLowerCase()
    const hasFallback = m[2] !== undefined
    if (hasFallback) continue
    if (key === 'name') continue
    const v = fieldValue(c, key, opener).trim()
    if (!v && !missing.includes(key)) missing.push(key)
  }
  return missing
}

export function fill(text: string, c: Contact, lang: OutreachLang, opener?: string): string {
  const re = new RegExp(PLACEHOLDER_RE.source, 'gi')
  const filled = text.replace(re, (_m, rawKey: string, fallback?: string) => {
    const key = rawKey.toLowerCase()
    const v = fieldValue(c, key, opener).trim()
    if (v) return v
    if (fallback !== undefined) return fallback
    return key === 'name' ? (lang === 'bn' ? 'মহোদয়' : 'Sir/Madam') : ''
  })
  return filled.replace(/\n{3,}/g, '\n\n')
}

export const OPT_OUT_LINE: Record<OutreachLang, string> = {
  en: 'If you would rather not receive emails from ESB Power Line, reply with "unsubscribe" and we will not write again.',
  bn: 'ভবিষ্যতে ইএসবি পাওয়ারলাইনের ইমেইল পেতে না চাইলে "unsubscribe" লিখে উত্তর দিন; আমরা আর লিখব না।',
}

/** The subject, body (with its marks) and opt-out line one recipient gets; the main process renders the HTML. */
export function buildMessage(c: Contact, subject: string, body: string, lang: OutreachLang, opener?: string): { subject: string; body: string; optOut: string } {
  return {
    subject: fill(subject, c, lang, opener).replace(/\s+/g, ' ').trim(),
    body: fill(body, c, lang, opener).trim(),
    optOut: OPT_OUT_LINE[lang],
  }
}

/** The body promises an attachment ("attached", "enclosed", "সংযুক্ত") — then there must be one. */
export const mentionsAttachment = (body: string) => /\b(attached|enclosed|attachment|please find)\b|সংযুক্ত|সংযোজিত/i.test(body)

/** Why the batch would skip this contact, or null when it will be sent. */
export function skipReason(c: Contact, subject: string, body: string, opener?: string): string | null {
  if (c.status === 'SENT') return 'Already sent'
  if (c.status === 'OPTED_OUT') return 'Asked not to be emailed'
  if (c.status === 'BOUNCED') return `Bounced earlier${c.error ? ` (${c.error})` : ''} — the address did not take mail`
  if (c.status === 'REPLIED') return 'Already replied'
  if (c.mxStatus === 'UNDELIVERABLE') return `No mail server for this address${c.rawStatus ? ` (${c.rawStatus})` : ''} — it would bounce`
  if (c.mxStatus === 'EXCLUDED') return `Excluded in the sheet${c.rawStatus ? ` (${c.rawStatus})` : ''}`
  if (c.mxStatus !== 'SAFE_TO_SEND' && !c.approved) {
    const why = c.mxStatus === 'UNKNOWN' ? 'No status in the sheet' : c.mxStatus === 'TECHNICAL_ONLY' ? 'Technical address' : 'Marked for review'
    return `${why}${c.rawStatus ? ` (${c.rawStatus})` : ''} — approve to include`
  }
  const miss = missingFields(c, subject, body, opener)
  if (miss.length) return `Missing ${miss.join(', ')}`
  return null
}
