import { beforeEach, describe, expect, it } from 'vitest'
import { RAIL_W, _resetColumnStore, collapseAt, parseState, resolveDrag, resolveKey, setColumnState } from '../../src/ui/sideColumnState'

const spec = { def: 312, min: 264, max: 480 }

describe('side column collapse', () => {
  it('folds at about 200 px, always below the minimum', () => {
    expect(collapseAt(spec)).toBe(200)
    expect(collapseAt({ def: 340, min: 280, max: 560 })).toBe(200)
    expect(collapseAt({ def: 240, min: 220, max: 400 })).toBe(172)
    expect(collapseAt({ def: 120, min: 100, max: 200 })).toBe(RAIL_W + 64)
  })

  it('dragging narrower than the line snaps to the rail and keeps the last width', () => {
    expect(resolveDrag(240, spec, 330, false)).toEqual({ w: 264, collapsed: false }) // held at the minimum
    expect(resolveDrag(199, spec, 330, false)).toEqual({ w: 330, collapsed: true })
    expect(resolveDrag(20, spec, 330, false)).toEqual({ w: 330, collapsed: true })
    expect(resolveDrag(900, spec, 330, false)).toEqual({ w: 480, collapsed: false })
  })

  it('pulling a rail outward past the line opens it at the last width', () => {
    expect(resolveDrag(150, spec, 360, true)).toEqual({ w: 360, collapsed: true })
    expect(resolveDrag(210, spec, 360, true)).toEqual({ w: 360, collapsed: false })
    expect(resolveDrag(420, spec, 360, true)).toEqual({ w: 420, collapsed: false })
  })

  it('arrow keys resize, fold from the minimum and open a rail', () => {
    expect(resolveKey({ w: 312, collapsed: false }, 1, 16, spec)).toEqual({ w: 328, collapsed: false })
    expect(resolveKey({ w: 270, collapsed: false }, -1, 16, spec)).toEqual({ w: 264, collapsed: false })
    expect(resolveKey({ w: 264, collapsed: false }, -1, 16, spec)).toEqual({ w: 264, collapsed: true })
    expect(resolveKey({ w: 300, collapsed: true }, -1, 16, spec)).toEqual({ w: 300, collapsed: true })
    expect(resolveKey({ w: 300, collapsed: true }, 1, 16, spec)).toEqual({ w: 300, collapsed: false })
  })

  it('reads saved state defensively, falling back to an older saved width', () => {
    expect(parseState(JSON.stringify({ w: 350, collapsed: true }), spec)).toEqual({ w: 350, collapsed: true })
    expect(parseState(JSON.stringify({ w: 9999 }), spec)).toEqual({ w: 480, collapsed: false })
    expect(parseState('{not json', spec)).toEqual({ w: 312, collapsed: false })
    expect(parseState(null, spec, 400)).toEqual({ w: 400, collapsed: false })
    expect(parseState(JSON.stringify({ w: 'x' }), spec, 100)).toEqual({ w: 264, collapsed: false })
  })
})

describe('side column persistence', () => {
  const mem = new Map<string, string>()
  beforeEach(() => {
    mem.clear()
    _resetColumnStore()
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => { mem.set(k, v) },
      removeItem: (k: string) => { mem.delete(k) },
    }
  })

  it('saves per desk per side', () => {
    setColumnState('news/left', { w: 300, collapsed: true })
    setColumnState('news/right', { w: 340, collapsed: false })
    expect(JSON.parse(mem.get('esb-banner-studio/side-col/news/left')!)).toEqual({ w: 300, collapsed: true })
    expect(JSON.parse(mem.get('esb-banner-studio/side-col/news/right')!)).toEqual({ w: 340, collapsed: false })
  })

  it('a live flip during a drag is not saved until release', () => {
    setColumnState('graphics/left', { w: 312, collapsed: true }, false)
    expect(mem.has('esb-banner-studio/side-col/graphics/left')).toBe(false)
  })

  it('a drag that flipped live and ends folded is saved on release', () => {
    setColumnState('news/left', { w: 300, collapsed: false })
    setColumnState('news/left', { w: 300, collapsed: true }, false)
    setColumnState('news/left', { w: 300, collapsed: true })
    expect(JSON.parse(mem.get('esb-banner-studio/side-col/news/left')!)).toEqual({ w: 300, collapsed: true })
  })

  it('survives storage that throws', () => {
    ;(globalThis as { localStorage?: unknown }).localStorage = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    expect(() => setColumnState('video/left', { w: 300, collapsed: true })).not.toThrow()
  })
})
