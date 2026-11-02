// Phase 3 Part B — Grid data cards: the main-process fetch (electron/grid-data.cjs) as if the renderer were hostile,
// the card's figure equalling the source JSON exactly, the Source line, derived labels, the project-file sanitiser,
// the refresh comparison, and a golden frame of the count-up's final (exported) state.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseGridDay, GRID_METRICS, readMetric, type GridMetricId } from '../../src/video/titles/grid'
import { formatExact, countUpText } from '../../src/video/titles/numbers'
import { canvasMeasurer, type Measurer } from '../../src/video/titles/layout'
import { renderTitleSpec, settleTime } from '../../src/video/titles/render'
import { DATA_SERIES, dataCardClip, dataCardTextAt, dataCardFor, dataCardSpec, readSeries, refreshDiff, sanitizeDataCard, type DataCardRef, type FetchedDay } from '../../src/video/dataCardClip'
import { migrateTimeline, splitClip } from '../../src/video/timeline'
import { buildTitleSpec, titleProblems } from '../../src/video/titleClip'

const require = createRequire(import.meta.url)
const { createGridData, validDate, resolveOrigin, dhakaToday, SITE_ORIGIN, MAX_BYTES } = require('../../electron/grid-data.cjs')

const ISO = '2026-10-21'
const fixturePath = path.resolve(import.meta.dirname, '../fixtures/video/grid-daily-2026-10-21.json')
const rawText = fs.readFileSync(fixturePath, 'utf8')
const raw = JSON.parse(rawText)
const cookies = [{ name: 'sb-sxgokpmrbgdndstygapc-auth-token', value: 'base64-eyJhY2Nlc3NfdG9rZW4iOiJ4In0' }]
const NOW = Date.parse('2026-11-02T06:00:00Z')

type Call = { url: string; init: RequestInit & { headers: Record<string, string> } }
function server(answer: (url: string) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fn = async (url: string, init: Call['init']) => { calls.push({ url, init }); return answer(url) }
  return { fn, calls }
}
const ok = (body: string, headers: Record<string, string> = {}) => new Response(body, { status: 200, headers: { 'Content-Type': 'application/json', ...headers } })
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'p3b-grid-'))
const make = (fetchImpl: unknown, extra: Record<string, unknown> = {}) => createGridData({ userDataDir: tmp(), fetchImpl, now: () => NOW, ...extra })

