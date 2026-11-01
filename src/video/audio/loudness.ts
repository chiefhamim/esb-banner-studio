// EBU R128 / ITU-R BS.1770-4 loudness: K-weighting, momentary (400 ms) and short-term (3 s) loudness every 100 ms,
// gated integrated loudness, loudness range (EBU Tech 3342) and true peak (4× oversampled). Pure TS over Float32Array
// PCM, one array per channel. Measured against ffmpeg's `ebur128` filter in tools/unit/video-audio-loudness.test.ts.

/** Below this a level is silence (no measurable loudness). */
export const SILENCE = -Infinity

export interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }

/** The two K-weighting stages for a sample rate (the BS.1770 pre-filter and RLB high-pass, bilinear form as in
 * libebur128, so 48 kHz gives the published coefficients and other rates match ffmpeg). */
export function kWeighting(sampleRate: number): [Biquad, Biquad] {
  let f0 = 1681.974450955533
  const G = 3.999843853973347
  let Q = 0.7071752369554196
  let K = Math.tan((Math.PI * f0) / sampleRate)
  const Vh = Math.pow(10, G / 20)
  const Vb = Math.pow(Vh, 0.4996667741545416)
  let a0 = 1 + K / Q + K * K
  const shelf: Biquad = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  }
  f0 = 38.13547087602444
  Q = 0.5003270373238773
  K = Math.tan((Math.PI * f0) / sampleRate)
  a0 = 1 + K / Q + K * K
  const hp: Biquad = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 }
  return [shelf, hp]
}

/** Run one biquad over a signal (direct form II transposed, double precision state). */
export function biquad(x: ArrayLike<number>, f: Biquad, out: Float64Array = new Float64Array(x.length)): Float64Array {
  let z1 = 0
  let z2 = 0
  for (let i = 0; i < x.length; i++) {
    const v = x[i]
    const y = f.b0 * v + z1
    z1 = f.b1 * v - f.a1 * y + z2
    z2 = f.b2 * v - f.a2 * y
    out[i] = y
  }
  return out
}

/** The K-weighted signal of one channel. */
export function kWeigh(x: Float32Array, sampleRate: number): Float64Array {
  const [a, b] = kWeighting(sampleRate)
  const y = biquad(x, a)
  return biquad(y, b, y)
}

/** BS.1770 channel weights: L, R, C = 1, surrounds 1.41, LFE 0 (5.1 order L R C LFE Ls Rs). */
export function channelWeights(n: number): number[] {
  if (n === 6) return [1, 1, 1, 0, 1.41, 1.41]
  if (n === 5) return [1, 1, 1, 1.41, 1.41]
  return Array.from({ length: n }, () => 1)
}

const toLufs = (power: number) => (power > 0 ? -0.691 + 10 * Math.log10(power) : SILENCE)
const toPower = (lufs: number) => Math.pow(10, (lufs + 0.691) / 10)

export interface LoudnessReport {
  /** Gated integrated loudness, LUFS (−Infinity for silence). */
  integrated: number
  /** Loudness range, LU. */
  range: number
  /** 10th and 95th percentile short-term loudness used for the range. */
  rangeLow: number
  rangeHigh: number
  /** Momentary loudness (400 ms) and short-term loudness (3 s) every 100 ms; entry i is the window ending at (i+1)·0.1 s.
   *  Windows that are not full yet (the first 0.3 s / 2.9 s) hold −Infinity. */
  momentary: Float32Array
  shortTerm: Float32Array
  /** Highest momentary / short-term values. */
  momentaryMax: number
  shortTermMax: number
  /** True peak (4× oversampled), dBTP, over all channels; and the plain sample peak, dBFS. */
  truePeak: number
  samplePeak: number
  /** Per channel true peak, dBTP. */
  truePeakPerChannel: number[]
}

export interface LoudnessOptions {
  /** Channel weights (default BS.1770 by channel count). */
  weights?: number[]
  /** Skip the true-peak pass (the slowest part). */
  truePeak?: boolean
}

