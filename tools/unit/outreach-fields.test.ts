import { describe, expect, it } from 'vitest'
import { headerToFieldKey, contactsFromRows } from '../../src/outreach/directory'
import { fill, missingFields, fieldValue, PLACEHOLDER_RE } from '../../src/outreach/compose'
import { letterChecks } from '../../src/outreach/checks'
import type { Contact } from '../../src/outreach/types'

describe('Step 4.1: Dynamic fields, fallbacks, and placeholder checks', () => {
  it('normalizes headers to field keys, handles collisions, reserved words, and non-latin headers', () => {
    const used = new Set<string>()
    // Standard latin header
    expect(headerToFieldKey('Postal Address', 0, used)).toBe('postal_address')
    // Collision gets _2
    expect(headerToFieldKey('Postal Address', 1, used)).toBe('postal_address_2')
    // Third collision gets _3
    expect(headerToFieldKey('Postal Address', 2, used)).toBe('postal_address_3')

    // Reserved words (name, designation, organization, sector, email) get _2
    expect(headerToFieldKey('Name', 3, used)).toBe('name_2')
    expect(headerToFieldKey('Organization', 4, used)).toBe('organization_2')

    // Non-latin header (Bangla) has no latin letters -> field_<index+1>
    expect(headerToFieldKey('ঠিকানা', 7, used)).toBe('field_8')
    // Numeric-only header
    expect(headerToFieldKey('12345', 8, used)).toBe('field_9')
  })

  it('captures unmapped columns into contact.fields up to 30 columns', () => {
    const rows = [
      ['Email', 'Name', 'Organization', 'City', 'Membership ID', 'ঠিকানা'],
      ['user@example.com', 'A. Rahim', 'Solar Tech', 'Dhaka', 'MEM-99', 'Gulshan-2'],
    ]
    const { contacts } = contactsFromRows(rows)
    expect(contacts).toHaveLength(1)
    const c = contacts[0]
    expect(c.email).toBe('user@example.com')
    expect(c.personName).toBe('A. Rahim')
    expect(c.organization).toBe('Solar Tech')
    expect(c.fields).toBeDefined()
    expect(c.fields?.city).toBe('Dhaka')
    expect(c.fields?.membership_id).toBe('MEM-99')
    expect(c.fields?.field_6).toBe('Gulshan-2')
  })

  it('resolves {key|fallback} syntax with fill()', () => {
    const c: Contact = {
      id: 'c1',
      serial: 1,
      sectorGroup: 'GROUP 1: POWER GENERATION',
      groupNo: 1,
      organization: 'National Grid Co.',
      personName: 'Engr. Kamal',
      designation: '',
      email: 'kamal@example.com',
      phone: '',
      purposes: [],
      mxStatus: 'SAFE_TO_SEND',
      rawStatus: 'SAFE_TO_SEND',
      diagnostic: '',
      sheet: 'Sheet1',
      approved: false,
      status: 'QUEUED',
      fields: {
        district: 'Chattogram',
        empty_field: '',
      },
    }

    // 1. Present value used
    expect(fill('Dear {name},', c, 'en')).toBe('Dear Engr. Kamal,')
    expect(fill('In {district|our area}', c, 'en')).toBe('In Chattogram')

    // 2. Absent value with fallback uses fallback
    expect(fill('As {designation|Representative}', c, 'en')).toBe('As Representative')
    expect(fill('Located in {region|Bangladesh}', c, 'en')).toBe('Located in Bangladesh')

    // 3. Absent value with empty fallback {key|} yields empty string without missing error
    expect(fill('Welcome{opener|} to ESB', c, 'en')).toBe('Welcome to ESB')

    // 4. {name} without fallback keeps courtesy default
    const nameless: Contact = { ...c, personName: '' }
    expect(fill('Dear {name},', nameless, 'en')).toBe('Dear Sir/Madam,')
    expect(fill('Dear {name|Friend},', nameless, 'en')).toBe('Dear Friend,')
    expect(fill('শ্রদ্ধেয় {name},', nameless, 'bn')).toBe('শ্রদ্ধেয় মহোদয়,')
  })

  it('missingFields ignores placeholders with fallbacks, skipping nobody who has a fallback', () => {
    const c: Contact = {
      id: 'c1',
      serial: 1,
      sectorGroup: '',
      groupNo: null,
      organization: 'Example Corp',
      personName: '', // {name} has courtesy fallback
      designation: '',
      email: 'user@example.com',
      phone: '',
      purposes: [],
      mxStatus: 'SAFE_TO_SEND',
      rawStatus: '',
      diagnostic: '',
      sheet: 'S1',
      approved: true,
      status: 'QUEUED',
      fields: {},
    }

    // Without fallback, designation is missing
    expect(missingFields(c, 'Hello', 'As {designation}')).toEqual(['designation'])

    // With fallback, designation is NOT missing
    expect(missingFields(c, 'Hello', 'As {designation|Valued Colleague}')).toEqual([])

    // Custom field without fallback is missing
    expect(missingFields(c, 'Hello', 'Visit {branch}')).toEqual(['branch'])

    // Custom field with fallback is NOT missing
    expect(missingFields(c, 'Hello', 'Visit {branch|our main office}')).toEqual([])

    // Empty fallback {opener|} is NOT missing
    expect(missingFields(c, 'Hello', '{opener|}Welcome!')).toEqual([])
  })

  it('letterChecks accepts list field keys and ignores | fallbacks in unclosed brace check', () => {
    const allowedFields = ['address', 'district']

    // Valid list field {address} is accepted when in allowedFields
    const checkValid = letterChecks({
      subject: 'Inquiry for {organization}',
      body: Array(15).fill('Please visit our office at {address|Dhaka} or contact {name} at {organization}.').join(' '),
      signature: 'Best regards',
      attachments: [],
      sources: [],
      allowedFields,
    })
    expect(checkValid.find((x) => x.id === 'placeholders')?.level).not.toBe('bad')
    expect(checkValid.find((x) => x.id === 'braces')?.level).toBeUndefined()

    // Typo {adress} is flagged as unknown placeholder
    const checkTypo = letterChecks({
      subject: 'Inquiry for {organization}',
      body: Array(15).fill('Please visit our office at {adress} or contact {name}.').join(' '),
      signature: 'Best regards',
      attachments: [],
      sources: [],
      allowedFields,
    })
    const phError = checkTypo.find((x) => x.id === 'placeholders')
    expect(phError).toBeDefined()
    expect(phError?.level).toBe('bad')
    expect(phError?.detail).toContain('{adress}')

    // Unclosed brace is still caught
    const checkBroken = letterChecks({
      subject: 'Inquiry',
      body: Array(15).fill('Hello {name, how are you today?').join(' '),
      signature: 'Best regards',
      attachments: [],
      sources: [],
      allowedFields,
    })
    expect(checkBroken.find((x) => x.id === 'braces')?.level).toBe('bad')
  })
})
