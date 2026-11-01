// ESB Studio — Video publishing: the credential store (main process only).
//
// Holds the YouTube OAuth client (id + secret of the owner's own Google Cloud "Desktop app" client), the YouTube
// tokens (refresh + access) and a copy of the Facebook Page token used for video publishing. Every secret is
// encrypted with Electron's safeStorage (DPAPI on Windows), like the Outreach app password (electron/mailer.cjs).
//
//   - Nothing secret is ever returned to the renderer: `status()` says only what is connected.
//   - The store refuses to save anything when the OS cannot encrypt.
//   - `redact(text)` removes every secret it holds from a text (error messages, logs) before it leaves main.
//   - A dry run (`ESB_VIDEO_PUBLISH_DRYRUN=1`) keeps its own file, so test tokens and real ones never mix and a
//     real token is never sent to the fake servers.
'use strict'
const fs = require('node:fs')
const path = require('node:path')

const PAGE_ID = /^\d{5,20}$/

function createCredentialStore({ dir, safeStorage, dryRun = false, clock = () => Date.now() }) {
  if (!safeStorage) throw new Error('createCredentialStore needs safeStorage')
  const file = path.join(dir, dryRun ? 'video-publish-secrets.dryrun.json' : 'video-publish-secrets.json')
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return {} } }
  const write = (v) => {
    fs.mkdirSync(dir, { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(v))
    fs.renameSync(tmp, file)
  }
  const canEncrypt = () => { try { return !!safeStorage.isEncryptionAvailable() } catch { return false } }
  const seal = (obj) => {
    if (!canEncrypt()) throw new Error('This computer cannot encrypt the publishing tokens, so they are not saved.')
    return safeStorage.encryptString(JSON.stringify(obj)).toString('base64')
  }
  const open = (b64) => {
    if (!b64) return null
    try { return JSON.parse(safeStorage.decryptString(Buffer.from(b64, 'base64'))) } catch { return null }
  }

  function status() {
    const s = read()
    const yt = open(s.youtube)
    const client = open(s.youtubeClient)
    const fb = open(s.facebook)
    return {
      encryption: canEncrypt(),
      youtube: {
        clientSaved: !!client?.clientId,
        connected: !!yt?.refreshToken,
        scopes: yt?.scope ? String(yt.scope).split(/\s+/).filter(Boolean) : [],
        connectedAt: s.meta?.youtubeAt ?? null,
        channelTitle: s.meta?.channelTitle ?? null,
      },
      facebook: {
        connected: !!fb?.token,
        pageId: fb?.pageId ?? null,
        pageName: s.meta?.pageName ?? null,
        connectedAt: s.meta?.facebookAt ?? null,
      },
    }
  }

  function saveYouTubeClient({ clientId, clientSecret }) {
    const id = String(clientId ?? '').trim()
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(id)) throw new Error('That is not a Google OAuth client ID (it ends in .apps.googleusercontent.com).')
    const secret = String(clientSecret ?? '').trim()
    if (secret.length > 200 || /\s/.test(secret)) throw new Error('That client secret is not valid.')
    const s = read()
    const prev = open(s.youtubeClient)
    s.youtubeClient = seal({ clientId: id, clientSecret: secret })
    // a different client cannot use the old tokens
    if (prev && prev.clientId !== id) { s.youtube = null; s.meta = { ...s.meta, youtubeAt: null, channelTitle: null } }
    write(s)
    return status()
  }
  const youtubeClient = () => open(read().youtubeClient)

  /** tokens: { refreshToken, accessToken, expiresAt, scope } */
  function saveYouTubeTokens(tokens, info = {}) {
    if (!tokens?.refreshToken) throw new Error('Google did not hand back a refresh token.')
    const s = read()
    s.youtube = seal({ refreshToken: tokens.refreshToken, accessToken: tokens.accessToken || '', expiresAt: Number(tokens.expiresAt) || 0, scope: tokens.scope || '' })
    s.meta = { ...s.meta, youtubeAt: clock(), channelTitle: info.channelTitle ?? s.meta?.channelTitle ?? null }
    write(s)
    return status()
  }
  const youtubeTokens = () => open(read().youtube)
  /** A refresh hands back a new access token (and sometimes a new refresh token). */
  function updateYouTubeAccess({ accessToken, expiresAt, refreshToken, scope }) {
    const s = read()
    const cur = open(s.youtube)
    if (!cur) throw new Error('YouTube is not connected.')
    s.youtube = seal({ ...cur, accessToken, expiresAt, refreshToken: refreshToken || cur.refreshToken, scope: scope || cur.scope })
    write(s)
  }

  /** The renderer passes the Page token once; it never comes back out. */
  function saveFacebook({ pageId, token, pageName }) {
    const id = String(pageId ?? '').trim()
    const tok = String(token ?? '').trim()
    if (!PAGE_ID.test(id)) throw new Error('That is not a Facebook Page ID.')
    if (tok.length < 20 || tok.length > 1000 || /\s/.test(tok)) throw new Error('That is not a Facebook Page token.')
    const s = read()
    s.facebook = seal({ pageId: id, token: tok })
    s.meta = { ...s.meta, facebookAt: clock(), pageName: typeof pageName === 'string' ? pageName.slice(0, 200) : null }
    write(s)
    return status()
  }
  const facebook = () => open(read().facebook)

  function forget(kind) {
    const s = read()
    if (kind === 'youtube') { s.youtube = null; s.meta = { ...s.meta, youtubeAt: null, channelTitle: null } }
    else if (kind === 'youtube-client') { s.youtubeClient = null; s.youtube = null; s.meta = { ...s.meta, youtubeAt: null, channelTitle: null } }
    else if (kind === 'facebook') { s.facebook = null; s.meta = { ...s.meta, facebookAt: null, pageName: null } }
    else throw new Error('Unknown connection')
    write(s)
    return status()
  }

  /** Remove every secret this store holds from a text. */
  function redact(text) {
    let out = String(text ?? '')
    const s = read()
    const yt = open(s.youtube)
    const client = open(s.youtubeClient)
    const fb = open(s.facebook)
    for (const secret of [yt?.refreshToken, yt?.accessToken, client?.clientSecret, fb?.token]) {
      if (secret && secret.length >= 8) out = out.split(secret).join('[secret]')
    }
    return out
  }

  return { status, saveYouTubeClient, youtubeClient, saveYouTubeTokens, youtubeTokens, updateYouTubeAccess, saveFacebook, facebook, forget, redact, file }
}

module.exports = { createCredentialStore }
