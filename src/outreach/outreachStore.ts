import { create } from 'zustand'
import type { EsbOutreachStatus } from '../esb'
import type { AttachmentItem, Contact, OutreachBlueprintId, OutreachLang } from './types'
import { OUTREACH_BLUEPRINTS } from './outreachAi'
import { contactsFromRows, readMailingFile } from './directory'
import type { Sheet } from './directory'

// What the editor decided per address — approved, opted out, sent — is kept in localStorage, so it survives a
// restart and a re-import of the workbook. The main process keeps its own ledger of sends (the one that stops a
// repeat); this copy is what the list shows, and it reaches back further than the main's seven-day window.
const KEY = 'esb-banner-studio/outreach/v1'

interface Saved {
  approved: string[]
  optOut: string[]
  sent: Record<string, number>
  draft: { blueprint: OutreachBlueprintId; lang: OutreachLang; subject: string; body: string } | null
}

function load(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null') as Partial<Saved> | null
    if (s) return { approved: s.approved ?? [], optOut: s.optOut ?? [], sent: s.sent ?? {}, draft: s.draft ?? null }
  } catch { /* storage blocked or edited by hand: start clean */ }
  return { approved: [], optOut: [], sent: {}, draft: null }
}
function save(s: Saved) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* full: the main process's ledger still prevents repeats */ }
}

export type CampaignState = 'idle' | 'running' | 'paused'

export interface LogEntry { t: number; level: 'info' | 'ok' | 'warn' | 'error'; text: string }

interface OutreachState {
  fileName: string
  sheets: Sheet[]
  sheet: string
  contacts: Contact[]
  importNote: string | null
  activeId: string | null
  filter: 'all' | 'ready' | 'skipped' | 'sent' | 'failed'
  group: string
  query: string

  blueprint: OutreachBlueprintId
  lang: OutreachLang
  subject: string
  body: string
  attachments: AttachmentItem[]

  campaign: CampaignState
  /** When the runner will send next (ms), for the countdown. */
  nextAt: number | null
  current: string | null
  runSent: number
  runTotal: number

  /** The main process's view: account, encrypted password present, sends in the last 24 h. null outside the desktop app. */
  mail: EsbOutreachStatus | null
  log: LogEntry[]
  saved: Saved

  loadFile: (file: File) => Promise<void>
  setSheet: (name: string) => void
  setActive: (id: string | null) => void
  setFilter: (f: OutreachState['filter']) => void
  setGroup: (g: string) => void
  setQuery: (q: string) => void
  approve: (email: string, on: boolean) => void
  optOut: (email: string, on: boolean) => void
  markSent: (email: string, t: number) => void
  markFailed: (email: string, error: string) => void
  markSending: (email: string | null) => void

  selectBlueprint: (id: OutreachBlueprintId) => void
  setLang: (lang: OutreachLang) => void
  setSubject: (s: string) => void
  setBody: (s: string) => void
  addAttachment: (a: AttachmentItem) => void
  removeAttachment: (id: string) => void

  setCampaign: (s: CampaignState, extra?: Partial<Pick<OutreachState, 'nextAt' | 'runSent' | 'runTotal'>>) => void
  setNextAt: (t: number | null) => void
  refreshMail: () => Promise<void>
  addLog: (level: LogEntry['level'], text: string) => void
}

/** The sheet's contacts with what the editor and the ledger know laid over them. */
function overlay(list: Contact[], s: Saved, mail: EsbOutreachStatus | null): Contact[] {
  const approved = new Set(s.approved), optOut = new Set(s.optOut)
  const ledger = new Map((mail?.sentTo ?? []).map((e) => [e.to, e.t]))
  return list.map((c) => {
    const sentAt = s.sent[c.email] ?? ledger.get(c.email)
    return {
      ...c,
      approved: approved.has(c.email),
      status: optOut.has(c.email) ? 'OPTED_OUT' : sentAt ? 'SENT' : c.status === 'FAILED' ? 'FAILED' : 'QUEUED',
      sentAt,
    }
  })
}

const template = (id: OutreachBlueprintId, lang: OutreachLang) => {
  const b = OUTREACH_BLUEPRINTS.find((x) => x.id === id) ?? OUTREACH_BLUEPRINTS[0]
  return lang === 'bn' ? { subject: b.bengaliSubject, body: b.bengaliBody } : { subject: b.defaultSubject, body: b.defaultBody }
}

