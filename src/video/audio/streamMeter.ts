// A streaming EBU R128 meter: feed the signal in pieces (10 s at a time) and read the same report `measureLoudness`
// gives for the whole signal, without ever holding the signal. The K-weighting filters keep their state across pieces
// and the 100 ms sub-block energies are collected as they complete; the gated integrated loudness and the range come
// from `summarizeBlocks`, the same code the whole-signal meter uses. The true peak is the expensive part (4× polyphase,
// 32 taps), so it is only computed in sub-blocks whose sample peak is within `TP_WINDOW_DB` of the loudest seen so far:
// an inter-sample peak is never more than ~3 dB over its neighbouring samples in real material, so the maximum is found
// where the samples are already near it. (`exactTruePeak: true` computes every block.)

import { kWeighting, summarizeBlocks, toDb, truePeakEnvelope, channelWeights } from './loudness'
import type { Biquad, LoudnessReport } from './loudness'

const TP_WINDOW_DB = 4
const MARGIN = 48

interface Stage { z1: number; z2: number }
const run = (x: number, f: Biquad, s: Stage) => {
  const y = f.b0 * x + s.z1
  s.z1 = f.b1 * x - f.a1 * y + s.z2
  s.z2 = f.b2 * x - f.a2 * y
  return y
}

export interface StreamMeterOptions { truePeak?: boolean; exactTruePeak?: boolean; weights?: number[] }

export class StreamMeter {
  private readonly step: number
  private readonly filters: [Biquad, Biquad]
  private readonly st: { a: Stage; b: Stage }[]
  private readonly weights: number[]
  private readonly opts: StreamMeterOptions
  private sub: number[] = []
  private carry: number[]
  private curN = 0
  private samples = 0
  private samplePeak = 0
  private tpMax = 0
  private tails: Float32Array[]
  constructor(sampleRate: number, channels = 2, opts: StreamMeterOptions = {}) {
    this.step = Math.round(sampleRate / 10)
    this.filters = kWeighting(sampleRate)
    this.st = Array.from({ length: channels }, () => ({ a: { z1: 0, z2: 0 }, b: { z1: 0, z2: 0 } }))
    this.weights = opts.weights ?? channelWeights(channels)
    this.opts = opts
    this.carry = Array.from({ length: channels }, () => 0)
    this.tails = Array.from({ length: channels }, () => new Float32Array(0))
  }

  /** Samples fed so far. */
  get length() { return this.samples }
  /** Running (not final) sample peak, linear. */
  get peak() { return this.samplePeak }

  push(chans: Float32Array[]) {
    const n = chans[0]?.length ?? 0
    if (!n) return
    const [f1, f2] = this.filters
    // K-weighted energy of each completed 100 ms sub-block, summed over the channels; a block begun in an earlier piece
    // carries its energy so far in `carry`
    const done: number[][] = []
    let k0 = this.curN
    chans.forEach((ch, c) => {
      const w = this.weights[c] ?? 1
      const s = this.st[c]
      const list: number[] = []
      let e = this.carry[c]
      let k = this.curN
      for (let i = 0; i < n; i++) {
        const y = run(run(ch[i], f1, s.a), f2, s.b)
        e += y * y
        if (++k === this.step) { list.push(w * e); e = 0; k = 0 }
      }
      this.carry[c] = e
      k0 = k
      done.push(list)
    })
    for (let b = 0; b < done[0].length; b++) { let e = 0; for (const l of done) e += l[b]; this.sub.push(e) }
    this.curN = k0
    this.samples += n

    // peaks
    for (let c = 0; c < chans.length; c++) {
      const ch = chans[c]
      for (let i = 0; i < n; i++) { const a = Math.abs(ch[i]); if (a > this.samplePeak) this.samplePeak = a }
    }
    if (this.opts.truePeak !== false) this.truePeakPiece(chans)
  }

  private truePeakPiece(chans: Float32Array[]) {
    const exact = !!this.opts.exactTruePeak
    const B = this.step
    const n = chans[0].length
    chans.forEach((ch, c) => {
      const tail = this.tails[c]
      const ext = new Float32Array(tail.length + n)
      ext.set(tail, 0)
      ext.set(ch, tail.length)
      const off = tail.length
      for (let a = 0; a < n; a += B) {
        const b = Math.min(n, a + B)
        let sp = 0
        for (let i = a; i < b; i++) { const v = Math.abs(ch[i]); if (v > sp) sp = v }
        if (!exact && sp < this.samplePeak * Math.pow(10, -TP_WINDOW_DB / 20)) continue
        if (sp === 0) continue
        const lo = Math.max(0, off + a - MARGIN)
        const hi = Math.min(ext.length, off + b + MARGIN)
        const env = truePeakEnvelope(ext.subarray(lo, hi))
        for (let i = off + a - lo; i < off + b - lo; i++) if (env[i] > this.tpMax) this.tpMax = env[i]
      }
      this.tails[c] = ch.slice(Math.max(0, n - MARGIN))
    })
  }

  /** The report so far (the unfinished 100 ms block is not counted). */
  report(): LoudnessReport {
    const sub = Float64Array.from(this.sub)
    const { m, s, integrated, range, rangeLow, rangeHigh } = summarizeBlocks(sub, this.step)
    const blocks = sub.length
    const momentary = new Float32Array(blocks)
    const shortTerm = new Float32Array(blocks)
    for (let b = 0; b < blocks; b++) { momentary[b] = m.lufs[b]; shortTerm[b] = s.lufs[b] }
    const maxOf = (a: Float32Array) => a.reduce((x, v) => (v > x ? v : x), -Infinity)
    const tp = this.opts.truePeak === false ? -Infinity : toDb(this.tpMax)
    return {
      integrated, range, rangeLow, rangeHigh, momentary, shortTerm,
      momentaryMax: maxOf(momentary), shortTermMax: maxOf(shortTerm),
      truePeak: tp, samplePeak: toDb(this.samplePeak),
      truePeakPerChannel: [tp],
    }
  }
}
