import { describe, it, expect } from 'vitest'
import { describeRun, describeEvent, fmtDuration, fmtClock, fmtDay } from '../../src/outreach/activityFormat'
import type { AutopilotSettings, JobSnapshot, OutreachEvent } from '../../src/esb'

const mockSettings: AutopilotSettings = {
  window: { enabled: true, from: '09:00', to: '17:00', days: [0, 1, 2, 3, 4], tz: 'Asia/Dhaka' },
  dailyLimit: 60,
  ramp: true,
  pace: 'auto',
  minDelaySec: 60,
  maxDelaySec: 300,
  domainMaxPerDay: 3,
  domainMinGapSec: 20 * 60,
  contactCooldownDays: 30,
  traySending: true,
  aiAutonomy: 'suggest',
  aiReadsReply: false,
  autoResume: true,
}

function mockJob(over: Partial<JobSnapshot> = {}): JobSnapshot {
  return {
    jobId: 'job-1',
    campaignId: 'cmp-1',
    name: 'Sector Review',
    kind: 'first',
    status: 'running',
    dry: false,
    total: 2400,
    sent: 142,
    failed: 0,
    skipped: 0,
    held: 0,
    remaining: 2258,
    createdAt: 1000,
    ...over,
  }
}

describe('activityFormat: describeRun (§5.3)', () => {
  const now = 1700000000000

  it('formats idle state with schedule window and ramp cap', () => {
    const res = describeRun(null, mockSettings, now)
    expect(res.status).toBe('idle')
    expect(res.label).toBe('Idle')
    expect(res.sentence).toContain('Sun, Mon, Tue, Wed, Thu 09:00–17:00, Dhaka')
    expect(res.summary).toContain('Up to 60 a day (ramp)')
  })

  it('formats running state with count, percent, and progress', () => {
    const job = mockJob({ total: 2400, sent: 142, until: now + 192000 })
    const res = describeRun(job, mockSettings, now)
    expect(res.status).toBe('sending')
    expect(res.label).toBe('Sending')
    expect(res.countText).toBe('142 of 2,400')
    expect(res.percent).toBe(6)
    expect(res.nextInText).toBe('Next in 3:12')
  })

  describe('waiting states (§5.3)', () => {
    it('window: Waiting for the window — opens Sun 09:00', () => {
      const until = Date.UTC(2026, 10, 1, 3, 0) // Sunday 09:00 Dhaka (UTC+6)
      const job = mockJob({ status: 'waiting', why: 'window', until })
      const res = describeRun(job, mockSettings, now)
      expect(res.status).toBe('waiting')
      expect(res.sentence).toMatch(/Waiting for the window — opens Sun 1 Nov 09:00/)
    })

    it('cap: Daily limit reached — continues at 14:32', () => {
      const until = Date.UTC(2026, 10, 1, 8, 32) // 14:32 Dhaka
      const job = mockJob({ status: 'waiting', why: 'cap', until })
      const res = describeRun(job, mockSettings, now)
      expect(res.status).toBe('waiting')
      expect(res.sentence).toBe('Daily limit reached — continues at 14:32')
    })

    it('gap: Spacing out sends — next in 3:12', () => {
      const until = now + 192000
      const job = mockJob({ status: 'waiting', why: 'gap', until })
      const res = describeRun(job, mockSettings, now)
      expect(res.sentence).toBe('Spacing out sends — next in 3:12')
    })

    it('domain: Same company just emailed — next in 12 min', () => {
      const until = now + 12 * 60000
      const job = mockJob({ status: 'waiting', why: 'domain', until })
      const res = describeRun(job, mockSettings, now)
      expect(res.sentence).toBe('Same company just emailed — next in 12 min')
    })

    it('offline: Offline — trying again every minute', () => {
      const job = mockJob({ status: 'waiting', why: 'offline' })
      const res = describeRun(job, mockSettings, now)
      expect(res.sentence).toBe('Offline — trying again every minute')
    })

    it('quota: Gmail asked us to slow down — continues at 21:10', () => {
      const until = Date.UTC(2026, 10, 1, 15, 10) // 21:10 Dhaka
      const job = mockJob({ status: 'waiting', why: 'quota', until })
      const res = describeRun(job, mockSettings, now)
      expect(res.sentence).toBe('Gmail asked us to slow down — continues at 21:10')
    })

    it('held: Waiting — all remaining messages are held', () => {
      const job = mockJob({ status: 'waiting', why: 'held' })
      const res = describeRun(job, mockSettings, now)
      expect(res.sentence).toBe('Waiting — all remaining messages are held')
    })
  })

  describe('paused states (§5.3)', () => {
    it('user: Paused by you', () => {
      const job = mockJob({ status: 'paused', reason: 'user' })
      expect(describeRun(job, mockSettings, now).sentence).toBe('Paused by you')
    })

    it('auth: Paused — sign-in problem', () => {
      const job = mockJob({ status: 'paused', reason: 'auth' })
      expect(describeRun(job, mockSettings, now).sentence).toBe('Paused — sign-in problem')
    })

    it('circuit: Paused to protect your account: 3 of the last 10 addresses were refused', () => {
      const job = mockJob({ status: 'paused', reason: 'circuit' })
      expect(describeRun(job, mockSettings, now).sentence).toBe('Paused to protect your account: 3 of the last 10 addresses were refused')
    })

    it('content: Paused — the attachment is too large', () => {
      const job = mockJob({ status: 'paused', reason: 'content' })
      expect(describeRun(job, mockSettings, now).sentence).toBe('Paused — the attachment is too large')
    })

    it('quit: Paused when the app closed', () => {
      const job = mockJob({ status: 'paused', reason: 'quit' })
      expect(describeRun(job, mockSettings, now).sentence).toBe('Paused when the app closed')
    })
  })

  it('done: 2,400 sent in full', () => {
    const job = mockJob({ status: 'done', sent: 2400, total: 2400 })
    const res = describeRun(job, mockSettings, now)
    expect(res.status).toBe('done')
    expect(res.sentence).toBe('2,400 sent in full')
    expect(res.percent).toBe(100)
  })

  it('stopped: Sending was stopped', () => {
    const job = mockJob({ status: 'stopped' })
    const res = describeRun(job, mockSettings, now)
    expect(res.status).toBe('stopped')
    expect(res.sentence).toBe('Sending was stopped')
  })
})

