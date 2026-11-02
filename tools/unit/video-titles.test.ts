// Phase 3 pre-build: titles, text animation, ESB title kit, Grid data cards, export validation (src/video/titles).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  graphemes, joinConjuncts, breakTokens, layoutTitle, type FontSpec, type Measurer,
  evalTextAnim, wordByWord, typeOn, maskReveal, slide, fade, lineByLine, blurIn, scaleIn, IDENTITY, type TextAnimSpec,
  ease, karaokeState, matchTimings,
  lowerThird, nameStrap, headlineCard, breakingStrap, quoteCard, sourceLine, endCard,
  BRAND_TEXT, ESB_BRAND, CATEGORY_PALETTE, FRAME_SIZES, safeRect, DEFAULT_SAFE_ZONES, kickerCase,
  parseGridDay, readMetric, fuelMix, sharesOf, zoneSeries, zoneShedPct, hourlySeries, GRID_DAILY_URL, GRID_DAILY_RUNTIME_URL, GridDataError, GRID_METRICS,
  formatExact, countUpText, sourceDecimals,
  gridNumberCard, gridChartCard, validateTitleSpec, assertExportable, looksLikeFiller, renderTitleSpec, layoutOf, canvasMeasurer, settleTime,
  type TitleSpec, type TextElement, type Aspect,
} from '../../src/video/titles'

/** Fake measurer: every grapheme cluster (spaces included) is half the font size wide. */
const measure: Measurer = (text, font) => graphemes(text).length * font.size * 0.5
const F = (size = 20): FontSpec => ({ family: 'Test', weight: 500, size, lineHeight: size * 1.2 })

const HASANTA = String.fromCodePoint(0x09cd)
const KA = 'ক', SSA = 'ষ', SA = 'স', TA = 'ত', RA = 'র'
const KSSA = KA + HASANTA + SSA // ক্ষ
const STRA = SA + HASANTA + TA + HASANTA + RA // স্ত্র

describe('Bangla-safe segmentation', () => {
  it('keeps conjuncts in one grapheme cluster', () => {
    expect(graphemes(KSSA).map((g) => g.text)).toEqual([KSSA])
    expect(graphemes(STRA).map((g) => g.text)).toEqual([STRA])
    const word = KSSA + 'ম' + 'তা' // ক্ষমতা
    expect(graphemes(word).map((g) => g.text)).toEqual([KSSA, 'ম', 'তা'])
    const w2 = STRA + 'ী' + ' ' + KSSA
    const gs = graphemes(w2)
    expect(gs.map((g) => g.text)).toEqual([STRA + 'ী', ' ', KSSA])
    expect(gs.map((g) => g.start)).toEqual([0, 6, 7])
  })

  it('joins a hasanta-split conjunct (older engines) but respects ZWNJ', () => {
    expect(joinConjuncts([{ text: KA + HASANTA, start: 0 }, { text: SSA, start: 2 }]).map((p) => p.text)).toEqual([KSSA])
    expect(joinConjuncts([{ text: SA + HASANTA, start: 0 }, { text: TA + HASANTA, start: 2 }, { text: RA, start: 4 }]).map((p) => p.text)).toEqual([STRA])
    const zwnj = String.fromCodePoint(0x200c)
    expect(joinConjuncts([{ text: KA + HASANTA + zwnj, start: 0 }, { text: SSA, start: 3 }])).toHaveLength(2)
  })

  it('break tokens keep punctuation on the word and break after hyphens', () => {
    const bn = `বিদ্যুৎ কে${'ন্দ্র'}ের উৎপাদন, বেড়েছে।`
    expect(breakTokens(bn).map((t) => t.text)).toEqual(['বিদ্যুৎ', `কে${'ন্দ্র'}ের`, 'উৎপাদন,', 'বেড়েছে।'])
    const en = breakTokens('Battery-Powered grid, today.')
    expect(en.map((t) => t.text)).toEqual(['Battery-', 'Powered', 'grid,', 'today.'])
    expect(en.map((t) => t.spaceBefore)).toEqual([false, false, true, true])
  })
})

