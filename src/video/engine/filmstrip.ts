// Filmstrip thumbnails for footage clips on the timeline: small frames every `step` seconds of the file, decoded once
// (the proxy when there is one), packed into one JPEG sprite and kept in the project cache. The timeline's lane canvas
// draws the tiles of each clip's visible part; nothing here touches React.

import { VideoSampleSink } from 'mediabunny'
import { inputFor } from '../media'
import { cacheKey, readCache, writeCache } from './mediaSource'
import { yieldToPlayback } from './background'

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

const known = new Map<string, StripState>()
const queue: { url: string; identity: string; key: string }[] = []
let running = false
const listeners = new Set<() => void>()
export const onFilmstrip = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
const notify = () => listeners.forEach((fn) => fn())

export function filmstripFor(url: string, identity = url): StripState {
  const key = cacheKey('fs', identity)
  const s = known.get(key)
  if (s) return s
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
        if (f) known.set(job.key, { state: 'ready', strip: f })
        else await build(job.url, job.key)
      } catch (e) {
        known.set(job.key, { state: 'none', why: (e as Error).message || 'could not read the picture' })
      }
      notify()
    }
  } finally {
    running = false
  }
}

async function build(url: string, key: string) {
  if (typeof OffscreenCanvas === 'undefined') { known.set(key, { state: 'none', why: 'no canvas' }); return }
  const input = inputFor(url)
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track || !(await track.canDecode())) { known.set(key, { state: 'none', why: 'the picture cannot be decoded here' }); return }
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
    for await (const s of sink.samplesAtTimestamps(times)) {
      await yieldToPlayback()
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
        known.set(key, { state: 'partial', strip: { ...strip } })
        notify()
        lastShow = performance.now()
      }
    }
    const old = strip.image
    strip.image = await createImageBitmap(sprite)
    old?.close()
    known.set(key, { state: 'ready', strip })
    void pack(strip, sprite).then((bytes) => writeCache(key, bytes)).catch(() => {})
  } finally {
    input.dispose()
  }
}
