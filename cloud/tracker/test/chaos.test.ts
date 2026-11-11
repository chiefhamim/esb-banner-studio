// What happens when things break. The reader must never notice, and no hit may be lost silently.
import { describe, expect, it } from 'vitest'
import { buildRow, drainDeadLetters, record, type Env } from '../src/index'
import { BASE, E, hit, letter, rows } from './helpers'

const deadDb = { prepare() { throw new Error('D1_ERROR: database unavailable') } } as unknown as D1Database

/** A database that refuses the first `n` writes, then works. */
function flakyDb(n: number) {
  let left = n
  return {
    prepare(sql: string) {
      const st = E.DB.prepare(sql)
      return {
        bind: (...a: unknown[]) => ({
          run: async () => { if (left-- > 0) throw new Error('D1_ERROR: overloaded'); return st.bind(...a).run() },
        }),
      }
    },
  } as unknown as D1Database
}

const deadKv = { put() { throw new Error('KV down') }, list() { throw new Error('KV down') }, get() { throw new Error('KV down') } } as unknown as KVNamespace

async function dlqCount(key: string) {
  const l = await E.DLQ.list({ prefix: 'dlq/' })
  let n = 0
  for (const o of l.keys) if ((await E.DLQ.get(o.name))!.includes(key)) n++
  return n
}

describe('chaos', () => {
  it('database down: the pixel still answers, the hit waits in the dead-letter store', async () => {
    const l = await letter()
    const r = await hit(l.pixel, {}, { DB: deadDb })
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('image/gif')
    expect(await rows(l.key)).toHaveLength(0)
    expect(await dlqCount(l.key)).toBe(1)
  })

  it('database down: a click still lands on the article', async () => {
    const l = await letter()
    const dest = 'https://esbpowerline.com/a'
    const r = await hit(await l.click(dest), {}, { DB: deadDb })
    expect(r.headers.get('location')).toBe(dest)
    expect(await dlqCount(l.key)).toBe(1)
  })

  it('the replay puts every dead letter in the database exactly once, even run twice', async () => {
    const l = await letter()
    for (let i = 0; i < 12; i++) await hit(l.pixel, {}, { DB: deadDb })
    expect(await dlqCount(l.key)).toBe(12)
    await drainDeadLetters(E)
    await drainDeadLetters(E)
    expect(await rows(l.key)).toHaveLength(12)
    expect(await dlqCount(l.key)).toBe(0)
  })

  it('a replay that dies half-way loses nothing and duplicates nothing', async () => {
    const l = await letter()
    const req = new Request(l.pixel, { headers: { 'user-agent': 'x' } })
    const row = await buildRow(E, req, 'open', l.key, l.sentAt, null)
    await E.DLQ.put(`dlq/${row.at}-${row.hit_id}`, JSON.stringify(row))
    // the row made it into the database but the dead letter was not deleted (crash between the two steps)
    expect(await record(E, row)).toBe('db')
    await drainDeadLetters(E)
    expect(await rows(l.key)).toHaveLength(1)
  })

  it('a database that hiccups is retried, no dead letter needed', async () => {
    const l = await letter()
    const req = new Request(l.pixel, { headers: { 'user-agent': 'x' } })
    const out = await record({ ...E, DB: flakyDb(2) } as Env, await buildRow(E, req, 'open', l.key, l.sentAt, null))
    expect(out).toBe('db')
    expect(await rows(l.key)).toHaveLength(1)
  })

  it('database AND dead-letter store down: the reader still gets the picture and the click', async () => {
    const l = await letter()
    const r = await hit(l.pixel, {}, { DB: deadDb, DLQ: deadKv })
    expect(r.status).toBe(200)
    const c = await hit(await l.click('https://esbpowerline.com/b'), {}, { DB: deadDb, DLQ: deadKv })
    expect(c.headers.get('location')).toBe('https://esbpowerline.com/b')
  })

  it('health says what is down (503)', async () => {
    const r = await hit(`${BASE}/health`, {}, { DB: deadDb })
    expect(r.status).toBe(503)
    expect(await r.json()).toMatchObject({ ok: false, db: 'down', deadLetterStore: 'ok' })
    const s = await hit(`${BASE}/health`, {}, { TRACK_SECRET: 'short' })
    expect(await s.json()).toMatchObject({ ok: false, secret: 'MISSING OR SHORT' })
  })

  it('missing secret: no crash, nothing recorded, picture served', async () => {
    const l = await letter()
    const r = await hit(l.pixel, {}, { TRACK_SECRET: '' })
    expect(r.status).toBe(200)
    expect(await rows(l.key)).toHaveLength(0)
  })
})
