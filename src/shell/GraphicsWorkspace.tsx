import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import type { Assets } from '../core/render'
import type { FormatId } from '../core/types'
import { Stage } from '../components/Stage'
import { ExportDialog } from '../components/ExportDialog'
import { FormatPicker } from '../components/FormatPicker'
import { Dock, Inspector, PhotosPanel, StoryPanel } from '../components/Panels'
import { PreviewWindow } from '../components/PreviewPanel'
import { copyToClipboard, emptySlots, humanBytes, loadSettings, renderBanner, runExport, saveSettings } from '../export'
import type { ExportSettings } from '../export'
import { openProject, openRecent, readRecent, saveProject } from '../project'
import { hint, pointer, restoreSessionPhotos, useStore } from '../store'
import { CATEGORIES, FORMATS, getFormat } from '../core/tokens'
import { ContextMenu, IconButton, MenuBar, MenuButton, Select, Tabs } from '../ui/controls'
import type { MenuDef } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { DEFAULT_LAYOUT, LIMITS, Splitter, loadLayout, saveLayout } from '../ui/layout'
import { RAIL_W, useSideColumn } from '../ui/sideColumnState'
import { ColumnHandle, ColumnRail, railClass } from '../ui/SideColumn'
import type { LayoutState } from '../ui/layout'
import { useShellStore } from './shellStore'
import { WorkspaceSwitcher } from './WorkspaceRail'
import { ShortcutsDialog, useHelpMenu, type ShortcutGroup } from '../ui/HelpMenu'
import { AiChip } from '../editorial/AiChip'
import { AccountButton } from './AccountButton'

type Tab = 'story' | 'photos'

// a side column folded to its icon rail is exactly RAIL_W wide; open, it keeps its old clamp
const colCss = (px: number) => (px <= RAIL_W ? `${px}px` : `clamp(264px, ${px}px, 38vw)`)
const gridCols = (lw: number, rw: number) => `46px ${colCss(lw)} minmax(0, 1fr) ${colCss(rw)}`

const SHORTCUTS: ShortcutGroup[] = [
  { group: 'File', rows: [['Ctrl + N', 'New banner'], ['Ctrl + Shift + N', 'Next story — keep this layout'], ['Ctrl + O', 'Open project'], ['Ctrl + S', 'Save project'], ['Ctrl + Shift + S', 'Save project as'], ['Ctrl + I', 'Import photos'], ['Ctrl + E', 'Export'], ['Ctrl + Shift + C', 'Copy banner as image']] },
  { group: 'Edit', rows: [['Ctrl + Z', 'Undo'], ['Ctrl + Y  /  Ctrl + Shift + Z', 'Redo'], ['Ctrl + X / C / V', 'Cut / copy / paste layers'], ['Ctrl + Shift + V', 'Paste in place'], ['Ctrl + D', 'Duplicate'], ['Del', 'Delete layer / hide template element'], ['Ctrl + A', 'Select all'], ['Esc', 'Deselect']] },
  { group: 'Tools', rows: [['P', 'Show / hide the live Facebook preview'], ['V', 'Select'], ['H  /  hold Space', 'Hand (pan)'], ['T', 'Add text'], ['R', 'Add rectangle']] },
  { group: 'Moving & resizing', rows: [['Arrow keys', 'Nudge 1 px (Shift = 10 px)'], ['Shift + drag', 'Lock the axis'], ['Alt + drag', 'Move without snapping'], ['Shift + resize', 'Keep proportions'], ['Alt + resize', 'Resize from the centre'], ['Shift + Alt + resize', 'Proportional, from the centre'], ['Alt + drag a photo', 'Move the whole photo block']] },
  { group: 'Selecting', rows: [['Click', 'Select'], ['Shift + click', 'Add / remove from selection'], ['Alt + click', 'Select the layer underneath'], ['Drag on empty canvas', 'Marquee select'], ['Ctrl + drag', 'Marquee anywhere, even over layers']] },
  { group: 'Arranging', rows: [['Ctrl + ] / [', 'Bring forward / send backward'], ['Ctrl + Shift + ] / [', 'Bring to front / send to back'], ['Drag a ruler', 'New guide (double-click a guide to remove)'], ['Right-click', 'Layer menu']] },
  { group: 'View', rows: [['D', 'Toggle element dimensions'], ['Ctrl + wheel', 'Zoom at the cursor'], ['Ctrl + = / −', 'Zoom in / out'], ['Ctrl + 0 / 1 / 2', 'Fit / 100 % / zoom to selection'], ['Wheel over a photo', 'Zoom that photo'], ['Double-click text', 'Edit it in place'], ['?', 'This list']] },
]

function PointerReadout() {
  const p = useSyncExternalStore(pointer.subscribe, pointer.get)
  return <span className="sb-item"><span className="sb-k">Pointer</span><span className="mono">{p ? `${Math.round(p.x)}, ${Math.round(p.y)} px` : '—, — px'}</span></span>
}