describe('layout (measured once, injected measurer)', () => {
  it('breaks lines greedily and records word and cluster offsets', () => {
    const lay = layoutTitle({ text: 'aaaa bbbb cccc', font: F(20), maxWidth: 100 }, measure)
    expect(lay.lines.map((l) => l.text)).toEqual(['aaaa bbbb', 'cccc'])
    expect(lay.words.map((w) => [w.text, w.x, w.lineIndex])).toEqual([['aaaa', 0, 0], ['bbbb', 50, 0], ['cccc', 0, 1]])
    expect(lay.words[1].graphemes.map((g) => g.x)).toEqual([50, 60, 70, 80])
    expect(lay.counts).toEqual({ line: 2, word: 3, grapheme: 12 })
    expect(lay.height).toBe(48)
    expect(lay.lines[1].baseline).toBeGreaterThan(lay.lines[0].baseline)
  })

  it('aligns centre/right and honours newlines', () => {
    const c = layoutTitle({ text: 'aaaa bbbb', font: F(20), maxWidth: 100, align: 'center' }, measure)
    expect(c.lines[0].x).toBe(5)
    const r = layoutTitle({ text: 'ab\ncd', font: F(20), maxWidth: 100, align: 'right' }, measure)
    expect(r.lines.map((l) => [l.text, l.x])).toEqual([['ab', 80], ['cd', 80]])
  })

  it('truncates past maxLines with an ellipsis', () => {
    const lay = layoutTitle({ text: 'aaaa bbbb cccc dddd eeee', font: F(20), maxWidth: 100, maxLines: 2 }, measure)
    expect(lay.truncated).toBe(true)
    expect(lay.lines).toHaveLength(2)
    expect(lay.lines[1].text.endsWith('…')).toBe(true)
    expect(measure(lay.lines[1].text, F(20))).toBeLessThanOrEqual(100)
  })

  it('splits an over-long Bangla word between clusters, never inside a conjunct', () => {
    const long = Array(6).fill(KSSA + 'ম').join('') // 12 clusters, 120 px
    const lay = layoutTitle({ text: long, font: F(20), maxWidth: 50 }, measure)
    expect(lay.lines.length).toBe(3)
    for (const g of lay.graphemes) expect([KSSA, 'ম']).toContain(g.text)
    expect(lay.lines.map((l) => l.text).join('')).toBe(long)
  })
})

