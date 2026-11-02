// Auto reframe of one footage clip for one target shape: open the clip's picture, find the face four times a second,
// plan the crop. Used by the clip's own Auto reframe panel and by "Make all sizes". Local only (MediaPipe).
import type { Clip } from '../timeline'
import { previewUrl } from '../engine/mediaSource'
import { planReframe, type ReframePlan, type SubjectFrame, type TargetAspect } from './reframe'
import { sampleTimes, trackFaces } from './faceTrack'

export type ReframeOutcome =
  | { ok: true; plan: ReframePlan; frames: SubjectFrame[]; faces: number }
  | { ok: false; why: string; noFace?: boolean }

export async function reframeClip(clip: Clip, target: TargetAspect, opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}): Promise<ReframeOutcome> {
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  // the media protocol sends CORS headers for the app; without this the frame canvas is tainted and cannot be read
  video.crossOrigin = 'anonymous'
  video.src = previewUrl(clip) || clip.sourceUrl || ''
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('This clip’s picture could not be opened for analysis.'))
    })
    const srcW = video.videoWidth
    const srcH = video.videoHeight
    if (!srcW || !srcH) return { ok: false, why: 'This clip has no picture to analyse.' }
    const times = sampleTimes(clip.in, clip.out, 4)
    if (!times.length) return { ok: false, why: 'The clip has no length to analyse.' }
    const frames = await trackFaces(video, times, { signal: opts.signal, onProgress: opts.onProgress })
    const faces = frames.filter((f) => f.box).length
    if (!faces) return { ok: false, why: 'No face was found in this clip, so no crop was made. Try a clip with a face in view.', noFace: true }
    // frame times are source seconds; planReframe wants keyframe times relative to the clip's in-point
    return { ok: true, plan: planReframe(frames, { srcW, srcH, target, clipIn: clip.in }), frames, faces }
  } catch (e) {
    return { ok: false, why: (e as Error).message }
  } finally {
    video.removeAttribute('src')
    video.load()
  }
}
