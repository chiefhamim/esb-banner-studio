// Clip effects (Phase 2 — Part B): the effect types, their parameters and defaults, validation of what a project file
// carries, and the .cube LUT parser. Pure (no DOM, no GPU), unit-tested; the compositor (engine/glCompositor.ts) runs
// them as shaders and engine/render.ts resolves them per frame (keyframes through engine/animation.ts).
//
//   colour     exposure, contrast, saturation, vibrance, temperature, tint, highlights, shadows
//   lut        a .cube 3D LUT (its text kept in the project, size-capped) with an intensity
//   chromaKey  key colour, tolerance, softness, spill suppression
//   mask       rectangle or ellipse in the layer's own frame: centre, size, feather, invert (up to MAX_MASKS)
//   blur       Gaussian, radius in pixels of a 1080-line frame (scaled with the output, so preview == export)
//   sharpen    unsharp amount (one output pixel)
//   vignette   amount, size, softness
//
// A layer's blend mode is `clip.blendMode`; an adjustment layer is an overlay clip with `adjustment: true` whose
// effects apply to everything drawn below it for its duration (chroma key does not apply there).
// Every numeric parameter can be animated: keyframes under `fx.<effectId>.<param>`.

import type { Clip, ClipEffect } from './timeline'

export type EffectType = 'colour' | 'lut' | 'chromaKey' | 'mask' | 'blur' | 'sharpen' | 'vignette'
export const EFFECT_TYPES: readonly EffectType[] = ['colour', 'lut', 'chromaKey', 'mask', 'blur', 'sharpen', 'vignette']

