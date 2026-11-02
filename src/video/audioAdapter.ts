// The audio UI's only door to Phase 4 Part A (the audio graph, clip/track/bus/master parameters, ducking, loudness).
// Part A lives in another branch, so every call here is guarded: when a piece is present the UI uses it; when it is not,
// the controls are disabled and say "engine pending". Nothing here pretends to work: no fake meters, no stored-but-
// ignored parameter, no invented loudness.
//
// What Part A is expected to provide (names are this adapter's contract; change them here only):
//   Clip params   gain (dB), fadeIn / fadeOut {dur, curve}, pan (-1..1), denoise {amount, noiseRange?}
//   Track params  bus 'voice'|'music'|'fx'|'none', volume (dB), pan, mute (= Track.muted), solo
//   Project       master {gain (dB), limiter}, ducking {enabled, depthDb, threshold, attack, release}, loudnessTarget
//   Store actions setClipAudio(clipId, patch)  setTrackAudio(trackId, patch)  setMasterAudio(patch)  setDucking(patch)
//                 setLoudnessTarget(target)    (each one undo step; inside beginGesture/endGesture they join the gesture)
//   Functions     measureProjectLoudness(project) → {integrated, truePeak, range?}   (sync or Promise)
//                 audioMeterLevels() → {tracks: Record<trackId, dB>, master: dB} | null   (the graph's analysers)
//                 markBeats(clipId) → {bpm?, beats: number[] | {t}[]} | null   (sync or Promise; a proposal only)
//                 exportLoudnessReport() → {integrated, truePeak, target?, ...} | null   (the last export's measurement)
// The functions are looked up by name in the modules where Part A is expected to put them, so a missing module or
// export never breaks the build.

import { create } from 'zustand'
import type { Clip, Track, VideoProject } from './timeline'
import { useVideoStore } from './videoStore'

export type FadeCurve = 'linear' | 'equal-power' | 'log'
export const FADE_CURVES: { value: FadeCurve; label: string; hint: string }[] = [
  { value: 'linear', label: 'Linear', hint: 'Straight ramp' },
  { value: 'equal-power', label: 'Equal power', hint: 'Constant loudness in a crossfade' },
  { value: 'log', label: 'Logarithmic', hint: 'Fast then slow, like the ear' },
]
export interface Fade { dur: number; curve: FadeCurve }
export type Bus = 'voice' | 'music' | 'fx' | 'none'
export const BUSES: { value: Bus; label: string }[] = [
  { value: 'voice', label: 'Voice' }, { value: 'music', label: 'Music' }, { value: 'fx', label: 'FX' }, { value: 'none', label: 'None' },
]
export type LoudnessTarget = -14 | -16 | -23 | 'off'
export const LOUDNESS_CHOICES: { value: LoudnessTarget; label: string; hint: string }[] = [
  { value: -14, label: '−14 LUFS', hint: 'YouTube and Facebook' },
  { value: -16, label: '−16 LUFS', hint: 'Podcast and phones' },
  { value: -23, label: '−23 LUFS', hint: 'Broadcast (EBU R128)' },
  { value: 'off', label: 'Off', hint: 'Export the mix as it is' },
]
export interface Ducking { enabled: boolean; depthDb: number; threshold: number; attack: number; release: number }
export interface Master { gain: number; limiter: boolean }
export interface Denoise { amount: number; noiseRange?: { start: number; end: number } }
export interface ClipAudio { gain?: number; fadeIn?: Fade; fadeOut?: Fade; pan?: number; denoise?: Denoise }
export interface TrackAudio { bus?: Bus; volume?: number; pan?: number; muted?: boolean; solo?: boolean }
export interface LoudnessReading { integrated: number; truePeak: number; range?: number }

export const DEFAULT_DUCKING: Ducking = { enabled: false, depthDb: 12, threshold: -35, attack: 0.05, release: 0.4 }
export const DEFAULT_MASTER: Master = { gain: 0, limiter: true }
export const FADE_MAX = 30
export const MIN_DB = -60

