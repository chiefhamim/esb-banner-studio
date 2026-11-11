// ESB Mail Tracker in the app: the main process signs exactly like the Worker, letters are rewritten safely, the
// poller turns Worker rows into event-log events once each, and the renderer folds them without double counting.
import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
// the Worker's own Node copy, itself held equal to the Worker by cloud/tracker/test/token.test.ts
import * as worker from '../../cloud/tracker/scripts/lib/token.mjs'
import { classifyEvent, foldEvents, type EventRow } from '../../src/outreach/cloudMerge'
import { mergeEngagement } from '../../src/outreach/trackerFold'

const require = createRequire(import.meta.url)
const T = require('../../electron/outreach-tracking.cjs')
const { createTrackerPull, cleanRow } = require('../../electron/outreach-tracker-pull.cjs')

const S = 'unit-test-secret-0123456789abcdef0123456789abcdef'
const tracker = { base: 'https://trk.example.com', secret: S, token: 'api-token' }

describe('signing matches the Worker byte for byte', () => {
  it('tokens and link signatures', () => {
    for (let i = 0; i < 300; i++) {
      const key = T.newMessageKey()
      const at = 1_700_000_000_000 + i * 7_777_777
      const url = `https://esbpowerline.com/articles/a-${i}?q=${i}&b=%E0%A6%95`
      expect(T.makeTrackerToken(S, key, at)).toBe(worker.makeToken(S, key, at))
      expect(T.trackerLinkSig(S, key, url)).toBe(worker.linkSig(S, key, url))
      expect(T.trackerFileSig(S, key, `f-${i}-abcdefgh`)).toBe(worker.fileSig(S, key, `f-${i}-abcdefgh`))
    }
  })
})

describe('letters through the Worker', () => {
  const key = 'AAECAwQFBgcICQoLDA0ODw'
  const html = `<html><body><p><a href="https://esbpowerline.com/a?x=1&amp;y=2">story</a> <a href="mailto:desk@example.com">mail</a>
    <a href="http://plain.example.com">http</a> <a href='https://example.org/page'>other</a> <a href="https://u:p@evil.example/">creds</a> <a href="#top">top</a></p></body></html>`
  const out = T.trackHtml(html, { key, tracker, sentAt: 1_762_000_000_000 })
  const token = worker.makeToken(S, key, 1_762_000_000_000)

  it('rewrites every plain https link through /c with a signature for the exact URL', () => {
    const a = 'https://esbpowerline.com/a?x=1&y=2'
    expect(out).toContain(`href="https://trk.example.com/c/${token}?u=${encodeURIComponent(a)}&amp;s=${worker.linkSig(S, key, a)}"`)
    expect(out).toContain(`https://trk.example.com/c/${token}?u=${encodeURIComponent('https://example.org/page')}`)
  })
  it('leaves mailto, http, anchors and user:password links alone', () => {
    expect(out).toContain('href="mailto:desk@example.com"')
    expect(out).toContain('href="http://plain.example.com"')
    expect(out).toContain('href="#top"')
    expect(out).toContain('href="https://u:p@evil.example/"')
  })
  it('adds exactly one pixel, before </body>', () => {
    expect(out.match(/<img /g)).toHaveLength(1)
    expect(out).toMatch(new RegExp(`<img src="https://trk.example.com/o/${token}.gif"[^>]*></body>`))
  })
  it('the website mode is unchanged when no tracker is configured', () => {
    const site = T.trackHtml(html, { key, campaignId: 'c1' })
    expect(site).toContain('https://esbpowerline.com/r/' + key)
    expect(site).toContain('https://esbpowerline.com/api/o/' + key)
  })
})

