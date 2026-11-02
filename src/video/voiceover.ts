// Voiceover recorder: a 3-2-1 countdown, a live level meter, optional punch-in (the timeline plays from the playhead
// while you speak, so you can narrate over the picture) and the take lands on an audio track at the playhead. Takes
// are written to disk by main (media.ts keepTake → esb:video-store-take) so a save or a crash restore keeps them.
// One shared controller: the header's Record button, the Audio tab and the countdown overlay all read this store.
//
// Phase 4 fix round:
//  - Latency: playback does not start at the instant the recorder does, and the microphone has its own delay. The take
//    is placed where the sound really was on the timeline (voiceoverPlacement): recorder start vs the first moving
//    frame of the playhead, minus the microphone's reported latency, plus the editor's own "latency offset" (ms).
//  - Punch-in over sound already on the track never overwrites it: the take goes on a new Voiceover track and says so.
//  - The recorder hands its pieces to main every ~1.5 s (esb:video-take-chunk), so a crash keeps the take; a part file left
//    by a crash is recovered at the next start.
//  - A microphone that is unplugged, or a recorder error, stops the take cleanly and keeps what was recorded.

import { create } from 'zustand'
import { assetFromEntry, keepTake, hasDiskMedia, videoBridge } from './media'
import { trackForKind } from './timeline'
import { useVideoStore } from './videoStore'
import { capabilities, writeTrack } from './audioAdapter'
import { fmtTime } from '../ui/time'

export type VoPhase = 'idle' | 'asking' | 'countdown' | 'recording'
export interface VoState {
  phase: VoPhase
  /** 3, 2, 1 during the countdown. */
  count: number
  seconds: number
  /** Microphone level 0..1 (peak, smoothed), for the meter. */
  level: number
  /** Play the timeline from the playhead while recording. */
  punch: boolean
  /** The audio track the take goes on (null = the first unlocked one). */
  trackId: string | null
  /** Where the take will be placed (the playhead when recording began). */
  at: number
  error: string | null
  note: string | null
  /** The editor's own correction on top of the measured latency, milliseconds (positive = the take is placed later).
   * Kept in localStorage; the Audio tab shows it as "Voiceover latency offset (ms)". */
  offsetMs: number
  /** The latency measured for the last take (ms): how far earlier than the playhead's start the take was placed. */
  measuredMs: number | null
  /** The take went on a new track because it would have covered sound on the chosen one (the sentence says which). */
  layered: string | null
  /** The recording stopped by itself (microphone unplugged, recorder error); what was recorded was kept. */
  interrupted: string | null
}

export const OFFSET_KEY = 'esb-video-vo-offset-ms'
export const OFFSET_LIMIT_MS = 1000
const readOffset = () => {
  try { const v = Number(typeof localStorage !== 'undefined' ? localStorage.getItem(OFFSET_KEY) : 0); return Number.isFinite(v) ? Math.max(-OFFSET_LIMIT_MS, Math.min(OFFSET_LIMIT_MS, Math.round(v))) : 0 } catch { return 0 }
}
export const useVoiceover = create<VoState>(() => ({ phase: 'idle', count: 0, seconds: 0, level: 0, punch: true, trackId: null, at: 0, error: null, note: null, offsetMs: readOffset(), measuredMs: null, layered: null, interrupted: null }))
const set = useVoiceover.setState

/** Set the editor's latency offset (ms, −1000..1000). */
export function setVoiceoverOffset(ms: number) {
  const v = Number.isFinite(ms) ? Math.max(-OFFSET_LIMIT_MS, Math.min(OFFSET_LIMIT_MS, Math.round(ms))) : 0
  try { localStorage.setItem(OFFSET_KEY, String(v)) } catch { /* no storage */ }
  set({ offsetMs: v })
}

export const COUNTDOWN_FROM = 3
/** The recorder hands over a piece this often (ms): the most a crash can lose. */
export const TIMESLICE_MS = 1500

/** Where a take goes on the timeline, and how much of its head is dropped. Pure.
 *  at            the playhead when recording began (timeline s)
 *  recStartMs    performance.now() when the recorder really started
 *  playStartMs   performance.now() of the first frame the playhead moved (null: nothing played, so there is nothing to line up with)
 *  micLatencyS   the microphone's reported delay (s; 0 when unknown)
 *  offsetMs      the editor's own correction
 * The take's sample 0 was captured at recStart − micLatency; the playhead reached `at` at playStart; so the sound belongs at
 * at + (recStart − playStart) − micLatency + offset. Before the timeline's start the head is trimmed (`trim`). */
