// ESB Mail Tracker: the Worker. Routes:
//   GET  /o/{token}.gif            open pixel. ALWAYS answers 200 + the GIF at once (bad token, database down: same).
//   GET  /c/{token}?u=&s=          click. Redirects to u only when s signs (key, u); anything else goes to HOME_URL.
//   GET  /f/{token}/{fileId}?s=    tracked attachment, streamed from R2 (ranges). Off until R2 is bound (FILES).
//   GET  /health                   database round trip, dead-letter backlog, secret present.
//   GET  /api/events?after=&limit= raw hits after an id (the app's cursor)        Bearer API_TOKEN
//   GET  /api/summary?keys=a,b     folded per-letter summaries                    Bearer API_TOKEN
//   PUT  /api/files/{id}           upload an attachment (x-file-name header)      Bearer API_TOKEN
//   DELETE /api/files/{id}
// Recording never delays the answer: it runs in waitUntil, retries, and if the database still refuses, the hit is
// written to KV (DLQ, free plan) under dlq/ and replayed by the cron job (hit_id makes the replay idempotent).

import { classify, type HitType } from './classify'
import { summarize, type EventRow } from './summary'
import { fileSig, linkSig, readToken, sameText } from './token'

export interface Env {
  DB: D1Database
  DLQ: KVNamespace
  FILES?: R2Bucket   // optional: R2 needs a card on the account; without it the file routes answer 404 / 501
  TRACK_SECRET: string
  API_TOKEN: string
  HOME_URL: string
}

// 1×1 transparent GIF (43 bytes)
export const GIF = Uint8Array.from(atob('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=='), (c) => c.charCodeAt(0))

const NO_STORE = 'no-store, no-cache, must-revalidate, private, max-age=0'
const FILE_ID = /^[A-Za-z0-9_-]{8,64}$/
const MAX_FILE = 25 * 1024 * 1024
export const RETRY_DELAYS = [0, 60, 250]

function pixel() {
  return new Response(GIF, {
    headers: { 'content-type': 'image/gif', 'cache-control': NO_STORE, pragma: 'no-cache', expires: '0', 'content-length': String(GIF.length) },
  })
}

function redirect(to: string) {
  return new Response(null, { status: 302, headers: { location: to, 'cache-control': NO_STORE, 'referrer-policy': 'no-referrer' } })
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': NO_STORE } })
}

function safeHttpUrl(u: string | null): string | null {
  if (!u || u.length > 2000) return null
  try {
    const p = new URL(u)
    return p.protocol === 'https:' || p.protocol === 'http:' ? p.href : null
  } catch {
    return null
  }
}

