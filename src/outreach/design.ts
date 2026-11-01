// A designed HTML letter (Letter → Designed HTML): a finished email page built elsewhere (Figma, a generator, an
// agency), sent as it is instead of the desk's marks. The file should be self-contained — pictures written into it as
// data: URLs — and each picture is lifted out here and named cid:esb-dN, so it travels inside the message and nothing
// is ever loaded from a server. Linked pictures (src="assets/…" or https://…) cannot be carried and are reported.
// The page itself is cut down by electron/email-html.mjs (sanitizeDesignHtml) in the Preview and again at send.

// @ts-expect-error — plain ESM shared with the main process, no type declarations
import { sanitizeDesignHtml, designText, renderDesigned as render, DESIGN_MAX_HTML } from '../../electron/email-html.mjs'
import { fieldValue, usedPlaceholders } from './compose'
import type { Contact, OutreachLang } from './types'

export interface DesignImage { cid: string; dataUrl: string }
export interface DesignLetter { name: string; html: string; images: DesignImage[]; importedAt: number }

export const renderDesigned = render as (i: {
  html: string; vars?: Record<string, string>; lang?: OutreachLang; unsubscribeHref?: string; optOut?: string; imageSrc?: (cid: string) => string
}) => { html: string; text: string }

/** Gmail refuses a message over 25 MB; the pictures share the 18 MB the attachments already use. */
export const DESIGN_MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_IMAGES = 24

const dataBytes = (u: string) => Math.floor((u.length - u.indexOf(',') - 1) * 3 / 4)

export interface DesignImport { design: DesignLetter; text: string; notes: string[] }

/** Read an HTML file's text into a designed letter, or throw a sentence the editor can act on. */
export function importDesign(name: string, raw: string): DesignImport {
  if (!/<(table|div|body|p)\b/i.test(raw)) throw new Error(`${name} does not look like an HTML email`)
  const notes: string[] = []
  const found = new Map<string, string>()
  const cidFor = (uri: string) => {
    let cid = found.get(uri)
    if (!cid) { cid = `esb-d${found.size + 1}`; found.set(uri, cid) }
    return `cid:${cid}`
  }
  const DATA = /data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+/g
  let html = raw.replace(DATA, (u) => cidFor(u))
  if (found.size > MAX_IMAGES) throw new Error(`${name} has ${found.size} pictures; a designed letter may carry ${MAX_IMAGES}`)
  const images = [...found].map(([dataUrl, cid]) => ({ cid, dataUrl }))
  const bytes = images.reduce((n, i) => n + dataBytes(i.dataUrl), 0)
  if (bytes > DESIGN_MAX_IMAGE_BYTES) throw new Error(`The pictures in ${name} come to ${(bytes / 1048576).toFixed(1)} MB; keep them under ${DESIGN_MAX_IMAGE_BYTES / 1048576} MB`)
  // pictures that are links (a file beside the page, or a server) cannot travel with the message
  const linked = [...html.matchAll(/\s(?:src|background)\s*=\s*["']?(?!cid:|#|["'])([^"'\s>]+)/gi)].map((m) => m[1])
  if (linked.length) notes.push(`${linked.length} picture${linked.length === 1 ? ' is a link' : 's are links'} (${linked[0]}${linked.length > 1 ? ` and ${linked.length - 1} more` : ''}) and will not show. Use the self-contained export of the page.`)
  if (/<script\b|\son[a-z]+\s*=/i.test(html)) notes.push('Scripts and event handlers were removed; mail clients never run them.')
  if (/<link\b[^>]*fonts\.googleapis/i.test(html)) notes.push('Web fonts are not loaded in email; the page falls back to its own font list (Gmail and Outlook show Arial).')
  html = html.replace(/\{\{\s*unsubscribe(?:_url)?\s*\}\}/gi, '{unsubscribe}')
  if (!/\{unsubscribe\}/i.test(html)) notes.push('The page has no {unsubscribe} link. The opt-out line is still added to the plain-text part and the List-Unsubscribe header.')
  if (html.length > DESIGN_MAX_HTML) throw new Error(`${name} is too long once its pictures are lifted out (${Math.round(html.length / 1000)} kB; the limit is ${DESIGN_MAX_HTML / 1000} kB)`)
  const text = designText(sanitizeDesignHtml(html)) as string
  if (!text.trim()) throw new Error(`${name} has no words in it`)
  return { design: { name, html, images, importedAt: Date.now() }, text, notes }
}

/** The recipient's words for the placeholders the page uses ({unsubscribe} is the main process's). */
export function designVars(c: Contact, html: string, opener?: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of usedPlaceholders(html)) {
    if (key === 'unsubscribe') continue
    const v = fieldValue(c, key, opener).trim()
    if (v) out[key] = v
  }
  return out
}

/** For the wire: just the page and its pictures. */
export const designPayload = (d: DesignLetter) => ({ html: d.html, images: d.images.map((i) => ({ cid: i.cid, dataUrl: i.dataUrl })) })

export const designBytes = (d: DesignLetter) => d.images.reduce((n, i) => n + dataBytes(i.dataUrl), 0) + d.html.length

/** The Preview of a designed letter for one contact: the same renderer the main process sends with, pictures as data
 *  URLs instead of cid:, and the opt-out link pointing where the real one will. */
export function designPreviewHtml(d: DesignLetter, c: Contact, lang: OutreachLang, sender?: string, opener?: string): string {
  const src = new Map(d.images.map((i) => [i.cid, i.dataUrl]))
  return renderDesigned({
    html: d.html, vars: designVars(c, d.html, opener), lang,
    unsubscribeHref: sender ? `mailto:${sender}?subject=unsubscribe` : '#',
    imageSrc: (cid) => src.get(cid) ?? '',
  }).html
}
