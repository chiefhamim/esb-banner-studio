// Phase 4 - Part A: the audio model (sanitisers, defaults, edits), the pure gain rules of the shared graph, the
// streaming meters and the store actions. The graph itself (Web Audio) is exercised in the browser by
// tools/e2e/video-audio-test.mjs.
import { describe, expect, it } from 'vitest'
import { createDefaultTimeline, deserializeVideoProject, serializeVideoProject, audibleClips } from '../../src/video/timeline'
import type { Clip, VideoProject } from '../../src/video/timeline'
import { busOf, fitFades, sanitizeClipAudio, sanitizeDucking, sanitizeMaster, sanitizeProjectAudio, sanitizeTrackAudio, trackLevel, denoiseKey } from '../../src/video/audioModel'
import { applyBeatMarkers, beatProposal, proposalTimes, updateClipAudio, updateProjectAudio, updateTrackAudio } from '../../src/video/audioEdit'
import { clipGainFn, sampleCurve } from '../../src/video/engine/audioGraph'
import { VoiceLevels, duckFromLevels, duckingCurve } from '../../src/video/audio/ducking'
import { StreamMeter } from '../../src/video/audio/streamMeter'
import { measureLoudness } from '../../src/video/audio/loudness'
import { denoiseOptionsFor } from '../../src/video/engine/denoiseJob'
import { useVideoStore } from '../../src/video/videoStore'
import { noise, sine } from './audio-fixtures'

const SR = 48000
const clip = (o: Partial<Clip> = {}): Clip => ({ id: 'a', trackId: 'a1', kind: 'audio', title: 'a', start: 0, duration: 4, in: 0, out: 4, color: '#000', sourceUrl: 'blob:x', ...o })
const proj = (clips: Clip[] = [clip()]): VideoProject => ({ ...createDefaultTimeline(), clips })

describe('audio model sanitisers (hostile input)', () => {
  it('drops wrong types, NaN, Infinity and unknown names; clamps ranges', () => {
    const hostile = { gain: 'loud', fadeIn: { dur: NaN, curve: 'x' }, fadeOut: { dur: Infinity }, pan: 9, denoise: { amount: -1 } }
    expect(sanitizeClipAudio(hostile)).toEqual({ pan: 1 })
    expect(sanitizeClipAudio({ gain: 1e9, pan: -5, fadeIn: { dur: 2, curve: 'nope' }, denoise: { amount: 7, noiseRange: [3, 1] } })).toEqual({ gain: 24, pan: -1, fadeIn: { dur: 2, curve: 'equal-power' }, denoise: { amount: 1 } })
    expect(sanitizeClipAudio({ denoise: { amount: 0.5, noiseRange: [1, 2] } }).denoise).toEqual({ amount: 0.5, noiseRange: [1, 2] })
    expect(sanitizeTrackAudio({ bus: 'master', volume: NaN, pan: '1', solo: 'yes' })).toEqual({})
    expect(sanitizeTrackAudio({ bus: 'voice', volume: -90, solo: true })).toEqual({ bus: 'voice', volume: -60, solo: true })
    expect(sanitizeMaster({ gain: Infinity, limiter: 1 })).toBeUndefined()
    expect(sanitizeMaster({ gain: -3, limiter: true })).toEqual({ gain: -3, limiter: true })
    expect(sanitizeDucking({ enabled: true, depthDb: -400, threshold: 'x', attack: 0, release: 99 })).toEqual({ enabled: true, source: 'voice', target: 'music', depthDb: 40, threshold: -40, attack: 0.001, release: 10 })
    expect(sanitizeDucking({ enabled: false })).toBeUndefined()
    expect(sanitizeProjectAudio({ master: 5, ducking: [], loudnessTarget: -15, busVolume: { voice: 'a', music: -6, junk: 3 } })).toEqual({ busVolume: { music: -6 } })
    expect(sanitizeProjectAudio({ loudnessTarget: -16 })).toEqual({ loudnessTarget: -16 })
  })

  it('a file with hostile audio fields opens cleanly; an old project is unchanged', () => {
    const old = proj([clip({ volume: 0.5 })])
    const text = serializeVideoProject(old)
    const back = deserializeVideoProject(text)!
    expect(back.master).toBeUndefined(); expect(back.ducking).toBeUndefined(); expect(back.loudnessTarget).toBeUndefined()
    expect(back.clips[0].gain).toBeUndefined(); expect(back.tracks.every((t) => t.bus === undefined && t.solo === undefined && t.volume === undefined)).toBe(true)
    const j = JSON.parse(text)
    j.master = { gain: 'x', limiter: 'y' }; j.ducking = 'no'; j.loudnessTarget = -999; j.busVolume = []
    const ai = j.tracks.findIndex((t: { kind: string }) => t.kind === 'audio')
    j.tracks[ai].bus = 'evil'; j.tracks[ai].volume = null; j.tracks[ai].solo = 'true'
    j.clips[0].gain = null; j.clips[0].fadeIn = { dur: -3 }; j.clips[0].denoise = 5; j.clips[0].pan = 'left'
    const hard = deserializeVideoProject(JSON.stringify(j))!
    expect(hard.master).toBeUndefined(); expect(hard.ducking).toBeUndefined(); expect(hard.loudnessTarget).toBeUndefined(); expect(hard.busVolume).toBeUndefined()
    expect(hard.tracks[ai].bus).toBeUndefined(); expect(hard.clips[0].gain).toBeUndefined(); expect(hard.clips[0].denoise).toBeUndefined(); expect(hard.clips[0].pan).toBeUndefined()
  })

  it('the Phase 4 fields round-trip through a file', () => {
    let p = proj([clip({ gain: -6, pan: 0.25, fadeIn: { dur: 1, curve: 'log' }, denoise: { amount: 0.6, noiseRange: [0, 0.5] } })])
    p = updateTrackAudio(p, 'a1', { bus: 'music', volume: -3, pan: -0.5, solo: true })
    p = updateProjectAudio(p, { master: { gain: -2, limiter: true }, ducking: { enabled: true, depthDb: 9 }, loudnessTarget: -14, busVolume: { music: -4 } })
    const back = deserializeVideoProject(serializeVideoProject(p))!
    expect(back.clips[0]).toMatchObject({ gain: -6, pan: 0.25, fadeIn: { dur: 1, curve: 'log' }, denoise: { amount: 0.6, noiseRange: [0, 0.5] } })
    expect(back.tracks.find((t) => t.id === 'a1')).toMatchObject({ bus: 'music', volume: -3, pan: -0.5, solo: true })
    expect(back.master).toEqual({ gain: -2, limiter: true }); expect(back.loudnessTarget).toBe(-14); expect(back.busVolume).toEqual({ music: -4 })
    expect(back.ducking).toMatchObject({ enabled: true, depthDb: 9 })
  })
})

