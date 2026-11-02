// A small in-place radix-2 FFT and the STFT pieces the denoiser and the onset detector share. Pure TS, no DOM.

/** Precomputed twiddles and bit reversal for one power-of-two size. */
export class FFT {
  readonly n: number
  private cos: Float64Array
  private sin: Float64Array
  private rev: Uint32Array
  constructor(n: number) {
    if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`FFT size must be a power of two (got ${n})`)
    this.n = n
    this.cos = new Float64Array(n / 2)
    this.sin = new Float64Array(n / 2)
    for (let i = 0; i < n / 2; i++) { this.cos[i] = Math.cos((2 * Math.PI * i) / n); this.sin[i] = -Math.sin((2 * Math.PI * i) / n) }
    this.rev = new Uint32Array(n)
    const bits = Math.log2(n)
    for (let i = 0; i < n; i++) {
      let r = 0
      for (let b = 0; b < bits; b++) r = (r << 1) | ((i >> b) & 1)
      this.rev[i] = r
    }
  }

  /** Forward transform in place (`inverse` = true: inverse, scaled by 1/n). */
  transform(re: Float64Array, im: Float64Array, inverse = false) {
    const n = this.n
    for (let i = 0; i < n; i++) {
      const j = this.rev[i]
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t }
    }
    const sgn = inverse ? -1 : 1
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1
      const step = n / size
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step]
          const wi = sgn * this.sin[k * step]
          const a = start + k
          const b = a + half
          const tr = re[b] * wr - im[b] * wi
          const ti = re[b] * wi + im[b] * wr
          re[b] = re[a] - tr
          im[b] = im[a] - ti
          re[a] += tr
          im[a] += ti
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n }
  }
}

/** Periodic Hann window (sums to a constant at 50 % and 75 % overlap). */
export function hann(n: number): Float64Array {
  const w = new Float64Array(n)
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)
  return w
}

/** Number of STFT frames that cover `len` samples with `hop`, padding `size` at each end. */
export const frameCount = (len: number, size: number, hop: number) => Math.ceil((len + size) / hop) + 1

/** Average several channels into one (the analysis signal for onsets, silence and transcription). */
export function downmix(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]
  const n = channels[0]?.length ?? 0
  const out = new Float32Array(n)
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i]
  const k = 1 / channels.length
  for (let i = 0; i < n; i++) out[i] *= k
  return out
}
