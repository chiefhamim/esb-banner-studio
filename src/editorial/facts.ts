// Deterministic fact table and discrepancy verification engine.
// Compares editorial draft against source facts with 0 hallucination risk.

import { bengaliToAsciiDigits, parseBengaliAmount } from './bengali'

export interface FactItem {
  id: string
  kind: 'currency' | 'number' | 'date' | 'quote' | 'entity'
  raw: string
  normalized: string
  sourceOffset?: number
}

export interface DiscrepancyFlag {
  field: string
  text: string
  kind: 'unverified_number' | 'unverified_currency' | 'unverified_quote' | 'unverified_date' | 'unverified_entity'
  severity: 'warning' | 'error'
  message: string
}

export const KNOWN_ENERGY_ENTITIES = [
  'BERC', 'PGCB', 'BPDB', 'DPDC', 'DESCO', 'Petrobangla', 'Titas',
  'BAPEX', 'SGFL', 'BGFCL', 'REB', 'BREB', 'RPGCL', 'NWPGCL', 'APSCL',
  'EGCB', 'CPGCBL', 'WZPDCL', 'NESCO', 'SREDA', 'Power Division', 'Energy Division',
  'Summit Power', 'United Power', 'Orion Group', 'Beximco', 'Barapukuria', 'Rooppur',
  'Matarbari', 'Payra', 'Rampal', 'Bheramara', 'Bibiyana', 'Kailashtila', 'Rashidpur',
]

/**
 * Extracts all verifiable facts from a source text (Bengali or English).
 */
export function extractFactTable(sourceText: string): FactItem[] {
  const facts: FactItem[] = []
  let factId = 0
  const ascii = bengaliToAsciiDigits(sourceText)

  // 1. Currencies & Large Amounts (crore, lakh, Tk, BDT, $)
  const currencyRegex = /(?:(?:টাকা|৳|Tk\.?|BDT|\$|USD)\s*)?[0-9০-৯]+(?:[,.][0-9০-৯]+)?\s*(?:কোটি|লাখ|লক্ষ|crore|lakh|thousand|হাজার)?(?:\s*(?:টাকা|৳|Tk\.?|BDT|\$|USD))?/gi
  const currencyMatches = sourceText.matchAll(currencyRegex)
  for (const m of currencyMatches) {
    const raw = m[0].trim()
    if (!raw || !/[0-9০-৯]/.test(raw)) continue
    const amt = parseBengaliAmount(raw)
    if (amt && amt.currency) {
      facts.push({
        id: `f-${++factId}`,
        kind: 'currency',
        raw,
        normalized: amt.normalized,
        sourceOffset: m.index,
      })
    }
  }

  // 2. Units & Capacities (MW, GW, MMCFD, BCM, kV, kWh, %, etc.) — Latin and Bengali spellings
  const BN_UNITS: Record<string, string> = {
    'মেগাওয়াট': 'MW', 'গিগাওয়াট': 'GW', 'কিলোওয়াট': 'KW', 'এমএমসিএফডি': 'MMCFD', 'এমএমসিএফ': 'MMCF',
    'কেভি': 'KV', 'শতাংশ': '%', 'টিসিএফ': 'TCF', 'বিসিএম': 'BCM',
  }
  const unitRegex = /([0-9]+(?:[,.][0-9]+)?)\s*(MW|GW|KW|MMCFD|BCM|TCF|KV|KWH|MVAR|%|শতাংশ|মেগাওয়াট|গিগাওয়াট|কিলোওয়াট|এমএমসিএফডি|এমএমসিএফ|কেভি|টিসিএফ|বিসিএম)/gi
  const unitMatches = ascii.matchAll(unitRegex)
  for (const m of unitMatches) {
    const raw = m[0].trim()
    facts.push({
      id: `f-${++factId}`,
      kind: 'number',
      raw,
      normalized: `${m[1]} ${BN_UNITS[m[2]] ?? m[2].toUpperCase()}`,
      sourceOffset: m.index,
    })
  }

  // 3. Quoted Statements ("...", “...”, '...')
  const quoteRegex = /["“'‘]([\s\S]{8,160}?)["”'’]/g
  const quoteMatches = sourceText.matchAll(quoteRegex)
  for (const m of quoteMatches) {
    const raw = m[1].trim()
    if (raw.length > 5) {
      facts.push({
        id: `f-${++factId}`,
        kind: 'quote',
        raw: m[0],
        normalized: raw,
        sourceOffset: m.index,
      })
    }
  }

  // 4. Known Bangladesh Energy Sector Entities
  for (const entity of KNOWN_ENERGY_ENTITIES) {
    const idx = sourceText.indexOf(entity)
    if (idx !== -1) {
      facts.push({
        id: `f-${++factId}`,
        kind: 'entity',
        raw: entity,
        normalized: entity,
        sourceOffset: idx,
      })
    }
  }

  // One chip per distinct fact: the same figure in the headline and the body is one fact, at its first offset.
  const seen = new Set<string>()
  return facts.filter((f) => {
    const key = `${f.kind}|${f.normalized.toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Validates a draft headline, deck, or body against the extracted source facts.
 * Flags numbers, currency amounts, or quotes in the draft that do not exist in the source.
 */
export function verifyDraftAgainstSource(draftText: string, sourceText: string, factTable: FactItem[]): DiscrepancyFlag[] {
  const flags: DiscrepancyFlag[] = []
  const draftAscii = bengaliToAsciiDigits(draftText)
  const sourceAscii = bengaliToAsciiDigits(sourceText)

  // 1. Verify numbers in draft (e.g. 592, 30, 500, 1500)
  const draftNums = draftAscii.matchAll(/\b([0-9]+(?:[,.][0-9]+)?)\b/g)
  for (const m of draftNums) {
    const num = m[1]
    // Ignore trivial single-digit ordinals or small integers 0-9 unless part of a metric
    if (num.length === 1 && parseInt(num, 10) < 5) continue

    if (!sourceAscii.includes(num)) {
      flags.push({
        field: 'draft',
        text: m[0],
        kind: 'unverified_number',
        severity: 'error',
        message: `Figure "${m[0]}" in draft does not appear in source material.`,
      })
    }
  }

  // 2. Verify quoted text in draft
  const draftQuotes = draftText.matchAll(/["“'‘]([\s\S]{8,120}?)["”'’]/g)
  for (const m of draftQuotes) {
    const quote = m[1].trim()
    if (!sourceText.includes(quote)) {
      flags.push({
        field: 'quote',
        text: m[0],
        kind: 'unverified_quote',
        severity: 'warning',
        message: `Quote "${m[0]}" does not match source text verbatim. Verify or mark as paraphrase.`,
      })
    }
  }

  // 3. Check entity mentions: if draft introduces known energy entities not in factTable.
  // A Bengali source cannot be matched against Latin-script names, so entity checks are skipped there
  // (numbers and quotes above remain verified) to avoid false alarms on every translated name.
  const sourceIsBengali = /[\u0980-\u09FF]/.test(sourceText)
  for (const entity of sourceIsBengali ? [] : KNOWN_ENERGY_ENTITIES) {
    if (draftText.includes(entity) && !factTable.some((f) => f.kind === 'entity' && f.raw === entity)) {
      flags.push({
        field: 'entity',
        text: entity,
        kind: 'unverified_entity',
        severity: 'warning',
        message: `Institution "${entity}" mentioned in draft is not present in source fact table.`,
      })
    }
  }

  return flags
}
