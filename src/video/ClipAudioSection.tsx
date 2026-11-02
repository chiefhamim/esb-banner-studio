// The clip inspector's Audio section: gain, pan, fades (numeric + curve), crossfade with the neighbour, noise
// reduction (amount + "use selection as noise sample") and beat markers as a proposal the editor accepts.
// With no audio engine the controls are present but off, with the reason in words.

import { useState } from 'react'
import { IconButton } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { Select } from '../ui/controls'
import type { Clip } from './timeline'
import { formatShortTime } from './timeline'
import { useVideoStore } from './videoStore'
import { useAudioJobs } from './audioJobs'
import { FxSection } from './EffectsPanel'
import { GSlider, NumField } from './audioControls'
import type { BeatProposal, FadeCurve } from './audioAdapter'
import { FADE_CURVES, FADE_MAX, PENDING_NOTE, acceptBeats, capabilities, clipDenoise, clipFadeIn, clipFadeOut, clipGainDb, clipPan, fmtDb, neighbourAfter, crossfadeBlocker, crossfadeWithNext, proposeBeats, beatsProblem, writeClip, writeClipC } from './audioAdapter'

const panText = (p: number) => (Math.abs(p) < 0.02 ? 'Centre' : p < 0 ? `Left ${Math.round(-p * 100)}` : `Right ${Math.round(p * 100)}`)
const curveOptions = FADE_CURVES.map((c) => ({ value: c.value, label: c.label, hint: c.hint }))

