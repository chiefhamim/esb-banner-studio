// Synthetic video fixtures for the Video desk tests. Nothing here is real footage or a real voice recording.
//   speech-6s.mp4   640x360 test pattern, 30 fps, H.264 + AAC 48 kHz. Silent for the first second, then a synthetic
//                   voice (Windows SAPI text-to-speech where available, otherwise a formant-like buzz) reading one
//                   neutral test sentence, ending before 5.5 s.
//   uhd-4k.mp4      (only with --4k) 4 s of 3840x2160 test pattern at 30 fps with a 3 s GOP (so it is both over 1080p
//                   and long-GOP) + a 440 Hz tone; for the proxy test. Written to tools/out/video-fixtures/, never committed.
//   long-1080p.mp4  (only with --long) 10 minutes of 1920x1080 test pattern + tone, for the export memory test. It is
//                   written to tools/out/video-fixtures/ (gitignored), never committed.
// Usage: node tools/fixtures/video/make-fixtures.mjs [--long] [--4k]
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const here = import.meta.dirname
const root = path.resolve(here, '../../..')
const run = (cmd, args) => { const r = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }); if (r.status !== 0) throw new Error(`${cmd} failed: ${String(r.stderr).slice(-600)}`); return r }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-vfix-'))
const out = path.join(here, 'speech-6s.mp4')
// with only --4k / --long, the committed speech fixture is left as it is (it is remade when missing or with no flags)
const extrasOnly = process.argv.some((a) => a === '--4k' || a === '--long') && fs.existsSync(out)
if (!extrasOnly) {
  const voice = path.join(tmp, 'voice.wav')
  let sapi = false
  if (process.platform === 'win32') {
    const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate = 1; $s.SetOutputToWaveFile('${voice.replace(/'/g, "''")}'); $s.Speak('This is a synthetic test voice for the video desk. One, two, three.'); $s.Dispose()`
    sapi = spawnSync('powershell', ['-NoProfile', '-Command', ps]).status === 0 && fs.existsSync(voice) && fs.statSync(voice).size > 10000
  }
  if (!sapi) {
    // a 130 Hz buzz shaped by two formant band-passes and a 4 Hz syllable envelope: speech-like energy, no words
    run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=f=130:d=4,volume=8', '-af', 'aeval=val(0)*(0.55+0.45*sin(2*PI*4*t)):c=same,bandpass=f=700:w=500,highpass=f=120', voice])
  }
  run('ffmpeg', ['-y', '-v', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=6',
    '-i', voice,
    '-filter_complex', '[1:a]aresample=48000,atrim=0:4.4,adelay=1000|1000,apad=whole_dur=6,aformat=channel_layouts=stereo[a]',
    '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p', '-g', '30',
    '-c:a', 'aac', '-b:a', '96k', '-t', '6', '-movflags', '+faststart', out])
  console.log('wrote', path.relative(root, out), fs.statSync(out).size, 'bytes', sapi ? '(SAPI voice)' : '(formant buzz)')
}

if (process.argv.includes('--long')) {
  const dir = path.join(root, 'tools', 'out', 'video-fixtures')
  fs.mkdirSync(dir, { recursive: true })
  const long = path.join(dir, 'long-1080p.mp4')
  if (!fs.existsSync(long)) {
    run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=600', '-f', 'lavfi', '-i', 'sine=f=330:d=600:sample_rate=48000',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '35', '-pix_fmt', 'yuv420p', '-g', '60', '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-movflags', '+faststart', long])
  }
  console.log('long fixture', path.relative(root, long), fs.statSync(long).size, 'bytes')
}
if (process.argv.includes('--4k')) {
  const dir = path.join(root, 'tools', 'out', 'video-fixtures')
  fs.mkdirSync(dir, { recursive: true })
  const uhd = path.join(dir, 'uhd-4k.mp4')
  if (!fs.existsSync(uhd)) {
    run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=f=440:d=4:sample_rate=48000',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', '-g', '90', '-keyint_min', '90', '-sc_threshold', '0', '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-movflags', '+faststart', uhd])
  }
  console.log('4K fixture', path.relative(root, uhd), fs.statSync(uhd).size, 'bytes')
}
fs.rmSync(tmp, { recursive: true, force: true })
