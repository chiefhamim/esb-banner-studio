// ESB Studio — Outreach IPC Guard (electron/outreach-guard.cjs)
// Pure argument validators for all outreach IPC channels (Appendix A, §1.7).

const { validateMail, EMAIL_RE } = require('./mailer.cjs')
const { validateSettings } = require('./outreach-settings.cjs')

const SAFE_ID_RE = /^[a-zA-Z0-9_\-]+$/
const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i
const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g

function stripControl(str) {
  return typeof str === 'string' ? str.replace(CONTROL_CHARS_RE, '') : ''
}

function hasHostileKeys(obj) {
  if (!obj || typeof obj !== 'object') return false
  return (
    Object.prototype.hasOwnProperty.call(obj, '__proto__') ||
    Object.prototype.hasOwnProperty.call(obj, 'constructor') ||
    Object.prototype.hasOwnProperty.call(obj, 'prototype')
  )
}

/**
 * Validates outreachJobSubmit argument (§1.7).
 *
 * @param {any} rawSpec
 * @returns {{ ok: true, cleaned: object, rejected: { index: number, error: string }[] } | { ok: false, error: string, rejected?: any[] }}
 */
function validateJobSpec(rawSpec) {
  if (!rawSpec || typeof rawSpec !== 'object' || Array.isArray(rawSpec)) {
    return { ok: false, error: 'Job spec must be an object' }
  }

  if (hasHostileKeys(rawSpec)) {
    return { ok: false, error: 'Job spec contains disallowed properties' }
  }

  // Messages array check
  if (!Array.isArray(rawSpec.messages) || rawSpec.messages.length === 0) {
    return { ok: false, error: 'Job spec must include a non-empty messages array' }
  }

  if (rawSpec.messages.length > 20000) {
    return { ok: false, error: 'Cannot submit more than 20,000 messages in one job' }
  }

  // Campaign ID
  const campaignId = String(rawSpec.campaignId || '').trim()
  if (!campaignId || campaignId.length > 100 || /[\r\n]/.test(campaignId)) {
    return { ok: false, error: 'Invalid or missing campaignId' }
  }

  // Campaign Name
  const campaignName = String(rawSpec.campaignName || 'Untitled Campaign').slice(0, 200)

  // Kind ('first' | 'followup')
  const kind = rawSpec.kind === 'followup' ? 'followup' : 'first'

  // startAt (optional epoch ms)
  let startAt = null
  if (rawSpec.startAt !== undefined && rawSpec.startAt !== null) {
    if (typeof rawSpec.startAt !== 'number' || !Number.isFinite(rawSpec.startAt) || rawSpec.startAt < 0) {
      return { ok: false, error: 'startAt must be a positive finite timestamp' }
    }
    startAt = Math.round(rawSpec.startAt)
  }

  // autoResume (boolean)
  const autoResume = rawSpec.autoResume !== false

  // Attachments check (max 5, no disk paths, validated through mailer)
  const rawAttachments = Array.isArray(rawSpec.attachments) ? rawSpec.attachments : []
  if (rawAttachments.length > 5) {
    return { ok: false, error: 'At most 5 attachments allowed' }
  }

  for (const a of rawAttachments) {
    if (!a || typeof a !== 'object') {
      return { ok: false, error: 'Invalid attachment format' }
    }
    if ('path' in a) {
      return { ok: false, error: 'Attachments are sent as data, never as a path on disk' }
    }
  }

  if (rawAttachments.length > 0) {
    try {
      validateMail({
        to: 'verify@example.com',
        subject: 'verify',
        body: 'verify',
        attachments: rawAttachments,
      })
    } catch (err) {
      return { ok: false, error: err.message || 'Attachment validation failed' }
    }
  }

  const shared = typeof rawSpec.shared === 'object' && rawSpec.shared !== null ? { ...rawSpec.shared } : {}
  delete shared.__proto__
  delete shared.constructor
  delete shared.prototype

  // Validate each message; invalid ones go to rejected[], not thrown
  const validMessages = []
  const rejected = []

  for (let i = 0; i < rawSpec.messages.length; i++) {
    const m = rawSpec.messages[i]
    if (!m || typeof m !== 'object' || Array.isArray(m)) {
      rejected.push({ index: i, error: 'Message must be an object' })
      continue
    }

    if (typeof m.to !== 'string' || /[\r\n]/.test(m.to)) {
      rejected.push({ index: i, error: 'Recipient address cannot contain CRLF' })
      continue
    }

    if (typeof m.subject !== 'string' || /[\r\n]/.test(m.subject)) {
      rejected.push({ index: i, error: 'Subject cannot contain CRLF' })
      continue
    }

    try {
      const v = validateMail({
        ...shared,
        ...m,
        attachments: [], // attachments validated once above
      })

      validMessages.push({
        to: v.to,
        subject: v.subject,
        body: v.body,
        optOut: v.optOut,
        name: typeof m.name === 'string' ? m.name.slice(0, 120) : undefined,
        org: typeof m.org === 'string' ? m.org.slice(0, 120) : undefined,
        key: typeof m.key === 'string' ? m.key.slice(0, 100) : undefined,
        // a designed letter's per-recipient words ({name}, …), already cut to one-line strings by validateMail;
        // dropping them here sent every campaign copy with the fallback ("Dear Reader") while tests used the name
        ...(v.vars && Object.keys(v.vars).length ? { vars: v.vars } : {}),
      })
    } catch (err) {
      rejected.push({ index: i, error: err.message || 'Validation error' })
    }
  }

  if (validMessages.length === 0) {
    return { ok: false, error: 'No valid messages in job spec', rejected }
  }

  // Strip any renderer-supplied dry flag
  return {
    ok: true,
    cleaned: {
      campaignId,
      campaignName,
      kind,
      shared,
      attachments: rawAttachments,
      messages: validMessages,
      startAt,
      autoResume,
    },
    rejected,
  }
}

