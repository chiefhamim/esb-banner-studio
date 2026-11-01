// Video Desk Pro, Phase 7 backend (electron/video-publish/*): validators, credential store, guards, the YouTube and
// Facebook clients and the publish engine, all against the LOCAL fake servers in tools/fixtures/publish/. Nothing
// here may reach graph.facebook.com, rupload.facebook.com, googleapis.com or accounts.google.com: every client gets
// fake endpoints, and the http layer refuses any other origin.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import * as V from '../../electron/video-publish/validators.mjs'
import { startFakePlatforms, FAKE_PAGE_ID, FAKE_PAGE_TOKEN, FAKE_APP_ID } from '../fixtures/publish/fake-platforms.mjs'

const require = createRequire(import.meta.url)
const { createVideoPublishing } = require('../../electron/video-publish/index.cjs')
const { createCredentialStore } = require('../../electron/video-publish/credentials.cjs')
const { createHttp } = require('../../electron/video-publish/http.cjs')
const { createDailyQuota, createMovingWindow } = require('../../electron/video-publish/guards.cjs')
const ep = require('../../electron/video-publish/endpoints.cjs')
const yt = require('../../electron/video-publish/youtube.cjs')

/** A stand-in for Electron's safeStorage: reversible, but the plain text never appears in the file. */
const fakeSafe = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (s: string) => Buffer.from(Buffer.from(s, 'utf8').map((b) => b ^ 0x5a)),
  decryptString: (b: Buffer) => Buffer.from(b.map((x) => x ^ 0x5a)).toString('utf8'),
})

const GOOD_REEL = { durationSec: 30, width: 1080, height: 1920, fps: 30, fpsMode: 'constant', videoCodec: 'avc', gopSec: 2, closedGop: true, audioCodec: 'aac', audioProfile: 'LC', audioSampleRate: 48000, audioChannels: 2, audioBitrate: 192000 }
const CLIENT_ID = '123456789-fakeclient.apps.googleusercontent.com'
const instant = () => Promise.resolve()

let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-vpub-')) })

