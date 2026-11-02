// Phase 6 project fields (template, brand corner, safe zone, export preset, per-size framing), checked when a project
// file is read. Everything is a short fixed-set value or a bounded number; nothing else survives.
import { BUG_CORNERS, type BugCorner } from './brandKit'
import { sanitizeSizes, type SizeOverrides } from './sizes'
import type { Platform } from './titles/brand'

export interface ExportPresetSaved { container: 'mp4' | 'webm'; fps: number; for: string }
export interface ProjectMeta {
  bugCorner?: BugCorner
  safeZone?: Platform
  template?: { id: string; name: string }
  exportPreset?: ExportPresetSaved
  sizes?: SizeOverrides
}

export function sanitizeProjectMeta(parsed: Record<string, unknown>): ProjectMeta {
  const out: ProjectMeta = {}
  if (BUG_CORNERS.some((c) => c.id === parsed.bugCorner) && parsed.bugCorner !== 'tr') out.bugCorner = parsed.bugCorner as BugCorner
  if (parsed.safeZone === 'reels' || parsed.safeZone === 'shorts') out.safeZone = parsed.safeZone
  const t = parsed.template as Record<string, unknown> | undefined
  if (t && typeof t.id === 'string' && typeof t.name === 'string') out.template = { id: t.id.slice(0, 60), name: t.name.slice(0, 80) }
  const e = parsed.exportPreset as Record<string, unknown> | undefined
  if (e && (e.container === 'mp4' || e.container === 'webm') && typeof e.fps === 'number' && e.fps >= 1 && e.fps <= 120) {
    out.exportPreset = { container: e.container, fps: Math.round(e.fps), for: typeof e.for === 'string' ? e.for.slice(0, 120) : '' }
  }
  const sizes = sanitizeSizes(parsed.sizes)
  if (sizes) out.sizes = sizes
  return out
}
