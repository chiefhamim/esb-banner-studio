import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import worker, { type Env } from '../src/index'
import { makeToken, linkSig, fileSig } from '../src/token'

export const E = env as unknown as Env
export const BASE = 'https://t.example.com'
export const HOME = 'https://esbpowerline.com/'

// Real-world user agents (as clients send them)
export const UA = {
  chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  outlookDesktop: 'Mozilla/4.0 (compatible; ms-office; MSOffice 16)',
  appleMailMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
  appleMailIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  gmailProxy: 'Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)',
  yahooProxy: 'YahooMailProxy; https://help.yahoo.com/kb/yahoo-mail-proxy-SLN28749.html',
  appleMpp: 'Mozilla/5.0',
  thunderbird: 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Thunderbird/128.5.0',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  curl: 'curl/8.7.1',
  python: 'python-requests/2.32.3',
  msDiscovery: 'Microsoft Office Existence Discovery',
  slack: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
}

let n = 0
export function newKey(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  b[0] = n++ & 255
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A letter sent `ageMs` ago (default an hour: old enough that no timing rule fires). */
export async function letter(ageMs = 3_600_000, key = newKey()) {
  const sentAt = Date.now() - ageMs
  const token = await makeToken(E.TRACK_SECRET, key, sentAt)
  return {
    key, token, sentAt,
    pixel: `${BASE}/o/${token}.gif`,
    click: async (u: string) => `${BASE}/c/${token}?u=${encodeURIComponent(u)}&s=${await linkSig(E.TRACK_SECRET, key, u)}`,
    file: async (id: string) => `${BASE}/f/${token}/${id}?s=${await fileSig(E.TRACK_SECRET, key, id)}`,
  }
}

export interface HitOpts { ua?: string; asn?: number; ip?: string; country?: string; city?: string; asOrg?: string; method?: string; headers?: Record<string, string>; body?: BodyInit }

export async function hit(url: string, o: HitOpts = {}, envOver: Partial<Env> = {}) {
  const headers = new Headers(o.headers)
  headers.set('user-agent', o.ua ?? UA.chromeWin)
  if (o.ip !== null) headers.set('cf-connecting-ip', o.ip ?? '203.0.113.7')
  const req = new Request(url, {
    method: o.method ?? 'GET', headers, body: o.body, redirect: 'manual',
    cf: { asn: o.asn ?? 24389, asOrganization: o.asOrg ?? 'Grameenphone', country: o.country ?? 'BD', city: o.city ?? 'Dhaka', colo: 'DAC' },
  } as RequestInit)
  const ctx = createExecutionContext()
  const res = await worker.fetch(req as Request<unknown, IncomingRequestCfProperties>, { ...E, ...envOver } as Env, ctx)
  await waitOnExecutionContext(ctx)
  return res
}

export const api = (path: string, init: RequestInit & { token?: string } = {}) =>
  hit(BASE + path, { method: init.method, body: init.body ?? undefined, headers: { authorization: `Bearer ${init.token ?? E.API_TOKEN}`, ...(init.headers as Record<string, string>) } })

export async function rows(key: string) {
  const { results } = await E.DB.prepare('SELECT * FROM events WHERE key = ? ORDER BY id').bind(key).all()
  return results as Record<string, unknown>[]
}
