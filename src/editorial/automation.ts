// Full newsroom automation pipeline: from pasted news link to ready-to-publish banner & editorial draft.

import { parseArticleDocument } from './extract'
import { adapterFor } from './siteAdapters'
import type { ExtractedArticle, ExtractedImage } from './extract'
import { extractFactTable, verifyDraftAgainstSource } from './facts'
import type { DiscrepancyFlag, FactItem } from './facts'
import {
  detectCategory,
  suggestHighlight,
} from '../core/newsroom'
import { translateNewsArticle } from './translator'
import { storyCaptions } from './aiDesk'
import { imageAssets, useStore } from '../store'
import { useEditorialStore } from './editorialStore'
import { autoDesk } from './deskFlag'

/** A fetch/extraction failure with the net-guard code, so the desk can say what happened and offer the paste fallback. */
export class IntakeError extends Error {
  code: string
  url: string
  constructor(code: string, message: string, url: string) {
    super(message)
    this.name = 'IntakeError'
    this.code = code
    this.url = url
  }
}

export interface IntakeErrorInfo {
  title: string
  detail: string
  /** The paste tab is the honest fallback for everything except a bad URL. */
  canPaste: boolean
}

export function describeIntakeError(err: unknown): IntakeErrorInfo {
  const e = err instanceof IntakeError ? err : null
  const code = e?.code ?? 'unknown'
  let host = ''
  try { host = e?.url ? new URL(e.url).hostname.replace(/^www\./, '') : '' } catch { host = '' }
  const site = host || 'the site'
  switch (code) {
    case 'invalid_url':
    case 'invalid_protocol':
      return { title: 'That is not a web address the desk can open', detail: 'Paste the full http(s) link to the story.', canPaste: false }
    case 'private_address':
      return { title: 'Local and private addresses are not fetched', detail: 'The studio only reads public news sites.', canPaste: false }
    case 'dns_error':
      return { title: `${site} could not be found`, detail: 'Check the address, or paste the story text.', canPaste: true }
    case 'timeout':
      return { title: `${site} did not answer in time`, detail: 'Try again in a moment, or paste the story text.', canPaste: true }
    case 'blocked':
    case 'rate_limited':
      return { title: `${site} refused the request`, detail: 'The publisher blocks automated readers (captcha, login or rate limit). Open the story in a browser and paste its text.', canPaste: true }
    case 'too_large':
    case 'bad_type':
      return { title: `${site} returned something that is not an article page`, detail: e?.message ?? '', canPaste: true }
    case 'empty_response':
      return { title: `${site} returned an empty page`, detail: 'The story may load in the browser only. Paste its text instead.', canPaste: true }
    case 'network_error':
    case 'stream_error':
    case 'bad_redirect':
    case 'too_many_redirects':
      return { title: `${site} could not be reached`, detail: e?.message ?? 'Network error.', canPaste: true }
    case 'http_error':
      return { title: `${site} answered with an error`, detail: e?.message ?? '', canPaste: true }
    default:
      return { title: 'The story could not be imported', detail: err instanceof Error ? err.message : String(err), canPaste: true }
  }
}

export interface AutomatedNewsResult {
  url: string
  /** Why the draft needs extra checking (untranslated text left in, or fewer paragraphs than the source). */
  translationNote?: string
  originalTitle: string
  originalDeck: string
  englishHeadline: string
  deck: string
  body: string
  slug: string
  focusKeywords: string
  metaTitle: string
  metaDescription: string
  byline: string
  credit: string
  date: string
  categoryId: string
  highlight: string
  paragraphs: string[]
  images: ExtractedImage[]
  extraction?: ExtractedArticle['meta']
  factTable: FactItem[]
  discrepancies: DiscrepancyFlag[]
  socialCaptions: {
    facebook: string
    x: string
    linkedin: string
    telegram: string
  }
}

// Cache mapping source image URL -> banner store image ID
const importedUrlToId = new Map<string, string>()

