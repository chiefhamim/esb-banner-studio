// Phase 1 Part A: the .esbvideo project folder (electron/video-project.cjs), its schema and migration
// (src/video/projectFolder.ts), relinking by hash, the cache and the proxy rules. The renderer is hostile: every path
// it names inside a folder is checked here against traversal, UNC, junctions / symlinks, data streams and device names.
import { describe, it, expect, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildProjectDoc, migrateProjectDoc, NewerProjectError, parseProjectText, PROJECT_SCHEMA_VERSION, relInMedia, schemaVersionOf } from '../../src/video/projectFolder'
import { proxySize, wantsProxy, isOver1080p, readCache, writeCache, CACHE_MAX_ENTRY } from '../../src/video/media'
import { serializeVideoProject } from '../../src/video/timeline'
import type { MediaAsset, VideoProject } from '../../src/video/timeline'

const require = createRequire(import.meta.url)
const vp = require('../../electron/video-project.cjs')
const vm = require('../../electron/video-media.cjs')

let dir: string
let root: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-vp-'))
  root = vp.createProjectFolder(path.join(dir, 'Story.esbvideo'))
})
const write = (p: string, data: string | Buffer = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data) }
/** A directory junction (no admin rights needed on Windows); a dir symlink elsewhere. */
const linkDir = (target: string, at: string) => fs.symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir')
const SECRET = 'ab'.repeat(32)

describe('project folder layout', () => {
  it('makes <name>.esbvideo with media, proxies, cache, autosave and renders', () => {
    for (const d of ['media', 'proxies', 'cache', 'autosave', 'renders']) expect(fs.statSync(path.join(root, d)).isDirectory()).toBe(true)
    // saving again into the same project folder is fine once it holds a project.json
    vp.writeProjectJson(root, '{"a":1}')
    expect(vp.createProjectFolder(root)).toBe(path.resolve(root))
  })

  it('refuses a name that is a file (an old single-file project) or a non-empty folder that is not a project', () => {
    write(path.join(dir, 'Old.esbvideo'), '{}')
    expect(() => vp.createProjectFolder(path.join(dir, 'Old.esbvideo'))).toThrow(/file with that name/)
    write(path.join(dir, 'Footage.esbvideo', 'clip.mp4'))
    expect(() => vp.createProjectFolder(path.join(dir, 'Footage.esbvideo'))).toThrow(/not empty/)
    expect(() => vp.createProjectFolder(path.join(dir, 'NoSuffix'))).toThrow()
    expect(() => vp.createProjectFolder('\\\\server\\share\\x.esbvideo')).toThrow()
  })

  it('writes project.json as JSON only, temp + rename', () => {
    expect(() => vp.writeProjectJson(root, 'not json')).toThrow()
    vp.writeProjectJson(root, '{"v":2}')
    expect(fs.readFileSync(path.join(root, 'project.json'), 'utf8')).toBe('{"v":2}')
    expect(fs.readdirSync(root).some((f) => f.endsWith('.tmp'))).toBe(false)
  })

  it('knows folders by opaque id only; unknown or gone ids are null', () => {
    const reg = vp.createFolderRegistry({ file: path.join(dir, 'folders.json'), secret: SECRET })
    const id = reg.add(root)
    expect(id).toMatch(/^[0-9a-f]{32}$/)
    expect(reg.pathFor(id)).toBe(path.resolve(root))
    expect(reg.pathFor('../' + id)).toBeNull()
    expect(reg.pathFor('u')).toBeNull()
    expect(reg.add(path.join(dir, 'missing.esbvideo'))).toBeNull()
    expect(reg.add(dir)).toBeNull() // not a .esbvideo folder
    // a registry file edited to hold a UNC path is ignored on load
    fs.writeFileSync(path.join(dir, 'f2.json'), JSON.stringify(['\\\\evil\\s\\x.esbvideo', root]))
    expect(vp.createFolderRegistry({ file: path.join(dir, 'f2.json'), secret: SECRET }).size()).toBe(1)
    fs.rmSync(root, { recursive: true })
    expect(reg.pathFor(id)).toBeNull()
  })
})