export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'add' | 'darken' | 'lighten' | 'soft-light'
export const BLEND_MODES: readonly BlendMode[] = ['normal', 'multiply', 'screen', 'overlay', 'add', 'darken', 'lighten', 'soft-light']
export const BLEND_LABEL: Record<BlendMode, string> = { normal: 'Normal', multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', add: 'Add', darken: 'Darken', lighten: 'Lighten', 'soft-light': 'Soft light' }
/** The shader's number for a blend mode (0 = normal, drawn with hardware blending). */
export const blendIndex = (m: unknown): number => { const i = BLEND_MODES.indexOf(m as BlendMode); return i < 0 ? 0 : i }

export interface NumParam { kind: 'num'; key: string; label: string; min: number; max: number; step: number; def: number; unit?: '%' | 'px' | 'stops' | '' }
export interface ChoiceParam { kind: 'choice'; key: string; label: string; options: { value: string; label: string }[]; def: string }
export interface BoolParam { kind: 'bool'; key: string; label: string; def: boolean }
export interface ColourParam { kind: 'colour'; key: string; label: string; def: string }
export interface TextParam { kind: 'text'; key: string; label: string; def: string; max: number }
export type ParamDef = NumParam | ChoiceParam | BoolParam | ColourParam | TextParam

export interface EffectDef { type: EffectType; label: string; params: ParamDef[]; /** At most this many on one clip. */ max: number; /** Applies on an adjustment layer. */ adjustment: boolean }

const n = (key: string, label: string, min: number, max: number, step: number, def: number, unit: NumParam['unit'] = ''): NumParam => ({ kind: 'num', key, label, min, max, step, def, unit })

/** Largest .cube text kept in a project (a 65-point cube written compactly is ~5.5 MB). */
export const LUT_MAX_CHARS = 8 * 1024 * 1024
/** Largest .cube file read at import (the text is compacted before it is stored). */
export const LUT_MAX_FILE_BYTES = 32 * 1024 * 1024
export const LUT_MIN_SIZE = 2
export const LUT_MAX_SIZE = 65
export const MAX_MASKS = 4
/** Effects on one clip at most (each type is capped too). */
export const MAX_EFFECTS = 12

export const EFFECT_DEFS: Record<EffectType, EffectDef> = {
  colour: {
    type: 'colour', label: 'Colour', max: 1, adjustment: true,
    params: [
      n('exposure', 'Exposure', -3, 3, 0.05, 0, 'stops'),
      n('contrast', 'Contrast', -1, 1, 0.01, 0, '%'),
      n('saturation', 'Saturation', -1, 1, 0.01, 0, '%'),
      n('vibrance', 'Vibrance', -1, 1, 0.01, 0, '%'),
      n('temperature', 'Temperature', -1, 1, 0.01, 0, '%'),
      n('tint', 'Tint', -1, 1, 0.01, 0, '%'),
      n('highlights', 'Highlights', -1, 1, 0.01, 0, '%'),
      n('shadows', 'Shadows', -1, 1, 0.01, 0, '%'),
    ],
  },
  lut: {
    type: 'lut', label: 'LUT', max: 1, adjustment: true,
    params: [
      // the LUT's content id (lutId); the .cube text itself is kept ONCE per project (the project file's `luts`)
      { kind: 'text', key: 'lut', label: 'LUT', def: '', max: 40 },
      { kind: 'text', key: 'name', label: 'Name', def: '', max: 120 },
      n('intensity', 'Intensity', 0, 1, 0.01, 1, '%'),
    ],
  },
  chromaKey: {
    type: 'chromaKey', label: 'Chroma key', max: 1, adjustment: false,
    params: [
      { kind: 'colour', key: 'color', label: 'Key colour', def: '#00b140' },
      n('tolerance', 'Tolerance', 0, 1, 0.01, 0.3, '%'),
      n('softness', 'Softness', 0, 1, 0.01, 0.15, '%'),
      n('spill', 'Spill suppression', 0, 1, 0.01, 0.8, '%'),
    ],
  },
  mask: {
    type: 'mask', label: 'Mask', max: MAX_MASKS, adjustment: true,
    params: [
      { kind: 'choice', key: 'shape', label: 'Shape', options: [{ value: 'rect', label: 'Rectangle' }, { value: 'ellipse', label: 'Ellipse' }], def: 'ellipse' },
      n('x', 'Centre X', 0, 1, 0.005, 0.5, '%'),
      n('y', 'Centre Y', 0, 1, 0.005, 0.5, '%'),
      n('w', 'Width', 0.01, 2, 0.005, 0.6, '%'),
      n('h', 'Height', 0.01, 2, 0.005, 0.6, '%'),
      n('feather', 'Feather', 0, 0.5, 0.005, 0.05, '%'),
      { kind: 'bool', key: 'invert', label: 'Invert', def: false },
    ],
  },
  blur: { type: 'blur', label: 'Blur', max: 1, adjustment: true, params: [n('radius', 'Radius', 0, 100, 0.5, 8, 'px')] },
  sharpen: { type: 'sharpen', label: 'Sharpen', max: 1, adjustment: true, params: [n('amount', 'Amount', 0, 2, 0.01, 0.5, '%')] },
  vignette: {
    type: 'vignette', label: 'Vignette', max: 1, adjustment: true,
    params: [n('amount', 'Amount', 0, 1, 0.01, 0.5, '%'), n('size', 'Size', 0, 1, 0.01, 0.55, '%'), n('softness', 'Softness', 0.05, 1, 0.01, 0.45, '%')],
  },
}

export const isEffectType = (t: unknown): t is EffectType => typeof t === 'string' && (EFFECT_TYPES as readonly string[]).includes(t)

let seq = 0
/** A new effect of `type` with its defaults (no text params: an empty LUT is a no-op until a file is loaded). */
export function newEffect(type: EffectType, existing: { id: string }[] = []): ClipEffect {
  const params: Record<string, number | string | boolean> = {}
  for (const p of EFFECT_DEFS[type].params) if (p.kind !== 'text') params[p.key] = p.def
  let id = ''
  do { id = `fx-${type}-${Date.now().toString(36)}${(seq++).toString(36)}` } while (existing.some((e) => e.id === id))
  return { id, type, enabled: true, params }
}

/** Edit helpers over a clip's effect list (each returns the clip to hand to the inspector's onChange). */
export function withEffect(clip: Clip, id: string, patch: (e: ClipEffect) => ClipEffect): Clip {
  return { ...clip, effects: (clip.effects ?? []).map((e) => (e.id === id ? patch(e) : e)) }
}
export const setParam = (clip: Clip, id: string, key: string, v: number | string | boolean): Clip => withEffect(clip, id, (e) => ({ ...e, params: { ...(e.params ?? {}), [key]: v } }))

/** The value of a parameter, made safe (a project file can carry anything). */
export function paramValue(e: ClipEffect, p: ParamDef): number | string | boolean {
  const v = e.params?.[p.key]
  switch (p.kind) {
    case 'num': return typeof v === 'number' && Number.isFinite(v) ? Math.min(p.max, Math.max(p.min, v)) : p.def
    case 'bool': return typeof v === 'boolean' ? v : p.def
    case 'choice': return typeof v === 'string' && p.options.some((o) => o.value === v) ? v : p.def
    case 'colour': return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : p.def
    case 'text': return typeof v === 'string' && v.length <= p.max ? v : p.def
  }
}

export function paramDef(type: EffectType, key: string): ParamDef | undefined { return EFFECT_DEFS[type].params.find((p) => p.key === key) }

/** Clean an effect list read from a project: known types only, safe ids, values in range, per-type caps. A LUT refers
 * to its text by content id (`params.lut`); `lutRef` maps the file's reference to a registered id (unknown: the LUT
 * is empty). An older inline `params.cube` is registered here (parsed once per distinct text) and replaced by its id.
 * `renames` collects ids that had to change (a duplicate or an unsafe id), so keyframes under `fx.<old id>.` can
 * follow (timeline.ts). Never throws. */
export function sanitizeEffects(raw: unknown, lutRef: (ref: string) => string | undefined = (r) => (lutText(r) ? r : undefined), renames?: { from: string; to: string }[]): ClipEffect[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: ClipEffect[] = []
  const count = new Map<EffectType, number>()
  const ids = new Set<string>()
  for (const r of raw) {
    if (out.length >= MAX_EFFECTS) break
    if (!r || typeof r !== 'object') continue
    const o = r as Partial<ClipEffect>
    if (!isEffectType(o.type)) continue
    const def = EFFECT_DEFS[o.type]
    const k = count.get(o.type) ?? 0
    if (k >= def.max) continue
    const given = typeof o.id === 'string' && /^[\w-]{1,60}$/.test(o.id) ? o.id : null
    let id = given ?? `fx-${o.type}-${out.length + 1}`
    while (ids.has(id)) id = `${id}x`
    ids.add(id)
    if (given && id !== given) renames?.push({ from: given, to: id })
    const src = (o.params && typeof o.params === 'object' ? o.params : {}) as Record<string, unknown>
    const params: Record<string, number | string | boolean> = {}
    const tmp: ClipEffect = { id, type: o.type, params: src as ClipEffect['params'] }
    for (const p of def.params) {
      const v = paramValue(tmp, p)
      if (p.kind === 'text' && v === '') continue
      params[p.key] = v
    }
    if (o.type === 'lut') {
      const ref = typeof params.lut === 'string' ? lutRef(params.lut) : undefined
      delete params.lut
      if (ref) params.lut = ref
      else if (typeof src.cube === 'string' && src.cube.length <= LUT_MAX_CHARS) { const id2 = registerLut(src.cube); if (id2) params.lut = id2 }
    }
    out.push({ id, type: o.type, enabled: o.enabled !== false, params })
    count.set(o.type, k + 1)
  }
  return out
}

// ---------------------------------------------------------------- LUTs by content id
//
// A LUT's .cube text is big (a 65-point cube is ~5.5 MB) and was copied into every clip that used it (and every split
// and paste), so a few clips pushed project.json past main's 25 MB cap and Save and autosave were refused. Now each
// distinct text is kept once: `lutId(text)` (a 64-bit FNV-style hash of the text + its length) names it, clips carry
// only the id (`params.lut`), the project file keeps `luts: { id: text }` for the ids its clips use, and the parse,
// the GPU texture and the save all key by the id. The registry below holds every text seen this session (the undo
// history may still use one); it is content-addressed, so two projects never disagree about an id.

const lutTexts = new Map<string, string>()
const idOfText = new Map<string, string>()

/** The content id of a .cube text ("lut-" + 16 hex + "-" + its length in base 36). */
export function lutId(text: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193 ^ text.length
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193)
    h2 = Math.imul(h2 ^ c, 0x5bd1e995)
    h2 ^= h2 >>> 15
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0')
  return `lut-${hex(h1)}${hex(h2)}-${text.length.toString(36)}`
}

