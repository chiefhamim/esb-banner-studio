// The mixer: one strip per audio track (bus, fader in dB, pan, mute, solo, meter), the master (fader, limiter), the
// ducking card and the loudness card. A dock over the stage, opened from the timeline toolbar. Meters read the audio
// graph's analysers; loudness numbers come from the measurer; with no engine they are absent, never invented.
// Every drag is one undo step (GSlider). Styles: styles/video-audio.css (vw-mx-).

import { useEffect, useMemo } from 'react'
import { Icon } from '../ui/Icon'
import { IconButton, Select, Switch } from '../ui/controls'
import { useVideoStore, viewOf } from './videoStore'
import type { Track } from './timeline'
import { GSlider, LevelBar } from './audioControls'
import type { BusChoice, LoudnessTarget } from './audioAdapter'
import { useLiveLevels } from './useAudioMeters'
import {
  BUSES, LOUDNESS_CHOICES, PENDING_NOTE, capabilities, enginePending, fmtDb, fmtDbtp, fmtLufs, measureLoudnessNow, projectDucking, projectMaster, projectTarget,
  trackBus, trackPan, trackSolo, trackVolumeDb, useLoudness, writeDucking, writeDuckingC, writeMaster, writeMasterC, writeTarget, writeTrack, writeTrackC,
} from './audioAdapter'
import { fmtDateTime, useClockFormat } from '../ui/time'
import { trackLabels } from './trackLabels'

const panText = (p: number) => (Math.abs(p) < 0.02 ? 'C' : p < 0 ? `L${Math.round(-p * 100)}` : `R${Math.round(p * 100)}`)

/** Peak level (dBFS) of one meter reading; -Infinity (silence) reads as the floor. */
const peakDb = (l: { peak: number } | null | undefined) => (l ? Math.max(-60, l.peak) : null)

const BUS_COLOUR: Record<BusChoice, string> = { auto: '#8a8a94', voice: '#3b82f6', music: '#8b5cf6', fx: '#d97706', none: '#6b6b75' }
const busOptions = BUSES.map((b) => ({ value: b.value, label: b.label, hint: b.hint, swatch: BUS_COLOUR[b.value] }))

function Strip({ track, code, name, db, pending, dim }: { track: Track; code: string; name: string; db: number | null; pending: boolean; dim: boolean }) {
  const toggleMute = useVideoStore((s) => s.toggleTrackMute)
  const vol = trackVolumeDb(track)
  const pan = trackPan(track)
  const bus = trackBus(track)
  const solo = trackSolo(track)
  const state = `${track.muted ? ', muted' : ''}${solo ? ', soloed' : ''}`
  return (
    <div className={`vw-mx-strip${track.muted ? ' muted' : ''}${solo ? ' soloed' : ''}${dim ? ' dim' : ''}`} data-track-id={track.id} role="group" aria-label={`${code} ${name}${state}`}>
      <div className="vw-mx-name" data-tip={`${code} · ${name}`}><b>{code}</b><span>{name}</span></div>
      <span className="vw-mx-busw" data-bus={bus} style={{ ['--bus' as string]: BUS_COLOUR[bus] }}>
        <Select<BusChoice>
          value={bus}
          options={busOptions}
          onChange={(v) => writeTrack(track.id, { bus: v === 'auto' ? null : v })}
          className="compact vw-mx-bus"
          title={pending ? PENDING_NOTE : `Bus: ${bus}. Which bus this track feeds`}
        />
      </span>
      <div className="vw-mx-fader">
        <GSlider className="vw-mx-vol" label={`${code} volume`} min={-60} max={12} step={0.5} value={vol} defaultValue={0} disabled={pending} onChange={(v) => writeTrackC(track.id, { volume: v })} />
        <span className="vw-mx-val mono">{fmtDb(vol)}</span>
      </div>
      <div className="vw-mx-pan">
        <GSlider className="vw-mx-panner" label={`${code} pan`} min={-1} max={1} step={0.02} value={pan} defaultValue={0} disabled={pending} onChange={(v) => writeTrackC(track.id, { pan: v })} />
        <span className="vw-mx-val mono">{panText(pan)}</span>
      </div>
      <div className="vw-mx-btns">
        <button type="button" className={`vw-mx-btn mute${track.muted ? ' on' : ''}`} aria-pressed={!!track.muted} aria-label={`${track.muted ? 'Unmute' : 'Mute'} ${code}`} data-tip={track.muted ? 'Muted. Click to unmute' : 'Mute'} onClick={() => toggleMute(track.id)}>M</button>
        <button type="button" className={`vw-mx-btn solo${solo ? ' on' : ''}`} aria-pressed={solo} aria-label={`${solo ? 'Unsolo' : 'Solo'} ${code}`} data-tip={pending ? PENDING_NOTE : solo ? 'Soloed. Click to unsolo' : 'Solo: hear only soloed tracks'} disabled={pending} onClick={() => writeTrack(track.id, { solo: !solo })}>S</button>
      </div>
      <LevelBar db={db} vertical={false} label={`${code} level`} idle={db == null} />
    </div>
  )
}

