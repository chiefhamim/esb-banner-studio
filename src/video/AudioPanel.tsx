// The bin's Audio tab: the voiceover recorder (countdown, level meter, punch-in) and the music library (one folder the
// owner chose; read-only; no bundled music). Styles: styles/video-audio.css (classes prefixed vw-au-).

import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../ui/Icon'
import { IconButton, Select, Switch } from '../ui/controls'
import { useVideoStore } from './videoStore'
import { hasDiskMedia } from './media'
import { WaveThumb, LevelBar } from './audioControls'
import { identityOf } from './engine/laneCanvas'
import { cancelVoiceover, setPunch, setTakeTrack, startVoiceover, stopVoiceover, useVoiceover } from './voiceover'
import { addMusicToTimeline, chooseMusicFolder, clearMusicFolder, dragMusic, fmtTrackLength, loadMusic, setLicenceNote, stopPreview, togglePreview, useMusic } from './musicLibrary'
import type { MusicFile } from './musicLibrary'
import { formatShortTime } from './timeline'
import '../styles/video-audio.css'

const ASSET_MIME = 'application/x-esb-asset'

function Recorder() {
  const vo = useVoiceover()
  const allTracks = useVideoStore((s) => s.project.tracks)
  const tracks = useMemo(() => allTracks.filter((t) => t.kind === 'audio'), [allTracks])
  const busy = vo.phase !== 'idle'
  const db = vo.level > 0.0005 ? 20 * Math.log10(vo.level) : -60
  const code = (id: string) => { const i = tracks.findIndex((t) => t.id === id); return `A${i + 1}` }
  return (
    <section className="vw-au-card vw-au-rec" aria-label="Voiceover">
      <div className="vw-au-head">
        <span className="vw-tag" data-tag="voice">Voiceover</span>
        {vo.phase === 'recording' ? (
          <button type="button" className="btn sm danger vw-au-stop" onClick={stopVoiceover}><span className="vw-recording-dot" />Stop · {vo.seconds}s</button>
        ) : vo.phase === 'countdown' || vo.phase === 'asking' ? (
          <button type="button" className="btn sm vw-au-cancel" onClick={cancelVoiceover}>Cancel</button>
        ) : (
          <button type="button" className="btn sm primary vw-au-record" onClick={() => void startVoiceover()}><Icon name="mic" size={13} />Record</button>
        )}
      </div>
      <div className="vw-au-meter-row">
        <span className="vw-au-meter-label">Mic level</span>
        <LevelBar db={busy ? db : null} vertical={false} label="Microphone level" idle={!busy} />
        <span className="vw-au-meter-db mono">{busy ? (db <= -60 ? '−∞' : `${Math.round(db)} dB`) : '—'}</span>
      </div>
      <div className="vw-au-opts">
        <Switch checked={vo.punch} onChange={setPunch} label="Punch in: play the picture while I record" />
        <div className="vw-au-field">
          <label>Take goes on</label>
          <Select<string>
            value={tracks.some((t) => t.id === vo.trackId) ? vo.trackId! : ''}
            options={[{ value: '', label: 'First free audio track' }, ...tracks.map((t) => ({ value: t.id, label: `${code(t.id)} · ${t.name}${t.locked ? ' (locked)' : ''}` }))]}
            onChange={(v) => setTakeTrack(v || null)}
            className="compact"
          />
        </div>
      </div>
      <p className="vw-au-note">Starts after a 3-2-1 countdown at the playhead{hasDiskMedia() ? ' and keeps each take with the app' : ''}. Use headphones when punching in.</p>
      {vo.error && <p className="vw-au-err" role="alert"><Icon name="alert" size={12} />{vo.error}</p>}
      {vo.note && <p className="vw-au-err" role="status"><Icon name="info" size={12} />{vo.note}</p>}
    </section>
  )
}

