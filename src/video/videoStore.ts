import { create } from 'zustand'
import type { AspectRatio, Clip, MediaAsset, VideoProject } from './timeline'
import {
  addClip,
  ASPECT_CONFIGS,
  contentEnd,
  EMPTY_VIEW_SECONDS,
  createDefaultTimeline,
  deleteClip,
  moveClip,
  relinkClips,
  snapTime,
  splitClip,
  trimClip,
  trimClipLeft,
  trimClipRight,
  unlinkClip,
} from './timeline'
import { forgetFile } from './media'

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
  /** Changed since it was last saved to a file (or since it was opened). */
  dirty: boolean
  /** Counts every change; autosave writes when it moves. */
  rev: number
  /** The .esbvideo file this project was opened from or saved to (desktop), for Save again. */
  projectPath: string | null

  // Actions
  setAspect: (aspect: AspectRatio) => void
  setProjectName: (name: string) => void
  setBug: (on: boolean) => void
  seek: (time: number, snap?: boolean) => void
  play: () => void
  pause: () => void
  togglePlay: () => void
  stepFrame: (frames: number) => void
  addClip: (clip: Clip) => void
  addClips: (clips: Clip[]) => void
  updateClip: (clip: Clip) => void
  moveClip: (clipId: string, newStart: number, newTrackId?: string) => void
  trimClip: (clipId: string, newStart: number, newDuration: number) => void
  trimClipLeftDelta: (clipId: string, deltaSeconds: number) => void
  trimClipRightDelta: (clipId: string, deltaSeconds: number) => void
  splitAtPlayhead: () => void
  deleteSelectedClip: () => void
  unlinkClip: (clipId: string) => void
  selectClip: (clipId: string | null) => void
  setZoom: (zoom: number) => void
  toggleTrackMute: (trackId: string) => void
  toggleTrackLock: (trackId: string) => void
  setExporting: (exporting: boolean, progress?: number) => void
  newProject: () => void
  addMediaAsset: (asset: MediaAsset) => void
  /** A missing file found again: the bin entry takes the new file, and every clip using it plays it. */
  relinkAsset: (id: string, next: Partial<MediaAsset>) => void
  removeMediaAsset: (id: string) => void
  setRecordingVoiceover: (recording: boolean) => void
  undo: () => void
  redo: () => void
  loadProject: (project: VideoProject, opts?: { assets?: MediaAsset[]; path?: string | null; dirty?: boolean }) => void
  markSaved: (path: string | null) => void
}

const MAX_HISTORY = 30

/** The blob: URLs of a project being thrown away (with its undo history) that neither the next project nor the media
 * bin still uses. A story-video build makes two (banner, photo) each time; nothing released them. */
function releaseDropped(s: { project: VideoProject; history: VideoProject[]; future: VideoProject[]; mediaAssets: MediaAsset[] }, next: VideoProject, nextAssets: MediaAsset[]) {
  const keep = new Set([...next.clips.map((c) => c.sourceUrl), ...nextAssets.map((a) => a.url)])
  const dropped = new Set([...[s.project, ...s.history, ...s.future].flatMap((p) => p.clips.map((c) => c.sourceUrl)), ...s.mediaAssets.map((a) => a.url)])
  for (const u of dropped) if (u && u.startsWith('blob:') && !keep.has(u)) { try { URL.revokeObjectURL(u) } catch { /* already gone */ } forgetFile(u) }
}

function pushHistory(currentProject: VideoProject, history: VideoProject[]): VideoProject[] {
  const next = [...history, currentProject]
  if (next.length > MAX_HISTORY) return next.slice(next.length - MAX_HISTORY)
  return next
}

/** The timeline view follows the content: 10 s of room after the last clip, and a 30 s ruler when it is empty
 * (lengths shown to the editor and exports use contentEnd, never this). */
export const withViewLength = (p: VideoProject): VideoProject => {
  const d = Math.max(EMPTY_VIEW_SECONDS, Math.ceil(contentEnd(p) + 10))
  return p.duration === d ? p : { ...p, duration: d }
}

