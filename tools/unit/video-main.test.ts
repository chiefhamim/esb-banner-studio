// The Video desk's main-process side (electron/video-media.cjs): the renderer is hostile, so every path, id, write
// position and snapshot is checked here.
import { describe, it, expect, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const v = require('../../electron/video-media.cjs')

let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-vm-')) })

describe('media registry and protocol', () => {
  it('accepts only absolute media paths that exist; ids are opaque', () => {
    const f = path.join(dir, 'clip.mp4')
    fs.writeFileSync(f, Buffer.alloc(100, 7))
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'x')
    const reg = v.createMediaRegistry({ file: path.join(dir, 'reg.json') })
    expect(v.isMediaPath('relative/clip.mp4')).toBe(false)
    expect(v.isMediaPath(path.join(dir, 'notes.txt'))).toBe(false)
    expect(reg.add(path.join(dir, 'notes.txt'))).toBeNull()
    expect(reg.add(path.join(dir, 'gone.mp4'))).toBeNull()
    const id = reg.add(f)
    expect(id).toMatch(/^[0-9a-f]{32}$/)
    expect(reg.pathFor(id)).toBe(path.resolve(f))
    expect(reg.pathFor('../../etc/passwd')).toBeNull()
    expect(reg.has(f)).toBe(true)
  })

  it('refuses network (UNC) and device paths everywhere, so nothing ever dials an SMB share', async () => {
    for (const p of ['\\\\attacker\\share\\clip.mp4', '//attacker/share/clip.mp4', '\\\\?\\C:\\x\\clip.mp4', '\\\\.\\C:\\x\\clip.mp4', '\\/attacker/s/clip.mp4']) {
      expect(v.isNetworkOrDevicePath(p)).toBe(true)
      expect(v.isMediaPath(p)).toBe(false)
    }
    const reg = v.createMediaRegistry({ file: path.join(dir, 'reg.json') })
    expect(reg.add('\\\\attacker\\share\\clip.mp4')).toBeNull()
    const r = await v.resolvePaths(reg, ['\\\\attacker\\share\\clip.mp4'])
    expect(r[0].missing).toBe(true)
    // a registry file edited to hold one is ignored on load
    fs.writeFileSync(path.join(dir, 'reg2.json'), JSON.stringify(['\\\\attacker\\share\\clip.mp4']))
    expect(v.createMediaRegistry({ file: path.join(dir, 'reg2.json') }).size()).toBe(0)
  })

  it('resolves a project’s paths: approved and present → a URL; listed but never approved → missing (opening approves nothing)', async () => {
    const f = path.join(dir, 'a.wav')
    fs.writeFileSync(f, Buffer.alloc(10))
    const reg = v.createMediaRegistry({ file: path.join(dir, 'reg.json') })
    reg.add(f)
    const other = path.join(dir, 'b.wav')
    fs.writeFileSync(other, Buffer.alloc(10)) // exists, but never approved: a crafted project naming it gets nothing
    const r = await v.resolvePaths(reg, [f, other, path.join(dir, 'c.wav'), 'C:\\Windows\\win.ini'])
    expect(r[0]).toMatchObject({ path: f, size: 10 })
    expect(r[0].url).toMatch(/^esb-media:\/\/m\/[0-9a-f]{32}$/)
    expect(r.slice(1).every((x: { missing?: boolean }) => x.missing)).toBe(true)
    expect(reg.has(other)).toBe(false)
    expect(reg.size()).toBe(1)
  })

  it('the registry is capped and keeps the newest approvals', () => {
    const files = [0, 1, 2, 3].map((i) => { const f = path.join(dir, `m${i}.mp3`); fs.writeFileSync(f, 'x'); return f })
    const file = path.join(dir, 'reg.json')
    const reg = v.createMediaRegistry({ file, max: 3 })
    files.forEach((f) => reg.add(f))
    expect(reg.size()).toBe(3)
    expect(reg.has(files[0])).toBe(false)
    expect(reg.has(files[3])).toBe(true)
    reg.flush()
    // a longer list on disk loads its newest end
    fs.writeFileSync(file, JSON.stringify(files))
    const again = v.createMediaRegistry({ file, max: 2 })
    expect(again.has(files[3]) && again.has(files[2]) && !again.has(files[0])).toBe(true)
  })

  it('serves byte ranges of an approved file, and nothing else; CORS only for the app’s own origin', async () => {
    const f = path.join(dir, 'clip.mp4')
    fs.writeFileSync(f, Buffer.from([...Array(100).keys()]))
    const reg = v.createMediaRegistry({ file: path.join(dir, 'reg.json') })
    const id = reg.add(f)
    const req = (url: string, headers: Record<string, string> = {}, method = 'GET') => new Request(url, { headers, method })
    const whole = await v.serveMedia(req(`esb-media://m/${id}`), reg)
    expect(whole.status).toBe(200)
    expect((await whole.arrayBuffer()).byteLength).toBe(100)
    const part = await v.serveMedia(req(`esb-media://m/${id}`, { range: 'bytes=10-19' }), reg)
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe('bytes 10-19/100')
    expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
    expect((await v.serveMedia(req(`esb-media://m/${id}`, { range: 'bytes=500-' }), reg)).status).toBe(416)
    expect((await v.serveMedia(req('esb-media://m/' + 'f'.repeat(32)), reg)).status).toBe(404)
    expect((await v.serveMedia(req(`esb-media://m/${id}`, {}, 'POST'), reg)).status).toBe(405)
    const dev = 'http://localhost:5173/'
    expect((await v.serveMedia(req(`esb-media://m/${id}`, { origin: 'http://localhost:5173' }), reg, { devUrl: dev })).headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
    expect((await v.serveMedia(req(`esb-media://m/${id}`, { origin: 'file://' }), reg)).headers.get('access-control-allow-origin')).toBe('file://')
    const evil = await v.serveMedia(req(`esb-media://m/${id}`, { origin: 'https://evil.example' }), reg, { devUrl: dev })
    expect(evil.headers.get('access-control-allow-origin')).toBeNull()
    expect(evil.headers.get('cross-origin-resource-policy')).toBe('same-site')
  })
})

describe('streamed export file', () => {
  const MP4_HEAD = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0])
  it('writes appends and patches at checked positions, then renames into place', async () => {
    const w = v.createExportWriter()
    const target = path.join(dir, 'out.mp4')
    const { id } = w.begin(target)
    await expect(w.write('wrong', 0, MP4_HEAD)).rejects.toThrow(/No export/)
    await expect(w.write(id, 5, MP4_HEAD)).rejects.toThrow(/position/) // a hole past the end
    await expect(w.write(id, -1, MP4_HEAD)).rejects.toThrow(/position/)
    await expect(w.write(id, 0.5, MP4_HEAD)).rejects.toThrow(/position/)
    await expect(w.write(id, 0, 'text')).rejects.toThrow(/piece/)
    await w.write(id, 0, MP4_HEAD)
    await w.write(id, 16, new Uint8Array(1000).fill(1))
    await w.write(id, 0, new Uint8Array([0, 0, 0, 0x20])) // the muxer patching a box size
    expect(fs.existsSync(target)).toBe(false)
    expect(w.end(id, true)).toBe(target)
    const b = fs.readFileSync(target)
    expect(b.length).toBe(1016)
    expect(b[3]).toBe(0x20)
    expect(fs.existsSync(target + '.partial')).toBe(false)
  })

  it('a failed or cancelled export leaves nothing behind; a file that is not a video is not kept', async () => {
    const w = v.createExportWriter()
    const t1 = path.join(dir, 'cancel.mp4')
    const a = w.begin(t1)
    await w.write(a.id, 0, MP4_HEAD)
    expect(w.end(a.id, false)).toBeNull()
    expect(fs.readdirSync(dir)).toEqual([])
    const t2 = path.join(dir, 'fake.mp4')
    const b = w.begin(t2)
    await w.write(b.id, 0, new TextEncoder().encode('MZ this is not a video file'))
    expect(w.end(b.id, true)).toBeNull()
    expect(fs.existsSync(t2)).toBe(false)
  })

  it('a crashed or reloaded window aborts the export: the half file is removed and later writes are refused', async () => {
    const w = v.createExportWriter()
    const t = path.join(dir, 'crash.mp4')
    const a = w.begin(t)
    await w.write(a.id, 0, MP4_HEAD)
    expect(w.abortActive()).toBe(true)
    expect(fs.existsSync(t + '.partial')).toBe(false)
    await expect(w.write(a.id, 16, MP4_HEAD)).rejects.toThrow(/No export/)
    expect(w.abortActive()).toBe(false)
  })

  it('a finished render whose chosen name cannot be replaced is kept under a free name, never deleted', async () => {
    const w = v.createExportWriter()
    // a directory where the file should go: rm(force) cannot remove it and rename onto it fails, like a locked file
    const target = path.join(dir, 'busy.mp4')
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(target, 'keep'), 'x')
    const a = w.begin(target)
    await w.write(a.id, 0, MP4_HEAD)
    const saved = w.end(a.id, true)
    expect(saved).toBe(path.join(dir, 'busy (2).mp4'))
    expect(fs.readFileSync(saved).length).toBe(16)
  })

  it('refuses to start when the drive is nearly full', () => {
    const w = v.createExportWriter()
    expect(() => w.begin(path.join(dir, 'x.mp4'), { minFree: Number.MAX_SAFE_INTEGER })).toThrow(/free space/)
  })
})

