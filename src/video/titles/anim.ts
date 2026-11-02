// Text animation model and evaluator (pure). A title element has an optional in phase and an optional out phase; each
// animates a unit (the whole block, each line, each word or each grapheme cluster) with one or more effects, a
// duration, a delay, a stagger between units and an easing curve. `evalTextAnim` turns (spec, local time, layout
// counts) into one state per unit, so the renderer draws without laying anything out per frame.
//
// Progress p runs 0 → 1 over a unit's in phase (p = 1 is the settled title, drawn exactly as a static one: opacity 1,
// no offset, scale 1, no blur, no clip). The out phase runs the same effects back, with its direction meaning the
// direction of travel ("slide up" in: rises into place; "slide up" out: rises away).

import { ease, type Easing } from './easing'

export type AnimUnit = 'all' | 'line' | 'word' | 'grapheme'
export type Direction = 'left' | 'right' | 'up' | 'down'
/** fade: opacity; appear: on/off (type-on); slide: offset; scale: from `fromScale`; blur: from `blurPx`; mask: a wipe. */
export type AnimEffect = 'fade' | 'appear' | 'slide' | 'scale' | 'blur' | 'mask'

export interface AnimPhase {
  effects: AnimEffect[]
  unit: AnimUnit
  /** Seconds each unit takes. */
  duration: number
  /** Seconds before the first unit starts (in) / after the out phase begins (out). */
  delay?: number
  /** Seconds between the starts of consecutive units. */
  stagger?: number
  easing?: Easing
  /** Slide travel and mask wipe direction. */
  direction?: Direction
  /** Slide distance in px. */
  distance?: number
  /** Scale effect starts here (in) / ends here (out). */
  fromScale?: number
  /** Blur effect radius at p = 0, px. */
  blurPx?: number
  order?: 'forward' | 'reverse' | 'center'
}

export interface TextAnimSpec {
  /** Seconds the element is on screen; the out phase ends exactly here. */
  duration: number
  in?: AnimPhase
  out?: AnimPhase
}

/** Clip as fractions of the unit's own box (0..1). */
export interface ClipRect { x0: number; y0: number; x1: number; y1: number }

export interface UnitState { opacity: number; dx: number; dy: number; scale: number; blur: number; clip: ClipRect | null }

export interface AnimCounts { line: number; word: number; grapheme: number }

/** Index maps from a fine unit to the coarser ones (from the layout). */
export interface AnimIndex {
  counts: AnimCounts
  /** For each grapheme: its word and line. For each word: its line. */
  graphemes: { wordIndex: number; lineIndex: number }[]
  words: { lineIndex: number }[]
}

export interface AnimFrame {
  /** The unit `states` are given for: the finer of the two phases' units. */
  unit: AnimUnit
  states: UnitState[]
  /** The block as a whole (background box), driven like a unit 'all' of each phase without stagger. */
  block: UnitState
  /** True when every state is the settled identity (the renderer may draw the static title). */
  settled: boolean
  /** Nothing visible at all. */
  hidden: boolean
}

export const IDENTITY: UnitState = Object.freeze({ opacity: 1, dx: 0, dy: 0, scale: 1, blur: 0, clip: null }) as UnitState

const RANK: Record<AnimUnit, number> = { all: 0, line: 1, word: 2, grapheme: 3 }

const countOf = (unit: AnimUnit, c: AnimCounts) => (unit === 'all' ? 1 : unit === 'line' ? c.line : unit === 'word' ? c.word : c.grapheme)

/** Stagger rank of unit i of n. */
function rankOf(i: number, n: number, order: AnimPhase['order']): number {
  if (order === 'reverse') return n - 1 - i
  if (order === 'center') return Math.abs(i - (n - 1) / 2)
  return i
}

/** Seconds from the phase's start to the end of its last unit. */
export function phaseLength(phase: AnimPhase, counts: AnimCounts): number {
  const n = countOf(phase.unit, counts)
  const maxRank = phase.order === 'center' ? (n - 1) / 2 : n - 1
  return (phase.delay ?? 0) + Math.max(0, maxRank) * (phase.stagger ?? 0) + phase.duration
}

const FLIP: Record<Direction, Direction> = { left: 'right', right: 'left', up: 'down', down: 'up' }

