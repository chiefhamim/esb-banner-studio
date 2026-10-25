// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { hasStoryMarks, storyFromMarkup } from './blocks'
import { validateChartIdeas } from './chart'

const story = [
  'Petrobangla will drill two wells in Sylhet, it said on Monday.',
  '## Output by year',
  '| Year | Output (MMCFD) |\n|---|---|\n| 2023 | 15.8 |\n| 2024 | 16.9 |\n| 2025 | 18.4 |',
  'The projects cover:',
  '- ==Two wells== in Sylhet\n- A **Tk 592 crore** budget\n- Completion by 2027',
  '> "We expect output to rise," the chairman said.\n> — Chairman, Petrobangla',
].join('\n\n')

describe('storyFromMarkup', () => {
  const { html, plain } = storyFromMarkup(story)
  it('builds the site HTML', () => {
    expect(html).toContain('<h2>Output by year</h2>')
    expect(html).toContain('<table>')
    expect(html).toContain('<th>Year</th>')
    expect(html).toContain('<td>15.8</td>')
    expect(html).toContain('<ul><li><p><span style="background-color: #fde68a">Two wells</span>')
    expect(html).toContain('<strong>Tk 592 crore</strong>')
    expect(html).toContain('<blockquote>')
  })
  it('leaves clean plain text with no marks', () => {
    expect(plain).not.toMatch(/\*\*|==|\|---|^## /m)
    expect(plain).toContain('Output by year')
    expect(plain).toContain('Two wells in Sylhet')
  })
  it('escapes markup the model might emit', () => {
    expect(storyFromMarkup('A <script>x</script> & B\n\n- <b onclick=x>y</b>').html).not.toMatch(/<script|<b /)
  })
  it('recognises a plain story', () => {
    expect(hasStoryMarks('One paragraph.\n\nAnother, with 2024 - and a - dash.')).toBe(false)
    expect(hasStoryMarks(story)).toBe(true)
  })
})

describe('validateChartIdeas', () => {
  const source = 'Output was 15.8 MMCFD in 2023, 16.9 in 2024 and 18.4 in 2025. ১৫.৮ বা ১৮'
  const good = { type: 'bar', title: 'Gas output', unit: 'MMCFD', labels: ['2023', '2024', '2025'], series: [{ name: '', values: [15.8, 16.9, 18.4] }] }
  it('keeps a chart whose numbers the source prints', () => { expect(validateChartIdeas(JSON.stringify([good]), source)).toHaveLength(1) })
  it('drops a chart with a number the source does not print (a computed or invented value)', () => {
    expect(validateChartIdeas(JSON.stringify([{ ...good, series: [{ name: '', values: [15.8, 16.9, 18.5] }] }]), source)).toHaveLength(0)
  })
  it('reads Bengali digits in the source and ignores malformed ideas', () => {
    expect(validateChartIdeas(JSON.stringify([{ ...good, labels: ['a', 'b'], series: [{ name: '', values: [15.8, 18] }] }]), source)).toHaveLength(1)
    expect(validateChartIdeas('not json', source)).toEqual([])
    expect(validateChartIdeas(JSON.stringify([{ title: 'x', labels: ['a'], series: [] }]), source)).toEqual([])
  })
})
