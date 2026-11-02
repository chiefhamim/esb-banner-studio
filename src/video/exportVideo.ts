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

import { AudioBufferSource, BufferTarget, CanvasSource, EncodedPacketSink, Mp4OutputFormat, Output, QUALITY_HIGH, StreamTarget, VideoSampleSink, WebMOutputFormat, canEncodeAudio, canEncodeVideo } from 'mediabunny'
import type { Input, StreamTargetChunk, VideoSample } from 'mediabunny'
import type { Clip, VideoProject } from './timeline'
import { audibleClips, clipsMissingMedia, contentEnd, isActive } from './timeline'
import { getCachedImage, getCachedVideo, picturesReady } from './compositor'
import { inputFor } from './media'
import { GLCompositor } from './engine/glCompositor'
import { canvasMeasure, measureNow, titleProblemText, titleProblems } from './titleClip'
import { renderFrame } from './engine/render'
import type { FrameInput } from './engine/render'
import { exportUrl } from './engine/mediaSource'
import { holdBackgroundFor, holdProxies } from './engine/background'
import { isPlainSpeed, srcAt } from './engine/animation'
import { prepareMix } from './engine/audioRender'
import type { ExportLoudness, PreparedMix } from './engine/audioRender'

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
  /** Phase 4: the measured loudness of the exported sound (null when the file has none). */
  loudness?: ExportLoudness | null
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
  /** Called with what the audio stage is doing before the picture starts (Reducing noise, Ducking, Measuring loudness). */
  onAudioStatus?: (text: string) => void
}

const SAMPLE_RATE = 48000

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
  // titles: an empty required field, placeholder or filler text, words cut by their lines (titleClip.ts)
  return titleProblemText(titleProblems(project, measureNow()))
}