describe('grid-data.cjs — the main-process fetch', () => {
  it('accepts only real calendar days in the site range', () => {
    expect(validDate('2026-10-21')).toBe('2026-10-21')
    for (const bad of ['2026-02-30', '2026-13-01', '2010-12-31', '2031-01-01', '26-10-21', '2026-10-21/../../x', '../2026-10-21', '2026-10-21.json', ' 2026-10-21', 2026, null, { iso: ISO }]) expect(validDate(bad)).toBeNull()
  })

  it('refuses a bad date or a future day without any request', async () => {
    const s = server(() => ok(rawText))
    const g = make(s.fn)
    expect((await g.fetchDay(cookies, '../../etc/passwd')).code).toBe('bad-date')
    expect((await g.fetchDay(cookies, 'https://evil.example/x')).code).toBe('bad-date')
    expect((await g.fetchDay(cookies, '2026-11-05')).code).toBe('not-published')
    expect(s.calls).toHaveLength(0)
  })

  it('asks the fixed origin for exactly the date path, with the session cookie and an honest agent — no Referer/Origin, no redirects', async () => {
    const s = server(() => ok(rawText))
    const g = make(s.fn, { userAgent: 'ESB-AI-Studio/test (desktop; +https://esbpowerline.com)' })
    const r = await g.fetchDay(cookies, ISO)
    expect(r.ok).toBe(true)
    expect(s.calls).toHaveLength(1)
    expect(s.calls[0].url).toBe(`${SITE_ORIGIN}/data/daily/${ISO}.json`)
    const h = s.calls[0].init.headers
    expect(h.Cookie).toBe(`${cookies[0].name}=${cookies[0].value}`)
    expect(h['User-Agent']).toMatch(/^ESB-AI-Studio\//)
    expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain('referer')
    expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain('origin')
    expect(s.calls[0].init.redirect).toBe('manual')
    expect(r.source).toBe(`${SITE_ORIGIN}/data/daily/${ISO}.json`)
    expect(r.fetchedAt).toBe(new Date(NOW).toISOString())
  })

  it('never goes anywhere but esbpowerline.com, unless an unpackaged build is pointed at a loopback test server', () => {
    expect(resolveOrigin(undefined, false)).toBe(SITE_ORIGIN)
    expect(resolveOrigin('https://evil.example', false)).toBe(SITE_ORIGIN)
    expect(resolveOrigin('http://evil.example:8080', false)).toBe(SITE_ORIGIN)
    expect(resolveOrigin('http://127.0.0.1:5999/x', false)).toBe(SITE_ORIGIN)
    expect(resolveOrigin('http://127.0.0.1:5999', true)).toBe(SITE_ORIGIN)
    expect(resolveOrigin('http://127.0.0.1:5999', false)).toBe('http://127.0.0.1:5999')
  })

  it('tries the runtime twin when the static file is not there, and says "No data published" when neither is', async () => {
    const twin = server((u) => (u.includes('/api/data/') ? ok(rawText) : new Response('nf', { status: 404 })))
    const r = await make(twin.fn).fetchDay(cookies, ISO)
    expect(r.ok).toBe(true)
    expect(twin.calls.map((c) => c.url)).toEqual([`${SITE_ORIGIN}/data/daily/${ISO}.json`, `${SITE_ORIGIN}/api/data/daily/${ISO}.json`])
    const none = server(() => new Response('nf', { status: 404 }))
    const n = await make(none.fn).fetchDay(cookies, ISO)
    expect(n).toMatchObject({ ok: false, code: 'not-published', error: `No data published for ${ISO}.` })
  })

  it('explains each refusal plainly', async () => {
    const answer = async (res: Response) => make(server(() => res).fn).fetchDay(cookies, ISO)
    expect(await answer(new Response('', { status: 307, headers: { Location: '/login' } }))).toMatchObject({ code: 'signed-out' })
    expect(await answer(new Response('{"error":"Unauthorized"}', { status: 401 }))).toMatchObject({ code: 'signed-out' })
    expect(await answer(new Response('Subscription required for historical grid data access.', { status: 403 }))).toMatchObject({ code: 'window' })
    expect(await answer(new Response('Access Denied: Direct data access is restricted.', { status: 403 }))).toMatchObject({ code: 'refused', error: expect.stringMatching(/site change is pending/) })
    expect(await answer(new Response('slow down', { status: 429 }))).toMatchObject({ code: 'rate' })
    expect(await answer(new Response('<html>', { status: 200 }))).toMatchObject({ code: 'bad-data' })
    // a file for another day is not this day's data
    const other = JSON.stringify({ ...raw, systemStats: { ...raw.systemStats, date: '20 Oct 2026' } })
    expect(await answer(ok(other))).toMatchObject({ code: 'bad-data' })
  })

  it('needs a session cookie of the site\'s own form before it sends anything', async () => {
    const s = server(() => ok(rawText))
    const g = make(s.fn)
    expect((await g.fetchDay(null, ISO)).code).toBe('signed-out')
    expect((await g.fetchDay([], ISO)).code).toBe('signed-out')
    expect((await g.fetchDay([{ name: 'session', value: 'x' }], ISO)).code).toBe('signed-out')
    expect((await g.fetchDay([{ name: cookies[0].name, value: 'a;\r\nHost: evil' }], ISO)).code).toBe('signed-out')
    expect(s.calls).toHaveLength(0)
  })

  it('refuses an oversized body, by its declared length and while streaming', async () => {
    const declared = await make(server(() => ok('{}', { 'Content-Length': String(MAX_BYTES + 1) })).fn).fetchDay(cookies, ISO)
    expect(declared.code).toBe('too-large')
    const big = new ReadableStream({ start(c) { const chunk = new Uint8Array(256 * 1024).fill(32); for (let i = 0; i < 10; i++) c.enqueue(chunk); c.close() } })
    const streamed = await make(server(() => new Response(big, { status: 200 })).fn).fetchDay(cookies, ISO)
    expect(streamed.code).toBe('too-large')
  })

  it('sends at most its per-minute budget to the site, whatever the renderer asks', async () => {
    const s = server(() => ok(rawText))
    const g = createGridData({ userDataDir: tmp(), fetchImpl: s.fn, now: () => NOW, maxPerMinute: 3 })
    const answers = []
    for (let i = 0; i < 5; i++) answers.push(await g.fetchDay(cookies, ISO, { refresh: true }))
    expect(s.calls).toHaveLength(3)
    expect(answers[4]).toMatchObject({ ok: false, code: 'rate' })
  })

  it('gives up after its time limit', async () => {
    const hang = (_u: string, init: RequestInit) => new Promise<Response>((_r, reject) => { init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))) })
    const r = await createGridData({ userDataDir: tmp(), fetchImpl: hang, now: () => NOW, timeoutMs: 50 }).fetchDay(cookies, ISO)
    expect(r.code).toBe('timeout')
  })

  it('caches each day with its fetch time; refresh asks again; the cached copy works offline', async () => {
    const dir = tmp()
    const s = server(() => ok(rawText))
    const g = createGridData({ userDataDir: dir, fetchImpl: s.fn, now: () => NOW })
    await g.fetchDay(cookies, ISO)
    const again = await g.fetchDay(null, ISO) // signed out: the saved copy still answers
    expect(again).toMatchObject({ ok: true, cached: true, fetchedAt: new Date(NOW).toISOString() })
    expect(s.calls).toHaveLength(1)
    await g.fetchDay(cookies, ISO, { refresh: true })
    expect(s.calls).toHaveLength(2)
    expect(g.cached(ISO)).toMatchObject({ ok: true, cached: true })
    expect(g.cached('2026-10-20').code).toBe('not-cached')
    expect(g.cachedDates()).toEqual([ISO])
    // a tampered cache file (another day's report under this name) is ignored
    fs.writeFileSync(path.join(dir, 'grid-cache', `${ISO}.json`), JSON.stringify({ v: 1, iso: ISO, fetchedAt: 'x', source: 'y', data: { systemStats: { date: '1 Jan 2020' } } }))
    expect(g.cached(ISO).ok).toBe(false)
  })

  it('finds the newest published day from today (Dhaka) backwards', async () => {
    expect(dhakaToday(Date.parse('2026-11-01T19:00:00Z'))).toBe('2026-11-02')
    const s = server((u) => (u.endsWith(`${ISO}.json`) && !u.includes('/api/') ? ok(rawText) : new Response('nf', { status: 404 })))
    const g = createGridData({ userDataDir: tmp(), fetchImpl: s.fn, now: () => Date.parse('2026-10-23T06:00:00Z') })
    const r = await g.latest(cookies)
    expect(r).toMatchObject({ ok: true, iso: ISO })
    // stops at the first refusal instead of probing on
    const refused = server(() => new Response('Access Denied: Direct data access is restricted.', { status: 403 }))
    const x = await make(refused.fn).latest(cookies)
    expect(x.code).toBe('refused')
    expect(refused.calls).toHaveLength(1)
  })
})

