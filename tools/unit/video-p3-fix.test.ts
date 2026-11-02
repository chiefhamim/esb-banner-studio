// Phase 3 fix round (logic / data / engine): regression tests for the review's findings C1-C13, S1-S3, P1-P5.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CATEGORIES } from '../../src/core/tokens'
import { CATEGORY_PALETTE, accentText, contrastRatio, CARD_FILLS } from '../../src/video/titles/brand'
import { parseGridDay, GRID_METRICS, readMetric, fuelMix, sharesOf, hourlySeries } from '../../src/video/titles/grid'
import { countUpText, formatExact, isShowableNumber } from '../../src/video/titles/numbers'
import { canvasMeasurer, createLayoutCache, layoutTitle, type Measurer } from '../../src/video/titles/layout'
import { renderTitleSpec, settleTime, exitTime } from '../../src/video/titles/render'
import { validateTitleSpec, looksLikeFiller } from '../../src/video/titles/validate'
import { clean, isBlank, lowerThird } from '../../src/video/titles/kit'
import { donutMetrics, linePositions, type ChartSpec } from '../../src/video/titles/charts'
import { calloutBox } from '../../src/video/titles/stickers'
import { fitCount, derivedLine, gridChartCard } from '../../src/video/titles/dataCards'
import { dataCardClip, dataCardFor, dataCardSpec, dataCardTextAt, sanitizeDataCard, type FetchedDay } from '../../src/video/dataCardClip'
import { migrateTimeline, splitClip, subClip } from '../../src/video/timeline'
import { titleDuration } from '../../src/video/titleModel'
import { buildTitleSpec, titleProblems } from '../../src/video/titleClip'
import { frameTime } from '../../src/video/engine/titleRaster'
import { useVideoStore } from '../../src/video/videoStore'

const require = createRequire(import.meta.url)
const { createGridData, pickDay } = require('../../electron/grid-data.cjs')

const ISO = '2026-10-21'
const raw = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../fixtures/video/grid-daily-2026-10-21.json'), 'utf8'))
const day = parseGridDay(raw, ISO)
const SRC = `https://esbpowerline.com/data/daily/${ISO}.json`
const fetched: FetchedDay = { day, fetchedAt: '2026-11-02T06:00:00.000Z', source: SRC }
const fake: Measurer = (text, font) => text.length * font.size * 0.55
const FRAMES = { '16:9': { w: 1920, h: 1080 }, '9:16': { w: 1080, h: 1920 }, '4:5': { w: 1080, h: 1350 }, '1:1': { w: 1080, h: 1080 } }

type NapiCanvas = { createCanvas: (w: number, h: number) => { getContext: (k: '2d') => CanvasRenderingContext2D; toBuffer: (m: 'image/png') => Buffer }; loadImage: (b: Buffer) => Promise<CanvasImageSource> }
let napi: NapiCanvas | null = null
try { napi = (await import('@napi-rs/canvas' as string)) as NapiCanvas } catch { napi = null }

describe('C1 the whole exact figure always fits (fit-to-width, no ellipsis)', () => {
  for (const [name, frame] of Object.entries(FRAMES)) {
    it(`every metric on ${name}: the value is the exact string, nothing is cut, the export check is clean`, () => {
      for (const id of GRID_METRICS) {
        const card = dataCardFor(fetched, id)
        if (!card) continue
        const spec = dataCardSpec(card, { frame, measure: fake, editor: false, duration: 6 })!
        const v = spec.elements.find((e) => e.id === 'value')!
        expect(v.type === 'text' && v.text).toBe(formatExact(card.value!))
        expect(validateTitleSpec(spec, { measure: fake }).filter((i) => i.code === 'overflow')).toEqual([])
      }
    })
  }
  it('totalEnergyGen 329.48744486 shows whole on 9:16 at a smaller size, not "329.4874…"', () => {
    const card = dataCardFor(fetched, 'totalEnergyGen')!
    const spec = dataCardSpec(card, { frame: FRAMES['9:16'], measure: fake, editor: false, duration: 6 })!
    const v = spec.elements.find((e) => e.id === 'value')!
    expect(v.type === 'text' && v.text).toBe('329.48744486')
    expect(v.type === 'text' && v.font.size).toBeLessThan(150)
    expect(v.type === 'text' && v.font.size).toBeGreaterThanOrEqual(40)
  })
  it('minimum sizes at 1080 wide: label, unit, source and derived lines are at least 24 px; the lower third kicker >= 22 and role >= 28', () => {
    const card = dataCardFor(fetched, 'fuelMix:share')!
    const spec = dataCardSpec(card, { frame: FRAMES['9:16'], measure: fake, editor: false, duration: 7 })!
    for (const e of spec.elements) if (e.type === 'text' && ['title', 'unit', 'source', 'derived'].includes(e.id)) expect(e.font.size).toBeGreaterThanOrEqual(24)
    const ch = spec.elements.find((e) => e.type === 'chart')!
    expect(ch.type === 'chart' && Math.round(ch.chart.size * 0.8)).toBeGreaterThanOrEqual(24)
    const lt = lowerThird({ name: 'Name', role: 'Role' }, { frame: FRAMES['9:16'], measure: fake })
    const sz = (id: string) => (lt.elements.find((e) => e.id === id) as { font: { size: number } }).font.size
    expect(sz('kicker')).toBeGreaterThanOrEqual(22)
    expect(sz('role')).toBeGreaterThanOrEqual(28)
  })
})

