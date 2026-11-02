// The status bar's loudness chip: the last measured integrated loudness and true peak of the mix (from the mixer's
// Measure), or "Loudness not measured". Never a number the measurer did not produce.
import { useLoudness, fmtDbtp, fmtLufs, projectTarget } from './audioAdapter'
import { useVideoStore } from './videoStore'

export function LoudnessChip({ onOpen }: { onOpen: () => void }) {
  const reading = useLoudness((s) => s.reading)
  const measuring = useLoudness((s) => s.measuring)
  const target = useVideoStore((s) => projectTarget(s.project))
  const hot = !!reading && reading.truePeak > -1
  return (
    <button type="button" className={`vw-sb-loud${reading ? ' measured' : ''}${hot ? ' hot' : ''}`} onClick={onOpen} data-tip={reading ? `Integrated loudness and true peak of the whole mix${typeof target === 'number' ? ` · target ${target} LUFS` : ''}. Open the mixer to measure again.` : 'Open the mixer to measure the mix'}>
      {measuring ? 'Measuring loudness' : reading ? <><b className="mono">{fmtLufs(reading.integrated)}</b><span className="mono">{fmtDbtp(reading.truePeak)}</span></> : 'Loudness not measured'}
    </button>
  )
}
