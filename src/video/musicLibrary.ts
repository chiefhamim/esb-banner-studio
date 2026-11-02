// The music library (renderer side). It lists the audio files of ONE folder the owner chose (main process:
// electron/video-music.cjs); nothing is bundled and nothing is downloaded. The renderer names a file only by its path
// relative to that folder; main resolves and confines it. Title and tags come from the file name and its subfolders.
// Licence notes are kept per track on the project's media asset (`MediaAsset.licence`), so they travel with the project.

import { create } from 'zustand'
import type { Clip, MediaAsset } from './timeline'
import { kindOf, newAssetId, patchMeta, probeMedia, videoBridge } from './media'
import { useVideoStore } from './videoStore'
import { capabilities, writeTrack } from './audioAdapter'

export interface MusicFile { rel: string; name: string; size: number; mtimeMs: number; title: string; tags: string[]; subfolder: string }

/** "Artist - Calm piano [ambient, slow] #news.mp3" → title "Artist - Calm piano", tags ambient, slow, news. Folder names
 * above the file are tags too. Brackets and parentheses hold tags; #words are tags; underscores are spaces. */
export function parseTrackName(rel: string): { title: string; tags: string[]; subfolder: string } {
  const parts = rel.split('/')
  const file = parts[parts.length - 1]
  const folders = parts.slice(0, -1)
  let stem = file.replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/_/g, ' ')
  const tags: string[] = []
  const take = (m: string) => { for (const t of m.split(/[,;|]/)) { const v = t.trim(); if (v && v.length <= 30) tags.push(v) } }
  stem = stem.replace(/\[([^\]]*)\]/g, (_, m: string) => { take(m); return ' ' })
  stem = stem.replace(/\(([^)]*)\)/g, (_, m: string) => { take(m); return ' ' })
  stem = stem.replace(/(^|\s)#([^\s#]+)/g, (_, sp: string, m: string) => { tags.push(m.replace(/-/g, ' ')); return sp })
  const title = stem.replace(/\s+/g, ' ').trim() || file
  for (const f of folders) { const v = f.trim(); if (v && v.length <= 30) tags.push(v) }
  const seen = new Set<string>()
  const uniq = tags.filter((t) => { const k = t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true }).slice(0, 8)
  return { title, tags: uniq, subfolder: folders.join(' / ') }
}

export const fmtTrackLength = (s: number) => (s > 0 && Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '')

export interface MusicState {
  supported: boolean
  folder: { path: string; name: string } | null
  files: MusicFile[]
  truncated: boolean
  loading: boolean
  error: string | null
  /** Lengths read so far (seconds), by rel, once a file was previewed or added. */
  durations: Record<string, number>
  /** The registered file for a rel (media URL), once previewed or added. */
  urls: Record<string, string>
  playing: string | null
}

export const useMusic = create<MusicState>(() => ({ supported: false, folder: null, files: [], truncated: false, loading: false, error: null, durations: {}, urls: {}, playing: null }))
const set = useMusic.setState

const clean = (e: unknown) => String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '').slice(0, 200)

export async function loadMusic(): Promise<void> {
  const b = videoBridge()
  if (!b?.videoMusicFolder || !b.videoMusicList) { set({ supported: false }); return }
  set({ supported: true, loading: true, error: null })
  try {
    const folder = await b.videoMusicFolder()
    if (!folder) { set({ folder: null, files: [], truncated: false, loading: false }); return }
    const r = await b.videoMusicList()
    set({ folder, files: r.files.map((f) => ({ ...f, ...parseTrackName(f.rel) })), truncated: r.truncated, loading: false })
  } catch (e) {
    set({ loading: false, error: clean(e) })
  }
}

export async function chooseMusicFolder(): Promise<void> {
  const b = videoBridge()
  if (!b?.videoMusicChoose) return
  stopPreview()
  try {
    await b.videoMusicChoose()
    set({ durations: {}, urls: {} })
    await loadMusic()
  } catch (e) { set({ error: clean(e) }) }
}

export async function clearMusicFolder(): Promise<void> {
  const b = videoBridge()
  stopPreview()
  try { await b?.videoMusicClear?.() } catch { /* nothing to forget */ }
  set({ folder: null, files: [], truncated: false, durations: {}, urls: {} })
}