// ------------------------------------------------------------------ the card equals the source

const fake: Measurer = (text, font) => text.length * font.size * 0.55
const day = parseGridDay(raw, ISO)
const fetched: FetchedDay = { day, fetchedAt: '2026-11-02T06:00:00.000Z', source: `${SITE_ORIGIN}/data/daily/${ISO}.json` }
const frame169 = { w: 1920, h: 1080 }

describe('data cards — the figure is the source JSON value for that date', () => {
  it('every number card carries the stored value, its unit, date, field, fetch time and source', () => {
    for (const id of GRID_METRICS) {
      const card = dataCardFor(fetched, id)
      const fig = readMetric(day, id)
      if (!fig) { expect(card).toBeNull(); continue }
      expect(card).toMatchObject({ kind: 'number', date: ISO, dateLabel: '21 Oct 2026', metric: id, value: fig.value, unit: fig.unit, fetchedAt: fetched.fetchedAt, source: fetched.source })
    }
    expect(dataCardFor(fetched, 'eveningPeakGen')!.value).toBe(raw.systemStats.eveningPeakGen)
    expect(dataCardFor(fetched, 'totalEnergyGen')!.value).toBe(raw.systemStats.totalEnergyGen)
    expect(dataCardFor(fetched, 'totalEnergyUnserved')!.value).toBe(raw.systemStats.totalEnergyUnserved)
  })

  it('the final (exported) frame shows the exact source digits and the Source line with the date', () => {
    for (const id of ['eveningPeakGen', 'totalEnergyGen', 'totalEnergyUnserved', 'maxTemp', 'totalGasSuppliedPower'] as GridMetricId[]) {
      const clip = dataCardClip(dataCardFor(fetched, id)!, 'v2', 0, id)
      const end = dataCardTextAt(clip, clip.duration - 0.5, 1920, 1080, false, fake)
      const src = (raw.systemStats as Record<string, number>)[id]
      expect(end.value).toBe(formatExact(src))
      expect(end.value.replace(/,/g, '')).toBe(String(src)) // nothing rounded: 329.48744486 stays 329.48744486
      expect(end.source).toBe('Source: esbpowerline.com Grid data, 21 Oct 2026')
      // mid count-up shows an intermediate, never the final until the end
      const mid = dataCardTextAt(clip, 0.5, 1920, 1080, false, fake)
      expect(mid.value).not.toBe(end.value)
    }
  })

  it('Bangla digits are the same digits in another script', () => {
    const card = dataCardFor(fetched, 'eveningPeakGen', { digits: 'bn', lang: 'bn' })!
    const t = dataCardTextAt(dataCardClip(card, 'v2', 0, 'bn'), 5, 1080, 1920, false, fake)
    expect(t.value).toBe('১৫,৫৫২.৫৪')
  })

  it('every series card keeps each item value exactly; derived series say "Derived" with the formula', () => {
    for (const id of DATA_SERIES) {
      const s = readSeries(day, id)
      const card = dataCardFor(fetched, id)
      if (!s) { expect(card).toBeNull(); continue }
      expect(card!.series!.items.map((i) => i.value)).toEqual(s.items.map((i) => i.value))
      const spec = dataCardSpec(card!, { frame: frame169, measure: fake, editor: false, duration: 7 })!
      const derived = spec.elements.find((e) => e.id === 'derived')
      if (s.derived) expect(derived && derived.type === 'text' && derived.text).toBe(`Derived: ${s.derived.formula}`)
      else expect(derived).toBeUndefined()
      expect(spec.elements.some((e) => e.type === 'text' && e.text === 'Source: esbpowerline.com Grid data, 21 Oct 2026')).toBe(true)
    }
    expect(dataCardFor(fetched, 'fuelMix')!.series!.items.map((i) => i.value)).toEqual(raw.generationData.map((g: { gen: number }) => g.gen))
    expect(dataCardFor(fetched, 'zone:pct')!.series!.derived?.formula).toMatch(/loadShed ÷ demand/)
    expect(dataCardFor(fetched, 'fuelMix:share')!.series!.derived?.formula).toMatch(/share = value ÷ Σ values/)
  })

  it('the animation presets change motion only, never the words', () => {
    const card = dataCardFor(fetched, 'eveningPeakDemand', { animIn: 'blur', animOut: 'slide' })!
    const spec = dataCardSpec(card, { frame: frame169, measure: fake, editor: false, duration: 6 })!
    expect(spec.elements.every((e) => !e.anim || e.anim.duration === 6)).toBe(true)
    const v = spec.elements.find((e) => e.id === 'value')!
    expect(v.anim?.in?.effects).toContain('blur')
    expect(v.type === 'text' && v.text).toBe(formatExact(raw.systemStats.eveningPeakDemand))
    const cut = dataCardSpec({ ...card, style: { ...card.style, animOut: 'none' } }, { frame: frame169, measure: fake, editor: false, duration: 6 })!
    expect(cut.elements.every((e) => !e.anim?.out)).toBe(true)
  })
})

