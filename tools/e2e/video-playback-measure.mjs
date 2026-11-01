// Measures how far the Video desk's playhead moves in 3 s of wall-clock play, empty and with 60 / 200 clips (dev
// server). Used for the before → after numbers in docs/VIDEO_PRO_PROGRESS.md ("Phase 0 fix round", P1).
// Phase 1: `measureEngine` plays whatever is on the desk for N seconds and reads the preview engine's own count of
// frames shown exactly vs dropped (held or skipped); LAYERS=1 sets up three 1080p30 layers + text first (the
// acceptance run in tools/e2e/video-engine-test.mjs uses the same function).
//   node tools/e2e/video-playback-measure.mjs            this checkout
//   LAYERS=1 SECONDS=60 node ...                         3 × 1080p30 footage layers + a title and a caption
//   ROOT=<other checkout> PORT=5297 node ...             another checkout (its own node_modules or a junction)
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { launchBrowser } from '../launch-browser.mjs'

const root = path.resolve(process.env.ROOT || path.resolve(import.meta.dirname, '../..'))
const PORT = Number(process.env.PORT || 5296)
let vite = null
const up = async () => { for (let i = 0; i < 90; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) return } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 500)) } throw new Error('Vite did not start') }

/** Seed n clips (spread over the 4 tracks, titles and captions only, so no media decode skews it) and play 3 s. */
export async function measure(page, n, seconds = 3) {
  return page.evaluate(async ({ n, seconds }) => {
    const vs = window.__videoStore
    const st = vs.getState()
    const kinds = [['v2', 'overlay'], ['c1', 'caption'], ['v2', 'overlay'], ['c1', 'caption']]
    const clips = Array.from({ length: n }, (_, i) => {
      const [trackId, kind] = kinds[i % 4]
      const c = { id: `m${i}`, trackId, title: `Clip ${i}`, kind, start: (i % 30) * 1, duration: 4, in: 0, out: 4, color: '#2563eb' }
      return kind === 'overlay' ? { ...c, overlayType: 'lower-third', overlayText: `Name ${i}`, overlaySub: 'Role' } : { ...c, captionText: `Caption ${i}` }
    })
    vs.setState({ project: { ...st.project, duration: 60, clips }, currentTime: 0, playing: false })
    await new Promise((r) => setTimeout(r, 300))
    let updates = 0
    const off = vs.subscribe((a, b) => { if (a.currentTime !== b.currentTime) updates++ })
    const t0 = performance.now()
    vs.getState().play()
    await new Promise((r) => setTimeout(r, seconds * 1000))
    const pos = vs.getState().currentTime
    const wall = (performance.now() - t0) / 1000
    vs.getState().pause()
    off()
    return { clips: n, wall: Math.round(wall * 1000) / 1000, playhead: Math.round(pos * 1000) / 1000, ratio: Math.round((pos / wall) * 1000) / 1000, fps: Math.round(updates / wall) }
  }, { n, seconds })
}

/** Play what is on the desk for `seconds` and return the engine's frame count (exact / dropped) and the clock. */
export async function measureEngine(page, seconds) {
  return page.evaluate(async (secs) => {
    const vs = window.__videoStore
    const eng = window.__videoEngine.preview()
    const t0 = performance.now()
    vs.getState().play()
    await new Promise((r) => setTimeout(r, secs * 1000))
    const stats = eng.stats()
    const pos = vs.getState().currentTime
    vs.getState().pause()
    return { ...stats, wall: (performance.now() - t0) / 1000, playhead: pos, cacheMB: Math.round(eng.cache.used / 1048576) }
  }, seconds)
}

/** Three 1080p30 footage layers (full frame, an inset, a rotated inset) with a lower third and a caption, `seconds`
 * long, from the engine fixtures already imported into the bin. */
export async function seedLayers(page, seconds) {
  await page.evaluate((D) => {
    const st = window.__videoStore.getState()
    const find = (n) => st.mediaAssets.find((a) => a.name === n)
    const a = find('layer-a-1080p30.mp4'), b = find('layer-b-1080p30.mp4'), c = find('layer-c-1080p30.mp4')
    let p = st.project
    for (const id of ['v3', 'v4']) if (!p.tracks.some((t) => t.id === id)) { st.addTrack('video'); p = window.__videoStore.getState().project }
    const mk = (o) => ({ in: 0, color: '#2563eb', title: o.id, out: o.duration, srcDuration: 65, ...o })
    st.loadProject({ ...p, clips: [
      mk({ id: 'L1', trackId: 'v1', kind: 'video', start: 0, duration: D, sourceUrl: a.url, mediaAssetId: a.id }),
      mk({ id: 'L2', trackId: 'v3', kind: 'video', start: 0, duration: D, sourceUrl: b.url, mediaAssetId: b.id, fit: 'fit', scale: 0.45, offX: -0.25, offY: -0.22 }),
      mk({ id: 'L3', trackId: 'v4', kind: 'video', start: 0, duration: D, sourceUrl: c.url, mediaAssetId: c.id, fit: 'fit', scale: 0.35, offX: 0.28, offY: 0.25, rotation: -4 }),
      mk({ id: 'T1', trackId: 'v2', kind: 'overlay', start: 0, duration: D, overlayType: 'lower-third', overlayText: 'Playback test', overlaySub: 'তিনটি স্তর' }),
      mk({ id: 'T2', trackId: 'c1', kind: 'caption', start: 0, duration: D, captionText: 'Three 1080p layers and text' }),
    ] }, { assets: st.mediaAssets, dirty: true })
    window.__videoStore.getState().seek(0)
  }, seconds + 2)
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('video-playback-measure.mjs')) {
  let browser
  try {
    vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
    await up()
    browser = await launchBrowser(chromium)
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
    await page.goto(`http://localhost:${PORT}/`)
    await page.waitForSelector('.launch-tile')
    await page.click('.launch-tile:has-text("Video")')
    await page.waitForSelector('.video-workspace')
    if (process.env.LAYERS) {
      const { ensureEngineFixtures } = await import('../fixtures/video/engine-fixtures.mjs')
      const fx = ensureEngineFixtures(['layer-a-1080p30.mp4', 'layer-b-1080p30.mp4', 'layer-c-1080p30.mp4'])
      await page.setInputFiles('.video-workspace input[type=file][multiple]', Object.values(fx))
      await page.waitForFunction(() => window.__videoStore.getState().mediaAssets.length >= 3, null, { timeout: 120000 })
      const secs = Number(process.env.SECONDS || 60)
      await seedLayers(page, secs)
      await page.waitForTimeout(1500)
      console.log(JSON.stringify(await measureEngine(page, secs)))
    } else for (const n of [0, 60, 200]) console.log(JSON.stringify(await measure(page, n)))
  } finally {
    await browser?.close()
    vite?.kill()
  }
}
