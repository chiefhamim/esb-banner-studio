import { describe, it, expect } from 'vitest'
import { suggestKeyphrases, analyzeSeo, buildMetaTitle, buildMetaDescription, buildSlug } from '../../src/editorial/seo'
import { extractFocusKeywords } from '../../src/editorial/translator'

const headline = 'Petrobangla to drill two new wells in Sylhet gas field for Tk 592 crore'
const deck = 'BAPEX will drill the wells, which are expected to add 30 MMCFD of gas to the national grid by 2026.'
const body = `Petrobangla has taken an initiative to drill two new development wells under the Sylhet gas field, officials said on Sunday.

The project, to be implemented by BAPEX, is estimated to cost Tk 592 crore and will supply 30 MMCFD of gas per day to the national grid by 2026.

Officials said the new wells would ease the gas crisis faced by industries in the Dhaka region. Petrobangla chairman said the country has no alternative but to increase investment in local gas exploration.

He also said that preparations are under way to drill three more wells next year as part of the gas exploration plan.`

describe('Keyphrases', () => {
  it('names what the story is about — organisations, places, topics — not amounts or filler', () => {
    const k = suggestKeyphrases(headline, deck, body).map((x) => x.phrase)
    expect(k.slice(0, 2)).toEqual(expect.arrayContaining(['Petrobangla', 'Sylhet gas field']))
    expect(k).toEqual(expect.arrayContaining(['BAPEX', 'gas exploration', 'national grid']))
    expect(k.some((p) => /\d/.test(p) || /crore|said|officials/i.test(p))).toBe(false)
    // action fragments are not topics
    expect(suggestKeyphrases('Plan to add gas and boost supply', '', 'They will add gas to boost supply. They add gas and boost supply.').map((x) => x.phrase)).not.toEqual(expect.arrayContaining(['add gas']))
    // the longer phrase wins over the fragment it contains
    expect(k).not.toContain('gas field')
  })

  it('translation tags use the same picker', () => {
    expect(extractFocusKeywords(headline, body).split(', ')).toContain('Sylhet gas field')
  })
})

describe('SEO checks', () => {
  const base = { headline, deck, body, slug: '', metaTitle: '', metaDescription: '', keyphrase: '', tags: [] as string[], hasImage: false }
  const status = (input: typeof base, id: string) => analyzeSeo(input).find((c) => c.id === id)?.status

  it('asks for a keyphrase before anything else', () => {
    expect(status(base, 'kp-set')).toBe('bad')
  })

  it('builders produce a title, description and slug that pass their checks', () => {
    const kp = 'Sylhet gas field'
    const input = { ...base, keyphrase: kp, metaTitle: buildMetaTitle(headline, kp), metaDescription: buildMetaDescription(deck, body, kp), slug: buildSlug(headline, kp), tags: ['Petrobangla', 'BAPEX', 'Sylhet gas field'], hasImage: true }
    expect(input.metaTitle.length).toBeLessThanOrEqual(60)
    expect(input.metaTitle).toBe('Sylhet gas field: Petrobangla to drill two new wells')
    expect(input.metaDescription.length).toBeGreaterThanOrEqual(120)
    expect(input.metaDescription.length).toBeLessThanOrEqual(158)
    expect(input.slug).toBe('sylhet-gas-field-petrobangla-drill-two-new-wells')
    for (const id of ['kp-title', 'kp-desc', 'kp-slug', 'kp-intro', 'title-len', 'desc-len', 'slug', 'image', 'tags']) expect([id, status(input, id)]).toEqual([id, 'good'])
  })

  it('flags a keyphrase another published story already targets', () => {
    const c = analyzeSeo({ ...base, keyphrase: 'Sylhet gas field', publishedTitles: ['Sylhet gas field output falls'] }).find((x) => x.id === 'kp-unique')
    expect(c?.status).toBe('warn')
    expect(c?.detail).toContain('Sylhet gas field output falls')
  })

  it('measures length honestly', () => {
    expect(status({ ...base, body: 'One short line.' }, 'length')).toBe('bad')
    expect(status({ ...base, metaTitle: 'x'.repeat(70) }, 'title-len')).toBe('warn')
  })
})
