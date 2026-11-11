// News engine (shared, identical in ESB Studio PC src/news and ESB Studio Phone src/mobile/watch; tools/sync-pc.mjs news).
// Official press releases from the Bangladesh National Portal sites (powerdivision.gov.bd/site/view/press_release …).
//
// Only the release LIST is read: the rows of its table (serial · title · date · attachment). The page around it — the top
// menu, the side menu, "সেবা ও কার্যক্রম", "প্রধানমন্ত্রীর জীবন বৃত্তান্ত", the footer — is never a headline. Found
// 2026-11-09: a fall-back that read every <ul><li><a> on the page listed the PMO site's menu as press releases "just now".
// So a row needs a date, or a link that is itself a release (/site/press_release/<id>, /site/news/<id> …); a page without
// such rows gives nothing rather than its navigation. A regex pass (no DOMParser), so it runs the same in tests and apps.
import { parseFeedDate, bnToAsciiDigits } from './dates'

export interface ParsedPressItem { key: string; title: string; link: string; published: string | null }

/** Notices that are not news: tenders, recruitment, transfers, office orders, compliance paperwork. */
export const NOT_PRESS = new RegExp([
  'দরপত্র', 'কোটেশন', 'নিলাম', 'টেন্ডার',
  '\\btender\\b', '\\bquotation\\b', '\\brfq\\b', '\\be-?gp\\b', '\\bprocurement\\b',
  '\\biem\\b', 'corrigendum', 'addendum', '\\bnoa\\b', 'notification of award',
  'অনাপত্তি', '\\bnoc\\b', 'পাসপোর্ট', 'passport',
  'সরকারি আদেশ', 'অফিস আদেশ', 'office order', '\\bg\\.?o\\.?\\b',
  'বদলি', 'পদোন্নতি', 'পদায়ন', 'যোগদান', 'অবমুক্তি', 'ছুটি মঞ্জুর',
  'নিয়োগ বিজ্ঞপ্তি', 'চাকরির বিজ্ঞপ্তি', 'লিখিত পরীক্ষা', 'মৌখিক পরীক্ষা', 'ব্যবহারিক পরীক্ষা',
  'উত্তীর্ণ প্রার্থী', 'ফলাফল প্রকাশ', 'প্রবেশপত্র', 'জ্যেষ্ঠতা তালিকা', '\\bseniority\\b',
  'বার্ষিক কর্মসম্পাদন', '\\bapa\\b', 'শুদ্ধাচার', '\\bnis\\b', 'সিটিজেন চার্টার', 'অভিযোগ প্রতিকার', 'তথ্য অধিকার',
].join('|'), 'i')

const GOV_HOST_TO_OFFICE: Record<string, string> = {
  'powerdivision.gov.bd': 'Power Division',
  'emrd.gov.bd': 'EMRD',
  'berc.org.bd': 'BERC',
  'sreda.gov.bd': 'SREDA',
  'pmo.gov.bd': 'PMO Press Wing',
  'bangabhaban.gov.bd': 'Bangabhaban Press Wing',
  'pressinform.gov.bd': 'PID (Press Information Dept)',
  'bpdb.gov.bd': 'BPDB',
  'petrobangla.org.bd': 'Petrobangla',
  'bpc.gov.bd': 'BPC',
  'reb.gov.bd': 'BREB',
  'pgcb.gov.bd': 'PGCB',
  'gtcl.gov.bd': 'GTCL',
  'bapex.com.bd': 'BAPEX',
  'rpgcl.org.bd': 'RPGCL',
  'desco.gov.bd': 'DESCO',
  'dpdc.gov.bd': 'DPDC',
  'nesco.gov.bd': 'NESCO',
  'wzpdcl.gov.bd': 'WZPDCL',
  'titasgas.org.bd': 'Titas Gas',
  'bgdcl.gov.bd': 'BGDCL',
  'jalalabadgas.org.bd': 'Jalalabad Gas',
  'pgcl.org.bd': 'PGCL',
  'sgfl.org.bd': 'SGFL',
  'gsb.gov.bd': 'GSB',
  'erl.gov.bd': 'ERL',
  'pocl.gov.bd': 'Padma Oil',
  'mpl.gov.bd': 'Meghna Petroleum',
  'jocl.gov.bd': 'Jamuna Oil',
}

/** The office a government link belongs to; `fallback` for another .gov.bd/.org.bd site; null for anything else. */
export function resolveGovOfficeName(link: string, fallback: string): string | null {
  try {
    const host = new URL(link).hostname.replace(/^www\./i, '').toLowerCase()
    for (const [domain, name] of Object.entries(GOV_HOST_TO_OFFICE)) {
      if (host === domain || host.endsWith('.' + domain)) return name
    }
    if (/\.(?:gov|org)\.bd$/i.test(host)) return fallback
  } catch { /* ignore */ }
  return null
}

