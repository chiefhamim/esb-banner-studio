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
  quit?: () => Promise<boolean>
  openSiteAs?: (cookies: { name: string; value: string }[], sitePath: string) => Promise<boolean>
  siteSignOut?: () => Promise<boolean>
  siteUpload?: (cookies: { name: string; value: string }[], bytes: Uint8Array, mime: string, name: string) => Promise<{ ok: boolean; url?: string; status?: number; error?: string }>
  siteRevalidate?: (cookies: { name: string; value: string }[], slugs: string[]) => Promise<{ ok: boolean; status: number; error?: string }>
  siteUploadProbe?: (cookies: { name: string; value: string }[]) => Promise<{ ok: boolean; status: number; detail: string }>
  outreachStatus?: () => Promise<EsbOutreachStatus>
  outreachSave?: (settings: EsbSmtpSettings, password?: string) => Promise<{ ok: true; status: EsbOutreachStatus } | { ok: false; error: string }>
  outreachForgetPassword?: () => Promise<EsbOutreachStatus>
  outreachSend?: (mail: EsbOutreachMail) => Promise<{ ok: true; messageId: string; sent24h: number } | { ok: false; error: string; nextAt?: number; duplicate?: boolean }>
}

/** The sender account and pacing; the app password is passed separately and never read back. */
export interface EsbSmtpSettings { host: string; port: number; user: string; name: string; dailyLimit: number; minDelaySec: number; maxDelaySec: number }
export interface EsbOutreachStatus {
  configured: boolean
  hasPassword: boolean
  encryption: boolean
  settings: EsbSmtpSettings | null
  /** Campaign emails sent in the last 24 hours, from the main process's ledger. */
  sent24h: number
  /** Addresses emailed in the last 7 days. */
  sentTo: { to: string; t: number }[]
}
/** One email: plain text only (the main process builds the HTML part), attachments as data URLs. */
export interface EsbOutreachMail { to: string; subject: string; text: string; attachments?: { name: string; dataUrl: string }[]; isTest?: boolean; resend?: boolean }

declare global {
  interface Window {
    esb?: EsbBridge
  }
}
