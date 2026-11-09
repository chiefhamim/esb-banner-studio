// Cross-PC sync for the Outreach desk (OUTREACH_SYNC_CONTRACT §1, §3). Campaigns, imported lists, designed letters
// and every per-address send result are kept in the esbpowerline Supabase project as well as on this PC, so a second
// PC opening a campaign sees the same contacts and results, and its Resume skips everyone already sent.
//
// - Talks to PostgREST with the signed-in staff member's own token (siteApi ensureFreshSession — refresh tokens are
//   single use, so this file never refreshes by itself). No token, no sync: the desk works locally as before.
// - Local stays the source for sending. Sync is best effort and catches up: pulls on sign-in, focus, every 60 s and
//   before a batch starts; pushes a few seconds after a change. Offline or a missing table only changes the status bar.
// - One PC sends a campaign at a time: outreach_acquire_lock before Send/Resume, a heartbeat every 60 s while the job
//   runs, released when it stops or finishes. A lock whose heartbeat is older than 10 minutes may be taken over.
// - Before a batch starts, the campaign's shared sends are entered in this PC's own ledger (esb:outreach-mark-sent),
//   so the main process refuses a repeat even if this PC's copy of the campaign were stale.
// - The account's Autopilot settings (hours, daily limit, gaps, per-organisation limits, cooldown) are the same on
//   every PC: one row in outreach_settings, last change wins by its sharedUpdatedAt (outreach-settings.cjs SHARED_KEYS).
//   Until that table exists (website migration proposal 0025) settings stay per PC and nothing else is affected.
// - Light by design: a campaign's whole `data` is downloaded only when its server updated_at differs from the one this
//   PC last saw (its own pushes included), the poll runs every 60 s only while the window is in front or a batch is
//   active (else every 5 min), and Supabase Realtime (cloudRealtime.ts) pokes a pull the moment another PC writes.
// Nothing here logs a token, a password or a contact row.

import { SUPABASE_ANON_KEY, SUPABASE_URL, ensureFreshSession, getStoredStaffSession } from '../editorial/siteApi'
import { DESK_KEYS, useOutreachStore } from './outreachStore'
import { useEngineStore } from './engineStore'
import { engineClient } from './engineClient'
import { STALE_SECONDS, lockBlock, useCloud, type CloudState, type LockInfo } from './cloudStore'
import { addressRows, applySendRows, foldEvents, keyIndex, keySentAt, mergeCampaign, rowSig, sendRowsFor, testSendId, type EventRow, type SendRow } from './cloudMerge'
import { idbGet, idbSet } from './idb'
import { ask } from './outreachUi'
import type { Campaign, ListMeta } from './types'
import type { Engagement } from './outcome'
import type { DesignLetter } from './design'
import type { Sheet } from './directory'
import { fmtDateTime } from '../ui/time'
import { createRealtime, type RealtimeHandle } from './cloudRealtime'
import type { AutopilotSettings } from '../esb'

const LS = 'esb-banner-studio/outreach/cloud'
const PC_KEY = 'esb-banner-studio/outreach/pc'
const PULL_EVERY = 60_000
/** Window in the background, nothing sending: a pull every 5 minutes is plenty (Realtime pokes the rest). */
const PULL_IDLE = 5 * 60_000
/** The account-wide Autopilot settings (electron/outreach-settings.cjs SHARED_KEYS — keep the two lists in step). */
export const SHARED_SETTINGS = ['window', 'dailyLimit', 'ramp', 'pace', 'minDelaySec', 'maxDelaySec', 'domainMaxPerDay', 'domainOverrides', 'domainMinGapSec', 'contactCooldownDays', 'gmailCeiling24h'] as const
const SETTINGS_ID = 'autopilot'
const PUSH_DELAY = 4_000
const HEARTBEAT_EVERY = 60_000
/** Cursors look back this far, so a row written by a PC whose clock runs a little slow is not skipped. */
const OVERLAP_MS = 10 * 60_000

class CloudError extends Error {
  readonly kind: Exclude<CloudState, 'ok' | 'syncing'>
  readonly status: number
  constructor(message: string, kind: Exclude<CloudState, 'ok' | 'syncing'>, status = 0) { super(message); this.kind = kind; this.status = status }
}

