import { create } from 'zustand'
import { slotAdjust as slotAdjustOf } from './core/photoEdit'
import { getCollage } from './core/collage'
import { buildScene, defaultDoc, perFormat } from './core/templates'
import { loadImage } from './core/assets'
import type { Align, Backdrop, Content, Doc, El, FormatId, GuideLine, Override, PhotoAdjust, PhotoSlot, Scene } from './core/types'
import { FORMATS, FORMAT_IDS, INK } from './core/tokens'

/** Large background / decoration layers. A plain click on them counts as "empty canvas" (deselects, starts a marquee) so the selection never
 *  sticks; pick them from the Layers panel, with Alt+click, or by double-clicking. Once selected they move like anything else. */
const BACKDROP_IDS = new Set(['header-bg', 'footer-bg', 'band', 'panel'])
export const isBackdrop = (e: { id: string; kind: string }): boolean => BACKDROP_IDS.has(e.id) || e.kind === 'watermark'

export interface ImageItem { id: string; name: string; url: string; w: number; h: number }

/** Decoded photos by image id (kept outside the store: not serialisable, never copied into history). */
export const imageAssets: Record<string, HTMLImageElement> = {}

const STORAGE_KEY = 'esb-banner-studio/doc/v1'
const HISTORY_LIMIT = 150
const emptySlot = (): PhotoSlot => ({ src: null, zoom: 1, panX: 0, panY: 0 })

const clone = <T,>(v: T): T => structuredClone(v)

/** Default collage for N photos when the user drops more photos than the current layout holds. */
const COLLAGE_FOR_COUNT: Record<number, string> = { 1: 'single', 2: 'two-cols', 3: 'big-left-2', 4: 'grid-2x2' }

function fitSlots(doc: Doc, collageId: string) {
  const n = getCollage(collageId).count
  for (const f of FORMAT_IDS) {
    const cur = doc.photos.slots[f]
    while (cur.length < n) cur.push(emptySlot())
    cur.length = n
  }
}

interface State {
  doc: Doc
  format: FormatId
  /** primary selection (last clicked) and the full selection */
  selectedId: string | null
  selectedIds: string[]
  selectedSlot: number
  tool: 'select' | 'hand'
  theme: 'dark' | 'light'
  rulers: boolean
  /** dot grid behind the artboard (View → Canvas grid); remembered across launches */
  canvasGrid: boolean
  cropGuides: boolean
  showDimensions: boolean
  zoom: 'fit' | number
  scale: number
  images: ImageItem[]
  past: Doc[]
  future: Doc[]
  lastKey: string
  lastAt: number
  snap: boolean
  notice: string | null
  /** layer clipboard (copy / cut / paste) */
  clip: El[] | null
  clipCount: number
  projectName: string | null
  projectPath: string | null
  dirty: boolean

  setFormat: (f: FormatId) => void
  select: (id: string | null) => void
  toggleSelect: (id: string) => void
  selectMany: (ids: string[]) => void
  selectSlot: (i: number) => void
  setTool: (t: 'select' | 'hand') => void
  setTheme: (t: 'dark' | 'light') => void
  setRulers: (v: boolean) => void
  setCanvasGrid: (v: boolean) => void
  setCropGuides: (v: boolean) => void
  setShowDimensions: (v: boolean) => void
  setZoom: (z: 'fit' | number) => void
  setScale: (s: number) => void
  setSnap: (v: boolean) => void
  setNotice: (m: string | null) => void

  /** Record an undo point. Calls with the same key within 700 ms are merged (typing, sliders). */
  record: (key?: string) => void
  undo: () => void
  redo: () => void

  setContent: (patch: Partial<Content>) => void
  setOverride: (id: string, patch: Partial<Override>, opts?: { silent?: boolean }) => void
  /** Show or hide several layers as one undo step (the Elements panel). */
  setVisible: (ids: string[], visible: boolean) => void
  clearOverrideFields: (id: string, fields: (keyof Override)[]) => void
  resetOverride: (id: string) => void
  resetAllOverrides: () => void
  /** Move/resize an element so its box lands exactly on `target` (works out dx/dy from the live layout). */
  placeElement: (id: string, target: { x?: number; y?: number; w?: number; h?: number }, silent?: boolean) => void
  /** Move several elements at once (one layout pass). Targets are absolute x/y. */
  moveElements: (targets: { id: string; x?: number; y?: number }[], silent?: boolean) => void
  scene: (format?: FormatId) => Scene