describe('buses, mute, solo', () => {
  it('a footage clip own sound defaults to voice, other audio to music; a track bus wins', () => {
    const v: Clip = { ...clip({ id: 'v', trackId: 'v1', kind: 'video', linkId: 'L' }), sourceUrl: 'blob:v' }
    const p = proj([v, clip({ id: 'own', linkId: 'L' }), clip({ id: 'song' })])
    expect(busOf(p, p.clips[1])).toBe('voice'); expect(busOf(p, p.clips[2])).toBe('music')
    const q = updateTrackAudio(p, 'a1', { bus: 'fx' })
    expect(busOf(q, q.clips[1])).toBe('fx'); expect(busOf(q, q.clips[2])).toBe('fx')
  })
  it('solo silences the other audio tracks; mute and track fader set the track level', () => {
    let p = proj([clip({ id: 'x' }), clip({ id: 'y', trackId: 'a2' })])
    p = { ...p, tracks: [...p.tracks, { id: 'a2', name: 'A2', kind: 'audio', muted: false, locked: false }] }
    expect(audibleClips(p).map((c) => c.id)).toEqual(['x', 'y'])
    const s = updateTrackAudio(p, 'a2', { solo: true })
    expect(audibleClips(s).map((c) => c.id)).toEqual(['y'])
    expect(trackLevel(s, s.tracks.find((t) => t.id === 'a1'))).toBe(0)
    expect(trackLevel(s, s.tracks.find((t) => t.id === 'a2'))).toBe(1)
    const m = updateTrackAudio(updateTrackAudio(p, 'a1', { muted: true }), 'a2', { volume: -6 })
    expect(audibleClips(m).map((c) => c.id)).toEqual(['y'])
    expect(trackLevel(m, m.tracks.find((t) => t.id === 'a2'))).toBeCloseTo(0.501, 3)
  })
  it('an edit that changes nothing returns the same project (no undo step)', () => {
    const p = proj()
    expect(updateClipAudio(p, 'a', { gain: 0 })).toBe(p)
    expect(updateClipAudio(p, 'a', { gain: NaN })).toBe(p)
    expect(updateTrackAudio(p, 'a1', { volume: 0 })).toBe(p)
    expect(updateProjectAudio(p, { master: { gain: 0 } })).toBe(p)
    expect(updateClipAudio(p, 'a', { gain: 3 })).not.toBe(p)
  })
})

