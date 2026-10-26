import { describe, expect, it } from 'vitest'
import { fmtPublished } from '../../src/editorial/fmtPublished'

const now = Date.parse('2026-10-26T12:00:00Z')
describe('fmtPublished', () => {
  it('reads recent times as relative and older ones as dates', () => {
    expect(fmtPublished('Mon, 26 Oct 2026 11:59:40 GMT', now)).toBe('Just now')
    expect(fmtPublished('Mon, 26 Oct 2026 11:15:00 GMT', now)).toBe('45 min ago')
    expect(fmtPublished('Mon, 26 Oct 2026 08:00:00 GMT', now)).toBe('4 h ago')
    expect(fmtPublished('Mon, 12 Oct 2026 08:00:00 GMT', now)).toMatch(/12/)
  })
  it('never prints a raw date it cannot read', () => {
    expect(fmtPublished('', now)).toBe('Published')
    expect(fmtPublished('not a date', now)).toBe('Published')
  })
})
