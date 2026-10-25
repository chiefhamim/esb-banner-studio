import { useEffect, useRef, useState, useCallback } from 'react'
import { WorkspaceSwitcher } from '../shell/WorkspaceRail'
import { Icon } from '../ui/Icon'
import { IconButton, Select, Slider, Tabs } from '../ui/controls'
import type { AspectRatio, Clip, MediaAsset, OverlayTemplate } from './timeline'
import {
  deserializeVideoProject,
  formatShortTime,
  formatTimecode,
  serializeVideoProject,
} from './timeline'
import { useVideoStore } from './videoStore'
import { renderCompositeFrame } from './compositor'
import { ExportSheet } from './ExportSheet'

const TRACK_LABEL = { overlay: 'Overlays', video: 'Footage', caption: 'Captions', audio: 'Audio' } as const
import { StoryVideoPanel } from './StoryVideoPanel'
import { downloadVideoBlob } from './exportVideo'

export function VideoWorkspace() {
  const {
    project,
    currentTime,
    playing,
    selectedClipId,
    zoom,
    exporting,
    history,
    future,
    mediaAssets,
    isRecordingVoiceover,
    setAspect,
    setProjectName,
    seek,
    togglePlay,
    stepFrame,
    addClip,
    updateClip,
    moveClip,
    trimClipLeftDelta,
    trimClipRightDelta,
    splitAtPlayhead,
    deleteSelectedClip,
    selectClip,
    setZoom,
    toggleTrackMute,
    toggleTrackLock,
    resetToDemo,
    addMediaAsset,
    removeMediaAsset,
    setRecordingVoiceover,
    undo,
    redo,
    loadProject,
  } = useVideoStore()

  const [activeTab, setActiveTab] = useState<'overlays' | 'media' | 'captions' | 'audio' | 'story'>('media')
  const [exportModal, setExportModal] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)

  // Dragging states
  const [draggingPlayhead, setDraggingPlayhead] = useState(false)
  const [draggedClip, setDraggedClip] = useState<{ id: string; startX: number; origStart: number } | null>(null)
  const [trimmingClip, setTrimmingClip] = useState<{ id: string; side: 'left' | 'right'; startX: number } | null>(null)

  // Voiceover recording state
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])
  const recordingTimerRef = useRef<number | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [monitorSize, setMonitorSize] = useState('')
  const rulerRef = useRef<HTMLDivElement>(null)
  const timelineTracksRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const projectInputRef = useRef<HTMLInputElement>(null)

  // Active audio elements for timeline playback sync
  const activeAudiosRef = useRef<Map<string, HTMLAudioElement>>(new Map())

  // ---------------------------------------------------------------- Playback Engine
  useEffect(() => {
    let animId: number
    let lastT = performance.now()

    const tick = (now: number) => {
      if (playing) {
        const dt = (now - lastT) / 1000
        const next = currentTime + dt
        if (next >= project.duration) {
          seek(0)
        } else {
          seek(next)
        }
      }
      lastT = now
      if (playing) {
        animId = requestAnimationFrame(tick)
      }
    }

    if (playing) {
      lastT = performance.now()
      animId = requestAnimationFrame(tick)
    }

    return () => cancelAnimationFrame(animId)
  }, [playing, currentTime, project.duration, seek])

  // ---------------------------------------------------------------- Audio Playback Sync
  useEffect(() => {
    const audios = activeAudiosRef.current
    if (!playing) {
      audios.forEach((audio) => {
        try {
          audio.pause()
        } catch {}
      })
      return
    }

    // When playing, sync any active audio clips on track A1
    const a1Track = project.tracks.find((t) => t.id === 'a1')
    if (a1Track?.muted) {
      audios.forEach((audio) => audio.pause())
      return
    }

    const audioClips = project.clips.filter((c) => c.kind === 'audio' && c.sourceUrl)
    audioClips.forEach((clip) => {
      const url = clip.sourceUrl!
      let audio = audios.get(url)
      if (!audio) {
        audio = new Audio(url)
        audios.set(url, audio)
      }

      if (currentTime >= clip.start && currentTime < clip.start + clip.duration) {
        const offset = clip.in + (currentTime - clip.start)
        if (Math.abs(audio.currentTime - offset) > 0.15) {
          audio.currentTime = offset
        }
        audio.volume = clip.volume ?? 1
        if (audio.paused) {
          audio.play().catch(() => {})
        }
      } else {
        if (!audio.paused) {
          audio.pause()
        }
      }
    })
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
    renderCompositeFrame(ctx, project, currentTime, displayWidth, displayHeight)
    ctx.restore()
  }, [project, currentTime, monitorSize, mediaTick])

  // Re-render when the monitor box changes size (window resize, panel drag)
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
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return

      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        stepFrame(e.shiftKey ? -10 : -1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        stepFrame(e.shiftKey ? 10 : 1)
      } else if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        splitAtPlayhead()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedClipId) {
          e.preventDefault()
          deleteSelectedClip()
        }
      } else if (e.key === 'Home') {
        e.preventDefault()
        seek(0)
      } else if (e.key === 'End') {
        e.preventDefault()
        seek(project.duration)
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, stepFrame, splitAtPlayhead, selectedClipId, deleteSelectedClip, seek, project.duration, undo, redo])

  // ---------------------------------------------------------------- Pointer Dragging & Scrubbing
  const handleRulerPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    setDraggingPlayhead(true)
    const rect = rulerRef.current?.getBoundingClientRect()
    if (!rect) return
    const clickX = e.clientX - rect.left
    const newTime = Math.max(0, Math.min(project.duration, clickX / zoom))
    seek(newTime, true)
  }

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (draggingPlayhead && rulerRef.current) {
      const rect = rulerRef.current.getBoundingClientRect()
      const clickX = e.clientX - rect.left
      const newTime = Math.max(0, Math.min(project.duration, clickX / zoom))
      seek(newTime)
    } else if (draggedClip) {
      const dx = e.clientX - draggedClip.startX
      const dt = dx / zoom
      moveClip(draggedClip.id, Math.max(0, draggedClip.origStart + dt))
    } else if (trimmingClip) {
      const dx = e.clientX - trimmingClip.startX
      const dt = dx / zoom
      if (Math.abs(dt) >= 0.1) {
        if (trimmingClip.side === 'left') {
          trimClipLeftDelta(trimmingClip.id, dt)
        } else {
          trimClipRightDelta(trimmingClip.id, dt)
        }
        setTrimmingClip({ ...trimmingClip, startX: e.clientX })
      }
    }
  }, [draggingPlayhead, draggedClip, trimmingClip, zoom, project.duration, seek, moveClip, trimClipLeftDelta, trimClipRightDelta])

  const handlePointerUp = useCallback(() => {
    setDraggingPlayhead(false)
    setDraggedClip(null)
    setTrimmingClip(null)
  }, [])

  useEffect(() => {
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [handlePointerMove, handlePointerUp])

  // ---------------------------------------------------------------- Real Media Import Pipeline
  const handleImportFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const url = URL.createObjectURL(file)
      let type: 'video' | 'audio' | 'image' = 'video'
      if (file.type.startsWith('audio/')) type = 'audio'
      else if (file.type.startsWith('image/')) type = 'image'

      let duration = 0
      let width: number | undefined
      let height: number | undefined
      let thumbnailUrl: string | undefined

      if (type === 'video') {
        await new Promise<void>((resolve) => {
          const v = document.createElement('video')
          v.src = url
          v.preload = 'metadata'
          v.muted = true
          v.onloadedmetadata = () => {
            duration = v.duration || 5
            width = v.videoWidth
            height = v.videoHeight
            v.currentTime = Math.min(1.0, duration / 2)
          }
          v.onseeked = () => {
            try {
              const tc = document.createElement('canvas')
              tc.width = 160
              tc.height = 90
              const tctx = tc.getContext('2d')
              if (tctx) {
                tctx.drawImage(v, 0, 0, 160, 90)
                thumbnailUrl = tc.toDataURL('image/jpeg', 0.7)
              }
            } catch {}
            resolve()
          }
          v.onerror = () => resolve()
          setTimeout(resolve, 2000)
        })
      } else if (type === 'audio') {
        await new Promise<void>((resolve) => {
          const a = document.createElement('audio')
          a.src = url
          a.preload = 'metadata'
          a.onloadedmetadata = () => {
            duration = a.duration || 5
            resolve()
          }
          a.onerror = () => resolve()
          setTimeout(resolve, 1500)
        })
      } else if (type === 'image') {
        await new Promise<void>((resolve) => {
          const img = new Image()
          img.src = url
          img.onload = () => {
            width = img.naturalWidth
            height = img.naturalHeight
            thumbnailUrl = url
            resolve()
          }
          img.onerror = () => resolve()
          setTimeout(resolve, 1000)
        })
      }

      const asset: MediaAsset = {
        id: `asset-${Date.now()}-${i}`,
        name: file.name,
        type,
        url,
        duration,
        width,
        height,
        size: file.size,
        thumbnailUrl,
      }
      addMediaAsset(asset)
    }
  }

  const handleAddAssetToTimeline = (asset: MediaAsset) => {
    if (asset.type === 'video') {
      const dur = asset.duration > 0 ? asset.duration : 8.0
      addClip({
        id: `clip-vid-${Date.now()}`,
        trackId: 'v1',
        title: asset.name,
        kind: 'video',
        start: currentTime,
        duration: dur,
        in: 0,
        out: dur,
        color: '#2563eb',
        sourceUrl: asset.url,
        thumbnailUrl: asset.thumbnailUrl,
      })
    } else if (asset.type === 'audio') {
      const dur = asset.duration > 0 ? asset.duration : 10.0
      addClip({
        id: `clip-aud-${Date.now()}`,
        trackId: 'a1',
        title: asset.name,
        kind: 'audio',
        start: currentTime,
        duration: dur,
        in: 0,
        out: dur,
        color: '#8b5cf6',
        sourceUrl: asset.url,
      })
    } else if (asset.type === 'image') {
      addClip({
        id: `clip-img-${Date.now()}`,
        trackId: 'v2',
        title: asset.name,
        kind: 'overlay',
        start: currentTime,
        duration: 5.0,
        in: 0,
        out: 5.0,
        color: '#059669',
        sourceUrl: asset.url,
      })
    }
  }

  // ---------------------------------------------------------------- Microphone Voiceover Recording
  const handleStartVoiceover = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      recordedChunksRef.current = []

      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data)
      }

      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
        const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' })
        const url = URL.createObjectURL(blob)
        const dur = Math.max(1, recordingSeconds)
        const name = `Voiceover Take ${new Date().toLocaleTimeString()}`

        const asset: MediaAsset = {
          id: `asset-vo-${Date.now()}`,
          name,
          type: 'audio',
          url,
          duration: dur,
          size: blob.size,
        }
        addMediaAsset(asset)

        addClip({
          id: `clip-vo-${Date.now()}`,
          trackId: 'a1',
          title: name,
          kind: 'audio',
          start: currentTime,
          duration: dur,
          in: 0,
          out: dur,
          color: '#7c3aed',
          sourceUrl: url,
        })
        setRecordingVoiceover(false)
        setRecordingSeconds(0)
      }

      rec.start()
      mediaRecorderRef.current = rec
      setRecordingVoiceover(true)
      setRecordingSeconds(0)

      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((s) => s + 1)
      }, 1000)
    } catch (err) {
      console.error('Microphone error:', err)
      alert('Could not access microphone: ' + (err as Error).message)
      setRecordingVoiceover(false)
    }
  }

  const handleStopVoiceover = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
  }

  // ---------------------------------------------------------------- Project Save & Open
  const handleSaveProject = () => {
    const json = serializeVideoProject(project)
    const blob = new Blob([json], { type: 'application/json' })
    const filename = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.esbvideo`
    downloadVideoBlob(blob, filename)
    setSaveStatus('Project saved successfully')
    setTimeout(() => setSaveStatus(null), 3000)
  }

  const handleOpenProjectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      const content = evt.target?.result as string
      const loaded = deserializeVideoProject(content)
      if (loaded) {
        loadProject(loaded)
        setSaveStatus('Project loaded')
        setTimeout(() => setSaveStatus(null), 3000)
      } else {
        alert('Invalid video project format')
      }
    }
    reader.readAsText(file)
  }

  // ---------------------------------------------------------------- Quick Preset Inserters
  const handleAddOverlay = (type: OverlayTemplate, title: string, sub?: string) => {
    const newClip: Clip = {
      id: `clip-ov-${Date.now()}`,
      trackId: 'v2',
      title,
      kind: 'overlay',
      start: currentTime,
      duration: 5.0,
      in: 0,
      out: 5.0,
      color: type === 'breaking' ? '#ef4444' : type === 'logo' ? '#0ea5e9' : '#10b981',
      overlayType: type,
      overlayText: title,
      overlaySub: sub,
    }
    addClip(newClip)
  }

  const handleAddCaption = (text: string) => {
    const newClip: Clip = {
      id: `clip-cap-${Date.now()}`,
      trackId: 'c1',
      title: 'Caption',
      kind: 'caption',
      start: currentTime,
      duration: 4.5,
      in: 0,
      out: 4.5,
      color: '#f59e0b',
      captionText: text,
    }
    addClip(newClip)
  }

  // ---------------------------------------------------------------- Export Action
  const handleStartExport = () => setExportModal(true)

  const selectedClip = project.clips.find((c) => c.id === selectedClipId)

  return (
    <div className="video-workspace">
      {/* Hidden file pickers */}
      <input
        type="file"
        ref={fileInputRef}
        multiple
        accept="video/*,audio/*,image/*"
        style={{ display: 'none' }}
        onChange={(e) => handleImportFiles(e.target.files)}
      />
      <input
        type="file"
        ref={projectInputRef}
        accept=".esbvideo,.json"
        style={{ display: 'none' }}
        onChange={handleOpenProjectFile}
      />

      {/* 1. Header Toolbar */}
      <header className="vw-header">
        <WorkspaceSwitcher />
        <div className="vw-brand">
          <input
            type="text"
            className="vw-title-input"
            value={project.name}
            onChange={(e) => setProjectName(e.target.value)}
            title="Edit Project Title"
          />
        </div>

        <div className="vw-aspect">
          <Select
            value={project.aspect}
            options={[
              // the pixel size is a hint in the list, so the closed picker never cuts a word at a narrow window
              { value: '16:9', label: '16:9 Broadcast', hint: '1920×1080' },
              { value: '9:16', label: '9:16 Reels', hint: '1080×1920' },
              { value: '1:1', label: '1:1 Square', hint: '1080×1080' },
              { value: '4:5', label: '4:5 Facebook', hint: '1080×1350' },
            ]}
            onChange={(v) => setAspect(v as AspectRatio)}
            className="compact"
          />
        </div>

        <div className="vw-timecode mono">
          {formatTimecode(currentTime, project.fps)}
        </div>

        <div className="vw-header-actions">
          <div className="pillbar">
            <IconButton icon="undo" tip="Undo (Ctrl+Z)" disabled={history.length === 0} onClick={undo} />
            <IconButton icon="redo" tip="Redo (Ctrl+Y)" disabled={future.length === 0} onClick={redo} />
          </div>

          <button
            type="button"
            className="btn sm subtle"
            onClick={() => projectInputRef.current?.click()}
            title="Open Video Project"
          >
            <Icon name="folder" size={13} /><span className="vw-lbl">Open</span>
          </button>

          <button
            type="button"
            className="btn sm subtle"
            onClick={handleSaveProject}
            title="Save Project (.esbvideo)"
          >
            <Icon name="download" size={13} /><span className="vw-lbl">Save</span>
          </button>

          {isRecordingVoiceover ? (
            <button
              type="button"
              className="btn danger sm"
              onClick={handleStopVoiceover}
              title="Stop Recording"
            >
              <span className="vw-recording-dot" />
              Stop ({recordingSeconds}s)
            </button>
          ) : (
            <button
              type="button"
              className="btn sm subtle"
              onClick={handleStartVoiceover}
              title="Record Microphone Voiceover"
            >
              <Icon name="mic" size={13} /><span className="vw-lbl">Record</span>
            </button>
          )}

          <button
            type="button"
            className="btn sm subtle"
            onClick={resetToDemo}
            title="Load Broadcast Demo Template"
          >
            <Icon name="reset" size={13} /><span className="vw-lbl">Demo</span>
          </button>

          <button type="button" className="btn primary sm" onClick={handleStartExport} disabled={exporting}>
            <Icon name="download" size={14} /> {exporting ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </header>

      {/* 2. Middle Body: Asset Bin + Canvas Monitor */}
      <div className="vw-stage-row">
        {/* Left: Asset Library & Broadcast Overlay Bin */}
        <aside className="vw-bin-panel">
          <Tabs<typeof activeTab>
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
                <div
                  className="vw-dropzone"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    handleImportFiles(e.dataTransfer.files)
                  }}
                >
                  <span className="vw-dropzone-icon"><Icon name="upload" size={18} /></span>
                  <p>Import media</p>
                  <span>Click or drop video, audio or images · MP4, WebM, MOV, MP3, WAV, PNG, JPG</span>
                </div>

                {mediaAssets.map((asset) => (
                  <div key={asset.id} className="vw-media-card">
                    {asset.thumbnailUrl ? (
                      <img src={asset.thumbnailUrl} alt="" className="vw-media-thumb" />
                    ) : (
                      <div className="vw-media-thumb">
                        {asset.type.toUpperCase()}
                      </div>
                    )}
                    <div className="vw-media-info">
                      <div className="vw-media-title" title={asset.name}>{asset.name}</div>
                      <div className="vw-media-meta mono">
                        {asset.duration > 0 && <span>{formatShortTime(asset.duration)}</span>}
                        {asset.width && asset.height && <span>{asset.width}×{asset.height}</span>}
                        <span>{(asset.size / (1024 * 1024)).toFixed(1)} MB</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn xs"
                      onClick={() => handleAddAssetToTimeline(asset)}
                      data-tip="Add to the timeline at the playhead"
                    >
                      <Icon name="plus" size={12} />Add
                    </button>
                    <button
                      type="button"
                      className="ibtn xs"
                      onClick={() => removeMediaAsset(asset.id)}
                      title="Remove from Bin"
                    >
                      <Icon name="trash" size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'overlays' && (
              <div className="vw-preset-list">
                <div className="vw-preset-card">
                  <div className="vw-preset-header">
                    <span className="vw-tag lower-third">Lower Third</span>
                    <button
                      type="button"
                      className="btn xs"
                      onClick={() => handleAddOverlay('lower-third', 'Engr. Rezwanul Khan', 'Chairman, Power Development Board')}
                    >
                      <Icon name="plus" size={12} />Add
                    </button>
                  </div>
                  <div className="vw-preset-name">Speaker Name &amp; Title</div>
                  <p className="vw-preset-desc">Branded glass bar with 3-stripe ESB accent.</p>
                </div>

                <div className="vw-preset-card">
                  <div className="vw-preset-header">
                    <span className="vw-tag breaking">Breaking</span>
                    <button
                      type="button"
                      className="btn xs"
                      onClick={() => handleAddOverlay('breaking', 'জাতীয় গ্রিডে ৩০ মিলিয়ন ঘনফুট গ্যাস', 'সরাসরি সম্প্রচার · ESB News')}
                    >
                      <Icon name="plus" size={12} />Add
                    </button>
                  </div>
                  <div className="vw-preset-name">Breaking News Ticker Bar</div>
                  <p className="vw-preset-desc">Red broadcast alert with Bengali headline support.</p>
                </div>

                <div className="vw-preset-card">
                  <div className="vw-preset-header">
                    <span className="vw-tag logo">Logo Overlay</span>
                    <button
                      type="button"
                      className="btn xs"
                      onClick={() => handleAddOverlay('logo', 'ESB PowerLine Monogram')}
                    >
                      <Icon name="plus" size={12} />Add
                    </button>
                  </div>
                  <div className="vw-preset-name">Official ESB Monogram</div>
                  <p className="vw-preset-desc">Official brand artwork at native aspect ratio.</p>
                </div>

                <div className="vw-preset-card">
                  <div className="vw-preset-header">
                    <span className="vw-tag attribution">Attribution</span>
                    <button
                      type="button"
                      className="btn xs"
                      onClick={() => handleAddOverlay('lower-third', 'Petrobangla Briefing', 'Offshore Drilling Updates 2026')}
                    >
                      <Icon name="plus" size={12} />Add
                    </button>
                  </div>
                  <div className="vw-preset-name">Press Briefing Card</div>
                  <p className="vw-preset-desc">Corporate spokesperson identification.</p>
                </div>
              </div>
            )}

            {activeTab === 'captions' && (
              <div className="vw-preset-list">
                <div className="vw-preset-card">
                  <div className="vw-preset-header">
                    <span className="vw-tag caption">Subtitle</span>
                    <button
                      type="button"
                      className="btn xs"
                      onClick={() => handleAddCaption('গ্রিডে দৈনিক ৩০ মিলিয়ন ঘনফুট গ্যাস সরবরাহ শুরু')}
                    >
                      <Icon name="plus" size={12} />Add
                    </button>
                  </div>
                  <div className="vw-preset-name">Gas Supply Subtitle</div>
                  <p className="vw-preset-desc">Bengali news transcript line.</p>
                </div>

                <div className="vw-preset-card">
                  <div className="vw-preset-header">
                    <span className="vw-tag caption">Subtitle</span>
                    <button
                      type="button"
                      className="btn xs"
                      onClick={() => handleAddCaption('Electricity peak demand reaches 16,500 MW today')}
                    >
                      <Icon name="plus" size={12} />Add
                    </button>
                  </div>
                  <div className="vw-preset-name">Power Demand Metric</div>
                  <p className="vw-preset-desc">Bilingual English ticker subtitle.</p>
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
                      <button type="button" className="btn xs danger" onClick={handleStopVoiceover}>
                        Stop ({recordingSeconds}s)
                      </button>
                    ) : (
                      <button type="button" className="btn xs" onClick={handleStartVoiceover}>
                        <Icon name="mic" size={12} />Record
                      </button>
                    )}
                  </div>
                  <div className="vw-preset-name">Microphone Voiceover Take</div>
                  <p className="vw-preset-desc">Direct narration recording saved to Track A1.</p>
                </div>
              </div>
            )}
          </div>

          {/* Selected Clip Inspector */}
          {selectedClip && (
            <div className="vw-inspector">
              <div className="vw-inspector-head">
                <span className="vw-inspector-title">Clip Inspector</span>
                <button type="button" className="ibtn" aria-label="Delete clip" data-tip="Delete clip (Del)" onClick={deleteSelectedClip}>
                  <Icon name="trash" size={13} />
                </button>
              </div>
              <div className="vw-inspector-body">
                <div className="vw-field">
                  <label>Title</label>
                  <input
                    type="text"
                    value={selectedClip.title}
                    onChange={(e) => updateClip({ ...selectedClip, title: e.target.value })}
                  />
                </div>
                {selectedClip.overlayText !== undefined && (
                  <div className="vw-field">
                    <label>Headline / Name</label>
                    <input
                      type="text"
                      value={selectedClip.overlayText}
                      onChange={(e) => updateClip({ ...selectedClip, overlayText: e.target.value })}
                    />
                  </div>
                )}
                {selectedClip.overlaySub !== undefined && (
                  <div className="vw-field">
                    <label>Subtitle / Role</label>
                    <input
                      type="text"
                      value={selectedClip.overlaySub}
                      onChange={(e) => updateClip({ ...selectedClip, overlaySub: e.target.value })}
                    />
                  </div>
                )}
                {selectedClip.captionText !== undefined && (
                  <div className="vw-field">
                    <label>Caption Text</label>
                    <input
                      type="text"
                      value={selectedClip.captionText}
                      onChange={(e) => updateClip({ ...selectedClip, captionText: e.target.value })}
                    />
                  </div>
                )}
                {selectedClip.kind === 'audio' && (
                  <div className="vw-field">
                    <label>Volume ({Math.round((selectedClip.volume ?? 1) * 100)}%)</label>
                    <Slider min={0} max={1} step={0.05} value={selectedClip.volume ?? 1} onChange={(v) => updateClip({ ...selectedClip, volume: v })} />
                  </div>
                )}
                <div className="vw-field">
                  <label>Opacity ({Math.round((selectedClip.opacity ?? 1) * 100)}%)</label>
                  <Slider min={0} max={1} step={0.05} value={selectedClip.opacity ?? 1} onChange={(v) => updateClip({ ...selectedClip, opacity: v })} />
                </div>
                <div className="vw-metrics">
                  <span>Start: {formatShortTime(selectedClip.start)}</span>
                  <span>Duration: {selectedClip.duration.toFixed(1)}s</span>
                  <span>In: {selectedClip.in.toFixed(1)}s</span>
                </div>
              </div>
            </div>
          )}
        </aside>

        {/* Right: Video Canvas Monitor & Player */}
        <section className="vw-monitor-panel">
          <div className="vw-monitor-container">
            <canvas
              ref={canvasRef}
              className="vw-canvas"
              style={{ '--vw-ar': project.width / project.height } as React.CSSProperties}
            />
          </div>

          {/* Transport Controls Bar */}
          <div className="vw-transport">
            <IconButton icon="skipBack" tip="Jump to start (Home)" onClick={() => seek(0)} />
            <IconButton icon="chevLeft" tip="Back one frame (←)" onClick={() => stepFrame(-1)} />
            <button
              type="button"
              className={`btn primary sm play-btn ${playing ? 'playing' : ''}`}
              onClick={togglePlay}
              title="Play / Pause (Space)"
            >
              <Icon name={playing ? 'pause' : 'play'} size={13} />
              {playing ? 'Pause' : 'Play'}
            </button>
            <IconButton icon="chevRight" tip="Forward one frame (→)" onClick={() => stepFrame(1)} />
            <IconButton icon="skipForward" tip="Jump to end (End)" onClick={() => seek(project.duration)} />

            <div className="vw-transport-sep" />

            <span className="vw-current-time mono">{formatShortTime(currentTime)}</span>
            <span className="vw-total-time mono">/ {formatShortTime(project.duration)}</span>
          </div>
        </section>
      </div>

      {/* 3. Bottom Multi-Track Timeline Editor */}
      <footer className="vw-timeline-footer">
        {/* Timeline Tools Bar */}
        <div className="vw-timeline-toolbar">
          <div className="vw-tl-tools-left">
            <button
              type="button"
              className="btn sm"
              onClick={splitAtPlayhead}
              title="Split clip at playhead (S)"
            >
              <Icon name="crop" size={13} /> Split (S)
            </button>
            <button
              type="button"
              className="btn sm"
              disabled={!selectedClipId}
              onClick={deleteSelectedClip}
              title="Delete selected clip (Del)"
            >
              <Icon name="trash" size={13} /> Delete
            </button>
          </div>

          <div className="vw-tl-tools-right">
            <IconButton icon="minus" tip="Zoom Out Timeline" onClick={() => setZoom(zoom - 10)} />
            <span className="vw-zoom-label mono">{zoom} px/s</span>
            <IconButton icon="plus" tip="Zoom In Timeline" onClick={() => setZoom(zoom + 10)} />
          </div>
        </div>

        {/* Timeline Tracks & Ruler */}
        <div className="vw-tracks-scroll" ref={timelineTracksRef}>
          {/* Timeline Header Track Column */}
          <div className="vw-track-headers">
            <div className="vw-ruler-header">Tracks</div>
            {project.tracks.map((t) => (
              <div key={t.id} className="vw-track-head">
                <span className="vw-th-title" title={t.name}><b>{t.id.toUpperCase()}</b>{TRACK_LABEL[t.kind]}</span>
                <div className="vw-th-actions">
                  <button
                    type="button"
                    className={`vw-th-btn ${t.muted ? 'active' : ''}`}
                    onClick={() => toggleTrackMute(t.id)}
                    aria-label={`${t.muted ? 'Unmute' : 'Mute'} ${t.id.toUpperCase()}`}
                    aria-pressed={!!t.muted}
                    data-tip={t.muted ? 'Unmute track' : 'Mute track'}
                  >
                    <Icon name={t.muted ? 'volumeX' : 'volume'} size={13} />
                  </button>
                  <button
                    type="button"
                    className={`vw-th-btn ${t.locked ? 'active' : ''}`}
                    onClick={() => toggleTrackLock(t.id)}
                    aria-label={`${t.locked ? 'Unlock' : 'Lock'} ${t.id.toUpperCase()}`}
                    aria-pressed={!!t.locked}
                    data-tip={t.locked ? 'Unlock track' : 'Lock track'}
                  >
                    <Icon name={t.locked ? 'lock' : 'unlock'} size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Timeline Ruler & Track Lanes */}
          <div className="vw-lanes-area" style={{ width: `${project.duration * zoom + 300}px` }}>
            {/* Time Ruler */}
            <div
              ref={rulerRef}
              className="vw-ruler"
              onPointerDown={handleRulerPointerDown}
              style={{ width: `${project.duration * zoom}px`, '--vw-sec': `${zoom}px` } as React.CSSProperties}
            >
              {Array.from({ length: Math.ceil(project.duration / 5) + 1 }).map((_, i) => {
                const sec = i * 5
                return (
                  <div key={sec} className="vw-ruler-mark" style={{ left: `${sec * zoom}px` }}>
                    <span className="vw-ruler-label mono">{formatShortTime(sec)}</span>
                  </div>
                )
              })}
            </div>

            {/* Playhead Line */}
            <div
              className="vw-playhead-line"
              style={{ left: `${currentTime * zoom}px` }}
            >
              <div className="vw-playhead-handle" />
            </div>

            {/* Track Lanes */}
            <div className="vw-lanes-container">
              {project.tracks.map((t) => (
                <div key={t.id} className={`vw-track-lane lane-${t.kind}`}>
                  {project.clips
                    .filter((c) => c.trackId === t.id)
                    .map((clip) => {
                      const isSelected = clip.id === selectedClipId
                      return (
                        <div
                          key={clip.id}
                          className={`vw-clip-block ${isSelected ? 'selected' : ''}`}
                          style={{
                            left: `${clip.start * zoom}px`,
                            width: `${clip.duration * zoom}px`,
                            backgroundColor: clip.color,
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            selectClip(clip.id)
                          }}
                          onPointerDown={(e) => {
                            e.stopPropagation()
                            selectClip(clip.id)
                            setDraggedClip({ id: clip.id, startX: e.clientX, origStart: clip.start })
                          }}
                        >
                          {/* Left Trim Handle */}
                          <div
                            className="vw-trim-handle left"
                            title="Drag to trim start"
                            onPointerDown={(e) => {
                              e.stopPropagation()
                              selectClip(clip.id)
                              setTrimmingClip({ id: clip.id, side: 'left', startX: e.clientX })
                            }}
                          />

                          <span className="vw-clip-title">{clip.title}</span>
                          <span className="vw-clip-duration mono">{clip.duration.toFixed(1)}s</span>

                          {/* Right Trim Handle */}
                          <div
                            className="vw-trim-handle right"
                            title="Drag to trim duration"
                            onPointerDown={(e) => {
                              e.stopPropagation()
                              selectClip(clip.id)
                              setTrimmingClip({ id: clip.id, side: 'right', startX: e.clientX })
                            }}
                          />
                        </div>
                      )
                    })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </footer>

      <footer className="statusbar vw-statusbar">
        <span>{project.clips.length} {project.clips.length === 1 ? 'clip' : 'clips'} · {project.tracks.length} tracks</span>
        {selectedClip && <><span className="sep" /><span className="vw-sb-sel">{selectedClip.title}</span></>}
        {saveStatus && <><span className="sep" /><span className="vw-sb-note">{saveStatus}</span></>}
        <div className="spacer" />
        <span className="muted">{project.width} × {project.height} · {project.fps} fps · {formatShortTime(project.duration)}</span>
      </footer>

      {/* 4. Export */}
      {exportModal && <ExportSheet project={project} onClose={() => setExportModal(false)} />}
    </div>
  )
}
