// Phase 4 (Part A): the audio parameters of a project, their defaults, their sanitisers and the pure rules that
// read them. One model for the preview graph, the export mix and the mixer UI; nothing here touches the DOM.
//
//   Clip   gain (dB) · fadeIn / fadeOut {dur, curve} · pan (−1..1) · denoise {amount 0..1, noiseRange?}
//   Track  bus ('voice' | 'music' | 'fx' | 'none'; unset = automatic) · volume (dB) · pan · muted · solo
//   Project master {gain (dB), limiter} · ducking {…} · loudnessTarget (null | −14 | −16 | −23) · busVolume (dB)
//
// Every field is optional and absent means "as before Phase 4": an old project opens unchanged, and its export has the
// same sound. A hostile file is cleaned the same way Phase 2's sanitisers clean theirs: wrong types, NaN, Infinity,
// out-of-range numbers and unknown names are dropped (the field falls back to its default), never thrown on.
//
// Units: dB for every gain; seconds for times; pan −1 (left) … 1 (right); `muted` is the track's existing mute flag
// (the mixer's "mute"); a clip's `volume` (0..1, keyframable) is unchanged and multiplies `gain`.

import type { Clip, Track, VideoProject } from './timeline'

export type FadeCurve = 'linear' | 'equal-power' | 'log'
export const FADE_CURVES: readonly FadeCurve[] = ['linear', 'equal-power', 'log']
export type Bus = 'voice' | 'music' | 'fx' | 'none'
export const BUSES: readonly Bus[] = ['voice', 'music', 'fx', 'none']
export const LOUDNESS_TARGET_VALUES = [-14, -16, -23] as const
export type LoudnessTarget = null | -14 | -16 | -23

/** A clip's fade: `dur` seconds, shaped by `curve` (fades.ts). */
export interface ClipFade { dur: number; curve: FadeCurve }
/** Noise reduction on a clip: `amount` 0 (off) … 1 (strongest); `noiseRange` = a stretch of clip-local seconds that holds
 * only the noise (the noise spectrum is measured there; without it the quietest frames are used). */
export interface ClipDenoise {
  amount: number
  noiseRange?: [number, number]
  /** The noise sample was cut away by an edit (split, trim, slip moved the clip's sound off it): the denoiser falls back
   * to the quietest frames and the clip's panel says so. Cleared when the editor picks a new sample. */
  noiseDropped?: boolean
}
export interface MasterSettings { gain: number; limiter: boolean }
/** Auto ducking: while the `source` bus is louder than `threshold` (dBFS, RMS), the `target` bus is lowered by up to
 * `depthDb` dB; `attack` / `release` are the seconds it takes to go down / come back. */
export interface DuckingSettings { enabled: boolean; source: 'voice'; target: 'music'; depthDb: number; threshold: number; attack: number; release: number }

export const GAIN_DB_MIN = -60
export const GAIN_DB_MAX = 24
export const TRACK_DB_MIN = -60
export const TRACK_DB_MAX = 12
export const MASTER_DB_MIN = -60
export const MASTER_DB_MAX = 12
const MAX_FADE = 3600

export const DEFAULT_FADE_CURVE: FadeCurve = 'equal-power'
export const DEFAULT_MASTER: MasterSettings = { gain: 0, limiter: false }
export const DEFAULT_DUCKING: DuckingSettings = { enabled: false, source: 'voice', target: 'music', depthDb: 12, threshold: -40, attack: 0.05, release: 0.4 }

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const r3 = (v: number) => Math.round(v * 1000) / 1000
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

// ---------------------------------------------------------------- sanitisers

export function sanitizeFade(raw: unknown): ClipFade | undefined {
  if (!isRecord(raw) || !fin(raw.dur) || raw.dur <= 0) return undefined
  const curve = FADE_CURVES.includes(raw.curve as FadeCurve) ? (raw.curve as FadeCurve) : DEFAULT_FADE_CURVE
  return { dur: r3(Math.min(MAX_FADE, raw.dur)), curve }
}

export function sanitizeDenoise(raw: unknown): ClipDenoise | undefined {
  if (!isRecord(raw) || !fin(raw.amount)) return undefined
  const amount = r3(clamp(raw.amount, 0, 1))
  const nr = raw.noiseRange
  const range = Array.isArray(nr) && nr.length === 2 && fin(nr[0]) && fin(nr[1]) && nr[0] >= 0 && nr[1] > nr[0] && nr[1] <= 1e5 ? ([nr[0], nr[1]] as [number, number]) : undefined
  // amount 0 is "off", but the sample the editor marked is kept (dragging the slider to 0 and back must not lose it)
  if (amount <= 0 && !range) return undefined
  const out: ClipDenoise = { amount }
  if (range) out.noiseRange = range
  else if (raw.noiseDropped === true && amount > 0) out.noiseDropped = true
  return out
}

/** Smallest noise sample the denoiser can learn from (seconds). */
export const MIN_NOISE_RANGE = 0.1

