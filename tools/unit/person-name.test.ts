import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { cleanPersonName, nameHasNumber } from '../../src/outreach/personName'

const require = createRequire(import.meta.url)
const engine = require('../../electron/person-name.cjs')

const CASES: [string, string][] = [
  ['মোঃ মাহফুজার রহমান (২০৩৯৯)', 'মোঃ মাহফুজার রহমান'],
  ['A. Karim (1042)', 'A. Karim'],
  ['A. Karim - 1042', 'A. Karim'],
  ['A. Karim, #1042', 'A. Karim'],
  ['মোঃ করিম ২০৩৯৯', 'মোঃ করিম'],
  ['12. Rahim Uddin', 'Rahim Uddin'],
  ['Rahim [ID 77] Uddin', 'Rahim Uddin'],
  ['Engr. Kamal (PEng)', 'Engr. Kamal (PEng)'],
  ['Elizabeth II', 'Elizabeth II'],
  ['(২০৩৯৯)', ''],
]

describe('a name from a sheet, without its numbers', () => {
  it.each(CASES)('%s', (raw, clean) => {
    expect(cleanPersonName(raw)).toBe(clean)
    expect(engine.cleanPersonName(raw)).toBe(clean)
  })
  it('sees Bangla digits as numbers, which \\d does not', () => {
    expect(/\d/.test('রহমান (২০৩৯৯)')).toBe(false)
    expect(nameHasNumber('রহমান (২০৩৯৯)')).toBe(true)
    expect(engine.nameHasNumber('রহমান (২০৩৯৯)')).toBe(true)
    expect(nameHasNumber('Elizabeth II')).toBe(false)
    expect(nameHasNumber('')).toBe(false)
  })
})
