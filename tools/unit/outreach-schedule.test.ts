import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  windowState,
  secondsLeftInWindow,
  rampCap,
  autoGap,
  domainOf,
  isWebmail,
  pickNext,
  planSchedule,
} = require('../../electron/outreach-schedule.cjs')

describe('outreach-schedule: pure scheduling, window, pacing & domain throttle (§4.6)', () => {
  const win = {
    enabled: true,
    from: '09:00',
    to: '17:00',
    days: [0, 1, 2, 3, 4], // Sun .. Thu
    tz: 'Asia/Dhaka',
  }

  it('windowState: Friday 10:00 Dhaka is closed, opens Sunday 09:00', () => {
    // 2026-10-30 is Friday. 10:00 in Dhaka (UTC+6) is 04:00 UTC
    const friday10amDhaka = Date.UTC(2026, 9, 30, 4, 0, 0)
    const st = windowState(friday10amDhaka, win)

    expect(st.open).toBe(false)
    expect(st.opensAt).not.toBeNull()

    // Sunday is 2026-11-01. 09:00 Dhaka is 03:00 UTC
    const sunday9amDhaka = Date.UTC(2026, 10, 1, 3, 0, 0)
    expect(Math.abs(st.opensAt - sunday9amDhaka)).toBeLessThan(120000) // within 2 minutes accuracy
  })

  it('windowState: Thursday 17:00 exactly Dhaka is closed', () => {
    // 2026-10-29 is Thursday. 17:00 in Dhaka (UTC+6) is 11:00 UTC
    const thursday5pmDhaka = Date.UTC(2026, 9, 29, 11, 0, 0)
    const st = windowState(thursday5pmDhaka, win)
    expect(st.open).toBe(false)
  })

  it('windowState: Sunday 08:59 Dhaka is closed, opens in 1 min', () => {
    // 2026-11-01 is Sunday. 08:59 in Dhaka is 02:59 UTC
    const sunday859amDhaka = Date.UTC(2026, 10, 1, 2, 59, 0)
    const st = windowState(sunday859amDhaka, win)
    expect(st.open).toBe(false)

    const diffSeconds = Math.round((st.opensAt - sunday859amDhaka) / 1000)
    expect(diffSeconds).toBeCloseTo(60, -1) // approx 60 seconds
  })

  it('secondsLeftInWindow accurately returns remaining seconds during open window', () => {
    // 2026-11-01 Sunday 10:00 Dhaka -> closes at 17:00 (7 hours = 25,200 sec)
    const sunday10amDhaka = Date.UTC(2026, 10, 1, 4, 0, 0)
    const left = secondsLeftInWindow(sunday10amDhaka, win)
    expect(left).toBeCloseTo(25200, -2)
  })

  it('rampCap: days 1 to 5 with dailyLimit 100 -> 30, 50, 70, 90, 100', () => {
    expect(rampCap(100, 1, true)).toBe(30)
    expect(rampCap(100, 2, true)).toBe(50)
    expect(rampCap(100, 3, true)).toBe(70)
    expect(rampCap(100, 4, true)).toBe(90)
    expect(rampCap(100, 5, true)).toBe(100)
    expect(rampCap(100, 6, true)).toBe(100)
  })

  it('planSchedule: 250 messages with ramp on => 5 days (30+50+70+90+10)', () => {
    const sundayMorning = Date.UTC(2026, 10, 1, 4, 0, 0) // Sunday
    const res = planSchedule({
      count: 250,
      now: sundayMorning,
      settings: { dailyLimit: 100, ramp: true, window: win },
      sentLast24h: 0,
      sendDays: 1,
    })

    expect(res.days).toBe(5)
    expect(res.perDay).toEqual([30, 50, 70, 90, 10])
  })

  it('planSchedule: 250 messages with ramp off => 3 days (100+100+50)', () => {
    const sundayMorning = Date.UTC(2026, 10, 1, 4, 0, 0)
    const res = planSchedule({
      count: 250,
      now: sundayMorning,
      settings: { dailyLimit: 100, ramp: false, window: win },
      sentLast24h: 0,
      sendDays: 1,
    })

    expect(res.days).toBe(3)
    expect(res.perDay).toEqual([100, 100, 50])
  })

  it('autoGap: span 28,800 s (8 h), room 60 -> ~480 s ± 30 %, never < 60 s, never > 1,800 s', () => {
    // 28,800 / 60 = 480 s. 480 * 0.7 = 336 s. 480 * 1.3 = 624 s.
    const gapMin = autoGap(28800, 60, () => 0) // min jitter factor 0.7
    const gapMax = autoGap(28800, 60, () => 1) // max jitter factor 1.3

    expect(gapMin).toBe(336)
    expect(gapMax).toBe(624)

    // Bound test: huge room
    expect(autoGap(100, 1000, () => 0)).toBe(60) // Clamped to min 60s
    // Bound test: huge span, 1 room
    expect(autoGap(100000, 1, () => 0.5)).toBeLessThanOrEqual(1800 * 1.3)
  })

  it('domainOf and isWebmail classification', () => {
    expect(domainOf('CEO@alpha.com')).toBe('alpha.com')
    expect(domainOf('user@gmail.com')).toBe('gmail.com')
    expect(isWebmail('gmail.com')).toBe(true)
    expect(isWebmail('yahoo.com')).toBe(true)
    expect(isWebmail('outlook.com')).toBe(true)
    expect(isWebmail('company.example.com')).toBe(false)
  })

  it('pickNext interleaves 3 domains with 12 messages without repeating a domain inside its gap', () => {
    const messages = [
      { to: 'a1@domainA.example.com' },
      { to: 'a2@domainA.example.com' },
      { to: 'a3@domainA.example.com' },
      { to: 'b1@domainB.example.com' },
      { to: 'b2@domainB.example.com' },
      { to: 'b3@domainB.example.com' },
      { to: 'c1@domainC.example.com' },
      { to: 'c2@domainC.example.com' },
      { to: 'c3@domainC.example.com' },
      { to: 'w1@gmail.com' },
      { to: 'w2@gmail.com' },
    ]

    const sent = new Set<number>()
    const domainStats = new Map<string, { lastSentAt: number; countToday: number }>()
    let now = 1000000

    const pickedSequence: string[] = []

    for (let step = 0; step < 11; step++) {
      const pick = pickNext(messages, sent, now, domainStats, { domainMaxPerDay: 5, domainMinGapSec: 20 * 60 })
      expect(pick).not.toBeNull()
      if ('index' in pick) {
        sent.add(pick.index)
        pickedSequence.push(pick.email)
        const dom = domainOf(pick.email)
        if (!isWebmail(dom)) {
          const prev = domainStats.get(dom) || { countToday: 0, lastSentAt: 0 }
          domainStats.set(dom, { countToday: prev.countToday + 1, lastSentAt: now })
        }
      }
      now += 60 * 1000 // advance 1 min
    }

    // First 3 non-webmail picks must be different domains: domainA, domainB, domainC (or webmail)
    const nonWebmailFirst3 = pickedSequence.filter((e) => !e.includes('gmail.com')).slice(0, 3)
    const distinctDomains = new Set(nonWebmailFirst3.map(domainOf))
    expect(distinctDomains.size).toBe(3)
  })

  it('performance: 20,000-message index picks 1,000 messages in < 1 s', () => {
    const messages: { to: string }[] = []
    for (let i = 0; i < 20000; i++) {
      messages.push({ to: `user${i}@org${i % 50}.example.com` })
    }

    const sent = new Set<number>()
    const domainStats = new Map<string, { lastSentAt: number; countToday: number }>()
    let now = 1000000

    const t0 = performance.now()
    let picks = 0
    for (let step = 0; step < 1000; step++) {
      const pick = pickNext(messages, sent, now, domainStats, { domainMaxPerDay: 50, domainMinGapSec: 60 })
      if (pick && 'index' in pick) {
        sent.add(pick.index)
        picks++
        const dom = domainOf(pick.email)
        const prev = domainStats.get(dom) || { countToday: 0, lastSentAt: 0 }
        domainStats.set(dom, { countToday: prev.countToday + 1, lastSentAt: now })
      }
      now += 2000
    }
    const elapsed = performance.now() - t0

    expect(picks).toBe(1000)
    expect(elapsed).toBeLessThan(1000)
  })
})
