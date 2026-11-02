// The offline side of the audio graph: the export's mix, the preview's cached renders (noise reduction, the ducking
// curve), the project loudness measurement and the export's loudness stage. The graph itself is audioGraph.ts, the same
// one the preview plays through.
//
//   renderChunk      one stretch of the timeline through the graph (an OfflineAudioContext per piece, 10 s at a time)
//   renderClipSpan   one clip's sound alone (no gains), for noise reduction and beat detection
//   ensureDenoised   noise-reduced renders of the clips that ask for it (in a worker; cached by clip content)
//   computeDuckCurve the voice bus's level → the music gain curve (streaming, 100 points a second)
//   prepareMix       the export's whole audio plan: denoise, duck, measure, gain/limit, then hand out final pieces
//   measureProjectLoudness   the loudness of the mix as it would be exported, before any normalisation

import type { Clip, VideoProject } from '../timeline'
import { audibleClips, contentEnd, flattenCompounds } from '../timeline'
import { AudioBufferSink } from 'mediabunny'
import { inputFor } from '../media'
import { exportUrl } from './mediaSource'
import { isPlainSpeed, srcAt } from './animation'
import { PcmSource } from './pcmSource'
import { ClipSpeedAudio } from './speedAudio'
import type { Bus } from '../audioModel'
import { audioParamsKey, busOf, denoiseKey, duckingOf, masterOf } from '../audioModel'
import { automate, automateDuck, buildMixGraph, clipStrip } from './audioGraph'
import { VoiceLevels, duckFromLevels } from '../audio/ducking'
import type { GainCurve } from '../audio/ducking'
import { StreamMeter } from '../audio/streamMeter'
import { DEFAULT_CEILING, normalizeGain } from '../audio/normalize'
import { detectOnsets } from '../audio/onsets'
import type { OnsetResult } from '../audio/onsets'
import { denoiseAsync, denoiseOptionsFor } from './denoiseJob'
import { limiterGainAsync } from './limiterJob'
import { setDenoiseJob, setDuckJob } from '../audioJobs'

export const SAMPLE_RATE = 48000
export const AUDIO_CHUNK_SECONDS = 10
/** The tail of the last piece kept as the limiter's left context (seconds), and the look-ahead taken from the next. */
const LIMIT_CONTEXT = 0.5
const LIMIT_HEAD = 0.1
/** The most PCM the export keeps from its measure pass (about 17 minutes of stereo) so later passes need not render again. */
const RAW_CACHE_BYTES = 420 * 1024 * 1024

// ---------------------------------------------------------------- source readers

/** Give the desk a turn (a message-channel hop, not a timer: no 4 ms clamp). The long loops of the mix call it between pieces. */
export function yieldUi(): Promise<void> {
  if (typeof MessageChannel === 'undefined') return new Promise((r) => setTimeout(r))
  return new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => { ch.port1.close(); r() }; ch.port2.postMessage(0) })
}

export interface AudioReader {
  buffers(from: number, to: number): AsyncIterable<{ buffer: AudioBuffer; timestamp: number }>
  close(): void
  /** The real length of the file's sound, seconds (what the decoder finds, not what a project file claims). */
  length?(): Promise<number>
}

/** A reader over one file's sound: mediabunny's decoder, or (a file it cannot read) the whole file through
 * decodeAudioData. Null when the file has no sound. */
export async function openAudio(url: string): Promise<AudioReader | null> {
  try {
    const input = inputFor(url)
    const track = await input.getPrimaryAudioTrack()
    if (track && (await track.canDecode())) {
      const sink = new AudioBufferSink(track)
      return { buffers: (a, b) => sink.buffers(a, b), close: () => input.dispose(), length: () => track.computeDuration().catch(() => Infinity) }
    }
    input.dispose()
    if (!track) return null
  } catch { /* fall through to decodeAudioData */ }
  try {
    const bytes = await fetchBounded(url)
    const buffer = await new OfflineAudioContext(2, 1, SAMPLE_RATE).decodeAudioData(bytes)
    return { buffers: async function* () { yield { buffer, timestamp: 0 } }, close: () => {}, length: async () => buffer.duration }
  } catch {
    return null
  }
}

/** The most compressed audio a whole-file decode is attempted on (its PCM is ten times bigger or more). */
export const DECODE_MAX_BYTES = 96 * 1024 * 1024
/** Fetch a file for a whole-file decode, refusing one over DECODE_MAX_BYTES before it is read (a hostile or mistaken file
 * could otherwise turn into gigabytes of PCM). */
export async function fetchBounded(url: string, max = DECODE_MAX_BYTES): Promise<ArrayBuffer> {
  const res = await fetch(url)
  const len = Number(res.headers.get('content-length') || 0)
  if (len > max) { try { await res.body?.cancel() } catch { /* gone */ } throw new Error(`This audio file is too big to decode here (${Math.round(len / 1048576)} MB; the limit is ${Math.round(max / 1048576)} MB). Convert it to a shorter or smaller file.`) }
  const bytes = await res.arrayBuffer()
  if (bytes.byteLength > max) throw new Error(`This audio file is too big to decode here (${Math.round(bytes.byteLength / 1048576)} MB; the limit is ${Math.round(max / 1048576)} MB). Convert it to a shorter or smaller file.`)
  return bytes
}

