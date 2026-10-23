import { describe, it, expect } from 'vitest'
import { audibleClips, exportDuration } from '../../src/video/exportVideo'
import { createDefaultTimeline } from '../../src/video/timeline'
import type { Clip } from '../../src/video/timeline'

const clip = (o: Partial<Clip>): Clip => ({ id: 'c', trackId: 'a1', title: 't', kind: 'audio', start: 0, duration: 2, in: 0, out: 2, color: '#000', sourceUrl: 'blob:x', ...o })

describe('video export plan', () => {
  it('exports the whole timeline unless a draft length is asked for', () => {
    const p = { ...createDefaultTimeline(), duration: 42 }
    expect(exportDuration(p)).toBe(42)
    expect(exportDuration(p, 10)).toBe(10)
    expect(exportDuration(p, 100)).toBe(42)
  })

  it('mixes only audible A1 clips: not muted, volume above zero, on an unmuted track, with a source', () => {
    const base = createDefaultTimeline()
    const p = { ...base, clips: [clip({ id: 'ok' }), clip({ id: 'muted', muted: true }), clip({ id: 'silent', volume: 0 }), clip({ id: 'nosrc', sourceUrl: undefined }), clip({ id: 'video', kind: 'video', trackId: 'v1' })] }
    expect(audibleClips(p).map((c) => c.id)).toEqual(['ok'])
    const trackMuted = { ...p, tracks: p.tracks.map((t) => (t.id === 'a1' ? { ...t, muted: true } : t)) }
    expect(audibleClips(trackMuted)).toEqual([])
  })
})