describe('config', () => {
  it('reads the secrets file, refuses short secrets and non-https bases', () => {
    const read = (t: string) => T.loadTrackerConfig({ env: {}, home: '/h', readFile: () => t })
    expect(read(`TRACK_SECRET=${S}\nAPI_TOKEN=tok\n`)).toEqual({ base: T.DEFAULT_TRACKER_BASE, secret: S, token: 'tok' })
    expect(read(`TRACK_SECRET=short\nAPI_TOKEN=tok`)).toBeNull()
    expect(read(`TRACK_SECRET=${S}\nAPI_TOKEN=tok\nTRACK_BASE=http://x.example`)).toBeNull()
    expect(T.loadTrackerConfig({ env: {}, home: '/h', readFile: () => { throw new Error('no file') } })).toBeNull()
  })
})

describe('gate (Worker mode)', () => {
  const res = (status: number, body: unknown, location?: string) => ({ status, json: async () => body, headers: { get: (h: string) => (h === 'location' ? location ?? null : null) } })
  it('live when health is ok and a forged click goes home', async () => {
    const fetchFn = vi.fn(async (u: string) => (u.endsWith('/health') ? res(200, { ok: true }) : res(302, null, 'https://esbpowerline.com/')))
    const g = T.createTrackingGate({ fetchFn, env: {}, tracker })
    expect(await g.enabled()).toBe(true)
    expect(g.status()).toMatchObject({ host: 'trk.example.com', live: true })
  })
  it('off when the forged click would go anywhere else', async () => {
    const fetchFn = vi.fn(async (u: string) => (u.endsWith('/health') ? res(200, { ok: true }) : res(302, null, 'https://evil.example/')))
    expect(await T.createTrackingGate({ fetchFn, env: {}, tracker }).enabled()).toBe(false)
  })
  it('off when health is down', async () => {
    const fetchFn = vi.fn(async () => res(503, { ok: false }))
    expect(await T.createTrackingGate({ fetchFn, env: {}, tracker }).enabled()).toBe(false)
  })
})

describe('poller', () => {
  const key = 'AAECAwQFBgcICQoLDA0ODw'
  const late = 'BBECAwQFBgcICQoLDA0ODw'
  const row = (id: number, k = key, extra = {}) => ({ id, key: k, type: 'open', target: null, at: 1_762_000_000_000 + id, cls: 'human', client: 'Outlook', device: 'Windows', country: 'BD', city: 'Dhaka', as_org: 'GP', ...extra })

  it('appends each hit once, keeps unknown keys until their send row arrives, survives a restart', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trk-'))
    const ledger = [{ t: Date.now(), to: 'Reader@Example.com', kind: 'campaign', key, c: 'camp1' }]
    const appended: Record<string, unknown>[] = []
    let pages = [[row(1), row(2), row(3, late)], []]
    const fetchFn = vi.fn(async (u: string) => {
      const after = Number(new URL(u).searchParams.get('after'))
      const events = (pages.shift() ?? []).filter((r) => r.id > after)
      return { ok: true, status: 200, json: async () => ({ events, more: false }) }
    })
    const mk = () => createTrackerPull({ tracker, dir, fetchFn, ledger: () => ledger, append: (e: Record<string, unknown>) => appended.push(e) })
    const p = mk()
    expect(await p.poll({ force: true })).toBe(2)
    expect(appended[0]).toMatchObject({ id: 'trk-1', type: 'track.open', email: 'reader@example.com', campaignId: 'camp1', messageKey: key, client: 'Outlook', country: 'BD', hitId: 1 })
    expect(p.status()).toMatchObject({ cursor: 3, waiting: 1 })
    // the late letter's send row lands; a fresh poller (app restarted) delivers the waiting hit, and the same rows
    // served again are not appended twice
    ledger.push({ t: Date.now(), to: 'late@example.com', kind: 'test', key: late, c: 'camp1' })
    pages = [[row(1), row(2), row(3, late)]]
    const p2 = mk()
    expect(await p2.poll({ force: true })).toBe(1)
    expect(appended.map((e) => e.id)).toEqual(['trk-1', 'trk-2', 'trk-3'])
    expect(appended[2]).toMatchObject({ email: 'late@example.com', test: true })
  })

  it('rejects malformed rows', () => {
    expect(cleanRow({ id: 1, key: 'short', type: 'open', at: 1 })).toBeNull()
    expect(cleanRow({ id: -1, key, type: 'open', at: 1 })).toBeNull()
    expect(cleanRow({ id: 1, key, type: 'drop table', at: 1 })).toBeNull()
    expect(cleanRow({ id: 1, key, type: 'open', at: 1, cls: 'admin' })?.cls).toBe('human')
  })

  it('a refused token is reported, not thrown', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trk-'))
    const p = createTrackerPull({ tracker, dir, fetchFn: async () => ({ ok: false, status: 401, json: async () => ({}) }), ledger: () => [{ t: Date.now(), key, to: 'a@example.com' }], append: () => {} })
    expect(await p.poll({ force: true })).toBe(0)
    expect(p.status()).toMatchObject({ ok: false, why: 'tracker refused the API token' })
  })
})