describe('clip gain function: fades and gain at sampled times', () => {
  it('linear fade-in is t/dur, equal-power is sin, log is dB-linear, fade-out mirrors', () => {
    const lin = clipGainFn(clip({ fadeIn: { dur: 2, curve: 'linear' }, fadeOut: { dur: 1, curve: 'linear' } }))
    expect(lin.at(0)).toBe(0); expect(lin.at(0.5)).toBeCloseTo(0.25, 6); expect(lin.at(1)).toBeCloseTo(0.5, 6); expect(lin.at(2)).toBeCloseTo(1, 6)
    expect(lin.at(3.5)).toBeCloseTo(0.5, 6); expect(lin.at(4)).toBe(0)
    const ep = clipGainFn(clip({ fadeIn: { dur: 2, curve: 'equal-power' } }))
    expect(ep.at(1)).toBeCloseTo(Math.sin(Math.PI / 4), 6)
    expect(20 * Math.log10(ep.at(1))).toBeCloseTo(-3.01, 2)
    const lg = clipGainFn(clip({ fadeOut: { dur: 2, curve: 'log' } }))
    expect(20 * Math.log10(lg.at(3))).toBeCloseTo(-30, 4) // halfway through a log fade is -30 dB
    expect(lg.at(1.9)).toBe(1)
  })
  it('gain (dB) multiplies volume; mute is zero; fades are scaled to fit a short clip; ranges cover only the fades', () => {
    const g = clipGainFn(clip({ gain: -6.0206, volume: 0.5 }))
    expect(g.at(1)).toBeCloseTo(0.25, 3); expect(g.ranges).toEqual([])
    expect(clipGainFn(clip({ muted: true })).at(1)).toBe(0)
    const f = fitFades({ duration: 2, fadeIn: { dur: 3, curve: 'linear' }, fadeOut: { dur: 1, curve: 'linear' } })
    expect(f.inDur + f.outDur).toBeCloseTo(2, 9)
    expect(clipGainFn(clip({ start: 10, fadeIn: { dur: 1, curve: 'linear' } })).ranges).toEqual([[10, 11]])
  })
  it('volume keyframes are followed (and the whole clip is a curve range)', () => {
    const g = clipGainFn(clip({ keyframes: { volume: [{ t: 0, v: 1 }, { t: 2, v: 0 }] } }))
    expect(g.ranges).toEqual([[0, 4]]); expect(g.at(1)).toBeCloseTo(0.5, 2)
    const c = sampleCurve(g.at, 0, 2)
    expect(c.length).toBe(201); expect(c[0]).toBeCloseTo(1, 6); expect(c[200]).toBeCloseTo(0, 6)
  })
})

describe('streaming levels and meter', () => {
  it('VoiceLevels in any piece size equals duckingCurve over the whole signal', () => {
    const x = noise(SR * 3 + 777, 0.05, 3)
    for (let i = SR; i < SR * 2; i++) x[i] *= 6
    const whole = duckingCurve([x, x], SR, { depth: 12 })
    for (const piece of [SR, 4800, 12345, SR * 3 + 777]) {
      const v = new VoiceLevels(SR)
      for (let o = 0; o < x.length; o += piece) { const s = x.subarray(o, Math.min(x.length, o + piece)); v.push([s, s]) }
      const c = duckFromLevels(v.finish(), { depth: 12 })
      expect(c.gainDb.length).toBe(whole.gainDb.length)
      let worst = 0
      for (let i = 0; i < c.gainDb.length; i++) worst = Math.max(worst, Math.abs(c.gainDb[i] - whole.gainDb[i]))
      expect(worst).toBeLessThan(1e-4)
    }
  })
  it('StreamMeter matches the whole-signal meter however the signal is cut', () => {
    const n = SR * 12 + 1234
    const l = noise(n, 0.1, 5)
    const r = sine(n, SR, 330, 0.2)
    for (let i = 0; i < SR * 4; i++) { l[i] *= 0.1; r[i] *= 0.1 }
    const whole = measureLoudness([l, r], SR)
    for (const piece of [SR * 10, 4800, 33333]) {
      const m = new StreamMeter(SR, 2)
      for (let o = 0; o < n; o += piece) m.push([l.subarray(o, Math.min(n, o + piece)), r.subarray(o, Math.min(n, o + piece))])
      const rep = m.report()
      expect(Math.abs(rep.integrated - whole.integrated)).toBeLessThan(0.01)
      expect(Math.abs(rep.range - whole.range)).toBeLessThan(0.05)
      expect(Math.abs(rep.truePeak - whole.truePeak)).toBeLessThan(0.1)
      expect(rep.momentary.length).toBe(Math.floor(n / 4800))
    }
  })
})

