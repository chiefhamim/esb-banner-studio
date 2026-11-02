// Phase 5 pre-build: text-based editing (word deletions → frame-snapped cuts), filler suggestions (EN + BN),
// silence detection (exact spans ±1 frame, cross-checked with ffmpeg silencedetect), the highlight finder and the
// auto-reframe planner (subject kept inside 9:16 while it moves).
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { cutsForDeletedWords, detectSilences, fillerCuts, findFillers, keepRanges, rippleTime, silenceCuts } from '../../src/video/ai/textEdit'
import { findHighlights, sentences } from '../../src/video/ai/highlights'
import { cropSize, offsetsFor, planReframe } from '../../src/video/ai/reframe'
import type { SubjectFrame } from '../../src/video/ai/reframe'
import { footageRect } from '../../src/video/timeline'
import { valueAt } from '../../src/video/audio/curve'
import type { Word } from '../../src/video/ai/transcript'
import { hasFfmpeg, noise, sine, writeF32 } from './audio-fixtures'

const SR = 48000
const w = (text: string, start: number, end: number, confidence = 1): Word => ({ text, start, end, confidence })

describe('deleted words → cuts', () => {
  const words = [w('We', 0.5, 0.7), w('um', 0.9, 1.1), w('built', 1.4, 1.8), w('the', 1.9, 2.0), w('new', 2.1, 2.4), w('line.', 2.5, 3.0)]

  it('cuts from after the previous kept word (+handle) to before the next (−handle), snapped to frames', () => {
    const p = cutsForDeletedWords(words, [1], { fps: 25, handle: 0.06 })
    expect(p).toMatchObject({ kind: 'proposal', applied: false, source: 'editor' })
    expect(p.cuts).toHaveLength(1)
    const c = p.cuts[0]
    expect(c).toMatchObject({ reason: 'deleted-words', from: 1, to: 2, label: 'um' })
    expect(c.start).toBeCloseTo(0.76, 6) // 0.7 + 0.06 = 0.76 = frame 19
    expect(Math.abs(c.end - 1.34)).toBeLessThanOrEqual(0.02 + 1e-9) // 1.4 − 0.06, to the nearest frame
    expect(c.end).toBeLessThanOrEqual(1.4)
  })

  it('never cuts into a kept word, frames on exact multiples, merges runs', () => {
    const p = cutsForDeletedWords(words, [3, 4], { fps: 30, handle: 0.06 })
    expect(p.cuts).toHaveLength(1)
    const c = p.cuts[0]
    expect(c.from).toBe(3)
    expect(c.to).toBe(5)
    expect(c.label).toBe('the new')
    for (const t of [c.start, c.end]) expect(Math.abs(t * 30 - Math.round(t * 30))).toBeLessThan(1e-9)
    expect(c.start).toBeGreaterThanOrEqual(1.8 - 1 / 60)
    expect(c.end).toBeLessThanOrEqual(2.5 + 1 / 60)
  })

  it('first and last words take a handle into the edge; keep ranges and ripple times follow', () => {
    const p = cutsForDeletedWords(words, [0, 5], { fps: 50, handle: 0.1, duration: 4 })
    expect(p.cuts.map((c) => [c.start, c.end])).toEqual([[0.4, 0.8], [2.5, 3.1]])
    expect(keepRanges(4, p.cuts)).toEqual([[0, 0.4], [0.8, 2.5], [3.1, 4]])
    expect(rippleTime(0.2, p.cuts)).toBe(0.2)
    expect(rippleTime(0.5, p.cuts)).toBeNull()
    expect(rippleTime(1, p.cuts)).toBeCloseTo(0.6, 9)
  })
})

