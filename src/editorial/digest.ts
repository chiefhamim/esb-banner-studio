// The weekly digest (W4): "This week at ESB PowerLine" — the stories this app published in a date range, assembled
// as an ordinary Outreach letter (the composer's own text-with-marks, see electron/email-html.mjs) and handed to the
// campaign flow as a draft. Pure: no storage, no network, no clock except what the caller passes in.
//
// - Which stories: the publish log first (insights.ts, written when a publish reached the site); a queue item marked
//   published with no log row is included by its last edit time and flagged `source: 'queue'`. Test-run (dry-run)
//   publishes are not published stories and are left out. One entry per slug: the headline and link of its latest
//   record, the date of its earliest — an Update (a typo fix) does not move a story out of the week it was published.
// - Days are newsroom days, Asia/Dhaka (UTC+6, no daylight saving), whatever zone the PC is set to: a range of
//   "1 Nov – 7 Nov" means 1 Nov 00:00 to 7 Nov 23:59:59.999 in Dhaka, both ends included.
// - Headlines and decks are data. They are written into the letter as plain text (whitespace collapsed to one line
//   so a stray newline cannot turn a deck into a heading or a list); the composer escapes every character before it
//   reads a mark, so a `<b>` or `&` in a headline reaches a recipient as text, never as markup.
// - Braces: the composer mail-merges `{name}`-style placeholders (compose.ts PLACEHOLDER_RE) and has no escape for
//   them, so `{` and `}` in a headline, deck or the intro become their full-width forms ｛ ｝ (U+FF5B / U+FF5D). They
//   read as braces, and a `{designation}` in a headline can no longer drop contacts or a `{name}` be merged.
// - Pictures: the letter's mark set has no image mark, so no picture line is ever written — an image URL the site
//   list knows is kept on the item (`imageUrl`) and nothing more. When the composer gains an image mark, flip
//   IMAGE_MARK and the line is added only for stories whose picture URL is known.

import type { PublishRecord } from './insights'

/** The composer (electron/email-html.mjs) has no image mark today. */
export const IMAGE_MARK = false

export const DIGEST_TITLE = 'This week at ESB PowerLine'

/** The fields of a queue item the digest reads (StoryItem from storyQueue.ts satisfies it). */
export interface QueueLike {
  id: string
  status: string
  updatedAt: number
  publishedUrl?: string
  publishedSlug?: string
  snapshot: { draft: { headline?: string; deck?: string } }
}

/** What the site's own list says about an article (LiveArticleSummary from siteApi.ts satisfies it). */
export interface SiteLike { slug: string; description?: string; imageUrl?: string }

export interface DigestItem {
  slug: string
  url: string
  headline: string
  /** The story's deck (standfirst); '' when none is known — the letter then has no deck line. */
  deck: string
  /** ISO time: the publish for log rows, the last edit for queue-only rows. */
  publishedAt: string
  source: 'log' | 'queue'
  storyId?: string
  /** A public https picture URL from the site's list, when it has one. Not written into the letter (see IMAGE_MARK). */
  imageUrl?: string
}

/** Calendar days in Dhaka, as YYYY-MM-DD (the DatePicker's own format). Both ends included. */
export interface DayRange { from: string; to: string }

const DHAKA_OFFSET_MS = 6 * 3_600_000
const DAY_MS = 86_400_000
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/** Midnight in Dhaka at the start of `day`, as epoch ms; NaN when it is not a YYYY-MM-DD day. */
export function dhakaDayStart(day: string): number {
  const m = ISO_DAY.exec(day)
  if (!m) return NaN
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - DHAKA_OFFSET_MS
}

/** The Dhaka calendar day an instant falls on, as YYYY-MM-DD. */
export function dhakaDay(t: number): string {
  return new Date(t + DHAKA_OFFSET_MS).toISOString().slice(0, 10)
}

