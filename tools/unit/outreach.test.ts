import { describe, expect, it } from 'vitest'
import {
  generateTrackingId,
  injectTrackingPixel,
  wrapTrackingLinks,
  isScannerPreFetch,
} from '../../src/outreach/tracking'
import { OUTREACH_BLUEPRINTS } from '../../src/outreach/outreachAi'

describe('Outreach Desk — Telemetry Engine', () => {
  it('generates distinct URL-safe tracking IDs', () => {
    const id1 = generateTrackingId('c_001')
    const id2 = generateTrackingId('c_001')
    expect(id1).not.toBe(id2)
    expect(id1).toMatch(/^[a-zA-Z0-9_-]+$/)
  })

  it('injects 1x1 transparent tracking pixel before closing body tag', () => {
    const html = '<html><body><p>Hello Bangladesh Energy Sector</p></body></html>'
    const trackingId = 'trk_test_123'
    const result = injectTrackingPixel(html, trackingId, 'https://esbpowerline.com/api/track')
    expect(result).toContain('<img src="https://esbpowerline.com/api/track/open/trk_test_123.gif"')
    expect(result).toContain('width="1" height="1"')
    expect(result).toContain('alt=""')
    expect(result.indexOf('<img')).toBeLessThan(result.indexOf('</body>'))
  })

  it('wraps hyperlinks with tracking redirect while ignoring mailto links', () => {
    const html = `
      <div>
        <a href="https://esbpowerline.com/prospectus">Download Prospectus</a>
        <a href="mailto:contact@esbpowerline.com">Reply to Desk</a>
      </div>
    `
    const trackingId = 'trk_test_456'
    const result = wrapTrackingLinks(html, trackingId, 'https://esbpowerline.com/api/track')
    expect(result).toContain('https://esbpowerline.com/api/track/click/trk_test_456?u=')
    expect(result).toContain('href="mailto:contact@esbpowerline.com"')
  })

  it('detects corporate security scanner pre-fetch within 5s', () => {
    const sentAt = '2026-10-28T10:00:00.000Z'
    const immediateHit = '2026-10-28T10:00:02.000Z' // 2s -> scanner
    const humanHit = '2026-10-28T10:05:00.000Z' // 5 min -> human

    expect(isScannerPreFetch(sentAt, immediateHit)).toBe(true)
    expect(isScannerPreFetch(sentAt, humanHit)).toBe(false)
  })
})

describe('Outreach Desk — AI Blueprints & Templates', () => {
  it('supplies all required promotional blueprints with bilingual support', () => {
    const ids = OUTREACH_BLUEPRINTS.map((b) => b.id)
    expect(ids).toContain('magazine_distribution')
    expect(ids).toContain('corporate_sponsorship')
    expect(ids).toContain('executive_interview')
    expect(ids).toContain('breaking_intelligence')
    expect(ids).toContain('institutional_dialogue')
    expect(ids).toContain('custom_pitch')

    for (const b of OUTREACH_BLUEPRINTS) {
      expect(b.defaultSubject).toBeTruthy()
      expect(b.defaultBody).toBeTruthy()
      expect(b.bengaliSubject).toBeTruthy()
      expect(b.bengaliBody).toBeTruthy()
      expect(b.bengaliBody).toContain('{organization}')
    }
  })
})