/** Keep a .cube text (it must parse; it is parsed once here) and return its id; null when it is not a usable LUT. */
export function registerLut(text: string): string | null {
  if (typeof text !== 'string' || !text || text.length > LUT_MAX_CHARS) return null
  const known = idOfText.get(text)
  if (known) return known
  const id = lutId(text)
  if (!lutTexts.has(id)) {
    if (!cachedCube(text, id)) return null
    lutTexts.set(id, text)
  }
  idOfText.set(text, id)
  return id
}

/** The text of a registered LUT id. */
export const lutText = (id: unknown): string | undefined => (typeof id === 'string' ? lutTexts.get(id) : undefined)

/** The LUT id an effect uses (an in-memory effect may still carry its text inline: it is registered on first use). */
export function lutOf(e: ClipEffect): string | null {
  const p = e.params
  if (typeof p?.lut === 'string' && lutTexts.has(p.lut)) return p.lut
  if (typeof p?.cube === 'string') return registerLut(p.cube)
  return null
}

/** Every LUT id the clips use. */
export function lutsUsed(clips: Iterable<Pick<Clip, 'effects'>>): Set<string> {
  const out = new Set<string>()
  for (const c of clips) for (const e of c.effects ?? []) if (e?.type === 'lut') { const id = lutOf(e); if (id) out.add(id) }
  return out
}

