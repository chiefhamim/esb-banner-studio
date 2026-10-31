// The weekly digest (W4): which published stories fall in a range (Dhaka days, both ends included), their order,
// one per slug, and the letter it becomes — rendered through the composer's own blocksToHtml so escaping is the real
// one. Every record is synthetic; links are example.com-style article paths on a test host.
import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain ESM shared with the main process, no type declarations
import { blocksToHtml } from '../../electron/email-html.mjs'
import {
  IMAGE_MARK, assembleDigest, defaultIntro, dhakaDay, dhakaDayStart, emptyWeek, moveItem, oneLine, presetRange, rangeBounds, rangeLabel, storiesInRange,
} from '../../src/editorial/digest'
import type { DigestItem, QueueLike } from '../../src/editorial/digest'
import type { PublishRecord } from '../../src/editorial/insights'

const URL = (slug: string) => `https://news.example.com/articles/${slug}`
const rec = (slug: string, publishedAt: string, over: Partial<PublishRecord> = {}): PublishRecord => ({
  storyId: 'id-' + slug, slug, url: URL(slug), headline: 'Headline ' + slug, categoryId: '01', format: 'web', publishedAt, dryRun: false, ...over,
})
const queued = (id: string, slug: string, updatedAt: number, over: Partial<QueueLike> = {}): QueueLike => ({
  id, status: 'published', updatedAt, publishedUrl: URL(slug), publishedSlug: slug, snapshot: { draft: { headline: 'Queue ' + slug, deck: 'Deck of ' + slug } }, ...over,
})
const WEEK = { from: '2026-10-26', to: '2026-11-01' }

describe('digest: Dhaka days', () => {
  it('a day starts at midnight in Dhaka (18:00 UTC the day before)', () => {
    expect(new Date(dhakaDayStart('2026-11-01')).toISOString()).toBe('2026-10-31T18:00:00.000Z')
    expect(dhakaDay(Date.parse('2026-10-31T17:59:59.999Z'))).toBe('2026-10-31')
    expect(dhakaDay(Date.parse('2026-10-31T18:00:00.000Z'))).toBe('2026-11-01')
    expect(Number.isNaN(dhakaDayStart('1 Nov'))).toBe(true)
  })
  it('a range covers both whole end days and refuses a backwards one', () => {
    const [a, b] = rangeBounds(WEEK)!
    expect(new Date(a).toISOString()).toBe('2026-10-25T18:00:00.000Z')
    expect(new Date(b).toISOString()).toBe('2026-11-01T17:59:59.999Z')
    expect(rangeBounds({ from: '2026-11-02', to: '2026-11-01' })).toBeNull()
  })
  it('presets: this week from Sunday, last 7 and last 30 days ending today (Dhaka)', () => {
    const now = Date.parse('2026-11-04T20:00:00Z') // Thu 5 Nov 02:00 in Dhaka
    expect(presetRange('week', now)).toEqual({ from: '2026-11-01', to: '2026-11-05' })
    expect(presetRange('last7', now)).toEqual({ from: '2026-10-30', to: '2026-11-05' })
    expect(presetRange('last30', now)).toEqual({ from: '2026-10-07', to: '2026-11-05' })
    // on a Sunday "this week" is today only
    expect(presetRange('week', Date.parse('2026-11-01T06:00:00Z'))).toEqual({ from: '2026-11-01', to: '2026-11-01' })
  })
  it('labels a range the short way', () => {
    expect(rangeLabel(WEEK)).toBe('26 Oct – 1 Nov 2026')
    expect(rangeLabel({ from: '2026-11-01', to: '2026-11-07' })).toBe('1 – 7 Nov 2026')
    expect(rangeLabel({ from: '2026-11-01', to: '2026-11-01' })).toBe('1 Nov 2026')
    expect(rangeLabel({ from: '2025-12-29', to: '2026-01-04' })).toBe('29 Dec 2025 – 4 Jan 2026')
  })
})

