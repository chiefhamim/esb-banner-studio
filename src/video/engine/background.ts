// Background media work (filmstrips, waveforms) gives way to playback: while the preview plays, those decode loops wait,
// so they never take decoder or GPU time from the frames on screen.

let held = false
let waiters: (() => void)[] = []

/** Playback started (true) or stopped (false). */
export function holdBackground(on: boolean) {
  held = on
  if (!on) { const w = waiters; waiters = []; w.forEach((f) => f()) }
}

/** Resolves at once, or when playback stops. Background loops await it between pieces of work. */
export function yieldToPlayback(): Promise<void> | void {
  if (!held) return
  return new Promise((r) => waiters.push(r))
}
