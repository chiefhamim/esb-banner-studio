// Media for the Video desk: where a clip's file comes from and what is in it.
//
// Desktop app: files are chosen in the main process's own dialog (or dropped on the bin) and recorded by their real
// path. The renderer never names a path to read; it gets an `esb-media://m/<id>` URL for each file main has approved,
// served by main with range requests, so <video>, fetch and the decoder stream the file instead of copying it. A
// project keeps the paths, and reopening it asks main for fresh URLs (or reports the file missing, for relinking).
// Browser (dev server, tests): files come from an <input type=file> as object URLs and live for the session only.

import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input, UrlSource } from 'mediabunny'
import type { InputVideoTrack } from 'mediabunny'
import { create } from 'zustand'
import type { MediaAsset } from './timeline'
import type { AssetFacts, ImportMode, ProjectSettings } from './projectFolder'
import { DEFAULT_SETTINGS } from './projectFolder'
import { useVideoStore } from './videoStore'

export interface MediaEntry { path: string; name: string; size: number; mtimeMs: number; url: string; /** media/<name> when it was copied into the project folder */ file?: string; /** set instead of the rest when main could not take the file */ error?: string }
export interface FolderRef { id: string; path: string }
export interface ResolvedEntry { path: string; url?: string; size?: number; mtimeMs?: number; missing?: boolean }

export interface VideoBridge {
  videoImport?: (opts?: { mode: ImportMode; folderId: string | null }) => Promise<MediaEntry[]>
  videoImportDropped?: (files: File[], opts?: { mode: ImportMode; folderId: string | null }) => Promise<MediaEntry[]>
  videoRelink?: (name: string) => Promise<MediaEntry | null>
  videoResolve?: (paths: string[]) => Promise<ResolvedEntry[]>
  videoStoreStill?: (name: string, bytes: Uint8Array) => Promise<MediaEntry | null>
  videoStoreTake?: (name: string, bytes: Uint8Array) => Promise<MediaEntry | null>
  // Phase 4 Part B: the music library (electron/video-music.cjs); files are named relative to the chosen folder
  videoMusicFolder?: () => Promise<{ path: string; name: string } | null>
  videoMusicChoose?: () => Promise<{ path: string; name: string } | null>
  videoMusicClear?: () => Promise<null>
  videoMusicList?: () => Promise<{ files: { rel: string; name: string; size: number; mtimeMs: number }[]; truncated: boolean }>
  videoMusicUse?: (rel: string) => Promise<MediaEntry | null>
  videoSaveProject?: (name: string, text: string, existing: string | null) => Promise<string | null>
  videoOpenProject?: () => Promise<{ path: string; text: string; folder?: FolderRef } | null>
  videoAutosave?: (text: string, folderId?: string | null) => Promise<{ ok: boolean; at: number }>
  videoAutosaveLatest?: () => Promise<{ at: number; text: string; folder?: FolderRef } | null>
  videoAutosaveClear?: (projectId?: string, folderId?: string | null) => Promise<boolean>
  videoExportBegin?: (name: string, kind: 'mp4' | 'webm', folderId?: string | null) => Promise<{ id: string; path: string } | null>
  videoExportWrite?: (id: string, position: number, bytes: Uint8Array) => Promise<boolean>
  videoExportEnd?: (id: string, ok: boolean) => Promise<string | null>
  reveal?: (p: string) => Promise<unknown>
  // Phase 1: project folders, relink by hash, proxies, cache (electron/video-project.cjs)
  videoFolderCreate?: (name: string) => Promise<FolderRef | null>
  videoFolderSave?: (folderId: string, text: string) => Promise<string>
  videoFolderResolve?: (folderId: string, files: string[]) => Promise<(MediaEntry & { missing?: boolean })[]>
  videoMediaFacts?: (urls: string[]) => Promise<{ url: string; size?: number; mtimeMs?: number; hash?: string; missing?: boolean }[]>
  videoRelinkSearch?: (folderId: string | null, items: { id: string; path?: string; size: number; hash: string }[]) => Promise<{ id: string; entry: MediaEntry }[]>
  videoProxyStatus?: (folderId: string | null, hashes: string[]) => Promise<Record<string, string>>
  videoProxyBegin?: (folderId: string | null, hash: string, sourceUrl?: string) => Promise<{ id: string }>
  videoProxyWrite?: (id: string, position: number, bytes: Uint8Array) => Promise<boolean>
  videoProxyEnd?: (id: string, ok: boolean) => Promise<{ url: string } | null>
  videoCacheRead?: (folderId: string | null, key: string) => Promise<Uint8Array | null>
  videoCacheWrite?: (folderId: string | null, key: string, bytes: Uint8Array) => Promise<boolean>
}

