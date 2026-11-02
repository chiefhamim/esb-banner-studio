// Phase 4 fix round (logic / engine / security / perf): one test group per review item.
import { describe, expect, it } from 'vitest'
import { createDefaultTimeline, flattenCompounds, audibleClips, splitClip, subClip, rippleTrim, slipClip, clearRange, deserializeVideoProject, serializeVideoProject, clipsForAsset, unlinkClip, deleteClip } from '../../src/video/timeline'
import type { Clip, Track, VideoProject } from '../../src/video/timeline'
import { busOf, trackLevel, soloActive, sanitizeDenoise, rebaseDenoise } from '../../src/video/audioModel'
import { updateClipAudio, applyProposal, beatProposal, clipPlacementKey, proposalProblem } from '../../src/video/audioEdit'
import { StreamMeter } from '../../src/video/audio/streamMeter'
import { interpolator, measureLoudness, truePeakEnvelope, truePeakEnvelopeGated } from '../../src/video/audio/loudness'
import { denoise } from '../../src/video/audio/denoise'
import { crossfadeBlocker } from '../../src/video/audioAdapter'
import { voiceoverPlacement } from '../../src/video/voiceover'
import { useVideoStore } from '../../src/video/videoStore'
import { noise, sine } from './audio-fixtures'

const SR = 48000
const clip = (o: Partial<Clip> = {}): Clip => ({ id: 'a', trackId: 'a1', kind: 'audio', title: 'a', start: 0, duration: 10, in: 0, out: 10, color: '#000', sourceUrl: 'blob:x', srcDuration: 60, ...o })
const proj = (clips: Clip[] = [clip()]): VideoProject => ({ ...createDefaultTimeline(), clips })

describe('C1 fades at a cut', () => {
  const c = clip({ fadeIn: { dur: 1, curve: 'linear' }, fadeOut: { dur: 2, curve: 'linear' } })
  it('split: half A keeps the fade-in, half B the fade-out', () => {
    const [a, b] = splitClip(proj([c]), 'a', 4).clips
    expect(a.fadeIn).toBeTruthy(); expect(a.fadeOut).toBeUndefined()
    expect(b.fadeIn).toBeUndefined(); expect(b.fadeOut).toBeTruthy()
  })
  it('extract / clearRange keeps true ends only; trims keep the edge fades; slip keeps both', () => {
    const out = clearRange(proj([c]), 3, 6, ['a1']).clips
    expect(out[0].fadeOut).toBeUndefined(); expect(out[0].fadeIn).toBeTruthy()
    expect(out[1].fadeIn).toBeUndefined(); expect(out[1].fadeOut).toBeTruthy()
    const t = rippleTrim(proj([c]), 'a', 'right', -2).clips[0]
    expect(t.fadeIn && t.fadeOut).toBeTruthy()
    const s = slipClip(proj([c]), 'a', 3).clips[0]
    expect(s.fadeIn && s.fadeOut).toBeTruthy()
    expect(subClip(c, 2, 10).fadeIn).toBeUndefined()
  })
})

describe('C2 project-level audio edits inside a compound', () => {
  it('master / ducking / target / bus volume land on the root project', () => {
    const st = useVideoStore.getState()
    const inner = clip({ id: 'in1' })
    const root: VideoProject = { ...createDefaultTimeline(), clips: [{ id: 'X', trackId: 'v1', kind: 'video', title: 'X', start: 0, duration: 10, in: 0, out: 10, color: '#000', compound: { tracks: createDefaultTimeline().tracks, clips: [inner] } }] }
    st.loadProject(root)
    useVideoStore.setState({ compoundPath: ['X'] })
    st.setMaster({ gain: -3 }); st.setLoudnessTarget(-14); st.setBusVolume('music', -6); st.setDucking({ enabled: true })
    const p = useVideoStore.getState().project
    expect(p.master?.gain).toBe(-3); expect(p.loudnessTarget).toBe(-14); expect(p.busVolume?.music).toBe(-6); expect(p.ducking?.enabled).toBe(true)
    useVideoStore.setState({ compoundPath: [] })
  })
})

describe('C3 footage sound stays voice', () => {
  it('is voice from creation, through unlink and deleting the picture, and for old projects once on load', () => {
    const asset = { id: 'm', name: 'f.mp4', type: 'video' as const, url: 'blob:v', duration: 5, hasAudio: true, size: 1 }
    const p0 = proj([])
    const [v, a] = clipsForAsset(p0, asset, 0, 'auto', 's1')
    expect(a.bus).toBe('voice')
    let p = { ...p0, clips: [v, a] }
    p = unlinkClip(p, v.id)
    expect(busOf(p, p.clips.find((c) => c.kind === 'audio')!)).toBe('voice')
    p = deleteClip(p, v.id)
    expect(busOf(p, p.clips[0])).toBe('voice')
    const old = proj([{ ...v, sourceUrl: undefined }, { ...a, bus: undefined, sourceUrl: undefined }])
    const back = deserializeVideoProject(serializeVideoProject(old))!
    expect(back.clips.find((c) => c.kind === 'audio')!.bus).toBe('voice')
  })
})