/** A link that is one release (or its file), not a section page: /site/press_release/<id>…, /site/news/<id>…, a document. */
export const PRESS_LINK = /\/site\/(?:press_release|news|handout|notices?|page_news)\/[^/?#]+|\/(?:press[-_]?release|news|handout)s?\/(?:details?\/)?[\w-]*\d[\w-]*|\.(?:pdf|docx?)(?:[?#]|$)/i

const SKIP_TITLES = /^(বিস্তারিত|দেখুন|ডাউনলোড|ক্লিক করুন|view|download|details|read more|more|click here|pdf|docx?|attachment|সংযুক্তি|\d+)$/i
const ONLY_DATE = /^(?:20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]20\d{2})$/
const DOC = /\.(?:pdf|docx?|xlsx?|jpe?g|png)(?:[?#]|$)/i

const ENTITY: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'" }
const stripTags = (s: string) =>
  String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(nbsp|amp|lt|gt|quot|#39|apos);/gi, (_, e: string) => ENTITY[e.toLowerCase()] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** National Portal pages may ship their content base64-encoded in #encoded-content. */
function decodeNationalPortalHtml(html: string): string {
  const m = html.match(/<div[^>]+id=["']encoded-content["'][^>]*>([\s\S]*?)<\/div>/i)
  if (!m?.[1]) return html
  try {
    const bin = atob(m[1].replace(/\s+/g, ''))
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const decoded = new TextDecoder('utf-8').decode(bytes)
    if (/<table|<tr|<a\s/i.test(decoded)) return decoded
  } catch { /* malformed */ }
  return html
}

/** Menus, headers, footers and side bars are cut out before anything is read. */
function withoutChrome(html: string): string {
  return html
    .replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<ul\b[^>]*(?:class|id)=["'][^"']*(?:menu|nav|sidebar|breadcrumb|footer)[^"']*["'][\s\S]*?<\/ul>/gi, ' ')
}

/** A press-list date: "2026-11-09", "09-11-2026", "০৯/১১/২০২৬", "০৯ নভেম্বর ২০২৬" (Dhaka noon when there is no time). */
export function parsePressDate(raw: string): string | null {
  const s = bnToAsciiDigits(raw).trim()
  if (!s) return null
  let m = s.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/)
  if (m) return parseFeedDate(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')} 12:00`)
  m = s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/)
  if (m) return parseFeedDate(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')} 12:00`)
  return s.length <= 40 ? parseFeedDate(raw) : null
}

const hrefs = (html: string) => [...html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)].map((m) => m[1].replace(/&amp;/g, '&').trim())

function absolute(href: string, pageUrl: string): string | null {
  if (!href || /^(?:javascript|mailto|tel):/i.test(href)) return null
  try {
    const u = new URL(href, pageUrl)
    if (u.protocol === 'http:' && /\.(?:gov|org|com)\.bd$/i.test(u.hostname)) u.protocol = 'https:'
    return /^https?:$/.test(u.protocol) ? u.href : null
  } catch {
    return null
  }
}

/** The releases listed on a National Portal press_release / news page: dated rows or release links, never the menus. */
export function parseGovPressTable(rawHtml: string, pageUrl: string): ParsedPressItem[] {
  // the new portal leaves its old table cells in comments, with US-style dates: "11/3/2026" was read as 11 March
  const html = withoutChrome(decodeNationalPortalHtml(rawHtml).replace(/<!--[\s\S]*?-->/g, ''))
  const out: ParsedPressItem[] = []
  const seen = new Set<string>()
  const push = (title: string, link: string, published: string | null) => {
    if (!title || title.length < 10 || SKIP_TITLES.test(title) || NOT_PRESS.test(title)) return
    // a release has a date or is itself a release link; a section page with neither is navigation
    if (!published && !PRESS_LINK.test(link)) return
    if (seen.has(link)) return
    seen.add(link)
    out.push({ key: link, title, link, published })
  }

  for (const tbody of html.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
    for (const tr of tbody.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
      if (/<th[\s>]/i.test(tr)) continue
      const cells = tr.match(/<td[\s\S]*?<\/td>/gi) ?? []
      if (cells.length < 2) continue
      const texts = cells.map((c) => stripTags(c))
      // title: the second column on the portal (serial · title · date), else the longest text cell that is not a date
      let ti = texts[1] && texts[1].length >= 10 && !ONLY_DATE.test(bnToAsciiDigits(texts[1])) ? 1 : -1
      if (ti < 0) {
        texts.forEach((t, i) => {
          const a = bnToAsciiDigits(t)
          if (t && !/^\d+$/.test(a) && !ONLY_DATE.test(a) && !SKIP_TITLES.test(t) && (ti < 0 || t.length > texts[ti].length)) ti = i
        })
      }
      if (ti < 0) continue
      const title = texts[ti].replace(/\s*\(?(?:নতুন|new)\)?\s*$/i, '').trim()
      const links = [...hrefs(cells[ti]), ...hrefs(tr)].map((h) => absolute(h, pageUrl)).filter((h): h is string => !!h)
      const link = links.find((h) => !DOC.test(h)) ?? links[0]
      if (!link) continue
      let published: string | null = null
      for (let i = 0; i < cells.length && !published; i++) if (i !== ti) published = parsePressDate(texts[i])
      push(title, link, published)
    }
  }

  // No table: release links only (a list of <a href="/site/press_release/…">), each with a date beside it when there is one
  if (!out.length) {
    for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>(?=([\s\S]{0,200}))/gi)) {
      const link = absolute(m[1].replace(/&amp;/g, '&'), pageUrl)
      if (!link || !PRESS_LINK.test(link) || DOC.test(link)) continue
      const after = stripTags(m[3]).slice(0, 60)
      push(stripTags(m[2]), link, parsePressDate(after))
    }
  }
  return out.slice(0, 35)
}