// --------------------------------------------------------------------------------------------- validators
describe('platform validators (pure, shared with the renderer)', () => {
  it('accepts a correct Reel', () => {
    const r = V.validateReel(GOOD_REEL)
    expect(r.problems).toEqual([])
    expect(r.ok).toBe(true)
  })
  it('rejects a 95 s Reel with a reason an editor can act on', () => {
    const r = V.validateReel({ ...GOOD_REEL, durationSec: 95 })
    expect(r.ok).toBe(false)
    expect(r.problems.map((p) => p.code)).toContain('too-long')
    expect(r.problems.find((p) => p.code === 'too-long')!.message).toMatch(/at most 90 s.*1 min 35 s/)
  })
  it('rejects a variable-frame-rate file (30 fps nominal)', () => {
    expect(V.validateReel({ ...GOOD_REEL, fpsMode: 'variable' }).problems.map((p) => p.code)).toContain('variable-fps')
    expect(V.validateReel({ ...GOOD_REEL, fpsMode: undefined, fpsMin: 24.2, fpsMax: 30 }).problems.map((p) => p.code)).toContain('variable-fps')
  })
  it.each([
    ['landscape', { width: 1920, height: 1080 }, 'aspect'],
    ['too small', { width: 360, height: 640 }, 'too-small'],
    ['2 s', { durationSec: 2 }, 'too-short'],
    ['VP9', { videoCodec: 'vp9' }, 'codec'],
    ['open GOP', { closedGop: false }, 'open-gop'],
    ['GOP 10 s', { gopSec: 10 }, 'gop'],
    ['Opus sound', { audioCodec: 'opus' }, 'audio-codec'],
    ['44.1 kHz', { audioSampleRate: 44100 }, 'audio-rate'],
    ['mono', { audioChannels: 1 }, 'audio-channels'],
    ['96 kbps', { audioBitrate: 96000 }, 'audio-bitrate'],
    ['20 fps', { fps: 20 }, 'fps'],
  ])('rejects a Reel that is %s', (_n, over, code) => {
    expect(V.validateReel({ ...GOOD_REEL, ...over }).problems.map((p) => p.code)).toContain(code)
  })
  it('never passes what it could not read: unknown facts are problems or warnings', () => {
    const r = V.validateReel({})
    expect(r.ok).toBe(false)
    expect(r.problems.map((p) => p.code)).toEqual(expect.arrayContaining(['size-unknown', 'fps-unknown', 'duration-unknown', 'codec-unknown']))
    expect(V.validateReel({ ...GOOD_REEL, gopSec: undefined, closedGop: undefined }).warnings.map((w) => w.code)).toContain('gop-unknown')
  })
  it('YouTube media basics, Shorts detection and the 15-minute note', () => {
    expect(V.validateYouTubeMedia({ ...GOOD_REEL }).short).toBe(true)
    expect(V.validateYouTubeMedia({ ...GOOD_REEL, width: 1920, height: 1080 }).short).toBe(false)
    expect(V.validateYouTubeMedia({ ...GOOD_REEL, durationSec: 20 * 60 }).warnings.map((w) => w.code)).toContain('needs-verified')
    expect(V.validateYouTubeMedia({ ...GOOD_REEL, durationSec: 13 * 3600 }).ok).toBe(false)
  })
  it('maps the YouTube snippet and status within the limits', () => {
    const r = V.buildYouTubeResource({ title: '  Grid  update ', description: 'Text', tags: ['power', 'grid line'], categoryId: '25', defaultLanguage: 'bn', privacyStatus: 'public' })
    expect(r.resource).toEqual({
      snippet: { title: 'Grid update', description: 'Text', tags: ['power', 'grid line'], categoryId: '25', defaultLanguage: 'bn', defaultAudioLanguage: 'bn' },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false, containsSyntheticMedia: false },
    })
    expect(V.buildYouTubeResource({ title: 'x'.repeat(101) }).problems.map((p) => p.code)).toContain('title-long')
    expect(V.buildYouTubeResource({ title: 'ok', description: 'ক'.repeat(1700) }).problems.map((p) => p.code)).toContain('description-long') // 5,100 bytes
    expect(V.buildYouTubeResource({ title: 'ok', description: 'ক'.repeat(1600) }).ok).toBe(true)
    expect(V.youtubeTagsLength(['a b', 'c'])).toBe(5 + 1 + 1)
    expect(V.buildYouTubeResource({ title: 'ok', tags: Array.from({ length: 60 }, (_, i) => `tag-number-${i}`) }).problems.map((p) => p.code)).toContain('tags-long')
    expect(V.buildYouTubeResource({ title: 'a <b>' }).problems.map((p) => p.code)).toContain('title-angle')
  })
  it('a scheduled YouTube video is private with publishAt; an AI voice is disclosed', () => {
    const now = Date.parse('2026-11-02T00:00:00Z')
    const r = V.buildYouTubeResource({ title: 'ok', privacyStatus: 'public', publishAt: '2026-11-03T10:00:00Z' }, now)
    expect(r.resource!.status).toMatchObject({ privacyStatus: 'private', publishAt: '2026-11-03T10:00:00.000Z' })
    expect(V.buildYouTubeResource({ title: 'ok', publishAt: '2026-11-01T10:00:00Z' }, now).problems.map((p) => p.code)).toContain('publish-at-past')
    expect(V.buildYouTubeResource({ title: 'ok', description: 'No note', aiVoice: true }).problems.map((p) => p.code)).toContain('ai-voice-note')
    expect(V.buildYouTubeResource({ title: 'ok', description: 'Narration: AI voice.', aiVoice: true }).resource!.status.containsSyntheticMedia).toBe(true)
  })
  it('Facebook schedule window is 10 minutes to 29 days ahead', () => {
    const now = Date.parse('2026-11-02T00:00:00Z')
    const at = (ms: number) => new Date(now + ms).toISOString()
    expect(V.checkFacebookPost({ state: 'SCHEDULED', scheduledAt: at(5 * 60_000) }, now).problems[0].code).toBe('schedule-soon')
    expect(V.checkFacebookPost({ state: 'SCHEDULED', scheduledAt: at(30 * 86400_000) }, now).problems[0].code).toBe('schedule-far')
    const ok = V.checkFacebookPost({ state: 'SCHEDULED', scheduledAt: at(3600_000) }, now)
    expect(ok.ok).toBe(true)
    expect(ok.scheduledTime).toBe(Math.floor((now + 3600_000) / 1000))
    expect(V.checkFacebookPost({ state: 'LIVE' as never }, now).ok).toBe(false)
  })
})