/** Left status item: SELECTION and its size (the modifier-key hint replaces it while dragging). With nothing selected it
 *  says None — the Inspector's "Nothing selected" already explains how to pick a layer. */
function StatusInfo() {
  const h = useSyncExternalStore(hint.subscribe, hint.get)
  const doc = useStore((s) => s.doc)
  const format = useStore((s) => s.format)
  const ids = useStore((s) => s.selectedIds)
  const scene = useStore((s) => s.scene)
  const info = useMemo(() => {
    const els = scene().elements.filter((e) => ids.includes(e.id))
    if (!els.length) return 'None'
    if (els.length > 1) return `${els.length} layers selected`
    const e = els[0]
    return `${e.name} · ${Math.round(e.w)} × ${Math.round(e.h)} at ${Math.round(e.x)}, ${Math.round(e.y)}`
  }, [scene, doc, format, ids])
  return h ? <span className="status-hint"><Icon name="info" size={13} />{h}</span> : <span className="sb-item status-info"><span className="sb-k">Selection</span><span className="sb-text">{info}</span></span>
}

function ZoomControls() {
  const zoom = useStore((s) => s.zoom)
  const scale = useStore((s) => s.scale)
  const setZoom = useStore((s) => s.setZoom)
  const presets = [0.25, 0.5, 0.75, 1, 1.5, 2, 3]
  const pct = Math.round(scale * 100)
  const options = [
    { value: 'fit', label: zoom === 'fit' ? `Fit · ${pct}%` : 'Fit to window' },
    ...presets.map((z) => ({ value: String(z), label: `${z * 100}%` })),
    ...(zoom !== 'fit' && !presets.includes(zoom) ? [{ value: String(zoom), label: `${pct}%` }] : []),
  ]
  return (
    <div className="zoomctl">
      <IconButton icon="minus" tip="Zoom out" size={13} tipPos="top" onClick={() => setZoom(Math.max(0.1, scale / 1.25))} />
      <Select value={zoom === 'fit' ? 'fit' : String(zoom)} options={options} align="end" className="compact" onChange={(v) => setZoom(v === 'fit' ? 'fit' : parseFloat(v))} />
      <IconButton icon="plus" tip="Zoom in" size={13} tipPos="top" onClick={() => setZoom(Math.min(4, scale * 1.25))} />
      <IconButton icon="fit" tip="Fit to window (Ctrl+0)" size={13} tipPos="top" active={zoom === 'fit'} onClick={() => setZoom('fit')} />
    </div>
  )
}

