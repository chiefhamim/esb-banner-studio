// The audio UI's door to Phase 4 Part A (src/video/audioModel.ts, audioEdit.ts, engine/audioRender.ts, the audio store
// actions). The UI reads parameters here and writes through the store actions Part A made (one undo step each; a drag
// wraps them in beginGesture / endGesture). Controls that need an action that is missing stay off with "engine pending",
// so a build without Part A never pretends. Real contract:
//   Clip     gain dB (-60..24), fadeIn / fadeOut {dur, curve}, pan, denoise {amount, noiseRange?: [t0, t1] clip-local s}
//   Track    bus? (unset = automatic: footage sound is Voice, other audio is Music), volume dB, pan, solo; mute is `muted`
//   Project  master {gain, limiter}, ducking {enabled, source, target, depthDb, threshold, attack, release}, loudnessTarget, busVolume
//   Actions  patchClipAudio, patchTrackAudio, setMaster, setDucking, setLoudnessTarget, markBeats, applyBeats (+ the single-field ones)
//   Measure  measureProjectLoudness(project, {signal, onProgress}); live levels: useLiveLevels (useAudioMeters.ts)

import { create } from 'zustand'
import type { Clip, Track, VideoProject } from './timeline'
import { useVideoStore } from './videoStore'
import type { Bus, ClipFade, DuckingSettings, FadeCurve, LoudnessTarget as ModelTarget } from './audioModel'
import { DEFAULT_DUCKING, DEFAULT_FADE_CURVE, DEFAULT_MASTER } from './audioModel'
import type { BeatProposal } from './audioEdit'
import { measureProjectLoudness } from './engine/audioRender'

export type { Bus, FadeCurve, BeatProposal }
export type Fade = ClipFade
export const FADE_CURVES: { value: FadeCurve; label: string; hint: string }[] = [
  { value: 'linear', label: 'Linear', hint: 'Straight ramp' },
  { value: 'equal-power', label: 'Equal power', hint: 'Constant loudness in a crossfade' },
  { value: 'log', label: 'Logarithmic', hint: 'Fast then slow, like the ear' },
]
/** Bus choices. "Auto" (no bus set) sends footage sound to Voice and other audio to Music. */
export type BusChoice = Bus | 'auto'
export const BUSES: { value: BusChoice; label: string; hint?: string }[] = [
  { value: 'auto', label: 'Auto', hint: 'Footage sound is Voice, other audio is Music' },
  { value: 'voice', label: 'Voice' }, { value: 'music', label: 'Music' }, { value: 'fx', label: 'FX' }, { value: 'none', label: 'None', hint: 'Straight to the master, never ducked' },
]
export type LoudnessTarget = -14 | -16 | -23 | 'off'
export const LOUDNESS_CHOICES: { value: LoudnessTarget; label: string; hint: string }[] = [
  { value: -14, label: '−14 LUFS', hint: 'YouTube and Facebook' },
  { value: -16, label: '−16 LUFS', hint: 'Podcast and phones' },
  { value: -23, label: '−23 LUFS', hint: 'Broadcast (EBU R128)' },
  { value: 'off', label: 'Off', hint: 'Export the mix as it is' },
]
export type Ducking = DuckingSettings
export interface Master { gain: number; limiter: boolean }
export interface Denoise { amount: number; noiseRange?: [number, number] }
export interface ClipAudio { gain?: number | null; fadeIn?: Fade | null; fadeOut?: Fade | null; pan?: number | null; denoise?: Denoise | null }
export interface TrackAudio { bus?: Bus | null; volume?: number | null; pan?: number | null; solo?: boolean | null; muted?: boolean }
export interface LoudnessReading { integrated: number; truePeak: number; range?: number; gainDb?: number; wouldLimit?: boolean; target?: number | null; /** A very short mix: the level is ungated. */ shortMix?: boolean; /** Things worth saying next to the numbers (short mix, broken samples). */ warnings?: string[] }

export { DEFAULT_DUCKING }
export const DEFAULT_MASTER_UI: Master = DEFAULT_MASTER
export const FADE_MAX = 30
export const MIN_DB = -60

