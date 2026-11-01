// Decoded frames, keyed by (source, frame index), with a byte budget.
//
// A decoded frame is copied out of the decoder at once (an ImageBitmap), so holding many of them never stalls a
// hardware decoder, whose own output buffers are few. The cache is shared by every clip that plays a source: two clips
// of one file at different points read different indexes of the same entry set.
//
// Eviction. Paused, it is plain LRU. While playing the engine tells the cache which index windows it still needs per
// source (`setWindows`: a little behind each playhead to the end of its look-ahead). Frames outside every window go
// first (the frames already shown, behind the playhead), then — only if the windows alone are over budget — the
// frames furthest ahead. So a look-ahead frame is never evicted to keep a frame that was already on screen.
//
// Aliases. A frame that lasts longer than one index (a still, a low-fps file) answers several indexes. Those extra
// indexes are aliases of the one real entry, never a second owner of its bitmap: evicting or replacing the entry drops
// its aliases with it, so a look-up can never return a closed bitmap.

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
const split = (k: string): [string, number] => { const h = k.lastIndexOf('#'); return [k.slice(0, h), Number(k.slice(h + 1))] }

export class FrameCache<E extends { bytes: number; close(): void } = FrameEntry> {
  private map = new Map<string, E>()
  /** alias key → the real entry's key */
  private aliases = new Map<string, string>()
  /** real key → its alias keys */
  private aliasedBy = new Map<string, Set<string>>()
  /** Indexes (real and alias) per source. */
  private bySource = new Map<string, Set<number>>()
  /** While playing: per source, the [lo, hi] index windows still needed. */
  private windows = new Map<string, [number, number][]>()
  used = 0
  hits = 0
  misses = 0
  evictions = 0
  budget: number
  constructor(budget: number) { this.budget = budget }

  /** Real entries (aliases are not counted). */
  get size() { return this.map.size }

  private resolve(k: string): E | undefined {
    const e = this.map.get(k)
    if (e) return e
    const t = this.aliases.get(k)
    return t ? this.map.get(t) : undefined
  }

  private realKey(k: string): string | undefined { return this.map.has(k) ? k : this.aliases.get(k) }

  has(source: string, index: number) { return !!this.resolve(frameKey(source, index)) }

  /** The entry, and mark it recently used. */
  get(source: string, index: number): E | undefined {
    const k = this.realKey(frameKey(source, index))
    const e = k ? this.map.get(k) : undefined
    if (e && k) { this.map.delete(k); this.map.set(k, e); this.hits++ } else this.misses++
    return e
  }

  /** The entry without touching its place in the LRU (look-ups that are only checks). */
  peek(source: string, index: number): E | undefined { return this.resolve(frameKey(source, index)) }

  /** The cached frame of `source` with the highest index ≤ `index` and within `maxBack` of it (a held frame while the
   * exact one decodes). */
  nearestBefore(source: string, index: number, maxBack = 90): { index: number; entry: E } | null {
    const set = this.bySource.get(source)
    if (!set) return null
    let best = -1
    for (const i of set) if (i <= index && i > best && index - i <= maxBack) best = i
    if (best < 0) return null
    const entry = this.resolve(frameKey(source, best))
    return entry ? { index: best, entry } : null
  }

  put(source: string, index: number, entry: E) {
    const k = frameKey(source, index)
    const old = this.map.get(k)
    if (old) { if (old === entry) return; this.drop(k, old) }
    else if (this.aliases.has(k)) this.unalias(k)
    this.map.set(k, entry)
    this.used += entry.bytes
    this.index(source).add(index)
    this.evict(k)
  }

  /** Make `index` answer with the entry at `target` (same source) until that entry goes. No-op if it is not cached. */
  alias(source: string, index: number, target: number) {
    if (index === target) return
    const k = frameKey(source, index)
    const tk = this.realKey(frameKey(source, target))
    if (!tk || this.map.has(k)) return
    if (this.aliases.has(k)) this.unalias(k)
    this.aliases.set(k, tk)
    let s = this.aliasedBy.get(tk)
    if (!s) { s = new Set(); this.aliasedBy.set(tk, s) }
    s.add(k)
    this.index(source).add(index)
  }

  /** While playing: the index windows each source still needs (frames outside them are evicted first). Paused: null. */
  setWindows(w: Map<string, [number, number][]> | null) { this.windows = w ?? new Map() }

  private index(source: string) {
    let s = this.bySource.get(source)
    if (!s) { s = new Set(); this.bySource.set(source, s) }
    return s
  }

  private inWindow(source: string, i: number): boolean {
    const ws = this.windows.get(source)
    if (!ws) return false
    for (const [lo, hi] of ws) if (i >= lo && i <= hi) return true
    return false
  }

  /** How far ahead of the start of its nearest window a needed frame is (bigger = needed later). */
  private ahead(source: string, i: number): number {
    let best = Infinity
    for (const [lo, hi] of this.windows.get(source) ?? []) if (i >= lo && i <= hi) best = Math.min(best, i - lo)
    return best
  }

  /** Evict until under budget (never the one just put): unneeded frames in LRU order, then the furthest-ahead ones. */
  private evict(keep: string) {
    if (this.used <= this.budget) return
    const playing = this.windows.size > 0
    const needed: [string, number][] = []
    for (const [k, e] of this.map) {
      if (this.used <= this.budget) return
      if (k === keep) continue
      if (playing) {
        const [src, i] = split(k)
        if (this.inWindow(src, i)) { needed.push([k, this.ahead(src, i)]); continue }
      }
      this.drop(k, e)
      this.evictions++
    }
    needed.sort((a, b) => b[1] - a[1])
    for (const [k] of needed) {
      if (this.used <= this.budget) return
      const e = this.map.get(k)
      if (e) { this.drop(k, e); this.evictions++ }
    }
  }

  private unalias(k: string) {
    const t = this.aliases.get(k)
    if (t == null) return
    this.aliases.delete(k)
    this.aliasedBy.get(t)?.delete(k)
    const [src, i] = split(k)
    this.bySource.get(src)?.delete(i)
  }

  private drop(k: string, e: E) {
    this.map.delete(k)
    this.used -= e.bytes
    const [src, i] = split(k)
    this.bySource.get(src)?.delete(i)
    const as = this.aliasedBy.get(k)
    if (as) {
      for (const a of as) { this.aliases.delete(a); const [as2, ai] = split(a); this.bySource.get(as2)?.delete(ai) }
      this.aliasedBy.delete(k)
    }
    try { e.close() } catch { /* already closed */ }
  }

  /** Forget every frame of a source (the file was relinked, or a proxy replaced it). */
  clearSource(source: string) {
    const s = this.bySource.get(source)
    if (!s) return
    for (const i of [...s]) {
      const k = frameKey(source, i)
      const e = this.map.get(k)
      if (e) this.drop(k, e)
      else if (this.aliases.has(k)) this.unalias(k)
    }
    this.bySource.delete(source)
  }

  clear() {
    for (const e of this.map.values()) { try { e.close() } catch { /* gone */ } }
    this.map.clear()
    this.aliases.clear()
    this.aliasedBy.clear()
    this.bySource.clear()
    this.used = 0
  }

  sources() { return [...this.bySource.keys()].filter((s) => (this.bySource.get(s)?.size ?? 0) > 0) }
}