const decodeWhole = async (url: string) => {
  try {
    const buf = await new OfflineAudioContext(2, 1, SAMPLE_RATE).decodeAudioData(await fetchBounded(url))
    return buf.duration > MAX_DECODED_SECONDS ? null : buf
  } catch { return null }
}
/** A decoded file longer than this is refused (a compressed file can be tiny and decode to hours). */
export const MAX_DECODED_SECONDS = 4 * 3600

/** Per render pass: the speed-changed clips' sound renderers (by clip id; a stretcher joins its grains across the
 * pieces of ONE sequential pass) and their source readers (by URL, shared by every pass). */
export interface SpeedAudioState { clips: Map<string, ClipSpeedAudio>; sources: Map<string, PcmSource> }
export const newSpeedAudioState = (): SpeedAudioState => ({ clips: new Map(), sources: new Map() })
export function closeSpeedAudio(st: SpeedAudioState) { st.sources.forEach((p) => p.dispose()); st.sources.clear(); st.clips.clear() }

// ---------------------------------------------------------------- a mix session

export interface MixSession {
  /** The project as it sounds: compound clips flattened. */
  project: VideoProject
  duration: number
  /** The audible clips that start before `duration`. */
  clips: Clip[]
  readers: Map<string, AudioReader | null>
  speed: SpeedAudioState
  /** Noise-reduced renders by clip id (each covers the clip's whole span, 48 kHz stereo). */
  denoised: Map<string, AudioBuffer>
  duck: GainCurve | null
}

export function newMixSession(project: VideoProject, duration?: number): MixSession {
  const p = flattenCompounds(project)
  const d = duration ?? contentEnd(p)
  return { project: p, duration: d, clips: audibleClips(p).filter((c) => c.start < d), readers: new Map(), speed: newSpeedAudioState(), denoised: new Map(), duck: null }
}

export function closeMixSession(s: MixSession) {
  s.readers.forEach((r) => r?.close())
  s.readers.clear()
  closeSpeedAudio(s.speed)
}

/** A new sequential pass over the same session: the stretchers start again from the first sample. */
export function restartPass(s: MixSession) { s.speed.clips.clear() }

/** Put clip `c`'s sound for timeline [a, b) into `ctx` (whose time 0 is timeline `t0`), connected to `dest`. Plain
 * speed clips are the decoder's own pieces (Web Audio resamples a 44.1 kHz file); speed-changed ones come from the
 * stretcher; a noise-reduced clip is its cached render. */
async function scheduleSource(ctx: OfflineAudioContext, c: Clip, dest: AudioNode, a: number, b: number, t0: number, s: MixSession, useDenoised = true) {
  const url = exportUrl(c)!
  const dn = useDenoised ? s.denoised.get(c.id) : undefined
  if (dn) {
    const src = ctx.createBufferSource()
    src.buffer = dn
    src.connect(dest)
    const off = a - c.start
    if (off < dn.duration) src.start(a - t0, off, Math.min(b - a, dn.duration - off))
    return
  }
  if (!s.readers.has(url)) s.readers.set(url, await openAudio(url))
  const reader = s.readers.get(url)
  if (!reader) return
  if (!isPlainSpeed(c)) {
    let sa = s.speed.clips.get(c.id)
    if (!sa) {
      let pcm = s.speed.sources.get(url)
      if (!pcm) { pcm = new PcmSource(url, decodeWhole); s.speed.sources.set(url, pcm) }
      sa = new ClipSpeedAudio(c, pcm, SAMPLE_RATE)
      s.speed.clips.set(c.id, sa)
    }
    const chans = await sa.render(a, b)
    if (!chans || !chans[0]?.length) return
    const buf = new AudioBuffer({ length: chans[0].length, numberOfChannels: 2, sampleRate: SAMPLE_RATE })
    buf.copyToChannel(chans[0] as Float32Array<ArrayBuffer>, 0)
    buf.copyToChannel((chans[1] ?? chans[0]) as Float32Array<ArrayBuffer>, 1)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(dest)
    src.start(a - t0)
    return
  }
  for await (const wb of reader.buffers(srcAt(c, a), srcAt(c, b))) {
    const when = c.start + (wb.timestamp - (c.in || 0)) - t0
    let start = when
    let offset = 0
    if (start < a - t0) { offset = a - t0 - start; start = a - t0 }
    const end = Math.min(when + wb.buffer.duration, b - t0)
    if (end <= start) continue
    const src = ctx.createBufferSource()
    src.buffer = wb.buffer
    src.connect(dest)
    src.start(start, offset, end - start)
  }
}

export interface ChunkOptions {
  /** Only this bus's clips, with every bus fader, the master and the ducking at unity (the ducking's sidechain). */
  sidechain?: boolean
}

/** The graph's sound for timeline [t0, t1): stereo, 48 kHz (silence where nothing plays). */
export async function renderChunk(s: MixSession, t0: number, t1: number, opts: ChunkOptions = {}): Promise<AudioBuffer> {
  const length = Math.max(1, Math.round((t1 - t0) * SAMPLE_RATE))
  const duck = duckingOf(s.project)
  const here = s.clips.filter((c) => c.start < t1 && c.start + c.duration > t0 && (!opts.sidechain || busOf(s.project, c) === duck.source))
  if (!here.length) return new AudioBuffer({ length, numberOfChannels: 2, sampleRate: SAMPLE_RATE })
  const ctx = new OfflineAudioContext(2, length, SAMPLE_RATE)
  const g = buildMixGraph(ctx, s.project, ctx.destination, { sidechain: opts.sidechain })
  const ctxOf = (tl: number) => tl - t0
  for (const c of here) {
    const a = Math.max(t0, c.start)
    const b = Math.min(t1, c.start + c.duration)
    if (b <= a) continue
    const strip = clipStrip(g, s.project, c)
    automate(strip.input.gain, strip.fn, a, b, ctxOf)
    await scheduleSource(ctx, c, strip.input, a, b, t0, s)
  }
  if (!opts.sidechain && s.duck && duck.enabled) automateDuck(g.duck.gain, s.duck, t0, t1, ctxOf)
  return ctx.startRendering()
}

