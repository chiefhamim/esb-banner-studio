// ESB Studio — the email as recipients get it. One file, used by both sides: the main process builds every message
// it sends with it (electron/mailer.cjs), and the Outreach desk's Preview renders with it, so what the editor sees is
// what goes out, byte for byte apart from the logo's address (cid: in the mail, a bundled URL in the preview).
//
// The editor writes plain text with a few marks, the same family as the Editorial body:
//   blank line = new paragraph (plain Enter in the desk's editors; Shift+Enter breaks the line instead) ·
//   "## " heading · "- " bullets · "1. " numbered · "> " quote · "-> " centred · "---" divider ·
//   **bold** · *italic* · [words](https://link) · bare https:// links
// Every character is escaped before a mark is read, and a link may only be https: or mailto:, so no markup from a
// workbook cell, a pasted text or an AI reply reaches a recipient as markup.

const BRAND = { green: '#1e9b4a', red: '#e52d2d', orange: '#ec8e3c', ink: '#1f2937', muted: '#6b7280', line: '#e5e7eb' }

// The printed letterhead's own palette (sampled from the artwork) and the facts its footer and QR state. Kept as a
// plain copy rather than an import so this file stays dependency-free on the main-process side — see officialPad.ts
// for the one this mirrors; edit both if a contact detail changes.
const PAD = { gold: '#ffe4a6', cream: '#fffef2' }
const PAD_CONTACT = {
  org: 'ESB Power Line',
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
    if (lines.every((l) => /^->\s+/.test(l))) { out.push(p(lines.map((l) => inline(escapeHtml(l.replace(/^->\s+/, '')))).join('<br>'), 'text-align:center')); continue }
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
    .replace(/^->\s+/gm, '')
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
function padFrame({ inner, font, lang, logoSrc, sidebarSrc, qrSrc, optOut = '' }) {
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
    + (optOut ? `<div style="margin-top:8px;font-size:10.5px;color:${BRAND.muted};opacity:0.85">${escapeHtml(optOut)}</div>` : '')
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
 * bundled image URL / a generated data URL in the preview. `fontFamily` is an id into EMAIL_FONTS (an unknown id
 * falls back to the default, never passed through as written); `headerBg`/`footerBg` are #rrggbb colours for the
 * plain letterhead's header and footer blocks (ignored for official pad, which keeps its own gold rail) — an invalid
 * value is dropped, never inserted into the style attribute as given; the footer's own text switches to black or
 * white automatically so a dark footerBg never leaves its text unreadable. `stripeColors` is "#rrggbb,#rrggbb,#rrggbb"
 * for the three bars above the header and below the footer — a bar left blank or not a real hex keeps DEFAULT_STRIPES'
 * colour for that bar.
 */
// The plain letterhead's default footer line, in the letter's own marks ([text](https://link)) — the editor's own
// text once they open Letter → Footer text, never hardcoded again after the first version had to be asked each
// time a word in it needed to change.
export const DEFAULT_FOOTER_LINE = 'ESB Power Line · [esbpowerline.com](https://esbpowerline.com)'

// Latin font choices, picked for one reason: these are the handful that render as themselves (not a silent fallback)
// across Outlook desktop, Gmail, Apple Mail and the rest — not "whatever is installed on the editor's PC", which has
// no effect on how a recipient's own mail client renders the message. A fixed list, not free text: the value ends up
// inside a style="" attribute, so an id the list doesn't know about is refused rather than inserted as written.
export const EMAIL_FONTS = [
  { id: 'sans', label: 'Arial (default)', stack: 'Arial,Helvetica,sans-serif' },
  { id: 'verdana', label: 'Verdana', stack: 'Verdana,Geneva,sans-serif' },
  { id: 'tahoma', label: 'Tahoma', stack: 'Tahoma,Geneva,sans-serif' },
  { id: 'trebuchet', label: 'Trebuchet MS', stack: "'Trebuchet MS',Helvetica,sans-serif" },
  { id: 'georgia', label: 'Georgia (serif)', stack: "Georgia,'Times New Roman',serif" },
  { id: 'times', label: 'Times New Roman (serif)', stack: "'Times New Roman',Times,serif" },
  { id: 'courier', label: 'Courier New (monospace)', stack: "'Courier New',Courier,monospace" },
]
const HEX_COLOR = /^#[0-9a-f]{6}$/i
// the three bars above the header and below the footer — a fixed default, overridable per campaign
export const DEFAULT_STRIPES = [BRAND.green, BRAND.red, BRAND.orange]

/** Black or white, whichever reads on the given background — so a footer background the editor picks dark does not
 *  also leave its own text unreadably grey; '' (no custom background) keeps the ordinary muted grey. */
function textOn(hex) {
  if (!HEX_COLOR.test(String(hex))) return ''
  const n = parseInt(hex.slice(1), 16)
  const yiq = (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000
  return yiq >= 150 ? BRAND.ink : '#ffffff'
}

// ------------------------------------------------------------------ designed HTML letters
// A designed email (Letter → Designed HTML) is a full HTML page the editor built elsewhere, used as it is instead of
// the marks above. It is the editor's own file, but the renderer is treated as hostile here as everywhere, so the
// page is cut down to what a mail client should ever see before anything else happens:
//   - no script, iframe, object, embed, form or input, base, meta refresh, link or svg; no on…= handlers;
//   - links only https:, mailto: or #anchor; images only cid: pictures carried inside the message (so a design
//     can never load a tracking pixel or anything else from a server);
//   - CSS url(...) only cid:, @import dropped.
// Per-recipient words go in as {key} / {key|fallback} placeholders, filled with escaped text (never markup);
// {unsubscribe} becomes the sender's own opt-out address. Same function for the Preview and for the sent message.

export const DESIGN_MAX_HTML = 300_000
export const DESIGN_CID_RE = /^esb-d[0-9]{1,3}$/
const PLACEHOLDER = /\{([a-z][a-z0-9_]*)(?:\|([^{}\n<>]*))?\}/gi
const NAME_FALLBACK = { en: 'Sir/Madam', bn: 'মহোদয়' }

export function sanitizeDesignHtml(input) {
  let h = String(input ?? '').slice(0, DESIGN_MAX_HTML)
  // whole elements whose content must go too
  h = h.replace(/<(script|iframe|object|embed|svg|math|template|noscript|form|select|textarea|title)\b[\s\S]*?<\/\1\s*>/gi, '')
  // void or stray tags
  h = h.replace(/<\/?(script|iframe|object|embed|svg|math|template|frame|frameset|applet|base|link|form|input|button|select|textarea|option|portal|meta)\b[^>]*>/gi, (m) =>
    /^<meta\b/i.test(m) && !/http-equiv/i.test(m) ? m : '')
  // event handlers and inline javascript in any attribute
  h = h.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  h = h.replace(/\s(href|src|background|action|formaction|xlink:href|poster|lowsrc|dynsrc)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, (m, attr, _q, a, b, c) => {
    const v = String(a ?? b ?? c ?? '').trim()
    const name = attr.toLowerCase()
    if (name === 'href') return /^(https:\/\/|mailto:|#)/i.test(v) || v === '{unsubscribe}' ? ` href="${v.replace(/"/g, '&quot;')}"` : ' href="#"'
    if (name === 'src' || name === 'background') return /^cid:esb-d[0-9]{1,3}$/i.test(v) ? ` ${name}="${v}"` : ''
    return ''
  })
  // CSS: no @import, url() only to cid:, no expression()/behavior
  h = h.replace(/@import[^;]*;?/gi, '')
  h = h.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (m, _q, u) => (/^cid:esb-d[0-9]{1,3}$/i.test(u.trim()) ? `url(${u.trim()})` : 'none'))
  h = h.replace(/expression\s*\(|behavior\s*:|-moz-binding/gi, '')
  return h
}

/** {key} / {key|fallback} → the recipient's value, escaped; {unsubscribe} → the opt-out address. */
export function fillDesign(html, vars = {}, { lang = 'en', unsubscribeHref = '' } = {}) {
  return String(html).replace(PLACEHOLDER, (m, rawKey, fallback) => {
    const key = rawKey.toLowerCase()
    if (key === 'unsubscribe') return escapeHtml(unsubscribeHref || '#')
    const v = String(vars?.[key] ?? '').trim()
    if (v) return escapeHtml(v)
    if (fallback !== undefined) return escapeHtml(fallback)
    return key === 'name' ? NAME_FALLBACK[lang === 'bn' ? 'bn' : 'en'] : ''
  })
}

/** The words of a designed page, for the text/plain part and for the desk's checks. */
export function designText(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(style|head|script)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<div[^>]*display\s*:\s*none[^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/<a\b[^>]*href="(https:[^"]+|mailto:[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, inner) => {
      const words = inner.replace(/<[^>]+>/g, '').trim()
      // a link around a picture or an icon only has no words to show in plain text; it is dropped, not printed bare
      return words && !href.includes(words.replace(/\s+/g, '')) ? `${words} (${href.replace(/\?utm_[^"]*$/, '')})` : words
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h[1-6]|tr|li|table|div)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&middot;/g, '·').replace(/&rarr;/g, '→').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#?\w+;/g, ' ')
    .split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).filter((l, i, a) => l || (a[i - 1] ?? '') !== '')
    .join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * A designed letter as it goes out. `imageSrc(cid)` gives each picture's address: the cid itself when sending, a
 * data URL in the Preview. Returns the same { html, text } shape as renderEmail.
 */
export function renderDesigned({ html, vars = {}, lang = 'en', unsubscribeHref = '', optOut = '', imageSrc = (cid) => `cid:${cid}` }) {
  const clean = sanitizeDesignHtml(html)
  let out = fillDesign(clean, vars, { lang, unsubscribeHref })
  out = out.replace(/cid:(esb-d[0-9]{1,3})/gi, (m, cid) => imageSrc(cid.toLowerCase()) || m)
  if (!/<html[\s>]/i.test(out)) out = `<!doctype html><html lang="${lang === 'bn' ? 'bn' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="margin:0">${out}</body></html>`
  const words = designText(fillDesign(clean, vars, { lang, unsubscribeHref }))
  const text = [words, optOut ? `—\n${optOut}` : ''].filter(Boolean).join('\n\n')
  return { html: out, text }
}

export function renderEmail({
  body, signature = '', optOut = '', lang = 'en', letterhead = false, logoSrc = 'cid:esb-logo',
  officialPad = false, sidebarSrc = 'cid:esb-pad-sidebar', qrSrc = 'cid:esb-pad-qr', footerLine = DEFAULT_FOOTER_LINE,
  fontFamily = 'sans', headerBg = '', footerBg = '', stripeColors = '',
}) {
  // Bengali always keeps its own script font regardless of the Latin choice — substituting one of the picks above
  // for Bengali text would render as tofu in most clients, which have no Bengali glyphs in Georgia or Courier New.
  const latin = (EMAIL_FONTS.find((f) => f.id === fontFamily) ?? EMAIL_FONTS[0]).stack
  const font = lang === 'bn' ? "'Hind Siliguri','Noto Sans Bengali','Nirmala UI',Arial,sans-serif" : latin
  const headBg = HEX_COLOR.test(String(headerBg)) ? headerBg : ''
  const footBg = HEX_COLOR.test(String(footerBg)) ? footerBg : ''
  const footInk = textOn(footBg) || BRAND.muted
  // one colour per bar; a bar whose value is missing or not a real hex keeps its own default rather than going blank
  const given = String(stripeColors).split(',').map((s) => s.trim())
  const bars = DEFAULT_STRIPES.map((def, i) => (HEX_COLOR.test(given[i]) ? given[i] : def))
  const sig = String(signature).trim()
  const foundation = String(footerLine).trim()
  const stripes = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${bars.map((c) => `<td style="height:4px;background:${c};font-size:0;line-height:0">&nbsp;</td>`).join('')}</tr></table>`
  const chrome = letterhead && !officialPad
  const head = chrome
    ? `${stripes}<div style="padding:20px 28px 8px${headBg ? `;background:${headBg}` : ''}"><img src="${escapeHtml(logoSrc)}" width="150" alt="ESB Power Line" style="display:block;width:150px;height:auto;border:0"></div>`
    : ''
  const optOutLine = optOut ? `<div style="margin-top:8px;font-size:11px;color:${footInk};opacity:0.85">${escapeHtml(optOut)}</div>` : ''
  const foot = chrome && (foundation || optOut)
    ? `<div style="padding:14px 28px 20px;color:${footInk};font-size:12px;line-height:1.5;border-top:1px solid ${BRAND.line}${footBg ? `;background:${footBg}` : ''}">${foundation ? inline(escapeHtml(foundation)) : ''}${optOutLine}</div>${stripes}`
    : chrome ? stripes : ''
  const inner = `${blocksToHtml(body, font)}`
    + (sig ? `<div style="margin:18px 0 0;color:#374151">${blocksToHtml(sig, font)}</div>` : '')
    + (!chrome && !officialPad && optOut ? `<p style="margin:22px 0 0;color:${BRAND.muted};font-size:12px;line-height:1.5">${escapeHtml(optOut)}</p>` : '')
  const body_ = officialPad
    ? padFrame({ inner, font, lang, logoSrc, sidebarSrc, qrSrc, optOut })
    : `<div style="max-width:640px;margin:0 auto;background:#ffffff;font-family:${font};font-size:15px;line-height:1.6;color:${BRAND.ink}">${head}<div style="padding:${chrome ? '12px 28px 8px' : '4px 0'}">${inner}</div>${foot}</div>`
  const html = `<!doctype html><html lang="${lang === 'bn' ? 'bn' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>`
    + `<body style="margin:0;padding:0;background:${officialPad ? PAD.cream : '#ffffff'};font-family:${font};font-size:15px;line-height:1.6;color:${BRAND.ink}">`
    + body_
    + `</body></html>`
  const text = [blocksToText(body), sig ? blocksToText(sig) : '', optOut ? `—\n${optOut}` : ''].filter(Boolean).join('\n\n')
  return { html, text }
}
