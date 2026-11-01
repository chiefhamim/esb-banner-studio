// Video projects on disk: save, open, and the autosave that brings back unsaved work after a crash.
//
// Desktop (Phase 1): a project is a `.esbvideo` FOLDER (Pictures/ESB Banners/Video/<name>.esbvideo/, made by main's
// save dialog) holding project.json (schema in projectFolder.ts), media/ (copies, when the editor chose Copy),
// proxies/, cache/, autosave/ and renders/. Autosave writes a snapshot every 10 s while there are unsaved changes —
// into the folder's autosave/ when there is one, else userData/video-autosave (temp file + rename, last 5 kept,
// electron/video-media.cjs). A Phase 0 single-file `.esbvideo` still opens and saves in place; Save as (Ctrl+Shift+S)
// turns it into a folder. Browser: the project downloads as a file and snapshots go to localStorage (footage from the
// browser's file picker cannot come back after a reload; the snapshot keeps the edit).

import type { MediaAsset, VideoProject } from './timeline'
import { relinkClips, serializeVideoProject } from './timeline'
import type { AssetFacts, ProjectSettings } from './projectFolder'
import { buildProjectDoc, DEFAULT_SETTINGS, parseProjectText, relInMedia } from './projectFolder'
import type { FolderRef, MediaEntry } from './media'
import { currentFolder, metaFor, probeMedia, resolveAssets, useMediaMeta, videoBridge } from './media'
import { clearProxyQueue, recheckProxies, startMediaPipeline } from './proxies'
import { useVideoStore } from './videoStore'
import { downloadVideoBlob } from './exportVideo'

export const AUTOSAVE_MS = 10_000
const LS_KEY = 'esb-banner-studio/video-autosave/v1'

export interface Snapshot { at: number; text: string; id?: string; folder?: FolderRef }

/** The project id a snapshot's text carries (snapshots are cleared per project). */
const idOf = (text: string): string | undefined => {
  try { const j = JSON.parse(text); return j?.timeline?.id ?? j?.id } catch { return undefined }
}

/** Has nothing worth keeping: no clips, nothing in the bin. */
const isBlank = (p: VideoProject, bin: MediaAsset[]) => p.clips.length === 0 && bin.length === 0

// ---------------------------------------------------------------- the folder on the desk

/** A different project was put on the desk by someone else (New, a story build): it has no folder and no facts yet. */
let adopting = false
let watching = false
function watchDesk() {
  if (watching) return
  watching = true
  useVideoStore.subscribe((s, prev) => {
    if (s.generation === prev.generation || adopting) return
    clearProxyQueue()
    useMediaMeta.setState({ folder: null, settings: { ...DEFAULT_SETTINGS }, byId: {}, found: {} })
  })
}
watchDesk()

/** Facts for every bin entry as they go into project.json: a file inside the folder's media/ is a copy. */
function factsForSave(bin: MediaAsset[], folder: FolderRef | null): Record<string, AssetFacts> {
  const out: Record<string, AssetFacts> = {}
  for (const a of bin) {
    const m = metaFor(a.id) ?? {}
    const file = folder ? relInMedia(folder.path, a.path) : undefined
    out[a.id] = { hash: m.hash, codec: m.codec, fps: m.fps, keyframeInterval: m.keyframeInterval, storage: file ? 'copy' : 'reference', file }
  }
  return out
}

/** The desk's project as current-schema text (with the folder it belongs to, for a snapshot). */
function projectText(withFolder: boolean): string {
  const s = useVideoStore.getState()
  const { folder, settings } = useMediaMeta.getState()
  const text = buildProjectDoc(s.project, s.mediaAssets, factsForSave(s.mediaAssets, folder), settings)
  if (!withFolder || !folder) return text
  const j = JSON.parse(text)
  j.folder = folder
  return JSON.stringify(j)
}

/** Change a project setting (import mode, proxies); it is saved with the project. */
export function setProjectSettings(patch: Partial<ProjectSettings>) {
  useMediaMeta.setState((s) => ({ settings: { ...s.settings, ...patch } }))
  useVideoStore.setState((s) => ({ dirty: true, rev: s.rev + 1 }))
  if (patch.proxies) recheckProxies()
}

// ---------------------------------------------------------------- autosave

