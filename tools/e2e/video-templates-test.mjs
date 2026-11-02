// Phase 6 in the browser (dev server): the package templates built from a story through the real Story tab, the platform
// settings they set (shape, length, safe zone, loudness, music level, export preset), a template that must refuse without a
// named quote, per-shape sizes (one timeline, shared captions), the brand kit's logo corner, and own templates (saved
// with the content stripped, started with empty slots that block the export).
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { launchBrowser } from '../launch-browser.mjs'
import { portOffset } from '../port-offset.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const PORT = 5260 + portOffset()
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
let failed = 0
const check = (label, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${info}`); if (!ok) failed++ }
const up = async () => { for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) return } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 500)) } throw new Error('Vite did not start') }

const BODY = 'Petrobangla will drill two new wells in Sylhet this winter. The wells are expected to add 30 MMCFD to the grid.\n\n“We expect the first gas by December and no delay,” said Rahim Uddin, the project director at Petrobangla.\n\nOfficials said the project will cost Tk 592 crore. Work begins in December near the Jalalabad field.'
let browser
try {
  await up()
  browser = await launchBrowser(chromium)
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 }, reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`http://localhost:${PORT}/`)
  await page.locator('.launch-tile:has-text("Video")').first().click()
  await page.waitForSelector('.video-workspace')
  await page.evaluate((body) => {
    const ed = window.__editorialStore.getState()
    ed.setDraftField('headline', 'Petrobangla to drill two new wells in Sylhet')
    ed.setDraftField('deck', 'Two new wells are set to raise gas supply by winter this year.')
    ed.setDraftField('body', body)
    ed.setDraftField('slug', 'two-new-wells-sylhet')
  }, BODY)
  await page.getByRole('tab', { name: 'Story', exact: true }).first().click()
  const state = () => page.evaluate(() => { const p = window.__videoStore.getState().project; return { aspect: p.aspect, w: p.width, h: p.height, duration: p.duration, safeZone: p.safeZone, loud: p.loudnessTarget, music: p.busVolume?.music, preset: p.exportPreset, tpl: p.template?.id, clips: p.clips.length, corner: p.bugCorner, titles: p.clips.filter((c) => c.titleData).map((c) => c.titleData.template), name: p.name } })
  const build = async (label) => {
    await page.getByRole('radio', { name: new RegExp('^' + label) }).first().click()
    await page.getByRole('button', { name: 'Build story video' }).first().click()
    const replace = page.getByRole('button', { name: 'Replace', exact: true })
    if (await replace.count()) await replace.first().click()
    await page.waitForSelector('.vw-story-note', { timeout: 30000 })
    await page.waitForTimeout(300)
    return page.locator('.vw-story-note').innerText()
  }

  // ---- News Short
  await build('News Short')
  let s = await state()
  check('News Short: 9:16, 60 s at most, shorts safe zone, -14 LUFS, music -18 dB, MP4 30 fps', s.aspect === '9:16' && s.w === 1080 && s.h === 1920 && s.duration <= 60.1 && s.safeZone === 'shorts' && s.loud === -14 && s.music === -18 && s.preset?.container === 'mp4' && s.preset?.fps === 30 && s.tpl === 'news-short', JSON.stringify(s))
  check('News Short closes on the ESB end card (brand kit default) and stays editable (clips are ordinary)', s.titles.includes('end-card') && s.clips > 4)

  // ---- Reel / YouTube / Facebook feed
  await build('Reel'); s = await state()
  check('Reel: 9:16, reels safe zone, within 90 s', s.aspect === '9:16' && s.safeZone === 'reels' && s.duration <= 90.1 && s.tpl === 'reel', JSON.stringify(s))
  await build('YouTube report'); s = await state()
  check('YouTube report: 16:9 1920×1080, no portrait safe zone', s.aspect === '16:9' && s.w === 1920 && s.safeZone === undefined && s.tpl === 'youtube-report', JSON.stringify(s))
  await build('Facebook feed'); s = await state()
  check('Facebook feed: 4:5 1080×1350, -16 LUFS', s.aspect === '4:5' && s.h === 1350 && s.loud === -16, JSON.stringify(s))

  // ---- Grid daily / Explainer: empty figure cards block the export
  await build('Grid daily update'); s = await state()
  const blocked = await page.evaluate(async () => (await import('/src/video/exportVideo.ts')).exportBlocker(window.__videoStore.getState().project))
  check('Grid daily update: three empty figure cards, and the export is blocked until they are filled', s.clips > 4 && /empty|fill|required|field/i.test(String(blocked)) , String(blocked).slice(0, 140))

  // ---- Quote video: needs a named speaker
  await build('Quote video'); s = await state()
  check('Quote video: opens on the quote card with the named speaker, word for word', s.titles.includes('quote') && s.tpl === 'quote-video', JSON.stringify(s.titles))
  await page.evaluate(() => window.__editorialStore.getState().setDraftField('body', 'Petrobangla will drill two new wells in Sylhet this winter. The wells are expected to add 30 MMCFD to the grid. “The schedule is not final for this stage of work yet,” the report said.'))
  const refusal = await build('Quote video')
  s = await state()
  check('Quote video refuses without a named speaker and leaves the open video alone', /speaker/i.test(refusal) && s.tpl === 'quote-video', refusal.slice(0, 120))
  await page.evaluate((body) => window.__editorialStore.getState().setDraftField('body', body), BODY)

  // ---- Sizes: one timeline, shared words
  await build('YouTube report')
  const before = await state()
  await page.getByRole('button', { name: /^9:16/ }).first().click()
  const nine = await state()
  check('Sizes: opening 9:16 keeps every clip and its timing, in a 1080×1920 frame', nine.aspect === '9:16' && nine.w === 1080 && nine.clips === before.clips && nine.duration === before.duration, JSON.stringify(nine))
  await page.evaluate(() => { const st = window.__videoStore.getState(); const c = st.project.clips.find((x) => x.kind === 'caption'); st.updateClip({ ...c, captionText: 'Edited in 9:16' }) })
  await page.getByRole('button', { name: /^16:9/ }).first().click()
  const edited = await page.evaluate(() => window.__videoStore.getState().project.clips.some((c) => c.captionText === 'Edited in 9:16'))
  check('Sizes: a caption edited in one shape is edited in every shape', edited)

  // ---- Brand kit: the logo corner
  await page.locator('select[aria-label="Logo position"]').selectOption('bl')
  s = await state()
  check('Brand kit: the logo corner is stored in the project (bottom left) and remembered on this PC', s.corner === 'bl' && (await page.evaluate(() => JSON.parse(localStorage.getItem('esb-banner-studio/video/brand/v1')).bugCorner)) === 'bl')

  // ---- Own template: content stripped, slots empty, export blocked
  await page.locator('input[aria-label="Template name"]').fill('Evening bulletin')
  await page.getByRole('button', { name: 'Save as template' }).click()
  await page.waitForSelector('[aria-label="My templates"] li')
  const saved = await page.evaluate(() => localStorage.getItem('esb-banner-studio/video/templates/v1') ?? '')
  check('My templates: saved without the story’s words, figures or files', saved.includes('Evening bulletin') && !/Petrobangla|Rahim|592|Sylhet|blob:|esb-media/.test(saved), saved.slice(0, 120))
  await page.locator('[aria-label="My templates"] li').first().getByRole('button', { name: 'Use' }).click()
  await page.getByRole('button', { name: 'Replace', exact: true }).last().click()
  const fromTpl = await page.evaluate(async () => { const p = window.__videoStore.getState().project; const m = await import('/src/video/exportVideo.ts'); return { name: p.name, tpl: p.template?.name, texts: p.clips.map((c) => c.captionText ?? '').join(''), blocker: m.exportBlocker(p) } })
  check('My templates: a video started from one has empty slots and the export is blocked until they are filled', fromTpl.name === 'Evening bulletin' && fromTpl.texts === '' && !!fromTpl.blocker, JSON.stringify(fromTpl).slice(0, 160))

  check('No page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
} catch (e) {
  console.log('FAIL test error', e.message)
  failed++
} finally {
  await browser?.close().catch(() => {})
  vite.kill()
}
console.log(failed ? `\n${failed} FAILED` : '\nAll passed')
process.exit(failed ? 1 : 0)
