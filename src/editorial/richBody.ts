// The story body as the site stores it: HTML limited to what esbpowerline.com's sanitiser keeps (lib/sanitize-article-html.ts).
// The Studio's editor, the AI and the publish step all go through `sanitizeBodyHtml`, so nothing the site would strip is ever sent.

import type { EditorialDraft } from './editorialStore'

const TAGS = new Set(['p', 'br', 'h1', 'h2', 'h3', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'sub', 'sup', 'ul', 'ol', 'li', 'blockquote', 'hr', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'figure', 'figcaption', 'img'])
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'head', 'title'])
const BLOCK = new Set(['p', 'h1', 'h2', 'h3', 'li', 'blockquote', 'th', 'td', 'figcaption'])
const CELL_CONTAINERS = new Set(['ul', 'ol', 'table', 'thead', 'tbody', 'tr', 'figure'])

const SAFE_URL = /^(https?:|mailto:)/i
const IMG_ALIGN = new Set(['article-img--full', 'article-img--left', 'article-img--center', 'article-img--right'])

/** Keep only the inline styles the site allows, and only values that cannot smuggle anything else in. */
function cleanStyle(style: string): string {
  const out: string[] = []
  for (const decl of style.split(';')) {
    const i = decl.indexOf(':')
    if (i < 0) continue
    const prop = decl.slice(0, i).trim().toLowerCase()
    const val = decl.slice(i + 1).trim()
    if (!val || /url\(|expression|javascript|[<>{}]/i.test(val)) continue
    if ((prop === 'color' || prop === 'background-color') && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%/]+\)|[a-z]{3,20})$/i.test(val)) out.push(`${prop}: ${val}`)
    else if (prop === 'text-align' && /^(left|right|center|justify)$/i.test(val)) out.push(`${prop}: ${val.toLowerCase()}`)
  }
  return out.join('; ')
}

function cleanNode(node: Node, doc: Document): Node[] {
  if (node.nodeType === 3) return [doc.createTextNode(node.textContent ?? '')]
  if (node.nodeType !== 1) return []
  const el = node as Element
  const tag = el.tagName.toLowerCase()
  if (DROP.has(tag)) return []
  const kids = Array.from(el.childNodes).flatMap((c) => cleanNode(c, doc))
  if (!TAGS.has(tag)) return kids
  if (tag === 'img') {
    const src = el.getAttribute('src') ?? ''
    if (!/^https?:/i.test(src)) return []
    const img = doc.createElement('img')
    img.setAttribute('src', src)
    const alt = el.getAttribute('alt'); if (alt) img.setAttribute('alt', alt)
    const title = el.getAttribute('title'); if (title) img.setAttribute('title', title)
    const cls = (el.getAttribute('class') ?? '').split(/\s+/).find((c) => IMG_ALIGN.has(c)); if (cls) img.setAttribute('class', cls)
    return [img]
  }
  const out = doc.createElement(tag === 'b' ? 'strong' : tag === 'i' ? 'em' : tag === 'strike' ? 's' : tag)
  if (tag === 'a') {
    const href = el.getAttribute('href') ?? ''
    if (!SAFE_URL.test(href.trim())) return kids
    out.setAttribute('href', href.trim()); out.setAttribute('rel', 'noopener noreferrer')
  }
  if (tag === 'td' || tag === 'th') {
    for (const a of ['colspan', 'rowspan']) { const v = el.getAttribute(a); if (v && /^\d{1,2}$/.test(v) && v !== '1') out.setAttribute(a, v) }
    const al = el.getAttribute('align'); if (al && /^(left|right|center)$/i.test(al)) out.setAttribute('align', al.toLowerCase())
  }
  if (tag === 'span' || tag === 'p' || tag === 'h1' || tag === 'h2' || tag === 'h3') {
    const st = cleanStyle(el.getAttribute('style') ?? ''); if (st) out.setAttribute('style', st)
  }
  if (tag === 'span' && !out.getAttribute('style')) return kids
  if (tag === 'figure') out.setAttribute('class', 'article-figure')
  for (const k of kids) out.appendChild(k)
  return [out]
}

/** Reduce any HTML to the subset the site keeps. Tables always get a table body; empty paragraphs are dropped. */
export function sanitizeBodyHtml(html: string): string {
  if (!html.trim()) return ''
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const root = doc.createElement('div')
  for (const n of Array.from(doc.body.childNodes).flatMap((c) => cleanNode(c, doc))) root.appendChild(n)
  for (const p of Array.from(root.querySelectorAll('p'))) if (!p.textContent?.trim() && !p.querySelector('img, br')) p.remove()
  return root.innerHTML.trim()
}

function blockTexts(el: Element, out: string[]) {
  for (const child of Array.from(el.children)) {
    const tag = child.tagName.toLowerCase()
    if (tag === 'hr') continue
    if (tag === 'img') continue
    if (CELL_CONTAINERS.has(tag)) { blockTexts(child, out); continue }
    if (tag === 'blockquote' && child.querySelector('p, li')) { blockTexts(child, out); continue }
    if (BLOCK.has(tag)) {
      const clone = child.cloneNode(true) as Element
      for (const br of Array.from(clone.querySelectorAll('br'))) br.replaceWith('\n')
      const t = (clone.textContent ?? '').replace(/[ \t ]+/g, ' ').replace(/ ?\n ?/g, '\n').trim()
      if (t) out.push(t)
      continue
    }
    blockTexts(child, out)
  }
}

/** The story as plain paragraphs (blank line between), which is what facts, SEO and video work from. Deterministic, so it can detect a stale rich copy. */
export function htmlToPlain(html: string): string {
  if (!html.trim()) return ''
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const out: string[] = []
  blockTexts(doc.body, out)
  return out.join('\n\n')
}

/** Plain paragraphs → the site's `<p>` markup. */
export function plainToHtml(body: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return body.replace(/\r/g, '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p).replace(/\n/g, '<br />')}</p>`).join('\n')
}

/** The rich copy of the story, if the draft still has one that matches its plain text (any other change to the text makes it stale and it is ignored). */
export function richOf(d: Pick<EditorialDraft, 'body' | 'bodyHtml'>): string | null {
  if (!d.bodyHtml) return null
  return htmlToPlain(d.bodyHtml) === d.body.trim() ? d.bodyHtml : null
}

/** What gets published: the rich HTML when it is current, otherwise the plain paragraphs. */
export function bodyForPublish(d: Pick<EditorialDraft, 'body' | 'bodyHtml'>): string {
  const rich = richOf(d)
  return sanitizeBodyHtml(rich ?? plainToHtml(d.body))
}