/** A clip's denoise after its sound moved by `shift` seconds in clip-local time (a head trim of `a` seconds is -a) and
 * the clip now lasts `newDur`: the noise sample moves with the sound it was taken from. What falls outside the clip is
 * cut off; if less than MIN_NOISE_RANGE is left the sample is dropped and `noiseDropped` records it. */
export function rebaseDenoise(d: ClipDenoise, shift: number, newDur: number): ClipDenoise | undefined {
  if (!d.noiseRange) return d
  const lo = Math.max(0, d.noiseRange[0] + shift)
  const hi = Math.min(newDur, d.noiseRange[1] + shift)
  const { noiseRange: _old, noiseDropped: _n, ...rest } = d
  void _old; void _n
  if (hi - lo >= MIN_NOISE_RANGE - 1e-9) {
    if (Math.abs(shift) < 1e-9 && hi === d.noiseRange[1] && lo === d.noiseRange[0]) return d
    return { ...rest, noiseRange: [r3(lo), r3(hi)] }
  }
  return d.amount > 0 ? { ...rest, noiseDropped: true } : undefined
}

/** The Phase 4 fields of a clip, cleaned (a Partial: only what is set and not the default). */
export function sanitizeClipAudio(o: Record<string, unknown>): Partial<Pick<Clip, 'gain' | 'fadeIn' | 'fadeOut' | 'pan' | 'denoise' | 'bus'>> {
  const out: Partial<Pick<Clip, 'gain' | 'fadeIn' | 'fadeOut' | 'pan' | 'denoise' | 'bus'>> = {}
  if (BUSES.includes(o.bus as Bus)) out.bus = o.bus as Bus
  if (fin(o.gain) && o.gain !== 0) out.gain = r3(clamp(o.gain, GAIN_DB_MIN, GAIN_DB_MAX))
  const fi = sanitizeFade(o.fadeIn)
  if (fi) out.fadeIn = fi
  const fo = sanitizeFade(o.fadeOut)
  if (fo) out.fadeOut = fo
  if (fin(o.pan) && o.pan !== 0) out.pan = r3(clamp(o.pan, -1, 1))
  const dn = sanitizeDenoise(o.denoise)
  if (dn) out.denoise = dn
  return out
}

/** The Phase 4 fields of a track, cleaned. (`muted` is the track's own, older field.) */
export function sanitizeTrackAudio(o: Record<string, unknown>): Partial<Pick<Track, 'bus' | 'volume' | 'pan' | 'solo'>> {
  const out: Partial<Pick<Track, 'bus' | 'volume' | 'pan' | 'solo'>> = {}
  if (BUSES.includes(o.bus as Bus)) out.bus = o.bus as Bus
  if (fin(o.volume) && o.volume !== 0) out.volume = r3(clamp(o.volume, TRACK_DB_MIN, TRACK_DB_MAX))
  if (fin(o.pan) && o.pan !== 0) out.pan = r3(clamp(o.pan, -1, 1))
  if (o.solo === true) out.solo = true
  return out
}

export function sanitizeMaster(raw: unknown): MasterSettings | undefined {
  if (!isRecord(raw)) return undefined
  const gain = fin(raw.gain) ? r3(clamp(raw.gain, MASTER_DB_MIN, MASTER_DB_MAX)) : 0
  const limiter = raw.limiter === true
  return gain === 0 && !limiter ? undefined : { gain, limiter }
}

export function sanitizeDucking(raw: unknown): DuckingSettings | undefined {
  if (!isRecord(raw)) return undefined
  const d = DEFAULT_DUCKING
  const out: DuckingSettings = {
    enabled: raw.enabled === true,
    source: 'voice',
    target: 'music',
    depthDb: fin(raw.depthDb) ? r3(clamp(Math.abs(raw.depthDb), 0, 40)) : d.depthDb,
    threshold: fin(raw.threshold) ? r3(clamp(raw.threshold, -80, 0)) : d.threshold,
    attack: fin(raw.attack) ? r3(clamp(raw.attack, 0.001, 5)) : d.attack,
    release: fin(raw.release) ? r3(clamp(raw.release, 0.001, 10)) : d.release,
  }
  const same = out.enabled === d.enabled && out.depthDb === d.depthDb && out.threshold === d.threshold && out.attack === d.attack && out.release === d.release
  return same ? undefined : out
}

export function sanitizeLoudnessTarget(raw: unknown): -14 | -16 | -23 | undefined {
  return LOUDNESS_TARGET_VALUES.includes(raw as -14) ? (raw as -14 | -16 | -23) : undefined
}

export function sanitizeBusVolume(raw: unknown): Partial<Record<Bus, number>> | undefined {
  if (!isRecord(raw)) return undefined
  const out: Partial<Record<Bus, number>> = {}
  for (const b of BUSES) { const v = raw[b]; if (fin(v) && v !== 0) out[b] = r3(clamp(v, TRACK_DB_MIN, TRACK_DB_MAX)) }
  return Object.keys(out).length ? out : undefined
}

