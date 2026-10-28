// ESB Studio — what came back. The Outreach desk sent letters; this reads the same account's INBOX (IMAP, the same
// app password) for the answers to them: replies, "unsubscribe" replies, and bounces from the mail system.
//
// Without it an "unsubscribe" reply sat in Gmail until the editor happened to mark the address by hand, and a letter
// the far server refused after accepting it (a bounce arrives as an email, minutes later) stayed "Sent" forever — the
// next campaign would write to the dead address again, and enough of that is what puts a sender in spam folders.
//
// What it may see, and what it hands on:
//   - the mailbox is opened READ-ONLY (EXAMINE): nothing is marked read, moved or deleted;
//   - only messages from, or bouncing, an address this desk emailed (the ledger in mailer.cjs) are reported; every
//     other message in the inbox is skipped unread, and nothing of it reaches the renderer;
//   - a reply is reported as {address, time, subject, auto, unsubscribe} — never its text. "unsubscribe" is looked
//     for in the reply's own words only, above the quoted letter, because our own letter's opt-out line contains the
//     word and is quoted back in most replies.
// The rules are pure functions (tools/unit/inbox.test.ts); `createInbox` holds the connection.

const DAY = 24 * 3600 * 1000
/** How far back a check reads: the ledger keeps 30 days, so nothing older can be matched anyway. */
const LOOKBACK_DAYS = 30
/** Newest messages scanned per check, and message bodies downloaded per check — a big inbox stays a bounded job. */
const MAX_SCAN = 1500
const MAX_DOWNLOADS = 150

const addr = (s) => String(s || '').trim().toLowerCase()

/** The IMAP server for an SMTP one: an explicit choice first, then the usual pairs, then smtp.x → imap.x. */
function imapHostFor(smtpHost, explicit) {
  if (explicit) return explicit
  const h = addr(smtpHost)
  if (h === 'smtp.gmail.com' || h === 'smtp.googlemail.com') return 'imap.gmail.com'
  if (h === 'smtp.office365.com' || h === 'smtp-mail.outlook.com') return 'outlook.office365.com'
  return h.replace(/^smtp\./, 'imap.')
}

/** Raw header block → lower-cased name: value (folded lines joined). */
function parseHeaders(raw) {
  const out = {}
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '')
  for (const line of text.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const m = /^([\w-]+):\s*(.*)$/.exec(line)
    if (m) out[m[1].toLowerCase()] = m[2].trim()
  }
  return out
}

const DAEMON = /^(mailer-daemon|postmaster|mail-daemon|mailerdaemon)@/i

/** An out-of-office or other robot answer: it is not a reply from the person. RFC 3834 plus the common markers. */
function isAutoReply(headers, subject) {
  const as = (headers['auto-submitted'] || '').toLowerCase()
  if (as && as !== 'no') return true
  if (headers['x-autoreply'] || headers['x-autorespond'] || headers['x-auto-response-suppress']?.match(/oof|all/i)) return true
  if (/^(auto_reply|auto-reply)$/i.test(headers.precedence || '')) return true
  return /^(auto(matic)?[\s-]*reply|out of (the )?office|abwesenheit|automatische antwort|réponse automatique)\b/i.test(String(subject || '').replace(/^(re|aw|fw|fwd)\s*:\s*/i, ''))
}

/** The reply's own words: everything above the first quoted line or "On … wrote:" / "From:" / "-----Original". */
function ownWords(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n')
  const out = []
  for (const l of lines) {
    if (/^\s*>/.test(l)) break
    if (/^\s*(On\s.+wrote:|.+ লিখেছেন:|-{2,}\s*Original Message|From:\s|Sent from my|________________)/i.test(l)) break
    out.push(l)
  }
  return out.join('\n').trim()
}

/** Did they ask not to be written to? Only their own words and the subject are read. */
const asksToUnsubscribe = (subject, text) => /\bunsubscribe\b|\bremove me\b|\bopt[\s-]?out\b|আনসাবস্ক্রাইব|বাদ দিন/i.test(`${String(subject || '').replace(/^(re|aw)\s*:\s*/i, '')}\n${ownWords(text)}`)

/**
 * Which of our recipients a bounce is about, and why. Read from the delivery report (RFC 3464 Final-Recipient /
 * Original-Recipient), else any address we emailed that the bounce names. `known` = addresses the desk emailed.
 */
function bounceInfo(raw, known) {
  const text = String(raw || '')
  const found = new Set()
  for (const m of text.matchAll(/^(?:Final|Original)-Recipient:\s*rfc822;\s*<?([^\s>]+)>?/gim)) { const a = addr(m[1]); if (known.has(a)) found.add(a) }
  if (!found.size) for (const a of known) if (text.toLowerCase().includes(a)) found.add(a)
  const diag = /^Diagnostic-Code:\s*(?:smtp;\s*)?(.+(?:\r?\n[ \t].+)*)/im.exec(text)?.[1]
  const status = /^Status:\s*([245]\.\d{1,3}\.\d{1,3})/im.exec(text)?.[1]
  // a 4.x.x status is a delay notice, not a failure: the server is still trying
  const temporary = !!status && status.startsWith('4')
  const reason = (diag ? diag.replace(/\s+/g, ' ') : status ? `Status ${status}` : 'The mail system returned the letter').slice(0, 200)
  return { addresses: [...found], reason, temporary }
}