export const videoBridge = (): VideoBridge | undefined => (typeof window !== 'undefined' ? (window as unknown as { esb?: VideoBridge }).esb : undefined)
/** The desktop app's media bridge is present (files by path, autosave to disk, export streamed to disk). */
export const hasDiskMedia = () => typeof videoBridge()?.videoImport === 'function'

// object URL → the File behind it (browser imports), so the decoder reads the File directly
const files = new Map<string, Blob>()
export function rememberFile(url: string, file: Blob) { files.set(url, file) }
export function forgetFile(url: string) { files.delete(url) }

/** A mediabunny input over a clip's media: the File itself when we have it, else the URL (with range requests). */
export function inputFor(url: string): Input {
  const blob = files.get(url)
  // a modest read cache: an export reads each file front to back once, so a large cache only holds memory
  return new Input({ source: blob ? new BlobSource(blob) : new UrlSource(url, { maxCacheSize: 16 * 1024 * 1024 }), formats: ALL_FORMATS })
}

const EXT_KIND: Record<string, MediaAsset['type']> = {
  mp4: 'video', m4v: 'video', mov: 'video', webm: 'video', mkv: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio', aac: 'audio', ogg: 'audio', opus: 'audio', flac: 'audio',
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image',
}
export function kindOf(name: string, mime = ''): MediaAsset['type'] | null {
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  return EXT_KIND[name.split('.').pop()?.toLowerCase() ?? ''] ?? null
}

export interface Probe { duration: number; width?: number; height?: number; hasAudio?: boolean; thumbnailUrl?: string }

/** Read what is in a file: its length, picture size, whether it has sound, and a small thumbnail. Lengths and
 * tracks come from the container (mediabunny); the thumbnail from a <video> frame. Unknown stays unknown. */
export async function probeMedia(url: string, type: MediaAsset['type']): Promise<Probe> {
  if (type === 'image') {
    return new Promise((resolve) => {
      const img = new Image()
      if (!/^(blob:|data:)/.test(url)) img.crossOrigin = 'anonymous'
      img.onload = () => resolve({ duration: 0, width: img.naturalWidth, height: img.naturalHeight, thumbnailUrl: url })
      img.onerror = () => resolve({ duration: 0 })
      img.src = url
    })
  }
  const out: Probe = { duration: 0 }
  try {
    const input = inputFor(url)
    try {
      const [v, a] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()])
      out.hasAudio = !!a
      if (v) { out.width = v.displayWidth; out.height = v.displayHeight }
      const d = await input.computeDuration()
      if (Number.isFinite(d) && d > 0) out.duration = d
    } finally {
      input.dispose()
    }
  } catch { /* a container the reader does not know: fall back to the element below */ }
  if (type === 'video') {
    await new Promise<void>((resolve) => {
      const v = document.createElement('video')
      if (!/^(blob:|data:)/.test(url)) v.crossOrigin = 'anonymous'
      v.preload = 'metadata'
      v.muted = true
      const done = () => { v.removeAttribute('src'); v.load(); resolve() }
      const timer = setTimeout(done, 4000)
      v.onloadedmetadata = () => {
        if (!out.duration && Number.isFinite(v.duration) && v.duration > 0) out.duration = v.duration
        if (!out.width) { out.width = v.videoWidth; out.height = v.videoHeight }
        v.currentTime = Math.min(1, (out.duration || 2) / 2)
      }
      // `seeked` can fire before the frame is decoded, which drew black thumbnails: wait for a decoded frame, and if
      // the picture is still black, try once more further in (a fade-in, or a frame that was not ready yet)
      let tries = 0
      v.onseeked = async () => {
        await frameReady(v)
        try {
          const tc = document.createElement('canvas')
          tc.width = 160
          tc.height = 90
          const tctx = tc.getContext('2d', { willReadFrequently: true })
          if (tctx) {
            tctx.drawImage(v, 0, 0, 160, 90)
            if (isBlack(tctx) && tries++ < 1 && out.duration > 2) { v.currentTime = Math.min(out.duration - 0.1, out.duration * 0.25 + 1); return }
            out.thumbnailUrl = tc.toDataURL('image/jpeg', 0.7)
          }
        } catch { /* no thumbnail */ }
        clearTimeout(timer)
        done()
      }
      v.onerror = () => { clearTimeout(timer); done() }
      v.src = url
    })
  } else if (!out.duration) {
    await new Promise<void>((resolve) => {
      const a = document.createElement('audio')
      a.preload = 'metadata'
      const timer = setTimeout(resolve, 3000)
      a.onloadedmetadata = () => { if (Number.isFinite(a.duration)) out.duration = a.duration; clearTimeout(timer); resolve() }
      a.onerror = () => { clearTimeout(timer); resolve() }
      a.src = url
    })
  }
  return out
}

