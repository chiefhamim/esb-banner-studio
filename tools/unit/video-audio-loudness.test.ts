// Phase 4 pre-build: EBU R128 loudness meter, normaliser and limiter, checked on synthetic signals and against
// ffmpeg's ebur128 filter on ffmpeg-made fixtures (±0.3 LU / ±0.3 dB; ffmpeg prints one decimal).
import { describe, expect, it } from 'vitest'
import { kWeighting, measureLoudness, truePeakOf } from '../../src/video/audio/loudness'
import { applyGain, limitTruePeak, normalizeGain, normalizeLoudness } from '../../src/video/audio/normalize'
import { ffEbur128, hasFfmpeg, lavfi, noise, sine, writeF32 } from './audio-fixtures'

const SR = 48000

describe('K-weighting', () => {
  it('gives the published BS.1770 coefficients at 48 kHz', () => {
    const [a, b] = kWeighting(48000)
    expect(a.b0).toBeCloseTo(1.53512485958697, 10)
    expect(a.b1).toBeCloseTo(-2.69169618940638, 10)
    expect(a.b2).toBeCloseTo(1.19839281085285, 10)
    expect(a.a1).toBeCloseTo(-1.69065929318241, 10)
    expect(a.a2).toBeCloseTo(0.73248077421585, 10)
    expect(b.a1).toBeCloseTo(-1.99004745483398, 10)
    expect(b.a2).toBeCloseTo(0.99007225036621, 10)
  })
})

describe('loudness meter (synthetic)', () => {
  it('reads a 1 kHz stereo sine at −23 dBFS as −23 LUFS (the EBU reference)', () => {
    const amp = Math.pow(10, -23 / 20)
    const s = sine(SR * 10, SR, 1000, amp)
    const r = measureLoudness([s, s], SR)
    expect(r.integrated).toBeCloseTo(-23, 1)
    expect(r.range).toBeLessThan(0.1)
    expect(r.samplePeak).toBeCloseTo(-23, 1)
    expect(r.truePeak).toBeCloseTo(-23, 1)
  })

  it('gates out silence: a tone with long silent gaps reads like the tone alone', () => {
    const amp = Math.pow(10, -20 / 20)
    const tone = sine(SR * 4, SR, 1000, amp)
    const gap = new Float32Array(SR * 6)
    const x = new Float32Array(tone.length * 2 + gap.length)
    x.set(tone, 0); x.set(gap, tone.length); x.set(tone, tone.length + gap.length)
    const alone = measureLoudness([tone], SR).integrated
    expect(Math.abs(measureLoudness([x], SR).integrated - alone)).toBeLessThan(0.3)
  })

  it('silence measures −Infinity, not a number', () => {
    const r = measureLoudness([new Float32Array(SR * 2)], SR)
    expect(r.integrated).toBe(-Infinity)
    expect(r.range).toBe(0)
  })

  it('finds the inter-sample peak of a quarter-rate sine at 45° (+3 dB over the samples)', () => {
    const s = sine(SR, SR, SR / 4, 0.9, Math.PI / 4)
    const sp = 20 * Math.log10(0.9 * Math.SQRT1_2)
    expect(measureLoudness([s], SR).samplePeak).toBeCloseTo(sp, 2)
    expect(20 * Math.log10(truePeakOf(s))).toBeGreaterThan(20 * Math.log10(0.9) - 0.2)
  })
})

const STEPS = "aevalsrc='if(lt(t,8),0.5,if(lt(t,14),0.05,0.2))*sin(2*PI*440*t)|if(lt(t,8),0.4,if(lt(t,14),0.04,0.25))*sin(2*PI*660*t)':d=20:s=48000"

describe.skipIf(!hasFfmpeg)('loudness meter vs ffmpeg ebur128', () => {
  const cases: { name: string; graph: string; ch: number; sr: number }[] = [
    { name: 'pink-mono-48k', graph: 'anoisesrc=d=20:c=pink:r=48000:a=0.25:s=7', ch: 1, sr: 48000 },
    { name: 'steps-stereo-48k', graph: STEPS, ch: 2, sr: 48000 },
    { name: 'speechlike-stereo-44k', graph: "aevalsrc='0.4*sin(2*PI*180*t)*(0.6+0.4*sin(2*PI*3*t))*gt(sin(2*PI*0.4*t),-0.3)+0.08*sin(2*PI*2500*t)|0.35*sin(2*PI*200*t)*gt(sin(2*PI*0.4*t),-0.3)':d=25:s=44100", ch: 2, sr: 44100 },
    { name: 'intersample-48k', graph: "aevalsrc='0.9*sin(2*PI*12000*t+PI/4)':d=5:s=48000,afade=t=in:d=0.05", ch: 1, sr: 48000 },
    { name: 'brown-loud-48k', graph: 'anoisesrc=d=15:c=brown:r=48000:a=0.8:s=3', ch: 2, sr: 48000 },
  ]
  for (const c of cases) {
    it(`matches ffmpeg on ${c.name}`, () => {
      const pcm = lavfi(c.name, c.graph, c.ch, c.sr)
      const ff = ffEbur128(writeF32(c.name + '-in', pcm), c.ch, c.sr)
      const r = measureLoudness(pcm, c.sr)
      console.log(`[ebur128] ${c.name}: I ${r.integrated.toFixed(2)} / ff ${ff.I} · LRA ${r.range.toFixed(2)} / ff ${ff.LRA} · TP ${r.truePeak.toFixed(2)} / ff ${ff.peak}`)
      expect(Math.abs(r.integrated - ff.I), `I ${r.integrated.toFixed(2)} vs ${ff.I}`).toBeLessThanOrEqual(0.3)
      expect(Math.abs(r.range - ff.LRA), `LRA ${r.range.toFixed(2)} vs ${ff.LRA}`).toBeLessThanOrEqual(0.3)
      expect(Math.abs(r.truePeak - ff.peak), `TP ${r.truePeak.toFixed(2)} vs ${ff.peak}`).toBeLessThanOrEqual(0.3)
    }, 60_000)
  }
})

