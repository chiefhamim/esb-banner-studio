// One template, many recipients: {name}, {designation}, {organization} and {sector} are filled from the contact's
// own row. A placeholder the row cannot fill keeps that contact out of the batch ("missing designation") rather than
// sending "In your capacity as  at ," — the only stand-in is the greeting, where "Sir/Madam" is ordinary courtesy.
// Every message ends with a line telling the reader how to stop further emails; the main process adds the matching
// List-Unsubscribe header.

import type { Contact, OutreachLang } from './types'

export const PLACEHOLDERS = ['name', 'designation', 'organization', 'sector'] as const
type Placeholder = (typeof PLACEHOLDERS)[number]

/** "GROUP 1: POWER GENERATION" → "Power Generation"; a bare "GROUP 2" names no sector. */
export function sectorName(group: string): string {
  const s = group.replace(/^GROUP\s+\d+\s*[:—–-]?\s*/i, '').trim()
  return s && s === s.toUpperCase() ? s.toLowerCase().replace(/\b\p{L}/gu, (ch) => ch.toUpperCase()).replace(/\b(And|Of|The|For|In)\b/g, (w) => w.toLowerCase()) : s
}

const value = (c: Contact, p: Placeholder): string =>
  p === 'name' ? c.personName : p === 'designation' ? c.designation : p === 'organization' ? c.organization : sectorName(c.sectorGroup)

/** The placeholders a template uses. */
export function usedPlaceholders(...texts: string[]): Placeholder[] {
  const all = texts.join('\n')
  return PLACEHOLDERS.filter((p) => all.includes(`{${p}}`))
}

/** The fields this contact's row leaves empty but the template needs ({name} has a courteous fallback). */
export function missingFields(c: Contact, subject: string, body: string): Placeholder[] {
  return usedPlaceholders(subject, body).filter((p) => p !== 'name' && !value(c, p).trim())
}

export function fill(text: string, c: Contact, lang: OutreachLang): string {
  return text.replace(/\{(name|designation|organization|sector)\}/g, (_m, p: Placeholder) => {
    const v = value(c, p).trim()
    if (v) return v
    return p === 'name' ? (lang === 'bn' ? 'মহোদয়' : 'Sir/Madam') : ''
  })
}

export const OPT_OUT_LINE: Record<OutreachLang, string> = {
  en: 'If you would rather not receive emails from ESB PowerLine, reply with "unsubscribe" and we will not write again.',
  bn: 'ভবিষ্যতে ইএসবি পাওয়ারলাইনের ইমেইল পেতে না চাইলে "unsubscribe" লিখে উত্তর দিন; আমরা আর লিখব না।',
}

/** The subject, body (with its marks) and opt-out line one recipient gets; the main process renders the HTML. */
export function buildMessage(c: Contact, subject: string, body: string, lang: OutreachLang): { subject: string; body: string; optOut: string } {
  return { subject: fill(subject, c, lang).replace(/\s+/g, ' ').trim(), body: fill(body, c, lang).trim(), optOut: OPT_OUT_LINE[lang] }
}

/** The body promises an attachment ("attached", "enclosed", "সংযুক্ত") — then there must be one. */
export const mentionsAttachment = (body: string) => /\b(attached|enclosed|attachment|please find)\b|সংযুক্ত|সংযোজিত/i.test(body)

/** Why the batch would skip this contact, or null when it will be sent. */
export function skipReason(c: Contact, subject: string, body: string): string | null {
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
  const miss = missingFields(c, subject, body)
  if (miss.length) return `Missing ${miss.join(', ')}`
  return null
}
