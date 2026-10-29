/**
 * Typed native bridge (Electron preload) for ESB Studio.
 * Exposes local file system operations, drag-and-drop helpers, and network fetch.
 */

export interface EsbFetchUrlResult {
  ok: boolean
  html?: string
  body?: string
  url?: string
  code?: string
  error?: string
}

export interface EsbFetchImageDataResult {
  ok: boolean
  dataUrl?: string
  error?: string
}

export interface EsbOpenProjectResult {
  path: string
  text: string
}

export interface EsbBridge {
  saveImage: (name: string, bytes: Uint8Array, dir?: string) => Promise<string | null>
  pickFolder: () => Promise<string | null>
  reveal: (path: string) => Promise<void>
  saveProject: (name: string, text: string, existingPath: string | null) => Promise<string | null>
  openProject: () => Promise<EsbOpenProjectResult | null>
  readProject: (path: string) => Promise<string | null>
  fetchUrl: (url: string, options?: { timeoutMs?: number; allowedTypes?: string[] }) => Promise<EsbFetchUrlResult>
  fetchImageData: (url: string, options?: { timeoutMs?: number }) => Promise<EsbFetchImageDataResult>
  prepareDragFile: (name: string, bytes: Uint8Array) => Promise<string | null>
  startDrag: (filePathOrName: string, bytes?: Uint8Array) => void
  saveVideo?: (name: string, bytes: Uint8Array) => Promise<string | null>
  quit?: (force?: boolean) => Promise<boolean>
  openSiteAs?: (cookies: { name: string; value: string }[], sitePath: string) => Promise<boolean>
  siteSignOut?: () => Promise<boolean>
  siteUpload?: (cookies: { name: string; value: string }[], bytes: Uint8Array, mime: string, name: string) => Promise<{ ok: boolean; url?: string; status?: number; error?: string }>
  siteRevalidate?: (cookies: { name: string; value: string }[], slugs: string[]) => Promise<{ ok: boolean; status: number; error?: string }>
  siteUploadProbe?: (cookies: { name: string; value: string }[]) => Promise<{ ok: boolean; status: number; detail: string }>
  outreachStatus?: () => Promise<EsbOutreachStatus>
  outreachSave?: (settings: EsbSmtpSettings, password?: string) => Promise<{ ok: true; status: EsbOutreachStatus } | { ok: false; error: string }>
  outreachForgetPassword?: () => Promise<EsbOutreachStatus>
  outreachVerify?: (force?: boolean) => Promise<{ ok: boolean; ms?: number; error?: string; at: number }>
  outreachInbox?: (force?: boolean) => Promise<EsbInboxResult>
  outreachSend?: (mail: EsbOutreachMail) => Promise<{ ok: true; messageId: string; sent24h: number } | { ok: false; error: string; nextAt?: number; duplicate?: boolean }>
  outreachJobSubmit?: (spec: JobSpec) => Promise<{ ok: true; jobId: string; rejected: { index: number; error: string }[] } | { ok: false; error: string }>
  outreachJobControl?: (jobId: string, action: 'pause' | 'resume' | 'stop' | 'hold' | 'release', arg?: string | number) => Promise<{ ok: boolean; error?: string }>
  outreachPauseAll?: (on: boolean) => Promise<{ ok: boolean }>
  outreachJobs?: () => Promise<JobSnapshot[]>
  outreachEvents?: (q?: { since?: string; before?: string; from?: number; to?: number; jobId?: string; campaignId?: string; types?: string[]; q?: string; limit?: number }) => Promise<{ events: OutreachEvent[]; hasMore: boolean }>
  outreachStats?: (q: { from: number; to: number; jobId?: string; campaignId?: string; includeDry?: boolean }) => Promise<OutreachStats>
  outreachPlan?: (q: { count: number }) => Promise<{ days: number; firstAt: number | null; lastAt: number | null; perDay: number[]; notes: string[] }>
  outreachSettings?: () => Promise<AutopilotSettings>
  outreachSettingsSave?: (s: Partial<AutopilotSettings>) => Promise<{ ok: true; settings: AutopilotSettings } | { ok: false; error: string; field?: string }>
  outreachCheckAddresses?: (domains: string[]) => Promise<Record<string, { mx: boolean; a: boolean; error?: string }>>
  outreachLogEvent?: (e: { type: 'ai.action' | 'note'; text: string; command?: string; status?: string; campaignId?: string }) => Promise<{ ok: boolean }>
  outreachOptOut?: (email: string, on: boolean) => Promise<{ ok: boolean }>
  outreachSyncOptOuts?: (emails: string[]) => Promise<{ ok: boolean; added: number }>
  outreachReplyTexts?: (emails: string[]) => Promise<{ email: string; text: string }[]>
  onOutreach?: (cb: (m: OutreachPush) => void) => () => void
}

