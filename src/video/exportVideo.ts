// Video export, frame-exact, through WebCodecs.
//
// The first exporter recorded a canvas with MediaRecorder. That ties the file's timing to the wall clock, so it
// drifted. Frames were pushed every half frame-interval, so the file ran at the wrong speed. Footage was drawn before
// its seek finished, and the Export button capped every video at 3 seconds with no sound. Here each frame is drawn
// only once every clip under it is at the right instant. It is encoded with its own timestamp (i/fps), so a
// 90-second timeline is a 90-second file however long the render takes. The A1 track is mixed offline at 48 kHz
// with each clip's trim and volume, and muxed alongside.
//
// MP4 (H.264) is the default. Audio is AAC where the platform encodes it (Windows, macOS) and Opus otherwise. Both
// are valid in MP4 and accepted by Facebook and YouTube. WebM (VP9 + Opus) is the fallback when H.264 is unavailable.

import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, WebMOutputFormat, canEncodeAudio, canEncodeVideo } from 'mediabunny'
import type { Clip, VideoProject } from './timeline'
import { getCachedImage, getCachedVideo, renderCompositeFrame } from './compositor'

export type ExportContainer = 'mp4' | 'webm'

export interface ExportResult {
  filename: string
  blob: Blob
  size: number
  duration: number
  container: ExportContainer
  videoCodec: string
  audioCodec: string | null
}

export interface ExportOptions {
  /** Export only the first N seconds (a quick draft); the whole timeline when omitted. */
  maxDuration?: number
  bitrate?: number
  fps?: number
  container?: ExportContainer
  signal?: AbortSignal
}

const SAMPLE_RATE = 48000

/** The clips whose sound goes into the file: A1 clips with a source, not muted, on a track that is not muted. */
export function audibleClips(project: VideoProject): Clip[] {
  const mutedTracks = new Set(project.tracks.filter((t) => t.muted).map((t) => t.id))
  return project.clips.filter((c) => c.kind === 'audio' && !!c.sourceUrl && !c.muted && (c.volume ?? 1) > 0 && !mutedTracks.has(c.trackId))
}

/** How long the file is: the whole timeline, or the requested draft length. */
export function exportDuration(project: VideoProject, maxDuration?: number): number {
  const d = maxDuration != null ? Math.min(project.duration, maxDuration) : project.duration
  return Math.max(1 / Math.max(1, project.fps), d)
}

/** The best container and codecs this machine can encode, preferring MP4/H.264. */
export async function pickCodecs(width: number, height: number, fps: number, prefer: ExportContainer = 'mp4'): Promise<{ container: ExportContainer; video: 'avc' | 'vp9' | 'vp8'; audio: 'aac' | 'opus' | null }> {
  const v = { width, height, frameRate: fps, quality: QUALITY_HIGH }
  const a = { numberOfChannels: 2, sampleRate: SAMPLE_RATE, quality: QUALITY_HIGH }
  const [avc, vp9, vp8, aac, opus] = await Promise.all([canEncodeVideo('avc', v), canEncodeVideo('vp9', v), canEncodeVideo('vp8', v), canEncodeAudio('aac', a), canEncodeAudio('opus', a)])
  if (prefer === 'mp4' && avc) return { container: 'mp4', video: 'avc', audio: aac ? 'aac' : opus ? 'opus' : null }
  if (vp9 || vp8) return { container: 'webm', video: vp9 ? 'vp9' : 'vp8', audio: opus ? 'opus' : null }
  if (avc) return { container: 'mp4', video: 'avc', audio: aac ? 'aac' : opus ? 'opus' : null }
  throw new Error('This system cannot encode video (no H.264, VP9 or VP8 encoder).')
}

/** Put every V1 clip under `time` at its exact source frame, and wait until the frame is decoded; stills load once. */
async function seekFootage(project: VideoProject, time: number) {
  const waits: Promise<void>[] = []
  for (const c of project.clips) {
    if (c.trackId !== 'v1' || !c.still || !c.sourceUrl || time < c.start || time >= c.start + c.duration) continue
    const img = getCachedImage(c.sourceUrl)
    if (img && !img.complete) waits.push(img.decode().catch(() => {}))
  }
  for (const c of project.clips) {
    if (c.trackId !== 'v1' || !c.sourceUrl || c.still || time < c.start || time >= c.start + c.duration) continue
    const v = getCachedVideo(c.sourceUrl)
    if (!v) continue
    const target = Math.max(0, (c.in || 0) + (time - c.start))
    if (v.readyState < 1) {
      waits.push(new Promise((res) => { v.addEventListener('loadedmetadata', () => res(), { once: true }); setTimeout(res, 4000) }))
    }
    waits.push((async () => {
      if (v.readyState < 1) await new Promise((r) => setTimeout(r, 0))
      if (Math.abs(v.currentTime - target) < 1 / (project.fps * 4) && v.readyState >= 2) return
      await new Promise<void>((res) => {
        const done = () => { clearTimeout(t); v.removeEventListener('seeked', done); res() }
        const t = setTimeout(done, 3000)
        v.addEventListener('seeked', done)
        v.currentTime = target
      })
    })())
  }
  await Promise.all(waits)
}