// --------------------------------------------------------------------------------------------- credentials
describe('credential store', () => {
  it('refuses to save when the OS cannot encrypt', () => {
    const c = createCredentialStore({ dir, safeStorage: fakeSafe(false) })
    expect(() => c.saveFacebook({ pageId: FAKE_PAGE_ID, token: FAKE_PAGE_TOKEN })).toThrow(/cannot encrypt/)
    expect(() => c.saveYouTubeTokens({ refreshToken: '1//refresh-token-123' })).toThrow(/cannot encrypt/)
    expect(c.status().encryption).toBe(false)
  })
  it('keeps secrets encrypted on disk and never in status()', () => {
    const c = createCredentialStore({ dir, safeStorage: fakeSafe() })
    c.saveYouTubeClient({ clientId: CLIENT_ID, clientSecret: 'GOCSPX-fake-secret' })
    c.saveYouTubeTokens({ refreshToken: '1//refresh-token-abcdef', accessToken: 'ya29.access-token-abcdef', expiresAt: 1, scope: yt.SCOPE_UPLOAD })
    c.saveFacebook({ pageId: FAKE_PAGE_ID, token: FAKE_PAGE_TOKEN, pageName: 'Page' })
    const raw = fs.readFileSync(c.file, 'utf8')
    for (const s of ['1//refresh-token-abcdef', 'ya29.access-token-abcdef', FAKE_PAGE_TOKEN, 'GOCSPX-fake-secret']) expect(raw).not.toContain(s)
    const st = JSON.stringify(c.status())
    for (const s of ['refresh-token', 'access-token', FAKE_PAGE_TOKEN, 'GOCSPX']) expect(st).not.toContain(s)
    expect(c.status()).toMatchObject({ youtube: { connected: true, clientSaved: true }, facebook: { connected: true, pageId: FAKE_PAGE_ID } })
    expect(c.redact(`oops ${FAKE_PAGE_TOKEN} and 1//refresh-token-abcdef`)).toBe('oops [secret] and [secret]')
    expect(c.forget('facebook').facebook.connected).toBe(false)
  })
  it('a dry run keeps its own file', () => {
    expect(createCredentialStore({ dir, safeStorage: fakeSafe(), dryRun: true }).file).toMatch(/dryrun/)
  })
  it('rejects malformed ids and tokens', () => {
    const c = createCredentialStore({ dir, safeStorage: fakeSafe() })
    expect(() => c.saveFacebook({ pageId: 'abc', token: FAKE_PAGE_TOKEN })).toThrow(/Page ID/)
    expect(() => c.saveFacebook({ pageId: FAKE_PAGE_ID, token: 'short' })).toThrow(/Page token/)
    expect(() => c.saveYouTubeClient({ clientId: 'not-a-client' })).toThrow(/client ID/)
  })
})

// --------------------------------------------------------------------------------------------- endpoints + http
describe('endpoints and the http door', () => {
  it('a dry run never falls back to the real platforms', () => {
    expect(() => ep.resolveEndpoints({ ESB_VIDEO_PUBLISH_DRYRUN: '1' })).toThrow(/FAKE_BASE/)
    expect(() => ep.resolveEndpoints({ ESB_VIDEO_PUBLISH_DRYRUN: '1', ESB_VIDEO_PUBLISH_FAKE_BASE: 'https://graph.facebook.com' })).toThrow(/FAKE_BASE/)
    const d = ep.resolveEndpoints({ ESB_VIDEO_PUBLISH_DRYRUN: '1', ESB_VIDEO_PUBLISH_FAKE_BASE: 'http://127.0.0.1:5555' })
    expect(d.dryRun).toBe(true)
    expect(ep.originsOf(d)).toEqual(Array(7).fill('http://127.0.0.1:5555'))
    const prod = ep.resolveEndpoints({})
    expect(prod.facebook.rupload).toBe('https://rupload.facebook.com/video-upload/v26.0')
    expect(prod.youtube.upload).toBe('https://www.googleapis.com/upload/youtube/v3')
  })
  it('refuses other origins and any token in a URL, before sending', async () => {
    let calls = 0
    const h = createHttp({ allowOrigins: ['http://127.0.0.1:1'], fetchImpl: (async () => { calls++; return new Response('{}') }) as typeof fetch })
    await expect(h.request('https://graph.facebook.com/v26.0/me')).rejects.toThrow(/not one of the publishing endpoints/)
    await expect(h.request('http://127.0.0.1:1/x?access_token=abc')).rejects.toThrow(/never travel in a URL/)
    await expect(h.request(`http://127.0.0.1:1/x/${FAKE_PAGE_TOKEN}`, { auth: { scheme: 'Bearer', token: FAKE_PAGE_TOKEN } })).rejects.toThrow(/never travel in a URL/)
    expect(calls).toBe(0)
  })
})

