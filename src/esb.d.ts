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
}

declare global {
  interface Window {
    esb?: EsbBridge
  }
}
