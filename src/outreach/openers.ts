// src/outreach/openers.ts
// VIP / Leadership opener generation & safety guards (§5.4).

import type { Contact, OutreachLang, Source } from './types'
import { SPAM_WORDS } from './checks'
import { aiFor, aiJson, aiPaused } from '../editorial/aiProviders'

export const CANDIDATE_DESIGNATION_RE =
  /chairman|managing director|\bmd\b|ceo|secretary|minister|director general|chief|president|vice chancellor/i

/** Whether a contact qualifies as a high-value leadership candidate for personal openers. */
export function isOpenerCandidate(c: Contact): boolean {
  return CANDIDATE_DESIGNATION_RE.test(c.designation || '')
}

/** Filter contacts to those who qualify for VIP openers. */
export function openerCandidates(contacts: Contact[]): Contact[] {
  return contacts.filter(isOpenerCandidate)
}

export interface GuardOpenerContext {
  lang: OutreachLang
  sources: Source[]
  otherEntities: Set<string>
  talkingPoints?: string[]
}

export interface GuardResult {
  ok: boolean
  reason?: string
}

/**
 * Builds the entity set of names and organizations (>= 4 chars) from all contacts EXCEPT the target contact.
 */
export function buildOtherEntities(allContacts: Contact[], targetContactId: string): Set<string> {
  const set = new Set<string>()
  for (const c of allContacts) {
    if (c.id === targetContactId) continue
    const name = (c.personName || '').trim().toLowerCase()
    if (name.length >= 4) set.add(name)
    const org = (c.organization || '').trim().toLowerCase()
    if (org.length >= 4) set.add(org)
  }
  return set
}

/**
 * Guards personal opening lines for high-value contacts (§5.4).
 * Returns { ok: true } or { ok: false, reason: '...' }.
 */
export function guardOpener(
  text: string,
  contact: Contact,
  ctx: GuardOpenerContext,
): GuardResult {
  const raw = text.trim()
  if (!raw) {
    return { ok: false, reason: 'Opener is empty' }
  }

  // 1. No unresolved { or }
  if (raw.includes('{') || raw.includes('}')) {
    return { ok: false, reason: 'Contains unresolved placeholder braces' }
  }

  // 2. Length <= 400 characters
  if (raw.length > 400) {
    return { ok: false, reason: `Exceeds 400 characters (${raw.length})` }
  }

  // 3. No digits that are not in a talking point
  const tpDigits = new Set<string>()
  const points = ctx.talkingPoints ?? ctx.sources.flatMap((s) => s.points.filter((p) => p.use).map((p) => p.text))
  for (const p of points) {
    const nums = p.match(/\d+/g) || []
    for (const n of nums) tpDigits.add(n)
  }
  const textDigits = raw.match(/\d+/g) || []
  for (const d of textDigits) {
    if (!tpDigits.has(d)) {
      return { ok: false, reason: `Contains unsourced number: ${d}` }
    }
  }

  // 4. No other contact's name or organisation (>= 4 chars)
  const lower = raw.toLowerCase()
  const myName = (contact.personName || '').trim().toLowerCase()
  const myOrg = (contact.organization || '').trim().toLowerCase()

  for (const entity of ctx.otherEntities) {
    if (entity === myName || entity === myOrg) continue
    // Check whole word or substring boundary for entity
    const escaped = entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(^|[^\\p{L}])${escaped}($|[^\\p{L}])`, 'iu')
    if (re.test(lower)) {
      return { ok: false, reason: `Mentions another contact or organisation: "${entity}"` }
    }
  }

  // 5. Script matches the letter language
  const hasBengali = /\p{Script=Bengali}/u.test(raw)
  if (ctx.lang === 'bn' && !hasBengali) {
    return { ok: false, reason: 'Expected Bengali script for Bengali letter' }
  }
  if (ctx.lang === 'en' && hasBengali) {
    return { ok: false, reason: 'Contains Bengali script in English letter' }
  }

  // 6. No URL that is not esbpowerline.com or a source URL
  const urls = [...raw.matchAll(/https?:\/\/[^\s)\]]+/g)].map((m) => m[0])
  const allowedUrls = new Set<string>(['esbpowerline.com', 'www.esbpowerline.com'])
  for (const s of ctx.sources) {
    if (s.url) {
      try {
        const u = new URL(s.url)
        allowedUrls.add(u.hostname.toLowerCase())
      } catch {
        /* ignore invalid source url */
      }
    }
  }

  for (const uStr of urls) {
    try {
      const u = new URL(uStr)
      if (!allowedUrls.has(u.hostname.toLowerCase())) {
        return { ok: false, reason: `URL "${uStr}" is not esbpowerline.com or an approved source URL` }
      }
    } catch {
      return { ok: false, reason: `Malformed URL: ${uStr}` }
    }
  }

  // 7. No spam words from checks.ts
  const forSpam = lower.replace(/\bfeel\s+free\b|\bfree\s+to\s+(reply|contact|write|call)\b/gi, '')
  for (const w of SPAM_WORDS) {
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(^|[^\\p{L}])${escaped}($|[^\\p{L}])`, 'iu')
    if (re.test(forSpam)) {
      return { ok: false, reason: `Contains spam word: "${w}"` }
    }
  }

  return { ok: true }
}

/**
 * Ask AI (role outreach) to draft a 1–2 sentence personal opening line for a VIP contact.
 */
export async function writeOpenerWithAi(
  contact: Contact,
  ctx: { lang: OutreachLang; sources: Source[]; allContacts: Contact[] },
): Promise<string | null> {
  if (aiPaused()) return null
  const ai = aiFor('outreach')
  if (!ai) return null

  const usedPoints = ctx.sources.flatMap((s) => s.points.filter((p) => p.use).map((p) => p.text))
  const system = `You write a courteous 1–2 sentence personal opening greeting line for an outreach email from ESB PowerLine.
Strict Rules:
- The opener must be directly relevant to the recipient's role, organisation, and sector.
- Language: ${ctx.lang === 'bn' ? 'Formal Bengali (আনুষ্ঠানিক সরকারি ও করপোরেট শিষ্টাচার)' : 'Formal British English'}.
- Length: 1 to 2 sentences, under 300 characters.
- DO NOT use braces or placeholders like {name}.
- DO NOT invent numbers or facts not in the talking points.
- DO NOT mention any other company or person.`

  const user = `Recipient details:
Name: ${contact.personName}
Designation: ${contact.designation}
Organisation: ${contact.organization}
Sector: ${contact.sectorGroup}
${usedPoints.length ? `Approved talking points:\n${usedPoints.join('\n')}\n` : ''}
Write ONLY the 1–2 sentence opening greeting line.`

  try {
    const res = await aiJson<{ opener: string }>({
      provider: ai.provider,
      key: ai.key,
      model: ai.model,
      system,
      user,
      schema: {
        type: 'object',
        properties: { opener: { type: 'string', description: '1-2 sentence opener' } },
        required: ['opener'],
      },
      maxTokens: 500,
      effort: 'low',
    })
    const text = String(res.data?.opener || '').trim()
    const otherEntities = buildOtherEntities(ctx.allContacts, contact.id)
    const guard = guardOpener(text, contact, {
      lang: ctx.lang,
      sources: ctx.sources,
      otherEntities,
      talkingPoints: usedPoints,
    })
    if (!guard.ok) {
      return null
    }
    return text
  } catch {
    return null
  }
}
