import { describe, it, expect } from 'vitest'
import { activeFrames, audibleClips, emptyTextClips, exportBlocker, exportDuration } from '../../src/video/exportVideo'
import { createDefaultTimeline } from '../../src/video/timeline'
import type { Clip } from '../../src/video/timeline'
import { fieldText } from '../../src/video/compositor'

const clip = (o: Partial<Clip>): Clip => ({ id: 'c', trackId: 'a1', title: 't', kind: 'audio', start: 0, duration: 2, in: 0, out: 2, color: '#000', sourceUrl: 'blob:x', ...o })

describe('video export plan', () => {
  it('exports up to the end of the last clip unless a draft length is asked for', () => {
    const p = { ...createDefaultTimeline(), duration: 60, clips: [clip({ start: 40, duration: 2 })] }
    expect(exportDuration(p)).toBe(42)
    expect(exportDuration(p, 10)).toBe(10)
    expect(exportDuration(p, 100)).toBe(42)
  })

  it('mixes only audible clips: not muted, volume above zero, on an unmuted track, with a source', () => {
    const base = createDefaultTimeline()
    const p = { ...base, clips: [clip({ id: 'ok' }), clip({ id: 'muted', muted: true }), clip({ id: 'silent', volume: 0 }), clip({ id: 'nosrc', sourceUrl: undefined }), clip({ id: 'video', kind: 'video', trackId: 'v1' })] }
    expect(audibleClips(p).map((c) => c.id)).toEqual(['ok'])
    const trackMuted = { ...p, tracks: p.tracks.map((t) => (t.id === 'a1' ? { ...t, muted: true } : t)) }
    expect(audibleClips(trackMuted)).toEqual([])
  })

  it('a footage clip’s own sound (its linked A1 clip) is mixed like any other sound', () => {
    const p = { ...createDefaultTimeline(), clips: [clip({ id: 'v', kind: 'video', trackId: 'v1', linkId: 'L' }), clip({ id: 'a', linkId: 'L' })] }
    expect(audibleClips(p).map((c) => c.id)).toEqual(['a'])
  })

  it('refuses an empty timeline and one with missing media', () => {
    expect(exportBlocker(createDefaultTimeline())).toMatch(/empty/)
    const p = { ...createDefaultTimeline(), clips: [clip({ id: 'v', kind: 'video', trackId: 'v1', title: 'interview.mp4', sourceUrl: undefined })] }
    expect(exportBlocker(p)).toMatch(/interview\.mp4/)
    expect(exportBlocker({ ...p, clips: [{ ...p.clips[0], sourceUrl: 'blob:v' }] })).toBeNull()
    // titles and captions need no file
    expect(exportBlocker({ ...p, clips: [clip({ id: 'o', kind: 'overlay', trackId: 'v2', sourceUrl: undefined, overlayType: 'lower-third', overlayText: 'A' })] })).toBeNull()
  })

  it('plans exactly the frames a clip is on screen', () => {
    expect(activeFrames(clip({ start: 1, duration: 0.1 }), 30, 300)).toEqual([30, 31, 32])
    expect(activeFrames(clip({ start: 9.95, duration: 5 }), 30, 300).at(-1)).toBe(299)
  })
})

describe('placeholders are editor-only', () => {
  it('an empty field shows its label in the editor and nothing in an export', () => {
    expect(fieldText('', 'Speaker name', true)).toEqual({ text: 'Speaker name', placeholder: true })
    expect(fieldText('  ', 'Speaker name', false)).toBeNull()
    expect(fieldText('Real name', 'Speaker name', false)).toEqual({ text: 'Real name', placeholder: false })
  })

  it('lists the titles left out of an export because nothing was typed in', () => {
    const p = { ...createDefaultTimeline(), clips: [
      clip({ id: 'e', kind: 'overlay', trackId: 'v2', sourceUrl: undefined, overlayType: 'lower-third', overlayText: '', overlaySub: '' }),
      clip({ id: 'f', kind: 'overlay', trackId: 'v2', sourceUrl: undefined, overlayType: 'card', overlayText: 'Title' }),
      clip({ id: 'logo', kind: 'overlay', trackId: 'v2', overlayType: 'logo' }),
      clip({ id: 'cap', kind: 'caption', trackId: 'c1', captionText: '' }),
    ] }
    expect(emptyTextClips(p).map((c) => c.id)).toEqual(['e', 'cap'])
  })
})
