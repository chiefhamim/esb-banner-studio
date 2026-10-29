// Before a campaign goes out: checks that need no AI and give the same answer every time. Each one reads the letter
// as written (subject, body, signature, attachments, sources) and names the exact words it found, so the editor can
// see why — not a score. The AI review in the right panel adds judgement on top; it never replaces these.

import { PLACEHOLDERS, PLACEHOLDER_RE, mentionsAttachment } from './compose'
import type { AttachmentItem, Source } from './types'

export type CheckLevel = 'bad' | 'warn' | 'ok'
export interface LetterCheck { id: string; level: CheckLevel; title: string; detail: string }

// Words that filters weigh against bulk mail from a new sender. Short on purpose: this is about a professional letter
// to officials, where any of these reads as a sales blast as well.
export const SPAM_WORDS = ['free', 'guarantee', 'guaranteed', 'act now', 'limited time', 'urgent', 'winner', 'congratulations', 'risk-free', 'no obligation', 'click here', 'buy now', 'cash', 'offer expires', '100%', 'best price', 'cheap', 'exclusive deal', 'special promotion']

/** Numbers as written: 1,200 · 3.5 · 40% · 2026 — kept with their punctuation so "1,200" matches "1,200". */
export const numbersIn = (t: string) => [...t.matchAll(/\d[\d,]*(?:\.\d+)?%?/g)].map((m) => m[0].replace(/[,.]$/, '')).filter((n) => n.replace(/\D/g, '').length >= 2)

const digits = (n: string) => n.replace(/[^\d.]/g, '')

/** Figures in the letter that no source, and not the editor's own blueprint, contains. Years and phone-like runs count. */
export function unsourcedNumbers(body: string, sources: Source[], reference = ''): string[] {
  const pool = new Set([...sources.flatMap((s) => numbersIn(s.text)), ...numbersIn(reference)].map(digits))
  return [...new Set(numbersIn(body.replace(/https?:\/\/\S+/g, '')))].filter((n) => !pool.has(digits(n)))
}

export function letterChecks(input: { subject: string; body: string; signature: string; attachments: AttachmentItem[]; sources: Source[]; reference?: string; allowedFields?: string[] }): LetterCheck[] {
  const { subject, body, signature, attachments, sources, reference = '' } = input
  const out: LetterCheck[] = []
  const add = (id: string, level: CheckLevel, title: string, detail: string) => out.push({ id, level, title, detail })
  const all = `${subject}\n${body}`
  // "feel free to reply" is courtesy, not a price
  const forSpam = all.replace(/\bfeel\s+free\b|\bfree\s+to\s+(reply|contact|write|call)\b/gi, '')

  if (!subject.trim()) add('subject', 'bad', 'No subject', 'Mail without a subject is often filtered.')
  else if (subject.length > 78) add('subject', 'warn', 'Long subject', `${subject.length} characters — phones show about 40, Gmail about 70.`)
  else add('subject', 'ok', 'Subject length', `${subject.length} characters.`)

  const words = body.trim().split(/\s+/).filter(Boolean).length
  if (words < 40) add('length', 'warn', 'Very short letter', `${words} words.`)
  else if (words > 400) add('length', 'warn', 'Long letter', `${words} words — officials read the first paragraph; keep the offer there.`)
  else add('length', 'ok', 'Length', `${words} words.`)

  const allowed = new Set([...PLACEHOLDERS, 'opener', ...(input.allowedFields ?? []).map((f) => f.toLowerCase())])
  const unknown = [...all.matchAll(new RegExp(PLACEHOLDER_RE.source, 'gi'))].map((m) => m[1].toLowerCase()).filter((p) => !allowed.has(p))
  if (unknown.length) add('placeholders', 'bad', 'Unknown placeholder', `${[...new Set(unknown)].map((p) => `{${p}}`).join(', ')} would be sent as written. Use ${PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}.`)
  const withoutPlaceholders = all.replace(new RegExp(PLACEHOLDER_RE.source, 'gi'), '')
  const broken = withoutPlaceholders.match(/\{[^}\n]*$|^[^{\n]*\}/m)
  if (broken) add('braces', 'bad', 'Unclosed brace', `“${broken[0].slice(0, 40)}” — a placeholder is missing a { or }.`)

  const found = SPAM_WORDS.filter((w) => new RegExp(`(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'iu').test(forSpam))
  if (found.length) add('spam', 'warn', 'Words spam filters weigh', found.map((w) => `“${w}”`).join(', '))
  else add('spam', 'ok', 'No sales-blast words', 'None of the usual filter words.')

  const caps = (subject.match(/\b[A-Z]{4,}\b/g) ?? []).filter((w) => !/^(ESB|BPDB|PGCB|BERC|MPEMR|SREDA|LNG|LPG|CNG|IPP|EPC|NESCO|DESCO|DPDC|REB|BREB|PDB|USAID|JICA|ADB)$/.test(w))
  if (caps.length) add('caps', 'warn', 'Capitals in the subject', caps.join(', '))
  if (/!{2,}/.test(all) || (subject.match(/!/g) ?? []).length) add('bang', 'warn', 'Exclamation marks', 'Officials read them as a sales pitch.')

  const links = [...body.matchAll(/https?:\/\/[^\s)\]]+/g)].map((m) => m[0])
  const http = links.filter((l) => l.startsWith('http:'))
  if (http.length) add('http', 'warn', 'Plain http link', `${http[0]} — links are only made clickable for https.`)
  if (links.length > 4) add('links', 'warn', 'Many links', `${links.length} links — more than a few looks like a newsletter to filters.`)
  if (/\b(bit\.ly|tinyurl|t\.co|goo\.gl)\//i.test(body)) add('short', 'warn', 'Shortened link', 'Shortened links are a common phishing sign.')

  if (mentionsAttachment(body) && !attachments.length) add('attach', 'bad', 'Promises a file that is not attached', 'The letter says “attached” or “সংযুক্ত” and nothing is attached.')
  if (attachments.length && !mentionsAttachment(body)) add('attach', 'warn', 'Files the letter does not mention', `${attachments.map((a) => a.name).join(', ')} — say what is attached.`)

  const nums = unsourcedNumbers(body, sources, reference)
  if (nums.length) add('numbers', 'warn', 'Figures not in any source', `${nums.slice(0, 6).join(', ')} — check them, or add the source they come from.`)
  else if (numbersIn(body).length) add('numbers', 'ok', 'Figures', 'Every figure appears in a source or the blueprint.')

  if (!signature.trim() && !/regards|sincerely|শুভেচ্ছা|ধন্যবাদ/i.test(body)) add('sign', 'warn', 'No sign-off', 'Choose a signature, or sign the letter.')
  if (/\b(lorem|ipsum|todo|xxx|tbd)\b/i.test(all)) add('draft', 'bad', 'Draft text left in', 'The letter still has placeholder words.')
  return out
}
