// Speed-changed sound, pure TypeScript, shared by the preview (pieces scheduled on Web Audio) and the export (offline
// mix): the same samples come out of both.
//
// A clip's sound at timeline time τ comes from source time map(τ) (engine/animation.ts sourceTimeAt — constant speed,
// ramps, reverse, freeze all look the same from here). Two ways to make it:
//
//   preservePitch (default)  WSOLA — waveform-similarity overlap-add. Output is built from 42.7 ms Hann grains every
//                            21.3 ms (50 % overlap, the windows sum to 1). Grain k is centred on the source position the
//                            mapping gives for its centre, moved by up to ±10 ms to the offset whose waveform best
//                            continues the previous grain (normalised cross-correlation, searched on a 4× decimated
//                            mono signal, then refined ±4 samples at full rate). A reverse grain reads the source
//                            backwards. |rate| < 0.05 is silence (a freeze frame has no sound).
//   resample                 the source read at map(τ) with linear interpolation: the pitch follows the speed (2× is an
//                            octave up), like a tape.
//
// Quality: tones and speech keep their pitch from 0.25× to 4× (a 440 Hz tone at 2× measures 440 Hz); below ~0.5×
// steady sounds get a slight phasiness and transients smear by up to a grain; above ~4× words lose syllables (grains
// skip source). Rate exactly 1 never comes here (the plain path copies samples).
//
// Grain positions are kept per grain index, so rendering consecutive ranges (the export's 10 s pieces, the preview's
// half-second pieces) joins seamlessly; a jump simply starts a new chain.

/** Random access to one stretch of source PCM (absolute source sample indexes; outside = silence). */
export interface PcmWindow {
  sampleRate: number
  /** First source sample held. */
  start: number
  /** Per channel. */
  channels: Float32Array[]
  /** Source samples outside [lo, hi) are silent (the clip's source span). */
  lo: number
  hi: number
}

export interface StretchOptions {
  /** Output sample rate (48 kHz in this app). */
  outRate: number
  channels: number
  /** Source seconds at clip-local timeline seconds. */
  map: (tLocal: number) => number
  /** |speed| at clip-local seconds (0 = frozen). */
  rate: (tLocal: number) => number
  preservePitch: boolean
}

export const GRAIN = 2048
const HOP = GRAIN / 2
const SEARCH = 480
const DEC = 4
const REFINE = 4
const SILENT_RATE = 0.05

/** Periodic Hann: overlapping by half, the windows add up to exactly 1. */
const WINDOW = (() => { const w = new Float32Array(GRAIN); for (let i = 0; i < GRAIN; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / GRAIN); return w })()

function sampleAt(ch: Float32Array, w: PcmWindow, pos: number): number {
  if (pos < w.lo || pos >= w.hi - 1) return 0
  const p = pos - w.start
  const i = Math.floor(p)
  if (i < 0 || i + 1 >= ch.length) return 0
  const f = p - i
  return ch[i] + (ch[i + 1] - ch[i]) * f
}

export class SpeedRenderer {
  readonly o: StretchOptions
  /** Chosen source centre (source samples) and direction of each grain already placed. */
  private chosen = new Map<number, { c: number; d: number }>()
  private monoT = new Float32Array(GRAIN / DEC + 1)
  private monoC = new Float32Array(GRAIN / DEC + 1 + (2 * SEARCH) / DEC + 2)
  constructor(o: StretchOptions) { this.o = o }

  /** Source sample range [lo, hi) needed to render output samples [n0, n0 + len) (clip-local, at outRate). */
  neededSource(n0: number, len: number, srcRate: number): [number, number] {
    const { outRate } = this.o
    let lo = Infinity
    let hi = -Infinity
    const step = Math.max(1, Math.floor(HOP / 2))
    for (let n = n0 - GRAIN; n <= n0 + len + GRAIN; n += step) {
      const s = this.o.map(Math.max(0, n) / outRate) * srcRate
      if (s < lo) lo = s
      if (s > hi) hi = s
    }
    const pad = GRAIN * 4 + SEARCH + 8
    return [Math.floor(lo - pad), Math.ceil(hi + pad)]
  }

  /** Render clip-local output samples [n0, n0 + len) from `src`. */
  render(src: PcmWindow, n0: number, len: number): Float32Array[] {
    const out = Array.from({ length: this.o.channels }, () => new Float32Array(Math.max(0, len)))
    if (len <= 0) return out
    if (!this.o.preservePitch) this.resample(src, n0, len, out)
    else this.wsola(src, n0, len, out)
    return out
  }

  private resample(src: PcmWindow, n0: number, len: number, out: Float32Array[]) {
    const { outRate, map, rate } = this.o
    const ratio = src.sampleRate
    // the mapping is evaluated every 32 samples and interpolated between
    const STEP = 32
    for (let s = 0; s < len; s += STEP) {
      const m = Math.min(STEP, len - s)
      const t0 = (n0 + s) / outRate
      const t1 = (n0 + s + m) / outRate
      if (rate(t0) < SILENT_RATE && rate(t1) < SILENT_RATE) continue
      const p0 = map(t0) * ratio
      const p1 = map(t1) * ratio
      for (let j = 0; j < m; j++) {
        const p = p0 + ((p1 - p0) * j) / m
        for (let ch = 0; ch < out.length; ch++) out[ch][s + j] = sampleAt(src.channels[Math.min(ch, src.channels.length - 1)], src, p)
      }
    }
  }

