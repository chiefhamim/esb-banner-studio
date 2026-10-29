import { describe, expect, it } from 'vitest'
import { reviewRendered, actionableFlags } from '../../src/outreach/rendered'
import type { Contact } from '../../src/outreach/types'

describe('Step 4.4: reviewRendered & per-message checks', () => {
  const baseContact: Contact = {
    id: 'c1',
    serial: 1,
    sectorGroup: 'Power',
    groupNo: 1,
    organization: 'Summit Power',
    personName: 'Muhammed Aziz Khan',
    designation: 'Chairman',
    email: 'aziz@summitpower.com',
    phone: '',
    purposes: [],
    mxStatus: 'SAFE_TO_SEND',
    rawStatus: '',
    diagnostic: '',
    sheet: 'S1',
    approved: true,
    status: 'QUEUED',
  }

  it('detects empty_fragment defects: doubled commas, dangling at/of, doubled spaces, and punctuation lines', () => {
    // 1. Doubled comma
    const f1 = reviewRendered(baseContact, { subject: 'Valid subject', body: 'Dear Sir, , how are you?' })
    expect(f1.some((f) => f.kind === 'empty_fragment')).toBe(true)

    // 2. Dangling " at ."
    const f2 = reviewRendered(baseContact, { subject: 'Valid subject', body: 'In your role as Chairman at . We invite you.' })
    expect(f2.some((f) => f.kind === 'empty_fragment')).toBe(true)

    // 3. Dangling "of ,"
    const f3 = reviewRendered(baseContact, { subject: 'Valid subject', body: 'The census of , is published.' })
    expect(f3.some((f) => f.kind === 'empty_fragment')).toBe(true)

    // 4. Doubled space
    const f4 = reviewRendered(baseContact, { subject: 'Valid subject', body: 'Hello  world' })
    expect(f4.some((f) => f.kind === 'empty_fragment')).toBe(true)

    // 5. Line with only punctuation
    const f5 = reviewRendered(baseContact, { subject: 'Valid subject', body: 'Hello\n...\nWorld' })
    expect(f5.some((f) => f.kind === 'empty_fragment')).toBe(true)

    // Clean text has no empty_fragment
    const clean = reviewRendered(baseContact, {
      subject: 'Valid subject',
      body: 'Dear Muhammed Aziz Khan,\n\nIn your capacity as Chairman at Summit Power, we present our census.',
    })
    expect(clean.some((f) => f.kind === 'empty_fragment')).toBe(false)
  })

  it('detects odd_name: emails in name, digits in name, name equals org, role word names', () => {
    // Name with email
    const fEmail = reviewRendered({ ...baseContact, personName: 'john@summit.com' }, { subject: 'Subj', body: 'Body' })
    expect(fEmail.some((f) => f.kind === 'odd_name')).toBe(true)

    // Name with digits
    const fDigit = reviewRendered({ ...baseContact, personName: 'Engr. Kamal 02' }, { subject: 'Subj', body: 'Body' })
    expect(fDigit.some((f) => f.kind === 'odd_name')).toBe(true)

    // Name equals org
    const fOrg = reviewRendered({ ...baseContact, personName: 'Summit Power' }, { subject: 'Subj', body: 'Body' })
    expect(fOrg.some((f) => f.kind === 'odd_name')).toBe(true)

    // Role word as name
    const fRole = reviewRendered({ ...baseContact, personName: 'admin' }, { subject: 'Subj', body: 'Body' })
    expect(fRole.some((f) => f.kind === 'odd_name')).toBe(true)

    // Normal Bangla name is valid
    const cleanBn = reviewRendered({ ...baseContact, personName: 'কামাল হোসেন' }, { subject: 'Subj', body: 'Body' })
    expect(cleanBn.some((f) => f.kind === 'odd_name')).toBe(false)
  })

  it('detects generic_mailbox_with_name when role mailbox receives personalized email', () => {
    const roleContact: Contact = {
      ...baseContact,
      email: 'info@summitpower.com',
      personName: 'Muhammed Aziz Khan',
    }
    const flags = reviewRendered(roleContact, { subject: 'Subj', body: 'Body' })
    expect(flags.some((f) => f.kind === 'generic_mailbox_with_name')).toBe(true)

    // When no personName is given, generic mailbox is expected and not flagged
    const namelessRole: Contact = { ...roleContact, personName: '' }
    const flags2 = reviewRendered(namelessRole, { subject: 'Subj', body: 'Body' })
    expect(flags2.some((f) => f.kind === 'generic_mailbox_with_name')).toBe(false)
  })

  it('detects long_subject when filled subject exceeds 78 characters', () => {
    const longSubj = 'This is an extremely long subject line that goes on and on and exceeds the seventy-eight character limit'
    const flags = reviewRendered(baseContact, { subject: longSubj, body: 'Body' })
    expect(flags.some((f) => f.kind === 'long_subject')).toBe(true)

    const normalSubj = 'Official Census of Bangladesh Energy Ecosystem (Summit Power)'
    const cleanFlags = reviewRendered(baseContact, { subject: normalSubj, body: 'Body' })
    expect(cleanFlags.some((f) => f.kind === 'long_subject')).toBe(false)
  })

  it('actionableFlags filters out informational flags (no_name, fallback_used)', () => {
    const namelessContact: Contact = { ...baseContact, personName: '' }
    const flags = reviewRendered(namelessContact, { subject: 'Subj', body: 'Clean body' })
    expect(flags.some((f) => f.kind === 'no_name')).toBe(true)
    // Should NOT be actionable (never sent to Needs you)
    expect(actionableFlags(flags)).toHaveLength(0)
  })
})