/** One clip's own sound for its whole span (no gain, fades, pan or noise reduction), stereo 48 kHz, one Float32Array
 * per channel. Rendered a minute at a time. */
export async function renderClipSpan(s: MixSession, c: Clip, signal?: AbortSignal, span?: number): Promise<Float32Array[]> {
  const total = Math.max(1, Math.round(c.duration * SAMPLE_RATE))
  // never read more than the sound that exists (`span`): the rest of the clip stays silent
  const live = Math.max(1, Math.min(total, Math.round((span ?? c.duration) * SAMPLE_RATE)))
  const out = [new Float32Array(live), new Float32Array(live)]
  const PIECE = 15
  restartPass(s)
  for (let a = c.start; a < c.start + c.duration - 1e-9; a += PIECE) {
    if (signal?.aborted) throw new DOMException('cancelled', 'AbortError')
    const at = Math.round((a - c.start) * SAMPLE_RATE)
    if (at >= live) break
    const b = Math.min(c.start + c.duration, a + PIECE)
    const len = Math.max(1, Math.round((b - a) * SAMPLE_RATE))
    const ctx = new OfflineAudioContext(2, len, SAMPLE_RATE)
    await scheduleSource(ctx, c, ctx.destination, a, b, a, s, false)
    const buf = await ctx.startRendering()
    for (let ch = 0; ch < 2; ch++) out[ch].set(buf.getChannelData(Math.min(ch, buf.numberOfChannels - 1)).subarray(0, Math.min(len, live - at)), at)
    await yieldUi() // let the desk breathe between pieces
  }
  return out
}

// ---------------------------------------------------------------- noise reduction

/** Noise-reduced renders, kept for the session by clip content (denoiseKey), oldest dropped first. */
const denoiseCache = new Map<string, AudioBuffer>()
const DENOISE_CACHE_BYTES = 600 * 1024 * 1024
const bytesOf = (b: AudioBuffer) => b.length * b.numberOfChannels * 4
function cacheDenoise(key: string, buf: AudioBuffer) {
  denoiseCache.delete(key)
  denoiseCache.set(key, buf)
  let total = 0
  for (const b of denoiseCache.values()) total += bytesOf(b)
  for (const k of [...denoiseCache.keys()]) { if (total <= DENOISE_CACHE_BYTES || k === key) break; total -= bytesOf(denoiseCache.get(k)!); denoiseCache.delete(k) }
}

/** The longest clip noise reduction will take (its whole PCM is held while it runs). */
export const DENOISE_MAX_SECONDS = 20 * 60
/** The most audio one project's noise reduction will work through in total (clips beyond it are refused, by name). */
export const DENOISE_TOTAL_SECONDS = 3 * 3600

/** Noise reduction could not be done for a clip: the message names the clip and says why (an export shows it as it is). */
export class DenoiseError extends Error {
  readonly clipId: string
  constructor(clipId: string, message: string) { super(message); this.name = 'DenoiseError'; this.clipId = clipId }
}
const clipName = (c: Clip) => `“${(c.title || c.id).slice(0, 60)}”`
const aborted = () => new DOMException('cancelled', 'AbortError')

/** One shared job per clip content: callers that ask for the same render wait on it together. A caller's own signal only
 * withdraws that caller; the job itself stops when nobody is left waiting. */
interface Job { ctl: AbortController; users: number; done: boolean; promise: Promise<AudioBuffer> }
const inFlight = new Map<string, Job>()

/** Noise reduction runs one clip at a time (each holds the clip's whole PCM and an FFT working set). */
let queueTail: Promise<void> = Promise.resolve()
function inQueue<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  const result = queueTail.then(() => { if (signal.aborted) throw aborted(); return run() })
  queueTail = result.then(() => undefined, () => undefined)
  return result
}

function joinJob(key: string, start: (signal: AbortSignal) => Promise<AudioBuffer>, signal?: AbortSignal): Promise<AudioBuffer> {
  let job = inFlight.get(key)
  if (!job) {
    const ctl = new AbortController()
    const j: Job = { ctl, users: 0, done: false, promise: undefined as unknown as Promise<AudioBuffer> }
    j.promise = start(ctl.signal).finally(() => { j.done = true; if (inFlight.get(key) === j) inFlight.delete(key) })
    j.promise.catch(() => undefined)
    inFlight.set(key, j)
    job = j
  }
  const mine = job
  mine.users++
  return new Promise<AudioBuffer>((res, rej) => {
    let left = false
    const onAbort = () => { leave(true); rej(aborted()) }
    const leave = (stop: boolean) => {
      if (left) return
      left = true
      signal?.removeEventListener('abort', onAbort)
      mine.users--
      if (stop && mine.users <= 0 && !mine.done) mine.ctl.abort()
    }
    if (signal?.aborted) { onAbort(); return }
    signal?.addEventListener('abort', onAbort, { once: true })
    mine.promise.then((b) => { leave(false); res(b) }, (e) => { leave(false); rej(e) })
  })
}