describe('path confinement (hostile renderer)', () => {
  it('accepts exactly <served subfolder>/<plain name>', () => {
    expect(vp.safeRel('proxies/abc.mp4')).toBe('proxies/abc.mp4')
    expect(vp.safeRel('media\\clip.mp4')).toBe('media/clip.mp4')
    for (const bad of ['../x.mp4', 'media/../x.mp4', 'media/../../x.mp4', 'media\\..\\x.mp4', 'media/sub/x.mp4', '/media/x.mp4', 'media/', 'media/.', 'media/..',
      'cache/k.bin', 'autosave/snap.json', 'project.json', 'media/clip.mp4:secret', 'media/clip.mp4::$DATA', 'media/C:x.mp4', 'media/con', 'media/NUL.mp4', 'media/x.mp4.', 'media/x.mp4 ', 'media/a*b.mp4', 'media/\u0000.mp4', '', null, 42]) {
      expect(vp.safeRel(bad as string), String(bad)).toBeNull()
    }
  })

  it('refuses UNC, device and data-stream roots', () => {
    for (const p of ['\\\\server\\share\\x.esbvideo', '//server/share/x.esbvideo', '\\\\?\\C:\\x.esbvideo', '\\\\.\\C:\\x.esbvideo', 'C:\\a\\x.esbvideo:ads', 'relative.esbvideo']) {
      expect(vp.isProjectFolderPath(p), p).toBe(false)
      expect(vp.confinedFile(p, 'media/x.mp4')).toBeNull()
    }
    expect(vp.hasStreamSuffix('C:\\a\\b.mp4')).toBe(false)
    expect(vp.hasStreamSuffix('C:\\a\\b.mp4:hidden')).toBe(true)
  })

  it('serves a real file inside the folder, and nothing else', () => {
    write(path.join(root, 'media', 'clip.mp4'), 'data')
    write(path.join(dir, 'secret.mp4'), 'secret')
    expect(vp.confinedFile(root, 'media/clip.mp4')).toBe(fs.realpathSync.native(path.join(root, 'media', 'clip.mp4')))
    expect(vp.confinedFile(root, 'media/gone.mp4')).toBeNull()
    expect(vp.confinedFile(root, 'media/../../secret.mp4')).toBeNull()
    fs.mkdirSync(path.join(root, 'media', 'sub.mp4'))
    expect(vp.confinedFile(root, 'media/sub.mp4')).toBeNull() // a folder is not a file
  })

  it('a junction or symlink that leads out of the folder is refused (subfolder and file)', () => {
    const outside = path.join(dir, 'private')
    write(path.join(outside, 'secret.mp4'), 'secret')
    // media/ itself replaced by a junction to a private folder
    fs.rmSync(path.join(root, 'media'), { recursive: true })
    linkDir(outside, path.join(root, 'media'))
    expect(fs.existsSync(path.join(root, 'media', 'secret.mp4'))).toBe(true)
    expect(vp.confinedFile(root, 'media/secret.mp4')).toBeNull()
    expect(() => vp.confinedDir(root, 'media')).toThrow(/outside/)
    expect(() => vp.confinedTarget(root, 'media', 'x.mp4')).toThrow(/outside/)
    // a file symlink inside proxies/ to the outside (needs symlink rights on Windows; skipped without them)
    try {
      fs.symlinkSync(path.join(outside, 'secret.mp4'), path.join(root, 'proxies', 'link.mp4'), 'file')
      expect(vp.confinedFile(root, 'proxies/link.mp4')).toBeNull()
      expect(() => vp.confinedTarget(root, 'proxies', 'link.mp4')).toThrow(/link/)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EPERM') throw e
    }
  })

  it('the protocol serves p/<id>/<sub>/<file> only through the confining resolver', async () => {
    write(path.join(root, 'proxies', '0123456789abcdef0123456789abcdef.mp4'), Buffer.from([...Array(64).keys()]))
    const reg = vm.createMediaRegistry({ file: path.join(dir, 'reg.json') })
    const id = 'a'.repeat(32)
    const folderFile = (key: string, rel: string) => (key === id ? vp.confinedFile(root, rel) : null)
    const get = (u: string) => vm.serveMedia(new Request(u, { headers: { range: 'bytes=0-3' } }), reg, { folderFile })
    expect((await get(`esb-media://p/${id}/proxies/0123456789abcdef0123456789abcdef.mp4`)).status).toBe(206)
    expect((await get(`esb-media://p/${'b'.repeat(32)}/proxies/0123456789abcdef0123456789abcdef.mp4`)).status).toBe(404)
    expect((await get(`esb-media://p/${id}/proxies/..%2F..%2Fx.mp4`)).status).toBe(404)
    expect((await get(`esb-media://p/${id}/cache/k.bin`)).status).toBe(404)
    expect((await get(`esb-media://p/${id}/proxies%2F..%2Fproject.json`)).status).toBe(404)
  })
})

describe('copy into media/ and quick hash', () => {
  it('copies, reuses the same file, and gives a different file of the same name a free name', async () => {
    const src = path.join(dir, 'footage', 'clip.mp4')
    write(src, 'one')
    const a = await vp.copyIntoMedia(root, src)
    expect(path.dirname(a)).toBe(fs.realpathSync.native(path.join(root, 'media')))
    expect(await vp.copyIntoMedia(root, src)).toBe(a)
    const other = path.join(dir, 'other', 'clip.mp4')
    write(other, 'two')
    expect(path.basename(await vp.copyIntoMedia(root, other))).toBe('clip (2).mp4')
    // a file already in media/ is used where it is
    expect(await vp.copyIntoMedia(root, a)).toBe(a)
    await expect(vp.copyIntoMedia(root, src + ':ads')).rejects.toThrow()
    await expect(vp.copyIntoMedia(root, path.join(dir, 'notes.txt'))).rejects.toThrow()
    expect(fs.readdirSync(path.join(root, 'media')).some((f) => f.endsWith('.copying'))).toBe(false)
  })

  it('quick hash: same bytes same hash; a change in the middle of a large file changes it', async () => {
    const big = Buffer.alloc(1024 * 1024, 7)
    write(path.join(dir, 'a.mp4'), big)
    write(path.join(dir, 'b.mp4'), big)
    const c = Buffer.from(big); c[512 * 1024] = 9
    write(path.join(dir, 'c.mp4'), c)
    const [ha, hb, hc] = await Promise.all(['a', 'b', 'c'].map((n) => vp.quickHash(path.join(dir, n + '.mp4'))))
    expect(ha).toMatch(/^[0-9a-f]{32}$/)
    expect(ha).toBe(hb)
    expect(hc).not.toBe(ha)
  })
})

