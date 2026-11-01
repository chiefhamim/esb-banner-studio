// Background proxy maker (a dedicated worker, so decoding and encoding never block the desk). It reads the original
// through its esb-media:// URL (range requests) and writes a 540p H.264 MP4 with a key frame every 0.5 s through
// mediabunny's Conversion API. The bytes go back to the page in pieces (StreamTarget), which hands them to main
// (`esb:video-proxy-write`); the next piece is produced only after the page acknowledges the last one, so memory stays
// flat however long the source is. The proxy keeps the original's timestamps (`trim.start = 0`), so a source time
// means the same frame in the proxy and in the original. No ffmpeg at runtime.
//
// Messages in:  { type: 'start', url, width, height } · { type: 'ack', n } · { type: 'nack', n, error } · { type: 'cancel' }
// Messages out: { type: 'write', n, position, data } · { type: 'progress', p } · { type: 'done', ms } ·
//               { type: 'canceled' } · { type: 'error', error }
import { ALL_FORMATS, Conversion, ConversionCanceledError, Input, Mp4OutputFormat, Output, StreamTarget, UrlSource } from 'mediabunny'
import type { StreamTargetChunk } from 'mediabunny'
import { proxyConversionOptions } from './engine/proxyOptions'

type Msg = { type: 'start'; url: string; width: number; height: number } | { type: 'ack'; n: number } | { type: 'nack'; n: number; error: string } | { type: 'cancel' }

const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as { postMessage: (m: unknown, t: Transferable[]) => void }).postMessage(m, transfer)
const acks = new Map<number, { res: () => void; rej: (e: Error) => void }>()
let seq = 0
let conversion: Conversion | null = null
let cancelled = false

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data
  if (m.type === 'ack') { acks.get(m.n)?.res(); acks.delete(m.n) }
  else if (m.type === 'nack') { acks.get(m.n)?.rej(new Error(m.error)); acks.delete(m.n) }
  else if (m.type === 'cancel') { cancelled = true; void conversion?.cancel() }
  else if (m.type === 'start') void run(m)
}

async function run(m: { url: string; width: number; height: number }) {
  const t0 = performance.now()
  const input = new Input({ source: new UrlSource(m.url, { maxCacheSize: 32 * 1024 * 1024 }), formats: ALL_FORMATS })
  try {
    const writable = new WritableStream<StreamTargetChunk>({
      write: (chunk) => new Promise<void>((res, rej) => {
        const n = ++seq
        acks.set(n, { res, rej })
        const data = chunk.data.slice() // our own copy, transferred to the page
        post({ type: 'write', n, position: chunk.position, data }, [data.buffer])
      }),
    })
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: new StreamTarget(writable, { chunked: true, chunkSize: 4 * 1024 * 1024 }) })
    conversion = await Conversion.init({
      input,
      output,
      ...proxyConversionOptions(m.width, m.height),
    })
    if (!conversion.isValid || !conversion.utilizedTracks.some((t) => t.type === 'video')) {
      throw new Error('This file cannot be converted here: ' + (conversion.discardedTracks.map((d) => d.reason).join(', ') || 'no video track'))
    }
    let last = 0
    conversion.onProgress = (p) => { const now = performance.now(); if (now - last > 200 || p >= 1) { last = now; post({ type: 'progress', p }) } }
    if (cancelled) throw new ConversionCanceledError()
    await conversion.execute()
    post({ type: 'done', ms: Math.round(performance.now() - t0) })
  } catch (err) {
    if (err instanceof ConversionCanceledError || cancelled) post({ type: 'canceled' })
    else post({ type: 'error', error: String((err as Error)?.message || err).slice(0, 300) })
  } finally {
    input.dispose()
  }
}