async function ipHash(secret: string, ip: string | null) {
  if (!ip) return null
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode('ip|' + ip)))
  return [...sig.slice(0, 10)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export type Row = Omit<EventRow, 'id'> & { hit_id: string }

export async function buildRow(env: Env, req: Request, type: HitType, key: string, sentAt: number, target: string | null, now = Date.now()): Promise<Row> {
  const cf = (req.cf ?? {}) as Record<string, unknown>
  const ua = (req.headers.get('user-agent') ?? '').slice(0, 400)
  const asn = typeof cf.asn === 'number' ? cf.asn : null
  const v = classify({ type, method: req.method, ua, asn, sinceSendMs: now - sentAt })
  const str = (x: unknown) => (typeof x === 'string' && x ? x.slice(0, 120) : null)
  return {
    hit_id: crypto.randomUUID(), key, type, target, at: now, sent_at: sentAt,
    cls: v.cls, why: v.why, client: v.client, device: v.device, ua: ua || null, asn,
    as_org: str(cf.asOrganization), country: str(cf.country), city: str(cf.city), colo: str(cf.colo),
    ip_hash: await ipHash(env.TRACK_SECRET, req.headers.get('cf-connecting-ip')),
  }
}

const COLS = ['hit_id', 'key', 'type', 'target', 'at', 'sent_at', 'cls', 'why', 'client', 'device', 'ua', 'asn', 'as_org', 'country', 'city', 'colo', 'ip_hash'] as const
const INSERT = `INSERT OR IGNORE INTO events (${COLS.join(',')}) VALUES (${COLS.map(() => '?').join(',')})`

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Write the hit; retry; then dead-letter it to R2. Returns where it ended up (tests assert on this). */
export async function record(env: Env, row: Row): Promise<'db' | 'dlq' | 'lost'> {
  for (const wait of RETRY_DELAYS) {
    if (wait) await sleep(wait)
    try {
      await env.DB.prepare(INSERT).bind(...COLS.map((c) => row[c] ?? null)).run()
      return 'db'
    } catch (e) {
      console.warn('tracker: insert failed', String(e))
    }
  }
  try {
    await env.DLQ.put(`dlq/${row.at}-${row.hit_id}`, JSON.stringify(row))
    return 'dlq'
  } catch (e) {
    // Last resort: the row is in the Worker log (observability) and can be rebuilt from there.
    console.error('tracker: HIT LOST', JSON.stringify(row), String(e))
    return 'lost'
  }
}

/** Replay dead-lettered hits into the database. Safe to run any time, any number of times. */
export async function drainDeadLetters(env: Env, max = 500): Promise<{ replayed: number; left: boolean }> {
  const list = await env.DLQ.list({ prefix: 'dlq/', limit: Math.min(max, 1000) })
  let replayed = 0
  for (const o of list.keys) {
    const body = await env.DLQ.get(o.name)
    if (!body) continue
    const row = JSON.parse(body) as Row
    await env.DB.prepare(INSERT).bind(...COLS.map((c) => row[c] ?? null)).run()
    await env.DLQ.delete(o.name)
    replayed++
  }
  return { replayed, left: !list.list_complete }
}

function authorised(env: Env, req: Request) {
  const h = req.headers.get('authorization') ?? ''
  return !!env.API_TOKEN && h.startsWith('Bearer ') && sameText(h.slice(7), env.API_TOKEN)
}

async function handle(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname
  const parts = path.split('/').filter(Boolean)
  const home = env.HOME_URL || 'https://esbpowerline.com/'

  // ── open pixel ─────────────────────────────────────────────────────────────
  if (parts[0] === 'o' && parts.length === 2) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return pixel()
    const raw = parts[1].replace(/\.gif$/, '')
    ctx.waitUntil((async () => {
      const t = await readToken(env.TRACK_SECRET, raw)
      if (t) await record(env, await buildRow(env, req, 'open', t.key, t.sentAt, null))
    })().catch((e) => console.error('tracker: open', String(e))))
    return pixel()
  }

  // ── click ──────────────────────────────────────────────────────────────────
  if (parts[0] === 'c' && parts.length === 2) {
    const t = await readToken(env.TRACK_SECRET, parts[1])
    const dest = safeHttpUrl(url.searchParams.get('u'))
    const s = url.searchParams.get('s') ?? ''
    if (!t || !dest || !sameText(s, await linkSig(env.TRACK_SECRET, t.key, dest))) return redirect(home)
    ctx.waitUntil(buildRow(env, req, 'click', t.key, t.sentAt, dest).then((r) => record(env, r)).catch((e) => console.error('tracker: click', String(e))))
    return redirect(dest)
  }

  // ── tracked file ───────────────────────────────────────────────────────────
  if (parts[0] === 'f' && parts.length === 3) {
    const t = await readToken(env.TRACK_SECRET, parts[1])
    const id = parts[2]
    const s = url.searchParams.get('s') ?? ''
    if (!env.FILES || !t || !FILE_ID.test(id) || !sameText(s, await fileSig(env.TRACK_SECRET, t.key, id))) return new Response('Not found', { status: 404 })
    const obj = await env.FILES.get(`files/${id}`, { range: req.headers, onlyIf: req.headers })
    if (!obj) return new Response('Not found', { status: 404 })
    const h = new Headers()
    obj.writeHttpMetadata(h)
    h.set('etag', obj.httpEtag)
    h.set('cache-control', NO_STORE)
    h.set('accept-ranges', 'bytes')
    // Count a download once: the first byte range (or the whole file), not every range request a viewer makes.
    const range = req.headers.get('range')
    if (!range || /^bytes=0-/.test(range)) {
      ctx.waitUntil(buildRow(env, req, 'file', t.key, t.sentAt, id).then((r) => record(env, r)).catch((e) => console.error('tracker: file', String(e))))
    }
    if (!('body' in obj)) return new Response(null, { status: 304, headers: h })
    // R2 reports a range for every read made with range headers; only a request that asked for one is partial
    if (range && obj.range && 'offset' in obj.range) {
      const off = obj.range.offset ?? 0
      const len = obj.range.length ?? obj.size - off
      h.set('content-range', `bytes ${off}-${off + len - 1}/${obj.size}`)
      return new Response(obj.body, { status: 206, headers: h })
    }
    return new Response(obj.body, { headers: h })
  }

  // ── health ─────────────────────────────────────────────────────────────────
  if (path === '/health') {
    const out: Record<string, unknown> = { ok: true, at: Date.now() }
    try {
      const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM events').first<{ n: number }>()
      out.db = 'ok'
      out.events = r?.n ?? 0
    } catch (e) {
      out.ok = false
      out.db = 'down'
    }
    try {
      const l = await env.DLQ.list({ prefix: 'dlq/', limit: 100 })
      out.deadLetterStore = 'ok'
      out.deadLetters = l.keys.length + (l.list_complete ? '' : '+')
    } catch {
      out.ok = false
      out.deadLetterStore = 'down'
    }
    out.files = env.FILES ? 'on' : 'off (R2 not enabled)'
    out.secret = env.TRACK_SECRET && env.TRACK_SECRET.length >= 32 ? 'set' : 'MISSING OR SHORT'
    if (out.secret !== 'set') out.ok = false
    return json(out, out.ok ? 200 : 503)
  }

  // ── API ────────────────────────────────────────────────────────────────────
  if (parts[0] === 'api') {
    if (!authorised(env, req)) return json({ error: 'unauthorised' }, 401)

    if (path === '/api/events' && req.method === 'GET') {
      const after = Math.max(0, Number(url.searchParams.get('after')) || 0)
      const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit')) || 500))
      const { results } = await env.DB.prepare(`SELECT * FROM events WHERE id > ? ORDER BY id LIMIT ?`).bind(after, limit).all<EventRow>()
      const last = results.length ? results[results.length - 1].id : after
      return json({ events: results, next: last, more: results.length === limit })
    }

    // remove test letters' rows (flood and smoke runs clean up after themselves)
    if (path === '/api/events' && req.method === 'DELETE') {
      const keys = [...new Set((url.searchParams.get('keys') ?? '').split(',').filter((k) => /^[A-Za-z0-9_-]{22}$/.test(k)))].slice(0, 100)
      if (!keys.length) return json({ deleted: 0 })
      const r = await env.DB.prepare(`DELETE FROM events WHERE key IN (${keys.map(() => '?').join(',')})`).bind(...keys).run()
      return json({ deleted: r.meta.changes ?? 0 })
    }

    if (path === '/api/summary' && req.method === 'GET') {
      const keys = [...new Set((url.searchParams.get('keys') ?? '').split(',').filter((k) => /^[A-Za-z0-9_-]{22}$/.test(k)))].slice(0, 100)
      if (!keys.length) return json({ summaries: [] })
      const { results } = await env.DB.prepare(`SELECT * FROM events WHERE key IN (${keys.map(() => '?').join(',')}) ORDER BY id`).bind(...keys).all<EventRow>()
      return json({ summaries: keys.map((k) => summarize(k, results)) })
    }

    if (parts[1] === 'files' && parts.length === 3) {
      const id = parts[2]
      if (!env.FILES) return json({ error: 'file hosting is off (R2 not enabled on this account)' }, 501)
      if (!FILE_ID.test(id)) return json({ error: 'bad id' }, 400)
      if (req.method === 'PUT') {
        const size = Number(req.headers.get('content-length'))
        if (!size || size > MAX_FILE) return json({ error: `size must be 1..${MAX_FILE}` }, 413)
        const name = (req.headers.get('x-file-name') ?? id).replace(/["\\\r\n]/g, '').slice(0, 150)
        const type = req.headers.get('content-type') ?? 'application/octet-stream'
        await env.FILES.put(`files/${id}`, req.body, {
          httpMetadata: { contentType: type, contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(name)}` },
          customMetadata: { name },
        })
        return json({ id, size })
      }
      if (req.method === 'DELETE') {
        await env.FILES.delete(`files/${id}`)
        return json({ id, deleted: true })
      }
    }

    if (path === '/api/drain' && req.method === 'POST') return json(await drainDeadLetters(env))
    return json({ error: 'not found' }, 404)
  }

  if (path === '/' || path === '/favicon.ico') return redirect(home)
  return new Response('Not found', { status: 404, headers: { 'cache-control': NO_STORE } })
}

export default {
  async fetch(req, env, ctx): Promise<Response> {
    try {
      return await handle(req, env, ctx)
    } catch (e) {
      // Never a 5xx for a reader: a pixel is still a picture, anything else goes home.
      console.error('tracker: unhandled', String(e))
      const p = new URL(req.url).pathname
      if (p.startsWith('/o/')) return pixel()
      if (p.startsWith('/api/') || p === '/health') return json({ error: 'internal' }, 503)
      return redirect(env.HOME_URL || 'https://esbpowerline.com/')
    }
  },
  async scheduled(_c, env, ctx) {
    ctx.waitUntil(drainDeadLetters(env).then((r) => r.replayed && console.log('tracker: replayed', r.replayed)))
  },
} satisfies ExportedHandler<Env>
