// Phase 3 — Part A: title clips on the timeline (model, file sanitizer, migration of Phase 0–2 overlays, spec
// building with the inspector's choices, export checks, safe zones, story shortcuts).
import { describe, expect, it } from 'vitest'
import { migrateTimeline, type Clip } from '../../src/video/timeline'
import { legacyView, migrateOverlayClip, sanitizeTitleData, MAX_FIELD_CHARS, type TitleData } from '../../src/video/titleModel'
import { buildTitleSpec, phaseOf, roughMeasure, titleAccent, titleProblemText, titleProblems } from '../../src/video/titleClip'
import { quotesIn } from '../../src/video/titleUi'
import { DEFAULT_SAFE_ZONES } from '../../src/video/titles/brand'
import { guideZones } from '../../src/video/engine/guides'
import { getCategory } from '../../src/core/tokens'
import { buildStoryTimeline } from '../../src/video/storyVideo'
import type { TextElement } from '../../src/video/titles/spec'
import { layoutTitle } from '../../src/video/titles/layout'

const title = (td: TitleData, extra: Partial<Clip> = {}): Clip => ({ id: 't', trackId: 'v2', title: 'T', kind: 'overlay', start: 1, duration: 6, in: 0, out: 6, color: '#000', titleData: td, ...extra })
const proj = (clips: Clip[], w = 1920, h = 1080) => ({ clips, width: w, height: h })

describe('title data in project files', () => {
  it('keeps a known template and only its own fields, capped', () => {
    const td = sanitizeTitleData({ template: 'lower-third', fields: { name: 'x'.repeat(5000), role: 7, evil: 'y' } })!
    expect(Object.keys(td.fields).sort()).toEqual(['name', 'role'])
    expect(td.fields.name.length).toBe(MAX_FIELD_CHARS)
    expect(td.fields.role).toBe('')
  })
  it('refuses an unknown template, cleans presets, colours and numbers', () => {
    expect(sanitizeTitleData({ template: 'nope', fields: {} })).toBeNull()
    expect(sanitizeTitleData('x')).toBeNull()
    const td = sanitizeTitleData({ template: 'headline', fields: { headline: 'H' }, categoryId: '99', platform: 'tiktok', animIn: { preset: 'word', duration: 1e9, delay: -3, stagger: 'x', ease: 'warp' }, animOut: { preset: 'explode' }, style: { fill: 'red', stroke: '#112233', strokeWidth: 400, shadow: 'yes' } })!
    expect(td.categoryId).toBeUndefined()
    expect(td.platform).toBeUndefined()
    expect(td.animIn).toEqual({ preset: 'word', duration: 5, delay: 0, stagger: 0, ease: 'esb' })
    expect(td.animOut).toBeUndefined()
    expect(td.style).toEqual({ stroke: '#112233', strokeWidth: 12 })
  })
  it('a sticker needs a known shape; its place is clamped', () => {
    expect(sanitizeTitleData({ template: 'sticker', fields: {} })).toBeNull()
    const td = sanitizeTitleData({ template: 'sticker', fields: { text: 'Here' }, sticker: { shape: 'callout', color: 'neon', x: 9, y: -1, size: 0, rotation: 9999 } })!
    expect(td.sticker).toEqual({ shape: 'callout', color: 'red', x: 1, y: 0, size: 0.04, rotation: 360 })
    expect(td.fields).toEqual({ text: 'Here' })
  })
  it('keeps the site categories (01–10), the story palette', () => {
    expect(sanitizeTitleData({ template: 'breaking', fields: {}, categoryId: '10' })!.categoryId).toBe('10')
    expect(titleAccent(title({ template: 'breaking', fields: {}, categoryId: '04' }))).toBe(getCategory('04').accent)
    expect(titleAccent(title({ template: 'breaking', fields: {} }, { accent: '#123456' }))).toBe('#123456')
    expect(titleAccent(title({ template: 'breaking', fields: {} }))).toBeNull()
  })
})

