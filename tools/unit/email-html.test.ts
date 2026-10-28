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
})
