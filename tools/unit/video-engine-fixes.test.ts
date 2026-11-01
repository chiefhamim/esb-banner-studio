// Phase 1 fix round, Part B: the engine bugs found in review, each pinned by a test that needs no GPU or decoder.
//   C1  a frame-cache alias never outlives the entry it points at (it used to return a closed bitmap)
//   P1  while playing, frames behind the playhead are evicted before look-ahead frames
//   C5  an exact decode that is in flight when the decoder is disposed resolves (null) instead of hanging or throwing
//   P10 a frame a stream decodes after dropSource is closed, never cached
//   P4  a texture used in the frame being drawn is never evicted by a later upload in the same frame
import { describe, expect, it, vi } from 'vitest'
import { FrameCache } from '../../src/video/engine/frameCache'
import { SourceDecoder } from '../../src/video/engine/decoder'
import { GLCompositor } from '../../src/video/engine/glCompositor'

type E = { bytes: number; close(): void; closed?: boolean; name: string }
const mk = (name: string, bytes = 100): E => { const e: E = { name, bytes, close: () => { e.closed = true } }; return e }

describe('frame cache aliases (C1)', () => {
  it('an alias answers with the original entry and is dropped when the original is evicted', () => {
    const c = new FrameCache<E>(300)
    const o = mk('orig')
    c.put('u', 590, o)
    c.alias('u', 600, 590) // a long frame answers index 600 too
    expect(c.get('u', 600)).toBe(o)
    expect(c.nearestBefore('u', 605)?.entry).toBe(o)
    // the monitor stays parked on 600 (touching the alias keeps the original recent) ...
    for (let i = 0; i < 3; i++) { c.put('v', i, mk('v' + i)); c.get('u', 600) }
    expect(o.closed).toBeFalsy()
    // ... until enough other frames push the original out: then the alias goes with it
    for (let i = 3; i < 8; i++) c.put('v', i, mk('v' + i))
    expect(o.closed).toBe(true)
    expect(c.has('u', 590)).toBe(false)
    expect(c.get('u', 600)).toBeUndefined()
    expect(c.peek('u', 600)).toBeUndefined()
    expect(c.nearestBefore('u', 605)).toBeNull()
  })

  it('replacing the original drops its aliases; a real frame put on an alias index replaces the alias', () => {
    const c = new FrameCache<E>(1e9)
    const o = mk('orig')
    c.put('u', 10, o)
    c.alias('u', 11, 10)
    c.alias('u', 12, 10)
    c.put('u', 10, mk('new'))
    expect(o.closed).toBe(true)
    expect(c.has('u', 11) || c.has('u', 12)).toBe(false)
    const n = c.peek('u', 10)!
    c.alias('u', 11, 10)
    const real = mk('real11')
    c.put('u', 11, real)
    expect(c.peek('u', 11)).toBe(real)
    expect(n.closed).toBeFalsy()
    c.clearSource('u')
    expect(c.sources()).toEqual([])
    expect(c.used).toBe(0)
  })

  it('an alias to a frame that is not cached is not made; aliases cost no bytes', () => {
    const c = new FrameCache<E>(1e9)
    c.alias('u', 5, 4)
    expect(c.has('u', 5)).toBe(false)
    c.put('u', 4, mk('a', 50))
    c.alias('u', 5, 4)
    expect(c.used).toBe(50)
    expect(c.size).toBe(1)
  })
})

describe('frame cache eviction while playing (P1)', () => {
  it('evicts frames behind the playhead first, then the furthest-ahead look-ahead frames', () => {
    const c = new FrameCache<E>(1000)
    // frames 0..9 of source s, each 100 bytes: the budget is full
    for (let i = 0; i < 10; i++) c.put('s', i, mk('s' + i))
    // the monitor showed 0..4 (LRU would now evict 5.. first: the look-ahead)
    for (let i = 0; i < 5; i++) c.get('s', i)
    c.setWindows(new Map([['s', [[4, 12]]]]))
    c.put('s', 10, mk('s10'))
    c.put('s', 11, mk('s11'))
    // 0 and 1 (behind the playhead) went, every look-ahead frame stayed
    expect(c.has('s', 0) || c.has('s', 1)).toBe(false)
    for (let i = 4; i <= 11; i++) expect(c.has('s', i)).toBe(true)
    // windows alone over budget: the furthest-ahead frames go, never the next one
    c.setWindows(new Map([['s', [[8, 30]]]]))
    for (let i = 12; i < 16; i++) c.put('s', i, mk('s' + i))
    expect(c.has('s', 8) && c.has('s', 9)).toBe(true)
    expect(c.used).toBeLessThanOrEqual(1000)
  })

  it('paused (no windows) it is plain LRU', () => {
    const c = new FrameCache<E>(300)
    c.put('a', 0, mk('a0')); c.put('a', 1, mk('a1')); c.put('a', 2, mk('a2'))
    c.get('a', 0)
    c.setWindows(null)
    c.put('a', 3, mk('a3'))
    expect(c.has('a', 1)).toBe(false)
    expect(c.has('a', 0)).toBe(true)
  })
})

/** A decoder with its sink replaced by a fake (no file, no WebCodecs). */
function fakeDecoder(sink: { getSample: (t: number) => Promise<unknown> }) {
  const cache = new FrameCache(1e9)
  const d = Object.create(SourceDecoder.prototype) as SourceDecoder
  Object.assign(d, {
    state: 'ready', fps: 30, first: 0, width: 64, height: 36, duration: 10, allKey: true, maxHeight: 0, disposed: false, lastExactMs: 0,
    url: 'blob:fake', cache, ready: Promise.resolve(true), input: null, sink, packets: null, busy: false, waiting: null,
    streams: new Set(), replacedAt: -Infinity, onHold: () => {}, failure: '',
  })
  return { d, cache }
}