describe('fillers (suggestions only)', () => {
  it('finds English and Bangla hesitations and discourse markers, longest match first', () => {
    const ws = ['So,', 'um', 'you', 'know,', 'the', 'plant', 'উম,', 'মানে', 'আসলে', 'বিদ্যুৎ', 'কী', 'বলব', 'Uh.'].map((t, i) => w(t, i, i + 0.5))
    const f = findFillers(ws)
    expect(f.map((x) => [x.text, x.kind, x.lang])).toEqual([
      ['So,', 'discourse', 'en'], ['um', 'hesitation', 'en'], ['you know,', 'discourse', 'en'],
      ['উম,', 'hesitation', 'bn'], ['মানে', 'discourse', 'bn'], ['আসলে', 'discourse', 'bn'], ['কী বলব', 'discourse', 'bn'], ['Uh.', 'hesitation', 'en'],
    ])
    expect(findFillers(ws, { kinds: ['hesitation'] }).map((x) => x.text)).toEqual(['um', 'উম,', 'Uh.'])
    expect(findFillers(ws, { langs: ['bn'], kinds: ['hesitation'] }).map((x) => x.text)).toEqual(['উম,'])
  })

  it('filler cuts are a detector proposal, never applied', () => {
    const ws = [w('the', 0, 0.3), w('um', 0.5, 0.8), w('grid', 1.2, 1.6)]
    const p = fillerCuts(ws, findFillers(ws), { fps: 25 })
    expect(p).toMatchObject({ applied: false, source: 'detector' })
    expect(p.cuts[0].reason).toBe('filler')
  })
})

describe('silence detection', () => {
  // tone with silences at exactly 1.0–2.5 s and 4.0–4.8 s, plus a short 0.2 s dip that must not count
  const spans: [number, number][] = [[1, 2.5], [4, 4.8]]
  const x = sine(SR * 6, SR, 300, 0.1)
  const hiss = noise(SR * 6, 0.0005, 3) // −66 dBFS floor in the "silence"
  for (let i = 0; i < x.length; i++) {
    const t = i / SR
    if (spans.some(([a, b]) => t >= a && t < b) || (t >= 3.2 && t < 3.4)) x[i] = hiss[i]
  }

  it('finds exactly the silent spans (±1 frame at 30 fps) and ignores short dips', () => {
    const s = detectSilences([x], SR, { threshold: -45, minDuration: 0.5 })
    expect(s).toHaveLength(2)
    s.forEach(([a, b], i) => { expect(Math.abs(a - spans[i][0])).toBeLessThanOrEqual(1 / 30); expect(Math.abs(b - spans[i][1])).toBeLessThanOrEqual(1 / 30) })
  })

  it('turns them into frame-snapped cuts that remove exactly those spans with no handle', () => {
    const p = silenceCuts(detectSilences([x], SR), { fps: 30, handle: 0 })
    expect(p).toMatchObject({ applied: false, source: 'detector' })
    expect(p.cuts.map((c) => [c.start, c.end])).toEqual([[1, 2.5], [4, 4.8]])
    const h = silenceCuts(detectSilences([x], SR), { fps: 30, handle: 0.1 })
    expect(h.cuts[0].start).toBeCloseTo(1.1, 6)
    expect(h.cuts[0].end).toBeCloseTo(2.4, 6)
  })

  it.skipIf(!hasFfmpeg)('agrees with ffmpeg silencedetect within a frame', () => {
    const file = writeF32('silence-fixture', [x])
    const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', file, '-af', 'silencedetect=n=-45dB:d=0.5', '-f', 'null', '-'], { encoding: 'utf8' })
    const starts = [...r.stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]))
    const ends = [...r.stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]))
    const ours = detectSilences([x], SR, { threshold: -45, minDuration: 0.5 })
    expect(starts.length).toBe(ours.length)
    ours.forEach(([a, b], i) => { expect(Math.abs(a - starts[i])).toBeLessThanOrEqual(1 / 30); expect(Math.abs(b - ends[i])).toBeLessThanOrEqual(1 / 30) })
  })
})