describe('text animation evaluator', () => {
  const lay = layoutTitle({ text: 'one two three', font: F(20), maxWidth: 1000 }, measure)
  const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6)

  it('easing ends are exact', () => {
    for (const e of ['linear', 'easeIn', 'easeOut', 'easeInOut', 'esb', 'easeOutBack'] as const) { expect(ease(e, 0)).toBe(0); expect(ease(e, 1)).toBe(1) }
    near(ease({ bezier: [0, 0, 1, 1] }, 0.3), 0.3)
    near(ease('easeInOut', 0.5), 0.5)
  })

  it('word by word: staggered, then settled, then the out phase', () => {
    const spec: TextAnimSpec = { duration: 5, in: wordByWord(0.09), out: fade(0.35) }
    const f0 = evalTextAnim(spec, 0, lay)
    expect(f0.unit).toBe('word')
    expect(f0.states.map((s) => s.opacity)).toEqual([0, 0, 0])
    expect(f0.states[0].dy).toBe(18)
    const f1 = evalTextAnim(spec, 0.18, lay)
    expect(f1.states[0].opacity).toBeGreaterThan(0)
    expect(f1.states[2].opacity).toBe(0)
    const mid = evalTextAnim(spec, 2, lay)
    expect(mid.settled).toBe(true)
    expect(mid.states.every((s) => s === IDENTITY)).toBe(true)
    const out = evalTextAnim(spec, 5 - 0.175, lay)
    for (const s of out.states) near(s.opacity, 0.5)
    expect(evalTextAnim(spec, 5, lay).hidden).toBe(true)
  })

  it('type-on reveals grapheme clusters one by one', () => {
    const spec: TextAnimSpec = { duration: 5, in: typeOn(10) }
    const f = evalTextAnim(spec, 0.25, lay)
    expect(f.unit).toBe('grapheme')
    expect(f.states.slice(0, 5).map((s) => s.opacity)).toEqual([1, 1, 1, 0, 0])
    const bn = layoutTitle({ text: `${KSSA}ম ${STRA}ী`, font: F(20), maxWidth: 1000 }, measure)
    expect(bn.counts.grapheme).toBe(3)
    expect(evalTextAnim(spec, 0.15, bn).states.map((s) => s.opacity)).toEqual([1, 1, 0])
  })

  it('slide, scale, blur, mask and line-by-line at key times', () => {
    const s0 = evalTextAnim({ duration: 3, in: slide('right', 60, 0.5) }, 0, lay).states[0]
    expect(s0.dx).toBe(-60); expect(s0.opacity).toBe(0)
    const sc = evalTextAnim({ duration: 3, in: scaleIn(0.8, 0.5) }, 0, lay).states[0]
    expect(sc.scale).toBe(0.8)
    const bl = evalTextAnim({ duration: 3, in: blurIn(14, 0.6) }, 0, lay).states[0]
    expect(bl.blur).toBe(14)
    const m = evalTextAnim({ duration: 3, in: maskReveal('right', 1, 0, 'all') }, 0.5, lay).states[0]
    near(m.clip!.x1, ease('esb', 0.5)); expect(m.clip!.x0).toBe(0)
    const mOut = evalTextAnim({ duration: 3, in: fade(0.1), out: maskReveal('right', 1, 0, 'all') }, 2.5, lay).states[0]
    near(mOut.clip!.x0, ease('esb', 0.5)); expect(mOut.clip!.x1).toBe(1)
    const two = layoutTitle({ text: 'aaaa bbbb cccc', font: F(20), maxWidth: 100 }, measure)
    const ll = evalTextAnim({ duration: 3, in: lineByLine(0.5) }, 0.25, two)
    expect(ll.unit).toBe('line')
    expect(ll.states[0].opacity).toBeGreaterThan(0); expect(ll.states[1].opacity).toBe(0)
    // the background box follows the first unit's timing
    expect(evalTextAnim({ duration: 3, in: wordByWord() }, 0, lay).block.opacity).toBe(0)
    expect(evalTextAnim({ duration: 3, in: wordByWord() }, 1, lay).block).toBe(IDENTITY)
  })

  it('mixes units: the finer phase sets the granularity', () => {
    const f = evalTextAnim({ duration: 4, in: fade(0.3), out: wordByWord(0.1) }, 0.15, lay)
    expect(f.unit).toBe('word')
    expect(new Set(f.states.map((s) => s.opacity)).size).toBe(1)
  })
})

describe('karaoke timing', () => {
  const lay = layoutTitle({ text: 'one two three', font: F(20), maxWidth: 1000 }, measure)
  const timings = [{ text: 'one', start: 0, end: 0.4 }, { text: 'two', start: 0.5, end: 0.9 }, { text: 'three,', start: 1, end: 1.6 }]
  it('matches the layout and tracks the active word', () => {
    expect(matchTimings(lay, timings)).toEqual({ ok: true })
    expect(matchTimings(lay, timings.slice(0, 2)).ok).toBe(false)
    expect(karaokeState(timings, -1).active).toBe(-1)
    const k = karaokeState(timings, 0.7)
    expect(k.active).toBe(1); expect(k.past(0)).toBe(true); expect(k.past(2)).toBe(false)
    expect(karaokeState(timings, 0.45).active).toBe(0)
    expect(karaokeState(timings, 2).past(2)).toBe(true)
  })
})

// ------------------------------------------------------------------ kit

const textEls = (s: TitleSpec) => s.elements.filter((e): e is TextElement => e.type === 'text')