// ------------------------------------------------------------------ local bookkeeping (localStorage, small)
interface Book {
  /** campaign id → the updatedAt last pulled or pushed: a campaign is pushed when it changed after that. */
  synced: Record<string, number>
  /** lists / designs already in the cloud (id → version). */
  lists: Record<string, number>
  designs: Record<string, number>
  /** Deleted here, still to delete there. */
  deleted: string[]
  /** server-side updated_at cursors (ISO). */
  campaignsAt: string
  sendsAt: string
  /** Test sends waiting to be pushed. */
  tests: SendRow[]
  /** campaign id -> the server's updated_at this PC last saw or wrote: `data` is fetched only when it differs. */
  seen: Record<string, string>
  /** outreach_settings: the sharedUpdatedAt last pulled/pushed, and when the table was last found missing. */
  settingsAt: number
  settingsMissingAt: number
  /** When this PC last changed a shared desk preference (signatures, templates, house prompt, letterhead look) or an
   *  approval, and the stamp of the 'desk' row last pulled/pushed. */
  deskChangedAt: number
  deskAt: number
}
const emptyBook = (): Book => ({ synced: {}, lists: {}, designs: {}, deleted: [], campaignsAt: '1970-01-01T00:00:00Z', sendsAt: '1970-01-01T00:00:00Z', tests: [], seen: {}, settingsAt: 0, settingsMissingAt: 0, deskChangedAt: 0, deskAt: 0 })
let book: Book = (() => { try { return { ...emptyBook(), ...(JSON.parse(localStorage.getItem(LS) || 'null') ?? {}) } } catch { return emptyBook() } })()
const saveBook = () => { try { localStorage.setItem(LS, JSON.stringify(book)) } catch { /* storage full: sync redoes the work */ } }

/** This PC's own id (random, kept), and the pc value written to the shared rows: "NAME#abcd1234". */
export const pcId: string = (() => {
  try {
    let id = localStorage.getItem(PC_KEY)
    if (!id) { id = (crypto.randomUUID?.() ?? `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`).replace(/-/g, ''); localStorage.setItem(PC_KEY, id) }
    return id
  } catch { return 'pc' + Math.random().toString(16).slice(2, 10) }
})()
const pcLabel = () => useCloud.getState().pcLabel || `PC ${pcId.slice(0, 4)}`
const pcTag = () => `${pcLabel()}#${pcId.slice(0, 8)}`

// sent-row signatures (id → rowSig) live in IndexedDB: thousands of rows are too many for localStorage
let sigs: Record<string, string> | null = null
const loadSigs = async () => (sigs ??= (await idbGet<Record<string, string>>('cloud:sigs')) ?? {})
const saveSigs = () => (sigs ? idbSet('cloud:sigs', sigs) : Promise.resolve())

/** A dry run (ESB_OUTREACH_DRYRUN) marks campaigns sent with simulated results: none of it may reach the shared copy. */
const testRun = () => !!useEngineStore.getState().settings?.dryRun

// ------------------------------------------------------------------ PostgREST
async function token(): Promise<{ token: string; userId?: string } | null> {
  const s = await ensureFreshSession(getStoredStaffSession())
  return s?.token ? { token: s.token, userId: s.userId } : null
}