// ---- the engine's pieces, looked up by name --------------------------------------------------------------------
type AnyFn = (...a: unknown[]) => unknown
const modules = import.meta.glob(['./audioModel.ts', './audioMeter.ts', './engine/audioEngine.ts', './exportVideo.ts', './engine/audioMix.ts', './engine/audioGraph.ts'], { eager: true }) as Record<string, Record<string, unknown>>
/** Dev server only: the end-to-end tests stand in for the engine's functions here (never present in a build). */
const devFns = (): Record<string, unknown> => ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV ? ((globalThis as unknown as { __esbAudioDev?: Record<string, unknown> }).__esbAudioDev ?? {}) : {})
const find = (name: string): AnyFn | undefined => {
  const d = devFns()[name]
  if (typeof d === 'function') return d as AnyFn
  for (const m of Object.values(modules)) if (typeof m[name] === 'function') return m[name] as AnyFn
  return undefined
}

type Loose = Record<string, unknown>
const st = () => useVideoStore.getState() as unknown as Loose
const act = (name: string): AnyFn | undefined => (typeof st()[name] === 'function' ? (st()[name] as AnyFn) : undefined)

/** Which parts of Part A are present right now (checked on use, so a hot module swap or a test shim is seen). */
export function capabilities() {
  return {
    clip: !!act('setClipAudio'),
    track: !!act('setTrackAudio'),
    master: !!act('setMasterAudio'),
    ducking: !!act('setDucking'),
    target: !!act('setLoudnessTarget'),
    measure: !!find('measureProjectLoudness'),
    meters: !!find('audioMeterLevels'),
    beats: !!find('markBeats'),
    exportReport: !!find('exportLoudnessReport'),
  }
}
export const enginePending = () => { const c = capabilities(); return !(c.clip && c.track && c.master && c.ducking) }
export const PENDING_NOTE = 'Audio engine pending: this control switches on when the audio graph is merged.'

// ---- reading parameters (all optional on the model; absent = the neutral value) ---------------------------------
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
export const clipGainDb = (c: Clip) => num((c as unknown as Loose).gain, 0)
export const clipPan = (c: Clip) => num((c as unknown as Loose).pan, 0)
const fadeOf = (v: unknown): Fade => {
  const f = (v ?? {}) as Loose
  return { dur: Math.max(0, num(f.dur, 0)), curve: f.curve === 'equal-power' || f.curve === 'log' ? f.curve : 'linear' }
}
export const clipFadeIn = (c: Clip) => fadeOf((c as unknown as Loose).fadeIn)
export const clipFadeOut = (c: Clip) => fadeOf((c as unknown as Loose).fadeOut)
export const clipDenoise = (c: Clip): Denoise => {
  const d = ((c as unknown as Loose).denoise ?? {}) as Loose
  const r = d.noiseRange as Loose | undefined
  return { amount: Math.max(0, Math.min(1, num(d.amount, 0))), noiseRange: r && typeof r.start === 'number' && typeof r.end === 'number' ? { start: r.start, end: r.end } : undefined }
}
export const trackBus = (t: Track): Bus => { const b = (t as unknown as Loose).bus; return b === 'voice' || b === 'music' || b === 'fx' || b === 'none' ? b : 'none' }
export const trackVolumeDb = (t: Track) => num((t as unknown as Loose).volume, 0)
export const trackPan = (t: Track) => num((t as unknown as Loose).pan, 0)
export const trackSolo = (t: Track) => (t as unknown as Loose).solo === true
export const projectMaster = (p: VideoProject): Master => { const m = ((p as unknown as Loose).master ?? {}) as Loose; return { gain: num(m.gain, 0), limiter: m.limiter !== false } }
export const projectDucking = (p: VideoProject): Ducking => {
  const d = ((p as unknown as Loose).ducking ?? {}) as Loose
  return { enabled: d.enabled === true, depthDb: num(d.depthDb, DEFAULT_DUCKING.depthDb), threshold: num(d.threshold, DEFAULT_DUCKING.threshold), attack: num(d.attack, DEFAULT_DUCKING.attack), release: num(d.release, DEFAULT_DUCKING.release) }
}
export const projectTarget = (p: VideoProject): LoudnessTarget => { const t = (p as unknown as Loose).loudnessTarget; return t === -14 || t === -16 || t === -23 ? t : 'off' }

