// The Video desk's project file schema (Phase 1): `project.json` inside a `.esbvideo` project folder.
//
//   {
//     "format": "esb-video-project",
//     "version": 2,
//     "savedAt": 1761990000000,
//     "settings": { "importMode": "reference" | "copy", "proxies": "auto" | "off" },
//     "media":    [ { id, name, type, storage: "reference" | "copy", path?, file?, size, mtimeMs?, hash?, duration,
//                     width?, height?, hasAudio?, codec?, fps?, keyframeInterval?, generated?, removed? } ],
//     "timeline": { …the sequence exactly as serializeVideoProject writes it, without mediaAssets… }
//   }
//
// Ownership: this module owns `format`, `version`, `settings` and `media`. `timeline` is passed through untouched —
// it is whatever `serializeVideoProject` writes (minus `mediaAssets`) and is read back by `deserializeVideoProject`,
// so the timeline model (Phase 1 Part B: tracks v2) can change its own shape and its own migrations freely.
//
// Version 1 is the Phase 0 single-file `.esbvideo`: the sequence at the top level with `mediaAssets` beside it (its
// own `version` field was the timeline's). `migrateProjectDoc` turns it (or any older version) into the current one;
// a file from a newer app is refused rather than half-read.

import type { MediaAsset, VideoProject } from './timeline'
import { deserializeVideoProject, serializeVideoProject } from './timeline'

export const PROJECT_FORMAT = 'esb-video-project'
export const PROJECT_SCHEMA_VERSION = 2

export type ImportMode = 'reference' | 'copy'
export interface ProjectSettings {
  /** What Import does with a file by default: play it where it is (default) or copy it into the folder's media/. */
  importMode: ImportMode
  /** Make 540p proxies in the background for heavy footage (default on). */
  proxies: 'auto' | 'off'
}
export const DEFAULT_SETTINGS: ProjectSettings = { importMode: 'reference', proxies: 'auto' }

/** Facts about a media file kept with the project beside the bin entry (relinking, proxies, the bin's metadata line). */
export interface AssetFacts {
  /** 'copy': the file lives in the project's media/ (`file` is its path there); 'reference': played where it is. */
  storage?: ImportMode
  /** media/<name> inside the project folder (copies only). */
  file?: string
  /** Quick content hash (size + head/middle/tail, electron/video-project.cjs quickHash), for relinking and proxy names. */
  hash?: string
  codec?: string
  fps?: number
  /** Longest gap between key frames seen near the start, in seconds. */
  keyframeInterval?: number
}

export interface MediaRecord extends AssetFacts {
  id: string
  name: string
  type: MediaAsset['type']
  storage: ImportMode
  path?: string
  size: number
  mtimeMs?: number
  duration: number
  width?: number
  height?: number
  hasAudio?: boolean
  generated?: boolean
  removed?: boolean
}

export interface ProjectDoc {
  format: typeof PROJECT_FORMAT
  version: number
  savedAt?: number
  settings: ProjectSettings
  media: MediaRecord[]
  timeline: Record<string, unknown>
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown, max = 4096): string | undefined => (typeof v === 'string' && v.length <= max ? v : undefined)
const HASH = /^[0-9a-f]{32}$/
const REL = /^media\/[^\\/:*?"<>|\u0000-\u001f]{1,180}$/

function settingsOf(v: unknown): ProjectSettings {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return { importMode: o.importMode === 'copy' ? 'copy' : 'reference', proxies: o.proxies === 'off' ? 'off' : 'auto' }
}

/** One media record read from a file: unknown fields dropped, wrong types ignored, a `file` outside media/ refused. */
export function mediaRecordOf(v: unknown): MediaRecord | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const id = str(o.id, 200)
  const type = o.type === 'video' || o.type === 'audio' || o.type === 'image' ? o.type : null
  if (!id || !type) return null
  const file = str(o.file, 200)
  const hash = str(o.hash, 64)
  const storage: ImportMode = o.storage === 'copy' && file && REL.test(file) ? 'copy' : 'reference'
  return {
    id,
    name: str(o.name, 400) ?? 'media',
    type,
    storage,
    path: str(o.path),
    file: storage === 'copy' ? file : undefined,
    size: num(o.size) ?? 0,
    mtimeMs: num(o.mtimeMs),
    hash: hash && HASH.test(hash) ? hash : undefined,
    duration: num(o.duration) ?? 0,
    width: num(o.width),
    height: num(o.height),
    hasAudio: typeof o.hasAudio === 'boolean' ? o.hasAudio : undefined,
    codec: str(o.codec, 80),
    fps: num(o.fps),
    keyframeInterval: num(o.keyframeInterval),
    generated: o.generated === true || undefined,
    removed: o.removed === true || undefined,
  }
}

/** The migrations, one per version step: `MIGRATIONS[n]` turns a version-n document into version n + 1. */
const MIGRATIONS: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {
  // v1 (Phase 0 single file) → v2 (folder schema): the sequence moves under `timeline` unchanged, its bin becomes
  // `media` (every file referenced by path, as v1 kept them), settings get their defaults.
  1: (doc) => {
    const { mediaAssets, ...timeline } = doc
    return {
      format: PROJECT_FORMAT,
      version: 2,
      settings: { ...DEFAULT_SETTINGS },
      media: Array.isArray(mediaAssets) ? mediaAssets.map((a) => ({ ...(a as object), storage: 'reference' })) : [],
      timeline,
    }
  },
}

