import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { classifySendError } = require('../../electron/outreach-errors.cjs')

describe('outreach-errors: classifySendError taxonomy (§4.5)', () => {
  const SAMPLES = [
    // 1. Auth errors
    {
      name: 'EAUTH code',
      err: { code: 'EAUTH', message: 'Auth error' },
      expected: { kind: 'auth', retryable: false, scope: 'account' },
    },
    {
      name: '535 5.7.8 Username and Password not accepted',
      err: { responseCode: 535, response: '535 5.7.8 Username and Password not accepted' },
      expected: { kind: 'auth', retryable: false, scope: 'account', enhanced: '5.7.8' },
    },
    {
      name: '534 responseCode (two-factor / app password required)',
      err: { responseCode: 534, message: '534 5.7.9 Please log in with an app password' },
      expected: { kind: 'auth', retryable: false, scope: 'account' },
    },
    {
      name: '530 Authentication required',
      err: { responseCode: 530, message: '530 5.7.0 Must issue a STARTTLS / AUTH command first' },
      expected: { kind: 'auth', retryable: false, scope: 'account' },
    },
    {
      name: 'Plain text invalid credentials',
      err: new Error('Invalid credentials provided for SMTP authentication'),
      expected: { kind: 'auth', retryable: false, scope: 'account' },
    },

    // 2. Content / message too large
    {
      name: '5.3.4 message size exceeds fixed limit',
      err: { responseCode: 552, response: '552 5.3.4 Message exceeds fixed maximum message size' },
      expected: { kind: 'content_all', retryable: false, scope: 'job', enhanced: '5.3.4' },
    },
    {
      name: '552 Message size exceeds server limit',
      err: { responseCode: 552, message: 'Message size exceeds maximum allowed limit' },
      expected: { kind: 'content_all', retryable: false, scope: 'job' },
    },
    {
      name: 'Plain text message too large',
      err: new Error('Message too large for remote mail system'),
      expected: { kind: 'content_all', retryable: false, scope: 'job' },
    },

    // 3. Quota / daily sending limit
    {
      name: '5.4.5 Daily user sending quota exceeded',
      err: { responseCode: 550, response: '550 5.4.5 Daily user sending quota exceeded' },
      expected: { kind: 'quota', retryable: true, scope: 'account', enhanced: '5.4.5' },
    },
    {
      name: '4.5.3 Too many recipients rate limit',
      err: { responseCode: 452, response: '452 4.5.3 Rate limit exceeded for sender' },
      expected: { kind: 'quota', retryable: true, scope: 'account', enhanced: '4.5.3' },
    },
    {
      name: '452 with limit text',
      err: { responseCode: 452, message: '452 Hourly sending limit reached' },
      expected: { kind: 'quota', retryable: true, scope: 'account' },
    },
    {
      name: 'Plain text daily user sending quota',
      err: new Error('Gmail SMTP error: daily user sending quota reached'),
      expected: { kind: 'quota', retryable: true, scope: 'account' },
    },

    // 4. Recipient permanent failures
    {
      name: '5.1.1 user unknown',
      err: { responseCode: 550, response: '550 5.1.1 <nobody@example.com>: User unknown' },
      expected: { kind: 'recipient_permanent', retryable: false, scope: 'recipient', enhanced: '5.1.1' },
    },
    {
      name: '5.1.2 host not found',
      err: { responseCode: 550, response: '550 5.1.2 Host or domain not found' },
      expected: { kind: 'recipient_permanent', retryable: false, scope: 'recipient', enhanced: '5.1.2' },
    },
    {
      name: '5.1.3 invalid address syntax',
      err: { responseCode: 501, response: '501 5.1.3 Bad recipient address syntax' },
      expected: { kind: 'recipient_permanent', retryable: false, scope: 'recipient', enhanced: '5.1.3' },
    },
    {
      name: '5.1.6 mailbox moved',
      err: { responseCode: 551, response: '551 5.1.6 User has moved to another host' },
      expected: { kind: 'recipient_permanent', retryable: false, scope: 'recipient', enhanced: '5.1.6' },
    },
    {
      name: '5.1.10 recipient address rejected',
      err: { responseCode: 550, response: '550 5.1.10 Recipient address rejected' },
      expected: { kind: 'recipient_permanent', retryable: false, scope: 'recipient', enhanced: '5.1.10' },
    },
    {
      name: '5.2.1 mailbox disabled',
      err: { responseCode: 550, response: '550 5.2.1 Mailbox disabled' },
      expected: { kind: 'recipient_permanent', retryable: false, scope: 'recipient', enhanced: '5.2.1' },
    },
    {
      name: '553 with 5.1.x',
      err: { responseCode: 553, response: '553 5.1.7 Invalid recipient address' },
      expected: { kind: 'recipient_permanent', retryable: false, scope: 'recipient', enhanced: '5.1.7' },
    },
    {
      name: '550 user does not exist',
      err: { responseCode: 550, message: '550 The email account that you tried to reach does not exist' },
      expected: { kind: 'recipient_permanent', retryable: false, scope: 'recipient' },
    },
    {
      name: 'Plain text mailbox not found',
      err: new Error('Mailbox not found for recipient user'),
      expected: { kind: 'recipient_permanent', retryable: false, scope: 'recipient' },
    },

    // 5. Policy / spam block
    {
      name: '5.7.1 blocked as spam',
      err: { responseCode: 550, response: '550 5.7.1 Blocked as spam by Spamhaus' },
      expected: { kind: 'policy', retryable: false, scope: 'recipient', enhanced: '5.7.1' },
    },
    {
      name: '5.7.26 DMARC policy violation',
      err: { responseCode: 550, response: '550 5.7.26 This message fails DMARC policy' },
      expected: { kind: 'policy', retryable: false, scope: 'recipient', enhanced: '5.7.26' },
    },
    {
      name: '554 reputation / blacklist',
      err: { responseCode: 554, message: '554 Your IP has poor reputation on blacklist' },
      expected: { kind: 'policy', retryable: false, scope: 'recipient' },
    },
    {
      name: 'Plain text unsolicited mail block',
      err: new Error('Administrative prohibition: Our system has detected an unusual rate of unsolicited mail'),
      expected: { kind: 'policy', retryable: false, scope: 'recipient' },
    },

    // 6. Network / connection errors
    {
      name: 'ECONNECTION code',
      err: { code: 'ECONNECTION', message: 'Connection dropped' },
      expected: { kind: 'network', retryable: true, scope: 'job' },
    },
    {
      name: 'ETIMEDOUT code',
      err: { code: 'ETIMEDOUT', message: 'Connection timed out' },
      expected: { kind: 'network', retryable: true, scope: 'job' },
    },
    {
      name: 'ESOCKET code',
      err: { code: 'ESOCKET', message: 'Socket closed prematurely' },
      expected: { kind: 'network', retryable: true, scope: 'job' },
    },
    {
      name: 'EDNS code',
      err: { code: 'EDNS', message: 'Failed to resolve MX host' },
      expected: { kind: 'network', retryable: true, scope: 'job' },
    },
    {
      name: 'ECONNRESET code',
      err: { code: 'ECONNRESET', message: 'Connection reset by peer' },
      expected: { kind: 'network', retryable: true, scope: 'job' },
    },
    {
      name: 'DNS lookup fails option',
      err: { message: 'Network unreachable' },
      options: { dnsLookupFails: true },
      expected: { kind: 'network', retryable: true, scope: 'job' },
    },

    // 7. Recipient transient errors (KEY REGRESSION GUARD: mailbox full is NEVER auth or quota!)
    {
      name: '552 5.2.2 mailbox over its storage limit (regression test)',
      err: { responseCode: 552, response: '552 5.2.2 Mailbox over its storage limit' },
      expected: { kind: 'recipient_transient', retryable: true, scope: 'recipient', enhanced: '5.2.2' },
    },
    {
      name: 'User is over quota (mailbox full)',
      err: { responseCode: 552, message: 'User is over quota (mailbox full)' },
      expected: { kind: 'recipient_transient', retryable: true, scope: 'recipient' },
    },
    {
      name: '451 4.3.0 server busy',
      err: { responseCode: 451, response: '451 4.3.0 Mail server busy, try again later' },
      expected: { kind: 'recipient_transient', retryable: true, scope: 'recipient', enhanced: '4.3.0' },
    },
    {
      name: '450 4.2.0 greylisted',
      err: { responseCode: 450, response: '450 4.2.0 Greylisted, retry in 5 minutes' },
      expected: { kind: 'recipient_transient', retryable: true, scope: 'recipient', enhanced: '4.2.0' },
    },
    {
      name: '421 service temporarily unavailable',
      err: { responseCode: 421, message: '421 Service temporarily unavailable' },
      expected: { kind: 'recipient_transient', retryable: true, scope: 'recipient' },
    },

    // 8. Unknown fallback
    {
      name: 'Unrecognized custom error text',
      err: new Error('Unusual remote behavior from custom gateway'),
      expected: { kind: 'unknown', retryable: true, scope: 'recipient' },
    },
  ]

  it.each(SAMPLES)('classifies $name', ({ err, options, expected }) => {
    const res = classifySendError(err, options)
    expect(res.kind).toBe(expected.kind)
    expect(res.retryable).toBe(expected.retryable)
    expect(res.scope).toBe(expected.scope)
    if (expected.enhanced) {
      expect(res.enhanced).toBe(expected.enhanced)
    }
  })

  it('proves "mailbox over its storage limit" is NOT auth and NOT quota', () => {
    const r1 = classifySendError({ message: '552 5.2.2 Mailbox over its storage limit' })
    expect(r1.kind).not.toBe('auth')
    expect(r1.kind).not.toBe('quota')
    expect(r1.kind).toBe('recipient_transient')

    const r2 = classifySendError({ message: 'User is over quota (mailbox full)' })
    expect(r2.kind).not.toBe('auth')
    expect(r2.kind).not.toBe('quota')
    expect(r2.kind).toBe('recipient_transient')
  })
})

