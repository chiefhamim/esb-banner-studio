import { Fragment, memo, useCallback, useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { WorkspaceSwitcher } from '../shell/WorkspaceRail'
import { useShellStore } from '../shell/shellStore'
import { DeskBoundary } from '../ui/DeskBoundary'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { Dialog, IconButton, MenuButton, MenuList, Popover, Seg, Select, Slider, Switch, Tabs } from '../ui/controls'
import type { MenuEntry } from '../ui/controls'
import type { AspectRatio, Clip, MediaAsset, OverlayTemplate, Track, TrackKind, VideoProject } from './timeline'
import { TRACK_KIND_LABEL, allClips, canPlaceOn, clipsForAsset, contentEnd, flattenCompounds, formatShortTime, formatTimecode, groupLocked, neighbours, trackForKind } from './timeline'
import { useVideoStore, viewOf } from './videoStore'
import type { EditTool } from './videoStore'
import { constantSpeed, withRampPreset } from './speed'
import { CompoundBar, KeyframeHead, KeyframeLane, KeyframesSummary, MarkersButton, PROP_RANGES, PasteAttributesDialog, PropRow, RulerMarkers, ShortcutsSheet, SpeedSection, TOOLS, ToolMenu } from './TimelinePro'
import { OVERLAY_LABELS, dropCachedMedia, pruneMediaCache } from './compositor'
import { GLCompositor } from './engine/glCompositor'
import { renderFrame } from './engine/render'
import { previewEngine } from './engine/previewEngine'
import { audioEngine, audioSignature } from './engine/audioEngine'
import { attachLaneCanvas } from './engine/laneCanvas'
import { onProxyReady, previewUrl } from './engine/mediaSource'
import { renderPreviewStill } from './engine/still'
import { holdBackground, holdProxies, noteScrub } from './engine/background'
import { releaseFilmstrips } from './engine/filmstrip'
import { ExportSheet } from './ExportSheet'
import { StoryVideoPanel } from './StoryVideoPanel'
import { DataCardInspector, DataPanel } from './DataPanel'
import { EffectsPanel, FxSection, InspectorSections, openSection, useInspectorUi } from './EffectsPanel'
import { ColourPanel } from './ColourPanel'
import { lutText } from './effects'
import { animationSource } from './engine/animation'
import { PROBE_CONCURRENCY, assetFromEntry, assetFromFile, hasDiskMedia, importOptions, keepTake, mapLimit, patchMeta, probeMedia, takeImportErrors, videoBridge } from './media'
import type { FolderRef } from './media'
import { BinCard, BinImportMode, BinMissingBar } from './BinCard'
import { clearSnapshots, describeSnapshot, latestSnapshot, loadProjectText, onAutosaved, saveProject, startAutosave } from './projectIO'
import type { Snapshot } from './projectIO'
import { fmtTime, useClockFormat } from '../ui/time'
import { TitleFields, TitleSection, TitlesTab } from './TitlesPanel'
import { guidesNow, useTitleUi } from './titleUi'
import { migrateOverlayClip, titleWords } from './titleModel'
import { titleRasterStats } from './engine/titleRaster'
import '../styles/video.css'

type BinTab = 'titles' | 'media' | 'captions' | 'audio' | 'story' | 'data'
const BIN_TAB_LABEL: Record<BinTab, string> = { media: 'Media', titles: 'Titles', captions: 'Captions', audio: 'Audio', story: 'Story', data: 'Data' }

/** The picture overlays the Titles tab adds (titles themselves are TitlesPanel.tsx's kit). */
const OVERLAY_PRESETS: { type: OverlayTemplate; tag: string; desc: string; color: string }[] = [
  { type: 'logo', tag: 'Logo', desc: 'The official ESB Power Line logo, at its own proportions.', color: '#0ea5e9' },
]

const pct = (v: number) => `${Math.round(v * 100)}%`
/** The inspector gets its own column beside the monitor from this window width; below it, it takes the bin's place. */
const WIDE_INSPECTOR = '(min-width: 1180px)'

const getState = useVideoStore.getState
/** The timeline being edited (the project, or the open compound's inside). */
const view = () => viewOf(getState())
const flatMemo = new WeakMap<VideoProject, VideoProject>()
/** What the monitor, the sound and the export play: compound clips replaced by their insides (cached per project). */
function playable(p: VideoProject): VideoProject {
  let f = flatMemo.get(p)
  if (!f) { f = flattenCompounds(p); flatMemo.set(p, f) }
  return f
}

function useMediaQuery(q: string) {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const fn = () => setOn(m.matches)
    m.addEventListener('change', fn)
    fn()
    return () => m.removeEventListener('change', fn)
  }, [q])
  return on
}

// ---------------------------------------------------------------- playback: one wall clock for picture and sound

/** The clock starts this far in the future, so the first sound can be scheduled and the first frames decoded before
 * the playhead moves (the picture and the sound then start at the same instant). */
const START_LEAD_MS = 60
/** The longest the clock waits for the first frames of every stream before it starts anyway. */
const START_WAIT_MS = 700

/** The playback loop. The position comes from the wall clock (where play started + time since), never from adding up
 * frame times, so a slow frame never slows the video down; a seek while playing moves the origin. Sound is scheduled
 * on the Web Audio clock mapped to the same wall clock (engine/audioEngine.ts); the preview engine keeps its decoders
 * a little ahead of the playhead. */
function PlaybackEngine() {
  const playing = useVideoStore((s) => s.playing)
  // J/K/L: 2× and 4× play forwards on the same clock (silent: the sound engine plays at 1× only); backwards is the
  // ReverseShuttle below
  const rate = useVideoStore((s) => (s.playing ? Math.max(1, s.rate || 1) : 0))
  useEffect(() => {
    const eng = previewEngine()
    const audio = audioEngine()
    holdBackground(playing)
    if (!playing) { eng.stopStreams(); audio.stop(); return }
    // the proxy maker waits while the preview plays (Part A; a no-op without it)
    const releaseProxies = holdProxies('playback')
    const cur = () => playable(view())
    const withSound = rate === 1
    let raf = 0
    let origin = performance.now() + START_LEAD_MS
    let base = getState().currentTime
    let last = base
    let project = cur()
    let sig = audioSignature(project)
    // the clock waits (at most START_WAIT_MS) until every stream under the playhead has its first frames, so playback
    // starts on exact frames instead of dropping the first ones; the sound starts with the clock
    let started = false
    const waitFrom = performance.now()
    const position = () => base + (Math.max(0, performance.now() - origin) / 1000) * rate
    const restartAudio = () => { if (withSound) void audio.start(cur(), base, origin, position); else audio.stop() }
    eng.updateStreams(project, base, true)
    const tick = () => {
      const st = getState()
      if (!st.playing) return
      const now = performance.now()
      const p = cur()
      if (!started) {
        if (Math.abs(st.currentTime - last) > 1e-4) { base = st.currentTime; last = base }
        eng.updateStreams(p, base, true)
        if (eng.prerolled(p, base) || now - waitFrom > START_WAIT_MS) {
          started = true
          eng.prerollMs = now - waitFrom
          project = p
          sig = audioSignature(project)
          origin = now + START_LEAD_MS
          eng.startStats()
          restartAudio()
        }
        raf = requestAnimationFrame(tick)
        return
      }
      if (Math.abs(st.currentTime - last) > 1e-4) { origin = now + START_LEAD_MS; base = st.currentTime; restartAudio() } // the editor seeked
      const end = Math.max(0.1, contentEnd(p) || p.duration)
      let t = base + (Math.max(0, now - origin) / 1000) * rate
      if (t >= end) { t = 0; base = 0; origin = now + START_LEAD_MS; restartAudio() }
      if (p !== project) {
        project = p
        const next = audioSignature(project)
        if (next !== sig) { sig = next; base = t; origin = now; restartAudio() } else if (withSound) audio.updateGains(project)
      }
      st.seek(t)
      last = getState().currentTime
      eng.updateStreams(p, last, true)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); eng.stopStreams(); audio.stop(); releaseProxies() }
  }, [playing, rate])
  // leaving the desk stops the sound and the decoders' look-ahead
  useEffect(() => () => { audioEngine().stop(); previewEngine().stopStreams(); holdBackground(false) }, [])
  return null
}

/** J backwards (−1×, −2×, −4×): the playhead runs back on the wall clock while the monitor shows each exact frame as a
 * paused scrub would (the decoders read forwards only, so this never streams). Stops at 0 or on any other key. */
function ReverseShuttle() {
  const rate = useVideoStore((s) => (!s.playing && s.rate < 0 ? s.rate : 0))
  useEffect(() => {
    if (!rate) return
    let raf = 0
    let prev = performance.now()
    const tick = () => {
      const st = getState()
      if (st.playing || st.rate !== rate) return
      const now = performance.now()
      const t = st.currentTime + ((now - prev) / 1000) * rate
      prev = now
      if (t <= 0) { st.seek(0); useVideoStore.setState({ rate: 0 }); return }
      st.seek(t)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [rate])
  return null
}

// ---------------------------------------------------------------- small live pieces (the only things that follow the playhead)

function HeaderTimecode() {
  const t = useVideoStore((s) => s.currentTime)
  const fps = useVideoStore((s) => s.project.fps)
  return <div className="vw-timecode mono" data-tip="Playhead (hours:minutes:seconds:frames)">{formatTimecode(t, fps)}</div>
}

function TransportTime() {
  const t = useVideoStore((s) => s.currentTime)
  const fps = useVideoStore((s) => s.project.fps)
  const end = useVideoStore((s) => contentEnd(viewOf(s)))
  return <><span className="vw-current-time mono">{formatTimecode(t, fps)}</span><span className="vw-total-time mono">/ {formatTimecode(end, fps)}</span></>
}

function Playhead({ zoom }: { zoom: number }) {
  const t = useVideoStore((s) => s.currentTime)
  return <div className="vw-playhead-line" style={{ left: 0, transform: `translateX(${t * zoom}px)` }}><div className="vw-playhead-handle" /></div>
}

function SplitButton() {
  const can = useVideoStore((s) => {
    const p = viewOf(s)
    const t = s.currentTime
    const target = s.selectedClipId ? p.clips.find((c) => c.id === s.selectedClipId) : p.clips.find((c) => t > c.start && t < c.start + c.duration)
    return !!target && t > target.start + 1e-3 && t < target.start + target.duration - 1e-3 && !groupLocked(p, target.id)
  })
  const split = useVideoStore((s) => s.splitAtPlayhead)
  return <button type="button" className="btn sm subtle vw-split" disabled={!can} onClick={split} data-tip="Split the clip at the playhead (S)"><Icon name="crop" size={13} /> Split</button>
}

/** The monitor: a WebGL2 canvas drawn outside React, once per animation frame, whenever the project, the playhead or
 * a decoded frame changes. Without WebGL2 it says so (and draws nothing) rather than show a wrong picture. */
function Monitor({ aspect }: { aspect: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [glError, setGlError] = useState<string | null>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let comp: GLCompositor
    try { comp = new GLCompositor(canvas) } catch (e) { setGlError((e as Error).message); return }
    const eng = previewEngine()
    let raf = 0
    const draw = () => {
      raf = 0
      if (comp.isLost()) { setGlError('The graphics context was lost (the GPU was reset). The picture comes back when the system restores it.'); return }
      const dpr = window.devicePixelRatio || 1
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
      // decode the preview at the monitor's own size (an export always decodes full size)
      eng.setMonitorHeight(h)
      const st = getState()
      const t = st.currentTime
      const { frames, exact } = eng.lookup(t, st.playing)
      renderFrame(comp, playable(viewOf(st)), t, w, h, { editor: true, frames, guides: guidesNow() })
      eng.drawLog?.push({ perf: performance.now(), t })
      if (st.playing) eng.noteDraw(Math.round(t * st.project.fps), exact())
      else if (exact()) eng.noteExactPaused(t)
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(draw) }
    comp.onLost = () => { setGlError('The graphics context was lost (the GPU was reset). The picture comes back when the system restores it.') }
    comp.onRestored = () => { setGlError(null); schedule() }
    eng.onFrame = schedule
    const unsub = useVideoStore.subscribe((s, prev) => {
      if (s.currentTime !== prev.currentTime && !s.playing) { eng.noteSeek(s.currentTime); noteScrub() }
      if (s.project !== prev.project || s.compoundPath !== prev.compoundPath || s.currentTime !== prev.currentTime || s.playing !== prev.playing) schedule()
    })
    const offProxy = onProxyReady(() => schedule())
    const offGuides = useTitleUi.subscribe(schedule)
    window.addEventListener('esb:video-media-ready', schedule)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
    ro?.observe(canvas)
    schedule()
    return () => {
      unsub(); offProxy(); offGuides(); window.removeEventListener('esb:video-media-ready', schedule); ro?.disconnect(); cancelAnimationFrame(raf)
      if (eng.onFrame === schedule) eng.onFrame = () => {}
      comp.dispose()
    }
  }, [])
  return (
    <>
      <canvas ref={canvasRef} className="vw-canvas" style={{ '--vw-ar': aspect } as React.CSSProperties} />
      {glError && <div className="vw-gl-error" role="alert"><Icon name="alert" size={16} /><span>{glError}</span></div>}
    </>
  )
}

/** Waveforms and filmstrips: one canvas over the visible part of the lanes, drawn by engine/laneCanvas.ts. */
function LaneVisuals({ scrollerRef, lanesRef }: { scrollerRef: React.RefObject<HTMLDivElement | null>; lanesRef: React.RefObject<HTMLDivElement | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    const scroller = scrollerRef.current
    const lanes = lanesRef.current
    if (!canvas || !scroller || !lanes) return
    const lc = attachLaneCanvas(canvas, scroller, lanes, { clips: () => view().clips, assets: () => getState().mediaAssets, zoom: () => getState().zoom })
    const unsub = useVideoStore.subscribe((s, p) => { if (s.mediaAssets !== p.mediaAssets || s.zoom !== p.zoom) lc.redraw() })
    return () => { unsub(); lc.detach() }
  }, [scrollerRef, lanesRef])
  return <canvas ref={canvasRef} className="vw-lane-visuals" aria-hidden="true" />
}

