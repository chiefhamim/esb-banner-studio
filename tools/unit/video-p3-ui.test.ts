// Phase 3 UI fix round: the export sheet's fix sentences and the safe-zone warning.
import { describe, it, expect } from 'vitest'
import { fixFor } from '../../src/video/ExportSheet'
import { guideZones } from '../../src/video/engine/guides'

describe('export sheet fixes', () => {
  it('says what to do about each problem', () => {
    expect(fixFor('“Speaker name” is empty')).toBe('Type the speaker’s name.')
    expect(fixFor('“Role” is empty')).toContain('Type the words for “Role”')
    expect(fixFor('“Quote” holds placeholder text: TBD')).toBe('Replace it with the real text.')
    expect(fixFor('Quote still says TBD')).toBe('Replace it with the real text.')
    expect(fixFor('A line does not fit in its lines: shorten it')).toMatch(/Shorten/)
    expect(fixFor('something new')).toMatch(/Open the clip/)
  })
})

describe('safe-zone warning', () => {
  it('portrait guides are lines: the critical box sits inside the title-safe frame', () => {
    const z = guideZones({ platform: 'reels' }, 1080, 1920)
    expect(z.critical.y + z.critical.h).toBeLessThan(1920 * 0.85)
    expect(z.bands.length).toBeGreaterThan(0)
  })
  it('landscape: the title-safe frame only', () => {
    expect(guideZones({ platform: 'reels' }, 1920, 1080).bands).toHaveLength(0)
  })
  // the title-vs-zone check measures a real spec (a canvas): it is covered by the harness states
  // monitor-safe-9x16 (no warning) and monitor-safe-9x16-warn (warning chip + outline)
})
