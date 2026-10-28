import { describe, expect, it } from 'vitest'
import { contactsFromRows, parseCsv } from '../../src/outreach/directory'
import { buildMessage, mentionsAttachment, missingFields, sectorName, skipReason } from '../../src/outreach/compose'
import { eligible } from '../../src/outreach/campaign'
import { OUTREACH_BLUEPRINTS } from '../../src/outreach/outreachAi'
import type { Contact } from '../../src/outreach/types'

// synthetic rows only — example.com addresses, no real people
const rows = [
  ['Outreach list'],
  [],
  ['SL', 'Sector Group', 'Organization', 'Person Name', 'Designation', 'Email Address', 'Deliverability Status'],
  ['GROUP 1: POWER GENERATION'],
  ['1', '', 'Example Power Co.', 'A. Rahman', 'Managing Director', 'MD@Example.com', 'SAFE_TO_SEND'],
  ['2', 'GROUP 2', 'Sample Gas Ltd.', '', 'Chief Engineer', 'ce@example.org; alt@example.org', 'REVIEW_REQUIRED'],
  ['3', 'GROUP 2', 'Test Grid', 'C. Hossain', '', 'planning@example.net', ''],
  ['4', 'GROUP 2', 'Dup Co.', 'D', 'X', 'md@example.com', 'SAFE_TO_SEND'],
  ['5', 'GROUP 2', 'Bad Co.', 'E', 'Y', 'not-an-address', 'SAFE_TO_SEND'],
]

describe('Directory: only what the sheet says', () => {
  const { contacts, skipped, duplicates } = contactsFromRows(rows)
  it('finds the header, keeps group banners, takes the first valid address, drops repeats', () => {
    expect(contacts.map((c) => c.email)).toEqual(['md@example.com', 'ce@example.org', 'planning@example.net'])
    expect(contacts[0].sectorGroup).toBe('GROUP 1: POWER GENERATION')
    expect(contacts[1].sectorGroup).toBe('GROUP 2')
    expect(skipped).toBe(1)
    expect(duplicates).toBe(1)
  })
  it('never invents a name, an organisation or a safe status', () => {
    expect(contacts[1].personName).toBe('')
    expect(contacts[2].mxStatus).toBe('UNKNOWN')
    expect(contacts[1].mxStatus).toBe('REVIEW_REQUIRED')
  })
  it('reads CSV with quoted commas and doubled quotes', () => {
    expect(parseCsv('Email,Organization\r\nx@example.com,"Power, Gas ""and"" Grid"\r\n')).toEqual([['Email', 'Organization'], ['x@example.com', 'Power, Gas "and" Grid']])
  })
  it('refuses a sheet with no Email column', () => {
    expect(() => contactsFromRows([['Name', 'Phone'], ['A', '1']])).toThrow(/Email/)
  })
})

describe('Compose: who the batch sends to, and what they get', () => {
  const { contacts } = contactsFromRows(rows)
  const subject = 'For {organization}'
  const body = 'Dear {name},\n\nAs {designation} at {organization} you may find the attached brief useful.'
  it('sends only to SAFE (or approved) rows that can fill every placeholder', () => {
    expect(eligible(contacts, subject, body).map((c) => c.email)).toEqual(['md@example.com'])
    expect(skipReason(contacts[1], subject, body)).toMatch(/review/)
    expect(skipReason({ ...contacts[2], approved: true }, subject, body)).toBe('Missing designation')
    expect(skipReason({ ...contacts[1], approved: true }, subject, body)).toBeNull()
  })
  it('greets a nameless row as Sir/Madam (মহোদয় in Bangla) and adds the opt-out line', () => {
    const m = buildMessage(contacts[1], subject, body, 'en')
    expect(m.text.startsWith('Dear Sir/Madam,')).toBe(true)
    expect(m.text).toMatch(/reply with "unsubscribe"/)
    expect(buildMessage(contacts[1], subject, 'শ্রদ্ধেয় {name},', 'bn').text.startsWith('শ্রদ্ধেয় মহোদয়,')).toBe(true)
    expect(missingFields(contacts[1], subject, body)).toEqual([])
  })
  it('never sends twice, or to someone who opted out', () => {
    const c = contacts[0] as Contact
    expect(skipReason({ ...c, status: 'SENT' }, subject, body)).toBe('Already sent')
    expect(skipReason({ ...c, status: 'OPTED_OUT' }, subject, body)).toMatch(/not to be emailed/)
  })
  it('{sector} reads as a sector name, never as "GROUP 1"', () => {
    expect(sectorName('GROUP 1: POWER GENERATION AND TRANSMISSION')).toBe('Power Generation and Transmission')
    expect(sectorName('GROUP 2')).toBe('')
    expect(buildMessage(contacts[0], 'x', 'In {sector}.', 'en').text.startsWith('In Power Generation.')).toBe(true)
  })
  it('notices a letter that promises an attachment', () => {
    expect(mentionsAttachment(body)).toBe(true)
    expect(mentionsAttachment('সংযুক্ত করা হলো')).toBe(true)
    expect(mentionsAttachment('Dear {name}, hello.')).toBe(false)
  })
})

describe('Blueprints', () => {
  it('every letter has English and Bangla and uses only the four placeholders', () => {
    for (const b of OUTREACH_BLUEPRINTS) {
      for (const t of [b.defaultSubject, b.defaultBody, b.bengaliSubject, b.bengaliBody]) {
        expect(t).toBeTruthy()
        expect([...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).every((p) => ['name', 'designation', 'organization', 'sector'].includes(p))).toBe(true)
      }
    }
  })
})
