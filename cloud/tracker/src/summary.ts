// One letter's story from its raw hits: opened (by whom, how often, first/last), clicked, downloaded, forwarded.
// Pure, so the same rules can be tested exhaustively and copied into the app.

export interface EventRow {
  id: number; key: string; type: 'open' | 'click' | 'file'; target: string | null; at: number; sent_at: number
  cls: string; why: string | null; client: string | null; device: string | null; ua: string | null
  asn: number | null; as_org: string | null; country: string | null; city: string | null; colo: string | null
  ip_hash: string | null
}

export type Forwarded = 'likely' | 'possible' | 'no' | 'unknown'

export interface Summary {
  key: string
  opened: boolean
  opens: number            // counted opens (people + mail-provider proxies), repeats within DEDUPE_MS folded
  humanOpens: number
  proxyOpens: number
  machineOpens: number     // Apple prefetch, scanners, bots: never counted as read
  firstOpen: number | null
  lastOpen: number | null
  clicks: number
  machineClicks: number
  links: { url: string; clicks: number; first: number }[]
  files: { id: string; downloads: number; first: number }[]
  clients: string[]
  devices: string[]
  places: { country: string | null; city: string | null; network: string | null; first: number }[]
  forwarded: Forwarded
  forwardWhy: string
}

/** The same reader fetching the same thing twice within this window is one hit (clients reload pictures). */
export const DEDUPE_MS = 10_000

const COUNTED = new Set(['human', 'proxy'])

export function summarize(key: string, rows: EventRow[]): Summary {
  const mine = rows.filter((r) => r.key === key).sort((a, b) => a.at - b.at || a.id - b.id)
  const seen = new Map<string, number>()
  const fresh = (r: EventRow) => {
    const sig = `${r.type}|${r.cls}|${r.target ?? ''}|${r.ip_hash ?? ''}|${r.ua ?? ''}`
    const last = seen.get(sig)
    seen.set(sig, r.at)
    return last == null || r.at - last > DEDUPE_MS
  }

  const s: Summary = {
    key, opened: false, opens: 0, humanOpens: 0, proxyOpens: 0, machineOpens: 0, firstOpen: null, lastOpen: null,
    clicks: 0, machineClicks: 0, links: [], files: [], clients: [], devices: [], places: [], forwarded: 'unknown',
    forwardWhy: 'no open seen yet',
  }
  const links = new Map<string, { url: string; clicks: number; first: number }>()
  const files = new Map<string, { id: string; downloads: number; first: number }>()
  const places = new Map<string, Summary['places'][number]>()
  const clients = new Set<string>(), devices = new Set<string>()

  for (const r of mine) {
    if (!fresh(r)) continue
    const counted = COUNTED.has(r.cls)
    if (r.type === 'open') {
      if (!counted) { s.machineOpens++; continue }
      s.opens++
      if (r.cls === 'human') s.humanOpens++; else s.proxyOpens++
      s.firstOpen ??= r.at
      s.lastOpen = r.at
    } else if (r.type === 'click') {
      if (!counted) { s.machineClicks++; continue }
      s.clicks++
      const l = links.get(r.target ?? '') ?? { url: r.target ?? '', clicks: 0, first: r.at }
      l.clicks++
      links.set(l.url, l)
    } else {
      if (!counted) continue
      const f = files.get(r.target ?? '') ?? { id: r.target ?? '', downloads: 0, first: r.at }
      f.downloads++
      files.set(f.id, f)
    }
    // A click or download is also proof the letter was opened (pictures may be blocked).
    if (r.type !== 'open' && s.firstOpen == null) s.firstOpen = r.at
    if (r.client) clients.add(r.client)
    if (r.device) devices.add(r.device)
    if (r.cls === 'human') {
      const pk = `${r.country}|${r.asn}`
      if (!places.has(pk)) places.set(pk, { country: r.country, city: r.city, network: r.as_org, first: r.at })
    }
  }
  s.opened = s.opens > 0 || s.clicks > 0 || files.size > 0
  s.links = [...links.values()]
  s.files = [...files.values()]
  s.clients = [...clients]
  s.devices = [...devices]
  s.places = [...places.values()]
  ;[s.forwarded, s.forwardWhy] = forwardVerdict(s)
  return s
}

function forwardVerdict(s: Summary): [Forwarded, string] {
  if (!s.opened) return ['unknown', 'no open seen yet']
  if (s.places.length === 0) return ['unknown', 'opened only through a mail provider that hides where (Gmail, Outlook.com)']
  const countries = new Set(s.places.map((p) => p.country).filter(Boolean))
  if (countries.size >= 2) return ['likely', `opened in ${countries.size} countries`]
  if (s.places.length >= 3) return ['likely', `opened from ${s.places.length} different networks`]
  if (s.places.length === 2 && s.devices.length >= 2) return ['possible', 'two networks and two kinds of device (could be one person at work and on the phone)']
  return ['no', 'one place']
}