describe('renderer fold with the tracker’s verdict', () => {
  const ev = (cls: string, why: string | null = null, type: 'open' | 'click' = 'open'): EventRow => ({ id: 1, message_key: 'k', type, link: null, at: new Date().toISOString(), ua: 'Mozilla/5.0', cls, why })
  it('trusts the tracker over the user-agent guess', () => {
    expect(classifyEvent(ev('human'))).toBe('human')
    expect(classifyEvent(ev('proxy', 'gmail-proxy'))).toBe('human') // Gmail fetches on open
    expect(classifyEvent(ev('proxy', 'microsoft-network'))).toBe('machine')
    expect(classifyEvent(ev('prefetch', 'apple-mpp-ua'))).toBe('machine')
    expect(classifyEvent(ev('scanner', 'asn:8075', 'click'))).toBe('ignore')
    expect(classifyEvent(ev('human'), undefined, true)).toBe('ignore') // bounced
  })
  it('folding the same hits twice counts each letter once; merge keeps both sources', () => {
    const keys = new Map([['k1', 'a@example.com']])
    const rows: EventRow[] = [{ id: 1, message_key: 'k1', type: 'open', link: null, at: '2026-11-11T10:00:00Z', cls: 'human' }, { id: 2, message_key: 'k1', type: 'click', link: 'https://esbpowerline.com/x', at: '2026-11-11T10:01:00Z', cls: 'human' }]
    const once = foldEvents({}, rows, keys)
    const twice = foldEvents(once, rows, keys)
    expect(twice['a@example.com']).toMatchObject({ opens: 1, clicks: 1 })
    const merged = mergeEngagement(twice['a@example.com'], { opens: 1, clicks: 0, links: [], keys: { o: ['k2'], m: [], c: [], l: [] }, firstOpen: 1 })
    expect(merged).toMatchObject({ opens: 2, clicks: 1, firstOpen: 1 })
  })
})

describe('Activity wording for tracker rows', async () => {
  const { linkShort, trackView } = await import('../../src/outreach/activityFormat')
  it('a link reads as host + path, never tracking parameters', () => {
    expect(linkShort('https://www.esbpowerline.com/magazine?utm_source=email&utm_medium=newsletter')).toBe('esbpowerline.com/magazine')
    expect(linkShort('https://www.esbpowerline.com/?utm_source=email')).toBe('esbpowerline.com')
    expect(linkShort('file:tariff-2026')).toBe('the file tariff-2026')
  })
  it('chips say what the hit was', () => {
    expect(trackView({ id: '1', t: 0, type: 'track.open', cls: 'proxy', why: 'gmail-proxy', client: 'Gmail', city: 'The Dalles', country: 'US' })).toMatchObject({ chip: 'Opened', app: 'Gmail', place: '', counted: true })
    expect(trackView({ id: '1', t: 0, type: 'track.open', cls: 'prefetch', why: 'apple-mpp-ua', client: 'Apple Mail' })).toMatchObject({ chip: 'Auto-loaded', counted: false })
    expect(trackView({ id: '1', t: 0, type: 'track.click', cls: 'scanner', why: 'asn:8075' })).toMatchObject({ chip: 'Scanner', counted: false })
  })
})