describe('autosave snapshots', () => {
  const proj = (id: string, n: number) => JSON.stringify({ id, n })
  it('keeps the last 5 of a project, written whole, and reads the newest that parses', () => {
    for (let i = 1; i <= 7; i++) v.writeSnapshot(dir, proj('p1', i), 1000 + i)
    const files = fs.readdirSync(dir).sort()
    expect(files).toHaveLength(5)
    expect(files.every((f) => /^snap-\d+-[0-9a-f]{12}\.json$/.test(f))).toBe(true)
    expect(JSON.parse(v.latestSnapshot(dir).text).n).toBe(7)
    fs.writeFileSync(path.join(dir, files.at(-1)!), '{broken') // a damaged newest snapshot falls back to the one before
    expect(JSON.parse(v.latestSnapshot(dir).text).n).toBe(6)
    expect(() => v.writeSnapshot(dir, 'not json')).toThrow()
    v.clearSnapshots(dir)
    expect(v.latestSnapshot(dir)).toBeNull()
  })

  it('saving one project clears only its own snapshots; another project’s unsaved work stays restorable', () => {
    v.writeSnapshot(dir, proj('discarded', 1), 2001)
    v.writeSnapshot(dir, proj('discarded', 2), 2002)
    v.writeSnapshot(dir, proj('opened', 1), 2003)
    fs.writeFileSync(path.join(dir, 'snap-000000000001000.json'), proj('opened', 0)) // an older snapshot without a tag
    expect(v.clearSnapshots(dir, 'opened')).toBe(true)
    const left = fs.readdirSync(dir)
    expect(left).toHaveLength(2)
    expect(JSON.parse(v.latestSnapshot(dir).text)).toEqual({ id: 'discarded', n: 2 })
    expect(v.clearSnapshots(dir, 42)).toBe(false) // not a string id: nothing removed
    expect(fs.readdirSync(dir)).toHaveLength(2)
  })

  it('a project path the renderer names must be a .esbvideo file', () => {
    expect(v.isVideoProjectPath('C:\\x\\a.esbvideo')).toBe(true)
    expect(v.isVideoProjectPath('C:\\x\\a.esb')).toBe(false)
    expect(v.isVideoProjectPath('C:\\x\\a\u0000.esbvideo')).toBe(false)
  })
})

