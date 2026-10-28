// The renderer's door to electron/email-html.mjs — the file the main process builds every sent message with — so the
// Preview is the email itself, not a look-alike. Only the logo's address differs: cid: in the mail, a data URL here.

// @ts-expect-error — plain ESM shared with the main process, no type declarations
import { renderEmail as render } from '../../electron/email-html.mjs'
import logoUrl from '../assets/images/esb-logo.png'
import type { OutreachLang } from './types'

export interface RenderInput { body: string; signature?: string; optOut?: string; lang?: OutreachLang; letterhead?: boolean; logoSrc?: string }
export const renderEmail = render as (i: RenderInput) => { html: string; text: string }

// the preview frame is sandboxed with no origin, so the logo goes in as a data URL (read once from the bundled file)
let logo: Promise<string> | null = null
export function logoDataUrl(): Promise<string> {
  return (logo ??= fetch(logoUrl).then((r) => r.blob()).then((b) => new Promise<string>((res, rej) => {
    const f = new FileReader(); f.onload = () => res(String(f.result)); f.onerror = () => rej(f.error); f.readAsDataURL(b)
  })).catch(() => ''))
}

/** For the preview frames only: a mail client shows a message inside its own margin, so a letter without the
 *  letterhead gets one here. The message that is sent is unchanged. */
export const withViewerMargin = (html: string, letterhead: boolean) => (letterhead ? html : html.replace('<body style="margin:0;padding:0;', '<body style="margin:0;padding:20px 24px;'))