describe('C2 a short data card always ends on the exact figure', () => {
  it('the count-up lands before the end of every card length, or shows the figure at once', () => {
    for (let d = 0.3; d <= 8; d += 0.1) {
      const f = fitCount(d, 0.2, 1.4)
      expect(f.delay + f.duration).toBeLessThanOrEqual(Math.max(d - 0.65, 0) + 1e-9)
    }
  })
  it('a 1.2 s card ends on 15,552.54, not 15,490.68', () => {
    const clip = { ...dataCardClip(dataCardFor(fetched, 'eveningPeakGen')!, 'v2', 0, 'short'), duration: 1.2, out: 1.2 }
    expect(dataCardTextAt(clip, 1.19, 1920, 1080, false, fake).value).toBe('15,552.54')
    expect(titleProblems({ clips: [clip], width: 1920, height: 1080 }, fake)).toEqual([])
  })
  it('a card too short to settle is blocked and says how long it must be', () => {
    const clip = { ...dataCardClip(dataCardFor(fetched, 'eveningPeakGen')!, 'v2', 0, 'tiny'), duration: 0.5, out: 0.5 }
    const p = titleProblems({ clips: [clip], width: 1920, height: 1080 }, fake)
    expect(p).toHaveLength(1)
    expect(p[0].messages.join(' ')).toMatch(/lengthen it to at least \d+\.\d s/)
  })
})

describe('C3 splitting a title or data card does not blink', () => {
  const split = (clip: ReturnType<typeof dataCardClip>) => {
    const proj = migrateTimeline({ clips: [clip], tracks: [{ id: 'v2', kind: 'overlay', name: 'V2' }] } as never)
    return (splitClip(proj as never, clip.id, 3) as unknown as { clips: (typeof clip)[] }).clips
  }
  it('both halves keep the whole title length; the exit is at the true end only', () => {
    const clip = dataCardClip(dataCardFor(fetched, 'eveningPeakGen')!, 'v2', 0, 'sp')
    const [a, b] = split(clip)
    expect(titleDuration(a)).toBe(titleDuration(clip))
    expect(titleDuration(b)).toBe(titleDuration(clip))
    const sa = buildTitleSpec(a, 1920, 1080, false, fake)!
    expect(sa.duration).toBe(6)
    expect(exitTime(sa, fake)).toBeGreaterThan(a.in + a.duration) // the first half ends before any out phase begins
  })
  it('the figure is the same on the last frame of the first half and the first frame of the second', () => {
    const clip = dataCardClip(dataCardFor(fetched, 'eveningPeakGen')!, 'v2', 0, 'sp2')
    const [a, b] = split(clip)
    expect(dataCardTextAt(a, 2.999, 1920, 1080, false, fake).value).toBe('15,552.54')
    expect(dataCardTextAt(b, b.start, 1920, 1080, false, fake).value).toBe('15,552.54')
  })
  it('a trimmed tail is a new end again (the carried length is dropped)', () => {
    const clip = dataCardClip(dataCardFor(fetched, 'eveningPeakGen')!, 'v2', 0, 'tr')
    const [a] = split(clip)
    expect(a.titleLen).toBe(6)
    expect(subClip(a, 0, 2).titleLen).toBeUndefined()
    expect(subClip(a, 1, 3).titleLen).toBe(6) // a head trim keeps it
  })
})

