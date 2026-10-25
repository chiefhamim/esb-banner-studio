// The main process's request that asks esbpowerline.com to refresh its cached pages after the Studio saves an article.
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { revalidateSite } = require('../../electron/site-upload.cjs')

const cookies = [{ name: 'sb-sxgokpmrbgdndstygapc-auth-token', value: 'base64-eyJhY2Nlc3NfdG9rZW4iOiJ4In0' }]
const reply = (status: number) => async () => new Response('{}', { status })

describe('revalidateSite', () => {
  it('posts the slugs as JSON with the session cookie, to the site only, and reports success', async () => {
    const seen: { url: string; init: RequestInit & { headers: Record<string, string> } }[] = []
    const fetchImpl = async (url: string, init: RequestInit & { headers: Record<string, string> }) => { seen.push({ url, init }); return new Response('{"ok":true}', { status: 200 }) }
    const r = await revalidateSite(cookies, ['rooppur-unit-1'], fetchImpl)
    expect(r.ok).toBe(true)
    expect(seen[0].url).toBe('https://esbpowerline.com/api/cms/revalidate')
    expect(seen[0].init.method).toBe('POST')
    expect(JSON.parse(String(seen[0].init.body))).toEqual({ slugs: ['rooppur-unit-1'] })
    expect(seen[0].init.headers.Cookie).toContain('sb-sxgokpmrbgdndstygapc-auth-token=')
    expect(seen[0].init.redirect).toBe('manual')
  })

  it('refuses before sending anything when there is no session or the slugs are not slugs', async () => {
    let sent = 0
    const fetchImpl = async () => { sent++; return new Response('{}') }
    expect((await revalidateSite([], ['a-b'], fetchImpl)).ok).toBe(false)
    expect((await revalidateSite(cookies, [], fetchImpl)).ok).toBe(false)
    expect((await revalidateSite(cookies, ['../admin'], fetchImpl)).ok).toBe(false)
    expect((await revalidateSite(cookies, ['a', 'b', 'c', 'd', 'e', 'f'], fetchImpl)).ok).toBe(false)
    expect(sent).toBe(0)
  })

  it('says what happened in each failing case and never throws', async () => {
    expect((await revalidateSite(cookies, ['a-b'], reply(404))).error).toMatch(/does not have the refresh route/)
    expect((await revalidateSite(cookies, ['a-b'], reply(401))).error).toMatch(/did not accept this session/)
    expect((await revalidateSite(cookies, ['a-b'], reply(302))).error).toMatch(/did not accept this session/)
    expect((await revalidateSite(cookies, ['a-b'], reply(429))).error).toMatch(/Too many/)
    expect((await revalidateSite(cookies, ['a-b'], async () => { throw new Error('offline') })).error).toMatch(/Could not reach/)
  })
})
