import type { Campaign, Contact } from './types'
import type { EsbOutreachMail, JobMessage, JobSpec } from '../esb'
import { buildMessage } from './compose'
import { reviewRendered, actionableFlags } from './rendered'
import { eligible, followUpLetter, followUpQueue, signatureOf } from './campaign'
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

  const reviewedMap = campaign.reviewed || {}
  const queue = rawQueue.filter((c) => {
    if (mode !== 'first') return true
    const resolved = letterFor(c, campaign)
    const opener = campaign.openers?.[c.email]?.text
    const m = buildMessage(c, resolved.subject, resolved.body, campaign.lang, opener)
    const flags = actionableFlags(reviewRendered(c, m))
    if (!flags.length) return true
    const approved = new Set(reviewedMap[c.email] || [])
    return flags.every((f) => approved.has(f.kind))
  })

  const fu = mode === 'followup' ? followUpLetter(campaign) : null

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