describe('data cards in the project file', () => {
  const card = dataCardFor(fetched, 'eveningPeakGen')!
  it('survive save and reopen unchanged', () => {
    const clip = dataCardClip(card, 'v2', 3, 'a')
    const tl = migrateTimeline({ timelineVersion: 2, tracks: [{ id: 'v2', name: 'V2', kind: 'overlay' }], clips: [JSON.parse(JSON.stringify(clip))] })
    expect(tl.clips[0].dataCard).toEqual(card)
  })
  it('a tampered card is dropped, never shown with a figure it did not read', () => {
    const bad = (patch: Record<string, unknown>) => sanitizeDataCard({ ...JSON.parse(JSON.stringify(card)), ...patch })
    expect(bad({ value: 99999 })).toBeUndefined() // the shown value must equal the stored figure
    expect(bad({ source: 'https://evil.example/data.json' })).toBeUndefined()
    expect(bad({ date: '2026-10-21T00' })).toBeUndefined()
    expect(bad({ metric: 'madeUp' })).toBeUndefined()
    expect(bad({ figure: { ...card.figure, value: 'NaN' } })).toBeUndefined()
    expect(bad({ style: { accent: 'url(javascript:x)', animIn: 'explode' } })!.style).toMatchObject({ accent: null, animIn: 'esb' })
    expect(sanitizeDataCard('x')).toBeUndefined()
    const chart = JSON.parse(JSON.stringify(dataCardFor(fetched, 'fuelMix')!)) as DataCardRef
    chart.series!.items = Array.from({ length: 200 }, () => chart.series!.items[0])
    expect(sanitizeDataCard(chart)).toBeUndefined()
    const tl = migrateTimeline({ timelineVersion: 2, tracks: [{ id: 'v1', name: 'V1', kind: 'video' }], clips: [{ ...dataCardClip(card, 'v1', 0, 'b'), kind: 'video' }] })
    expect(tl.clips[0].dataCard).toBeUndefined() // only an overlay may be a data card
  })
})

