// @vitest-environment jsdom
// The Video desk's store and project I/O: what the fix round after Phase 0 changed — removing a bin item a clip still
// uses, locked linked partners, one undo step per gesture, saving while edits continue, snapshots per project,
// voiceover takes kept by path, and probing an import a few files at a time.
import { beforeEach, describe, expect, it } from 'vitest'
import { useVideoStore } from '../../src/video/videoStore'
import { clipsForAsset, createDefaultTimeline, deleteClip, deserializeVideoProject, groupLocked, moveClip, serializeVideoProject, splitClip, trimClipLeft, trimClipRight } from '../../src/video/timeline'
import type { MediaAsset, VideoProject } from '../../src/video/timeline'
import { clearSnapshots, latestSnapshot, loadProjectText, saveProject, writeSnapshot } from '../../src/video/projectIO'
import { keepTake, mapLimit } from '../../src/video/media'

const footage: MediaAsset = { id: 'a-foot', name: 'interview.mp4', type: 'video', url: 'esb-media://m/' + 'a'.repeat(32), path: 'C:\\media\\interview.mp4', duration: 6, size: 1000, hasAudio: true }
const S = () => useVideoStore.getState()

function withFootage(): VideoProject {
  const p = createDefaultTimeline('16:9')
  return { ...p, clips: clipsForAsset(p, footage, 0, 'auto', 'x') }
}

beforeEach(() => {
  localStorage.clear()
  delete (window as unknown as { esb?: unknown }).esb
  S().newProject()
})

describe('C2: removing a bin item that clips still use', () => {
  it('hides it instead of deleting it, keeps it in the saved file, and undo / redo bring it back / hide it again', () => {
    S().loadProject(withFootage(), { assets: [footage] })
    S().removeMediaAsset(footage.id)
    const hidden = S().mediaAssets.find((a) => a.id === footage.id)
    expect(hidden?.removed).toBe(true)
    // the clips still play it, and the project file still lists its path (so a reopen can find or relink it)
    expect(S().project.clips.every((c) => c.sourceUrl === footage.url)).toBe(true)
    const saved = JSON.parse(serializeVideoProject(S().project, S().mediaAssets))
    expect(saved.mediaAssets.map((a: MediaAsset) => a.path)).toEqual([footage.path])
    S().undo()
    expect(S().mediaAssets.find((a) => a.id === footage.id)?.removed).toBeFalsy()
    S().redo()
    expect(S().mediaAssets.find((a) => a.id === footage.id)?.removed).toBe(true)
  })

  it('an item no clip uses is left out of the saved file', () => {
    S().loadProject(createDefaultTimeline('16:9'), { assets: [footage] })
    S().removeMediaAsset(footage.id)
    expect(JSON.parse(serializeVideoProject(S().project, S().mediaAssets)).mediaAssets).toEqual([])
  })

  it('a reopened project whose removed item is missing still offers it for relinking', async () => {
    S().loadProject(withFootage(), { assets: [footage] })
    S().removeMediaAsset(footage.id)
    const text = serializeVideoProject(S().project, S().mediaAssets)
    // no desktop bridge here: a path cannot be resolved, so the file comes back missing
    await loadProjectText(text, { path: null, dirty: false })
    const a = S().mediaAssets.find((x) => x.id === footage.id)
    expect(a?.missing).toBe(true)
    expect(a?.removed).toBe(true)
    expect(S().project.clips.every((c) => !c.sourceUrl)).toBe(true)
  })
})

describe('C4: a lock protects a clip from edits made through its linked partner', () => {
  it('move, trim, split and delete of a pair with a locked side are refused as a whole', () => {
    const p0 = withFootage()
    const p = { ...p0, tracks: p0.tracks.map((t) => (t.id === 'a1' ? { ...t, locked: true } : t)) }
    const vid = p.clips.find((c) => c.kind === 'video')!
    expect(groupLocked(p, vid.id)).toBe(true)
    expect(moveClip(p, vid.id, 3)).toBe(p)
    expect(trimClipLeft(p, vid.id, 1)).toBe(p)
    expect(trimClipRight(p, vid.id, -1)).toBe(p)
    expect(splitClip(p, vid.id, 2)).toBe(p)
    expect(deleteClip(p, vid.id)).toBe(p)
    // unlocked, the pair moves together as before
    expect(moveClip(p0, vid.id, 3).clips.every((c) => c.start === 3)).toBe(true)
  })

  it('the store leaves no undo step for a refused edit', () => {
    const p0 = withFootage()
    S().loadProject({ ...p0, tracks: p0.tracks.map((t) => (t.id === 'v1' ? { ...t, locked: true } : t)) })
    const vid = S().project.clips.find((c) => c.kind === 'audio')!
    S().selectClip(vid.id)
    S().deleteSelectedClip()
    S().moveClip(vid.id, 4)
    expect(S().project.clips).toHaveLength(2)
    expect(S().history).toHaveLength(0)
  })
})

