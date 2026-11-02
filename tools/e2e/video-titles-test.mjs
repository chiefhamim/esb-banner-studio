// Phase 3 — Part A acceptance (titles wired into the editor), in the browser on the dev server, with ffmpeg reading
// the exported file back. Every word on screen is a neutral test string (no real names or figures).
//   node tools/e2e/video-titles-test.mjs          JSON=path keeps the measured numbers
import { chromium } from 'playwright-core'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchBrowser } from '../launch-browser.mjs'
import { portOffset } from '../port-offset.mjs'

const PORT = 5201 + portOffset()
const root = path.resolve(import.meta.dirname, '../..')
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
const results = {}
let failed = 0
function check(label, ok, info = '') {
  if (ok) console.log(`PASS ${label} ${info}`)
  else { console.error(`FAIL ${label} ${info}`); failed++ }
}
const waitUp = async () => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/`)).ok) return } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('Vite did not start')
}
function exportFrame(file, n, w, h) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `select=eq(n\\,${n}),format=rgb24`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 * 1024 * 1024 })
  return r.stdout.length === w * h * 3 ? r.stdout : null
}
/** rgba vs rgb (export) or rgba vs rgba: share of pixels off by more than tol, and the mean difference in % */
function diff(a, b, w, h, tol = 48, bStride = 3) {
  let bad = 0, sum = 0
  for (let i = 0; i < w * h; i++) {
    const k = i * 4, j = i * bStride
    const d0 = Math.abs(a[k] - b[j]), d1 = Math.abs(a[k + 1] - b[j + 1]), d2 = Math.abs(a[k + 2] - b[j + 2])
    sum += (d0 + d1 + d2) / 3
    if (Math.max(d0, d1, d2) > tol) bad++
  }
  return { badPct: Math.round((bad / (w * h)) * 10000) / 100, meanPct: Math.round((sum / (w * h) / 255) * 10000) / 100 }
}
const T = (id, start, duration, titleData, extra = {}) => ({ id, trackId: 'v2', title: id, kind: 'overlay', start, duration, in: 0, out: duration, color: '#10b981', titleData, ...extra })

let browser
try {
  await waitUp()
  browser = await launchBrowser(chromium)
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
  page.setDefaultTimeout(30000)
  const errors = []
  page.on('pageerror', (e) => { errors.push(String(e)); console.error('PAGE ERROR:', e) })
  await page.goto(`http://localhost:${PORT}/`)
  await page.evaluate(() => localStorage.removeItem('esb-banner-studio/video-autosave/v1'))
  await page.waitForSelector('.launch-tile')
  await page.click('.launch-tile:has-text("Video")')
  await page.waitForSelector('.video-workspace')
  await page.evaluate(() => document.fonts.ready)

  const load = (clips, extra = {}) => page.evaluate(({ clips, extra }) => {
    const vs = window.__videoStore
    if (extra.aspect) vs.getState().setAspect(extra.aspect)
    const st = vs.getState()
    st.loadProject({ ...st.project, ...extra, clips }, { dirty: true })
    vs.getState().seek(0)
  }, { clips, extra })
  const still = (t) => page.evaluate(async (t) => window.__videoEngine.still(t), t).then((r) => ({ ...r, px: Buffer.from(r.base64, 'base64') }))
  const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
  const exportNow = async (name) => {
    await page.click('.vw-header-actions button:has-text("Export")')
    await page.waitForSelector('.vx')
    await page.waitForFunction(() => { const b = document.querySelector('.vx-go'); return b && !b.disabled }, null, { timeout: 15000 })
    const dl = page.waitForEvent('download', { timeout: 180000 })
    await page.click('.vx-go')
    const d = await dl
    const file = path.join(os.tmpdir(), `esb-p3a-${name}-${process.pid}.mp4`)
    await d.saveAs(file)
    await page.waitForSelector('.vw-export-success')
    await page.click('.vw-export-modal button:has-text("Done")')
    return file
  }

  // ---------------------------------------------------------------- ACCEPT: animated + Bangla titles, preview == export at 5 timestamps
  const bnName = 'ক্ষমতা স্ত্রী মন্ত্রণালয়' // conjuncts ক্ষ, স্ত্র, ন্ত্র
  await load([
    T('lt', 0, 4, { template: 'lower-third', fields: { name: bnName, role: 'বিদ্যুৎ বিভাগ' }, animIn: { preset: 'type-on', duration: 0, delay: 0, stagger: 0.05, ease: 'esb' } }),
    T('hd', 4, 3, { template: 'headline', fields: { headline: 'Test headline for the title card check', kicker: 'Test kicker' }, categoryId: '05' }),
  ], { bug: false })
  const file = await exportNow('anim')
  const frames = [6, 15, 60, 125, 205] // typing (2), the settled Bangla lower third, the headline's line-by-line in, its out fade
  const scores = []
  for (const n of frames) {
    const s = await still(n / 30)
    const ex = exportFrame(file, n, 1920, 1080)
    scores.push(ex ? { n, ...diff(s.px, ex, 1920, 1080) } : { n, error: 'no export frame' })
  }
  results.animGolden = scores
  check('ACCEPT animated + Bangla title frames: preview == export at 5 timestamps (mean ≤ 1 %, ≤ 1 % of pixels off by > 48)', scores.every((s) => s.badPct != null && s.badPct <= 1 && s.meanPct <= 1), JSON.stringify(scores))
  // the frames really differ while typing (the test is not comparing two empty frames)
  const s6 = await still(6 / 30), s15 = await still(15 / 30), s60 = await still(2)
  const typing = diff(s6.px, s15.px, 1920, 1080, 48, 4), settledVsTyping = diff(s6.px, s60.px, 1920, 1080, 48, 4)
  check('Typing frames are distinct pictures (the title animates)', typing.badPct > 0.05 && settledVsTyping.badPct > 0.05, JSON.stringify({ typing, settledVsTyping }))
  fs.rmSync(file, { force: true })

  // ---------------------------------------------------------------- ACCEPT: a static title is rasterised once; a moving one per frame
  await load([T('lt', 0, 6, { template: 'lower-third', fields: { name: bnName, role: 'Test role' }, animIn: { preset: 'type-on', duration: 0, delay: 0, stagger: 0.05, ease: 'esb' } })], { bug: false })
  // from inside the typing (a moving raster) into the settled part: the settled title is drawn once, then reused
  await page.evaluate(() => window.__videoStore.getState().seek(0.1)); await frame()
  await page.evaluate(() => window.__videoEngine.resetTitleStats())
  for (let k = 0; k < 30; k++) { await page.evaluate((t) => window.__videoStore.getState().seek(t), 2.2 + k * 0.08); await frame() }
  const st1 = await page.evaluate(() => window.__videoEngine.titleStats())
  await page.evaluate(() => { window.__videoEngine.resetTitleStats() })
  const movingTimes = Array.from({ length: 10 }, (_, k) => (k + 1) / 30)
  for (const t of movingTimes) { await page.evaluate((t) => window.__videoStore.getState().seek(t), t); await frame() }
  // the same instant again (a paused redraw) draws nothing new
  await page.evaluate(() => window.dispatchEvent(new Event('esb:video-media-ready'))); await frame()
  const st2 = await page.evaluate(() => window.__videoEngine.titleStats())
  results.rasterCounts = { settled30Seeks: st1, moving10Frames: st2 }
  check('ACCEPT a static title is rasterised once over 30 seeks across its settled part', st1.static === 1 && st1.moving === 0, JSON.stringify(st1))
  check('ACCEPT an animating title is rasterised once per new frame (10 frames → 10 rasters, a redraw of the same frame → none)', st2.moving === 10 && st2.static === 0, JSON.stringify(st2))

  // ---------------------------------------------------------------- ACCEPT: migrated Phase 0–2 overlays look the same
  const legacy = [
    { id: 'o1', trackId: 'v2', title: 'Lower third', kind: 'overlay', start: 0, duration: 4, in: 0, out: 4, color: '#10b981', overlayType: 'lower-third', overlayText: 'Test name', overlaySub: 'বাংলা পরীক্ষা' },
    { id: 'o2', trackId: 'v2', title: 'Headline', kind: 'overlay', start: 4, duration: 4, in: 0, out: 4, color: '#ef4444', overlayType: 'headline', overlayText: 'Test headline over two lines of the frame for the check', overlaySub: 'Test kicker', accent: '#00e676' },
    { id: 'o3', trackId: 'v2', title: 'Card', kind: 'overlay', start: 8, duration: 4, in: 0, out: 4, color: '#7c3aed', overlayType: 'card', overlayText: 'Card title', overlaySub: 'Card text', accent: '#7c3aed' },
    { id: 'o4', trackId: 'v2', title: 'Breaking', kind: 'overlay', start: 12, duration: 4, in: 0, out: 4, color: '#ef4444', overlayType: 'breaking', overlayText: 'Test breaking line', overlaySub: '' },
    { id: 'c1', trackId: 'c1', title: 'Caption', kind: 'caption', start: 0, duration: 4, in: 0, out: 4, color: '#f59e0b', captionText: 'A caption over the lower third' },
  ]
  const migrated = await page.evaluate((cs) => cs.map((c) => window.__videoEngine.migrateOverlay(c)), legacy)
  check('Migration makes classic title clips with the same words', migrated.filter((c) => c.kind === 'overlay').every((c) => c.titleData?.look === 'classic' && !c.overlayType), JSON.stringify(migrated.map((c) => c.titleData?.fields)))
  const mig = []
  for (const t of [1, 5, 9, 13]) {
    await load(legacy); const a = await still(t)
    await load(migrated); const b = await still(t)
    mig.push({ t, ...diff(a.px, b.px, 1920, 1080, 8, 4) })
  }
  results.migrated = mig
  check('ACCEPT migrated old overlays look the same (golden ≤ 1 %: lower third + caption, headline, text card, breaking)', mig.every((m) => m.badPct <= 1 && m.meanPct <= 1), JSON.stringify(mig))

  // ---------------------------------------------------------------- ACCEPT: a 9:16 lower third stays out of the Reels zones
  const longBn = 'মোহাম্মদ আব্দুল্লাহ আল মামুন ক্ষিতীশ চন্দ্র স্ত্রীবর্গ বিশ্বাস মজুমদার চৌধুরী'
  await load([T('lt', 0, 6, { template: 'lower-third', fields: { name: longBn, role: 'বাংলাদেশ বিদ্যুৎ উন্নয়ন বোর্ডের প্রধান প্রকৌশলী' } })], { aspect: '9:16', bug: false })
  const p9 = await still(3)
  let inBottom = 0, inRight = 0, drawn = 0
  for (let y = 0; y < 1920; y++) for (let x = 0; x < 1080; x++) {
    const k = (y * 1080 + x) * 4
    if (p9.px[k] + p9.px[k + 1] + p9.px[k + 2] <= 24) continue
    drawn++
    if (y >= 1920 * 0.8) inBottom++
    if (x >= 1080 * 0.87) inRight++
  }
  results.safe916 = { drawn, inBottom, inRight }
  check('ACCEPT 9:16 lower third: nothing drawn in the Reels bottom 20 % or the right button column', drawn > 1000 && inBottom === 0 && inRight === 0, JSON.stringify(results.safe916))

  // ---------------------------------------------------------------- ACCEPT: export refuses empty / placeholder titles and names them
  await load([
    T('e1', 0, 3, { template: 'lower-third', fields: { name: '', role: 'Test role' } }),
    T('e2', 3, 3, { template: 'quote', fields: { quote: 'Lorem ipsum dolor sit amet', speaker: 'Test speaker', speakerRole: '' } }),
  ], { aspect: '16:9' })
  await page.click('.vw-header-actions button:has-text("Export")')
  await page.waitForSelector('.vx-title-issues')
  const issue = await page.locator('.vx-title-issues').innerText()
  const goDisabled = await page.locator('.vx-go').isDisabled()
  results.blocked = issue
  check('ACCEPT export refuses an empty required field and placeholder text, naming each title', goDisabled && /Lower third at 0:00\.0/.test(issue) && /Speaker name.{0,4} is empty/.test(issue) && /Quote card at 0:03\.0/.test(issue) && /placeholder text/.test(issue), JSON.stringify(issue))
  await page.click('.vx-title-issues .vx-show-title >> nth=0')
  check('“Show” selects the title and closes the sheet', (await page.locator('.vx').count()) === 0 && (await page.evaluate(() => window.__videoStore.getState().selectedClipId)) === 'e1')
  // filled in: the same timeline exports
  await page.fill('#vw-tf-name', 'Test name')
  await page.evaluate(() => { const st = window.__videoStore.getState(); const c = st.project.clips.find((x) => x.id === 'e2'); st.updateClip({ ...c, titleData: { ...c.titleData, fields: { ...c.titleData.fields, quote: 'A test quote set word for word' } } }) })
  await page.click('.vw-header-actions button:has-text("Export")')
  await page.waitForSelector('.vx')
  check('Filled in, the export is allowed', (await page.locator('.vx-title-issues').count()) === 0)
  await page.click('.vx-actions button:has-text("Cancel")')

  // ---------------------------------------------------------------- the Titles tab adds kit titles and stickers; the inspector fits long Bangla
  await load([], { aspect: '16:9' })
  await page.click('.vw-bin-panel .side-tabs button:has-text("Titles")')
  for (const tpl of ['lower-third', 'name-strap', 'headline', 'breaking', 'quote', 'source', 'end-card']) await page.click(`.vw-preset-card[data-preset="${tpl}"] button:has-text("Add")`).then(() => page.keyboard.press('Escape')).catch(() => {})
  await page.click('.vw-bin-panel .side-tabs button:has-text("Titles")')
  for (const shape of ['arrow', 'circle', 'highlight', 'underline', 'box', 'callout']) { await page.click(`.vw-sticker-btn[data-shape="${shape}"]`); await page.keyboard.press('Escape'); await page.click('.vw-bin-panel .side-tabs button:has-text("Titles")').catch(() => {}) }
  const added = await page.evaluate(() => window.__videoStore.getState().project.clips.map((c) => c.titleData?.template + (c.titleData?.sticker ? ':' + c.titleData.sticker.shape : '')))
  check('Titles tab adds every kit title and every sticker (empty fields)', added.length === 13 && added.includes('end-card') && added.includes('sticker:callout'), JSON.stringify(added))
  await load([T('lt', 0, 6, { template: 'lower-third', fields: { name: longBn, role: 'বাংলাদেশ বিদ্যুৎ উন্নয়ন বোর্ডের প্রধান প্রকৌশলী (সঞ্চালন ও বিতরণ পরিকল্পনা)' } })])
  await page.evaluate(() => window.__videoStore.getState().selectClip('lt'))
  await page.waitForSelector('.vw-title-fields')
  const fit = await page.evaluate(() => {
    const out = []
    for (const el of document.querySelectorAll('.vw-inspector label, .vw-inspector .vw-hint, .vw-inspector .vw-title-problems, .vw-inspector .vw-fx-title, .vw-inspector .select-label, .vw-ih-name')) {
      const cs = getComputedStyle(el)
      const clipped = el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis'
      const r = el.getBoundingClientRect(), box = el.closest('.vw-inspector').getBoundingClientRect()
      if (clipped || r.right > box.right + 1) out.push(`${el.className || el.tagName}: ${el.textContent.slice(0, 40)}`)
    }
    return out
  })
  results.inspectorFit = fit
  check('Text fit: 0 problems in the title inspector with a long Bangla name and role', fit.length === 0, JSON.stringify(fit))

  check('No page errors', errors.length === 0, errors.join(' | '))
} catch (e) {
  console.error('video-titles-test error:', e?.stack || e)
  failed++
} finally {
  if (process.env.JSON) fs.writeFileSync(process.env.JSON, JSON.stringify(results, null, 2))
  await browser?.close().catch(() => {})
  vite.kill()
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
  process.exit(failed ? 1 : 0)
}
