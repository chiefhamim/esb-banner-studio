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
  secretSet?: (key: string, value: string) => Promise<boolean>
  secretGet?: (key: string) => Promise<string | null>
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
  /** `kind` says why a failed check failed: auth (wrong app password) | network (server unreachable) | tls | other. */
  outreachVerify?: (force?: boolean) => Promise<{ ok: boolean; ms?: number; error?: string; kind?: 'auth' | 'network' | 'tls' | 'other'; code?: string; at: number }>
  outreachInbox?: (force?: boolean) => Promise<EsbInboxResult>
  outreachSend?: (mail: EsbOutreachMail) => Promise<{ ok: true; messageId: string; messageKey?: string | null; sent24h: number } | { ok: false; error: string; nextAt?: number; duplicate?: boolean }>
  outreachJobSubmit?: (spec: JobSpec) => Promise<{ ok: true; jobId: string; rejected: { index: number; error: string }[] } | { ok: false; error: string }>
  outreachJobControl?: (jobId: string, action: 'pause' | 'resume' | 'stop' | 'hold' | 'release', arg?: string | number) => Promise<{ ok: boolean; error?: string }>
  outreachPauseAll?: (on: boolean) => Promise<{ ok: boolean }>
  outreachJobs?: () => Promise<JobSnapshot[]>
  outreachEvents?: (q?: { since?: string; before?: string; from?: number; to?: number; jobId?: string; campaignId?: string; types?: string[]; q?: string; limit?: number; includeDry?: boolean }) => Promise<{ events: OutreachEvent[]; hasMore: boolean }>
  outreachStats?: (q: { from: number; to: number; jobId?: string; campaignId?: string; includeDry?: boolean }) => Promise<OutreachStats>
  outreachPlan?: (q: OutreachPlanQuery) => Promise<OutreachPlan>
  outreachSettings?: () => Promise<AutopilotSettings>
  outreachSettingsSave?: (s: Partial<AutopilotSettings>) => Promise<{ ok: true; settings: AutopilotSettings } | { ok: false; error: string; field?: string }>
  outreachCheckAddresses?: (domains: string[]) => Promise<Record<string, { mx: boolean; a: boolean; error?: string }>>
  outreachLogEvent?: (e: { type: 'ai.action' | 'note'; text: string; command?: string; status?: string; campaignId?: string }) => Promise<{ ok: boolean }>
  outreachOptOut?: (email: string, on: boolean) => Promise<{ ok: boolean }>
  outreachSyncOptOuts?: (emails: string[]) => Promise<{ ok: boolean; added: number }>
  outreachReplyTexts?: (emails: string[]) => Promise<{ email: string; text?: string; ownWords?: string; subject?: string; at?: number }[]>
  /** Sends another PC made (the shared ledger), entered in this PC's ledger and event log so they are never repeated. */
  outreachMarkSent?: (sends: { email: string; kind: 'campaign' | 'followup' | 'test'; campaignId: string; at: number }[]) => Promise<{ ok: true; ledger: number; events: number; rejected: number } | { ok: false; error: string }>
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
  /** Sends today (calendar day in the sending time zone) — what the daily limit counts. */
  sentToday?: number
  /** Addresses emailed in the last 7 days. */
  sentTo: { to: string; t: number }[]
  /** Where replies are read: the saved choice or the one worked out from the SMTP server. */
  imapHost?: string
  /** This computer's name, as other PCs show it ("Sending from …"). */
  pcLabel?: string
  /** Whether esbpowerline.com's open/click endpoints answered at the last check (null = not checked yet). */
  tracking?: { live: boolean | null; why: string | null; at: number | null }
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
  /** A designed HTML letter (Letter → Designed HTML) in place of the marks: its page, cut down by the main process,
   *  and its pictures carried inside the message as cid:esb-dN. `body` stays the plain-text version. */
  design?: { html: string; images: { cid: string; dataUrl: string }[] }
  /** The recipient's words for the designed letter's {placeholders}, one line each. */
  vars?: Record<string, string>
  /** The campaign the letter belongs to; labels its tracking links. */
  campaignId?: string
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
  /** Emails per calendar day in window.tz (resets at local midnight). */
  dailyLimit: number
  ramp: boolean
  /** Always 'manual' since 2026-11-02 (one model: a random gap between the two numbers); 'auto' is read as it. */
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
  /** Hard ceiling over any rolling 24 h (default 400, under Gmail's 500). Settings file only, not on screen. */
  gmailCeiling24h?: number
  legacyBackfilled?: boolean
  /** The Sender dialog's old pacing copy was adopted once (outreach-settings.cjs migratePacingFromMailer). */
  pacingMigrated?: boolean
  /** When the account-wide settings (outreach-settings.cjs SHARED_KEYS) last changed, on any PC (ms). */
  sharedUpdatedAt?: number
  dryRun?: boolean
}