/** Measure a whole signal. `channels` are equal-length Float32Arrays. */
export function measureLoudness(channels: Float32Array[], sampleRate: number, opts: LoudnessOptions = {}): LoudnessReport {
  const weights = opts.weights ?? channelWeights(channels.length)
  const n = channels[0]?.length ?? 0
  const step = Math.round(sampleRate / 10) // 100 ms sub-blocks
  const blocks = Math.floor(n / step)
  // weighted mean-square energy per 100 ms sub-block, summed over channels
  const sub = new Float64Array(blocks)
  channels.forEach((ch, c) => {
    const w = weights[c] ?? 1
    if (!w) return
    const k = kWeigh(ch, sampleRate)
    for (let b = 0; b < blocks; b++) {
      let s = 0
      const o = b * step
      for (let i = 0; i < step; i++) { const v = k[o + i]; s += v * v }
      sub[b] += w * s
    }
  })
  const windowed = (len: number) => {
    const out = new Float32Array(blocks).fill(SILENCE)
    const pw = new Float64Array(blocks).fill(-1)
    let acc = 0
    for (let b = 0; b < blocks; b++) {
      acc += sub[b]
      if (b >= len) acc -= sub[b - len]
      if (b >= len - 1) {
        const p = Math.max(0, acc) / (len * step)
        pw[b] = p
        out[b] = toLufs(p)
      }
    }
    return { lufs: out, power: pw }
  }
  const m = windowed(4)
  const s = windowed(30)

  // integrated: 400 ms blocks every 100 ms, absolute gate −70, relative gate −10 LU
  const gated: number[] = []
  for (let b = 0; b < blocks; b++) if (m.power[b] >= 0 && m.lufs[b] > -70) gated.push(m.power[b])
  let integrated = SILENCE
  if (gated.length) {
    const rel = toLufs(gated.reduce((a, v) => a + v, 0) / gated.length) - 10
    const kept = gated.filter((p) => toLufs(p) > rel)
    if (kept.length) integrated = toLufs(kept.reduce((a, v) => a + v, 0) / kept.length)
  }

  // loudness range: short-term every 100 ms, absolute −70, relative −20 LU, 10th–95th percentile
  const st: number[] = []
  for (let b = 0; b < blocks; b++) if (s.power[b] >= 0 && s.lufs[b] > -70) st.push(s.power[b])
  let range = 0
  let rangeLow = SILENCE
  let rangeHigh = SILENCE
  if (st.length) {
    const rel = toLufs(st.reduce((a, v) => a + v, 0) / st.length) - 20
    const kept = st.map(toLufs).filter((l) => l > rel).sort((a, b) => a - b)
    if (kept.length) {
      rangeLow = kept[Math.floor((kept.length - 1) * 0.1 + 0.5)]
      rangeHigh = kept[Math.floor((kept.length - 1) * 0.95 + 0.5)]
      range = rangeHigh - rangeLow
    }
  }

  let samplePeak = 0
  for (const ch of channels) for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > samplePeak) samplePeak = a }
  const perCh = opts.truePeak === false ? channels.map(() => SILENCE) : channels.map((ch) => toDb(truePeakOf(ch)))
  const maxOf = (a: Float32Array) => a.reduce((x, v) => (v > x ? v : x), SILENCE)
  return {
    integrated,
    range,
    rangeLow,
    rangeHigh,
    momentary: m.lufs,
    shortTerm: s.lufs,
    momentaryMax: maxOf(m.lufs),
    shortTermMax: maxOf(s.lufs),
    truePeak: perCh.reduce((a, v) => Math.max(a, v), SILENCE),
    samplePeak: toDb(samplePeak),
    truePeakPerChannel: perCh,
  }
}

export const toDb = (lin: number) => (lin > 0 ? 20 * Math.log10(lin) : SILENCE)
export const fromDb = (db: number) => (db === SILENCE ? 0 : Math.pow(10, db / 20))
export { toPower as lufsToPower }

// ---------------------------------------------------------------- true peak

export const OVERSAMPLE = 4

function besselI0(x: number) {
  let s = 1
  let t = 1
  for (let k = 1; k < 40; k++) { t *= (x / (2 * k)) ** 2; s += t; if (t < 1e-12 * s) break }
  return s
}

/** Polyphase interpolation filter (Kaiser-windowed sinc): phase p gives the value at n + p/4 from the `taps`
 * samples around n. Each phase is normalised to unity gain at DC. */
export function interpolator(taps = 32, cutoff = 0.99, beta = 8): Float64Array[] {
  const L = OVERSAMPLE
  const N = taps * L
  const out: Float64Array[] = []
  for (let p = 0; p < L; p++) {
    const h = new Float64Array(taps)
    let sum = 0
    for (let k = 0; k < taps; k++) {
      const d = k - taps / 2 + 1 - p / L // distance (input samples) from the output point
      const idx = d * L + N / 2
      const win = idx < 0 || idx > N ? 0 : besselI0(beta * Math.sqrt(Math.max(0, 1 - ((2 * idx) / N - 1) ** 2))) / besselI0(beta)
      const sinc = d === 0 ? cutoff : Math.sin(Math.PI * d * cutoff) / (Math.PI * d)
      h[k] = sinc * win
      sum += h[k]
    }
    for (let k = 0; k < taps; k++) h[k] /= sum
    out.push(h)
  }
  return out
}

let PHASES: Float64Array[] | null = null

/** Per input sample, the largest |value| of the 4× oversampled signal in [n, n+1). */
export function truePeakEnvelope(x: Float32Array, phases?: Float64Array[]): Float32Array {
  const ph = phases ?? (PHASES ??= interpolator())
  const TAPS = ph[0].length
  const n = x.length
  const env = new Float32Array(n)
  const half = TAPS / 2 - 1
  for (let i = 0; i < n; i++) {
    let m = Math.abs(x[i])
    for (let p = 1; p < OVERSAMPLE; p++) {
      const h = ph[p]
      let s = 0
      for (let k = 0; k < TAPS; k++) {
        const j = i + k - half
        if (j >= 0 && j < n) s += h[k] * x[j]
      }
      const a = Math.abs(s)
      if (a > m) m = a
    }
    env[i] = m
  }
  return env
}

/** True peak of one channel (linear). */
export function truePeakOf(x: Float32Array): number {
  const e = truePeakEnvelope(x)
  let m = 0
  for (let i = 0; i < e.length; i++) if (e[i] > m) m = e[i]
  return m
}
