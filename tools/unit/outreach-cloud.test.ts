// Cross-PC sync, the pure half (src/outreach/cloudMerge.ts), and the per-contact statuses (outcome.ts, cloudStore.ts).
// Synthetic example.com data only.
import { describe, it, expect } from 'vitest'
import { applySendRows, foldEvents, keyIndex, mergeCampaign, pcName, rowSig, sendId, sendRowsFor, type EventRow, type SendRow } from '../../src/outreach/cloudMerge'
import { outcomeOf, notAnEmail, engineSkipText, type Engagement } from '../../src/outreach/outcome'
import { cloudText, lockBlock, type LockInfo } from '../../src/outreach/cloudStore'
import { newCampaign } from '../../src/outreach/outreachStore'
import type { Contact } from '../../src/outreach/types'

const contact = (over: Partial<Contact> = {}): Contact => ({ id: 'x', serial: 1, sectorGroup: '', groupNo: null, organization: 'Grid Co', personName: 'A. Rahman', designation: 'MD', email: 'md@example.com', phone: '', purposes: [], mxStatus: 'SAFE_TO_SEND', rawStatus: 'SAFE_TO_SEND', diagnostic: '', sheet: '', approved: false, status: 'QUEUED', ...over })
const ME = 'DESK-1#aaaaaaaa'
const OTHER = 'DESK-2#bbbbbbbb'

describe('mergeCampaign: last writer wins for the letter; per-address facts are kept from both', () => {
  const base = newCampaign({ id: 'cmp-1', name: 'Magazine', subject: 'Old', updatedAt: 1000 })
  it('the newer letter wins and both PCs’ sends are kept', () => {
    const local = { ...base, sent: { 'a@example.com': 10 }, updatedAt: 1000 }
    const remote = { ...base, subject: 'New', sent: { 'b@example.com': 20 }, failed: { 'a@example.com': '550' }, updatedAt: 2000 }
    const m = mergeCampaign(local, remote)
    expect(m.subject).toBe('New')
    expect(m.sent).toEqual({ 'a@example.com': 10, 'b@example.com': 20 })
    // a sent address is not failed, whichever PC heard what
    expect(m.failed).toEqual({})
    expect(m.updatedAt).toBe(2000)
  })
  it('an older remote copy changes nothing but adds the sends it knows', () => {
    const local = { ...base, subject: 'Mine', updatedAt: 3000 }
    expect(mergeCampaign(local, { ...base, subject: 'Theirs', updatedAt: 2000 })).toBe(local)
    const m = mergeCampaign(local, { ...base, subject: 'Theirs', sent: { 'c@example.com': 5 }, updatedAt: 2000 })
    expect(m.subject).toBe('Mine')
    expect(m.sent['c@example.com']).toBe(5)
  })
  it('a campaign another PC is sending arrives paused, never as "interrupted" here', () => {
    const m = mergeCampaign(undefined, { ...base, status: 'sending', interrupted: 'first', updatedAt: 5000 })
    expect(m.status).toBe('paused')
    expect(m.interrupted).toBeNull()
  })
  it('this PC’s own run state is never taken from another copy', () => {
    const local = { ...base, status: 'sending' as const, interrupted: 'first' as const, updatedAt: 1000 }
    const m = mergeCampaign(local, { ...base, status: 'paused', subject: 'Edited', updatedAt: 9000 }, { runningHere: true })
    expect(m.status).toBe('sending')
    expect(m.interrupted).toBe('first')
    expect(m.subject).toBe('Edited')
  })
})

describe('outreach_sends rows: one per address and kind, stable ids, never invented', () => {
  const c = newCampaign({
    id: 'cmp-2', sent: { 'a@example.com': Date.UTC(2026, 10, 1), 'b@example.com': Date.UTC(2026, 10, 1), 'c@example.com': 1 },
    bounced: { 'b@example.com': '550 5.1.1 No such user' }, replied: {}, failed: { 'd@example.com': '552 Mailbox full' },
    followed: { 'a@example.com': Date.UTC(2026, 10, 6) }, tracking: { 'campaign:a@example.com': 'A'.repeat(22) }, skipped: { 'e@example.com': 'cooldown' }, sentBy: { 'c@example.com': 'DESK-2' },
  })
  const rows = sendRowsFor(c, new Set(['c@example.com']), ME)
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]))
  it('ids follow the contract and statuses say what is known', () => {
    expect(sendId('CMP-2', 'campaign', 'A@Example.com')).toBe('cmp-2:campaign:a@example.com')
    expect(byId['cmp-2:campaign:a@example.com']).toMatchObject({ status: 'sent', message_key: 'A'.repeat(22), pc: ME, foreign: false })
    expect(byId['cmp-2:campaign:b@example.com']).toMatchObject({ status: 'bounced', detail: '550 5.1.1 No such user' })
    expect(byId['cmp-2:campaign:c@example.com']).toMatchObject({ status: 'opted_out', foreign: true })
    expect(byId['cmp-2:campaign:d@example.com']).toMatchObject({ status: 'failed', detail: '552 Mailbox full' })
    expect(byId['cmp-2:campaign:e@example.com']).toMatchObject({ status: 'skipped', detail: 'cooldown' })
    expect(byId['cmp-2:followup:a@example.com']).toMatchObject({ kind: 'followup', status: 'sent' })
    expect(rows.length).toBe(6)
  })
  it('a row is pushed again only when what it says changes', () => {
    expect(rowSig(byId['cmp-2:campaign:a@example.com'])).toBe(rowSig({ status: 'sent', detail: null, message_key: 'A'.repeat(22) }))
    expect(rowSig({ status: 'bounced', detail: 'x', message_key: null })).not.toBe(rowSig({ status: 'sent', detail: null, message_key: null }))
  })
})

