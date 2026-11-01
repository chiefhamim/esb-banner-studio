// Phase 2 — Part B: effects model, .cube parsing, the keyframe/speed adapter's fallbacks, and the time-stretcher.
import { describe, expect, it } from 'vitest'
import { EFFECT_DEFS, LUT_MAX_SIZE, applyLutCpu, cachedCube, chromaOf, compactCube, makeCube, newEffect, paramValue, parseCube, sanitizeEffects } from '../../src/video/effects'
import type { Clip } from '../../src/video/timeline'
import { migrateTimeline } from '../../src/video/timeline'
import { animationSource, audioRateAt, clipDurationFor, cubicBezier, directionAt, sampleKeys, sampleProp, sourceTimeAt } from '../../src/video/engine/animation'
import { GRAIN, SpeedRenderer, dominantFrequency } from '../../src/video/engine/timeStretch'
import type { PcmWindow } from '../../src/video/engine/timeStretch'
import { poseAt } from '../../src/video/engine/render'
import { writeVertices, vertices } from '../../src/video/engine/layerMath'

const clip = (o: Partial<Clip>): Clip => ({ id: 'c', trackId: 'v1', title: 'c', kind: 'video', start: 0, duration: 4, in: 0, out: 4, color: '#000', ...o })

function cubeText(size: number, f: (r: number, g: number, b: number) => [number, number, number], header = '') {
  const lines = [header, `LUT_3D_SIZE ${size}`]
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) lines.push(f(r / (size - 1), g / (size - 1), b / (size - 1)).map((v) => v.toFixed(6)).join(' '))
  return lines.join('\n') + '\n'
}

describe('.cube LUTs', () => {
  for (const size of [17, 33, 65]) {
    it(`parses a ${size}-point cube (red fastest) and keeps every value`, () => {
      const r = parseCube(cubeText(size, (r, g, b) => [r, g * 0.5, 1 - b], 'TITLE "test"\n# comment'))
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.lut.size).toBe(size)
      expect(r.lut.title).toBe('test')
      expect(r.lut.data.length).toBe(size ** 3 * 3)
      // the entry for (r=1, g=0, b=0) is index size-1
      expect(r.lut.data[(size - 1) * 3]).toBeCloseTo(1, 5)
      expect(r.lut.data[(size - 1) * 3 + 2]).toBeCloseTo(1, 5)
    })
  }
  it('refuses broken files with a reason', () => {
    expect(parseCube('')).toMatchObject({ ok: false })
    expect(parseCube('LUT_1D_SIZE 1024\n0 0 0')).toMatchObject({ ok: false, error: expect.stringContaining('1D') })
    expect(parseCube('LUT_3D_SIZE 1\n0 0 0')).toMatchObject({ ok: false, error: expect.stringContaining('LUT_3D_SIZE') })
    expect(parseCube(`LUT_3D_SIZE ${LUT_MAX_SIZE + 1}\n`)).toMatchObject({ ok: false })
    expect(parseCube('LUT_3D_SIZE 2\n0 0 0\n1 1 1\n')).toMatchObject({ ok: false, error: expect.stringContaining('Expected 2³') })
    expect(parseCube('0 0 0\nLUT_3D_SIZE 2')).toMatchObject({ ok: false, error: expect.stringContaining('before') })
    expect(parseCube('LUT_3D_SIZE 2\n0 0 x\n')).toMatchObject({ ok: false })
    expect(parseCube('LUT_3D_SIZE 2\n0 0\n')).toMatchObject({ ok: false, error: expect.stringContaining('three numbers') })
    expect(parseCube(cubeText(2, () => [0, 0, 0]) + '1 1 1\n')).toMatchObject({ ok: false, error: expect.stringContaining('More than') })
    expect(parseCube('LUT_3D_SIZE 2\nDOMAIN_MIN 1 1 1\nDOMAIN_MAX 0 0 0\n' + '0 0 0\n'.repeat(8))).toMatchObject({ ok: false, error: expect.stringContaining('DOMAIN') })
  })
  it('clamps output values and honours DOMAIN_MIN/MAX', () => {
    const t = 'LUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2\n' + Array.from({ length: 8 }, (_, i) => `${i & 1 ? 1.5 : -0.2} ${i & 2 ? 1 : 0} ${i & 4 ? 1 : 0}`).join('\n')
    const r = parseCube(t)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Math.max(...r.lut.data)).toBe(1)
    expect(Math.min(...r.lut.data)).toBe(0)
    // input 1.0 is the middle of a 0..2 domain
    const o = applyLutCpu(r.lut, 1, 1, 1)
    expect(o[1]).toBeCloseTo(0.5, 5)
  })
  it('compactCube round-trips within 1e-5 and is smaller', () => {
    const lut = makeCube(17, (r, g, b) => [Math.pow(r, 0.8), g * 0.9 + 0.05, Math.sqrt(b)], 'warm')
    const text = compactCube(lut)
    const back = parseCube(text)
    expect(back.ok).toBe(true)
    if (!back.ok) return
    let worst = 0
    for (let i = 0; i < lut.data.length; i++) worst = Math.max(worst, Math.abs(lut.data[i] - back.lut.data[i]))
    expect(worst).toBeLessThan(1e-5)
    expect(back.lut.title).toBe('warm')
    expect(text.length).toBeLessThan(cubeText(17, (r, g, b) => [Math.pow(r, 0.8), g * 0.9 + 0.05, Math.sqrt(b)]).length)
  })
  it('trilinear CPU sampling: exact at grid points, the identity cube is the identity', () => {
    const id = makeCube(17, (r, g, b) => [r, g, b])
    for (const v of [[0, 0, 0], [0.3, 0.6, 0.9], [1, 0.5, 0.25], [0.123, 0.987, 0.5]]) {
      const o = applyLutCpu(id, v[0], v[1], v[2])
      for (let j = 0; j < 3; j++) expect(o[j]).toBeCloseTo(v[j], 6)
    }
    const warm = makeCube(33, (r, g, b) => [r * r, g, b])
    expect(applyLutCpu(warm, 0.5, 0.5, 0.5)[0]).toBeCloseTo(0.25, 3)
  })
  it('caches the parse per text', () => {
    const t = compactCube(makeCube(5, (r, g, b) => [r, g, b]))
    expect(cachedCube(t)).toBe(cachedCube(t))
    expect(cachedCube('not a cube')).toBeNull()
  })
})