/** One undoable edit: the old project goes on the undo stack, redo is cleared, the project is dirty. */
const edit = (s: VideoState, project: VideoProject) => ({ history: pushHistory(s.project, s.history), future: [] as VideoProject[], project: withViewLength(project), dirty: true, rev: s.rev + 1 })

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
  dirty: false,
  rev: 0,
  projectPath: null,

  setAspect: (aspect) => {
    const cfg = ASPECT_CONFIGS[aspect]
    set((s) => edit(s, { ...s.project, aspect, width: cfg.width, height: cfg.height }))
  },

  setProjectName: (name) => set((s) => ({ project: { ...s.project, name }, dirty: true, rev: s.rev + 1 })),

  setBug: (on) => set((s) => edit(s, { ...s.project, bug: on })),

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

  addClip: (clip) => set((s) => ({ ...edit(s, addClip(s.project, clip)), selectedClipId: clip.id })),

  addClips: (clips) => set((s) => {
    if (!clips.length) return {}
    let p = s.project
    for (const c of clips) p = addClip(p, c)
    return { ...edit(s, p), selectedClipId: clips[0].id }
  }),

  updateClip: (clip) => set((s) => edit(s, { ...s.project, clips: s.project.clips.map((c) => (c.id === clip.id ? clip : c)) })),

  moveClip: (clipId, newStart, newTrackId) => set((s) => edit(s, moveClip(s.project, clipId, newStart, newTrackId))),

  trimClip: (clipId, newStart, newDuration) => set((s) => edit(s, trimClip(s.project, clipId, newStart, newDuration))),

  trimClipLeftDelta: (clipId, deltaSeconds) => set((s) => edit(s, trimClipLeft(s.project, clipId, deltaSeconds))),

  trimClipRightDelta: (clipId, deltaSeconds) => set((s) => edit(s, trimClipRight(s.project, clipId, deltaSeconds))),

  splitAtPlayhead: () => {
    const { project, currentTime, selectedClipId } = get()
    const target = selectedClipId
      ? project.clips.find((c) => c.id === selectedClipId)
      : project.clips.find((c) => currentTime > c.start && currentTime < c.start + c.duration)
    if (!target) return
    const updated = splitClip(project, target.id, currentTime)
    if (updated === project) return
    set((s) => edit(s, updated))
  },

  deleteSelectedClip: () => {
    const { selectedClipId } = get()
    if (!selectedClipId) return
    set((s) => ({ ...edit(s, deleteClip(s.project, selectedClipId)), selectedClipId: null }))
  },

  unlinkClip: (clipId) => set((s) => edit(s, unlinkClip(s.project, clipId))),

  selectClip: (clipId) => set({ selectedClipId: clipId }),

  setZoom: (zoom) => set({ zoom: Math.max(10, Math.min(200, zoom)) }),

  toggleTrackMute: (trackId) => set((s) => edit(s, { ...s.project, tracks: s.project.tracks.map((t) => (t.id === trackId ? { ...t, muted: !t.muted } : t)) })),

  toggleTrackLock: (trackId) => set((s) => edit(s, { ...s.project, tracks: s.project.tracks.map((t) => (t.id === trackId ? { ...t, locked: !t.locked } : t)) })),

  setExporting: (exporting, progress = 0) => set({ exporting, exportProgress: progress }),

  newProject: () => {
    const s = get()
    const project = createDefaultTimeline(s.project.aspect)
    releaseDropped(s, project, [])
    set({ project, mediaAssets: [], currentTime: 0, playing: false, selectedClipId: null, history: [], future: [], dirty: false, rev: s.rev + 1, projectPath: null })
  },

  addMediaAsset: (asset) => set((s) => ({ mediaAssets: [...s.mediaAssets.filter((a) => a.id !== asset.id), asset], dirty: true, rev: s.rev + 1 })),

  relinkAsset: (id, next) => set((s) => {
    const mediaAssets = s.mediaAssets.map((a) => (a.id === id ? { ...a, ...next, missing: false } : a))
    // the undo history points at the new file too, so undoing past the relink never brings back a dead URL
    const fix = (p: VideoProject) => relinkClips(p, mediaAssets)
    return { mediaAssets, project: fix(s.project), history: s.history.map(fix), future: s.future.map(fix), dirty: true, rev: s.rev + 1 }
  }),

  removeMediaAsset: (id) => {
    const { mediaAssets, project, history, future } = get()
    const asset = mediaAssets.find((a) => a.id === id)
    // a clip on the timeline (or one undo can bring back) still plays this file: revoking it then left the monitor
    // black or silent and broke the export. The bin entry goes; the bytes stay until nothing points at them.
    const inUse = !!asset && [project, ...history, ...future].some((p) => p.clips.some((c) => c.sourceUrl === asset.url))
    if (asset?.url && asset.url.startsWith('blob:') && !inUse) {
      try { URL.revokeObjectURL(asset.url) } catch { /* already gone */ }
      forgetFile(asset.url)
    }
    set((s) => ({ mediaAssets: s.mediaAssets.filter((a) => a.id !== id), dirty: true, rev: s.rev + 1 }))
  },

  setRecordingVoiceover: (recording) => set({ isRecordingVoiceover: recording }),

  undo: () => {
    const { history, project, future } = get()
    if (history.length === 0) return
    const prev = history[history.length - 1]
    set((s) => ({ project: prev, history: history.slice(0, history.length - 1), future: [project, ...future], selectedClipId: null, dirty: true, rev: s.rev + 1 }))
  },

  redo: () => {
    const { future, project, history } = get()
    if (future.length === 0) return
    const next = future[0]
    set((s) => ({ project: next, history: [...history, project], future: future.slice(1), selectedClipId: null, dirty: true, rev: s.rev + 1 }))
  },

  loadProject: (project, opts = {}) => {
    const s = get()
    const assets = opts.assets ?? s.mediaAssets
    releaseDropped(s, project, assets)
    set({
      project: withViewLength({ ...project, mediaAssets: undefined }),
      mediaAssets: assets,
      currentTime: 0,
      playing: false,
      selectedClipId: null,
      history: [],
      future: [],
      dirty: opts.dirty ?? true,
      rev: s.rev + 1,
      projectPath: opts.path !== undefined ? opts.path : s.projectPath,
    })
  },

  markSaved: (path) => set({ dirty: false, projectPath: path }),
}))

// dev-only handle for the end-to-end tests, as src/store.ts exposes __store
if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV && typeof window !== 'undefined') Object.assign(window, { __videoStore: useVideoStore })
