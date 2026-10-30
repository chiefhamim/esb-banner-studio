import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain ESM shared with the main process, no type declarations
import { renderEmail, blocksToHtml, blocksToText, EMAIL_FONTS } from '../../electron/email-html.mjs'

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
    const { html, text } = renderEmail({ body: 'Hello', signature: 'Desk\nESB Power Line', optOut: 'Reply unsubscribe', letterhead: true })
    expect(html).toContain('src="cid:esb-logo"')
    expect(html).toContain('#1e9b4a')
    expect(html).toContain('esbpowerline.com')
    expect(text).toBe('Hello\n\nDesk\nESB Power Line\n\n—\nReply unsubscribe')
    expect(renderEmail({ body: 'x', lang: 'bn' }).html).toContain('Hind Siliguri')
  })
  it('the default footer line names ESB Power Line and links the site — nothing else baked in', () => {
    const { html } = renderEmail({ body: 'Hello', letterhead: true })
    expect(html).toContain('ESB Power Line')
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
  it('"-> " centres a paragraph, in HTML and stripped from the plain-text part', () => {
    const h = blocksToHtml('-> A centred line\n-> and a second one', 'Arial')
    expect(h).toMatch(/<p style="margin:0 0 14px;text-align:center">A centred line<br>and a second one<\/p>/)
    expect(blocksToText('-> Centred\n\nNormal')).toBe('Centred\n\nNormal')
  })
  it('font family: a known id selects its stack, an unknown one falls back, Bengali never substitutes', () => {
    const georgia = EMAIL_FONTS.find((f: { id: string }) => f.id === 'georgia')
    expect(renderEmail({ body: 'x', fontFamily: 'georgia' }).html).toContain(`font-family:${georgia.stack}`)
    expect(renderEmail({ body: 'x', fontFamily: 'not-a-real-font' }).html).toContain('font-family:Arial,Helvetica,sans-serif')
    expect(renderEmail({ body: 'x', fontFamily: 'georgia', lang: 'bn' }).html).toContain("font-family:'Hind Siliguri'")
  })
  it('header background: a valid hex is used, an invalid one is dropped rather than inserted as written', () => {
    const ok = renderEmail({ body: 'x', letterhead: true, headerBg: '#112233' }).html
    expect(ok).toContain('background:#112233')
    const bad = renderEmail({ body: 'x', letterhead: true, headerBg: '"></div><script>alert(1)</script>' }).html
    expect(bad).not.toContain('<script>')
    expect(bad).not.toContain('background:"')
  })
  it('header background never applies to the official pad — it keeps its own gold rail', () => {
    const { html } = renderEmail({ body: 'x', officialPad: true, headerBg: '#112233' })
    expect(html).not.toContain('background:#112233')
  })
  it('footer background: a valid hex is used and the footer text switches to white on a dark pick', () => {
    const dark = renderEmail({ body: 'x', letterhead: true, footerLine: 'Dear reader', footerBg: '#111111' }).html
    expect(dark).toContain('background:#111111')
    expect(dark).toMatch(/color:#ffffff[^>]*background:#111111|background:#111111[^>]*color:#ffffff/)
    const light = renderEmail({ body: 'x', letterhead: true, footerLine: 'Dear reader', footerBg: '#ffffcc' }).html
    expect(light).toContain('color:#1f2937') // BRAND.ink — readable on a light pick
  })
  it('footer background: an invalid value never reaches the style attribute', () => {
    const { html } = renderEmail({ body: 'x', letterhead: true, footerLine: 'x', footerBg: 'red; } body { display:none' })
    expect(html).not.toContain('background:red')
  })
  it('stripe colours: each bar can be overridden independently, a blank or invalid bar keeps its own default', () => {
    const { html } = renderEmail({ body: 'x', letterhead: true, stripeColors: '#111111,,not-a-hex' })
    expect(html).toContain('background:#111111')
    expect(html).toContain('background:#e52d2d') // the default red, untouched
    expect(html).toContain('background:#ec8e3c') // the default orange, untouched
  })
})
