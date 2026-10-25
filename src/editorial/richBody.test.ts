// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { bodyForPublish, htmlToPlain, plainToHtml, richOf, sanitizeBodyHtml } from './richBody'

describe('sanitizeBodyHtml', () => {
  it('keeps what the site keeps', () => {
    const html = '<h2>Title</h2><p>Hi <strong>there</strong> <a href="https://x.com/a">link</a></p><ul><li><p>one</p></li></ul><blockquote><p>q</p></blockquote><table><tbody><tr><th>A</th><td colspan="2">B</td></tr></tbody></table><hr>'
    const out = sanitizeBodyHtml(html)
    for (const part of ['<h2>Title</h2>', '<strong>there</strong>', 'href="https://x.com/a"', 'rel="noopener noreferrer"', '<ul><li><p>one</p></li></ul>', '<blockquote>', 'colspan="2"', '<hr>']) expect(out).toContain(part)
  })
  it('strips scripts, handlers, bad links, data images and foreign styles', () => {
    const out = sanitizeBodyHtml('<p onclick="x()" style="position:fixed;color:red">a<script>alert(1)</script></p><a href="javascript:alert(1)">b</a><img src="data:image/png;base64,AAA"><span style="background-color: url(x)">c</span><font>d</font>')
    expect(out).not.toMatch(/script|onclick|javascript|data:|position|url\(|<font/)
    expect(out).toContain('abd'.slice(0, 1))
  })
  it('keeps a colour/background-color style and an http image', () => {
    const out = sanitizeBodyHtml('<p><span style="background-color: rgb(253, 230, 138)">x</span></p><img src="https://a.com/p.png" alt="p">')
    expect(out).toContain('background-color: rgb(253, 230, 138)')
    expect(out).toContain('<img src="https://a.com/p.png" alt="p">')
  })
  it('drops empty paragraphs', () => { expect(sanitizeBodyHtml('<p></p><p>a</p>')).toBe('<p>a</p>') })
})

describe('plain text', () => {
  it('round-trips paragraphs', () => { expect(htmlToPlain(plainToHtml('One.\n\nTwo & three.'))).toBe('One.\n\nTwo & three.') })
  it('turns lists, quotes and tables into paragraphs', () => {
    expect(htmlToPlain('<h2>H</h2><ul><li><p>a</p></li><li><p>b</p></li></ul><blockquote><p>q</p></blockquote><table><tbody><tr><td>x</td><td>y</td></tr></tbody></table>')).toBe('H\n\na\n\nb\n\nq\n\nx\n\ny')
  })
})

describe('richOf / bodyForPublish', () => {
  const html = '<h2>H</h2><p>Body</p>'
  it('uses the rich copy while it matches the plain text', () => {
    const d = { body: htmlToPlain(html), bodyHtml: html }
    expect(richOf(d)).toBe(html)
    expect(bodyForPublish(d)).toBe(html)
  })
  it('ignores a stale rich copy', () => {
    const d = { body: 'Edited elsewhere.', bodyHtml: html }
    expect(richOf(d)).toBeNull()
    expect(bodyForPublish(d)).toBe('<p>Edited elsewhere.</p>')
  })
})
