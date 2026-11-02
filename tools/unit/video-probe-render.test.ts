import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { probeFacts } from '../../src/video/publish/probeRender'
import { validateReel, validateYouTubeMedia } from '../../electron/video-publish/validators.mjs'

const reader = (file: string) => ({
  size: fs.statSync(file).size,
  read: async (start: number, end: number) => { const fd = fs.openSync(file, 'r'); try { const b = Buffer.alloc(end - start); const n = fs.readSync(fd, b, 0, b.length, start); return new Uint8Array(b.buffer, b.byteOffset, n) } finally { fs.closeSync(fd) } },
})
const ffmpeg = spawnSync('ffmpeg', ['-version']).status === 0
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-probe-'))
const make = (name: string, args: string[]) => { const out = path.join(tmp, name); const r = spawnSync('ffmpeg', ['-y', '-v', 'error', ...args, out]); if (r.status !== 0) throw new Error(String(r.stderr)); return out }

describe.skipIf(!ffmpeg)('facts read from the render itself', { timeout: 60_000 }, () => {
  it('a fixed 30 fps H.264 + AAC-LC 48 kHz stereo file reads as exactly that', async () => {
    const f = make('cfr.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '60', '-bf', '0', '-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-shortest'])
    const { facts, unreadable } = await probeFacts(reader(f))
    expect(unreadable).toEqual([])
    expect(facts).toMatchObject({ width: 1080, height: 1920, videoCodec: 'avc', fpsMode: 'constant', audioCodec: 'aac', audioProfile: 'LC', audioSampleRate: 48000, audioChannels: 2, closedGop: true })
    expect(facts.durationSec).toBeCloseTo(6, 0)
    expect(facts.fps).toBeCloseTo(30, 0)
    expect(facts.gopSec).toBeCloseTo(2, 1)
    expect(facts.audioBitrate).toBeGreaterThan(100_000)
    expect(validateReel(facts).problems).toEqual([])
  })

  it('a variable-frame-rate file is read as variable and refused for a Reel', async () => {
    const f = make('vfr.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=6', '-vf', "setpts='PTS+0.02*sin(N*7)/TB'", '-fps_mode', 'passthrough', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '60', '-bf', '0', '-an'])
    const { facts } = await probeFacts(reader(f))
    expect(facts.fpsMode).toBe('variable')
    expect(validateReel(facts).problems.some((p) => p.code === 'variable-fps')).toBe(true)
  })

  it('a 95 s file is read as 95 s and refused for a Reel, and fine for YouTube', async () => {
    const f = make('long.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=95', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=95', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '60', '-bf', '0', '-c:a', 'aac', '-shortest'])
    const { facts } = await probeFacts(reader(f))
    expect(facts.durationSec).toBeCloseTo(95, 0)
    expect(validateReel(facts).problems.some((p) => p.code === 'too-long')).toBe(true)
    expect(validateYouTubeMedia(facts).problems).toEqual([])
  })

  it('B-frames (reordered frames) are not claimed to be a closed GOP', async () => {
    const f = make('bframes.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '60', '-bf', '3', '-an'])
    const { facts } = await probeFacts(reader(f))
    expect(facts.closedGop).toBe(false)
  })
})