describe('C4 noise sample follows the sound', () => {
  const dn = { amount: 0.6, noiseRange: [1, 2] as [number, number] }
  it('split re-bases it; a range cut away is dropped with a note', () => {
    const [a, b] = splitClip(proj([clip({ denoise: dn })]), 'a', 5).clips
    expect(a.denoise!.noiseRange).toEqual([1, 2])
    expect(b.denoise!.noiseRange).toBeUndefined(); expect(b.denoise!.noiseDropped).toBe(true)
    const [, b2] = splitClip(proj([clip({ denoise: { amount: 0.6, noiseRange: [6, 8] } })]), 'a', 5).clips
    expect(b2.denoise!.noiseRange).toEqual([1, 3])
  })
  it('slip moves it; amount 0 keeps it', () => {
    const s = slipClip(proj([clip({ denoise: { amount: 0.5, noiseRange: [3, 5] } })]), 'a', 1).clips[0]
    expect(s.denoise!.noiseRange).toEqual([2, 4])
    const z = updateClipAudio(proj([clip({ denoise: dn })]), 'a', { denoise: { amount: 0 } }).clips[0]
    expect(z.denoise).toEqual({ amount: 0, noiseRange: [1, 2] })
    expect(sanitizeDenoise({ amount: 0 })).toBeUndefined()
    expect(rebaseDenoise({ amount: 0, noiseRange: [1, 1.05] }, 0, 10)).toBeUndefined()
  })
})

describe('C5 solo / mute / compound', () => {
  const T = (o: Partial<Track>): Track => ({ id: 't', name: 't', kind: 'audio', muted: false, locked: false, ...o })
  it('mute beats solo; solo silences the rest', () => {
    const tracks = [T({ id: 'a1', solo: true, muted: true }), T({ id: 'a2' })]
    expect(soloActive({ tracks })).toBe(true)
    expect(trackLevel({ tracks }, tracks[0])).toBe(0); expect(trackLevel({ tracks }, tracks[1])).toBe(0)
    const tr2 = [T({ id: 'a1', solo: true }), T({ id: 'a2' })]
    expect(trackLevel({ tracks: tr2 }, tr2[0])).toBe(1); expect(trackLevel({ tracks: tr2 }, tr2[1])).toBe(0)
  })
  it('solo inside a compound is scoped; the outer track params apply to the inside', () => {
    const base = createDefaultTimeline()
    const inTracks: Track[] = [T({ id: 'a1', solo: true }), T({ id: 'a2' })]
    const X: Clip = { id: 'X', trackId: 'a1', kind: 'audio', title: 'X', start: 0, duration: 10, in: 0, out: 10, color: '#000', compound: { tracks: inTracks, clips: [clip({ id: 'i1', trackId: 'a1' }), clip({ id: 'i2', trackId: 'a2' })] } }
    const root: VideoProject = { ...base, tracks: [...base.tracks.filter((t) => t.id !== 'a1'), T({ id: 'a1', volume: -6, pan: 0.5, bus: 'fx' }), T({ id: 'a9' })], clips: [X, clip({ id: 'o1', trackId: 'a9' })] }
    const flat = flattenCompounds(root)
    expect(flat.tracks.some((t) => t.solo)).toBe(false)
    expect(audibleClips(flat).map((c) => c.id).sort()).toEqual(['X/i1', 'o1'])
    const t1 = flat.tracks.find((t) => t.id === 'X/a1')!
    expect([t1.volume, t1.pan, t1.bus]).toEqual([-6, 0.5, 'fx'])
  })
})

describe('C6 short mixes and hostile samples', () => {
  it('a 300 ms mix is measured (ungated, flagged), not silent', () => {
    const x = sine(Math.round(0.3 * SR), SR, 1000, 0.3)
    const m = new StreamMeter(SR, 1); m.push([x])
    const r = m.report()
    expect(Number.isFinite(r.integrated)).toBe(true); expect(r.shortMix).toBe(true)
  })
  it('NaN / Infinity samples are measured as 0 and counted', () => {
    const x = sine(2 * SR, SR, 1000, 0.3); x[100] = NaN; x[200] = Infinity; x[300] = -Infinity
    const m = new StreamMeter(SR, 1); m.push([x])
    const r = m.report()
    expect(Number.isFinite(r.integrated)).toBe(true); expect(r.nonFinite).toBe(3); expect(Number.isFinite(r.truePeak)).toBe(true)
  })
})