export function voiceoverPlacement(a: { at: number; recStartMs: number; playStartMs: number | null; micLatencyS: number; offsetMs: number }): { start: number; trim: number; latencyMs: number } {
  if (a.playStartMs == null) return { start: Math.max(0, a.at), trim: 0, latencyMs: 0 }
  const lag = (a.playStartMs - a.recStartMs) / 1000 + Math.max(0, Math.min(1, a.micLatencyS)) // seconds the take must move earlier
  const raw = a.at - Math.max(-2, Math.min(2, lag)) + a.offsetMs / 1000
  return { start: Math.max(0, raw), trim: raw < 0 ? -raw : 0, latencyMs: Math.round(lag * 1000) }
}

let timers: number[] = []
let raf = 0
let stream: MediaStream | null = null
let rec: MediaRecorder | null = null
let ctx: AudioContext | null = null
let chunks: Blob[] = []
let startedAt = 0
let recStartMs = 0
let playStartMs: number | null = null
let micLatencyS = 0
let wasPlaying = false
let cancelled = false
/** The take being written to disk by main, if the bridge is there: its id and the pieces still on their way. */
interface DiskTake { id: string; queue: Promise<unknown>; failed: string | null }
let disk: DiskTake | null = null

const clearTimers = () => { for (const t of timers) clearTimeout(t); timers = []; cancelAnimationFrame(raf); raf = 0 }
function release() {
  clearTimers()
  stream?.getTracks().forEach((t) => { t.onended = null; t.stop() })
  stream = null
  if (ctx) { void ctx.close().catch(() => undefined); ctx = null }
  rec = null
}

/** The track a take lands on: the chosen one if it is an unlocked audio track, else the first unlocked audio track,
 * else the usual audio track. */
export function takeTrackId(): string {
  const { project } = useVideoStore.getState()
  const want = useVoiceover.getState().trackId
  const audio = project.tracks.filter((t) => t.kind === 'audio')
  return (audio.find((t) => t.id === want && !t.locked) ?? audio.find((t) => !t.locked) ?? audio.find((t) => t.id === want) ?? audio[0])?.id ?? trackForKind(project, 'audio') ?? 'a1'
}

export function setPunch(punch: boolean) { set({ punch }) }
export function setTakeTrack(trackId: string | null) { set({ trackId }) }

function meter(analyser: AnalyserNode) {
  const buf = new Float32Array(analyser.fftSize)
  const tick = () => {
    analyser.getFloatTimeDomainData(buf)
    let peak = 0
    for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]))
    const prev = useVoiceover.getState().level
    set({ level: Math.max(peak, prev * 0.85) })
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
}

/** Ask for the microphone, count down 3-2-1, then record. Calling it again during the countdown cancels it. */
export async function startVoiceover(): Promise<void> {
  const s = useVoiceover.getState()
  if (s.phase === 'countdown') { cancelVoiceover(); return }
  if (s.phase !== 'idle') return
  cancelled = false
  set({ phase: 'asking', error: null, note: null, level: 0, seconds: 0, layered: null, interrupted: null })
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (err) {
    set({ phase: 'idle', error: 'Could not use the microphone: ' + (err as Error).message })
    return
  }
  if (cancelled) { release(); set({ phase: 'idle' }); return }
  const mic = stream.getAudioTracks()[0]
  const lat = (mic?.getSettings?.() as { latency?: number } | undefined)?.latency
  micLatencyS = typeof lat === 'number' && Number.isFinite(lat) && lat > 0 ? lat : 0
  // a microphone that goes away (unplugged, taken by another app) ends the take cleanly instead of silently recording nothing
  if (mic) mic.onended = () => interrupt('The microphone stopped (it may have been unplugged). What was recorded so far was kept.')
  try {
    ctx = new AudioContext()
    const src = ctx.createMediaStreamSource(stream)
    const an = ctx.createAnalyser()
    an.fftSize = 1024
    src.connect(an)
    meter(an)
  } catch { /* no meter: recording still works */ }
  set({ phase: 'countdown', count: COUNTDOWN_FROM })
  for (let i = 1; i <= COUNTDOWN_FROM; i++) {
    timers.push(window.setTimeout(() => {
      if (i < COUNTDOWN_FROM) set({ count: COUNTDOWN_FROM - i })
      else beginRecording()
    }, i * 1000))
  }
}

/** The recording stopped by itself: keep the take and say why. */
function interrupt(why: string) {
  if (!rec || rec.state !== 'recording') return
  set({ interrupted: why })
  try { rec.stop() } catch { /* already stopped */ }
}