describe('activityFormat: durations and clocks (§3.2, §5.8)', () => {
  it('formats exact durations per spec', () => {
    expect(fmtDuration(0)).toBe('0 s')
    expect(fmtDuration(59)).toBe('59 s')
    expect(fmtDuration(60)).toBe('1 m')
    expect(fmtDuration(238)).toBe('3 m 58 s')
    expect(fmtDuration(7500)).toBe('2 h 05 m')
    expect(fmtDuration(17 * 86400)).toBe('17 days')
  })

  it('formats clock in specified timezone', () => {
    const ts = Date.UTC(2026, 10, 1, 8, 30) // 14:30 Dhaka
    expect(fmtClock(ts, 'Asia/Dhaka')).toBe('14:30')
  })
})

describe('activityFormat: describeEvent (§5.7)', () => {
  it('formats events cleanly into readable sentences', () => {
    expect(describeEvent({ id: '1', t: 1000, type: 'send.ok', name: 'Kabir Ahmed', org: 'Petrobangla' })).toBe('Sent to Kabir Ahmed (Petrobangla)')
    expect(describeEvent({ id: '2', t: 1000, type: 'send.fail', email: 'bad@example.com', error: '550 User unknown' })).toBe('Failed sending to bad@example.com: 550 User unknown')
    expect(describeEvent({ id: '3', t: 1000, type: 'reply', email: 'lead@example.com', unsubscribe: true })).toBe('lead@example.com replied with unsubscribe request')
    expect(describeEvent({ id: '4', t: 1000, type: 'bounce', email: 'dead@example.com', reason: '5.1.1 Address rejected' })).toBe('dead@example.com bounced: 5.1.1 Address rejected')
    expect(describeEvent({ id: '5', t: 1000, type: 'engine.quit' })).toBe('Engine quit cleanly')
  })
})
