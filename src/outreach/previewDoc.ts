// What the editor sees in an email preview frame. The letter's HTML is the real email (electron/email-html.mjs); this
// only adds viewer styling around it: a slim scrollbar like the app's, and — on request — how the mail apps that force
// a dark mode show it. Gmail's and Outlook's phone apps invert a letter that does not declare its own dark colours
// (light backgrounds go dark, text goes light, pictures are kept); that is emulated here with the same full inversion,
// pictures turned back. Apple Mail keeps such a letter light, so this is the harsher, most common case.
export type MailLook = 'light' | 'dark'

const SLIM = `::-webkit-scrollbar{width:12px;height:12px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:rgba(120,120,120,.38);background-clip:padding-box;border:3px solid transparent;border-radius:999px}::-webkit-scrollbar-thumb:hover{background-color:rgba(120,120,120,.58)}`
const DARK = `html{filter:invert(1) hue-rotate(180deg);background:#fff}img,picture,video,svg image,[style*="background-image"]{filter:invert(1) hue-rotate(180deg)}`

export function previewDoc(html: string, look: MailLook = 'light'): string {
  const css = `<style data-esb-viewer>${SLIM}${look === 'dark' ? DARK : ''}</style>`
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, css + '</head>')
  if (/<body[^>]*>/i.test(html)) return html.replace(/<body([^>]*)>/i, `<head>${css}</head><body$1>`)
  return css + html
}