/** Every word on a template comes from its inputs or the brand's fixed set. */
function onlyInputsAndBrand(s: TitleSpec, inputs: Record<string, string | undefined>) {
  for (const el of textEls(s)) {
    if (el.origin === 'brand') { expect(BRAND_TEXT.has(el.text), el.text).toBe(true); continue }
    expect(el.origin).toBe('input')
    const v = (inputs[el.field!] ?? '').replace(/\s+/g, ' ').trim()
    const body = el.transform === 'upper' ? kickerCase(v) : v
    expect(el.text).toBe(el.prefix ? `${el.prefix} ${body}` : body)
  }
}

describe('ESB title kit', () => {
  const frame = FRAME_SIZES['16:9']
  const o = { frame, measure }
  const bnName = `আব্দুল ${KSSA}মান`

  const cases: [string, (inp: Record<string, string>) => TitleSpec, Record<string, string>][] = [
    ['lowerThird', (i) => lowerThird(i, o), { name: 'Test Person', role: 'Test role at Test Org' }],
    ['lowerThird bn', (i) => lowerThird(i, o), { name: bnName, role: `${STRA}ী বিভাগ` }],
    ['nameStrap', (i) => nameStrap(i, o), { name: 'Test Person' }],
    ['headlineCard', (i) => headlineCard(i, o), { headline: 'A headline typed by the editor for this test', kicker: 'grid desk' }],
    ['breakingStrap', (i) => breakingStrap(i, o), { headline: 'A breaking line from the editor', sub: 'more' }],
    ['breakingStrap bn', (i) => breakingStrap(i, o), { headline: `${KSSA}মতা বেড়েছে` }],
    ['quoteCard', (i) => quoteCard(i, o), { quote: 'Words the speaker said, as the story prints them [the ministry].', speaker: 'Test Person', speakerRole: 'Test role' }],
    ['sourceLine', (i) => sourceLine(i, o), { source: 'Test Agency' }],
    ['sourceLine bn', (i) => sourceLine(i, o), { source: 'পরীক্ষা সংস্থা' }],
  ]

  it.each(cases)('%s: only input text + brand strings, and exportable', (_n, make, inputs) => {
    const s = make(inputs)
    expect(textEls(s).length).toBeGreaterThan(0)
    onlyInputsAndBrand(s, inputs)
    expect(validateTitleSpec(s, { measure })).toEqual([])
    expect(() => assertExportable(s)).not.toThrow()
  })

  it('kicker upper-cases Latin only; Bangla breaking label', () => {
    const h = headlineCard({ headline: 'x', kicker: 'grid desk' }, o)
    expect(textEls(h).find((e) => e.id === 'kicker')!.text).toBe('GRID DESK')
    const b = breakingStrap({ headline: `${KSSA}মতা` }, o)
    expect(textEls(b).find((e) => e.id === 'label')!.text).toBe('ব্রেকিং')
  })

  it('end card is the brand handles only', () => {
    const s = endCard(o)
    expect(textEls(s).map((e) => e.text)).toEqual([ESB_BRAND.site, `Facebook ${ESB_BRAND.facebook}`, `YouTube ${ESB_BRAND.youtube}`])
    expect(textEls(s).every((e) => e.origin === 'brand')).toBe(true)
    expect(ESB_BRAND).toMatchObject({ site: 'esbpowerline.com', facebook: 'esbpowerlineofficial', youtube: '@esbplbd' })
    expect(s.elements.find((e) => e.type === 'image')).toMatchObject({ brandAsset: 'esb-logo', src: null })
  })

  it('empty fields: nothing in an export, dimmed labels in the editor, and the export is refused', () => {
    const ex = lowerThird({}, o)
    expect(ex.elements).toEqual([])
    expect(validateTitleSpec(ex).map((i) => i.code)).toEqual(['required-empty'])
    const ed = lowerThird({ name: '', role: '' }, { ...o, editor: true })
    const ph = textEls(ed).filter((e) => e.placeholder)
    expect(ph.map((e) => e.text)).toEqual(['Speaker name', 'Role or organisation'])
    expect(() => assertExportable(ed)).toThrow()
    expect(sourceLine({}, o).elements).toEqual([])
    expect(sourceLine({ source: '   ' }, { ...o, editor: false }).elements).toEqual([])
    // a template never invents a default: an export with only the role keeps the name out
    const roleOnly = lowerThird({ role: 'Only a role' }, o)
    expect(textEls(roleOnly).map((e) => e.text)).toEqual([ESB_BRAND.kicker, 'Only a role'])
  })

  it('category accent from the 01–08 palette; explicit colour wins; ESB stripes otherwise', () => {
    const a = lowerThird({ name: 'n' }, { ...o, categoryId: '03' })
    expect(a.elements.find((e) => e.id === 'accent')).toMatchObject({ fill: CATEGORY_PALETTE['03'].color })
    const b = lowerThird({ name: 'n' }, { ...o, categoryId: '03', accent: '#123456' })
    expect(b.elements.find((e) => e.id === 'accent')).toMatchObject({ fill: '#123456' })
    const c = lowerThird({ name: 'n' }, o)
    expect(c.elements.find((e) => e.id === 'accent')).toHaveProperty('stripes')
  })

  it.each(['16:9', '9:16', '4:5', '1:1'] as Aspect[])('%s: critical text inside title-safe (and the 9:16 platform zones)', (aspect) => {
    const fr = FRAME_SIZES[aspect]
    const oo = { frame: fr, measure }
    const safe = safeRect(fr.w, fr.h, { platform: aspect === '9:16' ? 'reels' : null })
    if (aspect === '9:16') { expect(safe.y + safe.h).toBeLessThanOrEqual(fr.h * (1 - DEFAULT_SAFE_ZONES.platforms.reels.bottom) + 1e-6); expect(safe.x + safe.w).toBeLessThanOrEqual(fr.w * (1 - DEFAULT_SAFE_ZONES.platforms.reels.right) + 1e-6) }
    const specs = [
      lowerThird({ name: 'Test Person', role: 'Role' }, oo), nameStrap({ name: 'Test Person' }, oo), headlineCard({ headline: 'aaaa bbbb cccc dddd eeee ffff gggg', kicker: 'k' }, oo),
      breakingStrap({ headline: 'aaaa bbbb', sub: 'cc' }, oo), quoteCard({ quote: 'aaaa bbbb cccc', speaker: 'Test Person' }, oo), sourceLine({ source: 'Test' }, oo), endCard(oo),
    ]
    for (const s of specs) for (const el of textEls(s)) {
      const lay = layoutOf(el, measure)
      expect(el.x, `${s.kind}/${el.id}`).toBeGreaterThanOrEqual(safe.x - 0.5)
      expect(el.y, `${s.kind}/${el.id}`).toBeGreaterThanOrEqual(safe.y - 0.5)
      expect(el.x + el.w, `${s.kind}/${el.id}`).toBeLessThanOrEqual(safe.x + safe.w + 0.5)
      expect(el.y + lay.height, `${s.kind}/${el.id}`).toBeLessThanOrEqual(safe.y + safe.h + 0.5)
    }
  })

  it('platform zones are a config', () => {
    const r = safeRect(1080, 1920, { platform: 'shorts', config: { titleSafe: 1, platforms: { reels: { top: 0, right: 0, bottom: 0, left: 0 }, shorts: { top: 0, right: 0.5, bottom: 0.5, left: 0 } } } })
    expect(r).toEqual({ x: 0, y: 0, w: 540, h: 960 })
  })
})

