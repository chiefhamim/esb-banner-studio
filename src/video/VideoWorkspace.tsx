import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { WorkspaceSwitcher } from '../shell/WorkspaceRail'
import { Icon } from '../ui/Icon'
import { Dialog, IconButton, Seg, Select, Slider, Switch, Tabs } from '../ui/controls'
import type { AspectRatio, Clip, MediaAsset, OverlayTemplate, Track } from './timeline'
import { clipsForAsset, contentEnd, formatShortTime, formatTimecode, groupLocked, isActive } from './timeline'
import { useVideoStore } from './videoStore'
import { OVERLAY_LABELS, dropCachedMedia, getCachedVideo, peekCachedVideo, pruneMediaCache, renderCompositeFrame } from './compositor'
import { ExportSheet } from './ExportSheet'
import { StoryVideoPanel } from './StoryVideoPanel'
import { PROBE_CONCURRENCY, assetFromEntry, assetFromFile, hasDiskMedia, keepTake, mapLimit, probeMedia, videoBridge } from './media'
import { clearSnapshots, describeSnapshot, latestSnapshot, loadProjectText, onAutosaved, saveProject, startAutosave } from './projectIO'
import type { Snapshot } from './projectIO'
import { fmtTime, useClockFormat } from '../ui/time'
import '../styles/video.css'

const TRACK_LABEL = { overlay: 'Overlays', video: 'Footage', caption: 'Captions', audio: 'Audio' } as const
type BinTab = 'overlays' | 'media' | 'captions' | 'audio' | 'story'

/** The overlay presets: a kind of title with empty fields. The editor types every word; nothing is filled in here. */
const OVERLAY_PRESETS: { type: OverlayTemplate; tag: string; desc: string; color: string }[] = [
  { type: 'lower-third', tag: 'Lower third', desc: 'Names the person speaking, on a dark bar with the ESB stripes.', color: '#10b981' },
  { type: 'headline', tag: 'Headline', desc: 'A headline over the lower half, with an optional kicker.', color: '#dc2626' },
  { type: 'card', tag: 'Text card', desc: 'A title and a short text, centred, for a key point or a source.', color: '#7c3aed' },
  { type: 'breaking', tag: 'Breaking', desc: 'A red BREAKING strap with one headline line.', color: '#ef4444' },
  { type: 'logo', tag: 'Logo', desc: 'The official ESB Power Line logo, at its own proportions.', color: '#0ea5e9' },
]

const pct = (v: number) => `${Math.round(v * 100)}%`
/** Footage and sound are re-seeked only when they drift this far from the playhead (or the editor seeks). */
const DRIFT = 0.25
/** The inspector gets its own column beside the monitor from this window width; below it, it takes the bin's place. */
const WIDE_INSPECTOR = '(min-width: 1180px)'

const getState = useVideoStore.getState

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

// ---------------------------------------------------------------- playback: wall clock, footage and sound in step

/** The <audio> elements that play the timeline's sound, one per source file (not one per clip). */
const audioEls = new Map<string, HTMLAudioElement>()
function audioFor(url: string) {
  let a = audioEls.get(url)
  if (!a) {
    a = new Audio()
    a.preload = 'metadata'
    a.src = url
    audioEls.set(url, a)
  }
  return a
}
function releaseAudio(url: string) {
  const a = audioEls.get(url)
  if (!a) return
  try { a.pause(); a.removeAttribute('src'); a.load() } catch { /* already gone */ }
  audioEls.delete(url)
}

/** Put every footage <video> and every sound in step with the playhead. Playing: active elements run on their own and
 * are re-seeked only when they drift more than DRIFT (or after a seek). Paused: everything stops (the monitor seeks
 * footage to the exact frame itself). */
