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

function statusOf(raw: string): DeliverabilityStatus {
  const s = raw.toUpperCase()
  if (!s) return 'UNKNOWN'
  if (s.includes('EXCL')) return 'EXCLUDED'
  if (s.includes('TECH')) return 'TECHNICAL_ONLY'
  if (s.includes('REVIEW')) return 'REVIEW_REQUIRED'
  if (s.includes('SAFE')) return 'SAFE_TO_SEND'
  return 'UNKNOWN'
}

export interface ParsedSheet { contacts: Contact[]; skipped: number; duplicates: number }

/** The contacts on one sheet. The header row is the first of the top 15 with an "Email" column. */
export function contactsFromRows(rows: string[][]): ParsedSheet {
  let h = -1
  for (let i = 0; i < Math.min(rows.length, 15); i++) if (rows[i].some((c) => /^e-?mail(\s+address)?$/i.test(c.trim()))) { h = i; break }
  if (h < 0) throw new Error('No "Email" or "Email Address" column in the first 15 rows of this sheet.')
  const head = rows[h].map((c) => c.trim())
  const col = (re: RegExp) => head.findIndex((c) => re.test(c))
  const c = {
    email: col(/^e-?mail(\s+address)?$/i), name: col(/^(person\s+)?name$|contact\s+person/i), designation: col(/designation|title|position/i),
    organization: col(/organi[sz]ation|company|institution/i), group: col(/sector\s+group|^group$|^sector$/i), phone: col(/phone|mobile/i),
    purpose: col(/purpose/i), mx: col(/mail\s+server|^mx/i), status: col(/deliverability|status/i), serial: col(/^(serial|sl\.?|s\.?\s?no\.?)$/i),
  }
  const at = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '')
  const contacts: Contact[] = []
  const seen = new Set<string>()
  let skipped = 0, duplicates = 0, group = ''
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.every((x) => !x)) continue
    // a banner row such as "GROUP 1: POWER GENERATION" names the group for the rows under it
    const first = (r[0] ?? '').trim()
    if (/^GROUP\s+\d+/i.test(first) && r.filter(Boolean).length <= 2) { group = first.replace(/\s+/g, ' '); continue }
    const raw = at(r, c.email)
    // a cell with several addresses: the first valid one is the contact's, the rest are not guessed at
    const email = raw.split(/[,;\s]+/).map((t) => t.toLowerCase()).find((t) => EMAIL_RE.test(t))
    if (!email) { if (raw) skipped++; continue }
    if (seen.has(email)) { duplicates++; continue }
    seen.add(email)
    contacts.push({
      id: email,
      serial: Number(at(r, c.serial)) || contacts.length + 1,
      // a bare "GROUP 2" in the column takes the banner's full name ("GROUP 2: GAS …") when the banner is that group
      sectorGroup: (() => { const g = at(r, c.group); return g && !/^GROUP\s+\d+$/i.test(g) ? g : group && (!g || group.toUpperCase().startsWith(g.toUpperCase() + ':') || group.toUpperCase() === g.toUpperCase()) ? group : g })(),
      organization: at(r, c.organization),
      personName: at(r, c.name),
      designation: at(r, c.designation),
      email,
      phone: at(r, c.phone),
      purpose: at(r, c.purpose),
      mxHost: at(r, c.mx) || undefined,
      mxStatus: statusOf(at(r, c.status)),
      approved: false,
      status: 'QUEUED',
    })
  }
  return { contacts, skipped, duplicates }
}

export const STATUS_LABEL: Record<DeliverabilityStatus, string> = {
  SAFE_TO_SEND: 'Safe to send',
  REVIEW_REQUIRED: 'Review first',
  TECHNICAL_ONLY: 'Technical address',
  EXCLUDED: 'Excluded',
  UNKNOWN: 'No status in the sheet',
}
