// A streaming EBU R128 meter: feed the signal in pieces (10 s at a time) and read the same report `measureLoudness`
// gives for the whole signal, without ever holding the signal. The K-weighting filters keep their state across pieces
// and the 100 ms sub-block energies are collected as they complete; the gated integrated loudness and the range come
// from `summarizeBlocks`, the same code the whole-signal meter uses. The true peak is the expensive part (4× polyphase,
// 32 taps), so it is only computed in sub-blocks whose sample peak is within `TP_WINDOW_DB` of the loudest seen so far:
// an inter-sample peak is never more than ~3 dB over its neighbouring samples in real material, so the maximum is found
// where the samples are already near it. (`exactTruePeak: true` computes every block.)

import { interpolator, kWeighting, summarizeBlocks, toDb, toLufs, truePeakAt, channelWeights } from './loudness'
import type { Biquad, LoudnessReport } from './loudness'

const TP_WINDOW_DB = 4
const MARGIN = 48
const HALF = 15 // half the interpolator's 32 taps
let PH: Float64Array[] | null = null

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
  /** Per channel: index (in the kept tail + the next piece) of the first sample whose true peak is not worked out yet. */
  private tpFrom: number[]
  private bad = 0
  /** The tail's own contribution is not stored: report() finishes the last samples without changing the meter. */
  constructor(sampleRate: number, channels = 2, opts: StreamMeterOptions = {}) {
    this.step = Math.round(sampleRate / 10)
    this.filters = kWeighting(sampleRate)
    this.st = Array.from({ length: channels }, () => ({ a: { z1: 0, z2: 0 }, b: { z1: 0, z2: 0 } }))
    this.weights = opts.weights ?? channelWeights(channels)
    this.opts = opts
    this.carry = Array.from({ length: channels }, () => 0)
    this.tails = Array.from({ length: channels }, () => new Float32Array(0))
    this.tpFrom = Array.from({ length: channels }, () => 0)
  }

  /** Samples fed so far. */
  get length() { return this.samples }
  /** Running (not final) sample peak, linear. */
  get peak() { return this.samplePeak }
  /** NaN / infinite samples met so far (measured as 0). */
  get nonFinite() { return this.bad }

  /** Like push, but in slices of about a second with `pause` awaited between them (the desk stays responsive while a long
   * signal is fed). */
  async pushAsync(chans: Float32Array[], pause: () => Promise<void>, slice = 48000) {
    const n = chans[0]?.length ?? 0
    for (let a = 0; a < n; a += slice) {
      this.push(chans.map((c) => c.subarray(a, Math.min(n, a + slice))))
      await pause()
    }
  }

  push(chans: Float32Array[]) {
    const n = chans[0]?.length ?? 0
    if (!n) return
    chans = this.clean(chans)
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

  /** The signal with NaN / infinite samples replaced by 0 (the same arrays when there are none). */
  private clean(chans: Float32Array[]): Float32Array[] {
    let out: Float32Array[] | null = null
    for (let c = 0; c < chans.length; c++) {
      const ch = chans[c]
      let first = -1
      for (let i = 0; i < ch.length; i++) { const v = ch[i]; if (v - v !== 0) { first = i; break } } // NaN and ±Infinity: v − v is NaN
      if (first < 0) continue
      out ??= chans.slice()
      const copy = ch.slice()
      for (let i = first; i < copy.length; i++) if (copy[i] - copy[i] !== 0) { copy[i] = 0; this.bad++ }
      out[c] = copy
    }
    return out ?? chans
  }

  private gate(): number {
    if (this.opts.exactTruePeak) return 0
    return this.samplePeak > 0 ? this.samplePeak * Math.pow(10, -TP_WINDOW_DB / 20) : Infinity
  }

  /** Work out the true peak of the samples that can be finished (a sample needs 16 after it); the rest waits for the next
   * piece. Only around samples within TP_WINDOW_DB of the loudest so far. */
  private truePeakPiece(chans: Float32Array[]) {
    const ph = (PH ??= interpolator())
    const gate = this.gate()
    chans.forEach((ch, c) => {
      const tail = this.tails[c]
      const ext = new Float32Array(tail.length + ch.length)
      ext.set(tail, 0)
      ext.set(ch, tail.length)
      const upto = Math.max(0, ext.length - (HALF + 1)) // samples before this have all their taps
      this.tpMax = Math.max(this.tpMax, this.scan(ext, this.tpFrom[c], upto, gate, ph))
      const keepFrom = Math.max(0, ext.length - MARGIN)
      this.tpFrom[c] = Math.max(0, upto - keepFrom)
      this.tails[c] = ext.slice(keepFrom)
    })
  }

  /** The largest true peak over samples [from, to) of `x` that lie next to a sample of at least `gate`. */
  private scan(x: Float32Array, from: number, to: number, gate: number, ph: Float64Array[]): number {
    let m = 0
    let done = from - 1
    for (let i = Math.max(0, from); i < Math.min(to + 1, x.length); i++) {
      const a = Math.abs(x[i])
      if (gate !== 0 && (a < gate || a === 0)) continue
      for (let k = Math.max(from, i - 1, done + 1); k <= i && k < to; k++) { const v = truePeakAt(x, k, ph); if (v > m) m = v; done = k }
    }
    return m
  }

  /** The true peak (linear) with the last unfinished samples worked out as if the signal ended here. */
  private truePeakNow(): number {
    if (this.opts.truePeak === false) return 0
    const ph = (PH ??= interpolator())
    const gate = this.gate()
    let m = this.tpMax
    this.tails.forEach((t, c) => { m = Math.max(m, this.scan(t, this.tpFrom[c], t.length, gate, ph)) })
    return m
  }

  /** The report so far (the unfinished 100 ms block is not counted). */
  report(): LoudnessReport {
    const sub = Float64Array.from(this.sub)
    const { m, s, integrated: gated, range, rangeLow, rangeHigh } = summarizeBlocks(sub, this.step)
    let integrated = gated
    let shortMix = false
    // under 400 ms there is no gated block: report the ungated level of what there is (and say so), never "silent"
    if (!Number.isFinite(integrated) && sub.length < 4 && this.samples > 0) {
      let e = 0
      for (const v of sub) e += v
      for (let c = 0; c < this.carry.length; c++) e += (this.weights[c] ?? 1) * this.carry[c]
      const lufs = toLufs(e / this.samples)
      if (lufs > -70) { integrated = lufs; shortMix = true }
    }
    const blocks = sub.length
    const momentary = new Float32Array(blocks)
    const shortTerm = new Float32Array(blocks)
    for (let b = 0; b < blocks; b++) { momentary[b] = m.lufs[b]; shortTerm[b] = s.lufs[b] }
    const maxOf = (a: Float32Array) => a.reduce((x, v) => (v > x ? v : x), -Infinity)
    const tp = this.opts.truePeak === false ? -Infinity : toDb(this.truePeakNow())
    return {
      integrated, range, rangeLow, rangeHigh, momentary, shortTerm,
      momentaryMax: maxOf(momentary), shortTermMax: maxOf(shortTerm),
      truePeak: tp, samplePeak: toDb(this.samplePeak),
      ...(shortMix ? { shortMix } : {}), ...(this.bad ? { nonFinite: this.bad } : {}),
      truePeakPerChannel: [tp],
    }
  }
}
