// The status bar's loudness chip: the last measured integrated loudness and true peak of the mix (from the mixer's
// Measure), or "Loudness not measured". Never a number the measurer did not produce. It is never hidden: at narrow
// widths the target and peak drop out and the "-23.1 LUFS" stays, with its met / needs-gain state as a glyph and colour.
import { useLoudness, fmtDbtp, fmtLufs, projectTarget } from './audioAdapter'
import { useVideoStore } from './videoStore'
import { Icon } from '../ui/Icon'

export function LoudnessChip({ onOpen }: { onOpen: () => void }) {
  const reading = useLoudness((s) => s.reading)
  const measuring = useLoudness((s) => s.measuring)
  const target = useVideoStore((s) => projectTarget(s.project))
  const num = typeof target === 'number' ? target : null
  const hot = !!reading && reading.truePeak > -1
  const dev = reading && num != null ? reading.integrated - num : null
  const state = !reading ? 'none' : hot ? 'hot' : dev == null ? 'plain' : Math.abs(dev) <= 1 ? 'met' : 'gain'
  const verdict = dev == null ? '' : Math.abs(dev) <= 1 ? 'target met' : `${dev < 0 ? '+' : '−'}${Math.abs(dev).toFixed(1)} dB needed`
  const tip = reading
    ? `Whole mix: ${fmtLufs(reading.integrated)}, true peak ${fmtDbtp(reading.truePeak)}${hot ? ' (over the −1 dBTP ceiling)' : ''}${num != null ? `, target ${num} LUFS (${verdict})` : ', no target set'}. Click to open the mixer and measure again.`
    : 'Open the mixer to measure the mix'
  return (
    <button type="button" className={`vw-sb-loud${reading ? ' measured' : ''}${hot ? ' hot' : ''}`} data-state={state} onClick={onOpen} data-tip={tip} aria-label={reading ? `Loudness ${fmtLufs(reading.integrated)}${num != null ? `, target ${num}, ${verdict}` : ''}. Open the mixer` : measuring ? 'Measuring loudness' : 'Loudness not measured. Open the mixer'}>
      {measuring ? 'Measuring loudness' : reading ? (
        <>
          <Icon name={state === 'met' ? 'check' : state === 'none' || state === 'plain' ? 'volume' : 'alert'} size={12} className="vw-sb-loud-ic" />
          <b className="mono">{fmtLufs(reading.integrated)}</b>
          <span className="mono vw-sb-loud-tp">{fmtDbtp(reading.truePeak)}</span>
          {num != null && <span className="vw-sb-loud-target">target {num} · {verdict}</span>}
        </>
      ) : <><Icon name="volume" size={12} className="vw-sb-loud-ic" /><span>Loudness<span className="vw-sb-loud-long"> not measured</span></span></>}
    </button>
  )
}