// ---- the store's audio actions ------------------------------------------------------------------------------------
type AnyFn = (...a: unknown[]) => unknown
type Loose = Record<string, unknown>
const st = () => useVideoStore.getState() as unknown as Loose
const act = (name: string): AnyFn | undefined => (typeof st()[name] === 'function' ? (st()[name] as AnyFn) : undefined)

/** Which parts of Part A are present right now (checked on use). */
export function capabilities() {
  return {
    clip: !!act('patchClipAudio'),
    track: !!act('patchTrackAudio'),
    master: !!act('setMaster'),
    ducking: !!act('setDucking'),
    target: !!act('setLoudnessTarget'),
    measure: true,
    meters: true,
    beats: !!act('markBeats') && !!act('applyBeats'),
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
  return { dur: Math.max(0, num(f.dur, 0)), curve: f.curve === 'linear' || f.curve === 'equal-power' || f.curve === 'log' ? f.curve : DEFAULT_FADE_CURVE }
}
export const clipFadeIn = (c: Clip) => fadeOf((c as unknown as Loose).fadeIn)
export const clipFadeOut = (c: Clip) => fadeOf((c as unknown as Loose).fadeOut)
export const clipDenoise = (c: Clip): Denoise => {
  const d = ((c as unknown as Loose).denoise ?? {}) as Loose
  const r = d.noiseRange
  return { amount: Math.max(0, Math.min(1, num(d.amount, 0))), noiseRange: Array.isArray(r) && typeof r[0] === 'number' && typeof r[1] === 'number' ? [r[0], r[1]] : undefined }
}
/** The bus a track is set to, or 'auto' when none is (the engine then decides per clip). */
export const trackBus = (t: Track): BusChoice => { const b = (t as unknown as Loose).bus; return b === 'voice' || b === 'music' || b === 'fx' || b === 'none' ? b : 'auto' }
export const trackVolumeDb = (t: Track) => num((t as unknown as Loose).volume, 0)
export const trackPan = (t: Track) => num((t as unknown as Loose).pan, 0)
export const trackSolo = (t: Track) => (t as unknown as Loose).solo === true
export const projectMaster = (p: VideoProject): Master => { const m = ((p as unknown as Loose).master ?? {}) as Loose; return { gain: num(m.gain, DEFAULT_MASTER.gain), limiter: typeof m.limiter === 'boolean' ? m.limiter : DEFAULT_MASTER.limiter } }
export const projectDucking = (p: VideoProject): Ducking => ({ ...DEFAULT_DUCKING, ...(((p as unknown as Loose).ducking ?? {}) as Partial<Ducking>) })
export const projectTarget = (p: VideoProject): LoudnessTarget => { const t = (p as unknown as Loose).loudnessTarget; return t === -14 || t === -16 || t === -23 ? t : 'off' }

// ---- writing: one undo step per gesture ------------------------------------------------------------------------
export const writeClip = (id: string, patch: ClipAudio) => { act('patchClipAudio')?.(id, patch) }
export const writeTrack = (id: string, patch: TrackAudio) => { act('patchTrackAudio')?.(id, patch) }
export const writeMaster = (patch: Partial<Master>) => { act('setMaster')?.(patch) }
export const writeDucking = (patch: Partial<Ducking>) => { act('setDucking')?.(patch) }
export const writeTarget = (t: LoudnessTarget) => { act('setLoudnessTarget')?.((t === 'off' ? null : t) as ModelTarget) }
/** A slider or handle drag: the step is taken when it starts and closed when it ends (videoStore gestures). */
export const gestureStart = () => st().beginGesture && (st().beginGesture as () => void)()
export const gestureEnd = () => st().endGesture && (st().endGesture as () => void)()

// ---- dB helpers --------------------------------------------------------------------------------------------------
export const fmtDb = (v: number, dec = 1) => (v <= MIN_DB ? '−∞ dB' : `${v < 0 ? '−' : v > 0 ? '+' : ''}${Math.abs(v).toFixed(dec)} dB`)
export const fmtLufs = (v: number) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)} LUFS`
export const fmtDbtp = (v: number) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)} dBTP`

