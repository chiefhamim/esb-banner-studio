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

export interface Snapshot { at: number; text: string }

/** Has nothing worth keeping: no clips, nothing in the bin. */
const isBlank = (p: VideoProject, bin: MediaAsset[]) => p.clips.length === 0 && bin.length === 0

export async function writeSnapshot(text: string): Promise<number> {
  const b = videoBridge()
  if (b?.videoAutosave) return (await b.videoAutosave(text)).at
  const at = Date.now()
  try {
    const list: Snapshot[] = JSON.parse(localStorage.getItem(LS_KEY) || '[]')
    const next = [...list.filter((s) => s && typeof s.text === 'string'), { at, text }].slice(-5)
    localStorage.setItem(LS_KEY, JSON.stringify(next))
  } catch { /* storage full: the next tick tries again */ }
  return at
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

export async function clearSnapshots() {
  const b = videoBridge()
  if (b?.videoAutosaveClear) { await b.videoAutosaveClear(); return }
  try { localStorage.removeItem(LS_KEY) } catch { /* ignore */ }
}

/** A summary of a snapshot for the restore card (name, clips, when). */
export function describeSnapshot(s: Snapshot): { name: string; clips: number; at: number } | null {
  const p = deserializeVideoProject(s.text)
  return p ? { name: p.name, clips: p.clips.length, at: s.at } : null
}

let lastRev = -1
let lastAt: number | null = null
const listeners = new Set<(at: number) => void>()
export const onAutosaved = (fn: (at: number) => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
export const lastAutosaveAt = () => lastAt

/** Write a snapshot now if something changed since the last one (and there is unsaved work). */
export async function autosaveNow(): Promise<boolean> {
  const s = useVideoStore.getState()
  if (s.rev === lastRev || !s.dirty || isBlank(s.project, s.mediaAssets)) return false
  const rev = s.rev
  const at = await writeSnapshot(serializeVideoProject(s.project, s.mediaAssets))
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
export async function loadProjectText(text: string, opts: { path: string | null; dirty: boolean }): Promise<{ ok: boolean; missing: number }> {
  const parsed = deserializeVideoProject(text)
  if (!parsed) return { ok: false, missing: 0 }
  const assets = await resolveAssets(parsed.mediaAssets ?? [])
  const project = relinkClips({ ...parsed, mediaAssets: undefined }, assets)
  useVideoStore.getState().loadProject(project, { assets, path: opts.path, dirty: opts.dirty })
  lastRev = useVideoStore.getState().rev
  void refreshThumbnails()
  return { ok: true, missing: assets.filter((a) => a.missing).length }
}

/** Thumbnails are not saved with a project; make them again for the footage that is there. */
async function refreshThumbnails() {
  for (const a of useVideoStore.getState().mediaAssets) {
    if (a.type !== 'video' || a.missing || !a.url || a.thumbnailUrl) continue
    const p = await probeMedia(a.url, 'video')
    if (p.thumbnailUrl) useVideoStore.setState((s) => ({ mediaAssets: s.mediaAssets.map((x) => (x.id === a.id ? { ...x, thumbnailUrl: p.thumbnailUrl } : x)) }))
  }
}

/** Save: the same file again when the project has one, else ask where. Returns where it went (null: cancelled). */
export async function saveProject(saveAs = false): Promise<string | null> {
  const s = useVideoStore.getState()
  const text = serializeVideoProject(s.project, s.mediaAssets)
  const b = videoBridge()
  if (b?.videoSaveProject) {
    const where = await b.videoSaveProject(s.project.name || 'video', text, saveAs ? null : s.projectPath)
    if (where) { s.markSaved(where); await clearSnapshots() }
    return where
  }
  const filename = `${(s.project.name || 'video').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'video'}.esbvideo`
  downloadVideoBlob(new Blob([text], { type: 'application/json' }), filename)
  s.markSaved(null)
  await clearSnapshots()
  return filename
}