/** The cached noise-reduced render of a clip, if it has been made. */
export const denoisedFor = (c: Clip) => { const k = denoiseKey(c); return k ? denoiseCache.get(k) ?? null : null }

/** How many seconds of the clip noise reduction will really work on: never more than the file has (a project file can
 * claim a clip hours long over a short file) and never more than DENOISE_MAX_SECONDS. */
async function spanFor(s: MixSession, c: Clip): Promise<number> {
  if (c.duration > DENOISE_MAX_SECONDS) throw new DenoiseError(c.id, `Noise reduction cannot take ${clipName(c)}: it is ${Math.round(c.duration / 60)} minutes long and the limit is ${DENOISE_MAX_SECONDS / 60}. Split the clip into shorter ones, or switch noise reduction off for it.`)
  const url = exportUrl(c)!
  if (!s.readers.has(url)) s.readers.set(url, await openAudio(url))
  const reader = s.readers.get(url)
  if (!reader) throw new DenoiseError(c.id, `Noise reduction cannot read the sound of ${clipName(c)}.`)
  if (isPlainSpeed(c) && reader.length) {
    const real = await reader.length()
    if (Number.isFinite(real)) return Math.max(0.05, Math.min(c.duration, real - (c.in || 0)))
  }
  return c.duration
}

/** Make (or fetch) the noise-reduced render of one clip: its sound rendered through the clip's own speed mapping, then
 * the denoiser in a worker. Resolves with the render; REJECTS (a DenoiseError naming the clip and the reason, or an
 * AbortError when `signal` is aborted) when it cannot: the caller decides what that means (an export stops, the preview
 * plays the clip as it is and the clip's panel shows the reason). */
export function denoiseClipStrict(c: Clip, project: VideoProject, signal?: AbortSignal): Promise<AudioBuffer> {
  const key = denoiseKey(c)
  if (!key || !c.denoise) return Promise.reject(new DenoiseError(c.id, `${clipName(c)} has no noise reduction to make.`))
  const hit = denoiseCache.get(key)
  if (hit) { setDenoiseJob(c.id, 'ready'); return Promise.resolve(hit) }
  setDenoiseJob(c.id, 'pending')
  const dn = c.denoise
  const p = joinJob(key, (jobSignal) => inQueue(jobSignal, async () => {
    const s = newMixSession({ ...project, clips: [c], tracks: project.tracks }, c.start + c.duration)
    try {
      const span = await spanFor(s, c)
      const pcm = await renderClipSpan(s, c, jobSignal, span)
      const out = await denoiseAsync(pcm, SAMPLE_RATE, denoiseOptionsFor(dn), jobSignal)
      const buf = new AudioBuffer({ length: out[0].length, numberOfChannels: 2, sampleRate: SAMPLE_RATE })
      buf.copyToChannel(out[0] as Float32Array<ArrayBuffer>, 0)
      buf.copyToChannel(out[1] as Float32Array<ArrayBuffer>, 1)
      cacheDenoise(key, buf)
      return buf
    } finally { closeMixSession(s) }
  }), signal)
  return p.then((b) => { setDenoiseJob(c.id, 'ready'); return b }, (e) => {
    if ((e as Error).name === 'AbortError') throw e // withdrawn: a newer request (or nobody) owns the clip's state now
    const err = e instanceof DenoiseError ? e : new DenoiseError(c.id, `Noise reduction failed on ${clipName(c)}: ${String((e as Error)?.message || e).slice(0, 160)}`)
    setDenoiseJob(c.id, 'error', err.message)
    throw err
  })
}

/** The latest preview request per clip: a request for different settings (a slider moved on) withdraws the one before it. */
const previewCtl = new Map<string, { ctl: AbortController; key: string }>()

/** Preview side of denoiseClipStrict: the render, or null when it cannot be made (the reason is in audioJobs.errors[c.id])
 * or was superseded by a newer request for the same clip. Never rejects. */
export function denoiseClip(c: Clip, project: VideoProject, signal?: AbortSignal): Promise<AudioBuffer | null> {
  const key = denoiseKey(c)
  if (!key || !c.denoise) return Promise.resolve(null)
  const hit = denoiseCache.get(key)
  if (hit) { setDenoiseJob(c.id, 'ready'); return Promise.resolve(hit) }
  const prev = previewCtl.get(c.id)
  const mine = { ctl: new AbortController(), key }
  signal?.addEventListener('abort', () => mine.ctl.abort(), { once: true })
  const p = denoiseClipStrict(c, project, mine.ctl.signal) // joins the same render first, then the old request leaves
  previewCtl.set(c.id, mine)
  if (prev && prev.key !== key) prev.ctl.abort()
  return p.then((b) => b, () => null).finally(() => { if (previewCtl.get(c.id) === mine) previewCtl.delete(c.id) })
}

/** Make sure every clip of the session that asks for noise reduction has its render (an export waits for them). A clip
 * whose noise reduction cannot be made stops the export with a message naming it: the file is never written without the
 * noise reduction the editor asked for. */
export async function ensureDenoised(s: MixSession, signal?: AbortSignal) {
  let total = 0
  for (const c of s.clips) {
    if (!c.denoise || !(c.denoise.amount > 0)) continue
    if (signal?.aborted) throw aborted()
    total += Math.min(c.duration, DENOISE_MAX_SECONDS + 1)
    if (total > DENOISE_TOTAL_SECONDS) throw new DenoiseError(c.id, `Noise reduction would have to work through more than ${DENOISE_TOTAL_SECONDS / 3600} hours of sound; it stopped at ${clipName(c)}. Switch it off on some clips.`)
    s.denoised.set(c.id, await denoiseClipStrict(c, s.project, signal))
  }
}

