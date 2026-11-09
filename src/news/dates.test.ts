// News engine (shared, identical in both apps): feed dates as Bangladesh portals write them.
import { describe, expect, it } from 'vitest'
import { itemTimeMs, olderThan, parseFeedDate, sortTimeMs } from './dates'

describe('parseFeedDate', () => {
  it.each([
    ['Mon, 09 Nov 2026 10:00:00 +0600', '2026-11-09T04:00:00.000Z'],
    ['Mon, 09 Nov 2026 10:00:00 GMT', '2026-11-09T10:00:00.000Z'],
    ['Mon, 09 Nov 2026 10:00:00 BST', '2026-11-09T04:00:00.000Z'],
    ['2026-11-09T10:00:00Z', '2026-11-09T10:00:00.000Z'],
    ['2026-11-09T10:00:00+06:00', '2026-11-09T04:00:00.000Z'],
    // no zone: Dhaka time, whatever the computer's zone
    ['2026-11-09 10:30:00', '2026-11-09T04:30:00.000Z'],
    ['Mon, 09 Nov 2026 10:00:00', '2026-11-09T04:00:00.000Z'],
    ['2026-11-09', '2026-11-08T18:00:00.000Z'],
    ['09-11-2026 10:00', '2026-11-09T04:00:00.000Z'],
    // Bangla digits, months, weekdays, times of day
    ['০৯ নভেম্বর ২০২৬, ১০:৩০', '2026-11-09T04:30:00.000Z'],
    ['সোমবার, ৯ নভেম্বর ২০২৬', '2026-11-08T18:00:00.000Z'],
    ['প্রকাশ: ০৯ নভেম্বর ২০২৬, বিকাল ০৪:১৫', '2026-11-09T10:15:00.000Z'],
    ['৯ মে ২০২৬, রাত ১১:০০', '2026-05-09T17:00:00.000Z'],
    ['৯ জানুয়ারি ২০২৬ সকাল ৯:০৫', '2026-01-09T03:05:00.000Z'],
    ['২০২৬-১১-০৯ ১০:৩০:০০', '2026-11-09T04:30:00.000Z'],
  ])('%s', (raw, iso) => {
    expect(parseFeedDate(raw)).toBe(iso)
  })
  it('gives null for what it cannot read, never "now"', () => {
    expect(parseFeedDate('')).toBeNull()
    expect(parseFeedDate('কিছুক্ষণ আগে')).toBeNull()
    expect(parseFeedDate('0000-00-00 00:00:00')).toBeNull()
    expect(parseFeedDate(null)).toBeNull()
    expect(parseFeedDate('বিদ্যুৎ 2026')).toBeNull()
    expect(parseFeedDate('প্রধানমন্ত্রীর কার্যালয় সংক্রান্ত')).toBeNull()
  })
})

describe('undated items', () => {
  const T = Date.parse('2026-11-09T12:00:00Z')
  it('age from when they were first found, so maxAge still drops them', () => {
    const x = { published: null, foundAt: T - 30 * 3600_000 }
    expect(itemTimeMs(x)).toBe(T - 30 * 3600_000)
    expect(olderThan(x, T, 24 * 3600_000)).toBe(true)
    expect(olderThan({ published: null, foundAt: T - 3600_000 }, T, 24 * 3600_000)).toBe(false)
  })
  it('sort after every dated item instead of at the top as if fresh', () => {
    expect(sortTimeMs({ published: null })).toBeLessThan(sortTimeMs({ published: '2020-01-01T00:00:00Z' }))
  })
})
