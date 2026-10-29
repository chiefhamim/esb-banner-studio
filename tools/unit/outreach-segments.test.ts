import { describe, it, expect } from 'vitest'
import { blueprintFor, segmentOf, fnv1a, pickSubjectVariant, letterFor, segmentLabel } from '../../src/outreach/segments'
import type { Campaign, Contact } from '../../src/outreach/types'

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'c1',
    serial: 1,
    sectorGroup: 'Power Generation',
    groupNo: 1,
    organization: 'Apex Power Ltd',
    personName: 'Tariq Rahman',
    designation: 'Managing Director',
    email: 'tariq@apexpower.example.com',
    phone: '+8801700000000',
    purposes: ['SPONSORSHIP'],
    mxStatus: 'SAFE_TO_SEND',
    rawStatus: 'Deliverable',
    diagnostic: '',
    sheet: 'Sheet1',
    approved: true,
    status: 'QUEUED',
    ...overrides,
  }
}

function makeCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'camp1',
    name: 'Q4 Energy Outreach',
    createdAt: 1000,
    updatedAt: 1000,
    status: 'draft',
    kind: 'list',
    listId: 'list1',
    sheet: 'Sheet1',
    audience: { group: null, purposes: [] },
    recipients: [],
    blueprint: 'corporate_sponsorship',
    lang: 'en',
    subject: 'Main Campaign Subject',
    body: 'Main Campaign Body for {organization}.',
    signatureId: 'none',
    letterhead: false,
    sources: [],
    scheduledAt: null,
    sent: {},
    failed: {},
    replied: {},
    bounced: {},
    followUp: { afterDays: 3, subject: '', body: '' },
    followed: {},
    interrupted: null,
    ...overrides,
  }
}

describe('Audience Segments & Deterministic Variants (5.1)', () => {
  it('computes segmentOf keys accurately from groupNo and purpose mapping', () => {
    const c1 = makeContact({ groupNo: 1, purposes: ['SPONSORSHIP'] })
    expect(blueprintFor(c1)).toBe('corporate_sponsorship')
    expect(segmentOf(c1)).toBe('1:corporate_sponsorship')

    const c2 = makeContact({ groupNo: 3, purposes: ['MAGAZINE_DISTRIBUTION'] })
    expect(blueprintFor(c2)).toBe('magazine_distribution')
    expect(segmentOf(c2)).toBe('3:magazine_distribution')

    const cNoGroup = makeContact({ groupNo: null, purposes: ['EXECUTIVE_INTERVIEW', 'HIGH_LEVEL_ENGAGEMENT'] })
    expect(blueprintFor(cNoGroup)).toBe('executive_interview')
    expect(segmentOf(cNoGroup)).toBe('x:executive_interview')

    const cUnmapped = makeContact({ groupNo: 2, purposes: ['UNKNOWN_TAG'] })
    expect(blueprintFor(cUnmapped)).toBeNull()
    expect(segmentOf(cUnmapped)).toBe('2:custom')

    const cEmpty = makeContact({ groupNo: null, purposes: [] })
    expect(segmentOf(cEmpty)).toBe('x:custom')
  })

  it('letterFor falls back to main letter when variant is missing or in draft', () => {
    const c = makeContact({ groupNo: 1, purposes: ['SPONSORSHIP'] })
    const camp = makeCampaign({
      subject: 'Fallback Subject',
      body: 'Fallback Body',
      variants: {
        '1:corporate_sponsorship': {
          subject: 'Draft Subject',
          body: 'Draft Body',
          status: 'draft',
          by: 'ai',
          at: 1000,
        },
      },
    })

    const res = letterFor(c, camp)
    expect(res.isVariant).toBe(false)
    expect(res.subject).toBe('Fallback Subject')
    expect(res.body).toBe('Fallback Body')
  })

  it('letterFor uses variant only when status is approved', () => {
    const c = makeContact({ groupNo: 1, purposes: ['SPONSORSHIP'] })
    const camp = makeCampaign({
      subject: 'Fallback Subject',
      body: 'Fallback Body',
      variants: {
        '1:corporate_sponsorship': {
          subject: 'Approved Variant Subject',
          body: 'Approved Variant Body',
          status: 'approved',
          by: 'you',
          at: 1000,
        },
      },
    })

    const res = letterFor(c, camp)
    expect(res.isVariant).toBe(true)
    expect(res.subject).toBe('Approved Variant Subject')
    expect(res.body).toBe('Approved Variant Body')
    expect(res.segmentKey).toBe('1:corporate_sponsorship')
  })

  it('deterministic subject variant spread: 1,000 addresses distributed evenly within ±15% of 1/3', () => {
    const variants = ['Subject A: Partnership', 'Subject B: Executive Briefing', 'Subject C: Collaboration']
    const counts = [0, 0, 0]

    for (let i = 0; i < 1000; i++) {
      const email = `contact${i}@enterprise${i % 100}.example.com`
      const picked = pickSubjectVariant(email, variants, 'Default')
      const idx = variants.indexOf(picked)
      expect(idx).toBeGreaterThanOrEqual(0)
      counts[idx]++
    }

    // Expected per variant = 1000 / 3 = 333.33
    // ±15% bounds = [283, 383]
    for (const count of counts) {
      expect(count).toBeGreaterThanOrEqual(283)
      expect(count).toBeLessThanOrEqual(383)
    }

    // Verify stability: same email always yields identical subject
    const testEmail = 'lead.engineer@powergrid.example.com'
    const pick1 = pickSubjectVariant(testEmail, variants, 'Default')
    const pick2 = pickSubjectVariant(testEmail, variants, 'Default')
    expect(pick1).toBe(pick2)
  })

  it('old campaigns with no variants or subjectVariants load and return base letter', () => {
    const c = makeContact()
    const legacyCamp = makeCampaign() // no variants, no subjectVariants
    const res = letterFor(c, legacyCamp)
    expect(res.isVariant).toBe(false)
    expect(res.subject).toBe('Main Campaign Subject')
    expect(res.body).toBe('Main Campaign Body for {organization}.')
  })

  it('formats segment labels cleanly', () => {
    const contacts = [makeContact({ groupNo: 1, sectorGroup: 'Group 1: Power Generation' })]
    expect(segmentLabel('1:corporate_sponsorship', contacts)).toBe('Group 1: Power Generation · Corporate Sponsorship')
    expect(segmentLabel('x:magazine_distribution')).toBe('General Audience · Magazine Distribution')
  })
})
