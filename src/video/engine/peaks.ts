// Real waveforms: peaks computed from the decoded PCM of a file's sound, at several resolutions, and kept in the
// project cache (writeCache) so a reopened project draws them at once. Never a placeholder: a clip whose sound is not
// read yet shows no waveform, and one that could not be read says so in its tooltip.
//
// Levels: the base level has BASE_RATE bins per second; each next level merges 4 bins (200, 50, 12.5, 3.125 bins/s).
// A bin is the min and max sample (−127..127, all channels) over its span. The timeline draws the coarsest level that
// still has at least one bin per pixel.

import { AudioBufferSink } from 'mediabunny'
import { inputFor } from '../media'
import { cacheKey, readCache, writeCache } from './mediaSource'
import { yieldToPlayback } from './background'

export const BASE_RATE = 200
export const LEVELS = 4

export interface Peaks {
  duration: number
  /** Bins per second of each level (level 0 = BASE_RATE). */
  rates: number[]
  /** Per level: interleaved [min, max] Int8 pairs. */
  levels: Int8Array[]
}

const q = (v: number) => Math.max(-127, Math.min(127, Math.round(v * 127)))

/** Accumulates PCM into base-level bins as pieces arrive (any order of channel count; pieces in time order). */
export class PeakBuilder {
  private min: number[] = []
  private max: number[] = []
  readonly rate: number
  constructor(rate = BASE_RATE) { this.rate = rate }

  /** Add `channels` (equal lengths) whose first sample is at `t0` seconds. */
  add(channels: Float32Array[], sampleRate: number, t0: number) {
    if (!channels.length) return
    const n = channels[0].length
    const perBin = sampleRate / this.rate
    let bin = Math.floor(t0 * this.rate)
    let next = (bin + 1) * perBin - t0 * sampleRate // samples until the next bin starts
    let lo = this.min[bin] ?? 1
    let hi = this.max[bin] ?? -1
    for (let i = 0; i < n; i++) {
      if (i >= next) {
        this.min[bin] = lo
        this.max[bin] = hi
        bin++
        next += perBin
        lo = this.min[bin] ?? 1
        hi = this.max[bin] ?? -1
      }
      for (const ch of channels) { const v = ch[i]; if (v < lo) lo = v; if (v > hi) hi = v }
    }
    this.min[bin] = lo
    this.max[bin] = hi
  }

  finish(duration: number): Peaks {
    const bins = Math.max(this.min.length, Math.ceil(duration * this.rate))
    const base = new Int8Array(bins * 2)
    for (let i = 0; i < bins; i++) {
      const lo = this.min[i]
      const hi = this.max[i]
      base[i * 2] = lo == null || lo > hi ? 0 : q(lo)
      base[i * 2 + 1] = hi == null || lo > hi ? 0 : q(hi)
    }
    return pyramid(base, this.rate, duration)
  }
}

/** The coarser levels from the base: each merges 4 bins of the one above. */
export function pyramid(base: Int8Array, rate: number, duration: number, levels = LEVELS): Peaks {
  const out: Int8Array[] = [base]
  const rates = [rate]
  for (let l = 1; l < levels; l++) {
    const prev = out[l - 1]
    const n = Math.ceil(prev.length / 2 / 4)
    const next = new Int8Array(n * 2)
    for (let i = 0; i < n; i++) {
      let lo = 127
      let hi = -127
      for (let k = 0; k < 4; k++) {
        const j = (i * 4 + k) * 2
        if (j >= prev.length) break
        lo = Math.min(lo, prev[j])
        hi = Math.max(hi, prev[j + 1])
      }
      next[i * 2] = lo > hi ? 0 : lo
      next[i * 2 + 1] = lo > hi ? 0 : hi
    }
    out.push(next)
    rates.push(rates[l - 1] / 4)
  }
  return { duration, rates, levels: out }
}

/** The level to draw at `pxPerSecond`: the coarsest with at least one bin per pixel. */
export function levelFor(p: Peaks, pxPerSecond: number): number {
  for (let l = p.levels.length - 1; l >= 0; l--) if (p.rates[l] >= pxPerSecond) return l
  return 0
}

// ---------------------------------------------------------------- bytes (for the cache)

