// Outreach desk state. Like the Editorial story queue, the desk holds many CAMPAIGNS — each with its audience,
// letter, sources, schedule and per-address results — and one is open at a time. What the editor decided about an
// ADDRESS (approved, asked not to be emailed) holds across every campaign.
//
// Where things live: campaigns, signatures, templates and the house prompt in localStorage
// (`esb-banner-studio/outreach/v2`); imported workbooks and attachments in IndexedDB (idb.ts), being too big for it.
// The main process keeps its own ledger of sends, which is what stops a repeat; `campaign.sent` is what the list shows.

import { designBytes, type DesignLetter } from './design'
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { EsbInboxResult, EsbOutreachStatus } from '../esb'
import type { AttachmentItem, Campaign, Contact, ListMeta, OutreachBlueprintId, OutreachLang, Signature, Source, Template } from './types'
import { OUTREACH_BLUEPRINTS } from './outreachAi'
import { contactsFromRows, groupNamesOf, readMailingFile } from './directory'
import type { Sheet } from './directory'
import { domainOf, type DomainCheckResult } from './addressCheck'
import { idbDel, idbGet, idbSet } from './idb'
import { mailFailKind, mailRetryDelay, type MailFailKind } from './mailCheck'

// the mail check's own retry while the server is unreachable (one timer for the whole desk)
let smtpRetry: ReturnType<typeof setTimeout> | null = null
let smtpRetryStep = 0

const KEY = 'esb-banner-studio/outreach/v2'
const V1 = 'esb-banner-studio/outreach/v1'
// the first build kept the SMTP settings, app password included, in plain text under this key; the password now
// lives encrypted in the main process, so the old copy is deleted the first time the desk loads
const LEGACY_CONFIG = 'esb-banner-studio/outreach-config'

export const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

/** The desk's own preferences every PC should share (cloud sync, outreach_settings row 'desk'): signatures, saved
 *  templates, the house prompt and the letterhead look. */
export const DESK_KEYS = ['signatures', 'templates', 'housePrompt', 'footerLine', 'headerBg', 'footerBg', 'stripeColors', 'fontFamily'] as const
export type DeskKey = (typeof DESK_KEYS)[number]

interface Saved {
  campaigns: Campaign[]
  activeId: string | null
  lists: ListMeta[]
  approved: string[]
  optOut: string[]
  signatures: Signature[]
  templates: Template[]
  /** The editor's house style for every AI job on this desk; '' = none. */
  housePrompt: string
  /** The letterhead footer's own line — same marks as the letter body ([text](https://link), **bold**). Editable
   *  because it was hardcoded once and had to be asked to be changed each time; now it is the editor's own text. */
  footerLine: string
  /** The plain letterhead header's background — a #rrggbb colour, or '' for white. Ignored for the official pad. */
  headerBg: string
  /** The plain letterhead footer's own background — a #rrggbb colour, or '' for white. The footer's text switches
   *  to black or white on its own so a dark pick never leaves it unreadable. Ignored for the official pad. */
  footerBg: string
  /** The three bars above the header and below the footer — "#rrggbb,#rrggbb,#rrggbb", or '' for ESB's own green,
   *  red, orange. A bar left blank keeps its default colour rather than going blank. */
  stripeColors: string
  /** An id into EMAIL_FONTS (emailRender.ts) — a fixed list of fonts that render as themselves across mail clients,
   *  not "whatever is installed on this PC", which has no effect on what a recipient's own client renders. */
  fontFamily: string
  /** Addresses the mail system returned (address → its reason), from any campaign: no later campaign writes to them. */
  bouncedAddrs: Record<string, string>
}

export const DEFAULT_SIGNATURE: Signature = { id: 'sig-default', name: 'Outreach desk', text: 'With best regards,\n\nOutreach Desk\nESB Power Line — Express Broadcast and Communication Ltd.\nDhaka, Bangladesh · https://esbpowerline.com' }
export const DEFAULT_FOOTER_LINE = 'ESB Power Line · [esbpowerline.com](https://esbpowerline.com)'
export const DEFAULT_FONT_FAMILY = 'sans'

const template = (id: OutreachBlueprintId, lang: OutreachLang) => {
  const b = OUTREACH_BLUEPRINTS.find((x) => x.id === id) ?? OUTREACH_BLUEPRINTS[0]
  return lang === 'bn' ? { subject: b.bengaliSubject, body: b.bengaliBody } : { subject: b.defaultSubject, body: b.defaultBody }
}

export function newCampaign(over: Partial<Campaign> = {}): Campaign {
  const now = Date.now()
  const bp = OUTREACH_BLUEPRINTS[0].id
  return {
    id: uid('cmp'), name: 'Untitled campaign', createdAt: now, updatedAt: now, status: 'draft', kind: 'list',
    listId: null, sheet: '', audience: { group: null, purposes: [] }, recipients: [],
    blueprint: bp, lang: 'en', ...template(bp, 'en'), signatureId: DEFAULT_SIGNATURE.id, letterhead: true,
    sources: [], scheduledAt: null, sent: {}, failed: {},
    replied: {}, bounced: {}, followUp: { afterDays: 5, subject: '', body: '' }, followed: {}, interrupted: null,
    ...over,
  }
}

