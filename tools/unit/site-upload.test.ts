import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { uploadBanner, probeUpload, validateUpload, isTrustedMediaUrl, MAX_UPLOAD_BYTES } = require('../../electron/site-upload.cjs')

const cookies = [{ name: 'sb-sxgokpmrbgdndstygapc-auth-token', value: 'base64-eyJhY2Nlc3NfdG9rZW4iOiJ4In0' }]
const jpeg = () => { const b = new Uint8Array(4096); b.set([0xff, 0xd8, 0xff, 0xe0]); return b }
const webp = () => { const b = new Uint8Array(4096); b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]); return b }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** A fetch that records what it was sent and answers with `reply`. */
function recorder(reply: () => Response) {
  const calls: { url: string; init: RequestInit & { headers: Record<string, string> } }[] = []
  const fn = async (url: string, init: RequestInit & { headers: Record<string, string> }) => { calls.push({ url, init }); return reply() }
  return { fn, calls }
}

describe('site upload — what the main process will send', () => {
  it('refuses anything but a signed-in session cookie', () => {
    expect(validateUpload([], jpeg(), 'image/jpeg', 'x')).toMatch(/Not signed in/)
    expect(validateUpload([{ name: 'session', value: 'abc' }], jpeg(), 'image/jpeg', 'x')).toMatch(/Not signed in/)
    expect(validateUpload([{ name: cookies[0].name, value: 'a;b' }], jpeg(), 'image/jpeg', 'x')).toMatch(/Not signed in/)
  })

  it('stays under the Vercel request-body limit', () => {
    expect(MAX_UPLOAD_BYTES).toBeLessThan(4.5 * 1024 * 1024)
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1); big.set([0xff, 0xd8, 0xff])
    expect(validateUpload(cookies, big, 'image/jpeg', 'x')).toMatch(/4 MB/)
  })

  it('checks the bytes are the image type claimed', () => {
    expect(validateUpload(cookies, jpeg(), 'image/png', 'x')).toMatch(/not the image type/)
    expect(validateUpload(cookies, jpeg(), 'image/svg+xml', 'x')).toMatch(/Only JPEG/)
    expect(validateUpload(cookies, new Uint8Array(4), 'image/jpeg', 'x')).toMatch(/empty/)
    expect(validateUpload(cookies, webp(), 'image/webp', 'story-web')).toBeNull()
    expect(validateUpload(cookies, jpeg(), 'image/jpeg', '../etc/passwd')).toMatch(/file name/)
  })

  it('accepts only the site’s own storage as the returned URL', () => {
    expect(isTrustedMediaUrl('https://sxgokpmrbgdndstygapc.supabase.co/storage/v1/object/public/media/library/a.webp')).toBe(true)
    expect(isTrustedMediaUrl('https://esbpowerline.com/uploads/a.webp')).toBe(true)
    expect(isTrustedMediaUrl('http://sxgokpmrbgdndstygapc.supabase.co/a.webp')).toBe(false)
    expect(isTrustedMediaUrl('https://evil.example/a.webp')).toBe(false)
    expect(isTrustedMediaUrl('https://esbpowerline.com.evil.example/a.webp')).toBe(false)
    expect(isTrustedMediaUrl('javascript:alert(1)')).toBe(false)
  })
})

describe('site upload — the request and its answers', () => {
  const stored = 'https://sxgokpmrbgdndstygapc.supabase.co/storage/v1/object/public/media/library/x.webp'

  it('posts one multipart file to /api/upload with the session cookie and never follows a redirect', async () => {
    const r = recorder(() => json(200, { url: stored, storage: 'supabase' }))
    const res = await uploadBanner({ cookies, bytes: jpeg(), mime: 'image/jpeg', name: 'gas-field-web' }, r.fn)
    expect(res).toEqual({ ok: true, url: stored, storage: 'supabase' })
    expect(r.calls).toHaveLength(1)
    const { url, init } = r.calls[0]
    expect(url).toBe('https://esbpowerline.com/api/upload')
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('manual')
    expect(init.headers.Cookie).toBe(`${cookies[0].name}=${cookies[0].value}`)
    const form = await new Request(url, { method: 'POST', body: init.body as FormData }).formData()
    const file = form.get('file') as File
    expect(file.name).toBe('gas-field-web.jpg')
    expect(file.type).toBe('image/jpeg')
    expect(file.size).toBe(4096)
    expect(form.get('folder')).toBe('library')
  })

  it('reports each refusal plainly and does not throw', async () => {
    const cases: [Response, RegExp][] = [
      [new Response(null, { status: 307, headers: { Location: '/login' } }), /sign in again/],
      [json(401, { error: 'Unauthorized' }), /cannot upload/],
      [json(413, {}), /larger/],
      [json(429, { error: 'Too many' }), /Too many/],
      [json(500, { error: 'Upload failed. Please try again.' }), /Upload failed/],
      [json(200, { url: 'https://evil.example/x.webp' }), /did not return a media URL/],
      [new Response('<html>', { status: 200 }), /other than JSON/],
    ]
    for (const [reply, msg] of cases) {
      const res = await uploadBanner({ cookies, bytes: jpeg(), mime: 'image/jpeg', name: 'x' }, async () => reply)
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(msg)
    }
    const offline = await uploadBanner({ cookies, bytes: jpeg(), mime: 'image/jpeg', name: 'x' }, async () => { throw new TypeError('fetch failed') })
    expect(offline).toMatchObject({ ok: false, error: /Could not reach/ })
  })

  it('sends nothing when validation fails', async () => {
    const r = recorder(() => json(200, { url: stored }))
    await uploadBanner({ cookies: [], bytes: jpeg(), mime: 'image/jpeg', name: 'x' }, r.fn)
    expect(r.calls).toHaveLength(0)
  })

  it('the probe sends an empty form: 400 means allowed, 401 means not', async () => {
    const r = recorder(() => json(400, { error: 'No file provided.' }))
    expect(await probeUpload(cookies, r.fn)).toMatchObject({ ok: true, status: 400 })
    const form = await new Request(r.calls[0].url, { method: 'POST', body: r.calls[0].init.body as FormData }).formData()
    expect([...form.keys()]).toEqual([])
    expect(await probeUpload(cookies, async () => json(401, {}))).toMatchObject({ ok: false, status: 401 })
    expect(await probeUpload(cookies, async () => new Response(null, { status: 307 }))).toMatchObject({ ok: false, detail: /redirected/ })
    expect(await probeUpload([], async () => json(400, {}))).toMatchObject({ ok: false, status: 0 })
  })
})

describe('article payload image', () => {
  it('carries only an https link the site can serve, never a local blob: or data: URL', async () => {
    const { buildCmsArticlePayload } = await import('../../src/editorial/siteApi')
    const base = { headline: 'H', deck: 'D', body: 'B', slug: 's', category: 'Power', focusKeywords: '', byline: 'X', credit: '' }
    expect(buildCmsArticlePayload({ ...base, imageUrl: 'blob:http://localhost/abc' }).imageUrl).toBeUndefined()
    expect(buildCmsArticlePayload({ ...base, imageUrl: 'data:image/jpeg;base64,AAAA' }).imageUrl).toBeUndefined()
    expect(buildCmsArticlePayload({ ...base, imageUrl: 'https://x.supabase.co/a.webp' }).imageUrl).toBe('https://x.supabase.co/a.webp')
  })
})
