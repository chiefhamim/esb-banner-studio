// Hooks for the mixer UI (Part B displays them): the project's loudness as an export would produce it, and live levels
// while the preview plays. The measuring is engine/audioRender.ts (a streaming EBU R128 meter over the same graph the
// export uses, off the main thread's critical path: Offline rendering plus a few ms of DSP a piece).

import { useEffect, useRef, useState } from 'react'
import { useVideoStore, viewOf } from './videoStore'
import { flattenCompounds } from './timeline'
import type { ProjectLoudness } from './engine/audioRender'
import { measureProjectLoudness, mixSignature } from './engine/audioRender'
import { audioEngine } from './engine/audioEngine'
import type { Level } from './engine/audioGraph'

export type LoudnessMeterState = { status: 'idle' | 'measuring' | 'ready' | 'error'; report: ProjectLoudness | null; error: string | null; progress: number }

/** The loudness of the project's mix (integrated LUFS, LRA, true peak, momentary/short-term series, the gain an export
 * would apply for the project's target). Re-measured 800 ms after the last change that affects the sound; the previous
 * report stays until the new one is ready. `measure()` forces it now. */
export function useLoudnessMeter(opts: { auto?: boolean; delayMs?: number } = {}): LoudnessMeterState & { measure: () => void } {
  const auto = opts.auto !== false
  const delay = opts.delayMs ?? 800
  const project = useVideoStore((s) => viewOf(s))
  const [state, setState] = useState<LoudnessMeterState>({ status: 'idle', report: null, error: null, progress: 0 })
  const seq = useRef(0)
  const ctl = useRef<AbortController | null>(null)
  const sig = mixSignature(flattenCompounds(project))
  const run = (p = useVideoStore.getState().project) => {
    const id = ++seq.current
    ctl.current?.abort()
    const ac = (ctl.current = new AbortController())
    setState((s) => ({ ...s, status: 'measuring', error: null, progress: 0 }))
    measureProjectLoudness(p, { signal: ac.signal, onProgress: (pr) => { if (id === seq.current) setState((s) => ({ ...s, progress: pr })) } })
      .then((report) => { if (id === seq.current) setState({ status: 'ready', report, error: null, progress: 1 }) })
      .catch((e: Error) => { if (id === seq.current && e.name !== 'AbortError') setState((s) => ({ ...s, status: 'error', error: e.message || 'Could not measure' })) })
  }
  useEffect(() => {
    if (!auto) return
    const t = setTimeout(() => run(), delay)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, auto, delay])
  useEffect(() => () => { ctl.current?.abort() }, [])
  return { ...state, measure: () => run() }
}

export interface LiveLevels { master: Level; buses: Record<string, Level>; tracks: Record<string, Level> }

/** Peak/RMS (dBFS) of the master, each bus and each track, about 30 times a second while `active` (the preview plays);
 * null when nothing sounds. */
export function useLiveLevels(active: boolean): LiveLevels | null {
  const [lv, setLv] = useState<LiveLevels | null>(null)
  useEffect(() => {
    if (!active) { setLv(null); return }
    let raf = 0
    let last = 0
    const tick = (now: number) => {
      if (now - last > 33) {
        last = now
        const l = audioEngine().levels()
        setLv(l ? { master: l.master, buses: l.buses as Record<string, Level>, tracks: l.tracks } : null)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active])
  return lv
}