/**
 * Validates outreachJobControl argument (§1.7).
 */
function validateControl(jobId, action, arg) {
  if (typeof jobId !== 'string' || !jobId || jobId.length > 100 || !SAFE_ID_RE.test(jobId)) {
    return { ok: false, error: 'Invalid jobId' }
  }

  const allowedActions = ['pause', 'resume', 'stop', 'hold', 'release', 'send-next', 'clean-names']
  if (typeof action !== 'string' || !allowedActions.includes(action)) {
    return { ok: false, error: `Invalid action: ${action}` }
  }

  let cleanArg = undefined
  if (arg !== undefined && arg !== null) {
    if (typeof arg !== 'string' && typeof arg !== 'number') {
      return { ok: false, error: 'arg must be string or number' }
    }
    if (typeof arg === 'string') {
      if (arg.length > 300 || /[\r\n]/.test(arg)) {
        return { ok: false, error: 'arg too long or contains newline' }
      }
      cleanArg = arg.trim()
    } else {
      cleanArg = arg
    }
  }

  return { ok: true, jobId, action, arg: cleanArg }
}

/**
 * Validates outreachEvents query (§1.7).
 */
function validateEventsQuery(q) {
  if (q === undefined || q === null) {
    return { ok: true, query: { limit: 100 } }
  }
  if (typeof q !== 'object' || Array.isArray(q)) {
    return { ok: false, error: 'Query must be an object' }
  }

  const query = {}

  if (q.since !== undefined) {
    if (typeof q.since !== 'string' || q.since.length > 100 || /[\r\n]/.test(q.since)) {
      return { ok: false, error: 'Invalid since parameter' }
    }
    query.since = q.since
  }

  if (q.before !== undefined) {
    if (typeof q.before !== 'string' || q.before.length > 100 || /[\r\n]/.test(q.before)) {
      return { ok: false, error: 'Invalid before parameter' }
    }
    query.before = q.before
  }

  if (q.from !== undefined) {
    if (typeof q.from !== 'number' || !Number.isFinite(q.from)) {
      return { ok: false, error: 'from must be a finite number' }
    }
    query.from = q.from
  }

  if (q.to !== undefined) {
    if (typeof q.to !== 'number' || !Number.isFinite(q.to)) {
      return { ok: false, error: 'to must be a finite number' }
    }
    query.to = q.to
  }

  if (q.jobId !== undefined) {
    if (typeof q.jobId !== 'string' || q.jobId.length > 100 || /[\r\n]/.test(q.jobId)) {
      return { ok: false, error: 'Invalid jobId parameter' }
    }
    query.jobId = q.jobId
  }

  if (q.campaignId !== undefined) {
    if (typeof q.campaignId !== 'string' || q.campaignId.length > 100 || /[\r\n]/.test(q.campaignId)) {
      return { ok: false, error: 'Invalid campaignId parameter' }
    }
    query.campaignId = q.campaignId
  }

  if (q.types !== undefined) {
    if (!Array.isArray(q.types) || q.types.length > 50) {
      return { ok: false, error: 'types must be an array of at most 50 strings' }
    }
    for (const t of q.types) {
      if (typeof t !== 'string' || t.length > 50 || /[\r\n]/.test(t)) {
        return { ok: false, error: 'Invalid event type string' }
      }
    }
    query.types = [...q.types]
  }

  if (q.q !== undefined) {
    if (typeof q.q !== 'string' || q.q.length > 200 || /[\r\n]/.test(q.q)) {
      return { ok: false, error: 'Invalid search query string' }
    }
    query.q = q.q.trim()
  }

  if (q.limit !== undefined) {
    if (!Number.isInteger(q.limit) || q.limit < 1 || q.limit > 10000) {
      return { ok: false, error: 'limit must be an integer between 1 and 10000' }
    }
    query.limit = q.limit
  } else {
    query.limit = 100
  }

  if (q.includeDry !== undefined) {
    query.includeDry = !!q.includeDry
  }

  return { ok: true, query }
}

