import { describe, it, expect } from 'vitest'
import { applySize, captureFraming, sanitizeSizes, setFraming, variantFor } from '../../src/video/sizes'
import { loadUserTemplates, projectFromTemplate, saveUserTemplate, templateFrom, deleteUserTemplate, MAX_USER_TEMPLATES } from '../../src/video/userTemplates'
import { addClip, clipsMissingMedia, createDefaultTimeline, deserializeVideoProject, serializeVideoProject, type Clip, type VideoProject } from '../../src/video/timeline'
import { exportBlocker } from '../../src/video/exportVideo'

const footage = (over: Partial<Clip> = {}): Clip => ({ id: 'f1', trackId: 'v1', title: 'Interview', kind: 'video', start: 0, duration: 10, in: 0, out: 10, color: '#000', sourceUrl: 'esb-media://m/1', mediaAssetId: 'a1', ...over })
const proj = (clips: Clip[] = [footage()]): VideoProject => clips.reduce((p, c) => addClip(p, c), createDefaultTimeline('16:9'))

describe('one edit, several sizes', () => {
  it('switching shape keeps the timeline and swaps the framing', () => {
    const p = proj([footage({ fit: 'fill', offX: 0.2 })])
    const nine = applySize(p, '9:16')
    expect(nine.aspect).toBe('9:16')
    expect(nine.width).toBe(1080)
    expect(nine.clips).toHaveLength(1)
    expect(nine.clips[0].duration).toBe(10)
    // the 16:9 framing is remembered, the new shape starts without 16:9's offset
    expect(nine.clips[0].offX).toBeUndefined()
    const back = applySize(nine, '16:9')
    expect(back.clips[0].offX).toBe(0.2)
  })

  it('a framing set for another shape shows when the project enters it', () => {
    const p = setFraming(proj(), '9:16', { f1: { fit: 'fill', scale: 1.2, kfX: [{ t: 0, v: -0.1 }, { t: 5, v: 0.2 }] } })
    const nine = applySize(p, '9:16')
    expect(nine.clips[0].scale).toBe(1.2)
    expect(nine.clips[0].keyframes?.offX).toHaveLength(2)
  })

  it('edits to words and timing are shared by every size', () => {
    let p = proj([footage(), { id: 'cap', trackId: 'c1', title: 'C', kind: 'caption', start: 1, duration: 3, in: 0, out: 3, color: '#f59e0b', captionText: 'Hello' }])
    p = applySize(p, '9:16')
    p = { ...p, clips: p.clips.map((c) => (c.id === 'cap' ? { ...c, captionText: 'Changed', start: 2 } : c)) }
    const wide = applySize(p, '16:9')
    expect(wide.clips.find((c) => c.id === 'cap')).toMatchObject({ captionText: 'Changed', start: 2 })
  })

  it('variantFor gives the export size without changing the working copy', () => {
    const p = proj()
    const v = variantFor(p, '4:5')
    expect(v.width / v.height).toBeCloseTo(0.8, 2)
    expect(p.aspect).toBe('16:9')
  })

  it('survives saving and loading, and a hostile file cannot smuggle anything in', () => {
    const p = setFraming(proj(), '9:16', { f1: { scale: 1.3, offX: 0.1 } })
    const back = deserializeVideoProject(serializeVideoProject(p, []))
    expect(back?.sizes?.['9:16']?.f1).toMatchObject({ scale: 1.3, offX: 0.1 })
    expect(sanitizeSizes({ '9:16': { f1: { scale: 9999, offX: 'x', fit: 'evil', kfX: 'no' } }, '3:2': { f1: { scale: 1 } }, __proto__: { x: 1 } })).toBeUndefined()
    expect(captureFraming(proj([footage({ scale: 1.1 })])).f1.scale).toBe(1.1)
  })
})

describe('own templates', () => {
  const rich = (): VideoProject => {
    let p = proj([
      footage({ linkId: 'L' }),
      { id: 'snd', trackId: 'a1', title: 'sound', kind: 'audio', start: 0, duration: 10, in: 0, out: 10, color: '#8b5cf6', sourceUrl: 'esb-media://m/1', mediaAssetId: 'a1', linkId: 'L', volume: 0.7 },
      { id: 'cap', trackId: 'c1', title: 'Point 1', kind: 'caption', start: 1, duration: 4, in: 0, out: 4, color: '#f59e0b', captionText: 'Secret figure 592 crore' },
      { id: 'ttl', trackId: 'v2', title: 'T', kind: 'overlay', start: 0, duration: 5, in: 0, out: 5, color: '#10b981', titleData: { template: 'lower-third', fields: { name: 'Rahim Uddin', role: 'Director' } } },
      { id: 'dc', trackId: 'v2', title: 'Figure', kind: 'overlay', start: 5, duration: 5, in: 0, out: 5, color: '#0ea5e9', dataCard: { seriesId: 's', value: 1 } as never },
    ])
    p = { ...p, name: 'Secret story', markers: [{ id: 'm', t: 2, name: 'Secret marker', color: '#f00' }], loudnessTarget: -16, bugCorner: 'bl' }
    return p
  }

  it('keeps the structure and removes every word, figure, file and marker', () => {
    const t = templateFrom(rich(), 'My short')
    const json = JSON.stringify(t)
    for (const secret of ['Secret', 'Rahim', 'Director', '592', 'esb-media', 'mediaAssetId', 'sourceUrl']) expect(json, secret).not.toContain(secret)
    expect(t.shell.clips.map((c) => c.id)).toEqual(expect.arrayContaining(['f1', 'snd', 'cap', 'ttl']))
    expect(t.shell.clips.some((c) => c.id === 'dc')).toBe(false)
    expect(t.shell.loudnessTarget).toBe(-16)
    expect(t.shell.bugCorner).toBe('bl')
  })

  it('a video made from one has empty slots: its media is missing and the export is blocked until it is filled', () => {
    const p = projectFromTemplate(templateFrom(rich(), 'My short'))
    expect(p.name).toBe('My short')
    expect(clipsMissingMedia(p).length).toBeGreaterThan(0)
    expect(exportBlocker(p)).toBeTruthy()
    expect(p.clips.find((c) => c.id === 'cap')?.captionText).toBe('')
    expect(p.template?.name).toBe('My short')
  })

  it('is kept on this PC, replaced by id, limited, and deletable', () => {
    const mem = new Map<string, string>()
    const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v) } }
    const t = templateFrom(rich(), 'A', 'ut-1')
    expect(saveUserTemplate(t, st).ok).toBe(true)
    expect(saveUserTemplate({ ...t, name: 'A2' }, st).ok).toBe(true)
    expect(loadUserTemplates(st).map((x) => x.name)).toEqual(['A2'])
    for (let i = 0; i < MAX_USER_TEMPLATES - 1; i++) expect(saveUserTemplate(templateFrom(rich(), `T${i}`, `ut-x${i}`), st).ok).toBe(true)
    expect(saveUserTemplate(templateFrom(rich(), 'one too many', 'ut-over'), st)).toMatchObject({ ok: false })
    deleteUserTemplate('ut-1', st)
    expect(loadUserTemplates(st).some((x) => x.id === 'ut-1')).toBe(false)
  })

  it('ignores a damaged saved list', () => {
    expect(loadUserTemplates({ getItem: () => '{not json' })).toEqual([])
    expect(loadUserTemplates({ getItem: () => JSON.stringify([{ id: 1 }, { nothing: true }]) })).toEqual([])
  })
})
