// Video export, frame-exact, through WebCodecs.
//
// The first exporter recorded a canvas with MediaRecorder. That ties the file's timing to the wall clock, so it
// drifted, ran at the wrong speed and was capped at 3 seconds with no sound. Here each frame is drawn only once every
// clip under it is at the exact instant, and is encoded with its own timestamp (i/fps), so a 90-second timeline is a
// 90-second file however long the render takes.
//
// Footage frames are decoded by mediabunny (demux + WebCodecs VideoDecoder) at exactly the frame times the export
// needs (samplesAtTimestamps), so a long source is read once, front to back. A source the decoder cannot read falls
// back to seeking its <video> element per frame. Sound: every audible clip on the audio tracks — voiceover, music and
// each footage clip's own sound (its linked A1 clip) — is decoded the same way and mixed offline at 48 kHz in 10 s
// pieces, each added just before the frames it belongs to, so the muxer interleaves and nothing waits in memory.
//
// Where the file goes: in the desktop app the muxer streams to a file the editor chose (StreamTarget → main, which
// writes it in place), so a long export never holds the file in memory. In the browser it is kept in memory and
// downloaded (BufferTarget).
//
// MP4 (H.264) is the default. Audio is AAC where the platform encodes it (Windows, macOS) and Opus otherwise. WebM
// (VP9 + Opus) is the fallback when H.264 is unavailable.

import { AudioBufferSink, AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, StreamTarget, VideoSampleSink, WebMOutputFormat, canEncodeAudio, canEncodeVideo } from 'mediabunny'
import type { Input, StreamTargetChunk, VideoSample } from 'mediabunny'
import type { Clip, VideoProject } from './timeline'
import { audibleClips, clipsMissingMedia, contentEnd, isActive } from './timeline'
import { getCachedImage, getCachedVideo, picturesReady } from './compositor'
import { inputFor } from './media'
import { GLCompositor } from './engine/glCompositor'
import { renderFrame } from './engine/render'
import type { FrameInput } from './engine/render'
import { exportUrl } from './engine/mediaSource'
import { holdBackgroundFor, holdProxies } from './engine/background'

/** The graphics context went away mid-export (GPU reset, driver update): the frames would be black. */
export const CONTEXT_LOST_MESSAGE = 'The graphics context was lost during the export (the GPU was reset), so the remaining frames could not be drawn. Nothing was saved; export again.'

export type ExportContainer = 'mp4' | 'webm'

export interface ExportResult {
  filename: string
  /** The file in memory (browser export only; a streamed export is already on disk). */
  blob: Blob | null
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
  /** Stream the file here instead of keeping it in memory (desktop: a file main opened in the chosen place). */
  writable?: WritableStream<StreamTargetChunk>
}

const SAMPLE_RATE = 48000
const AUDIO_CHUNK_SECONDS = 10

export { audibleClips }

/** How long the file is: up to the end of the last clip, or the requested draft length. */
export function exportDuration(project: VideoProject, maxDuration?: number): number {
  const end = contentEnd(project)
  const d = maxDuration != null ? Math.min(end, maxDuration) : end
  return Math.max(1 / Math.max(1, project.fps), d)
}

/** Why an export cannot start, or null. A timeline with missing media would export holes, so it is refused. */
export function exportBlocker(project: VideoProject): string | null {
  if (!project.clips.length || contentEnd(project) <= 0) return 'The timeline is empty. Import media or build a video from a story first.'
  const missing = clipsMissingMedia(project)
  if (missing.length) return `${missing.length} clip${missing.length === 1 ? '' : 's'} ${missing.length === 1 ? 'has' : 'have'} no media (${missing.slice(0, 2).map((c) => c.title).join(', ')}${missing.length > 2 ? ', …' : ''}). Relink the files in the Media tab first.`
  return null
}

