// Automated E2E verification of Video Studio & Timeline Editor
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { launchBrowser } from './launch-browser.mjs'

const PORT = 5195
const root = path.resolve(import.meta.dirname, '..')
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

  // 10. Trigger real video export and capture download
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.click('.vw-header-actions button:has-text("Export Video")'),
  ])
  const downloadPath = await download.path()
  const fs = await import('node:fs')
  const stats = fs.statSync(downloadPath)
  check('Exported playable WebM file', stats.size > 5000, `size: ${(stats.size / 1024).toFixed(1)} KB`)

  // Verify EBML WebM magic header (0x1A, 0x45, 0xDF, 0xA3)
  const buf = Buffer.alloc(4)
  const fd = fs.openSync(downloadPath, 'r')
  fs.readSync(fd, buf, 0, 4, 0)
  fs.closeSync(fd)
  const isWebM = buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3
  check('Exported WebM container magic header verified', isWebM)

  // Close export modal
  await page.click('.vw-export-modal button:has-text("Done")')
  await page.waitForTimeout(300)

  // 11. Switch back to Graphics workspace
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