/** The Phase 4 project fields of a file, cleaned (spread into the project; only what differs from the defaults). */
export function sanitizeProjectAudio(parsed: Record<string, unknown>): Partial<Pick<VideoProject, 'master' | 'ducking' | 'loudnessTarget' | 'busVolume'>> {
  const out: Partial<Pick<VideoProject, 'master' | 'ducking' | 'loudnessTarget' | 'busVolume'>> = {}
  const m = sanitizeMaster(parsed.master)
  if (m) out.master = m
  const d = sanitizeDucking(parsed.ducking)
  if (d) out.ducking = d
  const lt = sanitizeLoudnessTarget(parsed.loudnessTarget)
  if (lt !== undefined) out.loudnessTarget = lt
  const bv = sanitizeBusVolume(parsed.busVolume)
  if (bv) out.busVolume = bv
  return out
}

// ---------------------------------------------------------------- resolved values

/** dB → linear gain. */
export const dbToLin = (db: number) => Math.pow(10, db / 20)

export const masterOf = (p: Pick<VideoProject, 'master'>): MasterSettings => ({ ...DEFAULT_MASTER, ...p.master })
export const duckingOf = (p: Pick<VideoProject, 'ducking'>): DuckingSettings => ({ ...DEFAULT_DUCKING, ...p.ducking })

/** The bus a clip is heard on. A track's own bus wins; a track left on automatic puts a clip that is the sound of a
 * footage clip (linked to a video clip) on 'voice', and everything else (music, effects dropped on an audio track) on
 * 'music'. A recorded voiceover goes on a track the mixer sets to 'voice'. `Clip.bus` records the origin when the clip
 * is made (footage sound = 'voice'), so unlinking or deleting the picture does not turn the speech into music. */
export function busOf(project: Pick<VideoProject, 'tracks' | 'clips'>, c: Clip): Bus {
  const t = project.tracks.find((x) => x.id === c.trackId)
  if (t?.bus) return t.bus
  if (c.bus) return c.bus // the clip's own origin (footage sound = voice), kept when it is unlinked or its picture is deleted
  if (c.linkId && project.clips.some((x) => x.linkId === c.linkId && x.kind === 'video' && x.id !== c.id)) return 'voice'
  return 'music'
}

/** At least one audio track is soloed (the others are then silent). DAW rule: mute always wins, so a track that is both
 * soloed and muted is silent, and the solo still silences the rest (soloing it does not bring anything back). */
export const soloActive = (p: Pick<VideoProject, 'tracks'>) => p.tracks.some((t) => t.kind === 'audio' && t.solo === true)

/** The linear level of a track: 0 when it is muted, or another track is soloed and this one is not. */
export function trackLevel(p: Pick<VideoProject, 'tracks'>, t: Track | undefined): number {
  if (!t) return 1
  if (t.muted) return 0
  if (soloActive(p) && t.solo !== true) return 0
  return dbToLin(t.volume ?? 0)
}

/** The linear level of a bus (its fader). */
export const busLevel = (p: Pick<VideoProject, 'busVolume'>, b: Bus) => dbToLin(p.busVolume?.[b] ?? 0)

/** Fade lengths that fit a clip: when the two together are longer than the clip they are scaled down to fit. */
export function fitFades(c: Pick<Clip, 'fadeIn' | 'fadeOut' | 'duration'>): { inDur: number; outDur: number; inCurve: FadeCurve; outCurve: FadeCurve } {
  let a = Math.max(0, c.fadeIn?.dur ?? 0)
  let b = Math.max(0, c.fadeOut?.dur ?? 0)
  const d = Math.max(0, c.duration)
  if (a + b > d && a + b > 0) { const k = d / (a + b); a *= k; b *= k }
  return { inDur: a, outDur: b, inCurve: c.fadeIn?.curve ?? DEFAULT_FADE_CURVE, outCurve: c.fadeOut?.curve ?? DEFAULT_FADE_CURVE }
}

/** What the project's audio parameters are, as one string (a quick "did the mix settings change" test). */
export function audioParamsKey(p: VideoProject): string {
  return JSON.stringify([
    p.master ?? null, p.ducking ?? null, p.loudnessTarget ?? null, p.busVolume ?? null,
    p.tracks.filter((t) => t.kind === 'audio').map((t) => [t.id, t.bus ?? '', t.volume ?? 0, t.pan ?? 0, t.muted ? 1 : 0, t.solo ? 1 : 0]),
    p.clips.filter((c) => c.kind === 'audio').map((c) => [c.id, c.gain ?? 0, c.pan ?? 0, c.fadeIn ?? null, c.fadeOut ?? null, c.denoise ?? null, c.bus ?? '', c.volume ?? 1, c.muted ? 1 : 0]),
  ])
}

/** The part of a clip's denoise that decides the rendered, noise-reduced sound (cache key): source, trim, speed and
 * the denoise settings; gain, fades and pan are applied after and do not matter. */
export function denoiseKey(c: Clip): string | null {
  if (!c.denoise || !(c.denoise.amount > 0) || !c.sourceUrl) return null
  return JSON.stringify([c.sourceUrl, c.in, c.out, c.duration, c.speed ?? 1, c.freezes ?? null, c.reverse ? 1 : 0, c.preservePitch === false ? 0 : 1, c.denoise.amount, c.denoise.noiseRange ?? null])
}