async function rest<T = unknown>(path: string, init: RequestInit & { prefer?: string } = {}): Promise<T> {
  const t = await token()
  if (!t) throw new CloudError('Not signed in', 'signed-out')
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 20_000)
  let res: Response
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...init,
      signal: ctl.signal,
      headers: {
        apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${t.token}`, Accept: 'application/json', 'Content-Type': 'application/json',
        ...(init.prefer ? { Prefer: init.prefer } : {}),
      },
    })
  } catch {
    throw new CloudError('The server did not answer', 'offline')
  } finally { clearTimeout(timer) }
  const text = await res.text().catch(() => '')
  if (!res.ok) {
    let code = ''
    try { code = String((JSON.parse(text) as { code?: string }).code ?? '') } catch { /* not JSON */ }
    // PGRST205/42P01: no such table; PGRST202/42883: no such function — the website migration is not applied yet
    if (res.status === 404 || /^(PGRST205|PGRST202|42P01|42883)$/.test(code)) throw new CloudError('The shared tables are not on the site yet', 'not-setup', res.status)
    if (res.status === 401) throw new CloudError('The site refused the sign-in — sign in again', 'signed-out', 401)
    if (res.status === 403 || code === '42501') throw new CloudError('This account may not use the shared Outreach data', 'no-access', res.status)
    throw new CloudError(`The server answered ${res.status}`, 'error', res.status)
  }
  return (text ? JSON.parse(text) : null) as T
}

const upsert = (table: string, rows: unknown[], onConflict = 'id') =>
  rest(`${table}?on_conflict=${onConflict}`, { method: 'POST', body: JSON.stringify(rows), prefer: 'resolution=merge-duplicates,return=minimal' })

/** GET a table page by page (PostgREST caps a response; 1,000 rows a page). */
async function getAll<T>(path: string, page = 1000): Promise<T[]> {
  const out: T[] = []
  for (let offset = 0; offset < 200_000; offset += page) {
    const rows = await rest<T[]>(`${path}${path.includes('?') ? '&' : '?'}limit=${page}&offset=${offset}`)
    out.push(...(rows ?? []))
    if (!rows || rows.length < page) break
  }
  return out
}

const isoBack = (iso: string) => new Date(Math.max(0, Date.parse(iso) - OVERLAP_MS)).toISOString()
const maxIso = (a: string, b: string | undefined) => (b && Date.parse(b) > Date.parse(a) ? b : a)

// ------------------------------------------------------------------ applying to the desk
let applying = false
const runningHere = (id: string) => {
  const j = useEngineStore.getState().jobForCampaign(id)
  return !!j && ['queued', 'running', 'waiting', 'paused'].includes(j.status)
}

async function applyCampaigns(remote: { id: string; data: Campaign; updated_at: string }[]) {
  const st = useOutreachStore.getState()
  let campaigns = st.campaigns
  let changed = false
  let reloadContacts = false, reloadDesign = false
  const fresh: string[] = []
  for (const row of remote) {
    if (book.deleted.includes(row.id)) continue
    const data = row.data && typeof row.data === 'object' ? { ...row.data, id: row.id } as Campaign : null
    if (!data || typeof data.name !== 'string' || !data.sent || typeof data.sent !== 'object') continue
    const local = campaigns.find((c) => c.id === row.id)
    const merged = mergeCampaign(local, data, { runningHere: runningHere(row.id) })
    book.synced[row.id] = Math.max(book.synced[row.id] ?? 0, merged.updatedAt ?? 0)
    if (merged === local) continue
    changed = true
    if (!local) { campaigns = [...campaigns, merged]; fresh.push(row.id) }
    else {
      campaigns = campaigns.map((c) => (c.id === row.id ? merged : c))
      if (row.id === st.activeId && (local.listId !== merged.listId || local.sheet !== merged.sheet || local.kind !== merged.kind || local.recipients.join() !== merged.recipients.join())) reloadContacts = true
      if (row.id === st.activeId && merged.design && merged.design.importedAt !== local.design?.importedAt) reloadDesign = true
    }
  }
  if (!changed) return fresh
  applying = true
  try { await st.cloudApply({ campaigns, reload: { contacts: reloadContacts, design: reloadDesign } }) } finally { applying = false }
  return fresh
}

async function applySends(rows: SendRow[]) {
  if (!rows.length) return
  const st = useOutreachStore.getState()
  const res = applySendRows(st.campaigns, rows, pcTag())
  const s = await loadSigs()
  for (const r of rows) s[r.id] = rowSig(r)
  void saveSigs()
  const optOut = res.optOut.filter((e) => !st.optOut.includes(e))
  const bounced = Object.entries(res.bounced).filter(([e]) => !st.bouncedAddrs[e])
  if (res.changed || optOut.length || bounced.length) {
    applying = true
    try {
      await st.cloudApply({
        ...(res.changed ? { campaigns: res.campaigns } : {}),
        ...(optOut.length ? { optOut: [...st.optOut, ...optOut] } : {}),
        ...(bounced.length ? { bouncedAddrs: { ...st.bouncedAddrs, ...Object.fromEntries(bounced) } } : {}),
      })
    } finally { applying = false }
    if (optOut.length) void window.esb?.outreachSyncOptOuts?.(optOut)
  }
  // the main process's own ledger: what it checks before every send, whatever the desk shows
  if (res.ledger.length && window.esb?.outreachMarkSent) {
    for (let i = 0; i < res.ledger.length; i += 5000) await window.esb.outreachMarkSent(res.ledger.slice(i, i + 5000)).catch(() => null)
  }
}

// ------------------------------------------------------------------ pull
async function pullCampaigns() {
  // one small request: every campaign's id and updated_at. A row is downloaded whole only when its updated_at is not
  // the one this PC last saw. Before, the 10-minute look-back re-downloaded the sending campaign (a few hundred KB
  // with its per-address maps) on every 60 s pull, the PC's own pushes included.
  const heads = await getAll<{ id: string; updated_at: string }>('outreach_campaigns?select=id,updated_at&order=updated_at.asc', 1000)
  const want = heads.filter((h) => !book.deleted.includes(h.id) && Date.parse(book.seen[h.id] ?? '') !== Date.parse(h.updated_at)).map((h) => h.id)
  const rows: { id: string; data: Campaign; updated_at: string }[] = []
  for (let i = 0; i < want.length; i += 20) {
    const ids = want.slice(i, i + 20).map((id) => `"${id.replace(/"/g, '')}"`).join(',')
    rows.push(...((await rest<{ id: string; data: Campaign; updated_at: string }[]>(`outreach_campaigns?id=in.(${encodeURIComponent(ids)})&select=id,data,updated_at`)) ?? []))
  }
  for (const r of rows) { book.campaignsAt = maxIso(book.campaignsAt, r.updated_at); book.seen[r.id] = r.updated_at }
  const fresh = await applyCampaigns(rows)
  // a campaign first seen now: all its sends, which the incremental cursor may already have passed
  for (const id of fresh) await applySends(await getAll<SendRow>(`outreach_sends?campaign_id=eq.${encodeURIComponent(id)}&select=*&order=at.asc`))
  // deleted on another PC: gone from the cloud although this PC synced it, and not changed here since
  const ids = new Set(heads.map((r) => r.id))
  for (const id of Object.keys(book.seen)) if (!ids.has(id)) delete book.seen[id]
  const st = useOutreachStore.getState()
  const gone = st.campaigns.filter((c) => book.synced[c.id] && !ids.has(c.id) && (c.updatedAt ?? 0) <= book.synced[c.id] && !runningHere(c.id) && c.id !== st.activeId)
  if (gone.length) {
    applying = true
    try { await st.cloudApply({ campaigns: st.campaigns.filter((c) => !gone.includes(c)) }) } finally { applying = false }
    for (const c of gone) { delete book.synced[c.id]; st.addLog('info', `${c.name} was deleted on another PC`) }
  }
}

