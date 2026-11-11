// Open/click tracking (electron/outreach-tracking.cjs, mailer.cjs) and the cloud-sends guard (outreach-guard.cjs).
// Synthetic example.com addresses only.
import { describe, it, expect, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-expect-error — plain ESM shared with the main process
import { renderDesigned, sanitizeDesignHtml } from '../../electron/email-html.mjs'

const require = createRequire(import.meta.url)
const T = require('../../electron/outreach-tracking.cjs')
const m = require('../../electron/mailer.cjs')
const guard = require('../../electron/outreach-guard.cjs')

const KEY = 'AbCdEfGhIjKlMnOpQrStUv'
const PIXEL_RE = /<img src="https:\/\/esbpowerline\.com\/api\/o\//g

describe('isTrackableUrl: only allowlisted https hosts, nothing that merely looks like one', () => {
  it.each([
    'https://esbpowerline.com/', 'https://www.esbpowerline.com/articles/x?utm_source=mail', 'https://ESBPOWERLINE.COM/a',
    'https://esbpowerline.com./a', 'https://facebook.com/esbpowerlineofficial', 'https://m.facebook.com/x', 'https://www.youtube.com/@esbplbd',
    'https://youtu.be/abc', 'https://wa.me/8801711378733', 'https://api.whatsapp.com/send?phone=1', 'https://esbpowerline.com:443/x',
  ])('tracks %s', (u) => expect(T.isTrackableUrl(u)).toBe(true))
  it.each([
    ['look-alike suffix', 'https://esbpowerline.com.evil.com/'],
    ['look-alike prefix', 'https://evilesbpowerline.com/'],
    ['sub-domain not on the list', 'https://news.esbpowerline.com/'],
    ['userinfo pointing elsewhere', 'https://esbpowerline.com@evil.com/'],
    ['userinfo naming us', 'https://user:pw@esbpowerline.com/'],
    ['backslash trick', 'https://evil.com\\@esbpowerline.com/'],
    ['plain http', 'http://esbpowerline.com/'],
    ['other port', 'https://esbpowerline.com:8443/'],
    ['path naming us', 'https://evil.com/esbpowerline.com'],
    ['mailto', 'mailto:desk@example.com?subject=unsubscribe'],
    ['anchor', '#top'],
    ['placeholder', '{unsubscribe}'],
    ['javascript', 'javascript:alert(1)'],
    ['protocol-relative', '//esbpowerline.com/'],
    ['not a URL', 'https://'],
  ])('does not track %s', (_why, u) => expect(T.isTrackableUrl(u)).toBe(false))
})

describe('trackHtml: links through /r, one pixel before </body>, everything else untouched', () => {
  const page = '<!doctype html><html><body><p><a href="https://esbpowerline.com/magazine?utm_source=mail&amp;x=1">Read</a> '
    + '<a href="https://example.org/other">Other</a> <a href="mailto:desk@example.com?subject=unsubscribe">Unsubscribe</a> '
    + `<a href='https://www.facebook.com/esbpowerlineofficial'>FB</a> <a href="#top">Top</a></p></body></html>`
  const out = T.trackHtml(page, { key: KEY, campaignId: 'cmp-abc_1' })
  it('rewrites allowlisted links, keeping the target and its own query string intact', () => {
    const want = `https://esbpowerline.com/r/${KEY}?u=${encodeURIComponent('https://esbpowerline.com/magazine?utm_source=mail&x=1')}&c=cmp-abc_1`
    expect(out).toContain(`href="${want.replace(/&/g, '&amp;')}"`)
    expect(out).toContain(`/r/${KEY}?u=${encodeURIComponent('https://www.facebook.com/esbpowerlineofficial')}`)
  })
  it('leaves other hosts, mailto and anchors exactly as they were', () => {
    expect(out).toContain('href="https://example.org/other"')
    expect(out).toContain('href="mailto:desk@example.com?subject=unsubscribe"')
    expect(out).toContain('href="#top"')
  })
  it('adds exactly one 1x1 pixel, just before </body>', () => {
    expect(out.match(PIXEL_RE)?.length).toBe(1)
    expect(out).toMatch(new RegExp(`<img src="https://esbpowerline\\.com/api/o/${KEY}\\?c=cmp-abc_1" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0"></body></html>$`))
  })
  it('a page without </body> gets the pixel at the end; an unsafe campaign id is left out of the links', () => {
    const o = T.trackHtml('<p><a href="https://esbpowerline.com/">x</a></p>', { key: KEY, campaignId: 'bad id&x=1' })
    expect(o.endsWith(`<img src="https://esbpowerline.com/api/o/${KEY}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">`)).toBe(true)
    expect(o).not.toContain('bad id')
  })
  it('refuses a key that is not 22 base64url characters', () => {
    expect(() => T.trackHtml('<p></p>', { key: 'short' })).toThrow()
    expect(() => T.trackHtml('<p></p>', { key: 'A'.repeat(21) + '"' })).toThrow()
  })
  it('keys are 22 random base64url characters', () => {
    const keys = new Set(Array.from({ length: 200 }, () => T.newMessageKey()))
    expect(keys.size).toBe(200)
    for (const k of keys) expect(k).toMatch(/^[A-Za-z0-9_-]{22}$/)
  })
})

describe('the sanitizer still refuses remote pictures from the page; only main adds the pixel', () => {
  const hostile = '<html><body><img src="https://esbpowerline.com/api/o/AbCdEfGhIjKlMnOpQrStUv"><img src="https://t.example/p.gif" width="1"><div style="background:url(https://t.example/b.gif)">x</div><a href="{unsubscribe}">Unsubscribe</a></body></html>'
  it('a renderer-supplied pixel — even one pointing at our own endpoint — is stripped', () => {
    const clean = sanitizeDesignHtml(hostile)
    expect(clean).not.toMatch(/https:\/\/(esbpowerline\.com|t\.example)/)
  })
  it('after renderDesigned + trackHtml there is exactly one pixel, ours, and {unsubscribe} is still the mailto', () => {
    const { html } = renderDesigned({ html: hostile, unsubscribeHref: 'mailto:desk@example.com?subject=unsubscribe' })
    const out = T.trackHtml(html, { key: KEY, campaignId: 'cmp-1' })
    expect(out.match(/<img\b[^>]*src="https?:/gi)?.length).toBe(1)
    expect(out.match(PIXEL_RE)?.length).toBe(1)
    expect(out).toContain('href="mailto:desk@example.com?subject=unsubscribe"')
  })
})

describe('createTrackingGate: on only when both site endpoints answer as the contract says', () => {
  const res = (status: number, headers: Record<string, string>) => ({ status, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } })
  it('live: a GIF from /api/o and a 302 to esbpowerline.com from /r', async () => {
    const calls: string[] = []
    const g = T.createTrackingGate({ env: {}, fetchFn: async (u: string) => { calls.push(u); return u.includes('/api/o/') ? res(200, { 'content-type': 'image/gif' }) : res(302, { location: 'https://esbpowerline.com/' }) } })
    expect(await g.enabled()).toBe(true)
    expect(await g.enabled()).toBe(true)
    expect(calls.length).toBe(2) // cached
    // the probe never uses a real 22-character key, so it records nothing
    expect(calls.every((u) => !/\/[A-Za-z0-9_-]{22}(\?|\.gif|$)/.test(u))).toBe(true)
  })
  it('not live while the routes 404 (migration/site not deployed), offline, or turned off', async () => {
    expect(await T.createTrackingGate({ env: {}, fetchFn: async () => res(404, { 'content-type': 'text/html' }) }).enabled()).toBe(false)
    expect(await T.createTrackingGate({ env: {}, fetchFn: async (u: string) => (u.includes('/api/o/') ? res(200, { 'content-type': 'image/gif' }) : res(404, {})) }).enabled()).toBe(false)
    expect(await T.createTrackingGate({ env: {}, fetchFn: async (u: string) => (u.includes('/api/o/') ? res(200, { 'content-type': 'image/gif' }) : res(302, { location: 'https://evil.example/' })) }).enabled()).toBe(false)
    expect(await T.createTrackingGate({ env: {}, fetchFn: async () => { throw new Error('ENOTFOUND') } }).enabled()).toBe(false)
    let asked = 0
    expect(await T.createTrackingGate({ env: { ESB_OUTREACH_TRACKING: '0' }, fetchFn: async () => { asked++; return res(200, {}) } }).enabled()).toBe(false)
    expect(asked).toBe(0)
  })
})

describe('mailer: a key per letter (tests too), pixel and links added after sanitizing, key returned and kept', () => {
  let dir: string
  const sent: Record<string, unknown>[] = []
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from('enc:' + s), decryptString: (b: Buffer) => b.toString().replace(/^enc:/, '') }
  const nodemailer = { createTransport: () => ({ sendMail: async (mm: Record<string, unknown>) => { sent.push(mm); return { messageId: `<id${sent.length}@example.com>` } } }) }
  const settings = { host: 'smtp.gmail.com', port: 587, user: 'desk@example.com', name: 'ESB Power Line', dailyLimit: 50, minDelaySec: 60, maxDelaySec: 120 }
  let now = Date.UTC(2026, 10, 1, 6)
  const live = { enabled: async () => true }
  let n = 0
  const newKey = () => `K${String(++n).padStart(21, '0')}`
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'esb-track-')); sent.length = 0 })

  it('a designed letter: one pixel, allowlisted links via /r, the renderer’s own pixel gone, key in result and ledger', async () => {
    const mailer = m.createMailer({ dir, safeStorage, nodemailer, clock: () => now, tracking: live, newKey })
    mailer.saveSettings(settings, 'abcdefghijklmnop')
    const r = await mailer.send({
      to: 'reader@example.com', subject: 'S', body: 'plain', campaignId: 'cmp-1',
      design: { html: '<html><body><img src="https://esbpowerline.com/api/o/AAAAAAAAAAAAAAAAAAAAAA"><a href="https://esbpowerline.com/magazine">Read</a><a href="{unsubscribe}">Unsubscribe</a></body></html>', images: [] },
    })
    expect(r).toMatchObject({ ok: true, messageKey: 'K000000000000000000001' })
    const html = String(sent[0].html)
    expect(html.match(PIXEL_RE)?.length).toBe(1)
    expect(html).toContain('/api/o/K000000000000000000001?c=cmp-1')
    expect(html).not.toContain('AAAAAAAAAAAAAAAAAAAAAA')
    expect(html).toContain(`/r/K000000000000000000001?u=${encodeURIComponent('https://esbpowerline.com/magazine')}`)
    expect(html).toContain('href="mailto:desk@example.com?subject=unsubscribe"')
    const ledger = JSON.parse(readFileSync(join(dir, 'outreach-ledger.json'), 'utf8'))
    expect(ledger[0]).toMatchObject({ to: 'reader@example.com', kind: 'campaign', key: 'K000000000000000000001', c: 'cmp-1' })
  })
  it('a plain-marks letter and a test email get their own keys too; the text/plain part has no pixel', async () => {
    const mailer = m.createMailer({ dir, safeStorage, nodemailer, clock: () => now, tracking: live, newKey })
    mailer.saveSettings(settings, 'abcdefghijklmnop')
    const a = await mailer.send({ to: 'a@example.com', subject: 'S', body: 'See [the site](https://esbpowerline.com/x) or [elsewhere](https://example.org/)', campaignId: 'cmp-2' })
    now += 60e3
    const t = await mailer.send({ to: 'me@example.com', subject: '[Test] S', body: 'B', isTest: true, campaignId: 'cmp-2' })
    expect(a.messageKey).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(t.messageKey).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(t.messageKey).not.toBe(a.messageKey)
    expect(String(sent[0].html).match(PIXEL_RE)?.length).toBe(1)
    expect(String(sent[0].html)).toContain('href="https://example.org/"')
    expect(String(sent[0].text)).not.toContain('api/o')
  })
  it('the campaign switch off: no key, no pixel, links exactly as written — and on again tracks the next one', async () => {
    const mailer = m.createMailer({ dir, safeStorage, nodemailer, clock: () => now, tracking: live, newKey })
    mailer.saveSettings(settings, 'abcdefghijklmnop')
    const off = await mailer.send({ to: 'off@example.com', subject: 'S', body: 'See [the site](https://esbpowerline.com/x)', campaignId: 'cmp-9', track: false })
    expect(off).toMatchObject({ ok: true, messageKey: null })
    expect(String(sent[0].html)).not.toMatch(PIXEL_RE)
    expect(String(sent[0].html)).toContain('href="https://esbpowerline.com/x"')
    const ledger = JSON.parse(readFileSync(join(dir, 'outreach-ledger.json'), 'utf8'))
    expect(ledger[0].key).toBeUndefined()
    now += 60e3
    const on = await mailer.send({ to: 'on@example.com', subject: 'S', body: 'See [the site](https://esbpowerline.com/x)', campaignId: 'cmp-9', track: true })
    expect(on.messageKey).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(String(sent[1].html).match(PIXEL_RE)?.length).toBe(1)
    now += 60e3
    // a payload from before the switch existed (no track field) is tracked, as it always was
    const old = await mailer.send({ to: 'old@example.com', subject: 'S', body: 'B', campaignId: 'cmp-9' })
    expect(old.messageKey).toMatch(/^[A-Za-z0-9_-]{22}$/)
  })
  it('while the site’s tracking is not live, letters go out exactly as before, with no key', async () => {
    const mailer = m.createMailer({ dir, safeStorage, nodemailer, clock: () => now, tracking: { enabled: async () => false } })
    mailer.saveSettings(settings, 'abcdefghijklmnop')
    const r = await mailer.send({ to: 'b@example.com', subject: 'S', body: 'See https://esbpowerline.com/x', campaignId: 'cmp-3' })
    expect(r).toMatchObject({ ok: true, messageKey: null })
    expect(String(sent[0].html)).not.toContain('/api/o/')
    expect(String(sent[0].html)).not.toContain('/r/')
  })
  it('a gate that throws is treated as off — sending never depends on the site', async () => {
    const mailer = m.createMailer({ dir, safeStorage, nodemailer, clock: () => now, tracking: { enabled: async () => { throw new Error('boom') } } })
    mailer.saveSettings(settings, 'abcdefghijklmnop')
    expect(await mailer.send({ to: 'c@example.com', subject: 'S', body: 'B' })).toMatchObject({ ok: true, messageKey: null })
  })
  it('markSent: sends from another PC enter the ledger once, and the 7-day rule then refuses a repeat here', async () => {
    const mailer = m.createMailer({ dir, safeStorage, nodemailer, clock: () => now })
    mailer.saveSettings(settings, 'abcdefghijklmnop')
    const at = now - 3600e3
    const first = await mailer.markSent([{ email: 'other@example.com', kind: 'campaign', campaignId: 'cmp-9', at }, { email: 'me@example.com', kind: 'test', campaignId: 'cmp-9', at }])
    expect(first.length).toBe(1)
    expect(await mailer.markSent([{ email: 'other@example.com', kind: 'campaign', campaignId: 'cmp-9', at: at + 1000 }])).toEqual([])
    expect(mailer.ledger()).toEqual([expect.objectContaining({ to: 'other@example.com', kind: 'campaign', remote: true, c: 'cmp-9' })])
    expect(await mailer.send({ to: 'other@example.com', subject: 'S', body: 'B' })).toMatchObject({ ok: false, duplicate: true })
    expect(mailer.status().sentTo.map((e: { to: string }) => e.to)).toContain('other@example.com')
  })
})