// ---- writing: one undo step per gesture ------------------------------------------------------------------------
export const writeClip = (id: string, patch: ClipAudio) => { act('setClipAudio')?.(id, patch) }
export const writeTrack = (id: string, patch: TrackAudio) => { act('setTrackAudio')?.(id, patch) }
export const writeMaster = (patch: Partial<Master>) => { act('setMasterAudio')?.(patch) }
export const writeDucking = (patch: Partial<Ducking>) => { act('setDucking')?.(patch) }
export const writeTarget = (t: LoudnessTarget) => { act('setLoudnessTarget')?.(t) }
/** A slider or handle drag: the step is taken when it starts and closed when it ends (videoStore gestures). */
export const gestureStart = () => st().beginGesture && (st().beginGesture as () => void)()
export const gestureEnd = () => st().endGesture && (st().endGesture as () => void)()

// ---- dB helpers --------------------------------------------------------------------------------------------------
export const fmtDb = (v: number, dec = 1) => (v <= MIN_DB ? '−∞ dB' : `${v < 0 ? '−' : v > 0 ? '+' : ''}${Math.abs(v).toFixed(dec)} dB`)
export const fmtLufs = (v: number) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)} LUFS`
export const fmtDbtp = (v: number) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)} dBTP`

// ---- loudness: real numbers only -------------------------------------------------------------------------------
export interface LoudnessState { reading: (LoudnessReading & { at: number; seconds: number }) | null; measuring: boolean; error: string | null }
export const useLoudness = create<LoudnessState>(() => ({ reading: null, measuring: false, error: null }))
let measureSeq = 0

function toReading(r: unknown): LoudnessReading | null {
  const o = (r ?? null) as Loose | null
  if (!o) return null
  const integrated = typeof o.integrated === 'number' ? o.integrated : typeof o.lufs === 'number' ? o.lufs : NaN
  const truePeak = typeof o.truePeak === 'number' ? o.truePeak : typeof o.tp === 'number' ? o.tp : NaN
  if (!Number.isFinite(integrated) || !Number.isFinite(truePeak)) return null
  return { integrated, truePeak, range: typeof o.range === 'number' ? o.range : typeof o.lra === 'number' ? o.lra : undefined }
}

/** Measure the project's mix with Part A's measurer. Returns null (and says why) when it is absent, the mix is silent
 * or the measurer throws. A silent mix has no loudness: it is reported as such, never as −70. */
export async function measureLoudnessNow(project: VideoProject): Promise<LoudnessReading | null> {
  const fn = find('measureProjectLoudness')
  if (!fn) { useLoudness.setState({ error: 'The loudness measurer is not in this build yet.' }); return null }
  const seq = ++measureSeq
  useLoudness.setState({ measuring: true, error: null })
  try {
    const raw = await fn(project)
    if (seq !== measureSeq) return null
    const reading = toReading(raw)
    if (!reading || reading.integrated <= -69.5) { useLoudness.setState({ measuring: false, reading: null, error: 'Nothing audible to measure.' }); return null }
    useLoudness.setState({ measuring: false, reading: { ...reading, at: Date.now(), seconds: (project as unknown as { duration?: number }).duration ?? 0 }, error: null })
    return reading
  } catch (e) {
    if (seq === measureSeq) useLoudness.setState({ measuring: false, error: String((e as Error).message || e).slice(0, 160) })
    return null
  }
}

