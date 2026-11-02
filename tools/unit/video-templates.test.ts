import { describe, it, expect } from 'vitest'
import { TEMPLATES, applyTemplate, templateById, type TemplateStory } from '../../src/video/templates'
import { DEFAULT_BRAND, sanitizeBrand, accentFor, loadBrand, saveBrand } from '../../src/video/brandKit'
import { exportBlocker } from '../../src/video/exportVideo'
import { quotesWithSpeakers } from '../../src/video/storyVideo'
import { deserializeVideoProject, serializeVideoProject } from '../../src/video/timeline'

const body = [
  'Petrobangla will drill two new wells in Sylhet this winter. The wells are expected to add 30 MMCFD to the grid.',
  '“We expect the first gas by December and no delay,” said Rahim Uddin, the project director at Petrobangla.',
  'Officials said the project will cost Tk 592 crore. Work begins in December near the Jalalabad field area.',
].join('\n\n')
const story = (over: Partial<TemplateStory> = {}): TemplateStory => ({
  headline: 'Petrobangla to drill two new wells in Sylhet',
  deck: 'Two new wells are set to raise gas supply by winter this year.',
  body,
  desk: 'Gas & Petroleum',
  bannerUrl: 'blob:banner',
  photoUrl: 'blob:p1',
  category: '02',
  quote: quotesWithSpeakers(body).named[0] ?? null,
  ...over,
})

describe('the seven package templates', () => {
  it('are all there with the shapes the plan names', () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(['news-short', 'reel', 'youtube-report', 'facebook-feed', 'grid-daily', 'quote-video', 'explainer-data'])
    expect(templateById('news-short')).toMatchObject({ aspect: '9:16', maxSeconds: 60 })
    expect(templateById('reel')).toMatchObject({ aspect: '9:16', maxSeconds: 90 })
    expect(templateById('youtube-report')?.aspect).toBe('16:9')
    expect(templateById('facebook-feed')?.aspect).toBe('4:5')
  })

  it('each builds a project in its own shape, with its loudness, music level and export preset, within its length', () => {
    for (const spec of TEMPLATES) {
      const r = applyTemplate(spec, story(), DEFAULT_BRAND)
      expect(r.refused, spec.id).toBeUndefined()
      const p = r.project
      expect(p.aspect, spec.id).toBe(spec.aspect)
      expect(p.loudnessTarget, spec.id).toBe(spec.loudness)
      expect(p.busVolume?.music, spec.id).toBe(spec.musicDb)
      expect(p.exportPreset?.fps, spec.id).toBe(spec.export.fps)
      expect(p.template?.id, spec.id).toBe(spec.id)
      expect(p.duration, spec.id).toBeLessThanOrEqual(spec.maxSeconds + 6) // data slots add their own seconds
    }
  })

  it('News Short stays under 60 seconds even for a long story', () => {
    const long = story({ body: Array.from({ length: 12 }, (_, i) => `Officials said the project number ${i + 1} will add more gas to the national grid this winter season.`).join(' ') })
    const p = applyTemplate(templateById('news-short')!, long, DEFAULT_BRAND).project
    expect(p.duration).toBeLessThanOrEqual(60.1)
  })

  it('the quote video needs a named speaker and says why it cannot be built without one', () => {
    const r = applyTemplate(templateById('quote-video')!, story({ quote: null }), DEFAULT_BRAND)
    expect(r.refused).toMatch(/names its speaker|speaker/i)
    const ok = applyTemplate(templateById('quote-video')!, story(), DEFAULT_BRAND)
    expect(ok.project.clips.some((c) => c.titleData?.template === 'quote')).toBe(true)
  })

  it('the Grid and Explainer templates leave empty figure cards that block the export (no placeholder text ever ships)', () => {
    for (const id of ['grid-daily', 'explainer-data'] as const) {
      const r = applyTemplate(templateById(id)!, story(), DEFAULT_BRAND)
      const cards = r.project.clips.filter((c) => c.id.startsWith('tpl-slot-'))
      expect(cards.length).toBe(templateById(id)!.dataSlots)
      expect(cards.every((c) => Object.values(c.titleData!.fields).every((v) => v === ''))).toBe(true)
      expect(r.notes.join(' ')).toMatch(/Data tab/)
    }
  })

  it('the brand kit decides the close, the logo corner and the accent', () => {
    const withCard = applyTemplate(templateById('youtube-report')!, story(), { ...DEFAULT_BRAND, endCard: true, bugCorner: 'bl' })
    expect(withCard.project.clips.some((c) => c.titleData?.template === 'end-card')).toBe(true)
    expect(withCard.project.bugCorner).toBe('bl')
    const without = applyTemplate(templateById('youtube-report')!, story(), { ...DEFAULT_BRAND, endCard: false, bugOn: false })
    expect(without.project.clips.some((c) => c.titleData?.template === 'end-card')).toBe(false)
    expect(without.project.clips.some((c) => c.title === 'Read more')).toBe(true)
    expect(without.project.bug).toBe(false)
  })

  it('portrait templates keep captions in the platform safe zone, and it survives saving', () => {
    const p = applyTemplate(templateById('reel')!, story(), DEFAULT_BRAND).project
    expect(p.safeZone).toBe('reels')
    const back = deserializeVideoProject(serializeVideoProject(p, []))
    expect(back?.safeZone).toBe('reels')
    expect(back?.template?.id).toBe('reel')
    expect(back?.exportPreset?.container).toBe('mp4')
  })

  it('a built story video is not blocked by anything but its media (no placeholder text)', () => {
    const p = applyTemplate(templateById('youtube-report')!, story(), DEFAULT_BRAND).project
    const why = exportBlocker(p)
    expect(why === null || !/empty|placeholder|required/i.test(why)).toBe(true)
  })
})

describe('brand kit', () => {
  it('reads anything back safely', () => {
    expect(sanitizeBrand({ accent: 'javascript:1', bugCorner: 'zz', bugOn: 0, endCard: false })).toEqual({ accent: 'auto', bugOn: true, bugCorner: 'tr', endCard: false })
    expect(sanitizeBrand(null)).toEqual(DEFAULT_BRAND)
    expect(sanitizeBrand({ accent: '04', bugCorner: 'br' })).toMatchObject({ accent: '04', bugCorner: 'br' })
  })
  it('is remembered on this PC', () => {
    const mem = new Map<string, string>()
    const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v) } }
    saveBrand({ ...DEFAULT_BRAND, bugCorner: 'tl', accent: 'stripes' }, st)
    expect(loadBrand(st)).toMatchObject({ bugCorner: 'tl', accent: 'stripes' })
    expect(accentFor(loadBrand(st), '02')).toBeUndefined()
    expect(accentFor(DEFAULT_BRAND, '02')).toBe('02')
  })
})