/** Resolve once the element has a decoded frame to draw (requestVideoFrameCallback where it fires, else readyState). */
function frameReady(v: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    const deadline = performance.now() + 1500
    const poll = () => { if (v.readyState >= 2 || performance.now() > deadline) resolve(); else setTimeout(poll, 30) }
    const rvfc = (v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }).requestVideoFrameCallback
    if (rvfc && v.readyState < 2) {
      let settled = false
      rvfc.call(v, () => { if (!settled) { settled = true; resolve() } })
      setTimeout(() => { if (!settled) { settled = true; poll() } }, 300)
    } else poll()
  })
}

/** The thumbnail is (nearly) all black. */
function isBlack(ctx: CanvasRenderingContext2D): boolean {
  const d = ctx.getImageData(0, 0, 160, 90).data
  let sum = 0
  for (let i = 0; i < d.length; i += 16) sum += d[i] + d[i + 1] + d[i + 2]
  return sum / (d.length / 16) < 12
}

let seq = 0
export const newAssetId = () => `asset-${Date.now().toString(36)}-${(seq++).toString(36)}`

/** Run `fn` over `items` with at most `limit` at once, keeping the order of the results. An import of 200 files probed
 * all at once opened 200 decoders and <video> elements together. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i) } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/** How many files an import probes at once. */
export const PROBE_CONCURRENCY = 4

/** A bin entry for a file main approved (desktop) — probed for length, size and sound. `type` overrides the kind read
 * from the extension (a voiceover take is a .webm that holds sound only). */
export async function assetFromEntry(e: MediaEntry, generated = false, type: MediaAsset['type'] | null = kindOf(e.name)): Promise<MediaAsset | null> {
  if (e.error || !e.url) { importErrors.push(`${e.name}: ${e.error ?? 'not imported'}`); return null }
  if (!type) return null
  const p = await probeMedia(e.url, type)
  const id = newAssetId()
  patchMeta(id, { storage: e.file ? 'copy' : 'reference', file: e.file })
  return { id, name: e.name, type, url: e.url, path: e.path, size: e.size, mtimeMs: e.mtimeMs, duration: p.duration, width: p.width, height: p.height, hasAudio: p.hasAudio, thumbnailUrl: p.thumbnailUrl, generated }
}

/** Keep a recorded voiceover: in the desktop app main writes it to userData/video-takes and it is recorded by path
 * (so a save, a reopen and a crash restore all find it); in the browser it stays an object URL for the session. */
export async function keepTake(blob: Blob, name: string, duration: number): Promise<{ asset: MediaAsset; onDisk: boolean; error?: string }> {
  const b = videoBridge()
  let error: string | undefined
  if (b?.videoStoreTake) {
    try {
      const entry = await b.videoStoreTake(name, new Uint8Array(await blob.arrayBuffer()))
      const asset = entry ? await assetFromEntry(entry, true, 'audio') : null
      if (asset) return { asset: { ...asset, name, duration: asset.duration > 0 ? asset.duration : duration }, onDisk: true }
    } catch (e) {
      error = (e as Error).message || 'could not write the take'
    }
  }
  // the browser, or the write failed: the take stays playable for this session (and the desk says it is not on disk)
  const url = URL.createObjectURL(blob)
  rememberFile(url, blob)
  return { asset: { id: newAssetId(), name, type: 'audio', url, duration, size: blob.size, generated: true }, onDisk: false, error }
}

