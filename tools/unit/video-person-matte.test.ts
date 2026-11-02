import { describe, it, expect } from 'vitest'
import { EFFECT_DEFS, newEffect, sanitizeEffects } from '../../src/video/effects'
import { usesPersonMatte } from '../../src/video/engine/personMatte'

describe('Remove background effect', () => {
  it('is defined, footage-only (not on adjustment layers), at most one per clip', () => {
    const d = EFFECT_DEFS.personMatte
    expect(d.label).toBe('Remove background')
    expect(d.adjustment).toBe(false)
    expect(d.max).toBe(1)
  })

  it('starts keeping the person with some edge softness', () => {
    const e = newEffect('personMatte', [])
    expect(e.type).toBe('personMatte')
    expect(e.params?.keep).toBe('person')
    expect(typeof e.params?.edge).toBe('number')
  })

  it('survives saving and loading a project, and a bad choice falls back', () => {
    const e = newEffect('personMatte', [])
    const kept = sanitizeEffects([e])
    expect(kept?.[0].type).toBe('personMatte')
    const bad = sanitizeEffects([{ ...e, params: { keep: 'nonsense', edge: 9 } }])
    expect(bad?.[0].params?.keep).toBe('person')
    expect(Number(bad?.[0].params?.edge)).toBeLessThanOrEqual(1)
  })

  it('usesPersonMatte sees only enabled footage effects', () => {
    const on = { kind: 'video', effects: [{ type: 'personMatte' }] }
    const off = { kind: 'video', effects: [{ type: 'personMatte', enabled: false }] }
    const title = { kind: 'overlay', effects: [{ type: 'personMatte' }] }
    expect(usesPersonMatte({ clips: [on] })).toBe(true)
    expect(usesPersonMatte({ clips: [off, title] })).toBe(false)
  })
})
