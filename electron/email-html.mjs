// ESB Studio — the email as recipients get it. One file, used by both sides: the main process builds every message
// it sends with it (electron/mailer.cjs), and the Outreach desk's Preview renders with it, so what the editor sees is
// what goes out, byte for byte apart from the logo's address (cid: in the mail, a bundled URL in the preview).
//
// The editor writes plain text with a few marks, the same family as the Editorial body:
//   blank line = new paragraph · "## " heading · "- " bullets · "1. " numbered · "> " quote · "---" divider
//   **bold** · *italic* · [words](https://link) · bare https:// links
// Every character is escaped before a mark is read, and a link may only be https: or mailto:, so no markup from a
// workbook cell, a pasted text or an AI reply reaches a recipient as markup.

const BRAND = { green: '#1e9b4a', red: '#e52d2d', orange: '#ec8e3c', ink: '#1f2937', muted: '#6b7280', line: '#e5e7eb' }

// The printed letterhead's own palette (sampled from the artwork) and the facts its footer and QR state. Kept as a
// plain copy rather than an import so this file stays dependency-free on the main-process side — see officialPad.ts
// for the one this mirrors; edit both if a contact detail changes.
const PAD = { gold: '#ffe4a6', cream: '#fffef2' }
const PAD_CONTACT = {
  org: 'ESB PowerLine',
  tagline: 'Safe Energy Safe Nation',
  url: 'https://esbpowerline.com',
  urlLabel: 'esbpowerline.com',
  email: 'news@esbpowerline.com',
  phone: '+88 01711 378733',
  addressLine: 'House#36/1, Avenue#01, Block#A, Section#10, Mirpur, Pallabi, Dhaka-1216',
  facebook: 'https://www.facebook.com/esbpowerlineofficial',
  youtube: 'https://www.youtube.com/@esbplbd',
}