/** All distinct LUTs of a project together may hold at most this many characters (main refuses a project text over
 * 25 MB; this leaves room for the rest), and at most this many distinct LUTs. */
export const LUT_PROJECT_MAX_CHARS = 16 * 1024 * 1024
export const LUT_PROJECT_MAX = 8

/** Why adding the LUT `text` to a project whose clips already use `used` would be refused (null: it fits). */
export function lutBudgetProblem(used: Set<string>, text: string): string | null {
  const id = lutId(text)
  if (used.has(id)) return null
  if (used.size >= LUT_PROJECT_MAX) return `This project already uses ${used.size} different LUTs (at most ${LUT_PROJECT_MAX}). Use one of them again, or remove one first.`
  let total = text.length
  for (const u of used) total += lutText(u)?.length ?? 0
  if (total > LUT_PROJECT_MAX_CHARS) return `The project's LUTs would take ${(total / 1048576).toFixed(1)} MB (at most ${LUT_PROJECT_MAX_CHARS / 1048576} MB together, so the project can still be saved). Use a smaller LUT (33 points) or one the project already uses.`
  return null
}

// ---------------------------------------------------------------- .cube LUTs

export interface CubeLut { size: number; /** RGB triples, red fastest then green then blue (the .cube order), 0..1. */ data: Float32Array; domainMin: [number, number, number]; domainMax: [number, number, number]; title: string }
export type CubeResult = { ok: true; lut: CubeLut } | { ok: false; error: string }

/** Parse a .cube 3D LUT (Adobe/Resolve format): TITLE, LUT_3D_SIZE 2–65, optional DOMAIN_MIN/MAX, then size³ RGB
 * lines. 1D LUTs are refused. Output values are clamped to 0..1. */
