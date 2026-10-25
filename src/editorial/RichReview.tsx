// The Verified view of a formatted story: the same headings, lists, quotes and tables as the site will show, with every
// text run passed through the fact checker so figures still read green (in the source) or amber (not found).

import { createElement } from 'react'
import type { ReactNode } from 'react'

const TAGS = new Set(['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'strong', 'em', 'u', 's', 'sub', 'sup', 'hr', 'br', 'figure', 'figcaption', 'span'])

function styleOf(el: Element): React.CSSProperties | undefined {
  const bg = (el as HTMLElement).style?.backgroundColor
  return bg ? { backgroundColor: bg, color: '#1a1a1a', borderRadius: 3 } : undefined
}

function walk(node: Node, key: string, text: (t: string) => ReactNode): ReactNode {
  if (node.nodeType === 3) return text(node.textContent ?? '')
  if (node.nodeType !== 1) return null
  const el = node as Element
  const tag = el.tagName.toLowerCase()
  if (tag === 'img') return <img key={key} src={el.getAttribute('src') ?? ''} alt={el.getAttribute('alt') ?? ''} className={el.getAttribute('class') ?? undefined} />
  if (tag === 'a') return <span key={key} className="rv-link">{Array.from(el.childNodes).map((c, i) => walk(c, key + '.' + i, text))}</span>
  if (!TAGS.has(tag)) return Array.from(el.childNodes).map((c, i) => walk(c, key + '.' + i, text))
  const kids = tag === 'hr' || tag === 'br' ? undefined : Array.from(el.childNodes).map((c, i) => walk(c, key + '.' + i, text))
  const cls = el.getAttribute('class') ?? undefined
  const props: Record<string, unknown> = { key, className: cls, style: tag === 'span' ? styleOf(el) : undefined }
  if (tag === 'th' || tag === 'td') { const cs = el.getAttribute('colspan'); if (cs) props.colSpan = Number(cs) }
  return createElement(tag, props, kids)
}

export function RichReview({ html, text }: { html: string; text: (t: string) => ReactNode }) {
  const doc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html')
  return <div className="rv article-body">{Array.from(doc.body.childNodes).map((n, i) => walk(n, 'r' + i, text))}</div>
}