// ---------------------------------------------------------------- ducking

const duckCache = new Map<string, GainCurve>()

/** What decides the ducking curve: every voice-bus clip (timing, source, gains, fades, denoise), the track strips they
 * play through and the ducking settings. */
export function duckSignature(project: VideoProject): string {
  const p = flattenCompounds(project)
  const d = duckingOf(p)
  const voice = audibleClips(p).filter((c) => busOf(p, c) === d.source)
  return JSON.stringify([d, voice.map((c) => [c.id, c.sourceUrl, c.start, c.duration, c.in, c.speed ?? 1, c.freezes ?? null, c.reverse ? 1 : 0, c.preservePitch === false ? 0 : 1, c.volume ?? 1, c.keyframes?.volume ?? null, c.gain ?? 0, c.pan ?? 0, c.fadeIn ?? null, c.fadeOut ?? null, denoiseKey(c)]), p.tracks.filter((t) => t.kind === 'audio').map((t) => [t.id, t.bus ?? '', t.volume ?? 0, t.muted ? 1 : 0, t.solo ? 1 : 0])])
}

/** The cached curve for a project's current ducking, if made. */
export const cachedDuck = (project: VideoProject) => duckCache.get(duckSignature(project)) ?? null

/** Does the project need a ducking curve (ducking on, and a voice clip and a music clip to act on)? */
export function needsDuck(project: VideoProject): boolean {
  const p = flattenCompounds(project)
  const d = duckingOf(p)
  if (!d.enabled) return false
  const clips = audibleClips(p)
  return clips.some((c) => busOf(p, c) === d.source) && clips.some((c) => busOf(p, c) === d.target)
}

/** The music's gain curve for a session: the voice bus rendered a piece at a time through the graph (sidechain mode),
 * its level followed by ducking.ts. Streaming, so a long timeline never holds its voice bus. */
export async function computeDuckCurve(s: MixSession, signal?: AbortSignal): Promise<GainCurve | null> {
  if (!needsDuck(s.project)) return null
  const key = duckSignature(s.project)
  const hit = duckCache.get(key)
  if (hit) return hit
  const d = duckingOf(s.project)
  const lv = new VoiceLevels(SAMPLE_RATE, { rate: 100 })
  const saved = s.duck
  s.duck = null
  restartPass(s)
  try {
    for (let a = 0; a < s.duration - 1e-9; a += AUDIO_CHUNK_SECONDS) {
      if (signal?.aborted) throw new DOMException('cancelled', 'AbortError')
      const b = Math.min(s.duration, a + AUDIO_CHUNK_SECONDS)
      const buf = await renderChunk(s, a, b, { sidechain: true })
      lv.push([buf.getChannelData(0), buf.getChannelData(1)])
      await yieldUi()
    }
  } finally { s.duck = saved; restartPass(s) }
  const curve = duckFromLevels(lv.finish(), { threshold: d.threshold, depth: d.depthDb, attack: d.attack, release: d.release, rate: 100 })
  duckCache.set(key, curve)
  if (duckCache.size > 8) duckCache.delete(duckCache.keys().next().value!)
  return curve
}

/** The preview's ducking job: one at a time, the newest request wins (a fader drag asks again for every pause). */
let duckPrep: { key: string; ctl: AbortController; promise: Promise<GainCurve | null> } | null = null

/** Preview side: make the ducking curve in the background (not on a clip's own session: it opens its own readers). The
 * same request while one is running joins it; a different one (the project changed) stops the old one first. A clip whose
 * noise reduction fails is ducked from its plain sound (the clip's panel shows the failure). */
export function prepareDuckForPreview(project: VideoProject, signal?: AbortSignal): Promise<GainCurve | null> {
  if (!needsDuck(project)) { duckPrep?.ctl.abort(); duckPrep = null; setDuckJob('idle'); return Promise.resolve(null) }
  const hit = cachedDuck(project)
  if (hit) { setDuckJob('ready'); return Promise.resolve(hit) }
  const key = duckSignature(project)
  if (duckPrep?.key === key) return duckPrep.promise
  duckPrep?.ctl.abort()
  const ctl = new AbortController()
  signal?.addEventListener('abort', () => ctl.abort(), { once: true })
  setDuckJob('pending')
  const promise = (async () => {
    const s = newMixSession(project)
    try {
      for (const c of s.clips) {
        if (!c.denoise || !(c.denoise.amount > 0)) continue
        const b = await denoiseClip(c, s.project, ctl.signal)
        if (ctl.signal.aborted) throw aborted()
        if (b) s.denoised.set(c.id, b)
      }
      const c = await computeDuckCurve(s, ctl.signal)
      if (duckPrep?.ctl === ctl) setDuckJob(c ? 'ready' : 'idle')
      return c
    } catch (e) {
      if ((e as Error).name !== 'AbortError' && duckPrep?.ctl === ctl) setDuckJob('error')
      return null
    } finally { closeMixSession(s); if (duckPrep?.ctl === ctl) duckPrep = null }
  })()
  duckPrep = { key, ctl, promise }
  return promise
}

// ---------------------------------------------------------------- loudness and the export's audio plan

