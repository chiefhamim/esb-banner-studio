import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain ESM shared with the main process, no type declarations
import { renderEmail, blocksToHtml, blocksToText } from '../../electron/email-html.mjs'

describe('email-html: the only HTML a recipient gets', () => {
  it('escapes markup from a workbook cell or an AI reply', () => {
    const h = blocksToHtml('Dear <img src=x onerror=alert(1)>,\n\n<script>x</script>', 'Arial')
    expect(h).not.toMatch(/<img|<script/)
    expect(h).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })
  it('links only https and mailto, never javascript:', () => {
    const h = blocksToHtml('[site](https://esbpowerline.com) [mail](mailto:desk@example.com) [bad](javascript:alert(1)) https://esbpowerline.com/articles/x.', 'Arial')
    expect(h).toContain('<a href="https://esbpowerline.com" style="color:#1d4ed8">site</a>')
    expect(h).toContain('href="mailto:desk@example.com"')
    expect(h).not.toContain('href="javascript')
    expect(h).toContain('<a href="https://esbpowerline.com/articles/x" style="color:#1d4ed8">https://esbpowerline.com/articles/x</a>.')
  })
  it('reads the marks: paragraphs, heading, bullets, numbered, quote, divider, bold, italic', () => {
    const h = blocksToHtml('## What we offer\n\n- One\n- Two\n\n1. First\n2. Second\n\n> Quoted\n\n---\n\n**Bold** and *italic* words', 'Arial')
    expect(h).toMatch(/<h3[^>]*>What we offer<\/h3>/)
    expect(h.match(/<li /g)).toHaveLength(4)
    expect(h).toMatch(/<ul[^>]*>.*<\/ul>/)
    expect(h).toMatch(/<ol[^>]*>.*<\/ol>/)
    expect(h).toMatch(/<blockquote[^>]*>Quoted<\/blockquote>/)
    expect(h).toContain('<hr ')
    expect(h).toContain('<strong>Bold</strong> and <em>italic</em> words')
  })
  it('the plain-text part has the same words without the marks', () => {
    expect(blocksToText('## Head\n\n**Bold** [site](https://esbpowerline.com)\n> q')).toBe('Head\n\nBold site (https://esbpowerline.com)\nq')
  })
  it('letterhead: logo by cid, brand stripes, footer; signature and opt-out included in both parts', () => {
    const { html, text } = renderEmail({ body: 'Hello', signature: 'Desk\nESB PowerLine', optOut: 'Reply unsubscribe', letterhead: true })
    expect(html).toContain('src="cid:esb-logo"')
    expect(html).toContain('#1e9b4a')
    expect(html).toContain('esbpowerline.com')
    expect(text).toBe('Hello\n\nDesk\nESB PowerLine\n\n—\nReply unsubscribe')
    expect(renderEmail({ body: 'x', lang: 'bn' }).html).toContain('Hind Siliguri')
  })
  it('the default footer line names ESB PowerLine and links the site — nothing else baked in', () => {
    const { html } = renderEmail({ body: 'Hello', letterhead: true })
    expect(html).toContain('ESB PowerLine')
    expect(html).toContain('href="https://esbpowerline.com"')
    expect(html).not.toContain('Express Broadcast and Communication Ltd.')
  })
  it('the footer line is the editor\'s own text (Letter → Footer text), same marks as the body', () => {
    const { html } = renderEmail({ body: 'Hello', letterhead: true, footerLine: '**ESB Desk** — [reply here](mailto:desk@example.com)' })
    expect(html).toContain('<strong>ESB Desk</strong>')
    expect(html).toContain('href="mailto:desk@example.com"')
    expect(html).not.toContain('esbpowerline.com') // the default text is gone, not merely appended to
  })
  it('an empty footer line removes the footer entirely — the stripes still show', () => {
    const { html } = renderEmail({ body: 'Hello', letterhead: true, footerLine: '' })
    expect(html).not.toContain('border-top:1px solid')
    expect(html).toContain('#1e9b4a') // the brand stripes
  })
  it('official pad: gold rail, logo, sidebar and QR by cid, the pad footer, and it wins over letterhead', () => {
    const { html } = renderEmail({ body: 'Hello', letterhead: true, officialPad: true })
    expect(html).toContain('#ffe4a6') // the rail's own gold, not a guess
    expect(html).toContain('src="cid:esb-logo"')
    expect(html).toContain('src="cid:esb-pad-sidebar"')
    expect(html).toContain('src="cid:esb-pad-qr"')
    expect(html).toContain('valign="bottom"') // the QR is pinned to the rail's foot with table alignment, not CSS position
    expect(html).toContain('Safe Energy Safe Nation')
    expect(html).toContain('facebook.com/esbpowerlineofficial')
    expect(html).toContain('youtube.com/@esbplbd')
    expect(html).toContain('House#36/1, Avenue#01, Block#A, Section#10, Mirpur, Pallabi, Dhaka-1216')
    // the plain letterhead chrome (brand stripes) must not also render underneath the pad
    expect(html).not.toContain('#1e9b4a')
  })
  it('official pad never uses a CSS background-image — Outlook\'s Word engine does not render one', () => {
    const { html } = renderEmail({ body: 'Hello', officialPad: true })
    expect(html).not.toMatch(/background-image\s*:/)
  })
})
