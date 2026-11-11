// Who fetched the pixel or followed the link: a person, a mail provider's proxy, an automatic prefetch, a security
// scanner or a bot. Pure: every rule is unit-tested in test/classify.test.ts. The order of the rules matters.

export type Cls = 'human' | 'proxy' | 'prefetch' | 'scanner' | 'bot'
export type HitType = 'open' | 'click' | 'file'

export interface HitFacts {
  type: HitType
  method: string
  ua: string
  asn: number | null
  sinceSendMs: number
}

export interface Verdict { cls: Cls; why: string; client: string | null; device: string | null }

// Opens and clicks this soon after sending are machines: no person reads a letter within half a minute of its sending.
export const TOO_SOON_MS = 30_000

// Networks a reader never sits in: cloud hosts and mail-security companies (they open and click to inspect links).
export const SCANNER_ASNS: Record<number, string> = {
  16509: 'Amazon', 14618: 'Amazon', 396982: 'Google Cloud', 15169: 'Google', 14061: 'DigitalOcean',
  16276: 'OVH', 24940: 'Hetzner', 63949: 'Linode', 20473: 'Vultr', 8100: 'QuadraNet',
  22843: 'Proofpoint', 26211: 'Proofpoint', 52129: 'Proofpoint', 30031: 'Mimecast', 15324: 'Barracuda',
  13916: 'Barracuda', 40444: 'Constant Contact', 21342: 'Akamai', 31898: 'Oracle Cloud',
}
const APPLE_ASNS = new Set([714, 6185])
const MICROSOFT_ASN = 8075

const SCANNER_UA =
  /(bot\b|bot\/|crawler|spider|curl\/|wget\/|python-requests|python-urllib|aiohttp|go-http-client|java\/|okhttp|axios\/|node-fetch|undici|headlesschrome|phantomjs|barracuda|proofpoint|mimecast|symantec|trend ?micro|forcepoint|fortinet|sophos|zscaler|existence discovery|slackbot|facebookexternalhit|whatsapp|twitterbot|linkedinbot|discordbot|telegrambot|skypeuripreview|googleother|bingpreview)/i

export function classify(h: HitFacts): Verdict {
  const ua = (h.ua || '').trim()
  const named = clientOf(ua)
  const v = (cls: Cls, why: string, client = named.client, device = named.device): Verdict => ({ cls, why, client, device })

  if (!ua) return v('bot', 'no-ua', null, null)
  if (/GoogleImageProxy|ggpht\.com/i.test(ua)) return v('proxy', 'gmail-proxy', 'Gmail', null)
  if (/YahooMailProxy/i.test(ua)) return v('proxy', 'yahoo-proxy', 'Yahoo Mail', null)
  if (h.method === 'HEAD') return v('scanner', 'head')
  const m = ua.match(SCANNER_UA)
  if (m) return v('scanner', `ua:${m[1].toLowerCase()}`)
  if (h.asn != null && SCANNER_ASNS[h.asn]) return v('scanner', `asn:${h.asn}`)

  if (h.type === 'open') {
    // Apple Mail Privacy Protection loads every picture from Apple's own network, read or not.
    if (ua === 'Mozilla/5.0') return v('prefetch', 'apple-mpp-ua', 'Apple Mail', null)
    if (h.asn != null && APPLE_ASNS.has(h.asn)) return v('prefetch', 'apple-mpp-asn', 'Apple Mail', null)
    if (h.sinceSendMs < TOO_SOON_MS) return v('prefetch', 'too-soon')
    // Outlook.com and Microsoft 365 fetch pictures from Microsoft's network: an open, but no place or device.
    if (h.asn === MICROSOFT_ASN) return v('proxy', 'microsoft-network', named.client ?? 'Outlook', null)
    return v('human', named.client ? 'client' : 'default')
  }

  // Clicks and downloads
  if (h.asn === MICROSOFT_ASN) return v('scanner', 'asn:8075')
  if (h.sinceSendMs < TOO_SOON_MS) return v('scanner', 'too-soon')
  return v('human', named.client ? 'client' : 'default')
}

export function clientOf(ua: string): { client: string | null; device: string | null } {
  const device =
    /iPhone/.test(ua) ? 'iPhone' :
    /iPad/.test(ua) ? 'iPad' :
    /Android/.test(ua) ? 'Android' :
    /Windows/.test(ua) ? 'Windows' :
    /Macintosh|Mac OS X/.test(ua) ? 'Mac' :
    /CrOS/.test(ua) ? 'ChromeOS' :
    /Linux/.test(ua) ? 'Linux' : null
  const client =
    /Thunderbird/.test(ua) ? 'Thunderbird' :
    /Outlook|MSOffice|ms-office|Microsoft Office/i.test(ua) ? 'Outlook' :
    /Edg\//.test(ua) ? 'Edge' :
    /OPR\//.test(ua) ? 'Opera' :
    /Firefox\//.test(ua) ? 'Firefox' :
    /Chrome\//.test(ua) ? 'Chrome' :
    /Version\/[\d.]+.*Safari/.test(ua) ? 'Safari' :
    // Apple Mail's own WebKit says AppleWebKit without Safari or Version
    /AppleWebKit/.test(ua) && (device === 'iPhone' || device === 'iPad' || device === 'Mac') ? 'Apple Mail' : null
  return { client, device }
}
