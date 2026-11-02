// The video copy kept with the project (editable text for the publish sheet). Kept apart from videoCopy.ts so the
// project loader can check it without pulling in the AI and Editorial code.

export interface VideoCopy {
  youtubeTitle: string
  description: string
  tags: string[]
  facebook: string
  /** The model that wrote it ('' once the editor has written it by hand) and when. */
  model: string
  at: number
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r/g, '').slice(0, max) : '')

/** Copy read back from a project file: every field is text within platform limits, nothing else is kept. */
export function sanitizeSavedCopy(raw: unknown): VideoCopy | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const tags = Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === 'string').map((t) => t.slice(0, 60)).filter(Boolean).slice(0, 30) : []
  const copy: VideoCopy = {
    youtubeTitle: str(o.youtubeTitle, 100),
    description: str(o.description, 5000),
    tags,
    facebook: str(o.facebook, 2200),
    model: str(o.model, 80),
    at: Number.isFinite(Number(o.at)) ? Number(o.at) : 0,
  }
  return copy.youtubeTitle || copy.description || copy.facebook || copy.tags.length ? copy : undefined
}