/**
 * Validates outreachStats query (§1.7).
 */
function validateStatsQuery(q) {
  if (!q || typeof q !== 'object' || Array.isArray(q)) {
    return { ok: false, error: 'Stats query must be an object' }
  }

  if (typeof q.from !== 'number' || !Number.isFinite(q.from)) {
    return { ok: false, error: 'from must be a finite number' }
  }

  if (typeof q.to !== 'number' || !Number.isFinite(q.to)) {
    return { ok: false, error: 'to must be a finite number' }
  }

  const query = { from: q.from, to: q.to }

  if (q.jobId !== undefined) {
    if (typeof q.jobId !== 'string' || q.jobId.length > 100 || /[\r\n]/.test(q.jobId)) {
      return { ok: false, error: 'Invalid jobId parameter' }
    }
    query.jobId = q.jobId
  }

  if (q.campaignId !== undefined) {
    if (typeof q.campaignId !== 'string' || q.campaignId.length > 100 || /[\r\n]/.test(q.campaignId)) {
      return { ok: false, error: 'Invalid campaignId parameter' }
    }
    query.campaignId = q.campaignId
  }

  if (q.includeDry !== undefined) {
    query.includeDry = !!q.includeDry
  }

  return { ok: true, query }
}

/**
 * Validates outreachPlan query (§1.7).
 */
function validatePlanQuery(q) {
  if (!q || typeof q !== 'object' || Array.isArray(q)) {
    return { ok: false, error: 'Plan query must be an object' }
  }

  if (!Number.isInteger(q.count) || q.count < 0 || q.count > 100000) {
    return { ok: false, error: 'count must be an integer between 0 and 100,000' }
  }

  // the organisation of each remaining email (for the per-organisation limit in the live plan)
  let domains = null
  if (q.domains !== undefined) {
    if (!Array.isArray(q.domains) || q.domains.length > 100000) return { ok: false, error: 'domains must be an array of at most 100,000' }
    domains = q.domains.map((d) => (typeof d === 'string' && d.length <= 253 && !/[\r\n\s]/.test(d) ? d.toLowerCase() : ''))
  }
  // unsaved settings from the Sending panel: validated by the caller with the settings validator (main.cjs)
  let draft = null
  if (q.draft !== undefined) {
    if (!q.draft || typeof q.draft !== 'object' || Array.isArray(q.draft)) return { ok: false, error: 'draft must be an object' }
    draft = q.draft
  }

  return { ok: true, count: q.count, domains, draft }
}

/**
 * Validates domains array for outreachCheckAddresses (§1.7).
 * Max 2,000 domains, valid hostname regex, no IP literals, no CRLF.
 */
function validateDomains(domains) {
  if (!Array.isArray(domains)) {
    return { ok: false, error: 'domains must be an array' }
  }

  if (domains.length > 2000) {
    return { ok: false, error: 'Cannot check more than 2,000 domains at once' }
  }

  const valid = []
  for (let i = 0; i < domains.length; i++) {
    const d = domains[i]
    if (typeof d !== 'string') {
      return { ok: false, error: `Domain at index ${i} must be a string` }
    }

    const clean = d.trim().toLowerCase()
    if (!clean || clean.length > 253 || /[\r\n]/.test(clean)) {
      return { ok: false, error: `Invalid domain at index ${i}` }
    }

    // Must match hostname regex and not be an IP literal
    if (!HOSTNAME_RE.test(clean) || IPV4_RE.test(clean) || clean.includes(':')) {
      return { ok: false, error: `Invalid host name at index ${i}: ${clean}` }
    }

    valid.push(clean)
  }

  return { ok: true, domains: [...new Set(valid)] }
}