/**
 * A saved campaign with the fields later versions added, and a batch that was running when the app closed marked as
 * interrupted (paused) — it is continued by the editor, never restarted on its own at launch.
 */
export function normalize(c: Campaign): Campaign {
  const d = newCampaign()
  const running = c.status === 'sending'
  return { ...d, ...c, followUp: { ...d.followUp, ...(c.followUp ?? {}) }, status: running ? 'paused' : c.status, interrupted: running ? c.interrupted ?? 'first' : null }
}

function load(): Saved {
  try { localStorage.removeItem(LEGACY_CONFIG) } catch { /* storage blocked */ }
  const base: Saved = { campaigns: [], activeId: null, lists: [], approved: [], optOut: [], signatures: [DEFAULT_SIGNATURE], templates: [], housePrompt: '', footerLine: DEFAULT_FOOTER_LINE, headerBg: '', footerBg: '', stripeColors: '', fontFamily: DEFAULT_FONT_FAMILY, bouncedAddrs: {} }
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null') as Partial<Saved> | null
    if (s) return { ...base, ...s, campaigns: (s.campaigns ?? []).map(normalize), signatures: s.signatures?.length ? s.signatures : base.signatures }
    // the first desk kept one draft and per-address marks: carry them into a first campaign
    const v1 = JSON.parse(localStorage.getItem(V1) || 'null') as { approved?: string[]; optOut?: string[]; sent?: Record<string, number>; draft?: { blueprint: OutreachBlueprintId; lang: OutreachLang; subject: string; body: string } } | null
    if (v1) {
      const c = newCampaign({ name: 'First campaign', ...(v1.draft ?? {}), sent: v1.sent ?? {} })
      return { ...base, campaigns: [c], activeId: c.id, approved: v1.approved ?? [], optOut: v1.optOut ?? [] }
    }
  } catch { /* edited by hand or blocked: start clean */ }
  return base
}
function save(s: Saved) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* full: the main process's ledger still prevents repeats */ }
}

export interface InboxUpdateData {
  ok?: boolean
  at?: number
  scanned?: number
  note?: string
  error?: string
  replies?: Array<{ email: string; at: number; auto?: boolean; unsubscribe?: boolean }>
  bounces?: Array<{ email: string; at: number; reason: string }>
}

export function applyInboxResultToCampaigns(
  campaigns: Campaign[],
  currentOptOut: string[],
  currentBounced: Record<string, string>,
  r: InboxUpdateData
): {
  campaigns: Campaign[]
  optOut: string[]
  bouncedAddrs: Record<string, string>
  news: Array<{ level: 'ok' | 'warn'; text: string }>
} {
  const optOut = new Set(currentOptOut)
  const bouncedAddrs = { ...currentBounced }
  const news: Array<{ level: 'ok' | 'warn'; text: string }> = []
  const nextCampaigns = campaigns.map((c) => {
    const replied = { ...c.replied }
    const bounced = { ...c.bounced }
    for (const x of r.replies ?? []) {
      const sentAt = Math.min(c.sent[x.email] ?? Infinity, c.followed[x.email] ?? Infinity)
      if (x.auto || !(x.at >= sentAt - 60_000) || replied[x.email]) continue
      replied[x.email] = x.at
      news.push({ level: 'ok', text: `${x.email} replied${x.unsubscribe ? ' and asked not to be emailed' : ''} — ${c.name}` })
    }
    for (const x of r.bounces ?? []) {
      if (c.sent[x.email] && !bounced[x.email]) {
        bounced[x.email] = x.reason
        news.push({ level: 'warn', text: `${x.email} bounced: ${x.reason} — ${c.name}` })
      }
    }
    return Object.keys(replied).length !== Object.keys(c.replied).length ||
      Object.keys(bounced).length !== Object.keys(c.bounced).length
      ? { ...c, replied, bounced }
      : c
  })
  for (const x of r.replies ?? []) if (x.unsubscribe) optOut.add(x.email)
  for (const x of r.bounces ?? []) bouncedAddrs[x.email] ??= x.reason
  return { campaigns: nextCampaigns, optOut: [...optOut], bouncedAddrs, news }
}

export type RunState = 'idle' | 'running' | 'paused'
export interface LogEntry { t: number; level: 'info' | 'ok' | 'warn' | 'error'; text: string }
export type InboxCheck = { state: 'idle' } | { state: 'busy'; at?: number } | { state: 'ok'; at: number; scanned: number; note?: string } | { state: 'bad'; at: number; error: string }
/** The last SMTP check. `bad` carries WHY (mailCheck.ts): only `auth` means the app password is wrong; `network` is
 *  retried by itself (`retryAt`) and shown as a warning, not a failure. */