// ------------------------------------------------------------------ validation

describe('export validation', () => {
  const o = { frame: FRAME_SIZES['16:9'], measure }
  it('flags filler text but not an editor\'s [insertion] in a quote', () => {
    for (const t of ['Lorem ipsum dolor', 'TBD', 'XXXX', '[Name]', '{{headline}}', '<name>', 'Your name here', 'Speaker name', '…']) expect(looksLikeFiller(t), t).toBe(true)
    for (const t of ['He said the plant [in Rampal] is back', 'Test Person', `${KSSA}মতা`]) expect(looksLikeFiller(t), t).toBe(false)
    const s = lowerThird({ name: 'Lorem ipsum', role: 'r' }, o)
    expect(validateTitleSpec(s).map((i) => i.code)).toContain('filler-text')
  })
  it('catches a text element that no longer matches its field, and unknown brand text', () => {
    const s = lowerThird({ name: 'Test Person' }, o)
    const t = structuredClone(s)
    ;(t.elements.find((e) => e.id === 'name') as TextElement).text = 'Someone Else'
    expect(validateTitleSpec(t).map((i) => i.code)).toContain('text-mismatch')
    ;(t.elements.find((e) => e.id === 'kicker') as TextElement).text = 'LIVE'
    expect(validateTitleSpec(t).map((i) => i.code)).toContain('unknown-origin')
  })
  it('flags text cut by its line limit when given a measurer', () => {
    const s = nameStrap({ name: Array(80).fill('word').join(' ') }, o)
    expect(validateTitleSpec(s, { measure }).map((i) => i.code)).toContain('overflow')
  })
})

