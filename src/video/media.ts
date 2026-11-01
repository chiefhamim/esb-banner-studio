// Media for the Video desk: where a clip's file comes from and what is in it.
//
// Desktop app: files are chosen in the main process's own dialog (or dropped on the bin) and recorded by their real
// path. The renderer never names a path to read; it gets an `esb-media://m/<id>` URL for each file main has approved,
// served by main with range requests, so <video>, fetch and the decoder stream the file instead of copying it. A
// project keeps the paths, and reopening it asks main for fresh URLs (or reports the file missing, for relinking).
// Browser (dev server, tests): files come from an <input type=file> as object URLs and live for the session only.

import { ALL_FORMATS, BlobSource, Input, UrlSource } from 'mediabunny'
import type { MediaAsset } from './timeline'

export interface MediaEntry { path: string; name: string; size: number; mtimeMs: number; url: string }
export interface ResolvedEntry { path: string; url?: string; size?: number; mtimeMs?: number; missing?: boolean }

export interface VideoBridge {
  videoImport?: () => Promise<MediaEntry[]>
  videoImportDropped?: (files: File[]) => Promise<MediaEntry[]>
  videoRelink?: (name: string) => Promise<MediaEntry | null>
  videoResolve?: (paths: string[]) => Promise<ResolvedEntry[]>
  videoStoreStill?: (name: string, bytes: Uint8Array) => Promise<MediaEntry | null>
  videoStoreTake?: (name: string, bytes: Uint8Array) => Promise<MediaEntry | null>
  videoSaveProject?: (name: string, text: string, existing: string | null) => Promise<string | null>
  videoOpenProject?: () => Promise<{ path: string; text: string } | null>
  videoAutosave?: (text: string) => Promise<{ ok: boolean; at: number }>
  videoAutosaveLatest?: () => Promise<{ at: number; text: string } | null>
  videoAutosaveClear?: (projectId?: string) => Promise<boolean>
  videoExportBegin?: (name: string, kind: 'mp4' | 'webm') => Promise<{ id: string; path: string } | null>
  videoExportWrite?: (id: string, position: number, bytes: Uint8Array) => Promise<boolean>
  videoExportEnd?: (id: string, ok: boolean) => Promise<string | null>
  reveal?: (p: string) => Promise<unknown>
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
  if (!type) return null
  const p = await probeMedia(e.url, type)
  return { id: newAssetId(), name: e.name, type, url: e.url, path: e.path, size: e.size, mtimeMs: e.mtimeMs, duration: p.duration, width: p.width, height: p.height, hasAudio: p.hasAudio, thumbnailUrl: p.thumbnailUrl, generated }
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
