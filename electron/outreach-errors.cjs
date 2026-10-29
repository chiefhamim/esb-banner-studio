// ESB Studio — Outreach Error Classification (electron/outreach-errors.cjs)
// Pure classification of SMTP / nodemailer send errors into actionable engine taxonomy (§4.5).

const ENHANCED_STATUS_RE = /\b([245])\.(\d{1,3})\.(\d{1,3})\b/

/**
 * Classifies an error from nodemailer/SMTP into a structured outcome.
 *
 * @param {Error|object|string} err
 * @param {{ dnsLookupFails?: boolean }} [options]
 * @returns {{
 *   kind: 'auth' | 'quota' | 'recipient_permanent' | 'policy' | 'content_all' | 'recipient_transient' | 'network' | 'unknown',
 *   retryable: boolean,
 *   scope: 'account' | 'job' | 'recipient',
 *   code?: string | number,
 *   enhanced?: string,
 *   text: string
 * }}
 */
function classifySendError(err, options = {}) {
  const o = err && typeof err === 'object' ? err : {}
  const rawCode = o.code !== undefined ? String(o.code) : undefined
  const respCode = Number(o.responseCode) || 0
  const response = String(o.response || o.message || o.error || (typeof err === 'string' ? err : ''))
  const text = (o.message ? String(o.message) : (o.error ? String(o.error) : response)).slice(0, 300)
  const lower = response.toLowerCase()

  const enhancedMatch = ENHANCED_STATUS_RE.exec(response)
  const enhanced = enhancedMatch ? enhancedMatch[0] : undefined

  // 1. Auth errors (Scope: account / job)
  if (
    rawCode === 'EAUTH' ||
    respCode === 535 ||
    respCode === 534 ||
    respCode === 530 ||
    /username and password not accepted|invalid credentials|authentication failed/i.test(lower)
  ) {
    return {
      kind: 'auth',
      retryable: false,
      scope: 'account',
      code: rawCode || respCode,
      enhanced,
      text,
    }
  }

  // 2. Content / message too large for everyone (Scope: job)
  if (
    enhanced === '5.3.4' ||
    (respCode === 552 && /size|too large|exceeds maximum/i.test(lower)) ||
    (/message exceeds|message too large|exceeds maximum allowed size/i.test(lower) && !/mailbox|storage/i.test(lower))
  ) {
    return {
      kind: 'content_all',
      retryable: false,
      scope: 'job',
      code: rawCode || respCode,
      enhanced,
      text,
    }
  }

  // 3. Quota / daily sending limit (Scope: account)
  // Must distinguish from recipient-specific mailbox full / storage limits (e.g. 5.2.2)
  const isRecipientMailboxLimit =
    enhanced === '5.2.2' ||
    /mailbox.*(?:full|storage|quota|exceed)|user is over quota|storage limit/i.test(lower)

  if (
    !isRecipientMailboxLimit &&
    (enhanced === '5.4.5' ||
      enhanced === '4.5.3' ||
      (respCode === 452 && /limit|quota/i.test(lower)) ||
      /daily user sending quota|rate limit|hourly sending limit|sending quota exceeded/i.test(lower))
  ) {
    return {
      kind: 'quota',
      retryable: true,
      scope: 'account',
      code: rawCode || respCode,
      enhanced,
      text,
    }
  }

  // 4. Recipient permanent failure (Scope: recipient)
  if (
    enhanced === '5.1.1' ||
    enhanced === '5.1.2' ||
    enhanced === '5.1.3' ||
    enhanced === '5.1.6' ||
    enhanced === '5.1.10' ||
    enhanced === '5.2.1' ||
    (respCode === 553 && /^5\.1\./.test(enhanced || '')) ||
    respCode === 550 && /user unknown|no such user|does not exist|recipient address rejected|invalid recipient|mailbox unavailable|address rejected/i.test(lower) ||
    /user unknown|no such user|mailbox not found|address not found|recipient not found|does not exist/i.test(lower)
  ) {
    return {
      kind: 'recipient_permanent',
      retryable: false,
      scope: 'recipient',
      code: rawCode || respCode,
      enhanced,
      text,
    }
  }

  // 5. Policy / spam block (Scope: recipient/job)
  if (
    (enhanced && /^5\.7\./.test(enhanced)) ||
    (respCode >= 500 && respCode < 600 && /spam|blocked|reputation|dmarc|policy|blacklisted|unsolicited/i.test(lower)) ||
    /blocked as spam|spamhaus|blacklist|administrative prohibition|dmarc policy/i.test(lower)
  ) {
    return {
      kind: 'policy',
      retryable: false,
      scope: 'recipient',
      code: rawCode || respCode,
      enhanced,
      text,
    }
  }

  // 6. Network / connection errors
  const isNetworkCode =
    rawCode === 'ECONNECTION' ||
    rawCode === 'ETIMEDOUT' ||
    rawCode === 'ESOCKET' ||
    rawCode === 'EDNS' ||
    rawCode === 'ECONNREFUSED' ||
    rawCode === 'ENOTFOUND' ||
    rawCode === 'ECONNRESET'

  if (isNetworkCode || options.dnsLookupFails === true) {
    return {
      kind: 'network',
      retryable: true,
      scope: 'job',
      code: rawCode,
      enhanced,
      text,
    }
  }

  // 7. Recipient transient errors (mailbox full, 4.x.x, 421, 450, 451, etc.)
  if (
    isRecipientMailboxLimit ||
    (respCode >= 400 && respCode < 500) ||
    (enhanced && /^4\./.test(enhanced)) ||
    respCode === 421 ||
    respCode === 450 ||
    respCode === 451 ||
    /greylisted|try again later|temporarily deferred|server busy/i.test(lower)
  ) {
    return {
      kind: 'recipient_transient',
      retryable: true,
      scope: 'recipient',
      code: rawCode || respCode,
      enhanced,
      text,
    }
  }

  // 8. Unknown fallback -> treated safely as recipient_transient
  return {
    kind: 'unknown',
    retryable: true,
    scope: 'recipient',
    code: rawCode || respCode || undefined,
    enhanced,
    text,
  }
}

module.exports = {
  classifySendError,
  ENHANCED_STATUS_RE,
}
