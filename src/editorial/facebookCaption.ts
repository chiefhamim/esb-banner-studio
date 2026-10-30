// The Facebook Page caption: short enough that neither phone nor desktop folds it behind "See more", written like an
// editor rather than a bot, with no link in it (the article link goes in the post's first comment) and its hashtags
// together on one line at the bottom. The style text below is given to the model that writes it (the translation call
// and the Social "Write with AI" job); `sanitizeFacebook` then holds whatever comes back to the same shape.

export const FACEBOOK_STYLE = `Facebook caption (the text under the banner picture on the ESB Power Line Page):
- Write like a sharp human news editor, not a bot: plain, specific, active voice. Open with the single most striking fact in the story (a number, a place, a decision), then stop.
- One or two short lines, 125 characters in all, so no "See more" button appears on a phone or a desktop. Never a paragraph.
- No link, and no "read more", "click", "link in comments" or question that baits a click.
- Avoid the giveaways of machine writing: no em dashes, no "Moreover", "landscape", "game-changer", "Here's what", no "BREAKING:", no all-caps words, at most one emoji.
- Use only facts the story states.
- After the text, a blank line, then ONE line of 3 to 5 hashtags: CamelCase, specific to this story and to Bangladesh's energy sector (for example #Bangladesh #LNG #Energy), with #ESBPowerLine last.`

/** The schema note for the same field. */
export const FACEBOOK_FIELD = 'Facebook caption: one or two short lines, 125 characters in all, the most striking fact first, human editor voice, no link, no em dashes; then a blank line and ONE line of 3 to 5 CamelCase hashtags ending with #ESBPowerLine.'

const URL_RE = /https?:\/\/\S+/gi
const TEXT_LIMIT = 125

/** Hold a caption to the shape: no links, at most two lines of text within 125 characters, one hashtag line (3 to 5). */
export function sanitizeFacebook(raw: string, fallbackHeadline = ''): string {
  const cleaned = (raw ?? '').replace(URL_RE, ' ').replace(/\r/g, '')
  const tags: string[] = []
  for (const m of cleaned.matchAll(/#[\p{L}\p{N}_]+/gu)) {
    const t = m[0]
    if (!tags.some((x) => x.toLowerCase() === t.toLowerCase())) tags.push(t)
  }
  // the brand tag closes the line, and a line never carries more than five
  const brand = tags.filter((t) => t.toLowerCase() === '#esbpowerline')
  const rest = tags.filter((t) => t.toLowerCase() !== '#esbpowerline').slice(0, brand.length ? 4 : 5)
  const line = [...rest, ...(brand.length ? brand : [])].slice(0, 5).join(' ')

  const lines = cleaned
    .replace(/#[\p{L}\p{N}_]+/gu, ' ')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  let body = lines.slice(0, 2).join('\n')
  if (!body) body = (fallbackHeadline ?? '').replace(/\s+/g, ' ').trim()
  if (body.length > TEXT_LIMIT) {
    // drop the second line first; if the first alone is still long, cut at a word
    if (lines[0] && lines[0].length <= TEXT_LIMIT) body = lines[0]
    else {
      // too long: end at the last clause that fits (a comma or semicolon), so the caption still reads as a whole thought;
      // only if there is no such place is it cut at a word
      const head = (lines[0] ?? body).slice(0, TEXT_LIMIT)
      const clause = Math.max(head.lastIndexOf(', '), head.lastIndexOf('; '))
      body = clause >= 60 ? head.slice(0, clause).trim() + '.' : head.replace(/\s+\S*$/, '').replace(/[,;:–—-]+$/, '') + '…'
    }
  }
  return line ? (body ? `${body}\n\n${line}` : line) : body
}