describe('applySendRows: another PC’s sends become this PC’s facts — and its main-process ledger entries', () => {
  const row = (over: Partial<SendRow>): SendRow => ({ id: '', campaign_id: 'cmp-3', email: 'a@example.com', kind: 'campaign', status: 'sent', detail: null, message_key: null, at: '2026-11-01T05:00:00.000Z', pc: OTHER, ...over })
  const local = newCampaign({ id: 'cmp-3', sent: { 'mine@example.com': 1 } })
  it('marks sent, remembers which PC, keeps the key, and asks for the ledger entry', () => {
    const r = applySendRows([local], [row({ message_key: 'B'.repeat(22) }), row({ email: 'mine@example.com', pc: ME })], ME)
    const c = r.campaigns[0]
    expect(c.sent['a@example.com']).toBe(Date.parse('2026-11-01T05:00:00.000Z'))
    expect(c.sentBy?.['a@example.com']).toBe('DESK-2')
    expect(c.tracking?.['campaign:a@example.com']).toBe('B'.repeat(22))
    // only the other PC's send goes to this PC's ledger; our own is already there
    expect(r.ledger).toEqual([{ email: 'a@example.com', kind: 'campaign', campaignId: 'cmp-3', at: Date.parse('2026-11-01T05:00:00.000Z') }])
  })
  it('bounces and opt-outs hold across campaigns; a failure never overrides a send', () => {
    const r = applySendRows([{ ...local, sent: { 'a@example.com': 5 } }], [row({ status: 'bounced', detail: '550 gone' }), row({ email: 'b@example.com', status: 'opted_out' }), row({ email: 'a@example.com', status: 'failed', detail: '421' })], ME)
    expect(r.campaigns[0].bounced['a@example.com']).toBe('550 gone')
    expect(r.campaigns[0].failed['a@example.com']).toBeUndefined()
    expect(r.bounced).toEqual({ 'a@example.com': '550 gone' })
    expect(r.optOut).toEqual(['b@example.com'])
  })
  it('rows for an unknown campaign, tests, and nothing new leave the campaigns untouched', () => {
    const r = applySendRows([local], [row({ campaign_id: 'cmp-nope' }), row({ kind: 'test', id: 'test:1:a@example.com' })], ME)
    expect(r.changed).toBe(false)
    expect(r.campaigns[0]).toBe(local)
    const again = applySendRows([local], [row({ email: 'mine@example.com', pc: ME })], ME)
    expect(again.changed).toBe(false)
  })
  it('the pc column shows the PC by name', () => {
    expect(pcName('DESK-2#bbbbbbbb')).toBe('DESK-2')
    expect(pcName(null)).toBe('another PC')
  })
})

describe('foldEvents: opens and clicks per recipient, only for letters this campaign sent', () => {
  const c = newCampaign({ id: 'cmp-4', tracking: { 'campaign:a@example.com': 'K'.repeat(22), 'followup:a@example.com': 'F'.repeat(22), 'campaign:b@example.com': 'B'.repeat(22) } })
  const ev = (id: number, key: string, type: 'open' | 'click', at: string, link: string | null = null): EventRow => ({ id, message_key: key, type, link, at })
  it('counts, first/last time and which links', () => {
    const f = foldEvents({}, [
      ev(1, 'K'.repeat(22), 'open', '2026-11-01T06:00:00Z'), ev(2, 'K'.repeat(22), 'open', '2026-11-02T06:00:00Z'), ev(3, 'F'.repeat(22), 'open', '2026-11-03T06:00:00Z'),
      ev(4, 'K'.repeat(22), 'click', '2026-11-02T06:01:00Z', 'esbpowerline.com/magazine'), ev(5, 'K'.repeat(22), 'click', '2026-11-02T06:02:00Z', 'esbpowerline.com/magazine'),
      ev(6, 'B'.repeat(22), 'click', '2026-11-02T07:00:00Z', 'www.facebook.com/esbpowerlineofficial'),
      ev(7, 'Z'.repeat(22), 'open', '2026-11-02T07:00:00Z'),
    ], keyIndex(c))
    expect(f['a@example.com']).toMatchObject({ opens: 3, firstOpen: Date.parse('2026-11-01T06:00:00Z'), lastOpen: Date.parse('2026-11-03T06:00:00Z'), clicks: 2, links: [{ link: 'esbpowerline.com/magazine', n: 2 }] })
    // a click without an open is not turned into an open
    expect(f['b@example.com']).toMatchObject({ opens: 0, clicks: 1 })
    expect(Object.keys(f)).toEqual(['a@example.com', 'b@example.com'])
  })
  it('folds on top of what was folded before', () => {
    const prev: Record<string, Engagement> = { 'a@example.com': { opens: 1, firstOpen: 100, lastOpen: 100, clicks: 0, links: [] } }
    expect(foldEvents(prev, [ev(9, 'K'.repeat(22), 'open', '2026-11-05T00:00:00Z')], keyIndex(c))['a@example.com'].opens).toBe(2)
  })
})