// --------------------------------------------------------------------------------------------- guards
describe('rate guards (persisted)', () => {
  it('YouTube daily uploads reset at Pacific midnight', () => {
    let t = Date.parse('2026-11-02T07:30:00Z') // 23:30 PST on 1 Nov... (PDT ends 1 Nov) -> 2026-11-01 local
    const f = path.join(dir, 'q.json')
    const q = createDailyQuota({ file: f, limit: 2, clock: () => t })
    q.record(); q.record()
    expect(() => q.check()).toThrow(/daily limit of 2/)
    expect(createDailyQuota({ file: f, limit: 2, clock: () => t }).used()).toBe(2) // survives a restart
    t += 60 * 60_000 // past midnight Pacific
    expect(q.used()).toBe(0)
    expect(() => q.check()).not.toThrow()
  })
  it('30 Reels per Page in a moving 24 h window', () => {
    let t = 1_000_000_000_000
    const f = path.join(dir, 'r.json')
    const w = createMovingWindow({ file: f, limit: 30, clock: () => t })
    for (let i = 0; i < 30; i++) { w.record('p1'); t += 60_000 }
    expect(() => w.check('p1')).toThrow(/30 have gone out/)
    expect(() => w.check('p2')).not.toThrow()
    t += 24 * 3600_000 - 30 * 60_000 + 1 // the first one leaves the window
    expect(w.used('p1')).toBe(29)
    expect(() => w.check('p1')).not.toThrow()
  })
})

// --------------------------------------------------------------------------------------------- end to end on the fakes
type Fake = Awaited<ReturnType<typeof startFakePlatforms>>
let fake: Fake
afterEach(async () => { await fake?.close() })

async function setup(opts: { config?: Record<string, unknown>; captions?: boolean; confirm?: (s: unknown) => Promise<boolean>; onUpdate?: (j: any) => void } = {}) {
  fake = await startFakePlatforms()
  const confirms: unknown[] = []
  const vp = await createVideoPublishing({
    dir, safeStorage: fakeSafe(), endpoints: ep.fakeEndpoints(fake.base), sleep: instant, youtubeChunk: yt.CHUNK_UNIT,
    openExternal: async (url: string) => { await fetch(url) },
    confirmApproval: opts.confirm ?? (async (s: unknown) => { confirms.push(s); return true }),
    config: { metaAppId: FAKE_APP_ID, ...opts.config },
  })
  vp.credentials.saveYouTubeClient({ clientId: CLIENT_ID, clientSecret: 'GOCSPX-fake-secret' })
  await vp.connectYouTube({ captions: !!opts.captions })
  vp.credentials.saveFacebook({ pageId: FAKE_PAGE_ID, token: FAKE_PAGE_TOKEN, pageName: 'Test Page' })
  return { vp, confirms }
}

function render(name = 'render.mp4', size = 2 * 1024 * 1024 + 12_345) {
  const f = path.join(dir, name)
  fs.writeFileSync(f, crypto.randomBytes(size))
  return f
}
const sha = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
const req = (renderPath: string, over: Record<string, any> = {}) => ({
  renderPath,
  metadata: { title: 'Grid test video', description: 'A test upload.', tags: ['test'], categoryId: '25', defaultLanguage: 'en', link: 'https://esbpowerline.com/articles/test', ...over.metadata },
  destinations: over.destinations ?? [{ kind: 'youtube', privacyStatus: 'private' }],
  schedule: over.schedule ?? { at: null },
  facts: over.facts ?? GOOD_REEL,
})
async function approveAndRun(vp: any, r: any) {
  const a = await vp.engine.approve(r)
  expect(a.ok).toBe(true)
  const job = await vp.engine.submit({ ...r, approvalToken: a.approvalToken })
  return vp.engine.run(job.id)
}

