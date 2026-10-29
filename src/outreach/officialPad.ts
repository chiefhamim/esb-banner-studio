// The "official pad" — ESB PowerLine's printed letterhead (gold sidebar, QR, contact footer) reproduced as the
// email's frame when a campaign turns it on. The sidebar graphic is cropped straight from the real letterhead
// artwork (tools/fixtures has no business owning brand art, so it is not re-derived here); only the QR is generated,
// because the one printed on paper encodes nothing this app can verify — a fresh one is built from the facts this
// file states, never guessed at.
//
// Shared with electron/email-html.mjs (CommonJS) the same way BRAND colours are: the constants are plain data, no
// imports, so both sides can hold their own copy without drifting. If a contact detail changes, edit both.

/** Every fact the pad's QR and footer state — all of it printed on the source letterhead or given by the editor
 *  directly (the Facebook and YouTube links), never invented. */
export const ESB_CONTACT = {
  org: 'ESB PowerLine',
  legalName: 'Express Broadcast and Communication Ltd.',
  url: 'https://esbpowerline.com',
  email: 'news@esbpowerline.com',
  phone: '+88 01711 378733',
  addressLine: 'House#36/1, Avenue#01, Block#A, Section#10, Mirpur, Pallabi, Dhaka-1216',
  facebook: 'https://www.facebook.com/esbpowerlineofficial',
  youtube: 'https://www.youtube.com/@esbplbd',
} as const

/** A standard vCard (3.0): any phone camera reads it as a contact card showing the org, phone, email, address and —
 *  in the note — both social links, which is the only way a QR shows more than one URL at once. */
export function buildVCard(): string {
  const c = ESB_CONTACT
  return [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:;${c.org};;;`,
    `FN:${c.org}`,
    `ORG:${c.org};${c.legalName}`,
    `TEL;TYPE=WORK,VOICE:${c.phone}`,
    `EMAIL;TYPE=WORK:${c.email}`,
    `URL:${c.url}`,
    `ADR;TYPE=WORK:;;${c.addressLine};;;;Bangladesh`,
    `NOTE:Facebook: ${c.facebook}  |  YouTube: ${c.youtube}`,
    'END:VCARD',
  ].join('\n')
}