/** Ask main to register a file of the chosen folder; its media URL and length. Refused paths throw. */
async function register(rel: string): Promise<{ url: string; path: string; name: string; size: number; mtimeMs: number; duration: number }> {
  const b = videoBridge()
  if (!b?.videoMusicUse) throw new Error('The music library needs the desktop app.')
  const e = await b.videoMusicUse(rel)
  if (!e?.url) throw new Error('That file could not be opened.')
  let duration = useMusic.getState().durations[rel] ?? 0
  if (!duration) {
    const p = await probeMedia(e.url, 'audio')
    duration = p.duration
    set((s) => ({ durations: { ...s.durations, [rel]: duration }, urls: { ...s.urls, [rel]: e.url } }))
  } else set((s) => ({ urls: { ...s.urls, [rel]: e.url } }))
  return { url: e.url, path: e.path, name: e.name, size: e.size, mtimeMs: e.mtimeMs, duration }
}

// ---- preview -----------------------------------------------------------------------------------------------------
let audio: HTMLAudioElement | null = null
export function stopPreview() {
  if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); audio = null }
  if (useMusic.getState().playing) set({ playing: null })
}
export async function togglePreview(rel: string): Promise<void> {
  if (useMusic.getState().playing === rel) { stopPreview(); return }
  stopPreview()
  try {
    const f = await register(rel)
    const el = new Audio(f.url)
    audio = el
    el.onended = () => { if (audio === el) stopPreview() }
    el.onerror = () => { if (audio === el) { stopPreview(); set({ error: 'That file would not play.' }) } }
    set({ playing: rel, error: null })
    await el.play()
  } catch (e) {
    stopPreview()
    set({ error: clean(e) })
  }
}

// ---- onto the timeline -------------------------------------------------------------------------------------------
/** The audio track music goes on: one already marked as the music bus or named Music, else a new "Music" track. */
export function musicTrackId(): string {
  const s = useVideoStore.getState()
  const tracks = s.project.tracks.filter((t) => t.kind === 'audio')
  const found = tracks.find((t) => (t as unknown as { bus?: string }).bus === 'music') ?? tracks.find((t) => /^music$/i.test(t.name.trim()))
  if (found) return found.id
  const id = s.addTrack('audio')
  s.renameTrack(id, 'Music')
  if (capabilities().track) writeTrack(id, { bus: 'music' })
  return id
}

/** The project's bin entry for a library track, made (and the file registered) the first time it is used. */
export async function ensureMusicAsset(rel: string, id?: string): Promise<MediaAsset> {
  const f = await register(rel)
  const have = useVideoStore.getState().mediaAssets.find((a) => a.musicRel === rel && !a.removed)
  if (have) return have
  const file = useMusic.getState().files.find((x) => x.rel === rel)
  const ext = /.[A-Za-z0-9]+$/.exec(f.name)?.[0] ?? ''
  const asset: MediaAsset = { id: id ?? newAssetId(), name: file?.title ? `${file.title}${ext}` : f.name, type: 'audio', url: f.url, path: f.path, size: f.size, mtimeMs: f.mtimeMs, duration: f.duration, musicRel: rel }
  patchMeta(asset.id, { storage: 'reference', file: undefined })
  useVideoStore.getState().addMediaAsset(asset)
  return asset
}

/** Dragging a library row: the drop handler looks the asset up by id, so the id is handed out at once and the bin
 * entry is made right behind it (a drop takes longer than that). */
export function dragMusic(rel: string): string {
  const have = useVideoStore.getState().mediaAssets.find((a) => a.musicRel === rel && !a.removed)
  if (have) return have.id
  const id = newAssetId()
  void ensureMusicAsset(rel, id).catch((e) => set({ error: clean(e) }))
  return id
}

/** Add a library track to the project's bin (once) and to the music track at `at`. One undo step. */
export async function addMusicToTimeline(rel: string, at: number): Promise<string> {
  const asset = await ensureMusicAsset(rel)
  const d = asset.duration > 0 ? asset.duration : 30
  useVideoStore.getState().beginGesture()
  const trackId = musicTrackId()
  const clip: Clip = { id: `clip-mus-${Date.now().toString(36)}`, trackId, title: asset.name, kind: 'audio', start: Math.max(0, at), duration: d, in: 0, out: d, color: '#0d9488', sourceUrl: asset.url, mediaAssetId: asset.id, srcDuration: d, volume: 1 }
  useVideoStore.getState().addClip(clip)
  useVideoStore.getState().endGesture()
  return clip.id
}

/** A licence note on a track that is in the project (`MediaAsset.licence`; the project file keeps it). */
export function setLicenceNote(assetId: string, text: string) {
  const v = text.slice(0, 600)
  useVideoStore.setState((s) => ({ mediaAssets: s.mediaAssets.map((a) => (a.id === assetId ? { ...a, licence: v || undefined } : a)), dirty: true, rev: s.rev + 1 }))
}

export const isAudioName = (name: string) => kindOf(name) === 'audio'
