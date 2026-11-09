import { describe, expect, it } from 'vitest'
import { contactsFromRows, groupNamesOf, parseCsv, parseGroupLabel, readableGroupName, statusOf } from '../../src/outreach/directory'
import { buildMessage, mentionsAttachment, missingFields, sectorName, skipReason } from '../../src/outreach/compose'
import { eligible, followUpLetter, followUpQueue, followUpReason, inAudience, resultsCsv } from '../../src/outreach/campaign'
import { letterChecks, unsourcedNumbers } from '../../src/outreach/checks'
import { OUTREACH_BLUEPRINTS, quoteInSource, suggestBlueprint } from '../../src/outreach/outreachAi'
import { directContacts, newCampaign, normalize, overlay } from '../../src/outreach/outreachStore'
import type { Contact, Source } from '../../src/outreach/types'

// synthetic rows only — example.com addresses, no real people
const rows = [
  ['Outreach list'],
  [],
  ['SL', 'Sector Group', 'Organization', 'Person Name', 'Designation', 'Email Address', 'Purpose', 'Deliverability Status'],
  ['GROUP 1: POWER GENERATION'],
  ['1', '', 'Example Power Co.', 'A. Rahman', 'Managing Director', 'MD@Example.com', 'MAGAZINE_DISTRIBUTION, SPONSORSHIP', 'SAFE_TO_SEND'],
  ['2', 'GROUP 2', 'Sample Gas Ltd.', '', 'Chief Engineer', 'ce@example.org; alt@example.org', 'SPONSORSHIP', 'REVIEW_REQUIRED'],
  ['3', 'GROUP 2', 'Test Grid', 'C. Hossain', '', 'planning@example.net', '', ''],
  ['4', 'GROUP 2', 'Dup Co.', 'D', 'X', 'md@example.com', '', 'SAFE_TO_SEND'],
  ['5', 'GROUP 2', 'Bad Co.', 'E', 'Y', 'not-an-address', '', 'SAFE_TO_SEND'],
  ['6', 'GROUP 2', 'Gone Co.', 'F', 'Z', 'f@nomail.example.com', '', 'DEAD_NO_DNS'],
]

describe('Directory: only what the sheet says', () => {
  const { contacts, skipped, duplicates } = contactsFromRows(rows)
  it('finds the header, keeps group banners, takes the first valid address, drops repeats', () => {
    expect(contacts.map((c) => c.email)).toEqual(['md@example.com', 'ce@example.org', 'planning@example.net', 'f@nomail.example.com'])
    expect(contacts[0].sectorGroup).toBe('Power Generation')
    expect(contacts[0].groupNo).toBe(1)
    expect(contacts[1].groupNo).toBe(2)
    expect(contacts[1].sectorGroup).toBe('')
    expect(skipped).toBe(1)
    expect(duplicates).toBe(1)
  })
  it('never invents a name, an organisation or a safe status', () => {
    expect(contacts[1].personName).toBe('')
    expect(contacts[2].mxStatus).toBe('UNKNOWN')
    expect(contacts[1].mxStatus).toBe('REVIEW_REQUIRED')
    expect(contacts[0].purposes).toEqual(['MAGAZINE_DISTRIBUTION', 'SPONSORSHIP'])
  })
  it("maps the workbook's own status words", () => {
    expect(statusOf('DEAD_NO_DNS')).toBe('UNDELIVERABLE')
    expect(statusOf('A_RECORD_FALLBACK')).toBe('REVIEW_REQUIRED')
    expect(statusOf('ELIGIBLE')).toBe('REVIEW_REQUIRED')
    expect(statusOf('NOT_RELEVANT')).toBe('EXCLUDED')
    expect(statusOf('TECHNICAL_ONLY')).toBe('TECHNICAL_ONLY')
    expect(statusOf('SAFE_TO_SEND')).toBe('SAFE_TO_SEND')
    expect(statusOf('')).toBe('UNKNOWN')
    expect(statusOf('maybe')).toBe('UNKNOWN')
  })
  it('reads group names from the summary sheet first, then from banners, and a banner above the header', () => {
    expect(parseGroupLabel('GROUP 3: TRANSMISSION — (17 leads)')).toEqual([3, 'TRANSMISSION'])
    expect(parseGroupLabel('Group 4')).toEqual([4, ''])
    expect(readableGroupName('POWER GENERATION AND TRANSMISSION (PGCB / NLDC)')).toBe('Power Generation and Transmission (PGCB / NLDC)')
    const summary = { name: 'Summary', rows: [['Group #', 'Industry / Sectoral Group Name', 'Leads'], ['GROUP 1', 'Power Generation Utilities', '2'], ['GROUP 2', 'Gas & Petroleum', '4']] }
    const sheet = { name: 'Safe', rows: [['GROUP 9: BANNER NAME'], ['Email', 'Organization'], ['x@example.com', 'X'], ['GROUP 1: OTHER WORDS'], ['Email', 'Organization'], ['y@example.com', 'Y']] }
    const names = groupNamesOf([summary, sheet])
    expect(names.get(1)).toBe('Power Generation Utilities')
    expect(names.get(9)).toBe('Banner Name')
    const r = contactsFromRows(sheet.rows, names, 'Safe')
    expect(r.contacts.map((c) => [c.email, c.groupNo, c.sectorGroup, c.sheet])).toEqual([['x@example.com', 9, 'Banner Name', 'Safe'], ['y@example.com', 1, 'Power Generation Utilities', 'Safe']])
  })
  it('keeps the sheet’s diagnostic note', () => {
    const r = contactsFromRows([['Email', 'Diagnostic Issue & Recommended Action'], ['a@example.com', 'No MX record — verify by phone']])
    expect(r.contacts[0].diagnostic).toBe('No MX record — verify by phone')
  })
  it('reads CSV with quoted commas and doubled quotes', () => {
    expect(parseCsv('Email,Organization\r\nx@example.com,"Power, Gas ""and"" Grid"\r\n')).toEqual([['Email', 'Organization'], ['x@example.com', 'Power, Gas "and" Grid']])
  })
  it('refuses a sheet with no Email column', () => {
    expect(() => contactsFromRows([['Name', 'Phone'], ['A', '1']])).toThrow(/Email/)
  })
})

