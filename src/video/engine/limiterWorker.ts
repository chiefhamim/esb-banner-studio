// The export's true-peak limiter off the main thread: message in { id, channels (transferred), sampleRate, opts }, out
// { id, gain (transferred) } or { id, error }. The gain curve is the same `limiterGain` the tests measure.
import { limiterGain } from '../audio/normalize'
import type { LimiterOptions } from '../audio/normalize'

type In = { id: number; channels: Float32Array[]; sampleRate: number; opts: LimiterOptions }
self.onmessage = (e: MessageEvent<In>) => {
  const { id, channels, sampleRate, opts } = e.data
  const post = self as unknown as { postMessage: (m: unknown, t?: Transferable[]) => void }
  try {
    const gain = limiterGain(channels, sampleRate, opts)
    post.postMessage({ id, gain }, [gain.buffer])
  } catch (err) {
    post.postMessage({ id, error: String((err as Error)?.message || err) })
  }
}
