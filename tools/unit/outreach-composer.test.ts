// @vitest-environment jsdom
// softBreakOnEnter: Gmail's own rule for the desk's plain-text-with-marks editors — Enter alone starts a new
// paragraph (blank line, which blocksToHtml reads as a paragraph break), Shift+Enter breaks the line within one.
import { describe, expect, it, vi } from 'vitest'
import { softBreakOnEnter } from '../../src/outreach/compose'

function fire(value: string, pos: number, shiftKey: boolean) {
  const el = document.createElement('textarea')
  el.value = value
  el.selectionStart = el.selectionEnd = pos
  const preventDefault = vi.fn()
  let next = value
  const onChange = (v: string) => { next = v; el.value = v }
  softBreakOnEnter({ key: 'Enter', shiftKey, currentTarget: el, preventDefault } as unknown as import('react').KeyboardEvent<HTMLTextAreaElement>, value, onChange)
  return { next, preventDefault }
}

describe('softBreakOnEnter', () => {
  it('Shift+Enter is left to the browser — a plain line break within the same paragraph', () => {
    const { next, preventDefault } = fire('Dear {name}', 11, true)
    expect(preventDefault).not.toHaveBeenCalled()
    expect(next).toBe('Dear {name}') // untouched: the native textarea inserts its own "\n"
  })
  it('Enter alone inserts a paragraph break (blank line)', () => {
    const { next, preventDefault } = fire('Dear {name}', 11, false)
    expect(preventDefault).toHaveBeenCalled()
    expect(next).toBe('Dear {name}\n\n')
  })
  it('does not double the blank line when the cursor already sits at one', () => {
    const { next } = fire('Dear {name}\n\n', 13, false)
    expect(next).toBe('Dear {name}\n\n\n') // one more "\n" completes the blank line, not two
  })
})