describe('Compose: who the batch sends to, and what they get', () => {
  const { contacts } = contactsFromRows(rows)
  const subject = 'For {organization}'
  const body = 'Dear {name},\n\nAs {designation} at {organization} you may find the attached brief useful.'
  it('sends only to SAFE (or approved) rows that can fill every placeholder', () => {
    expect(eligible(contacts, subject, body).map((c) => c.email)).toEqual(['md@example.com'])
    expect(skipReason(contacts[1], subject, body)).toMatch(/review/)
    expect(skipReason({ ...contacts[2], approved: true }, subject, body)).toBe('Missing designation')
    expect(skipReason({ ...contacts[1], approved: true }, subject, body)).toBeNull()
  })
  it('never sends to an address with no mail server, even when approved', () => {
    expect(skipReason({ ...contacts[3], approved: true }, subject, body)).toMatch(/No mail server.*bounce/)
  })
  it('greets a nameless row as Sir/Madam (মহোদয় in Bangla) and adds the opt-out line', () => {
    const m = buildMessage(contacts[1], subject, body, 'en')
    expect(m.body.startsWith('Dear Sir/Madam,')).toBe(true)
    expect(m.optOut).toMatch(/reply with "unsubscribe"/)
    expect(buildMessage(contacts[1], subject, 'শ্রদ্ধেয় {name},', 'bn').body.startsWith('শ্রদ্ধেয় মহোদয়,')).toBe(true)
    expect(missingFields(contacts[1], subject, body)).toEqual([])
  })
  it('never sends twice, or to someone who opted out', () => {
    const c = contacts[0] as Contact
    expect(skipReason({ ...c, status: 'SENT' }, subject, body)).toBe('Already sent')
    expect(skipReason({ ...c, status: 'OPTED_OUT' }, subject, body)).toMatch(/not to be emailed/)
  })
  it('{sector} reads as a sector name, never as "GROUP 1"', () => {
    expect(sectorName('GROUP 1: POWER GENERATION AND TRANSMISSION')).toBe('Power Generation and Transmission')
    expect(sectorName('GROUP 2')).toBe('')
    expect(buildMessage(contacts[0], 'x', 'In {sector}.', 'en').body).toBe('In Power Generation.')
  })
  it('notices a letter that promises an attachment', () => {
    expect(mentionsAttachment(body)).toBe(true)
    expect(mentionsAttachment('সংযুক্ত করা হলো')).toBe(true)
    expect(mentionsAttachment('Dear {name}, hello.')).toBe(false)
  })
})

