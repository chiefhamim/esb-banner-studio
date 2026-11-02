// Preview sound through one Web Audio graph, scheduled against the playback clock (replaces Phase 0's <audio>
// element per file). Each audible clip — footage sound (its linked A-track clip), music, voiceover — is decoded in
// pieces by mediabunny (AudioBufferSink) a short way ahead of the playhead, and every piece is started at the exact
// AudioContext time that matches its timeline time:
//
//   clip gain (gain dB × volume × fades) → clip pan → track (fader, mute/solo, pan) → bus → ducking → master → speakers
//
// that is the ONE graph of audioGraph.ts, which the export builds again offline (audioRender.ts). Noise-reduced clips
// play their cached render (made in a worker, denoiseJob.ts); the ducking curve is made in the background from the voice
// bus (the same code as the export) and applied as automation on the music bus when it is ready.
//
// The clock maps wall time to context time with getOutputTimestamp() (the time the speakers are playing now), so a
// sound is heard at the same wall-clock instant its picture is drawn. The export mixes with the same gain rules
// (`clipGain`), offline.

import { AudioBufferSink } from 'mediabunny'
import type { Clip, VideoProject } from '../timeline'
import { audibleClips } from '../timeline'
import { inputFor } from '../media'
import { isPlainSpeed } from './animation'
import { PcmSource } from './pcmSource'
import { ClipSpeedAudio } from './speedAudio'
import { applyStatic, automate, automateDuck, buildMixGraph, clipGainFn, clipStrip, readLevel } from './audioGraph'
import type { Level, MixGraph } from './audioGraph'
import { cachedDuck, denoiseClip, denoisedFor, needsDuck, prepareDuckForPreview } from './audioRender'
import type { GainCurve } from '../audio/ducking'
import { busOf, duckingOf, masterOf } from '../audioModel'
import type { Bus } from '../audioModel'
import { useVideoStore } from '../videoStore'
import { flattenCompounds } from '../timeline'

/** Schedule this far ahead of the playhead (seconds). */
const LOOKAHEAD = 1.5
/** A file mediabunny cannot read is decoded whole by Web Audio — only up to this size (its PCM can be ten times
 * bigger); a bigger one plays without sound and the desk says so. */
export const FALLBACK_MAX_BYTES = 96 * 1024 * 1024
/** Decoded fallback sound kept for the session (bytes of PCM), oldest dropped first. */
const FALLBACK_CACHE_BYTES = 512 * 1024 * 1024

/** Why a source has no preview sound ('' = it has sound, or none was asked for). */
export type SoundProblem = { url: string; why: string }

/** The plain volume a clip plays at (0 when it or its track is muted): the Phase 0–3 rule, kept for the callers that read
 * it. The mix itself is the graph (audioGraph.ts `clipGainFn`: also clip gain and fades, track fader, solo). */
export function clipGain(project: Pick<VideoProject, 'tracks'>, c: Clip): number {
  const track = project.tracks.find((t) => t.id === c.trackId)
  if (c.muted || track?.muted) return 0
  return Math.max(0, Math.min(1, c.volume ?? 1))
}

/** What changes the scheduled sound (any change restarts it; a volume change only moves a gain). */
export function audioSignature(project: VideoProject): string {
  return audibleClips(project).map((c) => `${c.id}|${c.trackId}|${busOf(project, c)}|${c.sourceUrl}|${c.start}|${c.duration}|${c.in}|${JSON.stringify(c.speed ?? 1)}|${JSON.stringify((c as { freezes?: unknown }).freezes ?? null)}|${(c as { reverse?: boolean }).reverse ? 1 : 0}|${(c as { preservePitch?: boolean }).preservePitch === false ? 0 : 1}|${c.keyframes?.volume ? JSON.stringify(c.keyframes.volume) : ''}|${denoisedFor(c) ? 1 : 0}`).join(';') + (masterOf(project).limiter ? '|lim' : '')
}

/** Idle source readers kept for the next start. */
const PCM_KEEP = 4

