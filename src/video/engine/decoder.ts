// One decoder per source file: mediabunny demuxes it and WebCodecs decodes it (VideoSampleSink). Frames land in the
// shared FrameCache under (url, frame index). Two ways in:
//   exact(t)       the frame shown at source time t, for a paused monitor (scrub, step). Requests coalesce: while one
//                  decode runs, only the newest waiting request is kept, so a fast scrub never queues up stale work;
//                  while scrubbing a long-GOP file the key frame before t is shown first (one decode).
//   FrameStream    sequential decode from a point, kept a short distance ahead of the playhead (look-ahead while
//                  playing). A stream that falls behind is restarted at the playhead (frames are dropped, never late).

import { EncodedPacketSink, VideoSampleSink } from 'mediabunny'
import type { Input, VideoSample } from 'mediabunny'
import { inputFor } from '../media'
import type { FrameCache, FrameEntry } from './frameCache'

export type DecoderState = 'opening' | 'ready' | 'failed'

/** Copy a decoded sample out of the decoder into an ImageBitmap (so the decoder's few buffers are free at once). */
export async function sampleToEntry(sample: VideoSample, maxHeight = 0): Promise<FrameEntry> {
  const frame = sample.toVideoFrame()
  const w = sample.displayWidth
  const h = sample.displayHeight
  const scale = maxHeight > 0 && h > maxHeight ? maxHeight / h : 1
  const rw = Math.max(1, Math.round(w * scale))
  const rh = Math.max(1, Math.round(h * scale))
  try {
    const bmp = scale < 1 ? await createImageBitmap(frame, { resizeWidth: rw, resizeHeight: rh, resizeQuality: 'low' }) : await createImageBitmap(frame)
    return { image: bmp, width: rw, height: rh, timestamp: sample.timestamp, bytes: rw * rh * 4, close: () => bmp.close() }
  } finally {
    try { frame.close() } catch { /* closed */ }
    try { sample.close() } catch { /* closed */ }
  }
}

let exactChain: Promise<void> = Promise.resolve()
/** Wait for the turn to decode an exact frame; call the returned function when done. */
function exactTurn(): Promise<() => void> {
  let release!: () => void
  const mine = new Promise<void>((r) => { release = r })
  const turn = exactChain.then(() => release)
  exactChain = exactChain.then(() => mine)
  return turn
}

export class SourceDecoder {
  state: DecoderState = 'opening'
  fps = 30
  first = 0
  width = 0
  height = 0
  duration = 0
  /** Every frame is a key frame (a proxy, an intra-only file): an exact frame is one decode. */
  allKey = false
  readonly ready: Promise<boolean>
  private input: Input | null = null
  private sink: VideoSampleSink | null = null
  private packets: EncodedPacketSink | null = null
  private busy = false
  private waiting: { t: number; resolve: (e: FrameEntry | null) => void } | null = null
  private streams = new Set<FrameStream>()
  disposed = false
  /** Decode time of the last exact frames, ms (scrub latency, for the stats). */
  lastExactMs = 0
  /** When a waiting request was last replaced by a newer one (a fast scrub). */
  private replacedAt = -Infinity
  /** A frame to hold arrived while the exact one is still decoding (the monitor redraws). */
  onHold: () => void = () => {}

  readonly url: string
  readonly cache: FrameCache
  /** Decoded frames are scaled to at most this height (0 = full size): the monitor's device-pixel height for the
   * preview, full size for a golden still. */
  maxHeight: number
  constructor(url: string, cache: FrameCache, maxHeight = 0) {
    this.url = url
    this.cache = cache
    this.maxHeight = maxHeight
    this.ready = this.open()
  }

  /** Why the decoder could not be used (the preview then shows the file through its <video> element). */
  failure = ''

