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

/** Schedule this far ahead of the playhead (seconds). */
const LOOKAHEAD = 1.5

/** The gain a clip plays at (0 when it or its track is muted). One rule for preview and export. */
export function clipGain(project: Pick<VideoProject, 'tracks'>, c: Clip): number {
  const track = project.tracks.find((t) => t.id === c.trackId)
  if (c.muted || track?.muted) return 0
  return Math.max(0, Math.min(1, c.volume ?? 1))
}

/** What changes the scheduled sound (any change restarts it; a volume change only moves a gain). */
export function audioSignature(project: VideoProject): string {
  return audibleClips(project).map((c) => `${c.id}|${c.sourceUrl}|${c.start}|${c.duration}|${c.in}`).join(';')
}

interface Running { stop(): void; gain: GainNode; clip: Clip }

export class AudioEngine {
  ctx: AudioContext | null = null
  private master: GainNode | null = null
  private running: Running[] = []
  private session = 0
  /** Test tap: an analyser on the master (A/V sync measurement). */
  tap: ((buf: Float32Array, ctxTime: number) => void) | null = null
  private tapNode: ScriptProcessorNode | null = null

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
    const input = (() => { try { return inputFor(c.sourceUrl!) } catch { return null } })()
    try {
      const track = input ? await input.getPrimaryAudioTrack().catch(() => null) : null
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
      if (!alive()) return
      // a file mediabunny cannot read: decode it whole (Web Audio's own decoder) and play the clip's span
      const bytes = await (await fetch(c.sourceUrl!)).arrayBuffer()
      const buf = await ctx.decodeAudioData(bytes)
      if (alive()) place(buf, 0)
    } catch { /* no sound for this clip */ } finally {
      try { input?.dispose() } catch { /* gone */ }
    }
  }

  /** Move gains to the project's current volumes and mutes (no restart). */
  updateGains(project: VideoProject) {
    for (const r of this.running) {
      const c = project.clips.find((x) => x.id === r.clip.id)
      const g = c ? clipGain(project, c) : 0
      if (this.ctx) r.gain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.01)
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
    void this.ctx?.close().catch(() => {})
    this.ctx = null
    this.master = null
    this.tapNode = null
  }
}

let shared: AudioEngine | null = null
export const audioEngine = () => (shared ??= new AudioEngine())