describe('YouTube OAuth (loopback + PKCE) against the fake', () => {
  it('connects, stores tokens encrypted, refreshes an expired access token', async () => {
    const { vp } = await setup()
    expect(vp.credentials.status().youtube).toMatchObject({ connected: true, channelTitle: 'Test channel (fake)', scopes: [yt.SCOPE_UPLOAD] })
    expect(fake.state.tokenCalls).toBe(1)
    fake.fail.ytExpireAccess = true
    expect((await vp.youtube.channel())?.title).toBe('Test channel (fake)')
    expect(fake.state.refreshCalls).toBe(1)
    expect(fake.leaks).toEqual([])
  })
  it('PKCE: a wrong verifier is refused by the server', async () => {
    fake = await startFakePlatforms()
    const p = yt.pkcePair()
    const u = new URL(yt.buildAuthUrl({ authUrl: `${fake.base}/google/auth`, clientId: CLIENT_ID, redirectUri: 'http://127.0.0.1:9/', challenge: p.challenge, state: 's', scopes: [yt.SCOPE_UPLOAD] }))
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(p.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const code = new URL((await fetch(u, { redirect: 'manual' })).headers.get('location')!).searchParams.get('code')!
    const r = await fetch(`${fake.base}/google/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: 'wrong'.padEnd(43, 'x'), redirect_uri: 'http://127.0.0.1:9/' }) })
    expect((await r.json()).error_description).toMatch(/PKCE/)
  })
})

describe('the Approve gate cannot be bypassed', () => {
  it('refuses a job without a token, with a forged or reused token, or with changed metadata or render', async () => {
    const { vp, confirms } = await setup()
    const f = render()
    const r = req(f)
    await expect(vp.engine.submit(r)).rejects.toThrow(/not been approved/)
    await expect(vp.engine.submit({ ...r, approvalToken: 'f'.repeat(64) })).rejects.toThrow(/not been approved/)
    const a = await vp.engine.approve(r)
    expect(confirms).toHaveLength(1)
    expect(a.renderHash).toBe(sha(f))
    await expect(vp.engine.submit({ ...req(f, { metadata: { title: 'Another title' } }), approvalToken: a.approvalToken })).rejects.toThrow(/changed after it was approved/)
    await expect(vp.engine.submit({ ...r, approvalToken: a.approvalToken })).rejects.toThrow(/not been approved/) // single use
    const b = await vp.engine.approve(r)
    fs.appendFileSync(f, 'x')
    await expect(vp.engine.submit({ ...r, approvalToken: b.approvalToken })).rejects.toThrow(/render changed/)
    const c = await vp.engine.approve({ ...r, renderHash: 'deadbeef' }).catch((e: Error) => e)
    expect(String(c)).toMatch(/not the one shown/)
    expect(fake.state.insertCalls).toBe(0)
  })
  it('no token when the owner does not confirm, or when a validator fails', async () => {
    const { vp } = await setup({ confirm: async () => false })
    const f = render()
    expect(await vp.engine.approve(req(f))).toEqual({ ok: false, cancelled: true })
    const bad = await vp.engine.approve(req(f, { destinations: [{ kind: 'facebook_reel', state: 'DRAFT' }], facts: { ...GOOD_REEL, durationSec: 95 } }))
    expect(bad.ok).toBe(false)
    expect(bad.problems.map((p: any) => p.code)).toContain('too-long')
    expect(bad.approvalToken).toBeUndefined()
  })
  it('a render swapped after the job was created is refused when it runs; nothing is sent', async () => {
    const { vp } = await setup()
    const f = render()
    const a = await vp.engine.approve(req(f))
    const job = await vp.engine.submit({ ...req(f), approvalToken: a.approvalToken })
    fs.writeFileSync(f, crypto.randomBytes(1000))
    const done = await vp.engine.run(job.id)
    expect(done.status).toBe('failed')
    expect(done.destinations[0].error).toMatch(/changed or is missing/)
    expect(fake.state.insertCalls).toBe(0)
  })
})

describe('YouTube resumable upload', () => {
  it('resumes after a cut at 50 % in the same session; the bytes are exact', async () => {
    const { vp } = await setup()
    const f = render()
    fake.fail.ytCutAt = 0.5
    const done = await approveAndRun(vp, req(f))
    expect(done.status).toBe('done')
    expect(fake.state.insertCalls).toBe(1)
    expect(fake.state.videos).toHaveLength(1)
    expect((fake.state.videos[0] as any).sha256).toBe(sha(f))
    expect(done.destinations[0].result.url).toBe(`https://youtu.be/${fake.state.videos[0].id}`)
    expect(fake.leaks).toEqual([])
    expect(vp.engine.ledger()[done.destinations[0].uploadKey]).toMatchObject({ kind: 'youtube', videoId: fake.state.videos[0].id })
  })
  it('backs off through 503 and 429 and refreshes an access token that expires mid-upload', async () => {
    const { vp } = await setup()
    const f = render()
    fake.fail.yt5xx = 2
    fake.fail.yt429 = 1
    fake.fail.ytExpireAccess = true
    const done = await approveAndRun(vp, req(f))
    expect(done.status).toBe('done')
    expect(fake.state.refreshCalls).toBeGreaterThanOrEqual(1)
    expect((fake.state.videos[0] as any).sha256).toBe(sha(f))
    expect(fake.state.insertCalls).toBe(1)
  })
  it('a lost final answer does not post twice (the session says it is complete)', async () => {
    const { vp } = await setup()
    fake.fail.ytDropFinal = true
    const done = await approveAndRun(vp, req(render()))
    expect(done.status).toBe('done')
    expect(fake.state.insertCalls).toBe(1)
    expect(fake.state.videos).toHaveLength(1)
  })
  it('an expired session after bytes landed: a new session only after checking the uploads', async () => {
    const { vp } = await setup()
    fake.fail.ytCutAt = 0.5
    fake.fail.ytExpireSession = true // the resume after the cut finds the session gone
    const done = await approveAndRun(vp, req(render()))
    expect(done.status).toBe('done')
    expect(fake.state.insertCalls).toBe(2)
    expect(fake.state.videos).toHaveLength(1)
    expect(fake.state.requests.some((r) => r.path === '/youtube/v3/playlistItems')).toBe(true)
  })
  it('the video landed but the session is gone: found by title, not uploaded again', async () => {
    const { vp } = await setup()
    const f = render()
    const a = await vp.engine.approve(req(f))
    const job = await vp.engine.submit({ ...req(f), approvalToken: a.approvalToken })
    fake.fail.ytDropFinal = 'expire'
    const done = await vp.engine.run(job.id)
    expect(done.status).toBe('done')
    expect(fake.state.insertCalls).toBe(1)
    expect(fake.state.videos).toHaveLength(1)
    expect(done.destinations[0].result.videoId).toBe(fake.state.videos[0].id)
  })
  it('state survives a restart: a stopped upload resumes in a new engine without a second session', async () => {
    fake = await startFakePlatforms()
    const make = () => createVideoPublishing({
      dir, safeStorage: fakeSafe(), endpoints: ep.fakeEndpoints(fake.base), sleep: instant, youtubeChunk: yt.CHUNK_UNIT,
      openExternal: async (url: string) => { await fetch(url) }, confirmApproval: async () => true,
    })
    let stopped = false
    const first = await make()
    first.credentials.saveYouTubeClient({ clientId: CLIENT_ID, clientSecret: 'GOCSPX-fake-secret' })
    await first.connectYouTube()
    const f = render()
    const a = await first.engine.approve(req(f))
    const job = await first.engine.submit({ ...req(f), approvalToken: a.approvalToken })
    const running = first.engine.run(job.id)
    // stop once half the file is on the server ("the app quits")
    await new Promise<void>((resolve) => { const iv = setInterval(() => { const s = [...fake.state.sessions.values()][0] as any; if (s && s.received >= s.size / 2 && !stopped) { stopped = true; clearInterval(iv); void first.engine.stopAll(); resolve() } }, 1) })
    const paused = await running
    expect(paused.status).toBe('paused')
    const s = [...fake.state.sessions.values()][0] as any
    expect(s.received).toBeLessThan(s.size)
    const second = await make()
    const [resumed] = await Promise.all(second.engine.resumeAll())
    expect(resumed.status).toBe('done')
    expect(fake.state.insertCalls).toBe(1)
    expect((fake.state.videos[0] as any).sha256).toBe(sha(f))
  })
  it('sets the thumbnail and uploads the reviewed captions', async () => {
    const { vp } = await setup({ captions: true })
    const thumb = path.join(dir, 'yt.png')
    fs.writeFileSync(thumb, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(500)]))
    const srt = '1\n00:00:00,000 --> 00:00:02,000\nTest line\n'
    const done = await approveAndRun(vp, req(render(), { metadata: { thumbnailPath: thumb, captionsSrt: srt, captionLanguage: 'en', aiVoice: true, description: 'Narrated with an AI voice.' } }))
    expect(done.status).toBe('done')
    expect(fake.state.thumbnails[0]).toMatchObject({ videoId: fake.state.videos[0].id, type: 'image/png' })
    expect(fake.state.captions[0].srt).toBe(srt)
    expect(fake.state.videos[0].status).toMatchObject({ containsSyntheticMedia: true, selfDeclaredMadeForKids: false })
  })
  it('captions without the force-ssl scope: the video stays up, the step is red with the reason', async () => {
    const { vp } = await setup({ captions: false })
    const done = await approveAndRun(vp, req(render(), { metadata: { captionsSrt: '1\n00:00:00,000 --> 00:00:01,000\nx\n' } }))
    expect(done.status).toBe('failed')
    expect(done.destinations[0].result.videoId).toBeTruthy()
    expect(done.destinations[0].steps.find((s: any) => s.name === 'captions')).toMatchObject({ status: 'failed' })
    expect(done.destinations[0].error).toMatch(/force-ssl/)
    // a retry does not upload the video again
    await vp.engine.retry(done.id)
    expect(fake.state.insertCalls).toBe(1)
  })
  it('the daily upload guard stops the next upload before YouTube is called', async () => {
    const { vp } = await setup({ config: { ytDailyUploads: 1 } })
    expect((await approveAndRun(vp, req(render('a.mp4')))).status).toBe('done')
    const second = await approveAndRun(vp, req(render('b.mp4'), { metadata: { title: 'Second' } }))
    expect(second.status).toBe('failed')
    expect(second.destinations[0].error).toMatch(/daily limit of 1/)
    expect(fake.state.insertCalls).toBe(1)
  })
})