  setCollage: (id: string) => void
  setGap: (g: number) => void
  setGapColor: (c: string) => void
  setBackdrop: (b: Backdrop) => void
  setSlot: (i: number, patch: Partial<PhotoSlot>, silent?: boolean) => void
  /** photo editor: change slot i's edit in every format (an edit belongs to the photo); null clears it */
  setSlotAdjust: (i: number, patch: Partial<PhotoAdjust> | null, opts?: { replace?: boolean; silent?: boolean }) => void
  /** photo editor: hold to see the photos without their edits (view only) */
  photoOriginal: boolean
  setPhotoOriginal: (on: boolean) => void
  syncSlotFraming: (slot: number) => void
  assignImage: (slot: number, imageId: string | null) => void
  swapSlots: (a: number, b: number) => void
  addImages: (files: File[]) => Promise<void>
  removeImage: (id: string) => void
  newBanner: (keepStyle?: boolean) => void

  // layers
  addText: () => void
  addRect: () => void
  addImageLayer: (imageId: string) => void
  duplicateSelected: () => void
  copySelected: () => boolean
  cutSelected: () => void
  pasteClip: (inPlace?: boolean) => void
  selectAll: () => void
  /** replace the whole document (open project / new) */
  loadDoc: (doc: Doc, meta?: { name: string | null; path: string | null }) => void
  markSaved: (name: string | null, path: string | null) => void
  deleteSelected: () => void
  moveLayer: (id: string, how: 'front' | 'back' | 'up' | 'down') => void
  reorderLayer: (id: string, beforeId: string | null) => void
  alignSelected: (mode: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') => void
  distributeSelected: (axis: 'x' | 'y') => void
  setAlignText: (id: string, align: Align) => void

  // guides
  addGuide: (axis: 'x' | 'y', at: number) => string
  moveGuide: (id: string, at: number, silent?: boolean) => void
  removeGuide: (id: string) => void
  clearGuides: () => void
}

/** Make any saved/imported document complete for every format (older saves only knew social + web). */
export function normalizeDoc(raw: Doc, keepPhotos: boolean): Doc {
  const d = raw
  d.content = { ...defaultDoc().content, ...d.content }
  d.overrides ??= {}
  d.photos.backdrop ??= 'blur'
  d.photos.slots = { ...perFormat(() => [] as PhotoSlot[]), ...d.photos.slots }
  d.extras = { ...perFormat(() => [] as El[]), ...(d.extras ?? {}) }
  d.order = { ...perFormat(() => [] as string[]), ...(d.order ?? {}) }
  d.guides = { ...perFormat(() => [] as GuideLine[]), ...(d.guides ?? {}) }
  for (const f of FORMAT_IDS) {
    if (!keepPhotos) {
      d.photos.slots[f] = d.photos.slots[f].map((sl) => ({ ...sl, src: null }))
      d.extras[f] = d.extras[f].filter((e) => e.kind !== 'image')
    }
  }
  fitSlots(d, d.photos.collage)
  return d
}

export function loadSaved(): Doc | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as Doc
    if (!d?.content || !d.photos) return null
    return normalizeDoc(d, false) // photos are not autosaved, so slots and photo layers come back empty
  } catch {
    return null
  }
}

// One scene per (document, format): every panel asks for it, so build it once per change.
const sceneCache = new Map<FormatId, { doc: Doc; scene: Scene }>()
function getScene(format: FormatId, doc: Doc): Scene {
  const hit = sceneCache.get(format)
  if (hit && hit.doc === doc) return hit.scene
  const scene = buildScene(format, doc)
  sceneCache.set(format, { doc, scene })
  return scene
}

let hintText: string | null = null
const hintSubs = new Set<() => void>()
/** Contextual hint shown in the status bar while dragging (modifier-key help). */
export const hint = {
  get: () => hintText,
  set: (t: string | null) => { if (t !== hintText) { hintText = t; hintSubs.forEach((f) => f()) } },
  subscribe: (cb: () => void) => { hintSubs.add(cb); return () => { hintSubs.delete(cb) } },
}

