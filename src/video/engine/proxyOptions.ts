// The proxy maker's conversion settings (proxyWorker.ts), in one place so a test can run the same conversion in the
// page: 540p-class H.264, a key frame every 0.5 s, sound kept, and the source's own timestamps kept (`trim.start = 0`).
// Without the trim, mediabunny's Conversion shifts a file so it starts at 0, and a source whose first frame is at
// 1.5 s would preview 1.5 s ahead of its export and its sound.
import { QUALITY_MEDIUM } from 'mediabunny'

export function proxyConversionOptions(width: number, height: number) {
  return {
    video: { width, height, fit: 'fill' as const, codec: 'avc' as const, keyFrameInterval: 0.5, forceTranscode: true, quality: QUALITY_MEDIUM },
    // the sound is kept (copied when the container allows) so a proxy previews like its original
    audio: {},
    trim: { start: 0 },
    showWarnings: false,
  }
}
