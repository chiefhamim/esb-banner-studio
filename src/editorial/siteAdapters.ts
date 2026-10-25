// Publishers whose article pages are rendered in the browser: the HTML that comes back holds only the head (title,
// description, lead image) and no story. Where a site publishes the text through its own public JSON endpoint, the desk
// asks that endpoint instead — the same request the site's page makes — and builds the same ExtractedArticle.
//
// Channel 24 (channel24bd.tv): a React app. /{category}/article/{id}/{slug} is served empty; the story is at
// https://backoffice.channel24bd.tv/api/v2/content-details/{category}/{id} (ContentDetails is the body as HTML).
// Barta24 (barta24.com): the same kind of app. /details/{category}/{id} is served as a bare shell; the story is at
// https://backoffice.barta24.com/api/content-details/{id}, where ContentDetails is a list of <p> strings (or one string)
// and the headline is DetailsHeading (ContentHeading is empty).

import { cleanAndDedupeParagraphs, detectLanguage, extractCatchSentence } from './extract'
import type { ExtractedArticle } from './extract'

export interface SiteAdapter {
  /** The JSON address that carries the story for this page, or null when the page is not one this adapter knows. */
  apiUrl: (pageUrl: URL) => string | null
  build: (json: unknown, pageUrl: string, htmlLength: number) => ExtractedArticle | null
}

const MEDIA = 'https://backoffice.channel24bd.tv/media/imgAll/'

/** Pull the text of every paragraph out of a body fragment, one entry per block. */
function paragraphsFromHtml(fragment: string): string[] {
  const blocks: string[] = []
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(`<div id="r">${fragment}</div>`, 'text/html')
    const root = doc.getElementById('r')
    root?.querySelectorAll('p, h2, h3, li').forEach((el) => blocks.push((el.textContent || '').replace(/\s+/g, ' ').trim()))
    if (!blocks.length && root?.textContent) blocks.push(root.textContent.replace(/\s+/g, ' ').trim())
  } else {
    for (const m of fragment.matchAll(/<(?:p|h2|h3|li)[^>]*>([\s\S]*?)<\/(?:p|h2|h3|li)>/gi)) blocks.push(m[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim())
  }
  return cleanAndDedupeParagraphs(blocks.filter(Boolean))
}

const channel24: SiteAdapter = {
  apiUrl(u) {
    if (!/(^|\.)channel24bd\.tv$/i.test(u.hostname)) return null
    const m = /^\/([^/]+)\/article\/(\d+)(?:\/|$)/.exec(u.pathname)
    return m ? `https://backoffice.channel24bd.tv/api/v2/content-details/${encodeURIComponent(decodeURIComponent(m[1]))}/${m[2]}` : null
  },
  build(json, pageUrl, htmlLength) {
    const row = (json as { contentDetails?: Record<string, unknown>[] } | null)?.contentDetails?.[0]
    if (!row) return null
    const text = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')
    const title = text(row.ContentHeading)
    const paragraphs = paragraphsFromHtml(typeof row.ContentDetails === 'string' ? row.ContentDetails : '')
    if (!title || !paragraphs.length) return null
    const brief = text(row.ContentBrief).replace(/<[^>]+>/g, '')
    const imagePath = text(row.ImageBgPath) || text(row.ImageSmPath)
    const caption = text(row.ImageBgPathCaption) || undefined
    // the page's own lead image is a plate with the headline printed on it; the plain photo is the better source
    return {
      title,
      deck: brief ? extractCatchSentence(brief, 200) : undefined,
      byline: text(row.WriterName) || undefined,
      publisher: 'Channel 24',
      publishedAt: text(row.create_date) ? text(row.create_date).replace(' ', 'T') + '+06:00' : undefined,
      canonicalUrl: pageUrl,
      paragraphs,
      images: imagePath ? [{ src: MEDIA + imagePath, alt: title, caption }] : [],
      rawHtmlLength: htmlLength,
      meta: { method: 'page-data', language: detectLanguage(`${title} ${paragraphs.slice(0, 3).join(' ')}`), warnings: [] },
    }
  },
}

const barta24: SiteAdapter = {
  apiUrl(u) {
    if (!/(^|\.)barta24\.com$/i.test(u.hostname)) return null
    const m = /^\/details\/[^/]+\/(\d+)(?:\/|$)/.exec(u.pathname)
    return m ? `https://backoffice.barta24.com/api/content-details/${m[1]}` : null
  },
  build(json, pageUrl, htmlLength) {
    const data = (json as { data?: Record<string, unknown>[] | Record<string, unknown> } | null)?.data
    const row = Array.isArray(data) ? data[0] : data
    if (!row) return null
    const text = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')
    const title = text(row.DetailsHeading) || text(row.ContentHeading)
    const body = Array.isArray(row.ContentDetails) ? row.ContentDetails.filter((x): x is string => typeof x === 'string').join('\n') : typeof row.ContentDetails === 'string' ? row.ContentDetails : ''
    const paragraphs = paragraphsFromHtml(body)
    if (!title || !paragraphs.length) return null
    const brief = text(row.ContentBrief).replace(/<[^>]+>/g, '')
    const imagePath = text(row.ImageBgPath) || text(row.ImageSmPath)
    const caption = text(row.ImageBgPathCaption) || undefined
    return {
      title,
      deck: brief ? extractCatchSentence(brief, 200) : undefined,
      byline: text(row.WriterName) || text(row.ByLine) || undefined,
      publisher: 'Barta24',
      publishedAt: text(row.created_at) || undefined,
      canonicalUrl: pageUrl,
      paragraphs,
      images: imagePath ? [{ src: 'https://cdn.barta24.com/' + imagePath.replace(/^\/+/, ''), alt: title, caption }] : [],
      rawHtmlLength: htmlLength,
      meta: { method: 'page-data', language: detectLanguage(`${title} ${paragraphs.slice(0, 3).join(' ')}`), warnings: [] },
    }
  },
}

const ADAPTERS: SiteAdapter[] = [channel24, barta24]

/** The adapter and JSON address for a page, or null when the page can be read from its own HTML. */
export function adapterFor(pageUrl: string): { adapter: SiteAdapter; apiUrl: string } | null {
  let u: URL
  try { u = new URL(pageUrl) } catch { return null }
  for (const adapter of ADAPTERS) {
    const apiUrl = adapter.apiUrl(u)
    if (apiUrl) return { adapter, apiUrl }
  }
  return null
}