describe('P1/P2 meter speed-ups keep the numbers', () => {
  it('sparse true peak equals the exact one on noise and on a hot sine; chunking does not matter', () => {
    const n = noise(20 * SR, 0.4)
    for (const x of [n, sine(5 * SR, SR, 997, 0.95)]) {
      const exact = new StreamMeter(SR, 1, { exactTruePeak: true }); exact.push([x])
      const fast = new StreamMeter(SR, 1)
      const B = Math.round(48000 * 1.7)
      for (let a = 0; a < x.length; a += B) fast.push([x.subarray(a, a + B)])
      expect(fast.report().truePeak).toBeCloseTo(exact.report().truePeak, 2)
      expect(fast.report().integrated).toBeCloseTo(measureLoudness([x], SR, { truePeak: false }).integrated, 3)
    }
  })
  it('the gated envelope equals the full one wherever it is over the gate', () => {
    // band-limited material (a 4-sample moving average of noise): the 3 dB over-the-neighbours rule the gate relies on holds
    const raw = noise(4 * SR, 0.8)
    const x = new Float32Array(raw.length)
    for (let i = 3; i < raw.length; i++) x[i] = (raw[i] + raw[i - 1] + raw[i - 2] + raw[i - 3]) / 4
    const ph = interpolator(64, 1, 10)
    const full = truePeakEnvelope(x, ph)
    const gated = truePeakEnvelopeGated(x, 0.25, ph)
    for (let i = 0; i < x.length; i++) if (full[i] > 0.5) expect(gated[i]).toBeCloseTo(full[i], 6)
  })
  it('streaming denoise keeps the length and lowers stationary noise (ring overlap-add)', () => {
    const n = noise(3 * SR, 0.05)
    const out = denoise([n], SR, { reduction: 20 })
    expect(out[0].length).toBe(n.length)
    let a = 0
    let b = 0
    for (let i = 0; i < n.length; i++) { a += n[i] * n[i]; b += out[0][i] * out[0][i] }
    expect(b).toBeLessThan(a * 0.2)
  })
})

describe('C7 voiceover placement', () => {
  it('moves the take earlier by the playback lag and the mic latency, with a user offset; trims before 0', () => {
    expect(voiceoverPlacement({ at: 5, recStartMs: 1000, playStartMs: 1150, micLatencyS: 0.05, offsetMs: 0 })).toMatchObject({ trim: 0, latencyMs: 200 })
    expect(voiceoverPlacement({ at: 5, recStartMs: 1000, playStartMs: 1150, micLatencyS: 0.05, offsetMs: 0 }).start).toBeCloseTo(4.8, 6)
    expect(voiceoverPlacement({ at: 5, recStartMs: 1000, playStartMs: 1150, micLatencyS: 0.05, offsetMs: 100 }).start).toBeCloseTo(4.9, 6)
    const z = voiceoverPlacement({ at: 0, recStartMs: 1000, playStartMs: 1300, micLatencyS: 0, offsetMs: 0 })
    expect(z.start).toBe(0); expect(z.trim).toBeCloseTo(0.3, 6)
    expect(voiceoverPlacement({ at: 3, recStartMs: 0, playStartMs: null, micLatencyS: 0.1, offsetMs: 50 }).start).toBe(3)
  })
})

describe('C9 crossfade refusals', () => {
  it('reversed, frozen and speed-ramped clips are refused with a reason', () => {
    expect(crossfadeBlocker(clip({ reverse: true }))).toMatch(/backwards/)
    expect(crossfadeBlocker(clip({ freezes: [{ at: 1, dur: 1 }] }))).toMatch(/freeze/)
    expect(crossfadeBlocker(clip({ speed: 2 }))).toMatch(/speed/)
    expect(crossfadeBlocker(clip())).toBeNull()
  })
})

describe('C10 beat proposal is clip-relative', () => {
  it('follows a moved clip; refused when the clip was edited', () => {
    const c = clip({ start: 10, duration: 4 })
    const pr = beatProposal({ clipId: 'a', clipStart: 10, clipDuration: 4, clipKey: clipPlacementKey(c), onsets: [], beats: [0, 1], tempo: null })
    const moved = proj([{ ...c, start: 30 }])
    expect(applyProposal(moved, pr).markers!.map((m) => m.t)).toEqual([30, 31])
    const edited = proj([{ ...c, duration: 3, out: 3 }])
    expect(proposalProblem(edited, pr)).toMatch(/edited/)
    expect(applyProposal(edited, pr)).toBe(edited)
  })
})

describe('C12 / P5 store: coalesced audio steps and no-op writes', () => {
  it('keyboard steps on a clip are one undo step; an unchanged write leaves no step', () => {
    const st = useVideoStore.getState()
    st.loadProject(proj([clip()]))
    const h0 = useVideoStore.getState().history.length
    for (const g of [1, 2, 3, 4]) useVideoStore.getState().patchClipAudioCoalesced('a', { gain: g })
    expect(useVideoStore.getState().history.length).toBe(h0 + 1)
    expect(useVideoStore.getState().project.clips[0].gain).toBe(4)
    const before = useVideoStore.getState().project
    useVideoStore.getState().patchClipAudio('a', { gain: 4 })
    expect(useVideoStore.getState().project).toBe(before)
  })
})

describe('S2 media asset text fields', () => {
  it('licence and musicRel are strings and capped; other types are dropped', () => {
    const text = JSON.stringify({ ...proj([]), mediaAssets: [{ id: 'a', name: 'a', type: 'audio', url: '', duration: 1, size: 1, licence: 'x'.repeat(2000), musicRel: { evil: 1 } }] })
    const back = deserializeVideoProject(text)!
    expect(back.mediaAssets[0].licence!.length).toBe(600); expect(back.mediaAssets[0].musicRel).toBeUndefined()
  })
})