describe('effect list validation', () => {
  it('newEffect carries every default; ids are unique', () => {
    const a = newEffect('colour')
    const b = newEffect('colour', [a])
    expect(a.id).not.toBe(b.id)
    expect(Object.keys(a.params!).sort()).toEqual(EFFECT_DEFS.colour.params.map((p) => p.key).sort())
    expect(newEffect('lut').params).toEqual({ intensity: 1 })
  })
  it('sanitizeEffects drops unknown types, clamps values, caps per type and repairs ids', () => {
    const cube = compactCube(makeCube(3, (r, g, b) => [r, g, b]))
    const out = sanitizeEffects([
      { id: 'a', type: 'colour', params: { exposure: 99, contrast: 'x' } },
      { id: 'a', type: 'colour', params: {} },
      { id: 'bad id!', type: 'blur', params: { radius: -5 } },
      { type: 'nope' },
      null,
      { id: 'm1', type: 'mask', params: { shape: 'star', invert: 'yes' } },
      { id: 'k', type: 'chromaKey', params: { color: 'green' } },
      { id: 'l', type: 'lut', params: { cube: 'garbage', intensity: 2 } },
      { id: 'l2', type: 'lut', params: { cube } },
      ...Array.from({ length: 6 }, (_, i) => ({ id: `mm${i}`, type: 'mask' })),
    ])!
    expect(out.filter((e) => e.type === 'colour')).toHaveLength(1)
    expect(out[0].params).toMatchObject({ exposure: 3, contrast: 0 })
    expect(out.find((e) => e.type === 'blur')).toMatchObject({ params: { radius: 0 } })
    expect(out.find((e) => e.type === 'blur')!.id).toMatch(/^[\w-]+$/)
    expect(out.find((e) => e.id === 'm1')!.params).toMatchObject({ shape: 'ellipse', invert: false })
    expect(out.find((e) => e.type === 'chromaKey')!.params!.color).toBe('#00b140')
    // one LUT per clip: the first (broken text dropped, intensity clamped); the second is over the cap
    expect(out.filter((e) => e.type === 'lut')).toHaveLength(1)
    expect(out.find((e) => e.type === 'lut')!.params).toEqual({ intensity: 1 })
    expect(out.filter((e) => e.type === 'mask').length).toBe(4)
    expect(sanitizeEffects('x')).toBeUndefined()
  })
  it('paramValue makes any stored value safe', () => {
    const p = EFFECT_DEFS.vignette.params[0]
    expect(paramValue({ id: 'v', type: 'vignette', params: { amount: NaN } }, p)).toBe(0.5)
    expect(paramValue({ id: 'v', type: 'vignette', params: { amount: 7 } }, p)).toBe(1)
  })
  it('migrateTimeline keeps a valid blend mode and adjustment flag, drops invalid ones', () => {
    const tracks = [{ id: 'v2', name: 'V2', kind: 'overlay', muted: false, locked: false }, { id: 'v1', name: 'V1', kind: 'video', muted: false, locked: false }]
    const tl = migrateTimeline({ timelineVersion: 2, tracks, clips: [
      clip({ id: 'a', blendMode: 'screen' }),
      clip({ id: 'b', blendMode: 'weird' as never }),
      clip({ id: 'c', trackId: 'v2', kind: 'overlay', adjustment: true }),
      clip({ id: 'd', adjustment: true }),
    ] })
    expect(tl.clips.find((c) => c.id === 'a')!.blendMode).toBe('screen')
    expect('blendMode' in tl.clips.find((c) => c.id === 'b')!).toBe(false)
    expect(tl.clips.find((c) => c.id === 'c')!.adjustment).toBe(true)
    expect('adjustment' in tl.clips.find((c) => c.id === 'd')!).toBe(false)
  })
  it('chroma of the default key is the green direction (Cb < 0, Cr < 0)', () => {
    const [cb, cr] = chromaOf(0, 177 / 255, 64 / 255)
    expect(cb).toBeLessThan(0)
    expect(cr).toBeLessThan(0)
  })
})

