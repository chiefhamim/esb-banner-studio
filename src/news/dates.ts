// News engine (shared, identical in ESB Studio PC src/news and ESB Studio Phone src/mobile/watch; tools/sync-pc.mjs news).
// Feed dates as Bangladesh portals actually write them. A bare Date.parse misreads most of them:
//   "Mon, 09 Nov 2026 10:00:00 BST"   BST is Bangladesh Standard Time (+06:00), which Date.parse does not know
//   "০৯ নভেম্বর ২০২৬, ১০:৩০"          Bangla digits and month names
//   "2026-11-09 10:30:00"             no zone: the portal means Dhaka time, not the reader's (or UTC)
//   "09-11-2026"                      day first, as Bangladesh writes it (Date.parse reads 11 September)
// Anything still unreadable is null: the item is then "time unknown" (see itemTimeMs / sortTimeMs), never "just now".

export const DHAKA_OFFSET = '+06:00'

const BN_DIGITS: Record<string, string> = { '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9' }

// spelling variants seen on portals; matched after NFC so precomposed and nukta forms of য় both work
const BN_MONTHS: [string[], string][] = [
  [['জানুয়ারি', 'জানুয়ারী', 'জানু'], 'Jan'],
  [['ফেব্রুয়ারি', 'ফেব্রুয়ারী', 'ফেব্রু'], 'Feb'],
  [['মার্চ'], 'Mar'],
  [['এপ্রিল'], 'Apr'],
  [['মে'], 'May'],
  [['জুন'], 'Jun'],
  [['জুলাই'], 'Jul'],
  [['আগস্ট', 'আগষ্ট'], 'Aug'],
  [['সেপ্টেম্বর', 'সেপ্টে'], 'Sep'],
  [['অক্টোবর', 'অক্টো'], 'Oct'],
  [['নভেম্বর', 'নভে'], 'Nov'],
  [['ডিসেম্বর', 'ডিসে'], 'Dec'],
]
const BN_LETTER = '[\\u0980-\\u09FF]'
const MONTH_RES: [RegExp, string][] = BN_MONTHS.map(([names, en]) => [
  // longest spelling first, so "নভেম্বর" is not read as "নভে" + "ম্বর"
  new RegExp(`(?<!${BN_LETTER})(?:${[...names].sort((a, b) => b.length - a.length).map((n) => n.normalize('NFC')).join('|')})${BN_LETTER}*`, 'g'),
  en,
])
const BN_WEEKDAY = /(?:শনি|রবি|সোম|মঙ্গল|বুধ|বৃহস্পতি|শুক্র)বার,?/g
const BN_LABEL = /^(?:প্রকাশ(?:িত)?|আপডেট|হালনাগাদ|published|updated|posted)\s*[:：]?\s*/i
const BN_PM = /(?:বিকাল|বিকেল|সন্ধ্যা|অপরাহ্ণ|অপরাহ্ন|দুপুর|রাত)/
const BN_AM = /(?:সকাল|ভোর|পূর্বাহ্ণ|পূর্বাহ্ন)/

/** Zone abbreviations Date.parse does not know, as offsets. BST on a Bangladesh portal is Bangladesh Standard Time. */
const ZONE_WORDS: Record<string, string> = { BST: '+0600', BDT: '+0600', DHAKA: '+0600', IST: '+0530' }
const HAS_ZONE = /(?:\b(?:GMT|UTC|UT|[ECMP][SD]T)\b|[+-]\d{2}:?\d{2}|\dZ)\s*$/i

export function bnToAsciiDigits(s: string): string {
  return s.replace(/[০-৯]/g, (d) => BN_DIGITS[d] ?? d)
}