/** Write a snapshot. Throws when it could not be kept, so the desk never says "autosaved" for a write that failed. */
export async function writeSnapshot(text: string): Promise<number> {
  const b = videoBridge()
  if (b?.videoAutosave) return (await b.videoAutosave(text, currentFolder()?.id ?? null)).at
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

/** The newest snapshot of any project (userData and every known project folder's autosave/). */
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
export async function clearSnapshots(projectId?: string, folderId: string | null = currentFolder()?.id ?? null) {
  const b = videoBridge()
  if (b?.videoAutosaveClear) { await b.videoAutosaveClear(projectId, folderId); return }
  try {
    if (projectId == null) { localStorage.removeItem(LS_KEY); return }
    const list: Snapshot[] = JSON.parse(localStorage.getItem(LS_KEY) || '[]')
    const left = list.filter((s) => s && (s.id ?? idOf(s.text)) !== projectId)
    if (left.length) localStorage.setItem(LS_KEY, JSON.stringify(left)); else localStorage.removeItem(LS_KEY)
  } catch { /* ignore */ }
}

/** A summary of a snapshot for the restore card (name, clips, when). */
export function describeSnapshot(s: Snapshot): { name: string; clips: number; at: number; projectId: string } | null {
  let p: ReturnType<typeof parseProjectText> = null
  try { p = parseProjectText(s.text) } catch { p = null }
  return p ? { name: p.project.name, clips: p.project.clips.length, at: s.at, projectId: p.project.id } : null
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
    at = await writeSnapshot(projectText(true))
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

/** Autosave every 10 s while the Video desk is open; once more when it closes. Also starts the media pipeline (facts
 * and proxies). Returns the stop function. */
export function startAutosave(): () => void {
  startMediaPipeline()
  lastRev = useVideoStore.getState().rev // what is on screen when the desk opens is not new work
  const timer = setInterval(() => { void autosaveNow().catch(() => {}) }, AUTOSAVE_MS)
  return () => { clearInterval(timer); void autosaveNow().catch(() => {}) }
}

// ---------------------------------------------------------------- open

let loadSeq = 0

/** Find a project's media again: references through main's registry (Phase 0 rule: only files this app imported),
 * the folder's own copies (media/<name>) through the folder the editor opened. */
async function resolveAll(assets: MediaAsset[], facts: Record<string, AssetFacts>, folder: FolderRef | null): Promise<MediaAsset[]> {
  const b = videoBridge()
  const copies = folder && b?.videoFolderResolve ? assets.filter((a) => facts[a.id]?.storage === 'copy' && facts[a.id]?.file) : []
  const copyIds = new Set(copies.map((a) => a.id))
  const refs = await resolveAssets(assets.filter((a) => !copyIds.has(a.id)))
  const byId = new Map(refs.map((a) => [a.id, a]))
  if (copies.length && folder && b?.videoFolderResolve) {
    const res = await b.videoFolderResolve(folder.id, copies.map((a) => facts[a.id].file!))
    copies.forEach((a, i) => {
      const r = res[i]
      byId.set(a.id, r && !r.missing && r.url ? { ...a, url: r.url, path: r.path, size: r.size ?? a.size, mtimeMs: r.mtimeMs ?? a.mtimeMs, missing: false, thumbnailUrl: a.type === 'image' ? r.url : a.thumbnailUrl } : { ...a, url: '', missing: true })
    })
  }
  return assets.map((a) => byId.get(a.id) ?? a)
}

/** Open a project's text (v1 single file, v2 folder project.json, or a snapshot of either): find its media again
 * (desktop), point the clips at them, and put it on the desk. Returns the number of media files that are missing (the
 * bin shows them with Relink, and Relink all when they were found by hash). When two opens overlap only the newest
 * lands: an older answer that arrives late is dropped (`stale`). */
export async function loadProjectText(text: string, opts: { path: string | null; dirty: boolean; folder?: FolderRef | null }): Promise<{ ok: boolean; missing: number; stale?: boolean; error?: string }> {
  const seq = ++loadSeq
  let parsed: ReturnType<typeof parseProjectText>
  try { parsed = parseProjectText(text) } catch (e) { return { ok: false, missing: 0, error: (e as Error).message } }
  if (!parsed) return { ok: false, missing: 0 }
  // a snapshot of a folder project names its folder; main checks the id on every use
  let folder = opts.folder ?? null
  if (opts.folder === undefined) {
    try { const f = JSON.parse(text)?.folder; if (f && typeof f.id === 'string' && /^[0-9a-f]{32}$/.test(f.id) && typeof f.path === 'string') folder = { id: f.id, path: f.path } } catch { /* none */ }
  }
  const assets = await resolveAll(parsed.project.mediaAssets ?? [], parsed.facts, folder)
  if (seq !== loadSeq) return { ok: false, missing: 0, stale: true }
  const project = relinkClips({ ...parsed.project, mediaAssets: undefined }, assets)
  clearProxyQueue()
  adopting = true
  try {
    useVideoStore.getState().loadProject(project, { assets, path: folder ? folder.path : opts.path, dirty: opts.dirty })
  } finally {
    adopting = false
  }
  useMediaMeta.setState({ folder, settings: parsed.settings, byId: Object.fromEntries(Object.entries(parsed.facts).map(([id, f]) => [id, { ...f }])), found: {} })
  lastRev = useVideoStore.getState().rev
  void refreshThumbnails(useVideoStore.getState().generation)
  const missing = assets.filter((a) => a.missing).length
  if (missing) void findMissingMedia()
  return { ok: true, missing }
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

// ---------------------------------------------------------------- relink by hash

/** Look for every missing file by size + quick hash (in the project's media/, and next to where each file was when
 * this app imported it). What is found waits in `useMediaMeta().found` for Relink all. Returns how many were found. */
export async function findMissingMedia(): Promise<number> {
  const b = videoBridge()
  if (!b?.videoRelinkSearch) return 0
  const generation = useVideoStore.getState().generation
  const items = useVideoStore.getState().mediaAssets
    .filter((a) => a.missing)
    .map((a) => ({ id: a.id, path: a.path, size: a.size, hash: metaFor(a.id)?.hash ?? '' }))
    .filter((i) => i.hash && i.size > 0)
  if (!items.length) return 0
  let res: { id: string; entry: MediaEntry }[] = []
  try { res = await b.videoRelinkSearch(currentFolder()?.id ?? null, items) } catch { return 0 }
  if (useVideoStore.getState().generation !== generation) return 0
  const found = Object.fromEntries(res.map((r) => [r.id, r.entry]))
  useMediaMeta.setState({ found })
  return res.length
}

/** Relink every missing file that was found by hash, in one step. Returns how many were relinked. */
export async function relinkAllFound(): Promise<number> {
  const { found } = useMediaMeta.getState()
  const st = useVideoStore.getState()
  let n = 0
  for (const [id, e] of Object.entries(found)) {
    const a = st.mediaAssets.find((x) => x.id === id)
    if (!a || !a.missing) continue
    const p = a.type === 'image' ? null : await probeMedia(e.url, a.type).catch(() => null)
    useVideoStore.getState().relinkAsset(id, { url: e.url, path: e.path, size: e.size, mtimeMs: e.mtimeMs, thumbnailUrl: a.type === 'image' ? e.url : p?.thumbnailUrl ?? a.thumbnailUrl })
    n++
  }
  useMediaMeta.setState({ found: {} })
  return n
}

// ---------------------------------------------------------------- save

/** Save: into the project's folder when it has one; a Phase 0 single file in place; otherwise (or with Save as) make
 * a project folder in main's dialog first. Returns where it went (null: cancelled). */
export async function saveProject(saveAs = false): Promise<string | null> {
  const s = useVideoStore.getState()
  // the revision written: an edit made while the save dialog was open keeps the project marked unsaved (and its
  // snapshots, which hold that edit)
  const rev = s.rev
  const projectId = s.project.id
  const b = videoBridge()
  const done = async (where: string | null, folderId: string | null) => {
    useVideoStore.getState().markSaved(where, rev)
    if (useVideoStore.getState().rev === rev) await clearSnapshots(projectId, folderId)
  }
  if (b?.videoFolderSave && b.videoFolderCreate) {
    const folder = currentFolder()
    if (folder && !saveAs) {
      await b.videoFolderSave(folder.id, projectText(false))
      await done(folder.path, folder.id)
      return folder.path
    }
    if (!folder && s.projectPath && !saveAs && b.videoSaveProject) {
      // a Phase 0 single-file project stays one (older builds can still open it); Save as makes it a folder
      const where = await b.videoSaveProject(s.project.name || 'video', serializeVideoProject(s.project, s.mediaAssets), s.projectPath)
      if (where) await done(where, null)
      return where
    }
    const made = await b.videoFolderCreate(s.project.name || 'video')
    if (!made) return null
    const before = currentFolder()
    useMediaMeta.setState({ folder: made })
    try {
      await b.videoFolderSave(made.id, projectText(false))
    } catch (e) {
      useMediaMeta.setState({ folder: before })
      throw e
    }
    // the old place's snapshots (userData, or the folder it was saved from) belong to this project too
    await clearSnapshots(projectId, before?.id ?? null)
    await done(made.path, made.id)
    recheckProxies()
    return made.path
  }
  if (b?.videoSaveProject) {
    const where = await b.videoSaveProject(s.project.name || 'video', serializeVideoProject(s.project, s.mediaAssets), saveAs ? null : s.projectPath)
    if (where) await done(where, null)
    return where
  }
  const filename = `${(s.project.name || 'video').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'video'}.esbvideo`
  downloadVideoBlob(new Blob([projectText(false)], { type: 'application/json' }), filename)
  await done(null, null)
  return filename
}