describe('keyframe adapter (fallback until Part A’s keyframes.ts is merged)', () => {
  it('reports which side is live', () => {
    expect(['part-a', 'fallback']).toContain(animationSource.keyframes)
  })
  it('linear, ease and bezier between keys; holds outside them', () => {
    const k = [{ t: 0, v: 0 }, { t: 2, v: 10 }]
    expect(sampleKeys(k, -1, 5)).toBe(0)
    expect(sampleKeys(k, 1, 5)).toBe(5)
    expect(sampleKeys(k, 3, 5)).toBe(10)
    expect(sampleKeys([{ t: 0, v: 0, ease: 'ease-in' }, { t: 1, v: 1 }], 0.5, 0)).toBeCloseTo(0.25)
    expect(sampleKeys([{ t: 0, v: 0, ease: 'ease-out' }, { t: 1, v: 1 }], 0.5, 0)).toBeCloseTo(0.75)
    expect(sampleKeys([], 1, 7)).toBe(7)
    expect(cubicBezier([0, 0, 1, 1], 0.3)).toBeCloseTo(0.3, 3)
    expect(cubicBezier([0.42, 0, 0.58, 1], 0.5)).toBeCloseTo(0.5, 3)
  })
  it('the render pose reads x / y / scale / rotation / opacity / crop keys, static fields otherwise', () => {
    const c = clip({ scale: 2, offX: 0.1, keyframes: { x: [{ t: 0, v: 0 }, { t: 2, v: 0.4 }], opacity: [{ t: 0, v: 1 }, { t: 2, v: 0 }] } })
    const p = poseAt(c, 1)
    expect(p.offX).toBeCloseTo(0.2)
    expect(p.opacity).toBeCloseTo(0.5)
    expect(p.scale).toBe(2)
    expect(sampleProp(c, 'fx.e1.radius', 1, 9)).toBe(9)
    expect(poseAt(clip({ offX: 0.3 }), 1).offX).toBe(0.3)
  })
})

