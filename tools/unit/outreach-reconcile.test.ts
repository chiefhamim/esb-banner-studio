import { describe, it, expect } from 'vitest'
import { project, type ReconcileState } from '../../src/outreach/reconcile'
import { applyInboxResultToCampaigns } from '../../src/outreach/outreachStore'
import type { Campaign } from '../../src/outreach/types'
import type { OutreachEvent } from '../../src/esb'

function mockCampaign(over: Partial<Campaign> = {}): Campaign {
  return {
    id: 'cmp-1',
    name: 'Q4 Energy Brief',
    createdAt: 1000,
    updatedAt: 1000,
    status: 'draft',
    kind: 'list',
    listId: 'list-1',
    sheet: 'Sheet1',
    audience: { group: null, purposes: [] },
    recipients: [],
    blueprint: 'magazine',
    lang: 'en',
    subject: 'Subject',
    body: 'Body',
    signatureId: 'sig-default',
    letterhead: true,
    sources: [],
    scheduledAt: null,
    sent: {},
    failed: {},
    replied: {},
    bounced: {},
    followUp: { afterDays: 5, subject: 'Follow up', body: 'Checking in' },
    followed: {},
    interrupted: null,
    ...over,
  }
}

describe('outreach-reconcile: pure event projection (§2.1)', () => {
  it('projects send.ok for first runs onto campaign.sent and clears failed', () => {
    const c1 = mockCampaign({ id: 'c1', failed: { 'a@example.com': 'Old transient failure' } })
    const state: ReconcileState = {
      campaigns: [c1],
      optOut: [],
      bouncedAddrs: {},
    }

    const events: OutreachEvent[] = [
      {
        id: 'ev-1',
        t: 5000,
        type: 'send.ok',
        campaignId: 'c1',
        email: 'a@example.com',
        run: 'first',
      },
    ]

    const next = project(state, events)
    expect(next.campaigns[0].sent['a@example.com']).toBe(5000)
    expect(next.campaigns[0].failed['a@example.com']).toBeUndefined()
  })

  it('projects send.ok for follow-up runs onto campaign.followed without touching sent', () => {
    const c1 = mockCampaign({ id: 'c1', sent: { 'b@example.com': 2000 } })
    const state: ReconcileState = {
      campaigns: [c1],
      optOut: [],
      bouncedAddrs: {},
    }

    const events: OutreachEvent[] = [
      {
        id: 'ev-2',
        t: 7000,
        type: 'send.ok',
        campaignId: 'c1',
        email: 'b@example.com',
        run: 'followup',
      },
    ]

    const next = project(state, events)
    expect(next.campaigns[0].sent['b@example.com']).toBe(2000)
    expect(next.campaigns[0].followed['b@example.com']).toBe(7000)
  })

  it('projects send.fail onto campaign.failed and records refused for permanent errors', () => {
    const c1 = mockCampaign({ id: 'c1' })
    const state: ReconcileState = {
      campaigns: [c1],
      optOut: [],
      bouncedAddrs: {},
    }

    const events: OutreachEvent[] = [
      {
        id: 'ev-3',
        t: 6000,
        type: 'send.fail',
        campaignId: 'c1',
        email: 'bad@example.com',
        run: 'first',
        kind: 'recipient_permanent',
        error: '550 5.1.1 User unknown',
      },
    ]

    const next = project(state, events)
    expect(next.campaigns[0].failed['bad@example.com']).toBe('550 5.1.1 User unknown')
    expect(next.bouncedAddrs['bad@example.com']).toBe('Refused: 550 5.1.1 User unknown')
  })

  it('projects reply events, matches campaigns within 60s window, and optout on unsubscribe', () => {
    const c1 = mockCampaign({ id: 'c1', sent: { 'rep@example.com': 10000 } })
    const state: ReconcileState = {
      campaigns: [c1],
      optOut: [],
      bouncedAddrs: {},
    }

    const events: OutreachEvent[] = [
      {
        id: 'ev-4',
        t: 12000,
        type: 'reply',
        email: 'rep@example.com',
        at: 12000,
        auto: false,
        unsubscribe: true,
      },
    ]

    const next = project(state, events)
    expect(next.campaigns[0].replied['rep@example.com']).toBe(12000)
    expect(next.optOut).toContain('rep@example.com')
    expect(next.news).toHaveLength(1)
    expect(next.news[0].text).toContain('rep@example.com replied and asked not to be emailed')
  })

  it('is completely idempotent when applied multiple times', () => {
    const c1 = mockCampaign({ id: 'c1' })
    const state: ReconcileState = {
      campaigns: [c1],
      optOut: [],
      bouncedAddrs: {},
    }

    const events: OutreachEvent[] = [
      { id: 'e1', t: 1000, type: 'send.ok', campaignId: 'c1', email: 'x@example.com', run: 'first' },
      { id: 'e2', t: 2000, type: 'optout', email: 'opt@example.com', on: true },
      { id: 'e3', t: 3000, type: 'bounce', email: 'x@example.com', reason: 'Mailbox full' },
    ]

    const pass1 = project(state, events)
    const pass2 = project(pass1, events)

    expect(pass2.campaigns[0].sent).toEqual(pass1.campaigns[0].sent)
    expect(pass2.optOut).toEqual(pass1.optOut)
    expect(pass2.bouncedAddrs).toEqual(pass1.bouncedAddrs)
    expect(pass2.news).toHaveLength(0) // No new duplicate notifications
  })

  it('ignores events for campaigns that no longer exist without failing', () => {
    const c1 = mockCampaign({ id: 'c1' })
    const state: ReconcileState = {
      campaigns: [c1],
      optOut: [],
      bouncedAddrs: {},
    }

    const events: OutreachEvent[] = [
      { id: 'e1', t: 1000, type: 'send.ok', campaignId: 'deleted-campaign', email: 'orphan@example.com', run: 'first' },
      { id: 'e2', t: 2000, type: 'send.fail', campaignId: 'deleted-campaign', email: 'perm@example.com', kind: 'policy', error: 'Blocked' },
    ]

    const next = project(state, events)
    expect(next.campaigns).toHaveLength(1)
    expect(next.campaigns[0].id).toBe('c1')
    expect(next.campaigns[0].sent['orphan@example.com']).toBeUndefined()
    // Global suppression still applies
    expect(next.bouncedAddrs['perm@example.com']).toBe('Refused: Blocked')
  })

  it('extracted applyInboxResultToCampaigns reproduces identical behavior', () => {
    const c1 = mockCampaign({ id: 'c1', name: 'Campaign 1', sent: { 'user@example.com': 50000 } })
    const currentOptOut: string[] = []
    const currentBounced: Record<string, string> = {}

    const inboxData = {
      replies: [
        { email: 'user@example.com', at: 60000, auto: false, unsubscribe: true },
        { email: 'auto@example.com', at: 60000, auto: true, unsubscribe: false },
      ],
      bounces: [
        { email: 'user@example.com', at: 55000, reason: '550 Mailbox unavailable' },
      ],
    }

    const res = applyInboxResultToCampaigns([c1], currentOptOut, currentBounced, inboxData)
    expect(res.campaigns[0].replied['user@example.com']).toBe(60000)
    expect(res.campaigns[0].bounced['user@example.com']).toBe('550 Mailbox unavailable')
    expect(res.optOut).toContain('user@example.com')
    expect(res.bouncedAddrs['user@example.com']).toBe('550 Mailbox unavailable')
    expect(res.news).toHaveLength(2)
  })
})
