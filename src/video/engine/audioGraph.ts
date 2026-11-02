// The ONE audio graph of the Video Desk, built the same way for the preview (a live AudioContext) and for the export (an
// OfflineAudioContext), so what is heard while editing is what is written to the file:
//
//   source → clip gain (clip gain dB × volume × fades, automated) → clip pan
//          → track gain (fader, mute/solo) → track pan → bus (voice | music | fx | none; bus fader)
//          → ducking (the music bus only: lowered while the voice bus speaks; a gain curve applied as automation)
//          → master gain → [preview limiter] → destination
//
// The numbers come from audioModel.ts; the gain over time of a clip is `clipGainFn`, sampled at CONTROL_RATE into
// AudioParam value curves. The export adds its loudness stage (a true-peak limiter and a gain to the project's target)
// after this graph, offline (audioRender.ts).

import type { Clip, VideoProject } from '../timeline'
import type { Bus } from '../audioModel'
import { BUSES, busLevel, busOf, dbToLin, fitFades, masterOf, trackLevel } from '../audioModel'
import { clipFadeGain } from '../audio/fades'
import { curveAt } from '../audio/ducking'
import type { GainCurve } from '../audio/ducking'
import { animated, sampleProp } from './animation'

/** Control points per second of every automation curve. */
export const CONTROL_RATE = 100

/** A clip's gain over timeline time, and the spans where it changes (outside them it is constant). */
export interface GainFn { at(t: number): number; ranges: [number, number][] }

/** The gain a clip plays at, as a function of timeline time: clip gain (dB) × volume (keyframes included) × fades.
 * 0 while the clip is muted. Track mute/solo/volume are the track's, not here. */
export function clipGainFn(c: Clip): GainFn {
  const end = c.start + c.duration
  if (c.muted) return { at: () => 0, ranges: [] }
  const f = fitFades(c)
  const lin = dbToLin(c.gain ?? 0)
  const keyed = animated(c, 'volume')
  const base = Math.max(0, Math.min(1, c.volume ?? 1))
  const spec = { fadeIn: f.inDur, fadeOut: f.outDur, curve: f.inCurve, curveOut: f.outCurve }
  const ranges: [number, number][] = []
  if (keyed) ranges.push([c.start, end])
  else {
    if (f.inDur > 0) ranges.push([c.start, c.start + f.inDur])
    if (f.outDur > 0) ranges.push([end - f.outDur, end])
  }
  return {
    ranges,
    at: (t) => {
      const tl = Math.max(0, Math.min(c.duration, t - c.start))
      const v = keyed ? Math.max(0, Math.min(1, sampleProp(c, 'volume', tl, base))) : base
      return v * lin * (f.inDur > 0 || f.outDur > 0 ? clipFadeGain(spec, tl, c.duration) : 1)
    },
  }
}

/** `n` samples of `fn` over [a, b] (first at a, last at b): the array `setValueCurveAtTime` wants. */
export function sampleCurve(fn: (t: number) => number, a: number, b: number): Float32Array {
  const n = Math.max(2, Math.ceil((b - a) * CONTROL_RATE) + 1)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = fn(a + ((b - a) * i) / (n - 1))
  return out
}

/** The longest value curve in one automation event (Web Audio takes any length; this keeps one piece cheap to build). */
const PIECE_SECONDS = 60

/** Schedule `fn` on `param` for timeline times [from, to]: a constant where it does not change, a value curve where it
 * does. `ctxOf` maps timeline time to context time. The param's value before the first event is set to fn(from). */
export function automate(param: AudioParam, fn: GainFn, from: number, to: number, ctxOf: (t: number) => number) {
  param.setValueAtTime(fn.at(from), ctxOf(from))
  let pos = from
  const ranges = fn.ranges.map(([a, b]) => [Math.max(a, from), Math.min(b, to)] as [number, number]).filter(([a, b]) => b - a > 1e-3).sort((p, q) => p[0] - q[0])
  for (const [ra, rb] of ranges) {
    if (rb <= pos) continue
    const a = Math.max(ra, pos)
    if (a > pos + 1e-6) param.setValueAtTime(fn.at(pos), ctxOf(pos))
    for (let s = a; s < rb - 1e-6; s += PIECE_SECONDS) {
      const e = Math.min(rb, s + PIECE_SECONDS)
      try { param.setValueCurveAtTime(sampleCurve(fn.at, s, e), ctxOf(s), e - s) } catch { /* overlapping events: keep the constant */ }
    }
    pos = rb
  }
  if (pos < to - 1e-6) param.setValueAtTime(fn.at(pos), ctxOf(pos))
}

/** Schedule a ducking curve (dB ≤ 0) as linear gain on `param` for timeline times [from, to]. */
export function automateDuck(param: AudioParam, curve: GainCurve, from: number, to: number, ctxOf: (t: number) => number) {
  const fn = (t: number) => dbToLin(curveAt(curve, t))
  param.setValueAtTime(fn(from), ctxOf(from))
  for (let s = from; s < to - 1e-6; s += PIECE_SECONDS) {
    const e = Math.min(to, s + PIECE_SECONDS)
    if (e - s < 1e-3) break
    try { param.setValueCurveAtTime(sampleCurve(fn, s, e), ctxOf(s), e - s) } catch { /* keep the constant */ }
  }
}

// ---------------------------------------------------------------- the graph