/** The sender account and pacing; the app password is passed separately and never read back. */
/** What came back to the desk's letters (electron/inbox.cjs). Only addresses the desk emailed; never message text. */
export interface EsbInboxResult {
  ok: boolean
  at: number
  error?: string
  note?: string
  scanned?: number
  replies?: { email: string; at: number; subject: string; auto: boolean; unsubscribe: boolean }[]
  bounces?: { email: string; at: number; reason: string }[]
}
export interface EsbSmtpSettings { host: string; imapHost?: string; port: number; user: string; name: string; dailyLimit: number; minDelaySec: number; maxDelaySec: number }
export interface EsbOutreachStatus {
  configured: boolean
  hasPassword: boolean
  encryption: boolean
  settings: EsbSmtpSettings | null
  /** Campaign emails sent in the last 24 hours, from the main process's ledger. */
  sent24h: number
  /** Addresses emailed in the last 7 days. */
  sentTo: { to: string; t: number }[]
  /** Where replies are read: the saved choice or the one worked out from the SMTP server. */
  imapHost?: string
}
/** One email: plain text only (the main process builds the HTML part), attachments as data URLs. */
export interface EsbOutreachMail {
  to: string
  subject: string
  /** Plain text with the marks of electron/email-html.mjs; the main process builds the HTML. */
  body: string
  signature?: string
  optOut?: string
  lang?: 'en' | 'bn'
  /** ESB letterhead: logo and brand stripes, the logo attached inline. */
  letterhead?: boolean
  /** The gold-rail official pad (letterhead artwork + a generated contact QR), in place of `letterhead`. */
  officialPad?: boolean
  /** The plain letterhead's footer line, in the letter's own marks — the editor's own text (Letter → Footer text). */
  footerLine?: string
  /** The plain letterhead header's background, #rrggbb — an invalid value is dropped, never inserted as given. */
  headerBg?: string
  /** The plain letterhead footer's own background, #rrggbb — same rule as headerBg. */
  footerBg?: string
  /** The three bars above the header and below the footer, "#rrggbb,#rrggbb,#rrggbb" — a bar that is blank or not a
   *  real hex keeps its own default colour. */
  stripeColors?: string
  /** An id into EMAIL_FONTS — an unknown id falls back to the default, never passed through as written. */
  fontFamily?: string
  attachments?: { name: string; dataUrl: string }[]
  isTest?: boolean
  resend?: boolean
  /** A second letter to someone who did not answer: the main process checks there was a first one, threads it under it. */
  followUp?: boolean
}

export interface AutopilotSettings {
  window: {
    enabled: boolean
    from: string
    to: string
    days: number[]
    tz: string
  }
  dailyLimit: number
  ramp: boolean
  pace: 'auto' | 'manual'
  minDelaySec: number
  maxDelaySec: number
  domainMaxPerDay: number
  domainMinGapSec: number
  contactCooldownDays: number
  traySending: boolean
  aiAutonomy: 'suggest' | 'confirm' | 'auto-safe'
  aiReadsReply: boolean
  autoResume: boolean
  legacyBackfilled?: boolean
}

export interface JobMessage {
  to: string
  subject: string
  body: string
  optOut?: string
  name?: string
  org?: string
  key?: string
}

export interface JobSpec {
  campaignId: string
  campaignName: string
  kind?: 'first' | 'followup'
  shared?: Partial<EsbOutreachMail>
  attachments?: { name: string; dataUrl: string }[]
  messages: JobMessage[]
  startAt?: number | null
  autoResume?: boolean
}

export interface JobSnapshot {
  jobId: string
  campaignId: string
  name: string
  kind: 'first' | 'followup'
  status: 'queued' | 'running' | 'waiting' | 'paused' | 'done' | 'stopped'
  why?: 'window' | 'cap' | 'ramp' | 'gap' | 'domain' | 'offline' | 'quota' | 'schedule' | 'held' | null
  until?: number | null
  reason?: 'user' | 'all' | 'auth' | 'circuit' | 'quit' | 'content' | null
  dry: boolean
  total: number
  sent: number
  failed: number
  skipped: number
  held: number
  remaining: number
  createdAt: number
  startedAt?: number | null
  endedAt?: number | null
  etaAt?: number | null
}

export interface OutreachEvent {
  id: string
  t: number
  type: string
  jobId?: string
  campaignId?: string
  email?: string
  run?: 'first' | 'followup'
  name?: string
  org?: string
  key?: string
  messageId?: string
  ms?: number
  attempt?: number
  kind?: string
  code?: string | number
  error?: string
  reason?: string
  dry?: boolean
  clean?: boolean
  on?: boolean
  by?: string
  at?: number
  subject?: string
  auto?: boolean
  unsubscribe?: boolean
  text?: string
  command?: string
  status?: string
  [key: string]: any
}

export interface OutreachStats {
  totals: {
    sent: number
    failed: number
    rejected: number
    skipped: number
    bounced: number
    replied: number
    optedOut: number
    retries: number
  }
  byHour: { h: number; sent: number; failed: number }[]
  byDay: { day: string; sent: number; failed: number; bounced: number; replied: number }[]
  today: { t: number; sent: number; failed: number }[]
  window: { from: string; to: string; days: number[]; tz: string } | null
  cap: number
  durations: {
    avgSendMs: number
    p95SendMs: number
    avgGapSec: number
    activeMs: number
    elapsedMs: number
    perActiveHour: number
  }
  replyMedianMs: number | null
  firstSendAt: number | null
  lastSendAt: number | null
  jobs: JobSnapshot[]
}

export type OutreachPush =
  | { kind: 'progress'; jobId: string; campaignId: string; status: string; why?: string; until?: number; reason?: string; sent: number; total: number; failed: number; current?: string; nextAt?: number | null }
  | { kind: 'event'; event: OutreachEvent }
  | { kind: 'inbox'; result: EsbInboxResult }

declare global {
  interface Window {
    esb?: EsbBridge
  }
}