describe('digest: which stories', () => {
  it('includes both boundaries, in Dhaka time, and nothing a millisecond outside', () => {
    const log = [
      rec('after', '2026-11-01T18:00:00.000Z'), // 2 Nov 00:00 Dhaka: out
      rec('last-ms', '2026-11-01T17:59:59.999Z'), // 1 Nov 23:59:59.999 Dhaka: in
      rec('first-ms', '2026-10-25T18:00:00.000Z'), // 26 Oct 00:00 Dhaka: in
      rec('before', '2026-10-25T17:59:59.999Z'), // 25 Oct 23:59 Dhaka: out
    ]
    expect(storiesInRange(log, [], WEEK).map((x) => x.slug)).toEqual(['last-ms', 'first-ms'])
  })
  it('newest first whatever order the log is in', () => {
    const log = [rec('b', '2026-10-28T10:00:00Z'), rec('c', '2026-10-30T10:00:00Z'), rec('a', '2026-10-27T10:00:00Z')]
    expect(storiesInRange(log, [], WEEK).map((x) => x.slug)).toEqual(['c', 'b', 'a'])
  })
  it('one entry per slug: the latest record wins', () => {
    const log = [rec('same', '2026-10-30T10:00:00Z', { headline: 'Updated headline' }), rec('same', '2026-10-27T10:00:00Z', { headline: 'First headline' })]
    const out = storiesInRange(log, [], WEEK)
    expect(out).toHaveLength(1)
    expect(out[0].headline).toBe('Updated headline')
  })
  it('test-run publishes are not published stories', () => {
    expect(storiesInRange([rec('dry', '2026-10-30T10:00:00Z', { dryRun: true })], [], WEEK)).toEqual([])
  })
  it('a queue item published with no log row comes in by its last edit, flagged as from the queue', () => {
    const q = [
      queued('q1', 'queue-only', Date.parse('2026-10-29T10:00:00Z')),
      queued('id-logged', 'logged', Date.parse('2026-10-31T10:00:00Z')), // has a log row: the log's is used
      queued('q3', 'draft-one', Date.parse('2026-10-29T10:00:00Z'), { status: 'approved' }),
      queued('q4', 'old', Date.parse('2026-09-01T10:00:00Z')),
    ]
    const out = storiesInRange([rec('logged', '2026-10-28T10:00:00Z')], q, WEEK)
    expect(out.map((x) => [x.slug, x.source])).toEqual([['queue-only', 'queue'], ['logged', 'log']])
    expect(out[0].headline).toBe('Queue queue-only')
    expect(out[0].publishedAt).toBe('2026-10-29T10:00:00.000Z')
  })
  it('decks from the queue copy, else the site list; pictures only from the site list and only https', () => {
    const q = [queued('id-a', 'a', 0, { status: 'draft' })]
    const site = [{ slug: 'b', description: 'Site deck of b', imageUrl: 'https://cdn.example.com/b.jpg' }, { slug: 'a', imageUrl: 'http://cdn.example.com/a.jpg' }]
    const out = storiesInRange([rec('a', '2026-10-30T10:00:00Z'), rec('b', '2026-10-29T10:00:00Z'), rec('c', '2026-10-28T10:00:00Z')], q, WEEK, site)
    expect(out.map((x) => x.deck)).toEqual(['Deck of a', 'Site deck of b', ''])
    expect(out.map((x) => x.imageUrl)).toEqual([undefined, 'https://cdn.example.com/b.jpg', undefined])
  })
  it('a record without an https link is left out (nothing to link to)', () => {
    expect(storiesInRange([rec('x', '2026-10-30T10:00:00Z', { url: 'javascript:alert(1)' })], [], WEEK)).toEqual([])
  })
  it('an empty week says so with its dates', () => {
    expect(storiesInRange([], [], WEEK)).toEqual([])
    expect(emptyWeek(WEEK)).toBe('No stories were published from this app between 26 Oct and 1 Nov 2026.')
  })
})

describe('digest: manual order', () => {
  it('moves one place up or down and clamps at the ends', () => {
    expect(moveItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b'])
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
    const l = ['a', 'b']
    expect(moveItem(l, 0, -1)).toBe(l)
    expect(moveItem(l, 1, 1)).toBe(l)
  })
})

const item = (slug: string, over: Partial<DigestItem> = {}): DigestItem => ({ slug, url: URL(slug), headline: 'Headline ' + slug, deck: 'Deck ' + slug, publishedAt: '2026-10-30T10:00:00Z', source: 'log', ...over })

describe('digest: the letter', () => {
  it('intro, then every headline, deck and link in the order given', () => {
    const { subject, body } = assembleDigest([item('two'), item('one')], { intro: 'Hello readers.', title: 'This week at ESB PowerLine — 26 Oct – 1 Nov 2026' })
    expect(subject).toBe('This week at ESB PowerLine — 26 Oct – 1 Nov 2026')
    expect(body).toBe([
      'Hello readers.',
      '## Headline two', `Deck two\n[Read the story](${URL('two')})`,
      '## Headline one', `Deck one\n[Read the story](${URL('one')})`,
    ].join('\n\n'))
    const html = blocksToHtml(body, 'Arial') as string
    const at = (s: string) => html.indexOf(s)
    expect(at('Hello readers.')).toBeGreaterThanOrEqual(0)
    expect(at('>Headline two</h3>')).toBeGreaterThan(at('Hello readers.'))
    expect(at(`href="${URL('two')}"`)).toBeGreaterThan(at('Deck two'))
    expect(at('>Headline one</h3>')).toBeGreaterThan(at(`href="${URL('two')}"`))
    expect(at(`href="${URL('one')}"`)).toBeGreaterThan(at('Deck one'))
  })
  it('a headline with <b> or & reaches the recipient as text, not markup', () => {
    const { body } = assembleDigest([item('x', { headline: 'Grid <b>bold</b> & co', deck: 'A <script>x</script> deck' })], { intro: '', title: 't' })
    const html = blocksToHtml(body, 'Arial') as string
    expect(html).toContain('Grid &lt;b&gt;bold&lt;/b&gt; &amp; co')
    expect(html).not.toContain('<b>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('A &lt;script&gt;x&lt;/script&gt; deck')
  })
  it('a newline in a deck or headline cannot start a heading or a list', () => {
    const { body } = assembleDigest([item('x', { headline: 'Line one\n\n## injected', deck: 'deck\n\n- bullet' })], { intro: '', title: 't' })
    expect(body).toBe(`## Line one ## injected\n\ndeck - bullet\n[Read the story](${URL('x')})`)
    expect(oneLine('  a \n b  ')).toBe('a b')
  })
  it('no deck line when the deck is unknown; no image line at all while the composer has no image mark', () => {
    expect(IMAGE_MARK).toBe(false)
    const { body } = assembleDigest([item('x', { deck: '' }), item('y', { imageUrl: 'https://cdn.example.com/y.jpg' })], { intro: '', title: 't' })
    expect(body).toBe(`## Headline x\n\n[Read the story](${URL('x')})\n\n## Headline y\n\nDeck y\n[Read the story](${URL('y')})`)
    expect(body).not.toContain('![')
    expect(body).not.toContain('cdn.example.com')
  })
  it('Bengali letters get a Bengali link label; the default intro names the range', () => {
    expect(assembleDigest([item('x')], { intro: '', title: 't', lang: 'bn' }).body).toContain('[পুরো খবর পড়ুন](')
    expect(defaultIntro(WEEK)).toBe('Here is what ESB PowerLine published, 26 Oct – 1 Nov 2026.')
  })
})
