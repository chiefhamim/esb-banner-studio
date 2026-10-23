import { create } from 'zustand'
import type { AspectRatio, Clip, MediaAsset, VideoProject } from './timeline'
import {
  addClip,
  createDefaultTimeline,
  deleteClip,
  moveClip,
  snapTime,
  splitClip,
  trimClip,
  trimClipLeft,
  trimClipRight,
} from './timeline'

interface VideoState {
  project: VideoProject
  currentTime: number
  playing: boolean
  selectedClipId: string | null
  zoom: number // Pixels per second on timeline ruler
  exporting: boolean
  exportProgress: number
  history: VideoProject[]
  future: VideoProject[]
  mediaAssets: MediaAsset[]
  isRecordingVoiceover: boolean

  // Actions
  setAspect: (aspect: AspectRatio) => void
  setProjectName: (name: string) => void
  seek: (time: number, snap?: boolean) => void
  play: () => void
  pause: () => void
  togglePlay: () => void
  stepFrame: (frames: number) => void
  addClip: (clip: Clip) => void
  updateClip: (clip: Clip) => void
  moveClip: (clipId: string, newStart: number, newTrackId?: string) => void
  trimClip: (clipId: string, newStart: number, newDuration: number) => void
  trimClipLeftDelta: (clipId: string, deltaSeconds: number) => void
  trimClipRightDelta: (clipId: string, deltaSeconds: number) => void
  splitAtPlayhead: () => void
  deleteSelectedClip: () => void
  selectClip: (clipId: string | null) => void
  setZoom: (zoom: number) => void
  toggleTrackMute: (trackId: string) => void
  toggleTrackLock: (trackId: string) => void
  setExporting: (exporting: boolean, progress?: number) => void
  resetToDemo: () => void
  addMediaAsset: (asset: MediaAsset) => void
  removeMediaAsset: (id: string) => void
  setRecordingVoiceover: (recording: boolean) => void
  undo: () => void
  redo: () => void
  loadProject: (project: VideoProject) => void
}

const MAX_HISTORY = 30

function pushHistory(currentProject: VideoProject, history: VideoProject[]): VideoProject[] {
  const next = [...history, currentProject]
  if (next.length > MAX_HISTORY) return next.slice(next.length - MAX_HISTORY)
  return next
}