/** [first ms, last ms] of a range, both inclusive; null when either end is not a day or the range runs backwards. */
export function rangeBounds(r: DayRange): [number, number] | null {
  const a = dhakaDayStart(r.from), b = dhakaDayStart(r.to)
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null
  return [a, b + DAY_MS - 1]
}

export type RangePreset = 'week' | 'last7' | 'last30'

/**
 * The range a preset names, on the day `now` falls on in Dhaka. "This week" starts on Sunday — the first column of
 * the app's calendar and the first working day in Bangladesh — and runs to today.
 */
export function presetRange(preset: RangePreset, now: number): DayRange {
  const today = dhakaDay(now)
  const start = dhakaDayStart(today)
  const weekday = new Date(start + DHAKA_OFFSET_MS).getUTCDay() // 0 = Sunday, in Dhaka
  const back = preset === 'week' ? weekday : preset === 'last7' ? 6 : 29
  return { from: dhakaDay(start - back * DAY_MS), to: today }
}

const fmt = (day: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(dhakaDayStart(day)).toLocaleDateString('en-GB', { timeZone: 'Asia/Dhaka', ...opts })

/** "26 Oct – 1 Nov 2026", "1 – 7 Nov 2026", "1 Nov 2026". */
export function rangeLabel(r: DayRange): string {
  if (!rangeBounds(r)) return ''
  const [fy, fm] = r.from.split('-'), [ty, tm] = r.to.split('-')
  const end = fmt(r.to, { day: 'numeric', month: 'short', year: 'numeric' })
  if (r.from === r.to) return end
  const start = fy !== ty ? fmt(r.from, { day: 'numeric', month: 'short', year: 'numeric' })
    : fm !== tm ? fmt(r.from, { day: 'numeric', month: 'short' })
    : fmt(r.from, { day: 'numeric' })
  return `${start} – ${end}`
}

/** One line of plain text: newlines and runs of spaces collapse, so data can never start a new block. */
export const oneLine = (s: string | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim()

/** Braces as full-width forms, so the composer's placeholder fill never sees one in data. */
export const noPlaceholders = (s: string) => s.replace(/\{/g, '｛').replace(/\}/g, '｝')

// no braces in a link either: one inside a URL would be mail-merged too
const httpsUrl = (u: string | undefined) => (/^https:\/\/[^\s"'<>{}]+$/i.test(u ?? '') ? u! : '')
const slugOf = (url: string | undefined) => /\/articles\/([^/?#]+)/.exec(url ?? '')?.[1] ?? ''

/**
 * The published stories in a range, newest first, one per slug: headline and link from its latest record, date from
 * its earliest (so it stays in the week it was first published, whether the log holds one merged record per slug or
 * one per Update). Decks come from the queue's own copy of the story, else the site's list; pictures from the site's
 * list only.
 */
export function storiesInRange(log: PublishRecord[], queue: QueueLike[], range: DayRange, site: SiteLike[] = []): DigestItem[] {
  const b = rangeBounds(range)
  if (!b) return []
  const [lo, hi] = b
  const inRange = (t: number) => Number.isFinite(t) && t >= lo && t <= hi
  const siteBySlug = new Map(site.filter((x) => x.slug).map((x) => [x.slug, x]))
  const queueSlug = (q: QueueLike) => q.publishedSlug || slugOf(q.publishedUrl)
  const deckFor = (storyId: string | undefined, slug: string) => {
    const q = queue.find((x) => (storyId && x.id === storyId) || (slug && queueSlug(x) === slug))
    return oneLine(q?.snapshot?.draft?.deck) || oneLine(siteBySlug.get(slug)?.description)
  }
  const withSite = (it: DigestItem): DigestItem => {
    const img = httpsUrl(siteBySlug.get(it.slug)?.imageUrl)
    return img ? { ...it, imageUrl: img } : it
  }

  // one entry per slug: the latest record's headline and link (`latest`), the earliest record's date (`publishedAt`)
  const bySlug = new Map<string, DigestItem & { latest: number }>()
  const logged = new Set<string>()
  const loggedIds = new Set<string>()
  for (const r of log) {
    if (r.dryRun || !r.slug) continue
    logged.add(r.slug)
    if (r.storyId) loggedIds.add(r.storyId)
    const url = httpsUrl(r.url)
    const t = Date.parse(r.publishedAt)
    if (!url || !Number.isFinite(t)) continue
    const cur = bySlug.get(r.slug)
    const first = cur && Date.parse(cur.publishedAt) <= t ? cur.publishedAt : r.publishedAt
    if (!cur || t > cur.latest) {
      bySlug.set(r.slug, { slug: r.slug, url, headline: oneLine(r.headline), deck: deckFor(r.storyId, r.slug), publishedAt: first, source: 'log', ...(r.storyId ? { storyId: r.storyId } : {}), latest: t })
    } else cur.publishedAt = first
  }
  const all: DigestItem[] = [...bySlug.values()].map(({ latest: _latest, ...it }) => it)
  for (const q of queue) {
    if (q.status !== 'published') continue
    const url = httpsUrl(q.publishedUrl)
    const slug = queueSlug(q)
    if (!url || !slug || logged.has(slug) || loggedIds.has(q.id) || all.some((x) => x.slug === slug)) continue
    all.push({ slug, url, headline: oneLine(q.snapshot?.draft?.headline), deck: deckFor(q.id, slug), publishedAt: new Date(q.updatedAt).toISOString(), source: 'queue', storyId: q.id })
  }
  return all
    .filter((it) => it.headline && inRange(Date.parse(it.publishedAt)))
    .sort((a, z) => Date.parse(z.publishedAt) - Date.parse(a.publishedAt))
    .map(withSite)
}

/** The list with the item at `index` moved by `delta` places (clamped); the same list when it cannot move. */
export function moveItem<T>(list: T[], index: number, delta: number): T[] {
  const to = Math.max(0, Math.min(list.length - 1, index + delta))
  if (index < 0 || index >= list.length || to === index) return list
  const next = [...list]
  const [x] = next.splice(index, 1)
  next.splice(to, 0, x)
  return next
}

const READ_LABEL = { en: 'Read the story', bn: 'পুরো খবর পড়ুন' } as const

/** The intro the dialog starts from; the editor's own words replace it. */
export function defaultIntro(r: DayRange): string {
  return `Here is what ESB PowerLine published, ${rangeLabel(r)}.`
}

/**
 * The letter: the intro paragraph, then for each story (in the order given) its headline as a heading, the deck and
 * a link to the story. `title` is the subject. Returns the composer's marks, never HTML.
 */
export function assembleDigest(items: DigestItem[], opts: { intro: string; title: string; lang?: 'en' | 'bn' }): { subject: string; body: string } {
  const read = READ_LABEL[opts.lang === 'bn' ? 'bn' : 'en']
  const blocks: string[] = []
  const intro = noPlaceholders(String(opts.intro ?? '').replace(/\r\n?/g, '\n').trim())
  if (intro) blocks.push(intro)
  for (const it of items) {
    const url = httpsUrl(it.url)
    const headline = noPlaceholders(oneLine(it.headline))
    if (!url || !headline) continue
    blocks.push(`## ${headline}`)
    const img = IMAGE_MARK ? httpsUrl(it.imageUrl) : ''
    if (img) blocks.push(`![${headline}](${img})`)
    const deck = noPlaceholders(oneLine(it.deck))
    blocks.push([deck, `[${read}](${url})`].filter(Boolean).join('\n'))
  }
  return { subject: noPlaceholders(oneLine(opts.title)), body: blocks.join('\n\n') }
}

/** What the dialog says when the range has no published stories. */
export function emptyWeek(r: DayRange): string {
  const label = rangeLabel(r)
  return label ? `No stories were published from this app between ${label.replace(' – ', ' and ')}.` : 'Pick a start day on or before the end day.'
}