describe('stills and voiceover takes the app writes itself', () => {
  it('a take must be a real recording by its own header', () => {
    expect(v.audioTakeKind(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('webm')
    expect(v.audioTakeKind(new TextEncoder().encode('OggS........'))).toBe('ogg')
    expect(v.audioTakeKind(new TextEncoder().encode('RIFF....WAVEfmt '))).toBe('wav')
    expect(v.audioTakeKind(new TextEncoder().encode('MZ not audio at all'))).toBeNull()
    expect(v.audioTakeKind('text')).toBeNull()
  })

  it('stores by content hash (the same bytes twice are one file) and refuses past the folder cap without deleting', () => {
    const d = path.join(dir, 'takes')
    const a = v.storeGenerated(d, 'Voiceover 4:58 PM', 'webm', new Uint8Array([1, 2, 3]), { maxFiles: 2, maxBytes: 1000 })
    expect(path.basename(a)).toMatch(/^Voiceover-4-58-PM-[0-9a-f]{24}\.webm$/)
    expect(v.storeGenerated(d, 'again', 'webm', new Uint8Array([1, 2, 3]), { maxFiles: 2, maxBytes: 1000 })).not.toBe(null)
    v.storeGenerated(d, 'b', 'webm', new Uint8Array([4]), { maxFiles: 2, maxBytes: 1000 })
    expect(() => v.storeGenerated(d, 'c', 'webm', new Uint8Array([5]), { maxFiles: 2, maxBytes: 1000 })).toThrow(/full/)
    expect(() => v.storeGenerated(d, 'big', 'webm', new Uint8Array(2000), { maxFiles: 99, maxBytes: 1000 })).toThrow(/full/)
    expect(fs.readdirSync(d)).toHaveLength(2)
    expect(fs.existsSync(a)).toBe(true)
  })
})