  private wsola(src: PcmWindow, n0: number, len: number, out: Float32Array[]) {
    const { outRate } = this.o
    const kFirst = Math.floor((n0 - GRAIN) / HOP) + 1
    const kLast = Math.floor((n0 + len - 1) / HOP)
    for (let k = Math.max(kFirst, -1); k <= kLast; k++) {
      const g = this.grain(src, k)
      if (!g) continue
      const ρ = src.sampleRate / outRate
      const begin = Math.max(0, k * HOP - n0)
      const end = Math.min(len, k * HOP + GRAIN - n0)
      for (let ch = 0; ch < out.length; ch++) {
        const data = src.channels[Math.min(ch, src.channels.length - 1)]
        const o = out[ch]
        for (let m = begin; m < end; m++) {
          const j = n0 + m - k * HOP
          o[m] += WINDOW[j] * sampleAt(data, src, g.c + g.d * (j - GRAIN / 2) * ρ)
        }
      }
    }
    // forget grains far behind (a long export would keep them all)
    if (this.chosen.size > 4096) for (const key of [...this.chosen.keys()]) if (key < kFirst - 8) this.chosen.delete(key)
  }

  /** Grain k: its chosen source centre and direction, or null when it is silent (frozen, or before the clip). */
  private grain(src: PcmWindow, k: number): { c: number; d: number } | null {
    const hit = this.chosen.get(k)
    if (hit) return hit.d === 0 ? null : hit
    const { outRate, map, rate } = this.o
    const tc = (k * HOP + GRAIN / 2) / outRate
    if (tc < 0) { this.chosen.set(k, { c: 0, d: 0 }); return null }
    const r = rate(tc)
    if (r < SILENT_RATE) { this.chosen.set(k, { c: 0, d: 0 }); return null }
    const ρ = src.sampleRate / outRate
    const target = map(tc) * src.sampleRate
    const ahead = map(tc + 0.005) - map(Math.max(0, tc - 0.005))
    const d = ahead < 0 ? -1 : 1
    const prev = this.chosen.get(k - 1)
    let c = target
    if (prev && prev.d === d) {
      // the natural continuation of the previous grain, and the offset of the target that looks most like it
      const nat = prev.c + d * HOP * ρ
      c = target + this.bestOffset(src, nat, target, d, ρ)
    }
    const g = { c, d }
    this.chosen.set(k, g)
    return g
  }

  private bestOffset(src: PcmWindow, nat: number, target: number, d: number, ρ: number): number {
    const nT = GRAIN / DEC
    const mono = (pos: number) => {
      let s = 0
      for (const ch of src.channels) s += sampleAt(ch, src, pos)
      return s / src.channels.length
    }
    const T = this.monoT
    let eT = 0
    for (let j = 0; j < nT; j++) { const v = mono(nat + d * (j * DEC - GRAIN / 2) * ρ); T[j] = v; eT += v * v }
    if (eT < 1e-9) return 0
    // candidate signal over the whole search range, decimated: C[i] = mono(target + d*((i*DEC) - SEARCH - GRAIN/2)*ρ)
    const C = this.monoC
    const nC = nT + Math.floor((2 * SEARCH) / DEC) + 1
    for (let i = 0; i < nC; i++) C[i] = mono(target + d * (i * DEC - SEARCH - GRAIN / 2) * ρ)
    let best = 0
    let bestScore = -Infinity
    for (let o = 0; o + nT <= nC; o++) {
      let xy = 0
      let yy = 0
      for (let j = 0; j < nT; j++) { const y = C[o + j]; xy += T[j] * y; yy += y * y }
      const score = yy > 1e-12 ? xy / Math.sqrt(yy) : -Infinity
      if (score > bestScore) { bestScore = score; best = o }
    }
    let off = best * DEC - SEARCH
    // refine at full rate
    let refined = off
    let rScore = -Infinity
    for (let r = -REFINE; r <= REFINE; r++) {
      const o = off + r
      let xy = 0
      let yy = 0
      for (let j = 0; j < GRAIN; j += 2) {
        const x = mono(nat + d * (j - GRAIN / 2) * ρ)
        const y = mono(target + d * (o + j - GRAIN / 2) * ρ)
        xy += x * y
        yy += y * y
      }
      const score = yy > 1e-12 ? xy / Math.sqrt(yy) : -Infinity
      if (score > rScore) { rScore = score; refined = o }
    }
    off = refined
    return d * off * ρ
  }
}

/** Dominant frequency of a mono signal between lo and hi Hz (Goertzel scan, 1 Hz steps, refined to 0.1 Hz). Tests. */
export function dominantFrequency(x: Float32Array, rate: number, lo = 50, hi = 4000): number {
  const power = (f: number) => {
    const w = (2 * Math.PI * f) / rate
    const cw = 2 * Math.cos(w)
    let s1 = 0
    let s2 = 0
    for (let i = 0; i < x.length; i++) { const s = x[i] + cw * s1 - s2; s2 = s1; s1 = s }
    return s1 * s1 + s2 * s2 - cw * s1 * s2
  }
  let best = lo
  let bp = -1
  for (let f = lo; f <= hi; f += 1) { const p = power(f); if (p > bp) { bp = p; best = f } }
  let fine = best
  for (let f = best - 1; f <= best + 1; f += 0.1) { const p = power(f); if (p > bp) { bp = p; fine = f } }
  return fine
}
