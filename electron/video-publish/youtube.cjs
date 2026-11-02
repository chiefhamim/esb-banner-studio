// ESB Studio — Video publishing: YouTube (main process only).
//
//   OAuth for an installed app: the system browser opens Google's consent page; Google redirects to a one-shot
//   server on 127.0.0.1 at a random port; the code is exchanged with a PKCE (S256) verifier. Scope youtube.upload,
//   plus youtube.force-ssl only when captions are to be uploaded.
//
//   videos.insert, RESUMABLE: one session per destination. Bytes go in chunks (multiples of 256 KiB). After a cut,
//   the session is asked how much it holds (`Content-Range: bytes */size` → 308 + Range) and the upload carries on
//   from there. 5xx / 429 / a broken connection back off and resume; a 401 refreshes the access token once. A new
//   session is never made while the old one lives; when it has expired (404/410) the caller first checks the
//   channel's uploads for this title, so a video that did land is not posted twice.
//
//   Then thumbnails.set and captions.insert (SRT).
'use strict'
const crypto = require('node:crypto')
const http = require('node:http')
const { PublishError, backoffMs, sleepReal, readChunk } = require('./http.cjs')

const SCOPE_UPLOAD = 'https://www.googleapis.com/auth/youtube.upload'
const SCOPE_FORCE_SSL = 'https://www.googleapis.com/auth/youtube.force-ssl'
const CHUNK_UNIT = 256 * 1024
const DEFAULT_CHUNK = 32 * CHUNK_UNIT // 8 MiB

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** RFC 7636: a 43-char verifier and its S256 challenge. */
function pkcePair(randomBytes = crypto.randomBytes) {
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
  return { verifier, challenge, method: 'S256' }
}

function buildAuthUrl({ authUrl, clientId, redirectUri, challenge, state, scopes }) {
  const u = new URL(authUrl)
  u.searchParams.set('client_id', clientId)
  u.searchParams.set('redirect_uri', redirectUri)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', scopes.join(' '))
  u.searchParams.set('code_challenge', challenge)
  u.searchParams.set('code_challenge_method', 'S256')
  u.searchParams.set('state', state)
  u.searchParams.set('access_type', 'offline')
  u.searchParams.set('prompt', 'consent')
  return u.toString()
}

function googleError(status, body) {
  const e = body?.error
  const reason = e?.errors?.[0]?.reason || (typeof e === 'string' ? e : '')
  const msg = (typeof e === 'object' && e?.message) || body?.error_description || ''
  if (reason === 'invalid_grant') return 'Google ended the YouTube connection (the sign-in was revoked or expired). Connect YouTube again.'
  if (reason === 'quotaExceeded' || reason === 'uploadLimitExceeded') return `YouTube's daily limit is used up${msg ? `: ${msg}` : ''}. It resets at midnight Pacific Time.`
  if (status === 401) return 'YouTube refused the sign-in. Connect YouTube again.'
  if (status === 403) return `YouTube does not allow this${msg ? `: ${msg}` : '.'}`
  return `YouTube answered ${status}${msg ? `: ${msg}` : ''}`
}

/**
 * Run the loopback consent flow. `openExternal(url)` opens the system browser (main: shell.openExternal).
 * Resolves to { refreshToken, accessToken, expiresAt, scope }.
 */