export interface LoudnessSummary { integrated: number; lra: number; truePeak: number; samplePeak: number }
export interface ExportLoudness {
  /** The project's target (LUFS), or null when the export is not normalised. */
  target: number | null
  /** The mix before the loudness stage, and the file's audio after it (measured on what was written). */
  before: LoudnessSummary
  after: LoudnessSummary
  /** Gain applied, dB (0 when not normalised). */
  gainDb: number
  /** The true-peak limiter had to work. */
  limited: boolean
  /** The ceiling the true peak is held under, dBTP. */
  ceiling: number
  /** The target could not be reached (a silent mix, or the limiter held it back by more than 0.5 LU). */
  note: string | null
  /** Things the editor should know about the sound: a mix too short for a gated measurement, broken (NaN) samples. */
  warnings: string[]
}

const summary = (r: { integrated: number; range: number; truePeak: number; samplePeak: number }): LoudnessSummary => ({ integrated: r.integrated, lra: r.range, truePeak: r.truePeak, samplePeak: r.samplePeak })

/** The ceiling a normalised export holds the true peak under (dBTP), leaving the encoder some room. */
export const EXPORT_CEILING = DEFAULT_CEILING

export interface PreparedMix {
  session: MixSession
  /** Seconds of audio handed out so far. */
  cursor: number
  /** The next piece of final audio (≤ 10 s) for the muxer; null at the end. */
  next(): Promise<AudioBuffer | null>
  /** The loudness story of the export (complete once every piece has been handed out). */
  loudness(): ExportLoudness | null
  dispose(): void
}

export interface PrepareOptions { signal?: AbortSignal; onStatus?: (text: string) => void; maxDuration?: number; /** Apply the master/loudness stage (default true). */ final?: boolean }

const toBuffer = (chans: Float32Array[], length: number): AudioBuffer => {
  const b = new AudioBuffer({ length, numberOfChannels: 2, sampleRate: SAMPLE_RATE })
  b.copyToChannel(chans[0] as Float32Array<ArrayBuffer>, 0)
  b.copyToChannel((chans[1] ?? chans[0]) as Float32Array<ArrayBuffer>, 1)
  return b
}

/** Everything the export's sound needs before the first frame: noise-reduced renders, the ducking curve and (for a
 * loudness target) the measured loudness of the mix and the gain that reaches it. Pieces then come out in order. */
