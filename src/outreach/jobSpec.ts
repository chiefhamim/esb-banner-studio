import type { Campaign, Contact } from './types'
import type { EsbOutreachMail, JobMessage, JobSpec } from '../esb'
import { buildMessage } from './compose'
import { reviewRendered, actionableFlags } from './rendered'
import { designFor, eligible, followUpLetter, followUpQueue, signatureOf } from './campaign'
import { designPayload, designVars } from './design'
import { useOutreachStore } from './outreachStore'
import { letterFor } from './segments'

export interface BuildJobSpecOptions {
  campaign: Campaign
  contacts: Contact[]
  mode?: 'first' | 'followup'
  signature?: string
  shared?: Partial<EsbOutreachMail>
  attachments?: { name: string; dataUrl: string }[]
  startAt?: number | null
  autoResume?: boolean
}

/** Drops anyone held in Needs you: a review flag on their rendered letter that was not approved in Review. */
function notHeld(campaign: Campaign, ready: Contact[]): Contact[] {
  const reviewedMap = campaign.reviewed || {}
  return ready.filter((c) => {
    const resolved = letterFor(c, campaign)
    const opener = campaign.openers?.[c.email]?.text
    const m = buildMessage(c, resolved.subject, resolved.body, campaign.lang, opener)
    const flags = actionableFlags(reviewRendered(c, m))
    if (!flags.length) return true
    const approved = new Set(reviewedMap[c.email] || [])
    return flags.every((f) => approved.has(f.kind))
  })
}

let sendableMemo: { campaign: Campaign; contacts: Contact[]; out: Contact[] } | null = null
/** Who the first letter really goes to: eligible, minus anyone held in Needs you. The header Send, the Send footer,
 *  the campaign card and the Review & send sheet count from this, the same list the job is built from, so "Review &
 *  send to N" never promises letters the job will hold back. Memoised on the campaign and contact objects. */
export function sendableQueue(campaign: Campaign, contacts: Contact[]): Contact[] {
  if (sendableMemo && sendableMemo.campaign === campaign && sendableMemo.contacts === contacts) return sendableMemo.out
  const out = notHeld(campaign, eligible(contacts, campaign.subject, campaign.body, campaign.audience))
  sendableMemo = { campaign, contacts, out }
  return out
}

/**
 * Pure builder: converts the campaign, audience, and letter settings into an immutable
 * headless JobSpec for the main process engine (§2.2).
 */
export function buildJobSpec(opts: BuildJobSpecOptions): JobSpec {
  const { campaign, contacts, mode = 'first', signature, shared, attachments, startAt = null, autoResume = true } = opts
  const st = useOutreachStore.getState()

  const rawQueue =
    mode === 'first'
      ? eligible(contacts, campaign.subject, campaign.body, campaign.audience)
      : followUpQueue(contacts, campaign).due

  const queue = mode === 'first' ? notHeld(campaign, rawQueue) : rawQueue

  const fu = mode === 'followup' ? followUpLetter(campaign) : null
  // the first letter goes as the designed page when there is one (throws if it is not loaded); a follow-up is always
  // the short plain note
  const design = mode === 'first' ? designFor(campaign) : null

  const messages: JobMessage[] = queue.map((c) => {
    const resolved = mode === 'first' ? letterFor(c, campaign) : null
    const opener = mode === 'first' ? campaign.openers?.[c.email]?.text : undefined
    const subject = fu ? fu.subject : resolved!.subject
    const body = fu ? fu.body : resolved!.body
    const m = buildMessage(c, subject, body, campaign.lang, opener)
    return {
      to: c.email,
      subject: m.subject,
      body: m.body,
      optOut: m.optOut,
      name: c.personName || undefined,
      org: c.organization || undefined,
      key: c.id || undefined,
      ...(design ? { vars: designVars(c, design.html, opener) } : {}),
    }
  })

  const mergedShared: Partial<EsbOutreachMail> = {
    lang: campaign.lang,
    letterhead: campaign.letterhead,
    officialPad: campaign.officialPad,
    footerLine: st.footerLine,
    fontFamily: st.fontFamily,
    headerBg: st.headerBg,
    footerBg: st.footerBg,
    stripeColors: st.stripeColors,
    signature: signature ?? signatureOf(campaign),
    followUp: mode === 'followup',
    ...(design ? { design: designPayload(design) } : {}),
    ...(shared ?? {}),
  }

  return {
    campaignId: campaign.id,
    campaignName: campaign.name,
    kind: mode,
    shared: mergedShared,
    attachments: mode === 'first' ? (attachments ?? []) : [],
    messages,
    startAt,
    autoResume,
  }
}