describe('highlight finder', () => {
  // 3-minute "interview": sentences of 8 words (3.2 s); one 40 s stretch is clean and complete, the rest is
  // full of fillers and starts mid-thought
  const words: Word[] = []
  let t = 0
  const say = (text: string, conf = 0.95) => { for (const x of text.split(' ')) { words.push(w(x, +t.toFixed(3), +(t + 0.32).toFixed(3), conf)); t += 0.4 } }
  for (let i = 0; i < 15; i++) say('and um so uh you know it was like um.', 0.7)
  t += 2
  const cleanStart = t
  for (let i = 0; i < 12; i++) say(`The new plant adds four hundred megawatts number ${i}.`)
  const cleanEnd = t
  t += 2
  for (let i = 0; i < 15; i++) say('but uh the um thing is uh like.', 0.7)

  it('returns 15–60 s windows on sentence boundaries, best first, the clean statement on top', () => {
    const c = findHighlights(words)
    expect(c.length).toBeGreaterThan(0)
    for (const h of c) {
      expect(h.end - h.start).toBeGreaterThanOrEqual(15)
      expect(h.end - h.start).toBeLessThanOrEqual(60)
      expect(h.text).toBe(words.slice(h.from, h.to).map((x) => x.text).join(' '))
      expect(sentences(words).some((s) => s.from === h.from)).toBe(true)
    }
    for (let i = 1; i < c.length; i++) expect(c[i].score).toBeLessThanOrEqual(c[i - 1].score)
    expect(c[0].start).toBeGreaterThanOrEqual(cleanStart - 1e-6)
    expect(c[0].end).toBeLessThanOrEqual(cleanEnd + 1e-6)
    expect(c[0].parts.fillers).toBe(1)
    expect(c[0].parts.completeness).toBe(1)
  })

  it('is deterministic and keeps candidates apart', () => {
    const a = findHighlights(words)
    expect(findHighlights(words)).toEqual(a)
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) {
      const inter = Math.max(0, Math.min(a[i].end, a[j].end) - Math.max(a[i].start, a[j].start))
      expect(inter / Math.min(a[i].end - a[i].start, a[j].end - a[j].start)).toBeLessThanOrEqual(0.3 + 1e-9)
    }
  })

  it('a transcript shorter than 15 s has no candidates', () => {
    expect(findHighlights(words.slice(0, 20))).toEqual([])
  })
})

