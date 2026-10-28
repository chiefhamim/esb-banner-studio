import { create } from 'zustand'
import type { AttachmentItem, CampaignConfig, Contact, OutreachBlueprintId, TrackingStatus } from './types'
import { OUTREACH_BLUEPRINTS } from './outreachAi'
import { parseWorkbookBuffer } from './directoryStore'

const CONFIG_STORAGE_KEY = 'esb-banner-studio/outreach-config'

export interface OutreachLog {
  id: string
  timestamp: string
  level: 'info' | 'success' | 'warning' | 'error'
  message: string
}

const DEFAULT_CONFIG: CampaignConfig = {
  senderName: 'ESB PowerLine',
  senderEmail: '',
  senderPassword: '',
  smtpHost: 'smtp.gmail.com',
  smtpPort: 587,
  secure: false,
  dailyLimit: 100,
  minDelaySec: 180,
  maxDelaySec: 480,
  trackingEndpoint: 'https://esbpowerline.com/api/outreach/track',
  enableOpenTracking: true,
  enableClickTracking: true,
  autoAddGraphicsBanner: false,
  autoAddEditorialStory: false,
}

function loadSavedConfig(): CampaignConfig {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY)
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
  } catch { /* fallback */ }
  return DEFAULT_CONFIG
}

interface OutreachState {
  contacts: Contact[]
  activeContactId: string | null
  sheetNames: string[]
  selectedSheet: string
  filterGroup: string
  filterStatus: string
  searchQuery: string
  
  // Composer state
  selectedBlueprint: OutreachBlueprintId
  languageMode: 'en' | 'bn' | 'bilingual'
  subject: string
  bodyHtml: string
  attachments: AttachmentItem[]
  
  // Execution & Pacing
  campaignState: 'IDLE' | 'RUNNING' | 'PAUSED' | 'COOLDOWN'
  rolling24hCount: number
  countdownSec: number
  activeRecipient: Contact | null
  batchTotal: number
  batchSent: number
  
  // Config & Logs
  config: CampaignConfig
  logs: OutreachLog[]
  
  // Actions
  loadWorkbookData: (buffer: ArrayBuffer | Uint8Array, sheetName?: string) => void
  setFilterGroup: (group: string) => void
  setFilterStatus: (status: string) => void
  setSearchQuery: (query: string) => void
  setActiveContactId: (id: string | null) => void
  
  selectBlueprint: (id: OutreachBlueprintId) => void
  setLanguageMode: (lang: 'en' | 'bn' | 'bilingual') => void
  setSubject: (subject: string) => void
  setBodyHtml: (html: string) => void
  addAttachment: (item: AttachmentItem) => void
  removeAttachment: (id: string) => void
  
  updateContactStatus: (email: string, status: TrackingStatus, details?: Partial<Contact>) => void
  recordSend: (email: string) => void
  recordOpen: (email: string) => void
  
  setCampaignState: (state: 'IDLE' | 'RUNNING' | 'PAUSED' | 'COOLDOWN') => void
  setCountdown: (sec: number) => void
  setActiveRecipient: (contact: Contact | null) => void
  updatePacing: (sentDelta?: number) => void
  
  saveConfig: (partial: Partial<CampaignConfig>) => void
  addLog: (level: 'info' | 'success' | 'warning' | 'error', message: string) => void
  clearLogs: () => void
}