describe('C4 sticker callouts', () => {
  it('a tiny sticker still gets a sane width and shrinks to fit; very long text is reported, not cut silently', () => {
    const ok = calloutBox('Dhaka will see load shedding tonight', 0.04, 1080, 1080, fake)
    expect(ok.lay.truncated).toBe(false)
    expect(ok.lay.boxWidth).toBeGreaterThanOrEqual(300)
    const long = calloutBox('word '.repeat(200), 0.3, 1080, 1080, fake)
    expect(long.truncated).toBe(true)
    const clip = { id: 's', trackId: 'v2', title: 's', kind: 'overlay', start: 0, duration: 4, in: 0, out: 4, color: '#fff', titleData: { template: 'sticker', fields: { text: 'word '.repeat(200) }, sticker: { shape: 'callout', color: 'red', x: 0.5, y: 0.5, size: 0.04, rotation: 0 } } }
    expect(titleProblems({ clips: [clip as never], width: 1080, height: 1080 }, fake)[0].messages.join(' ')).toMatch(/does not fit/)
  })
})

describe('C5 the derived line never cuts a disclosure', () => {
  it('shares say what they are and point to the formula, which stays in the clip data', () => {
    const card = dataCardFor(fetched, 'fuelMix:share')!
    const spec = dataCardSpec(card, { frame: FRAMES['9:16'], measure: fake, editor: false, duration: 7 })!
    const d = spec.elements.find((e) => e.id === 'derived')!
    expect(d.type === 'text' && d.text).toBe('Derived: share of total (see tooltip)')
    expect(spec.data?.derived).toMatch(/share = value ÷ Σ values/)
    expect(validateTitleSpec(spec, { measure: fake }).filter((i) => i.code === 'overflow')).toEqual([])
  })
  it('a formula with no short form is shown whole if it fits three lines, else the card says computed + tooltip', () => {
    const c = { o: { measure: fake } } as never
    expect(derivedLine({ formula: 'a ÷ b' }, c, 800, 24)).toBe('Derived: a ÷ b')
    expect(derivedLine({ formula: 'x '.repeat(400) }, c, 800, 24)).toBe('Derived: computed value (see tooltip)')
  })
})

describe('C6/C8/C10 fields', () => {
  it('invisible characters are removed; a required field of them only is empty', () => {
    expect(clean('A​B⁠C­D')).toBe('ABCD')
    expect(isBlank('​‌⁠­ ')).toBe(true)
    const spec = lowerThird({ name: '​‌⁠' }, { frame: FRAMES['16:9'], measure: fake })
    expect(spec.elements).toEqual([])
    expect(spec.fields.name.value).toBe('')
  })
  it('a joiner inside a Bangla word is kept', () => {
    const w = 'ক‍ষ'
    expect(clean(w)).toBe(w)
  })
  it('multiline fields keep paragraph breaks and flatten tabs', () => {
    expect(clean('one\t two\r\nthree\n\n\n\nfour', true)).toBe('one two\nthree\n\nfour')
    expect(clean('one\ntwo')).toBe('one two')
  })
  it('only whole-field filler is flagged, not words in real sentences', () => {
    for (const ok of ['dummy load test', 'Placeholder policy', 'The tbd contract was signed', 'Lorem was a vendor', 'He said [sic] twice']) expect(looksLikeFiller(ok)).toBe(false)
    for (const bad of ['Lorem ipsum dolor sit amet', 'TBD', '[Name]', '{{name}}', 'Your name here', 'placeholder', 'Speaker name', 'xxx', '...']) expect(looksLikeFiller(bad)).toBe(true)
  })
})

describe('C7 accent text reads on the dark card', () => {
  it('every site category and every palette colour gives text >= 4.5:1 on both card fills; bars keep the raw accent', () => {
    for (const hex of [...CATEGORIES.map((c) => c.accent), ...Object.values(CATEGORY_PALETTE).map((c) => c.color)]) {
      const t = accentText(hex)
      for (const f of CARD_FILLS) expect(contrastRatio(t, f)).toBeGreaterThanOrEqual(4.5)
    }
    expect(CATEGORIES).toHaveLength(10)
    const lt = lowerThird({ name: 'N' }, { frame: FRAMES['16:9'], measure: fake, accent: '#1e40af' })
    const bar = lt.elements.find((e) => e.id === 'accent')!
    expect(bar.type === 'rect' && bar.fill).toBe('#1e40af')
    const k = lt.elements.find((e) => e.id === 'kicker')!
    expect(k.type === 'text' && k.style.fill).not.toBe('#1e40af')
  })
})