// the status bar's mail check: a network blip or a TLS failure must never read as a wrong password
describe('outreach-errors: classifyVerifyError (Mail pill)', () => {
  const { classifyVerifyError, cleanServerText } = require('../../electron/outreach-errors.cjs')
  const mk = (props: Record<string, unknown>) => Object.assign(new Error(String(props.message ?? '')), props)

  it.each([
    ['EAUTH 535 (Gmail refused the app password)', mk({ code: 'EAUTH', responseCode: 535, message: 'Invalid login: 535-5.7.8 Username and Password not accepted' }), 'auth'],
    ['534 application-specific password required', mk({ code: 'EAUTH', responseCode: 534, message: 'Invalid login: 534-5.7.9 Application-specific password required' }), 'auth'],
    ['ETIMEDOUT (smtp.gmail.com:587 not reachable)', mk({ code: 'ETIMEDOUT', command: 'CONN', message: 'Connection timeout' }), 'network'],
    ['ECONNREFUSED', mk({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 142.250.4.108:587' }), 'network'],
    ['ENOTFOUND', mk({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND smtp.gmail.com' }), 'network'],
    ['EAI_AGAIN (DNS not ready yet)', mk({ code: 'EAI_AGAIN', message: 'getaddrinfo EAI_AGAIN smtp.gmail.com' }), 'network'],
    ['ECONNRESET', mk({ code: 'ECONNRESET', message: 'read ECONNRESET' }), 'network'],
    ['ESOCKET', mk({ code: 'ESOCKET', message: 'Socket closed unexpectedly' }), 'network'],
    ['EDNS', mk({ code: 'EDNS', message: 'Failed to resolve smtp.gmail.com' }), 'network'],
    ['ENETUNREACH', mk({ code: 'ENETUNREACH', message: 'connect ENETUNREACH' }), 'network'],
    ['Greeting never received, no code', mk({ message: 'Greeting never received' }), 'network'],
    ['ETLS (STARTTLS upgrade failed)', mk({ code: 'ETLS', message: 'Error initiating TLS - wrong version number' }), 'tls'],
    ['ESOCKET carrying a certificate error', mk({ code: 'ESOCKET', message: 'certificate has expired' }), 'tls'],
    ['CERT_HAS_EXPIRED', mk({ code: 'CERT_HAS_EXPIRED', message: 'certificate has expired' }), 'tls'],
    ['ERR_SSL_WRONG_VERSION_NUMBER (465 vs 587)', mk({ code: 'ERR_SSL_WRONG_VERSION_NUMBER', message: 'ssl3_get_record:wrong version number' }), 'tls'],
    ['530 must issue STARTTLS first', mk({ responseCode: 530, message: '530 5.7.0 Must issue a STARTTLS command first' }), 'tls'],
    ['something else', mk({ message: 'Unexpected reply from server' }), 'other'],
    ['a 421 service unavailable is not a wrong password', mk({ code: 'EPROTOCOL', responseCode: 421, message: '421 4.7.0 Try again later' }), 'other'],
  ])('%s -> %s', (_name, err, kind) => {
    const r = classifyVerifyError(err)
    expect(r.kind).toBe(kind)
    expect(typeof r.error).toBe('string')
    expect(r.error.length).toBeGreaterThan(0)
  })

  it('keeps the server text on one line and never carries something that looks like a credential', () => {
    const r = classifyVerifyError(mk({ code: 'EAUTH', responseCode: 535, message: 'Invalid login:\r\n535 rejected AUTH PLAIN AGJvYkBleGFtcGxlLmNvbQBzM2NyZXQtYXBwLXBhc3N3b3Jk password=hunter2' }))
    expect(r.kind).toBe('auth')
    expect(r.error).not.toMatch(/[\r\n]/)
    expect(r.error).not.toContain('AGJvYkBleGFtcGxl')
    expect(r.error).not.toContain('hunter2')
    expect(r.error).toContain('535 rejected')
    expect(cleanServerText('x'.repeat(500)).length).toBeLessThanOrEqual(200)
  })

  it('a send that hits a network blip is classified network or tls, never auth / recipient', () => {
    for (const code of ['ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ESOCKET', 'EDNS', 'EHOSTUNREACH']) {
      expect(classifySendError({ code, message: `connect ${code} smtp.gmail.com` }).kind).toBe('network')
    }
    // the mailer's own failed-send result (what the engine classifies again)
    expect(classifySendError({ ok: false, error: 'Connection timeout', code: 'ETIMEDOUT' }).kind).toBe('network')
    expect(classifySendError({ ok: false, error: 'certificate has expired', code: 'ESOCKET' }).kind).toBe('tls')
  })
})