describe('validateRemoteSends: the cloud ledger is renderer input, checked like any other', () => {
  const now = Date.UTC(2026, 10, 1)
  it('keeps good entries, lower-cased and de-duplicated', () => {
    const g = guard.validateRemoteSends([
      { email: ' A@Example.com ', kind: 'campaign', campaignId: 'cmp-1', at: now - 1000 },
      { email: 'a@example.com', kind: 'campaign', campaignId: 'cmp-1', at: now - 2000 },
      { email: 'a@example.com', kind: 'followup', campaignId: 'cmp-1', at: now },
    ], now)
    expect(g.ok).toBe(true)
    expect(g.entries).toEqual([{ email: 'a@example.com', kind: 'campaign', campaignId: 'cmp-1', at: now - 1000 }, { email: 'a@example.com', kind: 'followup', campaignId: 'cmp-1', at: now }])
  })
  it.each([
    ['two addresses', { email: 'a@example.com, b@example.com', kind: 'campaign', campaignId: 'c', at: now }],
    ['header injection', { email: 'a@example.com\r\nBcc: x@example.com', kind: 'campaign', campaignId: 'c', at: now }],
    ['unknown kind', { email: 'a@example.com', kind: 'blast', campaignId: 'c', at: now }],
    ['campaign id with a slash', { email: 'a@example.com', kind: 'campaign', campaignId: '../x', at: now }],
    ['empty campaign id', { email: 'a@example.com', kind: 'campaign', campaignId: '', at: now }],
    ['a time in the future', { email: 'a@example.com', kind: 'campaign', campaignId: 'c', at: now + 3600e3 }],
    ['a time long ago', { email: 'a@example.com', kind: 'campaign', campaignId: 'c', at: now - 500 * 86400e3 }],
    ['a string time', { email: 'a@example.com', kind: 'campaign', campaignId: 'c', at: String(now) }],
    ['prototype keys', JSON.parse('{"__proto__":{"x":1},"email":"a@example.com","kind":"campaign","campaignId":"c","at":0}')],
    ['not an object', 'a@example.com'],
  ])('drops %s', (_why, e) => {
    const g = guard.validateRemoteSends([e], now)
    expect(g.ok).toBe(true)
    expect(g.entries).toEqual([])
    expect(g.rejected).toBe(1)
  })
  it('refuses something that is not a list, or a list too long', () => {
    expect(guard.validateRemoteSends({ email: 'a@example.com' }).ok).toBe(false)
    expect(guard.validateRemoteSends(new Array(20001).fill(null)).ok).toBe(false)
  })
})