describe('C9 typing is one undo step', () => {
  it('many edits of one field on one clip undo together; another edit or a pause starts a new step', () => {
    const clip = { id: 'c1', trackId: 'v2', title: 't', kind: 'overlay' as const, start: 0, duration: 5, in: 0, out: 5, color: '#fff', titleData: { template: 'headline' as const, fields: { headline: '' } } }
    const st = useVideoStore
    st.getState().newProject?.()
    st.setState((s) => ({ project: { ...s.project, clips: [clip as never], tracks: s.project.tracks.some((t) => t.id === 'v2') ? s.project.tracks : [...s.project.tracks, { id: 'v2', kind: 'overlay', name: 'V2' } as never] }, history: [], future: [] }))
    const before = st.getState().history.length
    let text = ''
    for (const ch of 'A long headline typed key by key') { text += ch; st.getState().updateClipCoalesced({ ...clip, titleData: { ...clip.titleData, fields: { headline: text } } } as never, 'headline') }
    expect(st.getState().history.length).toBe(before + 1)
    st.getState().endCoalesce()
    st.getState().updateClipCoalesced({ ...clip, titleData: { ...clip.titleData, fields: { headline: text + '!' } } } as never, 'headline')
    expect(st.getState().history.length).toBe(before + 2)
    st.getState().undo()
    expect((st.getState().project.clips[0].titleData as { fields: Record<string, string> }).fields.headline).toBe(text)
    st.getState().undo()
    expect((st.getState().project.clips[0].titleData as { fields: Record<string, string> }).fields.headline).toBe('')
  })
})

describe('C11/P3 caches follow the measurer', () => {
  it('a layout made with the old measurer is not served to the new one', () => {
    const cache = createLayoutCache()
    const a: Measurer = (t, f) => t.length * f.size * 0.5
    const b: Measurer = (t, f) => t.length * f.size * 1.0
    const spec = { text: 'hello world again', font: { family: 'x', weight: 400, size: 20, lineHeight: 24 }, maxWidth: 200 }
    expect(cache(spec, a).width).not.toBe(cache(spec, b).width)
  })
  it('settle / exit times are worked out again for a new measurer', () => {
    const card = dataCardFor(fetched, 'eveningPeakGen')!
    const spec = dataCardSpec(card, { frame: FRAMES['16:9'], measure: fake, editor: false, duration: 6 })!
    const wide: Measurer = (t, f) => t.length * f.size * 3
    expect(settleTime(spec, fake)).toBeGreaterThan(0)
    expect(exitTime(spec, wide)).toBeGreaterThan(0)
  })
  it('the canvas measurer drops its oldest entries, never everything at once', () => {
    let calls = 0
    const ctx = { font: '', measureText: (t: string) => { calls++; return { width: t.length } } } as never
    const m = canvasMeasurer(ctx)
    const f = { family: 'x', weight: 400, size: 10, lineHeight: 12 }
    for (let i = 0; i < 4001; i++) m(`t${i}`, f)
    calls = 0
    m('t4000', f) // recent: still cached
    expect(calls).toBe(0)
    m('t0', f) // oldest: gone
    expect(calls).toBe(1)
  })
})

