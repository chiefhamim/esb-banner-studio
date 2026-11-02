// The sound of one footage clip's source range, as plain channels for the transcription engine.
import { openAudio } from '../engine/audioRender'

export interface SourceAudio { channels: Float32Array[]; sampleRate: number }

/** Decode `[from, to)` seconds of a source file into two channels. Refuses a range longer than `maxSec`
 * (memory: about 1.4 MB a minute at 48 kHz stereo) and a file with no sound. */
export async function sourceAudio(url: string, from: number, to: number, maxSec = 3600): Promise<SourceAudio | { error: string }> {
  if (!(to > from)) return { error: 'The clip has no length to transcribe.' }
  if (to - from > maxSec) return { error: `Transcribe one clip up to ${Math.round(maxSec / 60)} minutes at a time (this one is ${Math.round((to - from) / 60)} minutes).` }
  const reader = await openAudio(url)
  if (!reader) return { error: 'This file has no sound to transcribe.' }
  try {
    let sr = 0
    let out: Float32Array[] = []
    for await (const { buffer, timestamp } of reader.buffers(from, to)) {
      if (!sr) {
        sr = buffer.sampleRate
        out = [new Float32Array(Math.max(1, Math.round((to - from) * sr))), new Float32Array(Math.max(1, Math.round((to - from) * sr)))]
      }
      const ts = timestamp
      const first = Math.max(0, Math.round((from - ts) * sr))
      const last = Math.min(buffer.length, Math.round((to - ts) * sr))
      if (last <= first) continue
      const at = Math.round((ts + first / sr - from) * sr)
      for (let ch = 0; ch < 2; ch++) {
        const src = buffer.getChannelData(Math.min(ch, buffer.numberOfChannels - 1)).subarray(first, last)
        const dst = out[ch]
        const n = Math.max(0, Math.min(src.length, dst.length - at))
        if (n > 0) dst.set(src.subarray(0, n), Math.max(0, at))
      }
    }
    if (!sr) return { error: 'This file has no sound to transcribe.' }
    return { channels: out, sampleRate: sr }
  } finally {
    reader.close()
  }
}