interface Running { stop(): void; strip: ReturnType<typeof clipStrip>; clip: Clip }

/** What preview needs to re-time automation: timeline time t0 is context time `base`. */
interface Mapping { t0: number; base: number }

export class AudioEngine {
  ctx: AudioContext | null = null
  /** The node the graph's output joins (and the test tap sits behind): connected to the speakers. */
  private sink: GainNode | null = null
  /** The output node (tests connect a calibration burst to it). */
  get master(): GainNode | null { return this.sink }
  private graph: MixGraph | null = null
  private map: Mapping = { t0: 0, base: 0 }
  private last: { project: VideoProject; playhead: () => number } | null = null
  private prepTimer: ReturnType<typeof setTimeout> | undefined
  private prepUnsub: (() => void) | null = null
  private running: Running[] = []
  private session = 0
  /** Test tap: an analyser on the master (A/V sync measurement). */
  tap: ((buf: Float32Array, ctxTime: number) => void) | null = null
  private tapNode: ScriptProcessorNode | null = null
  /** Whole-file decodes of sources mediabunny cannot read: one per URL for the session (shared by every restart). */
  private fallback = new Map<string, Promise<AudioBuffer | null>>()
  private fallbackBytes = new Map<string, number>()
  /** Source PCM readers for speed-changed clips, kept per URL across play/seek restarts (their decoded 2 s blocks are
   * what a restart would otherwise decode again); idle ones beyond PCM_KEEP are closed, oldest first. */
  private pcms = new Map<string, { pcm: PcmSource; users: number; idleAt: number }>()
  private acquirePcm(url: string): PcmSource {
    let e = this.pcms.get(url)
    if (!e) { e = { pcm: new PcmSource(url, (u) => this.wholeFile(u)), users: 0, idleAt: 0 }; this.pcms.set(url, e) }
    e.users++
    return e.pcm
  }
  private releasePcm(url: string) {
    const e = this.pcms.get(url)
    if (!e) return
    e.users = Math.max(0, e.users - 1)
    if (e.users) return
    e.idleAt = performance.now()
    const idle = [...this.pcms.entries()].filter(([, x]) => !x.users).sort((a, b) => a[1].idleAt - b[1].idleAt)
    for (const [u, x] of idle.slice(0, Math.max(0, idle.length - PCM_KEEP))) { x.pcm.dispose(); this.pcms.delete(u) }
  }
  /** Close the cached readers nothing plays (a project was replaced, or a file relinked). */
  releaseSources() {
    for (const [u, x] of this.pcms) if (!x.users) { x.pcm.dispose(); this.pcms.delete(u) }
  }
  /** Sources whose sound cannot be played here, with the reason. */
  readonly unsupported = new Map<string, string>()
  /** Called when a source turns out to have no playable sound (the desk shows a note). */
  onUnsupported: (p: SoundProblem) => void = () => {}