/** Overlay and caption clips with nothing typed in: they are left out of the export (their labels are editor-only). */
export function emptyTextClips(project: VideoProject): Clip[] {
  return project.clips.filter((c) => {
    if (c.kind === 'caption') return !(c.captionText ?? '').trim()
    if (c.kind === 'overlay' && c.overlayType && c.overlayType !== 'logo' && !c.sourceUrl) return !(c.overlayText ?? '').trim() && !(c.overlaySub ?? '').trim()
    if (c.kind === 'overlay' && c.titleData?.look === 'classic') return !Object.values(c.titleData.fields).some((v) => v.trim())
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

/** Source time of `clip` at timeline time `t` (its speed, ramp, reverse or freeze included: engine/animation.ts). */
const srcTime = (c: Clip, t: number) => srcAt(c, t)

/** The frame numbers of an export at which `clip` is on screen. */
export function activeFrames(clip: Clip, fps: number, totalFrames: number): number[] {
  const out: number[] = []
  const first = Math.max(0, Math.floor(clip.start * fps) - 1)
  const last = Math.min(totalFrames - 1, Math.ceil((clip.start + clip.duration) * fps) + 1)
  for (let i = first; i <= last; i++) if (isActive(clip, i / fps)) out.push(i)
  return out
}

/** One export frame's picture of a footage clip, and how to free it once the frame is drawn. */
interface FootageFrame extends FrameInput { close(): void }
interface FootageReader { input: Input; iter: AsyncIterator<FootageFrame | null>; lastFrame: number }

const sampleFrame = (s: VideoSample): FootageFrame => ({ image: s.toCanvasImageSource(), width: s.displayWidth, height: s.displayHeight, close: () => { try { s.close() } catch { /* closed */ } } })

/** A decoded frame copied out of the decoder (a reverse run keeps a GOP's worth of frames). */
async function copyFrame(s: VideoSample): Promise<FootageFrame> {
  const vf = s.toVideoFrame()
  try {
    const bmp = await createImageBitmap(vf)
    return { image: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() }
  } finally { try { vf.close() } catch { /* closed */ } }
}

/** Frames a reverse run keeps at once (bytes); a GOP bigger than this is decoded again for its lower part. */
const REVERSE_BUDGET = 512 * 1024 * 1024

/** The frames at `times` (descending) of a reversed stretch: GOP by GOP from the top, each decoded forward from its key
 * frame once, copied, and handed out last first. */
async function* reverseRun(sink: VideoSampleSink, packets: EncodedPacketSink, times: number[], frameBytes: number): AsyncGenerator<FootageFrame | null> {
  const maxChunk = Math.max(1, Math.floor(REVERSE_BUDGET / Math.max(1, frameBytes)))
  let i = 0
  while (i < times.length) {
    const top = times[i]
    const key = await packets.getKeyPacket(top).catch(() => null)
    const start = key ? key.timestamp : 0
    let m = i
    while (m < times.length && times[m] >= start - 1e-9 && m - i < maxChunk) m++
    const want = times.slice(i, m).reverse() // ascending
    const got: (FootageFrame | null)[] = new Array(want.length).fill(null)
    let w = 0
    let prev: VideoSample | null = null
    try {
      for await (const smp of sink.samples(start, top + 1e-4)) {
        while (w < want.length && want[w] < smp.timestamp - 1e-6) { if (prev) got[w] = await copyFrame(prev); w++ }
        prev?.close()
        prev = smp
        if (w >= want.length) break
      }
      while (w < want.length) { if (prev) got[w] = await copyFrame(prev); w++ }
    } finally { prev?.close() }
    for (let j = got.length - 1; j >= 0; j--) yield got[j]
    i = m
  }
}

/** Every export frame of a speed-changed clip, in order: forward stretches through samplesAtTimestamps (each packet
 * decoded once), reversed stretches through reverseRun. */
async function* footageFrames(sink: VideoSampleSink, packets: EncodedPacketSink, times: number[], frameBytes: number): AsyncGenerator<FootageFrame | null> {
  let i = 0
  while (i < times.length) {
    let j = i + 1
    const down = j < times.length && times[j] < times[i] - 1e-9
    if (down) while (j < times.length && times[j] < times[j - 1] - 1e-9) j++
    else while (j < times.length && times[j] >= times[j - 1] - 1e-9) j++
    const run = times.slice(i, j)
    if (down) yield* reverseRun(sink, packets, run, frameBytes)
    else for await (const smp of sink.samplesAtTimestamps(run)) yield smp ? sampleFrame(smp) : null
    i = j
  }
}

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
    const iter: AsyncIterator<FootageFrame | null> = isPlainSpeed(clip)
      ? (async function* () { for await (const smp of sink.samplesAtTimestamps(times)) yield smp ? sampleFrame(smp) : null })()
      : footageFrames(sink, new EncodedPacketSink(track), times, track.displayWidth * track.displayHeight * 4)
    return { input, iter, lastFrame: frames[frames.length - 1] }
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
// The sound is engine/audioRender.ts: the same audio graph the preview plays through, rendered offline in 10 s pieces
// (noise reduction, ducking, master and the loudness stage included). Re-exported here for the callers that always
// imported it from the export module.
export { mixAudio, newSpeedAudioState, closeSpeedAudio } from './engine/audioRender'
export type { SpeedAudioState, ExportLoudness } from './engine/audioRender'

/** The loudness story of a finished export as short lines for the export sheet (null when there was no sound):
 * `ok` = the target was reached within 0.5 LU and the true peak is under the ceiling. */
export function exportLoudnessReport(r: Pick<ExportResult, 'loudness'>): { lines: string[]; ok: boolean; target: number | null } | null {
  const l = r.loudness
  if (!l) return null
  const f = (v: number, unit: string) => (Number.isFinite(v) ? `${v.toFixed(1)} ${unit}` : 'silent')
  const lines = [`Loudness ${f(l.after.integrated, 'LUFS')}${l.target != null ? ` (target ${l.target} LUFS)` : ''}`, `True peak ${f(l.after.truePeak, 'dBTP')}`, `Range ${l.after.lra.toFixed(1)} LU`]
  if (l.target != null) lines.push(`Gain ${l.gainDb >= 0 ? '+' : ''}${l.gainDb.toFixed(1)} dB${l.limited ? ', limiter on' : ''}`)
  if (l.note) lines.push(l.note)
  for (const w of l.warnings ?? []) lines.push(w)
  const ok = l.target == null ? l.after.truePeak <= l.ceiling + 0.5 : Number.isFinite(l.after.integrated) && Math.abs(l.after.integrated - l.target) <= 0.5 && l.after.truePeak <= l.ceiling + 0.3
  return { lines, ok, target: l.target }
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
  await canvasMeasure() // the title fit check measures with the real fonts
  await fontsReady()
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
  let mix: PreparedMix | null = null
  let audioUpTo = 0
  const addAudioUntil = async (t: number) => {
    if (!audioSource || !mix) return
    while (audioUpTo < Math.min(t, duration) - 1e-9) {
      const piece = await mix.next()
      if (!piece) break
      await audioSource.add(piece)
      audioUpTo += piece.length / SAMPLE_RATE
    }
  }
  if (audioSource) {
    try { mix = await prepareMix(timeline, duration, { signal: options.signal, onStatus: options.onAudioStatus }) } catch (err) { await output.cancel().catch(() => {}); throw err }
  }

  // filmstrips, waveforms and proxies wait while the export runs (they would take decoder and GPU time from it)
  const releaseBackground = holdBackgroundFor('export')
  const releaseProxies = holdProxies('export')
  try {
    for (let i = 0; i < totalFrames; i++) {
      if (options.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError')
      const t = i / fps
      // the sound for the next 10 s goes in as the picture reaches it
      if (t >= audioUpTo) await addAudioUntil(t + 10)
      const frames = new Map<string, FrameInput>()
      const samples: FootageFrame[] = []
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
              frames.set(c.id, value)
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
    mix?.dispose()
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
    loudness: mix?.loudness() ?? null,
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