/** Mix the audible clips into one stereo buffer the length of the export. */
export async function mixAudio(project: VideoProject, duration: number): Promise<AudioBuffer | null> {
  const clips = audibleClips(project).filter((c) => c.start < duration)
  if (!clips.length) return null
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * SAMPLE_RATE), SAMPLE_RATE)
  const decoded = new Map<string, AudioBuffer | null>()
  let placed = 0
  for (const c of clips) {
    const url = c.sourceUrl!
    if (!decoded.has(url)) {
      try {
        const bytes = await (await fetch(url)).arrayBuffer()
        decoded.set(url, await ctx.decodeAudioData(bytes))
      } catch {
        decoded.set(url, null)
      }
    }
    const buf = decoded.get(url)
    if (!buf) continue
    const src = ctx.createBufferSource()
    src.buffer = buf
    const gain = ctx.createGain()
    gain.gain.value = c.volume ?? 1
    src.connect(gain).connect(ctx.destination)
    const length = Math.min(c.duration, duration - c.start, buf.duration - (c.in || 0))
    if (length <= 0) continue
    src.start(c.start, c.in || 0, length)
    placed++
  }
  return placed ? ctx.startRendering() : null
}

export async function exportTimelineVideo(
  timeline: VideoProject,
  onProgress: (current: number, total: number) => void,
  options: ExportOptions = {},
): Promise<ExportResult> {
  const fps = options.fps || timeline.fps || 30
  const duration = exportDuration(timeline, options.maxDuration)
  const totalFrames = Math.max(1, Math.round(duration * fps))
  const codecs = await pickCodecs(timeline.width, timeline.height, fps, options.container)

  const canvas = document.createElement('canvas')
  canvas.width = timeline.width
  canvas.height = timeline.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get a 2D canvas for the render')

  const audio = codecs.audio ? await mixAudio(timeline, duration) : null

  const target = new BufferTarget()
  const output = new Output({
    format: codecs.container === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target,
  })
  const videoSource = new CanvasSource(canvas, { codec: codecs.video, bitrate: options.bitrate ?? (timeline.width * timeline.height >= 1920 * 1080 ? 10_000_000 : 8_000_000), keyFrameInterval: 2 })
  output.addVideoTrack(videoSource, { frameRate: fps })
  const audioSource = audio && codecs.audio ? new AudioBufferSource({ codec: codecs.audio, quality: QUALITY_HIGH }) : null
  if (audioSource) output.addAudioTrack(audioSource)
  await output.start()

  try {
    for (let i = 0; i < totalFrames; i++) {
      if (options.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError')
      const t = i / fps
      await seekFootage(timeline, t)
      renderCompositeFrame(ctx, timeline, t, canvas.width, canvas.height)
      await videoSource.add(t, 1 / fps)
      onProgress(i + 1, totalFrames)
    }
    if (audioSource && audio) await audioSource.add(audio)
    await output.finalize()
  } catch (err) {
    await output.cancel().catch(() => {})
    throw err
  } finally {
    canvas.width = canvas.height = 0
  }

  const mime = codecs.container === 'mp4' ? 'video/mp4' : 'video/webm'
  const blob = new Blob([target.buffer!], { type: mime })
  const safeTitle = (timeline.name || 'video').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'video'
  return {
    filename: `${safeTitle}-${timeline.aspect.replace(':', 'x')}.${codecs.container}`,
    blob,
    size: blob.size,
    duration,
    container: codecs.container,
    videoCodec: codecs.video === 'avc' ? 'H.264' : codecs.video.toUpperCase(),
    audioCodec: audioSource ? (codecs.audio === 'aac' ? 'AAC' : 'Opus') : null,
  }
}

export function downloadVideoBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