describe('relink by hash', () => {
  it('finds a moved/renamed file in the original folder’s siblings and the project media/, by size + hash', async () => {
    const shoot = path.join(dir, 'Shoot')
    const original = path.join(shoot, 'day1', 'interview.mp4')
    const body = Buffer.alloc(300 * 1024, 3); body.write('interview')
    const hash = await (async () => { write(original, body); return vp.quickHash(original) })()
    fs.rmSync(original)
    // moved to a sibling folder under a new name; a decoy of the same size with other bytes sits beside it
    write(path.join(shoot, 'day2', 'renamed.mp4'), body)
    const decoy = Buffer.alloc(300 * 1024, 4)
    write(path.join(shoot, 'day1', 'decoy.mp4'), decoy)
    const dirs = await vp.relinkDirs({ root, original, approved: true })
    expect(dirs.map((d: string) => path.basename(d))).toEqual(expect.arrayContaining(['media', 'day1', 'day2']))
    const found = await vp.findByHash([{ id: 'a1', size: body.length, hash }], dirs)
    expect(found.get('a1')).toBe(path.join(shoot, 'day2', 'renamed.mp4'))
    // a copy in the project media/ is found too
    const still = Buffer.alloc(1000, 5)
    write(path.join(root, 'media', 'still.png'), still)
    const sh = await vp.quickHash(path.join(root, 'media', 'still.png'))
    expect((await vp.findByHash([{ id: 's', size: 1000, hash: sh }], await vp.relinkDirs({ root, original: '', approved: false }))).get('s')).toMatch(/still\.png$/)
  })

  it('searches outside the project only next to a file this app approved before', async () => {
    const original = path.join(dir, 'private', 'x.mp4')
    const dirs = await vp.relinkDirs({ root, original, approved: false })
    expect(dirs).toHaveLength(1) // media/ only
    expect(await vp.relinkDirs({ root: null, original: '\\\\server\\share\\x.mp4', approved: true })).toEqual([])
  })

  it('ignores bad items and does not follow links while scanning', async () => {
    const found = await vp.findByHash([{ id: 'x', size: -1, hash: 'zz' }, null, { id: 'y', size: 10, hash: 'a'.repeat(32) }], [dir, '\\\\server\\share'])
    expect(found.size).toBe(0)
  })
})

describe('cache/', () => {
  it('validates keys and enforces the per-entry and total caps (nothing evicted)', async () => {
    const cdir = vp.confinedDir(root, 'cache')
    const store = vp.createCacheStore({ maxEach: 100, maxTotal: 250 })
    for (const bad of ['', 'A', 'a/b', '../x', 'a.b', 'x'.repeat(81), 'wave form', 'é']) await expect(store.write(cdir, bad, new Uint8Array(1)), bad).rejects.toThrow(/key/)
    await store.write(cdir, 'wave-1', new Uint8Array(100).fill(1))
    await store.write(cdir, 'wave-2', new Uint8Array(100).fill(2))
    await expect(store.write(cdir, 'big', new Uint8Array(101))).rejects.toThrow(/at most/)
    await expect(store.write(cdir, 'wave-3', new Uint8Array(100))).rejects.toThrow(/full/)
    // replacing an entry counts only the difference
    await store.write(cdir, 'wave-2', new Uint8Array(50))
    await store.write(cdir, 'wave-3', new Uint8Array(100))
    expect((await store.read(cdir, 'wave-1'))?.[0]).toBe(1)
    expect(await store.read(cdir, 'nothing')).toBeNull()
    await expect(store.read(cdir, '../x')).rejects.toThrow(/key/)
    expect(store.total(cdir)).toBe(250)
  })

  it('the renderer contract validates keys and size before anything leaves the page (browser memory cache)', async () => {
    await expect(writeCache('Bad Key', new Uint8Array(1))).rejects.toThrow()
    await expect(readCache('../x')).rejects.toThrow()
    await expect(writeCache('ok-key', new Uint8Array(CACHE_MAX_ENTRY + 1))).rejects.toThrow(/32 MB/)
    await writeCache('ok-key', new Uint8Array([1, 2, 3]))
    expect(Array.from((await readCache('ok-key')) ?? [])).toEqual([1, 2, 3])
    expect(await readCache('none-here')).toBeNull()
  })
})

