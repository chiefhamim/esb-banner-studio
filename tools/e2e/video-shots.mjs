// Deterministic screenshot harness for the Video desk (src/video/). Captures a fixed set of states in light and
// dark at 900, 1366 and 1920 px wide, so a later build can be compared against this one with
// tools/e2e/video-shots-compare.mjs.
//
//   OUT=<dir> node tools/e2e/video-shots.mjs            all states
//   OUT=<dir> STATES=timeline,export-setup node ...     only these states
//   PORT=5291 (default)  THEMES=light,dark  WIDTHS=900,1366,1920
//
// It starts its own Vite dev server on PORT with --strictPort and stops only that server; if something already
// answers on PORT it exits instead of using it (another checkout's server would mean screenshots of other code).
// Seed data goes in through the dev store handles (window.__videoStore, __editorialStore, __store) with synthetic
// media made by ffmpeg (a test pattern, a gradient still, a sine tone); every word on screen that the harness
// supplies is a neutral placeholder. Each state gets a fresh browser context (clean localStorage), reduced motion,
// a fixed clock (Date), animations disabled in the screenshot, and waits for fonts, images and video decode before the shot.
// A state the build cannot reach is logged "n/a" and recorded in manifest.json; the harness carries on.
// Files: <state>__<theme>__<width>.png and manifest.json in OUT.
import { chromium } from 'playwright-core'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchBrowser } from '../launch-browser.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const PORT = Number(process.env.PORT || 5291)
const OUT = process.env.OUT
if (!OUT) { console.error('usage: OUT=<dir> [STATES=a,b] [PORT=5291] node tools/e2e/video-shots.mjs'); process.exit(2) }
const outDir = path.resolve(OUT)
fs.mkdirSync(outDir, { recursive: true })
const list = (v, d) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : d)
const THEMES = list(process.env.THEMES, ['light', 'dark'])
const WIDTHS = list(process.env.WIDTHS, ['900', '1366', '1920']).map(Number)
const heightFor = (w) => (w === 1366 ? 768 : 900)
const BASE = `http://localhost:${PORT}/`

