// Pure address verification utilities: role mailboxes, disposable domains, and result aggregation.

export const ROLE_MAILBOX_PREFIXES = new Set([
  'info',
  'admin',
  'contact',
  'support',
  'office',
  'hr',
  'sales',
  'mail',
  'webmaster',
  'noreply',
  'no-reply',
  'postmaster',
])

export const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com',
  'guerrillamail.com',
  '10minutemail.com',
  'tempmail.com',
  'yopmail.com',
  'trashmail.com',
  'getnada.com',
  'sharklasers.com',
])

export interface DomainCheckResult {
  mx: boolean
  a: boolean
  error?: string
}

export function domainOf(email: string): string {
  const at = (email || '').lastIndexOf('@')
  if (at < 0) return ''
  return email.slice(at + 1).toLowerCase().trim()
}

export function roleMailbox(email: string): boolean {
  const at = (email || '').indexOf('@')
  if (at < 0) return false
  const local = email.slice(0, at).toLowerCase().trim()
  return ROLE_MAILBOX_PREFIXES.has(local)
}

export function disposableDomain(domainOrEmail: string): boolean {
  const dom = domainOrEmail.includes('@') ? domainOf(domainOrEmail) : domainOrEmail.toLowerCase().trim()
  return DISPOSABLE_DOMAINS.has(dom)
}

export interface VerificationSummary {
  total: number
  hasMailServer: number
  noMailServer: number
  sharedMailboxes: number
  disposable: number
}

export function summarizeChecks(
  emails: string[],
  domainResults: Record<string, DomainCheckResult>,
): VerificationSummary {
  let hasMailServer = 0
  let noMailServer = 0
  let sharedMailboxes = 0
  let disposable = 0

  for (const email of emails) {
    const dom = domainOf(email)
    const res = domainResults[dom]
    if (res) {
      if (res.mx || res.a) hasMailServer++
      else noMailServer++
    }
    if (roleMailbox(email)) sharedMailboxes++
    if (disposableDomain(dom)) disposable++
  }

  return {
    total: emails.length,
    hasMailServer,
    noMailServer,
    sharedMailboxes,
    disposable,
  }
}
