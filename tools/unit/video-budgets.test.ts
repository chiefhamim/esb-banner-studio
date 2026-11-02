// Phase 8: performance budgets for the AI-editing, template and publish code, written as tests. The numbers are generous
// (a loaded PC must still pass) but would catch an accidental quadratic loop or a per-word allocation.
import { describe, it, expect } from 'vitest'
import { addClip, createDefaultTimeline, type Clip } from '../../src/video/timeline'
import { applyCutsToClip } from '../../src/video/ai/applyCuts'
import { captionClipsFor } from '../../src/video/ai/captionPlan'
import { silencePlan, fillerPlan } from '../../src/video/ai/cutPlan'
import { findHighlights } from '../../src/video/ai/highlights'
import { buildCues, makeTranscript, sanitizeSavedTranscript, type Word } from '../../src/video/ai/transcript'
import { buildStoryTimeline, quotesWithSpeakers, suggestBroll } from '../../src/video/storyVideo'
import { TEMPLATES, applyTemplate } from '../../src/video/templates'
import { DEFAULT_BRAND } from '../../src/video/brandKit'
import { applySize, setFraming } from '../../src/video/sizes'
import { stripClip, templateFrom } from '../../src/video/userTemplates'

// Timing tests on a shared PC: the budget is scaled by how slow this machine is right now (a fixed CPU workload, measured
// before and after), so a busy PC cannot fail a budget that an idle one meets, while a real slowdown of the code still does.
const calibrate = () => { const t = performance.now(); let x = 0; for (let i = 0; i < 3e6; i++) x += Math.sqrt(i); return performance.now() - t + x * 0 }
const IDLE_CALIBRATION_MS = 12
const load = () => Math.max(1, [calibrate(), calibrate(), calibrate()].sort((a, b) => a - b)[1] / IDLE_CALIBRATION_MS)
let loadNow = 1
const time = <T>(fn: () => T): { ms: number; out: T } => { loadNow = load(); const t = performance.now(); const out = fn(); const ms = performance.now() - t; loadNow = Math.max(loadNow, load()); return { ms: ms / loadNow, out } }
const words = (n: number): Word[] => Array.from({ length: n }, (_, i) => ({ text: i % 40 === 39 ? `w${i}.` : `w${i}`, start: i * 0.4, end: i * 0.4 + 0.3, confidence: 0.9 }))
const hourClip: Clip = { id: 'f1', trackId: 'v1', title: 'Interview', kind: 'video', start: 0, duration: 3600, in: 0, out: 3600, color: '#000', sourceUrl: 'x', mediaAssetId: 'a1', srcDuration: 3600 }

describe('budgets: AI editing', () => {
  it('200 cuts out of an hour-long clip in under 2 s', () => {
    const p = addClip(createDefaultTimeline('16:9'), hourClip)
    const ranges = Array.from({ length: 200 }, (_, i) => ({ from: 10 + i * 17, to: 12 + i * 17 }))
    const { ms, out } = time(() => applyCutsToClip(p, 'f1', ranges))
    expect(out.removed).toBe(200)
    expect(ms).toBeLessThan(2000)
  })

  it('captions for 20,000 words in under 2.5 s (measured ~0.4 s idle, 1.2 s while two heavy runs shared the PC)', () => {
    const p = addClip(createDefaultTimeline('16:9'), hourClip)
    const { ms, out } = time(() => captionClipsFor(p, { mediaAssetId: 'a1' }, words(20000), 'c1'))
    expect(out.length).toBeGreaterThan(500)
    expect(ms).toBeLessThan(2500)
  })

  it('silence plan over 20 minutes of 16 kHz mono in under 2 s', () => {
    const sr = 16000
    const a = new Float32Array(sr * 60 * 20)
    for (let i = 0; i < a.length; i += 7) a[i] = (i % 3 === 0 ? 0.3 : -0.3) * (Math.floor(i / sr / 4) % 2)
    const { ms } = time(() => silencePlan([a], sr, 0, 30, 1200))
    expect(ms).toBeLessThan(2000)
  })

  it('hesitations and Short candidates for a 1-hour transcript in under 1.5 s', () => {
    const w = words(9000)
    expect(time(() => fillerPlan(w, 30, 3600)).ms).toBeLessThan(1500)
    expect(time(() => findHighlights(w, { top: 8 })).ms).toBeLessThan(1500)
    expect(time(() => buildCues(w)).ms).toBeLessThan(1500)
  })

  it('a saved transcript of 50,000 words is checked on load in under 800 ms', () => {
    const t = makeTranscript(words(50000), { kind: 'ai', engine: 'gemini', model: 'm', at: 1 })
    const json = JSON.parse(JSON.stringify(t))
    const { ms, out } = time(() => sanitizeSavedTranscript(json))
    expect(out?.words.length).toBe(50000)
    expect(ms).toBeLessThan(800)
  })
})

describe('budgets: templates, sizes, own templates', () => {
  const body = Array.from({ length: 60 }, (_, i) => `Officials said project ${i} will add gas to the grid this winter season near Sylhet.`).join('\n\n') + '\n\n“We expect the first gas by December and no delay at all,” said Rahim Uddin, the project director.'
  const story = { headline: 'Petrobangla to drill wells', deck: 'Two new wells are set to raise gas supply by winter this year.', body, desk: 'Gas', bannerUrl: 'b', photoUrl: 'p', category: '02', quote: quotesWithSpeakers(body).named[0] ?? null }

  it('all seven templates build from a long story in under 300 ms together', () => {
    const { ms } = time(() => TEMPLATES.map((t) => applyTemplate(t, story, DEFAULT_BRAND)))
    expect(ms).toBeLessThan(300)
  })

  it('story builder and B-roll matching over 500 bin items in under 200 ms', () => {
    const assets = Array.from({ length: 500 }, (_, i) => ({ id: `a${i}`, name: `clip-${i}-sylhet.mp4`, type: 'video' }))
    expect(time(() => suggestBroll(assets, body)).ms).toBeLessThan(200)
    expect(time(() => buildStoryTimeline({ ...story, aspect: '16:9' })).ms).toBeLessThan(100)
  })

  it('switching shape on a 400-clip project and saving it as a template in under 300 ms', () => {
    let p = createDefaultTimeline('16:9')
    for (let i = 0; i < 400; i++) p = addClip(p, { ...hourClip, id: `c${i}`, start: i * 3, duration: 3, in: i * 3, out: i * 3 + 3, offX: i % 5 / 10 })
    const { ms } = time(() => { const nine = applySize(setFraming(p, '9:16', {}), '9:16'); return templateFrom(nine, 'T') })
    expect(ms).toBeLessThan(300)
    expect(stripClip(hourClip)?.sourceUrl).toBeUndefined()
  })
})

describe('budgets: Bangla text (the grapheme segmenter is the slow part)', () => {
  it('cues for 9,000 Bangla words in under 1.2 s', () => {
    const bn = ['বাংলাদেশ', 'বিদ্যুৎ', 'উৎপাদন', 'গ্যাস', 'সরবরাহ', 'প্রকল্পের', 'কাজ', 'শুরু', 'হবে', 'ডিসেম্বরে']
    const w: Word[] = Array.from({ length: 9000 }, (_, i) => ({ text: i % 40 === 39 ? bn[i % 10] + '।' : bn[i % 10], start: i * 0.4, end: i * 0.4 + 0.3, confidence: 0.9 }))
    const { ms, out } = time(() => buildCues(w))
    expect(out.length).toBeGreaterThan(100)
    expect(ms).toBeLessThan(1200)
  })
})