export function ClipAudioSection({ clip, locked, flash }: { clip: Clip; locked: boolean; flash: (m: string) => void }) {
  const caps = capabilities()
  const pending = !caps.clip
  const off = pending || locked
  const range = useVideoStore((s) => s.range)
  const [beats, setBeats] = useState<BeatProposal | null>(null)
  const [busy, setBusy] = useState(false)
  // Fades fold away in narrow windows (Gain, Pan and the denoise stay above the fold); the choice is the editor's after that
  const [fadesOpen, setFadesOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 1000)
  const gain = clipGainDb(clip)
  const pan = clipPan(clip)
  const fin = clipFadeIn(clip)
  const fout = clipFadeOut(clip)
  const dn = clipDenoise(clip)
  const nrError = useAudioJobs((s) => s.errors[clip.id])
  const blocker = crossfadeBlocker(clip) ?? (neighbourAfter(clip) ? crossfadeBlocker(neighbourAfter(clip)!) : null)
  const maxFade = (other: number) => Math.max(0, Math.min(FADE_MAX, clip.duration - other))

  const setFadeIn = (patch: Partial<typeof fin>) => writeClipC(clip.id, { fadeIn: { ...fin, ...patch, dur: Math.min(patch.dur ?? fin.dur, maxFade(fout.dur)) } })
  const setFadeOut = (patch: Partial<typeof fout>) => writeClipC(clip.id, { fadeOut: { ...fout, ...patch, dur: Math.min(patch.dur ?? fout.dur, maxFade(fin.dur)) } })

  // the range selection (timeline seconds) as a span of this clip's source file
  const rin = range.in
  const rout = range.out
  const lo = rin != null && rout != null ? Math.max(rin, clip.start) : null
  const hi = rin != null && rout != null ? Math.min(rout, clip.start + clip.duration) : null
  const sampleOk = lo != null && hi != null && hi - lo >= 0.1
  const useSample = () => {
    if (!sampleOk || lo == null || hi == null) return
    writeClip(clip.id, { denoise: { amount: dn.amount > 0 ? dn.amount : 0.6, noiseRange: [lo - clip.start, hi - clip.start] } })
    flash('Noise sample set from the selection')
  }

  const mark = async () => {
    setBusy(true)
    try {
      const p = await proposeBeats(clip)
      if (!p || (!p.beats.length && !p.onsets.length)) { setBeats(null); flash('No beats found in this clip.'); return }
      setBeats(p)
    } catch (e) {
      flash('Could not find beats: ' + String((e as Error).message || e).slice(0, 100))
    } finally { setBusy(false) }
  }

  return (
    <FxSection id="audio" title="Audio" icon="sliders">
      {pending && <p className="vw-hint vw-au-pending"><Icon name="info" size={12} />Audio engine pending: these controls switch on when the audio graph is merged.</p>}
      <div className="vw-au-duo">
        <div className="vw-field vw-au-row" data-row="gain">
          <label data-tip="Double-click the slider to reset to 0 dB">Gain <em>{fmtDb(gain)}</em>{gain !== 0 && !off && <IconButton icon="refresh" size={11} className="vw-au-reset" tip="Reset gain to 0 dB" onClick={() => writeClip(clip.id, { gain: 0 })} />}</label>
          <GSlider className="vw-s-gain" label="Clip gain" min={-24} max={24} step={0.5} value={gain} defaultValue={0} disabled={off} onChange={(v) => writeClipC(clip.id, { gain: v })} />
        </div>
        <div className="vw-field vw-au-row" data-row="pan">
          <label data-tip="Double-click the slider to centre">Pan <em>{panText(pan)}</em>{Math.abs(pan) >= 0.02 && !off && <IconButton icon="refresh" size={11} className="vw-au-reset" tip="Centre the pan" onClick={() => writeClip(clip.id, { pan: 0 })} />}</label>
          <GSlider className="vw-s-pan" label="Clip pan" min={-1} max={1} step={0.02} value={pan} defaultValue={0} disabled={off} onChange={(v) => writeClipC(clip.id, { pan: v })} />
        </div>
      </div>
      <button type="button" className="vw-subhead vw-au-fold" aria-expanded={fadesOpen} onClick={() => setFadesOpen((o) => !o)}>
        <Icon name={fadesOpen ? 'chevDown' : 'chevRight'} size={12} />Fades
        {!fadesOpen && <span className="vw-au-fold-sum">In {Math.round(fin.dur * 100) / 100} s · Out {Math.round(fout.dur * 100) / 100} s</span>}
      </button>
      {fadesOpen && <>
      <div className="vw-au-fade" data-row="fade-in">
        <span className="vw-au-fade-label">In</span>
        <NumField className="vw-f-fadein" label="Fade in seconds" unit="s" min={0} max={maxFade(fout.dur)} step={0.1} decimals={2} value={fin.dur} disabled={off} onChange={(v) => setFadeIn({ dur: v })} />
        <Select<FadeCurve> value={fin.curve} options={curveOptions} onChange={(v) => setFadeIn({ curve: v, dur: fin.dur || Math.min(0.5, maxFade(fout.dur)) })} className="compact vw-au-curve" title="Fade-in curve" />
      </div>
      <div className="vw-au-fade" data-row="fade-out">
        <span className="vw-au-fade-label">Out</span>
        <NumField className="vw-f-fadeout" label="Fade out seconds" unit="s" min={0} max={maxFade(fin.dur)} step={0.1} decimals={2} value={fout.dur} disabled={off} onChange={(v) => setFadeOut({ dur: v })} />
        <Select<FadeCurve> value={fout.curve} options={curveOptions} onChange={(v) => setFadeOut({ curve: v, dur: fout.dur || Math.min(0.5, maxFade(fin.dur)) })} className="compact vw-au-curve" title="Fade-out curve" />
      </div>
      <button type="button" className="btn sm vw-au-xfade" disabled={off || !neighbourAfter(clip) || !!blocker} aria-describedby={blocker ? 'vw-au-xfade-why' : undefined} data-tip={blocker ?? (neighbourAfter(clip) ? 'Fade this clip out while the next one fades in (equal power)' : 'No audio clip after this one on its track')} onClick={() => { const why = crossfadeWithNext(clip); if (why) flash(why); else flash('Crossfade made') }}>
        <Icon name="swap" size={12} />Crossfade with next clip
      </button>
      {blocker && <p id="vw-au-xfade-why" className="vw-au-note vw-au-xfade-why"><Icon name="info" size={12} />{blocker}</p>}
      </>}

      <div className="vw-subhead">Noise reduction</div>
      <div className="vw-field vw-au-row" data-row="denoise">
        <label>Amount <em>{Math.round(dn.amount * 100)}%</em></label>
        <GSlider className="vw-s-denoise" label="Noise reduction amount" min={0} max={1} step={0.05} value={dn.amount} defaultValue={0} disabled={off} onChange={(v) => writeClipC(clip.id, { denoise: { ...dn, amount: v } })} />
      </div>
      {nrError && <p className="vw-au-err vw-au-nr-err" role="alert"><Icon name="alert" size={12} />Noise reduction failed: {nrError}</p>}
      {dn.noiseDropped && !dn.noiseRange && <p className="vw-au-err vw-au-nr-dropped" role="status"><Icon name="info" size={12} />The noise sample was cut away by an edit: pick a new one.</p>}
      <div className="vw-au-sample">
        <button type="button" className="btn sm vw-au-sample-btn" disabled={off || !sampleOk} data-tip={sampleOk ? 'Learn the noise from the in–out range on the timeline (a stretch with no one speaking)' : 'Set an in–out range on the timeline over a stretch with only noise (I and O keys)'} onClick={useSample}>Use selection as noise sample</button>
        {dn.noiseRange
          ? <span className="vw-au-sample-note">Sample {formatShortTime(dn.noiseRange[0])}–{formatShortTime(dn.noiseRange[1])} <button type="button" className="btn xs subtle vw-au-sample-clear" disabled={off} onClick={() => writeClip(clip.id, { denoise: { amount: dn.amount, noiseRange: undefined } })}>Clear</button></span>
          : <span className="vw-au-sample-note">No sample: the quietest part of the clip is used.</span>}
      </div>

      <div className="vw-subhead">Beats</div>
      <button type="button" className="btn sm vw-au-beats" disabled={!caps.beats || busy} data-tip={caps.beats ? 'Find the beats in this clip; you choose whether to add them as markers' : 'Beat detection needs the audio engine (pending)'} onClick={() => void mark()}>
        <Icon name="activity" size={12} />{busy ? 'Listening' : 'Mark beats'}
      </button>
      {beats && beatsProblem(beats) && <p className="vw-au-err vw-au-beats-why" role="alert"><Icon name="alert" size={12} />{beatsProblem(beats)}</p>}
      {beats && (
        <div className="vw-au-proposal" role="group" aria-label="Beat proposal">
          <span><b>{beats.beats.length || beats.onsets.length}</b> {beats.beats.length ? 'beat' : 'strong onset'}{(beats.beats.length || beats.onsets.length) === 1 ? '' : 's'}{beats.tempo ? ` · about ${Math.round(beats.tempo.bpm)} BPM` : ''} found. Nothing is added yet.</span>
          <div className="vw-btn-row">
            <button type="button" className="btn xs primary vw-au-accept" onClick={() => { const why = beatsProblem(beats); if (why) { setBeats(null); flash(why); return } const n = acceptBeats(beats); flash(n ? `Added ${n} markers` : 'Those markers are already there'); setBeats(null) }}>Add as markers</button>
            <button type="button" className="btn xs vw-au-dismiss" onClick={() => setBeats(null)}>Dismiss</button>
          </div>
        </div>
      )}
      {!caps.beats && <p className="vw-hint">{PENDING_NOTE}</p>}
    </FxSection>
  )
}