/** Banner-library image id for a remote photo URL that was imported earlier (null if never imported). */
export const bannerImageIdForUrl = (url: string): string | null => importedUrlToId.get(url.trim()) ?? null

/** Original public URL of a banner-library image, or null for local uploads (blob: URLs cannot be published). */
export function remoteUrlForImageId(id: string | null | undefined): string | null {
  if (!id) return null
  for (const [url, imgId] of importedUrlToId) if (imgId === id && /^https?:\/\//i.test(url)) return url
  return null
}

function dataUrlToFile(dataUrl: string, fileName: string): File | null {
  try {
    const commaIdx = dataUrl.indexOf(',')
    if (commaIdx < 0) return null
    const header = dataUrl.slice(0, commaIdx)
    const base64 = dataUrl.slice(commaIdx + 1)
    const mimeMatch = header.match(/data:([^;]+)/i)
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg'
    const binStr = atob(base64)
    const bytes = new Uint8Array(binStr.length)
    for (let i = 0; i < binStr.length; i++) {
      bytes[i] = binStr.charCodeAt(i)
    }
    return new File([bytes], fileName, { type: mime })
  } catch {
    return null
  }
}

async function loadUrlViaDomImage(url: string, fileName: string): Promise<{ file?: File; img?: HTMLImageElement } | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null
  // 1. Try with crossOrigin = 'anonymous' so we can extract a clean Blob
  const tryLoad = (cors: boolean) =>
    new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image()
      if (cors) img.crossOrigin = 'anonymous'
      const timer = setTimeout(() => resolve(null), 3500)
      img.onload = () => {
        clearTimeout(timer)
        resolve(img.naturalWidth > 0 ? img : null)
      }
      img.onerror = () => {
        clearTimeout(timer)
        resolve(null)
      }
      img.src = url
    })

  const corsImg = await tryLoad(true)
  if (corsImg) {
    try {
      const c = document.createElement('canvas')
      c.width = corsImg.naturalWidth
      c.height = corsImg.naturalHeight
      const ctx = c.getContext('2d')!
      ctx.drawImage(corsImg, 0, 0)
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.92))
      if (blob) {
        return { file: new File([blob], fileName, { type: 'image/jpeg' }), img: corsImg }
      }
    } catch {
      // fall through
    }
    return { img: corsImg }
  }

  const rawImg = await tryLoad(false)
  if (rawImg) return { img: rawImg }
  return null
}

/**
 * Robust cross-origin image importer for Graphics Studio.
 * Uses Electron's hardened net-guard background fetch (bypassing CORS) to convert
 * any article photo into a local File/Image and immediately assigns it into the banner canvas slot.
 */
