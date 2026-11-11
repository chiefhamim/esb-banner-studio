// What happened to one contact in one campaign, said once and the same way everywhere it is shown: the contact list
// chip, the Contact tab, the Activity desk and the results CSV. Every word is backed by a fact the desk holds — a
// send result from the main process, a bounce or reply read from the inbox, an open/click event from the site's
// tracking endpoints, a skip reason. Nothing is claimed beyond that: "Sent" means the server accepted it, never that it
// was delivered or read; "Opened (approx.)" means the letter's 1×1 picture was fetched, which some mail apps do on
// their own (Apple Mail Privacy Protection, Gmail's image proxy) and others never do.

import type { Campaign, Contact } from './types'
import { fmtDateTime } from '../ui/time'

/**
 * Opens and clicks seen for one recipient's message key(s), folded from outreach_events (cloudMerge.foldEvents). Each
 * LETTER counts once: `opens` = letters a person opened (approx.), `clicks` = letters with a link clicked,
 * `machineOpens` = letters whose picture only a mail provider's proxy fetched (Gmail image proxy, Apple MPP).
 * Scanner hits (inside 2 min of the send, non-browser agents, bounced letters) are not counted at all.
 */
export interface Engagement {
  opens: number
  firstOpen?: number
  lastOpen?: number
  /** Letters opened only by a machine (image proxy / privacy protection) — never shown as a reader. */
  machineOpens?: number
  firstMachine?: number
  clicks: number
  /** host + path of each link clicked, most clicked first. */
  links: { link: string; n: number }[]
  firstClick?: number
  lastClick?: number
  /** Which letter keys were seen (o: opened by a person, m: machine open, c: clicked, l: key|link), so a re-fold never counts one twice. */
  keys?: { o: string[]; m: string[]; c: string[]; l: string[] }
  /** ESB Mail Tracker: every counted hit (open or click), one per hit id, so "opened 3 times" is real. */
  hits?: number
  /** Where it was read: "Gmail", "Outlook · Windows · Dhaka, BD" (newest first, at most 6). */
  seen?: string[]
  /** country|network of each reader seen directly (not through a proxy), for the forward estimate. */
  places?: string[]
  /** Read in two countries or on three networks = likely; two networks on two kinds of device = possible. */
  forwarded?: 'likely' | 'possible'
}

export type OutcomeState = 'busy' | 'out' | 'bounced' | 'replied' | 'clicked' | 'opened' | 'sent' | 'failed' | 'noemail' | 'skip' | 'ready'

export interface Outcome {
  st: OutcomeState
  /** The chip's word. */
  label: string
  /** One line of what is known: the server's text, the bounce reason, the skip reason, when it was opened. */
  detail: string
}