export type SmtpCheck = { state: 'idle' } | { state: 'busy' } | { state: 'ok'; ms: number; at: number } | { state: 'bad'; kind: MailFailKind; error: string; at: number; retryAt?: number }

interface OutreachState extends Saved {
  /** The open campaign's list, read from IndexedDB. */
  sheets: Sheet[]
  groupNames: Map<number, string>
  contacts: Contact[]
  importNote: string | null
  activeContact: string | null
  view: 'all' | 'ready' | 'skipped' | 'sent' | 'opened' | 'replied' | 'failed' | 'has_server' | 'no_server' | 'role' | 'disposable'
  verifiedAddrs: Record<string, DomainCheckResult>
  checkingAddresses: { total: number; checked: number; active: boolean } | null
  lastBulkApproval: { previous: string[]; added: string[] } | null
  approveMany: (emails: string[]) => void
  undoApproveMany: () => void
  checkAddresses: () => Promise<void>
  cancelCheckAddresses: () => void
  query: string
  attachments: AttachmentItem[]
  /** The open campaign's designed HTML letter (design.ts), read from IndexedDB `design:{id}`; null when it uses marks. */
  design: DesignLetter | null

  run: RunState
  nextAt: number | null
  current: string | null
  runSent: number
  runTotal: number

  mail: EsbOutreachStatus | null
  smtp: SmtpCheck
  inbox: InboxCheck
  log: LogEntry[]

  campaign: () => Campaign | null
  openCampaign: (id: string) => Promise<void>
  createCampaign: (over?: Partial<Campaign>) => Promise<string>
  duplicateCampaign: (id: string) => Promise<void>
  deleteCampaign: (id: string) => Promise<void>
  patch: (p: Partial<Campaign>) => void
  patchById: (id: string, p: Partial<Campaign>) => void
  importList: (file: File) => Promise<void>
  useList: (listId: string) => Promise<void>
  setSheet: (name: string) => void
  setRecipients: (addresses: string[]) => void
  setAudience: (a: Partial<Campaign['audience']>) => void
  setActiveContact: (email: string | null) => void
  setView: (v: OutreachState['view']) => void
  setQuery: (q: string) => void
  approve: (email: string, on: boolean) => void
  optOutAddress: (email: string, on: boolean) => void
  markSent: (email: string, t: number) => void
  markFailed: (email: string, error: string) => void
  markSending: (email: string | null) => void
  markFollowed: (email: string, t: number) => void
  applyInboxResult: (r: EsbInboxResult | InboxUpdateData) => void
  checkInbox: (force?: boolean) => Promise<void>
  selectBlueprint: (id: OutreachBlueprintId) => void
  setLang: (lang: OutreachLang) => void
  addAttachment: (a: AttachmentItem) => void
  removeAttachment: (id: string) => void
  /** Use a designed HTML letter: the page goes to IndexedDB, `body` becomes its plain-text version. */
  setDesign: (d: DesignLetter, text: string) => Promise<void>
  /** Back to an ordinary letter; the plain-text version stays as the body to edit. */
  clearDesign: () => Promise<void>
  addSource: (s: Source) => void
  updateSource: (id: string, p: Partial<Source>) => void
  removeSource: (id: string) => void
  saveSignature: (s: Signature) => void
  deleteSignature: (id: string) => void
  saveTemplate: (name: string) => void
  applyTemplate: (id: string) => void
  deleteTemplate: (id: string) => void
  setHousePrompt: (p: string) => void
  setFooterLine: (line: string) => void
  setHeaderBg: (hex: string) => void
  setFooterBg: (hex: string) => void
  setStripeColors: (csv: string) => void
  setFontFamily: (id: string) => void
  setRun: (r: RunState, extra?: Partial<Pick<OutreachState, 'nextAt' | 'runSent' | 'runTotal'>>) => void
  setNextAt: (t: number | null) => void
  refreshMail: () => Promise<void>
  checkSmtp: (force?: boolean) => Promise<void>
  addLog: (level: LogEntry['level'], text: string) => void
  /** cloudSync.ts only: lay the shared copy over this PC's — merged campaigns, lists that arrived, addresses that
   *  opted out or bounced elsewhere — save, and re-read the open campaign's list or design if they just arrived. */
  cloudApply: (p: { campaigns?: Campaign[]; lists?: ListMeta[]; optOut?: string[]; bouncedAddrs?: Record<string, string>; approved?: string[]; desk?: Partial<Pick<Saved, DeskKey>>; reload?: { contacts?: boolean; design?: boolean } }) => Promise<void>
}

/** The sheet's contacts with what the editor and the ledgers know laid over them. A contact whose overlay did not
 *  change keeps its object, and the array itself is kept when nothing changed, so memoised rows and eligible()'s cache
 *  survive a relay (a log line, an inbox check, an approval elsewhere) instead of re-rendering 2,000 rows. */