describe('auto-reframe planner', () => {
  const SRC = { srcW: 1920, srcH: 1080 }
  const fps = 30

  it('crop sizes for each target', () => {
    expect(cropSize(1920, 1080, '9:16').w).toBeCloseTo((9 / 16) / (16 / 9), 9)
    expect(cropSize(1920, 1080, '9:16').h).toBe(1)
    expect(cropSize(1920, 1080, '1:1').w).toBeCloseTo(0.5625, 9)
    expect(cropSize(1080, 1920, '1:1')).toEqual({ w: 1, h: 0.5625 })
  })

  it('offsets match footageRect: the crop centre lands in the middle of the output frame', () => {
    for (const target of ['9:16', '4:5', '1:1'] as const) {
      const W = 1080
      const H = target === '9:16' ? 1920 : target === '4:5' ? 1350 : 1080
      for (const cx of [0.3, 0.5, 0.7]) {
        const { offX, offY } = offsetsFor(cx, 0.5, 1920, 1080, target)
        const r = footageRect(1920, 1080, W, H, { fit: 'fill', scale: 1, offX, offY })
        expect(r.dx + cx * r.dw).toBeCloseTo(W / 2, 6)
        expect(r.dy + 0.5 * r.dh).toBeCloseTo(H / 2, 6)
      }
    }
  })

  // a face (0.08 × 0.15 of the frame) walking left → right and back over 10 s, detections jittered ±0.01,
  // and missing for half a second in the middle
  const frames: SubjectFrame[] = []
  for (let i = 0; i <= 10 * fps; i++) {
    const t = i / fps
    const cx = 0.5 + 0.38 * Math.sin((2 * Math.PI * t) / 10)
    const j = (((i * 7919) % 21) - 10) / 1000
    frames.push({ t, box: t > 5 && t < 5.5 ? null : { x: cx - 0.04 + j, y: 0.3, w: 0.08, h: 0.15 } })
  }

  for (const target of ['9:16', '4:5', '1:1'] as const) {
    it(`keeps the moving face inside the ${target} frame on every frame`, () => {
      const p = planReframe(frames, { ...SRC, target })
      expect(p.insideRatio).toBe(1)
      for (const pt of p.path) {
        expect(pt.cx).toBeGreaterThanOrEqual(p.cropW / 2 - 1e-9)
        expect(pt.cx).toBeLessThanOrEqual(1 - p.cropW / 2 + 1e-9)
      }
    })
  }

  it('pans no faster than the limit when the subject allows it, and keyframes reproduce the path', () => {
    const p = planReframe(frames, { ...SRC, target: '9:16', maxSpeed: 1 }) // the face peaks at 0.24 source widths/s = 0.76 crop widths/s
    expect(p.fastMoves).toBe(0)
    for (let i = 1; i < p.path.length; i++) {
      const v = Math.abs(p.path[i].cx - p.path[i - 1].cx) / (p.path[i].t - p.path[i - 1].t)
      expect(v).toBeLessThanOrEqual(1 * p.cropW + 1e-6)
    }
    expect(p.keyframes.offX.length).toBeLessThan(p.path.length / 3)
    expect(p.keyframes.offX[0]).toMatchObject({ t: 0, ease: 'linear' })
    for (const pt of p.path) expect(Math.abs(valueAt(p.keyframes.offX, pt.t) - offsetsFor(pt.cx, pt.cy, 1920, 1080, '9:16').offX)).toBeLessThanOrEqual(0.0025)
    expect(p.clip).toEqual({ fit: 'fill', scale: 1 })
  })

  it('a jittering but still subject does not move the camera (dead zone)', () => {
    const still: SubjectFrame[] = Array.from({ length: 150 }, (_, i) => ({ t: i / fps, box: { x: 0.6 + (((i * 31) % 7) - 3) / 300, y: 0.3, w: 0.08, h: 0.15 } }))
    const p = planReframe(still, { ...SRC, target: '9:16' })
    const xs = p.path.map((q) => q.cx)
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1e-9)
    expect(p.keyframes.offX).toHaveLength(2)
  })

  it('a subject faster than the pan limit is still kept in frame (counted as fast moves)', () => {
    const fast: SubjectFrame[] = Array.from({ length: 60 }, (_, i) => ({ t: i / fps, box: { x: i < 30 ? 0.1 : 0.82, y: 0.4, w: 0.08, h: 0.15 } }))
    const p = planReframe(fast, { ...SRC, target: '9:16', maxSpeed: 0.3 })
    expect(p.insideRatio).toBe(1)
    expect(p.fastMoves).toBeGreaterThan(0)
  })

  it('with no detections at all the crop stays centred', () => {
    const p = planReframe([{ t: 0, box: null }, { t: 1, box: null }], { ...SRC, target: '1:1' })
    expect(p.path.every((q) => q.cx === 0.5)).toBe(true)
    expect(p.insideRatio).toBe(1)
  })

  it('keyframe times are clip-relative when clipIn is given', () => {
    const p = planReframe(frames.map((f) => ({ ...f, t: f.t + 12 })), { ...SRC, target: '9:16', clipIn: 12 })
    expect(p.keyframes.offX[0].t).toBe(0)
    expect(planReframe(frames.map((f) => ({ ...f, t: f.t + 12 })), { ...SRC, target: '9:16' }).keyframes.offX[0].t).toBe(12)
  })
})
