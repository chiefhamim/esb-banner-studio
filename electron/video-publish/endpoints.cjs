// ESB Studio — Video publishing: where requests go. Production defaults below are never reached by tests: every
// client takes its endpoints as an argument, and a dry run (ESB_VIDEO_PUBLISH_DRYRUN=1) points them all at the
// local fake servers (tools/fixtures/publish/fake-platforms.mjs) or refuses to start. A dry run never falls back to
// the real platforms.
'use strict'

const GRAPH_VERSION = 'v26.0'

const PRODUCTION = Object.freeze({
  youtube: Object.freeze({
    auth: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    api: 'https://www.googleapis.com/youtube/v3',
    upload: 'https://www.googleapis.com/upload/youtube/v3',
  }),
  facebook: Object.freeze({
    graph: `https://graph.facebook.com/${GRAPH_VERSION}`,
    graphVideo: `https://graph-video.facebook.com/${GRAPH_VERSION}`,
    rupload: `https://rupload.facebook.com/video-upload/${GRAPH_VERSION}`,
  }),
})

function fakeEndpoints(base) {
  const b = String(base).replace(/\/+$/, '')
  return {
    youtube: { auth: `${b}/google/auth`, token: `${b}/google/token`, api: `${b}/youtube/v3`, upload: `${b}/upload/youtube/v3` },
    facebook: { graph: `${b}/graph/${GRAPH_VERSION}`, graphVideo: `${b}/graph-video/${GRAPH_VERSION}`, rupload: `${b}/rupload/video-upload/${GRAPH_VERSION}` },
  }
}

const isLoopbackBase = (s) => /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d{2,5}\/?$/.test(String(s ?? ''))

function resolveEndpoints(env = process.env) {
  if (env.ESB_VIDEO_PUBLISH_DRYRUN === '1') {
    const base = env.ESB_VIDEO_PUBLISH_FAKE_BASE
    if (!isLoopbackBase(base)) throw new Error('Dry run needs ESB_VIDEO_PUBLISH_FAKE_BASE = the local fake platform server (http://127.0.0.1:<port>). Nothing is sent to YouTube or Facebook.')
    return { dryRun: true, ...fakeEndpoints(base) }
  }
  return { dryRun: false, youtube: { ...PRODUCTION.youtube }, facebook: { ...PRODUCTION.facebook } }
}

const originsOf = (ep) => [...Object.values(ep.youtube), ...Object.values(ep.facebook)].map((u) => new URL(u).origin)

module.exports = { PRODUCTION, GRAPH_VERSION, fakeEndpoints, resolveEndpoints, originsOf, isLoopbackBase }
