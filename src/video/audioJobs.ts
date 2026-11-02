// What the audio engine is preparing in the background (Part B shows it; the engine writes it): the noise-reduced
// render of each denoised clip, and the ducking curve. A tiny store so a panel can say "Reducing noise…" on a clip.
// `errors` holds the reason a clip's noise reduction failed (shown next to the clip; an export refuses with the same text).
import { create } from 'zustand'

export type JobState = 'pending' | 'ready' | 'error'
interface AudioJobs {
  /** Noise reduction by clip id. */
  denoise: Record<string, JobState>
  /** Why a clip's noise reduction failed or was refused, by clip id (only while its state is 'error'). */
  errors: Record<string, string>
  /** Auto ducking: the curve for the current project. */
  duck: 'idle' | JobState
  set: (patch: Partial<Pick<AudioJobs, 'duck'>> & { denoise?: Record<string, JobState>; errors?: Record<string, string | null> }) => void
}
export const useAudioJobs = create<AudioJobs>((set) => ({
  denoise: {},
  errors: {},
  duck: 'idle',
  set: (patch) => set((s) => {
    const errors = { ...s.errors }
    for (const [k, v] of Object.entries(patch.errors ?? {})) { if (v) errors[k] = v; else delete errors[k] }
    return { ...s, ...patch, errors, denoise: patch.denoise ? { ...s.denoise, ...patch.denoise } : s.denoise }
  }),
}))
export const setDenoiseJob = (id: string, state: JobState, message?: string) => useAudioJobs.getState().set({ denoise: { [id]: state }, errors: { [id]: state === 'error' ? message ?? 'Noise reduction failed' : null } })
export const setDuckJob = (state: 'idle' | JobState) => useAudioJobs.getState().set({ duck: state })
