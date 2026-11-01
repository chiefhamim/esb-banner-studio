// The monitor's frame supply: one decoder per preview source (the proxy when Part A has made one), a shared frame
// cache, look-ahead streams while playing and exact decodes while paused. It hands render.ts a FrameLookup for each
// draw and counts what the editor would see: frames shown exactly, frames held or skipped (dropped), and how long a
// scrub took to show the frame under the cursor.

import type { Clip, VideoProject } from '../timeline'
import { isActive } from '../timeline'
import { getCachedVideo } from '../compositor'
import { FrameCache } from './frameCache'
import type { FrameEntry } from './frameCache'
import { FrameStream, SourceDecoder } from './decoder'
import { previewUrl } from './mediaSource'
import type { FrameInput, FrameLookup } from './render'
import { srcTime } from './render'

/** How far ahead of the playhead streams decode (seconds), and how soon a coming clip starts decoding. */
const AHEAD = 0.4
const PREROLL = 1.0
/** A stream more than this behind the playhead is restarted at the playhead (it drops frames instead of lagging). */
const BEHIND = 0.2

export interface PlaybackStats {
  /** Timeline frames the playhead passed while playing. */
  frames: number
  /** Of those, frames the monitor drew with every footage layer exact. */
  exact: number
  /** frames − exact: frames held (the exact picture was not decoded in time) or skipped (no draw for that frame). */
  dropped: number
  draws: number
  seconds: number
  /** Dropped frames as ranges of timeline frame numbers (the first 40). */
  gaps: string[]
}

export class PreviewEngine {
  readonly cache: FrameCache
  private decoders = new Map<string, SourceDecoder>()
  private streams = new Map<string, { s: FrameStream; url: string; at: number }>()
  /** Called when a frame the monitor asked for has arrived (schedule a redraw). */
  onFrame: () => void = () => {}
  // playback stats
  private shown = new Set<number>()
  private firstIdx = -1
  private lastIdx = -1
  private draws = 0
  private playStarted = 0
  // scrub latency
  private seekAt = 0
  private seekT = -1
  scrubLatencies: number[] = []
  /** Tests: when set, every monitor draw is logged (wall time, timeline time) for the A/V sync measurement. */
  drawLog: { perf: number; t: number }[] | null = null

  constructor(budgetBytes = 640 * 1024 * 1024) {
    this.cache = new FrameCache(budgetBytes)
  }

  decoderFor(url: string): SourceDecoder {
    let d = this.decoders.get(url)
    if (!d) {
      d = new SourceDecoder(url, this.cache)
      this.decoders.set(url, d)
      void d.ready.then(() => this.onFrame())
    }
    return d
  }

  /** The pictures for a draw at `t`. While paused, a missing exact frame is decoded now (and the monitor redrawn when
   * it lands); meanwhile the nearest earlier frame of that clip is held, so the picture never flashes black. */
  lookup(t: number, playing: boolean): { frames: FrameLookup; exact: () => boolean } {
    let allExact = true
    const frames: FrameLookup = (clip: Clip): FrameInput | null => {
      const url = previewUrl(clip)
      if (!url) return null
      const dec = this.decoderFor(url)
      const st = srcTime(clip, t)
      if (dec.state === 'failed') return this.elementFrame(url, st, playing)
      if (dec.state === 'opening') { allExact = false; return null }
      const idx = dec.index(st)
      const e = this.cache.get(url, idx)
      if (e) return asInput(e)
      allExact = false
      if (!playing) void dec.exact(st).then((x) => { if (x) this.onFrame() })
      const hold = this.cache.nearestBefore(url, idx, playing ? 30 : 600)
      return hold ? asInput(hold.entry) : null
    }
    return { frames, exact: () => allExact }
  }

  /** A source mediabunny cannot decode: its <video> element, seeked to the frame while paused and run while playing. */
  private elementFrame(url: string, st: number, playing: boolean): FrameInput | null {
    const v = getCachedVideo(url)
    if (!v) return null
    if (!playing) { if (Math.abs(v.currentTime - st) > 0.02) v.currentTime = st; if (!v.paused) v.pause() }
    else { if (Math.abs(v.currentTime - st) > 0.25) v.currentTime = st; if (v.paused) v.play().catch(() => {}) }
    // never upload a picture the element is still seeking to (it can be half decoded)
    return v.readyState >= 2 && v.videoWidth > 0 && !v.seeking ? { image: v, width: v.videoWidth, height: v.videoHeight, live: true } : null
  }

