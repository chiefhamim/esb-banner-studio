import { describe, it, expect, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const m = require('../../electron/mailer.cjs')

const settings = { host: 'smtp.gmail.com', port: 587, user: 'desk@example.com', name: 'ESB PowerLine', dailyLimit: 3, minDelaySec: 60, maxDelaySec: 120 }
const pdf = (name = 'brief.pdf') => ({ name, dataUrl: 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4').toString('base64') })

describe('validateMail: one plain address, plain text, data attachments', () => {
  it('accepts an ordinary message', () => {
    const v = m.validateMail({ to: 'MD@Example.com', subject: 'Hello', text: 'Dear Sir,\n\nBody', attachments: [pdf()] })
    expect(v.to).toBe('md@example.com')
    expect(v.attachments[0]).toMatchObject({ filename: 'brief.pdf', contentType: 'application/pdf' })
  })
  it.each([
    ['two recipients', { to: 'a@example.com, b@example.com' }],
    ['a display name', { to: 'Boss <a@example.com>' }],
    ['header injection in the address', { to: 'a@example.com\r\nBcc: x@example.com' }],
  ])('refuses %s', (_n, over) => {
    expect(() => m.validateMail({ subject: 's', text: 't', ...over })).toThrow(/one plain email/)
  })
  it('flattens a subject to one line, so it cannot add headers', () => {
    expect(m.validateMail({ to: 'a@example.com', subject: 'Hi\r\nBcc: x@example.com', text: 't' }).subject).toBe('Hi Bcc: x@example.com')
  })
  it('never reads a file path, and refuses executables', () => {
    expect(() => m.validateMail({ to: 'a@example.com', subject: 's', text: 't', attachments: [{ name: 'x.pdf', path: 'C:\\Users\\me\\secret.pdf' }] })).toThrow(/never as a path/)
    expect(() => m.validateMail({ to: 'a@example.com', subject: 's', text: 't', attachments: [{ name: 'tool.exe', dataUrl: 'data:application/octet-stream;base64,TVo=' }] })).toThrow(/only PDF/)
  })
  it('caps the attachments under what Gmail accepts', () => {
    const big = { name: 'big.pdf', dataUrl: 'data:application/pdf;base64,' + Buffer.alloc(m.MAX_ATTACH_BYTES + 10).toString('base64') }
    expect(() => m.validateMail({ to: 'a@example.com', subject: 's', text: 't', attachments: [big] })).toThrow(/18 MB/)
  })
})

describe('validateSmtpSettings', () => {
  it('keeps a Gmail account and derives TLS from the port', () => {
    expect(m.validateSmtpSettings({ ...settings, port: 465 }).secure).toBe(true)
    expect(m.validateSmtpSettings(settings).secure).toBe(false)
  })
  it('refuses localhost, odd ports, a daily limit over Gmail\'s and waits under the floor', () => {
    expect(() => m.validateSmtpSettings({ ...settings, host: 'localhost' })).toThrow()
    expect(() => m.validateSmtpSettings({ ...settings, port: 8080 })).toThrow(/port/)
    expect(() => m.validateSmtpSettings({ ...settings, dailyLimit: 5000 })).toThrow(/Daily limit/)
    expect(() => m.validateSmtpSettings({ ...settings, minDelaySec: 5 })).toThrow(/Shortest wait/)
  })
})

describe('ledgerCheck: the cap, the gap and no repeats', () => {
  const now = Date.UTC(2026, 9, 28, 12)
  const mail = (to: string, extra = {}) => ({ to, isTest: false, resend: false, ...extra })
  it('stops at the daily limit and says when the next slot opens', () => {
    const l = [1, 2, 3].map((h) => ({ t: now - h * 3600e3, to: `x${h}@example.com`, kind: 'campaign' }))
    const r = m.ledgerCheck(l, now, settings, mail('new@example.com'))
    expect(r.ok).toBe(false)
    expect(r.nextAt).toBe(now - 3 * 3600e3 + 24 * 3600e3)
  })
  it('keeps the floor between two sends whatever the renderer asks', () => {
    const r = m.ledgerCheck([{ t: now - 5000, to: 'a@example.com', kind: 'campaign' }], now, settings, mail('b@example.com'))
    expect(r).toMatchObject({ ok: false, reason: /Too soon/ })
  })
  it('never emails the same address twice in a week unless asked to resend', () => {
    const l = [{ t: now - 2 * 24 * 3600e3, to: 'a@example.com', kind: 'campaign' }]
    expect(m.ledgerCheck(l, now, settings, mail('a@example.com'))).toMatchObject({ ok: false, duplicate: true })
    expect(m.ledgerCheck(l, now, settings, mail('a@example.com', { resend: true })).ok).toBe(true)
  })
  it('a follow-up needs a first letter at least 2 days old, goes once a month, and is threaded under it', () => {
    const first = { t: now - 3 * 24 * 3600e3, to: 'a@example.com', kind: 'campaign', id: '<first@example.com>' }
    expect(m.ledgerCheck([], now, settings, mail('a@example.com', { followUp: true }))).toMatchObject({ ok: false, reason: /No earlier letter/ })
    expect(m.ledgerCheck([{ ...first, t: now - 24 * 3600e3 }], now, settings, mail('a@example.com', { followUp: true }))).toMatchObject({ ok: false, reason: /less than 2 days/ })
    expect(m.ledgerCheck([first], now, settings, mail('a@example.com', { followUp: true }))).toMatchObject({ ok: true, inReplyTo: '<first@example.com>' })
    const again = [first, { t: now - 3600e3, to: 'a@example.com', kind: 'followup' }]
    expect(m.ledgerCheck(again, now, settings, mail('a@example.com', { followUp: true }))).toMatchObject({ ok: false, duplicate: true })
    // follow-ups count toward the day's cap like first letters
    const full = [1, 2, 3].map((h) => ({ t: now - h * 3600e3, to: `x${h}@example.com`, kind: 'followup' }))
    expect(m.ledgerCheck(full, now, settings, mail('new@example.com')).ok).toBe(false)
  })
  it('test sends do not use the daily quota but are limited per hour', () => {
    const full = [1, 2, 3].map((h) => ({ t: now - h * 600e3, to: 'x@example.com', kind: 'campaign' }))
    expect(m.ledgerCheck(full, now, settings, mail('me@example.com', { isTest: true })).ok).toBe(true)
    const tests = Array.from({ length: 10 }, (_, i) => ({ t: now - i * 60e3, to: 'me@example.com', kind: 'test' }))
    expect(m.ledgerCheck(tests, now, settings, mail('me@example.com', { isTest: true })).ok).toBe(false)
  })
})

describe('createMailer: password encrypted, ledger kept, List-Unsubscribe on every message', () => {
  let dir: string
  const sent: Record<string, unknown>[] = []
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from('enc:' + s),
    decryptString: (b: Buffer) => b.toString().replace(/^enc:/, ''),
  }
  const transports: Record<string, unknown>[] = []
  const nodemailer = { createTransport: (o: Record<string, unknown>) => { transports.push(o); return { sendMail: async (mm: Record<string, unknown>) => { sent.push(mm); return { messageId: '<id@example.com>' } } } } }
  let now = Date.UTC(2026, 9, 28, 12)
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'esb-mailer-')); sent.length = 0; transports.length = 0 })

  it('stores the app password encrypted and never returns it', () => {
    const mailer = m.createMailer({ dir, safeStorage, nodemailer, clock: () => now })
    const st = mailer.saveSettings(settings, 'abcd efgh ijkl mnop')
    expect(st.hasPassword).toBe(true)
    expect(JSON.stringify(st)).not.toContain('abcd')
    expect(readFileSync(join(dir, 'outreach-smtp.json'), 'utf8')).not.toContain('abcdefgh')
  })
  it('sends with the saved account, records the send, and refuses the same address again', async () => {
    const mailer = m.createMailer({ dir, safeStorage, nodemailer, clock: () => now })
    mailer.saveSettings(settings, 'abcdefghijklmnop')
    const r = await mailer.send({ to: 'md@example.com', subject: 'S', body: 'Dear Sir,\n\nBody', letterhead: true, optOut: 'Reply unsubscribe' })
    expect(r.ok).toBe(true)
    expect((transports[0].auth as { pass: string }).pass).toBe('abcdefghijklmnop')
    expect(sent[0]).toMatchObject({ from: { name: 'ESB PowerLine', address: 'desk@example.com' }, list: { unsubscribe: 'mailto:desk@example.com?subject=unsubscribe' } })
    // the letterhead logo rides inline as cid:esb-logo, read by main from its own copy
    expect((sent[0].attachments as { cid?: string }[]).some((a) => a.cid === 'esb-logo')).toBe(true)
    expect(String(sent[0].html)).toContain('src="cid:esb-logo"')
    expect(String(sent[0].html)).toContain('<p ')
    expect(String(sent[0].text)).toContain('Body')
    expect(mailer.status()).toMatchObject({ sent24h: 1, sentTo: [{ to: 'md@example.com' }] })
    now += 120e3
    expect(await mailer.send({ to: 'md@example.com', subject: 'S', text: 'again' })).toMatchObject({ ok: false, duplicate: true })
  })
  it('a follow-up is sent with In-Reply-To the first letter and recorded as a follow-up', async () => {
    const mailer = m.createMailer({ dir, safeStorage, nodemailer, clock: () => now })
    mailer.saveSettings(settings, 'abcdefghijklmnop')
    await mailer.send({ to: 'md@example.com', subject: 'S', body: 'First' })
    now += 3 * 24 * 3600e3
    const r = await mailer.send({ to: 'md@example.com', subject: 'Re: S', body: 'Following up', followUp: true })
    expect(r.ok).toBe(true)
    expect(sent[1]).toMatchObject({ inReplyTo: '<id@example.com>', references: ['<id@example.com>'] })
    expect(mailer.ledger().map((e: { kind: string }) => e.kind)).toEqual(['campaign', 'followup'])
    expect(mailer.inboxAccount()).toMatchObject({ user: 'desk@example.com', pass: 'abcdefghijklmnop', imapHost: 'imap.gmail.com' })
    expect(JSON.stringify(mailer.status())).not.toContain('abcdefgh')
  })
  it('sends nothing before a password is saved', async () => {
    const mailer = m.createMailer({ dir, safeStorage, nodemailer, clock: () => now })
    expect(await mailer.send({ to: 'a@example.com', subject: 's', text: 't' })).toMatchObject({ ok: false })
    expect(sent).toHaveLength(0)
  })
})