function beginRecording() {
  if (!stream || cancelled) return
  const st = useVideoStore.getState()
  let at = st.currentTime
  try {
    rec = new MediaRecorder(stream)
  } catch (err) {
    release()
    set({ phase: 'idle', error: 'Could not start recording: ' + (err as Error).message })
    return
  }
  chunks = []
  disk = null
  const b = videoBridge()
  if (b?.videoTakeBegin && b.videoTakeChunk) {
    const d: DiskTake = { id: '', queue: Promise.resolve(), failed: null }
    disk = d
    d.queue = b.videoTakeBegin().then((id) => { d.id = id }).catch((e) => { d.failed = (e as Error).message || 'could not start the take file' })
  }
  const r = rec
  r.ondataavailable = (e) => {
    if (!e.data || e.data.size === 0) return
    chunks.push(e.data)
    const d = disk
    if (d && b?.videoTakeChunk) {
      // appended in order, one at a time; a failure only means this take is not crash-safe (it is still held in memory)
      const piece = e.data
      d.queue = d.queue.then(async () => { if (d.failed || !d.id) return; await b.videoTakeChunk!(d.id, new Uint8Array(await piece.arrayBuffer())) }).catch((err) => { d.failed = (err as Error).message || 'could not write the take' })
    }
  }
  r.onerror = (ev) => {
    const msg = (ev as unknown as { error?: { message?: string } }).error?.message
    interrupt(`The recorder stopped${msg ? ` (${msg})` : ''}. What was recorded so far was kept.`)
  }
  r.onstop = () => void finish(r, at)
  wasPlaying = st.playing
  playStartMs = null
  r.onstart = () => {
    recStartMs = performance.now()
    startedAt = recStartMs
    // already playing: the playhead is moving right now, so recorder and picture start together
    if (wasPlaying) { at = useVideoStore.getState().currentTime; playStartMs = recStartMs; set({ at }) }
  }
  startedAt = performance.now()
  recStartMs = startedAt
  r.start(TIMESLICE_MS)
  if (useVoiceover.getState().punch && !st.playing) {
    useVideoStore.getState().play()
    // the first frame the playhead really moves: playback starts a little after the recorder
    const watch = () => {
      if (!rec || rec.state !== 'recording' || playStartMs != null) return
      if (useVideoStore.getState().currentTime > at + 0.0005) { playStartMs = performance.now(); return }
      timers.push(window.setTimeout(watch, 8))
    }
    watch()
  }
  set({ phase: 'recording', at, seconds: 0 })
  const tick = () => { set({ seconds: Math.floor((performance.now() - startedAt) / 1000) }); timers.push(window.setTimeout(tick, 250)) }
  tick()
}

