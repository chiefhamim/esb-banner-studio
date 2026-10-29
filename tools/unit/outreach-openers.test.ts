import { describe, it, expect } from 'vitest'
import { isOpenerCandidate, guardOpener, buildOtherEntities } from '../../src/outreach/openers'
import type { Contact, Source } from '../../src/outreach/types'

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'c_lead',
    serial: 1,
    sectorGroup: 'Power Generation',
    groupNo: 1,
    organization: 'Summit Power International',
    personName: 'Muhammed Aziz Khan',
    designation: 'Chairman',
    email: 'aziz@summitpower.example.com',
    phone: '+8801700000000',
    purposes: ['HIGH_LEVEL_ENGAGEMENT'],
    mxStatus: 'SAFE_TO_SEND',
    rawStatus: 'Deliverable',
    diagnostic: '',
    sheet: 'Sheet1',
    approved: true,
    status: 'QUEUED',
    ...overrides,
  }
}

function makeSources(): Source[] {
  return [
    {
      id: 's1',
      kind: 'story',
      title: 'Summit Power 300MW Expansion',
      url: 'https://news.example.com/energy-summit',
      text: 'Summit Power expanded capacity by 300MW in 2025 across Bangladesh.',
      points: [
        { id: 'p1', text: '300MW capacity commissioned in 2025.', quote: '300MW in 2025', use: true },
      ],
      addedAt: 1000,
    },
  ]
}

