// The mixer: one strip per audio track (bus, fader in dB, pan, mute, solo, meter), the master (fader, limiter), the
// ducking card and the loudness card. A dock over the stage, opened from the timeline toolbar. Meters read the audio
// graph's analysers; loudness numbers come from the measurer; with no engine they are absent, never invented.
// Every drag is one undo step (GSlider). Styles: styles/video-audio.css (vw-mx-).

import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../ui/Icon'
import { IconButton, Select, Switch } from '../ui/controls'
import { useVideoStore, viewOf } from './videoStore'
import type { Track } from './timeline'
import { GSlider, LevelBar } from './audioControls'
import type { Bus, LoudnessTarget } from './audioAdapter'
import {
  BUSES, LOUDNESS_CHOICES, PENDING_NOTE, capabilities, enginePending, fmtDb, fmtDbtp, fmtLufs, measureLoudnessNow, projectDucking, projectMaster, projectTarget, readMeters,
  trackBus, trackPan, trackSolo, trackVolumeDb, useLoudness, writeDucking, writeMaster, writeTarget, writeTrack,
} from './audioAdapter'
import { fmtTime } from '../ui/time'
import { trackLabels } from './trackLabels'

const panText = (p: number) => (Math.abs(p) < 0.02 ? 'C' : p < 0 ? `L${Math.round(-p * 100)}` : `R${Math.round(p * 100)}`)