export const useOutreachStore = create<OutreachState>((set, get) => {
  const saved = load()
  const draft = saved.draft ?? { blueprint: OUTREACH_BLUEPRINTS[0].id, lang: 'en' as const, ...template(OUTREACH_BLUEPRINTS[0].id, 'en') }
  const persist = (patch: Partial<Saved>) => { const next = { ...get().saved, ...patch }; save(next); set({ saved: next, contacts: overlay(get().contacts, next, get().mail) }) }
  const persistDraft = () => { const s = get(); persist({ draft: { blueprint: s.blueprint, lang: s.lang, subject: s.subject, body: s.body } }) }
  const fromSheet = (name: string) => {
    const sh = get().sheets.find((x) => x.name === name)
    if (!sh) return
    try {
      const r = contactsFromRows(sh.rows)
      const note = [r.skipped ? `${r.skipped} row${r.skipped === 1 ? '' : 's'} without a valid address skipped` : '', r.duplicates ? `${r.duplicates} repeated address${r.duplicates === 1 ? '' : 'es'} left out` : ''].filter(Boolean).join(' · ')
      set({ sheet: name, contacts: overlay(r.contacts, get().saved, get().mail), activeId: r.contacts[0]?.id ?? null, importNote: note || null })
      get().addLog('info', `${r.contacts.length} contacts on "${name}"${note ? ` (${note})` : ''}`)
    } catch (e) {
      set({ sheet: name, contacts: [], activeId: null, importNote: (e as Error).message })
      get().addLog('error', `"${name}": ${(e as Error).message}`)
    }
  }

  return {
    fileName: '',
    sheets: [],
    sheet: '',
    contacts: [],
    importNote: null,
    activeId: null,
    filter: 'all',
    group: '',
    query: '',

    blueprint: draft.blueprint,
    lang: draft.lang,
    subject: draft.subject,
    body: draft.body,
    attachments: [],

    campaign: 'idle',
    nextAt: null,
    current: null,
    runSent: 0,
    runTotal: 0,

    mail: null,
    log: [],
    saved,

    loadFile: async (file) => {
      if (get().campaign !== 'idle') { get().addLog('warn', 'Stop the batch before loading another list'); return }
      try {
        const sheets = await readMailingFile(file)
        if (!sheets.length) throw new Error('The file has no sheets')
        // the sheet the editor's own workbook calls safe, else the first that has an Email column
        const pick = sheets.find((s) => s.name === 'Strategic_Verified_Safe') ?? sheets.find((s) => s.rows.slice(0, 15).some((r) => r.some((c) => /^e-?mail(\s+address)?$/i.test(c)))) ?? sheets[0]
        set({ fileName: file.name, sheets, group: '', query: '', filter: 'all' })
        fromSheet(pick.name)
      } catch (e) {
        set({ importNote: (e as Error).message })
        get().addLog('error', `Could not read ${file.name}: ${(e as Error).message}`)
      }
    },
    setSheet: (name) => { if (get().campaign === 'idle') fromSheet(name) },
    setActive: (activeId) => set({ activeId }),
    setFilter: (filter) => set({ filter }),
    setGroup: (group) => set({ group }),
    setQuery: (query) => set({ query }),
    approve: (email, on) => {
      const a = new Set(get().saved.approved)
      if (on) a.add(email); else a.delete(email)
      persist({ approved: [...a] })
    },
    optOut: (email, on) => {
      const o = new Set(get().saved.optOut)
      if (on) o.add(email); else o.delete(email)
      persist({ optOut: [...o] })
      get().addLog('info', on ? `${email} will not be emailed again` : `${email} can be emailed again`)
    },
    markSent: (email, t) => {
      const sent = { ...get().saved.sent, [email]: t }
      // bounded: the oldest entries go first
      const keys = Object.keys(sent)
      if (keys.length > 5000) for (const k of keys.sort((x, y) => sent[x] - sent[y]).slice(0, keys.length - 5000)) delete sent[k]
      persist({ sent })
    },
    markFailed: (email, error) => set({ contacts: get().contacts.map((c) => (c.email === email ? { ...c, status: 'FAILED', error } : c)) }),
    markSending: (email) => set({ current: email, contacts: get().contacts.map((c) => (c.email === email ? { ...c, status: 'SENDING' } : c.status === 'SENDING' ? { ...c, status: 'QUEUED' } : c)) }),

    selectBlueprint: (id) => { set({ blueprint: id, ...template(id, get().lang) }); persistDraft() },
    setLang: (lang) => { set({ lang, ...template(get().blueprint, lang) }); persistDraft() },
    setSubject: (subject) => { set({ subject }); persistDraft() },
    setBody: (body) => { set({ body }); persistDraft() },
    addAttachment: (a) => {
      if (get().attachments.some((x) => x.name === a.name)) return
      set({ attachments: [...get().attachments, a] })
    },
    removeAttachment: (id) => set({ attachments: get().attachments.filter((a) => a.id !== id) }),

    setCampaign: (campaign, extra = {}) => set({ campaign, ...extra, ...(campaign === 'idle' ? { nextAt: null, current: null } : {}) }),
    setNextAt: (nextAt) => set({ nextAt }),
    refreshMail: async () => {
      const b = window.esb
      if (!b?.outreachStatus) return
      try {
        const mail = await b.outreachStatus()
        set({ mail, contacts: overlay(get().contacts, get().saved, mail) })
      } catch { /* the bridge is missing in an older build */ }
    },
    addLog: (level, text) => set({ log: [...get().log.slice(-199), { t: Date.now(), level, text }] }),
  }
})
