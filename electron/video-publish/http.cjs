// ESB Studio — Video publishing: the one door every publishing request goes through (main process only).
//
//   - Only the configured endpoint origins are reachable (`allowOrigins`); a session or upload URL a server hands
//     back on another host is refused, so a token can never be steered elsewhere.
//   - A token travels only in the Authorization header. A URL that carries one (or any access_token= parameter) is
//     refused before it is sent.
//   - Redirects are never followed (a 3xx comes back as it is: YouTube's 308 "Resume Incomplete" is an answer).
//   - Every error text is passed through `redact`, which removes the secrets the credential store knows.
'use strict'
const fs = require('node:fs')
const { Readable } = require('node:stream')

class PublishError extends Error {
  /** @param {string} message @param {{ status?: number, code?: string|number, retryable?: boolean, platform?: string, kind?: string }} [info] */
  constructor(message, info = {}) {
    super(message)
    this.name = 'PublishError'
    Object.assign(this, info)
  }
}

const sleepReal = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason ?? new Error('Stopped'))
  const t = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason ?? new Error('Stopped')) }, { once: true })
})

/** Exponential backoff with jitter: 1, 2, 4 … 32 s (Retry-After wins when the server sends one). */
function backoffMs(attempt, retryAfter, random = Math.random) {
  const ra = Number(retryAfter)
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra, 300) * 1000
  return Math.min(32_000, 1000 * 2 ** attempt) + Math.floor(random() * 1000)
}

/** A web stream of bytes [start, end) of a file, for one upload request that sends the rest of the file. */
function fileStream(filePath, start, end) {
  if (end <= start) return new Uint8Array(0)
  return Readable.toWeb(fs.createReadStream(filePath, { start, end: end - 1, highWaterMark: 1024 * 1024 }))
}

/** Bytes [start, start+len) of a file. */
function readChunk(filePath, start, len) {
  const fd = fs.openSync(filePath, 'r')
  try {
    const buf = Buffer.alloc(len)
    let got = 0
    while (got < len) {
      const n = fs.readSync(fd, buf, got, len - got, start + got)
      if (n === 0) break
      got += n
    }
    return got === len ? buf : buf.subarray(0, got)
  } finally { fs.closeSync(fd) }
}

function createHttp({ fetchImpl = globalThis.fetch, allowOrigins, redact = (s) => s, timeoutMs = 10 * 60_000 }) {
  if (!Array.isArray(allowOrigins) || !allowOrigins.length) throw new Error('createHttp needs the endpoint origins')
  const allowed = new Set(allowOrigins.map((o) => new URL(o).origin))

  function checkUrl(url, token) {
    let u
    try { u = new URL(url) } catch { throw new PublishError('Refused a malformed publishing address.', { kind: 'refused' }) }
    if (!allowed.has(u.origin)) throw new PublishError(`Refused a request to ${u.origin}: it is not one of the publishing endpoints.`, { kind: 'refused' })
    if (/[?&](access_token|refresh_token|client_secret)=/i.test(u.search)) throw new PublishError('Refused: a token may never travel in a URL.', { kind: 'refused' })
    if (token && (u.href.includes(token) || u.href.includes(encodeURIComponent(token)))) throw new PublishError('Refused: a token may never travel in a URL.', { kind: 'refused' })
    return u
  }

  /**
   * @param {string} url
   * @param {{ method?: string, headers?: Record<string,string>, body?: any, auth?: { scheme: string, token: string }, signal?: AbortSignal, timeoutMs?: number }} [opts]
   */
  async function request(url, opts = {}) {
    const u = checkUrl(url, opts.auth?.token)
    const headers = { ...(opts.headers || {}) }
    if (opts.auth) headers.Authorization = `${opts.auth.scheme} ${opts.auth.token}`
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(new Error('The platform did not answer in time')), opts.timeoutMs ?? timeoutMs)
    const onAbort = () => ctl.abort(opts.signal.reason ?? new Error('Stopped'))
    if (opts.signal) {
      if (opts.signal.aborted) onAbort()
      else opts.signal.addEventListener('abort', onAbort, { once: true })
    }
    const init = { method: opts.method || 'GET', headers, signal: ctl.signal, redirect: 'manual' }
    if (opts.body !== undefined) {
      init.body = opts.body
      if (opts.body && typeof opts.body.getReader === 'function') init.duplex = 'half'
    }
    try {
      const res = await fetchImpl(u, init)
      const text = await res.text()
      let json = null
      try { json = text ? JSON.parse(text) : null } catch { /* not JSON */ }
      return { status: res.status, headers: res.headers, text, json }
    } catch (e) {
      if (opts.signal?.aborted) throw new PublishError('Stopped.', { kind: 'stopped' })
      const why = e?.cause?.code || e?.cause?.message || e?.message || String(e)
      throw new PublishError(redact(`The connection to ${u.host} broke (${why}).`), { kind: 'network', retryable: true })
    } finally {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
    }
  }

  return { request, checkUrl, redact }
}

module.exports = { createHttp, PublishError, backoffMs, sleepReal, fileStream, readChunk }