/** One CSV line into its cells (quoted cells may hold commas). */
const cells = (line: string) => [...line.matchAll(/("(?:[^"]|"")*"|[^,]*)(,|$)/g)].slice(0, -1).map((x) => (x[1].startsWith('"') ? x[1].slice(1, -1).replace(/""/g, '"') : x[1]))

describe('Campaigns: audience, typed addresses, results', () => {
  const { contacts } = contactsFromRows(rows)
  it('an audience narrows by group and by purpose', () => {
    expect(contacts.filter((c) => inAudience(c, { group: 2, purposes: [] })).map((c) => c.email)).toEqual(['ce@example.org', 'planning@example.net', 'f@nomail.example.com'])
    expect(contacts.filter((c) => inAudience(c, { group: null, purposes: ['SPONSORSHIP'] })).map((c) => c.email)).toEqual(['md@example.com', 'ce@example.org'])
  })
  it('typed addresses are the editor’s own choice: approved, with nothing invented about them', () => {
    const [d] = directContacts(['someone@example.com'])
    expect(d.approved).toBe(true)
    expect(d.personName).toBe('')
    expect(skipReason(d, 'Hello', 'Dear {name},')).toBeNull()
    expect(skipReason(d, 'Hello', 'As {designation}')).toBe('Missing designation')
  })
  it('a campaign’s results lay over the list, and the CSV says what happened to everyone in the audience', () => {
    const c = newCampaign({ subject: 'For {organization}', body: 'Dear {name}, as {designation}…', sent: { 'md@example.com': Date.UTC(2026, 9, 28, 6) }, failed: { 'ce@example.org': 'Mailbox full' } })
    const over = overlay(contacts, { approved: ['ce@example.org'], optOut: ['planning@example.net'] }, c, null)
    expect(over.map((x) => x.status)).toEqual(['SENT', 'FAILED', 'OPTED_OUT', 'QUEUED'])
    const csv = resultsCsv(c, over).trim().split('\r\n')
    const head = cells(csv[0])
    expect(head).toEqual(['Email', 'Name', 'Designation', 'Organization', 'Group', 'Sheet status', 'Result', 'Detail', 'Sent at', 'Sent from', 'Opened (human, approx.)', 'First opened', 'Last opened', 'Machine open', 'Clicked', 'Links clicked', 'Replied', 'Bounced', 'Bounce reason', 'Failed (server said)', 'Opted out', 'Followed up', 'Tracked'])
    const col = (line: string, name: string) => cells(line)[head.indexOf(name)]
    expect(csv[1]).toMatch(/^md@example\.com,A\. Rahman,/)
    expect(col(csv[1], 'Result')).toBe('Sent')
    expect(col(csv[1], 'Sent at')).toBe('2026-10-28T06:00:00.000Z')
    expect(col(csv[1], 'Sent from')).toBe('This PC')
    // sent with no tracking key: said plainly, never shown as "not opened"
    expect(col(csv[1], 'Tracked')).toBe('no')
    expect(col(csv[1], 'Opened (human, approx.)')).toBe('')
    expect(col(csv[2], 'Result')).toBe('Failed')
    expect(col(csv[2], 'Failed (server said)')).toBe('Mailbox full')
    expect(col(csv[3], 'Result')).toBe('Opted out')
    // the sheet's DEAD_NO_DNS: no mail server, so "Not an email" with the reason, not a generic "Skipped"
    expect(col(csv[4], 'Result')).toBe('Not an email')
    expect(col(csv[4], 'Detail')).toMatch(/^No mail server for nomail\.example\.com \(DNS\)/)
  })
  it('opens and clicks from the site lay over a sent letter: approximate, with times, counts and links', () => {
    const c = newCampaign({ subject: 'S', body: 'Dear {name},', sent: { 'md@example.com': Date.UTC(2026, 9, 28, 6) }, tracking: { 'campaign:md@example.com': 'A'.repeat(22) } })
    const over = overlay(contacts, { approved: ['ce@example.org'], optOut: [] }, c, null)
    const t1 = Date.UTC(2026, 9, 28, 7), t2 = Date.UTC(2026, 9, 29, 9)
    const csv = resultsCsv(c, over, { 'md@example.com': { opens: 2, firstOpen: t1, lastOpen: t2, clicks: 1, links: [{ link: 'esbpowerline.com/magazine', n: 1 }], firstClick: t2, lastClick: t2 } }).trim().split('\r\n')
    const head = cells(csv[0])
    const col = (name: string) => cells(csv[1])[head.indexOf(name)]
    expect(col('Result')).toBe('Clicked')
    expect(col('Opened (human, approx.)')).toBe('yes')
    expect(col('Machine open')).toBe('')
    expect(col('First opened')).toBe(new Date(t1).toISOString())
    expect(col('Links clicked')).toBe('esbpowerline.com/magazine (1)')
    expect(col('Tracked')).toBe('yes')
  })
  it('replies and bounces read from the inbox lay over the list: a bounced address is never written to again', () => {
    const c = newCampaign({ sent: { 'md@example.com': 1, 'ce@example.org': 1 }, replied: { 'md@example.com': 5 }, bounced: { 'ce@example.org': '550 No such user' } })
    const over = overlay(contacts, { approved: ['ce@example.org'], optOut: [], bouncedAddrs: { 'planning@example.net': '550 gone' } }, c, null)
    expect(over.map((x) => x.status)).toEqual(['REPLIED', 'BOUNCED', 'BOUNCED', 'QUEUED'])
    expect(skipReason(over[2], 'x', 'y')).toMatch(/^Bounced earlier \(550 gone\)/)
    expect(skipReason(over[0], 'x', 'y')).toBe('Already replied')
  })
  it('a follow-up goes after N days only to those who have not replied, bounced, opted out or had one', () => {
    const day = 24 * 3600_000, now = Date.UTC(2026, 10, 10)
    const c = newCampaign({ subject: 'Magazine for {organization}', lang: 'en', followUp: { afterDays: 5, subject: '', body: '' },
      sent: { 'md@example.com': now - 6 * day, 'ce@example.org': now - 6 * day, 'planning@example.net': now - 2 * day, 'f@nomail.example.com': now - 9 * day },
      replied: { 'ce@example.org': now - 4 * day }, followed: { 'f@nomail.example.com': now - day } })
    const over = overlay(contacts, { approved: [], optOut: [] }, c, null)
    expect(followUpLetter(c).subject).toBe('Re: Magazine for {organization}')
    expect(followUpReason(over[1], c, now)).toBe('Replied')
    expect(followUpReason(over[2], c, now)).toMatch(/^Due /)
    expect(followUpReason(over[3], c, now)).toBe('Already followed up')
    const q = followUpQueue(over, c, now)
    expect(q.due.map((x) => x.email)).toEqual(['md@example.com'])
    expect(q.later).toBe(1)
  })
  it('a batch running when the app closed comes back paused and marked, to be continued by the editor — never on its own', () => {
    const old = { ...newCampaign(), status: 'sending', interrupted: 'followup' } as ReturnType<typeof newCampaign>
    expect(normalize(old)).toMatchObject({ status: 'paused', interrupted: 'followup' })
    // a campaign saved by the previous version gains the new fields
    const v1 = { ...newCampaign() } as Partial<ReturnType<typeof newCampaign>>
    delete v1.replied; delete v1.followUp; delete v1.interrupted
    expect(normalize(v1 as ReturnType<typeof newCampaign>)).toMatchObject({ replied: {}, interrupted: null, followUp: { afterDays: 5 } })
  })
  it('the audience’s purposes point to a blueprint', () => {
    expect(suggestBlueprint(contacts)?.id).toBe('corporate_sponsorship')
    expect(suggestBlueprint(contacts, ['MAGAZINE_DISTRIBUTION'])?.id).toBe('magazine_distribution')
    expect(suggestBlueprint([])).toBeNull()
  })
})

describe('Checks and the facts rule', () => {
  const src: Source = { id: 's', kind: 'text', title: 'Note', text: 'The plant added 1,200 MW in 2025 and supplies 40% of the region.', points: [], addedAt: 0 }
  it('figures not found in any source are named; figures that are, are not', () => {
    expect(unsourcedNumbers('It added 1,200 MW in 2025, about 40%.', [src])).toEqual([])
    expect(unsourcedNumbers('It added 1,500 MW, reaching 3 million homes.', [src])).toEqual(['1,500'])
    expect(unsourcedNumbers('Visit https://esbpowerline.com/articles/2026-x', [])).toEqual([])
  })
  it('a talking point’s quote must be the source’s own words', () => {
    expect(quoteInSource('The plant added 1,200 MW in 2025', src.text)).toBe(true)
    expect(quoteInSource('The plant added 1,500 MW in 2025', src.text)).toBe(false)
    expect(quoteInSource('added', src.text)).toBe(false)
  })
  it('the fixed checks catch what a filter or an official would', () => {
    const ids = (l: ReturnType<typeof letterChecks>) => l.filter((x) => x.level !== 'ok').map((x) => x.id)
    const bad = letterChecks({ subject: 'FREE OFFER!!', body: 'Dear {nme}, act now. Please find the brochure attached. We reach 90,000 readers. http://example.com', signature: '', attachments: [], sources: [] })
    expect(ids(bad)).toEqual(expect.arrayContaining(['placeholders', 'spam', 'caps', 'bang', 'http', 'attach', 'numbers', 'length']))
    const good = letterChecks({ subject: 'ESB Power Line magazine for {organization}', body: Array(12).fill('We would be glad to send {organization} the magazine each month.').join(' '), signature: 'With best regards', attachments: [], sources: [] })
    expect(ids(good)).toEqual([])
  })
})

describe('Blueprints', () => {
  it('every letter has English and Bangla and uses only the four placeholders', () => {
    for (const b of OUTREACH_BLUEPRINTS) {
      for (const t of [b.defaultSubject, b.defaultBody, b.bengaliSubject, b.bengaliBody]) {
        expect(t).toBeTruthy()
        expect([...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).every((p) => ['name', 'designation', 'organization', 'sector'].includes(p))).toBe(true)
      }
    }
  })
})