const deferred = <T,>() => { let resolve!: (v: T) => void; const p = new Promise<T>((r) => { resolve = r }); return { p, resolve } }

const fakeSample = (ts: number) => {
  const s = { timestamp: ts, displayWidth: 64, displayHeight: 36, closed: false, frameClosed: false, close: () => { s.closed = true }, toVideoFrame: () => ({ close: () => { s.frameClosed = true } }) }
  return s
}

describe('exact decodes and dispose (C5, P10)', () => {
  it('dispose during an exact decode resolves the caller with null (no hang, no TypeError) and caches nothing', async () => {
    const pending = deferred<unknown>()
    const { d, cache } = fakeDecoder({ getSample: () => pending.p })
    const errors: unknown[] = []
    const onErr = (e: unknown) => errors.push(e)
    process.on('unhandledRejection', onErr)
    try {
      const first = d.exact(1)
      await new Promise((r) => setTimeout(r, 0))
      const second = d.exact(2) // waiting behind the first
      d.dispose()
      const s = fakeSample(1)
      pending.resolve(s)
      await expect(second).resolves.toBeNull()
      await expect(first).resolves.toBeNull()
      expect(cache.size).toBe(0)
      expect(s.closed).toBe(true) // the decoded sample was released
      // after dispose a new request answers at once
      await expect(d.exact(3)).resolves.toBeNull()
      await new Promise((r) => setTimeout(r, 0))
      expect(errors).toEqual([])
    } finally {
      process.off('unhandledRejection', onErr)
    }
  })

  it('a createImageBitmap that rejects resolves the request with null and closes the sample and its frame', async () => {
    const s = fakeSample(1)
    const { d } = fakeDecoder({ getSample: async () => s })
    const orig = (globalThis as { createImageBitmap?: unknown }).createImageBitmap
    ;(globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn(async () => { throw new Error('GPU gone') })
    try {
      await expect(d.exact(1)).resolves.toBeNull()
      expect(s.closed && s.frameClosed).toBe(true)
    } finally {
      ;(globalThis as { createImageBitmap?: unknown }).createImageBitmap = orig
    }
  })

  it('a frame a stream decodes after dropSource is closed, never cached', async () => {
    const { d, cache } = fakeDecoder({ getSample: async () => null })
    d.dispose()
    const s = fakeSample(0.5)
    await expect(d.store(s as never)).resolves.toBeNull()
    expect(s.closed).toBe(true)
    expect(cache.size).toBe(0)
  })

  it('a bitmap that arrives after dispose is closed, not cached', async () => {
    const { d, cache } = fakeDecoder({ getSample: async () => null })
    const bmp = { width: 64, height: 36, closed: false, close() { this.closed = true } }
    const gate = deferred<typeof bmp>()
    const orig = (globalThis as { createImageBitmap?: unknown }).createImageBitmap
    ;(globalThis as { createImageBitmap?: unknown }).createImageBitmap = () => gate.p
    try {
      const p = d.store(fakeSample(0.5) as never)
      d.dispose()
      gate.resolve(bmp)
      await expect(p).resolves.toBeNull()
      expect(bmp.closed).toBe(true)
      expect(cache.size).toBe(0)
    } finally {
      ;(globalThis as { createImageBitmap?: unknown }).createImageBitmap = orig
    }
  })
})

/** A WebGL2 context that does nothing but count texture deletes. */
function fakeGl() {
  const deleted = new Set<unknown>()
  let id = 0
  const over: Record<string, unknown> = {
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    isContextLost: () => false,
    getExtension: () => null,
    createTexture: () => ({ id: ++id }),
    deleteTexture: (t: unknown) => { deleted.add(t) },
  }
  const gl = new Proxy({}, { get: (_t, k: string) => (k in over ? over[k] : /^[A-Z0-9_]+$/.test(k) ? 1 : () => ({})) })
  const canvas = { width: 0, height: 0, getContext: () => gl }
  return { canvas, deleted }
}

describe('static textures (P4)', () => {
  it('a texture used in the current frame survives later uploads that go over budget; older frames’ textures go', () => {
    const { canvas, deleted } = fakeGl()
    const comp = new GLCompositor(canvas as unknown as OffscreenCanvas)
    comp.staticBudget = 2 * 100 * 100 * 4 // room for two 100×100 rasters
    const raster = () => ({ src: {} as TexImageSource, width: 100, height: 100 })
    comp.begin(10, 10)
    const old = comp.staticTexture('old', raster)!
    comp.begin(10, 10) // a new frame: "old" is not used in it
    const a = comp.staticTexture('a', raster)!
    const b = comp.staticTexture('b', raster)! // over budget: "old" goes
    const c = comp.staticTexture('c', raster)! // still over: "a" and "b" are in this frame, so they stay
    expect(deleted.has(old.tex)).toBe(true)
    expect(deleted.has(a.tex) || deleted.has(b.tex) || deleted.has(c.tex)).toBe(false)
    // next frame uses only c: a and b may go now
    comp.begin(10, 10)
    comp.staticTexture('c', raster)
    comp.staticTexture('d', raster)
    expect(deleted.has(a.tex)).toBe(true)
    expect(deleted.has(c.tex)).toBe(false)
  })
})
