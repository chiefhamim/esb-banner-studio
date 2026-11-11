import { describe, expect, it } from 'vitest'
import { GIF } from '../src/index'
import { api, BASE, E, hit, HOME, letter, rows, UA } from './helpers'

describe('open pixel', () => {
  it('answers a 43-byte GIF, never cached, and records one human open', async () => {
    const l = await letter()
    const r = await hit(l.pixel, { ua: UA.outlookDesktop })
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('image/gif')
    expect(r.headers.get('cache-control')).toContain('no-store')
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(GIF)
    expect(GIF.length).toBe(43)
    expect(r.headers.get('content-length')).toBe('43')
    expect(String.fromCharCode(...GIF.slice(0, 6))).toBe('GIF89a')
    const got = await rows(l.key)
    expect(got).toHaveLength(1)
    expect(got[0]).toMatchObject({ type: 'open', cls: 'human', client: 'Outlook', country: 'BD', asn: 24389 })
    expect(got[0].sent_at).toBe(Math.floor(l.sentAt / 1000) * 1000)
  })

  it('works without the .gif ending too', async () => {
    const l = await letter()
    await hit(`${BASE}/o/${l.token}`)
    expect(await rows(l.key)).toHaveLength(1)
  })

  it('a forged or broken token still gets the picture, and nothing is stored', async () => {
    const l = await letter()
    const forged = l.token.slice(0, 30) + (l.token[30] === 'A' ? 'B' : 'A') + l.token.slice(31)
    for (const p of [`/o/${forged}.gif`, '/o/x.gif', '/o/.gif', `/o/${'A'.repeat(44)}.gif`]) {
      const r = await hit(BASE + p)
      expect(r.status).toBe(200)
      expect(r.headers.get('content-type')).toBe('image/gif')
    }
    expect(await rows(l.key)).toHaveLength(0)
  })

  it('never stores the reader’s IP address, only a keyed hash', async () => {
    const l = await letter()
    await hit(l.pixel, { ip: '198.51.100.23' })
    await hit(l.pixel, { ip: '198.51.100.23', ua: UA.thunderbird })
    const [a, b] = await rows(l.key)
    expect(JSON.stringify(a)).not.toContain('198.51.100.23')
    expect(a.ip_hash).toMatch(/^[0-9a-f]{20}$/)
    expect(b.ip_hash).toBe(a.ip_hash)
  })

  it('every open is its own row (counting happens later)', async () => {
    const l = await letter()
    for (let i = 0; i < 7; i++) await hit(l.pixel)
    expect(await rows(l.key)).toHaveLength(7)
  })
})

describe('click', () => {
  const dest = 'https://esbpowerline.com/articles/rooppur-unit-2?ref=mail#top'

  it('redirects to the signed link and records it', async () => {
    const l = await letter()
    const r = await hit(await l.click(dest))
    expect(r.status).toBe(302)
    expect(r.headers.get('location')).toBe(dest)
    expect(r.headers.get('cache-control')).toContain('no-store')
    expect(await rows(l.key)).toMatchObject([{ type: 'click', target: dest, cls: 'human' }])
  })

  it('a changed destination goes home, never to the new address (no open redirect)', async () => {
    const l = await letter()
    const good = await l.click(dest)
    const evil = good.replace(encodeURIComponent(dest), encodeURIComponent('https://evil.example/phish'))
    const r = await hit(evil)
    expect(r.headers.get('location')).toBe(HOME)
    expect(await rows(l.key)).toHaveLength(0)
  })

  it('a link signed for another letter goes home', async () => {
    const a = await letter(), b = await letter()
    const url = new URL(await a.click(dest))
    const r = await hit(`${BASE}/c/${b.token}${url.search}`)
    expect(r.headers.get('location')).toBe(HOME)
  })

  it('javascript:, data:, relative and missing links go home even if "signed"', async () => {
    const { linkSig } = await import('../src/token')
    const l = await letter()
    for (const u of ['javascript:alert(1)', 'data:text/html,hi', '/relative', '', 'ftp://x.example/f']) {
      const s = await linkSig(E.TRACK_SECRET, l.key, u)
      const r = await hit(`${BASE}/c/${l.token}?u=${encodeURIComponent(u)}&s=${s}`)
      expect(r.headers.get('location')).toBe(HOME)
    }
  })

  it('a security scanner’s click is kept but labelled', async () => {
    const l = await letter()
    await hit(await l.click(dest), { asn: 8075 })
    await hit(await l.click(dest), { method: 'HEAD' })
    expect((await rows(l.key)).map((r) => r.cls)).toEqual(['scanner', 'scanner'])
  })
})