describe('proxies: which footage and what size', () => {
  it('over 1080p or key frames 0.5 s or more apart (phones and cameras: 0.5-1 s GOP)', () => {
    expect(isOver1080p(3840, 2160)).toBe(true)
    expect(isOver1080p(1920, 1080)).toBe(false)
    expect(isOver1080p(1080, 1920)).toBe(false)
    expect(isOver1080p(2160, 3840)).toBe(true)
    expect(wantsProxy({ type: 'video', width: 1920, height: 1080 }, { keyframeInterval: 0.4 })).toBe(false)
    expect(wantsProxy({ type: 'video', width: 1920, height: 1080 }, {})).toBe(false)
    expect(wantsProxy({ type: 'video', width: 1920, height: 1080 }, { keyframeInterval: 0.5 })).toBe(true)
    expect(wantsProxy({ type: 'video', width: 1920, height: 1080 }, { keyframeInterval: 0.4999 })).toBe(true)
    expect(wantsProxy({ type: 'video', width: 1920, height: 1080 }, { keyframeInterval: 1 })).toBe(true)
    expect(wantsProxy({ type: 'video', width: 1920, height: 1080 }, { keyframeInterval: 2 })).toBe(true)
    // never a proxy that would be bigger than its source (540 on the short side)
    expect(wantsProxy({ type: 'video', width: 640, height: 360 }, { keyframeInterval: 2 })).toBe(false)
    expect(wantsProxy({ type: 'video', width: 960, height: 540 }, { keyframeInterval: 10 })).toBe(false)
    expect(wantsProxy({ type: 'video', width: 1280, height: 720 }, { keyframeInterval: 1 })).toBe(true)
    expect(wantsProxy({ type: 'video' }, { keyframeInterval: 2 })).toBe(false)
    expect(wantsProxy({ type: 'video', width: 3840, height: 2160 }, {})).toBe(true)
    expect(wantsProxy({ type: 'video', width: 3840, height: 2160, missing: true }, {})).toBe(false)
    expect(wantsProxy({ type: 'image', width: 6000, height: 4000 }, {})).toBe(false)
  })
  it('540 on the short side, even sizes', () => {
    expect(proxySize(3840, 2160)).toEqual({ width: 960, height: 540 })
    expect(proxySize(1080, 1920)).toEqual({ width: 540, height: 960 })
    expect(proxySize(4096, 2160)).toEqual({ width: 1024, height: 540 })
  })
  it('proxy files are named by hash only', () => {
    expect(vp.proxyName('0123456789abcdef0123456789abcdef')).toBe('0123456789abcdef0123456789abcdef.mp4')
    expect(vp.proxyName('../x')).toBeNull()
    expect(vp.proxyReady(root, '0123456789abcdef0123456789abcdef')).toBe(false)
    write(path.join(root, 'proxies', '0123456789abcdef0123456789abcdef.mp4'), Buffer.from('....ftypisom............'))
    expect(vp.proxyReady(root, '0123456789abcdef0123456789abcdef')).toBe(true)
    write(path.join(root, 'proxies', 'a.partial'))
    vp.cleanPartials(path.join(root, 'proxies'))
    expect(fs.existsSync(path.join(root, 'proxies', 'a.partial'))).toBe(false)
  })
})

// ---------------------------------------------------------------- schema

const tracks = [['v2', 'overlay'], ['v1', 'video'], ['c1', 'caption'], ['a1', 'audio']].map(([id, kind]) => ({ id, name: id.toUpperCase(), kind, muted: false, locked: false }))
const v1Project = {
  id: 'proj-1', name: 'Grid story', aspect: '16:9', width: 1920, height: 1080, fps: 30, duration: 30, bug: true, version: 2,
  tracks,
  clips: [{ id: 'c-v', trackId: 'v1', title: 'clip.mp4', kind: 'video', start: 0, duration: 6, in: 0, out: 6, color: '#2563eb', mediaAssetId: 'asset-1', scale: 1.2, offX: 0.1 }],
  mediaAssets: [{ id: 'asset-1', name: 'clip.mp4', type: 'video', url: '', duration: 6, width: 3840, height: 2160, size: 1234, path: 'C:\\Footage\\clip.mp4', mtimeMs: 99, hasAudio: true }],
}

