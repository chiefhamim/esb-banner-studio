// The music library's main-process side (electron/video-music.cjs): the renderer is hostile, so it can only name files
// relative to the one folder the owner chose; traversal, links out of the folder and non-audio files are refused.
import { describe, it, expect, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const m = require('../../electron/video-music.cjs')

let root: string
let outside: string
beforeEach(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-music-'))
  root = path.join(base, 'music')
  outside = path.join(base, 'secret')
  fs.mkdirSync(path.join(root, 'sub'), { recursive: true })
  fs.mkdirSync(outside)
  fs.writeFileSync(path.join(root, 'a - calm piano.mp3'), Buffer.alloc(40, 1))
  fs.writeFileSync(path.join(root, 'sub', 'b.wav'), Buffer.alloc(40, 2))
  fs.writeFileSync(path.join(root, 'notes.txt'), 'x')
  fs.writeFileSync(path.join(outside, 'private.mp3'), Buffer.alloc(40, 3))
})

describe('music folder listing and confinement', () => {
  it('lists only audio files inside the chosen folder', () => {
    const { files } = m.listAudio(root)
    expect(files.map((f: { rel: string }) => f.rel).sort()).toEqual(['a - calm piano.mp3', 'sub/b.wav'])
  })

  it('resolves a relative audio path inside the folder', () => {
    const f = m.confinedAudio(root, 'sub/b.wav')
    expect(f && fs.realpathSync(f)).toBe(fs.realpathSync(path.join(root, 'sub', 'b.wav')))
  })

  it('refuses traversal, absolute paths, drives, UNC, streams and non-audio', () => {
    const BS = String.fromCharCode(92)
    const bad = ['../secret/private.mp3', 'sub/../../secret/private.mp3', '/etc/x.mp3', path.join(outside, 'private.mp3'), 'C:/x.mp3', 'C:' + BS + 'x.mp3', BS + BS + 'host' + BS + 's' + BS + 'x.mp3', '//host/s/x.mp3', 'a - calm piano.mp3:stream.mp3', 'notes.txt', '', '.', '..', 'sub/', 'sub' + BS + 'b.wav', 'a' + String.fromCharCode(0) + '.mp3', 42, null, {}]
    for (const rel of bad) expect(m.confinedAudio(root, rel as string)).toBeNull()
  })

  it('refuses a link inside the folder that leads outside it', () => {
    let linked = true
    try { fs.symlinkSync(outside, path.join(root, 'linkdir'), 'junction') } catch { linked = false }
    try { fs.symlinkSync(path.join(outside, 'private.mp3'), path.join(root, 'link.mp3'), 'file') } catch { /* needs privilege on Windows */ }
    if (linked) {
      expect(m.confinedAudio(root, 'linkdir/private.mp3')).toBeNull()
      expect(m.listAudio(root).files.some((f: { rel: string }) => f.rel.includes('private'))).toBe(false)
    }
    expect(m.confinedAudio(root, 'link.mp3')).toBeNull()
  })

  it('refuses a folder that is not a local directory', () => {
    expect(m.isFolderPath(String.fromCharCode(92, 92) + 'host' + String.fromCharCode(92) + 'share')).toBe(false)
    expect(m.isFolderPath('relative')).toBe(false)
    expect(m.isFolderPath(path.join(root, 'a - calm piano.mp3'))).toBe(false)
    expect(m.confinedAudio(String.fromCharCode(92,92)+"host", "x.mp3")).toBeNull()
  })

  it('keeps the chosen folder across launches, only if it is still a folder', () => {
    const file = path.join(path.dirname(root), 'f.json')
    const a = m.createMusicFolder({ file })
    expect(a.get()).toBeNull()
    expect(a.set('relative')).toBeNull()
    expect(a.set(root)).toBe(path.resolve(root))
    expect(m.createMusicFolder({ file }).get()).toBe(path.resolve(root))
    a.clear()
    expect(m.createMusicFolder({ file }).get()).toBeNull()
  })
})
