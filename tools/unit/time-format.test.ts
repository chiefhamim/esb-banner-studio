import { afterEach, describe, expect, it } from 'vitest'
import { useShellStore, systemClock } from '../../src/shell/shellStore'
import { clockFormat, fmtDateTime, fmtHm, fmtHour, fmtShortTime, fmtTime, fmtWallClock } from '../../src/ui/time'

// 2026-11-01 is a Sunday. Dhaka is UTC+6 all year.
const at = (h: number, m: number, s = 0) => Date.UTC(2026, 10, 1, h - 6, m, s) // h:m in Dhaka
const DHAKA = { tz: 'Asia/Dhaka' }
const set = (c: '12h' | '24h') => useShellStore.getState().setClock(c)

afterEach(() => set('24h'))

describe('time format preference', () => {
  it('defaults to the system hour cycle and follows the setting', () => {
    expect(['12h', '24h']).toContain(systemClock())
    set('12h'); expect(clockFormat()).toBe('12h')
    set('24h'); expect(clockFormat()).toBe('24h')
  })
})

describe('fmtTime', () => {
  it('24-hour: zero-padded hours, no AM/PM', () => {
    set('24h')
    expect(fmtTime(at(16, 58), DHAKA)).toBe('16:58')
    expect(fmtTime(at(9, 5), DHAKA)).toBe('09:05')
  })
  it('12-hour: no leading zero, uppercase AM/PM after a normal space', () => {
    set('12h')
    expect(fmtTime(at(16, 58), DHAKA)).toBe('4:58 PM')
    expect(fmtTime(at(9, 5), DHAKA)).toBe('9:05 AM')
  })
  it('midnight and noon', () => {
    set('24h')
    expect(fmtTime(at(0, 0), DHAKA)).toBe('00:00')
    expect(fmtTime(at(12, 0), DHAKA)).toBe('12:00')
    expect(fmtTime(at(23, 59), DHAKA)).toBe('23:59')
    set('12h')
    expect(fmtTime(at(0, 0), DHAKA)).toBe('12:00 AM')
    expect(fmtTime(at(0, 30), DHAKA)).toBe('12:30 AM')
    expect(fmtTime(at(12, 0), DHAKA)).toBe('12:00 PM')
    expect(fmtTime(at(11, 59), DHAKA)).toBe('11:59 AM')
    expect(fmtTime(at(23, 59), DHAKA)).toBe('11:59 PM')
  })
  it('seconds option', () => {
    expect(fmtTime(at(16, 58, 7), { ...DHAKA, seconds: true, clock: '24h' })).toBe('16:58:07')
    expect(fmtTime(at(16, 58, 7), { ...DHAKA, seconds: true, clock: '12h' })).toBe('4:58:07 PM')
  })
  it('keeps the zone it is given', () => {
    const t = Date.UTC(2026, 10, 1, 10, 58) // 10:58 UTC
    expect(fmtTime(t, { tz: 'UTC', clock: '24h' })).toBe('10:58')
    expect(fmtTime(t, { tz: 'Asia/Dhaka', clock: '24h' })).toBe('16:58')
    expect(fmtTime(t, { tz: 'Asia/Kolkata', clock: '12h' })).toBe('4:28 PM')
    expect(fmtTime(t, { tz: 'America/New_York', clock: '12h' })).toBe('5:58 AM')
  })
  it('an unknown zone falls back to local time; a bad date prints nothing', () => {
    const t = Date.UTC(2026, 10, 1, 10, 58)
    const d = new Date(t)
    expect(fmtTime(t, { tz: 'Not/AZone', clock: '24h' })).toBe(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
    expect(fmtTime(NaN)).toBe('')
    expect(fmtTime('not a date')).toBe('')
  })
  it('accepts Date objects and ISO strings', () => {
    expect(fmtTime(new Date(at(16, 58)), { ...DHAKA, clock: '24h' })).toBe('16:58')
    expect(fmtTime('2026-11-01T10:58:00Z', { ...DHAKA, clock: '12h' })).toBe('4:58 PM')
  })
})

describe('fmtDateTime', () => {
  it('weekday, day, month and time in both modes', () => {
    expect(fmtDateTime(at(9, 0), { ...DHAKA, clock: '24h' })).toBe('Sun 1 Nov 09:00')
    expect(fmtDateTime(at(9, 0), { ...DHAKA, clock: '12h' })).toBe('Sun 1 Nov 9:00 AM')
  })
  it('the date follows the zone too (Dhaka is already the next day)', () => {
    const t = Date.UTC(2026, 9, 31, 20, 0) // Sat 31 Oct 20:00 UTC = Sun 1 Nov 02:00 Dhaka
    expect(fmtDateTime(t, { tz: 'UTC', clock: '24h' })).toBe('Sat 31 Oct 20:00')
    expect(fmtDateTime(t, { tz: 'Asia/Dhaka', clock: '12h' })).toBe('Sun 1 Nov 2:00 AM')
  })
  it('weekday off, year on', () => {
    expect(fmtDateTime(at(16, 58), { ...DHAKA, weekday: false, clock: '12h' })).toBe('1 Nov 4:58 PM')
    expect(fmtDateTime(at(16, 58), { ...DHAKA, year: true, clock: '24h' })).toBe('Sun 1 Nov 2026 16:58')
  })
})

describe('fmtShortTime', () => {
  it('today shows the time, earlier days the date', () => {
    const now = at(18, 0)
    expect(fmtShortTime(at(16, 58), { ...DHAKA, now, clock: '12h' })).toBe('4:58 PM')
    expect(fmtShortTime(at(16, 58), { ...DHAKA, now, clock: '24h' })).toBe('16:58')
    expect(fmtShortTime(at(16, 58) - 86400000, { ...DHAKA, now, clock: '24h' })).toBe('31 Oct')
  })
})

describe('wall-clock helpers', () => {
  it('fmtHm / fmtHour', () => {
    expect(fmtHm(0, 0, { clock: '12h' })).toBe('12:00 AM')
    expect(fmtHm(12, 0, { clock: '12h' })).toBe('12:00 PM')
    expect(fmtHm(7, 3, { clock: '24h' })).toBe('07:03')
    expect(fmtHour(0, '12h')).toBe('12 AM')
    expect(fmtHour(13, '12h')).toBe('1 PM')
    expect(fmtHour(9, '24h')).toBe('09:00')
    expect(fmtHour(24, '24h')).toBe('00:00')
  })
  it('fmtWallClock reads the stored "HH:MM" window and leaves anything else alone', () => {
    expect(fmtWallClock('17:00', '12h')).toBe('5:00 PM')
    expect(fmtWallClock('09:00', '12h')).toBe('9:00 AM')
    expect(fmtWallClock('09:00', '24h')).toBe('09:00')
    expect(fmtWallClock('25:00', '24h')).toBe('25:00')
    expect(fmtWallClock('soon', '12h')).toBe('soon')
  })
})