// ---- loudness: real numbers only -------------------------------------------------------------------------------
export interface LoudnessState { reading: (LoudnessReading & { at: number; seconds: number }) | null; measuring: boolean; progress: number; error: string | null; silent: boolean }
export const useLoudness = create<LoudnessState>(() => ({ reading: null, measuring: false, progress: 0, error: null, silent: false }))
let measureSeq = 0
let measureCtl: AbortController | null = null

/** Measure the project's mix through the same graph the export uses (Part A). A silent mix has no loudness: it is
 * reported as such, never as a number. The preview does not apply the target: this also shows the gain an export would add. */
export async function measureLoudnessNow(project: VideoProject): Promise<LoudnessReading | null> {
  const seq = ++measureSeq
  measureCtl?.abort()
  const ctl = (measureCtl = new AbortController())
  useLoudness.setState({ measuring: true, progress: 0, error: null, silent: false })
  try {
    const r = await measureProjectLoudness(project, { signal: ctl.signal, onProgress: (p) => { if (seq === measureSeq) useLoudness.setState({ progress: p }) } })
    if (seq !== measureSeq) return null
    if (r.silent || !Number.isFinite(r.integrated)) { useLoudness.setState({ measuring: false, reading: null, silent: true, error: null }); return null }
    const reading: LoudnessReading = { integrated: r.integrated, truePeak: r.truePeak, range: r.lra, gainDb: r.gainDb, wouldLimit: r.wouldLimit, target: r.target, shortMix: r.shortMix, warnings: r.warnings }
    useLoudness.setState({ measuring: false, silent: false, reading: { ...reading, at: Date.now(), seconds: r.duration }, error: null })
    return reading
  } catch (e) {
    if ((e as Error).name !== 'AbortError' && seq === measureSeq) useLoudness.setState({ measuring: false, error: String((e as Error).message || e).slice(0, 160) })
    return null
  }
}

// ---- beats -------------------------------------------------------------------------------------------------------
/** Part A's beat detector on a clip: a PROPOSAL in timeline seconds (nothing is added until the editor accepts). */
export async function proposeBeats(clip: Clip): Promise<BeatProposal | null> {
  const f = act('markBeats')
  return f ? ((await f(clip.id)) as BeatProposal | null) : null
}
/** Accept a proposal: one marker per beat (or per strong onset when no beat grid was found), one undo step. */
export function acceptBeats(p: BeatProposal): number {
  const f = act('applyBeats')
  return f ? (f(p, p.beats.length ? 'beats' : 'onsets') as number) : 0
}

// ---- crossfade ---------------------------------------------------------------------------------------------------
/** The next audio clip on the clip's track (by start). */
export function neighbourAfter(clip: Clip): Clip | undefined {
  const v = useVideoStore.getState().project
  return v.clips.filter((c) => c.trackId === clip.trackId && c.kind === 'audio' && c.id !== clip.id && c.start > clip.start + 1e-6).sort((a, b) => a.start - b.start)[0]
}

/** Why a clip cannot be crossfaded (its edges are not where the file's sound is simply continued), or null. A reversed,
 * frozen, speed-changed or speed-ramped clip plays the file differently from its edges, so widening it by spare file
 * sound would fade across the wrong audio. */
export function crossfadeBlocker(c: Clip): string | null {
  const name = `“${(c.title || 'A clip').slice(0, 40)}”`
  if (c.reverse) return `${name} plays backwards: crossfades need clips that play forwards. Overlap the clips by hand instead.`
  if (c.freezes?.length) return `${name} has a freeze frame: crossfades need clips without one. Overlap the clips by hand instead.`
  if (c.speed != null) return `${name} has a speed change${typeof c.speed === 'object' ? ' (a speed ramp)' : ''}: crossfades need clips at normal speed. Overlap the clips by hand instead.`
  return null
}

/** Crossfade `clip` into the clip after it: an overlap is faded as it is; clips that only touch are widened by spare
 * source on both sides so there is something to fade. One undo step. Returns a sentence when it cannot. */
export function crossfadeWithNext(shown: Clip): string | null {
  const clip = useVideoStore.getState().project.clips.find((c) => c.id === shown.id) ?? shown
  const next = neighbourAfter(clip)
  if (!next) return 'There is no audio clip after this one on the track.'
  const why = crossfadeBlocker(clip) ?? crossfadeBlocker(next)
  if (why) return why
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