export interface TrackNode { gain: GainNode; pan: StereoPannerNode; analyser?: AnalyserNode; trackId: string; bus: Bus }
export interface MixGraph {
  ctx: BaseAudioContext
  master: GainNode
  /** The node the destination hears (the master, or the preview limiter after it). */
  out: AudioNode
  buses: Record<Bus, GainNode>
  busAnalysers: Partial<Record<Bus, AnalyserNode>>
  masterAnalyser?: AnalyserNode
  /** The ducking gain: in series after the target (music) bus. */
  duck: GainNode
  tracks: Map<string, TrackNode>
  sidechain: boolean
}

export interface GraphOptions {
  /** Voice-bus analysis render (the ducking's sidechain): the bus faders and the master are left at unity (the track
   * strips still count, so a muted voice track does not duck the music). */
  sidechain?: boolean
  /** Level meters (analysers) on every track, bus and the master. */
  analysers?: boolean
  /** A safety limiter after the master (preview only; the export's limiter is the true-peak one in audioRender.ts). */
  limiter?: boolean
}

const analyser = (ctx: BaseAudioContext) => { const a = ctx.createAnalyser(); a.fftSize = 1024; a.smoothingTimeConstant = 0; return a }

/** The track/bus/master backbone, ending in `dest`. */
export function buildMixGraph(ctx: BaseAudioContext, project: VideoProject, dest: AudioNode, opts: GraphOptions = {}): MixGraph {
  const m = masterOf(project)
  const master = ctx.createGain()
  master.gain.value = opts.sidechain ? 1 : dbToLin(m.gain)
  let out: AudioNode = master
  if (opts.limiter && m.limiter && 'createDynamicsCompressor' in ctx) {
    const lim = ctx.createDynamicsCompressor()
    lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.1
    master.connect(lim)
    out = lim
  }
  out.connect(dest)
  const g: MixGraph = { ctx, master, out, buses: {} as Record<Bus, GainNode>, busAnalysers: {}, duck: ctx.createGain(), tracks: new Map(), sidechain: !!opts.sidechain }
  if (opts.analysers) { g.masterAnalyser = analyser(ctx); master.connect(g.masterAnalyser) }
  g.duck.connect(master)
  for (const b of BUSES) {
    const n = ctx.createGain()
    n.gain.value = opts.sidechain ? 1 : busLevel(project, b)
    n.connect(b === 'music' ? g.duck : master)
    if (opts.analysers) { const a = analyser(ctx); n.connect(a); g.busAnalysers[b] = a }
    g.buses[b] = n
  }
  return g
}

/** The (track, bus) strip a clip plays through, made when first needed. */
export function trackNode(g: MixGraph, project: VideoProject, trackId: string, bus: Bus, analysers = false): TrackNode {
  const key = `${trackId}|${bus}`
  let t = g.tracks.get(key)
  if (t) return t
  const track = project.tracks.find((x) => x.id === trackId)
  const gain = g.ctx.createGain()
  gain.gain.value = trackLevel(project, track)
  const pan = g.ctx.createStereoPanner()
  pan.pan.value = track?.pan ?? 0
  gain.connect(pan)
  pan.connect(g.buses[bus])
  t = { gain, pan, trackId, bus }
  if (analysers) { t.analyser = analyser(g.ctx); pan.connect(t.analyser) }
  g.tracks.set(key, t)
  return t
}

/** A clip's own strip: the gain node sources connect to (stereo in, whatever the file has), then its pan, into its track. */
export function clipStrip(g: MixGraph, project: VideoProject, c: Clip, analysers = false): { input: GainNode; pan: StereoPannerNode; fn: GainFn; bus: Bus; track: TrackNode } {
  const bus = busOf(project, c)
  const track = trackNode(g, project, c.trackId, bus, analysers)
  const input = g.ctx.createGain()
  // a mono file is spread to both sides before it is panned, so every source pans the same way
  input.channelCount = 2
  input.channelCountMode = 'explicit'
  input.channelInterpretation = 'speakers'
  const pan = g.ctx.createStereoPanner()
  pan.pan.value = c.pan ?? 0
  input.connect(pan)
  pan.connect(track.gain)
  return { input, pan, fn: clipGainFn(c), bus, track }
}

/** Move the static levels (faders, master, pans) to the project's current values without restarting anything. */
export function applyStatic(g: MixGraph, project: VideoProject, now: number) {
  const set = (p: AudioParam, v: number) => { try { p.setTargetAtTime(v, now, 0.01) } catch { p.value = v } }
  if (!g.sidechain) {
    set(g.master.gain, dbToLin(masterOf(project).gain))
    for (const b of BUSES) set(g.buses[b].gain, busLevel(project, b))
  }
  for (const t of g.tracks.values()) {
    const tr = project.tracks.find((x) => x.id === t.trackId)
    set(t.gain.gain, trackLevel(project, tr))
    set(t.pan.pan, tr?.pan ?? 0)
  }
}

// ---------------------------------------------------------------- meters

export interface Level { peak: number; rms: number }
/** dBFS of an analyser's last 1024 samples (peak and RMS; −Infinity for silence). */
let LEVEL_BUF = new Float32Array(1024)
export function readLevel(a: AnalyserNode, buf?: Float32Array<ArrayBuffer>): Level {
  if (!buf) { if (LEVEL_BUF.length !== a.fftSize) LEVEL_BUF = new Float32Array(a.fftSize); buf = LEVEL_BUF } // one shared buffer: this runs ~30× a second for every track
  a.getFloatTimeDomainData(buf)
  let peak = 0
  let sum = 0
  for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > peak) peak = v; sum += v * v }
  const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity)
  return { peak: db(peak), rms: db(Math.sqrt(sum / buf.length)) }
}
