// src/outreach/NeedsYou.tsx
// Exception queue: catches filled letters with odd names, broken punctuation, or personal names on shared mailboxes.

import { useMemo, useState } from 'react'
import type { Campaign, Contact } from './types'
import { reviewRendered, actionableFlags, type Flag, type FlagKind } from './rendered'
import { buildMessage, skipReason } from './compose'
import { inAudience } from './campaign'
import { ask } from './outreachUi'
import { useOutreachStore } from './outreachStore'
import { cleanPersonName, nameHasNumber } from './personName'
import { Icon } from '../ui/Icon'

const PAGE = 50

interface FlaggedItem {
  contact: Contact
  flag: Flag
  message: { subject: string; body: string }
}

interface NeedsYouProps {
  campaign: Campaign
  contacts: Contact[]
  onPatchCampaign: (p: Partial<Campaign>) => void
  onSelectContact?: (email: string) => void
}

export function NeedsYou({ campaign, contacts, onPatchCampaign, onSelectContact }: NeedsYouProps) {
  // undefined = the editor has not chosen yet (a lone group starts open); null = all folded. A lone group used to be
  // forced open, so its header could never fold it (1,076 rows stuck open).
  const [expandedKind, setExpandedKind] = useState<FlagKind | null | undefined>(undefined)
  // rows drawn per group: a list of a thousand renders in pieces, "Show more" adds the next page
  const [shown, setShown] = useState(PAGE)
  const setContactNames = useOutreachStore((x) => x.setContactNames)
  const fixable = (c: Contact) => { const f = cleanPersonName(c.personName); return nameHasNumber(c.personName) && !!f && f !== c.personName ? f : null }
  const fixAll = (items: FlaggedItem[]) => setContactNames(Object.fromEntries(items.flatMap(({ contact }) => { const f = fixable(contact); return f ? [[contact.email, f]] : [] })))

  // Identify all contacts in audience that have actionable, unreviewed flags
  const audienceContacts = useMemo(() => contacts.filter((c) => inAudience(c, campaign.audience)), [contacts, campaign.audience])

  // Contacts that would not be sent anyway (the sheet's status, a missing field, no mail server) are not letter
  // problems: approving them here changed nothing, so they are listed apart with what really holds them.
  const blocked = useMemo(() => {
    const groups = new Map<string, { label: string; fix: 'approve' | 'fallback' | 'none'; field?: string; emails: string[] }>()
    for (const contact of audienceContacts) {
      if (contact.status === 'SENT' || contact.status === 'OPTED_OUT' || contact.status === 'BOUNCED' || contact.status === 'REPLIED') continue
      const why = skipReason(contact, campaign.subject, campaign.body, campaign.openers?.[contact.email]?.text)
      if (!why) continue
      let key: string, label: string, fix: 'approve' | 'fallback' | 'none' = 'none', field: string | undefined
      if (/approve to include/.test(why)) { key = 'approve'; label = 'Address not approved yet (the sheet marks it for review or gives no status)'; fix = 'approve' }
      else if (why.startsWith('Missing ')) { field = why.slice(8).split(',')[0].trim(); key = `missing:${field}`; label = `No ${field} in the list for these contacts, and the letter uses {${field}}`; fix = 'fallback' }
      else { key = why.replace(/\s*\(.*?\)/, '').replace(/ — .*/, ''); label = key }
      const g = groups.get(key) ?? { label, fix, field, emails: [] }
      g.emails.push(contact.email)
      groups.set(key, g)
    }
    return [...groups.values()].sort((a, b) => b.emails.length - a.emails.length)
  }, [audienceContacts, campaign.subject, campaign.body, campaign.openers])
  const blockedSet = useMemo(() => new Set(blocked.flatMap((g) => g.emails)), [blocked])
  const approveAddresses = useOutreachStore((x) => x.approveMany)

  const flaggedItems = useMemo(() => {
    const items: FlaggedItem[] = []
    const reviewedMap = campaign.reviewed || {}

    for (const contact of audienceContacts) {
      if (contact.status === 'SENT' || contact.status === 'OPTED_OUT' || contact.status === 'BOUNCED') continue
      if (blockedSet.has(contact.email)) continue
      const msg = buildMessage(contact, campaign.subject, campaign.body, campaign.lang)
      const flags = actionableFlags(reviewRendered(contact, msg))
      const approvedForContact = new Set(reviewedMap[contact.email] || [])

      for (const flag of flags) {
        if (!approvedForContact.has(flag.kind)) {
          items.push({ contact, flag, message: msg })
        }
      }
    }
    return items
  }, [audienceContacts, campaign.subject, campaign.body, campaign.lang, campaign.reviewed, blockedSet])

  // Group by flag kind
  const groups = useMemo(() => {
    const map = new Map<FlagKind, { title: string; detail: string; items: FlaggedItem[] }>()
    for (const item of flaggedItems) {
      const existing = map.get(item.flag.kind)
      if (existing) {
        existing.items.push(item)
      } else {
        map.set(item.flag.kind, {
          title: item.flag.title,
          detail: item.flag.detail,
          items: [item],
        })
      }
    }
    return [...map.entries()]
  }, [flaggedItems])

  const approveItem = (email: string, kind: FlagKind) => {
    const reviewed = { ...(campaign.reviewed || {}) }
    const cur = reviewed[email] || []
    if (!cur.includes(kind)) {
      reviewed[email] = [...cur, kind]
      onPatchCampaign({ reviewed })
    }
  }

  const approveGroup = async (kind: FlagKind, items: FlaggedItem[], title: string) => {
    const count = items.length
    const ok = await ask({
      title: `Approve all ${count.toLocaleString()} with “${title}”?`,
      body: 'These contacts will be included in the sending batch despite the detected warning.',
      ok: 'Approve all',
    })
    if (!ok) return

    const reviewed = { ...(campaign.reviewed || {}) }
    for (const item of items) {
      const cur = reviewed[item.contact.email] || []
      if (!cur.includes(kind)) {
        reviewed[item.contact.email] = [...cur, kind]
      }
    }
    onPatchCampaign({ reviewed })
  }

  const approveBlocked = async (emails: string[]) => {
    const ok = await ask({
      title: `Approve ${emails.length.toLocaleString()} addresses for sending?`,
      body: 'The list marks these addresses for review, or gives them no status. Approving says you have checked them and they may be emailed, in this campaign and later ones. Addresses with no mail server are still never sent.',
      ok: 'Approve addresses',
    })
    if (ok) approveAddresses(emails)
  }

  const blockedCard = blocked.length > 0 && (
    <div className="or-blocked">
      <div className="or-needs-you-title">
        <Icon name="skipForward" size={15} />
        <b>Skipped for another reason ({blockedSet.size.toLocaleString()})</b>
      </div>
      <span className="or-needs-you-sub">Approving letters above does not change these. This is what holds them:</span>
      {blocked.map((g) => (
        <div key={g.label} className="or-blocked-row">
          <span className="or-blocked-n">{g.emails.length.toLocaleString()}</span>
          <span className="or-blocked-why">
            {g.label}
            {g.fix === 'fallback' && <small>Give it a fallback in the letter, e.g. <code>{`{${g.field}|your organisation}`}</code>, and they become ready.</small>}
            {g.fix === 'none' && <small>These cannot be sent.</small>}
          </span>
          {g.fix === 'approve' && <button type="button" className="btn xs primary" onClick={() => void approveBlocked(g.emails)}>Approve {g.emails.length.toLocaleString()}</button>}
        </div>
      ))}
    </div>
  )

  if (flaggedItems.length === 0) {
    return (
      <>
        {blockedCard}
        {!blocked.length && (
          <div className="or-needs-you-empty">
            <Icon name="check" size={14} />
            <span>No messages need your review. All letters pass spot checks.</span>
          </div>
        )}
      </>
    )
  }

  return (
    <>
    {blockedCard}
    <div className="or-needs-you">
      <div className="or-needs-you-head">
        <div className="or-needs-you-title">
          <Icon name="info" size={15} />
          <b>Needs you ({flaggedItems.length})</b>
        </div>
        <span className="or-needs-you-sub">
          {flaggedItems.length === 1 ? '1 letter has a defect that will keep it from sending.' : `${flaggedItems.length} letters have defects that will keep them from sending.`}
        </span>
      </div>

      <div className="or-needs-you-groups">
        {groups.map(([kind, group]) => {
          const isOpen = expandedKind === undefined ? groups.length === 1 : expandedKind === kind
          const toggle = () => { setExpandedKind(isOpen ? null : kind); setShown(PAGE) }
          return (
            <div key={kind} className={'or-flag-group' + (isOpen ? ' open' : '')}>
              <div className="or-flag-group-head" role="button" tabIndex={0} aria-expanded={isOpen} onClick={toggle}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } }}>
                <div className="or-flag-group-title">
                  <Icon name={isOpen ? 'chevDown' : 'chevRight'} size={12} />
                  <b>{group.title}</b>
                  <span className="or-flag-count">{group.items.length}</span>
                </div>
                {kind === 'odd_name' && group.items.some(({ contact }) => fixable(contact)) && (
                  <button type="button" className="btn xs primary" onClick={(e) => { e.stopPropagation(); fixAll(group.items) }} data-tip="Take the numbers out of these names, so the letter greets the person properly">Remove the numbers</button>
                )}
                <button
                  type="button"
                  className="btn xs"
                  onClick={(e) => {
                    e.stopPropagation()
                    void approveGroup(kind, group.items, group.title)
                  }}
                  data-tip={`Approve all ${group.items.length} contacts with this warning`}
                >
                  Approve all {group.items.length}
                </button>
              </div>

              {isOpen && (
                <div className="or-flag-items">
                  <p className="or-flag-desc">{group.detail}</p>
                  {group.items.slice(0, shown).map(({ contact, flag }) => (
                    <div key={contact.email} className="or-flag-row">
                      <div
                        className="or-flag-contact"
                        onClick={() => onSelectContact && onSelectContact(contact.email)}
                        role="button"
                        tabIndex={0}
                        data-tip="Click to inspect this contact in the Letter preview"
                      >
                        <b>{contact.personName || contact.email}</b>
                        <span>{[contact.designation, contact.organization].filter(Boolean).join(' · ')}</span>
                        {flag.sample && <code className="or-flag-sample">{flag.sample}</code>}
                      </div>
                      <div className="or-flag-actions">
                        {kind === 'odd_name' && fixable(contact) && (
                          <button type="button" className="btn xs primary" onClick={() => setContactNames({ [contact.email]: fixable(contact)! })} data-tip={`The letter will say “${fixable(contact)}”`}>Fix name</button>
                        )}
                        <button
                          type="button"
                          className={'btn xs' + (kind === 'odd_name' && fixable(contact) ? '' : ' primary')}
                          onClick={() => approveItem(contact.email, kind)}
                          data-tip="Include this contact anyway"
                        >
                          Approve
                        </button>
                      </div>
                    </div>
                  ))}
                  {group.items.length > shown && (
                    <button type="button" className="btn sm or-flag-more" onClick={() => setShown((n) => n + PAGE * 4)}>
                      Show more ({(group.items.length - shown).toLocaleString()} left)
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
    </>
  )
}