export async function importImageToBanner(
  imageUrl: string,
  fileName = 'news-photo.jpg',
  options?: { slotIndex?: number; libraryOnly?: boolean },
): Promise<boolean> {
  const cleanUrl = imageUrl?.trim()
  if (!cleanUrl) return false
  const slotIndex = options?.slotIndex ?? 0
  const libraryOnly = options?.libraryOnly ?? false

  try {
    const store = useStore.getState()

    // Check if this exact URL is already loaded in the Graphics Studio library
    const cachedId = importedUrlToId.get(cleanUrl)
    if (cachedId && store.images.some((im) => im.id === cachedId) && imageAssets[cachedId]) {
      if (!libraryOnly) {
        if (slotIndex === 0 && store.doc.photos.collage !== 'single') {
          store.setCollage('single')
        }
        store.assignImage(slotIndex, cachedId)
      }
      return true
    }

    let file: File | null = null
    let fallbackImg: HTMLImageElement | null = null

    // 1. If already a data: URL, decode directly with zero network/CSP calls
    if (cleanUrl.startsWith('data:image/')) {
      file = dataUrlToFile(cleanUrl, fileName)
    }

    // 2. Fetch via Electron's background net-guard (bypasses CORS & hotlink blocks) with 3.5s timeout
    if (!file && typeof window !== 'undefined' && window.esb?.fetchImageData) {
      const imgRes = await window.esb.fetchImageData(cleanUrl, { timeoutMs: 3500 })
      if (imgRes.ok && imgRes.dataUrl) {
        file = dataUrlToFile(imgRes.dataUrl, fileName)
      }
    }

    // 3. Fallback: load via DOM <img> element (allowed by img-src https: http:)
    if (!file) {
      const domLoaded = await loadUrlViaDomImage(cleanUrl, fileName)
      if (domLoaded?.file) file = domLoaded.file
      else if (domLoaded?.img) fallbackImg = domLoaded.img
    }

    if (file) {
      await useStore.getState().addImages([file])
      const updatedStore = useStore.getState()
      const newest = updatedStore.images[updatedStore.images.length - 1]
      if (newest) {
        importedUrlToId.set(cleanUrl, newest.id)
        if (!libraryOnly) {
          if (slotIndex === 0 && updatedStore.doc.photos.collage !== 'single') {
            updatedStore.setCollage('single')
          }
          updatedStore.assignImage(slotIndex, newest.id)
        }
        return true
      }
    }

    // 4. Direct HTMLImageElement fallback (when running in browser without CORS headers)
    if (fallbackImg) {
      const id = 'img-' + Math.random().toString(36).slice(2, 9)
      imageAssets[id] = fallbackImg
      const newItem = {
        id,
        name: fileName,
        url: cleanUrl,
        w: fallbackImg.naturalWidth || 1200,
        h: fallbackImg.naturalHeight || 800,
      }
      useStore.setState((s) => ({ images: [...s.images, newItem] }))
      importedUrlToId.set(cleanUrl, id)
      if (!libraryOnly) {
        const st = useStore.getState()
        if (slotIndex === 0 && st.doc.photos.collage !== 'single') {
          st.setCollage('single')
        }
        st.assignImage(slotIndex, id)
      }
      window.dispatchEvent(new CustomEvent('esb:open-panel', { detail: 'Photo library' }))
      return true
    }

    return false
  } catch (err) {
    console.warn('Could not auto-load image to banner:', err)
    return false
  }
}

/**
 * Imports the lead photo into Slot 0 of the Graphics Banner and pre-loads up to 3 additional
 * scraped article photos into the Graphics Studio Photo Library.
 */
export async function syncArticlePhotosToBanner(images: ExtractedImage[]): Promise<boolean> {
  if (!images || images.length === 0) return false
  let leadLoaded = false
  for (let i = 0; i < Math.min(images.length, 4); i++) {
    const src = images[i]?.src
    if (!src) continue
    if (!leadLoaded) {
      const ok = await importImageToBanner(src, `article-lead-${i + 1}.jpg`, { slotIndex: 0, libraryOnly: false })
      if (ok) leadLoaded = true
    } else {
      void importImageToBanner(src, `article-photo-${i + 1}.jpg`, { libraryOnly: true })
    }
  }
  return leadLoaded
}

/**
 * Takes a news URL, fetches HTML, extracts content & media, detects sector category,
 * translates into natural journalistic English, highlights key financial/technical figures,
 * loads the lead photo into the canvas, and syncs both Editorial Desk and Graphics Studio.
 */
