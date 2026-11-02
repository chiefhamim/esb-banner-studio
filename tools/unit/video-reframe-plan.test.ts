import { describe, it, expect } from 'vitest'
import { sampleTimes } from '../../src/video/ai/faceTrack'
import { planReframe } from '../../src/video/ai/reframe'

describe('face sampling', () => {
  it('spaces samples evenly inside the clip range, capped', () => {
    const t = sampleTimes(10, 20, 4)
    expect(t.length).toBe(40)
    expect(t[0]).toBeGreaterThan(10)
    expect(t[t.length - 1]).toBeLessThan(20)
    expect(sampleTimes(0, 1000, 4, 100).length).toBe(100)
    expect(sampleTimes(5, 5)).toEqual([])
  })
})

describe('reframe plan from face boxes', () => {
  it('follows a subject moving left to right in a 16:9 source (keyframes produced, crop inside frame)', () => {
    const frames = Array.from({ length: 40 }, (_, i) => ({ t: i * 0.25, box: { x: 0.1 + (i / 40) * 0.6, y: 0.3, w: 0.12, h: 0.2 } }))
    const plan = planReframe(frames, { srcW: 1920, srcH: 1080, target: '9:16', clipIn: 0 })
    expect(plan.keyframes.offX.length).toBeGreaterThan(1)
    expect(plan.insideRatio).toBeGreaterThan(0.8)
    expect(plan.cropW).toBeLessThan(1)
  })
})
