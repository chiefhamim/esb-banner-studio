import { describe, it, expect } from 'vitest'
import { buildJobSpec } from '../../src/outreach/jobSpec'
import { buildMessage } from '../../src/outreach/compose'
import { followUpLetter } from '../../src/outreach/campaign'
import type { Campaign, Contact } from '../../src/outreach/types'

function mockCampaign(over: Partial<Campaign> = {}): Campaign {
  return {
    id: 'cmp-alpha',
    name: 'Sector Intelligence Briefing',
    createdAt: 1000,
    updatedAt: 1000,
    status: 'draft',
    kind: 'list',
    listId: 'list-1',
    sheet: 'Energy',
    audience: { group: null, purposes: [] },
    recipients: [],
    blueprint: 'magazine',
    lang: 'en',
    subject: 'ESB PowerLine: Energy Sector Report for {organization}',
    body: 'Dear {name},\n\nWe are sharing the latest briefings for {organization}.',
    signatureId: 'sig-default',
    letterhead: true,
    officialPad: false,
    sources: [],
    scheduledAt: null,
    sent: {},
    failed: {},
    replied: {},
    bounced: {},
    followUp: {
      afterDays: 5,
      subject: 'Re: Sector Report Follow-up',
      body: 'Dear {name},\n\nFollowing up on our report for {organization}.',
    },
    followed: {},
    interrupted: null,
    ...over,
  }
}

function mockContact(i: number, over: Partial<Contact> = {}): Contact {
  return {
    id: `ct-${i}`,
    serial: i,
    sectorGroup: 'Power',
    groupNo: 1,
    organization: `Company ${i}`,
    personName: `Person ${i}`,
    designation: 'Director',
    email: `contact${i}@company${i}.example.com`,
    phone: '',
    purposes: [],
    mxStatus: 'SAFE_TO_SEND',
    rawStatus: 'SAFE_TO_SEND',
    diagnostic: '',
    sheet: 'Energy',
    approved: true,
    status: 'QUEUED',
    ...over,
  }
}

describe('outreach-jobspec: headless JobSpec builder (§2.2)', () => {
  it('builds first letter messages matching buildMessage output exactly', () => {
    const campaign = mockCampaign()
    const contacts = [
      mockContact(1, { personName: 'Tariq Rahman', organization: 'Padma Grid' }),
      mockContact(2, { personName: 'Farhana Ahmed', organization: 'Meghna Power' }),
    ]

    const spec = buildJobSpec({
      campaign,
      contacts,
      mode: 'first',
      attachments: [{ name: 'brief.pdf', dataUrl: 'data:application/pdf;base64,abc' }],
    })

    expect(spec.campaignId).toBe('cmp-alpha')
    expect(spec.campaignName).toBe('Sector Intelligence Briefing')
    expect(spec.kind).toBe('first')
    expect(spec.attachments).toHaveLength(1)
    expect(spec.attachments![0].name).toBe('brief.pdf')
    expect(spec.messages).toHaveLength(2)

    for (let i = 0; i < contacts.length; i++) {
      const c = contacts[i]
      const msg = spec.messages[i]
      const expected = buildMessage(c, campaign.subject, campaign.body, campaign.lang)
      expect(msg.to).toBe(c.email)
      expect(msg.subject).toBe(expected.subject)
      expect(msg.body).toBe(expected.body)
      expect(msg.name).toBe(c.personName)
      expect(msg.org).toBe(c.organization)
      expect(msg.key).toBe(c.id)
    }
  })

  it('builds follow-up letter messages using the follow-up letter, omitting attachments', () => {
    const campaign = mockCampaign({
      sent: { 'contact1@company1.example.com': 1000 },
    })
    const contacts = [
      mockContact(1, {
        personName: 'Tariq Rahman',
        organization: 'Padma Grid',
        email: 'contact1@company1.example.com',
      }),
    ]

    // Set sent time 10 days ago so follow-up is due
    const tenDaysAgo = Date.now() - 10 * 24 * 3600 * 1000
    campaign.sent['contact1@company1.example.com'] = tenDaysAgo

    const spec = buildJobSpec({
      campaign,
      contacts,
      mode: 'followup',
      attachments: [{ name: 'brief.pdf', dataUrl: 'data:application/pdf;base64,abc' }],
    })

    expect(spec.kind).toBe('followup')
    expect(spec.attachments).toHaveLength(0) // attachments omitted on follow-up
    expect(spec.messages).toHaveLength(1)

    const fu = followUpLetter(campaign)
    const expected = buildMessage(contacts[0], fu.subject, fu.body, campaign.lang)
    expect(spec.messages[0].subject).toBe(expected.subject)
    expect(spec.messages[0].body).toBe(expected.body)
  })

  it('populates shared properties correctly for branding and letterhead', () => {
    const campaign = mockCampaign({ letterhead: true, officialPad: true, lang: 'bn' })
    const contacts = [mockContact(1)]

    const spec = buildJobSpec({
      campaign,
      contacts,
      mode: 'first',
      signature: 'Custom Editorial Desk Signature',
    })

    expect(spec.shared?.lang).toBe('bn')
    expect(spec.shared?.letterhead).toBe(true)
    expect(spec.shared?.officialPad).toBe(true)
    expect(spec.shared?.signature).toBe('Custom Editorial Desk Signature')
  })

  it('builds 5,000 contacts in less than 1 second (pure performance requirement)', () => {
    const campaign = mockCampaign()
    const contacts: Contact[] = []
    for (let i = 1; i <= 5000; i++) {
      contacts.push(mockContact(i))
    }

    const t0 = performance.now()
    const spec = buildJobSpec({
      campaign,
      contacts,
      mode: 'first',
    })
    const elapsed = performance.now() - t0

    expect(spec.messages).toHaveLength(5000)
    expect(elapsed).toBeLessThan(1000)
  })
})