/** The same shape the main process accepts (electron/mailer.cjs EMAIL_RE). */
export const EMAIL_SYNTAX = /^[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/
export const isEmailSyntax = (s: string) => s.length <= 254 && EMAIL_SYNTAX.test(s)

// never Date#toLocaleString per row: it builds a new Intl formatter on each call, which for 800 sent contacts cost
// ~40 ms every time the list was recomputed (each keystroke in the letter). fmtDateTime reads local time from the Date
// itself and follows Home → Settings → Time format ("1 Nov 4:58 PM" / "1 Nov 16:58").
const when = (t?: number) => (t ? fmtDateTime(t, { weekday: false }) : '')

export const LABEL: Record<OutcomeState, string> = {
  busy: 'Sending', out: 'Opted out', bounced: 'Bounced', replied: 'Replied', clicked: 'Clicked', opened: 'Opened',
  sent: 'Sent', failed: 'Failed', noemail: 'Not an email', skip: 'Skipped', ready: 'Ready',
}

/** Why an address can never take mail: bad syntax, or DNS says the domain has no mail server. null otherwise. */
export function notAnEmail(c: Pick<Contact, 'email' | 'mxStatus' | 'rawStatus'>): string | null {
  if (!isEmailSyntax(c.email)) return 'Not a valid email address'
  if (c.mxStatus === 'UNDELIVERABLE') return `No mail server for ${c.email.split('@')[1] ?? 'this domain'} (DNS)${c.rawStatus ? ` · ${c.rawStatus}` : ''}`
  return null
}

export const OPENED_HUMAN = 'Opened (human, approx.)'
export const MACHINE_OPEN = 'Machine open'

export function openedText(e: Engagement): string {
  if (!e.opens) return ''
  const times = e.firstOpen === e.lastOpen || !e.lastOpen ? when(e.firstOpen) : `first ${when(e.firstOpen)} · last ${when(e.lastOpen)}`
  // ESB Mail Tracker extras: how many times, where, forwarded (only when the tracker saw them)
  const extra = [
    e.hits && e.hits > 1 ? `${e.hits} times` : '',
    e.seen?.length ? `in ${e.seen.slice(0, 2).join('; ')}` : '',
    e.forwarded === 'likely' ? 'probably forwarded' : e.forwarded === 'possible' ? 'maybe forwarded' : '',
  ].filter(Boolean).join(' · ')
  return [`${OPENED_HUMAN} ${times}`.trim(), extra].filter(Boolean).join(' · ')
}

/** "Machine open" line: only a proxy fetched the picture (Gmail image proxy, Apple Mail Privacy Protection). */
export function machineText(e: Engagement): string {
  if (!e.machineOpens) return ''
  return `${MACHINE_OPEN} ${when(e.firstMachine)} — a mail provider fetched the picture; says nothing about a reader`.trim()
}

export function clickedText(e: Engagement): string {
  if (!e.clicks) return ''
  return `Clicked ${e.links.map((l) => (l.n > 1 ? `${l.link} (${l.n}×)` : l.link)).join(', ')}`
}

/**
 * The contact's outcome in this campaign. `skip` is skipReason()'s answer for a contact not yet sent; `engineSkip` a
 * reason the sending engine gave when it passed the address over (suppressed, cooldown, sent from another PC).
 */
export function outcomeOf(c: Contact, skip: string | null, eng?: Engagement | null, engineSkip?: string): Outcome {
  const o = (st: OutcomeState, detail: string): Outcome => ({ st, label: LABEL[st], detail })
  if (c.status === 'SENDING') return o('busy', 'Being sent now')
  if (c.status === 'OPTED_OUT') return o('out', 'Asked not to be emailed')
  if (c.status === 'BOUNCED') return o('bounced', c.error || 'The mail system returned the letter')
  const engaged = eng ? [clickedText(eng), openedText(eng)].filter(Boolean).join(' · ') : ''
  const machine = eng && !eng.opens && !eng.clicks ? machineText(eng) : ''
  if (c.status === 'REPLIED') return o('replied', [`Replied ${when(c.repliedAt)}`.trim(), engaged].filter(Boolean).join(' · '))
  if (c.status === 'SENT' && eng?.clicks) return o('clicked', engaged)
  if (c.status === 'SENT' && eng?.opens) return o('opened', `${engaged} — counted when the letter's picture loads; some mail apps load it on their own, others never do`)
  if (c.status === 'SENT') return o('sent', [c.sentAt ? `Accepted by the mail server ${when(c.sentAt)} — not proof it was read` : 'Accepted by the mail server', machine].filter(Boolean).join(' · '))
  if (c.status === 'FAILED') return o('failed', c.error || 'The server refused it')
  const bad = notAnEmail(c)
  if (bad) return o('noemail', bad)
  if (engineSkip) return o('skip', engineSkip)
  if (skip) return o('skip', skip)
  return o('ready', c.approved && c.mxStatus !== 'SAFE_TO_SEND' ? 'Approved by you' : 'Will be sent')
}

/** The engine's reason codes for passing an address over, in words. */
export function engineSkipText(reason: string): string {
  if (reason === 'suppressed') return 'Skipped: opted out, bounced or refused before'
  if (reason === 'cooldown') return 'Skipped: emailed within the cooldown period'
  if (reason === 'elsewhere') return 'Skipped: already sent from another PC'
  if (reason === 'already-sent') return 'Skipped: already emailed in the last 7 days (this PC or another)'
  if (reason === 'not-due') return 'Skipped: no follow-up due for this address'
  return `Skipped: ${reason}`
}

/** The tracking key the main process gave one recipient's letter (campaign.tracking), if any. */
export const keyOf = (c: Campaign, email: string, kind: 'campaign' | 'followup' = 'campaign') => c.tracking?.[`${kind}:${email}`]