export const useVideoStore = create<VideoState>((set, get) => ({
  project: createDefaultTimeline('16:9'),
  currentTime: 0,
  playing: false,
  selectedClipId: null,
  zoom: 40,
  exporting: false,
  exportProgress: 0,
  history: [],
  future: [],
  mediaAssets: [],
  isRecordingVoiceover: false,

  setAspect: (aspect) => {
    const current = get().project
    const newTimeline = createDefaultTimeline(aspect)
    set((s) => ({
      history: pushHistory(s.project, s.history),
      future: [],
      project: {
        ...current,
        aspect,
        width: newTimeline.width,
        height: newTimeline.height,
      },
    }))
  },

  setProjectName: (name) => {
    set((s) => ({
      project: { ...s.project, name },
    }))
  },

  seek: (time, snap = false) => {
    const p = get().project
    const clamped = Math.max(0, Math.min(p.duration, time))
    const finalTime = snap ? snapTime(clamped, p) : clamped
    set({ currentTime: finalTime })
  },

  play: () => set({ playing: true }),
  pause: () => set({ playing: false }),
  togglePlay: () => set((s) => ({ playing: !s.playing })),

  stepFrame: (frames) => {
    const s = get()
    const dt = frames * (1 / s.project.fps)
    s.seek(s.currentTime + dt)
  },

  addClip: (clip) => {
    set((s) => ({
      history: pushHistory(s.project, s.history),
      future: [],
      project: addClip(s.project, clip),
      selectedClipId: clip.id,
    }))
  },

  updateClip: (clip) => {
    set((s) => ({
      history: pushHistory(s.project, s.history),
      future: [],
      project: {
        ...s.project,
        clips: s.project.clips.map((c) => (c.id === clip.id ? clip : c)),
      },
    }))
  },

  moveClip: (clipId, newStart, newTrackId) => {
    set((s) => ({
      history: pushHistory(s.project, s.history),
      future: [],
      project: moveClip(s.project, clipId, newStart, newTrackId),
    }))
  },

  trimClip: (clipId, newStart, newDuration) => {
    set((s) => ({
      history: pushHistory(s.project, s.history),
      future: [],
      project: trimClip(s.project, clipId, newStart, newDuration),
    }))
  },

  trimClipLeftDelta: (clipId, deltaSeconds) => {
    set((s) => ({
      history: pushHistory(s.project, s.history),
      future: [],
      project: trimClipLeft(s.project, clipId, deltaSeconds),
    }))
  },

  trimClipRightDelta: (clipId, deltaSeconds) => {
    set((s) => ({
      history: pushHistory(s.project, s.history),
      future: [],
      project: trimClipRight(s.project, clipId, deltaSeconds),
    }))
  },

  splitAtPlayhead: () => {
    const { project, currentTime, selectedClipId } = get()
    const target = selectedClipId
      ? project.clips.find((c) => c.id === selectedClipId)
      : project.clips.find((c) => currentTime > c.start && currentTime < c.start + c.duration)
    if (!target) return
    const updated = splitClip(project, target.id, currentTime)
    set((s) => ({
      history: pushHistory(s.project, s.history),
      future: [],
      project: updated,
    }))
  },

  deleteSelectedClip: () => {
    const { selectedClipId, project } = get()
    if (!selectedClipId) return
    set((s) => ({
      history: pushHistory(s.project, s.history),
      future: [],
      project: deleteClip(project, selectedClipId),
      selectedClipId: null,
    }))
  },

  selectClip: (clipId) => set({ selectedClipId: clipId }),

  setZoom: (zoom) => set({ zoom: Math.max(10, Math.min(200, zoom)) }),

  toggleTrackMute: (trackId) => {
    set((s) => ({
      project: {
        ...s.project,
        tracks: s.project.tracks.map((t) => (t.id === trackId ? { ...t, muted: !t.muted } : t)),
      },
    }))
  },

  toggleTrackLock: (trackId) => {
    set((s) => ({
      project: {
        ...s.project,
        tracks: s.project.tracks.map((t) => (t.id === trackId ? { ...t, locked: !t.locked } : t)),
      },
    }))
  },

  setExporting: (exporting, progress = 0) => set({ exporting, exportProgress: progress }),

  resetToDemo: () => {
    set({
      project: createDefaultTimeline('16:9'),
      currentTime: 0,
      playing: false,
      selectedClipId: null,
      history: [],
      future: [],
    })
  },

  addMediaAsset: (asset) => {
    set((s) => ({
      mediaAssets: [...s.mediaAssets.filter((a) => a.id !== asset.id), asset],
    }))
  },

  removeMediaAsset: (id) => {
    const asset = get().mediaAssets.find((a) => a.id === id)
    if (asset?.url && asset.url.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(asset.url)
      } catch {}
    }
    set((s) => ({
      mediaAssets: s.mediaAssets.filter((a) => a.id !== id),
    }))
  },

  setRecordingVoiceover: (recording) => set({ isRecordingVoiceover: recording }),

  undo: () => {
    const { history, project, future } = get()
    if (history.length === 0) return
    const prev = history[history.length - 1]
    const nextHistory = history.slice(0, history.length - 1)
    set({
      project: prev,
      history: nextHistory,
      future: [project, ...future],
      selectedClipId: null,
    })
  },

  redo: () => {
    const { future, project, history } = get()
    if (future.length === 0) return
    const next = future[0]
    const nextFuture = future.slice(1)
    set({
      project: next,
      history: [...history, project],
      future: nextFuture,
      selectedClipId: null,
    })
  },

  loadProject: (project) => {
    set({
      project,
      currentTime: 0,
      playing: false,
      selectedClipId: null,
      history: [],
      future: [],
    })
  },
}))

// dev-only handle for the end-to-end tests, as src/store.ts exposes __store
if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV && typeof window !== 'undefined') Object.assign(window, { __videoStore: useVideoStore })