// ------------------------------------------------------------------ account-wide Autopilot settings
type SettingsRow = { id: string; data: Partial<AutopilotSettings> & { sharedUpdatedAt?: number }; updated_at?: string }
const SETTINGS_RETRY = 30 * 60_000
const settingsTableMissing = () => book.settingsMissingAt > 0 && Date.now() - book.settingsMissingAt < SETTINGS_RETRY

/** The shared part of this PC's settings. */
export function sharedOf(s: AutopilotSettings | null | undefined): Partial<AutopilotSettings> | null {
  if (!s) return null
  const out: Record<string, unknown> = {}
  for (const k of SHARED_SETTINGS) out[k] = (s as unknown as Record<string, unknown>)[k]
  return out as Partial<AutopilotSettings>
}

/**
 * Pull, then push, the one settings row. Newer sharedUpdatedAt wins; a remote win is saved through the engine like a
 * dialog save (validated in main; waiting batches re-check at once), keeping the remote stamp so it does not bounce.
 * The table missing (proposal 0025 not applied) is remembered for 30 min and changes no status.
 */
async function syncSettings(userId?: string) {
  if (settingsTableMissing()) return
  try {
    const local = useEngineStore.getState().settings ?? (await engineClient.settings())
    const localAt = local?.sharedUpdatedAt ?? 0
    const [row] = (await rest<SettingsRow[]>(`outreach_settings?id=eq.${SETTINGS_ID}&select=id,data,updated_at`)) ?? []
    const remoteAt = Number(row?.data?.sharedUpdatedAt) || 0
    book.settingsMissingAt = 0
    if (row && remoteAt > localAt) {
      const patch: Record<string, unknown> = { sharedUpdatedAt: remoteAt }
      for (const k of SHARED_SETTINGS) if (row.data[k] !== undefined) patch[k] = row.data[k]
      const r = await engineClient.saveSettings(patch as Partial<AutopilotSettings>)
      if (r.ok) {
        book.settingsAt = remoteAt
        useOutreachStore.getState().addLog('info', 'Autopilot settings updated from another PC')
      }
      return
    }
    if (local && localAt > remoteAt) {
      await upsert('outreach_settings', [{ id: SETTINGS_ID, data: { ...sharedOf(local), sharedUpdatedAt: localAt }, updated_at: new Date().toISOString(), updated_by: userId ?? null }])
      book.settingsAt = localAt
      rt?.expectEcho()
    }
  } catch (e) {
    if (e instanceof CloudError && e.kind === 'not-setup') { book.settingsMissingAt = Date.now(); return }
    throw e
  }
}

async function pullSends() {
  const rows = await getAll<SendRow>(`outreach_sends?select=*&updated_at=gt.${encodeURIComponent(isoBack(book.sendsAt))}&order=updated_at.asc`)
  for (const r of rows) book.sendsAt = maxIso(book.sendsAt, r.updated_at)
  await applySends(rows)
}

/** Lists and designed letters the open campaign needs and this PC does not have. */
async function pullAssets() {
  const st = useOutreachStore.getState()
  const c = st.campaign()
  if (!c) return
  if (c.kind === 'list' && c.listId && !st.lists.some((l) => l.id === c.listId)) {
    const [row] = await rest<{ id: string; file_name: string | null; meta: ListMeta | null; rows: Sheet[] }[]>(`outreach_lists?id=eq.${encodeURIComponent(c.listId)}&select=id,file_name,meta,rows`)
    if (row && Array.isArray(row.rows)) {
      await idbSet(`list:${row.id}`, row.rows)
      const meta: ListMeta = row.meta && typeof row.meta === 'object' ? { ...row.meta, id: row.id } : { id: row.id, fileName: row.file_name || 'Shared list', addedAt: Date.now(), sheets: row.rows.map((x) => ({ name: x.name, contacts: 0 })) }
      book.lists[row.id] = 1
      applying = true
      try { await st.cloudApply({ lists: [meta, ...useOutreachStore.getState().lists.filter((l) => l.id !== row.id)], reload: { contacts: useOutreachStore.getState().activeId === c.id } }) } finally { applying = false }
      st.addLog('info', `${meta.fileName}: list fetched from the shared copy`)
    }
  }
  if (c.design) {
    const have = await idbGet<DesignLetter>(`design:${c.id}`)
    if (!have || have.importedAt !== c.design.importedAt) {
      const [row] = await rest<{ campaign_id: string; data: DesignLetter }[]>(`outreach_designs?campaign_id=eq.${encodeURIComponent(c.id)}&select=campaign_id,data`)
      if (row?.data && typeof row.data.html === 'string' && Array.isArray(row.data.images)) {
        await idbSet(`design:${c.id}`, row.data)
        book.designs[c.id] = row.data.importedAt
        if (useOutreachStore.getState().activeId === c.id) await st.cloudApply({ reload: { design: true } })
      }
    }
  }
}

