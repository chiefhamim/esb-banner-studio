// One decoder per source file: mediabunny demuxes it and WebCodecs decodes it (VideoSampleSink). Frames land in the
// shared FrameCache under (url, frame index). Two ways in:
//   exact(t)       the frame shown at source time t, for a paused monitor (scrub, step). Requests coalesce: while one
//                  decode runs, only the newest waiting request is kept, so a fast scrub never queues up stale work.
//   FrameStream    sequential decode from a point, kept a short distance ahead of the playhead (look-ahead while
//                  playing). A stream that falls behind is restarted at the playhead (frames are dropped, never late).

import { VideoSampleSink } from 'mediabunny'
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
    const bmp = scale < 1 ? await createImageBitmap(frame, { resizeWidth: rw, resizeHeight: rh, resizeQuality: 'medium' }) : await createImageBitmap(frame)
    return { image: bmp, width: rw, height: rh, timestamp: sample.timestamp, bytes: rw * rh * 4, close: () => bmp.close() }
  } finally {
    try { frame.close() } catch { /* closed */ }
    try { sample.close() } catch { /* closed */ }
  }
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
  private busy = false
  private waiting: { t: number; resolve: (e: FrameEntry | null) => void } | null = null
  private streams = new Set<FrameStream>()
  private disposed = false
  /** Decode time of the last exact frames, ms (scrub latency, for the stats). */
  lastExactMs = 0

  readonly url: string
  readonly cache: FrameCache
  readonly maxHeight: number
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
    if (typeof console !== 'undefined') console.warn(`[video engine] ${this.failure}; using the <video> element for this file`)
    return false
  }

  private async tryOpen(): Promise<boolean> {
    try {
      this.input = inputFor(this.url)
      const track = await this.input.getPrimaryVideoTrack()
      if (!track) { this.failure = 'no video track'; this.fail(); return false }
      if (!(await track.canDecode())) { this.failure = 'this codec cannot be decoded here'; this.fail(); return false }
      this.sink = new VideoSampleSink(track)
      this.width = track.displayWidth
      this.height = track.displayHeight
      this.first = await track.getFirstTimestamp()
      const stats = await track.computePacketStats(120)
      if (stats.averagePacketRate > 0 && Number.isFinite(stats.averagePacketRate)) this.fps = Math.round(stats.averagePacketRate * 1000) / 1000
      this.allKey = await track.hasOnlyKeyPackets().catch(() => false)
      this.duration = await this.input.computeDuration().catch(() => 0)
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

  peek(t: number): FrameEntry | undefined { return this.cache.peek(this.url, this.index(t)) }

  /** The exact frame at source time t (cached, or decoded now). Resolves null when a newer request replaced it. */
  exact(t: number): Promise<FrameEntry | null> {
    const hit = this.cache.get(this.url, this.index(t))
    if (hit) return Promise.resolve(hit)
    return new Promise((resolve) => {
      if (this.waiting) this.waiting.resolve(null)
      this.waiting = { t, resolve }
      void this.drain()
    })
  }

  private async drain() {
    if (this.busy) return
    this.busy = true
    try {
      if (!(await this.ready) || !this.sink) { this.waiting?.resolve(null); this.waiting = null; return }
      while (this.waiting) {
        const { t, resolve } = this.waiting
        this.waiting = null
        const idx = this.index(t)
        let e = this.cache.get(this.url, idx) ?? null
        if (!e) {
          const t0 = performance.now()
          const s = await this.sink.getSample(Math.max(this.first, t)).catch(() => null)
          if (s) {
            const si = this.indexOfSample(s.timestamp)
            e = await sampleToEntry(s, this.maxHeight)
            this.cache.put(this.url, si, e)
            // a frame that lasts longer than one index (a still, a low-fps file) answers every index it covers
            if (si !== idx) this.cache.put(this.url, idx, aliasOf(e))
          }
          this.lastExactMs = performance.now() - t0
        }
        resolve(e)
      }
    } finally {
      this.busy = false
    }
  }

  /** Start sequential decode from source time t (look-ahead while playing). */
  stream(t: number): FrameStream | null {
    if (this.state !== 'ready' || !this.sink) return null
    const s = new FrameStream(this, this.sink, t)
    this.streams.add(s)
    s.done.then(() => this.streams.delete(s))
    return s
  }

  /** @internal */ store(sample: VideoSample) {
    return sampleToEntry(sample, this.maxHeight).then((e) => { this.cache.put(this.url, this.indexOfSample(e.timestamp), e); return e })
  }

  dispose() {
    this.disposed = true
    for (const s of this.streams) s.stop()
    this.waiting?.resolve(null)
    this.waiting = null
    try { this.input?.dispose() } catch { /* gone */ }
    this.input = null
    this.sink = null
    this.state = 'failed'
  }
}

/** A second cache entry for the same picture (closing it does nothing; the original owns the bitmap). */
function aliasOf(e: FrameEntry): FrameEntry { return { ...e, bytes: 0, close: () => {} } }

/** Sequential decode, kept `ahead` seconds in front of a target the engine moves forward each frame. */
export class FrameStream {
  /** Source time of the last frame decoded. */
  last = -Infinity
  /** Decode up to here (source seconds); the engine moves it as the playhead moves. */
  target: number
  stopped = false
  readonly done: Promise<void>
  private iter: AsyncIterator<VideoSample>
  private dec: SourceDecoder
  readonly from: number
  constructor(dec: SourceDecoder, sink: VideoSampleSink, from: number) {
    this.dec = dec
    this.from = from
    this.target = from + 0.25
    this.iter = sink.samples(Math.max(dec.first, from))[Symbol.asyncIterator]()
    this.done = this.run()
  }

  private async run() {
    try {
      while (!this.stopped) {
        if (this.last >= this.target) { await new Promise((r) => setTimeout(r, 4)); continue }
        const { value, done } = await this.iter.next()
        if (done || !value) break
        if (this.stopped) { value.close(); break }
        this.last = value.timestamp
        await this.dec.store(value)
      }
    } catch { /* the source went away */ } finally {
      this.stopped = true
      try { await this.iter.return?.() } catch { /* closed */ }
    }
  }

  stop() { this.stopped = true }
}
