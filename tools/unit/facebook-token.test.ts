// The permanent Facebook token: short-lived user token -> long-lived user token -> the Page's own token -> expiry check.
import { describe, expect, it } from 'vitest'
import { makeTokenPermanent } from '../../src/editorial/facebook'

describe('makeTokenPermanent', () => {
  it('exchanges the user token, reads the Page token with it, and confirms it never expires', async () => {
    const calls: { url: string; auth?: string }[] = []
    ;(globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>
      calls.push({ url: String(url), auth: headers.Authorization })
      if (String(url).includes('/oauth/access_token')) return new Response(JSON.stringify({ access_token: 'LONGUSER' }), { status: 200 })
      if (String(url).includes('/debug_token')) return new Response(JSON.stringify({ data: { expires_at: 0 } }), { status: 200 })
      return new Response(JSON.stringify({ access_token: 'PAGETOKEN', name: 'ESB Power Line' }), { status: 200 })
    }) as typeof fetch
    const r = await makeTokenPermanent({ pageId: '123456', userToken: 'SHORT', appId: '99', appSecret: 'SECRET' })
    expect(r).toEqual({ ok: true, token: 'PAGETOKEN', pageName: 'ESB Power Line', permanent: true })
    // the secret travels in a request body or an Authorization header, never in a URL
    expect(calls.every((c) => !c.url.includes('SECRET'))).toBe(true)
    expect(calls[1].auth).toBe('Bearer LONGUSER')
    expect(calls[2].auth).toBe('Bearer 99|SECRET')
  })
  it('says so in words when Facebook refuses the exchange', async () => {
    ;(globalThis as unknown as { fetch: typeof fetch }).fetch = (async () => new Response(JSON.stringify({ error: { code: 190, message: 'bad token' } }), { status: 400 })) as typeof fetch
    const r = await makeTokenPermanent({ pageId: '123456', userToken: 'x', appId: '1', appSecret: 's' })
    expect(r.ok).toBe(false)
  })
})
