// Real frame-by-frame video renderer and exporter using Canvas stream & MediaRecorder.

import type { VideoProject } from './timeline'
import { renderCompositeFrame } from './compositor'

export interface ExportResult {
  filename: string
  blob: Blob
  size: number
  duration: number
}

export interface ExportOptions {
  maxDuration?: number
  bitrate?: number
  fps?: number
}

export async function exportTimelineVideo(
  timeline: VideoProject,
  onProgress: (current: number, total: number) => void,
  options: ExportOptions = {},
): Promise<ExportResult> {
  const fps = options.fps || 30
  const maxDuration = options.maxDuration ?? Math.min(timeline.duration, 15.0)
  const duration = Math.min(timeline.duration, maxDuration)
  const totalFrames = Math.max(1, Math.round(duration * fps))

  // Canvas must be attached to the DOM for Chromium captureStream frame pump
  const canvas = document.createElement('canvas')
  canvas.width = timeline.width
  canvas.height = timeline.height
  canvas.style.position = 'fixed'
  canvas.style.left = '-9999px'
  canvas.style.top = '-9999px'
  canvas.style.pointerEvents = 'none'
  document.body.appendChild(canvas)

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    canvas.remove()
    throw new Error('Could not get 2D canvas context for video render')
  }

  const stream = canvas.captureStream(fps)

  const chunks: Blob[] = []

  let mimeType = 'video/webm; codecs=vp9'
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = 'video/webm; codecs=vp8'
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm'
    }
  }

  const bitrate = options.bitrate || 6_000_000

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: bitrate,
  })

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data)
  }

  return new Promise((resolve, reject) => {
    recorder.onstop = () => {
      try {
        canvas.remove()
      } catch {}

      const blob = new Blob(chunks, { type: mimeType })
      console.log('Video render finished. Chunks:', chunks.length, 'Total size:', blob.size)
      const safeTitle = (timeline.name || 'video').toLowerCase().replace(/[^a-z0-9]+/g, '-')
      const filename = `${safeTitle}-${timeline.aspect}.webm`
      resolve({
        filename,
        blob,
        size: blob.size,
        duration,
      })
    }

    recorder.onerror = (e) => {
      try {
        canvas.remove()
      } catch {}
      console.error('MediaRecorder error:', e)
      reject(e)
    }

    recorder.start(200)

    let frame = 0
    const frameInterval = 1000 / fps

    function renderNext() {
      if (frame >= totalFrames) {
        // Allow MediaRecorder encoder to flush the final frames
        setTimeout(() => {
          if (recorder.state === 'recording') {
            recorder.stop()
          }
        }, 600)
        return
      }

      const t = frame / fps
      renderCompositeFrame(ctx!, timeline, t, canvas.width, canvas.height)
      const track = stream.getVideoTracks()[0] as any
      if (track && typeof track.requestFrame === 'function') {
        track.requestFrame()
      }
      onProgress(frame + 1, totalFrames)
      frame++

      setTimeout(renderNext, frameInterval / 2)
    }

    renderNext()
  })
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