export function GraphicsWorkspace({ base }: { base: Assets }) {
  // Arriving from the Editorial desk's "Edit in Graphics": open on the photo with its slot selected.
  const [tab, setTab] = useState<Tab>(() => {
    if (useShellStore.getState().consumeGraphicsFocus() !== 'photos') return 'story'
    const g = useStore.getState()
    g.selectSlot(0)
    g.select('photos')
    return 'photos'
  })
  const returnTo = useShellStore((s) => s.returnTo)
  const [exp, setExpState] = useState<ExportSettings>(loadSettings)
  const [showExport, setShowExport] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showKeys, setShowKeys] = useState(false)
  const [showPreview, setShowPreviewState] = useState(() => { try { return localStorage.getItem('esb-banner-studio/preview-open') === '1' } catch { return false } })
  const setShowPreview = useCallback((v: boolean | ((p: boolean) => boolean)) => setShowPreviewState((p) => { const n = typeof v === 'function' ? v(p) : v; try { localStorage.setItem('esb-banner-studio/preview-open', n ? '1' : '0') } catch { /* ignore */ } return n }), [])
  const [imgMenu, setImgMenu] = useState<{ x: number; y: number } | null>(null)
  // panel sizes: dragged live straight into CSS variables (no React render per frame), saved on release
  const catAccent = useStore((st) => CATEGORIES.find((c) => c.id === st.doc.content.categoryId)?.accent)
  const catInk = useStore((st) => CATEGORIES.find((c) => c.id === st.doc.content.categoryId)?.chipText)
  const [layout, setLayout] = useState<LayoutState>(loadLayout)
  const appRef = useRef<HTMLDivElement>(null)
  // each sidebar tab remembers where you were scrolled
  const leftScroll = useRef<HTMLDivElement>(null)
  const scrolls = useRef<Record<Tab, number>>({ story: 0, photos: 0 })
  const switchTab = (t: Tab) => { if (leftScroll.current) scrolls.current[tab] = leftScroll.current.scrollTop; setTab(t) }
  useLayoutEffect(() => { if (leftScroll.current) leftScroll.current.scrollTop = scrolls.current[tab] }, [tab])
  const sizes = useRef(layout)
  // Live drags write the grid / dock size directly (a changed CSS variable would restyle the whole tree on every pointer move).
  const liveSize = (k: keyof LayoutState) => (v: number) => {
    const app = appRef.current
    if (!app) return
    sizes.current = { ...sizes.current, [k]: v }
    if (k === 'dock') { const d = app.querySelector<HTMLElement>('.dock'); if (d) d.style.height = `min(${v}px, 46%)` }
    else app.style.gridTemplateColumns = gridCols(k === 'lw' ? v : leftCol.px, k === 'rw' ? v : rightCol.px)
  }
  const commitSize = (k: keyof LayoutState) => (v: number) => setLayout((l) => { const n = { ...l, [k]: v }; saveLayout(n); return n })
  const maxW = Math.min(LIMITS.lw[1], Math.round(window.innerWidth * 0.38))
  // the two side columns: resizable, and each folds to an icon rail (shared with every desk, src/ui/SideColumn.tsx)
  const leftCol = useSideColumn('graphics/left', 'left', { def: DEFAULT_LAYOUT.lw, min: LIMITS.lw[0], max: LIMITS.lw[1] }, () => loadLayout().lw)
  const rightCol = useSideColumn('graphics/right', 'right', { def: DEFAULT_LAYOUT.rw, min: LIMITS.rw[0], max: LIMITS.rw[1] }, () => loadLayout().rw)
  const showDockTab = (t: 'elements' | 'layers') => window.dispatchEvent(new CustomEvent('esb:dock-tab', { detail: t }))
  const file = useRef<HTMLInputElement>(null)
  const pasteInPlace = useRef(false)

  const format = useStore((s) => s.format)
  const setFormat = useStore((s) => s.setFormat)
  const past = useStore((s) => s.past.length)
  const future = useStore((s) => s.future.length)
  const snap = useStore((s) => s.snap)
  const tool = useStore((s) => s.tool)
  const rulers = useStore((s) => s.rulers)
  const canvasGrid = useStore((s) => s.canvasGrid)
  const cropGuides = useStore((s) => s.cropGuides)
  const showDimensions = useStore((s) => s.showDimensions)
  const theme = useStore((s) => s.theme)
  const notice = useStore((s) => s.notice)
  const images = useStore((s) => s.images)
  const selCount = useStore((s) => s.selectedIds.length)
  const hasClip = useStore((s) => !!s.clip)
  const projectName = useStore((s) => s.projectName)
  const dirty = useStore((s) => s.dirty)
  const guideCount = useStore((s) => s.doc.guides[s.format].length)

  const setExp = useCallback((s: ExportSettings) => { setExpState(s); saveSettings(s) }, [])

  useEffect(() => {
    void restoreSessionPhotos()
  }, [])
  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  useEffect(() => { document.title = `${projectName ?? 'Untitled banner'}${dirty ? ' •' : ''} — ESB AI Studio` }, [projectName, dirty])

  const addPhotos = useCallback(() => file.current?.click(), [])
  useEffect(() => {
    const open = () => { setTab('photos'); file.current?.click() }
    window.addEventListener('esb:add-photos', open)
    return () => window.removeEventListener('esb:add-photos', open)
  }, [])

  // ---------------------------------------------------------------- export helpers
  const quickExport = useCallback(async (formats: FormatId[]) => {
    if (!base) return
    const st = useStore.getState()
    // A quick export always exports. It used to stop at the first click on a banner with an empty photo slot and only
    // say "run it again", which read as a dead button; the empty slot is now reported with the result instead.
    const missing = formats.map((f) => emptySlots(st.doc, f)).reduce((a, b) => Math.max(a, b), 0)
    setBusy(true)
    try {
      const r = await runExport(st.doc, base, { ...exp, formats }, () => undefined)
      if (r.dir && r.dir !== exp.dir) setExp({ ...exp, dir: r.dir })
      if (exp.openAfter && r.saved[0]) void window.esb?.reveal?.(r.saved[0])
      const note = missing > 0 ? ` — ${missing} empty photo slot${missing > 1 ? 's' : ''} exported as placeholder` : ''
      st.setNotice(r.saved.length ? `Saved ${r.saved.length} file${r.saved.length === 1 ? '' : 's'} · ${humanBytes(r.bytes)}${note}` : 'Export cancelled')
    } catch (err) {
      st.setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [base, exp, setExp])

  const copyCurrent = useCallback(async () => {
    if (!base) return
    const st = useStore.getState()
    try { await copyToClipboard(st.doc, st.format, base); st.setNotice('Copied the banner to the clipboard — paste it anywhere.') }
    catch (e) { st.setNotice('Could not copy: ' + (e instanceof Error ? e.message : String(e))) }
  }, [base])

  const dragFilePathRef = useRef<string | null>(null)
  const isPreparingDrag = useRef(false)

  const prewarmDragFile = useCallback(async (): Promise<string | null> => {
    if (!base || !window.esb?.prepareDragFile || isPreparingDrag.current) return dragFilePathRef.current
    try {
      isPreparingDrag.current = true
      const st = useStore.getState()
      const blob = await renderBanner(st.doc, st.format, base, 1, 'png', 1)
      const buf = new Uint8Array(await blob.arrayBuffer())
      const safeName = `ESB_${st.doc.content.categoryId}_${st.format}.png`
      const p = await window.esb.prepareDragFile(safeName, buf)
      if (p) dragFilePathRef.current = p
      return p
    } catch (err) {
      console.warn('prewarmDragFile error:', err)
      return null
    } finally {
      isPreparingDrag.current = false
    }
  }, [base])

  // Automatically prewarm drag cache whenever doc or format changes (debounced 400ms)
  useEffect(() => {
    const t = setTimeout(() => { void prewarmDragFile() }, 400)
    return () => clearTimeout(t)
  }, [format, base, prewarmDragFile])

  const handleDragStart = useCallback((e: React.DragEvent) => {
    const filePath = dragFilePathRef.current
    if (filePath && window.esb?.startDrag) {
      e.preventDefault()
      window.esb.startDrag(filePath)
      useStore.getState().setNotice('Dropping banner directly into post…')
      return
    }
    // Fallback: If not ready, prewarm and fire immediately
    void prewarmDragFile().then((p) => {
      if (p && window.esb?.startDrag) {
        window.esb.startDrag(p)
      }
    })
  }, [prewarmDragFile])

  const zoomBy = (k: number) => { const st = useStore.getState(); st.setZoom(Math.min(4, Math.max(0.1, st.scale * k))) }
  const newBanner = (keep = false) => useStore.getState().newBanner(keep)
  const cleanAndStartNew = () => {
    useStore.getState().newBanner(false)
    try {
      localStorage.removeItem('esb-banner-studio/autosave-snapshot')
    } catch { /* ignore */ }
    useStore.getState().setZoom('fit')
    useStore.getState().setNotice('Session cleaned — started fresh')
    useShellStore.getState().setWorkspace('home')
  }

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const typing = (t instanceof HTMLInputElement && !['range', 'checkbox'].includes(t.type)) || t instanceof HTMLTextAreaElement
      const st = useStore.getState()
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      if (e.key === 'Escape') { if (showKeys) { setShowKeys(false); return } if (!typing && !showExport) st.select(null); return }
      if (mod && k === 'e') { e.preventDefault(); setShowExport(true); return }
      if (mod && k === 's') { e.preventDefault(); void saveProject(e.shiftKey); return }
      if (mod && k === 'o') { e.preventDefault(); void openProject(); return }
      if (mod && k === 'n') { e.preventDefault(); newBanner(e.shiftKey); return }
      if (mod && (e.altKey || e.shiftKey) && k === 'q') { e.preventDefault(); cleanAndStartNew(); return }
      if (mod && k === 'i' && !typing) { e.preventDefault(); addPhotos(); return }
      if (mod && e.shiftKey && k === 'c' && !typing) { e.preventDefault(); void copyCurrent(); return }
      if (typing || showExport) return
      if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? st.redo() : st.undo(); return }
      if (mod && k === 'y') { e.preventDefault(); st.redo(); return }
      if (mod && k === 'c') { if (st.copySelected()) { e.preventDefault(); st.setNotice('Copied') } return }
      if (mod && k === 'x') { e.preventDefault(); st.cutSelected(); return }
      if (mod && k === 'v' && e.shiftKey) { pasteInPlace.current = true; return } // the paste event reads this
      if (mod && k === '0') { e.preventDefault(); st.setZoom('fit'); return }
      if (mod && k === '1') { e.preventDefault(); st.setZoom(1); return }
      if (mod && k === '2') { e.preventDefault(); window.dispatchEvent(new CustomEvent('esb:zoom-selection')); return }
      if (mod && (k === '=' || k === '+')) { e.preventDefault(); zoomBy(1.25); return }
      if (mod && k === '-') { e.preventDefault(); zoomBy(0.8); return }
      if (mod && k === 'a') { e.preventDefault(); st.selectAll(); return }
      if (mod && k === 'd') { e.preventDefault(); st.duplicateSelected(); return }
      if (mod && e.key === "'") { e.preventDefault(); st.setCanvasGrid(!st.canvasGrid); return } // Ctrl+' = show grid (Photoshop/Illustrator convention)
      if (mod && (e.key === ']' || e.key === '[' || e.key === '}' || e.key === '{') && st.selectedId) {
        e.preventDefault()
        const up = e.key === ']' || e.key === '}'
        st.moveLayer(st.selectedId, e.shiftKey ? (up ? 'front' : 'back') : up ? 'up' : 'down')
        return
      }
      if (mod) return
      if (k === 'p') { setShowPreview((v) => !v); return }
      if (k === 'v') { st.setTool('select'); return }
      if (k === 'h') { st.setTool('hand'); return }
      if (k === 't') { e.preventDefault(); st.addText(); return }
      if (k === 'r') { e.preventDefault(); st.addRect(); return }
      if (k === 'd') {
        const next = !st.showDimensions
        st.setShowDimensions(next)
        st.setNotice(next ? 'Element dimensions: Visible' : 'Element dimensions: Hidden')
        return
      }
      if (e.key === '?') { setShowKeys(true); return }
      if (!st.selectedIds.length) return
      const step = e.shiftKey ? 10 : 1
      const dir: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
      const onSlider = t instanceof HTMLInputElement && t.type === 'range' // arrow keys belong to a focused slider
      if (dir[e.key] && !onSlider) {
        e.preventDefault()
        const [dx, dy] = dir[e.key]
        const els = st.scene().elements.filter((x) => st.selectedIds.includes(x.id) && !x.locked)
        const rest = els.filter((x) => x.kind !== 'watermark')
        if (rest.length) st.moveElements(rest.map((x) => ({ id: x.id, x: x.x + dx, y: x.y + dy })))
        for (const w of els.filter((x) => x.kind === 'watermark')) {
          const o = st.doc.overrides[`${st.format}:${w.id}`]
          st.setOverride(w.id, { iconDx: (o?.iconDx ?? 0) + dx, iconDy: (o?.iconDy ?? 0) + dy })
        }
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); st.deleteSelected() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showKeys, showExport, copyCurrent, addPhotos, setShowPreview])

  // a click anywhere outside a text field releases focus from it, so Ctrl+Z / Delete / arrows act on the banner, not on stale text focus
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const a = document.activeElement
      if ((a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement) && !(e.target as Element | null)?.closest?.('input, textarea')) a.blur()
    }
    window.addEventListener('pointerdown', down, true)
    return () => window.removeEventListener('pointerdown', down, true)
  }, [])

  // paste (photos from the clipboard, or the copied layers) / drop image files anywhere
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
      if (files.length) { e.preventDefault(); setTab('photos'); void useStore.getState().addImages(files); return }
      const st = useStore.getState()
      if (st.clip) { e.preventDefault(); st.pasteClip(pasteInPlace.current) }
      pasteInPlace.current = false
    }
    const onDragOver = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault() }
    const onDrop = (e: DragEvent) => {
      const files = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'))
      if (files.length) { e.preventDefault(); setTab('photos'); void useStore.getState().addImages(files) }
    }
    window.addEventListener('paste', onPaste)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => { window.removeEventListener('paste', onPaste); window.removeEventListener('dragover', onDragOver); window.removeEventListener('drop', onDrop) }
  }, [])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => useStore.getState().setNotice(null), 6500)
    return () => clearTimeout(t)
  }, [notice])

  // ---------------------------------------------------------------- menus
  const st = useStore.getState
  const recent = readRecent()
  const has = selCount > 0
  const help = useHelpMenu({ onShortcuts: () => setShowKeys(true) })
  const menus: MenuDef[] = [
    { label: 'File', items: [
      { label: 'New banner', icon: 'filePlus', shortcut: 'Ctrl+N', onClick: () => newBanner(false) },
      { label: 'Next story — keep this layout', hint: 'clears headline + photos', shortcut: 'Ctrl+Shift+N', onClick: () => newBanner(true) },
      { label: 'Open project', icon: 'folder', shortcut: 'Ctrl+O', onClick: () => void openProject() },
      ...(recent.length && window.esb ? [{ heading: 'Recent' } as const, ...recent.slice(0, 5).map((r) => ({ label: r.name, icon: 'newspaper' as const, onClick: () => void openRecent(r) }))] : []),
      { divider: true },
      { label: 'Save project', icon: 'download', shortcut: 'Ctrl+S', onClick: () => void saveProject(false) },
      { label: 'Save project as', shortcut: 'Ctrl+Shift+S', onClick: () => void saveProject(true) },
      { divider: true },
      { label: 'Import photos', icon: 'image', shortcut: 'Ctrl+I', onClick: addPhotos },
      { label: 'Export', icon: 'sliders', shortcut: 'Ctrl+E', onClick: () => setShowExport(true) },
      { divider: true },
      { label: 'Copy image to clipboard', icon: 'copy', shortcut: 'Ctrl+Shift+C', onClick: copyCurrent },
      { divider: true },
      { label: 'Quit and start new', icon: 'reset', shortcut: 'Ctrl+Alt+Q', danger: true, onClick: cleanAndStartNew },
      ...(window.esb ? [{ label: 'Exit studio', icon: 'x' as const, danger: true, onClick: () => window.close() }] : []),
    ] },
    { label: 'Edit', items: [
      { label: 'Undo', icon: 'undo', shortcut: 'Ctrl+Z', disabled: !past, onClick: () => st().undo() },
      { label: 'Redo', icon: 'redo', shortcut: 'Ctrl+Y', disabled: !future, onClick: () => st().redo() },
      { divider: true },
      { label: 'Cut', shortcut: 'Ctrl+X', disabled: !has, onClick: () => st().cutSelected() },
      { label: 'Copy', shortcut: 'Ctrl+C', disabled: !has, onClick: () => { if (st().copySelected()) st().setNotice('Copied') } },
      { label: 'Paste', shortcut: 'Ctrl+V', disabled: !hasClip, onClick: () => st().pasteClip(false) },
      { label: 'Paste in place', shortcut: 'Ctrl+Shift+V', disabled: !hasClip, onClick: () => st().pasteClip(true) },
      { label: 'Duplicate', shortcut: 'Ctrl+D', disabled: !has, onClick: () => st().duplicateSelected() },
      { label: 'Delete', shortcut: 'Del', disabled: !has, onClick: () => st().deleteSelected() },
      { divider: true },
      { label: 'Select all', shortcut: 'Ctrl+A', onClick: () => st().selectAll() },
      { label: 'Deselect', shortcut: 'Esc', disabled: !has, onClick: () => st().select(null) },
    ] },
    { label: 'Insert', items: [
      { label: 'Text', icon: 'text', shortcut: 'T', onClick: () => st().addText() },
      { label: 'Rectangle', icon: 'square', shortcut: 'R', onClick: () => st().addRect() },
      { divider: true },
      { label: 'Photos', icon: 'image', shortcut: 'Ctrl+I', onClick: addPhotos },
      ...(images.length ? [{ heading: 'Add a library photo as a layer' } as const, ...images.slice(0, 6).map((im) => ({ label: im.name, icon: 'image' as const, onClick: () => st().addImageLayer(im.id) }))] : []),
    ] },
    { label: 'Arrange', items: [
      { label: 'Bring to front', icon: 'front', shortcut: 'Ctrl+Shift+]', disabled: !has, onClick: () => st().selectedId && st().moveLayer(st().selectedId!, 'front') },
      { label: 'Bring forward', icon: 'forward', shortcut: 'Ctrl+]', disabled: !has, onClick: () => st().selectedId && st().moveLayer(st().selectedId!, 'up') },
      { label: 'Send backward', icon: 'backward', shortcut: 'Ctrl+[', disabled: !has, onClick: () => st().selectedId && st().moveLayer(st().selectedId!, 'down') },
      { label: 'Send to back', icon: 'back', shortcut: 'Ctrl+Shift+[', disabled: !has, onClick: () => st().selectedId && st().moveLayer(st().selectedId!, 'back') },
      { divider: true },
      { label: 'Align left', icon: 'alignLeft', disabled: !has, onClick: () => st().alignSelected('left') },
      { label: 'Align centre', icon: 'alignHCenter', disabled: !has, onClick: () => st().alignSelected('hcenter') },
      { label: 'Align right', icon: 'alignRight', disabled: !has, onClick: () => st().alignSelected('right') },
      { label: 'Align top', icon: 'alignTop', disabled: !has, onClick: () => st().alignSelected('top') },
      { label: 'Align middle', icon: 'alignVCenter', disabled: !has, onClick: () => st().alignSelected('vcenter') },
      { label: 'Align bottom', icon: 'alignBottom', disabled: !has, onClick: () => st().alignSelected('bottom') },
      { divider: true },
      { label: 'Hide / show', icon: 'eyeOff', disabled: !has, onClick: () => st().selectedIds.forEach((id) => { const e = st().scene().elements.find((x) => x.id === id); if (e) st().setOverride(id, { visible: !e.visible }) }) },
      { label: 'Lock / unlock', icon: 'lock', disabled: !has, onClick: () => st().selectedIds.forEach((id) => { const e = st().scene().elements.find((x) => x.id === id); if (e) st().setOverride(id, { locked: !e.locked }) }) },
    ] },
    { label: 'View', items: [
      { label: 'Zoom in', icon: 'plus', shortcut: 'Ctrl+=', onClick: () => zoomBy(1.25) },
      { label: 'Zoom out', icon: 'minus', shortcut: 'Ctrl+−', onClick: () => zoomBy(0.8) },
      { label: 'Fit to window', icon: 'fit', shortcut: 'Ctrl+0', onClick: () => st().setZoom('fit') },
      { label: 'Actual size (100%)', shortcut: 'Ctrl+1', onClick: () => st().setZoom(1) },
      { label: 'Zoom to selection', shortcut: 'Ctrl+2', disabled: !has, onClick: () => window.dispatchEvent(new CustomEvent('esb:zoom-selection')) },
      { divider: true },
      { label: 'Facebook preview', shortcut: 'P', checked: showPreview, onClick: () => setShowPreview(!showPreview) },
      { label: 'Rulers', checked: rulers, onClick: () => st().setRulers(!rulers) },
      { label: 'Canvas grid', shortcut: "Ctrl+'", checked: canvasGrid, onClick: () => st().setCanvasGrid(!canvasGrid) },
      { label: 'Snap to edges, centres & guides', checked: snap, onClick: () => st().setSnap(!snap) },
      { label: 'Crop guides (how Facebook trims)', checked: cropGuides, onClick: () => st().setCropGuides(!cropGuides) },
      { label: 'Element dimensions', shortcut: 'D', checked: showDimensions, onClick: () => {
        const next = !showDimensions
        st().setShowDimensions(next)
        st().setNotice(next ? 'Element dimensions: Visible' : 'Element dimensions: Hidden')
      } },
      { label: 'Clear guides', disabled: !guideCount, onClick: () => st().clearGuides() },
      { divider: true },
      { label: 'Dark theme', checked: theme === 'dark', onClick: () => st().setTheme(theme === 'dark' ? 'light' : 'dark') },
    ] },
    help.menu,
  ]

  return (
    <div className="app side-cols" ref={appRef} style={{ gridTemplateColumns: gridCols(leftCol.px, rightCol.px), ['--dock']: layout.dock + 'px', ['--cat']: catAccent, ['--cat-ink']: catInk } as CSSProperties}>
      <header className="topbar gx-head">
        <WorkspaceSwitcher />
        <MenuBar menus={menus} />
        {returnTo === 'editorial' && (
          <button type="button" className="pv-btn back-to-desk" aria-label="Back to the Editorial desk" onClick={() => useShellStore.getState().setWorkspace('editorial')} title="Back to the Editorial desk — your photo edits are already there">
            <Icon name="chevLeft" size={14} /><span className="back-label">Editorial</span>
          </button>
        )}
        <div className="spacer" />
        <div className="fmtgroup">
          <FormatPicker value={format} onChange={setFormat} />
          <button className="dual-toggle-btn" aria-label={format === 'fb45' ? 'Switch to Web Hero 16:9' : 'Switch to Facebook Feed 4:5'} data-tip={format === 'fb45' ? 'Switch to Web Hero 16:9' : 'Switch to Facebook Feed 4:5'} onClick={() => setFormat(format === 'fb45' ? 'web' : 'fb45')}>
            <Icon name="swap" size={15} />
          </button>
          <button className={'pv-btn' + (showPreview ? ' on' : '')} onClick={() => setShowPreview((v) => !v)} aria-pressed={showPreview} aria-label="Preview" data-tip="Preview (P) — live Facebook preview, stays open while you edit"><Icon name="eye" size={16} /></button>
        </div>
        <div className="spacer" />
        <div className="pillbar">
          <IconButton icon="undo" tip="Undo (Ctrl+Z)" disabled={!past} onClick={() => st().undo()} />
          <IconButton icon="redo" tip="Redo (Ctrl+Y)" disabled={!future} onClick={() => st().redo()} />
          <i className="pill-sep" />
          <IconButton icon="copy" tip="Copy banner as image (Ctrl+Shift+C)" onClick={copyCurrent} />
          <i className="pill-sep" />
          <button
            type="button"
            className="drag-post-chip"
            draggable
            onPointerEnter={() => void prewarmDragFile()}
            onPointerDown={() => void prewarmDragFile()}
            onDragStart={handleDragStart}
            title="Drag banner directly into Facebook composer, Chrome tab, WhatsApp, or File Explorer"
          >
            <Icon name="hand" size={13} />
            <span className="dpc-label">Drag to Post</span>
            <span className="dpc-tag">{format === 'web' ? '16:9' : format === 'fb45' ? '4:5' : '1:1'}</span>
          </button>
        </div>
        <AiChip role="main" onToast={(m) => st().setNotice(m)} />
        <AccountButton onToast={(m) => st().setNotice(m)} />
        <div className="split">
          <button className="btn primary" disabled={busy} onClick={() => setShowExport(true)}><Icon name="download" size={15} />{busy ? 'Exporting…' : 'Export'}</button>
          <MenuButton className="primary split-caret" align="end" title="Quick export" items={[
            { label: 'Export options', icon: 'sliders', shortcut: 'Ctrl+E', onClick: () => setShowExport(true) },
            { divider: true },
            { label: 'Quick: Newsroom Bundle (FB + Web)', icon: 'download', hint: '4:5 + 16:9', onClick: () => quickExport(['fb45', 'web']) },
            { label: 'Quick: this banner only', icon: 'download', hint: getFormat(format).name, onClick: () => quickExport([format]) },
            { label: 'Quick: all selected formats', icon: 'download', hint: `${exp.type.toUpperCase()} ${exp.scales.map((s) => s + '×').join(' ')}`, onClick: () => quickExport(exp.formats) },
            { divider: true },
            { label: 'Copy image to clipboard', icon: 'copy', shortcut: 'Ctrl+Shift+C', onClick: copyCurrent },
          ]} />
        </div>
      </header>

      <svg className="corner-join" viewBox="0 0 15 15" aria-hidden focusable="false"><path d="M14.5 .5A14 14 0 0 0 .5 14.5" /></svg>
      <nav className="toolbar">
        <IconButton icon="select" tip="Select (V)" tipPos="right" size={16} active={tool === 'select'} onClick={() => st().setTool('select')} />
        <IconButton icon="hand" tip="Hand — pan (H / Space)" tipPos="right" size={16} active={tool === 'hand'} onClick={() => st().setTool('hand')} />
        <hr />
        <IconButton icon="text" tip="Add text (T)" tipPos="right" size={16} onClick={() => st().addText()} />
        <IconButton icon="square" tip="Add rectangle (R)" tipPos="right" size={16} onClick={() => st().addRect()} />
        <IconButton icon="image" tip="Add image layer" tipPos="right" size={16} onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setImgMenu({ x: r.right + 8, y: r.top }) }} />
        <div className="grow" />
        <IconButton icon="ruler" tip="Rulers & guides" tipPos="right" size={16} className="toggle" active={rulers} onClick={() => st().setRulers(!rulers)} />
        <IconButton icon="dotgrid" tip="Canvas grid (Ctrl+')" tipPos="right" size={16} className="toggle" active={canvasGrid} onClick={() => st().setCanvasGrid(!canvasGrid)} />
        <IconButton icon="magnet" tip="Snap to edges, centres & guides" tipPos="right" size={16} className="toggle" active={snap} onClick={() => st().setSnap(!snap)} />
        <IconButton icon="crop" tip="Crop guides — see how Facebook trims this banner" tipPos="right" size={16} className="toggle" active={cropGuides} onClick={() => st().setCropGuides(!cropGuides)} />
        <IconButton icon="dimension" tip="Element dimensions — toggle accurate size badges (D)" tipPos="right" size={16} className="toggle" active={showDimensions} onClick={() => {
          const next = !showDimensions
          st().setShowDimensions(next)
          st().setNotice(next ? 'Element dimensions: Visible' : 'Element dimensions: Hidden')
        }} />
        <IconButton icon={theme === 'dark' ? 'sun' : 'moon'} tip={theme === 'dark' ? 'Light theme' : 'Dark theme'} tipPos="right" size={16} onClick={() => st().setTheme(theme === 'dark' ? 'light' : 'dark')} />
        <IconButton icon="keyboard" tip="Keyboard shortcuts (?)" tipPos="right" size={16} onClick={() => setShowKeys(true)} />
      </nav>
      {imgMenu && (
        <ContextMenu x={imgMenu.x} y={imgMenu.y} onClose={() => setImgMenu(null)} items={[
          { label: 'Import photos', icon: 'folder', onClick: addPhotos },
          ...(images.length ? [{ divider: true } as const] : []),
          ...images.slice(0, 8).map((im) => ({ label: im.name, icon: 'image' as const, hint: 'add as layer', onClick: () => st().addImageLayer(im.id) })),
        ]} />
      )}

      <aside className={'left' + railClass(leftCol)}>
        <Tabs value={tab} onChange={switchTab} options={[{ value: 'story', icon: 'newspaper', label: 'Story' }, { value: 'photos', icon: 'image', label: 'Photos' }]} />
        <div className="scroll rail" ref={leftScroll}><div key={tab} className="pane">{tab === 'story' ? <StoryPanel /> : <PhotosPanel addPhotos={addPhotos} />}</div></div>
        <ColumnRail col={leftCol} label="Story and photos" items={[
          { id: 'story', icon: 'newspaper', label: 'Story', on: tab === 'story', onClick: () => switchTab('story') },
          { id: 'photos', icon: 'image', label: 'Photos', on: tab === 'photos', onClick: () => switchTab('photos') },
        ]} actions={[{ id: 'import', icon: 'upload', label: 'Import photos (Ctrl+I)', onClick: addPhotos }]} />
        <ColumnHandle col={leftCol} label="Resize the left panel" root={() => appRef.current} apply={liveSize('lw')} max={maxW} />
      </aside>

      <main className="center">
        <Stage base={base} />
        {notice && <div className="toast" onClick={() => st().setNotice(null)}><Icon name="info" size={15} />{notice}</div>}
      </main>

      <aside className={'right' + railClass(rightCol)}>
        <ColumnHandle col={rightCol} label="Resize the right panel" root={() => appRef.current} apply={liveSize('rw')} max={maxW} />
        <ColumnRail col={rightCol} label="Inspector and layers" items={[
          { id: 'inspector', icon: 'sliders', label: 'Inspector', onClick: () => {} },
          { id: 'elements', icon: 'grid', label: 'Elements', onClick: () => showDockTab('elements') },
          { id: 'layers', icon: 'layers', label: 'Layers', onClick: () => showDockTab('layers') },
        ]} />
        <div className="scroll rail insp"><Inspector /></div>
        <Dock>
          <Splitter axis="horz" label="Resize the Elements and Layers list" value={layout.dock} min={LIMITS.dock[0]} max={LIMITS.dock[1]} reset={DEFAULT_LAYOUT.dock} onLive={liveSize('dock')} onCommit={commitSize('dock')} root={() => appRef.current} />
        </Dock>
      </aside>

      <footer className="statusbar">
        <PointerReadout />
        <span className="sep" />
        <StatusInfo />
        <div className="spacer" />
        <span className="muted">{getFormat(format).name} · {FORMATS[format].w} × {FORMATS[format].h}</span>
        <span className="sep" />
        <ZoomControls />
      </footer>

      {showPreview && <PreviewWindow base={base} onClose={() => setShowPreview(false)} />}

      {showExport && <ExportDialog base={base} settings={exp} setSettings={setExp} onClose={() => setShowExport(false)} />}

      {showKeys && <ShortcutsDialog groups={SHORTCUTS} onClose={() => setShowKeys(false)} />}
      {help.dialogs}


      <input ref={file} type="file" accept="image/*" multiple hidden
        onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; if (fs.length) void useStore.getState().addImages(fs) }} />
    </div>
  )
}
