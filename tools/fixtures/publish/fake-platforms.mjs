// Fake YouTube + Facebook servers for Video Desk Pro publishing tests and the dry run (ESB_VIDEO_PUBLISH_DRYRUN=1).
// Emulates only the endpoints electron/video-publish/*.cjs uses, on 127.0.0.1, with failures that can be injected:
//
//   fake.fail.ytCutAt = 0.5        the upload chunk that crosses 50 % keeps the bytes up to there, then the socket dies
//   fake.fail.yt5xx = n            the next n upload chunks answer 503     fake.fail.yt429 = n   … answer 429
//   fake.fail.ytExpireSession      the next chunk finds its session gone (404)
//   fake.fail.ytExpireAccess       every access token issued so far stops working (401 → the client refreshes)
//   fake.fail.ytDropFinal          the last chunk creates the video, then the socket dies before the answer
//                                  ('expire': and the session is gone too, so only the uploads list knows)
//   fake.fail.fbCutAt = 0.5        rupload / resumable upload keeps the bytes up to 50 %, then the socket dies
//   fake.fail.fb5xx = n            the next n Graph POSTs answer 500 (transient)
//   fake.fail.fbDropFinish         the Reel finish goes through, then the socket dies before the answer
//   fake.fail.fbDropPublish        the feed video post is created, then the socket dies before the answer
//   fake.fail.fbTokenExpired       every Graph call answers code 190
//
// `fake.state` holds what landed (sessions, videos, reels, comments, quota counts); `fake.leaks` lists any request
// whose URL carried a token (must stay empty). Run directly to serve a dry run:  node tools/fixtures/publish/fake-platforms.mjs
import http from 'node:http'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const rid = (n = 9) => crypto.randomBytes(n).toString('hex')
const numId = () => String(10 ** 14 + Math.floor(Math.random() * 9 * 10 ** 14))

export const FAKE_PAGE_ID = '100000000000001'
export const FAKE_PAGE_TOKEN = 'EAAfakePageTokenForTestsOnly0000000000'
export const FAKE_APP_ID = '200000000000002'