/** The date text with Bangla digits, months, weekdays and times written the way Date.parse reads them. */
export function normalizeDateText(raw: string): string {
  let s = bnToAsciiDigits(raw.normalize('NFC')).replace(BN_LABEL, '').trim()
  for (const [re, en] of MONTH_RES) s = s.replace(re, ` ${en} `)
  s = s.replace(BN_WEEKDAY, ' ')
  // "সকাল ১০:৩০" / "রাত ৮টা" -> "10:30 AM" / "8:00 PM"
  const pm = BN_PM.test(s)
  const am = !pm && BN_AM.test(s)
  if (pm || am) {
    s = s.replace(new RegExp(BN_PM.source + '|' + BN_AM.source, 'g'), ' ')
    s = s.replace(/(\d{1,2})\s*টা/, '$1:00')
    const night = /রাত/.test(raw.normalize('NFC'))
    s = s.replace(/\b(\d{1,2}):(\d{2})(?::\d{2})?\b(?!\s*(?:AM|PM))/i, (m, h: string) => {
      const hour = Number(h)
      if (hour > 12 || hour === 0) return m // already a 24-hour time
      // "রাত ১টা" is one in the morning, "রাত ১২টা" midnight; "রাত ১০টা" ten at night; "দুপুর ১২টা" noon
      const amPm = am ? 'AM' : night && (hour < 5 || hour === 12) ? 'AM' : 'PM'
      return `${m} ${amPm}`
    })
  }
  s = s.replace(/[|،]/g, ' ').replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim()
  // a known zone word at the end becomes an offset
  s = s.replace(/\b(BST|BDT|IST|Dhaka)\s*$/i, (_, z: string) => ZONE_WORDS[z.toUpperCase()])
  return s
}

/**
 * A feed's date as an ISO string, or null when it cannot be read. A date without a zone is Dhaka time; a date without a
 * time is Dhaka midnight. Years before 2000 are treated as unreadable (a portal's placeholder, not a real date).
 */
export function parseFeedDate(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null
  let s = normalizeDateText(raw)
  if (!s) return null
  // Date.parse is lenient ("বিদ্যুৎ 2026" reads as 1 Jan 2026): a date needs a month name or a numeric date, and no
  // Bangla words left over after the months, weekdays and times were read
  if (/[ঀ-৿]/.test(s)) return null
  if (!/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/i.test(s) && !/\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(s)) return null
  // ISO without a zone
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?))?$/)
  if (iso) s = `${iso[1]}T${(iso[2] ?? '00:00:00').padStart(5, '0')}${DHAKA_OFFSET}`
  else {
    // day first: 09-11-2026, 9/11/2026 10:30, 09.11.2026
    const dmy = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(.*)$/)
    if (dmy && Number(dmy[1]) <= 31 && Number(dmy[2]) <= 12) {
      s = `${dmy[3]}/${dmy[2].padStart(2, '0')}/${dmy[1].padStart(2, '0')}${dmy[4]}`
    }
    if (!HAS_ZONE.test(s)) {
      if (!/\d{1,2}:\d{2}/.test(s)) s += ' 00:00'
      s += ' +0600'
    } else if (!/\d{1,2}:\d{2}/.test(s)) {
      // "9 Nov 2026 +0600" needs a time for Date.parse
      s = s.replace(/\s*([+-]\d{2}:?\d{2}|\b(?:GMT|UTC|UT)\b)\s*$/i, ' 00:00 $1')
    }
  }
  const t = Date.parse(s)
  if (Number.isNaN(t)) return null
  if (new Date(t).getUTCFullYear() < 2000) return null
  return new Date(t).toISOString()
}

/** Milliseconds of an ISO date, or null. */
export function isoMs(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) && t > 0 ? t : null
}

/**
 * Time an item counts as for age limits: its published time, else when it was first found. An undated item therefore
 * still ages out of the maxAge window (counted from when this app first saw it) instead of staying "new" forever.
 */
export function itemTimeMs(x: { published: string | null; foundAt: number }): number {
  return isoMs(x.published) ?? (x.foundAt || 0)
}

/** Time an item sorts by: undated ("time unknown") items sort after every dated one, never at the top as if fresh. */
export function sortTimeMs(x: { published: string | null }): number {
  return isoMs(x.published) ?? 0
}

/** True when the item is older than maxAgeMs at `now` (undated items count from when they were first found). */
export function olderThan(x: { published: string | null; foundAt: number }, now: number, maxAgeMs: number): boolean {
  return now - itemTimeMs(x) > maxAgeMs
}