  /** Open, once more after a short wait if the first try fails (a decoder query can fail under load). */
  private async open(): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (await this.tryOpen()) return true
      if (this.failure === 'no video track' || this.disposed) break
      await new Promise((r) => setTimeout(r, 150))
    }
    this.state = 'failed'
    if (typeof console !== 'undefined' && !this.disposed) console.warn(`[video engine] ${this.failure}; using the <video> element for this file`)
    return false
  }

  private async tryOpen(): Promise<boolean> {
    try {
      this.input = inputFor(this.url)
      const track = await this.input.getPrimaryVideoTrack()
      if (!track) { this.failure = 'no video track'; this.fail(); return false }
      if (!(await track.canDecode())) { this.failure = 'this codec cannot be decoded here'; this.fail(); return false }
      this.width = track.displayWidth
      this.height = track.displayHeight
      this.first = await track.getFirstTimestamp()
      const stats = await track.computePacketStats(120)
      if (stats.averagePacketRate > 0 && Number.isFinite(stats.averagePacketRate)) this.fps = Math.round(stats.averagePacketRate * 1000) / 1000
      this.allKey = await track.hasOnlyKeyPackets().catch(() => false)
      this.duration = await this.input.computeDuration().catch(() => 0)
      if (this.disposed) { this.failure = 'closed'; this.fail(); return false }
      this.sink = new VideoSampleSink(track)
      this.packets = new EncodedPacketSink(track)
      this.state = 'ready'
      return true
    } catch (e) {
      this.failure = (e as Error)?.message || 'the file could not be read'
      this.fail()
      return false
    }
  }

  private fail() {
    try { this.input?.dispose() } catch { /* gone */ }
    this.input = null
  }

  /** The frame index shown at source time t. */
  index(t: number): number { return Math.max(0, Math.floor((t - this.first) * this.fps + 1e-3)) }
  private indexOfSample(ts: number) { return Math.max(0, Math.round((ts - this.first) * this.fps)) }

  /** Bytes one decoded frame takes at the current size (look-ahead sizing). */
  frameBytes(): number {
    const h = this.maxHeight > 0 && this.height > this.maxHeight ? this.maxHeight : this.height
    const w = this.height > 0 ? Math.round(this.width * (h / this.height)) : this.width
    return Math.max(1, w * h * 4)
  }

  peek(t: number): FrameEntry | undefined { return this.cache.peek(this.url, this.index(t)) }

  /** The exact frame at source time t (cached, or decoded now). Resolves null when a newer request replaced it, the
   * decoder was disposed, or the frame could not be decoded; never rejects. */
  exact(t: number): Promise<FrameEntry | null> {
    const hit = this.cache.get(this.url, this.index(t))
    if (hit) return Promise.resolve(hit)
    if (this.disposed) return Promise.resolve(null)
    return new Promise((resolve) => {
      if (this.waiting) { this.waiting.resolve(null); this.replacedAt = performance.now() }
      this.waiting = { t, resolve }
      void this.drain()
    })
  }

  private async drain() {
    if (this.busy) return
    this.busy = true
    try {
      const ok = await this.ready
      while (this.waiting) {
        const { t, resolve } = this.waiting
        this.waiting = null
        if (!ok || this.disposed || !this.sink) { resolve(null); continue }
        let e: FrameEntry | null = null
        // one exact decode at a time across every source: parallel seeks of several layers fight over the hardware
        // decoder (3 layers: p50 117 ms in parallel, ~20 ms each one after another)
        const release = await exactTurn()
        try { const newer = this.waiting as { t: number } | null; e = newer && this.index(newer.t) !== this.index(t) ? null : await this.decodeExact(t) } catch { e = null } finally { release() }
        resolve(this.disposed ? null : e)
      }
    } catch {
      // never leave a caller waiting
      this.waiting?.resolve(null)
      this.waiting = null
    } finally {
      this.busy = false
    }
  }

  /** Decode the frame at t: one getSample (mediabunny decodes from the key frame before t; measured faster than
   * walking the GOP frame by frame). While the editor scrubs fast (a request replaced another moments ago) on a
   * long-GOP file, the key frame before t is decoded first — one decode — and shown as the held frame, so the
   * picture follows the cursor while the exact frame is still being decoded. */
  private async decodeExact(t: number): Promise<FrameEntry | null> {
    const idx = this.index(t)
    const hit = this.cache.get(this.url, idx)
    if (hit) return hit
    const sink = this.sink
    if (!sink) return null
    const at = Math.max(this.first, t)
    const t0 = performance.now()
    try {
      if (!this.allKey && this.packets && performance.now() - this.replacedAt < 150) {
        const key = await this.packets.getKeyPacket(at).catch(() => null)
        if (key && this.index(key.timestamp) < idx - 2 && !this.cache.has(this.url, this.index(key.timestamp))) {
          const ks = await sink.getSample(key.timestamp).catch(() => null)
          if (ks && (await this.keep(ks, -1))) this.onHold()
          if (this.waiting || this.disposed) return null
        }
      }
      const s = await sink.getSample(at).catch(() => null)
      return s ? await this.keep(s, idx) : null
    } finally {
      this.lastExactMs = performance.now() - t0
    }
  }

  /** Copy a sample into the cache (and alias `idx` to it when the frame covers more than one index). */
  private async keep(s: VideoSample, idx: number): Promise<FrameEntry | null> {
    const si = this.indexOfSample(s.timestamp)
    let e: FrameEntry
    try { e = await sampleToEntry(s, this.maxHeight) } catch { return null }
    if (this.disposed) { e.close(); return null }
    this.cache.put(this.url, si, e)
    // a frame that lasts longer than one index (a still, a low-fps file) answers every index it covers
    if (idx >= 0 && si !== idx) this.cache.alias(this.url, idx, si)
    return e
  }

  /** Start sequential decode from source time t (look-ahead while playing). */
  stream(t: number): FrameStream | null {
    if (this.state !== 'ready' || !this.sink || this.disposed) return null
    const s = new FrameStream(this, this.sink, t)
    this.streams.add(s)
    s.done.then(() => this.streams.delete(s))
    return s
  }

  /** @internal A frame a stream decoded. Closed instead once the decoder is disposed, so frames decoded after
   * dropSource never land in the cache. */
  async store(sample: VideoSample): Promise<FrameEntry | null> {
    if (this.disposed) { try { sample.close() } catch { /* closed */ } return null }
    let e: FrameEntry
    try { e = await sampleToEntry(sample, this.maxHeight) } catch { return null }
    if (this.disposed) { e.close(); return null }
    this.cache.put(this.url, this.indexOfSample(e.timestamp), e)
    return e
  }

  dispose() {
    this.disposed = true
    for (const s of this.streams) s.stop()
    this.waiting?.resolve(null)
    this.waiting = null
    try { this.input?.dispose() } catch { /* gone */ }
    this.input = null
    this.sink = null
    this.packets = null
    this.state = 'failed'
  }
}