// ------------------------------------------------------------------ grid data

const fixturePath = path.resolve(import.meta.dirname, '../fixtures/video/grid-daily-2026-10-21.json')
const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))

describe('Grid daily reader (real esbpowerline.com file, 2026-10-21)', () => {
  const day = parseGridDay(raw, '2026-10-21')

  it('reads the public URL shape and checks the date', () => {
    expect(GRID_DAILY_URL('2026-10-21')).toBe('https://esbpowerline.com/data/daily/2026-10-21.json')
    expect(GRID_DAILY_RUNTIME_URL('2026-10-21')).toBe('https://esbpowerline.com/api/data/daily/2026-10-21.json')
    expect(day.dateLabel).toBe('21 Oct 2026')
    expect(() => parseGridDay(raw, '2026-10-22')).toThrow(GridDataError)
    expect(() => parseGridDay({ nope: 1 }, '2026-10-21')).toThrow(GridDataError)
    expect(() => parseGridDay({ ...raw, systemStats: { ...raw.systemStats, eveningPeakGen: '15552' } }, '2026-10-21')).toThrow(GridDataError)
  })

  it('figures are the stored values, with units, times and source fields', () => {
    const g = readMetric(day, 'eveningPeakGen')!
    expect(g).toMatchObject({ value: raw.systemStats.eveningPeakGen, unit: 'MW', time: '19:00', sourceField: 'systemStats.eveningPeakGen', dateLabel: '21 Oct 2026' })
    expect(g.derived).toBeUndefined()
    expect(readMetric(day, 'eveningPeakDemand')!.value).toBe(raw.systemStats.eveningPeakDemand)
    expect(readMetric(day, 'totalEnergyGen')).toMatchObject({ value: raw.systemStats.totalEnergyGen, unit: 'MKWh' })
    expect(readMetric(day, 'totalGasSuppliedPower')).toMatchObject({ value: raw.systemStats.totalGasSuppliedPower, unit: 'MMCFD' })
    const shed = readMetric(day, 'peakLoadShed')!
    const maxShed = Math.max(...raw.hourlyLoadData.map((h: { loadShed: number }) => h.loadShed))
    expect(shed.value).toBe(maxShed)
    expect(raw.hourlyLoadData[Number(/\[(\d+)\]/.exec(shed.sourceField)![1])].time).toBe(shed.time)
    const atPeak = raw.hourlyLoadData.find((h: { time: string }) => h.time === raw.systemStats.peakTimes.eveningPeakGen)
    expect(readMetric(day, 'eveningPeakLoadShed')!.value).toBe(atPeak.loadShed)
    for (const id of GRID_METRICS) { const f = readMetric(day, id); if (f) expect(Number.isFinite(f.value)).toBe(true) }
  })

  it('an unpublished figure is null, never 0', () => {
    const d2 = parseGridDay({ ...raw, systemStats: { ...raw.systemStats, dayPeakDemand: null }, hourlyLoadData: undefined, regionalDemandData: undefined }, '2026-10-21')
    expect(readMetric(d2, 'dayPeakDemand')).toBeNull()
    expect(readMetric(d2, 'peakLoadShed')).toBeNull()
    expect(hourlySeries(d2, 'demand')).toBeNull()
  })

  it('fuel mix, zones and hourly series as stored; shares and zone pct are labelled derived', () => {
    const mix = fuelMix(day)!
    expect(mix.items.map((i) => [i.label, i.value])).toEqual(raw.generationData.map((g: { name: string; gen: number }) => [g.name, g.gen]))
    expect(mix.unit).toBe('MKWh')
    expect(mix.derived).toBeUndefined()
    const sh = sharesOf(mix)
    expect(sh.derived!.formula).toMatch(/share = value ÷ Σ values/)
    expect(sh.unit).toBe('%')
    const sum = raw.generationData.reduce((a: number, g: { gen: number }) => a + g.gen, 0)
    expect(sh.items[0].value).toBe(Math.round((raw.generationData[0].gen / sum) * 1000) / 10)
    const zd = zoneSeries(day, 'demand')!
    expect(zd.items.map((i) => i.value)).toEqual(raw.regionalDemandData.map((z: { demand: number }) => z.demand))
    expect(zd.derived).toBeUndefined() // the file says p1-published
    expect(zoneSeries(parseGridDay({ ...raw, regionalDemandSource: 'derived-served-plus-shed' }, '2026-10-21'), 'demand')!.derived).toBeDefined()
    expect(zoneShedPct(day)!.derived!.formula).toMatch(/loadShed ÷ demand/)
    expect(zoneSeries(day, 'generation')!.items.map((i) => i.value)).toEqual(raw.zoneGenerationData.map((z: { total: number }) => z.total))
    expect(hourlySeries(day, 'generation')!.items).toHaveLength(raw.hourlyLoadData.length)
  })
})

