import { useCallback, useMemo, useSyncExternalStore } from 'react'

/**
 * Side columns that fold to an icon rail — one implementation for every desk.
 *
 * A column is `{ w, collapsed }`: `w` is the last width the editor dragged it to (kept while it is a rail, so expanding
 * returns there), `collapsed` shows the rail instead. Dragging the inner edge below `collapseAt` snaps to the rail;
 * dragging the rail's edge outward past it opens the column again at its last width. Saved per desk per side in
 * localStorage `esb-banner-studio/side-col/<id>`.
 */
export const RAIL_W = 52

export interface ColSpec { def: number; min: number; max: number }
export interface ColState { w: number; collapsed: boolean }

/** Below this raw drag width the column becomes a rail: ~200 px, and always somewhat below the column's own minimum. */
export function collapseAt(spec: ColSpec): number {
  return Math.max(RAIL_W + 64, Math.min(200, spec.min - 48))
}

export const clampW = (v: number, spec: ColSpec) => Math.round(Math.min(spec.max, Math.max(spec.min, v)))

/**
 * Where a drag lands. `raw` = the width the pointer asks for (start width ± distance moved); `last` = the width to
 * return to when a rail is pulled open. Opening from a rail never lands narrower than that last width.
 */
export function resolveDrag(raw: number, spec: ColSpec, last: number, fromCollapsed: boolean): ColState {
  if (raw < collapseAt(spec)) return { w: clampW(last, spec), collapsed: true }
  return { w: clampW(fromCollapsed ? Math.max(raw, last) : raw, spec), collapsed: false }
}

/** Arrow-key step: outward grows (or opens a rail), inward shrinks and — from the minimum — folds to the rail. */
export function resolveKey(cur: ColState, dir: 1 | -1, step: number, spec: ColSpec): ColState {
  if (cur.collapsed) return dir > 0 ? { w: clampW(cur.w, spec), collapsed: false } : cur
  if (dir < 0 && cur.w <= spec.min) return { w: cur.w, collapsed: true }
  return { w: clampW(cur.w + dir * step, spec), collapsed: false }
}

/** Read a saved state (or an older desk's saved width) defensively. */
export function parseState(raw: string | null, spec: ColSpec, legacyW?: number): ColState {
  try {
    const v = raw ? JSON.parse(raw) as Partial<ColState> : null
    if (v && typeof v.w === 'number' && Number.isFinite(v.w)) return { w: clampW(v.w, spec), collapsed: v.collapsed === true }
  } catch { /* fall through */ }
  return { w: typeof legacyW === 'number' && Number.isFinite(legacyW) ? clampW(legacyW, spec) : spec.def, collapsed: false }
}

const storageKey = (id: string) => 'esb-banner-studio/side-col/' + id

// ---------------------------------------------------------------- a tiny store, so two components of one desk share a column
const states = new Map<string, ColState>()
const listeners = new Map<string, Set<() => void>>()
/** Columns the editor has sized or folded (saved, or an older saved width) — the rest may keep a desk's responsive default. */
const touched = new Set<string>()

function getState(id: string, spec: ColSpec, legacyW?: () => number | undefined): ColState {
  let s = states.get(id)
  if (!s) {
    let raw: string | null = null
    try { raw = localStorage.getItem(storageKey(id)) } catch { /* private window, blocked storage */ }
    let legacy: number | undefined
    if (!raw && legacyW) { try { legacy = legacyW() } catch { /* ignore */ } }
    if (raw || typeof legacy === 'number') touched.add(id)
    s = parseState(raw, spec, legacy)
    states.set(id, s)
  }
  return s
}

export function setColumnState(id: string, next: ColState, persist = true) {
  const cur = states.get(id)
  const same = !!cur && cur.w === next.w && cur.collapsed === next.collapsed
  // a drag that flipped the rail live (unsaved) and ends there still has to be saved
  if (persist) { try { localStorage.setItem(storageKey(id), JSON.stringify(next)) } catch { /* ignore */ } }
  const wasTouched = touched.has(id)
  if (persist) touched.add(id)
  if (same && (wasTouched || !persist)) return
  states.set(id, { ...next })
  listeners.get(id)?.forEach((f) => f())
}

/** Test hook: forget the in-memory copies (localStorage is left alone). */
export function _resetColumnStore() { states.clear(); touched.clear() }

export interface SideColumn extends ColState {
  id: string
  spec: ColSpec
  side: 'left' | 'right'
  /** The width the grid should give the column right now. */
  px: number
  /** False until the editor sizes or folds it: a desk may keep its own responsive width until then. */
  touched: boolean
  /** Only News folds its columns to an icon rail; every other desk's columns just resize. */
  foldable: boolean
  set: (s: ColState) => void
  expand: () => void
  collapse: () => void
  toggle: () => void
}

/**
 * One side column's width and rail state. `legacyW` reads a width an older version of the desk saved, used once
 * when this column has no saved state yet.
 */
export function useSideColumn(id: string, side: 'left' | 'right', spec: ColSpec, legacyW?: () => number | undefined, opts?: { foldable?: boolean }): SideColumn {
  const foldable = opts?.foldable !== false
  const sub = useCallback((f: () => void) => {
    let set = listeners.get(id)
    if (!set) { set = new Set(); listeners.set(id, set) }
    set.add(f)
    return () => { set.delete(f) }
  }, [id])
  const saved = useSyncExternalStore(sub, () => getState(id, spec, legacyW))
  // a desk that does not fold ignores a rail state saved by an older version
  const st = foldable || !saved.collapsed ? saved : { w: saved.w, collapsed: false }
  const { def, min, max } = spec
  return useMemo(() => {
    const sp = { def, min, max }
    const set = (s: ColState) => setColumnState(id, s)
    return {
      ...st, id, side, spec: sp,
      px: st.collapsed ? RAIL_W : st.w,
      touched: touched.has(id),
      foldable,
      set: (s: ColState) => set(foldable ? s : { w: s.w, collapsed: false }),
      expand: () => set({ w: st.w, collapsed: false }),
      collapse: () => { if (foldable) set({ w: st.w, collapsed: true }) },
      toggle: () => { if (foldable) set({ w: st.w, collapsed: !st.collapsed }) },
    }
  }, [st, id, side, def, min, max, foldable])
}