export function overlay(list: Contact[], s: Pick<Saved, 'approved' | 'optOut'> & { bouncedAddrs?: Record<string, string>; verified?: Record<string, DomainCheckResult> }, c: Campaign | null, mail: EsbOutreachStatus | null): Contact[] {
  const approved = new Set(s.approved), optOut = new Set(s.optOut), bounced = s.bouncedAddrs ?? {}
  const ledger = new Map((mail?.sentTo ?? []).map((e) => [e.to, e.t]))
  let changed = false
  const out = list.map((x) => {
    const sentAt = c?.sent[x.email] ?? ledger.get(x.email)
    const failed = c?.failed[x.email]
    const bounce = c?.bounced?.[x.email] ?? bounced[x.email]
    const replied = c?.replied?.[x.email]
    const dom = domainOf(x.email)
    const ver = s.verified?.[dom]
    const noServer = ver && !ver.mx && !ver.a
    const mxStatus = noServer ? 'UNDELIVERABLE' : x.mxStatus
    const rawStatus = noServer ? 'No mail server (checked)' : x.rawStatus
    const isApproved = x.approved || approved.has(x.email)
    const status: Contact['status'] = optOut.has(x.email) ? 'OPTED_OUT' : bounce ? 'BOUNCED' : replied ? 'REPLIED' : sentAt ? 'SENT' : failed ? 'FAILED' : x.status === 'SENDING' ? 'SENDING' : 'QUEUED'
    const error = bounce ?? failed
    if (x.mxStatus === mxStatus && x.rawStatus === rawStatus && x.approved === isApproved && x.status === status && x.sentAt === sentAt && x.repliedAt === replied && x.error === error) return x
    changed = true
    return { ...x, mxStatus, rawStatus, approved: isApproved, status, sentAt, repliedAt: replied, error }
  })
  return changed ? out : list
}
/** Typed addresses for an ordinary email: each one is the editor's own choice, so it counts as approved. */
export function directContacts(addresses: string[]): Contact[] {
  return addresses.map((email, i) => ({
    id: email, serial: i + 1, sectorGroup: '', groupNo: null, organization: '', personName: '', designation: '', email, phone: '',
    purposes: [], mxStatus: 'SAFE_TO_SEND', rawStatus: 'Typed by you', diagnostic: '', sheet: '', approved: true, status: 'QUEUED',
  }))
}

