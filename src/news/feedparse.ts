// News engine (shared, identical in ESB Studio PC src/news and ESB Studio Phone src/mobile/watch; tools/sync-pc.mjs news).
// EnergyWatch's RSS / Atom parser, copied from EnergyWatch (Yeasin, src/feedparse.js, office copy of 2026-11-05) and typed.
// A regex pass, no XML library. Dates are read by dates.ts (BST, Bangla digits and months, zone-less = Dhaka).
import { parseFeedDate } from './dates'

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

function clean(raw: string | null): string {
  if (raw == null) return ''
  let s = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  s = decodeEntities(s)
  s = s.replace(/<[^>]+>/g, ' ')
  s = decodeEntities(s)
  return s.replace(/\s+/g, ' ').trim()
}

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'))
  return m ? m[1] : null
}

function atomLink(block: string): string | null {
  const links = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)].map((m) => m[1])
  let fallback: string | null = null
  for (const attrs of links) {
    const href = attrs.match(/href\s*=\s*["']([^"']+)["']/i)
    if (!href) continue
    const rel = attrs.match(/rel\s*=\s*["']([^"']+)["']/i)
    if (!rel || rel[1] === 'alternate') return decodeEntities(href[1])
    fallback ??= decodeEntities(href[1])
  }
  return fallback
}

export interface FeedEntry { key: string; title: string; link: string; date: string }

export function parseFeed(xml: string): FeedEntry[] {
  const items: FeedEntry[] = []
  const isAtom = !/<item\b/i.test(xml) && /<entry\b/i.test(xml)
  const blocks = xml.match(isAtom ? /<entry\b[\s\S]*?<\/entry>/gi : /<item\b[\s\S]*?<\/item>/gi) || []

  for (const b of blocks) {
    let title = clean(tag(b, 'title'))
    const source = clean(tag(b, 'source'))
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3)).trim()
    title = stripTitleSuffix(title)

    let link = isAtom ? atomLink(b) || '' : clean(tag(b, 'link'))
    const guid = clean(tag(b, 'guid')) || clean(tag(b, 'id'))
    if (!link && /^https?:/i.test(guid)) link = guid

    const date = clean(tag(b, 'pubDate')) || clean(tag(b, 'published')) || clean(tag(b, 'updated')) || clean(tag(b, 'dc:date'))

    const key = guid || link
    if (!key || !title) continue
    items.push({ key, title, link, date })
  }
  return items
}

/**
 * A headline without the site name portals append to it: "… | jagonews24.com", "… - bonikbarta.com.bd", "… — samakal.com",
 * "… | ঢাকাপোস্ট.কম". Only a trailing part that looks like a domain goes, so "… - 3.5 GW" or "ঢাকা-চট্টগ্রাম" stay.
 */
export function stripTitleSuffix(title: string): string {
  return title.replace(/\s*[|–—-]\s*[^|–—-]*?\.(?:com|net|org|tv|news|info|live|bd|কম)(?:\.bd)?\s*$/i, '').trim()
}

/** A feed date as ISO, or null when it cannot be read (the item is then "time unknown"). See dates.ts. */
export function parseDate(s: string): string | null {
  return parseFeedDate(s)
}
