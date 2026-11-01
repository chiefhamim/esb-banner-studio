// Source sound for speed-changed clips: decoded in 2 s blocks (mediabunny AudioBufferSink, or a whole-file decode for a
// file it cannot read), kept in a small LRU, and handed to timeStretch.ts as one contiguous window. Reverse play walks
// the blocks backwards, so each block is still decoded once. Preview and export each open their own.

import { AudioBufferSink } from 'mediabunny'
import type { Input } from 'mediabunny'
import { inputFor } from '../media'
import type { PcmWindow } from './timeStretch'

const BLOCK_SECONDS = 2
const MAX_BLOCKS = 24

interface Block { index: number; channels: Float32Array[]; frames: number }

export class PcmSource {
  readonly url: string
  sampleRate = 48000
  channels = 2
  private input: Input | null = null
  private sink: AudioBufferSink | null = null
  private whole: AudioBuffer | null = null
  private blocks = new Map<number, Promise<Block | null>>()
  readonly ready: Promise<boolean>
  private disposed = false
  constructor(url: string, decodeWhole?: (url: string) => Promise<AudioBuffer | null>) {
    this.url = url
    this.ready = this.open(decodeWhole)
  }

  private async open(decodeWhole?: (url: string) => Promise<AudioBuffer | null>): Promise<boolean> {
    try {
      this.input = inputFor(this.url)
      const track = await this.input.getPrimaryAudioTrack()
      if (track && (await track.canDecode())) {
        this.sink = new AudioBufferSink(track)
        this.sampleRate = track.sampleRate
        this.channels = Math.max(1, Math.min(2, track.numberOfChannels))
        return true
      }
      if (!track) return false
    } catch { /* try the whole-file decode */ }
    try { this.input?.dispose() } catch { /* gone */ }
    this.input = null
    if (!decodeWhole) return false
    this.whole = await decodeWhole(this.url).catch(() => null)
    if (!this.whole) return false
    this.sampleRate = this.whole.sampleRate
    this.channels = Math.max(1, Math.min(2, this.whole.numberOfChannels))
    return true
  }

  private block(i: number): Promise<Block | null> {
    const hit = this.blocks.get(i)
    if (hit) { this.blocks.delete(i); this.blocks.set(i, hit); return hit }
    const p = this.decodeBlock(i)
    this.blocks.set(i, p)
    while (this.blocks.size > MAX_BLOCKS) this.blocks.delete(this.blocks.keys().next().value!)
    return p
  }

  private async decodeBlock(i: number): Promise<Block | null> {
    const rate = this.sampleRate
    const frames = Math.round(BLOCK_SECONDS * rate)
    const first = i * frames
    const chs = Array.from({ length: this.channels }, () => new Float32Array(frames))
    if (this.whole) {
      for (let c = 0; c < this.channels; c++) {
        const d = this.whole.getChannelData(Math.min(c, this.whole.numberOfChannels - 1))
        chs[c].set(d.subarray(Math.max(0, first), Math.min(d.length, first + frames)), 0)
      }
      return { index: i, channels: chs, frames }
    }
    if (!this.sink || this.disposed) return null
    try {
      for await (const wb of this.sink.buffers(first / rate, (first + frames) / rate)) {
        const at = Math.round(wb.timestamp * rate) - first
        const b = wb.buffer
        for (let c = 0; c < this.channels; c++) {
          const d = b.getChannelData(Math.min(c, b.numberOfChannels - 1))
          // copy the part of this decoded piece that falls inside the block
          const from = Math.max(0, -at)
          const to = Math.min(d.length, frames - at)
          if (to > from) chs[c].set(d.subarray(from, to), at + from)
        }
      }
    } catch { return null }
    return { index: i, channels: chs, frames }
  }

  /** The source samples [lo, hi) as one window (silence outside [spanLo, spanHi), the clip's source span). */
  async window(lo: number, hi: number, spanLo: number, spanHi: number): Promise<PcmWindow> {
    await this.ready
    const rate = this.sampleRate
    const frames = Math.round(BLOCK_SECONDS * rate)
    const a = Math.max(0, Math.floor(lo))
    const b = Math.max(a + 1, Math.ceil(hi))
    const chs = Array.from({ length: this.channels }, () => new Float32Array(b - a))
    for (let i = Math.floor(a / frames); i * frames < b; i++) {
      const blk = await this.block(i)
      if (!blk) continue
      const off = i * frames - a
      for (let c = 0; c < this.channels; c++) {
        const src = blk.channels[c]
        const from = Math.max(0, -off)
        const to = Math.min(src.length, b - a - off)
        if (to > from) chs[c].set(src.subarray(from, to), off + from)
      }
    }
    return { sampleRate: rate, start: a, channels: chs, lo: Math.max(a, Math.floor(spanLo)), hi: Math.min(b, Math.ceil(spanHi)) }
  }

  dispose() {
    this.disposed = true
    this.blocks.clear()
    try { this.input?.dispose() } catch { /* gone */ }
    this.input = null
    this.sink = null
    this.whole = null
  }
}
