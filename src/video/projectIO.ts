// Video projects on disk: save, open, and the autosave that brings back unsaved work after a crash.
//
// Desktop: a project is saved as a .esbvideo file (the dialog suggests Pictures/ESB Banners/Video) through main, and
// autosave writes a snapshot to userData/video-autosave every 10 s while there are unsaved changes (temp file +
// rename, last 5 kept, electron/video-media.cjs). Browser: the project downloads as a file, and snapshots go to
// localStorage (footage from the browser's file picker cannot come back after a reload; the snapshot keeps the edit).

import type { MediaAsset, VideoProject } from './timeline'
import { deserializeVideoProject, relinkClips, serializeVideoProject } from './timeline'
import { probeMedia, resolveAssets, videoBridge } from './media'
import { useVideoStore } from './videoStore'
import { downloadVideoBlob } from './exportVideo'

export const AUTOSAVE_MS = 10_000
const LS_KEY = 'esb-banner-studio/video-autosave/v1'

export interface Snapshot { at: number; text: string; id?: string }

/** The project id a snapshot's text carries (snapshots are cleared per project). */
const idOf = (text: string): string | undefined => { try { return JSON.parse(text)?.id } catch { return undefined } }

/** Has nothing worth keeping: no clips, nothing in the bin. */
const isBlank = (p: VideoProject, bin: MediaAsset[]) => p.clips.length === 0 && bin.length === 0

/** Write a snapshot. Throws when it could not be kept, so the desk never says "autosaved" for a write that failed. */
export async function writeSnapshot(text: string): Promise<number> {
  const b = videoBridge()
  if (b?.videoAutosave) return (await b.videoAutosave(text)).at
  const at = Date.now()
  let list: Snapshot[] = []
  try { list = (JSON.parse(localStorage.getItem(LS_KEY) || '[]') as Snapshot[]).filter((s) => s && typeof s.text === 'string') } catch { list = [] }
  let next = [...list, { at, text, id: idOf(text) }].slice(-5)
  // browser storage is small (about 5 MB): when it is full, the oldest snapshots go first, down to this one alone
  for (;;) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); return at } catch (e) {
      if (next.length <= 1) throw new Error('browser storage is full (' + ((e as Error).message || 'quota exceeded') + ')')
      next = next.slice(1)
    }
  }
}

export async function latestSnapshot(): Promise<Snapshot | null> {
  const b = videoBridge()
  if (b?.videoAutosaveLatest) return b.videoAutosaveLatest()
  try {
    const list: Snapshot[] = JSON.parse(localStorage.getItem(LS_KEY) || '[]')
    return list.length ? list[list.length - 1] : null
  } catch {
    return null
  }
}

/** Remove one project's snapshots (by id), or all of them. Saving a project clears only its own, so the unsaved work
 * of another project (one replaced by Open, say) can still be restored. */
export async function clearSnapshots(projectId?: string) {
  const b = videoBridge()
  if (b?.videoAutosaveClear) { await b.videoAutosaveClear(projectId); return }
  try {
    if (projectId == null) { localStorage.removeItem(LS_KEY); return }
    const list: Snapshot[] = JSON.parse(localStorage.getItem(LS_KEY) || '[]')
    const left = list.filter((s) => s && (s.id ?? idOf(s.text)) !== projectId)
    if (left.length) localStorage.setItem(LS_KEY, JSON.stringify(left)); else localStorage.removeItem(LS_KEY)
  } catch { /* ignore */ }
}

/** A summary of a snapshot for the restore card (name, clips, when). */
export function describeSnapshot(s: Snapshot): { name: string; clips: number; at: number; projectId: string } | null {
  const p = deserializeVideoProject(s.text)
  return p ? { name: p.name, clips: p.clips.length, at: s.at, projectId: p.id } : null
}

let lastRev = -1
let lastAt: number | null = null
/** Called after each autosave attempt: the time it was kept, or null and the reason it failed. */
type AutosaveListener = (at: number | null, error?: string) => void
const listeners = new Set<AutosaveListener>()
export const onAutosaved = (fn: AutosaveListener) => { listeners.add(fn); return () => { listeners.delete(fn) } }
export const lastAutosaveAt = () => lastAt