// ------------------------------------------------------------------ synthetic media (cached, deterministic)
const mediaDir = path.join(os.tmpdir(), 'esb-video-shots-media-v2')
const MEDIA = {
  clip: path.join(mediaDir, 'sample-clip.mp4'),
  still: path.join(mediaDir, 'sample-still.png'),
  tone: path.join(mediaDir, 'sample-tone.wav'),
}
function makeMedia() {
  fs.mkdirSync(mediaDir, { recursive: true })
  const ff = (args, out) => {
    if (fs.existsSync(out) && fs.statSync(out).size > 0) return true
    const r = spawnSync('ffmpeg', ['-y', '-v', 'error', ...args, out])
    if (r.status !== 0) { console.warn('ffmpeg failed for', path.basename(out), String(r.stderr || r.error)); return false }
    return true
  }
  // 6 s test pattern, every frame a key frame so a seek lands on the exact frame, WITH real sound: the committed
  // speech-like fixture's audio (silence for 1 s, then a voice), so the bin's "sound" fact, the linked A1 clip and
  // its waveform are all true
  const speech = path.join(root, 'tools', 'fixtures', 'video', 'speech-6s.mp4')
  const okClip = fs.existsSync(speech)
    ? ff(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=6', '-i', speech, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '1', '-bf', '0', '-c:a', 'aac', '-b:a', '96k', '-shortest'], MEDIA.clip)
    : ff(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '1', '-bf', '0', '-an'], MEDIA.clip)
  const okStill = ff(['-f', 'lavfi', '-i', 'gradients=size=1600x900:seed=7:nb_colors=3:type=linear:duration=1', '-frames:v', '1'], MEDIA.still)
  const okTone = ff(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=8', '-c:a', 'pcm_s16le'], MEDIA.tone)
  // fall back to the checked-in fixtures if ffmpeg is missing
  const fx = path.join(root, 'tools', 'fixtures', 'media')
  if (!okClip) MEDIA.clip = path.join(fx, 'red-green-2s.mp4')
  if (!okStill) MEDIA.still = path.join(fx, 'synthetic-rig.jpg')
  if (!okTone) MEDIA.tone = path.join(fx, 'tone-440-2s.wav')
}

// ------------------------------------------------------------------ dev server (ours only)
const alive = async () => { try { return (await fetch(BASE)).ok } catch { return false } }
let vite = null
async function startServer() {
  if (await alive()) throw new Error(`port ${PORT} is already serving something; not reusing a server this harness did not start. Set PORT=<free port>.`)
  vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
  let exited = false
  vite.on('exit', () => { exited = true })
  for (let i = 0; i < 120; i++) {
    if (exited) throw new Error(`Vite exited before answering on ${PORT} (port busy?)`)
    if (await alive()) return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('Vite did not start')
}
function stopServer() { try { vite?.kill() } catch { /* already gone */ } }

// ------------------------------------------------------------------ page helpers
class NA extends Error {}
const na = (why) => { throw new NA(why) }

async function openVideo(page) {
  await page.goto(BASE)
  const tile = page.locator('.launch-tile:has-text("Video")')
  await Promise.race([tile.first().waitFor({ timeout: 30000 }), page.locator('.ws-btn[data-ws="video"]').first().waitFor({ timeout: 30000 })])
  if (await tile.count()) await tile.first().click()
  else await page.click('.ws-btn[data-ws="video"]')
  await page.waitForSelector('.video-workspace', { timeout: 30000 })
  if (!(await page.evaluate(() => !!window.__videoStore))) na('window.__videoStore dev handle missing')
  // neutral text for anything the Graphics doc lends the Video desk (the story banner)
  await page.evaluate(() => { try { window.__store?.getState().setContent({ headline: 'Sample headline', credit: '' }) } catch { /* optional */ } })
}

async function importMedia(page) {
  const input = page.locator('.video-workspace input[type=file][multiple]')
  if (!(await input.count())) na('no media import input')
  // The bin grabs the footage thumbnail on 'seeked', which sometimes fires before the frame is decoded and leaves a
  // black thumbnail (a real intermittent bug in the import path). For stable shots, re-import until it is not black
  // (up to 4 tries); the retries are recorded in the manifest note.
  for (let attempt = 0; attempt < 4; attempt++) {
    await input.first().setInputFiles([MEDIA.clip, MEDIA.still, MEDIA.tone])
    await page.waitForFunction(() => window.__videoStore.getState().mediaAssets.length >= 3, null, { timeout: 15000 })
    const dark = await page.evaluate(async () => {
      const v = window.__videoStore.getState().mediaAssets.find((a) => a.type === 'video')
      if (!v?.thumbnailUrl) return false
      const img = new Image(); img.src = v.thumbnailUrl; await img.decode().catch(() => {})
      const c = document.createElement('canvas'); c.width = 16; c.height = 9
      const x = c.getContext('2d'); x.drawImage(img, 0, 0, 16, 9)
      const d = x.getImageData(0, 0, 16, 9).data; let sum = 0
      for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2]
      return sum / (d.length / 4) / 3 < 12
    })
    if (!dark) return attempt
    await page.evaluate(() => { const st = window.__videoStore.getState(); for (const a of [...st.mediaAssets]) st.removeMediaAsset(a.id) })
    await page.locator('.video-workspace input[type=file][multiple]').first().setInputFiles([])
  }
  return 4
}

/** The fixed project used by most states: footage + still on V1, two overlays on V2, a caption on C1, tone on A1. */
let thumbRetries = 0
async function seedTimeline(page, { playhead = 1.0, select = null, zoom = null, extra = null } = {}) {
  thumbRetries = await importMedia(page)
  await page.evaluate(({ playhead, select, zoom, extra }) => {
    const vs = window.__videoStore
    const st = vs.getState()
    const a = st.mediaAssets
    const vid = a.find((x) => x.type === 'video'), img = a.find((x) => x.type === 'image'), aud = a.find((x) => x.type === 'audio')
    const clips = [
      { id: 'shot-v1', trackId: 'v1', title: 'Sample clip', kind: 'video', start: 0, duration: 6, in: 0, out: 6, color: '#2563eb', sourceUrl: vid?.url, mediaAssetId: vid?.id, thumbnailUrl: vid?.thumbnailUrl },
      { id: 'shot-v1-still', trackId: 'v1', title: 'Sample still', kind: 'video', start: 6, duration: 4, in: 0, out: 4, color: '#2563eb', sourceUrl: img?.url, mediaAssetId: img?.id, still: true, kenBurns: 'in' },
      { id: 'shot-ov-lt', trackId: 'v2', title: 'Sample name', kind: 'overlay', start: 0.5, duration: 4, in: 0, out: 4, color: '#10b981', overlayType: 'lower-third', overlayText: 'Sample name', overlaySub: 'Sample title' },
      { id: 'shot-ov-hl', trackId: 'v2', title: 'Sample headline', kind: 'overlay', start: 5, duration: 4, in: 0, out: 4, color: '#ef4444', overlayType: 'headline', overlayText: 'Sample headline', overlaySub: 'Sample subhead' },
      { id: 'shot-cap', trackId: 'c1', title: 'Caption', kind: 'caption', start: 0.5, duration: 4.5, in: 0, out: 4.5, color: '#f59e0b', captionText: 'Sample caption text' },
      { id: 'shot-a1', trackId: 'a1', title: 'Sample tone', kind: 'audio', start: 0, duration: 8, in: 0, out: 8, color: '#8b5cf6', sourceUrl: aud?.url, mediaAssetId: aud?.id, volume: 0.8 },
    ]
    if (extra === 'linked') {
      // the footage and its own sound (the clip file's audio track: a voice after 1 s), linked, as an import makes them
      clips[0] = { ...clips[0], linkId: 'link-shot' }
      clips[5] = { ...clips[5], duration: 6, out: 6, linkId: 'link-shot', title: 'Sample clip · sound', sourceUrl: vid?.url, mediaAssetId: vid?.id, volume: 1 }
    }
    if (extra === 'multi-track') {
      // timeline v2: a second footage track over V1 (a picture in picture), a text track with a title
      st.addTrack('video')
      st.addTrack('text')
      clips.push({ id: 'shot-v3', trackId: 'v3', title: 'Sample clip (inset)', kind: 'video', start: 1, duration: 5, in: 0, out: 5, color: '#0ea5e9', sourceUrl: vid?.url, mediaAssetId: vid?.id, fit: 'fit', scale: 0.38, offX: 0.27, offY: -0.25, rotation: -3 })
      clips.push({ id: 'shot-t1', trackId: 't1', title: 'Card', kind: 'overlay', start: 6.5, duration: 3, in: 0, out: 3, color: '#7c3aed', overlayType: 'card', overlayText: 'Sample card title', overlaySub: 'Sample card text' })
    }
    if (extra === 'many-tracks') {
      // more tracks than the timeline shows: three extra footage tracks with an inset each, and an extra sound track
      for (let k = 0; k < 3; k++) st.addTrack('video')
      st.addTrack('text')
      st.addTrack('audio')
      const ids = window.__videoStore.getState().project.tracks.map((t) => t.id)
      for (const id of ids.filter((x) => /^v[3-9]$/.test(x))) clips.push({ id: `shot-${id}`, trackId: id, title: `Inset on ${id.toUpperCase()}`, kind: 'video', start: 1 + Number(id.slice(1)) * 0.5, duration: 3, in: 0, out: 3, color: '#0ea5e9', sourceUrl: vid?.url, mediaAssetId: vid?.id, fit: 'fit', scale: 0.3, offX: 0.3, offY: -0.3 })
      const a2 = ids.find((x) => x === 'a2')
      if (a2) clips.push({ id: 'shot-a2', trackId: a2, title: 'Sample tone (A2)', kind: 'audio', start: 2, duration: 6, in: 0, out: 6, color: '#8b5cf6', sourceUrl: aud?.url, mediaAssetId: aud?.id, volume: 0.6 })
    }
    if (extra === 'empty-card') clips.push({ id: 'shot-card', trackId: 'v2', title: 'Text card', kind: 'overlay', start: 9.2, duration: 2.5, in: 0, out: 2.5, color: '#7c3aed', overlayType: 'card', overlayText: '', overlaySub: '' })
    st.loadProject({ ...vs.getState().project, name: 'Sample project', duration: 12, clips }, { dirty: true })
    if (extra === 'missing') {
      // the footage file is gone: its bin row says so with Relink, its clip is offline
      vs.setState((s) => ({ mediaAssets: s.mediaAssets.map((x) => (x.type === 'video' ? { ...x, missing: true, url: '', path: 'C:\\Footage\\sample-clip.mp4' } : x)), project: { ...s.project, clips: s.project.clips.map((c) => (c.mediaAssetId === vid?.id ? { ...c, sourceUrl: undefined } : c)) } }))
    }
    const s2 = vs.getState()
    if (zoom != null) s2.setZoom(zoom)
    if (select) s2.selectClip(select)
    s2.seek(playhead)
  }, { playhead, select, zoom, extra })
}

async function clickTab(page, label) {
  const bin = page.locator('.vw-bin-panel')
  let tab = bin.getByRole('tab', { name: label, exact: true })
  if (!(await tab.count())) tab = page.getByRole('tab', { name: label, exact: true })
  if (!(await tab.count())) na(`no "${label}" tab`)
  await tab.first().click()
}

/** Fonts, images and video decode, then a forced redraw of the monitor at the same playhead. */
async function settle(page) {
  await page.mouse.move(1, 1)
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all([...document.images].map((im) => (im.complete ? null : new Promise((r) => { im.onload = im.onerror = r; setTimeout(r, 3000) }))))
  })
  // the compositor seeks its own <video> elements; give them time to decode, then nudge the playhead so it redraws
  for (let k = 0; k < 3; k++) {
    await page.waitForTimeout(350)
    await page.evaluate(async () => {
      const vs = window.__videoStore
      if (!vs) return
      const t = vs.getState().currentTime
      vs.getState().seek(t + 1e-6)
      await new Promise((r) => requestAnimationFrame(() => r()))
      vs.getState().seek(t)
      window.dispatchEvent(new Event('esb:video-media-ready'))
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    })
  }
  await page.evaluate(() => document.fonts.ready)
  // the lane canvas has drawn every waveform and filmstrip it is reading (real ones, decoded from the files)
  await page.waitForFunction(() => { const c = document.querySelector('.vw-lane-visuals'); return !c || c.dataset.pending === '0' || c.dataset.pending === undefined }, null, { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(150)
}

// ------------------------------------------------------------------ states
// each returns { el?: Locator, note?: string } after putting the page into the state; throw na() if unreachable
const tabState = (label, seed = true) => async (page) => {
  if (seed) await seedTimeline(page)
  await clickTab(page, label)
  return {}
}
/** The bin with Phase 1 metadata (src/video/BinCard.tsx): wait for the media pipeline to read the real facts of the
 * imported files, then seed the proxy / folder / found-again state through the dev handle `window.__videoMeta`. The
 * footage is presented as a 4K file (the synthetic clip is 1280×720) so the proxy rows read as they would. */
async function seedBin(page, { extra = null, video = {}, folder = false, found = false, uhd = true } = {}) {
  await seedTimeline(page, { extra })
  await page.waitForFunction(() => {
    const st = window.__videoStore.getState()
    return st.mediaAssets.filter((a) => a.url && !a.missing && a.type !== 'image').every((a) => window.__videoMedia?.meta(a.id)?.analyzedUrl === a.url)
  }, null, { timeout: 15000 }).catch(() => {})
  const ok = await page.evaluate(({ video, folder, found, uhd }) => {
    if (!window.__videoMeta) return false
    const vs = window.__videoStore
    const vid = vs.getState().mediaAssets.find((x) => x.type === 'video')
    if (!vid) return false
    if (uhd) vs.setState((s) => ({ mediaAssets: s.mediaAssets.map((x) => (x.id === vid.id ? { ...x, name: 'sample-4k.mp4', width: 3840, height: 2160, size: 34e6 } : x)) }))
    window.__videoMeta.setState((s) => ({
      folder: folder ? { id: '0'.repeat(32), path: String.raw`C:\Users\Editor\Pictures\ESB Banners\Video\Sample project.esbvideo` } : s.folder,
      byId: { ...s.byId, [vid.id]: { ...s.byId[vid.id], analyzedUrl: vid.url || 'x', ...video } },
      found: found ? { [vid.id]: { path: String.raw`C:\Footage\day2\sample-4k.mp4`, name: 'sample-4k.mp4', size: 1, mtimeMs: 0, url: '' } } : {},
    }))
    return true
  }, { video, folder, found, uhd })
  if (!ok) na('window.__videoMeta dev handle missing')
  await clickTab(page, 'Media')
  return {}
}

const STATES = {
  empty: async (page) => {
    const newBtn = page.locator('.vw-header button', { hasText: /^\s*New( project)?\s*$/i })
    if (await newBtn.count()) { await newBtn.first().click(); await page.waitForTimeout(200); const ok = page.locator('.dialog button', { hasText: /discard|new|ok/i }); if (await ok.count()) await ok.first().click(); return { note: 'via New button' } }
    await page.evaluate(() => { const st = window.__videoStore.getState(); st.loadProject({ ...st.project, name: 'Sample project', clips: [] }) })
    return { note: 'no New action in this build: emptied via store' }
  },
  // the start screen is `empty`; the old `demo-default` (the desk as it opened) is the same screen since Phase 0
  'restore-card': async (page) => {
    // a snapshot left by a session that did not save: leave the desk and come back, and the card offers it
    await page.evaluate(() => {
      const text = JSON.stringify({ id: 'proj-shot', name: 'Sample unsaved video', aspect: '16:9', width: 1920, height: 1080, fps: 30, duration: 30, tracks: [{ id: 'v2', name: 'V2', kind: 'overlay', muted: false, locked: false }], clips: [{ id: 'c1', trackId: 'v2', title: 'Lower third', kind: 'overlay', start: 0, duration: 4, in: 0, out: 4, color: '#10b981', overlayType: 'lower-third', overlayText: 'Sample name', overlaySub: '' }] })
      localStorage.setItem('esb-banner-studio/video-autosave/v1', JSON.stringify([{ at: Date.now(), text, id: 'proj-shot' }]))
    })
    await page.click('.vw-header .ws-btn[data-ws="graphics"]')
    await page.waitForSelector('.app > .topbar')
    await page.click('.topbar .ws-btn[data-ws="video"]')
    await page.waitForSelector('.vw-restore-card', { timeout: 8000 }).catch(() => na('no restore card'))
    return {}
  },
  'new-confirm': async (page) => {
    await seedTimeline(page)
    await page.click('.vw-new')
    await page.waitForSelector('.dialog[aria-label="Start a new video?"]')
    await waitAnimations(page)
    return { note: 'after the dialog open animation finished' }
  },
  'missing-media': async (page) => { await seedTimeline(page, { extra: 'missing' }); return {} },
  'linked-clip': async (page) => { await seedTimeline(page, { select: 'shot-v1', extra: 'linked' }); return {} },
  'empty-card': async (page) => { await seedTimeline(page, { select: 'shot-card', extra: 'empty-card', playhead: 10 }); return {} },
  timeline: async (page) => { await seedTimeline(page, { playhead: 1.0 }); return {} },
  'inspector-video': async (page) => { await seedTimeline(page, { select: 'shot-v1' }); if (!(await page.locator('.vw-inspector').count())) na('no inspector shown'); return {} },
  'inspector-overlay': async (page) => { await seedTimeline(page, { select: 'shot-ov-lt' }); if (!(await page.locator('.vw-inspector').count())) na('no inspector shown'); return {} },
  'inspector-audio': async (page) => { await seedTimeline(page, { select: 'shot-a1' }); if (!(await page.locator('.vw-inspector').count())) na('no inspector shown'); return {} },
  // ('tab-media' was the same picture as 'timeline': the Media tab is the desk's default)
  // Phase 1 bin states (metadata line, proxy badge + progress, missing / found again, link-or-copy on import)
  'bin-normal': async (page) => seedBin(page, { uhd: false }),
  'bin-proxy-pending': async (page) => seedBin(page, { folder: true, video: { codec: 'avc1.640033', fps: 29.97, keyframeInterval: 2, proxyNeeded: true, proxy: 'pending', proxyProgress: 0.42 } }),
  'bin-proxy-0': async (page) => seedBin(page, { folder: true, video: { codec: 'avc1.640033', fps: 29.97, keyframeInterval: 2, proxyNeeded: true, proxy: 'pending', proxyProgress: 0 } }),
  'bin-proxy-99': async (page) => seedBin(page, { folder: true, video: { codec: 'avc1.640033', fps: 29.97, keyframeInterval: 2, proxyNeeded: true, proxy: 'pending', proxyProgress: 0.99 } }),
  'bin-proxy-ready': async (page) => seedBin(page, { folder: true, video: { codec: 'hvc1.1.6.L153', fps: 25, keyframeInterval: 1, proxyNeeded: true, proxy: 'ready', proxyUrl: 'esb-media://p/x/proxies/x.mp4', storage: 'copy', file: 'media/sample-4k.mp4' } }),
  'bin-proxy-failed': async (page) => seedBin(page, { video: { codec: 'avc1.640033', fps: 30, keyframeInterval: 3, proxyNeeded: true, proxy: 'failed', proxyError: 'This file cannot be converted here' } }),
  'bin-proxy-cancelled': async (page) => seedBin(page, { video: { codec: 'avc1.640033', fps: 30, keyframeInterval: 3, proxyNeeded: true, proxy: 'none', proxyCancelled: true } }),
  'bin-missing': async (page) => seedBin(page, { extra: 'missing', uhd: false }),
  'bin-missing-found': async (page) => seedBin(page, { extra: 'missing', uhd: false, found: true }),
  'tab-overlays': tabState('Overlays'),
  'tab-captions': tabState('Captions'),
  'tab-audio': tabState('Audio'),
  'tab-story': async (page) => {
    await seedTimeline(page)
    await seedDraft(page)
    await clickTab(page, 'Story')
    return {}
  },
  'story-built': async (page) => {
    await seedTimeline(page)
    await seedDraft(page)
    await clickTab(page, 'Story')
    const build = page.locator('.vw-story-build, button:has-text("Build story video")')
    if (!(await build.count())) na('no Build story video button')
    await build.first().click()
    const replace = page.locator('.vw-story-confirm button:has-text("Replace")')
    if (await replace.count()) await replace.first().click()
    await page.waitForFunction(() => window.__videoStore.getState().project.clips.some((c) => String(c.id).startsWith('story-')), null, { timeout: 20000 })
    await page.waitForSelector('.vw-story-note', { timeout: 5000 }).catch(() => {})
    await page.evaluate(() => window.__videoStore.getState().seek(1.0))
    return {}
  },
  'export-setup': async (page) => {
    await seedTimeline(page)
    const btn = page.locator('.vw-header button', { hasText: /Export/ })
    if (!(await btn.count())) na('no Export button')
    await btn.first().click()
    const sheet = page.locator('.vx, [role=dialog]')
    await sheet.first().waitFor({ timeout: 5000 }).catch(() => na('export sheet did not open'))
    // the encoder probe enables the go button; wait for it so the setup step is in its final form
    await page.waitForFunction(() => { const b = document.querySelector('.vx-go'); return !b || !b.disabled }, null, { timeout: 8000 }).catch(() => {})
    return {}
  },
  'monitor-0.5': async (page) => { await seedTimeline(page, { playhead: 0.5 }); return { el: page.locator('.vw-canvas').first() } },
  'monitor-3.0': async (page) => { await seedTimeline(page, { playhead: 3.0 }); return { el: page.locator('.vw-canvas').first() } },
  'timeline-zoomed': async (page) => { await seedTimeline(page, { playhead: 1.0, zoom: 120 }); return {} },
  'multi-track': async (page) => { await seedTimeline(page, { playhead: 2.0, extra: 'multi-track' }); return {} },
  // footage with its own (real) sound: the linked A1 clip's waveform is the file's audio
  'waveform-lane': async (page) => { await seedTimeline(page, { playhead: 1.0, zoom: 160, extra: 'linked' }); return { el: page.locator('.vw-timeline-footer').first() } },
  // more tracks than fit: the lanes scrolled to the bottom (headers level with lanes, the ruler pinned on top)
  'tracks-scrolled': async (page) => {
    await seedTimeline(page, { playhead: 2.0, extra: 'many-tracks' })
    await page.evaluate(() => { const sc = document.querySelector('.vw-tracks-scroll'); sc.scrollTop = sc.scrollHeight })
    return {}
  },
  // the same, unscrolled: the "N more tracks" chip at the foot of the headers
  'tracks-below': async (page) => { await seedTimeline(page, { playhead: 2.0, extra: 'many-tracks' }); return {} },
  'add-track-menu': async (page) => {
    await seedTimeline(page)
    await page.click('.vw-add-track')
    await page.waitForSelector('.menu .menu-item:has-text("Text track")')
    await waitAnimations(page)
    return {}
  },
  'track-menu': async (page) => {
    await seedTimeline(page, { extra: 'multi-track' })
    await page.click('.vw-track-head[data-track-id="v3"] .vw-th-more')
    await page.waitForSelector('.menu .menu-item:has-text("Remove track")')
    await waitAnimations(page)
    return {}
  },
  'track-removed': async (page) => {
    await seedTimeline(page, { extra: 'multi-track' })
    await page.click('.vw-track-head[data-track-id="v3"] .vw-th-more')
    await page.click('.menu .menu-item:has-text("Remove track")')
    return { note: 'V3 and its clip removed (Ctrl+Z brings it back)' }
  },
}

/** The timeline's geometry: every track header level with its lane (±1 px), the ruler on screen. */
async function timelineGeometry(page) {
  return page.evaluate(() => {
    const scroller = document.querySelector('.vw-tracks-scroll')
    if (!scroller) return null
    const problems = []
    const sb = scroller.getBoundingClientRect()
    for (const h of document.querySelectorAll('.vw-track-head[data-track-id]')) {
      const lane = document.querySelector(`.vw-track-lane[data-track-id="${h.dataset.trackId}"]`)
      if (!lane) { problems.push(`${h.dataset.trackId}: no lane`); continue }
      const a = h.getBoundingClientRect(), b = lane.getBoundingClientRect()
      if (Math.abs(a.top - b.top) > 1 || Math.abs(a.height - b.height) > 1) problems.push(`${h.dataset.trackId}: header ${Math.round(a.top)}+${Math.round(a.height)} vs lane ${Math.round(b.top)}+${Math.round(b.height)}`)
    }
    const ruler = document.querySelector('.vw-ruler')?.getBoundingClientRect()
    if (!ruler || ruler.bottom <= sb.top + 1 || ruler.top < sb.top - 1) problems.push('ruler not on screen')
    const below = [...document.querySelectorAll('.vw-track-head[data-track-id]')].filter((h) => h.getBoundingClientRect().top >= sb.bottom - 2).length
    return { problems, scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight, tracksBelow: below }
  }).catch(() => null)
}

/** Every running CSS/Web animation on the page has finished (a dialog's open fade, a sliding chip). */
async function waitAnimations(page) {
  await page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => r()))
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null)))
  })
}

