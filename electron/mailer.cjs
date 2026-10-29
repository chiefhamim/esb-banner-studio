// ESB Studio — the Outreach desk's mail sender, in the main process.
//
// The first version took the SMTP password, the recipient and any file path from the renderer and acted on them:
// `loadMailingList(path)` returned the bytes of any file on the PC, and an attachment carrying a `path` was read from
// disk and mailed to whatever address was named — so one hostile page could read the disk and post it out. Here the
// renderer can only ask for one email, to one plain address, with attachments it already holds as data, and the main
// process decides everything that matters:
//   - the SMTP account and password are saved here; the password is encrypted with the OS keychain (safeStorage,
//     DPAPI on Windows) and never goes back to the renderer;
//   - every campaign send is written to a ledger in userData, and the ledger enforces the daily cap, a floor on the
//     gap between sends and "never the same address twice within REPEAT_DAYS" unless the editor asked for a resend;
//   - every message carries List-Unsubscribe, so a recipient can opt out from the mail client itself.
// The checks are pure functions (unit-tested in tools/unit/mailer.test.ts); `createMailer` holds the state.

const fs = require('node:fs')
const path = require('node:path')

const EMAIL_RE = /^[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/
const HOST_RE = /^(?=.{4,253}$)([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/
const PORTS = new Set([25, 465, 587, 2525])
/** Gmail's own limit for an ordinary account is 500 a day; a campaign never asks for more. */
const MAX_DAILY = 500
/** However the renderer sets its pacing, two campaign emails are never closer than this. */
const MIN_GAP_SEC = 30
const REPEAT_DAYS = 7
/** A follow-up goes only to an address emailed at least this long ago, and at most once per FOLLOW_ONCE_DAYS. */
const FOLLOW_MIN_DAYS = 2
const FOLLOW_ONCE_DAYS = 30
const TESTS_PER_HOUR = 10
// tests skip the campaign cap but may go to any address, so they get a ceiling of their own for the day
const TESTS_PER_DAY = 30
/** Gmail refuses a message over 25 MB; base64 adds a third, so the raw files must stay under about 18 MB. */
const MAX_ATTACH_BYTES = 18 * 1024 * 1024
const MAX_ATTACHMENTS = 10
const ATTACH_TYPES = {
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
  txt: 'text/plain', csv: 'text/csv',
}
const DAY = 24 * 3600 * 1000

const oneLine = (s, max) => String(s ?? '').replace(/[\r\n\t\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max)
const isEmail = (s) => typeof s === 'string' && s.length <= 254 && EMAIL_RE.test(s)

/** The account and pacing the editor saves. Anything out of range is refused, not clamped silently. */
function validateSmtpSettings(s) {
  const o = s && typeof s === 'object' ? s : {}
  const host = String(o.host || '').trim().toLowerCase()
  if (!HOST_RE.test(host) || host === 'localhost') throw new Error('SMTP server must be a host name such as smtp.gmail.com')
  const port = Number(o.port)
  if (!PORTS.has(port)) throw new Error('SMTP port must be 465, 587, 25 or 2525')
  const user = String(o.user || '').trim()
  if (!isEmail(user)) throw new Error('Sender address is not a valid email address')
  const dailyLimit = Number(o.dailyLimit)
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > MAX_DAILY) throw new Error(`Daily limit must be 1–${MAX_DAILY}`)
  const minDelaySec = Number(o.minDelaySec), maxDelaySec = Number(o.maxDelaySec)
  if (!Number.isFinite(minDelaySec) || minDelaySec < MIN_GAP_SEC || minDelaySec > 3600) throw new Error(`Shortest wait must be ${MIN_GAP_SEC}–3600 seconds`)
  if (!Number.isFinite(maxDelaySec) || maxDelaySec < minDelaySec || maxDelaySec > 7200) throw new Error('Longest wait must be at least the shortest and at most 7200 seconds')
  // where replies are read (inbox.cjs); empty = worked out from the SMTP server
  const imapHost = String(o.imapHost || '').trim().toLowerCase()
  if (imapHost && (!HOST_RE.test(imapHost) || imapHost === 'localhost')) throw new Error('Inbox (IMAP) server must be a host name such as imap.gmail.com')
  return {
    host, port, secure: port === 465, user, imapHost,
    name: oneLine(o.name, 80).replace(/["<>]/g, '') || 'ESB PowerLine',
    dailyLimit, minDelaySec: Math.round(minDelaySec), maxDelaySec: Math.round(maxDelaySec),
  }
}

function attachmentFrom(a) {
  if (!a || typeof a !== 'object') throw new Error('Bad attachment')
  if ('path' in a) throw new Error('Attachments are sent as data, never as a path on disk')
  const name = oneLine(String(a.name || '').split(/[\\/]/).pop(), 120).replace(/[<>:"|?*]/g, '')
  const ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase()
  if (!ext || !ATTACH_TYPES[ext]) throw new Error(`${name || 'This file'}: only PDF, Office, image, text and CSV files can be attached`)
  const m = /^data:[^;,]*;base64,([A-Za-z0-9+/=\s]+)$/.exec(String(a.dataUrl || ''))
  if (!m) throw new Error(`${name}: the file data is missing`)
  return { filename: name, content: Buffer.from(m[1], 'base64'), contentType: ATTACH_TYPES[ext] }
}

/** One message as the renderer asks for it: a single plain address, a one-line subject, bounded bodies and files. */
function validateMail(m) {
  const o = m && typeof m === 'object' ? m : {}
  const to = String(o.to || '').trim()
  if (!isEmail(to)) throw new Error('Recipient must be one plain email address')
  const subject = oneLine(o.subject, 250)
  if (!subject) throw new Error('Subject is empty')
  // the body is plain text with a few marks (electron/email-html.mjs); the HTML part is built here from it, so no
  // markup from a workbook cell or an AI reply is ever sent as markup. `text` is the older field name.
  const body = String(o.body ?? o.text ?? '')
  if (!body.trim()) throw new Error('Message is empty')
  if (body.length > 100_000) throw new Error('Message is too long')
  const signature = String(o.signature ?? '')
  if (signature.length > 3000) throw new Error('Signature is too long')
  const optOut = oneLine(o.optOut, 400)
  const lang = o.lang === 'bn' ? 'bn' : 'en'
  const list = Array.isArray(o.attachments) ? o.attachments : []
  if (list.length > MAX_ATTACHMENTS) throw new Error(`At most ${MAX_ATTACHMENTS} attachments`)
  const attachments = list.map(attachmentFrom)
  const bytes = attachments.reduce((n, a) => n + a.content.length, 0)
  if (bytes > MAX_ATTACH_BYTES) throw new Error('Attachments are over 18 MB together — Gmail would refuse the message')
  return { to: to.toLowerCase(), subject, body, signature, optOut, lang, letterhead: o.letterhead === true, officialPad: o.officialPad === true, attachments, isTest: o.isTest === true, resend: o.resend === true, followUp: o.followUp === true && o.isTest !== true }
}

/** May this send go now? Reads the ledger of earlier sends. */
function ledgerCheck(ledger, now, settings, mail) {
  const recent = ledger.filter((e) => now - e.t < DAY)
  if (mail.isTest) {
    const lastHour = ledger.filter((e) => e.kind === 'test' && now - e.t < 3600 * 1000).length
    if (lastHour >= TESTS_PER_HOUR) return { ok: false, reason: `Test limit reached (${TESTS_PER_HOUR} an hour)` }
    const today = recent.filter((e) => e.kind === 'test').length
    return today >= TESTS_PER_DAY ? { ok: false, reason: `Test limit reached (${TESTS_PER_DAY} a day)` } : { ok: true }
  }
  // first letters and follow-ups both count toward the day and the gap; tests do not
  const campaign = recent.filter((e) => e.kind !== 'test').sort((a, b) => a.t - b.t)
  if (campaign.length >= settings.dailyLimit) {
    const nextAt = campaign[campaign.length - settings.dailyLimit].t + DAY
    return { ok: false, reason: `Daily limit of ${settings.dailyLimit} reached`, nextAt }
  }
  const last = campaign[campaign.length - 1]
  if (last && now - last.t < MIN_GAP_SEC * 1000) return { ok: false, reason: 'Too soon after the last email', nextAt: last.t + MIN_GAP_SEC * 1000 }
  if (mail.followUp) {
    const first = ledger.filter((e) => e.kind === 'campaign' && e.to === mail.to).sort((a, b) => b.t - a.t)[0]
    if (!first) return { ok: false, reason: `No earlier letter to ${mail.to} to follow up` }
    if (now - first.t < FOLLOW_MIN_DAYS * DAY) return { ok: false, reason: `The first letter to ${mail.to} went less than ${FOLLOW_MIN_DAYS} days ago` }
    const again = ledger.find((e) => e.kind === 'followup' && e.to === mail.to && now - e.t < FOLLOW_ONCE_DAYS * DAY)
    if (again) return { ok: false, reason: `Already followed up ${mail.to} on ${new Date(again.t).toISOString().slice(0, 10)}`, duplicate: true }
    return { ok: true, inReplyTo: first.id || '' }
  }
  if (!mail.resend) {
    const before = ledger.find((e) => e.kind === 'campaign' && e.to === mail.to && now - e.t < REPEAT_DAYS * DAY)
    if (before) return { ok: false, reason: `Already emailed ${mail.to} on ${new Date(before.t).toISOString().slice(0, 10)}`, duplicate: true }
  }
  return { ok: true }
}

const renderer = () => import('./email-html.mjs')
const LOGO = path.join(__dirname, 'assets', 'esb-logo.png')
const PAD_SIDEBAR = path.join(__dirname, 'assets', 'esb-pad-sidebar.png')
// the vCard text is duplicated from officialPad.ts (that file is TS, read only by the renderer bundle) — see the
// comment there; the QR is generated fresh per process start, never read from the printed pad.
const PAD_VCARD = [
  'BEGIN:VCARD', 'VERSION:3.0', 'N:;ESB PowerLine;;;', 'FN:ESB PowerLine',
  'ORG:ESB PowerLine;Express Broadcast and Communication Ltd.',
  'TEL;TYPE=WORK,VOICE:+88 01711 378733', 'EMAIL;TYPE=WORK:news@esbpowerline.com',
  'URL:https://esbpowerline.com',
  'ADR;TYPE=WORK:;;House#36/1, Avenue#01, Block#A, Section#10, Mirpur, Pallabi, Dhaka-1216;;;;Bangladesh',
  'NOTE:Facebook: https://www.facebook.com/esbpowerlineofficial  |  YouTube: https://www.youtube.com/@esbplbd',
  'END:VCARD',
].join('\n')
let padQrBuffer = null
async function padQrPng() {
  if (padQrBuffer) return padQrBuffer
  const QRCode = await import('qrcode')
  padQrBuffer = await QRCode.toBuffer(PAD_VCARD, { margin: 0, scale: 6, color: { dark: '#1f2937', light: '#ffffff' } })
  return padQrBuffer
}

function createMailer({ dir, safeStorage, nodemailer, clock = () => Date.now(), render = renderer }) {
  const settingsFile = path.join(dir, 'outreach-smtp.json')
  const ledgerFile = path.join(dir, 'outreach-ledger.json')
  const read = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return fallback } }
  // write a temp file and rename it, so a crash mid-write never leaves half a ledger
  const write = (f, v) => { const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(v)); fs.renameSync(tmp, f) }
  const ledger = () => { const l = read(ledgerFile, []); return Array.isArray(l) ? l : [] }

  function status() {
    const saved = read(settingsFile, null)
    const now = clock()
    const l = ledger()
    const recent = l.filter((e) => e.kind !== 'test' && now - e.t < DAY)
    return {
      configured: !!saved,
      hasPassword: !!saved?.password,
      encryption: safeStorage.isEncryptionAvailable(),
      settings: saved ? { host: saved.host, imapHost: saved.imapHost || '', port: saved.port, user: saved.user, name: saved.name, dailyLimit: saved.dailyLimit, minDelaySec: saved.minDelaySec, maxDelaySec: saved.maxDelaySec } : null,
      sent24h: recent.length,
      imapHost: saved ? require('./inbox.cjs').imapHostFor(saved.host, saved.imapHost) : '',
      // so the desk can mark contacts already emailed, even after its own storage is cleared
      sentTo: l.filter((e) => e.kind === 'campaign' && now - e.t < REPEAT_DAYS * DAY).map((e) => ({ to: e.to, t: e.t })),
    }
  }

  function saveSettings(input, password) {
    const s = validateSmtpSettings(input)
    const prev = read(settingsFile, null)
    // the stored password is kept only for the same account on the same servers: changing the IMAP host (or port) and
    // keeping the password would let one save point the next inbox check — and the password — at any server
    const same = prev && prev.user === s.user && prev.host === s.host && prev.port === s.port && (prev.imapHost || '') === (s.imapHost || '')
    let enc = same ? prev.password : null
    if (typeof password === 'string' && password.trim()) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('This computer cannot encrypt the password, so it is not saved')
      // Google shows app passwords in groups of four; the spaces are not part of it
      enc = safeStorage.encryptString(password.replace(/\s+/g, '')).toString('base64')
    }
    write(settingsFile, { ...s, password: enc })
    return status()
  }

  function forgetPassword() {
    const prev = read(settingsFile, null)
    if (prev) write(settingsFile, { ...prev, password: null })
    return status()
  }

  const transportFor = (saved) => nodemailer.createTransport({
    host: saved.host, port: saved.port, secure: saved.secure,
    auth: { user: saved.user, pass: safeStorage.decryptString(Buffer.from(saved.password, 'base64')) },
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
  })

  // the status bar's live check: log in to the SMTP server and out again, nothing sent. Remembered for a minute so a
  // window that asks often does not make the account log in again and again.
  let lastVerify = null
  async function verify(force = false) {
    const saved = read(settingsFile, null)
    if (!saved || !saved.password) return { ok: false, error: 'No sender account saved', at: clock() }
    // even a forced check waits 10 s since the last, so a renderer in a loop cannot make the account log in non-stop
    if (lastVerify && lastVerify.user === saved.user && clock() - lastVerify.at < (force ? 10_000 : 60_000)) return lastVerify
    const t0 = clock()
    try {
      await transportFor(saved).verify()
      lastVerify = { ok: true, ms: clock() - t0, user: saved.user, at: clock() }
    } catch (e) {
      lastVerify = { ok: false, error: String(e && e.message || e).slice(0, 200), user: saved.user, at: clock() }
    }
    return lastVerify
  }

  // one send at a time: the ledger is read, checked, sent against and written back as one step. Two overlapping calls
  // (a double-click, or a renderer firing many at once) each passed the daily cap, the gap and the repeat check against
  // the same ledger, and the last writer then dropped the others' entries.
  let sendChain = Promise.resolve()
  function send(raw) {
    const run = sendChain.then(() => sendNow(raw))
    sendChain = run.catch(() => {})
    return run
  }

  async function sendNow(raw) {
    let mail
    try { mail = validateMail(raw) } catch (e) { return { ok: false, error: e.message } }
    const saved = read(settingsFile, null)
    if (!saved || !saved.password) return { ok: false, error: 'Save the sender account and app password first' }
    const l = ledger()
    const gate = ledgerCheck(l, clock(), saved, mail)
    if (!gate.ok) return { ok: false, error: gate.reason, nextAt: gate.nextAt, duplicate: !!gate.duplicate }
    try {
      const { renderEmail } = await render()
      const { html, text } = renderEmail({
        body: mail.body, signature: mail.signature, optOut: mail.optOut, lang: mail.lang, letterhead: mail.letterhead,
        logoSrc: 'cid:esb-logo', officialPad: mail.officialPad, sidebarSrc: 'cid:esb-pad-sidebar', qrSrc: 'cid:esb-pad-qr',
      })
      // every pad/letterhead image travels inside the message (cid:), never as a link to a server; the QR is built
      // fresh from PAD_VCARD above, not read off the printed pad
      const logo = mail.letterhead && !mail.officialPad && fs.existsSync(LOGO)
        ? [{ filename: 'esb-logo.png', path: LOGO, cid: 'esb-logo', contentType: 'image/png' }] : []
      const pad = mail.officialPad
        ? [
            { filename: 'esb-logo.png', path: LOGO, cid: 'esb-logo', contentType: 'image/png' },
            ...(fs.existsSync(PAD_SIDEBAR) ? [{ filename: 'esb-pad-sidebar.png', path: PAD_SIDEBAR, cid: 'esb-pad-sidebar', contentType: 'image/png' }] : []),
            { filename: 'esb-pad-qr.png', content: await padQrPng(), cid: 'esb-pad-qr', contentType: 'image/png' },
          ]
        : []
      const info = await transportFor(saved).sendMail({
        from: { name: saved.name, address: saved.user },
        to: mail.to,
        subject: mail.subject,
        text,
        html,
        attachments: [...logo, ...pad, ...mail.attachments],
        list: { unsubscribe: `mailto:${saved.user}?subject=unsubscribe` },
        // a follow-up sits under the first letter in the recipient's mail client
        ...(gate.inReplyTo ? { inReplyTo: gate.inReplyTo, references: [gate.inReplyTo] } : {}),
      })
      l.push({ t: clock(), to: mail.to, kind: mail.isTest ? 'test' : mail.followUp ? 'followup' : 'campaign', id: String(info.messageId || '') })
      write(ledgerFile, l.filter((e) => clock() - e.t < 30 * DAY).slice(-5000))
      return { ok: true, messageId: info.messageId, sent24h: status().sent24h }
    } catch (e) {
      // the server's answer, without the account password (nodemailer does not echo it, but never risk it)
      return { ok: false, error: String(e && e.message || e).slice(0, 300) }
    }
  }

  /** For inbox.cjs only (never sent over IPC): the account with its password, and the ledger of sends. */
  function inboxAccount() {
    const saved = read(settingsFile, null)
    if (!saved || !saved.password) return null
    return { user: saved.user, pass: safeStorage.decryptString(Buffer.from(saved.password, 'base64')), imapHost: require('./inbox.cjs').imapHostFor(saved.host, saved.imapHost) }
  }

  return { status, saveSettings, forgetPassword, send, verify, inboxAccount, ledger }
}

module.exports = { validateSmtpSettings, validateMail, ledgerCheck, createMailer, EMAIL_RE, MAX_DAILY, MIN_GAP_SEC, REPEAT_DAYS, FOLLOW_MIN_DAYS, FOLLOW_ONCE_DAYS, MAX_ATTACH_BYTES }