describe('Phase 0–2 overlays become classic title clips', () => {
  const old = { id: 'o', trackId: 'v2', title: 'Lower third', kind: 'overlay' as const, start: 0, duration: 4, in: 0, out: 4, color: '#000', overlayType: 'lower-third' as const, overlayText: 'Name', overlaySub: 'Role', accent: '#7c3aed' }
  it('same words, the classic look; seen back as the old overlay for drawing', () => {
    const m = migrateOverlayClip(old)
    expect(m.titleData).toEqual({ template: 'lower-third', look: 'classic', classic: 'lower-third', fields: { name: 'Name', role: 'Role' } })
    expect(m.overlayType).toBeUndefined()
    const v = legacyView(m)
    expect([v.overlayType, v.overlayText, v.overlaySub, v.accent]).toEqual(['lower-third', 'Name', 'Role', '#7c3aed'])
  })
  it('card, headline and breaking map their two fields; logo and pictures are left alone', () => {
    expect(migrateOverlayClip({ ...old, overlayType: 'card', overlayText: 'T', overlaySub: 'B' }).titleData).toMatchObject({ template: 'text-card', classic: 'card', fields: { title: 'T', text: 'B' } })
    expect(migrateOverlayClip({ ...old, overlayType: 'headline' }).titleData?.fields).toEqual({ headline: 'Name', kicker: 'Role' })
    expect(migrateOverlayClip({ ...old, overlayType: 'breaking' }).titleData?.fields).toEqual({ headline: 'Name', sub: 'Role' })
    const logo = { ...old, overlayType: 'logo' as const }
    expect(migrateOverlayClip(logo)).toBe(logo)
    const pic = { ...old, sourceUrl: 'blob:x' }
    expect(migrateOverlayClip(pic)).toBe(pic)
  })
  it('opening a file migrates them, and a saved title clip round-trips', () => {
    const tl = migrateTimeline({ timelineVersion: 2, tracks: [{ id: 'v2', name: 'V2', kind: 'overlay' }], clips: [old, { ...old, id: 'logo', overlayType: 'logo', overlayText: undefined, overlaySub: undefined }] })
    expect(tl.clips[0].titleData?.look).toBe('classic')
    expect(tl.clips[1].titleData).toBeUndefined()
    expect(tl.clips[1].overlayType).toBe('logo')
    expect(tl.clips[1].overlayText).toBeUndefined()
    const again = migrateTimeline({ timelineVersion: 2, tracks: tl.tracks, clips: JSON.parse(JSON.stringify(tl.clips)) })
    expect(again.clips[0].titleData).toEqual(tl.clips[0].titleData)
  })
  it('title data on a non-overlay clip is dropped', () => {
    const tl = migrateTimeline({ timelineVersion: 2, tracks: [{ id: 'v1', name: 'V1', kind: 'video' }], clips: [{ ...old, id: 'v', trackId: 'v1', kind: 'video', overlayType: undefined, titleData: { template: 'lower-third', fields: { name: 'x' } } }] })
    expect(tl.clips[0].titleData).toBeUndefined()
  })
  it('Story → video makes classic title clips (the first cut looks as before)', () => {
    const tl = buildStoryTimeline({ aspect: '16:9', headline: 'H', deck: '', body: 'One two three four five six. Seven eight nine ten eleven.', desk: 'Desk', bannerUrl: null, photoUrl: 'blob:p' })
    expect(tl.clips.filter((c) => c.kind === 'overlay').every((c) => c.titleData?.look === 'classic' && !c.overlayType)).toBe(true)
  })
})