/** A bin entry for a browser File (object URL, this session only). */
export async function assetFromFile(file: File): Promise<MediaAsset | null> {
  const type = kindOf(file.name, file.type)
  if (!type) return null
  const url = URL.createObjectURL(file)
  rememberFile(url, file)
  const p = await probeMedia(url, type)
  return { id: newAssetId(), name: file.name, type, url, size: file.size, duration: p.duration, width: p.width, height: p.height, hasAudio: p.hasAudio, thumbnailUrl: p.thumbnailUrl }
}

/** Find a project's media again: each asset with a path gets this run's URL from main, or is marked missing. Size or
 * modified-time changes are kept (the file was edited) but noted by the new numbers. */
export async function resolveAssets(assets: MediaAsset[]): Promise<MediaAsset[]> {
  const b = videoBridge()
  const withPath = assets.filter((a) => a.path)
  if (!withPath.length || !b?.videoResolve) return assets.map((a) => (a.url ? a : { ...a, missing: true }))
  const res = await b.videoResolve(withPath.map((a) => a.path!))
  const byPath = new Map(res.map((r) => [r.path, r]))
  return assets.map((a) => {
    if (!a.path) return a.url ? a : { ...a, missing: true }
    const r = byPath.get(a.path)
    if (!r || r.missing || !r.url) return { ...a, url: '', missing: true }
    return { ...a, url: r.url, size: r.size ?? a.size, mtimeMs: r.mtimeMs ?? a.mtimeMs, missing: false, thumbnailUrl: a.type === 'image' ? r.url : a.thumbnailUrl }
  })
}

// ================================================================ Phase 1: facts, proxies, cache — the public contract
//
// The Video desk's other modules (the decode engine, the compositor, waveforms and filmstrips) read media through the
// functions below and never build esb-media URLs themselves:
//   previewUrlFor(id)  what the monitor should decode (a ready 540p proxy, else the original)
//   exportUrlFor(id)   what an export must decode (always the original)
//   onProxyReady(cb)   a proxy became ready (swap readers for that asset)
//   readCache / writeCache   key → bytes in the project's cache/ folder (waveforms, filmstrips)
//   mediaInfo(id)      codec, fps, size, duration, key frame interval, proxy and missing state
//   holdProxies(why)   pause background proxy work during playback / export; returns release()

export type ProxyState = 'none' | 'pending' | 'ready' | 'failed'

/** What the desk knows about one bin entry beyond the MediaAsset itself (kept per asset id; saved in project.json). */
export interface AssetMeta extends AssetFacts {
  /** The URL the facts were read from (they are read again when the asset is relinked to another file). */
  analyzedUrl?: string
  /** The URL `hash` was read from in this session. A relink keeps the old hash (it is what relink-by-hash looks for)
   * until the new file's hash is read; nothing proxy-related trusts a hash read from another URL. */
  hashUrl?: string
  /** The source hash the ready proxy was made from (or found for): it is used only while it is the current file's. */
  proxyHash?: string
  /** The source is heavy (over 1080p, or key frames at least 0.5 s apart): a proxy is wanted. */
  proxyNeeded?: boolean
  proxy?: ProxyState
  /** 0..1 while pending and running. */
  proxyProgress?: number
  proxyUrl?: string
  proxyError?: string
  /** The editor cancelled it: not made again by itself. */
  proxyCancelled?: boolean
  /** How long the last proxy took to make, in ms. */
  proxyMs?: number
}

interface MediaMetaState {
  /** The project folder on the desk (desktop), or null (an unsaved project or a Phase 0 single file). */
  folder: FolderRef | null
  settings: ProjectSettings
  byId: Record<string, AssetMeta>
  /** Missing files found again by size + hash, ready for one-click Relink all (asset id → the file found). */
  found: Record<string, MediaEntry>
}