/** The first text part a person wrote: text/plain, else text/html, skipping attachments. */
function textPart(node) {
  if (!node) return null
  const list = []
  const walk = (n) => { if (n.childNodes) n.childNodes.forEach(walk); else list.push(n) }
  walk(node)
  const usable = list.filter((n) => n.disposition !== 'attachment')
  return usable.find((n) => n.type === 'text/plain') || usable.find((n) => n.type === 'text/html') || null
}
const stripHtml = (h) => String(h).replace(/<(style|script)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<blockquote[\s\S]*$/i, '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')

async function readStream(stream, max) {
  const chunks = []
  let n = 0
  for await (const c of stream) { chunks.push(c); n += c.length; if (n >= max) break }
  return Buffer.concat(chunks).toString('utf8').slice(0, max)
}

/**
 * `ledger()` returns the mailer's sends ({t, to, kind, id}); `account()` the saved account with its password
 * decrypted, or null. `ImapFlow` is injected so the tests can stand in for a server.
 */
function createInbox({ ledger, account, ImapFlow, clock = () => Date.now() }) {
  let last = null
  let running = null

  async function check(force = false) {
    // the desk asks on open and every few minutes; a forced check still waits a minute since the last
    if (last && clock() - last.at < (force ? 60_000 : 5 * 60_000)) return last
    if (running) return running
    running = (async () => {
      const acct = account()
      if (!acct) return { ok: false, error: 'No sender account saved', at: clock() }
      const sends = ledger().filter((e) => e.kind !== 'test' && clock() - e.t < LOOKBACK_DAYS * DAY)
      if (!sends.length) return (last = { ok: true, at: clock(), scanned: 0, replies: [], bounces: [], note: 'Nothing sent in the last 30 days' })
      const firstTo = new Map()
      for (const e of sends) if (!firstTo.has(e.to) || e.t < firstTo.get(e.to)) firstTo.set(e.to, e.t)
      const known = new Set(firstTo.keys())
      const ourIds = new Set(sends.map((e) => e.id).filter(Boolean))
      const since = new Date(Math.min(...sends.map((e) => e.t)) - DAY)

      const client = new ImapFlow({ host: acct.imapHost, port: 993, secure: true, auth: { user: acct.user, pass: acct.pass }, logger: false, disableAutoIdle: true, tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' } })
      const replies = [], bounces = []
      let scanned = 0
      try {
        await client.connect()
        const lock = await client.getMailboxLock('INBOX', { readOnly: true })
        try {
          const found = await client.search({ since }, { uid: true })
          const uids = (Array.isArray(found) ? found : []).slice(-MAX_SCAN)
          scanned = uids.length
          if (uids.length) {
            const msgs = await client.fetchAll(uids, { uid: true, envelope: true, internalDate: true, bodyStructure: true, headers: ['auto-submitted', 'x-autoreply', 'x-autorespond', 'x-auto-response-suppress', 'precedence', 'content-type'] }, { uid: true })
            let downloads = 0
            for (const m of msgs) {
              const from = addr(m.envelope?.from?.[0]?.address)
              const at = new Date(m.internalDate || m.envelope?.date || 0).getTime()
              const subject = String(m.envelope?.subject || '').slice(0, 200)
              const headers = parseHeaders(m.headers)
              const isReport = /multipart\/report/i.test(headers['content-type'] || '')
              if (DAEMON.test(from) || isReport) {
                if (downloads >= MAX_DOWNLOADS) continue
                downloads++
                const d = await client.download(String(m.uid), undefined, { uid: true, maxBytes: 200_000 })
                if (!d.content) continue
                const b = bounceInfo(await readStream(d.content, 200_000), known)
                if (b.temporary) continue
                for (const a of b.addresses) if (at >= firstTo.get(a)) bounces.push({ email: a, at, reason: b.reason })
                continue
              }
              const repliesToUs = !!m.envelope?.inReplyTo && ourIds.has(m.envelope.inReplyTo)
              if (!known.has(from) || (at < firstTo.get(from) && !repliesToUs)) continue
              const auto = isAutoReply(headers, subject)
              let unsubscribe = /^\s*unsubscribe\s*$/i.test(subject)
              if (!auto && !unsubscribe && downloads < MAX_DOWNLOADS) {
                const part = textPart(m.bodyStructure)
                if (part) {
                  downloads++
                  const d = await client.download(String(m.uid), part.part || '1', { uid: true, maxBytes: 64_000 })
                  if (d.content) { const t = await readStream(d.content, 64_000); unsubscribe = asksToUnsubscribe(subject, part.type === 'text/html' ? stripHtml(t) : t) }
                }
              }
              replies.push({ email: from, at, subject, auto, unsubscribe })
            }
          }
        } finally { lock.release() }
        await client.logout()
        return (last = { ok: true, at: clock(), scanned, replies, bounces })
      } catch (e) {
        try { client.close() } catch { /* already closed */ }
        const msg = String(e && (e.responseText || e.message) || e)
        return (last = { ok: false, at: clock(), error: /auth|credential|login/i.test(msg) ? `The inbox refused the login (${msg.slice(0, 120)}) — IMAP must be on for the account` : msg.slice(0, 200) })
      }
    })()
    try { return await running } finally { running = null }
  }

  return { check }
}

module.exports = { createInbox, imapHostFor, parseHeaders, isAutoReply, ownWords, asksToUnsubscribe, bounceInfo, textPart, stripHtml }
