import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { createSettingsManager, validateSettings, DEFAULT_SETTINGS } = require('../../electron/outreach-settings.cjs')

describe('outreach-settings: schema defaults, validation bounds & atomic persistence (§1.6, §4.7)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outreach-settings-test-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {}
  })

  it('loads exact §4.7 defaults on a fresh directory and writes outreach-autopilot.json', () => {
    const mgr = createSettingsManager({ dir: tmpDir })
    const settings = mgr.get()

    expect(settings).toEqual({
      window: {
        enabled: true,
        from: '09:00',
        to: '17:00',
        days: [0, 1, 2, 3, 4],
        tz: 'Asia/Dhaka',
      },
      dailyLimit: 100,
      ramp: true,
      pace: 'manual',
      minDelaySec: 180,
      maxDelaySec: 480,
      domainMaxPerDay: 3,
      domainMinGapSec: 1200,
      contactCooldownDays: 30,
      gmailCeiling24h: 400,
      traySending: true,
      aiAutonomy: 'suggest',
      aiReadsReply: false,
      autoResume: true,
    })

    const filePath = path.join(tmpDir, 'outreach-autopilot.json')
    expect(fs.existsSync(filePath)).toBe(true)
    const diskContent = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    expect(diskContent).toEqual(settings)
  })

  it('validates bounds for dailyLimit and refuses with field name', () => {
    const mgr = createSettingsManager({ dir: tmpDir })

    expect(mgr.save({ dailyLimit: 9 })).toEqual({
      ok: false,
      error: 'dailyLimit must be an integer between 10 and 500',
      field: 'dailyLimit',
    })

    expect(mgr.save({ dailyLimit: 501 })).toEqual({
      ok: false,
      error: 'dailyLimit must be an integer between 10 and 500',
      field: 'dailyLimit',
    })

    expect(mgr.save({ dailyLimit: 150.5 })).toEqual({
      ok: false,
      error: 'dailyLimit must be an integer between 10 and 500',
      field: 'dailyLimit',
    })

    const res = mgr.save({ dailyLimit: 250 })
    expect(res.ok).toBe(true)
    expect(mgr.get().dailyLimit).toBe(250)
  })

  it('validates bounds for pace and delays, enforcing maxDelaySec >= minDelaySec', () => {
    const mgr = createSettingsManager({ dir: tmpDir })

    expect(mgr.save({ pace: 'turbo' })).toEqual({
      ok: false,
      error: "pace must be 'auto' or 'manual'",
      field: 'pace',
    })

    expect(mgr.save({ minDelaySec: 25 })).toEqual({
      ok: false,
      error: 'minDelaySec must be an integer between 30 and 3600',
      field: 'minDelaySec',
    })

    expect(mgr.save({ maxDelaySec: 4000 })).toEqual({
      ok: false,
      error: 'maxDelaySec must be an integer between 30 and 3600',
      field: 'maxDelaySec',
    })

    // Refuses when maxDelaySec < minDelaySec
    expect(mgr.save({ minDelaySec: 500, maxDelaySec: 400 })).toEqual({
      ok: false,
      error: 'maxDelaySec must be greater than or equal to minDelaySec',
      field: 'maxDelaySec',
    })

    const res = mgr.save({ pace: 'manual', minDelaySec: 60, maxDelaySec: 120 })
    expect(res.ok).toBe(true)
    expect(mgr.get().pace).toBe('manual')
    expect(mgr.get().minDelaySec).toBe(60)
    expect(mgr.get().maxDelaySec).toBe(120)
  })

  it('validates domain throttling and cooldown bounds', () => {
    const mgr = createSettingsManager({ dir: tmpDir })

    expect(mgr.save({ domainMaxPerDay: 0 })).toEqual({
      ok: false,
      error: 'domainMaxPerDay must be an integer between 1 and 50',
      field: 'domainMaxPerDay',
    })

    expect(mgr.save({ domainMaxPerDay: 51 })).toEqual({
      ok: false,
      error: 'domainMaxPerDay must be an integer between 1 and 50',
      field: 'domainMaxPerDay',
    })

    expect(mgr.save({ domainMinGapSec: -1 })).toEqual({
      ok: false,
      error: 'domainMinGapSec must be an integer between 0 and 14400',
      field: 'domainMinGapSec',
    })

    expect(mgr.save({ contactCooldownDays: 5 })).toEqual({
      ok: false,
      error: 'contactCooldownDays must be an integer between 7 and 365',
      field: 'contactCooldownDays',
    })

    expect(mgr.save({ contactCooldownDays: 400 })).toEqual({
      ok: false,
      error: 'contactCooldownDays must be an integer between 7 and 365',
      field: 'contactCooldownDays',
    })
  })

  it('validates window schedule: time format, ordering, days and time zones', () => {
    const mgr = createSettingsManager({ dir: tmpDir })

    expect(mgr.save({ window: { from: '9am' } })).toEqual({
      ok: false,
      error: 'window.from must be in HH:MM format',
      field: 'window.from',
    })

    expect(mgr.save({ window: { to: '25:00' } })).toEqual({
      ok: false,
      error: 'window.to must be in HH:MM format',
      field: 'window.to',
    })

    // end <= start
    expect(mgr.save({ window: { from: '17:00', to: '09:00' } })).toEqual({
      ok: false,
      error: 'window.to must be later than window.from',
      field: 'window.to',
    })

    // Invalid days
    expect(mgr.save({ window: { days: [] } })).toEqual({
      ok: false,
      error: 'window.days must be a non-empty array',
      field: 'window.days',
    })

    expect(mgr.save({ window: { days: [0, 7] } })).toEqual({
      ok: false,
      error: 'window.days must contain integers 0-6',
      field: 'window.days',
    })

    // Invalid time zone
    expect(mgr.save({ window: { tz: 'Fake/City' } })).toEqual({
      ok: false,
      error: 'Invalid time zone: Fake/City',
      field: 'window.tz',
    })

    // Valid window change
    const res = mgr.save({
      window: {
        enabled: true,
        from: '10:00',
        to: '18:00',
        days: [1, 2, 3, 4, 5],
        tz: 'America/New_York',
      },
    })
    expect(res.ok).toBe(true)
    expect(mgr.get().window.tz).toBe('America/New_York')
    expect(mgr.get().window.from).toBe('10:00')
    expect(mgr.get().window.to).toBe('18:00')
    expect(mgr.get().window.days).toEqual([1, 2, 3, 4, 5])
  })

  it('validates boolean flags and aiAutonomy', () => {
    const mgr = createSettingsManager({ dir: tmpDir })

    expect(mgr.save({ traySending: 'yes' as any })).toEqual({
      ok: false,
      error: 'traySending must be boolean',
      field: 'traySending',
    })

    expect(mgr.save({ aiAutonomy: 'full_auto' as any })).toEqual({
      ok: false,
      error: "aiAutonomy must be 'suggest', 'confirm', or 'auto-safe'",
      field: 'aiAutonomy',
    })

    const res = mgr.save({
      traySending: false,
      aiAutonomy: 'auto-safe',
      aiReadsReply: true,
      autoResume: false,
    })
    expect(res.ok).toBe(true)
    const cur = mgr.get()
    expect(cur.traySending).toBe(false)
    expect(cur.aiAutonomy).toBe('auto-safe')
    expect(cur.aiReadsReply).toBe(true)
    expect(cur.autoResume).toBe(false)
  })

  it('drops hostile keys (__proto__, constructor, unknown keys)', () => {
    const hostile = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":{"prototype":{"evil":true}},"unknownKey":"ignored","dailyLimit":120}'
    )

    const res = validateSettings(hostile, DEFAULT_SETTINGS)
    expect(res.valid).toBe(true)
    expect(res.cleaned.dailyLimit).toBe(120)
    expect(res.cleaned.unknownKey).toBeUndefined()
    expect((({} as any).polluted)).toBeUndefined()
    expect((({} as any).evil)).toBeUndefined()
  })

  it('round trips settings across manager instances and supports reset', () => {
    const mgr1 = createSettingsManager({ dir: tmpDir })
    mgr1.save({
      dailyLimit: 200,
      contactCooldownDays: 45,
      window: { from: '08:30', to: '16:30' },
    })

    // Reload with a fresh instance
    const mgr2 = createSettingsManager({ dir: tmpDir })
    const loaded = mgr2.get()
    expect(loaded.dailyLimit).toBe(200)
    expect(loaded.contactCooldownDays).toBe(45)
    expect(loaded.window.from).toBe('08:30')
    expect(loaded.window.to).toBe('16:30')

    // Reset restores defaults
    mgr2.reset()
    expect(mgr2.get()).toEqual(DEFAULT_SETTINGS)

    // And persisted on disk
    const mgr3 = createSettingsManager({ dir: tmpDir })
    expect(mgr3.get()).toEqual(DEFAULT_SETTINGS)
  })
})
