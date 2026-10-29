import { describe, it, expect } from 'vitest'
import { computeStats, createTimezoneHelper } from '../../electron/outreach-stats.cjs'

describe('outreach-stats: aggregation and metrics (§3.1)', () => {
  it('timezone bucketing across midnight in Asia/Dhaka (+06:00)', () => {
    const tz = createTimezoneHelper('Asia/Dhaka')
    // 2026-11-01T19:30:00Z -> In UTC it is 19:30 on Nov 1
    // In Asia/Dhaka (+6h) it is 2026-11-02 01:30 (Hour 1 on Nov 2)
    const utcTs = Date.parse('2026-11-01T19:30:00Z')
    const parts = tz.getParts(utcTs)
    expect(parts.day).toBe('2026-11-02')
    expect(parts.hour).toBe(1)

    // 2026-11-01T17:59:59Z -> In Asia/Dhaka is 23:59:59 on Nov 1
    const beforeMidnightTs = Date.parse('2026-11-01T17:59:59Z')
    const p1 = tz.getParts(beforeMidnightTs)
    expect(p1.day).toBe('2026-11-01')
    expect(p1.hour).toBe(23)
  })

  it('aggregates hand-built event set with known arithmetic', () => {
    // Timestamps in Asia/Dhaka:
    // Base: 2026-11-01 10:00:00 Asia/Dhaka = 2026-11-01 04:00:00Z
    const t0 = Date.parse('2026-11-01T04:00:00Z')
    const t1 = t0 + 60 * 1000 // 10:01: 60s gap, send ms: 400
    const t2 = t1 + 120 * 1000 // 10:03: 120s gap, send ms: 600
    // Reply 15 minutes later: diff = 15 * 60 * 1000 = 900,000 ms
    const tReply1 = t0 + 900 * 1000
    // Reply 30 minutes later to t1: diff = 30 * 60 * 1000 - 60 * 1000 = 1,740,000 ms
    const tReply2 = t0 + 1800 * 1000

    const events = [
      { id: '1', type: 'job.started', jobId: 'j1', t: t0 - 1000 },
      { id: '2', type: 'send.ok', jobId: 'j1', email: 'alice@example.com', t: t0, ms: 500 },
      { id: '3', type: 'send.ok', jobId: 'j1', email: 'bob@example.com', t: t1, ms: 400 },
      { id: '4', type: 'send.ok', jobId: 'j1', email: 'carol@example.com', t: t2, ms: 600 },
      { id: '5', type: 'send.fail', jobId: 'j1', email: 'david@example.com', t: t2 + 10000 },
      { id: '6', type: 'send.retry', jobId: 'j1', email: 'david@example.com', t: t2 + 5000 },
      { id: '7', type: 'send.skip', jobId: 'j1', email: 'eve@example.com', t: t2 + 6000 },
      { id: '8', type: 'bounce', email: 'frank@example.com', t: t2 + 20000 },
      // Auto-reply must be excluded from Replied total
      { id: '9', type: 'reply', email: 'auto@example.com', auto: true, t: t2 + 25000 },
      // Legitimate replies
      { id: '10', type: 'reply', email: 'alice@example.com', auto: false, t: tReply1 },
      { id: '11', type: 'reply', email: 'bob@example.com', auto: false, t: tReply2 },
      { id: '12', type: 'optout', email: 'grace@example.com', on: true, t: t2 + 30000 },
      { id: '13', type: 'job.done', jobId: 'j1', t: t2 + 40000 },
    ]

    const stats = computeStats(events, [], {
      from: t0 - 2000,
      to: tReply2 + 5000,
      tz: 'Asia/Dhaka',
      settings: { dailyLimit: 120 },
    })

    // Totals verification
    expect(stats.totals.sent).toBe(3) // 3 send.ok
    expect(stats.totals.failed).toBe(1) // 1 send.fail
    expect(stats.totals.retries).toBe(1) // 1 send.retry
    expect(stats.totals.skipped).toBe(1) // 1 send.skip
    expect(stats.totals.bounced).toBe(1) // 1 bounce
    expect(stats.totals.replied).toBe(2) // 2 replies (auto:true excluded)
    expect(stats.totals.optedOut).toBe(1) // 1 optout

    // Average send ms: (500 + 400 + 600) / 3 = 500 ms
    expect(stats.durations.avgSendMs).toBe(500)

    // Average gap between sends in same job and day:
    // Gap 1: t1 - t0 = 60s
    // Gap 2: t2 - t1 = 120s
    // Mean = (60 + 120) / 2 = 90s
    expect(stats.durations.avgGapSec).toBe(90)

    // Active time: job.started at (t0 - 1000) to job.done at (t2 + 40000)
    // = (t2 + 40000) - (t0 - 1000) = 180000 + 40000 + 1000 = 221000 ms
    expect(stats.durations.activeMs).toBe(221000)

    // Reply median:
    // Alice diff: 900,000 ms
    // Bob diff: 1,800,000 - 60,000 = 1,740,000 ms
    // Median of 2 values = (900,000 + 1,740,000) / 2 = 1,320,000 ms
    expect(stats.replyMedianMs).toBe(1320000)

    // Cap & window
    expect(stats.cap).toBe(120)

    // First and last send
    expect(stats.firstSendAt).toBe(t0)
    expect(stats.lastSendAt).toBe(t2)
  })

  it('aggregates 100,000 events in < 300 ms', () => {
    const baseT = Date.parse('2026-11-01T00:00:00Z')
    const events = new Array(100000)

    for (let i = 0; i < 100000; i++) {
      const t = baseT + (i * 30000) // every 30 seconds
      const mod = i % 10
      events[i] = {
        id: `ev-${i}`,
        type: mod < 7 ? 'send.ok' : mod < 8 ? 'send.fail' : mod < 9 ? 'bounce' : 'reply',
        jobId: `job-${Math.floor(i / 1000)}`,
        email: `contact${i}@example.com`,
        t,
        ms: 300 + (i % 200),
        auto: false,
      }
    }

    const start = performance.now()
    const stats = computeStats(events, [], {
      from: baseT,
      to: baseT + 100000 * 30000,
      tz: 'Asia/Dhaka',
    })
    const duration = performance.now() - start

    expect(stats.totals.sent).toBe(70000)
    expect(stats.totals.failed).toBe(10000)
    expect(stats.totals.bounced).toBe(10000)
    expect(stats.totals.replied).toBe(10000)
    expect(duration).toBeLessThan(300)
  })
})
