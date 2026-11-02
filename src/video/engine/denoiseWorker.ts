// Noise reduction off the main thread: a worker runs the STFT denoiser (audio/denoise.ts) on a clip's PCM, so a long
// clip never blocks the desk. Message in: { id, channels: Float32Array[] (transferred), sampleRate, opts }.
// Message out: { id, channels } (transferred back) or { id, error }.
import { denoise } from '../audio/denoise'
import type { DenoiseOptions } from '../audio/denoise'

type In = { id: number; channels: Float32Array[]; sampleRate: number; opts: DenoiseOptions }
self.onmessage = (e: MessageEvent<In>) => {
  const { id, channels, sampleRate, opts } = e.data
  const post = self as unknown as { postMessage: (m: unknown, t?: Transferable[]) => void }
  try {
    const out = denoise(channels, sampleRate, opts)
    post.postMessage({ id, channels: out }, out.map((c) => c.buffer))
  } catch (err) {
    post.postMessage({ id, error: String((err as Error)?.message || err) })
  }
}
