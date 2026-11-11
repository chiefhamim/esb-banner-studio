// src/outreach/NeedsYou.tsx
// Exception queue: catches filled letters with odd names, broken punctuation, or personal names on shared mailboxes.

import { useMemo, useState } from 'react'
import type { Campaign, Contact } from './types'
import { reviewRendered, actionableFlags, type Flag, type FlagKind } from './rendered'
import { buildMessage } from './compose'
import { inAudience } from './campaign'
import { ask } from './outreachUi'
import { useOutreachStore } from './outreachStore'
import { cleanPersonName, nameHasNumber } from './personName'
import { Icon } from '../ui/Icon'

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
  const [expandedKind, setExpandedKind] = useState<FlagKind | null>(null)
  const setContactNames = useOutreachStore((x) => x.setContactNames)
  const fixable = (c: Contact) => { const f = cleanPersonName(c.personName); return nameHasNumber(c.personName) && !!f && f !== c.personName ? f : null }
  const fixAll = (items: FlaggedItem[]) => setContactNames(Object.fromEntries(items.flatMap(({ contact }) => { const f = fixable(contact); return f ? [[contact.email, f]] : [] })))

  // Identify all contacts in audience that have actionable, unreviewed flags
  const audienceContacts = useMemo(() => contacts.filter((c) => inAudience(c, campaign.audience)), [contacts, campaign.audience])

  const flaggedItems = useMemo(() => {
    const items: FlaggedItem[] = []
    const reviewedMap = campaign.reviewed || {}

    for (const contact of audienceContacts) {
      if (contact.status === 'SENT' || contact.status === 'OPTED_OUT' || contact.status === 'BOUNCED') continue
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
  }, [audienceContacts, campaign.subject, campaign.body, campaign.lang, campaign.reviewed])

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

  if (flaggedItems.length === 0) {
    return (
      <div className="or-needs-you-empty">
        <Icon name="check" size={14} />
        <span>No messages need your review. All letters pass spot checks.</span>
      </div>
    )
  }

  return (
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
          const isOpen = expandedKind === kind || groups.length === 1
          return (
            <div key={kind} className={'or-flag-group' + (isOpen ? ' open' : '')}>
              <div className="or-flag-group-head" onClick={() => setExpandedKind(isOpen && groups.length > 1 ? null : kind)}>
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
                  {group.items.map(({ contact, flag }) => (
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
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
