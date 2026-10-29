// The renderer's door to electron/email-html.mjs — the file the main process builds every sent message with — so the
// Preview is the email itself, not a look-alike. Only the logo's address differs: cid: in the mail, a data URL here.

// @ts-expect-error — plain ESM shared with the main process, no type declarations
import { renderEmail as render, EMAIL_FONTS as FONTS, DEFAULT_STRIPES as STRIPES } from '../../electron/email-html.mjs'
import QRCode from 'qrcode'
import logoUrl from '../assets/images/esb-logo.png'
import sidebarUrl from '../assets/images/outreach/pad-sidebar.png'
import { buildVCard } from './officialPad'
import type { OutreachLang } from './types'

export interface RenderInput {
  body: string; signature?: string; optOut?: string; lang?: OutreachLang; letterhead?: boolean; logoSrc?: string
  officialPad?: boolean; sidebarSrc?: string; qrSrc?: string; footerLine?: string; fontFamily?: string
  headerBg?: string; footerBg?: string; stripeColors?: string
}
export const renderEmail = render as (i: RenderInput) => { html: string; text: string }
/** The only Latin fonts the desk offers — chosen for rendering the same in Outlook, Gmail and Apple Mail, not for
 *  what happens to be installed on this PC (which a recipient's mail client never sees). See email-html.mjs. */
export const EMAIL_FONTS = FONTS as { id: string; label: string; stack: string }[]
/** The three bars' own default colours (ESB green, red, orange) — see email-html.mjs. */
export const DEFAULT_STRIPES = STRIPES as string[]

// the preview frame is sandboxed with no origin, so bundled images go in as data URLs, read once
const asDataUrl = (url: string) => fetch(url).then((r) => r.blob()).then((b) => new Promise<string>((res, rej) => {
  const f = new FileReader(); f.onload = () => res(String(f.result)); f.onerror = () => rej(f.error); f.readAsDataURL(b)
})).catch(() => '')

let logo: Promise<string> | null = null
export function logoDataUrl(): Promise<string> {
  return (logo ??= asDataUrl(logoUrl))
}

let sidebar: Promise<string> | null = null
export function padSidebarDataUrl(): Promise<string> {
  return (sidebar ??= asDataUrl(sidebarUrl))
}

// generated, not read from a file — the QR printed on paper encodes nothing this app can verify, so the preview
// builds its own from the same facts officialPad.ts states, exactly as a real send will
let qr: Promise<string> | null = null
export function padQrDataUrl(): Promise<string> {
  return (qr ??= QRCode.toDataURL(buildVCard(), { margin: 0, scale: 6, color: { dark: '#1f2937', light: '#ffffff' } }).catch(() => ''))
}

/** For the preview frames only: a mail client shows a message inside its own margin, so a letter without the
 *  letterhead gets one here. The message that is sent is unchanged. */
export const withViewerMargin = (html: string, letterhead: boolean, officialPad = false) =>
  (letterhead || officialPad ? html : html.replace('<body style="margin:0;padding:0;', '<body style="margin:0;padding:20px 24px;'))