describe('exact figures and count-up', () => {
  it('never rounds beyond the source', () => {
    expect(formatExact(15552.54)).toBe('15,552.54')
    expect(formatExact(329.48744486)).toBe('329.48744486')
    expect(formatExact(0)).toBe('0')
    expect(formatExact(0.091)).toBe('0.091')
    expect(formatExact(1e-7)).toBe('0.0000001')
    expect(formatExact(2551818784)).toBe('2,551,818,784')
    expect(formatExact(15552.54, { group: false, digits: 'bn' })).toBe('১৫৫৫২.৫৪')
    expect(sourceDecimals(837.92)).toBe(2)
  })
  it('the count-up lands on the exact value and keeps the decimals on the way', () => {
    const spec = { target: 15552.54, duration: 1.4, delay: 0.2 }
    expect(countUpText(spec, 0)).toBe('0.00')
    const mid = countUpText(spec, 0.9)
    expect(mid).toMatch(/^[\d,]+\.\d{2}$/)
    expect(mid).not.toBe('15,552.54')
    expect(countUpText(spec, 1.6)).toBe('15,552.54')
    expect(countUpText(spec, 99)).toBe('15,552.54')
    expect(countUpText({ target: 329.48744486, duration: 1 }, 1)).toBe('329.48744486')
  })
})

describe('Grid data cards', () => {
  const day = parseGridDay(raw, '2026-10-21')
  const o = { frame: FRAME_SIZES['9:16'], measure }
  it('big number card: exact value, unit, source line with the date; exportable', () => {
    const fig = readMetric(day, 'eveningPeakGen')!
    const s = gridNumberCard(fig, o)
    const val = textEls(s).find((e) => e.id === 'value')!
    expect(val.text).toBe(formatExact(raw.systemStats.eveningPeakGen))
    expect(val.countUp!.target).toBe(raw.systemStats.eveningPeakGen)
    expect(countUpText(val.countUp!, s.duration)).toBe(val.text)
    expect(val.data).toMatchObject({ isoDate: '2026-10-21', sourceField: 'systemStats.eveningPeakGen' })
    expect(textEls(s).map((e) => e.text)).toContain('Source: esbpowerline.com Grid data, 21 Oct 2026')
    expect(textEls(s).find((e) => e.id === 'unit')!.text).toBe('MW · 19:00')
    expect(validateTitleSpec(s)).toEqual([])
    // the only words: the metric's label, the figure, unit/time and the source line
    expect(textEls(s).every((e) => e.origin === 'data')).toBe(true)
  })
  it('chart card with derived shares says so; removing the source line fails validation', () => {
    const s = gridChartCard(sharesOf(fuelMix(day)!), 'donut', o)
    expect(textEls(s).find((e) => e.id === 'derived')!.text).toMatch(/^Derived: share of total/)
    expect(validateTitleSpec(s)).toEqual([])
    const t = structuredClone(s)
    t.elements = t.elements.filter((e) => e.id !== 'source')
    expect(validateTitleSpec(t).map((i) => i.code)).toContain('no-source-line')
  })
  it('settle time covers the count-up', () => {
    const s = gridNumberCard(readMetric(day, 'totalEnergyGen')!, o)
    expect(settleTime(s, measure)).toBeGreaterThanOrEqual(1.6 - 1e-9)
  })
})