describe('project.json schema and migration', () => {
  it('reads the Phase 0 single file as version 1 and migrates it to v2 with the timeline unchanged', () => {
    expect(schemaVersionOf(v1Project)).toBe(1)
    const doc = migrateProjectDoc(JSON.parse(JSON.stringify(v1Project)))!
    expect(doc.version).toBe(PROJECT_SCHEMA_VERSION)
    expect(doc.settings).toEqual({ importMode: 'reference', proxies: 'auto' })
    const { mediaAssets: _m, ...timeline } = v1Project
    expect(doc.timeline).toEqual(timeline) // shape untouched (Part B owns it)
    expect(doc.media[0]).toMatchObject({ id: 'asset-1', storage: 'reference', path: 'C:\\Footage\\clip.mp4', size: 1234, width: 3840 })
  })

  it('a v1 project opens unchanged through parseProjectText', () => {
    const r = parseProjectText(JSON.stringify(v1Project))!
    expect(r.version).toBe(1)
    expect(r.project.name).toBe('Grid story')
    expect(r.project.clips[0]).toMatchObject({ id: 'c-v', scale: 1.2, offX: 0.1, mediaAssetId: 'asset-1' })
    expect(r.project.mediaAssets?.[0]).toMatchObject({ id: 'asset-1', path: 'C:\\Footage\\clip.mp4', url: '' })
  })

  it('v2 round trip: timeline as serializeVideoProject writes it, media with facts, no runtime URLs', () => {
    const r = parseProjectText(JSON.stringify(v1Project))!
    const bin: MediaAsset[] = [{ ...r.project.mediaAssets![0], url: 'esb-media://m/' + 'a'.repeat(32) }, { id: 'asset-2', name: 'copy.wav', type: 'audio', url: 'esb-media://m/' + 'b'.repeat(32), duration: 2, size: 9, path: path.join(root, 'media', 'copy.wav') }]
    const project = { ...r.project, mediaAssets: undefined } as VideoProject
    const text = buildProjectDoc(project, bin, {
      'asset-1': { hash: 'c'.repeat(32), codec: 'avc1.640033', fps: 30, keyframeInterval: 3, storage: 'reference' },
      'asset-2': { storage: 'copy', file: relInMedia(root, bin[1].path) },
    }, { importMode: 'copy', proxies: 'auto' }, 1000)
    expect(text).not.toContain('esb-media:')
    const doc = JSON.parse(text)
    expect(doc).toMatchObject({ format: 'esb-video-project', version: 2, savedAt: 1000, settings: { importMode: 'copy' } })
    const seq = JSON.parse(serializeVideoProject(project, bin))
    delete seq.mediaAssets
    expect(doc.timeline).toEqual(seq)
    expect(doc.media[1]).toMatchObject({ storage: 'copy', file: 'media/copy.wav' })
    const back = parseProjectText(text)!
    expect(back.version).toBe(2)
    expect(back.facts['asset-1']).toMatchObject({ hash: 'c'.repeat(32), codec: 'avc1.640033', keyframeInterval: 3 })
    expect(back.facts['asset-2']).toMatchObject({ storage: 'copy', file: 'media/copy.wav' })
    expect(back.project.clips).toEqual(project.clips)
    expect(back.settings.importMode).toBe('copy')
  })

  it('refuses a newer schema, and sanitises hostile media records', () => {
    expect(() => migrateProjectDoc({ format: 'esb-video-project', version: 99, timeline: {}, media: [] })).toThrow(NewerProjectError)
    expect(migrateProjectDoc({ hello: 1 })).toBeNull()
    expect(parseProjectText('not json')).toBeNull()
    const doc = migrateProjectDoc({ format: 'esb-video-project', version: 2, timeline: { ...v1Project, mediaAssets: undefined }, media: [
      { id: 'm1', name: 'x', type: 'video', storage: 'copy', file: 'media/../../secret.mp4', size: 1 },
      { id: 'm2', name: 'y', type: 'video', storage: 'copy', file: 'media/ok.mp4:ads', size: 1 },
      { id: 'm3', name: 'z', type: 'exe', size: 1 },
      { id: 'm4', name: 'w', type: 'audio', storage: 'copy', file: 'media/ok.wav', size: 1, hash: 'not-a-hash' },
    ] })!
    expect(doc.media.map((m) => m.id)).toEqual(['m1', 'm2', 'm4'])
    expect(doc.media[0].storage).toBe('reference') // a copy outside media/ is not trusted as a copy
    expect(doc.media[0].file).toBeUndefined()
    expect(doc.media[1].storage).toBe('reference')
    expect(doc.media[2]).toMatchObject({ storage: 'copy', file: 'media/ok.wav', hash: undefined })
  })

  it('relInMedia tells a copy inside the folder from a reference', () => {
    expect(relInMedia('C:\\Video\\A.esbvideo', 'C:\\Video\\A.esbvideo\\media\\x.mp4')).toBe('media/x.mp4')
    expect(relInMedia('C:\\Video\\A.esbvideo\\', 'c:/video/a.esbvideo/MEDIA/x.mp4')).toBe('media/x.mp4')
    expect(relInMedia('C:\\Video\\A.esbvideo', 'C:\\Video\\A.esbvideo\\media\\sub\\x.mp4')).toBeUndefined()
    expect(relInMedia('C:\\Video\\A.esbvideo', 'C:\\Footage\\x.mp4')).toBeUndefined()
  })
})

// ---------------------------------------------------------------- Phase 1 fix round, Part A (security)

