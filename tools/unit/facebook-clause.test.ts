// A Facebook caption that runs past 125 characters ends at its last clause that fits, not mid-thought with an ellipsis.
import { describe, expect, it } from 'vitest'
import { sanitizeFacebook } from '../../src/editorial/facebookCaption'

describe('A caption that runs long ends at a clause, not mid-thought', () => {
  it('cuts at the last comma that fits instead of trailing off', () => {
    const t = sanitizeFacebook('Nepal is back supplying Bangladesh 40MW of power after a two-month flood-driven halt, using new hydropower plants via India transmission lines and more words to run long\n\n#Nepal #Power #ESBPowerLine')
    const text = t.split('\n\n')[0]
    expect(text).toBe('Nepal is back supplying Bangladesh 40MW of power after a two-month flood-driven halt.')
    expect(text).not.toContain('…')
  })
  it('still cuts at a word, with an ellipsis, when there is no clause to end at', () => {
    const t = sanitizeFacebook('A'.repeat(10) + ' ' + 'word '.repeat(40) + '\n\n#A #B #C')
    expect(t.split('\n\n')[0].length).toBeLessThanOrEqual(126)
  })
})
