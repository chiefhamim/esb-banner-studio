// Activity desk → Overview: what happened to the people one campaign wrote to, in the same words as the contact list
// (outcome.ts). For the open campaign every contact is counted, Ready and Not an email included; for another
// campaign only what its own record holds (its list is not loaded). Opens are labelled approximate everywhere.

import { useMemo } from 'react'
import { useDesk } from './outreachStore'
import { useCloud } from './cloudStore'
import { inAudience } from './campaign'
import { skipReason } from './compose'
import { engineSkipText, MACHINE_OPEN, outcomeOf, type OutcomeState } from './outcome'
import { Icon } from '../ui/Icon'

const ORDER: [OutcomeState, string, string][] = [
  ['sent', 'Sent', 'Accepted by the mail server, nothing seen since — not proof it was read'],
  ['opened', 'Opened (human, approx.)', "The letter's picture was loaded by a mail app, once per letter. Scanners (within 2 min of sending, bots, bounced letters) and proxy fetches are not counted; apps that block pictures never show up"],
  ['clicked', 'Clicked', 'Followed a link in the letter'],
  ['replied', 'Replied', 'Answered — read from your inbox'],
  ['bounced', 'Bounced', 'Returned by the mail system: the address does not exist, the mailbox is full, or the server refused it'],
  ['failed', 'Failed', 'Refused by your mail server when sent — the server’s own words are on each contact'],
  ['noemail', 'Not an email', 'Not a valid address, or DNS says the domain has no mail server'],
  ['out', 'Opted out', 'Asked not to be emailed'],
  ['skip', 'Skipped', 'Not sent, with the reason on each contact'],
  ['ready', 'Ready', 'Will be sent by the next run'],
]

export function CampaignResults({ campaignId }: { campaignId: string | null }) {
  const s = useDesk()
  const c = s.campaigns.find((x) => x.id === campaignId) ?? null
  const engagement = useCloud((x) => (campaignId ? x.engagement[campaignId] : undefined))
  const counts = useMemo(() => {
    const n: Partial<Record<OutcomeState, number>> = {}
    const links = new Map<string, number>()
    if (!c) return { n, links: [] as [string, number][], whole: false, machine: 0 }
    const whole = c.id === s.activeId
    if (whole) {
      for (const x of s.contacts) {
        if (!inAudience(x, c.audience)) continue
        const es = c.skipped?.[x.email]
        const o = outcomeOf(x, x.status === 'QUEUED' ? skipReason(x, c.subject, c.body) : null, engagement?.[x.email], es ? engineSkipText(es) : undefined)
        n[o.st] = (n[o.st] ?? 0) + 1
      }
    } else {
      for (const email of Object.keys(c.sent)) {
        const e = engagement?.[email]
        const st: OutcomeState = s.optOut.includes(email) ? 'out' : c.bounced[email] ? 'bounced' : c.replied[email] ? 'replied' : e?.clicks ? 'clicked' : e?.opens ? 'opened' : 'sent'
        n[st] = (n[st] ?? 0) + 1
      }
      for (const email of Object.keys(c.failed)) if (!c.sent[email]) n.failed = (n.failed ?? 0) + 1
      for (const email of Object.keys(c.skipped ?? {})) if (!c.sent[email]) n.skip = (n.skip ?? 0) + 1
    }
    let machine = 0
    for (const [email, e] of Object.entries(engagement ?? {})) {
      if (!c.sent[email]) continue
      for (const l of e.links) links.set(l.link, (links.get(l.link) ?? 0) + l.n)
      if (e.machineOpens && !e.opens && !e.clicks && !c.bounced[email] && !c.replied[email]) machine++
    }
    return { n, links: [...links].sort((a, b) => b[1] - a[1]).slice(0, 5), whole, machine }
  }, [c, s.activeId, s.contacts, s.optOut, engagement])
  if (!c) return null
  const tracked = Object.keys(c.sent).filter((e) => c.tracking?.[`campaign:${e}`]).length
  const sent = Object.keys(c.sent).length
  return (
    <section className="or-card oa-results" aria-label="Campaign results">
      <header><Icon name="send" size={14} /><h3>{c.name} — results</h3><span className="or-small">{counts.whole ? 'every contact in the audience' : 'from the campaign’s record (open it to count its whole list)'}</span></header>
      <div className="oa-results-grid">
        {ORDER.filter(([st]) => counts.whole || (st !== 'ready' && st !== 'noemail')).map(([st, label, tip]) => (
          <span key={st} className={'oa-result st-' + st} data-tip={tip}><b>{(counts.n[st] ?? 0).toLocaleString()}</b>{label}</span>
        ))}
        {counts.machine > 0 && <span className="oa-result st-sent" data-tip="Counted under Sent: only a mail provider's proxy fetched the picture (Gmail image proxy, Apple Mail Privacy Protection) — it says nothing about a person reading"><b>{counts.machine.toLocaleString()}</b>{MACHINE_OPEN}</span>}
      </div>
      <p className="or-muted or-small">
        {sent ? `${tracked.toLocaleString()} of ${sent.toLocaleString()} sent letters carry a tracking key${tracked < sent ? ' — the rest went before the site’s tracking was live, so their opens and clicks are not known' : ''}.` : 'Nothing sent yet.'}
        {counts.links.length ? ` Links clicked: ${counts.links.map(([l, k]) => `${l} (${k})`).join(', ')}.` : ''}
      </p>
    </section>
  )
}
