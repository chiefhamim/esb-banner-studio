// Phase 1 — Part B engine pieces that need no GPU or decoder: the frame cache, layer geometry, waveform peaks and
// their bytes, cache keys, the media adapter's fallbacks and the sound gain rule.
import { describe, expect, it } from 'vitest'
import { FrameCache } from '../../src/video/engine/frameCache'
import { frameQuad, layerQuad, uvOf, vertices } from '../../src/video/engine/layerMath'
import { BASE_RATE, PeakBuilder, levelFor, packPeaks, pyramid, unpackPeaks } from '../../src/video/engine/peaks'
import { CACHE_KEY, cacheKey, exportUrl, previewUrl, readCache, writeCache } from '../../src/video/engine/mediaSource'
import { audioSignature, clipGain } from '../../src/video/engine/audioEngine'
import { kenBurnsZoom, srcTime } from '../../src/video/engine/render'
import { stripStep, tileRect } from '../../src/video/engine/filmstrip'
import { createDefaultTimeline, footageRect } from '../../src/video/timeline'
import type { Clip, VideoProject } from '../../src/video/timeline'

const entry = (bytes: number, log: string[], name: string) => ({ bytes, close: () => log.push(name) })

describe('frame cache', () => {
  it('keeps frames by source and index within a byte budget, evicting the least recently used', () => {
    const log: string[] = []
    const c = new FrameCache<{ bytes: number; close(): void }>(300)
    c.put('a', 0, entry(100, log, 'a0'))
    c.put('a', 1, entry(100, log, 'a1'))
    c.put('b', 0, entry(100, log, 'b0'))
    expect(c.used).toBe(300)
    c.get('a', 0) // a0 is now the most recent
    c.put('a', 2, entry(100, log, 'a2'))
    expect(log).toEqual(['a1'])
    expect(c.has('a', 0) && c.has('b', 0) && c.has('a', 2)).toBe(true)
    expect(c.used).toBeLessThanOrEqual(300)
  })

  it('never evicts the frame just put, even when it alone is over budget', () => {
    const log: string[] = []
    const c = new FrameCache<{ bytes: number; close(): void }>(50)
    c.put('a', 0, entry(100, log, 'a0'))
    expect(c.has('a', 0)).toBe(true)
    c.put('a', 1, entry(100, log, 'a1'))
    expect(log).toEqual(['a0'])
  })

  it('finds the nearest earlier frame to hold while the exact one decodes', () => {
    const c = new FrameCache<{ bytes: number; close(): void }>(1e9)
    for (const i of [3, 10, 20]) c.put('s', i, entry(1, [], ''))
    expect(c.nearestBefore('s', 15)?.index).toBe(10)
    expect(c.nearestBefore('s', 2)).toBeNull()
    expect(c.nearestBefore('s', 200, 90)).toBeNull()
    expect(c.nearestBefore('other', 15)).toBeNull()
  })

  it('replacing a frame closes the old one; clearing a source closes all of its frames', () => {
    const log: string[] = []
    const c = new FrameCache<{ bytes: number; close(): void }>(1e9)
    c.put('s', 1, entry(10, log, 'old'))
    c.put('s', 1, entry(10, log, 'new'))
    expect(log).toEqual(['old'])
    c.put('s', 2, entry(10, log, 's2'))
    c.put('t', 1, entry(10, log, 't1'))
    c.clearSource('s')
    expect(log).toEqual(['old', 'new', 's2'])
    expect(c.used).toBe(10)
    expect(c.sources()).toEqual(['t'])
  })
})

describe('layer geometry', () => {
  it('an unrotated layer is its draw rectangle; UVs follow the crop', () => {
    const r = footageRect(1000, 500, 1000, 500, { cropL: 0.1, cropR: 0.1 })
    expect(layerQuad(r)).toEqual([r.dx, r.dy, r.dx + r.dw, r.dy, r.dx + r.dw, r.dy + r.dh, r.dx, r.dy + r.dh])
    const [u0, v0, u1, v1] = uvOf(r, 1000, 500)
    expect([u0, v0, v1]).toEqual([0.1, 0, 1])
    expect(u1).toBeCloseTo(0.9, 9)
  })

  it('rotates around the anchor', () => {
    const q = layerQuad({ dx: 0, dy: 0, dw: 100, dh: 100 }, 90)
    const pts = [[q[0], q[1]], [q[2], q[3]], [q[4], q[5]], [q[6], q[7]]].map(([x, y]) => [Math.round(x) + 0, Math.round(y) + 0])
    expect(pts).toEqual([[100, 0], [100, 100], [0, 100], [0, 0]])
    const corner = layerQuad({ dx: 0, dy: 0, dw: 100, dh: 100 }, 180, 0, 0)
    expect(corner.map((v) => Math.round(v) + 0)).toEqual([0, 0, -100, 0, -100, -100, 0, -100])
  })

  it('a full-frame raster moves by fractions of the frame', () => {
    expect(frameQuad(1920, 1080, 0.1, -0.5)).toEqual([192, -540, 2112, -540, 2112, 540, 192, 540])
    expect(Array.from(vertices(frameQuad(2, 2), [0, 0, 1, 1]))).toEqual([0, 0, 0, 0, 2, 0, 1, 0, 2, 2, 1, 1, 0, 2, 0, 1])
  })

  it('source time and the still move', () => {
    const c = { start: 10, in: 2, duration: 4, kenBurns: 'in' } as Clip
    expect(srcTime(c, 11)).toBe(3)
    expect(srcTime(c, 5)).toBe(0)
    expect(kenBurnsZoom(c, 10)).toBe(1)
    expect(kenBurnsZoom(c, 14)).toBeCloseTo(1.06, 9)
    expect(kenBurnsZoom({ ...c, kenBurns: 'out' }, 10)).toBeCloseTo(1.06, 9)
  })
})

