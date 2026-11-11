// Thousands of random and hostile requests. Invariants: no 5xx for a reader, the pixel is always a GIF,
// a redirect only ever goes home or to a link the secret signed, junk never becomes a row.
import { describe, expect, it } from 'vitest'
import { BASE, E, hit, HOME, letter } from './helpers'

let seed = 0x2f6b1a
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)]
const junk = (n: number) => Array.from({ length: n }, () => String.fromCharCode(32 + Math.floor(rnd() * 95))).join('')

describe('fuzz', () => {
  it('2,000 random requests keep every invariant', async () => {
    const l = await letter()
    const signed = await l.click('https://esbpowerline.com/ok')
    const before = (await E.DB.prepare('SELECT COUNT(*) n FROM events').first<{ n: number }>())!.n
    const pieces = ['o', 'c', 'f', 'api', 'health', '..', '%2e%2e', l.token, l.token.slice(0, 43), 'x'.repeat(5000), '', '%00', '😀', 'events', 'files']
    let recordedSigned = 0
    for (let i = 0; i < 2000; i++) {
      const depth = 1 + Math.floor(rnd() * 4)
      let path = '/' + Array.from({ length: depth }, () => (rnd() < 0.7 ? pick(pieces) : encodeURIComponent(junk(1 + Math.floor(rnd() * 20))))).join('/')
      if (rnd() < 0.2) path += '.gif'
      let q = ''
      if (rnd() < 0.5) q = '?u=' + encodeURIComponent(pick(['https://evil.example', 'javascript:x', junk(30), 'https://esbpowerline.com/ok'])) + '&s=' + encodeURIComponent(junk(12))
      if (rnd() < 0.05) { path = new URL(signed).pathname; q = new URL(signed).search; recordedSigned++ }
      const method = pick(['GET', 'GET', 'GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'])
      const r = await hit(BASE + path + q, { method, ua: rnd() < 0.3 ? junk(500) : undefined, headers: rnd() < 0.3 ? { authorization: 'Bearer ' + junk(20) } : {} })
      const ctx = `${method} ${path}${q}`
      expect(r.status, ctx).toBeLessThan(500)
      if (path.startsWith('/o/') && path.split('/').length === 3) expect(r.headers.get('content-type'), ctx).toBe('image/gif')
      const loc = r.headers.get('location')
      if (loc) expect([HOME, 'https://esbpowerline.com/ok'], ctx).toContain(loc)
      if (loc === 'https://esbpowerline.com/ok') expect(path, ctx).toBe(new URL(signed).pathname)
    }
    const after = (await E.DB.prepare('SELECT COUNT(*) n FROM events').first<{ n: number }>())!.n
    // only the genuinely signed clicks (any method that reaches the click route) may have been stored
    expect(after - before).toBeLessThanOrEqual(recordedSigned)
  })
})