export const useMediaMeta = create<MediaMetaState>(() => ({ folder: null, settings: { ...DEFAULT_SETTINGS }, byId: {}, found: {} }))

/** Merge facts into one asset's meta. */
export function patchMeta(id: string, patch: Partial<AssetMeta>) {
  useMediaMeta.setState((s) => ({ byId: { ...s.byId, [id]: { ...s.byId[id], ...patch } } }))
}
export const metaFor = (id: string): AssetMeta | undefined => useMediaMeta.getState().byId[id]
export const currentFolder = () => useMediaMeta.getState().folder

/** Errors from the last import (files main could not take, e.g. a copy that ran out of space), read and cleared once. */
const importErrors: string[] = []
export const takeImportErrors = () => importErrors.splice(0, importErrors.length)

/** Import options for main: reference by path, or copy into the open project folder. */
export function importOptions(): { mode: ImportMode; folderId: string | null } {
  const { folder, settings } = useMediaMeta.getState()
  return { mode: folder && settings.importMode === 'copy' ? 'copy' : 'reference', folderId: folder?.id ?? null }
}

const assetById = (id: string): MediaAsset | undefined => useVideoStore.getState().mediaAssets.find((a) => a.id === id)

/** The entry's ready proxy belongs to the file the entry points at NOW: its facts and hash were read from the current
 * URL and the proxy was made from that hash. Right after a relink none of that holds until the new file is read, so
 * the preview (and anything cached from it, like a filmstrip) uses the new original, never the old file's proxy. */
export function proxyIsCurrent(a: Pick<MediaAsset, 'url' | 'missing'>, m: AssetMeta | undefined): boolean {
  return !!m && !a.missing && !!a.url && m.proxy === 'ready' && !!m.proxyUrl && m.analyzedUrl === a.url && m.hashUrl === a.url && !!m.hash && m.proxyHash === m.hash
}

/**
 * The URL the preview should decode for a bin entry: its proxy's `esb-media://p/…/proxies/<hash>.mp4` when one is
 * ready for the file the entry points at now (`proxyIsCurrent`), else the original file's URL. Empty string for an
 * unknown or missing entry. Never use it for export.
 */
export function previewUrlFor(assetId: string): string {
  const a = assetById(assetId)
  if (!a || a.missing) return ''
  const m = metaFor(assetId)
  return proxyIsCurrent(a, m) ? m!.proxyUrl! : a.url
}

/** The URL an export must decode for a bin entry: always the original file (never a proxy). Empty when missing. */
export function exportUrlFor(assetId: string): string {
  const a = assetById(assetId)
  return a && !a.missing ? a.url : ''
}

const proxyListeners = new Set<(assetId: string) => void>()
/** Call `cb(assetId)` whenever a proxy becomes ready (the preview can then swap to `previewUrlFor`). Returns the
 * unsubscribe function. */
export function onProxyReady(cb: (assetId: string) => void): () => void {
  proxyListeners.add(cb)
  return () => { proxyListeners.delete(cb) }
}
/** Mark a proxy ready (made from, or found for, the source hash `hash`) and tell the listeners (used by the proxy
 * queue). */
export function proxyBecameReady(assetId: string, url: string, ms?: number, hash: string | undefined = metaFor(assetId)?.hash) {
  patchMeta(assetId, { proxy: 'ready', proxyUrl: url, proxyHash: hash, proxyProgress: 1, proxyError: undefined, ...(ms != null ? { proxyMs: ms } : {}) })
  for (const cb of [...proxyListeners]) { try { cb(assetId) } catch { /* a listener's own error */ } }
}

// ---------------------------------------------------------------- holding background proxy work

const holds = new Map<symbol, string>()
let holdWaiters: (() => void)[] = []
const releasedListeners = new Set<() => void>()

