import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain ESM shared with the main process, no type declarations
import { sanitizeDesignHtml, fillDesign, renderDesigned, designText } from '../../electron/email-html.mjs'
import { importDesign, designVars } from '../../src/outreach/design'
import type { Contact } from '../../src/outreach/types'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { validateMail } = require('../../electron/mailer.cjs')

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const contact = (over: Partial<Contact> = {}): Contact => ({ id: 'x', serial: 1, sectorGroup: 'GROUP 1: POWER GENERATION', groupNo: 1, organization: 'Example Power Ltd', personName: 'Rahim Uddin', designation: 'Chief Engineer', email: 'rahim@example.com', phone: '', purposes: [], mxStatus: 'SAFE_TO_SEND', rawStatus: '', diagnostic: '', sheet: '', approved: false, status: 'QUEUED', ...over })

describe('designed HTML letters: what a recipient can get', () => {
  it('drops scripts, frames, forms, handlers and javascript: links', () => {
    const h = sanitizeDesignHtml('<table><tr><td onclick="x()">Hi<script>alert(1)</script><iframe src="https://evil.example"></iframe><form action="https://x"><input name=a></form><a href="javascript:alert(1)">bad</a><a href="https://esbpowerline.com">ok</a><a href="mailto:desk@example.com">m</a></td></tr></table>')
    expect(h).not.toMatch(/<script|<iframe|<form|<input|onclick|javascript:/i)
    expect(h).toContain('href="#"')
    expect(h).toContain('href="https://esbpowerline.com"')
    expect(h).toContain('href="mailto:desk@example.com"')
  })
  it('loads nothing from a server: images only cid:, CSS url() only cid:, no @import or <link>', () => {
    const h = sanitizeDesignHtml('<style>@import url(https://fonts.example/x.css); .a{background:url("https://t.example/p.gif")} .b{background:url(cid:esb-d2)}</style><link href="https://fonts.googleapis.com/css2" rel="stylesheet"><img src="https://t.example/pixel.gif"><img src="cid:esb-d1"><td background="https://x.example/a.png">')
    expect(h).not.toMatch(/https:\/\/(t|x|fonts)\./)
    expect(h).not.toMatch(/<link|@import/i)
    expect(h).toContain('src="cid:esb-d1"')
    expect(h).toContain('url(cid:esb-d2)')
  })
  it('fills placeholders with escaped text, uses the fallback, and greets Sir/Madam when there is no name', () => {
    expect(fillDesign('<p>Dear {name|Reader},</p>', { name: '<b>Rahim</b>' })).toBe('<p>Dear &lt;b&gt;Rahim&lt;/b&gt;,</p>')
    expect(fillDesign('<p>Dear {name|Reader},</p>', {})).toBe('<p>Dear Reader,</p>')
    expect(fillDesign('<p>Dear {name},</p>', {})).toBe('<p>Dear Sir/Madam,</p>')
    expect(fillDesign('<p>{name}</p>', {}, { lang: 'bn' })).toBe('<p>মহোদয়</p>')
    expect(fillDesign('<a href="{unsubscribe}">x</a>', {}, { unsubscribeHref: 'mailto:desk@example.com?subject=unsubscribe' })).toContain('href="mailto:desk@example.com?subject=unsubscribe"')
  })
  it('renders the page with cid pictures for the mail and data URLs for the preview; text part carries the opt-out', () => {
    const page = '<html><body><img src="cid:esb-d1" alt=""><p>Dear {name|Reader},</p><p>Read <a href="https://esbpowerline.com/articles?utm_source=email">the news</a></p><div style="display:none">preheader</div></body></html>'
    const sent = renderDesigned({ html: page, vars: { name: 'Rahim' }, optOut: 'Reply unsubscribe' })
    expect(sent.html).toContain('src="cid:esb-d1"')
    expect(sent.html).toContain('Dear Rahim,')
    expect(sent.text).toContain('Dear Rahim,')
    expect(sent.text).toContain('the news (https://esbpowerline.com/articles)')
    expect(sent.text).not.toContain('preheader')
    expect(sent.text.endsWith('—\nReply unsubscribe')).toBe(true)
    const preview = renderDesigned({ html: page, imageSrc: () => PNG })
    expect(preview.html).toContain(`src="${PNG}"`)
  })
  it('designText keeps paragraphs and drops styles and comments', () => {
    expect(designText('<style>p{color:red}</style><!--[if mso]>x<![endif]--><p>One</p><p>Two&nbsp;&middot; three</p>')).toBe('One\nTwo · three')
  })
})

describe('importing a designed page', () => {
  it('lifts data: pictures out as cid:esb-dN (one per distinct picture) and reports linked ones', () => {
    const raw = `<table><tr><td><img src="${PNG}"><img src="${PNG}"><img src="assets/logo.png"><p>Dear {{name}}</p><a href="{{unsubscribe_url}}">Unsubscribe</a></td></tr></table>`
    const r = importDesign('promo.html', raw)
    expect(r.design.images).toHaveLength(1)
    expect(r.design.images[0].cid).toBe('esb-d1')
    expect(r.design.html.match(/cid:esb-d1/g)).toHaveLength(2)
    expect(r.design.html).toContain('href="{unsubscribe}"')
    expect(r.notes.some((n) => n.includes('assets/logo.png'))).toBe(true)
  })
  it('refuses a file that is not an email page', () => {
    expect(() => importDesign('notes.html', 'just words')).toThrow(/does not look like an HTML email/)
  })
  it('fills only the placeholders the page uses, from the contact row', () => {
    const v = designVars(contact(), '<p>Dear {name|Reader} at {organization}, {sector}</p><a href="{unsubscribe}">x</a>')
    expect(v).toEqual({ name: 'Rahim Uddin', organization: 'Example Power Ltd', sector: 'Power Generation' })
  })
})

describe('mailer: a designed letter over the bridge', () => {
  const base = { to: 'desk@example.com', subject: 'Hello', body: 'Plain text version' }
  it('accepts a page with cid pictures and per-recipient words', () => {
    const m = validateMail({ ...base, design: { html: '<p>Hi {name}</p><img src="cid:esb-d1">', images: [{ cid: 'esb-d1', dataUrl: PNG }] }, vars: { name: 'Rahim', 'bad key': 'x' } })
    expect(m.design.images[0]).toMatchObject({ cid: 'esb-d1', filename: 'esb-d1.png', contentType: 'image/png' })
    expect(m.vars).toEqual({ name: 'Rahim' })
  })
  it('refuses a picture that is not an image, a bad cid, or too many pictures', () => {
    expect(() => validateMail({ ...base, design: { html: '<p>x</p>', images: [{ cid: 'esb-d1', dataUrl: 'data:text/html;base64,PGI+' }] } })).toThrow(/PNG, JPEG/)
    expect(() => validateMail({ ...base, design: { html: '<p>x</p>', images: [{ cid: '../x', dataUrl: PNG }] } })).toThrow(/Bad picture/)
    expect(() => validateMail({ ...base, design: { html: '<p>x</p>', images: Array.from({ length: 25 }, (_, i) => ({ cid: `esb-d${i + 1}`, dataUrl: PNG })) } })).toThrow(/at most 24/)
    expect(() => validateMail({ ...base, design: { html: '  ', images: [] } })).toThrow(/empty/)
  })
  it('an ordinary letter is unchanged', () => {
    const m = validateMail(base)
    expect(m.design).toBeNull()
    expect(m.vars).toEqual({})
  })
})