describe('Facebook Reels and feed video', () => {
  const reel = (f: string, over: Record<string, any> = {}) => req(f, { destinations: [{ kind: 'facebook_reel', state: 'PUBLISHED' }], ...over })

  it('Reel: start → rupload (resumes after a cut at 50 %) → status → finish → link comment', async () => {
    const { vp } = await setup()
    const f = render()
    fake.fail.fbCutAt = 0.5
    const done = await approveAndRun(vp, reel(f))
    expect(done.status).toBe('done')
    const r = [...fake.state.reels.values()][0] as any
    expect(fake.state.reels.size).toBe(1)
    expect(crypto.createHash('sha256').update(Buffer.concat(r.data)).digest('hex')).toBe(sha(f))
    expect(r).toMatchObject({ finishCount: 1, state: 'PUBLISHED', description: 'A test upload.' })
    expect(fake.state.comments[0].message).toBe('Full story: https://esbpowerline.com/articles/test')
    expect(fake.state.requests.filter((x) => x.path.startsWith('/rupload/')).every((x) => x.auth === 'OAuth')).toBe(true)
    expect(fake.leaks).toEqual([])
    expect(vp.engine.status().reels24h).toBe(1)
  })
  it('Reel: a lost finish answer is checked, not finished twice', async () => {
    const { vp } = await setup()
    fake.fail.fbDropFinish = true
    const done = await approveAndRun(vp, reel(render()))
    expect(done.status).toBe('done')
    expect((([...fake.state.reels.values()][0]) as any).finishCount).toBe(1)
  })
  it('Reel: transient 500s are retried; a scheduled Reel waits for its link comment', async () => {
    const { vp } = await setup()
    fake.fail.fb5xx = 2
    const at = new Date(Date.now() + 3600_000).toISOString()
    const done = await approveAndRun(vp, reel(render(), { destinations: [{ kind: 'facebook_reel', state: 'SCHEDULED' }], schedule: { at } }))
    expect(done.status).toBe('done')
    expect((([...fake.state.reels.values()][0]) as any).state).toBe('SCHEDULED')
    expect(done.destinations[0].steps.find((s: any) => s.name === 'comment').status).toBe('waiting')
    expect(fake.state.comments).toHaveLength(0)
  })
  it('the 30-per-24 h guard (here 1) stops the next Reel before Facebook is called', async () => {
    const { vp } = await setup({ config: { reelsPer24h: 1 } })
    expect((await approveAndRun(vp, reel(render('a.mp4')))).status).toBe('done')
    const second = await approveAndRun(vp, reel(render('b.mp4'), { metadata: { title: 'Second' } }))
    expect(second.status).toBe('failed')
    expect(second.destinations[0].error).toMatch(/1 have gone out/)
    expect(fake.state.reels.size).toBe(1)
  })
  it('an expired Page token fails in plain words and never echoes the token', async () => {
    const { vp } = await setup()
    fake.fail.fbTokenExpired = true
    const done = await approveAndRun(vp, reel(render()))
    expect(done.status).toBe('failed')
    expect(done.destinations[0].error).toMatch(/expired or was revoked/)
    expect(JSON.stringify(vp.engine.list())).not.toContain(FAKE_PAGE_TOKEN)
  })
  it('feed video: resumable session (resumes after a cut at 50 %) → graph-video /videos → link comment', async () => {
    const { vp } = await setup()
    const f = render()
    fake.fail.fbCutAt = 0.5
    const done = await approveAndRun(vp, req(f, { destinations: [{ kind: 'facebook_video', state: 'PUBLISHED' }] }))
    expect(done.status).toBe('done')
    const up = [...fake.state.uploads.values()][0] as any
    expect(crypto.createHash('sha256').update(Buffer.concat(up.data)).digest('hex')).toBe(sha(f))
    expect(fake.state.feedVideos).toHaveLength(1)
    expect(fake.state.feedVideos[0]).toMatchObject({ title: 'Grid test video', published: true })
    expect(fake.state.comments[0].objectId).toBe(fake.state.feedVideos[0].id)
    expect(fake.leaks).toEqual([])
  })
  it('feed video: a lost publish answer is found on the Page, not posted twice', async () => {
    const { vp } = await setup()
    fake.fail.fbDropPublish = true
    const done = await approveAndRun(vp, req(render(), { destinations: [{ kind: 'facebook_video', state: 'DRAFT' }] }))
    expect(done.status).toBe('done')
    expect(fake.state.feedVideos).toHaveLength(1)
    expect(done.destinations[0].result.videoId).toBe(fake.state.feedVideos[0].id)
  })
  it('all three destinations in one approved job', async () => {
    const { vp } = await setup()
    const done = await approveAndRun(vp, req(render(), { destinations: [{ kind: 'youtube', privacyStatus: 'unlisted' }, { kind: 'facebook_reel', state: 'DRAFT' }, { kind: 'facebook_video', state: 'DRAFT' }] }))
    expect(done.destinations.map((d: any) => d.state)).toEqual(['done', 'done', 'done'])
    expect(fake.state.videos[0].status.privacyStatus).toBe('unlisted')
    expect(fake.state.feedVideos[0].published).toBe(false)
  })
})

