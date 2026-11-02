// Face tracking for auto reframe: MediaPipe's face detector (local wasm + model, see tools/copy-mediapipe-wasm.mjs),
// run on frames the editor's own video element seeks to. Nothing leaves the PC.
import type { SubjectFrame } from './reframe'

let detector: Promise<import('@mediapipe/tasks-vision').FaceDetector> | null = null

/** One detector for the session. Loads the wasm and the bundled model from /public (never a CDN). */
export function faceDetector(): Promise<import('@mediapipe/tasks-vision').FaceDetector> {
  if (!detector) {
    detector = (async () => {
      const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision')
      const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm')
      return FaceDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: '/models/mediapipe/blaze_face_short_range.tflite', delegate: 'CPU' },
        runningMode: 'IMAGE',
        minDetectionConfidence: 0.5,
      })
    })()
    // a failed load must not stick: the next press tries again
    detector.catch(() => { detector = null })
  }
  return detector
}

/** Seek the video to each time (source seconds), detect the largest face in the frame. Frames with no face keep box null
 * (planReframe holds the last known position). Boxes are normalised to the frame (0..1). */
export async function trackFaces(video: HTMLVideoElement, times: number[], opts: { maxWidth?: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}): Promise<SubjectFrame[]> {
  const det = await faceDetector()
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Could not draw video frames for face detection.')
  const maxW = opts.maxWidth ?? 640
  const out: SubjectFrame[] = []
  for (let i = 0; i < times.length; i++) {
    if (opts.signal?.aborted) throw new Error('Face analysis was cancelled')
    const t = times[i]
    await seek(video, t)
    const vw = video.videoWidth
    const vh = video.videoHeight
    if (!vw || !vh) throw new Error('This clip’s picture could not be read for face detection.')
    const scale = Math.min(1, maxW / vw)
    canvas.width = Math.max(1, Math.round(vw * scale))
    canvas.height = Math.max(1, Math.round(vh * scale))
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const res = det.detect(canvas)
    let best: { x: number; y: number; w: number; h: number } | null = null
    for (const d of res.detections) {
      const b = d.boundingBox
      if (!b) continue
      const box = { x: b.originX / canvas.width, y: b.originY / canvas.height, w: b.width / canvas.width, h: b.height / canvas.height }
      if (!best || box.w * box.h > best.w * best.h) best = box
    }
    out.push({ t, box: best ? clampBox(best) : null })
    opts.onProgress?.(i + 1, times.length)
  }
  return out
}

const clampBox = (b: { x: number; y: number; w: number; h: number }) => {
  const x = Math.min(1, Math.max(0, b.x)); const y = Math.min(1, Math.max(0, b.y))
  return { x, y, w: Math.min(1 - x, Math.max(0, b.w)), h: Math.min(1 - y, Math.max(0, b.h)) }
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (Math.abs(video.currentTime - t) < 0.001 && video.readyState >= 2) { resolve(); return }
    const onSeeked = () => { cleanup(); resolve() }
    const onError = () => { cleanup(); reject(new Error('The video could not be read at that point.')) }
    const cleanup = () => { video.removeEventListener('seeked', onSeeked); video.removeEventListener('error', onError) }
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('error', onError)
    video.currentTime = t
  })
}

/** Evenly spaced sample times across [from, to) at `fps` samples per second, capped at `max` samples. */
export function sampleTimes(from: number, to: number, fps = 4, max = 2400): number[] {
  if (!(to > from)) return []
  const n = Math.min(max, Math.max(1, Math.floor((to - from) * fps)))
  return Array.from({ length: n }, (_, i) => from + ((i + 0.5) * (to - from)) / n)
}
