// The monitor's frame supply: one decoder per preview source (the proxy when Part A has made one), a shared frame
// cache, look-ahead streams while playing and exact decodes while paused. It hands render.ts a FrameLookup for each
// draw and counts what the editor would see: frames shown exactly, frames held or skipped (dropped), and how long a
// scrub took to show the frame under the cursor.

import type { Clip, VideoProject } from '../timeline'
import { isActive } from '../timeline'
import { getCachedVideo } from '../compositor'
import { FrameCache } from './frameCache'
import type { FrameEntry, FrameWindow } from './frameCache'
import { FrameStream, ReverseStream, SourceDecoder } from './decoder'
import { audioRateAt, directionAt, isPlainSpeed } from './animation'
import { previewUrl } from './mediaSource'
import type { FrameInput, FrameLookup } from './render'
import { srcTime } from './render'

/** How far ahead of the playhead streams decode at most (seconds; less when the budget is tight), and how soon a
 * coming clip starts decoding. */
const AHEAD = 0.5
const MIN_AHEAD = 0.15
/** Share of the cache budget the look-ahead of all streams may fill. */
const AHEAD_SHARE = 0.5
const PREROLL = 1.0
/** Seconds of source each stream decodes before the clock starts (at most START_WAIT_MS, see the playback loop). */
const PREROLL_AHEAD = 0.5
/** A stream more than this behind the playhead is restarted at the playhead (it drops frames instead of lagging). */
const BEHIND = 0.2
/** A reverse stream keeps this much source below its look-ahead decoded (seconds; about one GOP). */
const REVERSE_LEAD = 1.0

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
  private streams = new Map<string, { s: FrameStream | ReverseStream; url: string; at: number; dir: 1 | -1 }>()
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
  /** Height decoded preview frames are scaled to (device pixels; one of PREVIEW_HEIGHTS), from the monitor's size. */
  maxHeight = 720
  /** How long the last play waited for its first frames before the clock started (ms). */
  prerollMs = 0
  /** The project's frame rate (speed-changed clips pick their source frame on the timeline frame grid). */
  fps = 30
  /** The look-ahead the streams use now (seconds), sized to the budget. */
  ahead = AHEAD
  /** Per clip: the source URL it was last drawn from. A clip whose preview URL changes (a proxy became ready) keeps
   * drawing from the old one until the new decoder has a frame, so the swap never flashes black. */
  private shownUrl = new Map<string, string>()
  private pruneTimer: ReturnType<typeof setTimeout> | null = null
  private pruneKeep: (() => { urls: Set<string>; clips: Set<string> }) | null = null

  constructor(budgetBytes = 640 * 1024 * 1024) {
    this.cache = new FrameCache(budgetBytes)
  }

  decoderFor(url: string): SourceDecoder {
    let d = this.decoders.get(url)
    if (!d) {
      d = new SourceDecoder(url, this.cache, this.maxHeight)
      d.onHold = () => this.onFrame()
      this.decoders.set(url, d)
      void d.ready.then(() => this.onFrame())
    }
    return d
  }

  /** The monitor's height in device pixels: decoded frames are scaled to the next step up (an export always decodes
   * at full size). A bigger step drops the smaller frames so the paused picture is decoded again, sharp. */
  setMonitorHeight(px: number) {
    const h = PREVIEW_HEIGHTS.find((x) => x >= px) ?? 0
    if (h === this.maxHeight) return
    const bigger = h === 0 || (this.maxHeight !== 0 && h > this.maxHeight)
    this.maxHeight = h
    for (const d of this.decoders.values()) d.maxHeight = h
    if (bigger) { this.cache.clear(); this.onFrame() }
  }

  /** The pictures for a draw at `t`. While paused, a missing exact frame is decoded now (and the monitor redrawn when
   * it lands); meanwhile the nearest earlier frame of that clip is held, so the picture never flashes black. */
  lookup(t: number, playing: boolean): { frames: FrameLookup; exact: () => boolean } {
    let allExact = true
    const frames: FrameLookup = (clip: Clip): FrameInput | null => {
      const url = previewUrl(clip)
      if (!url) return null
      // a speed-changed clip shows the source frame of the timeline frame under the playhead (as the export does at
      // i / fps), so the look-ahead knows exactly which frames to keep
      const st = isPlainSpeed(clip) ? srcTime(clip, t) : srcTime(clip, Math.max(clip.start, quantize(t, this.fps)))
      const shown = this.shownUrl.get(clip.id)
      const now = this.frameOf(url, st, playing)
      if (now.exact || !shown || shown === url) {
        if (now.input) this.shownUrl.set(clip.id, url)
        if (shown && shown !== url && now.input) this.schedulePrune()
        if (!now.exact) allExact = false
        return now.input
      }
      // the clip's URL changed (a proxy is ready) and the new decoder has nothing yet: keep the old picture
      allExact = false
      const old = this.decoders.get(shown)
      if (!old || old.state !== 'ready') { if (now.input) this.shownUrl.set(clip.id, url); return now.input }
      const e = this.cache.get(shown, old.index(st)) ?? this.cache.nearestBefore(shown, old.index(st), 30)?.entry
      return e ? asInput(e) : now.input
    }
    return { frames, exact: () => allExact }
  }

  /** One clip's picture from `url` at source time `st`: exact (cached), or the nearest earlier frame held while the
   * exact one decodes (paused: asked for now). */
  private frameOf(url: string, st: number, playing: boolean): { input: FrameInput | null; exact: boolean } {
    const dec = this.decoderFor(url)
    if (dec.state === 'failed') { const f = this.elementFrame(url, st, playing); return { input: f, exact: !!f } }
    if (dec.state === 'opening') return { input: null, exact: false }
    const idx = dec.index(st)
    const e = this.cache.get(url, idx)
    if (e) return { input: asInput(e), exact: true }
    if (!playing) void dec.exact(st).then((x) => { if (x) this.onFrame() })
    const hold = this.cache.nearestBefore(url, idx, playing ? 30 : 600)
    return { input: hold ? asInput(hold.entry) : null, exact: false }
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

  /** Keep a stream running for every footage clip under (or about to reach) the playhead; stop the rest. The
   * look-ahead is sized so all streams together fill at most AHEAD_SHARE of the cache, and the cache is told which
   * frames are still needed (the ones behind the playhead go first). */
  updateStreams(project: VideoProject, t: number, playing: boolean) {
    if (!playing) { this.stopStreams(); return }
    const want = new Set<string>()
    const now = performance.now()
    const fps = Math.max(1, project.fps || 30)
    this.fps = fps
    const live: { c: Clip; url: string; dec: SourceDecoder; from: number; rate: number }[] = []
    for (const c of project.clips) {
      if (c.kind !== 'video' || c.still || !c.sourceUrl) continue
      const soon = isActive(c, t) || (c.start > t && c.start - t < PREROLL)
      if (!soon) continue
      const url = previewUrl(c)
      if (!url) continue
      const dec = this.decoderFor(url)
      if (dec.state !== 'ready') continue
      const at = Math.max(t, c.start)
      live.push({ c, url, dec, from: srcTime(c, at), rate: isPlainSpeed(c) ? 1 : audioRateAt(c, at - c.start) })
    }
    let perSecond = 0
    // frames kept per second of play: every source frame up to the project rate (a fast clip keeps only the shown ones)
    for (const l of live) perSecond += l.dec.frameBytes() * Math.max(0.1, Math.min(l.dec.fps * Math.max(0.1, l.rate), fps * 1.05))
    this.ahead = perSecond > 0 ? Math.max(MIN_AHEAD, Math.min(AHEAD, (this.cache.budget * AHEAD_SHARE) / perSecond)) : AHEAD
    const windows = new Map<string, FrameWindow[]>()
    const addWindow = (url: string, lo: number, hi: number, dir: 1 | -1 = 1) => { const w = windows.get(url) ?? []; w.push([lo, hi, dir]); windows.set(url, w) }
    for (const { c, url, dec, from, rate } of live) {
      want.add(c.id)
      let cur = this.streams.get(c.id)
      if (isPlainSpeed(c)) {
        const lost = cur && (cur.dir !== 1 || cur.url !== url || cur.s.stopped || (cur.s.last < from - BEHIND && now - cur.at > (cur.s.last === -Infinity ? 1000 : 300)) || cur.s.last > from + this.ahead + 0.6)
        if (lost) { cur!.s.stop(); this.streams.delete(c.id); cur = undefined }
        if (!cur) {
          const s = dec.stream(from)
          if (!s) continue
          cur = { s, url, at: now, dir: 1 }
          this.streams.set(c.id, cur)
        }
        cur.s.target = from + this.ahead
        addWindow(url, Math.max(0, dec.index(from) - 1), dec.index(from + this.ahead) + 2)
        continue
      }
      // a speed-changed clip: the source frames the next `ahead` seconds of timeline show
      const at = Math.max(c.start, quantize(Math.max(t, c.start), fps))
      const n = Math.max(1, Math.ceil(this.ahead * fps))
      const needed = this.neededFor(c.id)
      needed.clear()
      let lo = Infinity
      let hi = -Infinity
      for (let k = 0; k <= n; k++) {
        const tt = at + k / fps
        if (tt >= c.start + c.duration) break
        const st = srcTime(c, tt)
        needed.add(dec.index(st))
        if (st < lo) lo = st
        if (st > hi) hi = st
      }
      const dir = directionAt(c, at - c.start)
      if (dir === 0) {
        // a freeze frame: one exact frame
        if (cur) { cur.s.stop(); this.streams.delete(c.id) }
        void dec.exact(from).then((x) => { if (x) this.onFrame() })
        addWindow(url, dec.index(from), dec.index(from))
        continue
      }
      const slack = BEHIND * Math.max(1, rate)
      if (dir === 1) {
        const lost = cur && (cur.dir !== 1 || cur.url !== url || cur.s.stopped || (cur.s.last < from - slack && now - cur.at > (cur.s.last === -Infinity ? 1000 : 300)) || cur.s.last > hi + 0.6 * Math.max(1, rate))
        if (lost) { cur!.s.stop(); this.streams.delete(c.id); cur = undefined }
        if (!cur) {
          const s = dec.stream(from)
          if (!s) continue
          cur = { s, url, at: now, dir: 1 }
          this.streams.set(c.id, cur)
        }
        cur.s.want = rate > 1.05 ? needed : null
        if (cur.s instanceof FrameStream) cur.s.wantMax = dec.index(hi)
        cur.s.target = hi
        addWindow(url, Math.max(0, dec.index(lo) - 1), dec.index(hi) + 2)
      } else {
        const rs = cur?.s instanceof ReverseStream ? cur.s : null
        // a reverse stream is lost when the playhead went above where it started, or fell below what it has covered
        // while its GOP is still decoding (it restarts at the playhead: frames dropped, never late)
        const lost = cur && (!rs || cur.url !== url || rs.stopped || from > rs.top + 1 / fps || (from < rs.pending - slack && now - cur.at > 300))
        if (lost) { cur!.s.stop(); this.streams.delete(c.id); cur = undefined }
        if (!cur) {
          const s = dec.reverseStream(from)
          if (!s) continue
          cur = { s, url, at: now, dir: -1 }
          this.streams.set(c.id, cur)
        }
        const r = cur.s as ReverseStream
        // the GOP below the look-ahead is decoded before the playhead gets there: its wanted frames must be known too
        // (up to 3 s of source further down), or they would be dropped and never decoded again
        const ext = Math.min(900, Math.ceil((this.ahead + 3 / Math.max(0.1, rate)) * fps))
        for (let k = n + 1; k <= ext; k++) {
          const tt = at + k / fps
          if (tt >= c.start + c.duration) break
          needed.add(dec.index(srcTime(c, tt)))
        }
        r.want = rate > 1.05 ? needed : null
        // one GOP (~1 s of source) further down than the look-ahead: the next GOP is decoded while this one plays, so
        // the frame after a key frame (the last of the GOP below) is there in time
        r.target = lo - REVERSE_LEAD
        // keep what this stream decoded from its pending GOP up to the playhead
        addWindow(url, Math.max(0, dec.index(Math.min(r.pending, lo)) - 1), dec.index(from) + 2, -1)
      }
    }
    this.cache.setWindows(windows)
    for (const [id, s] of this.streams) if (!want.has(id)) { s.s.stop(); this.streams.delete(id) }
  }

  /** The reused set of source indexes a speed-changed clip needs (no new Set per frame). */
  private needed = new Map<string, Set<number>>()
  private neededFor(id: string): Set<number> {
    let s = this.needed.get(id)
    if (!s) { s = new Set(); this.needed.set(id, s); if (this.needed.size > 64) this.needed.delete(this.needed.keys().next().value!) }
    return s
  }

  /** Have the streams of every footage clip under `t` decoded their first frames (so the clock can start)? A clip
   * whose decoder is not ready (opening, or the <video> fallback) does not hold the start. */
  prerolled(project: VideoProject, t: number): boolean {
    for (const c of project.clips) {
      if (c.kind !== 'video' || c.still || !c.sourceUrl || !isActive(c, t)) continue
      const url = previewUrl(c)
      const dec = url ? this.decoders.get(url) : undefined
      if (!dec || dec.state !== 'ready') continue
      if (!isPlainSpeed(c)) {
        // a speed-changed clip: its first frame is in the cache
        if (!this.cache.has(url!, dec.index(srcTime(c, t)))) return false
        continue
      }
      const s = this.streams.get(c.id)
      if (!s || s.s.stopped) return false
      if (s.s.last < srcTime(c, t) + Math.min(PREROLL_AHEAD, this.ahead) - 1.5 / dec.fps) return false
    }
    return true
  }

  stopStreams() {
    for (const s of this.streams.values()) s.s.stop()
    this.streams.clear()
    this.cache.setWindows(null)
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

  /** Release decoders whose URL no clip uses any more (nor any clip still draws from while its new one opens). */
  prune(keep: Set<string>) {
    for (const u of this.shownUrl.values()) keep.add(u)
    for (const url of [...this.decoders.keys()]) if (!keep.has(url)) this.dropSource(url)
  }

  /** What a debounced prune keeps: the desk sets it to "every preview URL and clip id of the project". */
  setPruneSource(fn: (() => { urls: Set<string>; clips: Set<string> }) | null) { this.pruneKeep = fn }

  /** Prune soon (after edits settle, or once a clip has moved to its proxy). */
  schedulePrune(ms = 1500) {
    if (this.pruneTimer) clearTimeout(this.pruneTimer)
    this.pruneTimer = setTimeout(() => {
      this.pruneTimer = null
      const keep = this.pruneKeep?.()
      if (!keep) return
      // a clip that is gone no longer pins the URL it drew from
      for (const id of [...this.shownUrl.keys()]) if (!keep.clips.has(id)) this.shownUrl.delete(id)
      this.prune(keep.urls)
    }, ms)
  }

  /** Forget which URL each clip drew from (a different project is on the desk). */
  forgetClips() { this.shownUrl.clear() }

  dispose() {
    if (this.pruneTimer) clearTimeout(this.pruneTimer)
    this.stopStreams()
    for (const d of this.decoders.values()) d.dispose()
    this.decoders.clear()
    this.cache.clear()
  }
}

/** The start of the timeline frame `t` falls in. */
const quantize = (t: number, fps: number) => Math.floor(t * fps + 1e-6) / fps

/** Preview frame heights (device pixels); 0 = full size (a monitor taller than 2160 px). */
export const PREVIEW_HEIGHTS = [360, 540, 720, 1080, 1440, 2160]

const asInput = (e: FrameEntry): FrameInput => ({ image: e.image, width: e.width, height: e.height })

/** The one preview engine of the Video desk (the monitor and the timeline's thumbnails share its decoders). */
let shared: PreviewEngine | null = null
export const previewEngine = () => (shared ??= new PreviewEngine())
