// The AI writes the story as plain text with a few line-start marks, so a model that ignores them still gives a normal story:
//
//   ## Heading          ### Sub-heading
//   - bullet            1. numbered           > a featured quotation (a second line "— Name, role" is the attribution)
//   | a | b |  rows     (first row is the header; a |---| line is allowed)
//   **bold**   ==highlight==   inline
//
// This turns that text into the site's HTML subset. Nothing is added or reworded: marks come off, structure goes on.

import { htmlToPlain, sanitizeBodyHtml } from './richBody'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function inline(text: string): string {
  return esc(text)
    .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/==([^=\n]+?)==/g, '<span style="background-color: #fde68a">$1</span>')
    .replace(/\n/g, '<br />')
}

const rowCells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
const isRule = (line: string) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)

function table(lines: string[]): string {
  const rows = lines.filter((l) => !isRule(l)).map(rowCells)
  if (rows.length < 2) return rows.map((r) => `<p>${inline(r.join(' · '))}</p>`).join('')
  const cols = Math.max(...rows.map((r) => r.length))
  const cell = (tag: string, r: string[], i: number) => `<${tag}>${inline(r[i] ?? '')}</${tag}>`
  const head = `<tr>${Array.from({ length: cols }, (_, i) => cell('th', rows[0], i)).join('')}</tr>`
  const body = rows.slice(1).map((r) => `<tr>${Array.from({ length: cols }, (_, i) => cell('td', r, i)).join('')}</tr>`).join('')
  return `<table><tbody>${head}${body}</tbody></table>`
}

/** The model's marked-up story → sanitised site HTML. */
export function storyMarkupToHtml(markup: string): string {
  const blocks = markup.replace(/\r/g, '').replace(/[ \t]+$/gm, '').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean)
  const out: string[] = []
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
    const first = lines[0]
    if (/^###\s+/.test(first) && lines.length === 1) out.push(`<h3>${inline(first.replace(/^###\s+/, ''))}</h3>`)
    else if (/^#{1,2}\s+/.test(first) && lines.length === 1) out.push(`<h2>${inline(first.replace(/^#{1,2}\s+/, ''))}</h2>`)
    else if (lines.every((l) => /^[-*•]\s+/.test(l))) out.push(`<ul>${lines.map((l) => `<li><p>${inline(l.replace(/^[-*•]\s+/, ''))}</p></li>`).join('')}</ul>`)
    else if (lines.every((l) => /^\d+[.)]\s+/.test(l))) out.push(`<ol>${lines.map((l) => `<li><p>${inline(l.replace(/^\d+[.)]\s+/, ''))}</p></li>`).join('')}</ol>`)
    else if (lines.every((l) => /^>\s?/.test(l))) out.push(`<blockquote>${lines.map((l) => `<p>${inline(l.replace(/^>\s?/, ''))}</p>`).join('')}</blockquote>`)
    else if (lines.length >= 2 && lines.every((l) => l.startsWith('|'))) out.push(table(lines))
    else out.push(`<p>${inline(lines.join('\n'))}</p>`)
  }
  return sanitizeBodyHtml(out.join(''))
}

/** Does this text use any structure marks at all? (A plain story needs no HTML.) */
export const hasStoryMarks = (markup: string) => /^(#{1,3}\s|[-*•]\s|\d+[.)]\s|>\s?|\|)/m.test(markup) || /\*\*[^*]+\*\*|==[^=]+==/.test(markup)

/** Marked-up story → { html, plain }; `plain` is exactly what the desk's checks read, and matches the HTML (see richBody.richOf). */
export function storyFromMarkup(markup: string): { html: string; plain: string } {
  const html = storyMarkupToHtml(markup)
  return { html, plain: htmlToPlain(html) }
}
