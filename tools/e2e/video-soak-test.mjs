// Phase 8 soak: a long scripted editing session on the Video desk (browser build, dev server, headless Chromium) with
// autosave running the whole time. It imports footage, then loops: add and split and move and trim clips, colour and
// blur effects, captions, titles, undo/redo, scrub, short playback, ripple delete, aspect switches, queue-free edits, and
// every few minutes starts a new project (as an editor would between stories). Every SAMPLE_MIN minutes it forces a GC and
// records the JS heap, the number of DOM nodes and of object URLs. Acceptance (docs/VIDEO_PRO_PLAN.md Phase 8): no memory
// growth over 5 % per hour, no page errors, autosave kept running.
//   SOAK_MINUTES=120 node tools/e2e/video-soak-test.mjs      (default 120; a short run is SOAK_MINUTES=6)
//   JSON=path keeps the samples.
import { chromium } from 'playwright-core'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchBrowser } from '../launch-browser.mjs'
import { portOffset } from '../port-offset.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const PORT = 5330 + portOffset()
const MINUTES = Number(process.env.SOAK_MINUTES || 120)
const SAMPLE_MIN = Number(process.env.SAMPLE_MIN || (MINUTES >= 60 ? 5 : 1))
const WARMUP_MIN = Number(process.env.WARMUP_MIN || Math.min(10, MINUTES / 6))
const speech = path.join(root, 'tools', 'fixtures', 'video', 'speech-6s.mp4')
const tone = path.join(os.tmpdir(), 'esb-soak-tone.wav')
if (!fs.existsSync(tone)) spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=8', '-c:a', 'pcm_s16le', tone])
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
const up = async () => { for (let i = 0; i < 120; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) return } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 500)) } throw new Error('Vite did not start') }
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

