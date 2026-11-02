import type { Track } from './timeline'
import { TRACK_KIND_LABEL } from './timeline'

/** What the track headers call each track: picture tracks numbered from the bottom (V1 is the lowest), text,
 * caption and sound tracks from the top, so the numbers follow the order on screen; a default name is the kind,
 * with a number when two tracks share it ("Footage", "Footage 2"); a name the editor gave is kept. */
export function trackLabels(tracks: Track[]): Map<string, { code: string; name: string }> {
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
