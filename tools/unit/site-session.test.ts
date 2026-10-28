import { describe, it, expect, vi, afterEach } from 'vitest'
import { siteSessionCookies, authenticateStaff, insertArticleToSupabase, friendlyAuthError } from '../../src/editorial/siteApi'

// Format verified against @supabase/ssr 0.12.4 (the site's version) by having its createServerClient read these
// cookies back into a session — single and chunked — on 2026-10-23. This test pins the same format offline.
const decode = (cookies: { name: string; value: string }[]) => {
  const v = cookies.map((c) => c.value).join('')
  expect(v.startsWith('base64-')).toBe(true)
  const b64 = v.slice(7).replace(/-/g, '+').replace(/_/g, '/')
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64 + '==='.slice((b64.length + 3) % 4)), (c) => c.charCodeAt(0))))
}
const base = { email: 'e@x.com', name: 'E', role: 'EDITOR', token: 'acc', refreshToken: 'ref', expiresAt: 4102444800, userId: 'u1', user: { id: 'u1' }, authenticatedAt: '', authType: 'supabase' as const }

afterEach(() => { vi.unstubAllGlobals() })

describe('Signing the site in as the editor', () => {
  it('writes the @supabase/ssr session cookie for this project', () => {
    const c = siteSessionCookies(base)
    expect(c).toHaveLength(1)
    expect(c[0].name).toBe('sb-sxgokpmrbgdndstygapc-auth-token')
    const s = decode(c)
    expect([s.access_token, s.refresh_token, s.expires_at, s.user.id, s.token_type]).toEqual(['acc', 'studio-managed', 4102444800, 'u1', 'bearer'])
    // the Studio's own refresh token must never reach the CMS window (the site would rotate it and kill the Studio's session)
    expect(JSON.stringify(s)).not.toContain('"ref"')
  })

  it('splits a large session into .0, .1 chunks of at most 3,180 characters', () => {
    const c = siteSessionCookies({ ...base, user: { id: 'u1', user_metadata: { bio: 'é'.repeat(3000) } } })
    expect(c.length).toBeGreaterThan(1)
    expect(c.map((x) => x.name)).toEqual(c.map((_, i) => `sb-sxgokpmrbgdndstygapc-auth-token.${i}`))
    for (const x of c) expect(encodeURIComponent(x.value).length).toBeLessThanOrEqual(3180)
    expect(decode(c).user.user_metadata.bio).toBe('é'.repeat(3000))
  })

  it('no session, no cookie', () => {
    expect(siteSessionCookies({ ...base, token: undefined })).toEqual([])
  })
})

describe('Staff sign-in mirrors the site', () => {
  const stubStorage = () => { const m = new Map<string, string>(); vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v), removeItem: (k: string) => m.delete(k) }) }

  it('reads name and role from the profiles row and refuses member accounts', async () => {
    stubStorage()
    const user = { id: 'u9', email: 'ed@example.com', user_metadata: {}, app_metadata: {} }
    let role = 'EDITOR'
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/auth/v1/token')) return new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 3600, user }), { status: 200 })
      if (url.includes('/rest/v1/profiles')) return new Response(JSON.stringify([{ role, status: 'ACTIVE', full_name: 'Desk Editor' }]), { status: 200 })
      return new Response('', { status: 404 })
    }))
    const ok = await authenticateStaff('Ed@example.com', 'pw')
    expect(ok.success).toBe(true)
    expect(ok.session).toMatchObject({ email: 'ed@example.com', name: 'Desk Editor', role: 'EDITOR', token: 'a', authType: 'supabase' })
    role = 'SUBSCRIBER'
    const member = await authenticateStaff('ed@example.com', 'pw')
    expect(member.success).toBe(false)
    expect(member.error).toMatch(/member account/)
  })

  it('a wrong password gets the site\'s wording, and there is no bypass', async () => {
    stubStorage()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid login credentials' }), { status: 400 })))
    const r = await authenticateStaff('editor@example.com', 'nope')
    expect(r).toEqual({ success: false, error: 'Invalid email or password. Check your credentials and try again.' })
    expect(friendlyAuthError('exceed_egress_quota')).toMatch(/temporarily unavailable/)
  })

  it('publishing without a signed-in session is refused before any request', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const r = await insertArticleToSupabase({ title: 'T', slug: 's', excerpt: '', content: '<p>x</p>', category: 'Power Generation', status: 'DRAFT' } as never, null)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/Sign in/)
    expect(f).not.toHaveBeenCalled()
  })
})

// A Supabase refresh token is single use. Refreshing must always start from the newest saved copy, run one at a time, and
// save the new tokens at once; a stale in-memory object would present a dead token and end the whole session.
describe('Keeping the sign-in alive', () => {
  it('refreshes from the newest saved session, shares one request between callers, and saves the new tokens', async () => {
    const { ensureFreshSession, saveStaffSession, getStoredStaffSession } = await import('../../src/editorial/siteApi')
    const store = new Map<string, string>()
    ;(globalThis as unknown as { localStorage: Storage }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } as Storage
    const stale = { ...base, token: 'old', refreshToken: 'dead', expiresAt: 1 }
    saveStaffSession({ ...base, token: 'old2', refreshToken: 'alive', expiresAt: 1 })
    const bodies: string[] = []
    const user = { id: 'u1', email: 'e@x.com', user_metadata: {}, app_metadata: {} }
    ;(globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string, init?: RequestInit) => {
      if (String(url).includes('/auth/v1/token')) { bodies.push(String(init?.body)); return new Response(JSON.stringify({ access_token: 'new', refresh_token: 'next', expires_in: 3600, user }), { status: 200 }) }
      return new Response('[]', { status: 200 })
    }) as typeof fetch
    const [a, b] = await Promise.all([ensureFreshSession(stale), ensureFreshSession(stale)])
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toContain('alive')
    expect(bodies[0]).not.toContain('dead')
    expect(a?.token).toBe('new')
    expect(b?.token).toBe('new')
    expect(getStoredStaffSession()?.refreshToken).toBe('next')
  })
})