describe('Openers for High-Value Leadership Contacts (5.4)', () => {
  it('correctly identifies candidate designations', () => {
    expect(isOpenerCandidate(makeContact({ designation: 'Chairman' }))).toBe(true)
    expect(isOpenerCandidate(makeContact({ designation: 'Managing Director' }))).toBe(true)
    expect(isOpenerCandidate(makeContact({ designation: 'CEO & Founder' }))).toBe(true)
    expect(isOpenerCandidate(makeContact({ designation: 'Senior Secretary' }))).toBe(true)
    expect(isOpenerCandidate(makeContact({ designation: 'Director General' }))).toBe(true)
    expect(isOpenerCandidate(makeContact({ designation: 'Chief Operating Officer' }))).toBe(true)
    expect(isOpenerCandidate(makeContact({ designation: 'Vice Chancellor' }))).toBe(true)

    expect(isOpenerCandidate(makeContact({ designation: 'Assistant Manager' }))).toBe(false)
    expect(isOpenerCandidate(makeContact({ designation: 'Software Engineer' }))).toBe(false)
    expect(isOpenerCandidate(makeContact({ designation: 'Procurement Officer' }))).toBe(false)
  })

  it('passes a clean, compliant English opener', () => {
    const contact = makeContact()
    const allContacts = [
      contact,
      makeContact({ id: 'c2', personName: 'Farhan Kabir', organization: 'Beximco Energy' }),
    ]
    const otherEntities = buildOtherEntities(allContacts, contact.id)
    const sources = makeSources()

    const opener =
      'We have closely followed your strategic leadership at Summit Power International as the sector advances national grid stability.'
    const res = guardOpener(opener, contact, { lang: 'en', sources, otherEntities })
    expect(res.ok).toBe(true)
  })

  it('passes a clean, compliant Bangla opener', () => {
    const contact = makeContact({ personName: 'মুহাম্মদ আজিজ খান', organization: 'সামিট পাওয়ার' })
    const allContacts = [
      contact,
      makeContact({ id: 'c2', personName: 'ফারহান কবির', organization: 'বেক্সিমকো' }),
    ]
    const otherEntities = buildOtherEntities(allContacts, contact.id)
    const sources = makeSources()

    const opener =
      'বাংলাদেশের বিদ্যুৎ খাতের রূপান্তরে আপনার দূরদর্শী নেতৃত্বকে আমরা আন্তরিক শ্রদ্ধা জানাই।'
    const res = guardOpener(opener, contact, { lang: 'bn', sources, otherEntities })
    expect(res.ok).toBe(true)
  })

  it('rejects openers with unresolved placeholder braces', () => {
    const contact = makeContact()
    const otherEntities = new Set<string>()
    const sources = makeSources()

    const res = guardOpener('Welcome {name}, honoured to write to you.', contact, {
      lang: 'en',
      sources,
      otherEntities,
    })
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/placeholder braces/i)
  })

  it('rejects openers exceeding 400 characters', () => {
    const contact = makeContact()
    const otherEntities = new Set<string>()
    const sources = makeSources()

    const longText = 'A'.repeat(405)
    const res = guardOpener(longText, contact, { lang: 'en', sources, otherEntities })
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/exceeds 400 characters/i)
  })

  it('rejects digits not grounded in talking points, allows sourced numbers', () => {
    const contact = makeContact()
    const otherEntities = new Set<string>()
    const sources = makeSources() // Has 300 and 2025 in talking points

    // Unsourced number 450
    const resBad = guardOpener('Congratulations on the new 450MW project.', contact, {
      lang: 'en',
      sources,
      otherEntities,
    })
    expect(resBad.ok).toBe(false)
    expect(resBad.reason).toMatch(/unsourced number/i)

    // Sourced numbers 300 and 2025
    const resGood = guardOpener('Commending your milestone 300MW achievement in 2025.', contact, {
      lang: 'en',
      sources,
      otherEntities,
    })
    expect(resGood.ok).toBe(true)
  })

  it('rejects openers naming another contact or organisation, but allows own organisation', () => {
    const contact = makeContact({ personName: 'Muhammed Aziz Khan', organization: 'Summit Power' })
    const allContacts = [
      contact,
      makeContact({ id: 'c2', personName: 'Anisur Rahman', organization: 'Beximco Petroleum' }),
    ]
    const otherEntities = buildOtherEntities(allContacts, contact.id)
    const sources = makeSources()

    // Mentioning another organisation
    const resOrg = guardOpener('In collaboration with Beximco Petroleum, we wish to invite you.', contact, {
      lang: 'en',
      sources,
      otherEntities,
    })
    expect(resOrg.ok).toBe(false)
    expect(resOrg.reason).toMatch(/another contact/i)

    // Mentioning another contact's person name
    const resName = guardOpener('Following our discussion with Anisur Rahman, we reach out to you.', contact, {
      lang: 'en',
      sources,
      otherEntities,
    })
    expect(resName.ok).toBe(false)
    expect(resName.reason).toMatch(/another contact/i)

    // Mentioning own organisation is permitted
    const resOwn = guardOpener('Honouring your stewardship at Summit Power across the country.', contact, {
      lang: 'en',
      sources,
      otherEntities,
    })
    expect(resOwn.ok).toBe(true)
  })

  it('rejects script mismatch between language and text', () => {
    const contact = makeContact()
    const otherEntities = new Set<string>()
    const sources = makeSources()

    // Bangla text in English letter
    const resEn = guardOpener('আপনাকে আন্তরিক শুভেচ্ছা জানাই।', contact, { lang: 'en', sources, otherEntities })
    expect(resEn.ok).toBe(false)
    expect(resEn.reason).toMatch(/bengali script in english letter/i)

    // English text in Bangla letter
    const resBn = guardOpener('Warmest compliments from our team.', contact, { lang: 'bn', sources, otherEntities })
    expect(resBn.ok).toBe(false)
    expect(resBn.reason).toMatch(/expected bengali script/i)
  })

  it('rejects forbidden external URLs but allows esbpowerline.com and source URLs', () => {
    const contact = makeContact()
    const otherEntities = new Set<string>()
    const sources = makeSources() // Has https://news.example.com/energy-summit

    const resBad = guardOpener('Read more at https://malicious-site.com today.', contact, {
      lang: 'en',
      sources,
      otherEntities,
    })
    expect(resBad.ok).toBe(false)
    expect(resBad.reason).toMatch(/not esbpowerline\.com or an approved source URL/i)

    const resGood1 = guardOpener('Visit https://esbpowerline.com for details.', contact, {
      lang: 'en',
      sources,
      otherEntities,
    })
    expect(resGood1.ok).toBe(true)

    const resGood2 = guardOpener('As highlighted on https://news.example.com/energy-summit recently.', contact, {
      lang: 'en',
      sources,
      otherEntities,
    })
    expect(resGood2.ok).toBe(true)
  })

  it('rejects spam words', () => {
    const contact = makeContact()
    const otherEntities = new Set<string>()
    const sources = makeSources()

    const res = guardOpener('Act now for this exclusive deal for power executives.', contact, {
      lang: 'en',
      sources,
      otherEntities,
    })
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/spam word/i)
  })
})
