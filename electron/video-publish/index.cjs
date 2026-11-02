// ESB Studio — Video publishing (Phase 7 backend), wired together for main.cjs. NOT connected to IPC yet: the
// Phase 7 session adds the handlers (proposed surface in docs/VIDEO_PRO_PROGRESS.md, "Phase 7 pre-build").
//
//   const vp = await createVideoPublishing({ dir: app.getPath('userData'), safeStorage, openExternal: shell.openExternal,
//     confirmApproval: (s) => nativeApproveDialog(s) })
//
// Endpoints come from resolveEndpoints(env): production by default; ESB_VIDEO_PUBLISH_DRYRUN=1 points everything at
// the local fake servers (ESB_VIDEO_PUBLISH_FAKE_BASE) and keeps its own credential, job, ledger and guard files.
'use strict'
const { createHttp } = require('./http.cjs')
const { createCredentialStore } = require('./credentials.cjs')
const { resolveEndpoints, originsOf } = require('./endpoints.cjs')
const yt = require('./youtube.cjs')
const { createFacebookClient } = require('./facebook.cjs')
const { createPublishEngine } = require('./engine.cjs')

async function createVideoPublishing({ dir, safeStorage, openExternal, confirmApproval, env = process.env, endpoints, fetchImpl, clock, sleep, config = {}, youtubeChunk, pollMs, onUpdate }) {
  const ep = endpoints || resolveEndpoints(env)
  const dryRun = !!ep.dryRun
  const credentials = createCredentialStore({ dir, safeStorage, dryRun, clock })
  const httpClient = createHttp({ fetchImpl, allowOrigins: originsOf(ep), redact: credentials.redact })
  const tokens = yt.createGoogleTokens({ httpClient, endpoints: ep.youtube, credentials, clock })
  const youtube = yt.createYouTubeClient({ httpClient, endpoints: ep.youtube, tokens, sleep, chunkSize: youtubeChunk })
  const facebook = createFacebookClient({ httpClient, endpoints: ep.facebook, page: () => credentials.facebook(), sleep, pollMs })
  const validators = await import('./validators.mjs')
  const engine = createPublishEngine({ dir, credentials, youtube, facebook, validators, confirmApproval, clock, config, dryRun, onUpdate })

  /** Connect YouTube: the saved client, the browser consent, tokens saved encrypted. Returns status only. */
  async function connectYouTube({ captions = false } = {}) {
    const client = credentials.youtubeClient()
    if (!client?.clientId) throw new Error('Save the Google OAuth client ID first (Settings → YouTube).')
    if (!credentials.status().encryption) throw new Error('This computer cannot encrypt the YouTube tokens, so YouTube cannot be connected.')
    const scopes = [yt.SCOPE_UPLOAD, ...(captions ? [yt.SCOPE_FORCE_SSL] : [])]
    const t = await yt.authorize({ httpClient, endpoints: ep.youtube, clientId: client.clientId, clientSecret: client.clientSecret, scopes, openExternal, clock })
    credentials.saveYouTubeTokens(t)
    let channelTitle = null
    try { channelTitle = (await youtube.channel())?.title ?? null } catch { /* status still says connected */ }
    return credentials.saveYouTubeTokens(credentials.youtubeTokens(), { channelTitle })
  }

  return { endpoints: ep, dryRun, credentials, youtube, facebook, engine, validators, connectYouTube }
}

module.exports = { createVideoPublishing }
