import { describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { buildTrayTemplate, formatSec } = require('../../electron/outreach-tray.cjs')

describe('outreach-tray: tray context menu template & status formatting (§1.8, §4.8)', () => {
  it('formats seconds into m:ss', () => {
    expect(formatSec(0)).toBe('0:00')
    expect(formatSec(5)).toBe('0:05')
    expect(formatSec(65)).toBe('1:05')
    expect(formatSec(192)).toBe('3:12')
    expect(formatSec(-10)).toBe('0:00')
  })

  it('builds idle template with disabled status and correct actions', () => {
    const handlers = {
      onOpen: vi.fn(),
      onTogglePause: vi.fn(),
      onQuit: vi.fn(),
    }

    const template = buildTrayTemplate({ state: 'idle' }, handlers)
    expect(template.length).toBe(5)
    expect(template[0].label).toBe('Idle')
    expect(template[0].enabled).toBe(false)
    expect(template[1].label).toBe('Open ESB AI Studio')
    expect(template[2].label).toBe('Pause all sending')
    expect(template[3].type).toBe('separator')
    expect(template[4].label).toBe('Quit')

    // Click triggers
    template[1].click()
    expect(handlers.onOpen).toHaveBeenCalledTimes(1)

    template[2].click()
    expect(handlers.onTogglePause).toHaveBeenCalledTimes(1)

    template[4].click()
    expect(handlers.onQuit).toHaveBeenCalledTimes(1)
  })

  it('formats sending status with remaining time', () => {
    const template = buildTrayTemplate({
      state: 'sending',
      sent: 142,
      total: 2400,
      nextInSec: 192,
    })
    expect(template[0].label).toBe('Sending 142 of 2400 · next in 3:12')
  })

  it('formats waiting status with window opens or why', () => {
    const t1 = buildTrayTemplate({
      state: 'waiting',
      windowOpens: 'Sun 09:00',
    })
    expect(t1[0].label).toBe('Waiting — window opens Sun 09:00')

    const t2 = buildTrayTemplate({
      state: 'waiting',
      why: 'domain',
    })
    expect(t2[0].label).toBe('Waiting — domain')
  })

  it('shows Resume sending when paused', () => {
    const template = buildTrayTemplate({
      state: 'paused',
      isPaused: true,
    })
    expect(template[0].label).toBe('Paused')
    expect(template[2].label).toBe('Resume sending')
  })
})
