import * as media from '../media'

// Background media work (filmstrips, waveforms) gives way to the work the editor is watching: while the preview
// plays, while the editor scrubs and while an export runs, those decode loops wait, so they never take decoder or GPU
// time from the frames on screen or in the file. Playback and export also hold Part A's proxy maker
// (`holdProxies(reason)` in media.ts, looked up by name so this works without it).

const holds = new Map<string, number>()
let waiters: (() => void)[] = []

const held = () => holds.size > 0

function wakeIfFree() {
  if (held()) return
  const w = waiters
  waiters = []
  w.forEach((f) => f())
}

/** Hold background work for `reason` until the returned release is called (calls are counted per reason). */
export function holdBackgroundFor(reason: string): () => void {
  holds.set(reason, (holds.get(reason) ?? 0) + 1)
  let done = false
  return () => {
    if (done) return
    done = true
    const n = (holds.get(reason) ?? 1) - 1
    if (n <= 0) holds.delete(reason)
    else holds.set(reason, n)
    wakeIfFree()
  }
}

let playRelease: (() => void) | null = null
/** Playback started (true) or stopped (false). */
export function holdBackground(on: boolean) {
  if (on && !playRelease) playRelease = holdBackgroundFor('playback')
  else if (!on && playRelease) { const r = playRelease; playRelease = null; r() }
}

let scrubRelease: (() => void) | null = null
let scrubTimer: ReturnType<typeof setTimeout> | null = null
/** The editor moved the paused playhead: hold background work until the scrub has been still for `ms`. */
export function noteScrub(ms = 400) {
  if (!scrubRelease) scrubRelease = holdBackgroundFor('scrub')
  if (scrubTimer) clearTimeout(scrubTimer)
  scrubTimer = setTimeout(() => { scrubTimer = null; const r = scrubRelease; scrubRelease = null; r?.() }, ms)
}

/** Resolves at once, or when nothing holds background work any more. Background loops await it between pieces. */
export function yieldToPlayback(): Promise<void> | void {
  if (!held()) return
  return new Promise((r) => waiters.push(r))
}

export const backgroundHeld = () => [...holds.keys()]

// ---------------------------------------------------------------- Part A's proxy maker

/** Pause proxy making for `reason` (playback, export) until the returned release is called. Part A's
 * `holdProxies(reason): release` (media.ts) is looked up by name at call time, like engine/mediaSource.ts does, so
 * this is a no-op on a build without it. */
export function holdProxies(reason: string): () => void {
  const fn = (media as unknown as Record<string, unknown>).holdProxies
  if (typeof fn !== 'function') return () => {}
  let release: unknown = null
  try { release = (fn as (r: string) => unknown)(reason) } catch { release = null }
  let done = false
  return () => {
    if (done) return
    done = true
    if (typeof release === 'function') { try { (release as () => void)() } catch { /* gone */ } }
  }
}