/** Which schema version a parsed file is: the folder format says so; anything else with tracks and clips at the top
 * level is the Phase 0 single file (version 1, whatever its own timeline `version` says). */
export function schemaVersionOf(doc: unknown): number | null {
  if (!doc || typeof doc !== 'object') return null
  const o = doc as Record<string, unknown>
  if (o.format === PROJECT_FORMAT) return Number.isInteger(o.version) && (o.version as number) >= 2 ? (o.version as number) : null
  if (Array.isArray(o.tracks) && Array.isArray(o.clips)) return 1
  return null
}

export class NewerProjectError extends Error {}

/** Bring any known version up to the current schema. Throws NewerProjectError for a file from a newer app; returns
 * null for something that is not a video project at all. */
export function migrateProjectDoc(raw: unknown): ProjectDoc | null {
  let v = schemaVersionOf(raw)
  if (v == null) return null
  if (v > PROJECT_SCHEMA_VERSION) throw new NewerProjectError(`This project was saved by a newer version of the app (schema ${v}).`)
  let doc = raw as Record<string, unknown>
  while (v < PROJECT_SCHEMA_VERSION) {
    const step = MIGRATIONS[v]
    if (!step) return null
    doc = step(doc)
    v++
  }
  const timeline = doc.timeline
  if (!timeline || typeof timeline !== 'object' || Array.isArray(timeline)) return null
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_SCHEMA_VERSION,
    savedAt: num(doc.savedAt),
    settings: settingsOf(doc.settings),
    media: (Array.isArray(doc.media) ? doc.media : []).map(mediaRecordOf).filter((m): m is MediaRecord => !!m),
    timeline: timeline as Record<string, unknown>,
  }
}

/** A project as project.json text. The timeline part is `serializeVideoProject`'s own output (minus its bin); media
 * records merge each bin entry with its facts. Runtime URLs never reach the file. */
export function buildProjectDoc(project: VideoProject, bin: MediaAsset[], facts: Record<string, AssetFacts | undefined>, settings: ProjectSettings = DEFAULT_SETTINGS, now = Date.now()): string {
  const seq = JSON.parse(serializeVideoProject(project, bin)) as Record<string, unknown>
  const saved = (Array.isArray(seq.mediaAssets) ? seq.mediaAssets : []) as MediaAsset[]
  delete seq.mediaAssets
  const media: MediaRecord[] = saved.map((a) => {
    const f = facts[a.id] ?? {}
    const copy = f.storage === 'copy' && !!f.file && REL.test(f.file)
    return {
      id: a.id, name: a.name, type: a.type, storage: copy ? 'copy' : 'reference', path: a.path, file: copy ? f.file : undefined,
      size: a.size, mtimeMs: a.mtimeMs, hash: f.hash, duration: a.duration, width: a.width, height: a.height, hasAudio: a.hasAudio,
      codec: f.codec, fps: f.fps, keyframeInterval: f.keyframeInterval, generated: a.generated, removed: a.removed,
    }
  })
  const doc: ProjectDoc = { format: PROJECT_FORMAT, version: PROJECT_SCHEMA_VERSION, savedAt: now, settings: settingsOf(settings), media, timeline: seq }
  return JSON.stringify(doc, null, 2)
}

/** Read any project text (v1 single file, v2 folder, an autosave snapshot of either): the sequence with its bin for
 * the desk, the facts per media id, and the settings. Null when it is not a project. Throws NewerProjectError. */
export function parseProjectText(text: string): { project: VideoProject; facts: Record<string, AssetFacts>; settings: ProjectSettings; version: number } | null {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return null }
  const version = schemaVersionOf(raw)
  const doc = migrateProjectDoc(raw)
  if (!doc || version == null) return null
  const mediaAssets: MediaAsset[] = doc.media.map((m) => ({
    id: m.id, name: m.name, type: m.type, url: '', path: m.path, size: m.size, mtimeMs: m.mtimeMs, duration: m.duration,
    width: m.width, height: m.height, hasAudio: m.hasAudio, generated: m.generated, removed: m.removed,
  }))
  const project = deserializeVideoProject(JSON.stringify({ ...doc.timeline, mediaAssets }))
  if (!project) return null
  const facts: Record<string, AssetFacts> = {}
  for (const m of doc.media) facts[m.id] = { storage: m.storage, file: m.file, hash: m.hash, codec: m.codec, fps: m.fps, keyframeInterval: m.keyframeInterval }
  return { project, facts, settings: doc.settings, version }
}

/** A path inside the project folder's media/, as `media/<name>`, or undefined. Case-insensitive on Windows. */
export function relInMedia(folder: string, p: string | undefined): string | undefined {
  if (!p) return undefined
  const f = folder.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase() + '/media/'
  const q = p.replace(/\\/g, '/')
  if (!q.toLowerCase().startsWith(f)) return undefined
  const name = q.slice(f.length)
  const rel = 'media/' + name
  return !name.includes('/') && REL.test(rel) ? rel : undefined
}