describe('outcomeOf: one accurate status per contact, never more than the data shows', () => {
  const eng = (over: Partial<Engagement>): Engagement => ({ opens: 0, clicks: 0, links: [], ...over })
  it('sent is "accepted by the server", not "delivered" or "read"', () => {
    const o = outcomeOf(contact({ status: 'SENT', sentAt: 1 }), null)
    expect(o).toMatchObject({ st: 'sent', label: 'Sent' })
    expect(o.detail).toMatch(/not proof it was read/)
  })
  it('opened is approximate and says why; clicked names the links', () => {
    expect(outcomeOf(contact({ status: 'SENT' }), null, eng({ opens: 2, firstOpen: 1, lastOpen: 2 }))).toMatchObject({ st: 'opened', label: 'Opened (approx.)' })
    expect(outcomeOf(contact({ status: 'SENT' }), null, eng({ opens: 2 })).detail).toMatch(/some mail apps load it on their own/)
    expect(outcomeOf(contact({ status: 'SENT' }), null, eng({ clicks: 1, links: [{ link: 'wa.me/1', n: 1 }] }))).toMatchObject({ st: 'clicked', detail: 'Clicked wa.me/1' })
  })
  it('replied, bounced (with the reason), failed (with the server text), opted out', () => {
    expect(outcomeOf(contact({ status: 'REPLIED', repliedAt: 5 }), null, eng({ opens: 1 })).st).toBe('replied')
    expect(outcomeOf(contact({ status: 'BOUNCED', error: '550 5.1.1 User unknown' }), null)).toMatchObject({ st: 'bounced', detail: '550 5.1.1 User unknown' })
    expect(outcomeOf(contact({ status: 'FAILED', error: '552 5.2.2 Mailbox full' }), null)).toMatchObject({ st: 'failed', label: 'Failed', detail: '552 5.2.2 Mailbox full' })
    expect(outcomeOf(contact({ status: 'OPTED_OUT' }), null).label).toBe('Opted out')
  })
  it('"Not an email": bad syntax, or DNS says there is no mail server', () => {
    expect(notAnEmail(contact({ email: 'not-an-address' }))).toBe('Not a valid email address')
    expect(outcomeOf(contact({ email: 'a@nomail.example.com', mxStatus: 'UNDELIVERABLE', rawStatus: 'No mail server (checked)' }), 'No mail server…')).toMatchObject({ st: 'noemail', label: 'Not an email' })
    expect(outcomeOf(contact({ email: 'a@nomail.example.com', mxStatus: 'UNDELIVERABLE', rawStatus: '' }), null).detail).toBe('No mail server for nomail.example.com (DNS)')
  })
  it('skipped says why, including the engine’s own reasons', () => {
    expect(outcomeOf(contact(), 'Missing designation')).toMatchObject({ st: 'skip', label: 'Skipped', detail: 'Missing designation' })
    expect(outcomeOf(contact(), null, null, engineSkipText('elsewhere')).detail).toBe('Skipped: already sent from another PC')
    expect(outcomeOf(contact(), null).st).toBe('ready')
  })
})

describe('lock and status bar wording', () => {
  const lock = (over: Partial<LockInfo>): LockInfo => ({ campaignId: 'c', pc: 'p', label: 'DESK-2', heartbeatAt: Date.UTC(2026, 10, 1, 6, 30), mine: false, stale: false, ...over })
  it('a fresh lock held by another PC blocks with its name and last-seen time; stale or mine does not', () => {
    expect(lockBlock(lock({}))).toMatch(/^Sending from DESK-2 — last seen /)
    expect(lockBlock(lock({ stale: true }))).toBeNull()
    expect(lockBlock(lock({ mine: true }))).toBeNull()
    expect(lockBlock(null)).toBeNull()
  })
  it('the Cloud pill says what is true', () => {
    const now = Date.UTC(2026, 10, 1, 7)
    expect(cloudText({ state: 'ok', lastSync: now - 12_000, pending: 0 }, now)).toBe('Synced 12 s ago')
    expect(cloudText({ state: 'offline', lastSync: null, pending: 3 }, now)).toBe('Offline — will sync')
    expect(cloudText({ state: 'signed-out', lastSync: null, pending: 0 }, now)).toBe('Not signed in — sync off')
    expect(cloudText({ state: 'not-setup', lastSync: null, pending: 0 }, now)).toBe('Cloud not set up yet')
  })
})
