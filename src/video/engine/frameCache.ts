// Decoded frames, keyed by (source, frame index), in an LRU with a byte budget.
//
// A decoded frame is copied out of the decoder at once (an ImageBitmap), so holding many of them never stalls a
// hardware decoder, whose own output buffers are few. The cache is shared by every clip that plays a source: two clips
// of one file at different points read different indexes of the same entry set.

export interface FrameEntry {
  /** What the compositor uploads (an ImageBitmap; a VideoFrame for a short-lived export frame). */
  image: TexImageSource
  width: number
  height: number
  /** Presentation time of the frame in its source, seconds. */
  timestamp: number
  bytes: number
  close(): void
}

export const frameKey = (source: string, index: number) => `${source}#${index}`

export class FrameCache<E extends { bytes: number; close(): void } = FrameEntry> {
  private map = new Map<string, E>()
  private bySource = new Map<string, Set<number>>()
  used = 0
  hits = 0
  misses = 0
  budget: number
  constructor(budget: number) { this.budget = budget }

  get size() { return this.map.size }

  has(source: string, index: number) { return this.map.has(frameKey(source, index)) }

  /** The entry, and mark it recently used. */
  get(source: string, index: number): E | undefined {
    const k = frameKey(source, index)
    const e = this.map.get(k)
    if (e) { this.map.delete(k); this.map.set(k, e); this.hits++ } else this.misses++
    return e
  }

  /** The entry without touching its place in the LRU (look-ups that are only checks). */
  peek(source: string, index: number): E | undefined { return this.map.get(frameKey(source, index)) }

  /** The cached frame of `source` with the highest index ≤ `index` and within `maxBack` of it (a held frame while the
   * exact one decodes). */
  nearestBefore(source: string, index: number, maxBack = 90): { index: number; entry: E } | null {
    const set = this.bySource.get(source)
    if (!set) return null
    let best = -1
    for (const i of set) if (i <= index && i > best && index - i <= maxBack) best = i
    return best >= 0 ? { index: best, entry: this.map.get(frameKey(source, best))! } : null
  }

  put(source: string, index: number, entry: E) {
    const k = frameKey(source, index)
    const old = this.map.get(k)
    if (old) { if (old === entry) return; this.drop(k, source, index, old) }
    this.map.set(k, entry)
    this.used += entry.bytes
    let s = this.bySource.get(source)
    if (!s) { s = new Set(); this.bySource.set(source, s) }
    s.add(index)
    this.evict(k)
  }

  /** Evict least recently used entries until under budget (never the one just put). */
  private evict(keep: string) {
    for (const [k, e] of this.map) {
      if (this.used <= this.budget) break
      if (k === keep) continue
      const hash = k.lastIndexOf('#')
      this.drop(k, k.slice(0, hash), Number(k.slice(hash + 1)), e)
    }
  }

  private drop(k: string, source: string, index: number, e: E) {
    this.map.delete(k)
    this.used -= e.bytes
    this.bySource.get(source)?.delete(index)
    try { e.close() } catch { /* already closed */ }
  }

  /** Forget every frame of a source (the file was relinked, or a proxy replaced it). */
  clearSource(source: string) {
    const s = this.bySource.get(source)
    if (!s) return
    for (const i of [...s]) { const k = frameKey(source, i); const e = this.map.get(k); if (e) this.drop(k, source, i, e) }
    this.bySource.delete(source)
  }

  clear() {
    for (const e of this.map.values()) { try { e.close() } catch { /* gone */ } }
    this.map.clear()
    this.bySource.clear()
    this.used = 0
  }

  sources() { return [...this.bySource.keys()] }
}