export const useOutreachStore = create<OutreachState>((set, get) => {
  const initialConfig = loadSavedConfig()
  const initialBlueprint = OUTREACH_BLUEPRINTS[0]

  return {
    contacts: [],
    activeContactId: null,
    sheetNames: ['Strategic_Verified_Safe', 'All_Verified_Master_Census'],
    selectedSheet: 'Strategic_Verified_Safe',
    filterGroup: 'ALL',
    filterStatus: 'ALL',
    searchQuery: '',

    selectedBlueprint: initialBlueprint.id,
    languageMode: 'en',
    subject: initialBlueprint.defaultSubject,
    bodyHtml: initialBlueprint.defaultBody,
    attachments: [],

    campaignState: 'IDLE',
    rolling24hCount: 0,
    countdownSec: 0,
    activeRecipient: null,
    batchTotal: 0,
    batchSent: 0,

    config: initialConfig,
    logs: [
      {
        id: 'init_1',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        level: 'info',
        message: 'Outreach & Promotional Desk initialized. Ready to connect workbook.',
      },
    ],

    loadWorkbookData: (buffer, sheetName) => {
      try {
        const res = parseWorkbookBuffer(buffer, sheetName)
        set({
          contacts: res.contacts,
          sheetNames: res.sheetNames,
          selectedSheet: res.activeSheet,
          activeContactId: res.contacts[0]?.id || null,
        })
        get().addLog('success', `Loaded ${res.contacts.length} verified contacts from sheet '${res.activeSheet}'.`)
      } catch (err) {
        get().addLog('error', `Workbook load failed: ${String(err)}`)
      }
    },

    setFilterGroup: (filterGroup) => set({ filterGroup }),
    setFilterStatus: (filterStatus) => set({ filterStatus }),
    setSearchQuery: (searchQuery) => set({ searchQuery }),
    setActiveContactId: (activeContactId) => set({ activeContactId }),

    selectBlueprint: (id) => {
      const bp = OUTREACH_BLUEPRINTS.find((b) => b.id === id) || OUTREACH_BLUEPRINTS[0]
      const lang = get().languageMode
      set({
        selectedBlueprint: id,
        subject: lang === 'bn' ? bp.bengaliSubject : bp.defaultSubject,
        bodyHtml: lang === 'bn' ? bp.bengaliBody : bp.defaultBody,
      })
    },

    setLanguageMode: (languageMode) => {
      const bp = OUTREACH_BLUEPRINTS.find((b) => b.id === get().selectedBlueprint) || OUTREACH_BLUEPRINTS[0]
      set({
        languageMode,
        subject: languageMode === 'bn' ? bp.bengaliSubject : bp.defaultSubject,
        bodyHtml: languageMode === 'bn' ? bp.bengaliBody : bp.defaultBody,
      })
    },

    setSubject: (subject) => set({ subject }),
    setBodyHtml: (bodyHtml) => set({ bodyHtml }),

    addAttachment: (item) => {
      const current = get().attachments
      if (current.some((a) => a.name === item.name)) return
      set({ attachments: [...current, item] })
      get().addLog('info', `Attached: ${item.name} (${Math.round(item.size / 1024)} KB)`)
    },

    removeAttachment: (id) => {
      set({ attachments: get().attachments.filter((a) => a.id !== id) })
    },

    updateContactStatus: (email, status, details = {}) => {
      const norm = email.toLowerCase().trim()
      set((st) => ({
        contacts: st.contacts.map((c) => (c.email.toLowerCase().trim() === norm ? { ...c, trackingStatus: status, ...details } : c)),
      }))
    },

    recordSend: (email) => {
      const now = new Date().toISOString()
      get().updateContactStatus(email, 'SENT', { sentAt: now })
      set((st) => ({ rolling24hCount: st.rolling24hCount + 1, batchSent: st.batchSent + 1 }))
    },

    recordOpen: (email) => {
      const now = new Date().toISOString()
      const c = get().contacts.find((x) => x.email.toLowerCase().trim() === email.toLowerCase().trim())
      const newCount = (c?.openCount ?? 0) + 1
      get().updateContactStatus(email, 'OPENED', {
        openedAt: c?.openedAt || now,
        lastViewedAt: now,
        openCount: newCount,
      })
      get().addLog('success', `✓✓ Read Receipt: ${c?.personName || email} opened your email (${newCount}×)`)
    },

    setCampaignState: (campaignState) => set({ campaignState }),
    setCountdown: (countdownSec) => set({ countdownSec }),
    setActiveRecipient: (activeRecipient) => set({ activeRecipient }),

    updatePacing: (sentDelta = 0) => {
      set((st) => ({ batchSent: st.batchSent + sentDelta }))
    },

    saveConfig: (partial) => {
      const next = { ...get().config, ...partial }
      set({ config: next })
      try {
        localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(next))
      } catch { /* storage quota */ }
      get().addLog('info', 'Campaign & SMTP settings saved locally.')
    },

    addLog: (level, message) => {
      const entry: OutreachLog = {
        id: 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        level,
        message,
      }
      set((st) => ({ logs: [...st.logs.slice(-299), entry] }))
    },

    clearLogs: () => set({ logs: [] }),
  }
})
