// The sound of one footage clip's source range, as ONE mono channel at 16 kHz for the transcription engine and the silence
// detector. It is reduced buffer by buffer while it is decoded, so a long clip never holds its 48 kHz stereo original in memory
// (an hour of that is 1.4 GB; an hour as 16 kHz mono is 230 MB, and the cap below is shorter still).
import { openAudio } from '../engine/audioRender'
import { resample, TRANSCRIBE_RATE } from './transcribe'

export interface SourceAudio { channels: Float32Array[]; sampleRate: number }

/** Longest range decoded in one go, seconds (40 minutes: about 154 MB as 16 kHz mono floats). */
export const SOURCE_AUDIO_MAX_SEC = 40 * 60

/** Decode `[from, to)` seconds of a source file to mono 16 kHz. Refuses a range longer than `maxSec` and a file with no sound. */
export async function sourceAudio(url: string, from: number, to: number, maxSec = SOURCE_AUDIO_MAX_SEC): Promise<SourceAudio | { error: string }> {
  if (!(to > from)) return { error: 'The clip has no length to transcribe.' }
  if (to - from > maxSec) return { error: `Work on one clip of up to ${Math.round(maxSec / 60)} minutes at a time (this one is ${Math.round((to - from) / 60)} minutes). Split it, then transcribe each part.` }
  const reader = await openAudio(url)
  if (!reader) return { error: 'This file has no sound to transcribe.' }
  try {
    const out = new Float32Array(Math.max(1, Math.round((to - from) * TRANSCRIBE_RATE)))
    let any = false
    for await (const { buffer, timestamp } of reader.buffers(from, to)) {
      const sr = buffer.sampleRate
      const first = Math.max(0, Math.round((from - timestamp) * sr))
      const last = Math.min(buffer.length, Math.round((to - timestamp) * sr))
      if (last <= first) continue
      const ch = buffer.numberOfChannels
      const n = last - first
      const mono = new Float32Array(n)
      for (let c = 0; c < ch; c++) { const d = buffer.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[first + i] / ch }
      const small = sr === TRANSCRIBE_RATE ? mono : resample(mono, sr, TRANSCRIBE_RATE)
      const at = Math.round((timestamp + first / sr - from) * TRANSCRIBE_RATE)
      const room = Math.max(0, Math.min(small.length, out.length - at))
      if (room > 0) out.set(small.subarray(0, room), Math.max(0, at))
      any = true
    }
    if (!any) return { error: 'This file has no sound to transcribe.' }
    return { channels: [out], sampleRate: TRANSCRIBE_RATE }
  } finally {
    reader.close()
  }
}
