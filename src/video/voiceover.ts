// Voiceover recorder: a 3-2-1 countdown, a live level meter, optional punch-in (the timeline plays from the playhead
// while you speak, so you can narrate over the picture) and the take lands on an audio track at the playhead. Takes
// are written to disk by main (media.ts keepTake → esb:video-store-take) so a save or a crash restore keeps them.
// One shared controller: the header's Record button, the Audio tab and the countdown overlay all read this store.

import { create } from 'zustand'
import { keepTake, hasDiskMedia } from './media'
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
}
export const useVoiceover = create<VoState>(() => ({ phase: 'idle', count: 0, seconds: 0, level: 0, punch: true, trackId: null, at: 0, error: null, note: null }))
const set = useVoiceover.setState

export const COUNTDOWN_FROM = 3
let timers: number[] = []
let raf = 0
let stream: MediaStream | null = null
let rec: MediaRecorder | null = null
let ctx: AudioContext | null = null
let chunks: Blob[] = []
let startedAt = 0
let wasPlaying = false
let cancelled = false

const clearTimers = () => { for (const t of timers) clearTimeout(t); timers = []; cancelAnimationFrame(raf); raf = 0 }
function release() {
  clearTimers()
  stream?.getTracks().forEach((t) => t.stop())
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
  set({ phase: 'asking', error: null, note: null, level: 0, seconds: 0 })
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (err) {
    set({ phase: 'idle', error: 'Could not use the microphone: ' + (err as Error).message })
    return
  }
  if (cancelled) { release(); set({ phase: 'idle' }); return }
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

function beginRecording() {
  if (!stream || cancelled) return
  const st = useVideoStore.getState()
  const at = st.currentTime
  try {
    rec = new MediaRecorder(stream)
  } catch (err) {
    release()
    set({ phase: 'idle', error: 'Could not start recording: ' + (err as Error).message })
    return
  }
  chunks = []
  rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data) }
  const r = rec
  r.onstop = () => void finish(r, at)
  startedAt = performance.now()
  r.start()
  wasPlaying = st.playing
  if (useVoiceover.getState().punch && !st.playing) useVideoStore.getState().play()
  set({ phase: 'recording', at, seconds: 0 })
  const tick = () => { set({ seconds: Math.floor((performance.now() - startedAt) / 1000) }); timers.push(window.setTimeout(tick, 250)) }
  tick()
}

async function finish(r: MediaRecorder, at: number) {
  const dur = Math.max(0.1, Math.round((performance.now() - startedAt) / 100) / 10)
  const blob = new Blob(chunks, { type: r.mimeType || 'audio/webm' })
  const punch = useVoiceover.getState().punch
  release()
  if (punch && !wasPlaying) useVideoStore.setState({ playing: false, rate: 0 })
  set({ phase: 'idle', seconds: 0, level: 0 })
  if (cancelled || blob.size === 0) return
  const name = `Voiceover ${fmtTime(Date.now(), { seconds: true })}`
  const { asset, onDisk, error } = await keepTake(blob, name, dur)
  const s = useVideoStore.getState()
  s.addMediaAsset(asset)
  s.beginGesture()
  let trackId = takeTrackId()
  if (capabilities().track) {
    // a track with no bus set sends footage sound to Voice and anything else to Music (where it would be ducked): a
    // voiceover goes on a track marked Voice, a free one if possible, else a new Voiceover track
    const tr = useVideoStore.getState().project.tracks.find((t) => t.id === trackId)
    const bus = (tr as unknown as { bus?: string } | undefined)?.bus
    const others = useVideoStore.getState().project.clips.some((c) => c.trackId === trackId && !/^Voiceover/.test(c.title))
    if (bus !== 'voice') {
      if (!others && !bus) writeTrack(trackId, { bus: 'voice' })
      else { trackId = s.addTrack('audio'); s.renameTrack(trackId, 'Voiceover'); writeTrack(trackId, { bus: 'voice' }) }
    }
  }
  s.addClip({ id: `clip-vo-${Date.now()}`, trackId, title: name, kind: 'audio', start: at, duration: dur, in: 0, out: dur, color: '#7c3aed', sourceUrl: asset.url, mediaAssetId: asset.id, srcDuration: dur })
  useVideoStore.getState().endGesture()
  set({ note: !onDisk && hasDiskMedia() ? `The voiceover could not be written to disk (${error ?? 'unknown error'}); it plays this session only.` : null })
}

export function stopVoiceover() {
  if (rec && rec.state === 'recording') rec.stop()
}

/** Stop everything without keeping a take (Esc during the countdown, leaving the desk). */
export function cancelVoiceover() {
  cancelled = true
  if (rec && rec.state === 'recording') { rec.onstop = null; rec.stop() }
  if (useVoiceover.getState().phase === 'recording' && useVoiceover.getState().punch && !wasPlaying) useVideoStore.setState({ playing: false, rate: 0 })
  release()
  set({ phase: 'idle', seconds: 0, level: 0, count: 0 })
}

// dev server only: the shot harness shows the countdown without a microphone through this handle
if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV && typeof window !== 'undefined') Object.assign(window, { __voiceover: useVoiceover })