/** Version of the folded engagement kept in IndexedDB; an older fold (raw hit counts) is thrown away and redone. */
const ENGAGE_V = 2
/** Unmatched events are kept this long for a re-fold (the letter's key may reach this PC later), and at most this many. */
const PENDING_MS = 14 * 86_400_000
const PENDING_MAX = 5000

type SavedEngagement = { v?: number; lastId: number; byEmail: Record<string, Engagement>; pending?: EventRow[] }

/**
 * Opens and clicks for the open campaign, folded on top of what was folded before (kept in IndexedDB). An event whose
 * key matches no letter this PC knows yet (the send row from the other PC has not arrived) is kept in `pending` and
 * folded again on the next pull, instead of being skipped for good by the id cursor.
 */
async function pullEvents(campaignId: string) {
  const c = useOutreachStore.getState().campaigns.find((x) => x.id === campaignId)
  if (!c || !Object.keys(c.tracking ?? {}).length) return
  let saved = (await idbGet<SavedEngagement>(`engage:${campaignId}`)) ?? { v: ENGAGE_V, lastId: 0, byEmail: {} }
  if (saved.v !== ENGAGE_V) saved = { v: ENGAGE_V, lastId: 0, byEmail: {} }
  if (!useCloud.getState().engagement[campaignId] && Object.keys(saved.byEmail).length) useCloud.getState().set({ engagement: { ...useCloud.getState().engagement, [campaignId]: saved.byEmail } })
  const rows = await getAll<EventRow>(`outreach_events?campaign_id=eq.${encodeURIComponent(campaignId)}&id=gt.${saved.lastId}&select=id,message_key,type,link,at,ua&order=id.asc`)
  const keys = keyIndex(c)
  const pendingBefore = saved.pending ?? []
  const retry = pendingBefore.filter((r) => keys.has(r.message_key))
  if (!rows.length && !retry.length) return
  const all = [...retry, ...rows]
  const byEmail = foldEvents(saved.byEmail, all.filter((r) => keys.has(r.message_key)), keys, { sentAt: keySentAt(c), bounced: c.bounced })
  const now = Date.now()
  const pending = [...pendingBefore.filter((r) => !keys.has(r.message_key)), ...rows.filter((r) => !keys.has(r.message_key))]
    .filter((r) => now - Date.parse(r.at) < PENDING_MS).slice(-PENDING_MAX)
  const lastId = rows.length ? rows[rows.length - 1].id : saved.lastId
  await idbSet(`engage:${campaignId}`, { v: ENGAGE_V, lastId, byEmail, pending })
  useCloud.getState().set({ engagement: { ...useCloud.getState().engagement, [campaignId]: byEmail } })
}

// ------------------------------------------------------------------ shared desk preferences + approvals
type DeskRow = { id: string; data: Record<string, unknown> & { deskUpdatedAt?: number; approved?: string[] } }

/**
 * Row 'desk' of outreach_settings: signatures, templates, house prompt and letterhead look (newest change wins, by
 * deskUpdatedAt) and the approvals made by hand (a union: an approval made on either PC holds on both; un-approving
 * does not travel, which errs on the side of not sending). Missing table: skipped like the settings row.
 */
async function syncDesk(userId?: string) {
  if (settingsTableMissing()) return
  try {
    const st = useOutreachStore.getState()
    const [row] = (await rest<DeskRow[]>('outreach_settings?id=eq.desk&select=id,data')) ?? []
    const remoteAt = Number(row?.data?.deskUpdatedAt) || 0
    const remoteApproved = Array.isArray(row?.data?.approved) ? (row!.data.approved as unknown[]).filter((x): x is string => typeof x === 'string') : []
    const have = new Set(st.approved)
    const newApprovals = remoteApproved.filter((e) => !have.has(e))
    const deskWins = !!row && remoteAt > Math.max(book.deskChangedAt, book.deskAt)
    if (newApprovals.length || deskWins) {
      const desk: Record<string, unknown> = {}
      if (deskWins) for (const k of DESK_KEYS) if (row!.data[k] !== undefined) desk[k] = row!.data[k]
      applying = true
      try {
        await st.cloudApply({ ...(newApprovals.length ? { approved: [...st.approved, ...newApprovals] } : {}), ...(deskWins ? { desk: desk as never } : {}) })
      } finally { applying = false }
      if (deskWins) book.deskAt = remoteAt
    }
    // push when this PC changed something since the row it last saw, or holds approvals the row lacks
    const now = useOutreachStore.getState()
    const remoteSet = new Set(remoteApproved)
    const missing = now.approved.some((e) => !remoteSet.has(e))
    // (no row yet: this PC's desk goes up with stamp 1, so any real change made elsewhere still wins)
    if (!row || book.deskChangedAt > Math.max(remoteAt, book.deskAt) || missing) {
      const stamp = Math.max(1, book.deskChangedAt, remoteAt)
      const data: Record<string, unknown> = { deskUpdatedAt: stamp, approved: [...new Set([...remoteApproved, ...now.approved])] }
      for (const k of DESK_KEYS) data[k] = (now as unknown as Record<string, unknown>)[k]
      await upsert('outreach_settings', [{ id: 'desk', data, updated_at: new Date().toISOString(), updated_by: userId ?? null }])
      book.deskAt = stamp
    }
  } catch (e) {
    if (e instanceof CloudError && e.kind === 'not-setup') { book.settingsMissingAt = Date.now(); return }
    throw e
  }
}

