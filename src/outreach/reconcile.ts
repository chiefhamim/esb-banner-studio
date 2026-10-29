import type { Campaign } from './types'
import type { OutreachEvent } from '../esb'

export interface ReconcileState {
  campaigns: Campaign[]
  optOut: string[]
  bouncedAddrs: Record<string, string>
}

export interface ReconcileResult {
  campaigns: Campaign[]
  optOut: string[]
  bouncedAddrs: Record<string, string>
  news: Array<{ level: 'ok' | 'warn'; text: string }>
}

/**
 * Pure projection: applies append-only events to the desk's campaign and address state.
 * Guaranteed to be idempotent and tolerant of unknown campaign IDs.
 */
export function project(state: ReconcileState, events: OutreachEvent[]): ReconcileResult {
  if (!events || events.length === 0) {
    return {
      campaigns: state.campaigns,
      optOut: state.optOut,
      bouncedAddrs: state.bouncedAddrs,
      news: [],
    }
  }

  // Clone top-level campaign array and map by ID
  const campaignMap = new Map<string, Campaign>()
  const campaigns: Campaign[] = state.campaigns.map((c) => {
    const copy = {
      ...c,
      sent: { ...c.sent },
      failed: { ...c.failed },
      replied: { ...c.replied },
      bounced: { ...c.bounced },
      followed: { ...c.followed },
    }
    campaignMap.set(c.id, copy)
    return copy
  })

  const nextOptOut = new Set<string>(state.optOut)
  const nextBouncedAddrs: Record<string, string> = { ...state.bouncedAddrs }
  const news: Array<{ level: 'ok' | 'warn'; text: string }> = []
  const touchedCampaignIds = new Set<string>()
  let optOutChanged = false
  let bouncedChanged = false

  for (const ev of events) {
    const email = (ev.email || ev.to || '').toLowerCase().trim()

    switch (ev.type) {
      case 'send.ok': {
        if (!email || !ev.campaignId) break
        const c = campaignMap.get(ev.campaignId)
        if (!c) break
        const t = ev.t || Date.now()

        if (ev.run === 'followup') {
          if (c.followed[email] !== t) {
            c.followed[email] = t
            touchedCampaignIds.add(c.id)
          }
        } else {
          let dirty = false
          if (c.sent[email] !== t) {
            c.sent[email] = t
            dirty = true
          }
          if (c.failed[email] !== undefined) {
            delete c.failed[email]
            dirty = true
          }
          if (dirty) touchedCampaignIds.add(c.id)
        }
        break
      }

      case 'send.fail': {
        if (!email) break
        const c = ev.campaignId ? campaignMap.get(ev.campaignId) : undefined
        if (c && ev.run !== 'followup') {
          const errMsg = ev.error || ev.kind || 'Send failed'
          if (c.failed[email] !== errMsg) {
            c.failed[email] = errMsg
            touchedCampaignIds.add(c.id)
          }
        }
        if (ev.kind === 'recipient_permanent' || ev.kind === 'policy') {
          const reason = `Refused: ${ev.error || ev.kind}`
          if (nextBouncedAddrs[email] !== reason) {
            nextBouncedAddrs[email] = reason
            bouncedChanged = true
          }
        }
        break
      }

      case 'reply': {
        if (!email) break
        const replyAt = ev.at || ev.t || Date.now()
        const isAuto = !!ev.auto
        for (const c of campaigns) {
          const sentAt = Math.min(c.sent[email] ?? Infinity, c.followed[email] ?? Infinity)
          if (!isAuto && replyAt >= sentAt - 60_000 && !c.replied[email]) {
            c.replied[email] = replyAt
            touchedCampaignIds.add(c.id)
            news.push({
              level: 'ok',
              text: `${email} replied${ev.unsubscribe ? ' and asked not to be emailed' : ''} — ${c.name}`,
            })
          }
        }
        if (ev.unsubscribe && !nextOptOut.has(email)) {
          nextOptOut.add(email)
          optOutChanged = true
        }
        break
      }

      case 'bounce': {
        if (!email) break
        const reason = ev.reason || 'Bounced'
        for (const c of campaigns) {
          if (c.sent[email] && !c.bounced[email]) {
            c.bounced[email] = reason
            touchedCampaignIds.add(c.id)
            news.push({
              level: 'warn',
              text: `${email} bounced: ${reason} — ${c.name}`,
            })
          }
        }
        if (nextBouncedAddrs[email] !== reason) {
          nextBouncedAddrs[email] = reason
          bouncedChanged = true
        }
        break
      }

      case 'optout': {
        if (!email) break
        const on = ev.on !== false
        if (on) {
          if (!nextOptOut.has(email)) {
            nextOptOut.add(email)
            optOutChanged = true
          }
        } else {
          if (nextOptOut.has(email)) {
            nextOptOut.delete(email)
            optOutChanged = true
          }
        }
        break
      }
    }
  }

  // If nothing changed, return existing state references
  if (touchedCampaignIds.size === 0 && !optOutChanged && !bouncedChanged && news.length === 0) {
    return {
      campaigns: state.campaigns,
      optOut: state.optOut,
      bouncedAddrs: state.bouncedAddrs,
      news: [],
    }
  }

  // Assemble final campaigns list: keep unchanged campaigns by reference
  const finalCampaigns = state.campaigns.map((orig) => {
    if (touchedCampaignIds.has(orig.id)) {
      const updated = campaignMap.get(orig.id)!
      return { ...updated, updatedAt: Date.now() }
    }
    return orig
  })

  return {
    campaigns: finalCampaigns,
    optOut: optOutChanged ? [...nextOptOut] : state.optOut,
    bouncedAddrs: bouncedChanged ? nextBouncedAddrs : state.bouncedAddrs,
    news,
  }
}