export function parseCube(text: string): CubeResult {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'The file is empty.' }
  if (text.length > LUT_MAX_FILE_BYTES) return { ok: false, error: 'The file is too big for a LUT.' }
  let size = 0
  let title = ''
  const dmin: [number, number, number] = [0, 0, 0]
  const dmax: [number, number, number] = [1, 1, 1]
  let data: Float32Array | null = null
  let k = 0
  let pos = 0
  const len = text.length
  while (pos < len) {
    let end = text.indexOf('\n', pos)
    if (end < 0) end = len
    let line = text.slice(pos, end)
    pos = end + 1
    const hash = line.indexOf('#')
    if (hash >= 0) line = line.slice(0, hash)
    line = line.trim()
    if (!line) continue
    const c0 = line.charCodeAt(0)
    const numeric = (c0 >= 48 && c0 <= 57) || c0 === 45 || c0 === 43 || c0 === 46
    if (!numeric) {
      const sp = line.search(/\s/)
      const key = (sp < 0 ? line : line.slice(0, sp)).toUpperCase()
      const rest = sp < 0 ? '' : line.slice(sp + 1).trim()
      if (key === 'TITLE') { title = rest.replace(/^"|"$/g, '').slice(0, 120); continue }
      if (key === 'LUT_1D_SIZE') return { ok: false, error: 'This is a 1D LUT; only 3D .cube LUTs are supported.' }
      if (key === 'LUT_3D_SIZE') {
        if (data) return { ok: false, error: 'LUT_3D_SIZE appears twice.' }
        size = Number(rest)
        if (!Number.isInteger(size) || size < LUT_MIN_SIZE || size > LUT_MAX_SIZE) return { ok: false, error: `LUT_3D_SIZE must be a whole number from ${LUT_MIN_SIZE} to ${LUT_MAX_SIZE} (17, 33 and 65 are usual).` }
        data = new Float32Array(size * size * size * 3)
        continue
      }
      if (key === 'DOMAIN_MIN' || key === 'DOMAIN_MAX') {
        const v = rest.split(/\s+/).map(Number)
        if (v.length !== 3 || !v.every(Number.isFinite)) return { ok: false, error: `${key} needs three numbers.` }
        if (key === 'DOMAIN_MIN') dmin.splice(0, 3, v[0], v[1], v[2])
        else dmax.splice(0, 3, v[0], v[1], v[2])
        continue
      }
      if (key === 'LUT_3D_INPUT_RANGE') {
        const v = rest.split(/\s+/).map(Number)
        if (v.length !== 2 || !v.every(Number.isFinite)) return { ok: false, error: 'LUT_3D_INPUT_RANGE needs two numbers.' }
        dmin.splice(0, 3, v[0], v[0], v[0])
        dmax.splice(0, 3, v[1], v[1], v[1])
        continue
      }
      // other keywords (Resolve writes a few) are ignored, but words among the numbers are not
      if (data && k > 0) return { ok: false, error: `Unexpected text among the LUT values: “${line.slice(0, 40)}”.` }
      continue
    }
    if (!data) return { ok: false, error: 'LUT values come before LUT_3D_SIZE.' }
    const parts = line.split(/\s+/)
    if (parts.length !== 3) return { ok: false, error: `A LUT line must have three numbers (line ${k + 1} of the values).` }
    if (k >= data.length) return { ok: false, error: `More than ${size}³ values.` }
    for (let j = 0; j < 3; j++) {
      const v = Number(parts[j])
      if (!Number.isFinite(v)) return { ok: false, error: `Not a number in the LUT values: “${parts[j].slice(0, 20)}”.` }
      data[k++] = v < 0 ? 0 : v > 1 ? 1 : v
    }
  }
  if (!data) return { ok: false, error: 'No LUT_3D_SIZE line: this is not a 3D .cube LUT.' }
  if (k !== data.length) return { ok: false, error: `Expected ${size}³ = ${size ** 3} values, found ${k / 3}.` }
  for (let j = 0; j < 3; j++) if (!(dmax[j] > dmin[j])) return { ok: false, error: 'DOMAIN_MAX must be above DOMAIN_MIN.' }
  return { ok: true, lut: { size, data, domainMin: dmin, domainMax: dmax, title } }
}