/** A hard link needs no rights on Windows or elsewhere: the realistic way to plant a "temp file" that is really
 * someone else's file. A file symlink is tried too where the OS allows it. */
const plantHardLink = (outside: string, at: string) => fs.linkSync(outside, at)
function trySymlink(outside: string, at: string): boolean {
  try { fs.symlinkSync(outside, at, 'file'); return true } catch { return false }
}

describe('S1: temp files cannot be planted (random names, opened wx)', () => {
  it('project.json, the cache and a proxy write never write through a link planted at the old temp names', async () => {
    const outside = path.join(dir, 'precious.txt')
    write(outside, 'keep me')
    plantHardLink(outside, path.join(root, 'project.json.tmp'))
    if (!trySymlink(outside, path.join(root, 'cache', 'wave-1.bin.tmp'))) plantHardLink(outside, path.join(root, 'cache', 'wave-1.bin.tmp'))
    const hash = '0123456789abcdef0123456789abcdef'
    plantHardLink(outside, path.join(root, 'proxies', `${hash}.mp4.partial`))

    vp.writeProjectJson(root, '{"v":2}')
    await vp.createCacheStore().write(vp.confinedDir(root, 'cache'), 'wave-1', new Uint8Array([9, 9, 9]))
    const w = vm.createExportWriter()
    const job = w.begin(vp.confinedTarget(root, 'proxies', `${hash}.mp4`), { minFree: 0 })
    await w.write(job.id, 0, new Uint8Array(Buffer.from('....ftypisom................')))
    expect(w.end(job.id, true)).toBe(path.join(fs.realpathSync.native(root), 'proxies', `${hash}.mp4`))

    expect(fs.readFileSync(outside, 'utf8')).toBe('keep me')
    expect(fs.readFileSync(path.join(root, 'project.json'), 'utf8')).toBe('{"v":2}')
    expect(Array.from(fs.readFileSync(path.join(root, 'cache', 'wave-1.bin')))).toEqual([9, 9, 9])
    // nothing of ours is left behind under a random temp name either
    for (const d of [root, path.join(root, 'cache'), path.join(root, 'proxies')]) expect(fs.readdirSync(d).filter((f) => /\.[0-9a-f]{16}\.(tmp|partial)$/.test(f))).toEqual([])
  })

  it('temp names are random per write', () => {
    const target = path.join(root, 'x.json')
    const tmp = vm.tempName(target)
    expect(tmp).toMatch(/x\.json\.[0-9a-f]{16}\.tmp$/)
    expect(vm.tempName(target)).not.toBe(tmp)
    vm.writeFileAtomicSync(target, 'ok')
    expect(fs.readFileSync(target, 'utf8')).toBe('ok')
  })

  it('cleanFolder removes stray *.tmp / *.partial / *.copying in the root and every subfolder, without following links', () => {
    const outside = path.join(dir, 'precious.txt')
    write(outside, 'keep me')
    const strays = [path.join(root, 'project.json.tmp'), path.join(root, 'cache', 'a.bin.tmp'), path.join(root, 'proxies', 'b.mp4.partial'), path.join(root, 'media', 'c.mp4.copying'), path.join(root, 'autosave', 'snap-1.json.ab.tmp')]
    for (const f of strays) write(f)
    plantHardLink(outside, path.join(root, 'cache', 'linked.bin.tmp'))
    write(path.join(root, 'cache', 'keep.bin'), 'k')
    vp.cleanFolder(root)
    for (const f of strays) expect(fs.existsSync(f), f).toBe(false)
    expect(fs.existsSync(path.join(root, 'cache', 'linked.bin.tmp'))).toBe(false)
    expect(fs.readFileSync(outside, 'utf8')).toBe('keep me')
    expect(fs.existsSync(path.join(root, 'cache', 'keep.bin'))).toBe(true)
  })

  it('a Save into an existing project folder cleans it too', () => {
    write(path.join(root, 'project.json'), '{}')
    write(path.join(root, 'project.json.tmp'))
    vp.createProjectFolder(root)
    expect(fs.existsSync(path.join(root, 'project.json.tmp'))).toBe(false)
  })
})

describe('S2: the cache cap holds under parallel writes', () => {
  it('40 writes sent at once: exactly as many as fit are kept, the rest refused', async () => {
    const cdir = vp.confinedDir(root, 'cache')
    const store = vp.createCacheStore({ maxEach: 100, maxTotal: 1000 })
    const res = await Promise.allSettled(Array.from({ length: 40 }, (_, i) => store.write(cdir, `k-${i}`, new Uint8Array(100))))
    expect(res.filter((r) => r.status === 'fulfilled').length).toBe(10)
    expect(res.filter((r) => r.status === 'rejected').every((r) => /full/.test(String((r as PromiseRejectedResult).reason)))).toBe(true)
    const onDisk = fs.readdirSync(cdir).filter((f) => f.endsWith('.bin')).reduce((n, f) => n + fs.statSync(path.join(cdir, f)).size, 0)
    expect(onDisk).toBe(1000)
    expect(store.total(cdir)).toBe(1000)
    // the same key written 40 times at once counts once
    const store2 = vp.createCacheStore({ maxEach: 100, maxTotal: 1000 })
    const d2 = vp.confinedDir(vp.createProjectFolder(path.join(dir, 'B.esbvideo')), 'cache')
    await Promise.all(Array.from({ length: 40 }, () => store2.write(d2, 'same', new Uint8Array(100))))
    expect(store2.total(d2)).toBe(100)
  })
})

