// Measures how far the Video desk's playhead moves in 3 s of wall-clock play, empty and with 60 / 200 clips (dev
// server). Used for the before → after numbers in docs/VIDEO_PRO_PROGRESS.md ("Phase 0 fix round", P1).
//   node tools/e2e/video-playback-measure.mjs            this checkout
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
    for (const n of [0, 60, 200]) console.log(JSON.stringify(await measure(page, n)))
  } finally {
    await browser?.close()
    vite?.kill()
  }
}
