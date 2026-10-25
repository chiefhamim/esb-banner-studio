// The SEO checklist (17 points, each with its source) and the guards on the AI fixers. Synthetic text only.
import { describe, expect, it } from 'vitest'
import { analyzeSeo } from '../../src/editorial/seo'
import { safeBodyRewrite } from '../../src/editorial/seoFix'
import { analyzeSocial } from '../../src/editorial/socialChecks'

const BODY = [
  'The Sylhet gas field will get two new wells by March, the ministry said on Sunday.',
  'Each well is planned to add 20 million cubic feet of gas a day, officials added. The work costs Tk 592 crore and is led by BAPEX.',
  'Residents of the area will see no road closures during the drilling, according to the plan.',
].join('\n\n')

describe('the SEO checklist', () => {
  const base = { headline: 'Sylhet gas field to get two new wells', deck: 'BAPEX will drill them.', body: BODY, slug: 'sylhet-gas-field-two-new-wells', metaTitle: 'Sylhet gas field to get two new wells', metaDescription: 'The Sylhet gas field will get two new wells by March, adding 20 million cubic feet a day, the ministry said on Sunday.', keyphrase: 'Sylhet gas field', tags: ['BAPEX', 'Sylhet', 'gas field'], hasImage: true, imageAlt: 'A drilling rig at the Sylhet gas field' }
  it('has 17 points and every one names why it matters and where the rule comes from', () => {
    const c = analyzeSeo(base)
    expect(c).toHaveLength(17)
    for (const x of c) { expect(x.why).toBeTruthy(); expect(['google', 'practice']).toContain(x.src); expect(x.fix).toBeTruthy() }
  })
  it('a missing photo is a photo problem and a too-thin story is a reporting problem: neither can be written away', () => {
    expect(analyzeSeo({ ...base, hasImage: false }).find((c) => c.id === 'image')?.fix).toBe('photo')
    expect(analyzeSeo({ ...base, body: 'Short story only.' }).find((c) => c.id === 'length')?.fix).toBe('reporting')
  })
  it('Google sets no minimum length: a 160-word story passes the length check', () => {
    const body = Array.from({ length: 160 }, (_, i) => `word${i}`).join(' ')
    expect(analyzeSeo({ ...base, body }).find((c) => c.id === 'length')?.status).toBe('good')
  })
})

describe('a rewritten story is accepted only if it is the same story', () => {
  it('accepts splitting a sentence and reordering', () => {
    const next = BODY.replace('Each well is planned to add 20 million cubic feet of gas a day, officials added.', 'Each well is planned to add 20 million cubic feet of gas a day. Officials added this.')
    expect(safeBodyRewrite(BODY, next)).toBe(true)
  })
  it('refuses a changed or added number', () => {
    expect(safeBodyRewrite(BODY, BODY.replace('Tk 592 crore', 'Tk 600 crore'))).toBe(false)
    expect(safeBodyRewrite(BODY, BODY + ' It will create 400 jobs.')).toBe(false)
  })
  it('refuses a new name, a big length change, and an unchanged or empty answer', () => {
    expect(safeBodyRewrite(BODY, BODY.replace('BAPEX', 'Petrobangla'))).toBe(false)
    expect(safeBodyRewrite(BODY, 'Short.')).toBe(false)
    expect(safeBodyRewrite(BODY, BODY)).toBe(false)
    expect(safeBodyRewrite(BODY, '')).toBe(false)
  })
})

describe('the social checklist', () => {
  const url = 'https://esbpowerline.com/articles/s'
  const good = {
    facebook: 'Two new wells will lift Sylhet gas output by 40 million cubic feet a day.\n\n#Sylhet #Gas #Bangladesh #ESBPowerLine',
    x: `Two new wells for Sylhet.\n\n${url}`,
    linkedin: `Two new wells will lift Sylhet gas output. #Gas #Energy #Bangladesh\n\n${url}`,
    telegram: `📰 Two new wells for Sylhet gas field\n\n${url}`,
  }
  it('a well-formed set passes everything', () => {
    expect(analyzeSocial(good, 's').filter((c) => c.status !== 'good')).toEqual([])
  })
  it('flags a Facebook caption with a link, too long, with machine giveaways', () => {
    const bad = { ...good, facebook: `BREAKING — a very long caption that keeps going and going about the two new wells for the Sylhet gas field and everything around them, read more ${url} #A` }
    const ids = analyzeSocial(bad, 's').filter((c) => c.status !== 'good').map((c) => c.id)
    expect(ids).toEqual(expect.arrayContaining(['fb-nolink', 'fb-length', 'fb-tags', 'fb-human', 'fb-brand']))
  })
})