// ---------------------------------------------------------------- monitor / timeline split

const TL_KEY = 'esb-banner-studio/video/timeline-height'
const HEADER_H = 46
const STATUS_H = 28
/** The monitor's own chrome under the picture (transport, padding). */
const MONITOR_CHROME = 76
/** The smallest the monitor row may be squeezed to, and the timeline's limits. */
const MONITOR_MIN = 200
const TL_MIN = 160
const TL_AUTO_MIN = 280
/** The keyframe lane's height (video.css .vw-kf-lane). */
const KF_LANE_H = 34
function readTimelineHeight(): number | null {
  try { const v = Number(localStorage.getItem(TL_KEY)); return Number.isFinite(v) && v > 0 ? v : null } catch { return null }
}

/** The divider between the monitor and the timeline: drag it (or Up/Down with the keyboard); a double click returns
 * to the balanced height. */
function TimelineResizer({ height, min, max, onChange }: { height: number; min: number; max: number; onChange: (h: number | null) => void }) {
  const start = useRef<{ y: number; h: number } | null>(null)
  const clamp = (h: number) => Math.max(min, Math.min(max, h))
  return (
    <div
      className="vw-tl-resize"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize the timeline"
      aria-valuenow={height}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      data-tip="Drag to resize the timeline (double-click: balance with the monitor)"
      onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); start.current = { y: e.clientY, h: height } }}
      onPointerMove={(e) => { if (start.current) onChange(clamp(start.current.h - (e.clientY - start.current.y))) }}
      onPointerUp={() => { start.current = null }}
      onPointerCancel={() => { start.current = null }}
      onDoubleClick={() => onChange(null)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp') { e.preventDefault(); onChange(clamp(height + 24)) }
        else if (e.key === 'ArrowDown') { e.preventDefault(); onChange(clamp(height - 24)) }
        else if (e.key === 'Home' || e.key === 'Enter') { e.preventDefault(); onChange(null) }
      }}
    />
  )
}

