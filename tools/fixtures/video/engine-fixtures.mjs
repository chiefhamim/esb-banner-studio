// Synthetic fixtures for the Phase 1 engine tests, made with ffmpeg into tools/out/video-fixtures/ (gitignored) the
// first time a test needs them. Nothing here is real footage or a real recording.
//   layer-a-1080p30.mp4  65 s 1920x1080 30 fps H.264 (GOP 30) testsrc2 + 440 Hz tone   (playback layer 1, sound)
//   layer-b-1080p30.mp4  65 s 1920x1080 30 fps H.264 (GOP 30) smptehdbars + moving box  (playback layer 2)
//   layer-c-1080p30.mp4  65 s 1920x1080 30 fps H.264 (GOP 30) testsrc                    (playback layer 3)
//   scrub-540p.mp4       20 s 960x540 30 fps H.264, every frame a key frame (stands in for a Part A proxy)
//   flash-beep.mp4       8 s 1280x720 30 fps: black, one white frame at 1, 3, 5, 7 s; a 40 ms 1 kHz beep starting
//                        at exactly the same instants (48 kHz AAC)
//   golden-src.mp4       12 s 1920x1080 30 fps testsrc2 (its frame counter changes every frame)
//   offset-1500.mp4      6 s 1280x720 30 fps testsrc2 + tone whose FIRST timestamp is 1.5 s (-output_ts_offset):
//                        a proxy must keep that offset (fix round C2)
// Made only when asked for (UHD_FIXTURES; the fix round's playback cases, ~1 min of ffmpeg the first time):
//   uhd-a-30.mp4 / uhd-b-30.mp4   12 s 3840x2160 30 fps H.264 (GOP 30) testsrc2 / bars + moving box
//   uhd-c-60.mp4                  12 s 3840x2160 60 fps H.264 (GOP 60) testsrc2
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../../..')
export const engineFixtureDir = path.join(root, 'tools', 'out', 'video-fixtures')

const run = (args) => {
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${String(r.stderr).slice(-600)}`)
}

const SPECS = {
  'layer-a-1080p30.mp4': ['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=65', '-f', 'lavfi', '-i', 'sine=f=440:d=65:sample_rate=48000',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-g', '30', '-bf', '2', '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-movflags', '+faststart'],
  'layer-b-1080p30.mp4': ['-f', 'lavfi', '-i', "smptehdbars=size=1920x1080:rate=30:duration=65,drawbox=x='mod(t*360,1700)':y=400:w=220:h=220:color=white@0.9:t=fill",
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-g', '30', '-bf', '2', '-an', '-movflags', '+faststart'],
  'layer-c-1080p30.mp4': ['-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=30:duration=65',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-g', '30', '-bf', '2', '-an', '-movflags', '+faststart'],
  'scrub-540p.mp4': ['-f', 'lavfi', '-i', 'testsrc2=size=960x540:rate=30:duration=20',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-g', '1', '-an', '-movflags', '+faststart'],
  'flash-beep.mp4': ['-f', 'lavfi', '-i', "color=c=black:s=1280x720:r=30:d=8,drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='eq(n,30)+eq(n,90)+eq(n,150)+eq(n,210)'",
    '-f', 'lavfi', '-i', "aevalsrc='if(gte(t,1)*lt(mod(t-1,2),0.04),0.8*sin(2*PI*1000*t),0)':s=48000:d=8",
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-g', '30', '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-movflags', '+faststart'],
  'golden-src.mp4': ['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=12',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-g', '30', '-an', '-movflags', '+faststart'],
  'offset-1500.mp4': ['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=f=660:d=6:sample_rate=48000',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', '-g', '15', '-bf', '0', '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-output_ts_offset', '1.5'],
  // Phase 2 — Part B (effects, speed):
  //   greenscreen.mp4  4 s 1280x720 30 fps: noisy studio green (#00b140), a skin-tone square with a dark band, ringed by
  //                    an 8 px green-spill fringe (#7fae6e), slightly blurred (soft edges like a real key)
  //   counter-360p.mp4 6 s 640x360 30 fps, GOP 30: frame number N as 10 bars of 64 px (bit b = bar b, LSB left, white
  //                    = 1), so any exported frame says which source frame it is
  'greenscreen.mp4': ['-f', 'lavfi', '-i', 'color=c=0x00b140:s=1280x720:r=30:d=4,noise=alls=6:allf=t,drawbox=x=440:y=160:w=400:h=400:color=0x7fae6e:t=fill,drawbox=x=448:y=168:w=384:h=384:color=0xc89678:t=fill,drawbox=x=560:y=330:w=160:h=60:color=0x303040:t=fill,gblur=sigma=1.2',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', '-g', '30', '-an', '-movflags', '+faststart'],
  'counter-360p.mp4': ['-f', 'lavfi', '-i', "nullsrc=s=640x360:r=30:d=6,format=gray,geq=lum='if(gt(mod(floor(N/pow(2,floor(X/64))),2),0),235,16)'",
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-g', '30', '-bf', '2', '-an', '-movflags', '+faststart'],
  'uhd-a-30.mp4': ['-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=30:duration=12',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-g', '30', '-bf', '2', '-an', '-movflags', '+faststart'],
  'uhd-b-30.mp4': ['-f', 'lavfi', '-i', "smptehdbars=size=3840x2160:rate=30:duration=12,drawbox=x='mod(t*700,3400)':y=800:w=440:h=440:color=white@0.9:t=fill",
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', '-g', '30', '-bf', '2', '-an', '-movflags', '+faststart'],
  'uhd-c-60.mp4': ['-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=60:duration=12',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-g', '60', '-bf', '2', '-an', '-movflags', '+faststart'],
}

/** The 4K fixtures (made only when a test asks for them by name). */
export const UHD_FIXTURES = ['uhd-a-30.mp4', 'uhd-b-30.mp4', 'uhd-c-60.mp4']

/** Paths of the engine fixtures, making any that are missing. */
export function ensureEngineFixtures(names = Object.keys(SPECS).filter((n) => !UHD_FIXTURES.includes(n))) {
  fs.mkdirSync(engineFixtureDir, { recursive: true })
  const out = {}
  for (const n of names) {
    const f = path.join(engineFixtureDir, n)
    if (!fs.existsSync(f)) run([...SPECS[n], f])
    out[n] = f
  }
  return out
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const made = ensureEngineFixtures()
  for (const [n, f] of Object.entries(made)) console.log(n, fs.statSync(f).size, 'bytes')
}