describe('tracked files', () => {
  const id = 'tariff-order-2026'
  const body = new TextEncoder().encode('%PDF-1.7 synthetic test file '.repeat(400))

  it('upload, download with the right name, count once, ranges work, delete', async () => {
    const up = await api(`/api/files/${id}`, { method: 'PUT', body, headers: { 'content-type': 'application/pdf', 'content-length': String(body.length), 'x-file-name': 'Tariff order 2026.pdf' } })
    expect(up.status).toBe(200)

    const l = await letter()
    const url = await l.file(id)
    const r = await hit(url)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('application/pdf')
    expect(r.headers.get('content-disposition')).toContain('Tariff%20order%202026.pdf')
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(body)

    const part = await hit(url, { headers: { range: 'bytes=100-199' } })
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe(`bytes 100-199/${body.length}`)
    expect((await part.arrayBuffer()).byteLength).toBe(100)

    expect(await rows(l.key)).toMatchObject([{ type: 'file', target: id }]) // the range request is not a second download

    expect((await api(`/api/files/${id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await hit(url)).status).toBe(404)
  })

  it('without R2 bound: downloads 404, uploads say file hosting is off', async () => {
    const l = await letter()
    expect((await hit(await l.file(id), {}, { FILES: undefined })).status).toBe(404)
    const up = await hit(`${BASE}/api/files/${id}`, { method: 'PUT', body: 'x', headers: { authorization: `Bearer ${E.API_TOKEN}` } }, { FILES: undefined })
    expect(up.status).toBe(501)
  })

  it('a wrong signature or another file id is 404', async () => {
    const l = await letter()
    const url = await l.file(id)
    expect((await hit(url.replace(/s=.*/, 's=AAAAAAAAAAAA'))).status).toBe(404)
    expect((await hit(url.replace(id, 'other-file-123'))).status).toBe(404)
  })
})

describe('API', () => {
  it('refuses without the token, with a wrong one, or a near miss', async () => {
    for (const token of ['', 'wrong', E.API_TOKEN + 'x', E.API_TOKEN.slice(0, -1)]) {
      expect((await api('/api/events', { token })).status).toBe(401)
    }
    expect((await hit(`${BASE}/api/events`)).status).toBe(401)
  })

  it('events come back in order after a cursor, none skipped', async () => {
    const l = await letter()
    for (let i = 0; i < 5; i++) await hit(l.pixel)
    const all = (await (await api('/api/events?after=0&limit=1000')).json()) as { events: { id: number; key: string }[] }
    const mine = all.events.filter((e) => e.key === l.key)
    expect(mine).toHaveLength(5)
    const after = mine[1].id
    const page = (await (await api(`/api/events?after=${after}&limit=2`)).json()) as { events: { id: number }[]; next: number; more: boolean }
    expect(page.events.map((e) => e.id)).toEqual([mine[2].id, mine[3].id])
    expect(page.more).toBe(true)
    expect(page.next).toBe(mine[3].id)
  })

  it('summary folds a letter', async () => {
    const l = await letter()
    await hit(l.pixel, { ua: UA.gmailProxy, asn: 15169 })
    await hit(l.pixel, { ua: UA.appleMpp, asn: 714 })
    await hit(await l.click('https://esbpowerline.com/x'))
    const { summaries } = (await (await api(`/api/summary?keys=${l.key},not-a-key`)).json()) as { summaries: { opens: number; clicks: number; machineOpens: number }[] }
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({ opens: 1, machineOpens: 1, clicks: 1 })
  })
})

describe('health', () => {
  it('reports database and file store', async () => {
    const r = await hit(`${BASE}/health`)
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ ok: true, db: 'ok', deadLetterStore: 'ok', files: 'on', secret: 'set' })
  })
})
