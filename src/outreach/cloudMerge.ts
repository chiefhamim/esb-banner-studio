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
  /** null = a fact about the address itself, in no campaign (an opt-out made in the list): see addressRows. */
  campaign_id: string | null
  email: string
  kind: SendKind | null
  status: SendStatus
  detail: string | null
  message_key: string | null
  message_id?: string | null
  at: string
  pc?: string | null
  updated_at?: string
}

/** One row of public.outreach_events (only the columns the desk reads). */
export interface EventRow { id: number; message_key: string; type: 'open' | 'click'; link: string | null; at: string; ua?: string | null; ip_hash?: string | null; cls?: string | null; why?: string | null }

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

/**
 * Opt-outs that hold for the ADDRESS, whatever campaign: one row each (`addr:optout:{email}`, no campaign, no kind —
 * the table's CHECKs allow NULL). Before, an opt-out only travelled as the status of a campaign's sent row, so an
 * address marked "do not email" before anyone wrote to it stayed sendable on the other PC. Older Studio builds skip
 * rows without a campaign, so this is safe to mix.
 */
export const optOutRowId = (email: string) => `addr:optout:${email}`.toLowerCase()
export function addressRows(optOut: Iterable<string>, pc: string, at = Date.now()): SendRow[] {
  const iso = new Date(at).toISOString()
  return [...optOut].map((email) => ({ id: optOutRowId(email), campaign_id: null, email: email.toLowerCase(), kind: null, status: 'opted_out' as const, detail: null, message_key: null, at: iso, pc }))
}

/** What a row says, for "has this changed since it was last pushed/pulled". */
export const rowSig = (r: Pick<SendRow, 'status' | 'detail' | 'message_key'>) => `${r.status}|${r.detail ?? ''}|${r.message_key ?? ''}`

const isKey = (k: unknown): k is string => typeof k === 'string' && /^[A-Za-z0-9_-]{22}$/.test(k)

/**
 * What main enters in its own ledger + event log (esb:outreach-mark-sent): a send made on another PC (status absent),
 * or a bounce / reply recorded on the shared row, so Activity on both PCs counts the same.
 */
export interface RemoteLedgerEntry { email: string; kind: 'campaign' | 'followup'; campaignId: string; at: number; status?: 'bounced' | 'replied'; messageId?: string; detail?: string }

/**
 * Lay shared send rows onto the campaigns. Returns new campaign objects only for those that changed, plus the
 * addresses that opted out or bounced (they hold across every campaign) and the sends this PC's main process must
 * enter in its own ledger before it may send.
 */
export function applySendRows(campaigns: Campaign[], rows: SendRow[], myPc: string): {
  campaigns: Campaign[]
  optOut: string[]
  bounced: Record<string, string>
  ledger: RemoteLedgerEntry[]
  changed: boolean
} {
  const byId = new Map(campaigns.map((c) => [c.id, c]))
  const touched = new Map<string, Campaign>()
  const optOut: string[] = []
  const bounced: Record<string, string> = {}
  const ledger: RemoteLedgerEntry[] = []
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
    if (!row.campaign_id) {
      // an address-wide fact (addressRows)
      if (row.status === 'opted_out') optOut.push(email)
      continue
    }
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
        if (elsewhere) ledger.push({ email, kind: 'campaign', campaignId: c.id, at, ...(row.message_id ? { messageId: row.message_id } : {}) })
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
        if (elsewhere) ledger.push({ email, kind: 'followup', campaignId: c.id, at, ...(row.message_id ? { messageId: row.message_id } : {}) })
      }
    }
    if (row.status === 'opted_out') optOut.push(email)
    if (row.status === 'bounced') bounced[email] = row.detail || 'Bounced'
    // the bounce / reply itself, into main's event log (it keeps one per address + time, so a re-pull is harmless)
    if ((row.status === 'bounced' || row.status === 'replied') && (row.kind === 'campaign' || row.kind === 'followup')) {
      // keyed on the row's own `at` (stable), not updated_at, which moves whenever the row is written again
      ledger.push({ email, kind: row.kind, campaignId: c.id, at, status: row.status, ...(row.status === 'bounced' && row.detail ? { detail: row.detail } : {}) })
    }
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

/** When each tracked letter went out (`campaign:` → c.sent, `followup:` → c.followed), by key. */
export function keySentAt(c: Campaign): Map<string, number> {
  const m = new Map<string, number>()
  for (const [slot, key] of Object.entries(c.tracking ?? {})) {
    const kind = slot.slice(0, slot.indexOf(':'))
    const email = slot.slice(slot.indexOf(':') + 1)
    const t = kind === 'followup' ? c.followed?.[email] : c.sent?.[email]
    if (typeof t === 'number' && Number.isFinite(t)) m.set(key, t)
  }
  return m
}

