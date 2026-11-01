// Filmstrip thumbnails for footage clips on the timeline: small frames every `step` seconds of the file, decoded once
// (the proxy when there is one), packed into one JPEG sprite and kept in the project cache. The timeline's lane canvas
// draws the tiles of each clip's visible part; nothing here touches React.

import { VideoSampleSink } from 'mediabunny'
import { inputFor } from '../media'
import { cacheKey, readCache, writeCache } from './mediaSource'
import { backgroundHeld, yieldToPlayback } from './background'

export const THUMB_H = 48
const SPRITE_W = 4096

export interface Filmstrip {
  /** Seconds of source between tiles; tile i shows the frame at first + i·step. */
  step: number
  count: number
  tileW: number
  tileH: number
  cols: number
  /** Tiles decoded so far (a long file fills in while it is read). */
  ready: number
  image: ImageBitmap | null
}

/** Seconds between tiles for a file of `duration`: one a second, at most 600 tiles. */
export function stripStep(duration: number): number { return Math.max(1, duration / 600) }

/** Where tile `i` sits in the sprite. */
export function tileRect(f: Pick<Filmstrip, 'tileW' | 'tileH' | 'cols'>, i: number) {
  return { sx: (i % f.cols) * f.tileW, sy: Math.floor(i / f.cols) * f.tileH, sw: f.tileW, sh: f.tileH }
}

export type StripState = { state: 'ready' | 'partial'; strip: Filmstrip } | { state: 'pending' } | { state: 'none'; why: string }

// Sprites in memory: an LRU capped by bytes; a project switch releases the strips of media it no longer uses. A strip
// still being built is never evicted (its loop owns it).
const known = new Map<string, StripState>()
const urlOf = new Map<string, string>()
let knownBytes = 0
export const STRIP_BUDGET = 96 * 1024 * 1024
const stripBytes = (s: StripState | undefined) => (s && (s.state === 'ready' || s.state === 'partial') && s.strip.image ? s.strip.image.width * s.strip.image.height * 4 : 0)

/** Set a key's state, keeping the byte count and the LRU order (closing the sprite it replaces). */
function setKnown(key: string, next: StripState) {
  const old = known.get(key)
  if (old && old !== next) {
    knownBytes -= stripBytes(old)
    const oi = old.state === 'ready' || old.state === 'partial' ? old.strip.image : null
    const ni = next.state === 'ready' || next.state === 'partial' ? next.strip.image : null
    if (oi && oi !== ni && old.state === 'ready') oi.close()
  }
  known.delete(key)
  known.set(key, next)
  knownBytes += stripBytes(next)
  for (const [k, v] of known) {
    if (knownBytes <= STRIP_BUDGET) break
    if (k === key || v.state === 'pending' || v.state === 'partial') continue
    forget(k)
  }
}

function forget(key: string) {
  const v = known.get(key)
  if (!v || v.state === 'pending' || v.state === 'partial') return
  knownBytes -= stripBytes(v)
  if (v.state === 'ready') v.strip.image?.close()
  known.delete(key)
  urlOf.delete(key)
}

/** Release the sprites of every media URL not in `keep` (a different project is on the desk). They come back from
 * the project cache when needed again. */
export function releaseFilmstrips(keep: Set<string>) {
  for (const [k, u] of [...urlOf]) if (!keep.has(u)) forget(k)
}

export const filmstripMemory = () => ({ count: known.size, bytes: knownBytes })

const queue: { url: string; identity: string; key: string }[] = []
let running = false
const listeners = new Set<() => void>()
export const onFilmstrip = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
const notify = () => listeners.forEach((fn) => fn())

export function filmstripFor(url: string, identity = url): StripState {
  const key = cacheKey('fs', identity)
  const s = known.get(key)
  if (s) { known.delete(key); known.set(key, s); return s }
  urlOf.set(key, url)
  known.set(key, { state: 'pending' })
  queue.push({ url, identity, key })
  void pump()
  return { state: 'pending' }
}

// ---------------------------------------------------------------- bytes: [u32 header length][JSON header][JPEG]

