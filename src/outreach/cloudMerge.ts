// The pure half of cross-PC sync (cloudSync.ts does the network): how a campaign from the shared copy is laid over
// this PC's, how per-address send results become rows of outreach_sends and back, and how open/click events fold into
// per-recipient engagement. Rules (OUTREACH_SYNC_CONTRACT §3):
//   - a campaign's letter, audience and settings: last writer wins, by the campaign's own updatedAt;
//   - what happened to each address (sent, failed, replied, bounced, followed up, tracking key, skip reason) is a fact
//     about that address, so both copies are kept — merged, never overwritten, and sends are never deleted;
//   - an event whose message key matches no letter this campaign sent is ignored.

import type { Campaign } from './types'
import type { Engagement } from './outcome'

export type SendKind = 'campaign' | 'followup' | 'test'
export type SendStatus = 'sent' | 'failed' | 'bounced' | 'skipped' | 'replied' | 'opted_out'

/** One row of public.outreach_sends. */
export interface SendRow {
  id: string
  campaign_id: string
  email: string
  kind: SendKind
  status: SendStatus
  detail: string | null
  message_key: string | null
  message_id?: string | null
  at: string
  pc?: string | null
  updated_at?: string
}

/** One row of public.outreach_events (only the columns the desk reads). */
export interface EventRow { id: number; message_key: string; type: 'open' | 'click'; link: string | null; at: string }

export const sendId = (campaignId: string, kind: 'campaign' | 'followup', email: string) => `${campaignId}:${kind}:${email}`.toLowerCase()
export const testSendId = (t: number, email: string) => `test:${t}:${email}`.toLowerCase()

