// The engine's view of Part A's media layer (project folder, proxies, cache), behind one small adapter.
//
// Part A (the project folder, the media protocol, background proxies) provides, by contract:
//   previewUrlFor(assetId): string    the proxy when there is one, else the original
//   exportUrlFor(assetId): string     always the original
//   onProxyReady(cb): unsubscribe     a proxy finished (cb gets the asset id)
//   readCache(key) / writeCache(key, bytes)   the project's cache/ folder; key [a-z0-9-]{1,80}, ≤ 32 MB
//   mediaInfo(assetId) → { codec, fps, width, height, duration, hasAudio, sizeBytes, keyframeInterval, proxy, missing }
// Until those exist (this branch on its own, the browser dev server) every call falls back: the URLs are the clip's
// own `sourceUrl`, proxies never arrive, and the cache is an in-memory LRU for the session. The engine never imports
// Part A's internals; only this file knows the names.

import * as media from '../media'
import type { Clip } from '../timeline'

export interface MediaInfo {
  codec?: string
  fps?: number
  width?: number
  height?: number
  duration?: number
  hasAudio?: boolean
  sizeBytes?: number
  keyframeInterval?: number
  proxy?: boolean | string | null
  missing?: boolean
}

type PartA = {
  previewUrlFor?: (assetId: string) => string | null | undefined
  exportUrlFor?: (assetId: string) => string | null | undefined
  onProxyReady?: (cb: (assetId: string) => void) => () => void
  readCache?: (key: string) => Promise<Uint8Array | ArrayBuffer | null> | Uint8Array | ArrayBuffer | null
  writeCache?: (key: string, bytes: Uint8Array) => Promise<unknown> | unknown
  mediaInfo?: (assetId: string) => MediaInfo | null | undefined | Promise<MediaInfo | null | undefined>
}

/** Part A's functions, looked up by name at call time (computed keys, so a build without them has nothing missing). */
const partA = (): PartA => {
  const ns = media as unknown as Record<string, unknown>
  const pick = <K extends keyof PartA>(k: K) => (typeof ns[k as string] === 'function' ? (ns[k as string] as PartA[K]) : undefined)
  return {
    previewUrlFor: pick('previewUrlFor'),
    exportUrlFor: pick('exportUrlFor'),
    onProxyReady: pick('onProxyReady'),
    readCache: pick('readCache'),
    writeCache: pick('writeCache'),
    mediaInfo: pick('mediaInfo'),
  }
}

/** Part A answers '' for a missing or unknown asset. A clip whose file is missing has no `sourceUrl` either (relinkClips
 * clears it), so '' falls back to the clip's own URL: undefined (offline) when the file is gone, and the session's own
 * URL for media Part A does not know (a browser import). */
function pick(fn: ((id: string) => string | null | undefined) | undefined, clip: Pick<Clip, 'mediaAssetId' | 'sourceUrl'>): string | undefined {
  if (fn && clip.mediaAssetId && clip.sourceUrl) {
    try { const u = fn(clip.mediaAssetId); if (u) return u } catch { /* fall back */ }
  }
  return clip.sourceUrl
}

/** The URL the preview decodes for a clip: the asset's proxy when Part A has one, else the clip's own file. */
export const previewUrl = (clip: Pick<Clip, 'mediaAssetId' | 'sourceUrl'>) => pick(partA().previewUrlFor, clip)

/** The URL an export decodes for a clip: always the original file. */
export const exportUrl = (clip: Pick<Clip, 'mediaAssetId' | 'sourceUrl'>) => pick(partA().exportUrlFor, clip)

/** Call `cb` when a proxy is ready (the preview then switches to it). No-op until Part A provides it. */
export function onProxyReady(cb: (assetId: string) => void): () => void {
  const fn = partA().onProxyReady
  if (!fn) return () => {}
  try { return fn(cb) } catch { return () => {} }
}

export async function mediaInfo(assetId: string): Promise<MediaInfo | null> {
  const fn = partA().mediaInfo
  if (!fn) return null
  try { return (await fn(assetId)) ?? null } catch { return null }
}

// ---------------------------------------------------------------- cache (waveforms, filmstrips)

export const CACHE_KEY = /^[a-z0-9-]{1,80}$/
export const CACHE_MAX_BYTES = 32 * 1024 * 1024

/** Session fallback for the cache: an LRU of at most 64 MB. */
const memory = new Map<string, Uint8Array>()
let memoryBytes = 0
const MEMORY_BUDGET = 64 * 1024 * 1024
function memPut(key: string, bytes: Uint8Array) {
  const old = memory.get(key)
  if (old) { memoryBytes -= old.byteLength; memory.delete(key) }
  memory.set(key, bytes)
  memoryBytes += bytes.byteLength
  for (const [k, v] of memory) {
    if (memoryBytes <= MEMORY_BUDGET) break
    memory.delete(k)
    memoryBytes -= v.byteLength
  }
}

export async function readCache(key: string): Promise<Uint8Array | null> {
  if (!CACHE_KEY.test(key)) return null
  const hit = memory.get(key)
  if (hit) { memory.delete(key); memory.set(key, hit); return hit }
  const fn = partA().readCache
  if (!fn) return null
  try {
    const r = await fn(key)
    if (!r) return null
    const bytes = r instanceof Uint8Array ? r : new Uint8Array(r)
    memPut(key, bytes)
    return bytes
  } catch {
    return null
  }
}

export async function writeCache(key: string, bytes: Uint8Array): Promise<boolean> {
  if (!CACHE_KEY.test(key) || bytes.byteLength > CACHE_MAX_BYTES) return false
  memPut(key, bytes)
  const fn = partA().writeCache
  if (!fn) return true
  // Part A refuses (rejects) a write past its folder cap and evicts nothing: the entry then lives in memory only
  try { await fn(key, bytes); return true } catch { return false }
}

/** A short stable key for a cache entry: `prefix-` + a hash of what identifies the media (path, size and modified
 * time when known, else the URL). */
export function cacheKey(prefix: string, identity: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < identity.length; i++) {
    const c = identity.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0
  }
  return `${prefix}-${h1.toString(36)}${h2.toString(36)}`.toLowerCase().slice(0, 80)
}