/**
 * Hold background proxy work while something needs the decoder and the disk to itself. The engine calls it when
 * playback starts and when an export starts, and calls the returned `release()` when that ends:
 *
 *   const release = holdProxies('playback')   // … later: release()
 *
 * While any hold is out, no new proxy is started and the one being made pauses: the page stops acknowledging its
 * written pieces, so the worker's encoder stalls after at most one more 4 MB piece (it waits for each ack). Holds
 * nest (playback during an export): work resumes when the last one is released. `release` is idempotent. `reason`
 * is for debugging (`proxyHolds()`, `window.__videoMedia.holds()`).
 */
export function holdProxies(reason: string): () => void {
  const key = Symbol(reason)
  holds.set(key, String(reason).slice(0, 40))
  return () => {
    if (!holds.delete(key) || holds.size) return
    const w = holdWaiters
    holdWaiters = []
    w.forEach((f) => f())
    for (const cb of [...releasedListeners]) { try { cb() } catch { /* a listener's own error */ } }
  }
}
/** The reasons proxies are held for now (empty: not held). */
export const proxyHolds = (): string[] => [...holds.values()]
export const proxiesHeld = () => holds.size > 0
/** Resolves at once, or when the last hold is released. */
export const proxiesUnheld = (): Promise<void> => (holds.size ? new Promise((r) => holdWaiters.push(r)) : Promise.resolve())
/** Called whenever the last hold is released (the proxy queue starts its next job). */
export function onProxiesReleased(cb: () => void): () => void { releasedListeners.add(cb); return () => { releasedListeners.delete(cb) } }

export interface MediaInfo {
  codec: string | null
  fps: number | null
  width: number | null
  height: number | null
  duration: number
  hasAudio: boolean
  sizeBytes: number
  /** Longest key-frame gap measured near the start (s), or null when unknown (pictures, sound, not read yet). */
  keyframeInterval: number | null
  proxy: ProxyState
  missing: boolean
}

/** What is known about a bin entry, for the bin and the engine. Null for an unknown id. */
export function mediaInfo(assetId: string): MediaInfo | null {
  const a = assetById(assetId)
  if (!a) return null
  const m = metaFor(assetId) ?? {}
  return {
    codec: m.codec ?? null,
    fps: m.fps ?? null,
    width: a.width ?? null,
    height: a.height ?? null,
    duration: a.duration,
    hasAudio: !!a.hasAudio,
    sizeBytes: a.size,
    keyframeInterval: m.keyframeInterval ?? null,
    // a proxy that belongs to the file before a relink is not this entry's proxy
    proxy: m.proxy === 'ready' && !proxyIsCurrent(a, m) ? 'none' : m.proxy ?? 'none',
    missing: !!a.missing,
  }
}

// ---------------------------------------------------------------- cache/

export const CACHE_KEY_RE = /^[a-z0-9-]{1,80}$/
export const CACHE_MAX_ENTRY = 32 * 1024 * 1024
/** The browser keeps the cache in memory for the session, at most this much in all. */
const MEMORY_CACHE_MAX = 256 * 1024 * 1024
const memoryCache = new Map<string, Uint8Array>()
let memoryBytes = 0

function checkKey(key: string) {
  if (typeof key !== 'string' || !CACHE_KEY_RE.test(key)) throw new Error('Cache keys are 1 to 80 characters of a-z, 0-9 and -')
}

/**
 * Read a cache entry (waveform peaks, filmstrip frames…) from the project's cache/ folder — the app's own library
 * when the project has no folder yet; memory in the browser. Null when there is none.
 */
export async function readCache(key: string): Promise<Uint8Array | null> {
  checkKey(key)
  const b = videoBridge()
  if (b?.videoCacheRead) return (await b.videoCacheRead(currentFolder()?.id ?? null, key)) ?? null
  return memoryCache.get(key) ?? null
}

/**
 * Keep a cache entry (at most 32 MB) under `key` ([a-z0-9-]{1,80}). Rejects when the key is bad, the entry too large
 * or the cache full (1 GB per folder); nothing is evicted, so the caller simply recomputes next time.
 */
export async function writeCache(key: string, bytes: Uint8Array): Promise<void> {
  checkKey(key)
  if (!(bytes instanceof Uint8Array) || bytes.length > CACHE_MAX_ENTRY) throw new Error('Cache entries are at most 32 MB')
  const b = videoBridge()
  if (b?.videoCacheWrite) { await b.videoCacheWrite(currentFolder()?.id ?? null, key, bytes); return }
  const old = memoryCache.get(key)?.length ?? 0
  if (memoryBytes - old + bytes.length > MEMORY_CACHE_MAX) throw new Error('The session cache is full')
  memoryCache.set(key, bytes.slice())
  memoryBytes += bytes.length - old
}

