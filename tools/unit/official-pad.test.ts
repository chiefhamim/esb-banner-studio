import { describe, expect, it } from 'vitest'
import { buildVCard, ESB_CONTACT } from '../../src/outreach/officialPad'

describe('officialPad: the vCard the QR encodes', () => {
  it('is a valid vCard carrying the site, phone, email, physical address and both social links', () => {
    const v = buildVCard()
    expect(v).toMatch(/^BEGIN:VCARD\r?\n/)
    expect(v.trim()).toMatch(/END:VCARD$/)
    expect(v).toContain(`URL:${ESB_CONTACT.url}`)
    expect(v).toContain(`TEL;TYPE=WORK,VOICE:${ESB_CONTACT.phone}`)
    expect(v).toContain(`EMAIL;TYPE=WORK:${ESB_CONTACT.email}`)
    expect(v).toContain(ESB_CONTACT.addressLine)
    expect(v).toContain(ESB_CONTACT.facebook)
    expect(v).toContain(ESB_CONTACT.youtube)
  })
  it('states nothing beyond the facts on file — no invented handle, link or figure', () => {
    const v = buildVCard()
    // every https link in the card must be one of the three the app actually knows
    const links = v.match(/https:\/\/\S+/g) ?? []
    const known = [ESB_CONTACT.url, ESB_CONTACT.facebook, ESB_CONTACT.youtube]
    for (const l of links) expect(known.some((k) => l.startsWith(k))).toBe(true)
  })
})