/** Overlay and caption clips with nothing typed in: they are left out of the export (their labels are editor-only). */
export function emptyTextClips(project: VideoProject): Clip[] {
  return project.clips.filter((c) => {
    if (c.kind === 'caption') return !(c.captionText ?? '').trim()
    if (c.kind === 'overlay' && c.overlayType && c.overlayType !== 'logo' && !c.sourceUrl) return !(c.overlayText ?? '').trim() && !(c.overlaySub ?? '').trim()
    return false
  })
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

// ---------------------------------------------------------------- footage frames

/** Source time of `clip` at timeline time `t`. */
const srcTime = (c: Clip, t: number) => Math.max(0, (c.in || 0) + (t - c.start))

/** The frame numbers of an export at which `clip` is on screen. */
export function activeFrames(clip: Clip, fps: number, totalFrames: number): number[] {
  const out: number[] = []
  const first = Math.max(0, Math.floor(clip.start * fps) - 1)
  const last = Math.min(totalFrames - 1, Math.ceil((clip.start + clip.duration) * fps) + 1)
  for (let i = first; i <= last; i++) if (isActive(clip, i / fps)) out.push(i)
  return out
}

interface FootageReader { input: Input; iter: AsyncIterator<VideoSample | null>; lastFrame: number }

/** Open a decoder for one footage clip that yields exactly one frame per export frame it is on screen; null when the
 * decoder cannot read it (the <video> fallback is used). */
async function openFootage(clip: Clip, fps: number, totalFrames: number): Promise<FootageReader | null> {
  const url = exportUrl(clip)
  if (!url) return null
  const frames = activeFrames(clip, fps, totalFrames)
  if (!frames.length) return null
  let input: Input | null = null
  try {
    input = inputFor(url)
    const track = await input.getPrimaryVideoTrack()
    if (!track || !(await track.canDecode())) { input.dispose(); return null }
    const sink = new VideoSampleSink(track)
    const times = frames.map((i) => srcTime(clip, i / fps))
    return { input, iter: sink.samplesAtTimestamps(times)[Symbol.asyncIterator](), lastFrame: frames[frames.length - 1] }
  } catch {
    input?.dispose()
    return null
  }
}

/** Fallback: put a footage clip's <video> at its exact source frame and wait until the frame is decoded. */
async function seekElement(c: Clip, time: number, fps: number): Promise<FrameInput | null> {
  const v = getCachedVideo(exportUrl(c)!)
  if (!v) return null
  const target = srcTime(c, time)
  if (v.readyState < 1) await new Promise<void>((res) => { v.addEventListener('loadedmetadata', () => res(), { once: true }); setTimeout(res, 4000) })
  if (!(Math.abs(v.currentTime - target) < 1 / (fps * 4) && v.readyState >= 2)) {
    await new Promise<void>((res) => {
      const done = () => { clearTimeout(t); v.removeEventListener('seeked', done); res() }
      const t = setTimeout(done, 3000)
      v.addEventListener('seeked', done)
      v.currentTime = target
    })
  }
  return v.readyState >= 2 && v.videoWidth > 0 ? { image: v, width: v.videoWidth, height: v.videoHeight, live: true } : null
}

// ---------------------------------------------------------------- sound

interface AudioReader { buffers(from: number, to: number): AsyncIterable<{ buffer: AudioBuffer; timestamp: number }>; close(): void }

/** A reader over one file's sound: mediabunny's decoder, or (a file it cannot read) the whole file through
 * decodeAudioData. Null when the file has no sound. */
async function openAudio(url: string): Promise<AudioReader | null> {
  try {
    const input = inputFor(url)
    const track = await input.getPrimaryAudioTrack()
    if (track && (await track.canDecode())) {
      const sink = new AudioBufferSink(track)
      return { buffers: (a, b) => sink.buffers(a, b), close: () => input.dispose() }
    }
    input.dispose()
    if (!track) return null
  } catch { /* fall through to decodeAudioData */ }
  try {
    const bytes = await (await fetch(url)).arrayBuffer()
    const buffer = await new OfflineAudioContext(2, 1, SAMPLE_RATE).decodeAudioData(bytes)
    return {
      buffers: async function* () { yield { buffer, timestamp: 0 } },
      close: () => {},
    }
  } catch {
    return null
  }
}

/** Mix the audible clips over [t0, t1) of the timeline into one stereo 48 kHz buffer (silence where nothing plays). */
async function mixPiece(clips: Clip[], readers: Map<string, AudioReader | null>, t0: number, t1: number): Promise<AudioBuffer> {
  const length = Math.max(1, Math.round((t1 - t0) * SAMPLE_RATE))
  const here = clips.filter((c) => c.start < t1 && c.start + c.duration > t0)
  if (!here.length) return new AudioBuffer({ length, numberOfChannels: 2, sampleRate: SAMPLE_RATE })
  const ctx = new OfflineAudioContext(2, length, SAMPLE_RATE)
  for (const c of here) {
    const url = exportUrl(c)!
    if (!readers.has(url)) readers.set(url, await openAudio(url))
    const reader = readers.get(url)
    if (!reader) continue
    const a = Math.max(t0, c.start)
    const b = Math.min(t1, c.start + c.duration)
    if (b <= a) continue
    const gain = ctx.createGain()
    gain.gain.value = c.volume ?? 1
    gain.connect(ctx.destination)
    for await (const wb of reader.buffers(srcTime(c, a), srcTime(c, b))) {
      // where this decoded piece's first sample lands in the mix, clipped to the part of the clip inside [t0, t1)
      const when = c.start + (wb.timestamp - (c.in || 0)) - t0
      let start = when
      let offset = 0
      if (start < a - t0) { offset = a - t0 - start; start = a - t0 }
      const end = Math.min(when + wb.buffer.duration, b - t0)
      if (end <= start) continue
      const src = ctx.createBufferSource()
      src.buffer = wb.buffer
      src.connect(gain)
      src.start(start, offset, end - start)
    }
  }
  return ctx.startRendering()
}

/** Mix the audible clips into one stereo buffer the length of the export (tests and short previews). */
export async function mixAudio(project: VideoProject, duration: number): Promise<AudioBuffer | null> {
  const clips = audibleClips(project).filter((c) => c.start < duration)
  if (!clips.length) return null
  const readers = new Map<string, AudioReader | null>()
  try { return await mixPiece(clips, readers, 0, duration) } finally { readers.forEach((r) => r?.close()) }
}

async function fontsReady() {
  if (typeof document === 'undefined' || !document.fonts) return
  await Promise.all(['500', '600', '700', '800'].flatMap((wt) => [document.fonts.load(`${wt} 40px "ESB Sans"`), document.fonts.load(`${wt} 40px "Hind Siliguri"`, 'বাংলা')]).map((p) => p.catch(() => null)))
  await document.fonts.ready
}

export async function exportTimelineVideo(
  timeline: VideoProject,
  onProgress: (current: number, total: number) => void,
  options: ExportOptions = {},
): Promise<ExportResult> {
  const blocked = exportBlocker(timeline)
  if (blocked) throw new Error(blocked)
  const fps = options.fps || timeline.fps || 30
  const duration = exportDuration(timeline, options.maxDuration)
  const totalFrames = Math.max(1, Math.round(duration * fps))
  const codecs = await pickCodecs(timeline.width, timeline.height, fps, options.container)
  await fontsReady()

  // the same WebGL2 compositor and render path as the monitor; without WebGL2 the export stops with the reason
  const canvas = document.createElement('canvas')
  canvas.width = timeline.width
  canvas.height = timeline.height
  const comp = new GLCompositor(canvas)
  await picturesReady(timeline.clips.filter((c) => c.sourceUrl && (c.still || c.kind === 'overlay')).map((c) => c.sourceUrl!))

  const sounding = codecs.audio ? audibleClips(timeline).filter((c) => c.start < duration) : []
  const bufferTarget = options.writable ? null : new BufferTarget()
  let written = 0
  const target = options.writable
    ? new StreamTarget(new WritableStream<StreamTargetChunk>({
      write: async (chunk) => {
        written = Math.max(written, chunk.position + chunk.data.byteLength)
        const w = options.writable!.getWriter()
        try { await w.write(chunk) } finally { w.releaseLock() }
      },
    }), { chunked: true, chunkSize: 8 * 1024 * 1024 })
    : bufferTarget!
  const output = new Output({
    format: codecs.container === 'mp4' ? new Mp4OutputFormat({ fastStart: options.writable ? false : 'in-memory' }) : new WebMOutputFormat(),
    target,
  })
  const videoSource = new CanvasSource(canvas, { codec: codecs.video, bitrate: options.bitrate ?? (timeline.width * timeline.height >= 1920 * 1080 ? 10_000_000 : 8_000_000), keyFrameInterval: 2 })
  output.addVideoTrack(videoSource, { frameRate: fps })
  const audioSource = sounding.length && codecs.audio ? new AudioBufferSource({ codec: codecs.audio, quality: QUALITY_HIGH }) : null
  if (audioSource) output.addAudioTrack(audioSource)
  await output.start()

  const footage = timeline.clips.filter((c) => c.kind === 'video' && !c.still && !!c.sourceUrl)
  const readers = new Map<string, FootageReader | null>()
  const audioReaders = new Map<string, AudioReader | null>()
  let audioUpTo = 0
  const addAudioUntil = async (t: number) => {
    if (!audioSource) return
    while (audioUpTo < Math.min(t, duration) - 1e-9) {
      const t1 = Math.min(duration, audioUpTo + AUDIO_CHUNK_SECONDS)
      await audioSource.add(await mixPiece(sounding, audioReaders, audioUpTo, t1))
      audioUpTo = t1
    }
  }

  // filmstrips, waveforms and proxies wait while the export runs (they would take decoder and GPU time from it)
  const releaseBackground = holdBackgroundFor('export')
  const releaseProxies = holdProxies('export')
  try {
    for (let i = 0; i < totalFrames; i++) {
      if (options.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError')
      const t = i / fps
      // the sound for the next 10 s goes in as the picture reaches it
      if (t >= audioUpTo) await addAudioUntil(t + AUDIO_CHUNK_SECONDS)
      const frames = new Map<string, FrameInput>()
      const samples: VideoSample[] = []
      try {
        const waits: Promise<void>[] = []
        for (const c of footage) {
          if (!isActive(c, t)) {
            const r = readers.get(c.id)
            if (r && i > r.lastFrame) { r.input.dispose(); readers.set(c.id, null) }
            continue
          }
          if (!readers.has(c.id)) readers.set(c.id, await openFootage(c, fps, totalFrames))
          const r = readers.get(c.id)
          if (r) {
            const { value } = await r.iter.next()
            if (value) {
              samples.push(value)
              frames.set(c.id, { image: value.toCanvasImageSource(), width: value.displayWidth, height: value.displayHeight })
            }
          } else {
            waits.push(seekElement(c, t, fps).then((f) => { if (f) frames.set(c.id, f) }))
          }
        }
        for (const c of timeline.clips) {
          if (c.still && c.sourceUrl && isActive(c, t)) {
            const img = getCachedImage(c.sourceUrl)
            if (img && !img.complete) waits.push(img.decode().catch(() => {}))
          }
        }
        await Promise.all(waits)
        if (comp.isLost()) throw new Error(CONTEXT_LOST_MESSAGE)
        renderFrame(comp, timeline, t, canvas.width, canvas.height, { frames: (c) => frames.get(c.id) ?? null })
        if (comp.isLost()) throw new Error(CONTEXT_LOST_MESSAGE)
      } finally {
        // every decoded frame is closed, whatever happened to this one
        for (const s of samples) { try { s.close() } catch { /* closed */ } }
      }
      await videoSource.add(t, 1 / fps)
      onProgress(i + 1, totalFrames)
    }
    await addAudioUntil(duration)
    await output.finalize()
  } catch (err) {
    await output.cancel().catch(() => {})
    throw err
  } finally {
    releaseBackground()
    releaseProxies()
    readers.forEach((r) => r?.input.dispose())
    audioReaders.forEach((r) => r?.close())
    comp.dispose()
    comp.gl.getExtension('WEBGL_lose_context')?.loseContext()
    canvas.width = canvas.height = 0
  }

  const mime = codecs.container === 'mp4' ? 'video/mp4' : 'video/webm'
  const blob = bufferTarget ? new Blob([bufferTarget.buffer!], { type: mime }) : null
  return {
    filename: exportFilename(timeline, codecs.container),
    blob,
    size: blob ? blob.size : written,
    duration,
    container: codecs.container,
    videoCodec: codecs.video === 'avc' ? 'H.264' : codecs.video.toUpperCase(),
    audioCodec: audioSource ? (codecs.audio === 'aac' ? 'AAC' : 'Opus') : null,
  }
}

export function exportFilename(timeline: VideoProject, container: ExportContainer): string {
  const safeTitle = (timeline.name || 'video').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'video'
  return `${safeTitle}-${timeline.aspect.replace(':', 'x')}.${container}`
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