describe('C12/S1/S3 a crafted data card', () => {
  const good = () => JSON.parse(JSON.stringify(dataCardFor(fetched, 'eveningPeakGen')!))
  it('the genuine card passes', () => { expect(sanitizeDataCard(good())).toBeDefined() })
  it('mismatched date label, unit, figure id or label are rejected', () => {
    const c1 = good(); c1.dateLabel = '22 Oct 2026'; expect(sanitizeDataCard(c1)).toBeUndefined()
    const c2 = good(); c2.unit = 'MKWh'; expect(sanitizeDataCard(c2)).toBeUndefined()
    const c3 = good(); c3.figure.unit = 'MKWh'; expect(sanitizeDataCard(c3)).toBeUndefined()
    const c4 = good(); c4.figure.id = 'dayPeakGen'; expect(sanitizeDataCard(c4)).toBeUndefined()
    const c5 = good(); c5.figure.label.en = 'Total payments'; expect(sanitizeDataCard(c5)).toBeUndefined()
    const c6 = good(); c6.figure.sourceField = 'systemStats.dayPeakGen'; expect(sanitizeDataCard(c6)).toBeUndefined()
  })
  it('series: id, unit, title and item fields must be the series', () => {
    const s = () => JSON.parse(JSON.stringify(dataCardFor(fetched, 'zone:demand')!))
    expect(sanitizeDataCard(s())).toBeDefined()
    const a = s(); a.series.unit = 'MKWh'; a.unit = 'MKWh'; expect(sanitizeDataCard(a)).toBeUndefined()
    const b = s(); b.series.title.en = 'Profit by zone'; expect(sanitizeDataCard(b)).toBeUndefined()
    const c = s(); c.series.items[0].sourceField = 'systemStats.dayPeakGen'; expect(sanitizeDataCard(c)).toBeUndefined()
    const share = JSON.parse(JSON.stringify(dataCardFor(fetched, 'fuelMix:share')!)); delete share.series.derived
    expect(sanitizeDataCard(share)).toBeUndefined()
  })
  it('1e-300 and 1e300 never reach the renderer, and count-up never throws', () => {
    expect(isShowableNumber(1e-300)).toBe(false)
    expect(isShowableNumber(1e16)).toBe(false)
    expect(isShowableNumber(15552.54)).toBe(true)
    const c = good(); c.value = 1e-300; c.figure.value = 1e-300
    expect(sanitizeDataCard(c)).toBeUndefined()
    expect(() => countUpText({ target: 1e-300, duration: 1 }, 0.5)).not.toThrow()
    expect(() => parseGridDay({ ...raw, systemStats: { ...raw.systemStats, dayPeakGen: 1e300 } }, ISO)).toThrow()
  })
  it('only the site\'s own daily file is a valid source (no loopback, no other host or date)', () => {
    for (const src of ['http://127.0.0.1:5999/data/daily/2026-10-21.json', 'https://esbpowerline.com.evil.com/data/daily/2026-10-21.json', 'https://esbpowerline.com/other.json', 'https://esbpowerline.com/data/daily/2026-10-20.json']) {
      const c = good(); c.source = src; expect(sanitizeDataCard(c)).toBeUndefined()
    }
    const c = good(); c.source = `https://esbpowerline.com/api/data/daily/${ISO}.json`; expect(sanitizeDataCard(c)).toBeDefined()
  })
})

describe('C13 charts', () => {
  it('the hourly line is spaced by clock time', () => {
    const p = linePositions(['19:00', '19:30', '20:00', '21:00'])
    expect(p[1]).toBeCloseTo(0.25)
    expect(p[3]).toBe(1)
    expect(linePositions(['a', 'b', 'c'])).toEqual([0, 0.5, 1])
    const h = hourlySeries(day, 'generation')!
    const pos = linePositions(h.items.map((i) => i.label))
    expect(pos.every((x, i) => i === 0 || x > pos[i - 1])).toBe(true)
  })
  it('the donut legend leaves out zero rows and puts each value after its label', () => {
    const spec: ChartSpec = { kind: 'donut', items: [{ label: 'Gas', value: 5 }, { label: 'Hydro', value: 0 }, { label: 'Coal', value: 3 }], unit: 'MKWh', size: 32 }
    const m = donutMetrics(spec, { w: 780, h: 360 }, fake)
    expect(m.rows.map((r) => r.it.label)).toEqual(['Gas', 'Coal'])
    expect(m.fits).toBe(true)
  })
  it('load shedding at the evening peak is read at the demand-peak hour', () => {
    const f = readMetric(day, 'eveningPeakLoadShed')
    expect(f?.time).toBe(day.systemStats.peakTimes?.eveningPeakDemand ?? day.systemStats.peakTimes?.eveningPeakGen)
  })
})