async function seedDraft(page) {
  const ok = await page.evaluate(() => {
    const ed = window.__editorialStore?.getState()
    if (!ed?.setDraftField) return false
    ed.setDraftField('headline', 'Sample headline for a story video')
    ed.setDraftField('deck', 'This is a sample deck sentence for the story video.')
    ed.setDraftField('body', 'This is the first sample sentence of the body text. This is the second sample sentence of the body text.')
    return true
  })
  if (!ok) na('window.__editorialStore dev handle missing')
}

// ------------------------------------------------------------------ run
const wanted = list(process.env.STATES, Object.keys(STATES))
const unknown = wanted.filter((s) => !STATES[s])
if (unknown.length) { console.error('unknown states:', unknown.join(', '), '\nknown:', Object.keys(STATES).join(', ')); process.exit(2) }

const manifest = []
let browser
let errors = 0
try {
  makeMedia()
  await startServer()
  browser = await launchBrowser(chromium)
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      for (const state of wanted) {
        // the monitor is drawn the same in both themes (it is always dark): shoot it in the first theme only
        if (state.startsWith('monitor-') && theme !== THEMES[0]) continue
        const file = `${state}__${theme}__${width}.png`
        const ctx = await browser.newContext({ viewport: { width, height: heightFor(width) }, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: theme, acceptDownloads: true })
        // a fixed wall clock: the story banner prints today's date, and nothing else should change between runs
        await ctx.clock.setFixedTime(new Date('2026-01-15T10:00:00+06:00'))
        await ctx.addInitScript((th) => {
          try { localStorage.setItem('esb-banner-studio/theme', th) } catch { /* ignore */ }
          document.addEventListener('DOMContentLoaded', () => { document.documentElement.dataset.theme = th })
        }, theme)
        const page = await ctx.newPage()
        page.setDefaultTimeout(15000)
        const pageErrors = []
        thumbRetries = 0
        page.on('pageerror', (e) => pageErrors.push(String(e.message || e)))
        let entry = { state, theme, width, file, ok: false, note: '' }
        try {
          await openVideo(page)
          await page.evaluate((th) => { if (window.__store?.getState().theme !== th) window.__store?.getState().setTheme(th) }, theme)
          const r = (await STATES[state](page)) || {}
          await settle(page)
          await waitAnimations(page)
          const geo = await timelineGeometry(page)
          const opts = { path: path.join(outDir, file), animations: 'disabled', caret: 'hide' }
          if (r.el) await r.el.screenshot(opts)
          else await page.screenshot(opts)
          entry = { ...entry, ok: true, geometry: geo, note: [r.note, geo?.problems?.length ? `TIMELINE: ${geo.problems.join(', ')}` : '', thumbRetries ? `black bin thumbnail on import, re-imported ${thumbRetries}x` : '', pageErrors.length ? `page errors: ${pageErrors.join(' | ')}` : ''].filter(Boolean).join('; ') }
          console.log(`ok   ${file}${entry.note ? '  (' + entry.note + ')' : ''}`)
        } catch (e) {
          if (e instanceof NA) {
            entry = { ...entry, ok: 'n/a', note: e.message }
            console.log(`n/a  ${file}  (${e.message})`)
          } else {
            errors++
            entry = { ...entry, ok: false, note: String(e?.message || e).split('\n')[0] }
            console.log(`FAIL ${file}  (${entry.note})`)
          }
        }
        manifest.push(entry)
        await ctx.close()
      }
    }
  }
} catch (e) {
  console.error('video-shots error:', e?.message || e)
  errors++
} finally {
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ port: PORT, created: new Date().toISOString(), shots: manifest }, null, 2))
  await browser?.close().catch(() => {})
  stopServer()
  const ok = manifest.filter((m) => m.ok === true).length, nas = manifest.filter((m) => m.ok === 'n/a').length
  console.log(`\n${ok} shots, ${nas} n/a, ${errors} failed → ${outDir}`)
  process.exit(errors ? 1 : 0)
}