/**
 * Validates outreachLogEvent argument (§1.7).
 * Type must be 'ai.action' or 'note', text <= 500, control characters stripped.
 */
function validateLogEvent(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) {
    return { ok: false, error: 'Log event must be an object' }
  }

  if (e.type !== 'ai.action' && e.type !== 'note') {
    return { ok: false, error: "Event type must be 'ai.action' or 'note'" }
  }

  if (typeof e.text !== 'string' || !e.text.trim()) {
    return { ok: false, error: 'text is required and must be non-empty' }
  }

  const cleanText = stripControl(e.text).slice(0, 500)
  if (!cleanText.trim()) {
    return { ok: false, error: 'text cannot be only control characters' }
  }

  const event = {
    type: e.type,
    text: cleanText,
  }

  if (e.command !== undefined && typeof e.command === 'string') {
    event.command = stripControl(e.command).slice(0, 100)
  }

  if (e.status !== undefined && typeof e.status === 'string') {
    event.status = stripControl(e.status).slice(0, 50)
  }

  if (e.campaignId !== undefined && typeof e.campaignId === 'string') {
    event.campaignId = stripControl(e.campaignId).slice(0, 100)
  }

  return { ok: true, event }
}

/**
 * Validates outreachMarkSent: sends another PC made, read from the shared ledger, to be entered in this PC's ledger so
 * it never writes to those addresses again. Treated like every other renderer argument — as hostile: at most 20,000
 * entries, each a plain address, a known kind, a safe campaign id and a time no later than a few minutes from now and
 * no older than 400 days. A bad entry is dropped and counted, never passed on.
 */
function validateRemoteSends(raw, now = Date.now()) {
  if (!Array.isArray(raw)) return { ok: false, error: 'Expected a list of sends' }
  if (raw.length > 20000) return { ok: false, error: 'Cannot mark more than 20,000 sends at once' }
  const entries = []
  let rejected = 0
  const seen = new Set()
  for (const e of raw) {
    if (!e || typeof e !== 'object' || Array.isArray(e) || hasHostileKeys(e)) { rejected++; continue }
    const email = typeof e.email === 'string' ? e.email.trim().toLowerCase() : ''
    const kind = e.kind === 'campaign' || e.kind === 'followup' || e.kind === 'test' ? e.kind : null
    const campaignId = typeof e.campaignId === 'string' ? e.campaignId : ''
    const at = typeof e.at === 'number' && Number.isFinite(e.at) ? Math.round(e.at) : NaN
    if (!email || email.length > 254 || !EMAIL_RE.test(email) || !kind || !SAFE_ID_RE.test(campaignId) || campaignId.length > 100
      || !(at > now - 400 * 24 * 3600 * 1000 && at < now + 10 * 60 * 1000)) { rejected++; continue }
    // optional: what the shared row says happened (a send, or a bounce / reply read on another PC), the letter's
    // Message-ID and a short detail (the bounce reason)
    const status = e.status === undefined || e.status === 'sent' ? 'sent' : (e.status === 'bounced' || e.status === 'replied' ? e.status : null)
    if (!status) { rejected++; continue }
    const messageId = typeof e.messageId === 'string' && e.messageId.length <= 300 && /^<?[\x21-\x7e]+>?$/.test(e.messageId) ? e.messageId : undefined
    const detail = typeof e.detail === 'string' ? e.detail.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 200) : undefined
    const k = `${kind}|${email}|${campaignId}|${status}`
    if (seen.has(k)) continue
    seen.add(k)
    entries.push({ email, kind, campaignId, at, ...(status !== 'sent' ? { status } : {}), ...(messageId ? { messageId } : {}), ...(detail ? { detail } : {}) })
  }
  return { ok: true, entries, rejected }
}

module.exports = {
  validateRemoteSends,
  validateJobSpec,
  validateControl,
  validateEventsQuery,
  validateStatsQuery,
  validatePlanQuery,
  validateDomains,
  validateLogEvent,
  validateSettingsInput: validateSettings,
}