/** The report Part A keeps from the last export (measured on the file's mix), or null. */
export function lastExportLoudness(): (LoudnessReading & { target?: number }) | null {
  const fn = find('exportLoudnessReport')
  if (!fn) return null
  try {
    const r = fn() as Loose | null
    const rd = toReading(r)
    return rd ? { ...rd, target: typeof r?.target === 'number' ? r.target : undefined } : null
  } catch { return null }
}

// ---- meters ------------------------------------------------------------------------------------------------------
export interface MeterLevels { tracks: Record<string, number>; master: number }
/** The audio graph's analyser levels (dBFS peak), or null when there is no graph to read. */
export function readMeters(): MeterLevels | null {
  const fn = find('audioMeterLevels')
  if (!fn) return null
  try {
    const r = fn() as Loose | null
    if (!r || typeof r.master !== 'number') return null
    return { tracks: (r.tracks ?? {}) as Record<string, number>, master: r.master }
  } catch { return null }
}

// ---- beats -------------------------------------------------------------------------------------------------------
export interface BeatProposal { clipId: string; bpm?: number; times: number[] }
/** Part A's beat detector on a clip, as a proposal in timeline seconds (nothing is added until the editor accepts). */
export async function proposeBeats(clip: Clip): Promise<BeatProposal | null> {
  const fn = find('markBeats')
  if (!fn) return null
  const r = (await fn(clip.id)) as Loose | null
  if (!r) return null
  const raw = (Array.isArray(r) ? r : Array.isArray(r.beats) ? r.beats : []) as unknown[]
  const times = raw.map((b) => (typeof b === 'number' ? b : typeof (b as Loose)?.t === 'number' ? ((b as Loose).t as number) : NaN)).filter((t) => Number.isFinite(t) && t >= 0)
  return { clipId: clip.id, bpm: typeof r.bpm === 'number' ? r.bpm : undefined, times }
}
/** Accept a proposal: one marker per beat, all one undo step. */
export function acceptBeats(p: BeatProposal) {
  const s = useVideoStore.getState()
  s.beginGesture()
  for (const t of p.times) s.addMarker(t)
  s.endGesture()
}

/** The next audio clip on the clip's track (by start). */
export function neighbourAfter(clip: Clip): Clip | undefined {
  const v = useVideoStore.getState().project
  return v.clips.filter((c) => c.trackId === clip.trackId && c.kind === 'audio' && c.id !== clip.id && c.start > clip.start + 1e-6).sort((a, b) => a.start - b.start)[0]
}

/** Crossfade `clip` into the clip after it: an overlap is faded as it is; clips that only touch are widened by spare
 * source on both sides so there is something to fade. One undo step. Returns a sentence when it cannot. */
export function crossfadeWithNext(shown: Clip): string | null {
  const clip = useVideoStore.getState().project.clips.find((c) => c.id === shown.id) ?? shown
  const next = neighbourAfter(clip)
  if (!next) return 'There is no audio clip after this one on the track.'
  if (clip.speed != null || next.speed != null) return 'Crossfades need clips at normal speed.'
  const fps = useVideoStore.getState().project.fps || 30
  const gap = next.start - (clip.start + clip.duration)
  let overlap = -gap
  const s = useVideoStore.getState()
  s.beginGesture()
  try {
    if (gap > 1 / fps) return 'The two clips are not touching. Drag one against the other first.'
    if (overlap < 0.05) {
      const tail = (clip.srcDuration ?? Infinity) - clip.out
      const head = next.in
      const h = Math.min(0.5, tail, head)
      if (!(h >= 0.05)) return 'There is no spare sound at the cut to fade across. Overlap the clips by hand instead.'
      s.updateClip({ ...clip, duration: clip.duration + h, out: clip.out + h })
      s.updateClip({ ...next, start: next.start - h, in: next.in - h, duration: next.duration + h })
      overlap = 2 * h
    }
    const dur = Math.min(overlap, FADE_MAX)
    writeClip(clip.id, { fadeOut: { dur, curve: 'equal-power' } })
    writeClip(next.id, { fadeIn: { dur, curve: 'equal-power' } })
    return null
  } finally {
    s.endGesture()
  }
}