describe('refresh — shows a change and lets the editor decide', () => {
  const card = dataCardFor(fetched, 'eveningPeakGen')!
  it('unchanged when the site publishes the same figure (a newer fetch time is not a change)', () => {
    const d = refreshDiff(card, { ...fetched, fetchedAt: '2026-11-03T00:00:00.000Z' })
    expect(d.changed).toBe(false)
  })
  it('changed: before and after, and the rebuilt card keeps its style', () => {
    const corrected = parseGridDay({ ...raw, systemStats: { ...raw.systemStats, eveningPeakGen: 15560.1 } }, ISO)
    const styled = { ...card, style: { ...card.style, lang: 'bn' as const, accent: '#00E5FF' } }
    const d = refreshDiff(styled, { day: corrected, fetchedAt: '2026-11-03T00:00:00.000Z', source: fetched.source })
    expect(d).toMatchObject({ changed: true, missing: false, before: '15,552.54 MW · 19:00', after: '15,560.1 MW · 19:00' })
    expect(d.next).toMatchObject({ value: 15560.1, fetchedAt: '2026-11-03T00:00:00.000Z', style: { lang: 'bn', accent: '#00E5FF' } })
  })
  it('missing when the day no longer publishes the figure', () => {
    const gone = parseGridDay({ ...raw, systemStats: { ...raw.systemStats, maxTemp: null } }, ISO)
    const d = refreshDiff(dataCardFor(fetched, 'maxTemp')!, { ...fetched, day: gone })
    expect(d).toMatchObject({ changed: true, missing: true, next: null })
  })
  it('a chart is changed when any item value moves', () => {
    const c = dataCardFor(fetched, 'fuelMix')!
    const g2 = raw.generationData.map((g: { gen: number }, i: number) => (i === 0 ? { ...g, gen: g.gen + 0.01 } : g))
    expect(refreshDiff(c, { ...fetched, day: parseGridDay({ ...raw, generationData: g2 }, ISO) }).changed).toBe(true)
    expect(refreshDiff(c, fetched).changed).toBe(false)
  })
})

// ------------------------------------------------------------------ golden frame (count-up's final state)

type NapiCanvas = { createCanvas: (w: number, h: number) => { getContext: (k: '2d') => CanvasRenderingContext2D; toBuffer: (m: 'image/png') => Buffer }; loadImage: (b: Buffer) => Promise<CanvasImageSource & { width: number; height: number }> }
let napi: NapiCanvas | null = null
try { napi = (await import('@napi-rs/canvas' as string)) as NapiCanvas } catch { napi = null }
const GOLDEN = path.resolve(import.meta.dirname, '../golden/video/p3b-number-final-960x540.png')