describe('S2/P5 grid-data.cjs', () => {
  it('pickDay keeps the report\'s parts only and refuses a nesting bomb', () => {
    expect(Object.keys(pickDay({ ...raw, evil: 1 }))).not.toContain('evil')
    let deep: unknown = 1
    for (let i = 0; i < 5000; i++) deep = { a: deep }
    expect(pickDay({ ...raw, hourlyLoadData: [deep] })).toBeNull()
  })
  it('the newest-day search has one deadline and gives up when the network never answers', async () => {
    const never = (_url: string, init: { signal: AbortSignal }) => new Promise<Response>((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' }))))
    const g = createGridData({ userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'p3fix-')), fetchImpl: never, now: () => Date.parse('2026-11-02T06:00:00Z'), latestDeadlineMs: 80, timeoutMs: 60000 })
    const t0 = Date.now()
    const r = await g.latest([{ name: 'sb-sxgokpmrbgdndstygapc-auth-token', value: 'base64-eyJhY2Nlc3NfdG9rZW4iOiJ4In0' }])
    expect(Date.now() - t0).toBeLessThan(3000)
    expect(r.ok).toBe(false)
  })
})

describe('P2 moving titles are quantised to the project frame', () => {
  it('instants within one frame draw once; frame i of an export is frame i', () => {
    expect(frameTime(1.0001, 30)).toBeCloseTo(1)
    expect(frameTime(1.034, 30)).toBeCloseTo(1 + 1 / 30)
    expect(frameTime(7 / 30, 30)).toBeCloseTo(7 / 30)
  })
})

// ------------------------------------------------------------------ goldens

const golden = async (name: string, W: number, H: number, draw: (ctx: CanvasRenderingContext2D, m: Measurer) => void) => {
  const file = path.resolve(import.meta.dirname, '../golden/video', name)
  const canvas = napi!.createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  const m = canvasMeasurer(ctx)
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H)
  draw(ctx, m)
  const now = ctx.getImageData(0, 0, W, H).data.slice()
  if (!fs.existsSync(file) || process.env.UPDATE_GOLDEN === '1') { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, canvas.toBuffer('image/png')) }
  const ref = await napi!.loadImage(fs.readFileSync(file))
  const rc = napi!.createCanvas(W, H).getContext('2d')
  rc.drawImage(ref, 0, 0)
  const a = rc.getImageData(0, 0, W, H).data
  let off = 0
  for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - now[i]) + Math.abs(a[i + 1] - now[i + 1]) + Math.abs(a[i + 2] - now[i + 2]) > 48) off++
  expect(off / (W * H)).toBeLessThan(0.01)
}

describe.skipIf(!napi)('goldens (@napi-rs/canvas)', () => {
  it('9:16 totalEnergyGen card: the whole figure fits (fit-to-width)', async () => {
    await golden('p3fix-916-fit-540x960.png', 540, 960, (ctx, m) => {
      const spec = dataCardSpec(dataCardFor(fetched, 'totalEnergyGen')!, { frame: { w: 540, h: 960 }, measure: m, editor: false, duration: 6 })!
      renderTitleSpec(ctx, spec, settleTime(spec, m) + 0.1, { measure: m })
      const v = spec.elements.find((e) => e.id === 'value')!
      expect(v.type === 'text' && layoutTitle({ text: v.text, font: v.font, maxWidth: v.w, maxLines: 1 }, m).truncated).toBe(false)
    })
  })
  it('a split data card: the second half\'s first frame shows the exact figure', async () => {
    await golden('p3fix-split-960x540.png', 960, 540, (ctx, m) => {
      const clip = dataCardClip(dataCardFor(fetched, 'eveningPeakGen')!, 'v2', 0, 'g')
      const proj = migrateTimeline({ clips: [clip], tracks: [{ id: 'v2', kind: 'overlay', name: 'V2' }] } as never)
      const b = (splitClip(proj as never, clip.id, 3) as unknown as { clips: (typeof clip)[] }).clips[1]
      const spec = buildTitleSpec(b, 960, 540, false, m)!
      renderTitleSpec(ctx, spec, b.in, { measure: m })
    })
  })
  it('donut card on 4:5 keeps every nonzero legend row beside its value', async () => {
    await golden('p3fix-donut-45-540x675.png', 540, 675, (ctx, m) => {
      const spec = gridChartCard(sharesOf(fuelMix(day)!), 'donut', { frame: { w: 540, h: 675 }, measure: m, editor: false, duration: 7, itemColors: true })
      renderTitleSpec(ctx, spec, settleTime(spec, m) + 0.1, { measure: m })
      expect(validateTitleSpec(spec, { measure: m }).filter((i) => i.code === 'overflow')).toEqual([])
    })
  })
})