async function finish(r: MediaRecorder, at: number) {
  const wallDur = Math.max(0.1, (performance.now() - startedAt) / 1000)
  const blob = new Blob(chunks, { type: r.mimeType || 'audio/webm' })
  const punch = useVoiceover.getState().punch
  const played = punch ? playStartMs : null
  const d = disk
  disk = null
  release()
  if (punch && !wasPlaying) useVideoStore.setState({ playing: false, rate: 0 })
  set({ phase: 'idle', seconds: 0, level: 0 })
  if (cancelled || blob.size === 0) {
    if (d) { await d.queue; if (d.id) void videoBridge()?.videoTakeDiscard?.(d.id).catch(() => undefined) }
    if (!cancelled && blob.size === 0) set({ error: 'Nothing was recorded. Check the microphone and try again.' })
    return
  }
  const name = `Voiceover ${fmtTime(Date.now(), { seconds: true })}`
  let onDisk = false
  let error: string | undefined
  let asset: Awaited<ReturnType<typeof keepTake>>['asset'] | null = null
  // the pieces are already on disk: main turns the file into the take (validated like a whole take)
  const b = videoBridge()
  if (d && b?.videoTakeEnd) {
    await d.queue
    if (d.id && !d.failed) {
      try {
        const entry = await b.videoTakeEnd(d.id, name)
        const a = entry ? await assetFromEntry(entry, true, 'audio') : null
        if (a) { asset = { ...a, name, duration: a.duration > 0 && Math.abs(a.duration - wallDur) < 1.5 ? a.duration : wallDur }; onDisk = true }
      } catch (e) { error = (e as Error).message }
    } else if (d.failed) error = d.failed
  }
  if (!asset) {
    // no bridge, or the piecewise file failed: the whole take from memory, through the usual path
    const kept = await keepTake(blob, name, wallDur)
    asset = kept.asset
    onDisk = kept.onDisk
    error = kept.error ?? error
  }
  const dur = Math.max(0.1, Math.round((asset.duration > 0 ? asset.duration : wallDur) * 1000) / 1000)
  const place = voiceoverPlacement({ at, recStartMs, playStartMs: played, micLatencyS, offsetMs: useVoiceover.getState().offsetMs })
  const clipDur = Math.max(0.1, dur - place.trim)
  const s = useVideoStore.getState()
  s.addMediaAsset(asset)
  s.beginGesture()
  let trackId = takeTrackId()
  let layered: string | null = null
  const project = useVideoStore.getState().project
  const covered = project.clips.find((c) => c.trackId === trackId && c.start < place.start + clipDur - 1e-6 && c.start + c.duration > place.start + 1e-6)
  if (capabilities().track) {
    // a track with no bus set sends footage sound to Voice and anything else to Music (where it would be ducked): a
    // voiceover goes on a track marked Voice, a free one if possible, else a new Voiceover track
    const tr = project.tracks.find((t) => t.id === trackId)
    const bus = (tr as unknown as { bus?: string } | undefined)?.bus
    const others = project.clips.some((c) => c.trackId === trackId && !/^Voiceover/.test(c.title))
    if (bus !== 'voice' || covered) {
      if (!covered && !others && !bus) writeTrack(trackId, { bus: 'voice' })
      else {
        // never record over sound that is already there: the take is layered on a track of its own
        if (covered) layered = `The take overlaps “${(covered.title || 'a clip').slice(0, 40)}” on ${(tr?.name ?? trackId).split(' ·')[0]}, so it was put on a new Voiceover track and nothing was overwritten.`
        trackId = s.addTrack('audio')
        s.renameTrack(trackId, 'Voiceover')
        writeTrack(trackId, { bus: 'voice' })
      }
    }
  } else if (covered) {
    layered = `The take overlaps “${(covered.title || 'a clip').slice(0, 40)}” on the track and covers it.`
  }
  s.addClip({ id: `clip-vo-${Date.now()}`, trackId, title: name, kind: 'audio', start: place.start, duration: clipDur, in: place.trim, out: place.trim + clipDur, color: '#7c3aed', sourceUrl: asset.url, mediaAssetId: asset.id, srcDuration: dur, bus: 'voice' })
  useVideoStore.getState().endGesture()
  set({
    measuredMs: played != null ? place.latencyMs : null,
    layered,
    note: !onDisk && hasDiskMedia() ? `The voiceover could not be written to disk (${error ?? 'unknown error'}); it plays this session only.` : null,
  })
}

export function stopVoiceover() {
  if (rec && rec.state === 'recording') rec.stop()
}

/** Stop everything without keeping a take (Esc during the countdown, leaving the desk). */
export function cancelVoiceover() {
  cancelled = true
  const d = disk
  disk = null
  if (rec && rec.state === 'recording') { rec.onstop = null; rec.stop() }
  if (useVoiceover.getState().phase === 'recording' && useVoiceover.getState().punch && !wasPlaying) useVideoStore.setState({ playing: false, rate: 0 })
  release()
  if (d) void d.queue.then(() => { if (d.id) return videoBridge()?.videoTakeDiscard?.(d.id) }).catch(() => undefined)
  set({ phase: 'idle', seconds: 0, level: 0, count: 0 })
}

/** Takes a crash left half written (main keeps them as ".part" files): add them to the media bin. Run once at start. */
export async function recoverVoiceoverTakes(): Promise<number> {
  const b = videoBridge()
  if (!b?.videoTakeRecover) return 0
  try {
    const entries = await b.videoTakeRecover()
    let n = 0
    for (const e of entries) {
      const a = await assetFromEntry(e, true, 'audio')
      if (a) { useVideoStore.getState().addMediaAsset(a); n++ }
    }
    if (n) set({ note: `${n} voiceover ${n === 1 ? 'take' : 'takes'} from an interrupted recording ${n === 1 ? 'was' : 'were'} recovered. ${n === 1 ? 'It is' : 'They are'} in the media bin.` })
    return n
  } catch { return 0 }
}
if (typeof window !== 'undefined' && !(import.meta as unknown as { env?: { MODE?: string } }).env?.MODE?.startsWith('test')) setTimeout(() => { void recoverVoiceoverTakes() }, 4000)

// dev server only: the shot harness shows the countdown without a microphone through this handle
if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV && typeof window !== 'undefined') Object.assign(window, { __voiceover: useVoiceover })