/** The state of one unit at in-progress p (0 hidden → 1 settled). */
export function stateAt(phase: AnimPhase, p: number, dir: Direction = phase.direction ?? 'up'): UnitState {
  if (p >= 1) return IDENTITY
  const s: UnitState = { opacity: 1, dx: 0, dy: 0, scale: 1, blur: 0, clip: null }
  for (const fx of phase.effects) {
    if (fx === 'fade') s.opacity *= p
    else if (fx === 'appear') s.opacity *= p > 0 ? 1 : 0
    else if (fx === 'slide') {
      const d = (phase.distance ?? 24) * (1 - p)
      // in: travels toward `dir` into place, so it starts on the opposite side
      if (dir === 'up') s.dy += d
      else if (dir === 'down') s.dy -= d
      else if (dir === 'left') s.dx += d
      else s.dx -= d
    } else if (fx === 'scale') s.scale *= (phase.fromScale ?? 0.85) + (1 - (phase.fromScale ?? 0.85)) * p
    else if (fx === 'blur') s.blur = Math.max(s.blur, (phase.blurPx ?? 12) * (1 - p))
    else if (fx === 'mask') {
      // a wipe travelling toward `dir`: what it has passed is shown
      const c: ClipRect = { x0: 0, y0: 0, x1: 1, y1: 1 }
      if (dir === 'right') c.x1 = p
      else if (dir === 'left') c.x0 = 1 - p
      else if (dir === 'down') c.y1 = p
      else c.y0 = 1 - p
      s.clip = c
    }
  }
  return s
}

function combine(a: UnitState, b: UnitState): UnitState {
  if (a === IDENTITY) return b
  if (b === IDENTITY) return a
  const clip = a.clip && b.clip
    ? { x0: Math.max(a.clip.x0, b.clip.x0), y0: Math.max(a.clip.y0, b.clip.y0), x1: Math.min(a.clip.x1, b.clip.x1), y1: Math.min(a.clip.y1, b.clip.y1) }
    : a.clip ?? b.clip
  return { opacity: a.opacity * b.opacity, dx: a.dx + b.dx, dy: a.dy + b.dy, scale: a.scale * b.scale, blur: Math.max(a.blur, b.blur), clip }
}

/** Progress of unit `i` (of `n`) of a phase that started at `t0`, eased. */
function unitProgress(phase: AnimPhase, i: number, n: number, t: number, t0: number): number {
  const start = t0 + (phase.delay ?? 0) + rankOf(i, n, phase.order) * (phase.stagger ?? 0)
  if (phase.duration <= 0) return t >= start ? 1 : 0
  return ease(phase.easing, (t - start) / phase.duration)
}

/** Map an index of the fine unit to the index of a coarser unit. */
function coarseIndex(fine: AnimUnit, coarse: AnimUnit, i: number, idx: AnimIndex): number {
  if (coarse === 'all' || fine === coarse) return coarse === 'all' ? 0 : i
  if (fine === 'grapheme') return coarse === 'word' ? idx.graphemes[i].wordIndex : idx.graphemes[i].lineIndex
  if (fine === 'word') return idx.words[i].lineIndex
  return i
}

function phaseState(phase: AnimPhase | undefined, kind: 'in' | 'out', fine: AnimUnit, i: number, t: number, t0: number, idx: AnimIndex): UnitState {
  if (!phase) return IDENTITY
  const unit = phase.unit
  const n = countOf(unit, idx.counts)
  const ci = coarseIndex(fine, unit, i, idx)
  const p = unitProgress(phase, ci, n, t, t0)
  if (kind === 'in') return stateAt(phase, p)
  // out: progress q of the exit = the in state at 1 - q, travelling the other way
  return p <= 0 ? IDENTITY : stateAt(phase, 1 - p, FLIP[phase.direction ?? 'up'])
}

/** Build the index maps from a layout (layout.ts `TitleLayout` satisfies this shape). */
export function animIndexOf(layout: { counts: AnimCounts; graphemes: { wordIndex: number; lineIndex: number }[]; words: { lineIndex: number }[] }): AnimIndex {
  return { counts: layout.counts, graphemes: layout.graphemes, words: layout.words }
}

