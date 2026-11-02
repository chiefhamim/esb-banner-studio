import { describe, it, expect } from 'vitest'
import { MAIL_RETRY_STEPS, mailFailKind, mailFailView, mailRetryDelay } from '../../src/outreach/mailCheck'

describe('mailCheck: what the Mail pill and Sender card say', () => {
  it('only a refused login says "Wrong app password" and points to Sender', () => {
    const v = mailFailView('auth', '535 5.7.8 Username and Password not accepted')
    expect(v.text).toBe('Wrong app password')
    expect(v.tone).toBe('off')
    expect(v.fixInSender).toBe(true)
    expect(v.tip).toContain('535 5.7.8')
    expect(v.tip).toContain('Sender')
  })

  it('an unreachable server is a warning that retries, never "Login failed"', () => {
    const v = mailFailView('network', 'Connection timeout', { host: 'smtp.gmail.com', retryAtText: '4:58:30 PM' })
    expect(v.text).toBe('Mail server unreachable — retrying')
    expect(v.tone).toBe('warn')
    expect(v.fixInSender).toBe(false)
    expect(v.tip).toContain('Connection timeout')
    expect(v.tip).toContain('smtp.gmail.com')
    expect(v.tip).toContain('4:58:30 PM')
    expect(v.tip).toMatch(/password is not the problem/i)
  })

  it('TLS and anything else have their own words', () => {
    expect(mailFailView('tls', 'certificate has expired').text).toBe('Secure connection failed')
    expect(mailFailView('other', 'Unexpected reply').text).toBe('Mail check failed')
    for (const k of ['auth', 'network', 'tls', 'other'] as const) expect(mailFailView(k, 'x').text).not.toMatch(/login failed/i)
  })

  it('an unknown or missing kind (older main) is "other"', () => {
    expect(mailFailKind(undefined)).toBe('other')
    expect(mailFailKind('EAUTH')).toBe('other')
    expect(mailFailKind('network')).toBe('network')
  })

  it('retries 30 s, then 2 min, then every 5 min', () => {
    expect(MAIL_RETRY_STEPS).toEqual([30_000, 120_000, 300_000])
    expect([0, 1, 2, 3, 9].map(mailRetryDelay)).toEqual([30_000, 120_000, 300_000, 300_000, 300_000])
  })
})