export async function prepareMix(project: VideoProject, duration: number, opts: PrepareOptions = {}): Promise<PreparedMix> {
  const s = newMixSession(project, duration)
  const m = masterOf(s.project)
  const target = opts.final === false ? null : s.project.loudnessTarget ?? null
  const limit = opts.final !== false && m.limiter
  try {
    opts.onStatus?.('Reducing noise')
    await ensureDenoised(s, opts.signal)
    opts.onStatus?.('Ducking')
    s.duck = await computeDuckCurve(s, opts.signal)
    const blocks: [number, number][] = []
    for (let a = 0; a < duration - 1e-9; a += AUDIO_CHUNK_SECONDS) blocks.push([a, Math.min(duration, a + AUDIO_CHUNK_SECONDS)])
    // the measure pass keeps the blocks it renders (when they fit in RAW_CACHE_BYTES) so the limiter's trial passes and the
    // final pass do not render the whole timeline again; the final pass hands each one back as it is used
    const keepRaw = target != null && duration * SAMPLE_RATE * 2 * 4 <= RAW_CACHE_BYTES
    const rawCache: (Float32Array[] | undefined)[] = []
    const rawBlock = async (i: number) => {
      const hit = rawCache[i]
      if (hit) return hit
      const [a, b] = blocks[i]
      const buf = await renderChunk(s, a, b)
      const arr = [buf.getChannelData(0), buf.getChannelData(1)] as Float32Array[]
      if (keepRaw) rawCache[i] = arr
      return arr
    }
    const warnings: string[] = []

    let gainDb = 0
    let before: LoudnessSummary = { integrated: -Infinity, lra: 0, truePeak: -Infinity, samplePeak: -Infinity }
    let limited = false
    let note: string | null = null
    const ceiling = EXPORT_CEILING
    let needsLimiter = limit
    if (target != null && blocks.length) {
      opts.onStatus?.('Measuring loudness')
      const meter = new StreamMeter(SAMPLE_RATE, 2)
      for (let i = 0; i < blocks.length; i++) { if (opts.signal?.aborted) throw new DOMException('cancelled', 'AbortError'); await meter.pushAsync(await rawBlock(i), yieldUi) }
      const rep = meter.report()
      before = summary(rep)
      if (!keepRaw) restartPass(s)
      if (meter.nonFinite) warnings.push(`${meter.nonFinite} broken samples (NaN or infinite) in the sound were treated as silence.`)
      if (rep.shortMix) warnings.push('The mix is shorter than 0.4 s: its level was measured without gating, so the target is approximate.')
      if (!Number.isFinite(rep.integrated)) note = 'The mix is silent: nothing to normalise'
      else {
        const plan = normalizeGain(rep, { target, ceiling })
        gainDb = plan.gainDb
        needsLimiter = needsLimiter || plan.limit
        limited = plan.limit
      }
    } else if (blocks.length) {
      // not normalised: the "before" numbers are measured on the way out
    }
    const finalOnly = target == null && !limit && opts.final === false

    // one pass of final pieces (used for the real export, and for a dry run when the limiter will lower the level)
    const makePass = (sink: StreamMeter | null, free = false) => {
      let idx = 0
      let raw: Float32Array[] | null = null
      // silence before the first piece and after the last: the limiter's gain at the very ends is averaged with its
      // surroundings, so a peak in the first or last samples needs room around it
      let tail: Float32Array[] = [new Float32Array(Math.round(LIMIT_CONTEXT * SAMPLE_RATE)), new Float32Array(Math.round(LIMIT_CONTEXT * SAMPLE_RATE))]
      let g = Math.pow(10, gainDb / 20)
      return {
        setGain(db: number) { g = Math.pow(10, db / 20) },
        async next(): Promise<AudioBuffer | null> {
          if (idx >= blocks.length) return null
          raw ??= await rawBlock(idx)
          const cur = raw
          const hasNext = idx + 1 < blocks.length
          const nextRaw = hasNext ? await rawBlock(idx + 1) : null
          if (free) rawCache[idx] = undefined // the final pass is the last to read this block (the next one is read once more as its own)
          const n = cur[0].length
          let outCh: Float32Array[]
          if (finalOnly || (g === 1 && !needsLimiter)) outCh = cur
          else {
            const scaled = cur.map((ch) => { const o = new Float32Array(ch.length); for (let i = 0; i < o.length; i++) o[i] = ch[i] * g; return o })
            outCh = scaled
            if (needsLimiter) {
              const head = nextRaw ? nextRaw.map((ch) => { const o = new Float32Array(Math.min(ch.length, Math.round(LIMIT_HEAD * SAMPLE_RATE))); for (let i = 0; i < o.length; i++) o[i] = ch[i] * g; return o }) : [new Float32Array(Math.round(LIMIT_HEAD * SAMPLE_RATE)), new Float32Array(Math.round(LIMIT_HEAD * SAMPLE_RATE))]
              const ceilLin = Math.pow(10, ceiling / 20)
              let peak = 0
              for (const set of [tail, scaled, head]) for (const ch of set) for (let i = 0; i < ch.length; i++) { const v = Math.abs(ch[i]); if (v > peak) peak = v }
              if (peak > ceilLin * 0.55) {
                const joined = [0, 1].map((c) => { const o = new Float32Array(tail[c].length + n + head[c].length); o.set(tail[c], 0); o.set(scaled[c], tail[c].length); o.set(head[c], tail[c].length + n); return o })
                const gain = await limiterGainAsync(joined, SAMPLE_RATE, { ceiling })
                const off = tail[0].length
                let minG = 1
                outCh = scaled.map((ch) => { const o = new Float32Array(n); for (let i = 0; i < n; i++) { const k = gain[off + i]; if (k < minG) minG = k; o[i] = ch[i] * k } return o })
                if (minG < 0.9999) limited = true
              }
            }
            const keep = Math.round(LIMIT_CONTEXT * SAMPLE_RATE)
            tail = scaled.map((ch) => ch.slice(Math.max(0, n - keep)))
          }
          sink?.push(outCh)
          idx++
          raw = nextRaw
          return toBuffer(outCh, n)
        },
        get index() { return idx },
      }
    }

    // when the limiter will have to work, a dry pass tells how far it pulls the loudness down, and the gain is raised to make up for it
    if (target != null && needsLimiter && Number.isFinite(before.integrated)) {
      for (let attempt = 0; attempt < 2; attempt++) {
        opts.onStatus?.('Setting the limiter')
        const meter = new StreamMeter(SAMPLE_RATE, 2, { truePeak: false }) // only the integrated level is read here
        const dry = makePass(meter)
        while (await dry.next()) { if (opts.signal?.aborted) throw new DOMException('cancelled', 'AbortError'); await yieldUi() }
        if (!keepRaw) restartPass(s)
        const miss = target - meter.report().integrated
        if (!Number.isFinite(miss) || Math.abs(miss) <= 0.15) break
        gainDb += miss
      }
    }

    const finalMeter = new StreamMeter(SAMPLE_RATE, 2)
    const pass = makePass(finalMeter, keepRaw)
    pass.setGain(gainDb)
    let cursor = 0
    return {
      session: s,
      get cursor() { return cursor },
      async next() {
        const b = await pass.next()
        if (b) cursor += b.length / SAMPLE_RATE
        return b
      },
      loudness() {
        if (!blocks.length) return null
        const after = summary(finalMeter.report())
        if (target != null && !note && Number.isFinite(after.integrated) && Math.abs(after.integrated - target) > 0.5) note = `Reached ${after.integrated.toFixed(1)} LUFS: the true-peak limit held the level back`
        return { target, before: target != null ? before : after, after, gainDb, limited, ceiling, note, warnings }
      },
      dispose() { closeMixSession(s) },
    }
  } catch (e) { closeMixSession(s); throw e }
}

/** Mix the audible clips into one stereo buffer the length of the export (tests and short previews). `final: false`
 * leaves out the loudness stage (what the preview graph plays). */
export async function mixAudio(project: VideoProject, duration: number, opts: { final?: boolean; signal?: AbortSignal } = {}): Promise<AudioBuffer | null> {
  const p = flattenCompounds(project)
  if (!audibleClips(p).some((c) => c.start < duration)) return null
  const mix = await prepareMix(p, duration, { final: opts.final ?? false, signal: opts.signal })
  try {
    const parts: AudioBuffer[] = []
    for (let b = await mix.next(); b; b = await mix.next()) parts.push(b)
    const total = parts.reduce((n, b) => n + b.length, 0)
    const out = new AudioBuffer({ length: Math.max(1, total), numberOfChannels: 2, sampleRate: SAMPLE_RATE })
    let o = 0
    for (const b of parts) { out.copyToChannel(b.getChannelData(0) as Float32Array<ArrayBuffer>, 0, o); out.copyToChannel(b.getChannelData(1) as Float32Array<ArrayBuffer>, 1, o); o += b.length }
    return out
  } finally { mix.dispose() }
}

