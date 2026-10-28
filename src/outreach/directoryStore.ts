import * as XLSX from 'xlsx'
import type { Contact, DeliverabilityStatus } from './types'

export const DEFAULT_MAILING_LIST_PATH = 'W:\\E-Mail Marketing\\ESB_Powerline_Master_Consolidated_Mailing_List.xlsx'

const EMAIL_REGEX = /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/

export interface ParsedWorkbookResult {
  sheetNames: string[]
  activeSheet: string
  contacts: Contact[]
  totalRecords: number
  uniqueEmails: number
}

/**
 * Parses raw ArrayBuffer or base64 into contacts.
 */
export function parseWorkbookBuffer(data: ArrayBuffer | Uint8Array, targetSheet?: string): ParsedWorkbookResult {
  const wb = XLSX.read(data, { type: 'array' })
  const sheetNames = wb.SheetNames
  const activeSheet = targetSheet && sheetNames.includes(targetSheet) 
    ? targetSheet 
    : (sheetNames.includes('Strategic_Verified_Safe') ? 'Strategic_Verified_Safe' : sheetNames[0])

  const sheet = wb.Sheets[activeSheet]
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

  // Find header row containing Email Address
  let headerIdx = -1
  let emailCol = -1
  let nameCol = -1
  let desigCol = -1
  let orgCol = -1
  let groupCol = -1
  let phoneCol = -1
  let purposeCol = -1
  let mxHostCol = -1
  let statusCol = -1
  let serialCol = -1

  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const row = rows[i].map((c) => String(c ?? '').trim())
    const emailIndex = row.findIndex((c) => /email(\s+address)?/i.test(c))
    if (emailIndex >= 0) {
      headerIdx = i
      emailCol = emailIndex
      nameCol = row.findIndex((c) => /person\s+name|^name$/i.test(c))
      desigCol = row.findIndex((c) => /designation/i.test(c))
      orgCol = row.findIndex((c) => /organization/i.test(c))
      groupCol = row.findIndex((c) => /sector\s+group|group/i.test(c))
      phoneCol = row.findIndex((c) => /phone|contact/i.test(c))
      purposeCol = row.findIndex((c) => /purpose/i.test(c))
      mxHostCol = row.findIndex((c) => /mail\s+server|mx/i.test(c))
      statusCol = row.findIndex((c) => /deliverability|status/i.test(c))
      serialCol = row.findIndex((c) => /serial|sl/i.test(c))
      break
    }
  }

  if (headerIdx < 0 || emailCol < 0) {
    throw new Error(`Could not find valid 'Email Address' column in sheet: ${activeSheet}`)
  }

  const contacts: Contact[] = []
  const seenEmails = new Set<string>()
  let currentGroup = 'Group 1'

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.length === 0) continue

    // Detect group banners in merged rows (e.g. GROUP 1: POWER DISTRIBUTION...)
    const firstCell = String(r[0] ?? '').trim()
    if (/^GROUP\s+\d+/i.test(firstCell) && r.filter(Boolean).length <= 2) {
      currentGroup = firstCell.split(/[:—–-]/)[0].trim()
      continue
    }

    const rawEmail = String(r[emailCol] ?? '').trim()
    if (!rawEmail || !rawEmail.includes('@')) continue

    // Split any multiple emails and take primary valid
    const tokens = rawEmail.split(/[,;\s]+/).map((t) => t.trim().toLowerCase()).filter(Boolean)
    const validEmail = tokens.find((t) => EMAIL_REGEX.test(t))
    if (!validEmail) continue

    if (seenEmails.has(validEmail)) continue
    seenEmails.add(validEmail)

    const serialVal = serialCol >= 0 && r[serialCol] ? Number(r[serialCol]) || contacts.length + 1 : contacts.length + 1
    const groupVal = groupCol >= 0 && r[groupCol] ? String(r[groupCol]).trim() : currentGroup
    const nameVal = nameCol >= 0 && r[nameCol] ? String(r[nameCol]).trim() : 'Respected Official'
    const desigVal = desigCol >= 0 && r[desigCol] ? String(r[desigCol]).trim() : ''
    const orgVal = orgCol >= 0 && r[orgCol] ? String(r[orgCol]).trim() : 'Energy Organization'
    const phoneVal = phoneCol >= 0 && r[phoneCol] ? String(r[phoneCol]).trim() : ''
    const purposeVal = purposeCol >= 0 && r[purposeCol] ? String(r[purposeCol]).trim() : 'MAGAZINE_DISTRIBUTION'
    const mxHostVal = mxHostCol >= 0 && r[mxHostCol] ? String(r[mxHostCol]).trim() : undefined
    const rawStatus = statusCol >= 0 && r[statusCol] ? String(r[statusCol]).trim().toUpperCase() : ''
    
    let mxStatus: DeliverabilityStatus = 'SAFE_TO_SEND'
    if (rawStatus.includes('REVIEW')) mxStatus = 'REVIEW_REQUIRED'
    else if (rawStatus.includes('TECH')) mxStatus = 'TECHNICAL_ONLY'
    else if (rawStatus.includes('EXCL')) mxStatus = 'EXCLUDED'

    contacts.push({
      id: `lead_${contacts.length + 1}_${validEmail.replace(/[^a-z0-9]/g, '_')}`,
      serial: serialVal,
      sectorGroup: groupVal,
      organization: orgVal,
      personName: nameVal,
      designation: desigVal,
      email: validEmail,
      phone: phoneVal,
      purpose: purposeVal,
      mxHost: mxHostVal,
      mxStatus,
      trackingStatus: 'QUEUED',
      openCount: 0,
      clickCount: 0,
      attempts: 0,
    })
  }

  return {
    sheetNames,
    activeSheet,
    contacts,
    totalRecords: rows.length - (headerIdx + 1),
    uniqueEmails: contacts.length,
  }
}
