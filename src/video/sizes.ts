// One edit, several sizes. A project keeps ONE timeline (clips, timing, words, sound) and, per picture shape, how its
// footage is framed (fit, scale, offsets, the face-following keyframes). Switching the project's shape saves the framing
// of the shape being left and loads the one for the shape being entered, so an edit to timing or words shows in every
// size, and a per-size tweak stays with its size. Pure: nothing here touches the store or the network.
import type { AspectRatio, Clip, VideoProject } from './timeline'
import { ASPECT_CONFIGS } from './timeline'
import type { Keyframe } from './timeline'

export const SIZE_ASPECTS: readonly AspectRatio[] = ['16:9', '9:16', '4:5']

/** The framing of one clip in one shape. Only what differs between shapes. */
export interface Framing {
  fit?: 'fill' | 'fit'
  scale?: number
  offX?: number
  offY?: number
  /** The keyframes of offX / offY (auto reframe writes these). */
  kfX?: Keyframe[]
  kfY?: Keyframe[]
}
export type SizeFraming = Record<string, Framing>
export type SizeOverrides = Partial<Record<AspectRatio, SizeFraming>>

const isFootage = (c: Clip) => c.kind === 'video' && !c.compound

/** The framing the clips have right now. */
export function captureFraming(p: Pick<VideoProject, 'clips'>): SizeFraming {
  const out: SizeFraming = {}
  for (const c of p.clips) {
    if (!isFootage(c)) continue
    const f: Framing = {}
    if (c.fit) f.fit = c.fit
    if (c.scale !== undefined) f.scale = c.scale
    if (c.offX !== undefined) f.offX = c.offX
    if (c.offY !== undefined) f.offY = c.offY
    if (c.keyframes?.offX?.length) f.kfX = c.keyframes.offX
    if (c.keyframes?.offY?.length) f.kfY = c.keyframes.offY
    if (Object.keys(f).length) out[c.id] = f
  }
  return out
}

/** Put a framing on the clips (a clip with none keeps its fit and loses any offsets or face keyframes of another shape). */
export function withFraming(clips: Clip[], framing: SizeFraming | undefined): Clip[] {
  return clips.map((c) => {
    if (!isFootage(c)) return c
    const f = framing?.[c.id]
    const { offX: _x, offY: _y, scale: _s, ...rest } = c
    const kf = { ...(c.keyframes ?? {}) }
    delete kf.offX
    delete kf.offY
    const next: Clip = { ...rest }
    if (f?.fit ?? c.fit) next.fit = f?.fit ?? c.fit
    if (f?.scale !== undefined) next.scale = f.scale
    if (f?.offX !== undefined) next.offX = f.offX
    if (f?.offY !== undefined) next.offY = f.offY
    if (f?.kfX?.length) kf.offX = f.kfX
    if (f?.kfY?.length) kf.offY = f.kfY
    if (Object.keys(kf).length) next.keyframes = kf
    else delete next.keyframes
    return next
  })
}

/** The project in another shape: the framing of the current shape is remembered, the target's is loaded. */
export function applySize(p: VideoProject, aspect: AspectRatio): VideoProject {
  if (p.aspect === aspect) return p
  const cfg = ASPECT_CONFIGS[aspect]
  const sizes: SizeOverrides = { ...(p.sizes ?? {}), [p.aspect]: captureFraming(p) }
  return { ...p, aspect, width: cfg.width, height: cfg.height, sizes, clips: withFraming(p.clips, sizes[aspect]) }
}

/** The project as it would be exported in `aspect`, without changing which shape the editor is working in. */
export const variantFor = (p: VideoProject, aspect: AspectRatio): VideoProject => applySize(p, aspect)

/** Keep a framing computed for a shape (auto reframe) so entering that shape shows it. */
export function setFraming(p: VideoProject, aspect: AspectRatio, framing: SizeFraming): VideoProject {
  if (p.aspect === aspect) return { ...p, clips: withFraming(p.clips, framing) }
  return { ...p, sizes: { ...(p.sizes ?? {}), [aspect]: framing } }
}

// ---------------------------------------------------------------- reading a saved file

const finite = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
function kfs(raw: unknown): Keyframe[] | undefined {
  if (!Array.isArray(raw) || raw.length > 2000) return undefined
  const out: Keyframe[] = []
  for (const k of raw) {
    const o = k as Record<string, unknown>
    const t = finite(o?.t)
    const v = finite(o?.v)
    if (t === undefined || v === undefined || t < 0) return undefined
    out.push({ t, v, ...(typeof o.ease === 'string' ? { ease: o.ease as Keyframe['ease'] } : {}) })
  }
  return out.length ? out : undefined
}

/** `sizes` read back from a project file: known shapes only, numbers only, bounded. */
export function sanitizeSizes(raw: unknown): SizeOverrides | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: SizeOverrides = {}
  for (const aspect of Object.keys(ASPECT_CONFIGS) as AspectRatio[]) {
    const per = (raw as Record<string, unknown>)[aspect]
    if (!per || typeof per !== 'object' || Array.isArray(per)) continue
    const fr: SizeFraming = {}
    for (const [id, v] of Object.entries(per as Record<string, unknown>).slice(0, 2000)) {
      if (!v || typeof v !== 'object' || id.length > 160) continue
      const o = v as Record<string, unknown>
      const f: Framing = {}
      if (o.fit === 'fill' || o.fit === 'fit') f.fit = o.fit
      const scale = finite(o.scale); if (scale !== undefined && scale > 0 && scale <= 10) f.scale = scale
      const ox = finite(o.offX); if (ox !== undefined && Math.abs(ox) <= 5) f.offX = ox
      const oy = finite(o.offY); if (oy !== undefined && Math.abs(oy) <= 5) f.offY = oy
      const kx = kfs(o.kfX); if (kx) f.kfX = kx
      const ky = kfs(o.kfY); if (ky) f.kfY = ky
      if (Object.keys(f).length) fr[id] = f
    }
    if (Object.keys(fr).length) out[aspect] = fr
  }
  return Object.keys(out).length ? out : undefined
}