// ------------------------------------------------------------------ push
async function pushCampaigns(userId?: string) {
  const st = useOutreachStore.getState()
  for (const id of [...book.deleted]) {
    await rest(`outreach_campaigns?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', prefer: 'return=minimal' })
    await rest(`outreach_designs?campaign_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', prefer: 'return=minimal' })
    book.deleted = book.deleted.filter((x) => x !== id)
    delete book.synced[id]
  }
  const dirty = st.campaigns.filter((c) => (c.updatedAt ?? 0) > (book.synced[c.id] ?? -1))
  for (let i = 0; i < dirty.length; i += 20) {
    const part = dirty.slice(i, i + 20)
    const at = new Date().toISOString()
    await upsert('outreach_campaigns', part.map((c) => ({ id: c.id, data: c, updated_at: at, updated_by: userId ?? null })))
    // the server keeps the updated_at sent, so the next pull knows this version and does not download it back
    for (const c of part) { book.synced[c.id] = c.updatedAt ?? 0; book.seen[c.id] = at }
  }
  // the list and the designed letter each campaign uses, once
  for (const c of st.campaigns) {
    if (c.kind === 'list' && c.listId && !book.lists[c.listId]) {
      const rows = await idbGet<Sheet[]>(`list:${c.listId}`)
      const meta = st.lists.find((l) => l.id === c.listId)
      if (rows && meta) { await upsert('outreach_lists', [{ id: c.listId, file_name: meta.fileName, meta, rows, updated_at: new Date().toISOString(), updated_by: userId ?? null }]); book.lists[c.listId] = 1 }
    }
    if (c.design && book.designs[c.id] !== c.design.importedAt) {
      const d = await idbGet<DesignLetter>(`design:${c.id}`)
      if (d) { await upsert('outreach_designs', [{ campaign_id: c.id, data: d, updated_at: new Date().toISOString(), updated_by: userId ?? null }], 'campaign_id'); book.designs[c.id] = d.importedAt }
    }
  }
  saveBook()
}

async function pushSends() {
  const st = useOutreachStore.getState()
  const s = await loadSigs()
  const optOut = new Set(st.optOut)
  // each batch has the same columns in every row: PostgREST fills a column missing from one row with null, so rows
  // another PC wrote go up without pc / message_key (their writer's values stay)
  const own: { row: SendRow; sig: string }[] = []
  const foreign: { row: Omit<SendRow, 'pc' | 'message_key' | 'message_id'>; sig: string }[] = []
  const now = new Date().toISOString()
  // address-wide opt-outs first (a row per address, no campaign), then every campaign's per-address facts
  for (const r of addressRows(optOut, pcTag())) {
    const sig = rowSig(r)
    if (s[r.id] === sig) continue
    const { foreign: _f, ...rest } = { ...r, foreign: false }
    own.push({ row: { ...rest, updated_at: now } as SendRow, sig })
  }
  for (const c of st.campaigns) {
    for (const r of sendRowsFor(c, optOut, pcTag())) {
      const sig = rowSig(r)
      if (s[r.id] === sig) continue
      const { foreign: isForeign, pc, message_key, ...rest } = r
      if (isForeign) foreign.push({ row: { ...rest, updated_at: now }, sig })
      else own.push({ row: { ...rest, pc, message_key, updated_at: now }, sig })
    }
  }
  const tests = book.tests.map((r) => ({ row: { ...r, updated_at: now }, sig: rowSig(r) }))
  for (const rows of [own, foreign, tests]) {
    for (let i = 0; i < rows.length; i += 500) {
      const part = rows.slice(i, i + 500)
      await upsert('outreach_sends', part.map((x) => x.row))
      for (const x of part) s[x.row.id] = x.sig
      rt?.expectEcho()
    }
  }
  if (tests.length) { book.tests = []; saveBook() }
  useCloud.getState().set({ pending: 0 })
  void saveSigs()
}

// ------------------------------------------------------------------ the cycle
let running: Promise<void> | null = null
let again = false
let lastPull = 0
let rt: RealtimeHandle | null = null

/** One sync: pull (unless only pushing), then push. Never throws; the outcome is in useCloud. */
export function syncNow(opts: { pull?: boolean } = {}): Promise<void> {
  if (running) { again = true; return running }
  running = (async () => {
    const cloud = useCloud.getState()
    try {
      if (testRun()) { cloud.set({ state: 'test-run', error: null }); return }
      const t = await token()
      if (!t) { cloud.set({ state: 'signed-out', error: null }); return }
      cloud.set({ state: 'syncing' })
      if (opts.pull !== false) {
        await pullCampaigns()
        await pullSends()
        await pullAssets()
      }
      await pushCampaigns(t.userId)
      await pushSends()
      await syncSettings(t.userId)
      await syncDesk(t.userId)
      const active = useOutreachStore.getState().activeId
      if (active && opts.pull !== false) { await pullEvents(active); await readLock(active) }
      saveBook()
      if (opts.pull !== false) lastPull = Date.now()
      cloud.set({ state: 'ok', lastSync: Date.now(), error: null })
      void rt?.ensure()
    } catch (e) {
      const err = e instanceof CloudError ? e : new CloudError((e as Error)?.message || 'Sync failed', 'error')
      saveBook()
      cloud.set({ state: err.kind, error: err.message })
    } finally {
      running = null
      if (again) { again = false; void syncNow({ pull: false }) }
    }
  })()
  return running
}

// ------------------------------------------------------------------ the send lock
type LockRow = { campaign_id: string; pc: string; pc_label: string | null; heartbeat_at: string }
const toLock = (r: LockRow | null | undefined): LockInfo | null => {
  if (!r || !r.pc) return null
  const at = Date.parse(r.heartbeat_at)
  return { campaignId: r.campaign_id, pc: r.pc, label: r.pc_label || 'another PC', heartbeatAt: at, mine: r.pc === pcId, stale: Date.now() - at > STALE_SECONDS * 1000 }
}
const setLock = (id: string, l: LockInfo | null) => useCloud.getState().set({ locks: { ...useCloud.getState().locks, [id]: l } })

export async function readLock(campaignId: string): Promise<LockInfo | null> {
  const rows = await rest<LockRow[]>(`outreach_locks?campaign_id=eq.${encodeURIComponent(campaignId)}&select=campaign_id,pc,pc_label,heartbeat_at`)
  const l = toLock(rows?.[0])
  setLock(campaignId, l)
  return l
}

async function acquire(campaignId: string): Promise<LockInfo | null> {
  const r = await rest<LockRow | LockRow[] | null>('rpc/outreach_acquire_lock', { method: 'POST', body: JSON.stringify({ p_campaign: campaignId, p_pc: pcId, p_label: pcLabel(), p_stale_seconds: STALE_SECONDS }) })
  const row = Array.isArray(r) ? r[0] : r
  // the function returns the row as it stands: ours if we got it, the holder's if not (or nothing — then read it)
  const l = row ? toLock(row) : await readLock(campaignId)
  setLock(campaignId, l)
  return l
}

export async function releaseLock(campaignId: string) {
  try {
    await rest('rpc/outreach_release_lock', { method: 'POST', body: JSON.stringify({ p_campaign: campaignId, p_pc: pcId }) })
    setLock(campaignId, null)
  } catch { /* offline: it goes stale and can be taken over */ }
}

/**
 * Asked by startBatch/resumeBatch before anything is sent. Merges the campaign's shared sends into this PC (desk and
 * main-process ledger), then takes the send lock. Offline or without the cloud, sending goes ahead on local knowledge.
 */
export async function beforeSend(campaignId: string): Promise<{ ok: true; note?: string } | { ok: false; reason: string }> {
  if (testRun()) return { ok: true }
  const t = await token().catch(() => null)
  if (!t) return { ok: true, note: 'Not signed in — other PCs cannot see this run' }
  try {
    await applySends(await getAll<SendRow>(`outreach_sends?campaign_id=eq.${encodeURIComponent(campaignId)}&select=*&order=at.asc`))
    const held = await readLock(campaignId)
    if (held && !held.mine) {
      if (!held.stale) return { ok: false, reason: lockBlock(held)! }
      const take = await ask({
        title: `Take over from ${held.label}?`,
        body: `${held.label} started sending this campaign and was last seen ${fmtDateTime(held.heartbeatAt, { weekday: false })}. Take over only if that PC is closed or offline: its sends that have not reached the shared copy yet are not known here, and those people could be written to twice.`,
        ok: 'Take over', danger: true,
      })
      if (!take) return { ok: false, reason: `Not taken over — ${held.label} still holds this campaign` }
    }
    const l = await acquire(campaignId)
    if (l && !l.mine) return { ok: false, reason: lockBlock(l) ?? `Sending from ${l.label}` }
    useCloud.getState().set({ state: 'ok', lastSync: Date.now(), error: null })
    return { ok: true }
  } catch (e) {
    const err = e instanceof CloudError ? e : null
    if (err) useCloud.getState().set({ state: err.kind, error: err.message })
    if (err?.kind === 'not-setup') return { ok: true, note: 'Cloud not set up yet — sending from this PC only' }
    return { ok: true, note: 'Offline — could not check other PCs; sends they shared earlier are still never repeated' }
  }
}

/** Heartbeats for every campaign this PC is sending; a lock found taken by another PC pauses the job here. */
async function heartbeat() {
  if (testRun() || !(await token().catch(() => null))) return
  const jobs = useEngineStore.getState().jobs.filter((j) => ['queued', 'running', 'waiting'].includes(j.status))
  for (const j of jobs) {
    try {
      const l = await acquire(j.campaignId)
      if (l && !l.mine) {
        await engineClient.control(j.jobId, 'pause')
        useOutreachStore.getState().addLog('warn', `${j.name || 'Campaign'}: ${l.label} is sending it now — paused here`)
      }
    } catch { /* offline or not set up: the job carries on with local knowledge */ }
  }
}

/** A test letter's result, to go up with the next push. */
export function recordTest(campaignId: string, email: string, at: number, messageKey?: string | null) {
  book.tests.push({ id: testSendId(at, email), campaign_id: campaignId, email: email.toLowerCase(), kind: 'test', status: 'sent', detail: null, message_key: messageKey ?? null, at: new Date(at).toISOString(), pc: pcTag() })
  saveBook()
  schedulePush()
}

// ------------------------------------------------------------------ timers and listeners
let pushTimer: ReturnType<typeof setTimeout> | null = null
function schedulePush() {
  useCloud.getState().set({ pending: useCloud.getState().pending + 1 })
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => { pushTimer = null; void syncNow({ pull: false }) }, PUSH_DELAY)
}