function TrackRow({ f }: { f: MusicFile }) {
  const playing = useMusic((s) => s.playing === f.rel)
  const url = useMusic((s) => s.urls[f.rel])
  const dur = useMusic((s) => s.durations[f.rel] ?? 0)
  const asset = useVideoStore((s) => s.mediaAssets.find((a) => a.musicRel === f.rel && !a.removed))
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const add = async () => {
    setBusy(true); setErr('')
    try { await addMusicToTimeline(f.rel, useVideoStore.getState().currentTime) } catch (e) { setErr(String((e as Error).message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) } finally { setBusy(false) }
  }
  const hasNote = !!asset?.licence
  return (
    <div className={`vw-au-track${playing ? ' playing' : ''}`} data-rel={f.rel} draggable onDragStart={(e) => { e.dataTransfer.setData(ASSET_MIME, dragMusic(f.rel)); e.dataTransfer.effectAllowed = 'copy' }}>
      <div className="vw-au-track-main">
        {url ? <WaveThumb url={url} identity={asset ? identityOf(asset, url) : url} duration={dur} width={56} height={36} className="vw-au-wave" /> : <div className="vw-au-wave vw-au-wave-empty" aria-hidden="true"><Icon name="volume" size={16} /></div>}
        <div className="vw-au-track-info">
          <div className="vw-au-title" data-tip={f.rel}>{f.title}</div>
          <div className="vw-au-sub">
            {dur > 0 && <span className="mono">{fmtTrackLength(dur)}</span>}
            {f.subfolder && <span className="vw-au-folder">{f.subfolder}</span>}
          </div>
          {f.tags.length > 0 && <div className="vw-au-tags">{f.tags.map((t) => <span key={t} className="vw-au-tag">{t}</span>)}</div>}
        </div>
        <div className="vw-au-track-acts">
          <IconButton icon={playing ? 'pause' : 'play'} size={14} className="vw-au-preview" tip={playing ? 'Stop preview' : 'Preview'} onClick={() => void togglePreview(f.rel)} />
          <IconButton icon="plus" size={14} className="vw-au-add" tip="Add to the music track at the playhead (or drag it onto the timeline)" disabled={busy} onClick={() => void add()} />
        </div>
      </div>
      <div className="vw-au-lic-row">
        <button type="button" className={`btn xs subtle vw-au-lic-btn${hasNote ? ' has' : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <Icon name="shield" size={11} />{hasNote ? 'Licence note' : 'Licence'}
        </button>
        {hasNote && !open && <span className="vw-au-lic-peek" data-tip={asset?.licence}>{asset?.licence}</span>}
      </div>
      {open && (
        asset
          ? <textarea className="vw-au-lic" rows={2} value={asset.licence ?? ''} placeholder="Where this track came from and what its licence allows (kept in the project)" aria-label={`Licence note for ${f.title}`} onChange={(e) => setLicenceNote(asset.id, e.target.value)} />
          : <p className="vw-au-note">Add the track to the project first; its licence note is kept in the project file.</p>
      )}
      {err && <p className="vw-au-err" role="alert"><Icon name="alert" size={12} />{err}</p>}
    </div>
  )
}

function Library() {
  const m = useMusic()
  const [q, setQ] = useState('')
  useEffect(() => { void loadMusic(); return () => stopPreview() }, [])
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase()
    return k ? m.files.filter((f) => `${f.title} ${f.tags.join(' ')} ${f.rel}`.toLowerCase().includes(k)) : m.files
  }, [m.files, q])
  return (
    <section className="vw-au-card vw-au-lib" aria-label="Music library">
      <div className="vw-au-head">
        <span className="vw-tag" data-tag="music">Music library</span>
        {m.supported && m.folder && (
          <div className="vw-au-lib-acts">
            <IconButton icon="refresh" size={14} tip="Read the folder again" onClick={() => void loadMusic()} />
            <IconButton icon="folder" size={14} tip="Choose another folder" onClick={() => void chooseMusicFolder()} />
            <IconButton icon="x" size={14} tip="Forget this folder" onClick={() => void clearMusicFolder()} />
          </div>
        )}
      </div>
      {!m.supported ? (
        <p className="vw-au-note"><Icon name="info" size={12} />The music library needs the desktop app: it reads one folder you choose on this PC.</p>
      ) : !m.folder ? (
        <>
          <p className="vw-au-note">ESB Studio ships no music and downloads none. Choose a folder of tracks you are licensed to use; the library lists only that folder and never changes it.</p>
          <button type="button" className="btn sm vw-au-choose" onClick={() => void chooseMusicFolder()}><Icon name="folder" size={13} />Choose music folder</button>
        </>
      ) : (
        <>
          <div className="vw-au-folderline" data-tip={m.folder.path}><Icon name="folder" size={12} /><span>{m.folder.name}</span><em className="mono">{m.files.length} track{m.files.length === 1 ? '' : 's'}</em></div>
          {m.files.length > 6 && <input type="search" className="vw-au-search" placeholder="Search title or tag" aria-label="Search the music library" value={q} onChange={(e) => setQ(e.target.value)} />}
          {m.loading && <p className="vw-au-note">Reading the folder</p>}
          {!m.loading && m.files.length === 0 && <p className="vw-au-note">No audio files here (MP3, WAV, M4A, AAC, OGG, Opus, FLAC). Put tracks in this folder and refresh.</p>}
          {m.truncated && <p className="vw-au-note"><Icon name="info" size={12} />Only the first {m.files.length} tracks are listed.</p>}
          <div className="vw-au-list">{shown.map((f) => <TrackRow key={f.rel} f={f} />)}</div>
        </>
      )}
      {m.error && <p className="vw-au-err" role="alert"><Icon name="alert" size={12} />{m.error}</p>}
    </section>
  )
}

export function AudioPanel() {
  const t = useVideoStore((s) => s.currentTime)
  return (
    <div className="vw-au" data-playhead={formatShortTime(t)}>
      <Recorder />
      <Library />
    </div>
  )
}

/** The 3-2-1 overlay over the monitor while a take counts down (Esc cancels it). */
export function CountdownOverlay() {
  const phase = useVoiceover((s) => s.phase)
  const count = useVoiceover((s) => s.count)
  useEffect(() => {
    if (phase !== 'countdown' && phase !== 'asking') return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); cancelVoiceover() } }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [phase])
  if (phase !== 'countdown') return null
  return (
    <div className="vw-au-countdown" role="status" aria-live="assertive" data-count={count}>
      <div className="vw-au-count-num" key={count}>{count}</div>
      <p>Recording at the playhead. Esc cancels.</p>
    </div>
  )
}