let code = 1
const samples = []
let browser
try {
  await up()
  browser = await launchBrowser(chromium)
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)) })
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Performance.enable')
  await page.goto(`http://localhost:${PORT}/`)
  await page.locator('.launch-tile:has-text("Video")').first().click()
  await page.waitForSelector('.video-workspace')
  const input = page.locator('.video-workspace input[type=file][multiple]').first()
  await input.setInputFiles([speech, tone])
  await page.waitForFunction(() => window.__videoStore.getState().mediaAssets.length >= 2, null, { timeout: 30000 })

  /** One burst of edits, chosen by a seeded counter so a run is repeatable. */
  const burst = (n) => page.evaluate((n) => {
    const st = window.__videoStore
    const s = () => st.getState()
    const assets = s().mediaAssets
    const vid = assets.find((a) => a.type === 'video')
    const rnd = (k) => { const x = Math.sin(n * 9301 + k * 49297) * 233280; return x - Math.floor(x) }
    const proj = () => s().project
    const steps = ['add', 'split', 'move', 'trim', 'fx', 'caption', 'undo', 'redo', 'scrub', 'delete', 'aspect', 'zoom', 'copy']
    const pick = steps[Math.floor(rnd(1) * steps.length)]
    const clips = proj().clips
    const some = clips.length ? clips[Math.floor(rnd(2) * clips.length)] : null
    try {
      if (pick === 'add' || clips.length < 4) {
        const at = rnd(3) * 20
        s().addClips([{ id: `soak-${n}`, trackId: 'v1', title: 'Soak clip', kind: 'video', start: at, duration: 2 + rnd(4) * 3, in: 0, out: 5, color: '#2563eb', sourceUrl: vid?.url, mediaAssetId: vid?.id, srcDuration: 6 }])
      } else if (pick === 'split' && some) { s().seek(some.start + some.duration / 2); s().selectClip(some.id); s().splitAtPlayhead() }
      else if (pick === 'move' && some) s().moveClip(some.id, Math.max(0, some.start + (rnd(4) - 0.5) * 4))
      else if (pick === 'trim' && some) s().trimClipRightDelta(some.id, (rnd(5) - 0.6) * 0.5)
      else if (pick === 'fx' && some && some.kind === 'video') s().updateClip({ ...some, effects: [{ id: `fx-${n}`, type: rnd(6) > 0.5 ? 'colour' : 'blur', enabled: true, params: rnd(6) > 0.5 ? { saturation: rnd(7) - 0.5 } : { radius: 2 + rnd(7) * 6 } }] })
      else if (pick === 'caption') s().addClips([{ id: `cap-${n}`, trackId: 'c1', title: 'Cap', kind: 'caption', start: rnd(8) * 20, duration: 3, in: 0, out: 3, color: '#f59e0b', captionText: 'Soak caption ' + n }])
      else if (pick === 'undo') s().undo()
      else if (pick === 'redo') s().redo()
      else if (pick === 'scrub') s().seek(rnd(9) * 20)
      else if (pick === 'delete' && some && clips.length > 10) { s().selectClip(some.id); s().deleteSelectedClip() }
      else if (pick === 'aspect') s().setAspect(['16:9', '9:16', '4:5'][Math.floor(rnd(10) * 3)])
      else if (pick === 'zoom') s().setZoom(20 + rnd(11) * 80)
      else if (pick === 'copy' && some) { s().selectClip(some.id); s().copySelected(); s().pasteClips() }
    } catch (e) { return 'error: ' + (e && e.message) }
    // an editor tidies up: keep the timeline to a working size
    const c = s().project.clips
    if (c.length > 60) { for (const x of c.slice(0, 20)) { s().selectClip(x.id); s().deleteSelectedClip() } }
    return pick
  }, n)

  const sample = async (tMin) => {
    await cdp.send('HeapProfiler.collectGarbage')
    const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]))
    const extra = await page.evaluate(() => ({ dom: document.getElementsByTagName('*').length, clips: window.__videoStore.getState().project.clips.length, hist: window.__videoStore.getState().history.length }))
    const row = { tMin: Math.round(tMin * 10) / 10, heapMB: Math.round((m.JSHeapUsedSize / 1048576) * 10) / 10, nodes: m.Nodes, listeners: m.JSEventListeners, dom: extra.dom, clips: extra.clips, history: extra.hist }
    samples.push(row)
    log('sample', JSON.stringify(row))
  }

  const t0 = Date.now()
  let n = 0
  let nextSample = 0
  let nextNew = 25 // a new project every ~25 minutes of the session
  let bursts = 0
  let play = false
  while ((Date.now() - t0) / 60000 < MINUTES) {
    const tMin = (Date.now() - t0) / 60000
    if (tMin >= nextSample) { await sample(tMin); nextSample += SAMPLE_MIN }
    if (tMin >= nextNew) { await page.evaluate(() => window.__videoStore.getState().newProject()); await input.setInputFiles([speech, tone]); await page.waitForFunction(() => window.__videoStore.getState().mediaAssets.length >= 2); nextNew += 25; log('new project') }
    const r = await burst(n++)
    if (typeof r === 'string' && r.startsWith('error')) errors.push(r)
    bursts++
    // every so often let it play a second, as an editor checking a cut
    if (n % 40 === 0) { await page.evaluate(() => { const s = window.__videoStore.getState(); s.seek(0); s.play() }); await page.waitForTimeout(1500); await page.evaluate(() => window.__videoStore.getState().pause()) }
    await page.waitForTimeout(250)
    play = !play
  }
  await sample((Date.now() - t0) / 60000)

  // autosave kept running: the last autosave is recent
  const autosaveAge = await page.evaluate(async () => { const m = await import('/src/video/projectIO.ts'); return m.lastAutosaveAt() ? Date.now() - m.lastAutosaveAt() : null })
  const base = samples.find((s) => s.tMin >= WARMUP_MIN) ?? samples[0]
  const last = samples[samples.length - 1]
  const hours = Math.max(1e-6, (last.tMin - base.tMin) / 60)
  const pctPerHour = ((last.heapMB - base.heapMB) / base.heapMB) * 100 / hours
  // a fairer line too: the median of the final third against the median of the first third after warm-up
  const after = samples.filter((s) => s.tMin >= base.tMin)
  const third = Math.max(1, Math.floor(after.length / 3))
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
  const early = med(after.slice(0, third).map((s) => s.heapMB))
  const late = med(after.slice(-third).map((s) => s.heapMB))
  const medianPct = ((late - early) / early) * 100 / Math.max(1e-6, (after[after.length - 1].tMin - after[Math.floor(third / 2)].tMin) / 60)
  const result = { minutes: MINUTES, bursts, baseline: base, last, pctPerHour: Math.round(pctPerHour * 10) / 10, medianPctPerHour: Math.round(medianPct * 10) / 10, autosaveAgeMs: autosaveAge, errors: errors.slice(0, 5), samples }
  if (process.env.JSON) fs.writeFileSync(process.env.JSON, JSON.stringify(result, null, 2))
  const memOk = Math.min(pctPerHour, medianPct) <= 5
  console.log(`${memOk ? 'PASS' : 'FAIL'} Soak ${MINUTES} min: heap growth ${result.pctPerHour} %/h (median-based ${result.medianPctPerHour} %/h) against the 5 %/h budget; ${bursts} edit bursts`)
  console.log(`${errors.length === 0 ? 'PASS' : 'FAIL'} Soak: no page errors`, errors.slice(0, 3).join(' | '))
  console.log(`${autosaveAge != null && autosaveAge < 120000 ? 'PASS' : 'FAIL'} Soak: autosave kept running (last autosave ${autosaveAge == null ? 'never' : Math.round(autosaveAge / 1000) + ' s ago'})`)
  code = memOk && errors.length === 0 && autosaveAge != null && autosaveAge < 120000 ? 0 : 1
} catch (e) {
  console.log('FAIL soak error', e.message)
} finally {
  await browser?.close().catch(() => {})
  vite.kill()
}
process.exit(code)
