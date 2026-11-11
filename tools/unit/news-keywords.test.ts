import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFS, keywordsFor, titleHasWord } from '../../src/news/watchStore'
import { buildMatcher } from '../../src/news/matcher'

describe("the editor's own news keywords", () => {
  it('match English as a whole word, plural included', () => {
    expect(titleHasWord('LPG price rises again', 'lpg')).toBe(true)
    expect(titleHasWord('Two tankers reach Chattogram', 'Tanker')).toBe(true)
    expect(titleHasWord('ALPGA holds its annual meeting', 'LPG')).toBe(false)
    expect(titleHasWord('Tankerless future', 'Tanker')).toBe(false)
  })
  it('match Bangla inside a word, so inflected forms count', () => {
    expect(titleHasWord('তিতাসের গ্যাস সংকট', 'তিতাস')).toBe(true)
  })
  it('take a regex character literally', () => {
    expect(titleHasWord('Output (MW) up', '(MW)')).toBe(true)
  })
  it('reach the headline check, so a word its rules do not know still finds headlines', () => {
    const base = { ...DEFAULT_PREFS, keep: [] }
    expect(buildMatcher(keywordsFor(base))('A ship called Zubair docks in port')).toBeFalsy()
    const match = buildMatcher(keywordsFor({ ...base, keep: ['Zubair', 'Tanker'] }))
    expect(match('A ship called Zubair docks in port')).toBeTruthy()
    expect(match('Two tankers reach the port')).toBeTruthy()
  })
})