const MAGIC = 0x45535750 // "ESWP"

export function packPeaks(p: Peaks): Uint8Array {
  const head = 4 * (4 + p.levels.length * 2)
  const total = head + p.levels.reduce((n, l) => n + l.length, 0)
  const buf = new ArrayBuffer(total)
  const dv = new DataView(buf)
  dv.setUint32(0, MAGIC)
  dv.setUint32(4, 1) // format version
  dv.setFloat32(8, p.duration)
  dv.setUint32(12, p.levels.length)
  let off = head
  p.levels.forEach((l, i) => {
    dv.setFloat32(16 + i * 8, p.rates[i])
    dv.setUint32(20 + i * 8, l.length)
    new Int8Array(buf, off, l.length).set(l)
    off += l.length
  })
  return new Uint8Array(buf)
}

export function unpackPeaks(bytes: Uint8Array): Peaks | null {
  try {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (dv.getUint32(0) !== MAGIC || dv.getUint32(4) !== 1) return null
    const duration = dv.getFloat32(8)
    const n = dv.getUint32(12)
    if (n < 1 || n > 12) return null
    let off = 16 + n * 8
    const rates: number[] = []
    const levels: Int8Array[] = []
    for (let i = 0; i < n; i++) {
      rates.push(dv.getFloat32(16 + i * 8))
      const len = dv.getUint32(20 + i * 8)
      if (off + len > bytes.byteLength) return null
      levels.push(new Int8Array(bytes.buffer.slice(bytes.byteOffset + off, bytes.byteOffset + off + len)))
      off += len
    }
    return { duration, rates, levels }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- building from a file

export type PeakState = { state: 'ready'; peaks: Peaks } | { state: 'pending' } | { state: 'none'; why: string }

const known = new Map<string, PeakState>()
const queue: { url: string; identity: string }[] = []
let running = false
const listeners = new Set<() => void>()
/** Called when any waveform finishes (the timeline redraws). */
export const onPeaks = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }

/** The waveform of a file's sound: ready, being read, or unavailable (with why). Starts reading it the first time it
 * is asked for; files are read one at a time in the background. `identity` names the file (path + size + mtime). */
export function peaksFor(url: string, identity = url): PeakState {
  const k = cacheKey('wf', identity)
  const s = known.get(k)
  if (s) return s
  known.set(k, { state: 'pending' })
  queue.push({ url, identity })
  void pump()
  return { state: 'pending' }
}

async function pump() {
  if (running) return
  running = true
  try {
    while (queue.length) {
      const job = queue.shift()!
      const k = cacheKey('wf', job.identity)
      let res: PeakState
      try {
        const cached = await readCache(k)
        const p = cached ? unpackPeaks(cached) : null
        if (p) res = { state: 'ready', peaks: p }
        else {
          const built = await buildPeaks(job.url)
          if (built) { res = { state: 'ready', peaks: built }; void writeCache(k, packPeaks(built)) } else res = { state: 'none', why: 'no sound the app can read' }
        }
      } catch (e) {
        res = { state: 'none', why: (e as Error).message || 'could not read the sound' }
      }
      known.set(k, res)
      listeners.forEach((fn) => fn())
    }
  } finally {
    running = false
  }
}

/** Decode a file's whole sound once (mediabunny, in pieces) and reduce it to peaks. */
export async function buildPeaks(url: string): Promise<Peaks | null> {
  const input = inputFor(url)
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track || !(await track.canDecode())) return null
    const sink = new AudioBufferSink(track)
    const b = new PeakBuilder()
    let end = 0
    let slice = performance.now()
    for await (const wb of sink.buffers()) {
      await yieldToPlayback()
      const chans: Float32Array[] = []
      for (let c = 0; c < wb.buffer.numberOfChannels; c++) chans.push(wb.buffer.getChannelData(c))
      b.add(chans, wb.buffer.sampleRate, Math.max(0, wb.timestamp))
      end = Math.max(end, wb.timestamp + wb.duration)
      // yield every ~30 ms of work so a long file never blocks the desk
      if (performance.now() - slice > 30) { await new Promise((r) => setTimeout(r, 0)); slice = performance.now() }
    }
    return b.finish(end)
  } finally {
    input.dispose()
  }
}