describe('noise-reduction settings and cache key', () => {
  it('a stronger amount lowers the floor and raises the over-estimate; the key ignores gain, fades and pan', () => {
    const a = denoiseOptionsFor({ amount: 0.2 }); const b = denoiseOptionsFor({ amount: 1 })
    expect(b.reduction!).toBeGreaterThan(a.reduction!); expect(b.strength!).toBeGreaterThan(a.strength!)
    expect(denoiseOptionsFor({ amount: 0.5, noiseRange: [1, 2] }).noiseRange).toEqual([1, 2])
    const base = clip({ denoise: { amount: 0.5 } })
    expect(denoiseKey({ ...base, gain: 6, pan: 1, fadeIn: { dur: 1, curve: 'log' } })).toBe(denoiseKey(base))
    expect(denoiseKey({ ...base, speed: 2 })).not.toBe(denoiseKey(base))
    expect(denoiseKey(clip())).toBeNull()
  })
})

describe('beat proposals', () => {
  it('a proposal is mapped to the timeline, applies as one edit, skips duplicates and names nothing', () => {
    const pr = beatProposal({ clipId: 'a', clipStart: 10, clipDuration: 4, tempo: { bpm: 120, confidence: 0.9 }, onsets: [{ t: 0.5, strength: 1 }, { t: 1, strength: 3 }, { t: 9, strength: 9 }], beats: [0, 0.5, 1, 1.5, 7] })
    // Phase 4 fix: clip-relative times; they become timeline times when applied against the clip as it is then
    expect(pr).toMatchObject({ kind: 'proposal', applied: false, beats: [0, 0.5, 1, 1.5] })
    expect(pr.onsets.map((o) => o.t)).toEqual([0.5, 1])
    expect(proposalTimes(pr, 'onsets', 1)).toEqual([1])
    const p = proj()
    const abs = proposalTimes(pr).map((t) => 10 + t)
    const out = applyBeatMarkers(applyBeatMarkers(p, abs, 's'), abs, 't')
    expect(out.markers!.map((m) => m.t)).toEqual([10, 10.5, 11, 11.5]); expect(out.markers!.every((m) => m.name === '')).toBe(true)
  })
})

describe('store actions: one undo step per gesture', () => {
  it('a drag of the clip gain is a single undo step; setters clean their values', () => {
    const st = useVideoStore.getState()
    st.loadProject(proj([clip()]))
    const h0 = useVideoStore.getState().history.length
    st.beginGesture()
    for (const db of [1, 2, 3, 4, 5]) useVideoStore.getState().setClipGain('a', db)
    st.endGesture()
    expect(useVideoStore.getState().project.clips[0].gain).toBe(5)
    expect(useVideoStore.getState().history.length).toBe(h0 + 1)
    useVideoStore.getState().undo()
    expect(useVideoStore.getState().project.clips[0].gain).toBeUndefined()
    useVideoStore.getState().setClipGain('a', 999)
    expect(useVideoStore.getState().project.clips[0].gain).toBe(24)
    useVideoStore.getState().setClipFade('a', 'in', { dur: 1, curve: 'log' })
    useVideoStore.getState().setTrackSolo('a1', true)
    useVideoStore.getState().setDucking({ enabled: true, depthDb: 10 })
    useVideoStore.getState().setLoudnessTarget(-16)
    useVideoStore.getState().setMaster({ limiter: true })
    useVideoStore.getState().setBusVolume('music', -5)
    const p = useVideoStore.getState().project
    expect(p.clips[0].fadeIn).toEqual({ dur: 1, curve: 'log' }); expect(p.tracks.find((t) => t.id === 'a1')!.solo).toBe(true)
    expect(p.ducking?.enabled).toBe(true); expect(p.loudnessTarget).toBe(-16); expect(p.master?.limiter).toBe(true); expect(p.busVolume).toEqual({ music: -5 })
    const h = useVideoStore.getState().history.length
    useVideoStore.getState().setLoudnessTarget(-16) // unchanged: no step
    expect(useVideoStore.getState().history.length).toBe(h)
    useVideoStore.getState().setLoudnessTarget(null)
    expect(useVideoStore.getState().project.loudnessTarget).toBeUndefined()
  })
})
