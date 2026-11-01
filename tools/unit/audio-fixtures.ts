// Shared helpers for the Phase 4/5 audio library tests: synthetic signals in memory, and ffmpeg-made fixtures +
// ffmpeg reference measurements (written to tools/out/audio-fixtures, never committed). Tests that need ffmpeg skip
// themselves when it is not on PATH.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const OUT = join(process.cwd(), 'tools', 'out', 'audio-fixtures')

export const hasFfmpeg = (() => {
  try { execFileSync('ffmpeg', ['-hide_banner', '-version'], { stdio: 'ignore' }); return true } catch { return false }
})()

/** Render an ffmpeg lavfi source to raw float PCM and read it back, one Float32Array per channel. */
export function lavfi(name: string, graph: string, channels: number, sampleRate: number): Float32Array[] {
  mkdirSync(OUT, { recursive: true })
  const file = join(OUT, `${name}.f32`)
  if (!existsSync(file)) {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', graph, '-ac', String(channels), '-ar', String(sampleRate), '-f', 'f32le', file])
  }
  return readF32(file, channels)
}

export function readF32(file: string, channels: number): Float32Array[] {
  const buf = readFileSync(file)
  const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  const n = Math.floor(all.length / channels)
  const out = Array.from({ length: channels }, () => new Float32Array(n))
  for (let i = 0; i < n; i++) for (let c = 0; c < channels; c++) out[c][i] = all[i * channels + c]
  return out
}

/** Write channels as raw float PCM (for measuring our own output with ffmpeg). */
export function writeF32(name: string, chans: Float32Array[]): string {
  mkdirSync(OUT, { recursive: true })
  const n = chans[0].length
  const all = new Float32Array(n * chans.length)
  for (let i = 0; i < n; i++) for (let c = 0; c < chans.length; c++) all[i * chans.length + c] = chans[c][i]
  const file = join(OUT, `${name}.f32`)
  writeFileSync(file, Buffer.from(all.buffer))
  return file
}

export interface FfLoudness { I: number; LRA: number; low: number; high: number; peak: number }

/** ffmpeg's ebur128 summary for a raw float file. */
export function ffEbur128(file: string, channels: number, sampleRate: number): FfLoudness {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-f', 'f32le', '-ar', String(sampleRate), '-ac', String(channels), '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' })
  const text = r.stderr
  const summary = text.slice(text.lastIndexOf('Summary:'))
  const num = (re: RegExp) => { const m = summary.match(re); return m ? (m[1] === '-inf' ? -Infinity : parseFloat(m[1])) : NaN }
  return {
    I: num(/I:\s+(-?[\d.]+|-inf) LUFS/),
    LRA: num(/LRA:\s+(-?[\d.]+) LU/),
    low: num(/LRA low:\s+(-?[\d.]+|-inf) LUFS/),
    high: num(/LRA high:\s+(-?[\d.]+|-inf) LUFS/),
    peak: num(/Peak:\s+(-?[\d.]+|-inf) dBFS/),
  }
}

// ---------------------------------------------------------------- synthetic signals

/** Deterministic PRNG (mulberry32) so every run is the same. */
export function rng(seed = 1) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Gaussian white noise of a given RMS. */
export function noise(n: number, rms: number, seed = 1): Float32Array {
  const r = rng(seed)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i += 2) {
    const u = Math.max(1e-12, r())
    const v = r()
    const m = Math.sqrt(-2 * Math.log(u))
    out[i] = m * Math.cos(2 * Math.PI * v) * rms
    if (i + 1 < n) out[i + 1] = m * Math.sin(2 * Math.PI * v) * rms
  }
  return out
}

export function sine(n: number, sr: number, f: number, amp: number, phase = 0): Float32Array {
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * f * i) / sr + phase)
  return out
}

export const rms = (x: Float32Array, a = 0, b = x.length) => {
  let s = 0
  for (let i = a; i < b; i++) s += x[i] * x[i]
  return Math.sqrt(s / Math.max(1, b - a))
}
export const db = (v: number) => 20 * Math.log10(v)
