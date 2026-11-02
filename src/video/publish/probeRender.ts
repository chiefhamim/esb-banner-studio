// Facts about a finished render, READ FROM THE FILE (never assumed from the export settings): size, length, picture,
// frame rate (constant or not), key-frame spacing and whether frames are reordered, audio codec and settings. The platform
// validators (electron/video-publish/validators.mjs) judge these; a fact that cannot be read is left out, and the
// validators treat a missing fact as a problem or a warning, never a pass.
import { ALL_FORMATS, CustomSource, EncodedPacketSink, Input } from 'mediabunny'
import type { MediaFacts } from '../../../electron/video-publish/validators.mjs'

export interface RenderReader { size: number; read: (start: number, end: number) => Promise<Uint8Array> }

const CHUNK = 4 * 1024 * 1024

/** Facts from any byte source (main hands the file over in pieces; tests pass a Blob). */
export async function probeFacts(reader: RenderReader): Promise<{ facts: MediaFacts; unreadable: string[] }> {
  const unreadable: string[] = []
  const facts: MediaFacts = { fileSize: reader.size }
  const input = new Input({
    source: new CustomSource({
      getSize: () => reader.size,
      read: async (start, end) => {
        // never ask for more than a chunk at a time, whatever the demuxer wants
        const out = new Uint8Array(end - start)
        for (let at = start; at < end; at += CHUNK) out.set(await reader.read(at, Math.min(end, at + CHUNK)), at - start)
        return out
      },
      maxCacheSize: 16 * 1024 * 1024,
    }),
    formats: ALL_FORMATS,
  })
  try {
    try { facts.durationSec = await input.computeDuration() } catch { unreadable.push('length') }
    const v = await input.getPrimaryVideoTrack().catch(() => null)
    if (v) {
      facts.width = v.displayWidth
      facts.height = v.displayHeight
      try { facts.videoCodec = String(await v.getCodec() ?? '') || undefined } catch { unreadable.push('video codec') }
      try {
        // every packet in decode order: frame spacing, key-frame spacing, reordering
        const sink = new EncodedPacketSink(v)
        const times: number[] = []
        const keys: number[] = []
        let reordered = false
        let prev = -Infinity
        let firstIsKey = false
        let n = 0
        for await (const p of sink.packets()) {
          if (n === 0) firstIsKey = p.type === 'key'
          if (p.timestamp < prev - 1e-6) reordered = true
          prev = Math.max(prev, p.timestamp)
          times.push(p.timestamp)
          if (p.type === 'key') keys.push(p.timestamp)
          n++
          if (n > 400_000) break
        }
        times.sort((a, b) => a - b)
        if (times.length > 2) {
          const deltas: number[] = []
          for (let i = 1; i < times.length; i++) deltas.push(times[i] - times[i - 1])
          const sorted = [...deltas].sort((a, b) => a - b)
          const median = sorted[Math.floor(sorted.length / 2)]
          const spread = Math.max(...deltas.map((d) => Math.abs(d - median)))
          // a constant rate: every gap within a millisecond or 1 % of the usual one
          facts.fpsMode = spread <= Math.max(0.001, median * 0.01) ? 'constant' : 'variable'
          facts.fps = Math.round((1 / median) * 100) / 100
          facts.fpsMin = Math.round((1 / Math.max(...deltas)) * 100) / 100
          facts.fpsMax = Math.round((1 / Math.min(...deltas.filter((d) => d > 1e-6))) * 100) / 100
        } else unreadable.push('frame rate')
        if (keys.length) {
          let gap = 0
          for (let i = 1; i < keys.length; i++) gap = Math.max(gap, keys[i] - keys[i - 1])
          // a single key frame: the whole file is one group
          facts.gopSec = keys.length === 1 ? (facts.durationSec ?? 0) : Math.round(gap * 100) / 100
          // frames never reordered and the file starts on a key frame: every group is closed
          facts.closedGop = firstIsKey && !reordered
        } else unreadable.push('key frames')
      } catch { unreadable.push('frame rate and key frames') }
    } else unreadable.push('picture')
    const a = await input.getPrimaryAudioTrack().catch(() => null)
    if (a) {
      try { facts.audioCodec = String(await a.getCodec() ?? '') || undefined } catch { unreadable.push('audio codec') }
      try { facts.audioSampleRate = await a.getSampleRate(); facts.audioChannels = await a.getNumberOfChannels() } catch { unreadable.push('audio settings') }
      try {
        const cp = await a.getCodecParameterString()
        // mp4a.40.2 is AAC-LC (the object type 2); 5 and 29 are the HE profiles
        if (cp && /^mp4a\.40\./.test(cp)) facts.audioProfile = cp === 'mp4a.40.2' ? 'LC' : cp === 'mp4a.40.5' || cp === 'mp4a.40.29' ? 'HE' : cp
      } catch { unreadable.push('audio profile') }
      try { facts.audioBitrate = Math.round((await a.computePacketStats(2000)).averageBitrate) } catch { unreadable.push('audio bitrate') }
    }
  } finally {
    input.dispose()
  }
  return { facts, unreadable }
}

/** A render registered in main, read through the app's own IPC in 4 MB pieces. */
export async function probeRender(id: string, size: number): Promise<{ facts: MediaFacts; unreadable: string[] }> {
  const esb = (window as unknown as { esb?: { vpubRenderRead?: (id: string, start: number, end: number) => Promise<Uint8Array | { ok: false; error: string }> } }).esb
  if (!esb?.vpubRenderRead) throw new Error('Reading a render needs the desktop app.')
  return probeFacts({
    size,
    read: async (start, end) => {
      const r = await esb.vpubRenderRead!(id, start, end)
      if (!(r instanceof Uint8Array)) throw new Error((r as { error?: string })?.error || 'The render could not be read.')
      return r
    },
  })
}
