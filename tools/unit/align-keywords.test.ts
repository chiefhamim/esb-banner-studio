// The main keyphrase (first focus keyword) must come from the headline and the SEO title, so the title is never rebuilt
// around a phrase the headline does not carry. Synthetic stories only.
import { describe, expect, it } from 'vitest'
import { alignKeywords } from '../../src/editorial/translator'

const BODY = 'Nepal has restarted power exports to Bangladesh. The power exports run through India. Officials said the power exports total 40 MW.'

describe('alignKeywords', () => {
  it('puts first the listed phrase that is in both the headline and the SEO title', () => {
    const out = alignKeywords('Nepal Resumes 40 MW Power Exports to Bangladesh', BODY, 'Nepal Resumes 40 MW Power Exports', 'Nepal Electricity Authority, power exports, Bangladesh')
    expect(out.split(', ')[0]).toBe('power exports')
  })
  it('falls back to a headline phrase the story uses when no listed phrase is in the headline', () => {
    const out = alignKeywords('Nepal Resumes 40 MW Power Exports to Bangladesh', BODY, 'Nepal Resumes Power Exports', 'Nepal power export, Indian Energy Exchange')
    expect(countWords(out.split(', ')[0])).toBeGreaterThanOrEqual(2)
    expect('nepal resumes 40 mw power exports to bangladesh').toContain(out.split(', ')[0].toLowerCase())
  })
  it('keeps the rest of the list, without a duplicate, at most six', () => {
    const out = alignKeywords('Gas crisis halts urea output', 'The gas crisis halts urea output.', 'Gas crisis halts urea output', 'urea output, gas crisis, Titas Gas, BCIC, Jamalpur, Sarishabari, extra')
    const parts = out.split(', ')
    expect(parts).toHaveLength(6)
    expect(new Set(parts.map((p) => p.toLowerCase())).size).toBe(6)
  })
})

const countWords = (t: string) => t.split(/\s+/).filter(Boolean).length