function syncMedia(t: number, playing: boolean) {
  const { project } = getState()
  const mutedTracks = new Set(project.tracks.filter((tr) => tr.muted).map((tr) => tr.id))
  // footage
  const runVideo = new Map<string, number>()
  if (playing) for (const c of project.clips) if (c.kind === 'video' && !c.still && c.sourceUrl && isActive(c, t) && !runVideo.has(c.sourceUrl)) runVideo.set(c.sourceUrl, Math.max(0, (c.in || 0) + (t - c.start)))
  for (const c of project.clips) {
    if (c.kind !== 'video' || c.still || !c.sourceUrl) continue
    const want = runVideo.get(c.sourceUrl)
    const v = want != null ? getCachedVideo(c.sourceUrl) : peekCachedVideo(c.sourceUrl)
    if (!v) continue
    if (want == null) { if (!v.paused) v.pause(); continue }
    if (Math.abs(v.currentTime - want) > DRIFT) v.currentTime = want
    if (v.paused) v.play().catch(() => {})
  }
  // sound: one element per file; the first audible clip of that file under the playhead drives it
  const runAudio = new Map<string, { offset: number; volume: number }>()
  const urls = new Set<string>()
  for (const c of project.clips) {
    if (c.kind !== 'audio' || !c.sourceUrl) continue
    urls.add(c.sourceUrl)
    if (playing && !runAudio.has(c.sourceUrl) && isActive(c, t) && !c.muted && !mutedTracks.has(c.trackId)) runAudio.set(c.sourceUrl, { offset: (c.in || 0) + (t - c.start), volume: Math.max(0, Math.min(1, c.volume ?? 1)) })
  }
  for (const url of urls) {
    const want = runAudio.get(url)
    if (!want) { const a = audioEls.get(url); if (a && !a.paused) a.pause(); continue }
    const a = audioFor(url)
    a.volume = want.volume
    if (a.paused || Math.abs(a.currentTime - want.offset) > DRIFT) a.currentTime = want.offset
    if (a.paused) a.play().catch(() => {})
  }
  for (const url of [...audioEls.keys()]) if (!urls.has(url)) releaseAudio(url)
}

/** The playback loop. The position comes from the wall clock (where play started + time since), never from adding up
 * frame times, so a slow frame never slows the video down; a seek while playing moves the origin. */
function PlaybackEngine() {
  const playing = useVideoStore((s) => s.playing)
  useEffect(() => {
    if (!playing) { syncMedia(getState().currentTime, false); return }
    let raf = 0
    let origin = performance.now()
    let base = getState().currentTime
    let last = base
    const tick = () => {
      const st = getState()
      if (!st.playing) return
      const now = performance.now()
      if (Math.abs(st.currentTime - last) > 1e-4) { origin = now; base = st.currentTime } // the editor seeked
      const end = Math.max(0.1, contentEnd(st.project) || st.project.duration)
      let t = base + (now - origin) / 1000
      if (t >= end) { t = 0; base = 0; origin = now }
      st.seek(t)
      last = getState().currentTime
      syncMedia(last, true)
      raf = requestAnimationFrame(tick)
    }
    syncMedia(base, true)
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); syncMedia(getState().currentTime, false) }
  }, [playing])
  // leaving the desk stops and releases the sound
  useEffect(() => () => { for (const url of [...audioEls.keys()]) releaseAudio(url) }, [])
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
  const end = useVideoStore((s) => contentEnd(s.project))
  return <><span className="vw-current-time mono">{formatTimecode(t, fps)}</span><span className="vw-total-time mono">/ {formatTimecode(end, fps)}</span></>
}

function Playhead({ zoom }: { zoom: number }) {
  const t = useVideoStore((s) => s.currentTime)
  return <div className="vw-playhead-line" style={{ left: 0, transform: `translateX(${t * zoom}px)` }}><div className="vw-playhead-handle" /></div>
}

function SplitButton() {
  const can = useVideoStore((s) => {
    const p = s.project
    const t = s.currentTime
    const target = s.selectedClipId ? p.clips.find((c) => c.id === s.selectedClipId) : p.clips.find((c) => t > c.start && t < c.start + c.duration)
    return !!target && t > target.start + 1e-3 && t < target.start + target.duration - 1e-3 && !groupLocked(p, target.id)
  })
  const split = useVideoStore((s) => s.splitAtPlayhead)
  return <button type="button" className="btn sm subtle vw-split" disabled={!can} onClick={split} data-tip="Split the clip at the playhead (S)"><Icon name="crop" size={13} /> Split</button>
}

/** The monitor: draws outside React, once per animation frame, whenever the project, the playhead or a picture changes. */
function Monitor({ aspect }: { aspect: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let raf = 0
    const draw = () => {
      raf = 0
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr) }
      const st = getState()
      ctx.save()
      ctx.scale(dpr, dpr)
      renderCompositeFrame(ctx, st.project, st.currentTime, w, h, { editor: true, playing: st.playing })
      ctx.restore()
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(draw) }
    const unsub = useVideoStore.subscribe((s, prev) => { if (s.project !== prev.project || s.currentTime !== prev.currentTime || s.playing !== prev.playing) schedule() })
    window.addEventListener('esb:video-media-ready', schedule)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
    ro?.observe(canvas)
    schedule()
    return () => { unsub(); window.removeEventListener('esb:video-media-ready', schedule); ro?.disconnect(); cancelAnimationFrame(raf) }
  }, [])
  return <canvas ref={canvasRef} className="vw-canvas" style={{ '--vw-ar': aspect } as React.CSSProperties} />
}

