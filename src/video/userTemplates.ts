// The editor's own templates: "Save as template" keeps the STRUCTURE of a video (tracks, timing, title looks, effects,
// sound levels, shape, brand corner, export defaults) and strips its CONTENT: no media, no words, no figures, no
// markers, no transcript, no copy. A video made from one has empty slots that block the export until filled.
import type { Clip, Track, VideoProject } from './timeline'
import { createDefaultTimeline } from './timeline'

export interface UserTemplate {
  id: string
  name: string
  at: number
  /** The stripped structure. */
  shell: Pick<VideoProject, 'aspect' | 'width' | 'height' | 'fps' | 'duration' | 'bug'> & Partial<Pick<VideoProject, 'bugCorner' | 'safeZone' | 'loudnessTarget' | 'busVolume' | 'master' | 'ducking' | 'exportPreset' | 'rippleMarkers' | 'magnetic'>> & { tracks: Track[]; clips: Clip[] }
}

export const MAX_USER_TEMPLATES = 20
const KEY = 'esb-banner-studio/video/templates/v1'
const MAX_CHARS = 300_000

/** A clip with its content taken out and its structure kept. Null for a clip that is all content (a Grid figure card). */
export function stripClip(c: Clip): Clip | null {
  if (c.dataCard) return null
  const { sourceUrl: _s, thumbnailUrl: _t, mediaAssetId: _m, srcDuration: _d, transcript: _tr, ...rest } = c as Clip & { transcript?: unknown }
  const out: Clip = { ...rest, title: c.kind === 'video' ? 'Footage slot' : c.kind === 'audio' ? 'Sound slot' : c.title }
  if (c.kind === 'caption') { out.captionText = ''; out.title = 'Caption' }
  if (c.overlayText !== undefined) out.overlayText = ''
  if (c.overlaySub !== undefined) out.overlaySub = ''
  if (c.titleData) out.titleData = { ...c.titleData, fields: Object.fromEntries(Object.keys(c.titleData.fields).map((k) => [k, ''])) }
  // a still picture or a sound file is content; footage keeps its place, length and framing but not its file
  if (c.still && !c.sourceUrl) out.still = true
  return out
}

export function templateFrom(project: VideoProject, name: string, id = `ut-${Date.now().toString(36)}`): UserTemplate {
  const clips: Clip[] = []
  for (const c of project.clips) {
    const s = stripClip(c)
    if (s) clips.push(s)
  }
  return {
    id,
    name: name.trim().slice(0, 60) || 'My template',
    at: Date.now(),
    shell: {
      aspect: project.aspect, width: project.width, height: project.height, fps: project.fps, duration: project.duration, bug: project.bug,
      ...(project.bugCorner ? { bugCorner: project.bugCorner } : {}),
      ...(project.safeZone ? { safeZone: project.safeZone } : {}),
      ...(project.loudnessTarget !== undefined ? { loudnessTarget: project.loudnessTarget } : {}),
      ...(project.busVolume ? { busVolume: project.busVolume } : {}),
      ...(project.master ? { master: project.master } : {}),
      ...(project.ducking ? { ducking: project.ducking } : {}),
      ...(project.exportPreset ? { exportPreset: project.exportPreset } : {}),
      tracks: project.tracks.map((t) => ({ ...t })),
      clips,
    },
  }
}

/** A new project from a template: its slots are empty, nothing of the original's content is in it. */
export function projectFromTemplate(t: UserTemplate, stamp = Date.now().toString(36)): VideoProject {
  const base = createDefaultTimeline(t.shell.aspect)
  return {
    ...base,
    id: `tpl-${stamp}`,
    name: t.name,
    aspect: t.shell.aspect,
    width: t.shell.width,
    height: t.shell.height,
    fps: t.shell.fps,
    duration: t.shell.duration,
    bug: t.shell.bug,
    ...(t.shell.bugCorner ? { bugCorner: t.shell.bugCorner } : {}),
    ...(t.shell.safeZone ? { safeZone: t.shell.safeZone } : {}),
    ...(t.shell.loudnessTarget !== undefined ? { loudnessTarget: t.shell.loudnessTarget } : {}),
    ...(t.shell.busVolume ? { busVolume: t.shell.busVolume } : {}),
    ...(t.shell.master ? { master: t.shell.master } : {}),
    ...(t.shell.ducking ? { ducking: t.shell.ducking } : {}),
    ...(t.shell.exportPreset ? { exportPreset: t.shell.exportPreset } : {}),
    template: { id: t.id, name: t.name },
    tracks: t.shell.tracks.map((x) => ({ ...x })),
    clips: t.shell.clips.map((c) => ({ ...c })),
  }
}

// ---------------------------------------------------------------- the list on this PC

type Store = Pick<Storage, 'getItem' | 'setItem'>
const store = (): Store | undefined => (typeof localStorage !== 'undefined' ? localStorage : undefined)

function valid(t: unknown): t is UserTemplate {
  if (!t || typeof t !== 'object') return false
  const o = t as Record<string, unknown>
  const s = o.shell as Record<string, unknown> | undefined
  return typeof o.id === 'string' && o.id.length < 80 && typeof o.name === 'string' && !!s && Array.isArray(s.tracks) && Array.isArray(s.clips) && typeof s.width === 'number' && typeof s.height === 'number' && typeof s.aspect === 'string'
}

export function loadUserTemplates(st: Pick<Storage, 'getItem'> | undefined = store()): UserTemplate[] {
  try {
    const raw = JSON.parse(st?.getItem(KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter(valid).slice(0, MAX_USER_TEMPLATES) : []
  } catch { return [] }
}

/** Save (or replace by id) a template; false when it is too big or the list is full. */
export function saveUserTemplate(t: UserTemplate, st: Store | undefined = store()): { ok: boolean; why?: string } {
  if (!st) return { ok: false, why: 'Templates cannot be saved here.' }
  const all = loadUserTemplates(st).filter((x) => x.id !== t.id)
  if (all.length >= MAX_USER_TEMPLATES) return { ok: false, why: `You can keep ${MAX_USER_TEMPLATES} templates. Delete one first.` }
  const next = [t, ...all]
  const text = JSON.stringify(next)
  if (JSON.stringify(t).length > MAX_CHARS) return { ok: false, why: 'This video is too large to keep as a template.' }
  try { st.setItem(KEY, text); return { ok: true } } catch { return { ok: false, why: 'This PC’s storage is full.' } }
}

export function deleteUserTemplate(id: string, st: Store | undefined = store()) {
  if (!st) return
  try { st.setItem(KEY, JSON.stringify(loadUserTemplates(st).filter((x) => x.id !== id))) } catch { /* nothing to delete from */ }
}
