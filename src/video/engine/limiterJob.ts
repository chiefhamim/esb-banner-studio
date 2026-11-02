// Run the limiter's gain computation in a worker (inline where there is no Worker: unit tests). One request at a time per
// call site is expected; requests are answered in order.
import { limiterGain } from '../audio/normalize'
import type { LimiterOptions } from '../audio/normalize'

let worker: Worker | null = null
let seq = 0
const waiting = new Map<number, { res: (g: Float32Array) => void; rej: (e: Error) => void }>()
let idle: ReturnType<typeof setTimeout> | undefined

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null
  if (worker) return worker
  try {
    const w = new Worker(new URL('./limiterWorker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<{ id: number; gain?: Float32Array; error?: string }>) => {
      const p = waiting.get(e.data.id)
      if (!p) return
      waiting.delete(e.data.id)
      if (e.data.gain) p.res(e.data.gain)
      else p.rej(new Error(e.data.error || 'limiter failed'))
    }
    w.onerror = (e) => { for (const p of waiting.values()) p.rej(new Error(e.message || 'limiter worker failed')); waiting.clear(); worker = null }
    worker = w
    return w
  } catch { return null }
}

/** The limiter's gain curve for `channels` (the arrays are handed to the worker and must not be used afterwards). */
export function limiterGainAsync(channels: Float32Array[], sampleRate: number, opts: LimiterOptions): Promise<Float32Array> {
  const w = getWorker()
  if (!w) return Promise.resolve(limiterGain(channels, sampleRate, opts))
  clearTimeout(idle)
  return new Promise<Float32Array>((res, rej) => {
    const id = ++seq
    waiting.set(id, { res, rej })
    w.postMessage({ id, channels, sampleRate, opts }, channels.map((c) => c.buffer))
  }).finally(() => {
    idle = setTimeout(() => { if (!waiting.size) { worker?.terminate(); worker = null } }, 15000)
  })
}