/** Live pointer position for the status bar: kept outside the store so mouse moves never re-render the app. */
let ptr: { x: number; y: number } | null = null
const ptrSubs = new Set<() => void>()
export const pointer = {
  get: () => ptr,
  set: (p: { x: number; y: number } | null) => { ptr = p; ptrSubs.forEach((f) => f()) },
  subscribe: (cb: () => void) => { ptrSubs.add(cb); return () => { ptrSubs.delete(cb) } },
}

function initialDoc(): Doc {
  // Always start clean and fresh on application launch
  const d = defaultDoc()
  fitSlots(d, d.photos.collage)
  return d
}

export const useStore = create<State>((set, get) => {
  const pruneSelection = () => {
    const ids = get().selectedIds
    if (!ids.length) return
    const have = new Set(get().scene().elements.map((e) => e.id))
    const keep = ids.filter((i) => have.has(i))
    if (keep.length !== ids.length) set({ selectedIds: keep, selectedId: keep[keep.length - 1] ?? null })
  }

  const edit = (fn: (d: Doc) => void, key?: string) => {
    get().record(key)
    const d = clone(get().doc)
    fn(d)
    set({ doc: d })
  }

  return {
    doc: initialDoc(),
    format: 'fb45',
    selectedId: null,
    selectedIds: [],
    selectedSlot: 0,
    tool: 'select',
    theme: (() => {
      const t = (() => { try { return localStorage.getItem('esb-banner-studio/theme') === 'dark' ? 'dark' : 'light' } catch { return 'light' } })()
      if (typeof document !== 'undefined') document.documentElement.dataset.theme = t
      return t
    })(),
    rulers: false,
    canvasGrid: (() => { try { return localStorage.getItem('esb-banner-studio/canvas-grid') !== 'off' } catch { return true } })(),
    cropGuides: false,
    showDimensions: false,
    zoom: 'fit',
    scale: 0.5,
    images: [],
    past: [],
    future: [],
    lastKey: '',
    lastAt: 0,
    snap: true,
    notice: null,
    clip: null,
    clipCount: 0,
    projectName: null,
    projectPath: null,
    dirty: false,

    setFormat: (format) => set({ format, selectedId: null, selectedIds: [] }),
    select: (id) => set({ selectedId: id, selectedIds: id ? [id] : [] }),
    toggleSelect: (id) => {
      const cur = get().selectedIds
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
      set({ selectedIds: next, selectedId: next[next.length - 1] ?? null })
    },
    selectMany: (ids) => set({ selectedIds: ids, selectedId: ids[ids.length - 1] ?? null }),
    setTool: (tool) => set({ tool }),
    setTheme: (theme) => {
      try { localStorage.setItem('esb-banner-studio/theme', theme) } catch { /* ignore */ }
      if (typeof document !== 'undefined') {
        const root = document.documentElement
        root.classList.add('theme-switching')
        root.dataset.theme = theme
        void root.offsetHeight
        requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')))
      }
      set({ theme })
    },
    setRulers: (rulers) => set({ rulers }),
    setCanvasGrid: (canvasGrid) => {
      try { localStorage.setItem('esb-banner-studio/canvas-grid', canvasGrid ? 'on' : 'off') } catch { /* ignore */ }
      set({ canvasGrid })
    },
    setCropGuides: (cropGuides) => set({ cropGuides }),
    setShowDimensions: (showDimensions) => set({ showDimensions }),
    setZoom: (zoom) => set({ zoom }),
    setScale: (scale) => { if (Math.abs(scale - get().scale) > 1e-4) set({ scale }) },
    selectSlot: (selectedSlot) => set({ selectedSlot }),
    setSnap: (snap) => set({ snap }),
    setNotice: (notice) => set({ notice }),

    record: (key = '') => {
      const { lastKey, lastAt, past, doc } = get()
      const now = Date.now()
      if (key && key === lastKey && now - lastAt < 700) { set({ lastAt: now }); return }
      set({ past: [...past.slice(-(HISTORY_LIMIT - 1)), clone(doc)], future: [], lastKey: key, lastAt: now })
    },
    undo: () => {
      const { past, future, doc } = get()
      if (!past.length) return
      set({ doc: past[past.length - 1], past: past.slice(0, -1), future: [...future, clone(doc)], lastKey: '' })
      pruneSelection()
    },
    redo: () => {
      const { past, future, doc } = get()
      if (!future.length) return
      set({ doc: future[future.length - 1], future: future.slice(0, -1), past: [...past, clone(doc)], lastKey: '' })
      pruneSelection()
    },

    setContent: (patch) => edit((d) => { Object.assign(d.content, patch) }, 'content:' + Object.keys(patch).join(',')),

    setOverride: (id, patch, opts) => {
      const apply = (d: Doc) => {
        const k = `${get().format}:${id}`
        const o: Record<string, unknown> = { ...(d.overrides[k] ?? {}) }
        for (const [f, v] of Object.entries(patch)) { if (v === undefined) delete o[f]; else o[f] = v }
        if (Object.keys(o).length) d.overrides[k] = o as Override
        else delete d.overrides[k]
      }
      if (opts?.silent) { const d = clone(get().doc); apply(d); set({ doc: d }) }
      else edit(apply, `ov:${id}:${Object.keys(patch).join(',')}`)
    },
    setVisible: (ids, visible) => edit((d) => {
      const f = get().format
      for (const id of ids) {
        const k = `${f}:${id}`
        d.overrides[k] = { ...(d.overrides[k] ?? {}), visible }
      }
    }, 'vis:' + ids.join()),
    clearOverrideFields: (id, fields) => get().setOverride(id, Object.fromEntries(fields.map((f) => [f, undefined])) as Partial<Override>),
    resetOverride: (id) => edit((d) => { delete d.overrides[`${get().format}:${id}`] }),
    resetAllOverrides: () => edit((d) => {
      const prefix = get().format + ':'
      for (const k of Object.keys(d.overrides)) if (k.startsWith(prefix)) delete d.overrides[k]
    }),

    scene: (format) => getScene(format ?? get().format, get().doc),

    moveElements: (targets, silent) => {
      const { format, doc } = get()
      const els = getScene(format, doc).elements
      if (!silent) get().record('move' + targets.map((t) => t.id).join())
      const d = clone(get().doc)
      for (const t of targets) {
        const el = els.find((e) => e.id === t.id)
        if (!el) continue
        const k = `${format}:${t.id}`
        const o: Override = { ...(d.overrides[k] ?? {}) }
        if (t.x != null) o.dx = t.x - (el.x - (doc.overrides[k]?.dx ?? 0))
        if (t.y != null) o.dy = t.y - (el.y - (doc.overrides[k]?.dy ?? 0))
        d.overrides[k] = o
      }
      set({ doc: d })
    },

    placeElement: (id, target, silent) => {
      const { format, doc } = get()
      const el = getScene(format, doc).elements.find((e) => e.id === id)
      if (!el) return
      const o = doc.overrides[`${format}:${id}`] ?? {}
      const patch: Partial<Override> = {}
      if (target.w != null) patch.w = Math.max(4, target.w)
      if (target.h != null && el.kind !== 'text' && el.kind !== 'icon') patch.h = Math.max(4, target.h)
      // layout changes with w/h (text re-wraps, icons keep ratio) so measure again before fixing the position
      let cur: El = el
      if (Object.keys(patch).length) {
        const d2 = clone(doc)
        d2.overrides[`${format}:${id}`] = { ...o, ...patch }
        cur = buildScene(format, d2).elements.find((e) => e.id === id)!
      }
      const baseX = cur.x - (o.dx ?? 0)
      const baseY = cur.y - (o.dy ?? 0)
      if (target.x != null) patch.dx = target.x - baseX
      if (target.y != null) patch.dy = target.y - baseY
      get().setOverride(id, patch, { silent })
    },

    setCollage: (id) => edit((d) => { d.photos.collage = id; fitSlots(d, id) }),
    setGap: (g) => edit((d) => { d.photos.gap = g }, 'gap'),
    setGapColor: (c) => edit((d) => { d.photos.gapColor = c }, 'gapColor'),
    setBackdrop: (b) => edit((d) => { d.photos.backdrop = b }),
    photoOriginal: false,
    setPhotoOriginal: (on) => set({ photoOriginal: on }),
    setSlotAdjust: (i, patch, opts) => {
      const apply = (d: Doc) => {
        for (const f of FORMAT_IDS) {
          const s = d.photos.slots[f][i]
          if (!s) continue
          // the older per-slot fields fold into the edit the first time it changes, so nothing is counted twice
          const base: PhotoAdjust = opts?.replace || patch === null ? {} : { ...slotAdjustOf(s) }
          delete s.brightness; delete s.contrast; delete s.saturation; delete s.warmth; delete s.vignette
          const next: PhotoAdjust = patch === null ? {} : { ...base, ...patch }
          for (const k of Object.keys(next) as (keyof PhotoAdjust)[]) if (next[k] === 0 || next[k] === false || next[k] === undefined) delete next[k]
          if (Object.keys(next).length) s.adjust = next; else delete s.adjust
        }
      }
      if (opts?.silent) { const d = clone(get().doc); apply(d); set({ doc: d }) } else edit(apply, `adjust:${i}`)
    },
    setSlot: (i, patch, silent) => {
      const apply = (d: Doc) => {
        const f = get().format
        const s = d.photos.slots[f][i]
        if (!s) return
        const { src, ...view } = patch
        Object.assign(s, view)
        if (src !== undefined) for (const ff of FORMAT_IDS) { const t = d.photos.slots[ff][i]; if (t) t.src = src }
      }
      if (silent) { const d = clone(get().doc); apply(d); set({ doc: d }) } else edit(apply, `slot:${i}`)
    },
    syncSlotFraming: (slot) => {
      const cur = get().doc.photos.slots[get().format][slot]
      if (!cur) return
      edit((d) => {
        for (const f of FORMAT_IDS) {
          const target = d.photos.slots[f][slot]
          if (target) { target.zoom = cur.zoom; target.panX = cur.panX; target.panY = cur.panY }
        }
      }, `sync-slot:${slot}`)
      set({ notice: 'Applied photo framing to all 5 formats.' })
    },
    assignImage: (slot, imageId) => edit((d) => {
      for (const f of FORMAT_IDS) {
        const s = d.photos.slots[f][slot]
        if (!s) continue
        s.src = imageId
        s.zoom = 1; s.panX = 0; s.panY = 0
      }
    }),
    swapSlots: (a, b) => edit((d) => {
      for (const f of FORMAT_IDS) {
        const arr = d.photos.slots[f]
        if (!arr[a] || !arr[b]) continue
        ;[arr[a], arr[b]] = [arr[b], arr[a]]
      }
    }),

    addImages: async (files) => {
      const added: ImageItem[] = []
      for (const file of files) {
        if (!file.type.startsWith('image/')) continue
        const url = URL.createObjectURL(file)
        try {
          const img = await loadImage(url)
          const id = 'img-' + Math.random().toString(36).slice(2, 9)
          imageAssets[id] = img
          added.push({ id, name: file.name, url, w: img.naturalWidth, h: img.naturalHeight })
        } catch {
          URL.revokeObjectURL(url)
        }
      }
      if (!added.length) { set({ notice: 'No readable image files were found.' }); return }
      get().record()
      const d = clone(get().doc)
      const filled = () => d.photos.slots.social.filter((s) => s.src).length
      const total = filled() + added.length
      if (total > getCollage(d.photos.collage).count) {
        const pick = COLLAGE_FOR_COUNT[Math.min(total, 4)]
        if (pick && getCollage(pick).count > getCollage(d.photos.collage).count) { d.photos.collage = pick; fitSlots(d, pick) }
      }
      const n = d.photos.slots.social.length
      for (const item of added) {
        const idx = d.photos.slots.social.findIndex((s) => !s.src)
        if (idx < 0) break
        for (const f of FORMAT_IDS) d.photos.slots[f][idx] = { src: item.id, zoom: 1, panX: 0, panY: 0 }
      }
      window.dispatchEvent(new CustomEvent('esb:open-panel', { detail: 'Photo library' })) // a collapsed library would hide what was just added
      set({ doc: d, images: [...get().images, ...added], notice: added.length > n ? `${added.length} photos added; the layout shows the first ${n}.` : null })
    },
    removeImage: (id) => {
      get().record()
      const d = clone(get().doc)
      for (const f of FORMAT_IDS) for (const s of d.photos.slots[f]) if (s.src === id) s.src = null
      const item = get().images.find((i) => i.id === id)
      if (item) URL.revokeObjectURL(item.url)
      delete imageAssets[id]
      set({ doc: d, images: get().images.filter((i) => i.id !== id) })
    },

    newBanner: (keepStyle) => {
      get().record()
      const today = defaultDoc().content.date
      let d: Doc
      if (keepStyle) {
        // next story, same look: keep every move / style / layer / guide, clear only the story and the photos
        d = clone(get().doc)
        d.content = { ...d.content, headline: '', highlight: '', credit: '', caption: null, date: today }
        for (const f of FORMAT_IDS) d.photos.slots[f] = d.photos.slots[f].map(() => emptySlot())
        d.extras = Object.fromEntries(FORMAT_IDS.map((f) => [f, d.extras[f].filter((e) => e.kind !== 'image')])) as Doc['extras']
      } else {
        d = defaultDoc()
        d.content.categoryId = get().doc.content.categoryId
        d.content.headline = ''
        d.photos.collage = 'single'
        fitSlots(d, 'single')
      }
      skipDirty = true
      set({ doc: d, selectedId: null, selectedIds: [], selectedSlot: 0, projectName: null, projectPath: null, dirty: false })
      try { localStorage.removeItem('esb-banner-studio/autosave-snapshot') } catch { /* ignore */ }
    },

    // ---------------------------------------------------------------- layers
    addText: () => {
      const { format } = get()
      const id = 'x-' + Math.random().toString(36).slice(2, 8)
      const { w, h } = FORMATS[format]
      const el: El = {
        kind: 'text', id, name: 'Text', group: 'Custom', x: w / 2 - 120, y: h / 2 - 30, w: 0, h: 0, visible: true, locked: false, opacity: 1,
        text: 'New text', weight: 700, size: 64, ls: 0, lh: null, align: 'left', color: INK, runs: [], fit: 'hug',
      }
      edit((d) => { d.extras[format].push(el) })
      get().select(id)
    },
    addRect: () => {
      const { format } = get()
      const id = 'x-' + Math.random().toString(36).slice(2, 8)
      const { w, h } = FORMATS[format]
      const el: El = { kind: 'rect', id, name: 'Rectangle', group: 'Custom', x: w / 2 - 200, y: h / 2 - 100, w: 400, h: 200, visible: true, locked: false, opacity: 1, fill: '#e52d2d', radius: 16 }
      edit((d) => { d.extras[format].push(el) })
      get().select(id)
    },
    addImageLayer: (imageId) => {
      const { format, images } = get()
      const im = images.find((i) => i.id === imageId)
      if (!im) return
      const id = 'x-' + Math.random().toString(36).slice(2, 8)
      const { w, h } = FORMATS[format]
      const bw = Math.min(520, w * 0.4)
      const bh = (bw * im.h) / im.w
      const el: El = { kind: 'image', id, name: im.name, group: 'Custom', x: w / 2 - bw / 2, y: h / 2 - bh / 2, w: bw, h: bh, visible: true, locked: false, opacity: 1, src: imageId, fit: 'cover' }
      edit((d) => { d.extras[format].push(el) })
      get().select(id)
    },
    duplicateSelected: () => {
      const { format, selectedIds } = get()
      const scene = get().scene()
      const made: string[] = []
      get().record()
      const d = clone(get().doc)
      const order = scene.elements.map((e) => e.id)
      for (const sid of selectedIds) {
        const src = scene.elements.find((e) => e.id === sid)
        if (!src || src.kind === 'photos') continue
        const copy = clone(src) as El
        copy.id = 'x-' + Math.random().toString(36).slice(2, 8)
        copy.name = src.name + ' copy'
        copy.group = 'Custom'
        copy.locked = false
        copy.visible = true
        copy.x += 24
        copy.y += 24
        d.extras[format].push(copy)
        order.splice(order.indexOf(sid) + 1, 0, copy.id)
        made.push(copy.id)
      }
      if (!made.length) return
      d.order[format] = order
      set({ doc: d, selectedIds: made, selectedId: made[made.length - 1] })
    },
    deleteSelected: () => {
      const { format, selectedIds } = get()
      if (!selectedIds.length) return
      get().record()
      const d = clone(get().doc)
      for (const id of selectedIds) {
        if (id.startsWith('x-')) {
          d.extras[format] = d.extras[format].filter((e) => e.id !== id)
          d.order[format] = d.order[format].filter((x) => x !== id)
          delete d.overrides[`${format}:${id}`]
        } else {
          const k = `${format}:${id}`
          d.overrides[k] = { ...(d.overrides[k] ?? {}), visible: false }
        }
      }
      const keep = selectedIds.filter((i) => !i.startsWith('x-'))
      set({ doc: d, selectedIds: keep, selectedId: keep[keep.length - 1] ?? null })
    },
    moveLayer: (id, how) => {
      const { format } = get()
      const ids = get().scene().elements.map((e) => e.id)
      const i = ids.indexOf(id)
      if (i < 0) return
      ids.splice(i, 1)
      const to = how === 'front' ? ids.length : how === 'back' ? 0 : how === 'up' ? Math.min(ids.length, i + 1) : Math.max(0, i - 1)
      ids.splice(to, 0, id)
      edit((d) => { d.order[format] = ids })
    },
    reorderLayer: (id, beforeId) => {
      const { format } = get()
      const ids = get().scene().elements.map((e) => e.id).filter((x) => x !== id)
      const at = beforeId ? ids.indexOf(beforeId) : ids.length
      ids.splice(at < 0 ? ids.length : at, 0, id)
      edit((d) => { d.order[format] = ids })
    },
    alignSelected: (mode) => {
      const { format, selectedIds } = get()
      const els = get().scene().elements.filter((e) => selectedIds.includes(e.id) && !e.locked)
      if (!els.length) return
      const f = FORMATS[format]
      const multi = els.length > 1
      const x0 = multi ? Math.min(...els.map((e) => e.x)) : 0
      const x1 = multi ? Math.max(...els.map((e) => e.x + e.w)) : f.w
      const y0 = multi ? Math.min(...els.map((e) => e.y)) : 0
      const y1 = multi ? Math.max(...els.map((e) => e.y + e.h)) : f.h
      get().record('align' + Date.now())
      get().moveElements(els.map((e) => {
        const t: { id: string; x?: number; y?: number } = { id: e.id }
        if (mode === 'left') t.x = x0
        if (mode === 'hcenter') t.x = (x0 + x1) / 2 - e.w / 2
        if (mode === 'right') t.x = x1 - e.w
        if (mode === 'top') t.y = y0
        if (mode === 'vcenter') t.y = (y0 + y1) / 2 - e.h / 2
        if (mode === 'bottom') t.y = y1 - e.h
        return t
      }), true)
    },
    distributeSelected: (axis) => {
      const { selectedIds } = get()
      const els = get().scene().elements.filter((e) => selectedIds.includes(e.id) && !e.locked)
      if (els.length < 3) return
      const key = axis === 'x' ? 'x' : 'y'
      const size = axis === 'x' ? 'w' : 'h'
      const sorted = [...els].sort((a, b) => a[key] - b[key])
      const first = sorted[0]
      const last = sorted[sorted.length - 1]
      const total = last[key] + last[size] - first[key]
      const gap = (total - sorted.reduce((a, e) => a + e[size], 0)) / (sorted.length - 1)
      get().record('dist' + Date.now())
      let cur = first[key] + first[size] + gap
      const targets: { id: string; x?: number; y?: number }[] = []
      for (const e of sorted.slice(1, -1)) { targets.push({ id: e.id, [key]: cur }); cur += e[size] + gap }
      get().moveElements(targets, true)
    },
    copySelected: () => {
      const { selectedIds } = get()
      const els = get().scene().elements.filter((e) => selectedIds.includes(e.id) && e.kind !== 'photos').map((e) => clone(e) as El)
      if (!els.length) return false
      set({ clip: els, clipCount: 0 })
      return true
    },
    cutSelected: () => { if (get().copySelected()) get().deleteSelected() },
    pasteClip: (inPlace) => {
      const { clip, format, clipCount } = get()
      if (!clip?.length) return
      const { w: W, h: H } = FORMATS[format]
      const step = inPlace ? 0 : 24 * (clipCount + 1)
      get().record()
      const d = clone(get().doc)
      const made: string[] = []
      for (const src of clip) {
        const copy = clone(src) as El
        copy.id = 'x-' + Math.random().toString(36).slice(2, 8)
        copy.group = 'Custom'
        copy.locked = false
        copy.visible = true
        copy.x = Math.min(Math.max(0, src.x + step), Math.max(0, W - Math.min(src.w, W)))
        copy.y = Math.min(Math.max(0, src.y + step), Math.max(0, H - Math.min(src.h, H)))
        d.extras[format].push(copy)
        made.push(copy.id)
      }
      set({ doc: d, selectedIds: made, selectedId: made[made.length - 1], clipCount: clipCount + 1 })
    },
    selectAll: () => get().selectMany(get().scene().elements.filter((x) => x.visible && !x.locked && x.kind !== 'photos' && !isBackdrop(x)).map((x) => x.id)),
    loadDoc: (doc, meta) => {
      get().record()
      skipDirty = true
      set({ doc, selectedId: null, selectedIds: [], selectedSlot: 0, projectName: meta?.name ?? null, projectPath: meta?.path ?? null, dirty: false })
    },
    markSaved: (name, path) => {
      skipDirty = true
      set({ projectName: name, projectPath: path, dirty: false })
      try {
        localStorage.setItem('esb-banner-studio/autosave-snapshot', JSON.stringify({
          dirty: false,
          savedAt: Date.now(),
          name,
          path,
          doc: get().doc,
        }))
      } catch { /* ignore */ }
    },
    setAlignText: (id, align) => get().setOverride(id, { align }),

    // ---------------------------------------------------------------- guides
    addGuide: (axis, at) => {
      const id = 'g-' + Math.random().toString(36).slice(2, 7)
      const f = get().format
      edit((d) => { d.guides[f].push({ id, axis, at }) })
      return id
    },
    moveGuide: (id, at, silent) => {
      const f = get().format
      const apply = (d: Doc) => { const g = d.guides[f].find((x: GuideLine) => x.id === id); if (g) g.at = at }
      if (silent) { const d = clone(get().doc); apply(d); set({ doc: d }) } else edit(apply, 'guide:' + id)
    },
    removeGuide: (id) => { const f = get().format; edit((d) => { d.guides[f] = d.guides[f].filter((g) => g.id !== id) }) },
    clearGuides: () => { const f = get().format; edit((d) => { d.guides[f] = [] }) },
  }
})

