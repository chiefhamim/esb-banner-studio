// News engine (shared, identical in ESB Studio PC src/news and ESB Studio Phone src/mobile/watch; tools/sync-pc.mjs news).
import { describe, expect, it } from 'vitest'
import { _test, checkRange, portalSites } from './rangeSearch'

describe('EnergyWatch date range', () => {
  it('searches each portal by its own site', () => {
    const all = portalSites()
    const pa = all.find((p) => p.name === 'Prothom Alo')!
    expect(pa.sites).toContain('prothomalo.com')
    expect(pa.sites).not.toContain('en.prothomalo.com') // covered by prothomalo.com
    expect(all.find((p) => p.name === 'The Business Standard')!.lang).toBe('en')
    expect(all.every((p) => p.sites.length > 0)).toBe(true)
  })
  it("builds Google News's date search", () => {
    const from = Date.UTC(2026, 10, 1), to = Date.UTC(2026, 10, 3)
    const url = decodeURIComponent(_test.gnUrl({ site: 'tbsnews.net', portal: 'TBS', lang: 'en', words: ['LNG', 'gas'], from, to }))
    expect(url).toContain('site:tbsnews.net (LNG OR gas) after:2026-11-01 before:2026-11-04')
    expect(url).toContain('hl=en')
  })
  it('accepts a sensible range and explains a bad one', () => {
    const t = Date.now() - 3 * 86400_000
    expect(checkRange(t, t + 86400_000)).toBeNull()
    expect(checkRange(t, t - 1)).toMatch(/after the start/)
    expect(checkRange(t - 10 * 86400_000, t)).toMatch(/7 days/)
  })
})
