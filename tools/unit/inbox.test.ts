import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'

const require = createRequire(import.meta.url)
const ib = require('../../electron/inbox.cjs')

// synthetic messages only — example.com addresses, no real mail
describe('inbox rules', () => {
  it('finds the IMAP server for the SMTP one', () => {
    expect(ib.imapHostFor('smtp.gmail.com')).toBe('imap.gmail.com')
    expect(ib.imapHostFor('smtp.office365.com')).toBe('outlook.office365.com')
    expect(ib.imapHostFor('smtp.example.com')).toBe('imap.example.com')
    expect(ib.imapHostFor('smtp.example.com', 'mail.example.com')).toBe('mail.example.com')
  })
  it('reads "unsubscribe" in their own words only, never in our quoted letter', () => {
    const quoted = 'Thank you, we would like copies.\n\nOn Tue, 28 Oct 2026, ESB Power Line wrote:\n> If you would rather not receive emails, reply with "unsubscribe".'
    expect(ib.asksToUnsubscribe('Re: Magazine', quoted)).toBe(false)
    expect(ib.asksToUnsubscribe('Re: Magazine', 'Please unsubscribe me.\n\n> Dear Sir')).toBe(true)
    expect(ib.asksToUnsubscribe('unsubscribe', '')).toBe(true)
    expect(ib.asksToUnsubscribe('Re: পত্রিকা', 'আমাকে বাদ দিন')).toBe(true)
  })
  it('an out-of-office is not a reply from the person', () => {
    expect(ib.isAutoReply({ 'auto-submitted': 'auto-replied' }, 'Re: x')).toBe(true)
    expect(ib.isAutoReply({}, 'Out of Office: back on Monday')).toBe(true)
    expect(ib.isAutoReply({}, 'Automatic reply: Re: Magazine')).toBe(true)
    expect(ib.isAutoReply({ 'auto-submitted': 'no' }, 'Re: Magazine')).toBe(false)
  })
  it('a bounce names our recipient and why; a delay notice is not a bounce', () => {
    const known = new Set(['gone@example.com', 'ok@example.com'])
    const dsn = 'Content-Type: message/delivery-status\r\n\r\nFinal-Recipient: rfc822; gone@example.com\r\nAction: failed\r\nStatus: 5.1.1\r\nDiagnostic-Code: smtp; 550 5.1.1 The email account that you tried\r\n to reach does not exist.'
    expect(ib.bounceInfo(dsn, known)).toEqual({ addresses: ['gone@example.com'], reason: '550 5.1.1 The email account that you tried to reach does not exist.', temporary: false })
    expect(ib.bounceInfo('Final-Recipient: rfc822; ok@example.com\nStatus: 4.4.1', known).temporary).toBe(true)
    // a stranger named in a bounce is not reported
    expect(ib.bounceInfo('Final-Recipient: rfc822; stranger@example.org\nStatus: 5.1.1', known).addresses).toEqual([])
  })
  it('picks the text a person wrote, not an attachment', () => {
    const tree = { type: 'multipart/mixed', childNodes: [{ type: 'multipart/alternative', childNodes: [{ part: '1.1', type: 'text/plain' }, { part: '1.2', type: 'text/html' }] }, { part: '2', type: 'text/plain', disposition: 'attachment' }] }
    expect(ib.textPart(tree).part).toBe('1.1')
  })
})

describe('createInbox against a stand-in server', () => {
  const now = Date.UTC(2026, 10, 3, 12)
  const sent = Date.UTC(2026, 9, 28, 12)
  const ledger = () => [
    { t: sent, to: 'reply@example.com', kind: 'campaign', id: '<a@desk>' },
    { t: sent, to: 'quit@example.com', kind: 'campaign', id: '<b@desk>' },
    { t: sent, to: 'gone@example.com', kind: 'campaign', id: '<c@desk>' },
    { t: sent, to: 'away@example.com', kind: 'campaign', id: '<d@desk>' },
  ]
  const msgs = [
    { uid: 1, from: 'reply@example.com', subject: 'Re: Magazine', text: 'Yes please, send two copies.\n\nOn Tue wrote:\n> reply with "unsubscribe"' },
    { uid: 2, from: 'quit@example.com', subject: 'Re: Magazine', text: 'Unsubscribe, thank you.' },
    { uid: 3, from: 'mailer-daemon@googlemail.com', subject: 'Delivery Status Notification (Failure)', source: 'Final-Recipient: rfc822; gone@example.com\nStatus: 5.1.1\nDiagnostic-Code: smtp; 550 No such user' },
    { uid: 4, from: 'away@example.com', subject: 'Automatic reply: Magazine', headers: 'Auto-Submitted: auto-replied\r\n', text: 'I am away' },
    { uid: 5, from: 'someone-else@example.org', subject: 'Private matter', text: 'unsubscribe' },
  ]
  const opened: Record<string, unknown>[] = []
  class FakeImap {
    constructor(o: Record<string, unknown>) { opened.push(o) }
    on() { return this } // ImapFlow is an EventEmitter
    async connect() {}
    async getMailboxLock(_p: string, o: { readOnly: boolean }) { opened.push({ lock: o }); return { release() {} } }
    async search() { return msgs.map((x) => x.uid) }
    async fetchAll() { return msgs.map((x) => ({ uid: x.uid, internalDate: new Date(now), envelope: { from: [{ address: x.from }], subject: x.subject }, headers: Buffer.from(x.headers ?? ''), bodyStructure: { part: '1', type: 'text/plain' } })) }
    async download(uid: string) { const x = msgs.find((y) => String(y.uid) === uid)!; return { content: Readable.from([Buffer.from(x.source ?? x.text ?? '')]) } }
    async logout() {}
    close() {}
  }
  it('reports only our recipients: a reply, an unsubscribe, a bounce and an out-of-office — opened read-only', async () => {
    const inbox = ib.createInbox({ ledger, account: () => ({ user: 'desk@example.com', pass: 'x', imapHost: 'imap.example.com' }), ImapFlow: FakeImap, clock: () => now })
    const r = await inbox.check(true)
    expect(r.ok).toBe(true)
    expect(opened[0]).toMatchObject({ host: 'imap.example.com', port: 993, secure: true })
    expect(opened[1]).toEqual({ lock: { readOnly: true } })
    expect(r.replies.map((x: { email: string; unsubscribe: boolean; auto: boolean }) => [x.email, x.unsubscribe, x.auto])).toEqual([['reply@example.com', false, false], ['quit@example.com', true, false], ['away@example.com', false, true]])
    expect(r.bounces).toEqual([{ email: 'gone@example.com', at: now, reason: '550 No such user' }])
    expect(JSON.stringify(r)).not.toContain('someone-else')
    expect(JSON.stringify(r)).not.toContain('two copies')
  })
})
