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

  it('resolves a project’s paths: approved and present → a URL, else missing', () => {
    const f = path.join(dir, 'a.wav')
    fs.writeFileSync(f, Buffer.alloc(10))
    const reg = v.createMediaRegistry({ file: path.join(dir, 'reg.json') })
    reg.add(f)
    const other = path.join(dir, 'b.wav')
    fs.writeFileSync(other, Buffer.alloc(10)) // exists, but never approved
    const r = v.resolvePaths(reg, [f, other, path.join(dir, 'c.wav'), 'C:\\Windows\\win.ini'])
    expect(r[0]).toMatchObject({ path: f, size: 10 })
    expect(r[0].url).toMatch(/^esb-media:\/\/m\/[0-9a-f]{32}$/)
    expect(r.slice(1).every((x: { missing?: boolean }) => x.missing)).toBe(true)
  })

  it('serves byte ranges of an approved file, and nothing else', async () => {
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
  })

  it('a project lists only media paths for approval', () => {
    const text = JSON.stringify({ mediaAssets: [{ path: 'C:\\a\\b.mp4' }, { path: 'C:\\Windows\\win.ini' }, { path: 'rel.mp4' }, null] })
    expect(v.projectMediaPaths(process.platform === 'win32' ? text : text.replace(/C:\\\\/g, '/'))).toHaveLength(1)
    expect(v.projectMediaPaths('not json')).toEqual([])
  })
})

describe('streamed export file', () => {
  const MP4_HEAD = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0])
  it('writes appends and patches at checked positions, then renames into place', () => {
    const w = v.createExportWriter()
    const target = path.join(dir, 'out.mp4')
    const { id } = w.begin(target)
    expect(() => w.write('wrong', 0, MP4_HEAD)).toThrow(/No export/)
    expect(() => w.write(id, 5, MP4_HEAD)).toThrow(/position/) // a hole past the end
    expect(() => w.write(id, -1, MP4_HEAD)).toThrow(/position/)
    expect(() => w.write(id, 0.5, MP4_HEAD)).toThrow(/position/)
    expect(() => w.write(id, 0, 'text')).toThrow(/piece/)
    w.write(id, 0, MP4_HEAD)
    w.write(id, 16, new Uint8Array(1000).fill(1))
    w.write(id, 0, new Uint8Array([0, 0, 0, 0x20])) // the muxer patching a box size
    expect(fs.existsSync(target)).toBe(false)
    expect(w.end(id, true)).toBe(target)
    const b = fs.readFileSync(target)
    expect(b.length).toBe(1016)
    expect(b[3]).toBe(0x20)
    expect(fs.existsSync(target + '.partial')).toBe(false)
  })

  it('a failed or cancelled export leaves nothing behind; a file that is not a video is not kept', () => {
    const w = v.createExportWriter()
    const t1 = path.join(dir, 'cancel.mp4')
    const a = w.begin(t1)
    w.write(a.id, 0, MP4_HEAD)
    expect(w.end(a.id, false)).toBeNull()
    expect(fs.readdirSync(dir)).toEqual([])
    const t2 = path.join(dir, 'fake.mp4')
    const b = w.begin(t2)
    w.write(b.id, 0, new TextEncoder().encode('MZ this is not a video file'))
    expect(w.end(b.id, true)).toBeNull()
    expect(fs.existsSync(t2)).toBe(false)
  })
})

describe('autosave snapshots', () => {
  it('keeps the last 5, written whole, and reads the newest that parses', () => {
    for (let i = 1; i <= 7; i++) v.writeSnapshot(dir, JSON.stringify({ n: i }), 1000 + i)
    const files = fs.readdirSync(dir).sort()
    expect(files).toHaveLength(5)
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false)
    expect(JSON.parse(v.latestSnapshot(dir).text).n).toBe(7)
    fs.writeFileSync(path.join(dir, files.at(-1)!), '{broken') // a damaged newest snapshot falls back to the one before
    expect(JSON.parse(v.latestSnapshot(dir).text).n).toBe(6)
    expect(() => v.writeSnapshot(dir, 'not json')).toThrow()
    v.clearSnapshots(dir)
    expect(v.latestSnapshot(dir)).toBeNull()
  })

  it('a project path the renderer names must be a .esbvideo file', () => {
    expect(v.isVideoProjectPath('C:\\x\\a.esbvideo')).toBe(true)
    expect(v.isVideoProjectPath('C:\\x\\a.esb')).toBe(false)
    expect(v.isVideoProjectPath('C:\\x\\a\u0000.esbvideo')).toBe(false)
  })
})