export interface JobMessage {
  to: string
  subject: string
  body: string
  optOut?: string
  name?: string
  org?: string
  key?: string
  /** A designed letter's per-recipient words; see EsbOutreachMail.vars. */
  vars?: Record<string, string>
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
  why?: 'window' | 'cap' | 'ramp' | 'gap' | 'domain' | 'offline' | 'tls' | 'quota' | 'schedule' | 'held' | null
  until?: number | null
  /** What exactly the wait is for (engine job.wait): the organisation and its limit/spacing, the gap range, the hours. */
  wait?: JobWait | null
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

/** The detail behind JobSnapshot.why, set by electron/outreach-engine.cjs. Every field optional. */
export interface OutreachPlanQuery {
  count: number
  /** the organisation (e-mail domain) of each remaining email — the per-organisation limit */
  domains?: string[]
  /** unsaved settings from the Sending panel; the plan follows what is typed (validated in main) */
  draft?: Partial<AutopilotSettings>
}

export type PlanWarning =
  | { kind: 'hours'; fit: number; limit: number; spanSec: number; avgGapSec: number }
  | { kind: 'ceiling'; ceiling: number; limit: number }
  | { kind: 'ramp'; limitToday: number; limit: number }
  | { kind: 'anyHour' }
  | { kind: 'org'; today: number; remaining: number; inOrgs: number; orgs: number; orgMax: number; orgGapMin: number }

/** The Sending panel's live line, computed by the engine with its own rules (outreach-schedule.cjs livePlan). */
export interface LivePlan {
  now: number
  tz: string
  limit: number
  limitToday: number
  sentToday: number
  sent24h: number
  roomToday: number
  limitedBy: null | 'day' | 'ceiling'
  freesAt: number | null
  ceiling: number
  nextAt: number | null
  minGapSec: number
  maxGapSec: number
  avgGapSec: number
  dayDurationSec: number
  fitPerDay: number
  windowOn: boolean
  remaining: number
  today: number
  finishAt: number | null
  days: number
  perDay: { day: string; n: number }[]
  warnings: PlanWarning[]
}

export interface OutreachPlan {
  days: number
  firstAt: number | null
  lastAt: number | null
  perDay: number[]
  notes: string[]
  live?: LivePlan
  error?: string
}

export interface JobWait {
  /** why 'domain': the organisation (domain) and whether it hit its daily limit or its spacing. */
  domain?: string | null
  kind?: 'limit' | 'spacing' | 'day' | 'ceiling' | null
  count?: number | null
  max?: number
  /** why 'domain': the spacing per organisation; why 'gap': the gap chosen after the last email. */
  gapSec?: number
  /** why 'gap': the pacing and the editor's range. */
  pace?: 'auto' | 'manual'
  minSec?: number
  maxSec?: number
  /** why 'window': the sending hours. */
  from?: string
  to?: string
  tz?: string
  /** why 'cap': today's limit (after warm-up) and how many went today (calendar day in `tz`), or — kind 'ceiling' —
   *  in the last 24 h against the safety ceiling. */
  limit?: number
  sent?: number
  ramp?: boolean
  ceiling?: number
  /** why 'cap': when the limit frees (local midnight, or the ceiling's oldest send turning 24 h) and when sending
   *  really resumes (the sending hours may start later); `hours` is set when the hours decide. */
  resetAt?: number | null
  resumeAt?: number
  hours?: { from: string; to: string } | null
}

export type OutreachPush =
  | { kind: 'progress'; jobId: string; campaignId: string; status: string; why?: string; until?: number; wait?: JobWait | null; reason?: string; sent: number; total: number; failed: number; current?: string; nextAt?: number | null }
  | { kind: 'event'; event: OutreachEvent }
  | { kind: 'inbox'; result: EsbInboxResult }

declare global {
  interface Window {
    esb?: EsbBridge
  }
}