/** Sequential decode, kept `ahead` seconds in front of a target the engine moves forward each frame. While it is far
 * enough ahead it sleeps until the target moves (no polling). */
export class FrameStream {
  /** Source time of the last frame decoded. */
  last = -Infinity
  stopped = false
  readonly done: Promise<void>
  private iter: AsyncIterator<VideoSample>
  private dec: SourceDecoder
  private wake: (() => void) | null = null
  private _target: number
  readonly from: number
  constructor(dec: SourceDecoder, sink: VideoSampleSink, from: number) {
    this.dec = dec
    this.from = from
    this._target = from + 0.25
    this.iter = sink.samples(Math.max(dec.first, from))[Symbol.asyncIterator]()
    this.done = this.run()
  }

  /** Decode up to here (source seconds); the engine moves it as the playhead moves. */
  get target() { return this._target }
  set target(v: number) {
    this._target = v
    if (this.last < v) this.poke()
  }

  private poke() { const w = this.wake; this.wake = null; w?.() }

  private async run() {
    try {
      while (!this.stopped) {
        if (this.last >= this._target) {
          // sleep until the target moves past what is decoded (or stop); a long timeout only as a safety net
          await new Promise<void>((r) => { this.wake = r; setTimeout(() => { if (this.wake === r) this.poke() }, 250) })
          continue
        }
        const { value, done } = await this.iter.next()
        if (done || !value) break
        if (this.stopped) { value.close(); break }
        const ts = value.timestamp
        await this.dec.store(value)
        // counted only once the frame is in the cache (the clock waits on this before it starts)
        this.last = ts
      }
    } catch { /* the source went away */ } finally {
      this.stopped = true
      try { await this.iter.return?.() } catch { /* closed */ }
    }
  }

  stop() { this.stopped = true; this.poke() }
}
