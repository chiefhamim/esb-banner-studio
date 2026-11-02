// Preview sound through one Web Audio graph, scheduled against the playback clock (replaces Phase 0's <audio>
// element per file). Each audible clip — footage sound (its linked A-track clip), music, voiceover — is decoded in
// pieces by mediabunny (AudioBufferSink) a short way ahead of the playhead, and every piece is started at the exact
// AudioContext time that matches its timeline time:
//
//   clip gain (volume, clip mute) → track gain (track mute) → master → speakers
//
// The clock maps wall time to context time with getOutputTimestamp() (the time the speakers are playing now), so a
// sound is heard at the same wall-clock instant its picture is drawn. The export mixes with the same gain rules
// (`clipGain`), offline.

import { AudioBufferSink } from 'mediabunny'
import type { Clip, VideoProject } from '../timeline'
import { audibleClips } from '../timeline'
import { inputFor } from '../media'
import { animated, isPlainSpeed, sampleProp } from './animation'
import { PcmSource } from './pcmSource'
import { ClipSpeedAudio } from './speedAudio'

/** Schedule this far ahead of the playhead (seconds). */
const LOOKAHEAD = 1.5
/** A file mediabunny cannot read is decoded whole by Web Audio — only up to this size (its PCM can be ten times
 * bigger); a bigger one plays without sound and the desk says so. */
export const FALLBACK_MAX_BYTES = 96 * 1024 * 1024
/** Decoded fallback sound kept for the session (bytes of PCM), oldest dropped first. */
const FALLBACK_CACHE_BYTES = 512 * 1024 * 1024

/** Why a source has no preview sound ('' = it has sound, or none was asked for). */
export type SoundProblem = { url: string; why: string }

/** The gain a clip plays at (0 when it or its track is muted). One rule for preview and export. */
export function clipGain(project: Pick<VideoProject, 'tracks'>, c: Clip): number {
  const track = project.tracks.find((t) => t.id === c.trackId)
  if (c.muted || track?.muted) return 0
  return Math.max(0, Math.min(1, c.volume ?? 1))
}

/** What changes the scheduled sound (any change restarts it; a volume change only moves a gain). */
export function audioSignature(project: VideoProject): string {
  return audibleClips(project).map((c) => `${c.id}|${c.sourceUrl}|${c.start}|${c.duration}|${c.in}|${JSON.stringify(c.speed ?? 1)}|${JSON.stringify((c as { freezes?: unknown }).freezes ?? null)}|${(c as { reverse?: boolean }).reverse ? 1 : 0}|${(c as { preservePitch?: boolean }).preservePitch === false ? 0 : 1}|${c.keyframes?.volume ? JSON.stringify(c.keyframes.volume) : ''}`).join(';')
}

/** Idle source readers kept for the next start. */
const PCM_KEEP = 4

interface Running { stop(): void; gain: GainNode; clip: Clip }

export class AudioEngine {
  ctx: AudioContext | null = null
  private master: GainNode | null = null
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
      this.master = this.ctx.createGain()
      this.master.connect(this.ctx.destination)
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
    const trackGains = new Map<string, GainNode>()
    for (const c of audibleClips(project)) {
      if (c.start + c.duration <= t0) continue
      let tg = trackGains.get(c.trackId)
      if (!tg) { tg = ctx.createGain(); tg.connect(this.master!); trackGains.set(c.trackId, tg) }
      const g = ctx.createGain()
      g.gain.value = clipGain(project, c)
      g.connect(tg)
      const nodes = new Set<AudioBufferSourceNode>()
      let alive = true
      this.running.push({ clip: c, gain: g, stop: () => { alive = false; for (const n of nodes) { try { n.stop() } catch { /* not started */ } n.disconnect() } nodes.clear(); g.disconnect() } })
      this.volumeAutomation(c, g, Math.max(t0, c.start), (tl) => base + (tl - t0))
      void this.scheduleClip(c, t0, base, playhead, g, nodes, () => alive && session === this.session)
    }
  }

  private async scheduleClip(c: Clip, t0: number, base: number, playhead: () => number, out: GainNode, nodes: Set<AudioBufferSourceNode>, alive: () => boolean) {
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

  /** A clip's volume keyframes as a gain curve from timeline time `from` to its end (100 values a second). */
  private volumeAutomation(c: Clip, g: GainNode, from: number, ctxOf: (tl: number) => number) {
    if (!animated(c, 'volume') || !this.ctx) return
    const end = c.start + c.duration
    const startCtx = Math.max(this.ctx.currentTime + 0.01, ctxOf(from))
    const t0 = from + (startCtx - ctxOf(from))
    const dur = end - t0
    if (dur <= 0.02) return
    const n = Math.min(60000, Math.max(2, Math.ceil(dur * 100) + 1))
    const curve = new Float32Array(n)
    const mute = g.gain.value === 0 ? 0 : 1
    for (let i = 0; i < n; i++) curve[i] = mute * Math.max(0, Math.min(1, sampleProp(c, 'volume', t0 + (dur * i) / (n - 1) - c.start, c.volume ?? 1)))
    try { g.gain.setValueCurveAtTime(curve, startCtx, dur) } catch { /* keep the static gain */ }
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

  /** Move gains to the project's current volumes and mutes (no restart). */
  updateGains(project: VideoProject) {
    for (const r of this.running) {
      const c = project.clips.find((x) => x.id === r.clip.id)
      const g = c ? clipGain(project, c) : 0
      // a clip with volume keyframes follows its curve (scheduled at start); others move to the new gain
      if (this.ctx && !(c && animated(c, 'volume'))) { try { r.gain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.01) } catch { /* automation running */ } }
    }
  }

  stop() {
    this.session++
    for (const r of this.running) r.stop()
    this.running = []
  }

  private installTap() {
    if (!this.tap || this.tapNode || !this.ctx || !this.master) return
    const n = this.ctx.createScriptProcessor(1024, 2, 2)
    n.onaudioprocess = (e) => {
      const inp = e.inputBuffer.getChannelData(0)
      e.outputBuffer.getChannelData(0).set(inp)
      e.outputBuffer.getChannelData(1).set(e.inputBuffer.getChannelData(1))
      this.tap?.(inp, e.playbackTime)
    }
    this.master.disconnect()
    this.master.connect(n)
    n.connect(this.ctx.destination)
    this.tapNode = n
  }

  dispose() {
    this.stop()
    for (const x of this.pcms.values()) x.pcm.dispose()
    this.pcms.clear()
    void this.ctx?.close().catch(() => {})
    this.ctx = null
    this.master = null
    this.tapNode = null
  }
}

let shared: AudioEngine | null = null
export const audioEngine = () => (shared ??= new AudioEngine())
