import { useEffect, useRef, useState, useCallback } from 'react'
import { WorkspaceSwitcher } from '../shell/WorkspaceRail'
import { Icon } from '../ui/Icon'
import { Dialog, IconButton, Seg, Select, Slider, Switch, Tabs } from '../ui/controls'
import type { AspectRatio, Clip, MediaAsset, OverlayTemplate } from './timeline'
import { clipsForAsset, contentEnd, formatShortTime, formatTimecode, isActive } from './timeline'
import { useVideoStore } from './videoStore'
import { OVERLAY_LABELS, dropCachedMedia, renderCompositeFrame } from './compositor'
import { ExportSheet } from './ExportSheet'
import { StoryVideoPanel } from './StoryVideoPanel'
import { assetFromEntry, assetFromFile, hasDiskMedia, newAssetId, probeMedia, videoBridge } from './media'
import { clearSnapshots, describeSnapshot, latestSnapshot, loadProjectText, onAutosaved, saveProject, startAutosave } from './projectIO'
import type { Snapshot } from './projectIO'
import { fmtTime, useClockFormat } from '../ui/time'
import '../styles/video.css'

const TRACK_LABEL = { overlay: 'Overlays', video: 'Footage', caption: 'Captions', audio: 'Audio' } as const
type BinTab = 'overlays' | 'media' | 'captions' | 'audio' | 'story'

/** The overlay presets: a kind of title with empty fields. The editor types every word; nothing is filled in here. */
const OVERLAY_PRESETS: { type: OverlayTemplate; tag: string; name: string; desc: string; color: string }[] = [
  { type: 'lower-third', tag: 'Lower third', name: 'Name and role', desc: 'Names the person speaking. Dark glass bar with the ESB stripes.', color: '#10b981' },
  { type: 'headline', tag: 'Headline', name: 'Title card headline', desc: 'A headline over the lower half of the picture, with an optional kicker.', color: '#dc2626' },
  { type: 'card', tag: 'Text card', name: 'Centred text card', desc: 'A title and a short text on a dark card, for a key point or a source line.', color: '#7c3aed' },
  { type: 'breaking', tag: 'Breaking', name: 'Breaking strap', desc: 'A red BREAKING strap with one headline line.', color: '#ef4444' },
  { type: 'logo', tag: 'Logo', name: 'ESB logo', desc: 'The official ESB Power Line logo, at its own proportions.', color: '#0ea5e9' },
]

const pct = (v: number) => `${Math.round(v * 100)}%`

