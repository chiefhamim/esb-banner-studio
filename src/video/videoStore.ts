import { create } from 'zustand'
import type { AspectRatio, AttrGroup, Clip, Marker, MediaAsset, TrackKind, VideoProject } from './timeline'
import {
  addClip,
  addMarker,
  addTrack,
  allClips,
  breakCompound,
  compoundView,
  flattenCompounds,
  ensureTracksFor,
  extractRange,
  groupClips,
  insertClips,
  liftRange,
  magnetize,
  compoundProblem,
  makeCompound,
  markerNear,
  moveSet,
  moveTrack,
  overwriteClips,
  pasteAttributes,
  removeMarker,
  removeTrack,
  renameTrack,
  retimeClip,
  rippleDelete,
  rippleTrim,
  rollEdit,
  setLocked,
  setTrackHidden,
  slideClip,
  slipClip,
  ungroupClips,
  updateMarker,
  writeCompoundView,
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
import { analyseClipBeats } from './engine/audioRender'
import type { Bus, ClipDenoise, ClipFade, LoudnessTarget } from './audioModel'
import type { BeatProposal, ClipAudioPatch, ProjectAudioPatch, TrackAudioPatch } from './audioEdit'
import { applyBeatMarkers, beatProposal, proposalTimes, updateClipAudio, updateProjectAudio, updateTrackAudio } from './audioEdit'

/** An undo step. Removing a bin item changes no clip, so its step carries which bin items undo shows again (`unhide`)
 * and redo hides again (`hide`). */
type Step = VideoProject & { unhide?: string[]; hide?: string[] }
const bare = (p: Step): VideoProject => {
  if (!p.unhide && !p.hide) return p
  const { unhide: _u, hide: _h, ...rest } = p
  return rest
}

/** Timeline tools (Phase 2). Select moves and trims; Ripple trims and moves what follows; Roll moves an edit point;
 * Slip changes a clip's content in place; Slide moves a clip between its neighbours. */
export type EditTool = 'select' | 'ripple' | 'roll' | 'slip' | 'slide'
/** How a drop or a paste lands: over what is there, or pushing it later. */
export type EditMode = 'overwrite' | 'insert'

interface VideoState {
  /** The whole project (what is saved). While a compound clip is open, the timeline edits its inside: `viewOf(s)`. */
  project: VideoProject
  /** Compound clips opened in place, outermost first ([] = the main timeline). */
  compoundPath: string[]
  currentTime: number
  playing: boolean
  /** Shuttle speed (J/K/L): 1 = normal play; 2, 4 faster; −1, −2, −4 backwards (played as a paused scrub); 0 = stopped. */
  rate: number
  selectedClipId: string | null
  /** Every selected clip (Shift/Ctrl+click adds); the first is `selectedClipId`, which the inspector shows. */
  selectedIds: string[]
  zoom: number // Pixels per second on timeline ruler
  tool: EditTool
  editMode: EditMode
  /** In and out points (I / O) for Lift and Extract; null when unset. */
  range: { in: number | null; out: number | null }
  /** Clips copied with Ctrl+C (with their linked partners), for paste and paste attributes. */
  clipboard: Clip[] | null
  exporting: boolean
  exportProgress: number
  history: Step[]
  future: Step[]
  mediaAssets: MediaAsset[]
  isRecordingVoiceover: boolean
  /** Changed since it was last saved to a file (or since it was opened). */
  dirty: boolean
  /** Counts every change; autosave writes when it moves. */
  rev: number
  /** The .esbvideo file this project was opened from or saved to (desktop), for Save again. */
  projectPath: string | null
  /** Moves when a different project is put on the desk (new, open, restore, story build): caches can be pruned. */
  generation: number
  /** A drag, trim or slider gesture is under way: its many small changes make one undo step. */
  gesture: boolean

  // Actions
  setAspect: (aspect: AspectRatio) => void
  setProjectName: (name: string) => void
  setBug: (on: boolean) => void
  seek: (time: number, snap?: boolean) => void
  play: () => void
  pause: () => void
  togglePlay: () => void
  /** J / K / L: back, stop, forward; a second press of the same direction doubles the speed (up to 4×). */
  shuttle: (key: 'j' | 'k' | 'l') => void
  stepFrame: (frames: number) => void
  addClip: (clip: Clip) => void
  addClips: (clips: Clip[]) => void
  /** Clips put on the timeline by a drop or a paste, by the edit mode (insert or overwrite). */
  placeClips: (clips: Clip[], mode?: EditMode) => boolean
  updateClip: (clip: Clip) => void
  /** Replace a clip for an edit that arrives in many small steps (typing in a field): the steps of one `key` on one
   * clip, with nothing else edited between them and none more than COALESCE_MS apart, make ONE undo step. Use
   * `endCoalesce()` on blur / Enter to close the step at once. Sliders and colour drags use beginGesture / endGesture. */
  updateClipCoalesced: (clip: Clip, key: string) => void
  /** Close the open coalesced edit: the next `updateClipCoalesced` starts a new undo step. */
  endCoalesce: () => void
  moveClip: (clipId: string, newStart: number, newTrackId?: string) => void
  trimClip: (clipId: string, newStart: number, newDuration: number) => void
  trimClipLeftDelta: (clipId: string, deltaSeconds: number) => void
  trimClipRightDelta: (clipId: string, deltaSeconds: number) => void
  rippleTrimDelta: (clipId: string, side: 'left' | 'right', deltaSeconds: number) => void
  rollDelta: (leftId: string, rightId: string, deltaSeconds: number) => void
  slipDelta: (clipId: string, deltaSourceSeconds: number) => void
  slideDelta: (clipId: string, deltaSeconds: number) => void
  /** Retime a clip (speed, ramp, freeze, reverse): its sound follows and later clips move by the change. */
  retime: (clipId: string, f: (c: Clip) => Clip) => boolean
  splitAtPlayhead: () => void
  deleteSelectedClip: () => void
  /** Delete the selection and close the gap on every track. False when a lock stopped it. */
  rippleDeleteSelected: () => boolean
  /** Lift / extract the in–out range (or, without one, the selection's time span) from every unlocked track. */
  lift: () => boolean
  extract: () => boolean
  setRangeIn: (t: number | null) => void
  setRangeOut: (t: number | null) => void
  unlinkClip: (clipId: string) => void
  /** Select a clip: replace the selection, or add/remove it (Shift/Ctrl+click). */
  selectClip: (clipId: string | null, mode?: 'replace' | 'toggle') => void
  selectClips: (ids: string[]) => void
  setZoom: (zoom: number) => void
  setTool: (tool: EditTool) => void
  setEditMode: (mode: EditMode) => void
  toggleMagnetic: () => void
  copySelected: () => number
  /** Paste the copied clips at the playhead on their own tracks (insert or overwrite). */
  pasteClips: (mode?: EditMode) => boolean
  /** Paste attribute groups from the first copied clip onto the selection. `refused`: clips whose speed could not
   * change (the ripple would pull a linked pair apart on a locked track); they keep their speed. */
  pasteAttributes: (groups: AttrGroup[]) => { ok: boolean; refused: number }
  groupSelected: () => boolean
  ungroupSelected: () => boolean
  compoundSelected: () => boolean
  /** Why the selection cannot become a compound clip now (null: it can). */
  compoundIssue: () => string | null
  /** Ripple edits move the markers after the edit (default on). */
  toggleRippleMarkers: () => void
  breakCompound: (clipId: string) => boolean
  openCompound: (clipId: string) => boolean
  /** Close open compounds back to `depth` (0 = the main timeline). */
  closeCompound: (depth?: number) => void
  addMarker: (t?: number) => string | null
  updateMarker: (id: string, patch: Partial<Omit<Marker, 'id'>>) => void
  removeMarker: (id: string) => void
  jumpMarker: (dir: 1 | -1) => boolean
  toggleTrackMute: (trackId: string) => void
  toggleTrackLock: (trackId: string) => void
  /** Timeline v2: add a track of a kind (returns its id), remove one with its clips, move one in the list, hide one. */
  addTrack: (kind: TrackKind) => string
  removeTrack: (trackId: string) => boolean
  moveTrack: (trackId: string, toIndex: number) => void
  toggleTrackHidden: (trackId: string) => void
  renameTrack: (trackId: string, name: string) => void
  setExporting: (exporting: boolean, progress?: number) => void
  newProject: () => void
  addMediaAsset: (asset: MediaAsset) => void
  /** A missing file found again: the bin entry takes the new file, and every clip using it plays it. */
  relinkAsset: (id: string, next: Partial<MediaAsset>) => void
  removeMediaAsset: (id: string) => void
  setRecordingVoiceover: (recording: boolean) => void
  undo: () => void
  redo: () => void
  // ---- Phase 4 audio (Part A). A slider or fade handle drag wraps these in beginGesture / endGesture: one undo step.
  /** Clip gain in dB (null = 0). */
  setClipGain: (clipId: string, db: number | null) => void
  /** A clip's fade-in / fade-out (null = none). */
  setClipFade: (clipId: string, side: 'in' | 'out', fade: ClipFade | null) => void
  setClipPan: (clipId: string, pan: number | null) => void
  /** Noise reduction on a clip (null or amount 0 = off). */
  setClipDenoise: (clipId: string, d: ClipDenoise | null) => void
  /** Several clip audio fields at once (one undo step). */
  patchClipAudio: (clipId: string, patch: ClipAudioPatch) => void
  /** An audio track's bus (null = automatic), fader (dB), pan, mute, solo. */
  setTrackBus: (trackId: string, bus: Bus | null) => void
  setTrackVolume: (trackId: string, db: number | null) => void
  setTrackPan: (trackId: string, pan: number | null) => void
  setTrackMute: (trackId: string, muted: boolean) => void
  setTrackSolo: (trackId: string, solo: boolean) => void
  patchTrackAudio: (trackId: string, patch: TrackAudioPatch) => void
  /** Master fader (dB) and limiter. */
  setMaster: (patch: { gain?: number; limiter?: boolean } | null) => void
  /** Auto ducking of the music bus under the voice bus. */
  setDucking: (patch: { enabled?: boolean; depthDb?: number; threshold?: number; attack?: number; release?: number } | null) => void
  /** The loudness an export is normalised to (null = not normalised). */
  setLoudnessTarget: (t: LoudnessTarget) => void
  setBusVolume: (bus: Bus, db: number | null) => void
  patchProjectAudio: (patch: ProjectAudioPatch) => void
  /** Beat and onset detection on an audio clip: returns a PROPOSAL (nothing is added); null when the clip has no sound. */
  markBeats: (clipId: string) => Promise<BeatProposal | null>
  /** Add a proposal's markers (the beat grid, or the strongest onsets) in one undo step; returns how many were added. */
  applyBeats: (proposal: BeatProposal, use?: 'beats' | 'onsets') => number
  /** Start a gesture (pointer down on a clip, a trim handle or a slider): one undo step for everything until end. */
  beginGesture: () => void
  /** End the gesture; a gesture that changed nothing leaves no undo step. */
  endGesture: () => void
  loadProject: (project: VideoProject, opts?: { assets?: MediaAsset[]; path?: string | null; dirty?: boolean }) => void
  /** Saved to `path`. Only marks the project clean if nothing changed since `rev` (the revision that was written). */
  markSaved: (path: string | null, rev?: number) => void
}

const MAX_HISTORY = 30

/** The blob: URLs of a project being thrown away (with its undo history) that neither the next project nor the media
 * bin still uses. A story-video build makes two (banner, photo) each time; nothing released them. */
function releaseDropped(s: { project: VideoProject; history: Step[]; future: Step[]; mediaAssets: MediaAsset[] }, next: VideoProject, nextAssets: MediaAsset[]) {
  const keep = new Set([...allClips(next).map((c) => c.sourceUrl), ...nextAssets.map((a) => a.url)])
  const dropped = new Set([...[s.project, ...s.history, ...s.future].flatMap((p) => allClips(p).map((c) => c.sourceUrl)), ...s.mediaAssets.map((a) => a.url)])
  for (const u of dropped) if (u && u.startsWith('blob:') && !keep.has(u)) { try { URL.revokeObjectURL(u) } catch { /* already gone */ } forgetFile(u) }
}

function pushHistory(currentProject: Step, history: Step[]): Step[] {
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

let viewMemo: { project: VideoProject; key: string; view: VideoProject } | null = null
/** The timeline being edited: the project, or the inside of the open compound clip (same object while neither
 * changes, so selectors stay stable). */
export function viewOf(s: Pick<VideoState, 'project' | 'compoundPath'>): VideoProject {
  if (!s.compoundPath.length) return s.project
  const key = s.compoundPath.join('/')
  if (viewMemo && viewMemo.project === s.project && viewMemo.key === key) return viewMemo.view
  const view = compoundView(s.project, s.compoundPath) ?? s.project
  viewMemo = { project: s.project, key, view }
  return view
}

/** One undoable edit of the timeline being edited (`next` replaces the view): the old project goes on the undo stack,
 * redo is cleared, the project is dirty. An edit that changed nothing (a refused move of a locked clip) leaves no step.
 * During a gesture the step was taken when it began, so the moves inside it only change the project. The magnetic
 * main track closes its gaps after each edit (at the end of a gesture, so a drag can reorder). */
const edit = (s: VideoState, next: VideoProject): Partial<VideoState> => {
  const view = viewOf(s)
  if (next === view) return {}
  let v = next
  if (!s.compoundPath.length && s.project.magnetic && !s.gesture) v = magnetize(v)
  const root = s.compoundPath.length ? writeCompoundView(s.project, s.compoundPath, v) : withViewLength(v)
  if (s.gesture) return { project: root, dirty: true, rev: s.rev + 1 }
  return { history: pushHistory(s.project, s.history), future: [] as Step[], project: root, dirty: true, rev: s.rev + 1 }
}

/** A pause longer than this ends a coalesced typing step (the next keystroke is a new undo step). */
export const COALESCE_MS = 1200
let coalesceMark: { key: string; rev: number; at: number } | null = null

/** Makes marker ids unique when several are added in the same millisecond. */
let markerSeq = 0

/** The project a gesture started from (to drop its step if nothing moved). */
let gestureFrom: VideoProject | null = null

/** The selection, kept to clips that exist in the view. */
const liveSelection = (s: VideoState, view: VideoProject) => {
  const ids = s.selectedIds.filter((id) => view.clips.some((c) => c.id === id))
  if (s.selectedClipId && !ids.includes(s.selectedClipId) && view.clips.some((c) => c.id === s.selectedClipId)) ids.unshift(s.selectedClipId)
  return ids
}

/** The copied clips, placed at `at` keeping their spacing, with new ids and new link/group ids. */
function clonesAt(clips: Clip[], at: number, stamp: string): Clip[] {
  const a = Math.min(...clips.map((c) => c.start))
  const links = new Map<string, string>()
  const groups = new Map<string, string>()
  const map = (m: Map<string, string>, v: string | undefined, p: string) => { if (!v) return undefined; if (!m.has(v)) m.set(v, `${p}-${stamp}-${m.size}`); return m.get(v) }
  return clips.map((c, i) => ({ ...c, id: `${c.id.replace(/-paste-[\w]+$/, '')}-paste-${stamp}${i}`, start: at + (c.start - a), linkId: map(links, c.linkId, 'link'), groupId: map(groups, c.groupId, 'grp') }))
}

export const useVideoStore = create<VideoState>((set, get) => ({
  project: createDefaultTimeline('16:9'),
  compoundPath: [],
  currentTime: 0,
  playing: false,
  rate: 0,
  selectedClipId: null,
  selectedIds: [],
  zoom: 40,
  tool: 'select',
  editMode: 'overwrite',
  range: { in: null, out: null },
  clipboard: null,
  exporting: false,
  exportProgress: 0,
  history: [],
  future: [],
  mediaAssets: [],
  isRecordingVoiceover: false,
  dirty: false,
  rev: 0,
  projectPath: null,
  generation: 0,
  gesture: false,

  setAspect: (aspect) => {
    const cfg = ASPECT_CONFIGS[aspect]
    set((s) => s.project.aspect === aspect ? {} : { history: pushHistory(s.project, s.history), future: [], project: { ...s.project, aspect, width: cfg.width, height: cfg.height }, dirty: true, rev: s.rev + 1 })
  },

  setProjectName: (name) => set((s) => ({ project: { ...s.project, name }, dirty: true, rev: s.rev + 1 })),

  setBug: (on) => set((s) => ({ history: pushHistory(s.project, s.history), future: [], project: { ...s.project, bug: on }, dirty: true, rev: s.rev + 1 })),

  seek: (time, snap = false) => {
    const p = viewOf(get())
    const clamped = Math.max(0, Math.min(p.duration, time))
    const finalTime = snap ? snapTime(clamped, p) : clamped
    set({ currentTime: finalTime })
  },

  play: () => set({ playing: true, rate: 1 }),
  pause: () => set({ playing: false, rate: 0 }),
  togglePlay: () => set((s) => (s.playing || s.rate ? { playing: false, rate: 0 } : { playing: true, rate: 1 })),

  shuttle: (key) => set((s) => {
    const cur = s.playing ? s.rate || 1 : s.rate
    if (key === 'k') return { playing: false, rate: 0 }
    if (key === 'l') {
      const r = cur > 0 ? Math.min(4, cur * 2) : 1
      return { playing: true, rate: r }
    }
    const r = cur < 0 ? Math.max(-4, cur * 2) : -1
    // backwards is a paused scrub (exact frames): the playback loop only runs forwards
    return { playing: false, rate: r }
  }),

  stepFrame: (frames) => {
    const s = get()
    const dt = frames * (1 / s.project.fps)
    s.seek(s.currentTime + dt)
  },

  addClip: (clip) => set((s) => ({ ...edit(s, addClip(ensureTracksFor(viewOf(s), [clip]), clip)), selectedClipId: clip.id, selectedIds: [clip.id] })),

  addClips: (clips) => set((s) => {
    if (!clips.length) return {}
    let p = ensureTracksFor(viewOf(s), clips)
    for (const c of clips) p = addClip(p, c)
    return { ...edit(s, p), selectedClipId: clips[0].id, selectedIds: [clips[0].id] }
  }),

  placeClips: (clips, mode) => {
    const s = get()
    if (!clips.length) return false
    const view = viewOf(s)
    const next = (mode ?? s.editMode) === 'insert' ? insertClips(view, clips) : overwriteClips(view, clips)
    if (next === view) return false
    set((st) => ({ ...edit(st, next), selectedClipId: clips[0].id, selectedIds: [clips[0].id] }))
    return true
  },

  updateClip: (clip) => set((s) => { const v = viewOf(s); return edit(s, { ...v, clips: v.clips.map((c) => (c.id === clip.id ? clip : c)) }) }),

  updateClipCoalesced: (clip, key) => set((s) => {
    const v = viewOf(s)
    const next = { ...v, clips: v.clips.map((c) => (c.id === clip.id ? clip : c)) }
    const now = Date.now()
    const id = `${clip.id}|${key}`
    const same = !!coalesceMark && coalesceMark.key === id && coalesceMark.rev === s.rev && now - coalesceMark.at < COALESCE_MS && !s.gesture && s.history.length > 0
    // inside an open step the earlier undo entry already holds the state before the first keystroke: change the project only
    const r = same ? edit({ ...s, gesture: true }, next) : edit(s, next)
    const rev = (r.rev as number | undefined) ?? s.rev
    coalesceMark = { key: id, rev, at: now }
    return r
  }),

  endCoalesce: () => { coalesceMark = null },

  moveClip: (clipId, newStart, newTrackId) => set((s) => edit(s, moveClip(viewOf(s), clipId, newStart, newTrackId))),

  trimClip: (clipId, newStart, newDuration) => set((s) => edit(s, trimClip(viewOf(s), clipId, newStart, newDuration))),

  trimClipLeftDelta: (clipId, deltaSeconds) => set((s) => edit(s, trimClipLeft(viewOf(s), clipId, deltaSeconds))),

  trimClipRightDelta: (clipId, deltaSeconds) => set((s) => edit(s, trimClipRight(viewOf(s), clipId, deltaSeconds))),

  rippleTrimDelta: (clipId, side, deltaSeconds) => set((s) => edit(s, rippleTrim(viewOf(s), clipId, side, deltaSeconds))),

  rollDelta: (leftId, rightId, deltaSeconds) => set((s) => edit(s, rollEdit(viewOf(s), leftId, rightId, deltaSeconds))),

  slipDelta: (clipId, delta) => set((s) => edit(s, slipClip(viewOf(s), clipId, delta))),

  slideDelta: (clipId, delta) => set((s) => edit(s, slideClip(viewOf(s), clipId, delta))),

  retime: (clipId, f) => {
    const s = get()
    const v = viewOf(s)
    const next = retimeClip(v, clipId, f)
    if (next === v) return false
    set((st) => edit(st, next))
    return true
  },

  splitAtPlayhead: () => {
    const s = get()
    const project = viewOf(s)
    const { currentTime, selectedClipId } = s
    const target = selectedClipId
      ? project.clips.find((c) => c.id === selectedClipId)
      : project.clips.find((c) => currentTime > c.start && currentTime < c.start + c.duration)
    if (!target) return
    const updated = splitClip(project, target.id, currentTime)
    if (updated === project) return
    set((st) => edit(st, updated))
  },

  deleteSelectedClip: () => {
    const s = get()
    const project = viewOf(s)
    const ids = liveSelection(s, project)
    if (!ids.length) return
    let next = project
    for (const id of ids) next = deleteClip(next, id)
    if (next === project) return // on a locked track (or linked to one)
    set((st) => ({ ...edit(st, next), selectedClipId: null, selectedIds: [] }))
  },

  rippleDeleteSelected: () => {
    const s = get()
    const project = viewOf(s)
    const ids = liveSelection(s, project)
    if (!ids.length) return false
    // each selected clip ripples out in turn (later ones keep their ids as they move up), all in one undo step
    let next = project
    for (const id of ids) {
      if (!next.clips.some((c) => c.id === id)) continue
      const r = rippleDelete(next, id)
      if (r === next) return false
      next = r
    }
    set((st) => ({ ...edit(st, next), selectedClipId: null, selectedIds: [] }))
    return true
  },

  lift: () => {
    const s = get()
    const span = rangeOrSelection(s)
    if (!span) return false
    const v = viewOf(s)
    const next = liftRange(v, span[0], span[1])
    if (next === v) return false
    set((st) => ({ ...edit(st, next), selectedClipId: null, selectedIds: [] }))
    return true
  },

  extract: () => {
    const s = get()
    const span = rangeOrSelection(s)
    if (!span) return false
    const v = viewOf(s)
    const next = extractRange(v, span[0], span[1])
    if (next === v) return false
    set((st) => ({ ...edit(st, next), selectedClipId: null, selectedIds: [], range: { in: null, out: null }, currentTime: Math.min(st.currentTime, span[0]) }))
    return true
  },

  setRangeIn: (t) => set((s) => ({ range: { in: t, out: t != null && s.range.out != null && s.range.out <= t ? null : s.range.out } })),
  setRangeOut: (t) => set((s) => ({ range: { out: t, in: t != null && s.range.in != null && s.range.in >= t ? null : s.range.in } })),

  unlinkClip: (clipId) => set((s) => edit(s, unlinkClip(viewOf(s), clipId))),

  selectClip: (clipId, mode = 'replace') => set((s) => {
    if (!clipId) return { selectedClipId: null, selectedIds: [] }
    if (mode === 'toggle') {
      const has = s.selectedIds.includes(clipId)
      const ids = has ? s.selectedIds.filter((x) => x !== clipId) : [...s.selectedIds, clipId]
      return { selectedIds: ids, selectedClipId: has ? (s.selectedClipId === clipId ? ids[0] ?? null : s.selectedClipId) : s.selectedClipId ?? clipId }
    }
    return { selectedClipId: clipId, selectedIds: [clipId] }
  }),

  selectClips: (ids) => set({ selectedIds: ids, selectedClipId: ids[0] ?? null }),

  setZoom: (zoom) => set({ zoom: Math.max(10, Math.min(200, zoom)) }),

  setTool: (tool) => set({ tool }),
  setEditMode: (editMode) => set({ editMode }),

  toggleMagnetic: () => set((s) => {
    const on = !s.project.magnetic
    let project: VideoProject = { ...s.project, magnetic: on || undefined }
    if (on) project = withViewLength(magnetize(project))
    return { history: pushHistory(s.project, s.history), future: [], project, dirty: true, rev: s.rev + 1 }
  }),

  copySelected: () => {
    const s = get()
    const v = viewOf(s)
    const ids = new Set<string>()
    for (const id of liveSelection(s, v)) for (const x of moveSet(v, id)) ids.add(x)
    const clips = v.clips.filter((c) => ids.has(c.id))
    if (!clips.length) return 0
    // the clicked clip first, so paste attributes reads from it
    clips.sort((a, b) => (a.id === s.selectedClipId ? -1 : b.id === s.selectedClipId ? 1 : 0))
    set({ clipboard: clips })
    return clips.length
  },

  pasteClips: (mode) => {
    const s = get()
    if (!s.clipboard?.length) return false
    const clips = clonesAt(s.clipboard, s.currentTime, Date.now().toString(36))
    return get().placeClips(clips, mode)
  },

  pasteAttributes: (groups) => {
    const s = get()
    const src = s.clipboard?.[0]
    if (!src || !groups.length) return { ok: false, refused: 0 }
    const v = viewOf(s)
    const report = { refused: [] as string[] }
    const next = pasteAttributes(v, src, liveSelection(s, v), groups, report)
    if (next === v) return { ok: false, refused: report.refused.length }
    set((st) => edit(st, next))
    return { ok: true, refused: report.refused.length }
  },

  groupSelected: () => {
    const s = get()
    const v = viewOf(s)
    const next = groupClips(v, liveSelection(s, v))
    if (next === v) return false
    set((st) => edit(st, next))
    return true
  },

  ungroupSelected: () => {
    const s = get()
    const v = viewOf(s)
    const next = ungroupClips(v, liveSelection(s, v))
    if (next === v) return false
    set((st) => edit(st, next))
    return true
  },

  compoundSelected: () => {
    const s = get()
    const v = viewOf(s)
    const ids = liveSelection(s, v)
    if (!ids.length) return false
    const next = makeCompound(v, ids, undefined, s.compoundPath.length)
    if (next === v) return false
    const made = next.clips.find((c) => !v.clips.some((x) => x.id === c.id))
    set((st) => ({ ...edit(st, next), selectedClipId: made?.id ?? null, selectedIds: made ? [made.id] : [] }))
    return true
  },

  compoundIssue: () => {
    const s = get()
    const v = viewOf(s)
    return compoundProblem(v, liveSelection(s, v), s.compoundPath.length)
  },

  toggleRippleMarkers: () => set((s) => ({ history: pushHistory(s.project, s.history), future: [], project: { ...s.project, rippleMarkers: s.project.rippleMarkers === false ? undefined : false }, dirty: true, rev: s.rev + 1 })),

  breakCompound: (clipId) => {
    const s = get()
    const v = viewOf(s)
    const next = breakCompound(v, clipId)
    if (next === v) return false
    set((st) => ({ ...edit(st, next), selectedClipId: null, selectedIds: [] }))
    return true
  },

  openCompound: (clipId) => {
    const s = get()
    const v = viewOf(s)
    const X = v.clips.find((c) => c.id === clipId && c.compound)
    if (!X) return false
    // the playhead goes to the same picture inside (nested time = in + time into the clip)
    const inside = Math.max(0, X.in + (s.currentTime - X.start))
    set({ compoundPath: [...s.compoundPath, clipId], selectedClipId: null, selectedIds: [], currentTime: Math.max(0, Math.min(X.in + X.duration, inside)), playing: false, rate: 0, range: { in: null, out: null } })
    return true
  },

  closeCompound: (depth = Math.max(0, get().compoundPath.length - 1)) => {
    const s = get()
    if (depth >= s.compoundPath.length) return
    // the playhead comes back to where the open compound sits on its parent's timeline
    let t = s.currentTime
    for (let d = s.compoundPath.length; d > depth; d--) {
      const parent = compoundView(s.project, s.compoundPath.slice(0, d - 1))
      const X = parent?.clips.find((c) => c.id === s.compoundPath[d - 1])
      if (X) t = X.start + Math.max(0, Math.min(X.duration, t - X.in))
    }
    set({ compoundPath: s.compoundPath.slice(0, depth), selectedClipId: s.compoundPath[depth] ?? null, selectedIds: s.compoundPath[depth] ? [s.compoundPath[depth]] : [], currentTime: t, playing: false, rate: 0, range: { in: null, out: null } })
  },

  addMarker: (t) => {
    const s = get()
    const v = viewOf(s)
    const at = t ?? s.currentTime
    const id = `mk-${Date.now().toString(36)}-${++markerSeq}`
    const next = addMarker(v, at, { id })
    if (next === v) return v.markers?.find((m) => Math.abs(m.t - at) < 1 / v.fps)?.id ?? null
    set((st) => edit(st, next))
    return id
  },

  updateMarker: (id, patch) => set((s) => edit(s, updateMarker(viewOf(s), id, patch))),

  removeMarker: (id) => set((s) => edit(s, removeMarker(viewOf(s), id))),

  jumpMarker: (dir) => {
    const s = get()
    const m = markerNear(viewOf(s), s.currentTime, dir)
    if (!m) return false
    s.seek(m.t)
    return true
  },

  toggleTrackMute: (trackId) => set((s) => { const v = viewOf(s); return edit(s, { ...v, tracks: v.tracks.map((t) => (t.id === trackId ? { ...t, muted: !t.muted } : t)) }) }),

  toggleTrackLock: (trackId) => set((s) => { const v = viewOf(s); return edit(s, { ...v, tracks: v.tracks.map((t) => (t.id === trackId ? { ...t, locked: !t.locked } : t)) }) }),

  addTrack: (kind) => {
    const before = new Set(viewOf(get()).tracks.map((t) => t.id))
    set((s) => edit(s, addTrack(viewOf(s), kind)))
    return viewOf(get()).tracks.find((t) => !before.has(t.id))?.id ?? ''
  },

  removeTrack: (trackId) => {
    const s = get()
    const v = viewOf(s)
    const next = removeTrack(v, trackId)
    if (next === v) return false
    const gone = !next.clips.some((c) => c.id === s.selectedClipId)
    set((st) => ({ ...edit(st, next), selectedClipId: gone ? null : st.selectedClipId, selectedIds: st.selectedIds.filter((id) => next.clips.some((c) => c.id === id)) }))
    return true
  },

  moveTrack: (trackId, toIndex) => set((s) => edit(s, moveTrack(viewOf(s), trackId, toIndex))),

  toggleTrackHidden: (trackId) => set((s) => { const v = viewOf(s); return edit(s, setTrackHidden(v, trackId, !v.tracks.find((t) => t.id === trackId)?.hidden)) }),

  renameTrack: (trackId, name) => set((s) => edit(s, renameTrack(viewOf(s), trackId, name))),

  setExporting: (exporting, progress = 0) => set({ exporting, exportProgress: progress }),

  newProject: () => {
    const s = get()
    const project = createDefaultTimeline(s.project.aspect)
    releaseDropped(s, project, [])
    gestureFrom = null
    set({ project, compoundPath: [], mediaAssets: [], currentTime: 0, playing: false, rate: 0, selectedClipId: null, selectedIds: [], history: [], future: [], dirty: false, rev: s.rev + 1, projectPath: null, generation: s.generation + 1, gesture: false, range: { in: null, out: null } })
  },

  addMediaAsset: (asset) => set((s) => ({ mediaAssets: [...s.mediaAssets.filter((a) => a.id !== asset.id), asset], dirty: true, rev: s.rev + 1 })),

  relinkAsset: (id, next) => set((s) => {
    const mediaAssets = s.mediaAssets.map((a) => (a.id === id ? { ...a, ...next, missing: false } : a))
    // the undo history points at the new file too, so undoing past the relink never brings back a dead URL
    const fix = (p: VideoProject) => relinkClips(p, mediaAssets)
    return { mediaAssets, project: fix(s.project), history: s.history.map(fix), future: s.future.map(fix), dirty: true, rev: s.rev + 1 }
  }),

  removeMediaAsset: (id) => set((s) => {
    // The bin entry is hidden, not deleted: a clip on the timeline (or one undo can bring back) may still play it, and
    // the saved project finds that clip's file through it. Nothing is revoked here (an object URL is released when the
    // project is replaced and nothing uses it any more). The removal is an undo step of its own.
    const asset = s.mediaAssets.find((a) => a.id === id)
    if (!asset || asset.removed) return {}
    const step: Step = { ...s.project, unhide: [id] }
    return { mediaAssets: s.mediaAssets.map((a) => (a.id === id ? { ...a, removed: true } : a)), history: pushHistory(step, s.history), future: [], dirty: true, rev: s.rev + 1 }
  }),

  setRecordingVoiceover: (recording) => set({ isRecordingVoiceover: recording }),

  undo: () => {
    const { history, project, future, mediaAssets } = get()
    if (history.length === 0) return
    const prev = history[history.length - 1]
    const unhide = new Set(prev.unhide ?? [])
    const redoStep: Step = unhide.size ? { ...project, hide: [...unhide] } : project
    set((s) => ({
      project: bare(prev), history: history.slice(0, history.length - 1), future: [redoStep, ...future], selectedClipId: null, selectedIds: [], dirty: true, rev: s.rev + 1,
      compoundPath: validPath(bare(prev), s.compoundPath),
      mediaAssets: unhide.size ? mediaAssets.map((a) => (unhide.has(a.id) ? { ...a, removed: undefined } : a)) : mediaAssets,
    }))
  },

  redo: () => {
    const { future, project, history, mediaAssets } = get()
    if (future.length === 0) return
    const next = future[0]
    const hide = new Set(next.hide ?? [])
    const undoStep: Step = hide.size ? { ...project, unhide: [...hide] } : project
    set((s) => ({
      project: bare(next), history: [...history, undoStep], future: future.slice(1), selectedClipId: null, selectedIds: [], dirty: true, rev: s.rev + 1,
      compoundPath: validPath(bare(next), s.compoundPath),
      mediaAssets: hide.size ? mediaAssets.map((a) => (hide.has(a.id) ? { ...a, removed: true } : a)) : mediaAssets,
    }))
  },

  setClipGain: (clipId, db) => set((s) => edit(s, updateClipAudio(viewOf(s), clipId, { gain: db }))),
  setClipFade: (clipId, side, fade) => set((s) => edit(s, updateClipAudio(viewOf(s), clipId, side === 'in' ? { fadeIn: fade } : { fadeOut: fade }))),
  setClipPan: (clipId, pan) => set((s) => edit(s, updateClipAudio(viewOf(s), clipId, { pan }))),
  setClipDenoise: (clipId, d) => set((s) => edit(s, updateClipAudio(viewOf(s), clipId, { denoise: d }))),
  patchClipAudio: (clipId, patch) => set((s) => edit(s, updateClipAudio(viewOf(s), clipId, patch))),
  setTrackBus: (trackId, bus) => set((s) => edit(s, updateTrackAudio(viewOf(s), trackId, { bus }))),
  setTrackVolume: (trackId, db) => set((s) => edit(s, updateTrackAudio(viewOf(s), trackId, { volume: db }))),
  setTrackPan: (trackId, pan) => set((s) => edit(s, updateTrackAudio(viewOf(s), trackId, { pan }))),
  setTrackMute: (trackId, muted) => set((s) => edit(s, updateTrackAudio(viewOf(s), trackId, { muted }))),
  setTrackSolo: (trackId, solo) => set((s) => edit(s, updateTrackAudio(viewOf(s), trackId, { solo }))),
  patchTrackAudio: (trackId, patch) => set((s) => edit(s, updateTrackAudio(viewOf(s), trackId, patch))),
  setMaster: (patch) => set((s) => edit(s, updateProjectAudio(viewOf(s), { master: patch }))),
  setDucking: (patch) => set((s) => edit(s, updateProjectAudio(viewOf(s), { ducking: patch }))),
  setLoudnessTarget: (t) => set((s) => edit(s, updateProjectAudio(viewOf(s), { loudnessTarget: t }))),
  setBusVolume: (bus, db) => set((s) => edit(s, updateProjectAudio(viewOf(s), { busVolume: { [bus]: db } }))),
  patchProjectAudio: (patch) => set((s) => edit(s, updateProjectAudio(viewOf(s), patch))),

  markBeats: async (clipId) => {
    const s = get()
    const a = await analyseClipBeats(flattenCompounds(viewOf(s)), clipId)
    return a ? beatProposal({ clipId, clipStart: a.clipStart, clipDuration: a.clipDuration, onsets: a.onsets, beats: a.beats, tempo: a.tempo }) : null
  },

  applyBeats: (proposal, use = 'beats') => {
    const s = get()
    const v = viewOf(s)
    const times = proposalTimes(proposal, use)
    const next = applyBeatMarkers(v, times, Date.now().toString(36))
    if (next === v) return 0
    set((st) => edit(st, next))
    return (next.markers?.length ?? 0) - (v.markers?.length ?? 0)
  },

  beginGesture: () => set((s) => {
    if (s.gesture) return {}
    gestureFrom = s.project
    return { history: pushHistory(s.project, s.history), future: [], gesture: true }
  }),

  endGesture: () => set((s) => {
    if (!s.gesture) return {}
    // the magnetic main track closes its gaps when the drag ends (so the drag itself could reorder clips)
    let project = s.project
    if (project.magnetic && !s.compoundPath.length) project = withViewLength(magnetize(project))
    const unchanged = gestureFrom === project
    gestureFrom = null
    return unchanged ? { gesture: false, history: s.history.slice(0, -1) } : { gesture: false, project }
  }),

  loadProject: (project, opts = {}) => {
    const s = get()
    const assets = opts.assets ?? s.mediaAssets
    releaseDropped(s, project, assets)
    gestureFrom = null
    set({
      project: withViewLength({ ...project, mediaAssets: undefined }),
      compoundPath: [],
      mediaAssets: assets,
      currentTime: 0,
      playing: false,
      rate: 0,
      selectedClipId: null,
      selectedIds: [],
      range: { in: null, out: null },
      history: [],
      future: [],
      // a project put on the desk as it is on disk is clean; restores and story builds pass dirty: true
      dirty: opts.dirty ?? false,
      rev: s.rev + 1,
      projectPath: opts.path !== undefined ? opts.path : s.projectPath,
      generation: s.generation + 1,
      gesture: false,
    })
  },

  markSaved: (path, rev) => set((s) => ({ dirty: rev != null && rev !== s.rev ? s.dirty : false, projectPath: path })),
}))

/** The open compound path, cut back to the part that still exists in `project` (an undo can remove a compound). */
function validPath(project: VideoProject, path: string[]): string[] {
  for (let d = path.length; d > 0; d--) if (compoundView(project, path.slice(0, d))) return path.slice(0, d)
  return []
}

/** The span Lift/Extract act on: the in–out range, else the selection's time span. */
function rangeOrSelection(s: VideoState): [number, number] | null {
  const { in: a, out: b } = s.range
  if (a != null && b != null && b > a) return [a, b]
  const v = viewOf(s)
  const ids = liveSelection(s, v)
  const clips = v.clips.filter((c) => ids.includes(c.id))
  if (!clips.length) return null
  return [Math.min(...clips.map((c) => c.start)), Math.max(...clips.map((c) => c.start + c.duration))]
}

/** A clip's whole move set is on unlocked tracks (for the UI: can it be edited). */
export function canEdit(project: VideoProject, clipId: string): boolean {
  return !setLocked(project, moveSet(project, clipId))
}

// dev-only handle for the end-to-end tests, as src/store.ts exposes __store
if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV && typeof window !== 'undefined') Object.assign(window, { __videoStore: useVideoStore, __videoView: () => viewOf(useVideoStore.getState()) })