/** "HAMIM-PC#3fa2c1d0" → "HAMIM-PC": the pc column carries a short id so two PCs with one name stay apart. */
export const pcName = (pc: string | null | undefined) => String(pc ?? '').replace(/#[0-9a-f]{4,}$/i, '') || 'another PC'

const MAPS = ['sent', 'failed', 'replied', 'bounced', 'followed'] as const
const OPT_MAPS = ['tracking', 'skipped', 'sentBy'] as const

function unionInto<T>(base: Record<string, T> | undefined, other: Record<string, T> | undefined): { out: Record<string, T>; added: boolean } {
  const out = { ...(base ?? {}) }
  let added = false
  for (const [k, v] of Object.entries(other ?? {})) if (!(k in out)) { out[k] = v; added = true }
  return { out, added }
}

/**
 * The campaign as this PC should hold it after seeing `remote`. Returns `local` itself when nothing changes (so the
 * store and memoised views keep their identity). A remote campaign saved while another PC was sending arrives as
 * paused here, never as "interrupted": this PC did not start it and must not offer to continue it.
 */
export function mergeCampaign(local: Campaign | undefined, remote: Campaign, opts: { runningHere?: boolean } = {}): Campaign {
  const r: Campaign = remote.status === 'sending' && !opts.runningHere ? { ...remote, status: 'paused', interrupted: null } : remote
  if (!local) return { ...r, interrupted: null }
  const remoteWins = (r.updatedAt ?? 0) > (local.updatedAt ?? 0)
  const base = remoteWins ? r : local
  const other = remoteWins ? local : r
  let changed = remoteWins
  const out: Campaign = { ...base }
  for (const k of MAPS) {
    const u = unionInto(base[k] as Record<string, unknown>, other[k] as Record<string, unknown>)
    ;(out as unknown as Record<string, unknown>)[k] = u.out
    changed = changed || u.added
  }
  for (const k of OPT_MAPS) {
    const u = unionInto(base[k] as Record<string, unknown> | undefined, other[k] as Record<string, unknown> | undefined)
    if (Object.keys(u.out).length || base[k]) (out as unknown as Record<string, unknown>)[k] = u.out
    changed = changed || u.added
  }
  // a sent address is not failed or skipped any more, whichever PC learned which
  for (const e of Object.keys(out.sent)) {
    if (out.failed[e] !== undefined) { out.failed = { ...out.failed }; delete out.failed[e]; changed = true }
    if (out.skipped?.[e] !== undefined) { out.skipped = { ...out.skipped }; delete out.skipped[e]; changed = true }
  }
  // this PC's own run state is never taken from another PC's copy
  if (opts.runningHere) { out.status = local.status; out.interrupted = local.interrupted }
  else if (remoteWins) out.interrupted = local.interrupted && local.status === out.status ? local.interrupted : null
  out.updatedAt = Math.max(local.updatedAt ?? 0, r.updatedAt ?? 0)
  return changed ? out : local
}

/**
 * Every per-address fact this campaign holds, as outreach_sends rows. Rows another PC wrote (campaign.sentBy) are
 * included too — a bounce or a reply this PC's inbox found for them is news to the cloud — but the caller sends those
 * without the pc / message_key columns, so the original writer's values stay.
 */
export function sendRowsFor(c: Campaign, optOut: ReadonlySet<string>, pc: string): (SendRow & { foreign: boolean })[] {
  const rows: (SendRow & { foreign: boolean })[] = []
  const iso = (t: number | undefined) => new Date(t && Number.isFinite(t) ? t : c.updatedAt || Date.now()).toISOString()
  for (const [email, t] of Object.entries(c.sent)) {
    const status: SendStatus = c.bounced[email] ? 'bounced' : c.replied[email] ? 'replied' : optOut.has(email) ? 'opted_out' : 'sent'
    rows.push({ id: sendId(c.id, 'campaign', email), campaign_id: c.id, email, kind: 'campaign', status, detail: c.bounced[email] ?? null, message_key: c.tracking?.[`campaign:${email}`] ?? null, at: iso(t), pc, foreign: !!c.sentBy?.[email] })
  }
  for (const [email, err] of Object.entries(c.failed)) {
    if (c.sent[email]) continue
    rows.push({ id: sendId(c.id, 'campaign', email), campaign_id: c.id, email, kind: 'campaign', status: 'failed', detail: String(err).slice(0, 500), message_key: null, at: iso(undefined), pc, foreign: false })
  }
  for (const [email, why] of Object.entries(c.skipped ?? {})) {
    if (c.sent[email] || c.failed[email]) continue
    rows.push({ id: sendId(c.id, 'campaign', email), campaign_id: c.id, email, kind: 'campaign', status: 'skipped', detail: why, message_key: null, at: iso(undefined), pc, foreign: false })
  }
  for (const [email, t] of Object.entries(c.followed)) {
    rows.push({ id: sendId(c.id, 'followup', email), campaign_id: c.id, email, kind: 'followup', status: c.replied[email] && c.replied[email] >= t ? 'replied' : 'sent', detail: null, message_key: c.tracking?.[`followup:${email}`] ?? null, at: iso(t), pc, foreign: !!c.sentBy?.[`followup:${email}`] })
  }
  return rows
}

/** What a row says, for "has this changed since it was last pushed/pulled". */
export const rowSig = (r: Pick<SendRow, 'status' | 'detail' | 'message_key'>) => `${r.status}|${r.detail ?? ''}|${r.message_key ?? ''}`

const isKey = (k: unknown): k is string => typeof k === 'string' && /^[A-Za-z0-9_-]{22}$/.test(k)

/**
 * Lay shared send rows onto the campaigns. Returns new campaign objects only for those that changed, plus the
 * addresses that opted out or bounced (they hold across every campaign) and the sends this PC's main process must
 * enter in its own ledger before it may send.
 */
export function applySendRows(campaigns: Campaign[], rows: SendRow[], myPc: string): {
  campaigns: Campaign[]
  optOut: string[]
  bounced: Record<string, string>
  ledger: { email: string; kind: 'campaign' | 'followup'; campaignId: string; at: number }[]
  changed: boolean
} {
  const byId = new Map(campaigns.map((c) => [c.id, c]))
  const touched = new Map<string, Campaign>()
  const optOut: string[] = []
  const bounced: Record<string, string> = {}
  const ledger: { email: string; kind: 'campaign' | 'followup'; campaignId: string; at: number }[] = []
  const edit = (id: string): Campaign | null => {
    const have = touched.get(id) ?? byId.get(id)
    if (!have) return null
    if (!touched.has(id)) {
      const copy: Campaign = { ...have, sent: { ...have.sent }, failed: { ...have.failed }, replied: { ...have.replied }, bounced: { ...have.bounced }, followed: { ...have.followed }, tracking: { ...(have.tracking ?? {}) }, skipped: { ...(have.skipped ?? {}) }, sentBy: { ...(have.sentBy ?? {}) } }
      touched.set(id, copy)
    }
    return touched.get(id)!
  }
  const dirty = new Set<string>()
  for (const row of rows) {
    if (row.kind === 'test') continue
    const email = String(row.email || '').toLowerCase().trim()
    const at = Date.parse(row.at)
    if (!email || !Number.isFinite(at)) continue
    const c = edit(row.campaign_id)
    if (!c) continue
    const mark = (cond: boolean, fn: () => void) => { if (cond) { fn(); dirty.add(c.id) } }
    const elsewhere = !!row.pc && row.pc !== myPc
    const delivered = row.status === 'sent' || row.status === 'replied' || row.status === 'bounced' || row.status === 'opted_out'
    if (row.kind === 'campaign') {
      if (delivered) {
        mark(!c.sent[email], () => { c.sent[email] = at })
        mark(c.failed[email] !== undefined, () => { delete c.failed[email] })
        mark(c.skipped![email] !== undefined, () => { delete c.skipped![email] })
        mark(elsewhere && !c.sentBy![email], () => { c.sentBy![email] = pcName(row.pc) })
        mark(isKey(row.message_key) && c.tracking![`campaign:${email}`] !== row.message_key, () => { c.tracking![`campaign:${email}`] = row.message_key! })
        if (elsewhere) ledger.push({ email, kind: 'campaign', campaignId: c.id, at })
      } else if (row.status === 'failed') {
        mark(!c.sent[email] && c.failed[email] === undefined, () => { c.failed[email] = row.detail || 'Failed on another PC' })
      } else if (row.status === 'skipped') {
        mark(!c.sent[email] && !c.failed[email] && !c.skipped![email], () => { c.skipped![email] = String(row.detail || 'skipped').slice(0, 40) })
      }
      const upd = Date.parse(row.updated_at ?? row.at)
      mark(row.status === 'replied' && !c.replied[email], () => { c.replied[email] = Number.isFinite(upd) ? upd : at })
      mark(row.status === 'bounced' && !c.bounced[email], () => { c.bounced[email] = row.detail || 'Bounced' })
    } else {
      if (delivered) {
        mark(!c.followed[email], () => { c.followed[email] = at })
        mark(elsewhere && !c.sentBy![`followup:${email}`], () => { c.sentBy![`followup:${email}`] = pcName(row.pc) })
        mark(isKey(row.message_key) && c.tracking![`followup:${email}`] !== row.message_key, () => { c.tracking![`followup:${email}`] = row.message_key! })
        if (elsewhere) ledger.push({ email, kind: 'followup', campaignId: c.id, at })
      }
    }
    if (row.status === 'opted_out') optOut.push(email)
    if (row.status === 'bounced') bounced[email] = row.detail || 'Bounced'
  }
  const out = dirty.size ? campaigns.map((c) => (dirty.has(c.id) ? touched.get(c.id)! : c)) : campaigns
  return { campaigns: out, optOut, bounced, ledger, changed: dirty.size > 0 }
}

/** The address each tracking key belongs to, from the campaign's own record of the letters it sent. */
export function keyIndex(c: Campaign): Map<string, string> {
  const m = new Map<string, string>()
  for (const [slot, key] of Object.entries(c.tracking ?? {})) m.set(key, slot.slice(slot.indexOf(':') + 1))
  return m
}

/** host + path of a clicked link, as the site stores it; anything odd is kept as written but cut short. */
const linkLabel = (l: string | null) => String(l ?? '').replace(/^https?:\/\//i, '').replace(/\/$/, '').slice(0, 120) || 'a link'

/**
 * Fold open/click events into per-recipient engagement, on top of what was folded before (`prev`). Events for keys
 * this campaign did not send are dropped.
 */
export function foldEvents(prev: Record<string, Engagement>, events: EventRow[], keys: Map<string, string>): Record<string, Engagement> {
  const out: Record<string, Engagement> = { ...prev }
  for (const ev of events) {
    const email = keys.get(ev.message_key)
    if (!email) continue
    const t = Date.parse(ev.at)
    if (!Number.isFinite(t)) continue
    const cur = out[email] ?? { opens: 0, clicks: 0, links: [] }
    const e: Engagement = { ...cur, links: cur.links }
    if (ev.type === 'open') {
      e.opens++
      e.firstOpen = Math.min(e.firstOpen ?? t, t)
      e.lastOpen = Math.max(e.lastOpen ?? t, t)
    } else if (ev.type === 'click') {
      e.clicks++
      e.firstClick = Math.min(e.firstClick ?? t, t)
      e.lastClick = Math.max(e.lastClick ?? t, t)
      const label = linkLabel(ev.link)
      const links = e.links.map((l) => ({ ...l }))
      const hit = links.find((l) => l.link === label)
      if (hit) hit.n++; else links.push({ link: label, n: 1 })
      links.sort((a, b) => b.n - a.n)
      e.links = links
    } else continue
    out[email] = e
  }
  return out
}
