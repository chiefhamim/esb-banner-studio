// What the audio engine is preparing in the background (Part B shows it; the engine writes it): the noise-reduced
// render of each denoised clip, and the ducking curve. A tiny store so a panel can say "Reducing noise…" on a clip.
import { create } from 'zustand'

export type JobState = 'pending' | 'ready' | 'error'
interface AudioJobs {
  /** Noise reduction by clip id. */
  denoise: Record<string, JobState>
  /** Auto ducking: the curve for the current project. */
  duck: 'idle' | JobState
  set: (patch: Partial<Pick<AudioJobs, 'duck'>> & { denoise?: Record<string, JobState> }) => void
}
export const useAudioJobs = create<AudioJobs>((set) => ({
  denoise: {},
  duck: 'idle',
  set: (patch) => set((s) => ({ ...s, ...patch, denoise: patch.denoise ? { ...s.denoise, ...patch.denoise } : s.denoise })),
}))
export const setDenoiseJob = (id: string, state: JobState) => useAudioJobs.getState().set({ denoise: { [id]: state } })
export const setDuckJob = (state: 'idle' | JobState) => useAudioJobs.getState().set({ duck: state })