/** Evaluate a title's animation at element-local time `tLocal` (seconds from the element's start). */
export function evalTextAnim(spec: TextAnimSpec, tLocal: number, layout: AnimIndex): AnimFrame {
  const fine: AnimUnit = [spec.in?.unit ?? 'all', spec.out?.unit ?? 'all'].reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'all' as AnimUnit)
  const n = countOf(fine, layout.counts)
  const outStart = spec.out ? spec.duration - phaseLength(spec.out, layout.counts) : Infinity
  const states: UnitState[] = []
  let settled = true
  let hidden = true
  for (let i = 0; i < n; i++) {
    let s = phaseState(spec.in, 'in', fine, i, tLocal, 0, layout)
    if (tLocal >= outStart) s = combine(s, phaseState(spec.out, 'out', fine, i, tLocal, outStart, layout))
    if (tLocal >= spec.duration && spec.out) s = { ...s, opacity: 0 }
    if (s !== IDENTITY) settled = false
    if (s.opacity > 0 && !(s.clip && (s.clip.x1 <= s.clip.x0 || s.clip.y1 <= s.clip.y0))) hidden = false
    states.push(s)
  }
  const blockIn = spec.in ? stateAt(spec.in, ease(spec.in.easing, spec.in.duration > 0 ? (tLocal - (spec.in.delay ?? 0)) / spec.in.duration : 1)) : IDENTITY
  let block = blockIn
  if (spec.out && tLocal >= outStart) {
    const len = phaseLength(spec.out, layout.counts)
    // the box leaves with the last unit: it is fully gone exactly when the element ends
    const q = ease(spec.out.easing, len > 0 ? (tLocal - outStart - (len - spec.out.duration)) / spec.out.duration : 1)
    if (q > 0) block = combine(block, stateAt(spec.out, 1 - q, FLIP[spec.out.direction ?? 'up']))
  }
  if (tLocal >= spec.duration && spec.out) block = { ...block, opacity: 0 }
  if (block !== IDENTITY) settled = false
  return { unit: fine, states, block, settled, hidden: hidden && block.opacity <= 0 }
}

// ------------------------------------------------------------------ presets (ESB's own; durations in seconds)

const ESB: Easing = 'esb'

/** Type-on: one grapheme cluster after another (Bangla conjuncts appear whole). `cps` = clusters per second. */
export const typeOn = (cps = 28, delay = 0): AnimPhase => ({ effects: ['appear'], unit: 'grapheme', duration: 0, stagger: 1 / cps, delay, easing: 'step' })
/** Word by word: each word rises a little and fades in. */
export const wordByWord = (stagger = 0.09, delay = 0): AnimPhase => ({ effects: ['fade', 'slide'], unit: 'word', duration: 0.42, stagger, delay, easing: ESB, direction: 'up', distance: 18 })
/** Line by line: each line rises and fades in. */
export const lineByLine = (stagger = 0.16, delay = 0): AnimPhase => ({ effects: ['fade', 'slide'], unit: 'line', duration: 0.5, stagger, delay, easing: ESB, direction: 'up', distance: 28 })
export const slide = (direction: Direction = 'right', distance = 60, duration = 0.5, delay = 0): AnimPhase => ({ effects: ['fade', 'slide'], unit: 'all', duration, delay, easing: ESB, direction, distance })
export const scaleIn = (fromScale = 0.86, duration = 0.45, delay = 0): AnimPhase => ({ effects: ['fade', 'scale'], unit: 'all', duration, delay, easing: ESB, fromScale })
export const fade = (duration = 0.35, delay = 0, unit: AnimUnit = 'all'): AnimPhase => ({ effects: ['fade'], unit, duration, delay, easing: 'easeInOut' })
/** Mask reveal: a wipe travelling toward `direction`, per line by default. */
export const maskReveal = (direction: Direction = 'right', duration = 0.6, delay = 0, unit: AnimUnit = 'line', stagger = 0.12): AnimPhase => ({ effects: ['mask'], unit, duration, delay, stagger, easing: ESB, direction })
export const blurIn = (blurPx = 14, duration = 0.6, delay = 0, unit: AnimUnit = 'all'): AnimPhase => ({ effects: ['fade', 'blur'], unit, duration, delay, easing: ESB, blurPx })
