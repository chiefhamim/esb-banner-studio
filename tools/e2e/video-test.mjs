// Automated E2E verification of Video Studio & Timeline Editor
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { launchBrowser } from '../launch-browser.mjs'

const PORT = 5195
const root = path.resolve(import.meta.dirname, '../..')
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })

const waitUp = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('Vite did not start')
}

let browser
let failed = 0

function check(label, condition, info = '') {
  if (condition) {
    console.log(`PASS ${label} ${info}`)
  } else {
    console.error(`FAIL ${label} ${info}`)
    failed++
  }
}

try {
  await waitUp()
  browser = await launchBrowser(chromium)
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
  page.setDefaultTimeout(20000)

  page.on('console', (msg) => console.log('PAGE LOG:', msg.type(), msg.text()))
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err))

  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForSelector('.topbar')

  // 1. Switch to Video Studio via Workspace Rail
  await page.click('.ws-btn[data-ws="video"]')
  await page.waitForSelector('.video-workspace')
  check('Video Studio workspace mounted', (await page.locator('.video-workspace').count()) === 1)

  // 2. Verify canvas monitor & timecode readout
  const hasCanvas = await page.locator('.vw-canvas').count()
  const timecode = await page.textContent('.vw-timecode')
  check('Video canvas monitor rendered', hasCanvas === 1)
  check('Timecode readout initialized', timecode?.trim() === '00:00:00:00', `got: ${timecode}`)

  // 3. Play / Pause transport test
  const playBtn = page.locator('.play-btn')
  await playBtn.click()
  await page.waitForTimeout(300)
  const isPlaying = await page.locator('.play-btn.playing').count()
  check('Playback transport started', isPlaying === 1)

  await playBtn.click()
  await page.waitForTimeout(100)
  const isPaused = await page.locator('.play-btn:not(.playing)').count()
  check('Playback transport paused', isPaused === 1)

  // 4. Track lanes and clips count
  const clipCountBefore = await page.locator('.vw-clip-block').count()
  check('Timeline initialised with multi-track clips', clipCountBefore >= 4, `found ${clipCountBefore} clips`)

  // 5. Add a new Lower-Third overlay clip
  await page.click('.vw-bin-tabs button:has-text("Overlays")')
  await page.click('.vw-preset-card:has-text("Speaker Name") button:has-text("+ Add")')
  await page.waitForTimeout(150)
  const clipCountAfter = await page.locator('.vw-clip-block').count()
  check('Added broadcast lower-third overlay clip', clipCountAfter === clipCountBefore + 1)

  // 6. Split clip at playhead
  await page.keyboard.press('KeyS')
  await page.waitForTimeout(150)
  const clipCountAfterSplit = await page.locator('.vw-clip-block').count()
  check('Split clip at playhead', clipCountAfterSplit >= clipCountAfter)

  // 7. Verify trim handles on clips
  const trimHandles = await page.locator('.vw-trim-handle.left').count()
  check('Trim handles rendered on timeline clips', trimHandles >= 4)

  // 8. Media bin tab & dropzone
  await page.click('.vw-bin-tabs button:has-text("Media Bin")')
  const hasDropzone = await page.locator('.vw-dropzone').count()
  check('Media library dropzone rendered', hasDropzone === 1)

  // 9. Editable project title
  const titleInput = page.locator('.vw-title-input')
  await titleInput.fill('ESB Breaking News 2026')
  check('Editable project title updated', (await titleInput.inputValue()) === 'ESB Breaking News 2026')

  // 10. Export the whole timeline: MP4/H.264, its true length, every frame (ffprobe reads the file back)
  const { execFileSync, spawnSync } = await import('node:child_process')
  const fs = await import('node:fs')
  const probe = (f) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-count_frames', '-of', 'json', f]).toString())
  const exportOnce = async (length) => {
    await page.click('.vw-header-actions button:has-text("Export")')
    await page.waitForSelector('.vx')
    if (length) await page.click(`.vx-row .seg-ctl button:has-text("${length}")`)
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 300000 }), page.click('.vx-go')])
    const file = await download.path()
    await page.waitForSelector('.vw-export-success')
    const facts = (await page.locator('.vw-export-success').innerText()).replace(/\s+/g, ' ')
    await page.click('.vw-export-modal button:has-text("Done")')
    return { file, facts }
  }
  const projDur = await page.evaluate(() => window.__videoStore.getState().project.duration)
  const full = await exportOnce()
  const p1 = probe(full.file)
  const v1 = p1.streams.find((s) => s.codec_type === 'video')
  check('Export is MP4 / H.264', p1.format.format_name.includes('mp4') && v1.codec_name === 'h264', `${p1.format.format_name} ${v1.codec_name}`)
  check('Export runs the whole timeline at true speed (not the old 3 s cap)', Math.abs(Number(p1.format.duration) - projDur) < 0.1 && Number(v1.nb_read_frames) === Math.round(projDur * 30), `duration ${p1.format.duration}s of ${projDur}s, ${v1.nb_read_frames} frames`)
  check('Result reports the file as written', /MP4/.test(full.facts) && /H\.264/.test(full.facts), full.facts)

  // 11. Footage frames land at their own time, and A1 audio is mixed in. Synthetic fixtures: 1 s red then 1 s
  // green (one key frame per frame), a 440 Hz tone placed at 1.0 s.
  await page.setInputFiles('.video-workspace input[type=file][multiple]', [path.join(root, 'tools/fixtures/media/red-green-2s.mp4'), path.join(root, 'tools/fixtures/media/tone-440-2s.wav')])
  await page.waitForFunction(() => window.__videoStore.getState().mediaAssets.length >= 2)
  await page.evaluate(() => {
    const st = window.__videoStore.getState()
    const a = st.mediaAssets
    const vid = a.find((x) => x.type === 'video'), aud = a.find((x) => x.type === 'audio')
    window.__videoStore.setState({ project: { ...st.project, duration: 3, clips: [
      { id: 'tv', trackId: 'v1', title: 'rg', kind: 'video', start: 0, duration: 2, in: 0, out: 2, color: '#2563eb', sourceUrl: vid.url },
      { id: 'ta', trackId: 'a1', title: 'tone', kind: 'audio', start: 1, duration: 2, in: 0, out: 2, color: '#8b5cf6', sourceUrl: aud.url, volume: 0.8 },
    ] } })
  })
  const av = await exportOnce()
  const p2 = probe(av.file)
  const a2 = p2.streams.find((s) => s.codec_type === 'audio')
  check('Sound from A1 is in the file', !!a2 && /aac|opus/.test(a2.codec_name) && Math.abs(Number(p2.format.duration) - 3) < 0.1, `${a2?.codec_name} ${p2.format.duration}s`)
  const pixel = (t) => { const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', av.file, '-frames:v', '1', '-vf', 'format=rgb24,crop=1:1:300:540', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']); return [...r.stdout] }
  const red = pixel(0.5), green = pixel(1.5)
  const frameAt = (n) => [...spawnSync('ffmpeg', ['-v', 'error', '-i', av.file, '-vf', `select=eq(n\\,${n}),format=rgb24,crop=1:1:300:540`, '-frames:v', '1', '-f', 'rawvideo', '-']).stdout]
  const f29 = frameAt(29), f30 = frameAt(30)
  check('Frame-exact at the cut: frame 29 is still red, frame 30 is green', f29[0] > 180 && f29[1] < 80 && f30[1] > 180 && f30[0] < 80, JSON.stringify({ f29, f30 }))
  check('Footage frame at 0.5 s is the red second, at 1.5 s the green one', red[0] > 180 && red[1] < 80 && green[1] > 180 && green[0] < 80, JSON.stringify({ red, green }))
  // mean level of a stretch of the soundtrack (ffmpeg prints it on stderr; -999 when it reports none)
  const level = (ss, t) => { const r = spawnSync('ffmpeg', ['-v', 'info', '-ss', String(ss), '-t', String(t), '-i', av.file, '-af', 'volumedetect', '-f', 'null', '-']); return Number(/mean_volume: (-?[\d.]+)/.exec(String(r.stderr))?.[1] ?? -999) }
  const quiet = level(0.1, 0.7), tone = level(1.2, 1.5)
  check('The tone starts where its clip starts: silent before 1 s, audible after', (quiet === -999 || quiet < -60) && tone > -30, `before ${quiet} dB, during ${tone} dB`)
  fs.rmSync(full.file, { force: true })

  // 12. Story → video: the Story tab builds a cut from the Editorial draft; its stills are in the exported frames
  await page.evaluate(() => {
    const ed = window.__editorialStore.getState()
    ed.setDraftField('headline', 'Two new wells to add 30 MMCFD of gas to the grid')
    ed.setDraftField('deck', 'Two new wells in Sylhet are set to raise gas supply this winter.')
    ed.setDraftField('body', 'Petrobangla will drill two new wells in Sylhet this winter. The wells are expected to add 30 MMCFD to the grid.')
  })
  await page.click('.vw-bin-tabs button:has-text("Story")')
  await page.waitForSelector('.vw-story-points')
  check('Story tab previews the cut from the draft', (await page.locator('.vw-story-points li').count()) === 5, String(await page.locator('.vw-story-points li').count()))
  await page.click('.vw-story-build')
  await page.click('.vw-story-confirm button:has-text("Replace")')
  await page.waitForSelector('.vw-story-note')
  const built = await page.evaluate(() => { const p = window.__videoStore.getState().project; return { n: p.clips.length, stills: p.clips.filter((c) => c.still).length, d: p.duration } })
  check('Build story video replaces the timeline with the cut', built.stills === 3 && built.n >= 7, JSON.stringify(built))
  const sv = await exportOnce('draft')
  const top = (t) => [...spawnSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', sv.file, '-frames:v', '1', '-vf', 'format=rgb24,crop=1:1:960:40', '-f', 'rawvideo', '-']).stdout]
  const bannerPx = top(1)
  check('The banner still is in the exported frames (not the empty-footage placeholder)', bannerPx.length === 3 && bannerPx.reduce((a, b) => a + b, 0) / 3 > 150, JSON.stringify(bannerPx))

  // 12. Switch back to Graphics workspace
  await page.click('.ws-btn[data-ws="graphics"]')
  await page.waitForSelector('.topbar')
  check('Switched back to Graphics workspace', (await page.locator('.topbar').count()) === 1)

  await browser.close()
} catch (err) {
  console.error('Video E2E test error:', err)
  failed++
} finally {
  vite.kill()
  process.exit(failed > 0 ? 1 : 0)
}
