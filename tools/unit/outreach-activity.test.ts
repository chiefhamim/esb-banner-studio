import { describe, it, expect } from 'vitest'
import { safeCsvCell, buildDayCsv, buildRunCsv } from '../../src/outreach/ActivityReports'
import type { JobSnapshot } from '../../src/esb'

describe('ActivityReports: CSV exports & formula injection neutralization (§3.6)', () => {
  it('safeCsvCell neutralizes formula injection characters (=, +, -, @)', () => {
    expect(safeCsvCell('=SUM(A1:A10)')).toBe('"\'=SUM(A1:A10)"')
    expect(safeCsvCell('+cmd|"/C calc"!A0')).toBe('"\'+cmd|""/C calc""!A0"')
    expect(safeCsvCell('-123')).toBe('"\' -123"'.replace(' ', ''))
    expect(safeCsvCell('@evil.com')).toBe('"\'@evil.com"')

    // Safe values remain untouched
    expect(safeCsvCell('Petrobangla Ltd')).toBe('"Petrobangla Ltd"')
    expect(safeCsvCell(1200)).toBe('"1200"')
    expect(safeCsvCell(null)).toBe('""')
    expect(safeCsvCell(undefined)).toBe('""')
  })

  it('buildDayCsv formats daily rows cleanly with correct headers and Bangla support', () => {
    const data = [
      {
        day: '2026-11-01',
        sent: 120,
        failed: 3,
        bounced: 1,
        replied: 8,
      },
    ]

    const csv = buildDayCsv(data)
    expect(csv).toContain('Date,Sent,Failed,Bounced,Replied,First email,Last email,Time sending')
    expect(csv).toContain('"2026-11-01","120","3","1","8"')
  })

  it('buildRunCsv formats campaign job snapshots cleanly', () => {
    const jobs: JobSnapshot[] = [
      {
        jobId: 'job-run-1',
        campaignId: 'camp-1',
        name: 'শক্তিরূপ রূপপুর পারমাণবিক প্রকল্প',
        kind: 'first',
        status: 'done',
        dry: false,
        total: 500,
        sent: 495,
        failed: 5,
        skipped: 0,
        held: 0,
        remaining: 0,
        createdAt: 1000,
        startedAt: 2000,
        endedAt: 60000,
      },
    ]

    const csv = buildRunCsv(jobs)
    expect(csv).toContain('Campaign,Started,Finished,Sent,Failed,Skipped,Took,Average gap s,Result')
    expect(csv).toContain('"শক্তিরূপ রূপপুর পারমাণবিক প্রকল্প"')
    expect(csv).toContain('"495"')
    expect(csv).toContain('"done"')
  })
})
