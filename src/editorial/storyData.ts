// Pin the article body for sites that ship their story as data (Quintype: Prothom Alo and others). Shared by the PC and the
// phone (vendored into ESB Studio Phone src/pc/editorial by tools/sync-pc.mjs); parseArticleDocument runs it on every page.
//
// Found on 2026-11-05: a Prothom Alo video post has one paragraph in its markup, so the extractor fell back to "page data"
// and collected every long string in the page's site-wide JSON (a Kishor Alo submissions widget, a BNP explainer, a Trump
// explainer): 19 "paragraphs", of which one was the story. The AI then translated a mix of the story and the junk.
//
// Quintype pages carry the page's own story at qt.data.story.cards[].story-elements. Here, before the extractor sees the
// page, that story's text elements become a JSON-LD articleBody (which the extractor prefers), and the site-wide data
// block is emptied so the junk fallback can never run. Other pages pass through unchanged. Running it twice is harmless.

interface QtElement { type?: string; subtype?: string | null; text?: string }
interface QtStory { headline?: string; subheadline?: string; slug?: string; url?: string; cards?: { 'story-elements'?: QtElement[] }[] }

const SKIP_SUBTYPES = new Set(['also-read', 'q-and-a', 'cta', 'references'])

const decode = (s: string) => s
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))

/** HTML of one text element → its paragraphs (an element can hold several <p>). */
function paragraphsOf(html: string): string[] {
  return decode(html.replace(/<\/(p|li|h\d|blockquote)>/gi, '\n\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
    .split(/\n\s*\n+/).map((t) => t.replace(/\s+/g, ' ').trim()).filter((t) => t.length > 0)
}

export function storyParagraphs(story: QtStory): string[] {
  const out: string[] = []
  for (const card of story.cards ?? []) {
    for (const el of card['story-elements'] ?? []) {
      if (el.subtype && SKIP_SUBTYPES.has(el.subtype)) continue
      if ((el.type === 'text' || el.type === 'title') && el.text) out.push(...paragraphsOf(el.text))
    }
  }
  return out
}

const DATA_SCRIPT = /<script type="application\/json" id="static-page">([\s\S]*?)<\/script>/

/** The page with its own story pinned as the article body, or the page unchanged when it is not a Quintype story page. */
export function pinStoryBody(html: string): string {
  const m = html.match(DATA_SCRIPT)
  if (!m) return html
  let story: QtStory | undefined
  try { story = (JSON.parse(m[1]) as { qt?: { data?: { story?: QtStory } } }).qt?.data?.story } catch { return html }
  if (!story?.cards?.length) return html
  const paras = storyParagraphs(story)
  if (!paras.length) return html
  const ld = JSON.stringify({ '@context': 'https://schema.org', '@type': 'NewsArticle', headline: story.headline, description: story.subheadline, articleBody: paras.join('\n\n') })
    .replace(/</g, '\\u003c')
  const tag = `<script type="application/ld+json">${ld}</script>`
  const withoutData = html.replace(DATA_SCRIPT, '<script type="application/json" id="static-page">{}</script>')
  return /<head[^>]*>/i.test(withoutData) ? withoutData.replace(/<head[^>]*>/i, (h) => h + tag) : tag + withoutData
}
