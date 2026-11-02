// Titles: bin-wide choices and helpers shared by the Titles tab, the inspector and the monitor (no components here).

import { create } from 'zustand'
import { CATEGORIES } from '../core/tokens'
import { useVideoStore, viewOf } from './videoStore'
import { trackForKind, type Clip } from './timeline'
import { TITLE_TEMPLATES, type TitleData, type TitleTemplate } from './titleModel'
import type { Platform } from './titles/brand'

/** Bin-wide title choices: the accent new titles take, and the monitor's safe-zone guides. */
export const useTitleUi = create<{ accent: string; guides: boolean; platform: Platform }>(() => ({ accent: 'auto', guides: false, platform: 'reels' }))

/** The guides the monitor draws now (null = off). */
export const guidesNow = () => { const s = useTitleUi.getState(); return s.guides ? { platform: s.platform } : null }


const getVideo = useVideoStore.getState

/** The category id a new title takes: the picker's choice ('auto' = the story's category when a story is open). */
export function accentFor(choice: string, storyCat: string | null): string | undefined {
  if (choice === 'stripes') return undefined
  if (choice === 'auto') return storyCat ?? undefined
  return CATEGORIES.some((c) => c.id === choice) ? choice : undefined
}

export function newTitleClip(template: TitleTemplate, fields: Record<string, string>, extra: Partial<TitleData> = {}): Clip {
  const def = TITLE_TEMPLATES[template]
  const st = getVideo()
  const p = viewOf(st)
  const id = `clip-title-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
  const all: Record<string, string> = {}
  for (const d of def.fields) all[d.key] = fields[d.key] ?? ''
  const td: TitleData = { template, fields: all, ...extra }
  if (template === 'sticker' && td.sticker?.shape !== 'callout') td.fields = {}
  return { id, trackId: trackForKind(p, 'overlay') ?? trackForKind(p, 'text') ?? 'v2', title: def.label, kind: 'overlay', start: st.currentTime, duration: def.seconds, in: 0, out: def.seconds, color: def.color, titleData: td }
}

/** Quoted passages in the story (“…” or "…", four words or more), word for word without their marks. */
export function quotesIn(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/[“"]([^”"]{8,600})[”"]/g)) {
    const q = m[1].replace(/\s+/g, ' ').trim()
    if (q.split(' ').length >= 4 && !out.includes(q)) out.push(q)
  }
  return out.slice(0, 8)
}

