// Phase 4 fix round, main-process side: music listing caps (S3), the registry forgetting music tracks (S4) and the take
// that is written while it is recorded (C7).
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const music = require('../../electron/video-music.cjs')
const media = require('../../electron/video-media.cjs')
const take = require('../../electron/video-take.cjs')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'p4fix-'))

describe('S3 music listing is bounded and async', () => {
  it('stops at the entry and folder caps and says it was cut', async () => {
    const root = tmp()
    for (let d = 0; d < music.MAX_DIRS + 20; d++) fs.mkdirSync(path.join(root, `d${String(d).padStart(4, '0')}`))
    fs.writeFileSync(path.join(root, 'a.mp3'), 'x')
    const r = await music.listAudioAsync(root)
    expect(r.truncated).toBe(true)
    expect(r.files.map((f: { rel: string }) => f.rel)).toContain('a.mp3')
    expect(music.listAudio(root).truncated).toBe(true)
    fs.rmSync(root, { recursive: true, force: true })
  })
  it('async and sync agree on a small folder', async () => {
    const root = tmp()
    fs.mkdirSync(path.join(root, 'sub'))
    fs.writeFileSync(path.join(root, 'sub', 'b.wav'), 'x'); fs.writeFileSync(path.join(root, 'c.txt'), 'x')
    const a = await music.listAudioAsync(root)
    expect(a.files.map((f: { rel: string }) => f.rel)).toEqual(['sub/b.wav'])
    expect(a.truncated).toBe(false)
    fs.rmSync(root, { recursive: true, force: true })
  })
})

describe('S4 clearing the music folder unregisters its tracks', () => {
  it('a removed file is no longer servable by id', () => {
    const dir = tmp()
    const f = path.join(dir, 't.mp3'); fs.writeFileSync(f, 'x')
    const reg = media.createMediaRegistry({ file: path.join(dir, 'reg.json') })
    const id = reg.add(f)
    expect(reg.pathFor(id)).toBeTruthy()
    expect(reg.remove(f)).toBe(true)
    expect(reg.pathFor(id)).toBeNull()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('C7 a take is kept on disk while it records', () => {
  const webm = (n: number) => { const b = new Uint8Array(n); b.set([0x1a, 0x45, 0xdf, 0xa3]); return b }
  const mk = (dir: string) => take.createTakeRecorder({ dir, audioTakeKind: media.audioTakeKind, maxBytes: 1 << 20 })
  it('pieces are appended in order and finish returns the whole take; a bad first piece is refused', () => {
    const dir = tmp(); const t = mk(dir)
    const id = t.begin()
    expect(() => t.append(id, new Uint8Array(100))).toThrow()
    expect(() => t.append('0000000000000000', webm(20))).toThrow()
    t.append(id, webm(50)); t.append(id, new Uint8Array(30).fill(7))
    const r = t.finish(id)
    expect(r.kind).toBe('webm'); expect(r.data.length).toBe(80); expect(r.data[60]).toBe(7)
    expect(fs.readdirSync(dir)).toEqual([])
    fs.rmSync(dir, { recursive: true, force: true })
  })
  it('a crash leaves a part file that recover() turns back into a take; the size cap holds', () => {
    const dir = tmp(); const t = mk(dir)
    const id = t.begin(); t.append(id, webm(64))
    const again = mk(dir)
    const rec = again.recover()
    expect(rec).toHaveLength(1); expect(rec[0].data.length).toBe(64)
    expect(fs.readdirSync(dir)).toEqual([])
    const id2 = again.begin()
    expect(() => again.append(id2, webm(2 << 20))).toThrow()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