export async function automateNewsFromUrl(
  url: string,
  onProgress?: (status: string) => void,
): Promise<AutomatedNewsResult> {
  let cleanUrl = url.trim()
  if (!cleanUrl) throw new Error('Please enter a valid URL')
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(cleanUrl)) {
    cleanUrl = `https://${cleanUrl}`
  }

  // 1. Fetch HTML via the Electron net-guard bridge (desktop) or, in the browser, directly / through the local dev proxy.
  //    No third-party relay: the URL an editor is working on never leaves the machine except to the publisher.
  onProgress?.('Fetching story from URL…')
  let html = ''
  if (typeof window !== 'undefined' && window.esb?.fetchUrl) {
    const res = await window.esb.fetchUrl(cleanUrl)
    if (!res.ok || !res.html) {
      throw new IntakeError(res.code || 'network_error', res.error || 'Failed to fetch the page', cleanUrl)
    }
    html = res.html
  } else {
    try {
      const res = await fetch(cleanUrl)
      if (!res.ok) throw new IntakeError(res.status === 401 || res.status === 403 ? 'blocked' : res.status === 429 ? 'rate_limited' : 'http_error', `HTTP ${res.status}`, cleanUrl)
      html = await res.text()
    } catch (err) {
      if (err instanceof IntakeError) throw err
      let proxyRes: Response
      try {
        proxyRes = await fetch(`/api/proxy?url=${encodeURIComponent(cleanUrl)}`)
      } catch {
        throw new IntakeError('network_error', 'The browser could not reach the site (cross-origin fetch blocked).', cleanUrl)
      }
      if (!proxyRes.ok) throw new IntakeError(proxyRes.status === 502 ? 'network_error' : 'http_error', `Proxy HTTP ${proxyRes.status}`, cleanUrl)
      html = await proxyRes.text()
    }
  }

  // 2. Extract Document & Images
  onProgress?.('Extracting article content & media…')
  let article: ExtractedArticle = parseArticleDocument(html, cleanUrl)

  // A page that is built in the browser arrives with no story in its HTML. When the publisher's own JSON endpoint is
  // known (siteAdapters.ts), read the story from there — the request the page itself would make.
  if (article.paragraphs.length < 2 && typeof window !== 'undefined' && window.esb?.fetchUrl) {
    const hit = adapterFor(cleanUrl)
    if (hit) {
      onProgress?.('The page loads its story in the browser — reading it from the site’s own feed…')
      const api = await window.esb.fetchUrl(hit.apiUrl, { allowedTypes: ['application/json'], timeoutMs: 20000 })
      if (api.ok && api.html) {
        try {
          const built = hit.adapter.build(JSON.parse(api.html), cleanUrl, html.length)
          if (built) article = built
        } catch { /* not JSON: keep what the page itself gave */ }
      }
    }
  }

  const originalTitle = article.title || 'Untitled Story'
  const originalDeck = article.deck || ''
  const paragraphs = article.paragraphs
  const byline = article.byline || ''
  const credit = article.images[0]?.credit || article.publisher || (cleanUrl ? new URL(cleanUrl).hostname.replace(/^www\./, '') : '')

  // Store raw source article immediately (<200ms) for the Left Column
  useEditorialStore.getState().setSourceArticle(article, cleanUrl)

  // 3. Detect Sector Desk (1-10)
  onProgress?.('Classifying industry sector desk…')
  const combinedContext = [cleanUrl, originalTitle, originalDeck, paragraphs.slice(0, 3).join(' ')].join(' ')
  const categoryId = detectCategory(combinedContext) || '01'

  // 4. Translate & Polish Headline (< 104), Deck (< 200), Slug (< 80), and Full English Body (Fast Parallel Pipeline)
  onProgress?.('Translating story elements in parallel…')
  const translation = await translateNewsArticle({
    title: originalTitle,
    deck: originalDeck,
    paragraphs,
  }, onProgress)

  const englishHeadline = translation.headline
  const englishDeck = translation.deck
  const englishBody = translation.body
  const slug = translation.slug
  const focusKeywords = translation.focusKeywords
  const metaTitle = translation.metaTitle
  const metaDescription = translation.metaDescription

  useEditorialStore.getState().setTranslationMeta(translation.provider, translation.modelUsed)

  // 5. Date Parsing (YYYY-MM-DD)
  let date = new Date().toISOString().slice(0, 10)
  if (article.publishedAt) {
    const parsedDate = new Date(article.publishedAt)
    if (!isNaN(parsedDate.getTime())) {
      date = `${parsedDate.getFullYear()}-${String(parsedDate.getMonth() + 1).padStart(2, '0')}-${String(parsedDate.getDate()).padStart(2, '0')}`
    }
  }

  // 6. Highlight Selection (amounts, units, metrics)
  const highlight = suggestHighlight(englishHeadline)

  // 7. Fact Table & Discrepancies
  onProgress?.('Verifying facts, figures and entities…')
  const rawSourceText = [originalTitle, originalDeck, ...paragraphs].filter(Boolean).join('\n\n')
  const factTable = extractFactTable(rawSourceText)
  const draftText = `${englishHeadline} ${englishDeck} ${englishBody}`
  const discrepancies = verifyDraftAgainstSource(draftText, rawSourceText, factTable)

  // 8. Generate Platform Social Captions
  // every caption ends with the story's own link on esbpowerline.com; an AI provider rewrites them after intake
  const socialCaptions = storyCaptions({ headline: englishHeadline, deck: englishDeck, categoryId, slug })
  // the AI call that translated the story also wrote the Facebook caption (no extra request); free translation uses the template
  if (translation.facebook) socialCaptions.facebook = translation.facebook

  // 9. Sync Editorial Store with English Translation
  onProgress?.('Syncing Editorial Desk…')
  const edStore = useEditorialStore.getState()
  edStore.setDeskAuto(true)
  edStore.setDraftField('headline', englishHeadline)
  edStore.setDraftField('deck', englishDeck)
  edStore.setDraftField('slug', slug)
  edStore.setDraftField('focusKeywords', focusKeywords)
  edStore.setDraftField('metaTitle', metaTitle)
  edStore.setDraftField('metaDescription', metaDescription)
  edStore.setDraftField('byline', byline)
  edStore.setDraftField('credit', credit)
  edStore.setDraftField('bodyHtml', translation.bodyHtml ?? '')
  edStore.setDraftField('chartIdeas', translation.charts ?? [])
  edStore.setDraftField('body', englishBody)
  edStore.setSocialCaption('facebook', socialCaptions.facebook)
  edStore.setSocialCaption('x', socialCaptions.x)
  edStore.setSocialCaption('linkedin', socialCaptions.linkedin)
  edStore.setSocialCaption('telegram', socialCaptions.telegram)
  edStore.reverify()

  // 10. Sync Graphics Banner Store
  onProgress?.('Generating graphics banner…')
  const bannerStore = useStore.getState()
  autoDesk(() => bannerStore.setContent({
    headline: englishHeadline,
    categoryId,
    date,
    highlight: highlight || bannerStore.doc.content.highlight,
    credit: credit || bannerStore.doc.content.credit,
    caption: socialCaptions.facebook,
  }))

  // 11. Auto-Fetch and apply lead article photo to banner slot + pre-load remaining article photos in background
  if (article.images && article.images.length > 0) {
    onProgress?.('Importing article photos to Graphics Studio…')
    // Non-blocking: allows instant UI render while photo loads into slot 0 in the background
    void syncArticlePhotosToBanner(article.images)
  }

  bannerStore.setNotice(`Auto-generated news for: “${englishHeadline.slice(0, 36)}…”`)

  const translationNote = translation.translationFailed
    ? 'Part of the story could not be translated (no translation service answered) — the Bengali is left in place for you to translate.'
    : translation.coverageWarning
  return {
    translationNote,
    url: cleanUrl,
    originalTitle,
    originalDeck,
    englishHeadline,
    deck: englishDeck,
    body: englishBody,
    slug,
    focusKeywords,
    metaTitle,
    metaDescription,
    byline,
    credit,
    date,
    categoryId,
    highlight,
    paragraphs,
    images: article.images,
    extraction: article.meta,
    factTable,
    discrepancies,
    socialCaptions,
  }
}