describe('S3: proxy writes are capped per file, per folder, and by free space while they grow', () => {
  const MB = 1024 * 1024
  it('refuses a piece past the file limit or the folder cap, and stops when the drive fills up mid-write', async () => {
    const t = path.join(root, 'proxies', 'a.mp4')
    let w = vm.createExportWriter()
    let j = w.begin(t, { minFree: 0, maxBytes: 10 })
    await w.write(j.id, 0, new Uint8Array(10))
    await expect(w.write(j.id, 10, new Uint8Array(1))).rejects.toThrow(/larger/)
    w.end(j.id, false)

    j = w.begin(t, { minFree: 0, folderBytes: 90, folderCap: 100 })
    await w.write(j.id, 0, new Uint8Array(10))
    await expect(w.write(j.id, 10, new Uint8Array(1))).rejects.toThrow(/full/)
    // a patch inside what was written does not grow the file and is allowed
    await w.write(j.id, 0, new Uint8Array(5))
    w.end(j.id, false)
    expect(() => w.begin(t, { minFree: 0, folderBytes: 100, folderCap: 100 })).toThrow(/full/)

    let free = 10_000 * MB
    w = vm.createExportWriter({ free: () => free })
    j = w.begin(t, { minFree: 1024 * MB })
    await w.write(j.id, 0, new Uint8Array(32 * MB))
    free = 1050 * MB // the drive filled up from elsewhere: this 40 MB piece would leave less than 1 GB
    await expect(w.write(j.id, 32 * MB, new Uint8Array(40 * MB))).rejects.toThrow(/nearly full/)
    w.end(j.id, false)
    expect(fs.readdirSync(path.join(root, 'proxies')).filter((f) => f.endsWith('.partial'))).toEqual([])
  })
})

describe('S4: folder ids are an HMAC with the install secret', () => {
  it('the same path gets a different id under another secret, never the old plain hash; the secret persists', () => {
    const p = path.join(dir, 'X.esbvideo')
    const a = vp.folderId(p, SECRET)
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(vp.folderId(p, 'cd'.repeat(32))).not.toBe(a)
    expect(vp.folderId(p.toUpperCase() + path.sep, SECRET)).toBe(a) // the same folder however it is spelled
    const plain = require('node:crypto').createHash('sha256').update('esb-folder:' + path.resolve(p).replace(/\\/g, '/').toLowerCase()).digest('hex').slice(0, 32)
    expect(a).not.toBe(plain)
    expect(() => vp.folderId(p)).toThrow(/secret/)
    const sf = path.join(dir, 'secret')
    const s1 = vp.loadInstallSecret(sf)
    expect(s1).toMatch(/^[0-9a-f]{64}$/)
    expect(vp.loadInstallSecret(sf)).toBe(s1)
    // the registry keeps working across launches with the same secret
    const r1 = vp.createFolderRegistry({ file: path.join(dir, 'reg.json'), secret: s1 })
    const id = r1.add(root)
    expect(vp.createFolderRegistry({ file: path.join(dir, 'reg.json'), secret: s1 }).pathFor(id)).toBe(path.resolve(root))
    expect(r1.entries()).toEqual([{ id, path: path.resolve(root) }])
    // a new secret (the file was lost): the folder is still known, under a new id
    const r3 = vp.createFolderRegistry({ file: path.join(dir, 'reg.json'), secret: 'ef'.repeat(32) })
    expect(r3.pathFor(id)).toBeNull()
    expect(r3.size()).toBe(1)
  })
})

describe('S5: the autosave restore picks the newest snapshot by name and reads only small plain files', () => {
  it('across folders, newest first, skipping a planted huge file and a damaged one', async () => {
    const a = vp.confinedDir(root, 'autosave')
    const b = path.join(dir, 'userdata-autosave')
    fs.mkdirSync(b)
    const name = (t: number) => `snap-${String(t).padStart(15, '0')}-aaaaaaaaaaaa.json`
    write(path.join(b, name(100)), '{"n":"old"}')
    write(path.join(a, name(200)), '{"n":"folder"}')
    // newer, but over 25 MB (sparse): skipped without being read
    const huge = path.join(a, name(300))
    fs.writeFileSync(huge, '{')
    fs.truncateSync(huge, vm.MAX_SNAPSHOT + 1)
    // newer still, but damaged
    write(path.join(b, name(400)), '{not json')
    const best = await vm.latestSnapshotIn([{ dir: b }, { dir: a, folder: { id: 'f', path: root } }])
    expect(JSON.parse(best.text).n).toBe('folder')
    expect(best.at).toBe(200)
    expect(best.folder).toEqual({ id: 'f', path: root })
    expect(JSON.parse(vm.latestSnapshot(a).text).n).toBe('folder')
    // reading stops after maxReads candidates
    expect(await vm.latestSnapshotIn([{ dir: b }], { maxReads: 1 })).toBeNull()
    expect(await vm.latestSnapshotIn([{ dir: path.join(dir, 'nope') }])).toBeNull()
  })

  it('an autosave/ that is a junction out of the project is refused (main asks confinedDir first)', () => {
    const outside = path.join(dir, 'elsewhere')
    fs.mkdirSync(outside)
    fs.rmSync(path.join(root, 'autosave'), { recursive: true })
    linkDir(outside, path.join(root, 'autosave'))
    expect(() => vp.confinedDir(root, 'autosave')).toThrow(/outside/)
  })
})