describe('dry run wiring (ESB_VIDEO_PUBLISH_DRYRUN=1)', () => {
  it('runs the whole flow against the fake from the environment alone, with its own files', async () => {
    fake = await startFakePlatforms()
    const vp = await createVideoPublishing({
      dir, safeStorage: fakeSafe(), sleep: instant, youtubeChunk: yt.CHUNK_UNIT, env: { ESB_VIDEO_PUBLISH_DRYRUN: '1', ESB_VIDEO_PUBLISH_FAKE_BASE: fake.base },
      openExternal: async (url: string) => { await fetch(url) }, confirmApproval: async () => true, config: { metaAppId: FAKE_APP_ID },
    })
    expect(vp.dryRun).toBe(true)
    vp.credentials.saveYouTubeClient({ clientId: CLIENT_ID, clientSecret: 'x' })
    await vp.connectYouTube()
    vp.credentials.saveFacebook({ pageId: FAKE_PAGE_ID, token: FAKE_PAGE_TOKEN })
    fake.fail.ytCutAt = 0.5
    const done = await approveAndRun(vp, req(render(), { destinations: [{ kind: 'youtube', privacyStatus: 'private' }, { kind: 'facebook_reel', state: 'DRAFT' }] }))
    expect(done.status).toBe('done')
    expect(done.dryRun).toBe(true)
    expect(fs.readdirSync(dir).filter((n) => n.startsWith('video-publish-')).every((n) => n.includes('dryrun'))).toBe(true)
  })
})