/** Speech-like noise bursts with sharp peaks (quiet overall: reaching −14 LUFS needs the limiter). */
function bursts() {
  const n = SR * 12
  const v = noise(n, 0.05, 11)
  for (let i = 0; i < n; i++) v[i] *= (Math.sin((2 * Math.PI * 0.7 * i) / SR) > -0.2 ? 1 : 0.02) * (1 + 3 * Math.max(0, Math.sin((2 * Math.PI * 5 * i) / SR)) ** 8)
  return v
}

describe('normalise to a target', () => {
  it('computes the gain and says when the ceiling needs a limiter', () => {
    expect(normalizeGain({ integrated: -20, truePeak: -8 }, { target: -14 })).toMatchObject({ gainDb: 6, limit: false })
    const g = normalizeGain({ integrated: -20, truePeak: -3 }, { target: -14, ceiling: -1 })
    expect(g.gainDb).toBe(6)
    expect(g.limit).toBe(true)
    expect(g.predictedTruePeak).toBe(3)
    expect(normalizeGain({ integrated: -Infinity, truePeak: -Infinity }, { target: -14 }).gainDb).toBe(0)
  })

  it('the limiter holds the true peak under the ceiling and leaves quiet parts untouched', () => {
    const x = sine(SR * 2, SR, 1000, 0.1)
    for (let i = SR; i < SR + 4800; i++) x[i] = 0.99 * Math.sin((2 * Math.PI * 3000 * i) / SR) // a loud burst
    const out = limitTruePeak([x], SR, { ceiling: -3 })
    expect(20 * Math.log10(truePeakOf(out[0]))).toBeLessThanOrEqual(-3 + 0.05)
    // half a second away from the burst nothing changed
    for (let i = 1000; i < SR / 2; i += 997) expect(out[0][i]).toBeCloseTo(x[i], 6)
  })

  for (const target of [-14, -16, -23]) {
    it(`brings speech-like noise bursts to ${target} LUFS with true peak ≤ −1 dBTP`, () => {
      const v = bursts()
      const res = normalizeLoudness([v, v], SR, { target, ceiling: -1 })
      const after = measureLoudness(res.channels, SR)
      expect(Math.abs(after.integrated - target)).toBeLessThanOrEqual(0.5)
      expect(after.truePeak).toBeLessThanOrEqual(-1)
      expect(res.after.integrated).toBeCloseTo(after.integrated, 5)
      console.log(`[normalise] ${target}: I ${after.integrated.toFixed(2)} TP ${after.truePeak.toFixed(2)} limited ${res.limited}`)
    }, 60_000)
  }

  it.skipIf(!hasFfmpeg)('ffmpeg agrees: the −14 LUFS result measures −14 ± 0.5 and ≤ −1 dBTP (limited and unlimited)', () => {
    const v = bursts()
    const lim = normalizeLoudness([v, v], SR, { target: -14, ceiling: -1 })
    expect(lim.limited).toBe(true)
    const fl = ffEbur128(writeF32('normalised-14-limited', lim.channels), 2, SR)
    console.log(`[normalise] −14 limited: ours I ${lim.after.integrated.toFixed(2)} TP ${lim.after.truePeak.toFixed(2)} · ffmpeg I ${fl.I} TP ${fl.peak}`)
    expect(Math.abs(fl.I + 14)).toBeLessThanOrEqual(0.5)
    expect(fl.peak).toBeLessThanOrEqual(-1)
    const pcm = lavfi('steps-stereo-48k', STEPS, 2, 48000)
    const res = normalizeLoudness(pcm, 48000, { target: -14, ceiling: -1 })
    const ff = ffEbur128(writeF32('normalised-14', res.channels), 2, 48000)
    console.log(`[normalise] −14 target: ours I ${res.after.integrated.toFixed(2)} TP ${res.after.truePeak.toFixed(2)} · ffmpeg I ${ff.I} TP ${ff.peak} · gain ${res.gainDb.toFixed(2)} dB, limited ${res.limited}`)
    expect(Math.abs(ff.I + 14)).toBeLessThanOrEqual(0.5)
    expect(ff.peak).toBeLessThanOrEqual(-1)
  }, 60_000)

  it('applyGain scales every channel', () => {
    const out = applyGain([new Float32Array([0.5, -0.25])], -6.0206)
    expect(out[0][0]).toBeCloseTo(0.25, 4)
    expect(out[0][1]).toBeCloseTo(-0.125, 4)
  })
})