/** "N more tracks" at the foot of the track headers while tracks are below the visible part; a click scrolls to them. */
function TracksBelowCue({ scrollerRef, count }: { scrollerRef: React.RefObject<HTMLDivElement | null>; count: number }) {
  const [below, setBelow] = useState(0)
  useEffect(() => {
    const sc = scrollerRef.current
    if (!sc) return
    const measure = () => {
      // the visible bottom (above a horizontal scrollbar); a track cut by more than 8 px counts as below
      const bottom = sc.getBoundingClientRect().top + sc.clientHeight
      let n = 0
      for (const h of sc.querySelectorAll<HTMLElement>('.vw-track-head[data-track-id]')) if (h.getBoundingClientRect().bottom > bottom + 8) n++
      setBelow(n)
    }
    measure()
    sc.addEventListener('scroll', measure, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(sc)
    // the keyframe lane opening or closing moves the tracks without a scroll or a resize of the scroller
    const mo = new MutationObserver(measure)
    const heads = sc.querySelector('.vw-track-headers')
    if (heads) mo.observe(heads, { childList: true })
    return () => { sc.removeEventListener('scroll', measure); ro?.disconnect(); mo.disconnect() }
  }, [scrollerRef, count])
  if (!below) return null
  return (
    <button type="button" className="vw-tracks-below" onClick={() => { const sc = scrollerRef.current; sc?.scrollBy({ top: sc.clientHeight * 0.8, behavior: 'smooth' }) }} data-tip="Scroll down to the other tracks">
      <Icon name="chevDown" size={12} />{below} more track{below === 1 ? '' : 's'}
    </button>
  )
}

// ---------------------------------------------------------------- the timeline (memoised: it redraws on edits, not on the playhead)

const Ruler = memo(function Ruler({ duration, zoom, onPointerDown, rulerRef, markers, range, onOpenMarker }: { duration: number; zoom: number; onPointerDown: (e: React.PointerEvent) => void; rulerRef: React.RefObject<HTMLDivElement | null>; markers: VideoProject['markers']; range: { in: number | null; out: number | null }; onOpenMarker: (id: string) => void }) {
  return (
    <div ref={rulerRef} className="vw-ruler" onPointerDown={onPointerDown} style={{ width: `${duration * zoom}px`, '--vw-sec': `${zoom}px` } as React.CSSProperties}>
      {Array.from({ length: Math.ceil(duration / 5) + 1 }).map((_, i) => (
        <div key={i} className="vw-ruler-mark" style={{ left: `${i * 5 * zoom}px` }}><span className="vw-ruler-label mono">{formatShortTime(i * 5)}</span></div>
      ))}
      <RulerMarkers markers={markers ?? NO_MARKERS} zoom={zoom} range={range} onOpen={onOpenMarker} />
    </div>
  )
})
const NO_MARKERS: NonNullable<VideoProject['markers']> = []

type ClipGrab = (e: React.PointerEvent, clip: Clip, what: 'move' | 'left' | 'right') => void

/** The selected clip shows its keyframe lane under its track while it has keys. */
const kfClipOf = (clips: Clip[], selectedIds: string[]) => {
  if (selectedIds.length !== 1) return undefined
  const c = clips.find((x) => x.id === selectedIds[0])
  return c && !c.compound && c.keyframes && Object.values(c.keyframes).some((k) => k?.length) ? c : undefined
}

const Lanes = memo(function Lanes({ tracks, clips, selectedIds, zoom, tool, onGrab, onOpen, lanesRef, onDropAsset }: { tracks: Track[]; clips: Clip[]; selectedIds: string[]; zoom: number; tool: EditTool; onGrab: ClipGrab; onOpen: (clip: Clip) => void; lanesRef: React.RefObject<HTMLDivElement | null>; onDropAsset: (e: React.DragEvent) => void }) {
  const locked = new Set(tracks.filter((t) => t.locked).map((t) => t.id))
  const sel = new Set(selectedIds)
  // a selected clip's linked partners (and its group) are shown as part of the selection
  const links = new Set(clips.filter((c) => sel.has(c.id) && c.linkId).map((c) => c.linkId!))
  const groups = new Set(clips.filter((c) => sel.has(c.id) && c.groupId).map((c) => c.groupId!))
  const kf = kfClipOf(clips, selectedIds)
  const [dropping, setDropping] = useState(false)
  return (
    <div
      className={`vw-lanes-container tool-${tool}${dropping ? ' dropping' : ''}`}
      ref={lanesRef}
      onDragOver={(e) => { if (e.dataTransfer.types.includes(ASSET_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDropping(true) } }}
      onDragLeave={(e) => { if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setDropping(false) }}
      onDrop={(e) => { setDropping(false); onDropAsset(e) }}
    >
      {tracks.map((t) => {
        const own = clips.filter((c) => c.trackId === t.id)
        const rows = laneRows(own)
        return (
          <Fragment key={t.id}>
            <div className={`vw-track-lane lane-${t.kind}${t.locked ? ' locked' : ''}${t.hidden ? ' hidden' : ''}`} data-track-id={t.id}>
              {own.map((clip) => {
                const row = rows.row.get(clip.id) ?? 0
                const isLocked = locked.has(clip.trackId)
                const isSel = sel.has(clip.id)
                const partner = !isSel && ((clip.linkId && links.has(clip.linkId)) || (clip.groupId && groups.has(clip.groupId)))
                const speed = clip.speed != null || clip.freezes?.length || clip.reverse
                return (
                  <div
                    key={clip.id}
                    className={`vw-clip-block ${clip.id === selectedIds[0] ? 'selected' : isSel ? 'selected also' : partner ? 'linked-sel' : ''}${clip.sourceUrl || clip.compound || (clip.kind !== 'video' && clip.kind !== 'audio') ? '' : ' offline'}${rows.count > 1 ? ' stacked' : ''}${clip.sourceUrl && (clip.kind === 'video' || clip.kind === 'audio') && rows.count === 1 ? ' has-visual' : ''}${clip.compound ? ' compound' : ''}`}
                    data-clip-kind={clip.kind}
                    data-clip-id={clip.id}
                    style={{ left: `${clip.start * zoom}px`, width: `${clip.duration * zoom}px`, backgroundColor: clip.color, '--row': row, '--rows': rows.count } as React.CSSProperties}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => onGrab(e, clip, 'move')}
                    onDoubleClick={() => onOpen(clip)}
                  >
                    {!isLocked && <div className="vw-trim-handle left" data-tip={TRIM_TIP[tool].left} onPointerDown={(e) => onGrab(e, clip, 'left')} />}
                    <span className="vw-clip-label">
                      {clip.linkId && <span className="vw-clip-link" aria-label="Linked to its sound"><Icon name="link" size={10} /></span>}
                      {clip.compound && <span className="vw-clip-link" aria-label="Compound clip (double-click to open)"><Icon name="layers" size={10} /></span>}
                      {clip.groupId && <span className="vw-clip-link" aria-label="Grouped"><Icon name="grid" size={10} /></span>}
                      <span className="vw-clip-title">{clipLabel(clip)}</span>
                    </span>
                    <span className="vw-clip-duration mono">{speed ? <i className="vw-clip-speed">{clip.reverse ? '◂ ' : ''}{rampOfLabel(clip)}</i> : null}{clip.duration.toFixed(1)}s</span>
                    {!isLocked && <div className="vw-trim-handle right" data-tip={TRIM_TIP[tool].right} onPointerDown={(e) => onGrab(e, clip, 'right')} />}
                  </div>
                )
              })}
            </div>
            {kf && kf.trackId === t.id && <KeyframeLane clip={kf} zoom={zoom} />}
          </Fragment>
        )
      })}
    </div>
  )
})

const ASSET_MIME = 'application/x-esb-asset'
const APOSTROPHE = "'"
const TRIM_TIP: Record<EditTool, { left: string; right: string }> = {
  select: { left: 'Drag to trim the start', right: 'Drag to trim the end' },
  ripple: { left: 'Ripple trim the start: later clips follow', right: 'Ripple trim the end: later clips follow' },
  roll: { left: 'Roll this cut with the clip before', right: 'Roll this cut with the clip after' },
  slip: { left: 'Drag to trim the start', right: 'Drag to trim the end' },
  slide: { left: 'Drag to trim the start', right: 'Drag to trim the end' },
}
const rampOfLabel = (c: Clip) => (c.speed && typeof c.speed === 'object' ? 'ramp ' : c.freezes?.length && c.speed == null ? 'freeze ' : `${constantSpeed(c)}× `)

// ---------------------------------------------------------------- the desk

/** The desk inside its own error boundary: "Try again" reopens it with nothing selected, on the main timeline, paused
 * (what was being drawn when it failed); the project and its undo history are kept. */
export function VideoWorkspace() {
  return (
    <DeskBoundary desk="Video" onReset={() => useVideoStore.setState({ selectedClipId: null, selectedIds: [], compoundPath: [], playing: false, rate: 0 })} onLeave={() => useShellStore.getState().setWorkspace('home')}>
      <VideoDesk />
    </DeskBoundary>
  )
}

function VideoDesk() {
  const {
    project, tl, playing, selectedClipId, selectedIds, tool, range, inCompound, zoom, exporting, canUndo, canRedo, mediaAssets, isRecordingVoiceover, dirty, generation, projectPath,
  } = useVideoStore(useShallow((s) => ({
    project: s.project, tl: viewOf(s), playing: s.playing, selectedClipId: s.selectedClipId, selectedIds: s.selectedIds, tool: s.tool, range: s.range, inCompound: s.compoundPath.length > 0,
    zoom: s.zoom, exporting: s.exporting,
    canUndo: s.history.length > 0, canRedo: s.future.length > 0, mediaAssets: s.mediaAssets, isRecordingVoiceover: s.isRecordingVoiceover,
    dirty: s.dirty, generation: s.generation, projectPath: s.projectPath,
  })))
  const {
    setAspect, setProjectName, seek, togglePlay, stepFrame, addClip, addClips, updateClip,
    selectClip, setZoom, toggleTrackMute, toggleTrackLock, toggleTrackHidden, newProject, addMediaAsset, removeMediaAsset,
    relinkAsset, setRecordingVoiceover, undo, redo, setBug, unlinkClip, beginGesture,
  } = getState()
  useClockFormat()
  const wide = useMediaQuery(WIDE_INSPECTOR)

  const [activeTab, setActiveTab] = useState<BinTab>('media')
  const [exportModal, setExportModal] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const noteTimer = useRef<number | null>(null)
  const [autosave, setAutosave] = useState<{ at: number | null; error?: string } | null>(null)
  const [restore, setRestore] = useState<(Snapshot & { name: string; clips: number; projectId: string }) | null>(null)
  const [confirmReplace, setConfirmReplace] = useState<'new' | 'open' | null>(null)
  const [importing, setImporting] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [captionDraft, setCaptionDraft] = useState('')
  const [showKeys, setShowKeys] = useState(false)
  const [pasteAttrs, setPasteAttrs] = useState(false)
  const [markerFocus, setMarkerFocus] = useState<string | null>(null)

  type Drag =
    | { kind: 'playhead' }
    | { kind: 'move'; id: string; startX: number; origStart: number; others: { id: string; start: number }[] }
    | { kind: 'trim' | 'rtrim'; id: string; side: 'left' | 'right'; startX: number }
    | { kind: 'roll'; left: string; right: string; startX: number }
    | { kind: 'slip' | 'slide'; id: string; startX: number; speed: number }
  const drag = useRef<Drag | null>(null)

  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])
  const recordingTimerRef = useRef<number | null>(null)

  const rulerRef = useRef<HTMLDivElement>(null)
  const tracksScrollRef = useRef<HTMLDivElement>(null)
  const lanesRef = useRef<HTMLDivElement>(null)
  const [trackMenu, setTrackMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  // the timeline's height: balanced against the monitor (the monitor gets what its picture can use, the timeline the
  // rest) until the editor drags the divider; then theirs, remembered
  const monitorRef = useRef<HTMLElement>(null)
  const [monitorW, setMonitorW] = useState(0)
  const [viewH, setViewH] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 800))
  const [timelineUser, setTimelineUserState] = useState<number | null>(readTimelineHeight)
  const setTimelineUser = useCallback((h: number | null) => {
    setTimelineUserState(h)
    try { if (h == null) localStorage.removeItem(TL_KEY); else localStorage.setItem(TL_KEY, String(Math.round(h))) } catch { /* private mode */ }
  }, [])
  useEffect(() => {
    const onResize = () => setViewH(window.innerHeight)
    window.addEventListener('resize', onResize)
    const el = monitorRef.current
    const ro = el && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => setMonitorW(el.clientWidth)) : null
    if (el) { ro?.observe(el); setMonitorW(el.clientWidth) }
    return () => { window.removeEventListener('resize', onResize); ro?.disconnect() }
  }, [])
  const binRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const projectInputRef = useRef<HTMLInputElement>(null)

  /** A status-bar note for a few seconds; a newer note replaces it, and opening another project clears it. */
  const flash = useCallback((text: string) => {
    setNote(text)
    if (noteTimer.current) clearTimeout(noteTimer.current)
    noteTimer.current = window.setTimeout(() => setNote(null), 4000)
  }, [])
  useEffect(() => () => { if (noteTimer.current) clearTimeout(noteTimer.current) }, [])

  // ---------------------------------------------------------------- a different project on the desk: release what the old one used
  useEffect(() => {
    if (generation === 0) return
    setNote(null)
    const st = getState()
    const keep = new Set<string>()
    for (const p of [st.project, ...st.history, ...st.future]) for (const c of allClips(p)) if (c.sourceUrl) keep.add(c.sourceUrl)
    for (const a of st.mediaAssets) if (a.url) keep.add(a.url)
    pruneMediaCache(keep)
    releaseFilmstrips(keep)
    audioEngine().releaseSound(keep)
    const urls = new Set<string>()
    for (const c of playable(viewOf(st)).clips) { const u = previewUrl(c); if (u) urls.add(u) }
    previewEngine().forgetClips()
    previewEngine().prune(urls)
  }, [generation])

  // decoders no clip uses any more are released a moment after the edits settle (or a clip moved to its proxy)
  useEffect(() => {
    const eng = previewEngine()
    eng.setPruneSource(() => {
      const st = getState()
      const urls = new Set<string>()
      const clips = new Set<string>()
      for (const c of playable(viewOf(st)).clips) { clips.add(c.id); const u = previewUrl(c); if (u) urls.add(u) }
      return { urls, clips }
    })
    const unsub = useVideoStore.subscribe((s, p) => { if (s.project.clips !== p.project.clips || s.compoundPath !== p.compoundPath) eng.schedulePrune() })
    const offProxy = onProxyReady(() => eng.schedulePrune(4000))
    return () => { unsub(); offProxy(); eng.setPruneSource(null) }
  }, [])

  // a file whose sound cannot be played here says so (once per file), instead of playing silently
  useEffect(() => {
    const audio = audioEngine()
    audio.onUnsupported = ({ url }) => {
      const name = getState().mediaAssets.find((a) => a.url === url)?.name
      flash(`Sound not supported${name ? ` for ${name}` : ''}: its audio cannot be decoded here, so it plays silent.`)
    }
    return () => { audio.onUnsupported = () => {} }
  }, [flash])

  // a fade at the foot of the bin while there is more below (re-measured after each render: tab, rows, inspector)
  useEffect(() => {
    const el = binRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const check = () => { if (el.scrollHeight - el.scrollTop - el.clientHeight > 4) el.setAttribute('data-more', ''); else el.removeAttribute('data-more') }
    check()
    el.addEventListener('scroll', check, { passive: true })
    const ro = new ResizeObserver(check)
    ro.observe(el)
    for (const c of Array.from(el.children)) ro.observe(c)
    return () => { el.removeEventListener('scroll', check); ro.disconnect() }
  })

  // ---------------------------------------------------------------- Autosave and the restore card
  useEffect(() => {
    const stop = startAutosave()
    // a failed autosave is said out loud (once per reason until one succeeds), not only in the status bar
    let told: string | null = null
    const off = onAutosaved((at, error) => {
      setAutosave({ at, error })
      if (error && error !== told) { told = error; flash(`Autosave failed: ${error}. Your work is not saved yet — try Save (Ctrl+S).`) }
      if (!error) told = null
    })
    // a snapshot left from a session that did not save (a crash, a kill) is offered while the desk is still empty
    const st = getState()
    if (!st.project.clips.length && !st.dirty) {
      void latestSnapshot().then((snap) => {
        const d = snap ? describeSnapshot(snap) : null
        if (snap && d && d.clips > 0 && !getState().project.clips.length) setRestore({ ...snap, ...d })
      })
    }
    return () => { off(); stop() }
  }, [])

  const restoreSnapshot = async () => {
    if (!restore) return
    const r = await loadProjectText(restore.text, { path: null, dirty: true })
    setRestore(null)
    if (r.stale) return
    if (!r.ok) { flash('That snapshot could not be read.'); return }
    flash(r.missing ? `Restored. ${r.missing} media file${r.missing === 1 ? ' is' : 's are'} missing — relink in Media.` : 'Restored the unsaved video')
  }
  const discardSnapshot = async () => { if (restore) await clearSnapshots(restore.projectId); setRestore(null) }

  // ---------------------------------------------------------------- Keyboard (one listener; it reads the latest state when a key comes)
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  useEffect(() => {
    keyRef.current = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable) return
      if (document.querySelector('.modal-bg')) return
      // a focused keyframe diamond handles its own Delete and Enter
      if (target.closest?.('.vw-kf-lane') && (e.key === 'Delete' || e.key === 'Backspace' || e.key === 'Enter')) return
      const st = getState()
      const ctrl = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      const tool = !ctrl && !e.altKey && !e.shiftKey ? TOOLS.find((t) => t.key.toLowerCase() === k) : undefined
      if (e.code === 'Space') { e.preventDefault(); st.togglePlay() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); st.stepFrame(e.shiftKey ? -10 : -1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); st.stepFrame(e.shiftKey ? 10 : 1) }
      else if (k === 's' && ctrl) { e.preventDefault(); void doSave(e.shiftKey) }
      else if (k === 's' && !ctrl) { e.preventDefault(); st.splitAtPlayhead() }
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!st.selectedClipId) return
        e.preventDefault()
        if (e.shiftKey || st.tool === 'ripple') { if (!st.rippleDeleteSelected()) flash('Ripple delete would move a clip on a locked track (or split a linked pair). Unlock it first.') }
        else removeSelected()
      }
      else if (e.key === 'Home') { e.preventDefault(); st.seek(0) }
      else if (e.key === 'End') { e.preventDefault(); st.seek(contentEnd(view())) }
      else if (ctrl && k === 'z') { e.preventDefault(); if (e.shiftKey) st.redo(); else st.undo() }
      else if (ctrl && k === 'y') { e.preventDefault(); st.redo() }
      else if (ctrl && e.altKey && k === 'v') { e.preventDefault(); setPasteAttrs(true) }
      else if (ctrl && k === 'c') { if (st.selectedClipId) { e.preventDefault(); const n = st.copySelected(); flash(`Copied ${n} clip${n === 1 ? '' : 's'}`) } }
      else if (ctrl && k === 'v') { e.preventDefault(); if (!st.clipboard) flash('Nothing copied yet (Ctrl+C on a clip).'); else if (!st.pasteClips()) flash('Could not paste there (a locked track).') }
      else if (ctrl && e.altKey && k === 'g') { e.preventDefault(); { const why = st.compoundIssue(); if (why || !st.compoundSelected()) flash(why ?? 'Select clips on unlocked tracks to make a compound clip.') } }
      else if (ctrl && e.shiftKey && k === 'g') { e.preventDefault(); if (!st.ungroupSelected()) flash('No group in the selection.') }
      else if (ctrl && k === 'g') { e.preventDefault(); if (!st.groupSelected()) flash('Shift+click two or more clips to group them.') }
      else if (ctrl && k === 'm') { e.preventDefault(); st.toggleMagnetic(); flash(getState().project.magnetic ? 'Magnetic main track on: V1 closes its gaps' : 'Magnetic main track off') }
      else if (ctrl) return
      else if (k === 'm' && e.shiftKey) { e.preventDefault(); st.jumpMarker(1) }
      else if (k === 'm' && e.altKey) { e.preventDefault(); st.jumpMarker(-1) }
      else if (k === 'm') { e.preventDefault(); st.addMarker() }
      else if (k === 'x' && e.altKey) { e.preventDefault(); st.setRangeIn(null); st.setRangeOut(null) }
      else if (e.altKey) return
      else if (k === 'j' || k === 'k' || k === 'l') { e.preventDefault(); st.shuttle(k) }
      else if (k === 'i') { e.preventDefault(); st.setRangeIn(st.currentTime) }
      else if (k === 'o') { e.preventDefault(); st.setRangeOut(st.currentTime) }
      else if (e.key === ';') { e.preventDefault(); if (!st.lift()) flash('Set in and out (I, O) or select a clip to lift.') }
      else if (e.key === APOSTROPHE) { e.preventDefault(); if (!st.extract()) flash('Set in and out (I, O) or select a clip to extract.') }
      else if (e.key === '?') { e.preventDefault(); setShowKeys(true) }
      else if (e.key === 'Enter') { const c = view().clips.find((x) => x.id === st.selectedClipId); if (c?.compound) { e.preventDefault(); st.openCompound(c.id) } }
      else if (e.key === 'Escape') { if (st.compoundPath.length && !document.querySelector('.popover')) { e.preventDefault(); st.closeCompound() } else if (st.selectedClipId) st.selectClip(null) }
      else if (tool) { e.preventDefault(); st.setTool(tool.id) }
    }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const removeSelected = () => {
    const st = getState()
    if (st.selectedClipId && groupLocked(view(), st.selectedClipId)) { flash('That clip is on a locked track (or linked to one). Unlock it first.'); return }
    st.deleteSelectedClip()
  }

  // ---------------------------------------------------------------- Pointer: scrub, move, trim and the tools (one undo step per gesture)
  const timeAt = (clientX: number) => {
    const rect = rulerRef.current?.getBoundingClientRect()
    const st = getState()
    return rect ? Math.max(0, Math.min(view().duration, (clientX - rect.left) / st.zoom)) : st.currentTime
  }
  const onRulerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    drag.current = { kind: 'playhead' }
    getState().seek(timeAt(e.clientX), true)
  }, [])
  const onGrab = useCallback<ClipGrab>((e, clip, what) => {
    e.stopPropagation()
    if (e.button !== 0) return
    const st = getState()
    const v = view()
    // Shift / Ctrl+click adds to (or takes from) the selection; it does not drag
    if (e.shiftKey || e.ctrlKey || e.metaKey) { st.selectClip(clip.id, 'toggle'); return }
    const keepMulti = st.selectedIds.length > 1 && st.selectedIds.includes(clip.id) && what === 'move'
    if (keepMulti) useVideoStore.setState({ selectedClipId: clip.id, selectedIds: [clip.id, ...st.selectedIds.filter((x) => x !== clip.id)] })
    else st.selectClip(clip.id)
    if (groupLocked(v, clip.id)) return
    const tool = st.tool
    if (what === 'move') {
      if (tool === 'slip' && clip.srcDuration != null) { st.beginGesture(); drag.current = { kind: 'slip', id: clip.id, startX: e.clientX, speed: constantSpeed(clip) }; return }
      if (tool === 'slide') { st.beginGesture(); drag.current = { kind: 'slide', id: clip.id, startX: e.clientX, speed: 1 }; return }
      st.beginGesture()
      const others = keepMulti ? getState().selectedIds.filter((x) => x !== clip.id).map((id) => ({ id, start: v.clips.find((c) => c.id === id)?.start ?? 0 })) : []
      drag.current = { kind: 'move', id: clip.id, startX: e.clientX, origStart: clip.start, others }
      return
    }
    if (tool === 'roll') {
      const n = neighbours(v, clip.id)
      const pair = what === 'right' ? (n.next ? { left: clip.id, right: n.next.id } : null) : (n.prev ? { left: n.prev.id, right: clip.id } : null)
      if (pair) { st.beginGesture(); drag.current = { kind: 'roll', ...pair, startX: e.clientX }; return }
    }
    st.beginGesture()
    drag.current = { kind: tool === 'ripple' ? 'rtrim' : 'trim', id: clip.id, side: what, startX: e.clientX }
  }, [])
  const onOpenClip = useCallback((clip: Clip) => { if (clip.compound) getState().openCompound(clip.id) }, [])
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const st = getState()
      const v = view()
      const frame = 1 / (v.fps || 30)
      if (d.kind === 'playhead') st.seek(timeAt(e.clientX))
      else if (d.kind === 'move') {
        const lane = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('.vw-track-lane')
        const clip = v.clips.find((c) => c.id === d.id)
        const to = lane?.dataset.trackId && clip && lane.dataset.trackId !== clip.trackId && canPlaceOn(v, clip, lane.dataset.trackId) ? lane.dataset.trackId : undefined
        const dt = (e.clientX - d.startX) / st.zoom
        st.moveClip(d.id, Math.max(0, d.origStart + dt), to)
        for (const o of d.others) st.moveClip(o.id, Math.max(0, o.start + dt))
      }
      else if (d.kind === 'trim' || d.kind === 'rtrim') {
        const dt = (e.clientX - d.startX) / st.zoom
        if (Math.abs(dt) >= (d.kind === 'rtrim' ? frame : 0.1)) {
          if (d.kind === 'rtrim') st.rippleTrimDelta(d.id, d.side, dt)
          else if (d.side === 'left') st.trimClipLeftDelta(d.id, dt)
          else st.trimClipRightDelta(d.id, dt)
          d.startX = e.clientX
        }
      }
      else {
        const dt = (e.clientX - d.startX) / st.zoom
        if (Math.abs(dt) < frame) return
        if (d.kind === 'roll') st.rollDelta(d.left, d.right, dt)
        // slip: dragging right shows earlier content (the picture moves with the pointer)
        else if (d.kind === 'slip') st.slipDelta(d.id, -dt * d.speed)
        else st.slideDelta(d.id, dt)
        d.startX = e.clientX
      }
    }
    // a gesture ends on release anywhere (a slider in the inspector starts one too)
    const up = () => { drag.current = null; getState().endGesture() }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up) }
  }, [])

  /** A bin item dropped on a lane: at the drop time, on that lane when it takes the clip, by the edit mode. */
  const onDropAsset = useCallback((e: React.DragEvent) => {
    const id = e.dataTransfer.getData(ASSET_MIME)
    if (!id) return
    e.preventDefault()
    const st = getState()
    const asset = st.mediaAssets.find((a) => a.id === id)
    if (!asset) return
    if (asset.missing) { flash(`${asset.name} is missing. Relink it first.`); return }
    const v = view()
    const t = Math.round(timeAt(e.clientX) * v.fps) / v.fps
    const lane = (e.target as HTMLElement).closest<HTMLElement>('.vw-track-lane')?.dataset.trackId
    const laneKind = v.tracks.find((x) => x.id === lane)?.kind
    const clips = clipsForAsset(v, asset, t, asset.type === 'image' && laneKind === 'overlay' ? 'overlay' : 'auto')
    if (!clips.length) return
    const shift = t - clips[0].start
    const placed = clips.map((c, i) => ({ ...c, start: c.start + shift, trackId: i === 0 && lane && canPlaceOn(v, c, lane) ? lane : c.trackId }))
    if (!st.placeClips(placed)) flash('Could not drop there: the track is locked.')
    else flash(`${st.editMode === 'insert' ? 'Inserted' : 'Placed'} ${asset.name} at ${formatShortTime(t)}`)
  }, [flash])

  // ---------------------------------------------------------------- Import
  const addAssets = (assets: (MediaAsset | null)[]) => {
    const ok = assets.filter((a): a is MediaAsset => !!a)
    ok.forEach(addMediaAsset)
    const errors = takeImportErrors()
    if (ok.length) { setActiveTab('media'); selectClip(null); flash(`Imported ${ok.length} file${ok.length === 1 ? '' : 's'}${errors.length ? ` · ${errors.length} not: ${errors[0]}` : ''}`) }
    else if (errors.length) flash(`Not imported: ${errors[0]}`)
    return ok
  }
  const importFromDialog = async () => {
    const b = videoBridge()
    if (!b?.videoImport) { fileInputRef.current?.click(); return }
    setImporting(true)
    try { addAssets(await mapLimit(await b.videoImport(importOptions()), PROBE_CONCURRENCY, (e) => assetFromEntry(e))) } catch (e) { flash('Could not import: ' + String((e as Error).message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) } finally { setImporting(false) }
  }
  const importFiles = async (files: FileList | File[] | null) => {
    if (!files || !files.length) return
    setImporting(true)
    try {
      const b = videoBridge()
      // desktop: a dropped file is recorded by its real path (the preload reads it from the File), so it survives a restart
      if (b?.videoImportDropped) addAssets(await mapLimit(await b.videoImportDropped(Array.from(files), importOptions()), PROBE_CONCURRENCY, (e) => assetFromEntry(e)))
      else addAssets(await mapLimit(Array.from(files), PROBE_CONCURRENCY, assetFromFile))
    } finally {
      setImporting(false)
    }
  }

  const addAssetToTimeline = (asset: MediaAsset, as: 'auto' | 'overlay' = 'auto') => {
    if (asset.missing) { flash(`${asset.name} is missing. Relink it first.`); return }
    const st = getState()
    addClips(clipsForAsset(view(), asset, st.currentTime, as))
  }

  const relink = async (asset: MediaAsset) => {
    const b = videoBridge()
    if (!b?.videoRelink) { flash('Relinking needs the desktop app. Import the file again here.'); return }
    const e = await b.videoRelink(asset.name)
    if (!e) return
    const p = await probeMedia(e.url, asset.type)
    if (asset.url) { dropCachedMedia(asset.url); previewEngine().dropSource(asset.url) }
    relinkAsset(asset.id, { url: e.url, path: e.path, size: e.size, mtimeMs: e.mtimeMs, name: e.name, duration: p.duration || asset.duration, width: p.width ?? asset.width, height: p.height ?? asset.height, hasAudio: p.hasAudio ?? asset.hasAudio, thumbnailUrl: asset.type === 'image' ? e.url : p.thumbnailUrl })
    patchMeta(asset.id, { storage: 'reference', file: undefined })
    flash(`Relinked ${e.name}`)
  }

  // ---------------------------------------------------------------- Microphone Voiceover Recording
  const handleStartVoiceover = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      recordedChunksRef.current = []
      const startedAt = performance.now()
      const at = getState().currentTime
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data) }
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
        setRecordingVoiceover(false)
        setRecordingSeconds(0)
        const blob = new Blob(recordedChunksRef.current, { type: rec.mimeType || 'audio/webm' })
        const dur = Math.max(1, Math.round((performance.now() - startedAt) / 100) / 10)
        const name = `Voiceover ${fmtTime(Date.now(), { seconds: true })}`
        // the take is written to disk (desktop) before it goes on the timeline, so a save or a crash restore keeps it
        void keepTake(blob, name, dur).then(({ asset, onDisk, error }) => {
          addMediaAsset(asset)
          addClip({ id: `clip-vo-${Date.now()}`, trackId: trackForKind(view(), 'audio') ?? 'a1', title: name, kind: 'audio', start: at, duration: dur, in: 0, out: dur, color: '#7c3aed', sourceUrl: asset.url, mediaAssetId: asset.id, srcDuration: dur })
          if (!onDisk && hasDiskMedia()) flash(`The voiceover could not be written to disk (${error ?? 'unknown error'}); it plays this session only.`)
        })
      }
      rec.start()
      mediaRecorderRef.current = rec
      setRecordingVoiceover(true)
      setRecordingSeconds(0)
      recordingTimerRef.current = window.setInterval(() => setRecordingSeconds((n) => n + 1), 1000)
    } catch (err) {
      flash('Could not use the microphone: ' + (err as Error).message)
      setRecordingVoiceover(false)
    }
  }
  const handleStopVoiceover = () => { if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop() }
  // leaving the desk stops a voiceover still recording (its timer and microphone)
  useEffect(() => () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
    const rec = mediaRecorderRef.current
    if (rec && rec.state !== 'inactive') { rec.onstop = null; rec.stop(); rec.stream.getTracks().forEach((t) => t.stop()) }
  }, [])

  // ---------------------------------------------------------------- Project: new, open, save
  const doSave = async (saveAs = false): Promise<boolean> => {
    try {
      const where = await saveProject(saveAs)
      if (where) flash(hasDiskMedia() ? `Saved ${where.split(/[\\/]/).pop()}` : 'Project downloaded')
      return !!where
    } catch (e) {
      flash('Could not save: ' + ((e as Error).message || 'unknown error'))
      return false
    }
  }
  const hasWork = () => { const st = getState(); return st.dirty && (st.project.clips.length > 0 || st.mediaAssets.some((a) => !a.removed)) }
  const openNow = async () => {
    const b = videoBridge()
    if (!b?.videoOpenProject) { projectInputRef.current?.click(); return }
    let r: { path: string; text: string; folder?: FolderRef } | null = null
    try { r = await b.videoOpenProject() } catch (e) { flash('Could not open: ' + String((e as Error).message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); return }
    if (!r) return
    const res = await loadProjectText(r.text, { path: r.path, dirty: false, folder: r.folder ?? null })
    if (res.stale) return
    if (!res.ok) { flash(res.error ?? 'That file is not a video project.'); return }
    setRestore(null)
    flash(res.missing ? `Opened. ${res.missing} media file${res.missing === 1 ? ' is' : 's are'} missing — relink in Media.` : 'Project opened')
  }
  const openFromInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    void file.text().then(async (text) => {
      const res = await loadProjectText(text, { path: null, dirty: false })
      if (res.stale) return
      if (!res.ok) flash('That file is not a video project.')
      else flash(res.missing ? `Opened. ${res.missing} media file${res.missing === 1 ? ' is' : 's are'} not in this browser session — import them again.` : 'Project opened')
    })
  }
  // New and Open replace the desk: with unsaved work they ask first (the work's autosave is kept either way)
  const doNew = () => { if (hasWork()) setConfirmReplace('new'); else newProject() }
  const doOpen = () => { if (hasWork()) setConfirmReplace('open'); else void openNow() }
  const replaceNow = (kind: 'new' | 'open') => { if (kind === 'new') newProject(); else void openNow() }

  // ---------------------------------------------------------------- Overlays and captions
  const handleAddOverlay = (type: OverlayTemplate, tag: string) => {
    const color = OVERLAY_PRESETS.find((p) => p.type === type)?.color ?? '#10b981'
    const p = view()
    const clip: Clip = { id: `clip-ov-${Date.now().toString(36)}`, trackId: trackForKind(p, 'overlay') ?? (type !== 'logo' ? trackForKind(p, 'text') : undefined) ?? 'v2', title: tag, kind: 'overlay', start: getState().currentTime, duration: 5, in: 0, out: 5, color, overlayType: type }
    if (type !== 'logo') { clip.overlayText = ''; clip.overlaySub = '' }
    addClip(clip)
  }
  const handleAddCaption = () => {
    const text = captionDraft.trim()
    const p = view()
    addClip({ id: `clip-cap-${Date.now().toString(36)}`, trackId: trackForKind(p, 'caption') ?? trackForKind(p, 'text') ?? 'c1', title: text ? text.slice(0, 40) : 'Caption', kind: 'caption', start: getState().currentTime, duration: 4.5, in: 0, out: 4.5, color: '#f59e0b', captionText: text })
    setCaptionDraft('')
  }

  const selectedClip = tl.clips.find((c) => c.id === selectedClipId)
  const binAssets = mediaAssets.filter((a) => !a.removed || a.missing)
  const missingAssets = mediaAssets.filter((a) => a.missing)
  const empty = tl.clips.length === 0 && !inCompound
  const length = contentEnd(tl)
  // the room under the header and over the status bar, shared by the monitor row and the timeline
  const room = Math.max(320, viewH - HEADER_H - STATUS_H)
  const tlMax = Math.max(TL_MIN, room - MONITOR_MIN)
  const tlAuto = monitorW > 0 ? Math.min(room * 0.55, Math.max(TL_AUTO_MIN, room - (monitorW / (project.width / project.height) + MONITOR_CHROME))) : TL_AUTO_MIN
  // the keyframe lane under a selected animated clip adds a row: the balanced height grows by it (room allowing)
  const timelineH = Math.round(Math.max(TL_MIN, Math.min(tlMax, timelineUser ?? tlAuto + (kfClipOf(tl.clips, selectedIds) ? KF_LANE_H : 0))))
  const showTab = (t: BinTab) => { setActiveTab(t); selectClip(null) }
  const kfClip = kfClipOf(tl.clips, selectedIds)
  const labels = trackLabels(tl.tracks)
  const editMode = useVideoStore((s) => s.editMode)

  const inspector = selectedClip && (
    <ClipInspector
      clip={selectedClip}
      locked={groupLocked(tl, selectedClip.id)}
      onChange={updateClip}
      onDelete={removeSelected}
      onClose={() => selectClip(null)}
      onUnlink={() => unlinkClip(selectedClip.id)}
      onGestureStart={beginGesture}
      closeLabel={wide ? 'Close the inspector' : 'Back to the bin'}
      linkedWith={selectedClip.linkId ? tl.clips.find((c) => c.linkId === selectedClip.linkId && c.id !== selectedClip.id) : undefined}
      flash={flash}
      selectionCount={selectedIds.length}
    />
  )

  return (
    <div className="video-workspace">
      <PlaybackEngine />
      <ReverseShuttle />
      <input type="file" ref={fileInputRef} multiple accept="video/*,audio/*,image/*" style={{ display: 'none' }} onChange={(e) => { void importFiles(e.target.files ? Array.from(e.target.files) : null); e.target.value = '' }} />
      <input type="file" ref={projectInputRef} accept=".esbvideo" style={{ display: 'none' }} onChange={openFromInput} />

      {/* 1. Header */}
      <header className="vw-header">
        <WorkspaceSwitcher />
        <div className="vw-brand">
          <input type="text" className="vw-title-input" value={project.name} onChange={(e) => setProjectName(e.target.value)} aria-label="Project name" data-tip="Project name" />
        </div>
        <div className="vw-aspect">
          <Select
            value={project.aspect}
            options={[
              // the ratio alone is the label, so the closed picker never cuts a word at 900 px; the use is the hint
              { value: '16:9', label: '16:9', hint: 'Landscape · 1920×1080' },
              { value: '9:16', label: '9:16', hint: 'Reels, Shorts · 1080×1920' },
              { value: '1:1', label: '1:1', hint: 'Square · 1080×1080' },
              { value: '4:5', label: '4:5', hint: 'Facebook feed · 1080×1350' },
            ]}
            onChange={(v) => setAspect(v as AspectRatio)}
            className="compact"
          />
        </div>
        <HeaderTimecode />
        <div className="vw-header-actions">
          <div className="pillbar">
            <IconButton icon="undo" tip="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo} />
            <IconButton icon="redo" tip="Redo (Ctrl+Y)" disabled={!canRedo} onClick={redo} />
          </div>
          <button type="button" className="btn sm subtle vw-new" onClick={doNew} data-tip="New empty video"><Icon name="filePlus" size={13} /><span className="vw-lbl">New</span></button>
          <button type="button" className="btn sm subtle vw-open" onClick={doOpen} data-tip="Open a video project (.esbvideo)"><Icon name="folder" size={13} /><span className="vw-lbl">Open</span></button>
          <button type="button" className="btn sm subtle vw-save" onClick={() => void doSave()} data-tip="Save the project (Ctrl+S)"><Icon name="download" size={13} /><span className="vw-lbl">Save</span></button>
          {isRecordingVoiceover ? (
            <button type="button" className="btn danger sm" onClick={handleStopVoiceover} data-tip="Stop recording"><span className="vw-recording-dot" />Stop ({recordingSeconds}s)</button>
          ) : (
            <button type="button" className="btn sm subtle" onClick={() => void handleStartVoiceover()} data-tip="Record a voiceover from the microphone"><Icon name="mic" size={13} /><span className="vw-lbl">Record</span></button>
          )}
          <button type="button" className="btn primary sm" onClick={() => setExportModal(true)} disabled={exporting}>
            <Icon name="download" size={14} /> {exporting ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </header>

      {/* 2. Bin + monitor (+ inspector) */}
      <div className={`vw-stage-row${selectedClip && wide ? ' with-inspector' : ''}`}>
        <aside className="vw-bin-panel">
          {selectedClip && !wide ? (
            // narrow windows: the inspector holds the bin's place, and this bar says so (and goes back)
            <div className="vw-bin-back" role="navigation" aria-label="Clip inspector">
              <button type="button" className="btn sm subtle vw-back-bin" onClick={() => selectClip(null)} data-tip={`Back to ${BIN_TAB_LABEL[activeTab]} (Esc)`}><Icon name="chevLeft" size={13} />{BIN_TAB_LABEL[activeTab]}</button>
              <span className="vw-bin-back-title">Clip inspector</span>
            </div>
          ) : (
            <Tabs<BinTab>
              value={activeTab}
              onChange={showTab}
              options={(Object.keys(BIN_TAB_LABEL) as BinTab[]).map((value) => ({ value, label: BIN_TAB_LABEL[value] }))}
            />
          )}

          {selectedClip && !wide ? (
            <div className="vw-bin-content vw-inspector-host" ref={binRef}>{inspector}</div>
          ) : (
            <div className="vw-bin-content" ref={binRef}>
              {activeTab === 'media' && (
                <div className="vw-media-bin">
                  <button
                    type="button"
                    className={`vw-dropzone${dragOver ? ' dragover' : ''}`}
                    onClick={() => void importFromDialog()}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => { e.preventDefault(); setDragOver(false); void importFiles(Array.from(e.dataTransfer.files)) }}
                  >
                    <span className="vw-dropzone-icon"><Icon name="upload" size={18} /></span>
                    <p>{importing ? 'Reading files…' : 'Import media'}</p>
                    <span>Click or drop video, audio or pictures · MP4, MOV, WebM, MP3, WAV, PNG, JPG</span>
                  </button>
                  <BinImportMode />
                  <BinMissingBar missing={missingAssets.length} onRelinked={(n) => flash(`Relinked ${n} file${n === 1 ? '' : 's'}`)} />
                  {binAssets.map((asset) => <BinCard key={asset.id} asset={asset} onAdd={addAssetToTimeline} onRelink={relink} onRemove={removeMediaAsset} />)}
                  {!hasDiskMedia() && binAssets.length > 0 && <p className="vw-bin-note"><Icon name="info" size={12} />Browser preview: files last this session only.</p>}
                </div>
              )}

              {activeTab === 'titles' && <TitlesTab bug={project.bug !== false} onBug={setBug} onAddLogo={() => handleAddOverlay('logo', 'Logo')} />}

              {activeTab === 'captions' && (
                <div className="vw-preset-list">
                  <div className="vw-preset-card vw-caption-card">
                    <div className="vw-preset-header">
                      <span className="vw-tag" data-tag="caption">Caption</span>
                      <button type="button" className="btn xs vw-caption-add" onClick={handleAddCaption}><Icon name="plus" size={12} />Add</button>
                    </div>
                    <textarea className="vw-caption-input" value={captionDraft} placeholder="Caption text (Bangla or English)" rows={3} onChange={(e) => setCaptionDraft(e.target.value)} aria-label="Caption text" />
                    <p className="vw-preset-desc">Adds a caption at the playhead on C1, held 4.5 s. Leave it empty to type it later in the inspector.</p>
                  </div>
                </div>
              )}

              {activeTab === 'story' && <StoryVideoPanel />}
              {activeTab === 'data' && <DataPanel />}
              {activeTab === 'audio' && (
                <div className="vw-preset-list">
                  <div className="vw-preset-card">
                    <div className="vw-preset-header">
                      <span className="vw-tag" data-tag="voice">Voiceover</span>
                      {isRecordingVoiceover ? (
                        <button type="button" className="btn xs danger" onClick={handleStopVoiceover}>Stop ({recordingSeconds}s)</button>
                      ) : (
                        <button type="button" className="btn xs" onClick={() => void handleStartVoiceover()}><Icon name="mic" size={12} />Record</button>
                      )}
                    </div>
                    <p className="vw-preset-desc">Records narration to A1 at the playhead{hasDiskMedia() ? ' and keeps the take with the app' : ''}. Footage sound arrives on A1 by itself when a clip is added.</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </aside>

        <section className="vw-monitor-panel" ref={monitorRef}>
          <div className="vw-monitor-container">
            <Monitor aspect={project.width / project.height} />
            {empty && (
              <div className="vw-start" role="group" aria-label="Start a video">
                {restore ? (
                  <div className="vw-start-card vw-restore-card">
                    <div className="vw-start-icon"><Icon name="refresh" size={18} /></div>
                    <b>Restore unsaved video</b>
                    <p>“{restore.name}” · {restore.clips} clip{restore.clips === 1 ? '' : 's'} · autosaved {fmtTime(restore.at)}</p>
                    <div className="vw-start-actions">
                      <button type="button" className="btn vw-restore-discard" onClick={() => void discardSnapshot()}>Discard</button>
                      <button type="button" className="btn primary vw-restore-go" onClick={() => void restoreSnapshot()}><Icon name="undo" size={14} />Restore</button>
                    </div>
                  </div>
                ) : (
                  <div className="vw-start-card">
                    <div className="vw-start-icon"><Icon name="video" size={18} /></div>
                    <b>Start a video</b>
                    <p>Bring in footage, sound and pictures, or cut a first version from the story on the Editorial desk.</p>
                    <div className="vw-start-actions">
                      <button type="button" className="btn primary vw-start-import" onClick={() => void importFromDialog()}><Icon name="upload" size={14} />Import media</button>
                      <button type="button" className="btn vw-start-story" onClick={() => showTab('story')}><Icon name="newspaper" size={14} />Build from story</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="vw-transport">
            <IconButton icon="skipBack" tip="Jump to start (Home)" onClick={() => seek(0)} />
            <IconButton icon="chevLeft" tip="Back one frame (←)" onClick={() => stepFrame(-1)} />
            <button type="button" className={`btn primary sm play-btn ${playing ? 'playing' : ''}`} onClick={togglePlay} data-tip="Play / Pause (Space)">
              <Icon name={playing ? 'pause' : 'play'} size={13} />{playing ? 'Pause' : 'Play'}
            </button>
            <IconButton icon="chevRight" tip="Forward one frame (→)" onClick={() => stepFrame(1)} />
            <IconButton icon="skipForward" tip="Jump to end (End)" onClick={() => seek(length)} />
            <div className="vw-transport-sep" />
            <TransportTime />
          </div>
        </section>

        {selectedClip && wide && <aside className="vw-inspector-panel" aria-label="Clip inspector">{inspector}</aside>}
      </div>

      {/* 3. Timeline */}
      <footer className={`vw-timeline-footer${inCompound ? ' in-compound' : ''}`} style={{ height: `${timelineH}px` }}>
        <TimelineResizer height={timelineH} min={TL_MIN} max={tlMax} onChange={setTimelineUser} />
        <CompoundBar />
        <div className="vw-timeline-toolbar">
          <div className="vw-tl-tools-left">
            <SplitButton />
            <button type="button" className="btn sm subtle vw-delete" disabled={!selectedClipId} onClick={removeSelected} aria-label="Delete the selected clip" data-tip={selectedClipId ? 'Delete the selected clip (Del · Shift+Del closes the gap)' : 'Delete: select a clip first (Del · Shift+Del closes the gap)'}><Icon name="trash" size={13} /><span className="vw-del-lbl">Delete</span></button>
            <span className="vw-tl-sep" />
            <ToolMenu />
            <IconButton icon="magnet" className={`vw-magnet${project.magnetic ? ' on' : ''}`} active={!!project.magnetic} tip={project.magnetic ? 'Magnetic main track is on: V1 closes its gaps (Ctrl+M)' : 'Magnetic main track: V1 closes its gaps (Ctrl+M)'} onClick={() => { getState().toggleMagnetic(); flash(getState().project.magnetic ? 'Magnetic main track on: V1 closes its gaps' : 'Magnetic main track off') }} />
          </div>
          <div className="vw-tl-tools-right">
            <MarkersButton focusId={markerFocus} onFocusDone={() => setMarkerFocus(null)} />
            <MenuButton label="Track" icon="plus" className="sm subtle vw-add-track" menuClassName="vw-solid vw-add-track-menu" items={ADD_TRACK.map((k) => ({ label: `${TRACK_KIND_LABEL[k]} track`, icon: ADD_ICON[k], hint: ADD_HINT[k], onClick: () => { const id = getState().addTrack(k); const lb = trackLabels(view().tracks).get(id); flash(`Added ${lb ? `${lb.code} · ${lb.name}` : TRACK_KIND_LABEL[k]}`) } }))} align="end" />
            <span className="vw-tl-sep" />
            <IconButton icon="minus" tip="Zoom out" onClick={() => setZoom(zoom - 10)} />
            <span className="vw-zoom-label mono">{zoom} px/s</span>
            <IconButton icon="plus" tip="Zoom in" onClick={() => setZoom(zoom + 10)} />
            <IconButton icon="keyboard" className="vw-keys-btn" tip="Keyboard shortcuts (?)" onClick={() => setShowKeys(true)} />
          </div>
        </div>

        <div className="vw-tracks-scroll" ref={tracksScrollRef}>
          <div className="vw-track-headers">
            <div className="vw-ruler-header">{inCompound ? 'Compound' : 'Tracks'}</div>
            {tl.tracks.map((t) => { const lb = labels.get(t.id) ?? { code: t.id.toUpperCase(), name: TRACK_KIND_LABEL[t.kind] }; return (
              <Fragment key={t.id}>
                <div className={`vw-track-head${t.hidden ? ' hidden' : ''}`} data-track-id={t.id}>
                  <span className="vw-th-title" data-tip={`${lb.code} · ${lb.name} (${TRACK_KIND_LABEL[t.kind].toLowerCase()} track)`}><b>{lb.code}</b>{lb.name}</span>
                  <div className="vw-th-actions">
                    {t.kind === 'audio' ? (
                      <button type="button" className={`vw-th-btn ${t.muted ? 'active' : ''}`} onClick={() => toggleTrackMute(t.id)} aria-label={`${t.muted ? 'Unmute' : 'Mute'} ${lb.code}`} aria-pressed={!!t.muted} data-tip={t.muted ? 'Unmute track' : 'Mute track'}>
                        <Icon name={t.muted ? 'volumeX' : 'volume'} size={13} />
                      </button>
                    ) : (
                      <button type="button" className={`vw-th-btn vw-th-hide ${t.hidden ? 'active' : ''}`} onClick={() => toggleTrackHidden(t.id)} aria-label={`${t.hidden ? 'Show' : 'Hide'} ${lb.code}`} aria-pressed={!!t.hidden} data-tip={t.hidden ? 'Show track (drawn again)' : 'Hide track (not drawn or exported)'}>
                        <Icon name={t.hidden ? 'eyeOff' : 'eye'} size={13} />
                      </button>
                    )}
                    <button type="button" className={`vw-th-btn ${t.locked ? 'active' : ''}`} onClick={() => toggleTrackLock(t.id)} aria-label={`${t.locked ? 'Unlock' : 'Lock'} ${lb.code}`} aria-pressed={!!t.locked} data-tip={t.locked ? 'Unlock track' : 'Lock track'}>
                      <Icon name={t.locked ? 'lock' : 'unlock'} size={13} />
                    </button>
                    <button type="button" className={`vw-th-btn vw-th-more${trackMenu?.id === t.id ? ' open' : ''}`} aria-expanded={trackMenu?.id === t.id} aria-haspopup="menu" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setTrackMenu((m) => (m?.id === t.id ? null : { id: t.id, x: r.left, y: r.bottom + 4 })) }} aria-label={`More for ${lb.code}`} data-tip="Move or remove the track">
                      <Icon name="more" size={13} />
                    </button>
                  </div>
                </div>
                {kfClip && kfClip.trackId === t.id && <KeyframeHead clip={kfClip} />}
              </Fragment>
            ) })}
          </div>

          <div className="vw-lanes-area" style={{ width: `${tl.duration * zoom + 300}px` }}>
            <Ruler duration={tl.duration} zoom={zoom} onPointerDown={onRulerDown} rulerRef={rulerRef} markers={tl.markers} range={range} onOpenMarker={setMarkerFocus} />
            <Playhead zoom={zoom} />
            <Lanes tracks={tl.tracks} clips={tl.clips} selectedIds={selectedIds} zoom={zoom} tool={tool} onGrab={onGrab} onOpen={onOpenClip} lanesRef={lanesRef} onDropAsset={onDropAsset} />
            <LaneVisuals scrollerRef={tracksScrollRef} lanesRef={lanesRef} />
          </div>
        </div>
        <TracksBelowCue scrollerRef={tracksScrollRef} count={tl.tracks.length} />
      </footer>

      <footer className="statusbar vw-statusbar">
        <span>{tl.clips.length} {tl.clips.length === 1 ? 'clip' : 'clips'} · {tl.tracks.length} tracks</span>
        {selectedClip && <><span className="sep" /><span className="vw-sb-sel">{selectedIds.length > 1 ? `${selectedIds.length} clips selected` : clipLabel(selectedClip)}</span></>}
        {note && <><span className="sep" /><span className="vw-sb-note">{note}</span></>}
        <div className="spacer" />
        <span className="muted vw-sb-tool" data-tip="Tool · drop and paste mode">{TOOLS.find((x) => x.id === tool)?.label} · {editMode === 'insert' ? 'Insert' : 'Overwrite'}{project.magnetic ? ' · Magnetic' : ''}</span>
        <span className="sep" />
        <span className={`muted vw-sb-save${autosave?.error && dirty ? ' failed' : ''}`} data-tip={autosave?.error && dirty ? `Autosave failed: ${autosave.error}` : undefined}>
          {dirty ? (autosave?.error ? 'Unsaved · autosave failed' : autosave?.at ? `Unsaved · autosaved ${fmtTime(autosave.at, { seconds: true })}` : 'Unsaved') : empty && !projectPath ? 'New video' : 'Saved'}
        </span>
        <span className="sep" />
        <span className="muted">{project.width} × {project.height} · {project.fps} fps · {formatShortTime(length)}</span>
      </footer>

      {trackMenu && (() => {
        const st = { project: view() }
        const i = st.project.tracks.findIndex((t) => t.id === trackMenu.id)
        const t = st.project.tracks[i]
        if (!t) return null
        const n = st.project.clips.filter((c) => c.trackId === t.id).length
        const items: MenuEntry[] = [
          { heading: (() => { const lb = trackLabels(st.project.tracks).get(t.id); return lb ? `${lb.code} · ${lb.name}` : t.name })() },
          { label: 'Move up', icon: 'chevUp', disabled: i === 0, onClick: () => getState().moveTrack(t.id, i - 1) },
          { label: 'Move down', icon: 'chevDown', disabled: i === st.project.tracks.length - 1, onClick: () => getState().moveTrack(t.id, i + 1) },
          { divider: true },
          { label: n ? `Remove track and its ${n} clip${n === 1 ? '' : 's'}` : 'Remove track', icon: 'trash', danger: true, disabled: t.locked, hint: t.locked ? 'Unlock it first' : 'Ctrl+Z brings it back', onClick: () => { if (!getState().removeTrack(t.id)) flash('That track (or a clip linked to it) is locked. Unlock it first.') } },
        ]
        return <Popover anchor={{ x: trackMenu.x, y: trackMenu.y }} onClose={() => setTrackMenu(null)} className="menu ctx vw-solid" minWidth={200}><MenuList items={items} onDone={() => setTrackMenu(null)} /></Popover>
      })()}
      {showKeys && <ShortcutsSheet onClose={() => setShowKeys(false)} />}
      {pasteAttrs && <PasteAttributesDialog onClose={() => setPasteAttrs(false)} flash={flash} />}
      {exportModal && <ExportSheet project={playable(project)} onClose={() => setExportModal(false)} onShowMedia={() => { setExportModal(false); showTab('media') }} />}
      {confirmReplace && (
        <Dialog
          title={confirmReplace === 'new' ? 'Start a new video?' : 'Open another video?'}
          onClose={() => setConfirmReplace(null)}
          width={440}
          footer={<>
            <button type="button" className="btn" onClick={() => setConfirmReplace(null)}>Cancel</button>
            <button type="button" className="btn vw-confirm-save" onClick={() => { const k = confirmReplace; setConfirmReplace(null); void doSave().then((ok) => { if (ok) replaceNow(k) }) }}>Save first</button>
            <button type="button" className={`btn primary ${confirmReplace === 'new' ? 'vw-confirm-new' : 'vw-confirm-open'}`} onClick={() => { const k = confirmReplace; setConfirmReplace(null); replaceNow(k) }}>{confirmReplace === 'new' ? 'New video' : 'Open…'}</button>
          </>}
        >
          <p className="vw-confirm-body">This video has changes that are not saved to a file. Save it first, or {confirmReplace === 'new' ? 'start an empty one' : 'open another'} without saving. Its last autosave is kept, so it can still be restored.</p>
        </Dialog>
      )}
    </div>
  )
}

/** Rows for one track's clips: clips that overlap in time get their own row (greedy, by start), so stacked
 * overlays are all visible on the lane. */
function laneRows(clips: Clip[]): { row: Map<string, number>; count: number } {
  const ends: number[] = []
  const row = new Map<string, number>()
  for (const c of [...clips].sort((a, b) => a.start - b.start)) {
    let r = ends.findIndex((e) => e <= c.start + 1e-6)
    if (r < 0) { r = ends.length; ends.push(0) }
    ends[r] = c.start + c.duration
    row.set(c.id, r)
  }
  return { row, count: Math.max(1, ends.length) }
}

/** What a clip is called on the timeline: its words when an overlay or caption has them, else its title. */
function clipLabel(c: Clip): string {
  if (c.compound) return `${c.title && c.title !== 'Compound clip' ? c.title : 'Compound'} · ${c.compound.clips.length} clip${c.compound.clips.length === 1 ? '' : 's'}`
  if (c.kind === 'caption') return (c.captionText ?? '').trim() || 'Caption (empty)'
  if (c.kind === 'overlay' && c.titleData) return titleWords(c.titleData) || (c.titleData.template === 'sticker' ? `${c.title}` : `${c.title} (empty)`)
  if (c.kind === 'overlay' && c.overlayType && c.overlayType !== 'logo' && !c.sourceUrl) return (c.overlayText ?? '').trim() || `${c.title} (empty)`
  return c.title
}

/** What kind of clip the inspector shows (its header word). */
function kindWord(c: Clip): string {
  if (c.compound) return 'Compound'
  if (c.adjustment) return 'Adjustment'
  if (c.kind === 'video') return c.still ? 'Still' : 'Footage'
  if (c.kind === 'audio') return 'Sound'
  if (c.kind === 'caption') return 'Caption'
  if (c.dataCard) return 'Data card'
  if (c.titleData) return c.titleData.template === 'sticker' ? 'Sticker' : 'Title'
  return 'Overlay'
}

/** The inspector's sections, in the order of the jump strip and of the column. */
const SECTION_LABEL: Record<string, string> = { title: 'Title', transform: 'Transform', speed: 'Speed', colour: 'Colour', fx: 'Effects', keys: 'Keys' }

function ClipInspector({ clip, locked, onChange, onDelete, onClose, onUnlink, onGestureStart, closeLabel, linkedWith, flash, selectionCount }: { clip: Clip; locked: boolean; onChange: (c: Clip) => void; onDelete: () => void; onClose: () => void; onUnlink: () => void; onGestureStart: () => void; closeLabel: string; linkedWith?: Clip; flash: (s: string) => void; selectionCount: number }) {
  const isFootage = clip.kind === 'video' && !clip.compound
  const labels = clip.overlayType ? OVERLAY_LABELS[clip.overlayType] : null
  const set = (patch: Partial<Clip>) => onChange({ ...clip, ...patch })
  const textOverlay = !clip.compound && clip.kind === 'overlay' && clip.overlayType && clip.overlayType !== 'logo' && !clip.sourceUrl
  const anyEmpty = textOverlay && (!(clip.overlayText ?? '').trim() || !(clip.overlaySub ?? '').trim())
  const pctF = (v: number) => pct(v)
  const row = (prop: keyof typeof PROP_RANGES, cls: string, format: (v: number) => string = pctF) => (
    <PropRow key={prop} clip={clip} prop={prop} {...PROP_RANGES[prop]} format={format} className={cls} onChange={onChange} disabled={locked} />
  )
  // speed is for footage and sound read from a file (not stills, titles or compounds)
  const timed = !clip.compound && !clip.still && clip.srcDuration != null && (clip.kind === 'video' || clip.kind === 'audio')
  const visual = clip.kind !== 'audio' && !clip.compound
  // the sections this clip has (a compound has none: it is edited inside; its opacity is a plain row)
  const isTitle = !clip.compound && clip.kind === 'overlay' && !!clip.titleData
  const ids = clip.compound ? [] : [...(isTitle ? ['title'] : []), 'transform', ...(timed ? ['speed'] : []), ...(visual ? ['colour', 'fx'] : []), 'keys']
  const stored = useInspectorUi((s) => s.open)
  const open = stored == null ? null : ids.includes(stored) ? stored : ids[0] ?? null
  const transformTitle = clip.kind === 'audio' ? 'Sound' : clip.adjustment ? 'Opacity' : 'Transform'
  const name = clipLabel(clip)
  return (
    <InspectorSections.Provider value={{ ids, open }}>
      <div
        className="vw-inspector"
        // a slider drag is one undo step: the step is taken when it starts and closed on release (window pointerup)
        onPointerDownCapture={(e) => { if ((e.target as HTMLElement).matches?.('input[type=range]')) onGestureStart() }}
      >
        <div className="vw-inspector-head">
          <div className="vw-ih-row">
            <span className="vw-inspector-title">{kindWord(clip)}</span>
            <span className="vw-ih-name" data-tip={name}>{name}</span>
            <div className="vw-inspector-actions">
              <IconButton icon="trash" size={14} tip={locked ? 'On a locked track' : 'Delete clip (Del)'} disabled={locked} onClick={onDelete} />
              <IconButton icon="x" size={14} tip={closeLabel} onClick={onClose} className="vw-inspector-close" />
            </div>
          </div>
          {ids.length > 1 && (
            <Seg<string>
              className="vw-jump"
              label="Jump to a section"
              value={open ?? ''}
              onChange={(id) => openSection(id)}
              options={ids.map((id) => ({ value: id, label: id === 'transform' ? transformTitle : SECTION_LABEL[id], tip: `Open ${(id === 'transform' ? transformTitle : id === 'keys' ? 'keyframes' : SECTION_LABEL[id]).toLowerCase()}` }))}
            />
          )}
        </div>
        <div className="vw-inspector-body">
          {selectionCount > 1 && <p className="vw-hint vw-multi-hint"><Icon name="info" size={12} />{selectionCount} clips selected. Ctrl+G groups them, Ctrl+Alt+G makes a compound clip; this shows the first.</p>}
          {locked && <p className="vw-hint vw-locked-hint"><Icon name="lock" size={12} />On a locked track{linkedWith ? ' (or linked to one)' : ''}: it cannot be moved, trimmed, split or deleted.</p>}
          {isTitle && <TitleFields clip={clip} onChange={onChange} />}
          {!textOverlay && !isTitle && (clip.kind !== 'caption' || clip.compound) && (
            <div className="vw-field">
              <label htmlFor="vw-f-title">Name on the timeline</label>
              <input id="vw-f-title" type="text" value={clip.title} onChange={(e) => set({ title: e.target.value })} />
            </div>
          )}
          {clip.compound && (
            <>
              <div className="vw-compound-actions">
                <p className="vw-hint">A nested timeline of {clip.compound.clips.length} clip{clip.compound.clips.length === 1 ? '' : 's'}. Open it to edit inside; it plays here as one clip.</p>
                <div className="vw-btn-row">
                  <button type="button" className="btn sm vw-open-compound" onClick={() => getState().openCompound(clip.id)}><Icon name="layers" size={12} />Open (Enter)</button>
                  <button type="button" className="btn sm subtle vw-break-compound" disabled={locked} onClick={() => { if (!getState().breakCompound(clip.id)) flash('Unlock the track first.') }}>Break apart</button>
                </div>
              </div>
              <div className="vw-field"><label>Opacity <em>{pct(clip.opacity ?? 1)}</em></label><Slider className="vw-s-opacity" min={0} max={1} step={0.05} value={clip.opacity ?? 1} onChange={(v) => set({ opacity: v })} /></div>
              {/* a compound's opacity and volume are applied to its inside (attrGroupsFor); transform, crop and effects are not */}
              {clip.compound.clips.some((c) => c.kind === 'audio' || (c.kind === 'video' && !c.still)) && (
                <div className="vw-field"><label>Volume <em>{pct(clip.volume ?? 1)}</em></label><Slider className="vw-s-compound-vol" min={0} max={1} step={0.05} value={clip.volume ?? 1} onChange={(v) => set({ volume: v })} /></div>
              )}
            </>
          )}
          {clip.dataCard && !clip.compound && <DataCardInspector key={clip.id} clip={clip} locked={locked} onChange={onChange} />}
          {textOverlay && labels && (
            <>
              <div className="vw-field">
                <label htmlFor="vw-f-text">{labels.text}</label>
                <input id="vw-f-text" type="text" className="vw-f-text" value={clip.overlayText ?? ''} placeholder={labels.text} onChange={(e) => set({ overlayText: e.target.value })} />
              </div>
              <div className="vw-field">
                <label htmlFor="vw-f-sub">{labels.sub}</label>
                {clip.overlayType === 'card'
                  ? <textarea id="vw-f-sub" className="vw-f-sub" rows={3} value={clip.overlaySub ?? ''} placeholder={labels.sub} onChange={(e) => set({ overlaySub: e.target.value })} />
                  : <input id="vw-f-sub" type="text" className="vw-f-sub" value={clip.overlaySub ?? ''} placeholder={labels.sub} onChange={(e) => set({ overlaySub: e.target.value })} />}
              </div>
              {anyEmpty && <p className="vw-hint">An empty field shows its label on the monitor only; it is never drawn into the export.</p>}
            </>
          )}
          {clip.kind === 'caption' && !clip.compound && (
            <div className="vw-field">
              <label htmlFor="vw-f-cap">Caption text</label>
              <textarea id="vw-f-cap" className="vw-f-cap" rows={3} value={clip.captionText ?? ''} placeholder="Caption text" onChange={(e) => set({ captionText: e.target.value })} />
            </div>
          )}
          {isTitle && <TitleSection clip={clip} onChange={onChange} />}
          {!clip.compound && (
            <FxSection id="transform" title={transformTitle} icon={clip.kind === 'audio' ? 'volume' : 'dimension'}>
              {isFootage && (
                <>
                  <div className="vw-field vw-field-row">
                    <label>Frame</label>
                    <Seg<'fill' | 'fit'> value={clip.fit ?? 'fill'} onChange={(v) => set({ fit: v })} options={[{ value: 'fill', label: 'Fill' }, { value: 'fit', label: 'Fit' }]} />
                  </div>
                  {row('scale', 'vw-s-scale')}
                  {row('x', 'vw-s-x')}
                  {row('y', 'vw-s-y')}
                </>
              )}
              {clip.kind === 'audio' && (
                <>
                  {row('volume', 'vw-s-vol')}
                  <Switch checked={!clip.muted} onChange={(on) => set({ muted: !on })} label="Sound on" />
                </>
              )}
              {clip.kind !== 'audio' && !isFootage && !clip.adjustment && (
                <>
                  {row('x', 'vw-s-x')}
                  {row('y', 'vw-s-y')}
                </>
              )}
              {clip.kind !== 'audio' && !clip.adjustment && row('rotation', 'vw-s-rot', (v) => `${Math.round(v)}°`)}
              {clip.kind !== 'audio' && row('opacity', 'vw-s-opacity')}
              {isFootage && (
                <>
                  <div className="vw-subhead">Crop</div>
                  {row('cropL', 'vw-s-cropL')}
                  {row('cropR', 'vw-s-cropR')}
                  {row('cropT', 'vw-s-cropT')}
                  {row('cropB', 'vw-s-cropB')}
                  <button type="button" className="btn sm vw-reset-transform" onClick={() => set({ fit: undefined, scale: undefined, offX: undefined, offY: undefined, cropL: undefined, cropR: undefined, cropT: undefined, cropB: undefined, rotation: undefined, anchorX: undefined, anchorY: undefined, keyframes: clip.keyframes?.volume ? { volume: clip.keyframes.volume } : undefined })}><Icon name="reset" size={12} />Reset frame</button>
                </>
              )}
            </FxSection>
          )}
          {timed && (
            <FxSection id="speed" title="Speed" icon="trendingUp" count={clip.speed != null || clip.freezes?.length || clip.reverse ? 1 : 0}>
              <SpeedSection clip={clip} locked={locked} flash={flash} />
            </FxSection>
          )}
          {/* effects and colour act on a layer's own pixels; a compound is flattened into its clips, so it has none of its own */}
          {visual && <><ColourPanel clip={clip} onChange={onChange} /><EffectsPanel clip={clip} onChange={onChange} /></>}
          {!clip.compound && (
            <FxSection id="keys" title="Keyframes" icon="activity" count={keyCount(clip)}>
              <KeyframesSummary clip={clip} />
            </FxSection>
          )}
          {linkedWith && (
            <div className="vw-linked">
              <Icon name="link" size={12} />
              <span>Linked to {linkedWith.kind === 'audio' ? 'its sound' : 'its footage'} on {trackCodeOf(linkedWith.trackId)}: they move, trim, split and change speed together.</span>
              <button type="button" className="btn xs vw-unlink" onClick={onUnlink}>Unlink</button>
            </div>
          )}
          {clip.groupId && (
            <div className="vw-linked">
              <Icon name="grid" size={12} />
              <span>In a group: it moves and deletes with the others.</span>
              <button type="button" className="btn xs vw-ungroup" onClick={() => { getState().selectClip(clip.id); getState().ungroupSelected() }}>Ungroup</button>
            </div>
          )}
          <div className="vw-metrics">
            <span>Start {formatShortTime(clip.start)}</span>
            <span>Length {clip.duration.toFixed(1)} s</span>
            {(clip.kind === 'video' || clip.kind === 'audio') && !clip.still && !clip.compound && <span>From {clip.in.toFixed(1)} s of the file</span>}
          </div>
        </div>
      </div>
    </InspectorSections.Provider>
  )
}

/** How many keyframes the clip has (every property). */
const keyCount = (c: Clip) => Object.values(c.keyframes ?? {}).reduce((n, k) => n + (k?.length ?? 0), 0)

/** The track a clip sits on, as the track headers name it (V2, A1…: numbered by order, see trackLabels). */
function trackCodeOf(trackId: string): string {
  const v = view()
  return trackLabels(v.tracks).get(trackId)?.code ?? trackId.toUpperCase()
}

/** What the track headers call each track: picture tracks numbered from the bottom (V1 is the lowest), text,
 * caption and sound tracks from the top, so the numbers follow the order on screen; a default name is the kind,
 * with a number when two tracks share it ("Footage", "Footage 2"); a name the editor gave is kept. */
function trackLabels(tracks: Track[]): Map<string, { code: string; name: string }> {
  const out = new Map<string, { code: string; name: string }>()
  const group = (t: Track) => (t.kind === 'video' || t.kind === 'overlay' ? 'V' : t.kind === 'text' ? 'T' : t.kind === 'caption' ? 'C' : 'A')
  const fromBottom = (g: string) => g === 'V'
  const byGroup = new Map<string, Track[]>()
  for (const t of tracks) { const g = group(t); byGroup.set(g, [...(byGroup.get(g) ?? []), t]) }
  const kindSeen = new Map<string, number>()
  const kindTotal = new Map<string, number>()
  for (const t of tracks) kindTotal.set(t.kind, (kindTotal.get(t.kind) ?? 0) + 1)
  for (const [g, list] of byGroup) {
    const ordered = fromBottom(g) ? [...list].reverse() : list
    ordered.forEach((t, i) => {
      const code = `${g}${i + 1}`
      const custom = t.name.replace(/^[A-Z]\d+\s*·\s*/, '').trim()
      const isDefault = !custom || custom === TRACK_KIND_LABEL[t.kind] || /^[A-Z]\d+$/.test(t.name.trim())
      let name = custom
      if (isDefault) {
        const n = (kindSeen.get(t.kind) ?? 0) + 1
        kindSeen.set(t.kind, n)
        name = n > 1 && (kindTotal.get(t.kind) ?? 0) > 1 ? `${TRACK_KIND_LABEL[t.kind]} ${n}` : TRACK_KIND_LABEL[t.kind]
      }
      out.set(t.id, { code, name })
    })
  }
  return out
}

const ADD_TRACK: TrackKind[] = ['video', 'overlay', 'text', 'caption', 'audio']
const ADD_HINT: Record<TrackKind, string> = {
  video: 'Footage and stills; covers the tracks below it',
  overlay: 'Lower thirds, headlines, cards, logos',
  text: 'Titles and captions mixed on one track',
  caption: 'Captions only, one line of words at a time',
  audio: 'Music, voiceover or a clip’s own sound',
}
const ADD_ICON: Record<TrackKind, IconName> = { video: 'video', overlay: 'layers', text: 'type', caption: 'quote', audio: 'volume' }

// dev-only handle for the end-to-end tests (engine stats, a preview still for the golden frames)
if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV && typeof window !== 'undefined') {
  Object.assign(window, {
    __videoEngine: {
      preview: previewEngine,
      audio: audioEngine,
      animationSource: () => animationSource,
      /** A clip with a ramp preset applied (speed.ts), for the playback tests. */
      rampPreset: (clip: Clip, name: string) => withRampPreset(clip, name),
      /** The .cube text of a LUT id (effects.ts registry). */
      lutText: (id: string) => lutText(id),
      stats: () => previewEngine().stats(),
      /** Title rasters drawn so far (static: once per settled title; moving: once per new instant). */
      titleStats: () => ({ static: titleRasterStats.static, moving: titleRasterStats.moving }),
      resetTitleStats: () => titleRasterStats.reset(),
      /** A Phase 0–2 overlay as the title clip a reopened project makes of it. */
      migrateOverlay: (c: Clip) => migrateOverlayClip(c),
      scrubLatencies: () => previewEngine().scrubLatencies.slice(),
      still: async (t: number) => {
        const r = await renderPreviewStill(playable(view()), t)
        // raw RGBA as base64 (a data URL read off a Blob: fast for 8 MB)
        const url: string = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsDataURL(new Blob([r.pixels as unknown as BlobPart])) })
        return { width: r.width, height: r.height, base64: url.slice(url.indexOf(',') + 1) }
      },
    },
  })
}