/** The LUT written back compactly (what a project stores): header + values with at most 5 decimals. */
export function compactCube(lut: CubeLut): string {
  const f = (v: number) => (v === 0 ? '0' : v === 1 ? '1' : String(Math.round(v * 100000) / 100000))
  const lines: string[] = []
  if (lut.title) lines.push(`TITLE "${lut.title.replace(/"/g, '')}"`)
  lines.push(`LUT_3D_SIZE ${lut.size}`)
  const d = (a: number[]) => a.map(f).join(' ')
  if (lut.domainMin.some((v) => v !== 0) || lut.domainMax.some((v) => v !== 1)) { lines.push(`DOMAIN_MIN ${d(lut.domainMin)}`); lines.push(`DOMAIN_MAX ${d(lut.domainMax)}`) }
  const v = lut.data
  for (let i = 0; i < v.length; i += 3) lines.push(`${f(v[i])} ${f(v[i + 1])} ${f(v[i + 2])}`)
  return lines.join('\n') + '\n'
}

/** Parsed LUTs by id (or by text for an unregistered one): parsed once, looked up per frame for nothing. */
const parsed = new Map<string, CubeLut | null>()
export function cachedCube(textOrId: string, id?: string): CubeLut | null {
  const text = lutTexts.get(textOrId) ?? textOrId
  const key = id ?? (lutTexts.has(textOrId) ? textOrId : text.length > 4096 ? lutId(text) : text)
  let hit = parsed.get(key)
  if (hit !== undefined) { parsed.delete(key); parsed.set(key, hit); return hit }
  const r = parseCube(text)
  hit = r.ok ? r.lut : null
  parsed.set(key, hit)
  while (parsed.size > 8) parsed.delete(parsed.keys().next().value!)
  return hit
}

/** CPU reference: the LUT at (r, g, b) (0..1) with trilinear interpolation, as the GPU samples its 3D texture. */
export function applyLutCpu(lut: CubeLut, r: number, g: number, b: number, out: Float32Array | number[] = new Float32Array(3)): Float32Array | number[] {
  const N = lut.size
  const c = (v: number, j: number) => Math.min(1, Math.max(0, (v - lut.domainMin[j]) / (lut.domainMax[j] - lut.domainMin[j]))) * (N - 1)
  const x = c(r, 0), y = c(g, 1), z = c(b, 2)
  const x0 = Math.min(N - 2, Math.floor(x)), y0 = Math.min(N - 2, Math.floor(y)), z0 = Math.min(N - 2, Math.floor(z))
  const fx = x - x0, fy = y - y0, fz = z - z0
  const d = lut.data
  const at = (i: number, j: number, k: number, ch: number) => d[((k * N + j) * N + i) * 3 + ch]
  for (let ch = 0; ch < 3; ch++) {
    const c00 = at(x0, y0, z0, ch) * (1 - fx) + at(x0 + 1, y0, z0, ch) * fx
    const c10 = at(x0, y0 + 1, z0, ch) * (1 - fx) + at(x0 + 1, y0 + 1, z0, ch) * fx
    const c01 = at(x0, y0, z0 + 1, ch) * (1 - fx) + at(x0 + 1, y0, z0 + 1, ch) * fx
    const c11 = at(x0, y0 + 1, z0 + 1, ch) * (1 - fx) + at(x0 + 1, y0 + 1, z0 + 1, ch) * fx
    out[ch] = (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz
  }
  return out
}

/** A LUT made from a function (tests, the identity). */
export function makeCube(size: number, f: (r: number, g: number, b: number) => [number, number, number], title = ''): CubeLut {
  const data = new Float32Array(size ** 3 * 3)
  let k = 0
  for (let bi = 0; bi < size; bi++) for (let gi = 0; gi < size; gi++) for (let ri = 0; ri < size; ri++) {
    const o = f(ri / (size - 1), gi / (size - 1), bi / (size - 1))
    for (let j = 0; j < 3; j++) data[k++] = Math.min(1, Math.max(0, o[j]))
  }
  return { size, data, domainMin: [0, 0, 0], domainMax: [1, 1, 1], title }
}

// ---------------------------------------------------------------- chroma key (shared numbers with the shader)

/** BT.709 chroma (Cb, Cr) of an sRGB colour (0..1); the key works on the distance between chromas. */
export function chromaOf(r: number, g: number, b: number): [number, number] {
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return [(b - y) / 1.8556, (r - y) / 1.5748]
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  const v = m ? parseInt(m[1], 16) : 0x00b140
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}

export function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}