describe('speed adapter (fallback until Part A’s speed.ts is merged)', () => {
  it('a plain clip maps 1:1 from its in point', () => {
    const c = clip({ in: 2, out: 6 })
    expect(sourceTimeAt(c, 1.5)).toBeCloseTo(3.5)
    expect(audioRateAt(c, 1)).toBe(1)
    expect(clipDurationFor(c)).toBe(4)
  })
  it('constant 2× / 0.5×: twice / half as fast, duration over the rate', () => {
    expect(sourceTimeAt(clip({ in: 1, out: 9, speed: 2, duration: 4 }), 1)).toBeCloseTo(3)
    expect(clipDurationFor(clip({ in: 1, out: 9, speed: 2 }))).toBeCloseTo(4)
    expect(clipDurationFor(clip({ in: 0, out: 2, speed: 0.5 }))).toBeCloseTo(4)
    expect(audioRateAt(clip({ speed: 2 }), 0)).toBe(2)
  })
  it('rates are clamped to 0.1×–10×', () => {
    expect(audioRateAt(clip({ speed: 50 }), 0)).toBe(10)
    expect(audioRateAt(clip({ speed: 0.01 }), 0)).toBe(0.1)
  })
  it('reverse starts at the last frame of the span and runs down to the in point', () => {
    const c = clip({ in: 0, out: 4, duration: 4, reverse: true } as Partial<Clip>)
    const fps = 30
    const idx = (t: number) => Math.floor(t * fps + 1e-3)
    expect(idx(sourceTimeAt(c, 0))).toBe(119)
    expect(idx(sourceTimeAt(c, 1 / fps))).toBe(118)
    expect(idx(sourceTimeAt(c, 119 / fps))).toBe(0)
    expect(directionAt(c, 1)).toBe(-1)
    expect(sourceTimeAt(clip({ in: 0, out: 4, reverse: true } as Partial<Clip>), 1)).toBeCloseTo(3 - 1e-3)
    // 2× reverse covers the span in half the time
    expect(clipDurationFor(clip({ in: 0, out: 4, speed: 2, reverse: true } as Partial<Clip>))).toBeCloseTo(2)
  })
  it('a ramp integrates the rate; a freeze holds the picture and silences the sound', () => {
    const r = clip({ in: 0, out: 10, speed: { ramp: [{ t: 0, v: 1 }, { t: 2, v: 3 }] } })
    // ∫0..2 of 1 + t = 4
    expect(sourceTimeAt(r, 2)).toBeCloseTo(4, 5)
    expect(sourceTimeAt(r, 3)).toBeCloseTo(7, 5)
    expect(audioRateAt(r, 1)).toBeCloseTo(2)
    // 4 s of source by t = 2, then 3× for the remaining 6 s: 2 + 2 = 4 s
    expect(clipDurationFor(r)).toBeCloseTo(4, 3)
    const f = clip({ in: 1, out: 5, duration: 6, freezes: [{ at: 1, dur: 2 }] } as Partial<Clip>)
    expect(sourceTimeAt(f, 1.5)).toBeCloseTo(2)
    expect(sourceTimeAt(f, 2.5)).toBeCloseTo(2)
    expect(sourceTimeAt(f, 4)).toBeCloseTo(3)
    expect(directionAt(f, 1.5)).toBe(0)
    expect(audioRateAt(f, 1.5)).toBe(0)
    expect(audioRateAt(f, 0.5)).toBe(1)
    expect(clipDurationFor(f)).toBeCloseTo(6)
  })
  it('never maps outside the source span', () => {
    const c = clip({ in: 2, out: 4, speed: 3 })
    expect(sourceTimeAt(c, 100)).toBeLessThan(4)
    expect(sourceTimeAt(c, -5)).toBeGreaterThanOrEqual(2)
  })
})