describe('waveform peaks', () => {
  it('bins a sine at the base rate with its real amplitude', () => {
    const rate = 48000
    const s = new Float32Array(rate) // 1 s, 400 Hz at 0.5
    for (let i = 0; i < s.length; i++) s[i] = 0.5 * Math.sin((2 * Math.PI * 400 * i) / rate)
    const b = new PeakBuilder()
    // fed in uneven pieces, as a decoder delivers them
    let at = 0
    for (const n of [1000, 7000, 333, 39667]) { b.add([s.subarray(at, at + n)], rate, at / rate); at += n }
    const p = b.finish(1)
    expect(p.rates).toEqual([BASE_RATE, BASE_RATE / 4, BASE_RATE / 16, BASE_RATE / 64])
    expect(p.levels[0].length / 2).toBe(BASE_RATE)
    for (let i = 0; i < BASE_RATE; i++) {
      expect(p.levels[0][i * 2 + 1]).toBeGreaterThanOrEqual(60)
      expect(p.levels[0][i * 2]).toBeLessThanOrEqual(-60)
    }
  })

  it('silence is flat; a click lands in its own bin', () => {
    const rate = 48000
    const s = new Float32Array(rate)
    s[Math.round(0.5 * rate)] = 1
    const b = new PeakBuilder()
    b.add([s, new Float32Array(rate)], rate, 0)
    const p = b.finish(1)
    const bin = Math.floor(0.5 * BASE_RATE)
    expect(p.levels[0][bin * 2 + 1]).toBe(127)
    expect(p.levels[0][(bin - 3) * 2 + 1]).toBe(0)
    expect(p.levels[1][Math.floor(bin / 4) * 2 + 1]).toBe(127)
  })

  it('picks the coarsest level with a bin per pixel', () => {
    const p = pyramid(new Int8Array(2 * 2000), BASE_RATE, 10)
    expect(levelFor(p, 40)).toBe(1) // 50 bins/s
    expect(levelFor(p, 3)).toBe(3)
    expect(levelFor(p, 400)).toBe(0)
  })

  it('packs and unpacks to the same peaks; rejects other bytes', () => {
    const base = new Int8Array([-5, 9, -127, 127, 0, 0, -1, 3, 4, 8])
    const p = pyramid(base, BASE_RATE, 0.025)
    const back = unpackPeaks(packPeaks(p))!
    expect(back.rates).toEqual(p.rates)
    expect(back.levels.map((l) => Array.from(l))).toEqual(p.levels.map((l) => Array.from(l)))
    expect(back.duration).toBeCloseTo(0.025, 6)
    expect(unpackPeaks(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull()
  })
})

describe('filmstrip layout', () => {
  it('one tile a second, at most 600 tiles; tiles fill rows of the sprite', () => {
    expect(stripStep(30)).toBe(1)
    expect(stripStep(1200)).toBe(2)
    expect(tileRect({ tileW: 85, tileH: 48, cols: 48 }, 49)).toEqual({ sx: 85, sy: 48, sw: 85, sh: 48 })
  })
})

describe('media adapter (before Part A: falls back to the clip file and a session cache)', () => {
  it('preview and export read the clip’s own file', () => {
    const c = { mediaAssetId: 'm1', sourceUrl: 'blob:abc' }
    expect(previewUrl(c)).toBe('blob:abc')
    expect(exportUrl(c)).toBe('blob:abc')
    expect(previewUrl({ sourceUrl: undefined })).toBeUndefined()
  })

  it('cache keys fit the contract; the session cache keeps bytes and refuses bad keys and big entries', async () => {
    const k = cacheKey('wf', 'C:\\Footage\\interview.mp4|123|456')
    expect(k).toMatch(CACHE_KEY)
    expect(cacheKey('wf', 'a')).not.toBe(cacheKey('wf', 'b'))
    expect(await writeCache(k, new Uint8Array([1, 2, 3]))).toBe(true)
    expect(Array.from((await readCache(k))!)).toEqual([1, 2, 3])
    expect(await writeCache('Bad Key!', new Uint8Array(1))).toBe(false)
    expect(await writeCache('big', new Uint8Array(33 * 1024 * 1024))).toBe(false)
    expect(await readCache('missing-key')).toBeNull()
  })
})

describe('sound rules shared by preview and export', () => {
  const base = createDefaultTimeline()
  const a = (o: Partial<Clip>): Clip => ({ id: 'a', trackId: 'a1', kind: 'audio', title: 'a', start: 0, duration: 2, in: 0, out: 2, color: '#000', sourceUrl: 'blob:x', ...o })
  it('gain follows volume, clip mute and track mute', () => {
    expect(clipGain(base, a({ volume: 0.4 }))).toBe(0.4)
    expect(clipGain(base, a({ muted: true }))).toBe(0)
    expect(clipGain({ tracks: base.tracks.map((t) => (t.id === 'a1' ? { ...t, muted: true } : t)) }, a({}))).toBe(0)
    expect(clipGain(base, a({ volume: 3 }))).toBe(1)
  })
  it('a volume change does not restart the sound; a move does', () => {
    const p: VideoProject = { ...base, clips: [a({})] }
    expect(audioSignature({ ...p, clips: [a({ volume: 0.2 })] })).toBe(audioSignature(p))
    expect(audioSignature({ ...p, clips: [a({ start: 1 })] })).not.toBe(audioSignature(p))
  })
})
