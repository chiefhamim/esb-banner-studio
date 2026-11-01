// The media pipeline: every bin entry gets its facts read (quick hash from main, codec / fps / key-frame interval
// from the container's packet metadata), and heavy footage (over 1080p, or key frames more than 1 s apart) gets a
// 540p H.264 proxy made in the background — one at a time, in a worker (proxyWorker.ts), with progress and cancel.
// Proxies are named by the source's hash in the project's proxies/ (or the app's library before the project has a
// folder), so they survive a restart: on open a finished one is found again, a half-made one is redone. Proxies are
// for the preview only (`previewUrlFor`); exports always read the original (`exportUrlFor`).

import { useVideoStore } from './videoStore'
import type { AssetMeta } from './media'
import { analyzeMedia, currentFolder, exportUrlFor, mediaInfo, metaFor, patchMeta, previewUrlFor, proxyBecameReady, proxySize, useMediaMeta, videoBridge, wantsProxy } from './media'
import type { MediaAsset } from './timeline'

const assetOf = (id: string): MediaAsset | undefined => useVideoStore.getState().mediaAssets.find((a) => a.id === id)

// ---------------------------------------------------------------- facts

const FACT_CONCURRENCY = 2
const inFlight = new Set<string>()
let active = 0
const waiting: (() => void)[] = []
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= FACT_CONCURRENCY) await new Promise<void>((r) => waiting.push(r))
  active++
  try { return await fn() } finally { active--; waiting.shift()?.() }
}

/** Read one entry's facts for its current URL, then see whether it has (or needs) a proxy. */
async function readFacts(id: string, url: string) {
  const a = assetOf(id)
  if (!a || a.url !== url) return
  const b = videoBridge()
  const before = metaFor(id) ?? {}
  // a different file than the facts were read from (a relink): its old proxy no longer applies
  const patch: Partial<AssetMeta> = before.analyzedUrl && before.analyzedUrl !== url ? { proxy: 'none', proxyUrl: undefined, proxyProgress: undefined, proxyCancelled: false, hash: undefined } : {}
  if (b?.videoMediaFacts && /^esb-media:/i.test(url)) {
    try { const [f] = await b.videoMediaFacts([url]); if (f?.hash) patch.hash = f.hash } catch { /* no hash: no relink-by-hash or proxy for it */ }
  }
  if (a.type !== 'image') Object.assign(patch, await analyzeMedia(url).catch(() => ({})))
  if (assetOf(id)?.url !== url) return // relinked meanwhile; the newer read wins
  patchMeta(id, { ...patch, analyzedUrl: url })
  await checkProxy(id)
}

/** A finished proxy for this entry is used; otherwise one is queued when the footage needs it. */
async function checkProxy(id: string) {
  const a = assetOf(id)
  const m = metaFor(id)
  if (!a || !m || a.type !== 'video') return
  const needed = wantsProxy(a, m)
  patchMeta(id, { proxyNeeded: needed })
  const b = videoBridge()
  if (!b?.videoProxyStatus || !m.hash) { if (m.proxy !== 'ready') patchMeta(id, { proxy: 'none' }); return }
  const st = await b.videoProxyStatus(currentFolder()?.id ?? null, [m.hash]).catch(() => ({} as Record<string, string>))
  if (st[m.hash]) { proxyBecameReady(id, st[m.hash]); return }
  if (!needed || m.proxyCancelled || useMediaMeta.getState().settings.proxies === 'off') { patchMeta(id, { proxy: 'none' }); return }
  enqueueProxy(id)
}

function scan() {
  for (const a of useVideoStore.getState().mediaAssets) {
    if (a.missing || !a.url || inFlight.has(a.id)) continue
    if (metaFor(a.id)?.analyzedUrl === a.url) continue
    inFlight.add(a.id)
    void limited(() => readFacts(a.id, a.url)).catch(() => {}).finally(() => inFlight.delete(a.id))
  }
}

let timer: ReturnType<typeof setTimeout> | undefined
const schedule = () => { clearTimeout(timer); timer = setTimeout(scan, 30) }

let started = false
/** Start watching the bin (idempotent; the Video desk calls it when it opens). */
export function startMediaPipeline() {
  if (started || typeof window === 'undefined') return
  started = true
  useVideoStore.subscribe((s, prev) => { if (s.mediaAssets !== prev.mediaAssets) schedule() })
  schedule()
  // read-only handles for the tests and the engine's debugging (the page already holds all of this)
  Object.assign(window, { __videoMedia: { previewUrlFor, exportUrlFor, mediaInfo, meta: metaFor, folder: currentFolder, assets: () => useVideoStore.getState().mediaAssets.map((x) => ({ id: x.id, name: x.name })) } })
}

// ---------------------------------------------------------------- the proxy queue