describe('building a title clip', () => {
  it('editor draws labels for empty fields; export leaves them out', () => {
    const c = title({ template: 'lower-third', fields: { name: '', role: '' } })
    const ed = buildTitleSpec(c, 1920, 1080, true, roughMeasure)!
    expect(ed.elements.some((e) => e.type === 'text' && e.placeholder && e.text === 'Speaker name')).toBe(true)
    const ex = buildTitleSpec(c, 1920, 1080, false, roughMeasure)!
    expect(ex.elements.length).toBe(0)
  })
  it('the category accent colours the bar; words come from the fields only', () => {
    const c = title({ template: 'lower-third', fields: { name: 'ক্ষমতা স্ত্রী', role: 'Role' }, categoryId: '05' })
    const s = buildTitleSpec(c, 1920, 1080, false, roughMeasure)!
    expect(s.elements.find((e) => e.id === 'accent')).toMatchObject({ fill: getCategory('05').accent })
    const texts = s.elements.filter((e): e is TextElement => e.type === 'text').map((e) => e.text)
    expect(texts).toEqual(['ESB POWER LINE', 'ক্ষমতা স্ত্রী', 'Role'])
  })
  it('style and animation choices apply to the words, not the brand kicker or the panel', () => {
    const c = title({ template: 'lower-third', fields: { name: 'N', role: 'R' }, style: { fill: '#ff0000', fill2: '#00ff00', stroke: '#000000', strokeWidth: 4, shadow: true, box: '#111111' }, animIn: { preset: 'type-on', duration: 0, delay: 0.2, stagger: 0.05, ease: 'esb' }, animOut: { preset: 'none', duration: 0, delay: 0, stagger: 0, ease: 'esb' } })
    const s = buildTitleSpec(c, 1920, 1080, false, roughMeasure)!
    const name = s.elements.find((e) => e.id === 'name') as TextElement
    expect(name.style.fill).toEqual({ type: 'linear', angle: 0, stops: [[0, '#ff0000'], [1, '#00ff00']] })
    expect(name.style.stroke).toEqual({ color: '#000000', width: 4 * (1080 / 1080) })
    expect(name.style.box?.fill).toBe('#111111')
    expect(name.anim?.in?.unit).toBe('grapheme')
    expect(name.anim?.in?.stagger).toBeCloseTo(0.05)
    expect(name.anim?.in?.delay).toBeCloseTo(0.2)
    expect(name.anim?.out).toBeUndefined()
    const kicker = s.elements.find((e) => e.id === 'kicker') as TextElement
    expect(kicker.style.fill).not.toBe('#ff0000')
    expect(s.elements.find((e) => e.id === 'panel')?.anim?.in?.effects).toContain('slide')
  })
  it('every preset gives a phase (none = cut)', () => {
    for (const preset of ['fade', 'type-on', 'word', 'line', 'slide-up', 'slide-left', 'slide-right', 'scale', 'mask', 'blur'] as const) {
      const p = phaseOf({ preset, duration: 0.4, delay: 0.1, stagger: 0.05, ease: 'easeOut' })
      expect(p, preset).not.toBeNull()
      expect(p!.delay, preset).toBeCloseTo(0.1)
    }
    expect(phaseOf({ preset: 'none', duration: 1, delay: 0, stagger: 0, ease: 'esb' })).toBeNull()
  })
  it('the out phase ends at the end of the clip (a split second half keeps its time)', () => {
    const c = title({ template: 'name-strap', fields: { name: 'N' } }, { in: 2, out: 6, duration: 4 })
    const s = buildTitleSpec(c, 1920, 1080, false, roughMeasure)!
    expect(s.duration).toBe(6)
  })
})

describe('safe zones', () => {
  it('a 9:16 lower third stays out of the Reels bottom and right zones', () => {
    for (const name of ['A', 'আব্দুল্লাহ আল মামুন ক্ষিতীশ চন্দ্র স্ত্রীবর্গ বিশ্বাস মজুমদার চৌধুরী']) {
      const s = buildTitleSpec(title({ template: 'lower-third', fields: { name, role: 'Chief executive, a very long organisation name here' } }), 1080, 1920, false, roughMeasure)!
      const z = DEFAULT_SAFE_ZONES.platforms.reels
      for (const e of s.elements) {
        const bottom = e.type === 'text' ? e.y + layoutTitle({ text: e.text, font: e.font, maxWidth: e.w, maxLines: e.maxLines }, roughMeasure).height : e.y + (e as { h: number }).h
        expect(bottom, e.id).toBeLessThanOrEqual(1920 * (1 - z.bottom) + 1)
        expect(e.x + (e as { w: number }).w, e.id).toBeLessThanOrEqual(1080 * (1 - z.right) + 1)
      }
    }
  })
  it('Shorts zones are used when chosen; none = title safe only', () => {
    const shorts = buildTitleSpec(title({ template: 'name-strap', fields: { name: 'N' }, platform: 'shorts' }), 1080, 1920, false, roughMeasure)!
    expect(shorts.elements[0].x + (shorts.elements[0] as { w: number }).w).toBeLessThanOrEqual(1080 * 0.86 + 1)
    const none = buildTitleSpec(title({ template: 'lower-third', fields: { name: 'N' }, platform: 'none' }), 1080, 1920, false, roughMeasure)!
    const panel = none.elements.find((e) => e.id === 'panel') as { y: number; h: number }
    expect(panel.y + panel.h).toBeGreaterThan(1920 * 0.8)
  })
  it('the monitor guides shade the same zones', () => {
    const z = guideZones({ platform: 'reels' }, 1080, 1920)
    expect(z.bands[0]).toMatchObject({ y: 1920 * 0.8, h: 1920 * 0.2 })
    expect(guideZones({ platform: 'reels' }, 1920, 1080).bands).toEqual([])
  })
})