// ---------------------------------------------------------------- the timeline (memoised: it redraws on edits, not on the playhead)

const Ruler = memo(function Ruler({ duration, zoom, onPointerDown, rulerRef }: { duration: number; zoom: number; onPointerDown: (e: React.PointerEvent) => void; rulerRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div ref={rulerRef} className="vw-ruler" onPointerDown={onPointerDown} style={{ width: `${duration * zoom}px`, '--vw-sec': `${zoom}px` } as React.CSSProperties}>
      {Array.from({ length: Math.ceil(duration / 5) + 1 }).map((_, i) => (
        <div key={i} className="vw-ruler-mark" style={{ left: `${i * 5 * zoom}px` }}><span className="vw-ruler-label mono">{formatShortTime(i * 5)}</span></div>
      ))}
    </div>
  )
})

type ClipGrab = (e: React.PointerEvent, clip: Clip, what: 'move' | 'left' | 'right') => void

const Lanes = memo(function Lanes({ tracks, clips, selectedClipId, zoom, onGrab }: { tracks: Track[]; clips: Clip[]; selectedClipId: string | null; zoom: number; onGrab: ClipGrab }) {
  const locked = new Set(tracks.filter((t) => t.locked).map((t) => t.id))
  return (
    <div className="vw-lanes-container">
      {tracks.map((t) => {
        const own = clips.filter((c) => c.trackId === t.id)
        const rows = laneRows(own)
        return (
          <div key={t.id} className={`vw-track-lane lane-${t.kind}${t.locked ? ' locked' : ''}`}>
            {own.map((clip) => {
              const row = rows.row.get(clip.id) ?? 0
              const isLocked = locked.has(clip.trackId)
              return (
                <div
                  key={clip.id}
                  className={`vw-clip-block ${clip.id === selectedClipId ? 'selected' : ''}${clip.sourceUrl || (clip.kind !== 'video' && clip.kind !== 'audio') ? '' : ' offline'}${rows.count > 1 ? ' stacked' : ''}`}
                  data-clip-kind={clip.kind}
                  data-clip-id={clip.id}
                  style={{ left: `${clip.start * zoom}px`, width: `${clip.duration * zoom}px`, backgroundColor: clip.color, '--row': row, '--rows': rows.count } as React.CSSProperties}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => onGrab(e, clip, 'move')}
                >
                  {!isLocked && <div className="vw-trim-handle left" data-tip="Drag to trim the start" onPointerDown={(e) => onGrab(e, clip, 'left')} />}
                  {clip.linkId && <span className="vw-clip-link" aria-label="Linked to its sound"><Icon name="link" size={10} /></span>}
                  <span className="vw-clip-title">{clipLabel(clip)}</span>
                  <span className="vw-clip-duration mono">{clip.duration.toFixed(1)}s</span>
                  {!isLocked && <div className="vw-trim-handle right" data-tip="Drag to trim the end" onPointerDown={(e) => onGrab(e, clip, 'right')} />}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
})

// ---------------------------------------------------------------- the desk

export function VideoWorkspace() {
  const {
    project, playing, selectedClipId, zoom, exporting, canUndo, canRedo, mediaAssets, isRecordingVoiceover, dirty, generation, projectPath,
  } = useVideoStore(useShallow((s) => ({
    project: s.project, playing: s.playing, selectedClipId: s.selectedClipId, zoom: s.zoom, exporting: s.exporting,
    canUndo: s.history.length > 0, canRedo: s.future.length > 0, mediaAssets: s.mediaAssets, isRecordingVoiceover: s.isRecordingVoiceover,
    dirty: s.dirty, generation: s.generation, projectPath: s.projectPath,
  })))
  const {
    setAspect, setProjectName, seek, togglePlay, stepFrame, addClip, addClips, updateClip,
    selectClip, setZoom, toggleTrackMute, toggleTrackLock, newProject, addMediaAsset, removeMediaAsset,
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

  const drag = useRef<{ kind: 'playhead' } | { kind: 'move'; id: string; startX: number; origStart: number } | { kind: 'trim'; id: string; side: 'left' | 'right'; startX: number } | null>(null)

  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])
  const recordingTimerRef = useRef<number | null>(null)

  const rulerRef = useRef<HTMLDivElement>(null)
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
    for (const p of [st.project, ...st.history, ...st.future]) for (const c of p.clips) if (c.sourceUrl) keep.add(c.sourceUrl)
    for (const a of st.mediaAssets) if (a.url) keep.add(a.url)
    pruneMediaCache(keep)
  }, [generation])

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
    const off = onAutosaved((at, error) => setAutosave({ at, error }))
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
      const st = getState()
      if (e.code === 'Space') { e.preventDefault(); st.togglePlay() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); st.stepFrame(e.shiftKey ? -10 : -1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); st.stepFrame(e.shiftKey ? 10 : 1) }
      else if (e.key.toLowerCase() === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void doSave(e.shiftKey) }
      else if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); st.splitAtPlayhead() }
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (st.selectedClipId) { e.preventDefault(); removeSelected() } }
      else if (e.key === 'Home') { e.preventDefault(); st.seek(0) }
      else if (e.key === 'End') { e.preventDefault(); st.seek(contentEnd(st.project)) }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) st.redo(); else st.undo() }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); st.redo() }
    }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const removeSelected = () => {
    const st = getState()
    if (st.selectedClipId && groupLocked(st.project, st.selectedClipId)) { flash('That clip is on a locked track (or linked to one). Unlock it first.'); return }
    st.deleteSelectedClip()
  }

  // ---------------------------------------------------------------- Pointer: scrub, move and trim (one undo step per gesture)
  const timeAt = (clientX: number) => {
    const rect = rulerRef.current?.getBoundingClientRect()
    const st = getState()
    return rect ? Math.max(0, Math.min(st.project.duration, (clientX - rect.left) / st.zoom)) : st.currentTime
  }
  const onRulerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    drag.current = { kind: 'playhead' }
    getState().seek(timeAt(e.clientX), true)
  }, [])
  const onGrab = useCallback<ClipGrab>((e, clip, what) => {
    e.stopPropagation()
    const st = getState()
    st.selectClip(clip.id)
    if (groupLocked(st.project, clip.id)) return
    st.beginGesture()
    drag.current = what === 'move' ? { kind: 'move', id: clip.id, startX: e.clientX, origStart: clip.start } : { kind: 'trim', id: clip.id, side: what, startX: e.clientX }
  }, [])
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const st = getState()
      if (d.kind === 'playhead') st.seek(timeAt(e.clientX))
      else if (d.kind === 'move') st.moveClip(d.id, Math.max(0, d.origStart + (e.clientX - d.startX) / st.zoom))
      else {
        const dt = (e.clientX - d.startX) / st.zoom
        if (Math.abs(dt) >= 0.1) {
          if (d.side === 'left') st.trimClipLeftDelta(d.id, dt)
          else st.trimClipRightDelta(d.id, dt)
          d.startX = e.clientX
        }
      }
    }
    // a gesture ends on release anywhere (a slider in the inspector starts one too)
    const up = () => { drag.current = null; getState().endGesture() }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up) }
  }, [])

  // ---------------------------------------------------------------- Import
  const addAssets = (assets: (MediaAsset | null)[]) => {
    const ok = assets.filter((a): a is MediaAsset => !!a)
    ok.forEach(addMediaAsset)
    if (ok.length) { setActiveTab('media'); selectClip(null); flash(`Imported ${ok.length} file${ok.length === 1 ? '' : 's'}`) }
    return ok
  }
  const importFromDialog = async () => {
    const b = videoBridge()
    if (!b?.videoImport) { fileInputRef.current?.click(); return }
    setImporting(true)
    try { addAssets(await mapLimit(await b.videoImport(), PROBE_CONCURRENCY, (e) => assetFromEntry(e))) } finally { setImporting(false) }
  }
  const importFiles = async (files: FileList | File[] | null) => {
    if (!files || !files.length) return
    setImporting(true)
    try {
      const b = videoBridge()
      // desktop: a dropped file is recorded by its real path (the preload reads it from the File), so it survives a restart
      if (b?.videoImportDropped) addAssets(await mapLimit(await b.videoImportDropped(Array.from(files)), PROBE_CONCURRENCY, (e) => assetFromEntry(e)))
      else addAssets(await mapLimit(Array.from(files), PROBE_CONCURRENCY, assetFromFile))
    } finally {
      setImporting(false)
    }
  }

  const addAssetToTimeline = (asset: MediaAsset, as: 'auto' | 'overlay' = 'auto') => {
    if (asset.missing) { flash(`${asset.name} is missing. Relink it first.`); return }
    const st = getState()
    addClips(clipsForAsset(st.project, asset, st.currentTime, as))
  }

  const relink = async (asset: MediaAsset) => {
    const b = videoBridge()
    if (!b?.videoRelink) { flash('Relinking needs the desktop app. Import the file again here.'); return }
    const e = await b.videoRelink(asset.name)
    if (!e) return
    const p = await probeMedia(e.url, asset.type)
    if (asset.url) dropCachedMedia(asset.url)
    relinkAsset(asset.id, { url: e.url, path: e.path, size: e.size, mtimeMs: e.mtimeMs, name: e.name, duration: p.duration || asset.duration, width: p.width ?? asset.width, height: p.height ?? asset.height, hasAudio: p.hasAudio ?? asset.hasAudio, thumbnailUrl: asset.type === 'image' ? e.url : p.thumbnailUrl })
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
          addClip({ id: `clip-vo-${Date.now()}`, trackId: 'a1', title: name, kind: 'audio', start: at, duration: dur, in: 0, out: dur, color: '#7c3aed', sourceUrl: asset.url, mediaAssetId: asset.id, srcDuration: dur })
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
    let r: { path: string; text: string } | null = null
    try { r = await b.videoOpenProject() } catch (e) { flash('Could not open: ' + String((e as Error).message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); return }
    if (!r) return
    const res = await loadProjectText(r.text, { path: r.path, dirty: false })
    if (res.stale) return
    if (!res.ok) { flash('That file is not a video project.'); return }
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
    const clip: Clip = { id: `clip-ov-${Date.now().toString(36)}`, trackId: 'v2', title: tag, kind: 'overlay', start: getState().currentTime, duration: 5, in: 0, out: 5, color, overlayType: type }
    if (type !== 'logo') { clip.overlayText = ''; clip.overlaySub = '' }
    addClip(clip)
  }
  const handleAddCaption = () => {
    const text = captionDraft.trim()
    addClip({ id: `clip-cap-${Date.now().toString(36)}`, trackId: 'c1', title: text ? text.slice(0, 40) : 'Caption', kind: 'caption', start: getState().currentTime, duration: 4.5, in: 0, out: 4.5, color: '#f59e0b', captionText: text })
    setCaptionDraft('')
  }

  const selectedClip = project.clips.find((c) => c.id === selectedClipId)
  const binAssets = mediaAssets.filter((a) => !a.removed || a.missing)
  const missingAssets = mediaAssets.filter((a) => a.missing)
  const empty = project.clips.length === 0
  const length = contentEnd(project)
  const showTab = (t: BinTab) => { setActiveTab(t); selectClip(null) }

  const inspector = selectedClip && (
    <ClipInspector
      clip={selectedClip}
      locked={groupLocked(project, selectedClip.id)}
      onChange={updateClip}
      onDelete={removeSelected}
      onClose={() => selectClip(null)}
      onUnlink={() => unlinkClip(selectedClip.id)}
      onGestureStart={beginGesture}
      closeLabel={wide ? 'Close the inspector' : 'Back to the bin'}
      linkedWith={selectedClip.linkId ? project.clips.find((c) => c.linkId === selectedClip.linkId && c.id !== selectedClip.id) : undefined}
    />
  )

  return (
    <div className="video-workspace">
      <PlaybackEngine />
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
          <Tabs<BinTab>
            value={activeTab}
            onChange={showTab}
            options={[
              { value: 'media', label: 'Media' },
              { value: 'overlays', label: 'Overlays' },
              { value: 'captions', label: 'Captions' },
              { value: 'audio', label: 'Audio' },
              { value: 'story', label: 'Story' },
            ]}
          />

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
                  {missingAssets.length > 0 && (
                    <div className="vw-missing" role="status"><Icon name="alert" size={14} /><span>{missingAssets.length} file{missingAssets.length === 1 ? ' is' : 's are'} missing. Relink {missingAssets.length === 1 ? 'it' : 'them'} to play and export.</span></div>
                  )}
                  {binAssets.map((asset) => <MediaCard key={asset.id} asset={asset} onAdd={addAssetToTimeline} onRelink={relink} onRemove={removeMediaAsset} />)}
                  {!hasDiskMedia() && binAssets.length > 0 && <p className="vw-bin-note"><Icon name="info" size={12} />Browser preview: files last this session only.</p>}
                </div>
              )}

              {activeTab === 'overlays' && (
                <div className="vw-preset-list">
                  <div className="vw-bug-row">
                    <Switch checked={project.bug !== false} onChange={setBug} label="ESB bug, top right" />
                  </div>
                  <p className="vw-preset-intro">Each title starts empty: type its words in the inspector.</p>
                  {OVERLAY_PRESETS.map((p) => (
                    <div key={p.type} className="vw-preset-card" data-preset={p.type}>
                      <div className="vw-preset-header">
                        <span className="vw-tag" data-tag={p.type}>{p.tag}</span>
                        <button type="button" className="btn xs" onClick={() => handleAddOverlay(p.type, p.tag)}><Icon name="plus" size={12} />Add</button>
                      </div>
                      <p className="vw-preset-desc">{p.desc}</p>
                    </div>
                  ))}
                </div>
              )}

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

        <section className="vw-monitor-panel">
          <div className="vw-monitor-container">
            <Monitor aspect={project.width / project.height} />
            {empty && (
              <div className="vw-start" role="group" aria-label="Start a video">
                {restore ? (
                  <div className="vw-start-card vw-restore-card">
                    <div className="vw-start-icon"><Icon name="refresh" size={18} /></div>
                    <b>Restore unsaved video</b>
                    <p>“{restore.name}” · {restore.clips} clip{restore.clips === 1 ? '' : 's'} · autosaved {fmtTime(restore.at, { seconds: true })}</p>
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
      <footer className="vw-timeline-footer">
        <div className="vw-timeline-toolbar">
          <div className="vw-tl-tools-left">
            <SplitButton />
            <button type="button" className="btn sm subtle vw-delete" disabled={!selectedClipId} onClick={removeSelected} data-tip="Delete the selected clip (Del)"><Icon name="trash" size={13} /> Delete</button>
          </div>
          <div className="vw-tl-tools-right">
            <IconButton icon="minus" tip="Zoom out" onClick={() => setZoom(zoom - 10)} />
            <span className="vw-zoom-label mono">{zoom} px/s</span>
            <IconButton icon="plus" tip="Zoom in" onClick={() => setZoom(zoom + 10)} />
          </div>
        </div>

        <div className="vw-tracks-scroll">
          <div className="vw-track-headers">
            <div className="vw-ruler-header">Tracks</div>
            {project.tracks.map((t) => (
              <div key={t.id} className="vw-track-head">
                <span className="vw-th-title" data-tip={t.name}><b>{t.id.toUpperCase()}</b>{TRACK_LABEL[t.kind]}</span>
                <div className="vw-th-actions">
                  {t.kind === 'audio' && (
                    <button type="button" className={`vw-th-btn ${t.muted ? 'active' : ''}`} onClick={() => toggleTrackMute(t.id)} aria-label={`${t.muted ? 'Unmute' : 'Mute'} ${t.id.toUpperCase()}`} aria-pressed={!!t.muted} data-tip={t.muted ? 'Unmute track' : 'Mute track'}>
                      <Icon name={t.muted ? 'volumeX' : 'volume'} size={13} />
                    </button>
                  )}
                  <button type="button" className={`vw-th-btn ${t.locked ? 'active' : ''}`} onClick={() => toggleTrackLock(t.id)} aria-label={`${t.locked ? 'Unlock' : 'Lock'} ${t.id.toUpperCase()}`} aria-pressed={!!t.locked} data-tip={t.locked ? 'Unlock track' : 'Lock track'}>
                    <Icon name={t.locked ? 'lock' : 'unlock'} size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="vw-lanes-area" style={{ width: `${project.duration * zoom + 300}px` }}>
            <Ruler duration={project.duration} zoom={zoom} onPointerDown={onRulerDown} rulerRef={rulerRef} />
            <Playhead zoom={zoom} />
            <Lanes tracks={project.tracks} clips={project.clips} selectedClipId={selectedClipId} zoom={zoom} onGrab={onGrab} />
          </div>
        </div>
      </footer>

      <footer className="statusbar vw-statusbar">
        <span>{project.clips.length} {project.clips.length === 1 ? 'clip' : 'clips'} · {project.tracks.length} tracks</span>
        {selectedClip && <><span className="sep" /><span className="vw-sb-sel">{clipLabel(selectedClip)}</span></>}
        {note && <><span className="sep" /><span className="vw-sb-note">{note}</span></>}
        <div className="spacer" />
        <span className={`muted vw-sb-save${autosave?.error && dirty ? ' failed' : ''}`} data-tip={autosave?.error && dirty ? `Autosave failed: ${autosave.error}` : undefined}>
          {dirty ? (autosave?.error ? 'Unsaved · autosave failed' : autosave?.at ? `Unsaved · autosaved ${fmtTime(autosave.at, { seconds: true })}` : 'Unsaved') : empty && !projectPath ? 'New video' : 'Saved'}
        </span>
        <span className="sep" />
        <span className="muted">{project.width} × {project.height} · {project.fps} fps · {formatShortTime(length)}</span>
      </footer>

      {exportModal && <ExportSheet project={project} onClose={() => setExportModal(false)} onShowMedia={() => { setExportModal(false); showTab('media') }} />}
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

/** One bin row: picture or icon, name and facts, and its actions in one aligned group. */
const MediaCard = memo(function MediaCard({ asset, onAdd, onRelink, onRemove }: { asset: MediaAsset; onAdd: (a: MediaAsset, as?: 'auto' | 'overlay') => void; onRelink: (a: MediaAsset) => void; onRemove: (id: string) => void }) {
  const thumb = asset.thumbnailUrl && !asset.missing
    ? <img src={asset.thumbnailUrl} alt="" className="vw-media-thumb" crossOrigin={/^(blob:|data:)/.test(asset.thumbnailUrl) ? undefined : 'anonymous'} />
    : <div className={`vw-media-thumb vw-thumb-icon${asset.missing ? ' missing' : ''}`}><Icon name={asset.missing ? 'alert' : asset.type === 'audio' ? 'volume' : asset.type === 'image' ? 'image' : 'video'} size={18} /></div>
  return (
    <div className={`vw-media-card${asset.missing ? ' missing' : ''}`} data-asset={asset.type}>
      {thumb}
      <div className="vw-media-info">
        <div className="vw-media-title" data-tip={`${asset.path ?? asset.name}${asset.type === 'video' && asset.width ? ` · ${asset.width}×${asset.height}` : ''}`}>{asset.name}</div>
        <div className="vw-media-meta mono">
          {/* one text line, short enough for the 312 px bin; footage's picture size is in the tooltip */}
          {asset.missing ? <span className="vw-miss-word">Not found{asset.removed ? ' · used by clips' : ''}</span> : [
            asset.duration > 0 ? formatShortTime(asset.duration) : '',
            asset.type === 'image' && asset.width && asset.height ? `${asset.width}×${asset.height}` : '',
            asset.type === 'video' && asset.hasAudio !== undefined ? (asset.hasAudio ? 'sound' : 'no sound') : '',
            `${(asset.size / (1024 * 1024)).toFixed(1)} MB`,
          ].filter(Boolean).join(' · ')}
        </div>
      </div>
      <div className="vw-media-actions">
        {asset.missing ? (
          <button type="button" className="btn xs vw-relink" onClick={() => onRelink(asset)} data-tip="Find the file on this PC"><Icon name="search" size={12} />Relink</button>
        ) : (
          <>
            {asset.type === 'image' && <IconButton icon="layers" size={14} className="vw-act vw-add-overlay" tip="Add as an overlay on V2 (over the footage)" onClick={() => onAdd(asset, 'overlay')} />}
            <IconButton icon="plus" size={14} className="vw-act vw-add" tip={asset.type === 'image' ? 'Add to V1 as a full-frame still' : asset.type === 'video' ? (asset.hasAudio ? 'Add to V1, with its sound on A1' : 'Add to V1') : 'Add to A1'} onClick={() => onAdd(asset)} />
          </>
        )}
        {!asset.removed && <IconButton icon="trash" size={14} className="vw-act vw-remove" tip="Remove from the bin (Ctrl+Z brings it back)" onClick={() => onRemove(asset.id)} />}
      </div>
    </div>
  )
})

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
  if (c.kind === 'caption') return (c.captionText ?? '').trim() || 'Caption (empty)'
  if (c.kind === 'overlay' && c.overlayType && c.overlayType !== 'logo' && !c.sourceUrl) return (c.overlayText ?? '').trim() || `${c.title} (empty)`
  return c.title
}

function ClipInspector({ clip, locked, onChange, onDelete, onClose, onUnlink, onGestureStart, closeLabel, linkedWith }: { clip: Clip; locked: boolean; onChange: (c: Clip) => void; onDelete: () => void; onClose: () => void; onUnlink: () => void; onGestureStart: () => void; closeLabel: string; linkedWith?: Clip }) {
  const isFootage = clip.kind === 'video'
  const labels = clip.overlayType ? OVERLAY_LABELS[clip.overlayType] : null
  const set = (patch: Partial<Clip>) => onChange({ ...clip, ...patch })
  const textOverlay = clip.kind === 'overlay' && clip.overlayType && clip.overlayType !== 'logo' && !clip.sourceUrl
  const anyEmpty = textOverlay && (!(clip.overlayText ?? '').trim() || !(clip.overlaySub ?? '').trim())
  return (
    <div
      className="vw-inspector"
      // a slider drag is one undo step: the step is taken when it starts and closed on release (window pointerup)
      onPointerDownCapture={(e) => { if ((e.target as HTMLElement).matches?.('input[type=range]')) onGestureStart() }}
    >
      <div className="vw-inspector-head">
        <span className="vw-inspector-title">{isFootage ? (clip.still ? 'STILL' : 'FOOTAGE') : clip.kind === 'audio' ? 'SOUND' : clip.kind === 'caption' ? 'CAPTION' : 'OVERLAY'}</span>
        <div className="vw-inspector-actions">
          <IconButton icon="trash" size={14} tip={locked ? 'On a locked track' : 'Delete clip (Del)'} disabled={locked} onClick={onDelete} />
          <IconButton icon="x" size={14} tip={closeLabel} onClick={onClose} className="vw-inspector-close" />
        </div>
      </div>
      <div className="vw-inspector-body">
        {locked && <p className="vw-hint vw-locked-hint"><Icon name="lock" size={12} />On a locked track{linkedWith ? ' (or linked to one)' : ''}: it cannot be moved, trimmed, split or deleted.</p>}
        {!textOverlay && clip.kind !== 'caption' && (
          <div className="vw-field">
            <label htmlFor="vw-f-title">Name on the timeline</label>
            <input id="vw-f-title" type="text" value={clip.title} onChange={(e) => set({ title: e.target.value })} />
          </div>
        )}
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
        {clip.kind === 'caption' && (
          <div className="vw-field">
            <label htmlFor="vw-f-cap">Caption text</label>
            <textarea id="vw-f-cap" className="vw-f-cap" rows={3} value={clip.captionText ?? ''} placeholder="Caption text" onChange={(e) => set({ captionText: e.target.value })} />
          </div>
        )}
        {isFootage && (
          <>
            <div className="vw-field vw-field-row">
              <label>Frame</label>
              <Seg<'fill' | 'fit'> value={clip.fit ?? 'fill'} onChange={(v) => set({ fit: v })} options={[{ value: 'fill', label: 'Fill' }, { value: 'fit', label: 'Fit' }]} />
            </div>
            <div className="vw-field">
              <label>Scale <em>{pct(clip.scale ?? 1)}</em></label>
              <Slider className="vw-s-scale" min={0.1} max={4} step={0.01} value={clip.scale ?? 1} onChange={(v) => set({ scale: v })} />
            </div>
            <div className="vw-field">
              <label>Position X <em>{pct(clip.offX ?? 0)}</em></label>
              <Slider className="vw-s-x" min={-1} max={1} step={0.005} value={clip.offX ?? 0} onChange={(v) => set({ offX: v })} />
            </div>
            <div className="vw-field">
              <label>Position Y <em>{pct(clip.offY ?? 0)}</em></label>
              <Slider className="vw-s-y" min={-1} max={1} step={0.005} value={clip.offY ?? 0} onChange={(v) => set({ offY: v })} />
            </div>
            <div className="vw-subhead">Crop</div>
            {(['cropL', 'cropR', 'cropT', 'cropB'] as const).map((k) => (
              <div className="vw-field" key={k}>
                <label>{k === 'cropL' ? 'Left' : k === 'cropR' ? 'Right' : k === 'cropT' ? 'Top' : 'Bottom'} <em>{pct(clip[k] ?? 0)}</em></label>
                <Slider className={`vw-s-${k}`} min={0} max={0.45} step={0.005} value={clip[k] ?? 0} onChange={(v) => set({ [k]: v })} />
              </div>
            ))}
            <button type="button" className="btn sm vw-reset-transform" onClick={() => set({ fit: undefined, scale: undefined, offX: undefined, offY: undefined, cropL: undefined, cropR: undefined, cropT: undefined, cropB: undefined })}><Icon name="reset" size={12} />Reset frame</button>
          </>
        )}
        {clip.kind === 'audio' && (
          <>
            <div className="vw-field">
              <label>Volume <em>{pct(clip.volume ?? 1)}</em></label>
              <Slider className="vw-s-vol" min={0} max={1} step={0.05} value={clip.volume ?? 1} onChange={(v) => set({ volume: v })} />
            </div>
            <Switch checked={!clip.muted} onChange={(on) => set({ muted: !on })} label="Sound on" />
          </>
        )}
        {clip.kind !== 'audio' && (
          <div className="vw-field">
            <label>Opacity <em>{pct(clip.opacity ?? 1)}</em></label>
            <Slider className="vw-s-opacity" min={0} max={1} step={0.05} value={clip.opacity ?? 1} onChange={(v) => set({ opacity: v })} />
          </div>
        )}
        {linkedWith && (
          <div className="vw-linked">
            <Icon name="link" size={12} />
            <span>Linked to {linkedWith.kind === 'audio' ? 'its sound on A1' : 'its footage on V1'}: they move, trim and split together.</span>
            <button type="button" className="btn xs vw-unlink" onClick={onUnlink}>Unlink</button>
          </div>
        )}
        <div className="vw-metrics">
          <span>Start {formatShortTime(clip.start)}</span>
          <span>Length {clip.duration.toFixed(1)} s</span>
          {(clip.kind === 'video' || clip.kind === 'audio') && !clip.still && <span>From {clip.in.toFixed(1)} s of the file</span>}
        </div>
      </div>
    </div>
  )
}