async function authorize({ httpClient, endpoints, clientId, clientSecret = '', scopes = [SCOPE_UPLOAD], openExternal, timeoutMs = 5 * 60_000, clock = () => Date.now(), randomBytes = crypto.randomBytes }) {
  const { verifier, challenge } = pkcePair(randomBytes)
  const state = b64url(randomBytes(16))
  let settle
  const result = new Promise((resolve, reject) => { settle = { resolve, reject } })
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1')
    if (u.pathname !== '/' || (!u.searchParams.has('code') && !u.searchParams.has('error'))) { res.writeHead(404).end(); return }
    const ok = u.searchParams.get('state') === state && u.searchParams.has('code')
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(`<!doctype html><meta charset="utf-8"><title>ESB Studio</title><p style="font:16px system-ui;margin:3em">${ok ? 'YouTube is connected. You can close this tab and return to ESB Studio.' : 'The YouTube connection did not complete. Return to ESB Studio and try again.'}</p>`)
    if (u.searchParams.get('state') !== state) settle.reject(new PublishError('The answer from Google did not match this sign-in, so it was ignored. Try again.', { kind: 'auth' }))
    else if (u.searchParams.has('error')) settle.reject(new PublishError(u.searchParams.get('error') === 'access_denied' ? 'YouTube access was not allowed in the browser.' : `Google refused: ${u.searchParams.get('error')}`, { kind: 'auth' }))
    else settle.resolve(u.searchParams.get('code'))
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const redirectUri = `http://127.0.0.1:${server.address().port}`
  const timer = setTimeout(() => settle.reject(new PublishError('No answer from the browser within 5 minutes. Try connecting again.', { kind: 'auth' })), timeoutMs)
  try {
    await openExternal(buildAuthUrl({ authUrl: endpoints.auth, clientId, redirectUri, challenge, state, scopes }))
    const code = await result
    const body = new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirectUri })
    const r = await httpClient.request(endpoints.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() })
    if (r.status !== 200 || !r.json?.access_token) throw new PublishError(googleError(r.status, r.json), { status: r.status, kind: 'auth' })
    if (!r.json.refresh_token) throw new PublishError('Google did not hand back a refresh token. Remove ESB Studio from your Google account\'s third-party access and connect again.', { kind: 'auth' })
    return { refreshToken: r.json.refresh_token, accessToken: r.json.access_token, expiresAt: clock() + (Number(r.json.expires_in) || 3600) * 1000, scope: r.json.scope || scopes.join(' ') }
  } finally {
    clearTimeout(timer)
    server.close()
  }
}

/** Access tokens from the credential store, refreshed a minute before they run out (and on demand after a 401). */
function createGoogleTokens({ httpClient, endpoints, credentials, clock = () => Date.now() }) {
  let inflight = null
  async function refresh() {
    if (inflight) return inflight
    inflight = (async () => {
      const client = credentials.youtubeClient()
      const t = credentials.youtubeTokens()
      if (!client?.clientId || !t?.refreshToken) throw new PublishError('YouTube is not connected.', { kind: 'auth' })
      const body = new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret || '', refresh_token: t.refreshToken, grant_type: 'refresh_token' })
      const r = await httpClient.request(endpoints.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() })
      if (r.status !== 200 || !r.json?.access_token) throw new PublishError(googleError(r.status, r.json), { status: r.status, kind: 'auth' })
      const next = { accessToken: r.json.access_token, expiresAt: clock() + (Number(r.json.expires_in) || 3600) * 1000, refreshToken: r.json.refresh_token, scope: r.json.scope }
      credentials.updateYouTubeAccess(next)
      return next.accessToken
    })()
    try { return await inflight } finally { inflight = null }
  }
  async function access() {
    const t = credentials.youtubeTokens()
    if (!t?.refreshToken) throw new PublishError('YouTube is not connected.', { kind: 'auth' })
    if (t.accessToken && t.expiresAt - 60_000 > clock()) return t.accessToken
    return refresh()
  }
  return { access, refresh }
}

const parseRange = (h) => {
  const m = /bytes=(\d+)-(\d+)/.exec(String(h ?? ''))
  return m ? Number(m[2]) + 1 : 0
}