/** host + path of a clicked link, as the site stores it; anything odd is kept as written but cut short. */
const linkLabel = (l: string | null) => String(l ?? '').replace(/^https?:\/\//i, '').replace(/\/$/, '').slice(0, 120) || 'a link'

/** Events this soon after the letter went out are a mail gateway scanning it, not a reader. */
export const SCAN_WINDOW_MS = 120_000

/** User agents that are never a person reading: command-line clients, crawlers, link scanners, security gateways. */
const NOT_A_BROWSER = /curl|wget|python|java\/|go-http|okhttp|libwww|httpclient|axios|node-fetch|undici|bot\b|bot\/|crawler|spider|scanner|bingpreview|headless|phantom|slurp|facebookexternalhit|barracuda|proofpoint|mimecast|symantec|messagelabs|forcepoint|trendmicro|fortinet|sophos|ironport|microsoft office protocol discovery|safelinks/i
/** Image proxies that fetch the picture for the reader's mail app (Gmail) — an open by a machine, maybe on a read. */
const IMAGE_PROXY = /googleimageproxy|ggpht\.com|yahoomailproxy|outlook-[a-z]*-?proxy/i

export type EventClass = 'human' | 'machine' | 'ignore'

/**
 * What one tracking hit is worth. `ignore`: a scanner or prefetch (inside SCAN_WINDOW_MS of the send, on a letter that
 * bounced, or a non-browser user agent). `machine`: an open fetched by a mail provider's proxy — Gmail's image proxy,
 * or Apple Mail Privacy Protection (whose fetches carry the bare "Mozilla/5.0" agent) — shown apart, never as a reader.
 * Anything else is `human` (still approximate: an open is a picture loading). A row without a user agent (older
 * tracking endpoint) is taken as human, as before.
 */
export function classifyEvent(ev: Pick<EventRow, 'type' | 'at' | 'ua'>, sentAt?: number, bounced?: boolean): EventClass {
  if (bounced) return 'ignore'
  const t = Date.parse(ev.at)
  if (!Number.isFinite(t)) return 'ignore'
  // the ESB Mail Tracker has already judged the hit (network, agent, timing: cloud/tracker/src/classify.ts).
  // Gmail's and Yahoo's proxies fetch the picture when the reader opens the letter: a real open. Microsoft's network
  // and Apple's privacy prefetch load it whether or not anyone reads it: shown apart. Scanners and bots never count.
  const tc = (ev as { cls?: string | null }).cls
  if (tc) {
    const why = String((ev as { why?: string | null }).why ?? '')
    if (tc === 'human') return 'human'
    if (tc === 'proxy') return why === 'microsoft-network' ? 'machine' : 'human'
    if (tc === 'prefetch') return ev.type === 'open' ? 'machine' : 'ignore'
    return 'ignore'
  }
  if (sentAt != null && t - sentAt < SCAN_WINDOW_MS) return 'ignore'
  const ua = String(ev.ua ?? '').trim()
  if (!ua) return 'human'
  if (NOT_A_BROWSER.test(ua)) return 'ignore'
  if (ev.type === 'open' && (IMAGE_PROXY.test(ua) || /^mozilla\/5\.0$/i.test(ua))) return 'machine'
  return 'human'
}

export interface FoldContext {
  /** When each key's letter was sent (keySentAt). */
  sentAt?: Map<string, number>
  /** Addresses whose letter bounced: nothing on them counts. */
  bounced?: Record<string, unknown>
}

/**
 * Fold open/click events into per-recipient engagement, on top of what was folded before (`prev`). Each LETTER counts
 * once — opened yes/no, clicked yes/no, machine-opened yes/no — however many hits it got. Events for keys this
 * campaign did not send are dropped; scanners and prefetches are ignored (classifyEvent).
 */
export function foldEvents(prev: Record<string, Engagement>, events: EventRow[], keys: Map<string, string>, ctx: FoldContext = {}): Record<string, Engagement> {
  const out: Record<string, Engagement> = { ...prev }
  for (const ev of events) {
    const email = keys.get(ev.message_key)
    if (!email) continue
    if (ev.type !== 'open' && ev.type !== 'click') continue
    const cls = classifyEvent(ev, ctx.sentAt?.get(ev.message_key), !!ctx.bounced?.[email])
    if (cls === 'ignore') continue
    const t = Date.parse(ev.at)
    const cur = out[email] ?? { opens: 0, clicks: 0, links: [] }
    const k = cur.keys ?? { o: [], m: [], c: [], l: [] }
    const e: Engagement = { ...cur, links: cur.links, keys: { o: [...k.o], m: [...k.m], c: [...k.c], l: [...k.l] } }
    const ks = e.keys!
    const key = ev.message_key
    if (ev.type === 'open' && cls === 'machine') {
      if (!ks.m.includes(key)) ks.m.push(key)
      e.firstMachine = Math.min(e.firstMachine ?? t, t)
    } else if (ev.type === 'open') {
      if (!ks.o.includes(key)) ks.o.push(key)
      e.firstOpen = Math.min(e.firstOpen ?? t, t)
      e.lastOpen = Math.max(e.lastOpen ?? t, t)
    } else {
      if (!ks.c.includes(key)) ks.c.push(key)
      e.firstClick = Math.min(e.firstClick ?? t, t)
      e.lastClick = Math.max(e.lastClick ?? t, t)
      const label = linkLabel(ev.link)
      const lk = `${key}|${label}`
      if (!ks.l.includes(lk)) {
        ks.l.push(lk)
        const links = e.links.map((l) => ({ ...l }))
        const hit = links.find((l) => l.link === label)
        if (hit) hit.n++; else links.push({ link: label, n: 1 })
        links.sort((a, b) => b.n - a.n)
        e.links = links
      }
    }
    e.opens = ks.o.length
    e.clicks = ks.c.length
    e.machineOpens = ks.m.filter((x) => !ks.o.includes(x)).length
    out[email] = e
  }
  return out
}