export async function startFakePlatforms({ pageId = FAKE_PAGE_ID, pageToken = FAKE_PAGE_TOKEN, appId = FAKE_APP_ID, port = 0, accessTtlSec = 3600 } = {}) {
  const fail = {}
  const state = {
    codes: new Map(), access: new Map(), refresh: new Set(), tokenCalls: 0, refreshCalls: 0,
    sessions: new Map(), videos: [], insertCalls: 0, thumbnails: [], captions: [],
    reels: new Map(), reelFinishCalls: 0, uploads: new Map(), feedVideos: [], comments: [],
    requests: [],
  }
  const leaks = []
  let base = ''

  const json = (res, status, body, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(body)) }
  const readBody = (req) => new Promise((resolve) => { const parts = []; req.on('data', (d) => parts.push(d)); req.on('end', () => resolve(Buffer.concat(parts))) })
  const gErr = (res, status, reason, message) => json(res, status, { error: { code: status, message, errors: [{ reason, message }] } })
  const fbErr = (res, status, code, message, transient = false) => json(res, status, { error: { message, type: 'OAuthException', code, is_transient: transient } })

  /** Receive a body into `target.data` from `start`, cutting the socket at `cutAt` bytes if set. Resolves false when cut. */
  function receive(req, target, start, cutAt) {
    return new Promise((resolve) => {
      let pos = start
      let cut = false
      req.on('data', (d) => {
        if (cut) return
        let piece = d
        if (cutAt != null && pos + piece.length > cutAt) {
          piece = piece.subarray(0, Math.max(0, cutAt - pos))
          cut = true
        }
        target.data.push(piece)
        pos += piece.length
        target.received = pos
        if (cut) { req.socket.destroy(); resolve(false) }
      })
      req.on('end', () => { if (!cut) resolve(true) })
      req.on('close', () => { if (!cut) resolve(true) })
    })
  }

  const googleAuthOk = (req) => {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '')
    const t = m && state.access.get(m[1])
    return t && t.expiresAt > Date.now() ? t : null
  }
  const fbAuthOk = (req, schemes = ['Bearer', 'OAuth']) => {
    const m = /^(\w+) (.+)$/.exec(req.headers.authorization || '')
    return !!m && schemes.includes(m[1]) && m[2] === pageToken
  }
  const issueAccess = (scope) => {
    const t = `ya29.fake-${rid(12)}`
    state.access.set(t, { expiresAt: Date.now() + accessTtlSec * 1000, scope })
    return t
  }

  function reelStatus(r) {
    const uploaded = r.received >= r.size && r.size > 0
    return {
      video_status: r.finished ? 'ready' : uploaded ? 'upload_complete' : 'uploading',
      uploading_phase: { status: uploaded ? 'complete' : r.received > 0 ? 'in_progress' : 'not_started', bytes_transferred: r.received },
      processing_phase: { status: uploaded ? 'complete' : 'not_started' },
      publishing_phase: r.finished ? { status: 'complete', publish_status: r.state.toLowerCase() } : { status: 'not_started' },
    }
  }

  async function handle(req, res) {
    const u = new URL(req.url, 'http://127.0.0.1')
    const p = u.pathname
    state.requests.push({ method: req.method, path: p, auth: (req.headers.authorization || '').split(' ')[0] })
    const known = [pageToken, ...state.access.keys(), ...state.refresh]
    if (known.some((t) => req.url.includes(t) || req.url.includes(encodeURIComponent(t))) || /access_token=/.test(req.url)) leaks.push(req.url)

    // ---------------- Google OAuth
    if (p === '/google/auth' && req.method === 'GET') {
      const q = u.searchParams
      if (q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge')) return json(res, 400, { error: 'invalid_request' })
      const code = `4/fake-${rid()}`
      state.codes.set(code, { challenge: q.get('code_challenge'), redirectUri: q.get('redirect_uri'), scope: q.get('scope') })
      const back = new URL(q.get('redirect_uri'))
      back.searchParams.set('code', code)
      back.searchParams.set('state', q.get('state'))
      res.writeHead(302, { Location: back.toString() }); return res.end()
    }
    if (p === '/google/token' && req.method === 'POST') {
      const f = new URLSearchParams((await readBody(req)).toString())
      state.tokenCalls++
      if (f.get('grant_type') === 'authorization_code') {
        const c = state.codes.get(f.get('code'))
        state.codes.delete(f.get('code'))
        if (!c) return json(res, 400, { error: 'invalid_grant', error_description: 'Bad code' })
        const challenge = b64url(crypto.createHash('sha256').update(f.get('code_verifier') || '').digest())
        if (challenge !== c.challenge) return json(res, 400, { error: 'invalid_grant', error_description: 'PKCE verification failed' })
        if (f.get('redirect_uri') !== c.redirectUri) return json(res, 400, { error: 'redirect_uri_mismatch' })
        const refresh = `1//fake-refresh-${rid()}`
        state.refresh.add(refresh)
        refreshScopes.set(refresh, c.scope)
        return json(res, 200, { access_token: issueAccess(c.scope), expires_in: accessTtlSec, refresh_token: refresh, scope: c.scope, token_type: 'Bearer' })
      }
      if (f.get('grant_type') === 'refresh_token') {
        state.refreshCalls++
        if (!state.refresh.has(f.get('refresh_token'))) return json(res, 400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })
        const scope = refreshScopes.get(f.get('refresh_token'))
        return json(res, 200, { access_token: issueAccess(scope), expires_in: accessTtlSec, scope, token_type: 'Bearer' })
      }
      return json(res, 400, { error: 'unsupported_grant_type' })
    }

    // ---------------- YouTube
    if (p.startsWith('/upload/youtube/v3/') || p.startsWith('/youtube/v3/')) {
      if (fail.ytExpireAccess) { fail.ytExpireAccess = false; for (const t of state.access.values()) t.expiresAt = 0 }
      const tok = googleAuthOk(req)
      if (!tok) { req.resume(); return gErr(res, 401, 'authError', 'Invalid Credentials') }

      if (p === '/upload/youtube/v3/videos' && req.method === 'POST' && u.searchParams.get('uploadType') === 'resumable') {
        const resource = JSON.parse((await readBody(req)).toString() || '{}')
        state.insertCalls++
        const size = Number(req.headers['x-upload-content-length'])
        if (!resource?.snippet?.title) return gErr(res, 400, 'invalidTitle', 'The request metadata specifies an invalid or empty video title.')
        const id = rid()
        state.sessions.set(id, { size, resource, data: [], received: 0, expired: false, video: null })
        return json(res, 200, {}, { Location: `${base}/upload/youtube/v3/videos?uploadType=resumable&upload_id=${id}` })
      }
      if (p === '/upload/youtube/v3/videos' && req.method === 'PUT') {
        const s = state.sessions.get(u.searchParams.get('upload_id') || '')
        if (!s || s.expired) { req.resume(); return gErr(res, 404, 'notFound', 'Upload session not found') }
        const range = String(req.headers['content-range'] || '')
        const answerIncomplete = () => { res.writeHead(308, s.received > 0 ? { Range: `bytes=0-${s.received - 1}` } : {}); res.end() }
        const statusQuery = /^bytes \*\/\d+$/.test(range)
        if (statusQuery) {
          await readBody(req)
          if (s.video) return json(res, 200, s.video)
          return answerIncomplete()
        }
        const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range)
        if (!m) { req.resume(); return gErr(res, 400, 'badRange', 'Bad Content-Range') }
        if (fail.ytExpireSession) { fail.ytExpireSession = false; s.expired = true; req.resume(); return gErr(res, 404, 'notFound', 'Upload session expired') }
        if (fail.yt5xx > 0) { fail.yt5xx--; req.resume(); return gErr(res, 503, 'backendError', 'Backend Error') }
        if (fail.yt429 > 0) { fail.yt429--; req.resume(); return json(res, 429, { error: { code: 429, message: 'Too Many Requests', errors: [{ reason: 'rateLimitExceeded' }] } }, { 'Retry-After': '0' }) }
        const start = Number(m[1])
        if (start !== s.received) { req.resume(); return answerIncomplete() }
        let cutAt = null
        if (fail.ytCutAt && s.received < s.size * fail.ytCutAt && Number(m[2]) + 1 > s.size * fail.ytCutAt) { cutAt = Math.floor(s.size * fail.ytCutAt); fail.ytCutAt = 0 }
        const whole = await receive(req, s, start, cutAt)
        if (!whole) return
        if (s.received >= s.size) {
          const vid = b64url(crypto.randomBytes(8)).slice(0, 11)
          s.video = { kind: 'youtube#video', id: vid, snippet: s.resource.snippet, status: s.resource.status, sha256: crypto.createHash('sha256').update(Buffer.concat(s.data)).digest('hex') }
          state.videos.push({ ...s.video, publishedAt: new Date().toISOString() })
          if (fail.ytDropFinal) { if (fail.ytDropFinal === 'expire') s.expired = true; fail.ytDropFinal = false; req.socket.destroy(); return }
          return json(res, 200, s.video)
        }
        return answerIncomplete()
      }
      if (p === '/youtube/v3/channels' && req.method === 'GET') {
        return json(res, 200, { items: [{ id: 'UCfakeChannel0000000000', snippet: { title: 'Test channel (fake)' }, contentDetails: { relatedPlaylists: { uploads: 'UUfakeUploads' } } }] })
      }
      if (p === '/youtube/v3/playlistItems' && req.method === 'GET') {
        const items = [...state.videos].reverse().map((v) => ({ snippet: { title: v.snippet.title, publishedAt: v.publishedAt, resourceId: { kind: 'youtube#video', videoId: v.id } } }))
        return json(res, 200, { items })
      }
      if (p === '/upload/youtube/v3/thumbnails/set' && req.method === 'POST') {
        const body = await readBody(req)
        const v = state.videos.find((x) => x.id === u.searchParams.get('videoId'))
        if (!v) return gErr(res, 404, 'videoNotFound', 'Video not found')
        state.thumbnails.push({ videoId: v.id, bytes: body.length, type: req.headers['content-type'] })
        return json(res, 200, { items: [{ default: { url: 'https://i.ytimg.invalid/fake.jpg' } }] })
      }
      if (p === '/upload/youtube/v3/captions' && req.method === 'POST') {
        const body = (await readBody(req)).toString('utf8')
        if (!/force-ssl/.test(tok.scope || '')) return gErr(res, 403, 'insufficientPermissions', 'Request had insufficient authentication scopes.')
        if (!/^multipart\/related; boundary=/.test(req.headers['content-type'] || '')) return gErr(res, 400, 'badContent', 'Expected multipart/related')
        const meta = JSON.parse(/\{"snippet".*\}/.exec(body)?.[0] || '{}')
        const srt = /application\/x-subrip[^\n]*\r\n\r\n([\s\S]*?)\r\n--/.exec(body)?.[1] || ''
        if (!state.videos.find((x) => x.id === meta?.snippet?.videoId)) return gErr(res, 404, 'videoNotFound', 'Video not found')
        state.captions.push({ videoId: meta.snippet.videoId, language: meta.snippet.language, srt })
        return json(res, 200, { id: `cap-${rid(4)}`, snippet: meta.snippet })
      }
      req.resume()
      return gErr(res, 404, 'notFound', `Fake YouTube has no ${req.method} ${p}`)
    }

    // ---------------- Facebook
    const graph = /^\/(graph|graph-video)\/v\d+\.\d+\/(.+)$/.exec(p)
    const rup = /^\/rupload\/video-upload\/v\d+\.\d+\/(\d+)$/.exec(p)
    if (graph || rup) {
      if (fail.fbTokenExpired) { req.resume(); return fbErr(res, 400, 190, 'Error validating access token: Session has expired.') }
      if (rup) {
        if (!fbAuthOk(req, ['OAuth'])) { req.resume(); return fbErr(res, 401, 190, 'Invalid OAuth access token.') }
        const r = state.reels.get(rup[1])
        if (!r) { req.resume(); return fbErr(res, 400, 100, 'Unknown video id') }
        const offset = Number(req.headers.offset)
        r.size = Number(req.headers.file_size)
        if (offset !== r.received) { req.resume(); return fbErr(res, 400, 100, `offset ${offset} does not match ${r.received}`) }
        let cutAt = null
        if (fail.fbCutAt && r.received < r.size * fail.fbCutAt) { cutAt = Math.floor(r.size * fail.fbCutAt); fail.fbCutAt = 0 }
        const whole = await receive(req, r, offset, cutAt)
        if (!whole) return
        return json(res, 200, { success: true })
      }
      const [, host, rest] = graph
      const parts = rest.split('/')
      const isPost = req.method === 'POST'
      if (isPost && fail.fb5xx > 0) { fail.fb5xx--; req.resume(); return fbErr(res, 500, 2, 'An unexpected error has occurred. Please retry your request later.', true) }

      // resumable upload sessions use "OAuth <token>"
      if (parts[0].startsWith('upload:')) {
        if (!fbAuthOk(req, ['OAuth'])) { req.resume(); return fbErr(res, 401, 190, 'Invalid OAuth access token.') }
        const s = state.uploads.get(parts[0])
        if (!s) { req.resume(); return fbErr(res, 400, 100, 'Unknown upload session') }
        if (!isPost) return json(res, 200, { id: parts[0], file_offset: s.received })
        const offset = Number(req.headers.file_offset)
        if (offset !== s.received) { req.resume(); return fbErr(res, 400, 100, 'file_offset mismatch') }
        let cutAt = null
        if (fail.fbCutAt && s.received < s.size * fail.fbCutAt) { cutAt = Math.floor(s.size * fail.fbCutAt); fail.fbCutAt = 0 }
        const whole = await receive(req, s, offset, cutAt)
        if (!whole) return
        if (s.received >= s.size) { s.h = `4:${b64url(crypto.randomBytes(12))}`; return json(res, 200, { h: s.h }) }
        return json(res, 200, { file_offset: s.received })
      }
      if (parts[0] === appId && parts[1] === 'uploads' && isPost) {
        if (!fbAuthOk(req, ['OAuth', 'Bearer'])) { req.resume(); return fbErr(res, 401, 190, 'Invalid OAuth access token.') }
        await readBody(req)
        const id = `upload:${b64url(crypto.randomBytes(9))}`
        state.uploads.set(id, { size: Number(u.searchParams.get('file_length')), name: u.searchParams.get('file_name'), data: [], received: 0, h: null })
        return json(res, 200, { id })
      }
      if (!fbAuthOk(req, ['Bearer', 'OAuth'])) { req.resume(); return fbErr(res, 401, 190, 'Invalid OAuth access token.') }
      const f = isPost ? new URLSearchParams((await readBody(req)).toString()) : null

      if (parts[0] === pageId && parts[1] === 'video_reels') {
        if (!isPost) return json(res, 200, { data: [...state.reels.values()].filter((r) => r.finished).map((r) => ({ id: r.id, description: r.description, created_time: r.created })) })
        const phase = f.get('upload_phase')
        if (phase === 'start') {
          const id = numId()
          state.reels.set(id, { id, size: 0, data: [], received: 0, finished: false, finishCount: 0, state: null, description: '', created: new Date().toISOString() })
          return json(res, 200, { video_id: id, upload_url: `https://rupload.facebook.com/video-upload/v26.0/${id}` })
        }
        if (phase === 'finish') {
          state.reelFinishCalls++
          const r = state.reels.get(f.get('video_id') || '')
          if (!r) return fbErr(res, 400, 100, 'Unknown video id')
          if (r.received < r.size || !r.size) return fbErr(res, 400, 100, 'The video has not finished uploading')
          const vs = f.get('video_state')
          if (!['PUBLISHED', 'SCHEDULED', 'DRAFT'].includes(vs)) return fbErr(res, 400, 100, 'Invalid video_state')
          if (vs === 'SCHEDULED') {
            const t = Number(f.get('scheduled_publish_time')) * 1000
            if (!(t - Date.now() >= 10 * 60_000 - 5000 && t - Date.now() <= 29 * 86400_000)) return fbErr(res, 400, 100, 'scheduled_publish_time must be 10 minutes to 29 days ahead')
          }
          r.finished = true
          r.finishCount++
          r.state = vs
          r.description = f.get('description') || ''
          if (fail.fbDropFinish) { fail.fbDropFinish = false; req.socket.destroy(); return }
          return json(res, 200, { success: true, post_id: `${pageId}_${r.id}` })
        }
        return fbErr(res, 400, 100, 'Unknown upload_phase')
      }
      if (parts[0] === pageId && parts[1] === 'videos') {
        if (!isPost) return json(res, 200, { data: state.feedVideos.map((v) => ({ id: v.id, title: v.title, description: v.description, created_time: v.created })) })
        if (host !== 'graph-video') return fbErr(res, 400, 100, 'Video uploads go to graph-video')
        const h = f.get('fbuploader_video_file_chunk')
        const s = [...state.uploads.values()].find((x) => x.h && x.h === h)
        if (!s) return fbErr(res, 400, 100, 'Unknown file handle')
        const v = { id: numId(), title: f.get('title') || '', description: f.get('description') || '', published: f.get('published') === 'true', scheduled: f.get('scheduled_publish_time'), created: new Date().toISOString() }
        state.feedVideos.push(v)
        if (fail.fbDropPublish) { fail.fbDropPublish = false; req.socket.destroy(); return }
        return json(res, 200, { id: v.id })
      }
      if (parts[0] === pageId && parts.length === 1 && !isPost) return json(res, 200, { id: pageId, name: 'Test Page (fake)' })
      if (parts[1] === 'comments' && isPost) {
        const c = { id: `${parts[0]}_${rid(4)}`, objectId: parts[0], message: f.get('message') || '' }
        state.comments.push(c)
        return json(res, 200, { id: c.id })
      }
      if (parts.length === 1 && !isPost && u.searchParams.get('fields') === 'status') {
        const r = state.reels.get(parts[0])
        if (r) return json(res, 200, { id: r.id, status: reelStatus(r) })
        const v = state.feedVideos.find((x) => x.id === parts[0])
        if (v) return json(res, 200, { id: v.id, status: { video_status: 'ready', uploading_phase: { status: 'complete' }, processing_phase: { status: 'complete' }, publishing_phase: { status: 'complete' } } })
        return fbErr(res, 400, 100, 'Unknown object')
      }
      return fbErr(res, 400, 100, `Fake Graph has no ${req.method} ${p}`)
    }
    req.resume()
    json(res, 404, { error: 'not found' })
  }
  const refreshScopes = new Map()

  const server = http.createServer((req, res) => { handle(req, res).catch((e) => { try { json(res, 500, { error: String(e) }) } catch { /* socket gone */ } }) })
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
  const close = () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()) })
  return { base, state, fail, leaks, pageId, pageToken, appId, close, server }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const fake = await startFakePlatforms({ port: Number(process.env.PORT) || 0 })
  console.log(`Fake YouTube + Facebook on ${fake.base}`)
  console.log(`  ESB_VIDEO_PUBLISH_DRYRUN=1 ESB_VIDEO_PUBLISH_FAKE_BASE=${fake.base}`)
  console.log(`  Page id ${fake.pageId}, app id ${fake.appId}; the fake Page token is in this file (FAKE_PAGE_TOKEN).`)
}