describe('P3: one undo step per gesture', () => {
  it('a drag of many pointer moves is one step, and a gesture that changed nothing leaves none', () => {
    S().loadProject(withFootage())
    const id = S().project.clips[0].id
    S().beginGesture()
    for (let x = 1; x <= 40; x++) S().moveClip(id, x * 0.1)
    S().endGesture()
    expect(S().history).toHaveLength(1)
    expect(S().project.clips.find((c) => c.id === id)!.start).toBeCloseTo(4)
    S().undo()
    expect(S().project.clips.find((c) => c.id === id)!.start).toBe(0)
    S().beginGesture()
    S().endGesture()
    expect(S().history).toHaveLength(0)
  })

  it('a slider gesture on one clip is one step', () => {
    S().loadProject(withFootage())
    const c = S().project.clips[0]
    S().beginGesture()
    for (let k = 1; k <= 30; k++) S().updateClip({ ...S().project.clips.find((x) => x.id === c.id)!, scale: 1 + k / 100 })
    S().endGesture()
    expect(S().history).toHaveLength(1)
  })
})

describe('C6: a save marks the project clean only if nothing changed while it was saving', () => {
  it('an edit after the text was taken keeps "Unsaved"', async () => {
    S().loadProject(withFootage(), { dirty: true })
    const saving = saveProject() // browser path: downloads, then marks saved
    S().setProjectName('Changed during the save')
    await saving
    expect(S().dirty).toBe(true)
    await saveProject()
    expect(S().dirty).toBe(false)
  })
})

describe('C3 / C7: snapshots per project; a full browser storage is reported, oldest pruned', () => {
  it('saving one project leaves another project’s snapshot restorable', async () => {
    await writeSnapshot(JSON.stringify({ ...createDefaultTimeline(), id: 'p-discarded', clips: [] }))
    await writeSnapshot(JSON.stringify({ ...createDefaultTimeline(), id: 'p-opened', clips: [] }))
    await clearSnapshots('p-opened')
    const snap = await latestSnapshot()
    expect(snap && JSON.parse(snap.text).id).toBe('p-discarded')
  })

  it('prunes the oldest snapshots when storage is full, and throws when even one does not fit', async () => {
    const real = Storage.prototype.setItem
    let budget = 1800
    Storage.prototype.setItem = function (k: string, v: string) { if (v.length > budget) throw new DOMException('quota', 'QuotaExceededError'); return real.call(this, k, v) }
    try {
      for (let i = 0; i < 4; i++) await writeSnapshot(JSON.stringify({ id: 'p', pad: 'x'.repeat(600), i }))
      const list = JSON.parse(localStorage.getItem('esb-banner-studio/video-autosave/v1')!)
      expect(list.length).toBeLessThan(4)
      expect(JSON.parse(list.at(-1).text).i).toBe(3)
      budget = 10
      await expect(writeSnapshot(JSON.stringify({ id: 'p', i: 9 }))).rejects.toThrow(/storage is full/)
    } finally {
      Storage.prototype.setItem = real
    }
  })
})

describe('C1: a recorded voiceover is kept by path on the desktop', () => {
  it('the take is written through main and saved with its path, so a reopen finds it', { timeout: 20000 }, async () => {
    const written: { name: string; size: number }[] = []
    ;(window as unknown as { esb: unknown }).esb = {
      videoImport: async () => [],
      videoStoreTake: async (name: string, bytes: Uint8Array) => { written.push({ name, size: bytes.length }); return { path: 'C:\\Users\\x\\AppData\\Roaming\\ESB\\video-takes\\Voiceover-abc.webm', name: 'Voiceover-abc.webm', size: bytes.length, mtimeMs: 1, url: 'data:,' } },
    }
    const blob = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4])], { type: 'audio/webm' })
    const { asset, onDisk } = await keepTake(blob, 'Voiceover 4:58 PM', 2.5)
    expect(onDisk).toBe(true)
    expect(written).toEqual([{ name: 'Voiceover 4:58 PM', size: 8 }])
    expect(asset.type).toBe('audio')
    expect(asset.path).toMatch(/video-takes/)
    const p = createDefaultTimeline()
    const text = serializeVideoProject({ ...p, clips: [{ id: 'vo', trackId: 'a1', title: 'VO', kind: 'audio', start: 0, duration: 2.5, in: 0, out: 2.5, color: '#000', sourceUrl: asset.url, mediaAssetId: asset.id }] }, [asset])
    const back = deserializeVideoProject(text)!
    expect(back.mediaAssets![0].path).toBe(asset.path)
    expect(back.clips[0].mediaAssetId).toBe(asset.id)
  })

  it('when main refuses the take it still plays this session, and says it is not on disk', async () => {
    ;(window as unknown as { esb: unknown }).esb = { videoImport: async () => [], videoStoreTake: async () => { throw new Error('folder is full') } }
    URL.createObjectURL ??= () => 'blob:test'
    const r = await keepTake(new Blob([new Uint8Array(12)]), 'VO', 1)
    expect(r.onDisk).toBe(false)
    expect(r.error).toMatch(/full/)
    expect(r.asset.url).toMatch(/^blob:/)
  })
})

describe('P4: an import is probed a few files at a time', () => {
  it('mapLimit never runs more than the limit at once and keeps the order', async () => {
    let running = 0
    let peak = 0
    const out = await mapLimit(Array.from({ length: 40 }, (_, i) => i), 4, async (i) => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 2))
      running--
      return i * 2
    })
    expect(peak).toBe(4)
    expect(out).toEqual(Array.from({ length: 40 }, (_, i) => i * 2))
  })
})