  private ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })
    }
    // (a test may hand the engine an OfflineAudioContext as `ctx`: the preview graph is then rendered, not played)
    if (!this.sink) {
      this.sink = this.ctx.createGain()
      this.sink.connect(this.ctx.destination)
    }
    return this.ctx
  }

  /** Context time heard at wall time `perfMs` (performance.now()). */
  ctxTimeAt(perfMs: number): number {
    const ctx = this.ensure()
    const ts = ctx.getOutputTimestamp?.()
    if (ts && ts.performanceTime && ts.contextTime != null && ts.performanceTime > 0) return ts.contextTime + (perfMs - ts.performanceTime) / 1000
    return ctx.currentTime + (perfMs - performance.now()) / 1000 + (ctx.outputLatency || ctx.baseLatency || 0)
  }

  /** Wall time a context time is heard. */
  perfAt(ctxTime: number): number {
    const ctx = this.ensure()
    const ts = ctx.getOutputTimestamp?.()
    if (ts && ts.performanceTime && ts.contextTime != null && ts.performanceTime > 0) return ts.performanceTime + (ctxTime - ts.contextTime) * 1000
    return performance.now() + (ctxTime - ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0)) * 1000
  }

  /** Start the sound at timeline time `t0`, heard at wall time `originPerf`. `playhead()` reads the clock. */
  async start(project: VideoProject, t0: number, originPerf: number, playhead: () => number) {
    this.stop()
    const ctx = this.ensure()
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {})
    this.installTap()
    const session = ++this.session
    // one mapping for the whole start (re-reading the output timestamp per piece would jitter the joins)
    const base = this.ctxTimeAt(originPerf)
    this.map = { t0, base }
    this.last = { project, playhead }
    const ctxOf = (tl: number) => base + (tl - t0)
    const g = buildMixGraph(ctx, project, this.sink!, { analysers: true, limiter: true })
    this.graph = g
    this.watch()
    for (const c of audibleClips(project)) {
      if (c.start + c.duration <= t0) continue
      const strip = clipStrip(g, project, c, true)
      const nodes = new Set<AudioBufferSourceNode>()
      let alive = true
      this.running.push({ clip: c, strip, stop: () => { alive = false; for (const n of nodes) { try { n.stop() } catch { /* not started */ } n.disconnect() } nodes.clear(); strip.input.disconnect(); strip.pan.disconnect() } })
      automate(strip.input.gain, strip.fn, this.fromFor(c, t0), c.start + c.duration, ctxOf)
      const dn = denoisedFor(c)
      if (c.denoise && !dn) void denoiseClip(c, flattenCompounds(project)).then((b) => { if (b && session === this.session) this.refresh() })
      void this.scheduleClip(c, t0, base, playhead, strip.input, nodes, () => alive && session === this.session, dn)
    }
    // ducking: the cached curve now, or when the background job has made it
    const duck = needsDuck(project) ? cachedDuck(project) : null
    if (duck) automateDuck(g.duck.gain, duck, t0, this.endOf(project), ctxOf)
    else if (needsDuck(project)) void prepareDuckForPreview(project).then((curve) => { if (curve && session === this.session && this.graph === g) this.applyDuck(curve, project) })
  }

  /** Where a clip's automation starts: its start, or the playhead when it began earlier (an event in the past is skipped). */
  private fromFor(c: Clip, t0: number) {
    const ctx = this.ctx!
    const nowTl = this.map.t0 + (ctx.currentTime + 0.01 - this.map.base)
    return Math.max(c.start, t0, Math.min(nowTl, c.start + c.duration - 0.001))
  }
  private endOf(project: VideoProject) { let e = 0; for (const c of project.clips) e = Math.max(e, c.start + c.duration); return e }

  /** Schedule a ducking curve on the music bus from now to the end of the project (re-done after any change). */
  private applyDuck(curve: GainCurve | null, project: VideoProject) {
    const g = this.graph
    const ctx = this.ctx
    if (!g || !ctx) return
    const now = ctx.currentTime
    const hold = g.duck.gain as AudioParam & { cancelAndHoldAtTime?: (t: number) => void }
    try { if (hold.cancelAndHoldAtTime) hold.cancelAndHoldAtTime(now); else g.duck.gain.cancelScheduledValues(now) } catch { /* nothing scheduled */ }
    const ctxOf = (tl: number) => this.map.base + (tl - this.map.t0)
    const nowTl = this.map.t0 + (now + 0.01 - this.map.base)
    if (!curve || !duckingOf(project).enabled) { g.duck.gain.setTargetAtTime(1, now, 0.02); return }
    automateDuck(g.duck.gain, curve, nowTl, Math.max(nowTl + 0.01, this.endOf(project)), ctxOf)
  }

  /** The sound is restarted at the playhead (a noise-reduced render became ready). */
  private refresh() {
    const l = this.last
    if (!l || !this.graph) return
    void this.start(l.project, l.playhead(), performance.now(), l.playhead)
  }

  /** Background work for the preview: the noise-reduced renders and the ducking curve of the project on the desk are made
   * as soon as it changes (a short pause after the last edit), so pressing play finds them ready. */
  prepare(project: VideoProject) {
    const p = flattenCompounds(project)
    for (const c of p.clips) if (c.kind === 'audio' && c.denoise && c.sourceUrl) void denoiseClip(c, p)
    if (needsDuck(p) && !cachedDuck(p)) void prepareDuckForPreview(p).then((curve) => { if (curve && this.graph && this.last) this.applyDuck(curve, this.last.project) })
  }

  /** Watch the store: prepare the background renders after edits. Installed once. */
  private watch() {
    if (this.prepUnsub) return
    this.prepUnsub = useVideoStore.subscribe((s, prev) => {
      if (s.project === prev.project) return
      clearTimeout(this.prepTimer)
      this.prepTimer = setTimeout(() => this.prepare(useVideoStore.getState().project), 500)
    })
  }

  /** Peak and RMS (dBFS) of the master, every bus and every audio track while the sound plays (null when it is not). */
  levels(): { master: Level; buses: Partial<Record<Bus, Level>>; tracks: Record<string, Level> } | null {
    const g = this.graph
    if (!g || !g.masterAnalyser || !this.running.length) return null
    const buses: Partial<Record<Bus, Level>> = {}
    for (const [b, a] of Object.entries(g.busAnalysers)) buses[b as Bus] = readLevel(a!)
    const tracks: Record<string, Level> = {}
    for (const t of g.tracks.values()) if (t.analyser) { const l = readLevel(t.analyser); const o = tracks[t.trackId]; if (!o || l.peak > o.peak) tracks[t.trackId] = l }
    return { master: readLevel(g.masterAnalyser), buses, tracks }
  }

  private async scheduleClip(c: Clip, t0: number, base: number, playhead: () => number, out: GainNode, nodes: Set<AudioBufferSourceNode>, alive: () => boolean, denoised: AudioBuffer | null = null) {
    const ctx = this.ctx!
    const from = Math.max(t0, c.start)
    const srcFrom = (c.in || 0) + (from - c.start)
    const srcTo = (c.in || 0) + c.duration
    const ctxOf = (tl: number) => base + (tl - t0)
    const clipEndCtx = ctxOf(c.start + c.duration)
    const place = (buffer: AudioBuffer, srcTs: number) => {
      const tl = c.start + (srcTs - (c.in || 0)) // timeline time of the buffer's first sample
      let when = ctxOf(tl)
      let offset = 0
      const minWhen = Math.max(ctx.currentTime + 0.005, ctxOf(from))
      if (when < minWhen) { offset = minWhen - when; when = minWhen }
      const dur = Math.min(buffer.duration - offset, clipEndCtx - when)
      if (dur <= 0) return
      const n = ctx.createBufferSource()
      n.buffer = buffer
      n.connect(out)
      n.start(when, offset, dur)
      n.onended = () => { nodes.delete(n); n.disconnect() }
      nodes.add(n)
    }
    if (denoised) {
      // the noise-reduced render: one buffer for the whole clip, started at the playhead's offset into it
      const when = Math.max(ctx.currentTime + 0.005, ctxOf(from))
      const offset = (from - c.start) + (when - ctxOf(from))
      if (offset < denoised.duration) {
        const n = ctx.createBufferSource()
        n.buffer = denoised
        n.connect(out)
        n.start(when, offset, Math.min(denoised.duration - offset, clipEndCtx - when))
        n.onended = () => { nodes.delete(n); n.disconnect() }
        nodes.add(n)
      }
      return
    }
    if (!isPlainSpeed(c)) { await this.scheduleSpeedClip(c, from, ctxOf, out, nodes, alive, playhead); return }
    const input = (() => { try { return inputFor(c.sourceUrl!) } catch { return null } })()
    try {
      // undefined = the file could not be read by mediabunny; null = it was read and has no sound
      const track = input ? await input.getPrimaryAudioTrack().catch(() => undefined) : undefined
      if (track && (await track.canDecode().catch(() => false))) {
        const sink = new AudioBufferSink(track)
        for await (const wb of sink.buffers(srcFrom, srcTo)) {
          if (!alive()) break
          place(wb.buffer, wb.timestamp)
          // stay LOOKAHEAD ahead of the playhead
          const tl = c.start + (wb.timestamp + wb.duration - (c.in || 0))
          while (alive() && tl - playhead() > LOOKAHEAD) await new Promise((r) => setTimeout(r, 50))
        }
        return
      }
      if (!alive() || track === null) return
      // a file mediabunny cannot read: decode it whole (Web Audio's own decoder) once, and play the clip's span
      const buf = await this.wholeFile(c.sourceUrl!)
      if (buf && alive()) place(buf, 0)
    } catch { /* no sound for this clip */ } finally {
      try { input?.dispose() } catch { /* gone */ }
    }
  }

  /** A speed-changed clip: its sound made by the same stretcher as the export (engine/timeStretch.ts; pitch kept
   * unless the clip says otherwise), in half-second pieces each started at the context time of its first sample. */
  private async scheduleSpeedClip(c: Clip, from: number, ctxOf: (tl: number) => number, out: GainNode, nodes: Set<AudioBufferSourceNode>, alive: () => boolean, playhead: () => number) {
    const ctx = this.ctx!
    const url = c.sourceUrl!
    const pcm = this.acquirePcm(url)
    const sa = new ClipSpeedAudio(c, pcm, ctx.sampleRate)
    const end = c.start + c.duration
    const PIECE = 0.5
    try {
      // pieces on the clip's own sample grid, so consecutive pieces join without a gap or an overlap
      let n = Math.max(0, Math.floor((from - c.start) * ctx.sampleRate))
      while (alive()) {
        const a = c.start + n / ctx.sampleRate
        if (a >= end - 1e-6) break
        const len = Math.max(1, Math.min(Math.round(PIECE * ctx.sampleRate), Math.ceil((end - a) * ctx.sampleRate)))
        const b = a + len / ctx.sampleRate
        const chans = await sa.render(a, b)
        if (!alive()) break
        if (chans && chans[0]?.length) {
          const buf = ctx.createBuffer(2, chans[0].length, ctx.sampleRate)
          buf.copyToChannel(chans[0] as Float32Array<ArrayBuffer>, 0)
          buf.copyToChannel((chans[1] ?? chans[0]) as Float32Array<ArrayBuffer>, 1)
          let when = ctxOf(a)
          let offset = 0
          const minWhen = ctx.currentTime + 0.005
          if (when < minWhen) { offset = minWhen - when; when = minWhen }
          if (offset < buf.duration) {
            const node = ctx.createBufferSource()
            node.buffer = buf
            node.connect(out)
            node.start(when, offset)
            node.onended = () => { nodes.delete(node); node.disconnect() }
            nodes.add(node)
          }
        }
        n += len
        while (alive() && b - playhead() > LOOKAHEAD) await new Promise((r) => setTimeout(r, 50))
      }
    } catch { /* no sound for this clip */ } finally {
      this.releasePcm(url)
    }
  }

  /** The whole file's sound through Web Audio's decoder, decoded once per URL (size-guarded). Null = no sound. */
  private wholeFile(url: string): Promise<AudioBuffer | null> {
    const hit = this.fallback.get(url)
    if (hit) { this.fallback.delete(url); this.fallback.set(url, hit); return hit }
    const ctx = this.ensure()
    const p = (async () => {
      try {
        const res = await fetch(url)
        const len = Number(res.headers.get('content-length') || 0)
        if (len > FALLBACK_MAX_BYTES) { try { await res.body?.cancel() } catch { /* gone */ } throw new Error('too big') }
        const bytes = await res.arrayBuffer()
        if (bytes.byteLength > FALLBACK_MAX_BYTES) throw new Error('too big')
        const buf = await ctx.decodeAudioData(bytes)
        this.fallbackBytes.set(url, buf.length * buf.numberOfChannels * 4)
        this.trimFallback(url)
        return buf
      } catch (e) {
        const why = (e as Error)?.message === 'too big' ? 'Sound not supported: this file’s audio cannot be read here and the file is too big to decode whole' : 'Sound not supported: this file’s audio cannot be decoded here'
        this.unsupported.set(url, why)
        this.fallbackBytes.set(url, 0)
        this.onUnsupported({ url, why })
        return null
      }
    })()
    this.fallback.set(url, p)
    return p
  }

  private trimFallback(keep: string) {
    let total = 0
    for (const b of this.fallbackBytes.values()) total += b
    for (const url of [...this.fallback.keys()]) {
      if (total <= FALLBACK_CACHE_BYTES) break
      if (url === keep) continue
      total -= this.fallbackBytes.get(url) ?? 0
      this.fallback.delete(url)
      this.fallbackBytes.delete(url)
    }
  }

  /** Forget decoded fallback sound of URLs not in `keep` (a different project is on the desk). */
  releaseSound(keep: Set<string>) {
    for (const url of [...this.fallback.keys()]) if (!keep.has(url)) { this.fallback.delete(url); this.fallbackBytes.delete(url); this.unsupported.delete(url) }
  }

  /** Move gains, pans, faders, the master and the ducking to the project's current values (no restart). */
  updateGains(project: VideoProject) {
    const ctx = this.ctx
    const g = this.graph
    if (!ctx || !g) return
    const now = ctx.currentTime
    const ctxOf = (tl: number) => this.map.base + (tl - this.map.t0)
    const nowTl = this.map.t0 + (now + 0.01 - this.map.base)
    if (this.last) this.last = { ...this.last, project }
    for (const r of this.running) {
      const c = project.clips.find((x) => x.id === r.clip.id)
      const param = r.strip.input.gain
      const hold = param as AudioParam & { cancelAndHoldAtTime?: (t: number) => void }
      try { if (hold.cancelAndHoldAtTime) hold.cancelAndHoldAtTime(now); else param.cancelScheduledValues(now) } catch { /* nothing scheduled */ }
      if (!c) { param.setTargetAtTime(0, now, 0.01); continue }
      r.clip = c
      r.strip.fn = clipGainFn(c)
      if (r.strip.fn.ranges.length === 0) param.setTargetAtTime(r.strip.fn.at(nowTl), now, 0.01)
      else automate(param, r.strip.fn, Math.max(nowTl, c.start), Math.max(c.start + c.duration, nowTl + 0.01), ctxOf)
      try { r.strip.pan.pan.setTargetAtTime(c.pan ?? 0, now, 0.01) } catch { /* gone */ }
    }
    applyStatic(g, project, now)
    this.applyDuck(needsDuck(project) ? cachedDuck(project) : null, project)
  }

  stop() {
    this.session++
    for (const r of this.running) r.stop()
    this.running = []
    if (this.graph) { try { this.graph.out.disconnect(); this.graph.master.disconnect() } catch { /* gone */ } this.graph = null }
  }

  private installTap() {
    if (!this.tap || this.tapNode || !this.ctx || !this.sink) return
    const n = this.ctx.createScriptProcessor(1024, 2, 2)
    n.onaudioprocess = (e) => {
      const inp = e.inputBuffer.getChannelData(0)
      e.outputBuffer.getChannelData(0).set(inp)
      e.outputBuffer.getChannelData(1).set(e.inputBuffer.getChannelData(1))
      this.tap?.(inp, e.playbackTime)
    }
    this.sink.disconnect()
    this.sink.connect(n)
    n.connect(this.ctx.destination)
    this.tapNode = n
  }

  dispose() {
    this.stop()
    for (const x of this.pcms.values()) x.pcm.dispose()
    this.pcms.clear()
    void this.ctx?.close().catch(() => {})
    this.ctx = null
    this.sink = null
    this.graph = null
    this.prepUnsub?.()
    this.prepUnsub = null
    this.tapNode = null
  }
}

let shared: AudioEngine | null = null
export const audioEngine = () => (shared ??= new AudioEngine())