// ------------------------------------------------------------------ no invented content in src/video/titles

describe('src/video/titles ships no invented content', () => {
  const dir = path.resolve(import.meta.dirname, '../../src/video/titles')
  const strings = (code: string) => (code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').match(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g) ?? []).join('\n')
  it('no honorific + name and no energy figure in any string', () => {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      const s = strings(fs.readFileSync(path.join(dir, f), 'utf8'))
      expect(s, f).not.toMatch(/\b(Engr|Dr|Mr|Mrs|Ms|Prof)\.\s+[A-Z]/)
      expect(s, f).not.toMatch(/\b\d[\d,.]*\s*(MW|MWh|MKWh|GW|MMCFD|crore|lakh|kV|BCF|Tk)\b/)
      expect(s, f).not.toMatch(/[০-৯]+\s*(মেগাওয়াট|কোটি|ঘনফুট)/)
    }
  })
})

// ------------------------------------------------------------------ pixel smoke test

type NapiCanvas = { createCanvas: (w: number, h: number) => { getContext: (k: '2d') => CanvasRenderingContext2D } }
let napi: NapiCanvas | null = null
try { napi = (await import('@napi-rs/canvas' as string)) as NapiCanvas } catch { napi = null }

describe.skipIf(!napi)('pixel smoke (@napi-rs/canvas; skipped when the optional native canvas is absent)', () => {
  it('draws a lower third: nothing at t=0, the panel and text once settled', () => {
    const canvas = napi!.createCanvas(640, 360)
    const ctx = canvas.getContext('2d')
    const m = canvasMeasurer(ctx)
    const s = lowerThird({ name: 'Test Person', role: `${KSSA}মতা ও ${STRA}ী` }, { frame: { w: 640, h: 360 }, measure: m })
    const count = (t: number) => {
      ctx.clearRect(0, 0, 640, 360)
      renderTitleSpec(ctx, s, t, { measure: m })
      const d = ctx.getImageData(0, 0, 640, 360).data
      let n = 0
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++
      return n
    }
    expect(count(0)).toBe(0)
    const settled = count(2)
    expect(settled).toBeGreaterThan(2000)
    // bright text pixels inside the dark panel
    const panel = s.elements.find((e) => e.id === 'panel') as { x: number; y: number; w: number; h: number }
    const d = ctx.getImageData(Math.round(panel.x), Math.round(panel.y), Math.round(panel.w), Math.round(panel.h)).data
    let bright = 0
    for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) bright++
    expect(bright).toBeGreaterThan(50)
    expect(count(s.duration)).toBe(0)
  })
  it('draws a donut chart card at its end state', () => {
    const canvas = napi!.createCanvas(540, 960)
    const ctx = canvas.getContext('2d')
    const m = canvasMeasurer(ctx)
    const day = parseGridDay(raw, '2026-10-21')
    const s = gridChartCard(fuelMix(day)!, 'donut', { frame: { w: 540, h: 960 }, measure: m })
    renderTitleSpec(ctx, s, 3, { measure: m })
    const d = ctx.getImageData(0, 0, 540, 960).data
    let n = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++
    expect(n).toBeGreaterThan(10000)
  })
})
