// Phase 2 UI fix round: the one data addition it needed (a "hold" ease for the curve editor's Hold preset).
import { describe, expect, it } from 'vitest'
import type { Clip } from '../../src/video/timeline'
import { EASE_LABEL, applyEase, easeName, setKeyEase, valueAt } from '../../src/video/keyframes'
import { sampleKeys, sampleProp } from '../../src/video/engine/animation'

const clip = (o: Partial<Clip>): Clip => ({ id: 'c', trackId: 'v1', title: 'c', kind: 'video', start: 0, duration: 4, in: 0, out: 4, color: '#000', ...o })

describe('hold ease', () => {
  const held = setKeyEase(clip({ keyframes: { opacity: [{ t: 0, v: 1 }, { t: 2, v: 0 }] } }), 'opacity', 0, 'hold')
  it('is stored and named', () => {
    expect(held.keyframes!.opacity[0].ease).toBe('hold')
    expect(easeName(held.keyframes!.opacity[0])).toBe('hold')
    expect(EASE_LABEL.hold).toBe('Hold')
  })
  it('keeps the key value until the next key (keyframes.ts and the engine agree)', () => {
    expect(applyEase({ ease: 'hold' }, 0.99)).toBe(0)
    expect(valueAt(held, 'opacity', 1.9)).toBe(1)
    expect(valueAt(held, 'opacity', 2)).toBe(0)
    expect(sampleProp(held, 'opacity', 1.9, 1)).toBe(1)
    expect(sampleKeys(held.keyframes!.opacity, 1.9, 1)).toBe(1)
  })
  it('back to linear drops it', () => {
    const lin = setKeyEase(held, 'opacity', 0, 'linear')
    expect(lin.keyframes!.opacity[0].ease).toBeUndefined()
    expect(valueAt(lin, 'opacity', 1)).toBeCloseTo(0.5)
  })
})
