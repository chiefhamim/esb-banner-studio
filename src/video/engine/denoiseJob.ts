// Run the denoiser in a worker (the desk's main thread stays free: the work is one message out and one back), or inline
// where there is no Worker (unit tests). The clip's amount (0..1) maps to the denoiser's settings here, once, for the
// preview and the export alike.

import { denoise } from '../audio/denoise'
import type { DenoiseOptions } from '../audio/denoise'
import type { ClipDenoise } from '../audioModel'

/** amount 0..1 → the denoiser's floor (dB of reduction) and noise over-estimate. */
export function denoiseOptionsFor(d: ClipDenoise): DenoiseOptions {
  const a = Math.max(0, Math.min(1, d.amount))
  return { reduction: 6 + 24 * a, strength: 0.8 + 0.8 * a, ...(d.noiseRange ? { noiseRange: d.noiseRange } : {}) }
}

let worker: Worker | null = null
let seq = 0
const waiting = new Map<number, { res: (c: Float32Array[]) => void; rej: (e: Error) => void }>()
let idle: ReturnType<typeof setTimeout> | undefined

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null
  if (worker) return worker
  try {
    const w = new Worker(new URL('./denoiseWorker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<{ id: number; channels?: Float32Array[]; error?: string }>) => {
      const p = waiting.get(e.data.id)
      if (!p) return
      waiting.delete(e.data.id)
      if (e.data.channels) p.res(e.data.channels)
      else p.rej(new Error(e.data.error || 'denoise failed'))
    }
    w.onerror = (e) => { for (const p of waiting.values()) p.rej(new Error(e.message || 'denoise worker failed')); waiting.clear(); worker = null }
    worker = w
    return w
  } catch { return null }
}

const aborted = () => new DOMException('cancelled', 'AbortError')

/** Denoise `channels` (the arrays are handed to the worker and must not be used afterwards). With a `signal`, aborting
 * stops the work: the worker is shut down (a fresh one starts for the next job) and the promise rejects with an
 * AbortError. Callers run one job at a time (audioRender.ts queues them). */
export function denoiseAsync(channels: Float32Array[], sampleRate: number, opts: DenoiseOptions, signal?: AbortSignal): Promise<Float32Array[]> {
  if (signal?.aborted) return Promise.reject(aborted())
  const w = getWorker()
  if (!w) return Promise.resolve(denoise(channels, sampleRate, opts))
  clearTimeout(idle)
  const id = ++seq
  let onAbort: (() => void) | null = null
  return new Promise<Float32Array[]>((res, rej) => {
    waiting.set(id, { res, rej })
    onAbort = () => {
      if (!waiting.has(id)) return
      waiting.delete(id)
      try { w.terminate() } catch { /* gone */ }
      if (worker === w) worker = null
      for (const p of waiting.values()) p.rej(new Error('Noise reduction was restarted'))
      waiting.clear()
      rej(aborted())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    w.postMessage({ id, channels, sampleRate, opts }, channels.map((c) => c.buffer))
  }).finally(() => {
    if (onAbort) signal?.removeEventListener('abort', onAbort)
    idle = setTimeout(() => { if (!waiting.size) { worker?.terminate(); worker = null } }, 15000)
  })
}