let started = false
export function startCloudSync() {
  if (started || typeof window === 'undefined') return
  started = true
  void window.esb?.outreachStatus?.().then((s) => { if (s?.pcLabel) useCloud.getState().set({ pcLabel: s.pcLabel }) }).catch(() => null)
  const st = useOutreachStore
  // local changes go up a few seconds later; deletions are remembered until the cloud copy is gone too
  st.subscribe((s, prev) => {
    if (applying) return
    if (s.campaigns !== prev.campaigns) {
      const now = new Set(s.campaigns.map((c) => c.id))
      for (const c of prev.campaigns) if (!now.has(c.id) && book.synced[c.id] !== undefined && !book.deleted.includes(c.id)) { book.deleted.push(c.id); saveBook() }
      schedulePush()
    } else if (s.optOut !== prev.optOut || s.lists !== prev.lists) schedulePush()
    if (s.approved !== prev.approved || DESK_KEYS.some((k) => s[k] !== prev[k])) {
      if (DESK_KEYS.some((k) => s[k] !== prev[k])) { book.deskChangedAt = Date.now(); saveBook() }
      schedulePush()
    }
    if (s.activeId !== prev.activeId && s.activeId) {
      const id = s.activeId
      void (async () => {
        if (!(await token().catch(() => null))) return
        await pullAssets().catch(() => null)
        await readLock(id).catch(() => null)
        await pullEvents(id).catch(() => null)
      })()
    }
  })
  // a job that stopped or finished here gives its campaign back
  useEngineStore.subscribe((s, prev) => {
    for (const j of s.jobs) {
      const before = prev.jobs.find((p) => p.jobId === j.jobId)
      if ((j.status === 'done' || j.status === 'stopped') && before && before.status !== j.status) {
        if (useCloud.getState().locks[j.campaignId]?.mine) void releaseLock(j.campaignId)
        schedulePush()
      }
    }
  })
  window.addEventListener('esb-session', () => void syncNow())
  window.addEventListener('focus', () => void syncNow())
  window.addEventListener('online', () => void syncNow())
  // Realtime: another PC's send / open / lock / settings change pulls here at once (cloudRealtime.ts); it never
  // carries data itself, so the poll below stays the fallback
  rt = createRealtime({
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
    token: async () => (testRun() ? null : (await token().catch(() => null))?.token ?? null),
    onPoke: () => void syncNow(),
  })
  setInterval(() => { if (pollDue(Date.now())) void syncNow() }, 15_000)
  setInterval(() => void heartbeat(), HEARTBEAT_EVERY)
  setTimeout(() => void syncNow(), 3000)
}

/**
 * How often to pull: every 60 s while a batch is active here or the window is in front; every 5 min in the background
 * with nothing to send. With Realtime confirmed live (another PC's sends, opens, locks and settings arrive as pokes)
 * the front pace eases to 2 min: campaign edits are the only thing it does not poke.
 */
export function pollEvery(o: { visible: boolean; activeJob: boolean; live: boolean }): number {
  if (o.activeJob) return PULL_EVERY
  if (o.visible) return o.live ? 2 * PULL_EVERY : PULL_EVERY
  return PULL_IDLE
}
function pollDue(now: number): boolean {
  const visible = typeof document === 'undefined' || document.visibilityState === 'visible'
  const activeJob = useEngineStore.getState().jobs.some((j) => ['queued', 'running', 'waiting'].includes(j.status))
  return now - lastPull >= pollEvery({ visible, activeJob, live: !!rt?.live() }) - 1_000
}

/** For tests and the dev console only. */
export const __cloudInternals = { get book() { return book }, reset: () => { book = emptyBook(); saveBook(); sigs = {} } }