export function VideoWorkspace() {
  const s = useVideoStore()
  const {
    project, currentTime, playing, selectedClipId, zoom, exporting, history, future, mediaAssets, isRecordingVoiceover, dirty,
    setAspect, setProjectName, seek, togglePlay, stepFrame, addClip, addClips, updateClip, moveClip, trimClipLeftDelta, trimClipRightDelta,
    splitAtPlayhead, deleteSelectedClip, selectClip, setZoom, toggleTrackMute, toggleTrackLock, newProject, addMediaAsset, removeMediaAsset,
    relinkAsset, setRecordingVoiceover, undo, redo, setBug, unlinkClip,
  } = s
  useClockFormat()

  const [activeTab, setActiveTab] = useState<BinTab>('media')
  const [exportModal, setExportModal] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [autosavedAt, setAutosavedAt] = useState<number | null>(null)
  const [restore, setRestore] = useState<(Snapshot & { name: string; clips: number }) | null>(null)
  const [confirmNew, setConfirmNew] = useState(false)
  const [importing, setImporting] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [captionDraft, setCaptionDraft] = useState('')

  const [draggingPlayhead, setDraggingPlayhead] = useState(false)
  const [draggedClip, setDraggedClip] = useState<{ id: string; startX: number; origStart: number } | null>(null)
  const [trimmingClip, setTrimmingClip] = useState<{ id: string; side: 'left' | 'right'; startX: number } | null>(null)

  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])
  const recordingTimerRef = useRef<number | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [monitorSize, setMonitorSize] = useState('')
  const rulerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const projectInputRef = useRef<HTMLInputElement>(null)
  const activeAudiosRef = useRef<Map<string, { el: HTMLAudioElement; url: string }>>(new Map())

  const flash = (text: string) => { setNote(text); window.setTimeout(() => setNote((n) => (n === text ? null : n)), 4000) }

  // ---------------------------------------------------------------- Autosave and the restore card
  useEffect(() => {
    const stop = startAutosave()
    const off = onAutosaved((at) => setAutosavedAt(at))
    // a snapshot left from a session that did not save (a crash, a kill) is offered while the desk is still empty
    const st = useVideoStore.getState()
    if (!st.project.clips.length && !st.dirty) {
      void latestSnapshot().then((snap) => {
        const d = snap ? describeSnapshot(snap) : null
        if (snap && d && d.clips > 0 && !useVideoStore.getState().project.clips.length) setRestore({ ...snap, ...d })
      })
    }
    return () => { off(); stop() }
  }, [])

  const restoreSnapshot = async () => {
    if (!restore) return
    const r = await loadProjectText(restore.text, { path: null, dirty: true })
    setRestore(null)
    if (!r.ok) { flash('That snapshot could not be read.'); return }
    flash(r.missing ? `Restored. ${r.missing} media file${r.missing === 1 ? ' is' : 's are'} missing — relink in Media.` : 'Restored the unsaved video')
  }
  const discardSnapshot = async () => { await clearSnapshots(); setRestore(null) }

  // ---------------------------------------------------------------- Playback Engine
  useEffect(() => {
    let animId: number
    let lastT = performance.now()
    const tick = (now: number) => {
      if (playing) {
        const dt = (now - lastT) / 1000
        const next = currentTime + dt
        const end = Math.max(0.1, contentEnd(project) || project.duration)
        seek(next >= end ? 0 : next)
      }
      lastT = now
      if (playing) animId = requestAnimationFrame(tick)
    }
    if (playing) {
      lastT = performance.now()
      animId = requestAnimationFrame(tick)
    }
    return () => cancelAnimationFrame(animId)
  }, [playing, currentTime, project, seek])

  // leaving the Video desk stops what it started: timeline audio, and a voiceover still recording (its timer and mic)
  useEffect(() => {
    const audios = activeAudiosRef.current
    return () => {
      audios.forEach((a) => { try { a.el.pause(); a.el.src = '' } catch { /* already gone */ } })
      audios.clear()
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
      const rec = mediaRecorderRef.current
      if (rec && rec.state !== 'inactive') { rec.onstop = null; rec.stop(); rec.stream.getTracks().forEach((t) => t.stop()) }
    }
  }, [])

  // ---------------------------------------------------------------- Audio playback: every audible clip, footage sound included
  useEffect(() => {
    const audios = activeAudiosRef.current
    const live = new Set<string>()
    const mutedTracks = new Set(project.tracks.filter((t) => t.muted).map((t) => t.id))
    for (const clip of project.clips) {
      if (clip.kind !== 'audio' || !clip.sourceUrl) continue
      live.add(clip.id)
      let a = audios.get(clip.id)
      if (!a || a.url !== clip.sourceUrl) {
        if (a) { a.el.pause(); a.el.src = '' }
        a = { el: new Audio(clip.sourceUrl), url: clip.sourceUrl }
        audios.set(clip.id, a)
      }
      const audible = playing && isActive(clip, currentTime) && !clip.muted && !mutedTracks.has(clip.trackId)
      if (audible) {
        const offset = clip.in + (currentTime - clip.start)
        if (Math.abs(a.el.currentTime - offset) > 0.15) a.el.currentTime = offset
        a.el.volume = Math.max(0, Math.min(1, clip.volume ?? 1))
        if (a.el.paused) a.el.play().catch(() => {})
      } else if (!a.el.paused) a.el.pause()
    }
    for (const [id, a] of audios) if (!live.has(id)) { a.el.pause(); a.el.src = ''; audios.delete(id) }
  }, [playing, currentTime, project.clips, project.tracks])

  // ---------------------------------------------------------------- Canvas Rendering
  const [mediaTick, setMediaTick] = useState(0)
  useEffect(() => {
    const bump = () => setMediaTick((n) => n + 1)
    window.addEventListener('esb:video-media-ready', bump)
    return () => window.removeEventListener('esb:video-media-ready', bump)
  }, [])
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const displayWidth = canvas.clientWidth
    const displayHeight = canvas.clientHeight
    if (canvas.width !== displayWidth * dpr || canvas.height !== displayHeight * dpr) {
      canvas.width = displayWidth * dpr
      canvas.height = displayHeight * dpr
    }
    ctx.save()
    ctx.scale(dpr, dpr)
    renderCompositeFrame(ctx, project, currentTime, displayWidth, displayHeight, { editor: true })
    ctx.restore()
  }, [project, currentTime, monitorSize, mediaTick])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setMonitorSize(`${canvas.clientWidth}x${canvas.clientHeight}`))
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  // ---------------------------------------------------------------- Keyboard Shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable) return
      if (document.querySelector('.modal-bg')) return
      if (e.code === 'Space') { e.preventDefault(); togglePlay() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); stepFrame(e.shiftKey ? -10 : -1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); stepFrame(e.shiftKey ? 10 : 1) }
      else if (e.key.toLowerCase() === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void doSave(e.shiftKey) }
      else if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); splitAtPlayhead() }
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (selectedClipId) { e.preventDefault(); deleteSelectedClip() } }
      else if (e.key === 'Home') { e.preventDefault(); seek(0) }
      else if (e.key === 'End') { e.preventDefault(); seek(contentEnd(project)) }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo() }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ---------------------------------------------------------------- Pointer Dragging & Scrubbing
  const lockedTracks = new Set(project.tracks.filter((t) => t.locked).map((t) => t.id))
  const handleRulerPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    setDraggingPlayhead(true)
    const rect = rulerRef.current?.getBoundingClientRect()
    if (!rect) return
    seek(Math.max(0, Math.min(project.duration, (e.clientX - rect.left) / zoom)), true)
  }

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (draggingPlayhead && rulerRef.current) {
      const rect = rulerRef.current.getBoundingClientRect()
      seek(Math.max(0, Math.min(project.duration, (e.clientX - rect.left) / zoom)))
    } else if (draggedClip) {
      moveClip(draggedClip.id, Math.max(0, draggedClip.origStart + (e.clientX - draggedClip.startX) / zoom))
    } else if (trimmingClip) {
      const dt = (e.clientX - trimmingClip.startX) / zoom
      if (Math.abs(dt) >= 0.1) {
        if (trimmingClip.side === 'left') trimClipLeftDelta(trimmingClip.id, dt)
        else trimClipRightDelta(trimmingClip.id, dt)
        setTrimmingClip({ ...trimmingClip, startX: e.clientX })
      }
    }
  }, [draggingPlayhead, draggedClip, trimmingClip, zoom, project.duration, seek, moveClip, trimClipLeftDelta, trimClipRightDelta])

  const handlePointerUp = useCallback(() => { setDraggingPlayhead(false); setDraggedClip(null); setTrimmingClip(null) }, [])

  useEffect(() => {
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => { window.removeEventListener('pointermove', handlePointerMove); window.removeEventListener('pointerup', handlePointerUp) }
  }, [handlePointerMove, handlePointerUp])

  // ---------------------------------------------------------------- Import
  const addAssets = (assets: (MediaAsset | null)[]) => {
    const ok = assets.filter((a): a is MediaAsset => !!a)
    ok.forEach(addMediaAsset)
    if (ok.length) { setActiveTab('media'); flash(`Imported ${ok.length} file${ok.length === 1 ? '' : 's'}`) }
    return ok
  }
  const importFromDialog = async () => {
    const b = videoBridge()
    if (!b?.videoImport) { fileInputRef.current?.click(); return }
    setImporting(true)
    try { addAssets(await Promise.all((await b.videoImport()).map((e) => assetFromEntry(e)))) } finally { setImporting(false) }
  }
  const importFiles = async (files: FileList | File[] | null) => {
    if (!files || !files.length) return
    setImporting(true)
    try {
      const b = videoBridge()
      // desktop: a dropped file is recorded by its real path (the preload reads it from the File), so it survives a restart
      if (b?.videoImportDropped) addAssets(await Promise.all((await b.videoImportDropped(Array.from(files))).map((e) => assetFromEntry(e))))
      else addAssets(await Promise.all(Array.from(files).map(assetFromFile)))
    } finally {
      setImporting(false)
    }
  }

  const addAssetToTimeline = (asset: MediaAsset, as: 'auto' | 'overlay' = 'auto') => {
    if (asset.missing) { flash(`${asset.name} is missing. Relink it first.`); return }
    addClips(clipsForAsset(useVideoStore.getState().project, asset, currentTime, as))
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
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data) }
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
        const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' })
        const url = URL.createObjectURL(blob)
        const dur = Math.max(1, Math.round((performance.now() - startedAt) / 100) / 10)
        const name = `Voiceover ${fmtTime(Date.now(), { seconds: true })}`
        const asset: MediaAsset = { id: newAssetId(), name, type: 'audio', url, duration: dur, size: blob.size }
        addMediaAsset(asset)
        addClip({ id: `clip-vo-${Date.now()}`, trackId: 'a1', title: name, kind: 'audio', start: currentTime, duration: dur, in: 0, out: dur, color: '#7c3aed', sourceUrl: url, mediaAssetId: asset.id, srcDuration: dur })
        setRecordingVoiceover(false)
        setRecordingSeconds(0)
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

  // ---------------------------------------------------------------- Project: new, open, save
  const doSave = async (saveAs = false) => {
    try {
      const where = await saveProject(saveAs)
      if (where) flash(hasDiskMedia() ? `Saved ${where.split(/[\\/]/).pop()}` : 'Project downloaded')
    } catch (e) {
      flash('Could not save: ' + ((e as Error).message || 'unknown error'))
    }
  }
  const doOpen = async () => {
    const b = videoBridge()
    if (!b?.videoOpenProject) { projectInputRef.current?.click(); return }
    const r = await b.videoOpenProject()
    if (!r) return
    const res = await loadProjectText(r.text, { path: r.path, dirty: false })
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
      if (!res.ok) flash('That file is not a video project.')
      else flash(res.missing ? `Opened. ${res.missing} media file${res.missing === 1 ? ' is' : 's are'} not in this browser session — import them again.` : 'Project opened')
    })
  }
  const doNew = () => {
    if (dirty && (project.clips.length || mediaAssets.length)) { setConfirmNew(true); return }
    newProject()
  }

  // ---------------------------------------------------------------- Overlays and captions
  const handleAddOverlay = (type: OverlayTemplate, tag: string) => {
    const color = OVERLAY_PRESETS.find((p) => p.type === type)?.color ?? '#10b981'
    const clip: Clip = { id: `clip-ov-${Date.now().toString(36)}`, trackId: 'v2', title: tag, kind: 'overlay', start: currentTime, duration: 5, in: 0, out: 5, color, overlayType: type }
    if (type !== 'logo') { clip.overlayText = ''; clip.overlaySub = '' }
    addClip(clip)
  }
  const handleAddCaption = () => {
    const text = captionDraft.trim()
    addClip({ id: `clip-cap-${Date.now().toString(36)}`, trackId: 'c1', title: text ? text.slice(0, 40) : 'Caption', kind: 'caption', start: currentTime, duration: 4.5, in: 0, out: 4.5, color: '#f59e0b', captionText: text })
    setCaptionDraft('')
  }

  const selectedClip = project.clips.find((c) => c.id === selectedClipId)
  const missingAssets = mediaAssets.filter((a) => a.missing)
  const empty = project.clips.length === 0
  const length = contentEnd(project)

  return (
    <div className="video-workspace">
      <input type="file" ref={fileInputRef} multiple accept="video/*,audio/*,image/*" style={{ display: 'none' }} onChange={(e) => { void importFiles(e.target.files ? Array.from(e.target.files) : null); e.target.value = '' }} />
      <input type="file" ref={projectInputRef} accept=".esbvideo,.json" style={{ display: 'none' }} onChange={openFromInput} />

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
        <div className="vw-timecode mono">{formatTimecode(currentTime, project.fps)}</div>
        <div className="vw-header-actions">
          <div className="pillbar">
            <IconButton icon="undo" tip="Undo (Ctrl+Z)" disabled={history.length === 0} onClick={undo} />
            <IconButton icon="redo" tip="Redo (Ctrl+Y)" disabled={future.length === 0} onClick={redo} />
          </div>
          <button type="button" className="btn sm subtle vw-new" onClick={doNew} data-tip="New empty video"><Icon name="filePlus" size={13} /><span className="vw-lbl">New</span></button>
          <button type="button" className="btn sm subtle vw-open" onClick={() => void doOpen()} data-tip="Open a video project (.esbvideo)"><Icon name="folder" size={13} /><span className="vw-lbl">Open</span></button>
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

      {/* 2. Bin + monitor */}
      <div className="vw-stage-row">
        <aside className="vw-bin-panel">
          <Tabs<BinTab>
            value={activeTab}
            onChange={setActiveTab}
            options={[
              { value: 'media', label: 'Media' },
              { value: 'overlays', label: 'Overlays' },
              { value: 'captions', label: 'Captions' },
              { value: 'audio', label: 'Audio' },
              { value: 'story', label: 'Story' },
            ]}
          />

          <div className="vw-bin-content">
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
                {!hasDiskMedia() && mediaAssets.length > 0 && <p className="vw-bin-note">Browser preview: imported files last for this session only. The desktop app keeps them by their path.</p>}
                {missingAssets.length > 0 && (
                  <div className="vw-missing" role="status"><Icon name="alert" size={14} /><span>{missingAssets.length} file{missingAssets.length === 1 ? ' is' : 's are'} missing. Relink {missingAssets.length === 1 ? 'it' : 'them'} to play and export.</span></div>
                )}
                {mediaAssets.map((asset) => (
                  <div key={asset.id} className={`vw-media-card${asset.missing ? ' missing' : ''}`} data-asset={asset.type}>
                    {asset.thumbnailUrl && !asset.missing ? <img src={asset.thumbnailUrl} alt="" className="vw-media-thumb" crossOrigin={/^(blob:|data:)/.test(asset.thumbnailUrl) ? undefined : 'anonymous'} /> : <div className="vw-media-thumb">{asset.missing ? 'MISSING' : asset.type.toUpperCase()}</div>}
                    <div className="vw-media-info">
                      <div className="vw-media-title" data-tip={`${asset.path ?? asset.name}${asset.type === 'video' && asset.width ? ` · ${asset.width}×${asset.height}` : ''}`}>{asset.name}</div>
                      <div className="vw-media-meta mono">
                        {/* one text line, short enough for the 312 px bin; footage's picture size is in the tooltip */}
                        {asset.missing ? <span className="vw-miss-word">Not found</span> : [
                          asset.duration > 0 ? formatShortTime(asset.duration) : '',
                          asset.type === 'image' && asset.width && asset.height ? `${asset.width}×${asset.height}` : '',
                          asset.type === 'video' && asset.hasAudio !== undefined ? (asset.hasAudio ? 'sound' : 'no sound') : '',
                          `${(asset.size / (1024 * 1024)).toFixed(1)} MB`,
                        ].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    {asset.missing ? (
                      <button type="button" className="btn xs vw-relink" onClick={() => void relink(asset)} data-tip="Find the file on this PC"><Icon name="search" size={12} />Relink</button>
                    ) : (
                      <div className="vw-media-actions">
                        <IconButton icon="plus" size={14} className="vw-add" tip={asset.type === 'image' ? 'Add to V1 as a full-frame still' : asset.type === 'video' ? (asset.hasAudio ? 'Add to V1, with its sound on A1' : 'Add to V1') : 'Add to A1'} onClick={() => addAssetToTimeline(asset)} />
                        {asset.type === 'image' && <IconButton icon="layers" size={13} className="vw-add-overlay" tip="Add as an overlay on V2 (over the footage)" onClick={() => addAssetToTimeline(asset, 'overlay')} />}
                      </div>
                    )}
                    <IconButton icon="trash" tip="Remove from the bin" size={12} className="xs" onClick={() => removeMediaAsset(asset.id)} />
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'overlays' && (
              <div className="vw-preset-list">
                <div className="vw-bug-row">
                  <Switch checked={project.bug !== false} onChange={setBug} label="ESB bug, top right" />
                </div>
                {OVERLAY_PRESETS.map((p) => (
                  <div key={p.type} className="vw-preset-card" data-preset={p.type}>
                    <div className="vw-preset-header">
                      <span className={`vw-tag ${p.type}`}>{p.tag}</span>
                      <button type="button" className="btn xs" onClick={() => handleAddOverlay(p.type, p.tag)}><Icon name="plus" size={12} />Add</button>
                    </div>
                    <div className="vw-preset-name">{p.name}</div>
                    <p className="vw-preset-desc">{p.desc}{p.type !== 'logo' ? ' Starts empty: type the words in the clip inspector.' : ''}</p>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'captions' && (
              <div className="vw-preset-list">
                <div className="vw-preset-card vw-caption-card">
                  <div className="vw-preset-header">
                    <span className="vw-tag caption">Caption</span>
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
                    <span className="vw-tag voice">Voiceover</span>
                    {isRecordingVoiceover ? (
                      <button type="button" className="btn xs danger" onClick={handleStopVoiceover}>Stop ({recordingSeconds}s)</button>
                    ) : (
                      <button type="button" className="btn xs" onClick={() => void handleStartVoiceover()}><Icon name="mic" size={12} />Record</button>
                    )}
                  </div>
                  <div className="vw-preset-name">Microphone voiceover</div>
                  <p className="vw-preset-desc">Records narration to A1 at the playhead. Footage sound arrives on A1 by itself when a clip is added.</p>
                </div>
              </div>
            )}
          </div>

          {selectedClip && <ClipInspector clip={selectedClip} onChange={updateClip} onDelete={deleteSelectedClip} onUnlink={() => unlinkClip(selectedClip.id)} linkedWith={selectedClip.linkId ? project.clips.find((c) => c.linkId === selectedClip.linkId && c.id !== selectedClip.id) : undefined} />}
        </aside>

        <section className="vw-monitor-panel">
          <div className="vw-monitor-container">
            <canvas ref={canvasRef} className="vw-canvas" style={{ '--vw-ar': project.width / project.height } as React.CSSProperties} />
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
                      <button type="button" className="btn vw-start-story" onClick={() => setActiveTab('story')}><Icon name="newspaper" size={14} />Build from story</button>
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
            <span className="vw-current-time mono">{formatShortTime(currentTime)}</span>
            <span className="vw-total-time mono">/ {formatShortTime(length)}</span>
          </div>
        </section>
      </div>

      {/* 3. Timeline */}
      <footer className="vw-timeline-footer">
        <div className="vw-timeline-toolbar">
          <div className="vw-tl-tools-left">
            <button type="button" className="btn sm" onClick={splitAtPlayhead} data-tip="Split the clip at the playhead (S)"><Icon name="crop" size={13} /> Split</button>
            <button type="button" className="btn sm" disabled={!selectedClipId} onClick={deleteSelectedClip} data-tip="Delete the selected clip (Del)"><Icon name="trash" size={13} /> Delete</button>
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
            <div ref={rulerRef} className="vw-ruler" onPointerDown={handleRulerPointerDown} style={{ width: `${project.duration * zoom}px`, '--vw-sec': `${zoom}px` } as React.CSSProperties}>
              {Array.from({ length: Math.ceil(project.duration / 5) + 1 }).map((_, i) => (
                <div key={i} className="vw-ruler-mark" style={{ left: `${i * 5 * zoom}px` }}><span className="vw-ruler-label mono">{formatShortTime(i * 5)}</span></div>
              ))}
            </div>
            <div className="vw-playhead-line" style={{ left: `${currentTime * zoom}px` }}><div className="vw-playhead-handle" /></div>
            <div className="vw-lanes-container">
              {project.tracks.map((t) => (
                <div key={t.id} className={`vw-track-lane lane-${t.kind}${t.locked ? ' locked' : ''}`}>
                  {(() => { const rows = laneRows(project.clips.filter((c) => c.trackId === t.id)); return project.clips.filter((c) => c.trackId === t.id).map((clip) => {
                    const row = rows.row.get(clip.id) ?? 0
                    const isSelected = clip.id === selectedClipId
                    const locked = lockedTracks.has(clip.trackId)
                    return (
                      <div
                        key={clip.id}
                        className={`vw-clip-block ${isSelected ? 'selected' : ''}${clip.sourceUrl || (clip.kind !== 'video' && clip.kind !== 'audio') ? '' : ' offline'}${rows.count > 1 ? ' stacked' : ''}`}
                        data-clip-kind={clip.kind}
                        style={{ left: `${clip.start * zoom}px`, width: `${clip.duration * zoom}px`, backgroundColor: clip.color, '--row': row, '--rows': rows.count } as React.CSSProperties}
                        onClick={(e) => { e.stopPropagation(); selectClip(clip.id) }}
                        onPointerDown={(e) => { e.stopPropagation(); selectClip(clip.id); if (!locked) setDraggedClip({ id: clip.id, startX: e.clientX, origStart: clip.start }) }}
                      >
                        {!locked && <div className="vw-trim-handle left" data-tip="Drag to trim the start" onPointerDown={(e) => { e.stopPropagation(); selectClip(clip.id); setTrimmingClip({ id: clip.id, side: 'left', startX: e.clientX }) }} />}
                        {clip.linkId && <span className="vw-clip-link" aria-label="Linked to its sound"><Icon name="link" size={10} /></span>}
                        <span className="vw-clip-title">{clipLabel(clip)}</span>
                        <span className="vw-clip-duration mono">{clip.duration.toFixed(1)}s</span>
                        {!locked && <div className="vw-trim-handle right" data-tip="Drag to trim the end" onPointerDown={(e) => { e.stopPropagation(); selectClip(clip.id); setTrimmingClip({ id: clip.id, side: 'right', startX: e.clientX }) }} />}
                      </div>
                    )
                  }) })()}
                </div>
              ))}
            </div>
          </div>
        </div>
      </footer>

      <footer className="statusbar vw-statusbar">
        <span>{project.clips.length} {project.clips.length === 1 ? 'clip' : 'clips'} · {project.tracks.length} tracks</span>
        {selectedClip && <><span className="sep" /><span className="vw-sb-sel">{clipLabel(selectedClip)}</span></>}
        {note && <><span className="sep" /><span className="vw-sb-note">{note}</span></>}
        <div className="spacer" />
        <span className="muted vw-sb-save">{dirty ? (autosavedAt ? `Unsaved · autosaved ${fmtTime(autosavedAt, { seconds: true })}` : 'Unsaved') : 'Saved'}</span>
        <span className="sep" />
        <span className="muted">{project.width} × {project.height} · {project.fps} fps · {formatShortTime(length)}</span>
      </footer>

      {exportModal && <ExportSheet project={project} onClose={() => setExportModal(false)} />}
      {confirmNew && (
        <Dialog
          title="Start a new video?"
          onClose={() => setConfirmNew(false)}
          width={440}
          footer={<>
            <button type="button" className="btn" onClick={() => setConfirmNew(false)}>Cancel</button>
            <button type="button" className="btn" onClick={() => { setConfirmNew(false); void doSave() }}>Save first</button>
            <button type="button" className="btn primary vw-confirm-new" onClick={() => { setConfirmNew(false); newProject() }}>New video</button>
          </>}
        >
          <p className="vw-confirm-body">This video has changes that are not saved to a file. Save it first, or start an empty one. The last autosave is kept until the new video is saved.</p>
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
  if (c.kind === 'caption') return (c.captionText ?? '').trim() || 'Caption (empty)'
  if (c.kind === 'overlay' && c.overlayType && c.overlayType !== 'logo' && !c.sourceUrl) return (c.overlayText ?? '').trim() || `${c.title} (empty)`
  return c.title
}

function ClipInspector({ clip, onChange, onDelete, onUnlink, linkedWith }: { clip: Clip; onChange: (c: Clip) => void; onDelete: () => void; onUnlink: () => void; linkedWith?: Clip }) {
  const isFootage = clip.kind === 'video'
  const labels = clip.overlayType ? OVERLAY_LABELS[clip.overlayType] : null
  const set = (patch: Partial<Clip>) => onChange({ ...clip, ...patch })
  const textOverlay = clip.kind === 'overlay' && clip.overlayType && clip.overlayType !== 'logo' && !clip.sourceUrl
  return (
    <div className="vw-inspector">
      <div className="vw-inspector-head">
        <span className="vw-inspector-title">{isFootage ? (clip.still ? 'STILL' : 'FOOTAGE') : clip.kind === 'audio' ? 'SOUND' : clip.kind === 'caption' ? 'CAPTION' : 'OVERLAY'}</span>
        <button type="button" className="ibtn" aria-label="Delete clip" data-tip="Delete clip (Del)" onClick={onDelete}><Icon name="trash" size={13} /></button>
      </div>
      <div className="vw-inspector-body">
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
            <p className="vw-hint">Empty fields show their label here only; they are never drawn into the export.</p>
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
            <div className="vw-field-pair">
              <div className="vw-field">
                <label>Position X <em>{pct(clip.offX ?? 0)}</em></label>
                <Slider className="vw-s-x" min={-1} max={1} step={0.005} value={clip.offX ?? 0} onChange={(v) => set({ offX: v })} />
              </div>
              <div className="vw-field">
                <label>Position Y <em>{pct(clip.offY ?? 0)}</em></label>
                <Slider className="vw-s-y" min={-1} max={1} step={0.005} value={clip.offY ?? 0} onChange={(v) => set({ offY: v })} />
              </div>
            </div>
            <div className="vw-field-pair">
              {(['cropL', 'cropR', 'cropT', 'cropB'] as const).map((k) => (
                <div className="vw-field" key={k}>
                  <label>Crop {k === 'cropL' ? 'left' : k === 'cropR' ? 'right' : k === 'cropT' ? 'top' : 'bottom'} <em>{pct(clip[k] ?? 0)}</em></label>
                  <Slider className={`vw-s-${k}`} min={0} max={0.45} step={0.005} value={clip[k] ?? 0} onChange={(v) => set({ [k]: v })} />
                </div>
              ))}
            </div>
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
            <Slider min={0} max={1} step={0.05} value={clip.opacity ?? 1} onChange={(v) => set({ opacity: v })} />
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