/** Poll the graph's analysers while the mixer is open (rAF, ~30 fps). */
function useMeters(open: boolean) {
  const [m, setM] = useState<ReturnType<typeof readMeters>>(null)
  useEffect(() => {
    if (!open) return
    let raf = 0
    let last = 0
    const tick = (t: number) => {
      if (t - last > 33) { last = t; setM(readMeters()) }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [open])
  return m
}

function Strip({ track, code, name, db, pending }: { track: Track; code: string; name: string; db: number | null; pending: boolean }) {
  const toggleMute = useVideoStore((s) => s.toggleTrackMute)
  const vol = trackVolumeDb(track)
  const pan = trackPan(track)
  const bus = trackBus(track)
  const solo = trackSolo(track)
  return (
    <div className={`vw-mx-strip${track.muted ? ' muted' : ''}`} data-track-id={track.id} role="group" aria-label={`${code} ${name}`}>
      <div className="vw-mx-name" data-tip={`${code} · ${name}`}><b>{code}</b><span>{name}</span></div>
      <Select<Bus>
        value={bus}
        options={BUSES.map((b) => ({ value: b.value, label: b.label }))}
        onChange={(v) => writeTrack(track.id, { bus: v })}
        className="compact vw-mx-bus"
        title={pending ? PENDING_NOTE : 'Which bus this track feeds'}
      />
      <div className="vw-mx-fader">
        <GSlider className="vw-mx-vol" label={`${code} volume`} min={-60} max={12} step={0.5} value={vol} defaultValue={0} disabled={pending} onChange={(v) => writeTrack(track.id, { volume: v })} />
        <span className="vw-mx-val mono">{fmtDb(vol)}</span>
      </div>
      <div className="vw-mx-pan">
        <GSlider className="vw-mx-panner" label={`${code} pan`} min={-1} max={1} step={0.02} value={pan} defaultValue={0} disabled={pending} onChange={(v) => writeTrack(track.id, { pan: v })} />
        <span className="vw-mx-val mono">{panText(pan)}</span>
      </div>
      <div className="vw-mx-btns">
        <button type="button" className={`vw-mx-btn mute${track.muted ? ' on' : ''}`} aria-pressed={!!track.muted} aria-label={`${track.muted ? 'Unmute' : 'Mute'} ${code}`} data-tip={track.muted ? 'Unmute' : 'Mute'} onClick={() => toggleMute(track.id)}>M</button>
        <button type="button" className={`vw-mx-btn solo${solo ? ' on' : ''}`} aria-pressed={solo} aria-label={`${solo ? 'Unsolo' : 'Solo'} ${code}`} data-tip={pending ? PENDING_NOTE : solo ? 'Unsolo' : 'Solo: hear only soloed tracks'} disabled={pending} onClick={() => writeTrack(track.id, { solo: !solo })}>S</button>
      </div>
      <LevelBar db={db} vertical={false} label={`${code} level`} idle={db == null} />
    </div>
  )
}

function Slot({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return <div className="vw-mx-slot"><span className="vw-mx-slot-label">{label}</span>{children}<span className="vw-mx-val mono">{value}</span></div>
}

function MasterStrip({ db, pending }: { db: number | null; pending: boolean }) {
  const project = useVideoStore((s) => s.project)
  const m = projectMaster(project)
  return (
    <div className="vw-mx-strip master" role="group" aria-label="Master">
      <div className="vw-mx-name"><b>M</b><span>Master</span></div>
      <Switch checked={m.limiter} onChange={(v) => writeMaster({ limiter: v })} label="Limiter" />
      <div className="vw-mx-fader">
        <GSlider className="vw-mx-master-vol" label="Master volume" min={-60} max={12} step={0.5} value={m.gain} defaultValue={0} disabled={pending} onChange={(v) => writeMaster({ gain: v })} />
        <span className="vw-mx-val mono">{fmtDb(m.gain)}</span>
      </div>
      <LevelBar db={db} vertical={false} label="Master level" idle={db == null} />
    </div>
  )
}

function DuckingCard({ pending }: { pending: boolean }) {
  const project = useVideoStore((s) => s.project)
  const d = projectDucking(project)
  const off = pending || !d.enabled
  return (
    <section className="vw-mx-card vw-mx-duck" aria-label="Ducking">
      <div className="vw-mx-card-head">
        <b>Ducking</b>
        <Switch checked={d.enabled} onChange={(v) => writeDucking({ enabled: v })} label="Music ducks under voice" />
      </div>
      <div className={`vw-mx-duck-grid${off ? ' off' : ''}`}>
        <Slot label="Depth" value={`−${d.depthDb.toFixed(0)} dB`}><GSlider label="Ducking depth" min={3} max={30} step={1} value={d.depthDb} defaultValue={12} disabled={pending} onChange={(v) => writeDucking({ depthDb: v })} /></Slot>
        <Slot label="Threshold" value={`${d.threshold.toFixed(0)} dB`}><GSlider label="Ducking threshold" min={-60} max={-10} step={1} value={d.threshold} defaultValue={-35} disabled={pending} onChange={(v) => writeDucking({ threshold: v })} /></Slot>
        <Slot label="Attack" value={`${Math.round(d.attack * 1000)} ms`}><GSlider label="Ducking attack" min={0.01} max={0.5} step={0.01} value={d.attack} defaultValue={0.05} disabled={pending} onChange={(v) => writeDucking({ attack: v })} /></Slot>
        <Slot label="Release" value={`${Math.round(d.release * 1000)} ms`}><GSlider label="Ducking release" min={0.1} max={2} step={0.05} value={d.release} defaultValue={0.4} disabled={pending} onChange={(v) => writeDucking({ release: v })} /></Slot>
      </div>
    </section>
  )
}

function LoudnessCard() {
  const project = useVideoStore((s) => s.project)
  const { reading, measuring, error } = useLoudness()
  const caps = capabilities()
  const target = projectTarget(project)
  const num = typeof target === 'number' ? target : null
  const dev = reading && num != null ? reading.integrated - num : null
  return (
    <section className="vw-mx-card vw-mx-loud" aria-label="Loudness">
      <div className="vw-mx-card-head">
        <b>Loudness</b>
        <Select<string>
          value={String(target)}
          options={LOUDNESS_CHOICES.map((c) => ({ value: String(c.value), label: c.label, hint: c.hint }))}
          onChange={(v) => writeTarget((v === 'off' ? 'off' : Number(v)) as LoudnessTarget)}
          className="compact vw-mx-target"
          title={caps.target ? 'The export is normalised to this' : PENDING_NOTE}
        />
      </div>
      <div className="vw-mx-readout" data-state={reading ? 'measured' : measuring ? 'measuring' : 'none'}>
        <div><span>Integrated</span><b className="mono vw-mx-lufs">{reading ? fmtLufs(reading.integrated) : '—'}</b></div>
        <div><span>True peak</span><b className="mono vw-mx-tp">{reading ? fmtDbtp(reading.truePeak) : '—'}</b></div>
        <div><span>Range</span><b className="mono">{reading?.range != null ? `${reading.range.toFixed(1)} LU` : '—'}</b></div>
      </div>
      <div className="vw-mx-measure">
        <button type="button" className="btn sm vw-mx-measure-btn" disabled={!caps.measure || measuring} data-tip={caps.measure ? 'Measure the whole mix the way the export will play it' : 'The loudness measurer is not in this build yet'} onClick={() => void measureLoudnessNow(useVideoStore.getState().project)}>
          <Icon name="activity" size={13} />{measuring ? 'Measuring' : 'Measure'}
        </button>
        <span className="vw-mx-measure-note">
          {error ?? (reading
            ? `Measured ${fmtTime(reading.at, { seconds: true })}${dev != null ? ` · ${Math.abs(dev) < 0.05 ? 'on target' : `${dev > 0 ? '+' : '−'}${Math.abs(dev).toFixed(1)} LU from target`}` : ''}`
            : caps.measure ? 'Not measured yet.' : 'Measuring needs the audio engine (pending).')}
        </span>
      </div>
    </section>
  )
}

export function MixerPanel({ onClose, bottom }: { onClose: () => void; bottom: number }) {
  const project = useVideoStore((s) => viewOf(s))
  const pending = enginePending()
  const meters = useMeters(true)
  const labels = useMemo(() => trackLabels(project.tracks), [project.tracks])
  const audio = project.tracks.filter((t) => t.kind === 'audio')
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target as HTMLElement)?.closest?.('input,textarea,select')) onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  return (
    <aside className="vw-mixer" role="dialog" aria-label="Mixer" data-engine={pending ? 'pending' : 'ready'} style={{ bottom }}>
      <header className="vw-mx-head">
        <Icon name="sliders" size={14} /><b>Mixer</b>
        {pending && <span className="vw-mx-pending" data-tip={PENDING_NOTE}>Engine pending</span>}
        <span className="vw-mx-spacer" />
        <IconButton icon="x" size={14} tip="Close the mixer" className="vw-mx-close" onClick={onClose} />
      </header>
      <div className="vw-mx-body">
        {pending && <p className="vw-mx-banner"><Icon name="info" size={12} />The audio graph is not merged into this build yet, so volume, pan, solo, buses, ducking and normalising are switched off. Mute works now.</p>}
        <div className="vw-mx-strips">
          {audio.length === 0 && <p className="vw-mx-empty">No audio tracks yet. Add an Audio track from the timeline toolbar.</p>}
          {audio.map((t) => { const lb = labels.get(t.id) ?? { code: t.id.toUpperCase(), name: t.name }; return <Strip key={t.id} track={t} code={lb.code} name={lb.name} db={meters ? meters.tracks[t.id] ?? null : null} pending={pending} /> })}
          <MasterStrip db={meters ? meters.master : null} pending={pending} />
        </div>
        <div className="vw-mx-cards">
          <DuckingCard pending={pending} />
          <LoudnessCard />
        </div>
      </div>
    </aside>
  )
}