// Photos are not kept between sessions (the desk starts clean, see restoreSessionPhotos). An earlier version tried to
// keep them in IndexedDB on every change; that database is cleared once so nothing it held lingers on disk.
if (typeof indexedDB !== 'undefined') { try { indexedDB.deleteDatabase('esb-banner-studio/idb') } catch { /* unavailable */ } }

export async function restoreSessionPhotos(): Promise<void> {
  // Clean fresh start on application launch: do not restore old session photos or stale doc
  return
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
let skipDirty = false
useStore.subscribe((s, prev) => {
  if (s.doc === prev.doc) return
  // a content change can remove layers (e.g. the link pill): never keep them selected
  if (s.selectedIds.length && (s.doc.content !== prev.doc.content || s.doc.extras !== prev.doc.extras)) {
    const have = new Set(s.scene().elements.map((e) => e.id))
    const keep = s.selectedIds.filter((i) => have.has(i))
    if (keep.length !== s.selectedIds.length) useStore.setState({ selectedIds: keep, selectedId: keep[keep.length - 1] ?? null })
  }
  if (skipDirty) skipDirty = false
  else if (!s.dirty) useStore.setState({ dirty: true })
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    // read now, not from this change's `s`: the first edit after a save set `dirty` after `s` was taken, so the
    // snapshot below was skipped for it
    const s = useStore.getState()
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s.doc))
      if (s.dirty) {
        localStorage.setItem('esb-banner-studio/autosave-snapshot', JSON.stringify({
          dirty: true,
          savedAt: Date.now(),
          name: s.projectName,
          path: s.projectPath,
          doc: s.doc,
        }))
      }
    } catch { /* storage unavailable */ }
  }, 250)
})

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(useStore.getState().doc)) } catch { /* ignore */ }
  })
}

// test hook (dev server only): lets the fuzz / UI tests drive the store directly
if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV && typeof window !== 'undefined') Object.assign(window, { __store: useStore })