describe.skipIf(!napi)('golden frame (@napi-rs/canvas): the big-number card at the end of its count-up', () => {
  it('matches the reference within 1 % of pixels, and the frame equals the settled frame', async () => {
    const W = 960, H = 540
    const canvas = napi!.createCanvas(W, H)
    const ctx = canvas.getContext('2d')
    const m = canvasMeasurer(ctx)
    const card = dataCardFor(fetched, 'eveningPeakGen')!
    const spec = dataCardSpec(card, { frame: { w: W, h: H }, measure: m, editor: false, duration: 6 })!
    const end = settleTime(spec, m)
    const value = spec.elements.find((e) => e.id === 'value')!
    expect(value.type === 'text' && countUpText(value.countUp!, end)).toBe('15,552.54')
    const frameAt = (t: number) => { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); renderTitleSpec(ctx, spec, t, { measure: m }); return ctx.getImageData(0, 0, W, H).data.slice() }
    const settled = frameAt(end)
    const later = frameAt(end + 1.5) // still settled: the same pixels as the final count-up frame
    let same = 0
    for (let i = 0; i < settled.length; i++) if (settled[i] === later[i]) same++
    expect(same / settled.length).toBeGreaterThan(0.999)
    frameAt(end)
    if (!fs.existsSync(GOLDEN) || process.env.UPDATE_GOLDEN === '1') {
      fs.mkdirSync(path.dirname(GOLDEN), { recursive: true })
      fs.writeFileSync(GOLDEN, canvas.toBuffer('image/png'))
    }
    const ref = await napi!.loadImage(fs.readFileSync(GOLDEN))
    const rc = napi!.createCanvas(W, H)
    const rctx = rc.getContext('2d')
    rctx.drawImage(ref, 0, 0)
    const a = rctx.getImageData(0, 0, W, H).data
    let off = 0
    for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - settled[i]) + Math.abs(a[i + 1] - settled[i + 1]) + Math.abs(a[i + 2] - settled[i + 2]) > 48) off++
    expect(off / (W * H)).toBeLessThan(0.01)
  })
})

describe('data cards on the title path (Part A + Part B merge)', () => {
  const card = () => dataCardFor(fetched, 'eveningPeakGen')!

  it('a data card is built by buildTitleSpec from clip.dataCard alone (no titleData copy)', () => {
    const clip = dataCardClip(card(), 'v2', 0, 'tp')
    expect(clip.titleData).toBeUndefined()
    const spec = buildTitleSpec(clip, 1920, 1080, false, fake)!
    expect(spec.elements.some((e) => e.type === 'text' && e.id === 'value')).toBe(true)
  })

  it('titleProblems covers the Source line: a card without it is blocked, a good one passes', () => {
    const good = dataCardClip(card(), 'v2', 0, 'ok')
    const p = { clips: [good], width: 1920, height: 1080 }
    expect(titleProblems(p, fake)).toEqual([])
    // a card whose stored figure lost its date cannot show the Source line: the export is refused
    const bad = { ...good, dataCard: { ...good.dataCard!, figure: { ...good.dataCard!.figure!, isoDate: '' } } }
    const found = titleProblems({ ...p, clips: [bad] }, fake)
    expect(found.length).toBe(1)
    expect(found[0].label).toBe('Data card')
  })

  it('a split second half starts settled: the count-up has landed at its first frame', () => {
    const clip = dataCardClip(card(), 'v2', 0, 'sp')
    const proj = { ...migrateTimeline({ clips: [clip], tracks: [{ id: 'v2', kind: 'overlay', name: 'V2' }] } as never) }
    const cut = splitClip(proj as never, clip.id, 3) as { clips: typeof clip[] }
    const [a, b] = cut.clips
    expect(a.duration).toBeCloseTo(3)
    const end = dataCardTextAt(clip, clip.duration - 0.5, 1920, 1080, false, fake).value
    expect(dataCardTextAt(a, 0.5, 1920, 1080, false, fake).value).not.toBe(end)
    expect(dataCardTextAt(b, b.start, 1920, 1080, false, fake).value).toBe(end)
  })
})