describe('S6: relink search stays bounded', () => {
  it('a slow folder (cloud placeholders) is left after one slow hash; the hash count is capped', async () => {
    const slow = path.join(dir, 'cloud')
    const fast = path.join(dir, 'local')
    for (let i = 0; i < 5; i++) write(path.join(slow, `c${i}.mp4`), Buffer.alloc(10, i))
    write(path.join(fast, 'x.mp4'), Buffer.alloc(10, 7))
    let t = 0
    const hashed: string[] = []
    const hash = async (p: string) => { hashed.push(path.basename(p)); if (p.startsWith(slow)) t += 5000; return 'f'.repeat(32) }
    const found = await vp.findByHash([{ id: 'a', size: 10, hash: 'e'.repeat(32) }], [slow, fast], { now: () => t, hash, budgetMs: 60000 })
    expect(found.size).toBe(0)
    expect(hashed.filter((f) => f.startsWith('c'))).toHaveLength(1)
    expect(hashed).toContain('x.mp4')
    const many = path.join(dir, 'many')
    for (let i = 0; i < 30; i++) write(path.join(many, `m${i}.mp4`), Buffer.alloc(10))
    let n = 0
    await vp.findByHash([{ id: 'a', size: 10, hash: 'e'.repeat(32) }], [many], { maxHashes: 5, hash: async () => { n++; return 'f'.repeat(32) } })
    expect(n).toBe(5)
  })
})

describe('S7: only media files, and only from the subfolder named', () => {
  it('a proxies/ entry that links into cache/ is refused; the protocol serves media types only', async () => {
    write(path.join(root, 'cache', 'wave.bin'), 'secret')
    write(path.join(root, 'proxies', 'real.mp4'), 'x')
    expect(vp.confinedFile(root, 'proxies/real.mp4')).toBeTruthy()
    if (trySymlink(path.join(root, 'cache', 'wave.bin'), path.join(root, 'proxies', 'linked.mp4'))) expect(vp.confinedFile(root, 'proxies/linked.mp4')).toBeNull()
    write(path.join(root, 'renders', 'notes.txt'), 'x')
    const res = await vm.serveMedia(new Request('esb-media://p/u/renders/notes.txt'), { pathFor: () => null }, { folderFile: (_k: string, rel: string) => vp.confinedFile(root, rel) })
    expect(res.status).toBe(404)
  })
})

describe('S8 / P11: protocol headers and the confined-file memo', () => {
  it('nosniff on every answer; a null origin only in the packaged app', async () => {
    write(path.join(root, 'media', 'a.mp4'), 'x')
    const res = await vm.serveMedia(new Request('esb-media://p/u/media/a.mp4'), { pathFor: () => null }, { folderFile: (_k: string, rel: string) => vp.confinedFile(root, rel) })
    expect(res.status).toBe(200)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect((await vm.serveMedia(new Request('esb-media://m/zz'), { pathFor: () => null })).headers.get('x-content-type-options')).toBe('nosniff')
    expect(vm.allowedOrigin('null', undefined)).toBe('null')
    expect(vm.allowedOrigin('null', 'http://localhost:5173')).toBeNull()
    expect(vm.allowedOrigin('http://localhost:5173', 'http://localhost:5173')).toBe('http://localhost:5173')
  })

  it('resolves a file once per short window, and again after invalidate or the window', () => {
    write(path.join(root, 'media', 'a.mp4'), 'x')
    let t = 0
    const r = vp.createConfinedResolver({ ttlMs: 1000, now: () => t })
    const f = r.resolve('k', root, 'media/a.mp4')
    expect(f).toBeTruthy()
    fs.rmSync(path.join(root, 'media', 'a.mp4'))
    expect(r.resolve('k', root, 'media/a.mp4')).toBe(f) // memo (opening it then 404s)
    r.invalidate('k')
    expect(r.resolve('k', root, 'media/a.mp4')).toBeNull()
    write(path.join(root, 'media', 'a.mp4'), 'x')
    t = 2000
    expect(r.resolve('k', root, 'media/a.mp4')).toBe(f)
  })
})
