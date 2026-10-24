import { describe, it, expect } from 'vitest'
import { suggestKeyphrases, analyzeSeo, buildMetaTitle, buildMetaDescription, buildSlug, effectiveTitle, effectiveDescription, cleanDescription, visibleTitle } from '../../src/editorial/seo'
import { extractFocusKeywords, seoFields, stripSiteSuffix } from '../../src/editorial/translator'

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
    // the headline cut at a clause boundary keeps it a sentence and keeps the keyphrase
    expect(input.metaTitle).toBe('Petrobangla to drill two new wells in Sylhet gas field')
    expect(input.metaDescription.length).toBeGreaterThanOrEqual(120)
    expect(input.metaDescription.length).toBeLessThanOrEqual(160)
    expect(input.slug).toBe('sylhet-gas-field-petrobangla-drill-two-new-wells')
    for (const id of ['kp-h1', 'kp-title', 'kp-desc', 'kp-slug', 'kp-intro', 'title-len', 'desc-len', 'slug', 'tags', 'lede']) expect([id, status(input, id)]).toEqual([id, 'good'])
    expect(status({ ...input, imageAlt: 'Drilling rig at a Sylhet gas field well site' }, 'image')).toBe('good')
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

describe('SEO matches what esbpowerline.com renders', () => {
  const base = { headline, deck, body, slug: 'x', metaTitle: '', metaDescription: '', keyphrase: 'Sylhet gas field', tags: [] as string[], hasImage: true }
  const check = (i: Partial<typeof base> & Record<string, unknown>, id: string) => analyzeSeo({ ...base, ...i }).find((c) => c.id === id)

  it('the <title> is the SEO title or the headline, with no site-name suffix', () => {
    expect(effectiveTitle({ metaTitle: '', headline: 'Gas output rises' })).toBe('Gas output rises')
    expect(buildMetaTitle(headline, 'Sylhet gas field')).not.toMatch(/ESB PowerLine/)
    expect(stripSiteSuffix('Gas output rises | ESB PowerLine')).toBe('Gas output rises')
    expect(stripSiteSuffix('Gas output rises - ESB Powerline')).toBe('Gas output rises')
  })

  it('the description is the meta description or the deck, cut at 160 like the site', () => {
    const long = 'Officials said the wells will add gas. '.repeat(8).trim()
    expect(effectiveDescription({ metaDescription: long, deck: '' }).length).toBeLessThanOrEqual(160)
    expect(effectiveDescription({ metaDescription: long, deck: '' })).toMatch(/\.$/) // at a sentence end
    expect(cleanDescription('word '.repeat(50))).toMatch(/…$/)
    expect(check({ metaDescription: long }, 'desc-len')?.status).toBe('warn')
    expect(check({}, 'desc-own')?.status).toBe('warn') // the deck stands in: say so
  })

  it('judges the title by what Google shows, and the keyphrase by whether it is in that part', () => {
    const t = 'Bangladesh Power Development Board and Power Grid Company review the national transmission plan for Sylhet gas field'
    expect(visibleTitle(t)).toMatch(/ …$/)
    expect(check({ metaTitle: t }, 'title-len')?.status).toBe('warn')
    expect(check({ metaTitle: t }, 'kp-title')?.status).toBe('warn') // present, but past the cut
    expect(check({ metaTitle: 'Sylhet gas field: two new wells for Petrobangla' }, 'kp-title')?.status).toBe('good')
  })

  it('the slug check asks only for the words a slug keeps', () => {
    expect(check({ keyphrase: 'Ministry of Power', slug: 'ministry-power-budget' }, 'kp-slug')?.status).toBe('good')
    expect(check({ keyphrase: 'Ministry of Power', slug: 'power-budget' }, 'kp-slug')?.detail).toContain('ministry')
  })

  it('news checks: keyphrase in the headline, a short lede, alt text that describes the photo', () => {
    expect(check({ headline: 'Two new wells approved' }, 'kp-h1')?.status).toBe('warn')
    expect(check({ body: Array(70).fill('word').join(' ') + '.' }, 'lede')?.status).toBe('warn')
    expect(check({}, 'image')?.detail).toMatch(/alt text/i)
  })

  it('a Title Case headline does not produce headline fragments as keyphrases', () => {
    const k = suggestKeyphrases('Bangladesh–India Interconnection Raises Rooppur Grid Capacity', 'The Power Grid Company of Bangladesh says the Bheramara link will raise import capacity.', 'The Power Grid Company of Bangladesh said the Bheramara link upgrade is complete. The Bheramara link carries power from India.').map((x) => x.phrase)
    expect(k.some((p) => /raises/i.test(p))).toBe(false)
    expect(k).toEqual(expect.arrayContaining(['Power Grid Company of Bangladesh']))
  })

  it('every translation path hands the panel fields it grades as good, with no suffix', () => {
    const kws = 'Sylhet gas field, Petrobangla'
    const f = seoFields(headline, deck, body, kws, 'Sylhet gas field wells approved | ESB PowerLine', 'Too short.')
    expect(f.metaTitle).toBe('Sylhet gas field wells approved')
    expect(f.metaDescription.length).toBeGreaterThanOrEqual(120)
    expect(seoFields(headline, deck, body, kws, 'A title without the phrase').metaTitle).toMatch(/Sylhet gas field/)
  })
})

describe('Title Case headlines', () => {
  it('a phrase only the headline uses is not offered — it is a fragment, not a topic', () => {
    const k = suggestKeyphrases('Bangladesh–India Cross-Border Transmission Interconnection Raises Rooppur Nuclear Grid Capacity by 1,200 MW', 'The Bangladesh Power Development Board says the Bheramara–Baharampur interconnection upgrade will raise import capacity.', 'The Bangladesh Power Development Board said the Bheramara–Baharampur interconnection upgrade is complete. Officials said the Bheramara–Baharampur link will carry more power from India.').map((x) => x.phrase)
    expect(k.some((p) => /Rooppur Nuclear Grid|Nuclear Grid Capacity/.test(p))).toBe(false)
    expect(k).toEqual(expect.arrayContaining(['Bangladesh Power Development Board']))
  })
})