describe('time-stretch (WSOLA) and resample', () => {
  const rate = 48000
  /** A source window of a sine (or anything) at 48 kHz, `seconds` long. */
  const source = (seconds: number, f: (t: number) => number): PcmWindow => {
    const n = Math.round(seconds * rate)
    const ch = new Float32Array(n)
    for (let i = 0; i < n; i++) ch[i] = f(i / rate)
    return { sampleRate: rate, start: 0, channels: [ch, ch], lo: 0, hi: n }
  }
  const render = (speed: number, preserve: boolean, src: PcmWindow, seconds: number) => {
    const r = new SpeedRenderer({ outRate: rate, channels: 2, preservePitch: preserve, map: (t) => Math.max(0, speed < 0 ? src.hi / rate - 0.001 + speed * t : speed * t), rate: () => Math.abs(speed) })
    // in two pieces, like the export's consecutive ranges
    const half = Math.round((seconds * rate) / 2)
    const a = r.render(src, 0, half)[0]
    const b = r.render(src, half, half)[0]
    const out = new Float32Array(half * 2)
    out.set(a, 0)
    out.set(b, half)
    return out
  }
  const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length)
  const tone = source(10, (t) => 0.5 * Math.sin(2 * Math.PI * 440 * t))

  it('2× with pitch preserved: 440 Hz stays 440 ± 1 Hz, level kept, no clicks at the piece join', () => {
    const out = render(2, true, tone, 3)
    const mid = out.subarray(rate * 0.5, rate * 2.5)
    expect(Math.abs(dominantFrequency(mid, rate, 200, 2000) - 440)).toBeLessThan(1)
    expect(rms(mid)).toBeGreaterThan(0.3)
    let jump = 0
    for (let i = 1; i < mid.length; i++) jump = Math.max(jump, Math.abs(mid[i] - mid[i - 1]))
    // a 440 Hz sine at 0.5 moves at most 0.029 per sample; allow a little for the overlap-add
    expect(jump).toBeLessThan(0.06)
  })
  it('0.5× and 4× with pitch preserved keep 440 Hz', () => {
    for (const s of [0.5, 4]) {
      const out = render(s, true, tone, 2)
      expect(Math.abs(dominantFrequency(out.subarray(rate * 0.3, rate * 1.7), rate, 200, 2000) - 440)).toBeLessThan(2)
    }
  })
  it('resample (pitch not preserved): 2× doubles the tone, 0.5× halves it', () => {
    expect(Math.abs(dominantFrequency(render(2, false, tone, 2).subarray(rate * 0.3, rate * 1.7), rate, 200, 2000) - 880)).toBeLessThan(2)
    expect(Math.abs(dominantFrequency(render(0.5, false, tone, 2).subarray(rate * 0.3, rate * 1.7), rate, 100, 2000) - 220)).toBeLessThan(2)
  })
  it('reverse plays the source backwards (a rising chirp comes out falling)', () => {
    const chirp = source(4, (t) => 0.5 * Math.sin(2 * Math.PI * (200 * t + 50 * t * t)))
    const out = render(-1, true, chirp, 3.5)
    const early = dominantFrequency(out.subarray(rate * 0.2, rate * 0.6), rate, 100, 1000)
    const late = dominantFrequency(out.subarray(rate * 2.8, rate * 3.2), rate, 100, 1000)
    expect(early).toBeGreaterThan(late + 100)
  })
  it('a frozen stretch is silent; output before the clip is silent', () => {
    const r = new SpeedRenderer({ outRate: rate, channels: 2, preservePitch: true, map: () => 1, rate: () => 0 })
    expect(rms(r.render(tone, 0, rate)[0])).toBe(0)
    expect(GRAIN).toBe(2048)
  })
  it('rate 1 through WSOLA reproduces the source (the windows sum to 1)', () => {
    const r = new SpeedRenderer({ outRate: rate, channels: 1, preservePitch: true, map: (t) => t, rate: () => 1 })
    const out = r.render(tone, 0, rate)[0]
    let worst = 0
    for (let i = GRAIN; i < rate - GRAIN; i++) worst = Math.max(worst, Math.abs(out[i] - tone.channels[0][i]))
    expect(worst).toBeLessThan(1e-4)
  })
})

describe('compositor helpers', () => {
  it('writeVertices fills a reused buffer the same as vertices()', () => {
    const q = [0, 0, 10, 0, 10, 5, 0, 5] as [number, number, number, number, number, number, number, number]
    const uv = [0, 1, 1, 0] as [number, number, number, number]
    const buf = new Float32Array(16)
    expect(Array.from(writeVertices(buf, q, uv))).toEqual(Array.from(vertices(q, uv)))
  })
})