describe('export checks', () => {
  it('an empty required field blocks the export and is named', () => {
    const p = titleProblems(proj([title({ template: 'lower-third', fields: { name: '', role: 'R' } })]))
    expect(p).toHaveLength(1)
    expect(p[0].messages.join()).toContain('“Speaker name” is empty')
    expect(titleProblemText(p)).toMatch(/1 title cannot be exported yet\. Lower third at 0:01\.0: “Speaker name” is empty/)
  })
  it('placeholder or filler text blocks it', () => {
    for (const v of ['Speaker name', 'TBD', 'Lorem ipsum', '[Name]', '{{name}}', 'Your name here']) {
      const p = titleProblems(proj([title({ template: 'name-strap', fields: { name: v } })]))
      expect(p[0]?.messages.join(), v).toMatch(/placeholder/)
    }
    expect(titleProblems(proj([title({ template: 'quote', fields: { quote: 'He said [the minister] would sign', speaker: 'S', speakerRole: '' } })]))).toEqual([])
  })
  it('filled titles, the end card and a shape pass; an empty callout does not', () => {
    expect(titleProblems(proj([title({ template: 'headline', fields: { headline: 'H', kicker: '' } }), title({ template: 'end-card', fields: {} }, { id: 'e' }), title({ template: 'sticker', fields: {}, sticker: { shape: 'arrow', color: 'red', x: 0.5, y: 0.5, size: 0.3, rotation: 0 } }, { id: 's' })]))).toEqual([])
    expect(titleProblems(proj([title({ template: 'sticker', fields: { text: '' }, sticker: { shape: 'callout', color: 'red', x: 0.5, y: 0.5, size: 0.3, rotation: 0 } })]))[0].messages).toEqual(['“Callout text” is empty'])
  })
  it('a classic title keeps the old rule: empty is left out, filler is refused', () => {
    expect(titleProblems(proj([migrateOverlayClip({ ...title({ template: 'lower-third', fields: {} }), titleData: undefined, overlayType: 'lower-third', overlayText: '', overlaySub: '' })]))).toEqual([])
    expect(titleProblems(proj([migrateOverlayClip({ ...title({ template: 'lower-third', fields: {} }), titleData: undefined, overlayType: 'lower-third', overlayText: 'XXX', overlaySub: '' })]))).toHaveLength(1)
  })
  it('words cut by their lines are named when measured', () => {
    const long = Array.from({ length: 40 }, () => 'নামের').join(' ')
    const p = titleProblems(proj([title({ template: 'name-strap', fields: { name: long } })]), roughMeasure)
    expect(p[0].messages.join()).toMatch(/“Speaker name” does not fit/)
  })
})

describe('Story → title shortcuts', () => {
  it('finds quotes in the draft word for word', () => {
    const body = 'The minister said, “We will add 500 MW to the grid this year.” Others disagreed. He added "load shedding will end soon enough".'
    expect(quotesIn(body)).toEqual(['We will add 500 MW to the grid this year.', 'load shedding will end soon enough'])
    expect(quotesIn('“Too short”')).toEqual([])
  })
})