function createYouTubeClient({ httpClient, endpoints, tokens, sleep = sleepReal, chunkSize = DEFAULT_CHUNK, maxRetries = 8, random = Math.random }) {
  if (chunkSize % CHUNK_UNIT) throw new Error('YouTube chunks must be a multiple of 256 KiB')

  /** A request with the current access token; one refresh and retry on 401. */
  async function authed(url, opts = {}) {
    let token = await tokens.access()
    let r = await httpClient.request(url, { ...opts, auth: { scheme: 'Bearer', token } })
    if (r.status === 401) {
      token = await tokens.refresh()
      r = await httpClient.request(url, { ...opts, auth: { scheme: 'Bearer', token } })
    }
    return r
  }

  const retryable = (s) => s === 429 || s >= 500

  /** Start a resumable session. Returns the session URI (on the upload origin, checked). */
  async function startSession({ fileSize, mime = 'video/mp4', resource, signal }) {
    const url = `${endpoints.upload}/videos?uploadType=resumable&part=snippet,status`
    for (let attempt = 0; ; attempt++) {
      let r
      try {
        r = await authed(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(fileSize), 'X-Upload-Content-Type': mime }, body: JSON.stringify(resource) })
      } catch (e) {
        if (e.retryable && attempt < maxRetries) { await sleep(backoffMs(attempt, null, random), signal); continue }
        throw e
      }
      if (r.status === 200 || r.status === 201) {
        const loc = r.headers.get('location')
        if (!loc) throw new PublishError('YouTube did not open an upload session.', { status: r.status })
        httpClient.checkUrl(loc)
        if (new URL(loc).origin !== new URL(endpoints.upload).origin) throw new PublishError('YouTube pointed the upload at an unexpected address, so it was refused.', { kind: 'refused' })
        return loc
      }
      if (retryable(r.status) && attempt < maxRetries) { await sleep(backoffMs(attempt, r.headers.get('retry-after'), random), signal); continue }
      throw new PublishError(googleError(r.status, r.json), { status: r.status, platform: 'youtube' })
    }
  }

  /** How much of the file the session holds. { state: 'incomplete', offset } | { state: 'complete', video } | { state: 'expired' } */
  async function queryStatus(sessionUri, fileSize, signal) {
    for (let attempt = 0; ; attempt++) {
      let r
      try {
        r = await authed(sessionUri, { method: 'PUT', signal, headers: { 'Content-Range': `bytes */${fileSize}`, 'Content-Length': '0' }, body: new Uint8Array(0) })
      } catch (e) {
        if (e.retryable && attempt < maxRetries) { await sleep(backoffMs(attempt, null, random), signal); continue }
        throw e
      }
      if (r.status === 308) return { state: 'incomplete', offset: parseRange(r.headers.get('range')) }
      if (r.status === 200 || r.status === 201) return { state: 'complete', video: r.json }
      if (r.status === 404 || r.status === 410) return { state: 'expired' }
      if (retryable(r.status) && attempt < maxRetries) { await sleep(backoffMs(attempt, r.headers.get('retry-after'), random), signal); continue }
      throw new PublishError(googleError(r.status, r.json), { status: r.status, platform: 'youtube' })
    }
  }

  /**
   * Send the file from `offset` to the end. `onProgress(offset)` after each chunk lands (the caller persists it).
   * Resolves to the video resource. Throws { kind: 'expired' } if the session is gone.
   */
  async function upload({ sessionUri, filePath, fileSize, offset = 0, onProgress = () => {}, signal }) {
    let pos = offset
    let failures = 0
    while (true) {
      if (signal?.aborted) throw new PublishError('Stopped.', { kind: 'stopped' })
      const len = Math.min(chunkSize, fileSize - pos)
      let r
      try {
        const chunk = readChunk(filePath, pos, len)
        if (chunk.length !== len) throw new PublishError('The render file changed size while it was being uploaded.', { kind: 'file' })
        r = await authed(sessionUri, { method: 'PUT', signal, headers: { 'Content-Range': `bytes ${pos}-${pos + len - 1}/${fileSize}`, 'Content-Type': 'application/octet-stream' }, body: chunk })
      } catch (e) {
        if (!e.retryable || failures >= maxRetries) throw e
        await sleep(backoffMs(failures++, null, random), signal)
        const st = await queryStatus(sessionUri, fileSize, signal)
        if (st.state === 'complete') return st.video
        if (st.state === 'expired') throw new PublishError('The YouTube upload session expired.', { kind: 'expired' })
        pos = st.offset
        onProgress(pos)
        continue
      }
      if (r.status === 200 || r.status === 201) { onProgress(fileSize); return r.json }
      if (r.status === 308) { pos = parseRange(r.headers.get('range')); failures = 0; onProgress(pos); continue }
      if (r.status === 404 || r.status === 410) throw new PublishError('The YouTube upload session expired.', { kind: 'expired' })
      if (retryable(r.status) && failures < maxRetries) {
        await sleep(backoffMs(failures++, r.headers.get('retry-after'), random), signal)
        const st = await queryStatus(sessionUri, fileSize, signal)
        if (st.state === 'complete') return st.video
        if (st.state === 'expired') throw new PublishError('The YouTube upload session expired.', { kind: 'expired' })
        pos = st.offset
        onProgress(pos)
        continue
      }
      throw new PublishError(googleError(r.status, r.json), { status: r.status, platform: 'youtube' })
    }
  }

  /** A video with this exact title uploaded to the connected channel since `since` (ms), or null. 2 quota units. */
  async function findRecentUpload({ title, since, signal }) {
    const ch = await authed(`${endpoints.api}/channels?part=contentDetails&mine=true`, { signal })
    if (ch.status !== 200) throw new PublishError(googleError(ch.status, ch.json), { status: ch.status, platform: 'youtube' })
    const uploads = ch.json?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
    if (!uploads) return null
    const pl = await authed(`${endpoints.api}/playlistItems?part=snippet&maxResults=25&playlistId=${encodeURIComponent(uploads)}`, { signal })
    if (pl.status !== 200) throw new PublishError(googleError(pl.status, pl.json), { status: pl.status, platform: 'youtube' })
    const hit = (pl.json?.items || []).find((it) => it?.snippet?.title === title && Date.parse(it.snippet.publishedAt) >= since - 5 * 60_000)
    return hit ? { id: hit.snippet.resourceId?.videoId } : null
  }

  async function setThumbnail({ videoId, bytes, mime, signal }) {
    if (!/^image\/(png|jpeg)$/.test(mime)) throw new PublishError('A YouTube thumbnail must be PNG or JPEG.')
    if (bytes.length > 2 * 1024 * 1024) throw new PublishError('A YouTube thumbnail must be under 2 MB.')
    const r = await authed(`${endpoints.upload}/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`, { method: 'POST', signal, headers: { 'Content-Type': mime }, body: bytes })
    if (r.status !== 200) throw new PublishError(googleError(r.status, r.json) + (r.status === 403 ? ' (Custom thumbnails need a verified channel.)' : ''), { status: r.status, platform: 'youtube' })
    return r.json
  }

  async function insertCaption({ videoId, srt, language, name = '', signal }) {
    const boundary = `esb${crypto.randomBytes(12).toString('hex')}`
    const meta = JSON.stringify({ snippet: { videoId, language, name, isDraft: false } })
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/x-subrip; charset=UTF-8\r\n\r\n`),
      Buffer.from(String(srt), 'utf8'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    const r = await authed(`${endpoints.upload}/captions?uploadType=multipart&part=snippet`, { method: 'POST', signal, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body })
    if (r.status !== 200) throw new PublishError(googleError(r.status, r.json) + (r.status === 403 ? ' (Captions need the youtube.force-ssl permission: connect YouTube again with captions on.)' : ''), { status: r.status, platform: 'youtube' })
    return r.json
  }

  async function channel(signal) {
    const r = await authed(`${endpoints.api}/channels?part=snippet&mine=true`, { signal })
    if (r.status !== 200) throw new PublishError(googleError(r.status, r.json), { status: r.status, platform: 'youtube' })
    const it = r.json?.items?.[0]
    return it ? { id: it.id, title: it.snippet?.title ?? '' } : null
  }

  return { startSession, queryStatus, upload, findRecentUpload, setThumbnail, insertCaption, channel }
}

module.exports = { SCOPE_UPLOAD, SCOPE_FORCE_SSL, CHUNK_UNIT, pkcePair, buildAuthUrl, authorize, createGoogleTokens, createYouTubeClient, googleError, parseRange }