// ---------------------------------------------------------------- reading a file's facts

/** Over 1080p by picture size (either side past 1920 × 1080, in either orientation). */
export const isOver1080p = (w?: number, h?: number) => !!w && !!h && (Math.max(w, h) > 1920 || Math.min(w, h) > 1080)
/** Key frames at least this far apart make scrubbing slow: such footage gets a proxy. Phones and cameras write a key
 * frame every 0.5-1 s (and exports from editors every 2-10 s); with the earlier "more than 1 s" rule the common 1 s
 * GOP got none. The proxy itself has a key frame every 0.5 s, so it never asks for a proxy of its own. */
export const LONG_GOP_SECONDS = 0.5

/** Footage that should be edited on a proxy: over 1080p, or larger than 540p with key frames 0.5 s or more apart. */
export function wantsProxy(a: Pick<MediaAsset, 'type' | 'width' | 'height' | 'missing'>, m: Pick<AssetMeta, 'keyframeInterval'>): boolean {
  if (a.type !== 'video' || a.missing) return false
  if (isOver1080p(a.width, a.height)) return true
  // a proxy is 540 on the short side: a source that small or smaller would only be scaled up, so it never gets one
  if (!a.width || !a.height || Math.min(a.width, a.height) <= 540) return false
  // a hair under 0.5 s (0.4999 from rounding the packet times) still counts
  return (m.keyframeInterval ?? 0) >= LONG_GOP_SECONDS - 0.005
}

/** The proxy's picture size: 540 on the short side, the long side in proportion, both even. */
export function proxySize(w: number, h: number): { width: number; height: number } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
  return w >= h ? { width: even((540 * w) / h), height: 540 } : { width: 540, height: even((540 * h) / w) }
}

/** The longest gap between key frames near the start of a track (up to 12 gaps or 30 s), from packet metadata only
 * (no decoding). A track with a single key frame has an interval of its whole length. */
export async function keyframeIntervalOf(track: InputVideoTrack): Promise<number | undefined> {
  const sink = new EncodedPacketSink(track)
  const opts = { metadataOnly: true }
  let k = await sink.getFirstKeyPacket(opts)
  if (!k) return undefined
  const first = k.timestamp
  let prev = first
  let gap = 0
  let n = 0
  while (n < 12 && prev - first < 30) {
    const next = await sink.getNextKeyPacket(k, opts)
    if (!next) break
    gap = Math.max(gap, next.timestamp - prev)
    prev = next.timestamp
    k = next
    n++
  }
  if (n === 0) {
    const d = await track.computeDuration()
    return Number.isFinite(d) ? d - first : undefined
  }
  return gap
}

/** Codec, frame rate and key-frame interval of a file's video track (packet metadata; nothing is decoded). */
export async function analyzeMedia(url: string): Promise<Pick<AssetFacts, 'codec' | 'fps' | 'keyframeInterval'>> {
  const input = inputFor(url)
  try {
    const v = await input.getPrimaryVideoTrack()
    const out: Pick<AssetFacts, 'codec' | 'fps' | 'keyframeInterval'> = {}
    if (!v) {
      const a = await input.getPrimaryAudioTrack()
      if (a?.codec) out.codec = a.codec
      return out
    }
    if (v.codec) out.codec = v.codec
    try { const st = await v.computePacketStats(120); if (st.averagePacketRate > 0) out.fps = Math.round(st.averagePacketRate * 100) / 100 } catch { /* unknown */ }
    try { const k = await keyframeIntervalOf(v); if (k != null) out.keyframeInterval = Math.round(k * 1000) / 1000 } catch { /* unknown */ }
    return out
  } finally {
    input.dispose()
  }
}

// dev server only: the shot harness seeds bin states through this handle (like window.__videoStore)
if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV && typeof window !== 'undefined') Object.assign(window, { __videoMeta: useMediaMeta })