// ---------------------------------------------------------------- project loudness

export interface ProjectLoudness {
  /** LUFS (−Infinity when silent), LU, dBTP, dBFS. */
  integrated: number
  lra: number
  truePeak: number
  samplePeak: number
  /** Momentary (400 ms) and short-term (3 s) loudness every 100 ms, LUFS. */
  momentary: Float32Array
  shortTerm: Float32Array
  momentaryMax: number
  shortTermMax: number
  duration: number
  /** Nothing audible. */
  silent: boolean
  /** Shorter than 400 ms: `integrated` is an ungated level, not a BS.1770 gated one. */
  shortMix?: boolean
  /** Things the editor should know (a very short mix, NaN samples that were measured as silence). */
  warnings: string[]
  /** The project's loudness target and what an export would do: the gain, and whether the limiter would be needed. */
  target: number | null
  gainDb: number
  wouldLimit: boolean
}

/** What makes two measurements the same: the audible clips, the strips and the mix settings. */
export function mixSignature(project: VideoProject): string {
  const p = flattenCompounds(project)
  const clips = audibleClips(p).map((c) => [c.id, c.sourceUrl, c.start, c.duration, c.in, c.speed ?? 1, c.freezes ?? null, c.reverse ? 1 : 0, c.preservePitch === false ? 0 : 1, c.keyframes?.volume ?? null])
  return JSON.stringify([clips, audioParamsKey(p)])
}

const loudCache = new Map<string, ProjectLoudness>()

/** The loudness of the project's mix as the export would produce it before the loudness stage (denoise and ducking
 * included), measured by the streaming R128 meter. Cached by `mixSignature`. */
export async function measureProjectLoudness(project: VideoProject, opts: { signal?: AbortSignal; onProgress?: (p: number) => void } = {}): Promise<ProjectLoudness> {
  const p = flattenCompounds(project)
  const key = mixSignature(p)
  const hit = loudCache.get(key)
  if (hit) return hit
  const duration = contentEnd(p)
  const s = newMixSession(p, duration)
  try {
    const target = p.loudnessTarget ?? null
    if (!s.clips.length || duration <= 0) {
      return { integrated: -Infinity, lra: 0, truePeak: -Infinity, samplePeak: -Infinity, momentary: new Float32Array(0), shortTerm: new Float32Array(0), momentaryMax: -Infinity, shortTermMax: -Infinity, duration, silent: true, target, gainDb: 0, wouldLimit: false, warnings: [] }
    }
    await ensureDenoised(s, opts.signal)
    s.duck = await computeDuckCurve(s, opts.signal)
    const meter = new StreamMeter(SAMPLE_RATE, 2)
    for (let a = 0; a < duration - 1e-9; a += AUDIO_CHUNK_SECONDS) {
      if (opts.signal?.aborted) throw new DOMException('cancelled', 'AbortError')
      const b = Math.min(duration, a + AUDIO_CHUNK_SECONDS)
      const buf = await renderChunk(s, a, b)
      await meter.pushAsync([buf.getChannelData(0), buf.getChannelData(1)], yieldUi)
      opts.onProgress?.(b / duration)
    }
    const r = meter.report()
    const plan = target != null && Number.isFinite(r.integrated) ? normalizeGain(r, { target, ceiling: EXPORT_CEILING }) : { gainDb: 0, limit: false }
    const out: ProjectLoudness = {
      integrated: r.integrated, lra: r.range, truePeak: r.truePeak, samplePeak: r.samplePeak,
      momentary: r.momentary, shortTerm: r.shortTerm, momentaryMax: r.momentaryMax, shortTermMax: r.shortTermMax,
      duration, silent: !Number.isFinite(r.integrated), target, gainDb: plan.gainDb, wouldLimit: plan.limit,
      ...(r.shortMix ? { shortMix: true } : {}),
      warnings: [
        ...(meter.nonFinite ? [`${meter.nonFinite} broken samples (NaN or infinite) in the sound were treated as silence.`] : []),
        ...(r.shortMix ? ['The mix is shorter than 0.4 s: its level was measured without gating (short-term), not as a gated integrated value.'] : []),
      ],
    }
    loudCache.set(key, out)
    if (loudCache.size > 6) loudCache.delete(loudCache.keys().next().value!)
    return out
  } finally { closeMixSession(s) }
}

// ---------------------------------------------------------------- beats

export interface BeatAnalysis extends OnsetResult { clipId: string; clipStart: number; clipDuration: number }

/** Onsets and beats of an audio clip's sound as heard on the timeline (its speed and trim applied). Times in the
 * result are clip-local seconds. Reads at most the first 10 minutes. */
export async function analyseClipBeats(project: VideoProject, clipId: string, signal?: AbortSignal): Promise<BeatAnalysis | null> {
  const p = flattenCompounds(project)
  const c = p.clips.find((x) => x.id === clipId && x.kind === 'audio' && !!x.sourceUrl)
  if (!c) return null
  const clip = c.duration > 600 ? { ...c, duration: 600 } : c
  const s = newMixSession({ ...p, clips: [clip] }, clip.start + clip.duration)
  try {
    const pcm = await renderClipSpan(s, clip, signal)
    const r = detectOnsets(pcm, SAMPLE_RATE)
    return { ...r, clipId, clipStart: clip.start, clipDuration: clip.duration }
  } finally { closeMixSession(s) }
}

export type { Bus }