  /** Keep a stream running for every footage clip under (or about to reach) the playhead; stop the rest. */
  updateStreams(project: VideoProject, t: number, playing: boolean) {
    if (!playing) { this.stopStreams(); return }
    const want = new Set<string>()
    const now = performance.now()
    for (const c of project.clips) {
      if (c.kind !== 'video' || c.still || !c.sourceUrl) continue
      const soon = isActive(c, t) || (c.start > t && c.start - t < PREROLL)
      if (!soon) continue
      const url = previewUrl(c)
      if (!url) continue
      const dec = this.decoderFor(url)
      if (dec.state !== 'ready') continue
      want.add(c.id)
      const from = srcTime(c, Math.max(t, c.start))
      let cur = this.streams.get(c.id)
      const lost = cur && (cur.url !== url || cur.s.stopped || (cur.s.last < from - BEHIND && now - cur.at > 300) || cur.s.last > from + AHEAD + 0.6)
      if (lost) { cur!.s.stop(); this.streams.delete(c.id); cur = undefined }
      if (!cur) {
        const s = dec.stream(from)
        if (!s) continue
        cur = { s, url, at: now }
        this.streams.set(c.id, cur)
      }
      cur.s.target = from + AHEAD
    }
    for (const [id, s] of this.streams) if (!want.has(id)) { s.s.stop(); this.streams.delete(id) }
  }

  stopStreams() {
    for (const s of this.streams.values()) s.s.stop()
    this.streams.clear()
  }

  // ---------------------------------------------------------------- measurement

  startStats() {
    this.shown.clear()
    this.firstIdx = -1
    this.lastIdx = -1
    this.draws = 0
    this.playStarted = performance.now()
  }

  /** Record a draw while playing: the timeline frame index shown and whether every footage layer was exact. */
  noteDraw(frameIdx: number, exact: boolean) {
    this.draws++
    if (this.firstIdx < 0) this.firstIdx = frameIdx
    this.lastIdx = Math.max(this.lastIdx, frameIdx)
    if (exact) this.shown.add(frameIdx)
  }

  stats(): PlaybackStats {
    const frames = this.firstIdx < 0 ? 0 : this.lastIdx - this.firstIdx + 1
    // where the drops were, as ranges of timeline frames ("12-14")
    const gaps: string[] = []
    for (let i = this.firstIdx; i <= this.lastIdx && gaps.length < 40; i++) {
      if (this.shown.has(i)) continue
      let j = i
      while (j + 1 <= this.lastIdx && !this.shown.has(j + 1)) j++
      gaps.push(i === j ? String(i) : `${i}-${j}`)
      i = j
    }
    return { frames, exact: this.shown.size, dropped: Math.max(0, frames - this.shown.size), draws: this.draws, seconds: (performance.now() - this.playStarted) / 1000, gaps }
  }

  /** A paused seek: time it until the exact frame is on screen. */
  noteSeek(t: number) { this.seekAt = performance.now(); this.seekT = t }
  noteExactPaused(t: number) {
    if (this.seekT >= 0 && Math.abs(t - this.seekT) < 1e-6) {
      this.scrubLatencies.push(performance.now() - this.seekAt)
      if (this.scrubLatencies.length > 200) this.scrubLatencies.shift()
      this.seekT = -1
    }
  }

  /** Forget a source (relinked, or a proxy replaced it). */
  dropSource(url: string) {
    const d = this.decoders.get(url)
    if (d) { d.dispose(); this.decoders.delete(url) }
    this.cache.clearSource(url)
  }

  /** Release decoders whose URL no clip uses any more. */
  prune(keep: Set<string>) {
    for (const url of [...this.decoders.keys()]) if (!keep.has(url)) this.dropSource(url)
  }

  dispose() {
    this.stopStreams()
    for (const d of this.decoders.values()) d.dispose()
    this.decoders.clear()
    this.cache.clear()
  }
}

const asInput = (e: FrameEntry): FrameInput => ({ image: e.image, width: e.width, height: e.height })

/** The one preview engine of the Video desk (the monitor and the timeline's thumbnails share its decoders). */
let shared: PreviewEngine | null = null
export const previewEngine = () => (shared ??= new PreviewEngine())