/** Write a snapshot now if something changed since the last one (and there is unsaved work). */
export async function autosaveNow(): Promise<boolean> {
  const s = useVideoStore.getState()
  if (s.rev === lastRev || !s.dirty || isBlank(s.project, s.mediaAssets)) return false
  const rev = s.rev
  let at: number
  try {
    at = await writeSnapshot(serializeVideoProject(s.project, s.mediaAssets))
  } catch (e) {
    const why = (e as Error).message || 'the snapshot could not be written'
    listeners.forEach((fn) => fn(null, why))
    throw e
  }
  lastRev = rev
  lastAt = at
  listeners.forEach((fn) => fn(at))
  return true
}

/** Autosave every 10 s while the Video desk is open; once more when it closes. Returns the stop function. */
export function startAutosave(): () => void {
  lastRev = useVideoStore.getState().rev // what is on screen when the desk opens is not new work
  const timer = setInterval(() => { void autosaveNow().catch(() => {}) }, AUTOSAVE_MS)
  return () => { clearInterval(timer); void autosaveNow().catch(() => {}) }
}

/** Open a project's text: find its media again (desktop), point the clips at them, and put it on the desk. Returns the
 * number of media files that are missing (the bin shows them with Relink). */
let loadSeq = 0

/** Open a project's text: find its media again (desktop), point the clips at them, and put it on the desk. Returns the
 * number of media files that are missing (the bin shows them with Relink). When two opens overlap only the newest
 * lands: an older answer that arrives late is dropped (`stale`). */
export async function loadProjectText(text: string, opts: { path: string | null; dirty: boolean }): Promise<{ ok: boolean; missing: number; stale?: boolean }> {
  const seq = ++loadSeq
  const parsed = deserializeVideoProject(text)
  if (!parsed) return { ok: false, missing: 0 }
  const assets = await resolveAssets(parsed.mediaAssets ?? [])
  if (seq !== loadSeq) return { ok: false, missing: 0, stale: true }
  const project = relinkClips({ ...parsed, mediaAssets: undefined }, assets)
  useVideoStore.getState().loadProject(project, { assets, path: opts.path, dirty: opts.dirty })
  lastRev = useVideoStore.getState().rev
  void refreshThumbnails(useVideoStore.getState().generation)
  return { ok: true, missing: assets.filter((a) => a.missing).length }
}

/** Thumbnails are not saved with a project; make them again for the footage that is there. Stops as soon as another
 * project is put on the desk. */
async function refreshThumbnails(generation: number) {
  const current = () => useVideoStore.getState().generation === generation
  for (const a of useVideoStore.getState().mediaAssets) {
    if (!current()) return
    if (a.type !== 'video' || a.missing || !a.url || a.thumbnailUrl) continue
    const p = await probeMedia(a.url, 'video')
    if (!current()) return
    if (p.thumbnailUrl) useVideoStore.setState((s) => ({ mediaAssets: s.mediaAssets.map((x) => (x.id === a.id ? { ...x, thumbnailUrl: p.thumbnailUrl } : x)) }))
  }
}

/** Save: the same file again when the project has one, else ask where. Returns where it went (null: cancelled). */
export async function saveProject(saveAs = false): Promise<string | null> {
  const s = useVideoStore.getState()
  // the revision written: an edit made while the save dialog was open keeps the project marked unsaved (and its
  // snapshots, which hold that edit)
  const rev = s.rev
  const projectId = s.project.id
  const text = serializeVideoProject(s.project, s.mediaAssets)
  const b = videoBridge()
  const done = async (where: string | null) => {
    useVideoStore.getState().markSaved(where, rev)
    if (useVideoStore.getState().rev === rev) await clearSnapshots(projectId)
  }
  if (b?.videoSaveProject) {
    const where = await b.videoSaveProject(s.project.name || 'video', text, saveAs ? null : s.projectPath)
    if (where) await done(where)
    return where
  }
  const filename = `${(s.project.name || 'video').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'video'}.esbvideo`
  downloadVideoBlob(new Blob([text], { type: 'application/json' }), filename)
  await done(null)
  return filename
}