const queue: string[] = []
let running: { id: string; worker: Worker | null; cancelled: boolean } | null = null

/** Queue a proxy for an entry (no-op if it is queued or being made). */
export function enqueueProxy(id: string) {
  if (queue.includes(id) || running?.id === id) return
  patchMeta(id, { proxy: 'pending', proxyProgress: 0, proxyError: undefined, proxyCancelled: false })
  queue.push(id)
  void runNext()
}

/** Stop making an entry's proxy (queued or running). It is not made again by itself; Make proxy queues it again. */
export function cancelProxy(id: string) {
  const i = queue.indexOf(id)
  if (i >= 0) { queue.splice(i, 1); patchMeta(id, { proxy: 'none', proxyCancelled: true, proxyProgress: undefined }); return }
  if (running?.id === id) { running.cancelled = true; running.worker?.postMessage({ type: 'cancel' }) }
}

/** Make (or make again) an entry's proxy on request. */
export function retryProxy(id: string) {
  patchMeta(id, { proxyCancelled: false })
  enqueueProxy(id)
}

type Result = { kind: 'done'; ms: number } | { kind: 'canceled' } | { kind: 'error'; error: string }

async function runNext(): Promise<void> {
  if (running) return
  const id = queue.shift()
  if (!id) return
  const a = assetOf(id)
  const m = metaFor(id)
  const b = videoBridge()
  if (!a || a.missing || !a.url) { void runNext(); return } // left the bin (another project) while queued
  if (!m?.hash || !a.width || !a.height || !b?.videoProxyBegin || !b.videoProxyWrite || !b.videoProxyEnd) {
    patchMeta(id, { proxy: 'failed', proxyError: 'A proxy needs the desktop app and a readable file.' })
    void runNext()
    return
  }
  const job: { id: string; worker: Worker | null; cancelled: boolean } = { id, worker: null, cancelled: false }
  running = job
  let jobId: string | null = null
  try {
    jobId = (await b.videoProxyBegin(currentFolder()?.id ?? null, m.hash)).id
    const { width, height } = proxySize(a.width, a.height)
    const write = b.videoProxyWrite
    const jid = jobId
    const result = await new Promise<Result>((resolve) => {
      const w = new Worker(new URL('./proxyWorker.ts', import.meta.url), { type: 'module' })
      job.worker = w
      w.onerror = (ev) => resolve({ kind: 'error', error: ev.message || 'the proxy worker stopped' })
      w.onmessage = (ev: MessageEvent) => {
        const msg = ev.data as { type: string; n?: number; position?: number; data?: Uint8Array; p?: number; ms?: number; error?: string }
        if (msg.type === 'write') {
          write(jid, msg.position!, msg.data!).then(() => w.postMessage({ type: 'ack', n: msg.n }), (e: unknown) => w.postMessage({ type: 'nack', n: msg.n, error: String((e as Error)?.message || e) }))
        } else if (msg.type === 'progress') patchMeta(id, { proxyProgress: Math.max(0, Math.min(1, msg.p ?? 0)) })
        else if (msg.type === 'done') resolve({ kind: 'done', ms: msg.ms ?? 0 })
        else if (msg.type === 'canceled') resolve({ kind: 'canceled' })
        else if (msg.type === 'error') resolve({ kind: 'error', error: msg.error ?? 'the proxy could not be made' })
      }
      w.postMessage({ type: 'start', url: a.url, width, height })
      if (job.cancelled) w.postMessage({ type: 'cancel' })
    })
    job.worker?.terminate()
    if (result.kind === 'done') {
      const r = await b.videoProxyEnd(jobId, true)
      if (r?.url) proxyBecameReady(id, r.url, result.ms)
      else patchMeta(id, { proxy: 'failed', proxyError: 'The proxy file did not check out.' })
    } else {
      await b.videoProxyEnd(jobId, false)
      patchMeta(id, result.kind === 'canceled' ? { proxy: 'none', proxyCancelled: true, proxyProgress: undefined } : { proxy: 'failed', proxyError: result.error, proxyProgress: undefined })
    }
  } catch (e) {
    job.worker?.terminate()
    if (jobId) await b.videoProxyEnd(jobId, false).catch(() => null)
    patchMeta(id, { proxy: 'failed', proxyError: String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '').slice(0, 200), proxyProgress: undefined })
  } finally {
    running = null
    void runNext()
  }
}

/** Forget the queue (a different project is put on the desk); a proxy being made finishes, since it is keyed by hash. */
export function clearProxyQueue() {
  queue.splice(0, queue.length)
}

/** Re-check every entry's proxy (the project got a folder, or proxies were switched on). */
export function recheckProxies() {
  for (const a of useVideoStore.getState().mediaAssets) if (a.type === 'video' && metaFor(a.id)?.analyzedUrl) void checkProxy(a.id)
}