function Slot({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return <div className="vw-mx-slot"><span className="vw-mx-slot-label">{label}</span>{children}<span className="vw-mx-val mono">{value}</span></div>
}

const LIMITER_INFO = 'The preview limiter is a safety compressor. The export applies the true-peak limiter and the loudness target. Faders and ducking are heard in the preview.'

function MasterStrip({ db, pending }: { db: number | null; pending: boolean }) {
  const project = useVideoStore((s) => s.project)
  const m = projectMaster(project)
  return (
    <div className="vw-mx-strip master" role="group" aria-label="Master">
      <div className="vw-mx-name"><b>M</b><span>Master</span></div>
      <div className="vw-mx-fader">
        <GSlider className="vw-mx-master-vol" label="Master volume" min={-60} max={12} step={0.5} value={m.gain} defaultValue={0} disabled={pending} onChange={(v) => writeMasterC({ gain: v })} />
        <span className="vw-mx-val mono">{fmtDb(m.gain)}</span>
      </div>
      <div className="vw-mx-limiter">
        <Switch checked={m.limiter} onChange={(v) => writeMaster({ limiter: v })} label={`Limiter · ${m.limiter ? 'on' : 'off'}`} />
        <span className="vw-mx-info" tabIndex={0} role="img" aria-label={LIMITER_INFO} data-tip={LIMITER_INFO}><Icon name="info" size={13} /></span>
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
        <Slot label="Depth" value={`−${d.depthDb.toFixed(0)} dB`}><GSlider label="Ducking depth" min={3} max={30} step={1} value={d.depthDb} defaultValue={12} disabled={pending} onChange={(v) => writeDuckingC({ depthDb: v })} /></Slot>
        <Slot label="Threshold" value={`${d.threshold.toFixed(0)} dB`}><GSlider label="Ducking threshold" min={-60} max={-10} step={1} value={d.threshold} defaultValue={-35} disabled={pending} onChange={(v) => writeDuckingC({ threshold: v })} /></Slot>
        <Slot label="Attack" value={`${Math.round(d.attack * 1000)} ms`}><GSlider label="Ducking attack" min={0.01} max={0.5} step={0.01} value={d.attack} defaultValue={0.05} disabled={pending} onChange={(v) => writeDuckingC({ attack: v })} /></Slot>
        <Slot label="Release" value={`${Math.round(d.release * 1000)} ms`}><GSlider label="Ducking release" min={0.1} max={2} step={0.05} value={d.release} defaultValue={0.4} disabled={pending} onChange={(v) => writeDuckingC({ release: v })} /></Slot>
      </div>
    </section>
  )
}

/** True-peak ceiling the export enforces. */
const TP_CEILING = -1
/** Within this many LU of the target counts as met. */
const MET_LU = 1

function LoudnessCard() {
  const project = useVideoStore((s) => s.project)
  const { reading, measuring, error, silent, progress } = useLoudness()
  useClockFormat()
  const caps = capabilities()
  const target = projectTarget(project)
  const num = typeof target === 'number' ? target : null
  const dev = reading && num != null ? reading.integrated - num : null
  const tpOk = reading ? reading.truePeak <= TP_CEILING : null
  let status: { state: 'met' | 'gain' | 'info'; text: string } | null = null
  if (reading && dev != null) {
    status = Math.abs(dev) <= MET_LU
      ? { state: 'met', text: `Target met (${dev >= 0 ? '+' : '−'}${Math.abs(dev).toFixed(1)} LU)` }
      : { state: 'gain', text: `${dev < 0 ? '+' : '−'}${Math.abs(dev).toFixed(1)} dB needed to reach ${num} LUFS` }
  } else if (reading && num == null) status = { state: 'info', text: 'No target set: the export keeps the mix as it plays' }
  return (
    <section className="vw-mx-card vw-mx-loud" aria-label="Loudness">
      <div className="vw-mx-card-head">
        <b>Loudness</b>
        <div className="vw-mx-head-acts">
        <Select<string>
          value={String(target)}
          options={LOUDNESS_CHOICES.map((c) => ({ value: String(c.value), label: c.label, hint: c.hint }))}
          onChange={(v) => writeTarget((v === 'off' ? 'off' : Number(v)) as LoudnessTarget)}
          className="compact vw-mx-target"
          prefix="Target"
          title={caps.target ? 'The export is normalised to this' : PENDING_NOTE}
        />
        <button type="button" className="btn sm vw-mx-measure-btn" disabled={!caps.measure || measuring} data-tip={caps.measure ? 'Measure the whole mix the way the export will play it' : 'The loudness measurer is not in this build yet'} onClick={() => void measureLoudnessNow(useVideoStore.getState().project)}>
          <Icon name="activity" size={13} />{measuring ? `Measuring ${Math.round(progress * 100)}%` : reading ? 'Measure again' : 'Measure'}
        </button>
        </div>
      </div>
      {status && <p className={`vw-mx-status ${status.state}`} role="status"><Icon name={status.state === 'met' ? 'check' : 'info'} size={13} />{status.text}</p>}
      <div className="vw-mx-readout" data-state={reading ? 'measured' : measuring ? 'measuring' : 'none'}>
        <div><span>Integrated</span><b className={`mono vw-mx-lufs${status ? ' ' + status.state : ''}`}>{reading ? fmtLufs(reading.integrated) : '—'}</b></div>
        <div><span>True peak</span><b className={`mono vw-mx-tp${tpOk == null ? '' : tpOk ? ' ok' : ' over'}`}>{reading ? fmtDbtp(reading.truePeak) : '—'}</b>{reading && <small className={`vw-mx-ceil ${tpOk ? 'ok' : 'over'}`}>{tpOk ? 'Under' : 'Over'} the −1 dBTP ceiling</small>}</div>
        <div><span>Range</span><b className="mono">{reading?.range != null ? `${reading.range.toFixed(1)} LU` : '—'}</b></div>
      </div>
      {reading && reading.target != null && reading.gainDb != null && <p className="vw-mx-measure-note vw-mx-gain">The export would apply {reading.gainDb >= 0 ? '+' : '−'}{Math.abs(reading.gainDb).toFixed(1)} dB{reading.wouldLimit ? ' and the true-peak limiter' : ''}. The preview does not apply the target.</p>}
      {reading && (reading.warnings?.length || reading.shortMix) ? (
        <ul className="vw-mx-warnings" role="status" aria-label="Loudness warnings">
          {(reading.warnings?.length ? reading.warnings : ['The mix is shorter than 0.4 s: its level was measured without gating, so the target is approximate.']).map((w) => <li key={w}><Icon name="alert" size={12} />{w}</li>)}
        </ul>
      ) : null}
      <div className="vw-mx-measure">
        <span className="vw-mx-measure-note vw-mx-when">
          {error ?? (silent ? 'Nothing audible to measure.' : reading ? `Whole mix · measured ${fmtDateTime(reading.at)}` : 'Not measured yet.')}
        </span>
      </div>
    </section>
  )
}

export function MixerPanel({ onClose, bottom }: { onClose: () => void; bottom: number }) {
  const project = useVideoStore((s) => viewOf(s))
  const pending = enginePending()
  const playing = useVideoStore((s) => s.playing)
  const levels = useLiveLevels(playing)
  const labels = useMemo(() => trackLabels(project.tracks), [project.tracks])
  const audio = project.tracks.filter((t) => t.kind === 'audio')
  const anySolo = audio.some((t) => trackSolo(t))
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target as HTMLElement)?.closest?.('input,textarea,select')) onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  // The dock sits over the stage: it never rises above the app header (46 px + a gap), whatever the window height.
  return (
    <aside className="vw-mixer" role="dialog" aria-label="Mixer" data-engine={pending ? 'pending' : 'ready'} data-tracks={audio.length} style={{ bottom, maxHeight: `calc(100% - ${bottom}px - 60px)` }}>
      <header className="vw-mx-head">
        <Icon name="sliders" size={14} /><b>Mixer</b>
        {pending && <span className="vw-mx-pending" data-tip={PENDING_NOTE}>Engine pending</span>}
        <span className="vw-mx-spacer" />
        <IconButton icon="x" size={14} tip="Close the mixer" className="vw-mx-close" onClick={onClose} />
      </header>
      <div className="vw-mx-body">
        {pending && <p className="vw-mx-banner"><Icon name="info" size={12} />The audio graph is not merged into this build yet, so volume, pan, solo, buses, ducking and normalising are switched off. Mute works now.</p>}
        <div className="vw-mx-strips" tabIndex={audio.length > 4 ? 0 : undefined} aria-label="Track strips">
          {audio.length === 0 && <p className="vw-mx-empty">No audio tracks yet. Add an Audio track from the timeline toolbar.</p>}
          {audio.map((t) => { const lb = labels.get(t.id) ?? { code: t.id.toUpperCase(), name: t.name }; return <Strip key={t.id} track={t} code={lb.code} name={lb.name} db={peakDb(levels?.tracks[t.id])} pending={pending} dim={anySolo && !trackSolo(t)} /> })}
        </div>
        <MasterStrip db={peakDb(levels?.master)} pending={pending} />
        <div className="vw-mx-cards">
          <DuckingCard pending={pending} />
          <LoudnessCard />
        </div>
      </div>
    </aside>
  )
}