export const useOutreachStore = create<OutreachState>((set, get) => {
  const saved = load()
  const persist = () => {
    const s = get()
    save({ campaigns: s.campaigns, activeId: s.activeId, lists: s.lists, approved: s.approved, optOut: s.optOut, signatures: s.signatures, templates: s.templates, housePrompt: s.housePrompt, footerLine: s.footerLine, headerBg: s.headerBg, footerBg: s.footerBg, stripeColors: s.stripeColors, fontFamily: s.fontFamily, bouncedAddrs: s.bouncedAddrs })
  }
  const relay = () => set({ contacts: overlay(get().contacts, { ...get(), verified: get().verifiedAddrs }, get().campaign(), get().mail) })
  const patchCampaign = (id: string, p: Partial<Campaign>) => {
    set({ campaigns: get().campaigns.map((c) => (c.id === id ? { ...c, ...p, updatedAt: Date.now() } : c)) })
    persist()
  }
  /** Read the open campaign's contacts from its list and sheet (or its typed addresses). */
  // each load is numbered: opening A then B while A's list is still being read must not leave A's contacts on B (the
  // send queue reads `contacts`)
  let contactsSeq = 0
  const listCache = new Map<string, Sheet[]>()
  const parsedCache = new Map<string, ReturnType<typeof contactsFromRows>>()
  const loadContacts = async () => {
    const seq = ++contactsSeq
    const c = get().campaign()
    if (!c) return set({ sheets: [], contacts: [], groupNames: new Map(), importNote: null })
    if (c.kind === 'direct') return set({ sheets: [], groupNames: new Map(), importNote: null, contacts: overlay(directContacts(c.recipients), get(), c, get().mail) })
    // a list's rows never change under its id (a new import is a new id), so the read and the parse are kept for the
    // session: switching between two campaigns on a 2,000-row list re-read IndexedDB and re-parsed every row each time
    const sheets = c.listId ? (listCache.get(c.listId) ?? (await idbGet<Sheet[]>(`list:${c.listId}`)) ?? []) : []
    if (c.listId && sheets.length) listCache.set(c.listId, sheets)
    const verifiedAddrs = c.listId ? (await idbGet<Record<string, DomainCheckResult>>(`verify:${c.listId}`)) ?? {} : {}
    if (seq !== contactsSeq || get().activeId !== c.id) return
    set({ verifiedAddrs })
    const groupNames = groupNamesOf(sheets)
    const sh = sheets.find((x) => x.name === c.sheet) ?? sheets.find((x) => x.rows.slice(0, 15).some((r) => r.some((v) => /^e-?mail(\s+address)?$/i.test(v))))
    if (!sh) return set({ sheets, groupNames, contacts: [], importNote: c.listId ? 'The list for this campaign is not on this computer any more — import it again.' : null })
    try {
      const parseKey = `${c.listId}|${sh.name}`
      const r = parsedCache.get(parseKey) ?? contactsFromRows(sh.rows, new Map(groupNames), sh.name)
      parsedCache.set(parseKey, r)
      const note = [r.skipped ? `${r.skipped} row${r.skipped === 1 ? '' : 's'} without a valid address skipped` : '', r.duplicates ? `${r.duplicates} repeated address${r.duplicates === 1 ? '' : 'es'} left out` : ''].filter(Boolean).join(' · ')
      if (sh.name !== c.sheet) patchCampaign(c.id, { sheet: sh.name })
      set({ sheets, groupNames, contacts: overlay(r.contacts, get(), get().campaign(), get().mail), importNote: note || null })
    } catch (e) {
      set({ sheets, groupNames, contacts: [], importNote: (e as Error).message })
    }
  }
  const loadAttachments = async () => {
    const c = get().campaign()
    const files = c ? (await idbGet<AttachmentItem[]>(`files:${c.id}`)) ?? [] : []
    if ((get().activeId ?? null) !== (c?.id ?? null)) return // another campaign was opened meanwhile
    set({ attachments: files })
  }
  const loadDesign = async () => {
    const c = get().campaign()
    const d = c?.design ? (await idbGet<DesignLetter>(`design:${c.id}`)) ?? null : null
    if ((get().activeId ?? null) !== (c?.id ?? null)) return
    set({ design: d })
  }

  // open the last campaign once the store exists
  queueMicrotask(() => { if (get().activeId) void get().openCampaign(get().activeId!) })

  return {
    ...saved,
    sheets: [],
    groupNames: new Map(),
    contacts: [],
    importNote: null,
    activeContact: null,
    view: 'all',
    query: '',
    attachments: [],
    design: null,
    run: 'idle',
    nextAt: null,
    current: null,
    runSent: 0,
    runTotal: 0,
    mail: null,
    smtp: { state: 'idle' },
    inbox: { state: 'idle' },
    log: [],
    verifiedAddrs: {},
    checkingAddresses: null,
    lastBulkApproval: null,

    approveMany: (emails: string[]) => {
      const currentApproved = get().approved
      const setApproved = new Set(currentApproved)
      const toAdd = emails.filter((e) => !setApproved.has(e))
      if (!toAdd.length) return
      for (const e of toAdd) setApproved.add(e)
      set({ approved: [...setApproved], lastBulkApproval: { previous: currentApproved, added: toAdd } })
      persist()
      relay()
      get().addLog('ok', `Approved ${toAdd.length} address${toAdd.length === 1 ? '' : 'es'} that pass checks`)
    },
    undoApproveMany: () => {
      const last = get().lastBulkApproval
      if (!last) return
      set({ approved: last.previous, lastBulkApproval: null })
      persist()
      relay()
      get().addLog('info', `Undid approval of ${last.added.length} address${last.added.length === 1 ? '' : 'es'}`)
    },
    checkAddresses: async () => {
      const c = get().campaign()
      if (!c?.listId) return
      const contacts = get().contacts
      const domains = [...new Set(contacts.map((x) => domainOf(x.email)).filter(Boolean))]
      if (!domains.length) return
      set({ checkingAddresses: { total: domains.length, checked: 0, active: true } })
      try {
        const b = window.esb
        let results: Record<string, DomainCheckResult> = {}
        if (b?.outreachCheckAddresses) {
          results = await b.outreachCheckAddresses(domains)
        } else {
          for (const d of domains) results[d] = { mx: !d.includes('dead') && !d.includes('nomail'), a: true }
        }
        const next = { ...get().verifiedAddrs, ...results }
        set({ verifiedAddrs: next, checkingAddresses: null })
        await idbSet(`verify:${c.listId}`, next)
        relay()
        get().addLog('ok', `Checked addresses for ${domains.length} companies`)
      } catch (err) {
        set({ checkingAddresses: null })
        get().addLog('error', `Address check: ${(err as Error).message}`)
      }
    },
    cancelCheckAddresses: () => set({ checkingAddresses: null }),

    campaign: () => get().campaigns.find((c) => c.id === get().activeId) ?? null,

    openCampaign: async (id) => {
      if (get().run !== 'idle' && id !== get().activeId) { get().addLog('warn', 'Stop the batch before opening another campaign'); return }
      if (!get().campaigns.some((c) => c.id === id)) return
      set({ activeId: id, activeContact: null, view: 'all', query: '' })
      persist()
      await Promise.all([loadContacts(), loadAttachments(), loadDesign()])
      set({ activeContact: get().contacts[0]?.id ?? null })
    },
    createCampaign: async (over = {}) => {
      // a new campaign starts on the list the editor was using, if any
      const cur = get().campaign()
      const c = newCampaign({ listId: cur?.kind === 'list' ? cur.listId : null, sheet: cur?.kind === 'list' ? cur.sheet : '', ...over })
      set({ campaigns: [c, ...get().campaigns] })
      persist()
      await get().openCampaign(c.id)
      return c.id
    },
    duplicateCampaign: async (id) => {
      const src = get().campaigns.find((c) => c.id === id)
      if (!src) return
      const c = newCampaign({ ...src, id: uid('cmp'), name: `${src.name} (copy)`, status: 'draft', scheduledAt: null, sent: {}, failed: {}, replied: {}, bounced: {}, followed: {}, interrupted: null, createdAt: Date.now() })
      const files = await idbGet<AttachmentItem[]>(`files:${id}`)
      if (files) await idbSet(`files:${c.id}`, files)
      const design = await idbGet<DesignLetter>(`design:${id}`)
      if (design) await idbSet(`design:${c.id}`, design)
      set({ campaigns: [c, ...get().campaigns] })
      persist()
      await get().openCampaign(c.id)
    },
    deleteCampaign: async (id) => {
      if (get().run !== 'idle' && id === get().activeId) return
      await idbDel(`files:${id}`)
      await idbDel(`design:${id}`)
      const campaigns = get().campaigns.filter((c) => c.id !== id)
      set({ campaigns })
      if (get().activeId === id) {
        set({ activeId: campaigns[0]?.id ?? null })
        persist()
        if (campaigns[0]) await get().openCampaign(campaigns[0].id); else set({ contacts: [], sheets: [], attachments: [], design: null })
      } else persist()
    },
    patch: (p) => { const c = get().campaign(); if (c) patchCampaign(c.id, p) },
    patchById: (id, p) => patchCampaign(id, p),

    importList: async (file) => {
      if (get().run !== 'idle') { get().addLog('warn', 'Stop the batch before loading another list'); return }
      try {
        const sheets = await readMailingFile(file)
        if (!sheets.length) throw new Error('The file has no sheets')
        const groupNames = groupNamesOf(sheets)
        const counts = sheets.map((sh) => { try { return { name: sh.name, contacts: contactsFromRows(sh.rows, new Map(groupNames), sh.name).contacts.length } } catch { return { name: sh.name, contacts: 0 } } })
        const meta: ListMeta = { id: uid('list'), fileName: file.name, addedAt: Date.now(), sheets: counts }
        await idbSet(`list:${meta.id}`, sheets)
        // the sheet the editor's own workbook calls safe, else the first one that has contacts
        const pick = counts.find((x) => x.name === 'Strategic_Verified_Safe' && x.contacts) ?? counts.find((x) => x.contacts)
        const replaced = get().lists.filter((l) => l.fileName === file.name)
        for (const l of replaced) if (!get().campaigns.some((c) => c.listId === l.id)) void idbDel(`list:${l.id}`)
        set({ lists: [meta, ...get().lists.filter((l) => l.fileName !== file.name || get().campaigns.some((c) => c.listId === l.id))] })
        if (!get().campaign()) await get().createCampaign({ name: file.name.replace(/\.(xlsx|csv)$/i, '').replace(/[_-]+/g, ' ') })
        get().patch({ kind: 'list', listId: meta.id, sheet: pick?.name ?? '', audience: { group: null, purposes: [] } })
        await loadContacts()
        set({ activeContact: get().contacts[0]?.id ?? null })
        get().addLog('info', `${file.name}: ${counts.filter((x) => x.contacts).map((x) => `${x.name.replace(/_/g, ' ')} ${x.contacts}`).join(' · ')}`)
      } catch (e) {
        set({ importNote: (e as Error).message })
        get().addLog('error', `Could not read ${file.name}: ${(e as Error).message}`)
      }
    },
    useList: async (listId) => {
      if (get().run !== 'idle') return
      const meta = get().lists.find((l) => l.id === listId)
      get().patch({ kind: 'list', listId, sheet: meta?.sheets.find((x) => x.contacts)?.name ?? '', audience: { group: null, purposes: [] } })
      await loadContacts()
    },
    setSheet: (name) => { if (get().run === 'idle') { get().patch({ sheet: name, audience: { group: null, purposes: [] } }); void loadContacts() } },
    setRecipients: (addresses) => {
      const c = get().campaign(); if (!c || c.kind !== 'direct' || get().run !== 'idle') return
      const recipients = [...new Set(addresses.map((a) => a.trim().toLowerCase()).filter(Boolean))].slice(0, 200)
      get().patch({ recipients })
      void loadContacts().then(() => { if (!get().contacts.some((x) => x.id === get().activeContact)) set({ activeContact: get().contacts[0]?.id ?? null }) })
    },
    setAudience: (a) => { const c = get().campaign(); if (c && get().run === 'idle') get().patch({ audience: { ...c.audience, ...a } }) },
    setActiveContact: (activeContact) => set({ activeContact }),
    setView: (view) => set({ view }),
    setQuery: (query) => set({ query }),
    approve: (email, on) => {
      const a = new Set(get().approved)
      if (on) a.add(email); else a.delete(email)
      set({ approved: [...a], contacts: get().contacts.map((c) => (c.email === email && c.rawStatus !== 'Typed by you' ? { ...c, approved: on } : c)) }); persist(); relay()
    },
    optOutAddress: (email, on) => {
      const o = new Set(get().optOut)
      if (on) o.add(email); else o.delete(email)
      set({ optOut: [...o] }); persist(); relay()
      get().addLog('info', on ? `${email} will not be emailed again` : `${email} can be emailed again`)
    },
    markSent: (email, t) => {
      const c = get().campaign(); if (!c) return
      const failed = { ...c.failed }; delete failed[email]
      patchCampaign(c.id, { sent: { ...c.sent, [email]: t }, failed })
      relay()
    },
    markFailed: (email, error) => {
      const c = get().campaign(); if (!c) return
      patchCampaign(c.id, { failed: { ...c.failed, [email]: error } })
      relay()
    },
    markFollowed: (email, t) => {
      const c = get().campaign(); if (!c) return
      patchCampaign(c.id, { followed: { ...c.followed, [email]: t } })
    },
    applyInboxResult: (r) => {
      const { campaigns, optOut, bouncedAddrs, news } = applyInboxResultToCampaigns(
        get().campaigns,
        get().optOut,
        get().bouncedAddrs,
        r
      )
      const isOk = !('ok' in r) || r.ok
      set({
        campaigns,
        optOut,
        bouncedAddrs,
        ...(isOk && 'at' in r && typeof r.at === 'number'
          ? { inbox: { state: 'ok', at: r.at, scanned: ('scanned' in r ? r.scanned : undefined) ?? 0, note: 'note' in r ? r.note : undefined } }
          : {})
      })
      persist(); relay()
      for (const n of news) get().addLog(/bounced/.test(n.text) ? 'warn' : 'ok', n.text)
    },
    checkInbox: async (force = false) => {
      const b = window.esb
      if (!b?.outreachInbox || get().inbox.state === 'busy') return
      set({ inbox: { state: 'busy', at: get().inbox.state === 'ok' ? (get().inbox as { at: number }).at : undefined } })
      const r = await b.outreachInbox(force).catch((e: Error) => ({ ok: false, at: Date.now(), error: e.message }) as EsbInboxResult)
      if (!r.ok) { set({ inbox: { state: 'bad', at: r.at, error: r.error ?? 'The inbox did not answer' } }); return }
      get().applyInboxResult(r)
    },
    markSending: (email) => set({ current: email, contacts: get().contacts.map((c) => (c.email === email ? { ...c, status: 'SENDING' } : c.status === 'SENDING' ? { ...c, status: 'QUEUED' } : c)) }),

    selectBlueprint: (id) => { const c = get().campaign(); if (c) get().patch({ blueprint: id, ...template(id, c.lang) }) },
    setLang: (lang) => {
      const c = get().campaign(); if (!c) return
      // a blueprint switches to its other-language letter; the editor's own text is kept and only the language changes
      get().patch(c.blueprint !== 'template' && c.blueprint !== 'blank' ? { lang, ...template(c.blueprint, lang) } : { lang })
    },
    addAttachment: (a) => {
      const c = get().campaign(); if (!c || get().attachments.some((x) => x.name === a.name)) return
      const next = [...get().attachments, a]
      set({ attachments: next }); void idbSet(`files:${c.id}`, next)
    },
    removeAttachment: (id) => {
      const c = get().campaign(); if (!c) return
      const next = get().attachments.filter((a) => a.id !== id)
      set({ attachments: next }); void idbSet(`files:${c.id}`, next)
    },
    setDesign: async (d, text) => {
      const c = get().campaign(); if (!c) return
      await idbSet(`design:${c.id}`, d)
      if (get().activeId !== c.id) return
      set({ design: d })
      get().patch({ design: { name: d.name, importedAt: d.importedAt, images: d.images.length, bytes: designBytes(d) }, body: text })
    },
    clearDesign: async () => {
      const c = get().campaign(); if (!c) return
      await idbDel(`design:${c.id}`)
      set({ design: null })
      get().patch({ design: undefined })
    },
    addSource: (src) => { const c = get().campaign(); if (c) get().patch({ sources: [src, ...c.sources] }) },
    updateSource: (id, p) => { const c = get().campaign(); if (c) get().patch({ sources: c.sources.map((x) => (x.id === id ? { ...x, ...p } : x)) }) },
    removeSource: (id) => { const c = get().campaign(); if (c) get().patch({ sources: c.sources.filter((x) => x.id !== id) }) },
    saveSignature: (sig) => { set({ signatures: get().signatures.some((x) => x.id === sig.id) ? get().signatures.map((x) => (x.id === sig.id ? sig : x)) : [...get().signatures, sig] }); persist() },
    deleteSignature: (id) => { if (get().signatures.length > 1) { set({ signatures: get().signatures.filter((x) => x.id !== id) }); persist() } },
    saveTemplate: (name) => {
      const c = get().campaign(); if (!c) return
      set({ templates: [{ id: uid('tpl'), name: name.trim() || c.subject.slice(0, 40), lang: c.lang, subject: c.subject, body: c.body, savedAt: Date.now() }, ...get().templates] })
      persist()
    },
    applyTemplate: (id) => { const t = get().templates.find((x) => x.id === id); if (t) get().patch({ blueprint: 'template', lang: t.lang, subject: t.subject, body: t.body }) },
    deleteTemplate: (id) => { set({ templates: get().templates.filter((x) => x.id !== id) }); persist() },
    setHousePrompt: (housePrompt) => { set({ housePrompt }); persist() },
    setFooterLine: (line) => { set({ footerLine: line.trim() }); persist() },
    setHeaderBg: (hex) => { set({ headerBg: hex }); persist() },
    setFooterBg: (hex) => { set({ footerBg: hex }); persist() },
    setStripeColors: (csv) => { set({ stripeColors: csv }); persist() },
    setFontFamily: (id) => { set({ fontFamily: id }); persist() },

    setRun: (run, extra = {}) => set({ run, ...extra, ...(run === 'idle' ? { nextAt: null, current: null } : {}) }),
    setNextAt: (nextAt) => set({ nextAt }),
    refreshMail: async () => {
      const b = window.esb
      if (!b?.outreachStatus) return
      try { set({ mail: await b.outreachStatus() }); relay() } catch { /* an older build without the bridge */ }
    },
    checkSmtp: async (force = false) => {
      const b = window.esb
      if (!b?.outreachVerify) return
      const prev = get().smtp
      // while the server is unreachable the pill keeps saying so during a retry instead of flickering to "Checking"
      if (!(prev.state === 'bad' && prev.kind === 'network')) set({ smtp: { state: 'busy' } })
      const r = await b.outreachVerify(force).catch((e: Error) => ({ ok: false, kind: 'other', error: e.message, at: Date.now() }) as Awaited<ReturnType<NonNullable<typeof b.outreachVerify>>>)
      if (smtpRetry) { clearTimeout(smtpRetry); smtpRetry = null }
      if (r.ok) { smtpRetryStep = 0; set({ smtp: { state: 'ok', ms: r.ms ?? 0, at: r.at } }); return }
      const kind = mailFailKind(r.kind)
      let retryAt: number | undefined
      if (kind === 'network') {
        // 30 s → 2 min → 5 min while it stays unreachable; a cached answer (same time) does not move the ladder on
        const fresh = !(prev.state === 'bad' && prev.at === r.at)
        const delay = mailRetryDelay(fresh ? smtpRetryStep : Math.max(0, smtpRetryStep - 1))
        if (fresh) smtpRetryStep++
        retryAt = Date.now() + delay
        smtpRetry = setTimeout(() => { smtpRetry = null; void get().checkSmtp(true) }, delay)
      } else smtpRetryStep = 0
      set({ smtp: { state: 'bad', kind, error: r.error ?? 'Mail check failed', at: r.at, ...(retryAt ? { retryAt } : {}) } })
    },
    addLog: (level, text) => set({ log: [...get().log.slice(-299), { t: Date.now(), level, text }] }),
    cloudApply: async (p) => {
      const next: Partial<OutreachState> = {}
      if (p.campaigns) next.campaigns = p.campaigns
      if (p.lists) next.lists = p.lists
      if (p.optOut) next.optOut = p.optOut
      if (p.bouncedAddrs) next.bouncedAddrs = p.bouncedAddrs
      if (p.approved) next.approved = p.approved
      if (p.desk) Object.assign(next, p.desk)
      if (p.campaigns && get().activeId && !p.campaigns.some((c) => c.id === get().activeId)) next.activeId = p.campaigns[0]?.id ?? null
      set(next)
      persist()
      if (next.activeId !== undefined && next.activeId) { await get().openCampaign(next.activeId); return }
      if (p.reload?.contacts) await loadContacts(); else relay()
      if (p.reload?.design) await loadDesign()
    },
  }
})

/** The whole desk state except the activity log: what a column or dialog that reads "everything" should use. With
 *  plain `useOutreachStore()` every log line (one per send, inbox check, AI step) re-rendered the entire desk. */
const withoutLog = (x: OutreachState): OutreachState => { const { log: _log, ...rest } = x; return rest as OutreachState }
export function useDesk(): OutreachState { return useOutreachStore(useShallow(withoutLog)) }

if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV && typeof window !== 'undefined') Object.assign(window, { __outreachStore: useOutreachStore })