export const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const safeUrl = (u) => (/^(https:\/\/[^\s"'<>]+|mailto:[^\s"'<>]+)$/i.test(u) ? u : null)

/** One line's inline marks, on text that is already escaped. */
function inline(escaped) {
  let s = escaped
  // [label](url) first, so the url inside is not linked twice
  s = s.replace(/\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)/g, (m, label, url) => {
    const u = safeUrl(url.replace(/&amp;/g, '&'))
    return u ? `<a href="${escapeHtml(u)}" style="color:#1d4ed8">${label}</a>` : m
  })
  s = s.replace(/(^|[\s(])(https:\/\/[^\s<]+[^\s<.,;:)!?'"])/g, (m, pre, url) => `${pre}<a href="${url}" style="color:#1d4ed8">${url}</a>`)
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, '$1<em>$2</em>')
  return s
}

/** The body's blocks: paragraphs, headings, lists, quotes, dividers. */
export function blocksToHtml(text, font) {
  const out = []
  const paras = String(text).replace(/\r\n?/g, '\n').split(/\n{2,}/)
  const p = (inner, extra = '') => `<p style="margin:0 0 14px;${extra}">${inner}</p>`
  for (const block of paras) {
    const lines = block.split('\n').filter((l) => l.trim() !== '')
    if (!lines.length) continue
    if (lines.length === 1 && /^-{3,}$/.test(lines[0].trim())) { out.push(`<hr style="border:0;border-top:1px solid ${BRAND.line};margin:18px 0">`); continue }
    if (lines.length === 1 && /^#{2,3}\s+/.test(lines[0])) { out.push(`<h3 style="margin:18px 0 8px;font-size:16px;line-height:1.35;color:${BRAND.ink};font-family:${font}">${inline(escapeHtml(lines[0].replace(/^#{2,3}\s+/, '')))}</h3>`); continue }
    if (lines.every((l) => /^\s*[-•]\s+/.test(l))) { out.push(`<ul style="margin:0 0 14px;padding-left:22px">${lines.map((l) => `<li style="margin:0 0 6px">${inline(escapeHtml(l.replace(/^\s*[-•]\s+/, '')))}</li>`).join('')}</ul>`); continue }
    if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) { out.push(`<ol style="margin:0 0 14px;padding-left:22px">${lines.map((l) => `<li style="margin:0 0 6px">${inline(escapeHtml(l.replace(/^\s*\d+[.)]\s+/, '')))}</li>`).join('')}</ol>`); continue }
    if (lines.every((l) => /^>\s?/.test(l))) { out.push(`<blockquote style="margin:0 0 14px;padding:4px 0 4px 14px;border-left:3px solid ${BRAND.line};color:#374151">${lines.map((l) => inline(escapeHtml(l.replace(/^>\s?/, '')))).join('<br>')}</blockquote>`); continue }
    out.push(p(lines.map((l) => inline(escapeHtml(l))).join('<br>')))
  }
  return out.join('\n')
}

/** The plain-text part: the same words without the marks; links as "words (link)". */
export function blocksToText(text) {
  return String(text).replace(/\r\n?/g, '\n')
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, '$1$2')
    .replace(/^#{2,3}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .trim()
}

/**
 * The official-pad frame: the printed letterhead reproduced as an email table (not a background image behind the
 * text — Outlook's Word engine does not render CSS background-image, and a background-heavy, text-light email is
 * exactly what spam filters flag, which matters at 2,000 recipients). Gold left rail, the real sidebar artwork
 * cropped from the letterhead, the contact QR pinned to the bottom of the rail with `valign="bottom"` (plain table
 * alignment — works in every client, unlike flexbox), logo + tagline header, the pad's own contact footer.
 * `sidebarSrc`/`qrSrc` are cid: addresses when sending, data URLs in the preview — same pattern as `logoSrc`.
 */
function padFrame({ inner, font, lang, logoSrc, sidebarSrc, qrSrc }) {
  const c = PAD_CONTACT
  const header = `<div style="padding:22px 26px 6px">`
    + `<img src="${escapeHtml(logoSrc)}" width="140" alt="${escapeHtml(c.org)}" style="display:block;width:140px;height:auto;border:0">`
    + `<div style="margin-top:6px;font-size:12px;letter-spacing:.04em;color:${BRAND.muted}">${escapeHtml(c.tagline)}</div>`
    + `</div>`
  const footer = `<div style="padding:14px 26px 20px;border-top:1px solid ${BRAND.line};color:${BRAND.muted};font-size:11.5px;line-height:1.7">`
    + `<a href="${c.url}" style="color:${BRAND.muted};text-decoration:none">${escapeHtml(c.urlLabel)}</a>`
    + ` &nbsp;·&nbsp; <a href="mailto:${c.email}" style="color:${BRAND.muted};text-decoration:none">${escapeHtml(c.email)}</a>`
    + ` &nbsp;·&nbsp; ${escapeHtml(c.phone)}<br>`
    + `${escapeHtml(c.addressLine)}<br>`
    + `<a href="${c.facebook}" style="color:${BRAND.muted};text-decoration:none">Facebook</a>`
    + ` &nbsp;·&nbsp; <a href="${c.youtube}" style="color:${BRAND.muted};text-decoration:none">YouTube</a>`
    + `</div>`
  const rail = `<td width="72" valign="bottom" style="background:${PAD.gold};padding:0;font-size:0;line-height:0">`
    + `<img src="${escapeHtml(sidebarSrc)}" width="72" alt="" style="display:block;width:72px;height:auto;border:0">`
    + `<div style="padding:10px 9px;background:${PAD.gold}"><img src="${escapeHtml(qrSrc)}" width="54" height="54" alt="Scan for ${escapeHtml(c.org)}'s contact details" style="display:block;width:54px;height:54px;border:4px solid ${PAD.cream};background:#ffffff"></div>`
    + `</td>`
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:680px;margin:0 auto;background:${PAD.cream}"><tr>`
    + rail
    + `<td valign="top" style="background:${PAD.cream}">${header}<div style="padding:4px 26px 8px">${inner}</div>${footer}</td>`
    + `</tr></table>`
}

/**
 * The whole message. `letterhead` adds the plain ESB header (logo + the three brand stripes) and footer;
 * `officialPad` (takes priority over `letterhead` — one chrome, never both stacked) wraps the letter in the full
 * gold-rail pad frame instead, see `padFrame`. `logoSrc`/`sidebarSrc`/`qrSrc` are "cid:esb-…" when sending and the
 * bundled image URL / a generated data URL in the preview.
 */
export function renderEmail({
  body, signature = '', optOut = '', lang = 'en', letterhead = false, logoSrc = 'cid:esb-logo',
  officialPad = false, sidebarSrc = 'cid:esb-pad-sidebar', qrSrc = 'cid:esb-pad-qr',
}) {
  const font = lang === 'bn' ? "'Hind Siliguri','Noto Sans Bengali','Nirmala UI',Arial,sans-serif" : "Arial,Helvetica,sans-serif"
  const sig = String(signature).trim()
  const stripes = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${[BRAND.green, BRAND.red, BRAND.orange].map((c) => `<td style="height:4px;background:${c};font-size:0;line-height:0">&nbsp;</td>`).join('')}</tr></table>`
  const chrome = letterhead && !officialPad
  const head = chrome
    ? `${stripes}<div style="padding:20px 28px 8px"><img src="${escapeHtml(logoSrc)}" width="150" alt="ESB PowerLine" style="display:block;width:150px;height:auto;border:0"></div>`
    : ''
  const foot = chrome
    ? `<div style="padding:14px 28px 22px;color:${BRAND.muted};font-size:12px;line-height:1.5;border-top:1px solid ${BRAND.line}">ESB PowerLine · Express Broadcast and Communication Ltd. · <a href="https://esbpowerline.com" style="color:${BRAND.muted}">esbpowerline.com</a></div>${stripes}`
    : ''
  const inner = `${blocksToHtml(body, font)}`
    + (sig ? `<div style="margin:18px 0 0;color:#374151">${blocksToHtml(sig, font)}</div>` : '')
    + (optOut ? `<p style="margin:22px 0 0;color:${BRAND.muted};font-size:12px;line-height:1.5">${escapeHtml(optOut)}</p>` : '')
  const body_ = officialPad
    ? padFrame({ inner, font, lang, logoSrc, sidebarSrc, qrSrc })
    : `<div style="max-width:640px;margin:0 auto;background:#ffffff;font-family:${font};font-size:15px;line-height:1.6;color:${BRAND.ink}">${head}<div style="padding:${chrome ? '12px 28px 8px' : '4px 0'}">${inner}</div>${foot}</div>`
  const html = `<!doctype html><html lang="${lang === 'bn' ? 'bn' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>`
    + `<body style="margin:0;padding:0;background:${officialPad ? PAD.cream : '#ffffff'};font-family:${font};font-size:15px;line-height:1.6;color:${BRAND.ink}">`
    + body_
    + `</body></html>`
  const text = [blocksToText(body), sig ? blocksToText(sig) : '', optOut ? `—\n${optOut}` : ''].filter(Boolean).join('\n\n')
  return { html, text }
}