async function pack(f: Filmstrip, sprite: OffscreenCanvas): Promise<Uint8Array> {
  const head = new TextEncoder().encode(JSON.stringify({ v: 1, step: f.step, count: f.count, tileW: f.tileW, tileH: f.tileH, cols: f.cols }))
  const jpeg = new Uint8Array(await (await sprite.convertToBlob({ type: 'image/jpeg', quality: 0.72 })).arrayBuffer())
  const out = new Uint8Array(4 + head.length + jpeg.length)
  new DataView(out.buffer).setUint32(0, head.length)
  out.set(head, 4)
  out.set(jpeg, 4 + head.length)
  return out
}

async function unpack(bytes: Uint8Array): Promise<Filmstrip | null> {
  try {
    const n = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0)
    const h = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + n)))
    if (h.v !== 1) return null
    const image = await createImageBitmap(new Blob([bytes.slice(4 + n)], { type: 'image/jpeg' }))
    return { step: h.step, count: h.count, tileW: h.tileW, tileH: h.tileH, cols: h.cols, ready: h.count, image }
  } catch {
    return null
  }
}

async function pump() {
  if (running) return
  running = true
  try {
    while (queue.length) {
      const job = queue.shift()!
      try {
        const cached = await readCache(job.key)
        const f = cached ? await unpack(cached) : null
        if (f) setKnown(job.key, { state: 'ready', strip: f })
        else await build(job.url, job.key)
      } catch (e) {
        setKnown(job.key, { state: 'none', why: (e as Error).message || 'could not read the picture' })
      }
      notify()
    }
  } finally {
    running = false
  }
}

async function build(url: string, key: string) {
  if (typeof OffscreenCanvas === 'undefined') { setKnown(key, { state: 'none', why: 'no canvas' }); return }
  const input = inputFor(url)
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track || !(await track.canDecode())) { setKnown(key, { state: 'none', why: 'the picture cannot be decoded here' }); return }
    const first = await track.getFirstTimestamp()
    const duration = await input.computeDuration()
    const step = stripStep(duration)
    const count = Math.max(1, Math.floor((duration - first) / step))
    const tileH = THUMB_H
    const tileW = Math.max(16, Math.min(128, Math.round(THUMB_H * (track.displayWidth / Math.max(1, track.displayHeight)))))
    const cols = Math.max(1, Math.floor(SPRITE_W / tileW))
    const sprite = new OffscreenCanvas(Math.min(count, cols) * tileW, Math.ceil(count / cols) * tileH)
    const ctx = sprite.getContext('2d')!
    const strip: Filmstrip = { step, count, tileW, tileH, cols, ready: 0, image: null }
    const sink = new VideoSampleSink(track)
    const times = Array.from({ length: count }, (_, i) => first + i * step + Math.min(step / 2, 0.04))
    let i = 0
    let lastShow = performance.now()
    // the decode pipeline reads ahead; when playback, a scrub or an export takes the decoder it is closed at once (not
    // left decoding its queue of key frames) and opened again from the next tile afterwards
    while (i < count) {
      const iter = sink.samplesAtTimestamps(times.slice(i))[Symbol.asyncIterator]()
      let paused = false
      try {
        while (i < count) {
          if (backgroundHeld().length) { paused = true; break }
          const { value: s, done } = await iter.next()
          if (done) { i = count; break }
          if (s) {
            const r = tileRect(strip, i)
            try { s.draw(ctx, r.sx, r.sy, r.sw, r.sh) } finally { s.close() }
          }
          i++
          strip.ready = i
          if (performance.now() - lastShow > 400 && i < count) {
            // show what is there while the rest is read
            const old = strip.image
            strip.image = await createImageBitmap(sprite)
            old?.close()
            setKnown(key, { state: 'partial', strip: { ...strip } })
            notify()
            lastShow = performance.now()
          }
        }
      } finally {
        try { await iter.return?.() } catch { /* closed */ }
      }
      if (paused) await yieldToPlayback()
    }
    const old = strip.image
    strip.image = await createImageBitmap(sprite)
    old?.close()
    setKnown(key, { state: 'ready', strip })
    void pack(strip, sprite).then((bytes) => writeCache(key, bytes)).catch(() => {})
  } finally {
    input.dispose()
  }
}
