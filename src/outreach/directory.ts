// The mailing list: an .xlsx workbook or a .csv file the editor picks, read in the renderer. Nothing is read from a
// fixed path on disk (the first version asked the main process for any path it liked), and nothing the sheet does
// not say is filled in: a row with no name has no name, a row with no deliverability status is UNKNOWN — the first
// version called those "Respected Official", "Energy Organization" and SAFE_TO_SEND.

import readExcelFile from 'read-excel-file/universal'
import type { Contact, DeliverabilityStatus } from './types'

export interface Sheet { name: string; rows: string[][] }

const EMAIL_RE = /^[a-z0-9._%+'-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/

/** A CSV file, quoted fields and doubled quotes included. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

const cellText = (v: unknown) => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).trim()

/** Every sheet of the file, as rows of text. An old binary .xls is refused with what to do instead. */
export async function readMailingFile(file: Blob & { name?: string }): Promise<Sheet[]> {
  const name = (file.name || '').toLowerCase()
  if (name.endsWith('.csv')) return [{ name: (file.name || 'CSV').replace(/\.csv$/i, ''), rows: parseCsv(await file.text()) }]
  if (name.endsWith('.xls')) throw new Error('This is an old .xls workbook. Open it in Excel and save it as .xlsx, then import that.')
  const sheets = await readExcelFile(await file.arrayBuffer())
  return sheets.map((s) => ({ name: s.sheet, rows: s.data.map((r) => r.map(cellText)) }))
}

/**
 * The sheet's own status word, mapped. Measured on the ESB master list (2026-10): SAFE_TO_SEND (MX verified),
 * A_RECORD_FALLBACK (no MX record, the domain's A record might take mail), DEAD_NO_DNS (no mail server at all),
 * REVIEW_REQUIRED, ELIGIBLE (in scope but not MX-verified), TECHNICAL_ONLY, NOT_RELEVANT.
 */
export function statusOf(raw: string): DeliverabilityStatus {
  const s = raw.toUpperCase().replace(/[\s-]+/g, '_')
  if (!s) return 'UNKNOWN'
  if (/DEAD|NO_DNS|BOUNCE|INVALID|UNDELIVERABLE/.test(s)) return 'UNDELIVERABLE'
  if (/EXCL|NOT_RELEVANT|DO_NOT|UNSUB/.test(s)) return 'EXCLUDED'
  if (s.includes('TECH')) return 'TECHNICAL_ONLY'
  if (/REVIEW|FALLBACK|ELIGIBLE|CHECK/.test(s)) return 'REVIEW_REQUIRED'
  if (/SAFE|VERIFIED|VALID/.test(s)) return 'SAFE_TO_SEND'
  return 'UNKNOWN'
}

/** "GROUP 3: POWER GENERATION … — (17 leads)" → [3, "POWER GENERATION …"]; also "Group 3" alone → [3, '']. */
export function parseGroupLabel(text: string): [number, string] | null {
  const m = /^\s*GROUP\s*#?\s*(\d+)\s*(?:[:—–-]\s*(.*))?$/i.exec(text.replace(/\s+/g, ' ').trim())
  if (!m) return null
  return [Number(m[1]), (m[2] ?? '').replace(/\s*[—–-]\s*\(.*$/, '').replace(/\s*\(\d[^)]*\)\s*$/, '').trim()]
}

/** A name in capitals made readable, keeping acronyms ("(PGCB / NATIONAL LOAD DESPATCH)" stays as written inside brackets). */
export function readableGroupName(name: string): string {
  if (!name || name !== name.toUpperCase()) return name
  const small = new Set(['and', 'of', 'the', 'for', 'in', 'on', 'to', '&'])
  let depth = 0
  return name.split(/(\s+)/).map((w, i) => {
    const open = (w.match(/\(/g) || []).length, close = (w.match(/\)/g) || []).length
    const inBrackets = depth > 0 || open > 0
    depth += open - close
    if (/^\s+$/.test(w) || inBrackets || !/[A-Z]/.test(w)) return w
    const lower = w.toLowerCase()
    if (i > 0 && small.has(lower)) return lower
    return lower.replace(/(^|[-/])(\p{L})/gu, (_m, p, ch) => p + ch.toUpperCase())
  }).join('')
}

/**
 * Group names the whole workbook states: the summary sheet's "Group # | Industry / Sectoral Group Name" rows first
 * (written in ordinary case), then any "GROUP n: NAME" banner row on another sheet.
 */
export function groupNamesOf(sheets: Sheet[]): Map<number, string> {
  const names = new Map<number, string>()
  for (const sh of sheets) {
    const h = sh.rows.findIndex((r) => r.some((c) => /^group\s*#?$/i.test(c)) && r.some((c) => /group\s+name|sectoral/i.test(c)))
    if (h < 0) continue
    const gi = sh.rows[h].findIndex((c) => /^group\s*#?$/i.test(c)), ni = sh.rows[h].findIndex((c) => /group\s+name|sectoral/i.test(c))
    for (const r of sh.rows.slice(h + 1)) {
      const g = parseGroupLabel(r[gi] ?? '')
      if (g && r[ni]) names.set(g[0], r[ni].trim())
    }
  }
  for (const sh of sheets) for (const r of sh.rows) {
    const cells = r.filter(Boolean)
    if (cells.length > 2) continue
    const g = parseGroupLabel(cells[0] ?? '')
    if (g && g[1] && !names.has(g[0])) names.set(g[0], readableGroupName(g[1]))
  }
  return names
}

const isEmailHeader = (c: string) => /^e-?mail(\s+address)?$/i.test(c.trim())

const RESERVED_FIELD_KEYS = new Set(['name', 'designation', 'organization', 'sector', 'email'])

/**
 * Turns an unmapped spreadsheet header into a safe placeholder key:
 * lower-cased, non-alphanumerics to _, trimmed _, collisions get _2, reserved keys get _2,
 * headers with no Latin letters become field_<index+1>.
 */
export function headerToFieldKey(header: string, index: number, usedKeys: Set<string>): string {
  let base = (header || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!/[a-z]/.test(base)) {
    base = `field_${index + 1}`
  }
  let key = base
  if (RESERVED_FIELD_KEYS.has(key) || usedKeys.has(key)) {
    let suffix = 2
    while (usedKeys.has(`${base}_${suffix}`) || RESERVED_FIELD_KEYS.has(`${base}_${suffix}`)) {
      suffix++
    }
    key = `${base}_${suffix}`
  }
  usedKeys.add(key)
  return key
}

export interface ParsedSheet { contacts: Contact[]; skipped: number; duplicates: number }

/**
 * The contacts on one sheet. The header row is the first of the top 15 with an "Email" column; a header repeated
 * under each group banner is skipped, and a banner above the first header names the first group.
 */
export function contactsFromRows(rows: string[][], groupNames: Map<number, string> = new Map(), sheetName = ''): ParsedSheet {
  let h = -1
  for (let i = 0; i < Math.min(rows.length, 15); i++) if (rows[i].some(isEmailHeader)) { h = i; break }
  if (h < 0) throw new Error('No "Email" or "Email Address" column in the first 15 rows of this sheet.')
  const head = rows[h].map((c) => c.trim())
  const col = (re: RegExp) => head.findIndex((c) => re.test(c))
  const c = {
    email: head.findIndex(isEmailHeader), name: col(/^(person\s+)?name$|contact\s+person/i), designation: col(/designation|title|position/i),
    organization: col(/organi[sz]ation|company|institution/i), group: col(/sector\s+group|^group$|^sector$/i), phone: col(/phone|mobile/i),
    purpose: col(/purpose/i), mx: col(/mail\s+server|^mx|dns\s+record/i), status: col(/deliverability|^status$/i), serial: col(/^(serial|sl\.?|s\.?\s?no\.?)$/i),
    diagnostic: col(/diagnostic|recommended\s+action|^issue/i),
  }
  const mappedIndices = new Set([
    c.email, c.name, c.designation, c.organization, c.group, c.phone,
    c.purpose, c.mx, c.status, c.serial, c.diagnostic,
  ].filter((i) => i >= 0))
  const extraCols: { index: number; key: string }[] = []
  const usedKeys = new Set<string>()
  for (let i = 0; i < head.length; i++) {
    if (mappedIndices.has(i)) continue
    if (!head[i]) continue
    if (extraCols.length >= 30) break
    const key = headerToFieldKey(head[i], i, usedKeys)
    extraCols.push({ index: i, key })
  }
  const at = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '')
  const contacts: Contact[] = []
  const seen = new Set<string>()
  let skipped = 0, duplicates = 0
  let group: number | null = null
  // a banner above the header ("GROUP 1: …" on the row just before it) names the first group
  for (let i = h - 1; i >= 0; i--) { const g = parseGroupLabel(rows[i].filter(Boolean)[0] ?? ''); if (g) { group = g[0]; if (g[1] && !groupNames.has(g[0])) groupNames.set(g[0], readableGroupName(g[1])); break } }
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.every((x) => !x)) continue
    if (r.some(isEmailHeader)) continue // the header again, under the next group's banner
    const cells = r.filter(Boolean)
    const banner = cells.length <= 2 ? parseGroupLabel(cells[0] ?? '') : null
    if (banner) { group = banner[0]; if (banner[1] && !groupNames.has(banner[0])) groupNames.set(banner[0], readableGroupName(banner[1])); continue }
    const raw = at(r, c.email)
    // a cell with several addresses: the first valid one is the contact's, the rest are not guessed at
    const email = raw.split(/[,;\s]+/).map((t) => t.toLowerCase()).find((t) => EMAIL_RE.test(t))
    if (!email) { if (raw) skipped++; continue }
    if (seen.has(email)) { duplicates++; continue }
    seen.add(email)
    const colGroup = at(r, c.group)
    const g = parseGroupLabel(colGroup)
    const groupNo = g ? g[0] : group
    const statusWord = at(r, c.status)
    let fields: Record<string, string> | undefined
    if (extraCols.length > 0) {
      for (const col of extraCols) {
        const val = at(r, col.index)
        if (val) {
          if (!fields) fields = {}
          fields[col.key] = val.slice(0, 500)
        }
      }
    }
    contacts.push({
      id: email,
      serial: Number(at(r, c.serial)) || contacts.length + 1,
      sectorGroup: (groupNo != null ? groupNames.get(groupNo) : '') || (g ? readableGroupName(g[1]) : readableGroupName(colGroup)),
      groupNo,
      organization: at(r, c.organization),
      personName: at(r, c.name),
      designation: at(r, c.designation),
      email,
      phone: at(r, c.phone),
      purposes: at(r, c.purpose).split(/[,;]+/).map((p) => p.trim().toUpperCase().replace(/\s+/g, '_')).filter(Boolean),
      mxHost: at(r, c.mx) || undefined,
      mxStatus: statusOf(statusWord),
      rawStatus: statusWord,
      diagnostic: at(r, c.diagnostic),
      sheet: sheetName,
      approved: false,
      status: 'QUEUED',
      ...(fields ? { fields } : {}),
    })
  }
  return { contacts, skipped, duplicates }
}

/** "MAGAZINE_DISTRIBUTION" → "Magazine distribution". */
export const purposeLabel = (p: string) => p.charAt(0) + p.slice(1).toLowerCase().replace(/_/g, ' ')

export const STATUS_LABEL: Record<DeliverabilityStatus, string> = {
  SAFE_TO_SEND: 'Safe to send',
  REVIEW_REQUIRED: 'Review first',
  TECHNICAL_ONLY: 'Technical address',
  EXCLUDED: 'Excluded',
  UNDELIVERABLE: 'No mail server',
  UNKNOWN: 'No status in the sheet',
}
