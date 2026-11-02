// Phase 3 Part B: Grid data cards in the desktop app (dist/ + Electron), against a FAKE local server standing in for
// esbpowerline.com (never the real site): ESB_GRID_TEST_ORIGIN points the main process at 127.0.0.1, which only an
// unpackaged build honours (electron/grid-data.cjs resolveOrigin). The fake answers like the site: the daily JSON for
// a signed-in cookie, 401 without, 404 for an unpublished day, plus an oversized day.
//
// Checks: the Data tab signed out, the newest published day loaded by default, a picked day's figures shown with unit
// and date before adding, Add → a card clip whose stored value equals the source JSON exactly, the refresh prompt
// (Keep / Update), the main process refusing hostile dates and oversized bodies, no request path but the two daily
// ones, a saved copy used offline, and an exported MP4 whose settled frame matches the golden frame.
// Needs a fresh `npm run build`. Linux: xvfb-run -a.
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const root = path.resolve(import.meta.dirname, '../..')
const win = process.platform === 'win32'
const exe = path.join(root, 'node_modules', 'electron', 'dist', win ? 'electron.exe' : 'electron')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'p3b-profile-'))
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'p3b-work-'))
const OUT = process.env.OUT || path.join(root, 'tools', 'out', 'p3b')
fs.mkdirSync(OUT, { recursive: true })
const GOLDEN = path.join(root, 'tools', 'golden', 'video', 'p3b-export-final-480x270.png')
let failed = 0
function check(label, ok, info = '') { console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${info}`); if (!ok) failed++ }

const ISO = '2026-10-21'
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tools/fixtures/video/grid-daily-2026-10-21.json'), 'utf8'))
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dhakaToday = () => new Date(Date.now() + 6 * 3600 * 1000).toISOString().slice(0, 10)
const minus = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10) }
const label = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}` }
// the newest "published" day on the fake site is yesterday (Dhaka): the fixture's figures under that day's label (test
// data for the stand-in only; the card test itself uses the real 21 Oct file)
const LATEST = minus(dhakaToday(), 1)
const OVERSIZED = '2026-10-19'

// ---- the fake esbpowerline.com
const state = { eveningPeakGen: fixture.systemStats.eveningPeakGen, requests: [] }
const fake = http.createServer((req, res) => {
  state.requests.push({ path: req.url, cookie: req.headers.cookie || '', ua: req.headers['user-agent'] || '', referer: req.headers.referer, origin: req.headers.origin })
  const m = /^\/(?:api\/)?data\/daily\/(\d{4}-\d{2}-\d{2})\.json$/.exec(req.url || '')
  if (!m) { res.writeHead(404).end('nf'); return }
  if (!/sb-[a-z0-9]+-auth-token=/.test(req.headers.cookie || '')) { res.writeHead(401, { 'Content-Type': 'application/json' }).end('{"error":"Unauthorized"}'); return }
  const iso = m[1]
  if (iso === OVERSIZED && !req.url.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(' '.repeat(3 * 1024 * 1024)); return }
  if (req.url.startsWith('/api/')) { res.writeHead(404, { 'Content-Type': 'application/json' }).end('{"error":"Not published"}'); return }
  let body = null
  if (iso === ISO) body = { ...fixture, systemStats: { ...fixture.systemStats, eveningPeakGen: state.eveningPeakGen } }
  else if (iso === LATEST) body = { ...fixture, systemStats: { ...fixture.systemStats, date: label(LATEST) } }
  if (!body) { res.writeHead(404).end('nf'); return }
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body))
})
await new Promise((r) => fake.listen(0, '127.0.0.1', r))
const ORIGIN = `http://127.0.0.1:${fake.address().port}`

const session = { email: 'editor@example.com', name: 'Test Editor', role: 'EDITOR', token: 'test-access-token', refreshToken: 'test-refresh', expiresAt: Math.floor(Date.now() / 1000) + 36000, userId: 'u-test', authenticatedAt: new Date().toISOString(), authType: 'supabase' }

const app = await electron.launch({ executablePath: exe, args: [...(win ? [] : ['--no-sandbox']), root, '--user-data-dir=' + profile], env: { ...process.env, ESB_NO_SYNC: '1', ESB_GRID_TEST_ORIGIN: ORIGIN } })
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.setDefaultTimeout(30000)
await page.setViewportSize({ width: 1366, height: 820 }).catch(() => {})
await app.evaluate(({ dialog }) => {
  globalThis.__save = []
  dialog.showSaveDialog = async () => { const p = globalThis.__save.shift(); return p ? { canceled: false, filePath: p } : { canceled: true } }
})
await page.waitForSelector('.home-shell, .topbar', { timeout: 20000 })
const openVideo = async () => { await page.click('.launch-tile:has-text("Video")'); await page.waitForSelector('.video-workspace') }
const openData = async () => { await page.click('.vw-bin-panel [role=tab]:has-text("Data")'); await page.waitForSelector('.vw-data-panel') }
const shot = (name) => page.screenshot({ path: path.join(OUT, name) })

try {
  // 1. signed out
  await openVideo()
  await openData()
  await page.waitForSelector('.vw-data-signed-out')
  const out = (await page.locator('.vw-data-panel').innerText()).replace(/\s+/g, ' ')
  check('Signed out: the Data tab explains, and says stored cards keep their values', /Sign in to esbpowerline\.com in the Studio/.test(out) && /not enabled/.test(out) && /keep their stored values/.test(out), out.slice(0, 160))
  check('Signed out: nothing was asked of the site', state.requests.length === 0, String(state.requests.length))
  await shot('data-tab-signed-out.png')

  // 2. sign in (a synthetic staff session, example.com) → the newest published day by default
  await page.evaluate((s) => { localStorage.setItem('esb-banner-studio/site-session', JSON.stringify(s)); window.dispatchEvent(new CustomEvent('esb-session', { detail: s })) }, session)
  await page.reload()
  await page.waitForSelector('.home-shell, .topbar')
  await openVideo()
  await openData()
  await page.waitForSelector('.vw-data-item[data-metric="eveningPeakGen"]', { timeout: 20000 })
  const status = await page.locator('.vw-data-day .vw-data-status').innerText()
  check('Signed in: the tab opens on the newest published day', status.includes(label(LATEST)) && (await page.inputValue('.vw-data-date')) === LATEST, status)
  const sent = state.requests.filter((r) => r.path.endsWith(`${LATEST}.json`))[0]
  check('The request carried the session cookie and the Studio\'s own agent, and no Referer/Origin', !!sent && /sb-[a-z0-9]+-auth-token=base64-/.test(sent.cookie) && /^ESB-AI-Studio\//.test(sent.ua) && !sent.referer && !sent.origin, sent ? sent.ua : 'none')

  // 3. pick 21 Oct 2026: every figure with its unit and date before adding
  await page.fill('.vw-data-date', ISO)
  await page.click('.vw-data-load')
  await page.waitForFunction((d) => document.querySelector('.vw-data-day .vw-data-status')?.textContent?.includes(d), '21 Oct 2026')
  const row = (await page.locator('.vw-data-item[data-metric="eveningPeakGen"]').innerText()).replace(/\s+/g, ' ')
  check('Before adding: the figure shows its exact value, unit, hour and date', row.includes('15,552.54') && row.includes('MW') && row.includes('19:00') && row.includes('21 Oct 2026'), row)
  const share = (await page.locator('.vw-data-item[data-series="fuelMix:share"]').innerText()).replace(/\s+/g, ' ')
  check('A derived series is labelled "Derived: share of total"', /Derived: share of total/.test(share), share.slice(0, 120))
  // the full formula stays reachable: in the tooltip, and in the text once "Show formula" is pressed
  const item = page.locator('.vw-data-item[data-series="fuelMix:share"]')
  check('The derived label carries the formula as its tooltip', /share = value ÷ Σ values/.test((await item.locator('.vw-data-derived [data-tip]').getAttribute('data-tip')) || ''))
  await item.locator('.vw-formula-toggle').click()
  const formula = ((await item.locator('.vw-formula').innerText()) || '').replace(/\s+/g, ' ')
  check('Show formula reveals the full formula', /share = value ÷ Σ values/.test(formula) && /× 100/.test(formula), formula.slice(0, 120))
  await shot('data-tab-day-loaded.png')

  // 4. Add → a data-card clip with the source value exactly
  await page.click('.vw-data-item[data-metric="eveningPeakGen"] .vw-data-add')
  await page.waitForSelector('.vw-data-inspector')
  const ins = (await page.locator('.vw-data-inspector').innerText()).replace(/\s+/g, ' ')
  check('ACCEPT the card\'s number equals the source JSON value for that date', ins.includes('15,552.54 MW · 19:00') && ins.includes('21 Oct 2026 (2026-10-21)') && ins.includes('systemStats.eveningPeakGen'), ins.slice(0, 200))
  check('The card records where and when it was fetched', /Fetched .* from 127\.0\.0\.1:\d+\/data\/daily\/2026-10-21\.json/.test(ins), ins.match(/Fetched[^]*?json/)?.[0] ?? '')
  await shot('data-card-inspector.png')

  // 5. refresh: unchanged, then changed → Keep, then Update
  await page.click('.vw-data-refresh-btn')
  await page.waitForSelector('.vw-data-same')
  check('Refresh with the same published value says "Unchanged"', /Unchanged/.test(await page.locator('.vw-data-same').innerText()))
  state.eveningPeakGen = 15560.1
  await page.click('.vw-data-refresh-btn')
  await page.waitForSelector('.vw-data-changed')
  const prompt = (await page.locator('.vw-data-changed').innerText()).replace(/\s+/g, ' ')
  check('ACCEPT refresh-change prompt: before and after are shown, nothing changes yet', prompt.includes('On the card: 15,552.54 MW') && prompt.includes('Published now: 15,560.1 MW') && (await page.locator('.vw-data-shown').innerText()).includes('15,552.54'), prompt)
  await shot('data-card-refresh-changed.png')
  await page.click('.vw-data-keep')
  check('Keep leaves the stored figure', (await page.locator('.vw-data-shown').innerText()).includes('15,552.54'))
  await page.click('.vw-data-refresh-btn')
  await page.waitForSelector('.vw-data-update')
  await page.click('.vw-data-update')
  await page.waitForFunction(() => document.querySelector('.vw-data-shown')?.textContent?.includes('15,560.1'))
  check('Update takes the newly published figure', true)
  await page.click('.vw-header-actions [data-tip^="Undo"]')
  // undo clears the selection; select the card again to read it
  await page.click('.vw-clip-block')
  await page.waitForSelector('.vw-data-shown')
  check('Undo restores the stored figure', (await page.locator('.vw-data-shown').innerText().catch(() => '')).includes('15,552.54'))
  state.eveningPeakGen = fixture.systemStats.eveningPeakGen

  // 6. the main process refuses hostile calls
  const hostile = await page.evaluate(async (s) => {
    const esb = window.esb
    const ck = [{ name: 'sb-sxgokpmrbgdndstygapc-auth-token', value: 'base64-eyJ4IjoxfQ' }]
    return {
      traversal: await esb.gridDay(ck, '../../../etc/passwd'),
      url: await esb.gridDay(ck, 'https://evil.example/2026-10-21.json'),
      notADay: await esb.gridDay(ck, '2026-02-30'),
      object: await esb.gridDay(ck, ['2026-10-21']),
      badCookie: await esb.gridDay([{ name: 'evil', value: 'x' }], '2026-10-21', { refresh: true }),
      oversized: await esb.gridDay(ck, s),
      cachedBad: await esb.gridCached('../x'),
    }
  }, OVERSIZED)
  check('IPC refuses other paths and impossible dates', hostile.traversal.code === 'bad-date' && hostile.url.code === 'bad-date' && hostile.notADay.code === 'bad-date' && hostile.object.code === 'bad-date' && hostile.cachedBad.code === 'bad-date', JSON.stringify([hostile.traversal.code, hostile.url.code, hostile.notADay.code, hostile.object.code]))
  check('IPC refuses a cookie that is not the site session', hostile.badCookie.code === 'signed-out')
  check('IPC refuses an oversized body', hostile.oversized.code === 'too-large', hostile.oversized.code)
  const paths = [...new Set(state.requests.map((r) => r.path))]
  check('Only the two daily-report paths were ever requested', paths.every((p) => /^\/(api\/)?data\/daily\/\d{4}-\d{2}-\d{2}\.json$/.test(p)), paths.join(' '))

  // 7. export with the number card alone: its settled frame
  await page.keyboard.press('Escape')
  const n = await page.locator('.vw-clip-block').count()
  check('One data-card clip on the timeline', n === 1, String(n))
  const outFile = path.join(work, 'p3b-data.mp4')
  await app.evaluate((_e, p) => { globalThis.__save.push(p) }, outFile)
  await page.click('.vw-header-actions button:has-text("Export")')
  await page.waitForSelector('.vx-go:not([disabled])')
  await page.click('.vx-go')
  await page.waitForSelector('.vw-export-success', { timeout: 180000 })
  await page.click('.vw-export-modal button:has-text("Done")')
  const png = path.join(OUT, 'export-number-final.png')
  // 4.0 s: after the count-up (≈1.6 s) and before the out phase (the last 0.35 s of 6 s)
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '4.0', '-i', outFile, '-frames:v', '1', '-vf', 'scale=480:270', png])
  check('Exported MP4 has a frame at the settled time', fs.existsSync(png))
  const png2 = path.join(OUT, 'export-number-later.png')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '5.2', '-i', outFile, '-frames:v', '1', '-vf', 'scale=480:270', png2])
  if (!fs.existsSync(GOLDEN) || process.env.UPDATE_GOLDEN === '1') { fs.mkdirSync(path.dirname(GOLDEN), { recursive: true }); fs.copyFileSync(png, GOLDEN); console.log('  (golden written: ' + GOLDEN + ')') }
  const diff = await page.evaluate(async ([a, b]) => {
    const load = (b64) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + b64 })
    const [ia, ib] = await Promise.all([load(a), load(b)])
    const px = (img) => { const c = document.createElement('canvas'); c.width = 480; c.height = 270; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, 480, 270).data }
    const da = px(ia), db = px(ib)
    let off = 0
    for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 60) off++
    return off / (480 * 270)
  }, [fs.readFileSync(png).toString('base64'), fs.readFileSync(GOLDEN).toString('base64')])
  check('ACCEPT the exported settled frame matches the golden frame (≤ 1 % pixels off)', diff <= 0.01, (diff * 100).toFixed(3) + ' %')
  const still = await page.evaluate(async ([a, b]) => {
    const load = (b64) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + b64 })
    const [ia, ib] = await Promise.all([load(a), load(b)])
    const px = (img) => { const c = document.createElement('canvas'); c.width = 480; c.height = 270; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, 480, 270).data }
    const da = px(ia), db = px(ib)
    let off = 0, lit = 0
    for (let i = 0; i < da.length; i += 4) { if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 60) off++; if (da[i] + da[i + 1] + da[i + 2] > 600) lit++ }
    return { off: off / (480 * 270), lit }
  }, [fs.readFileSync(png).toString('base64'), fs.readFileSync(png2).toString('base64')])
  check('The count-up has landed: the frame at 4.0 s equals the frame at 5.2 s, and the card is drawn', still.off <= 0.005 && still.lit > 500, JSON.stringify(still))

  // 8. charts
  await openData()
  for (const id of ['fuelMix', 'zone:demand']) await page.click(`.vw-data-item[data-series="${id}"] .vw-data-add`)
  await page.keyboard.press('Escape')

  check('Chart cards added (three data-card clips)', (await page.locator('.vw-clip-block').count()) === 3)
  // 9. offline: the site gone, the saved copy still opens; the cards keep their values
  await new Promise((r) => fake.close(r))
  const offline = await page.evaluate(() => window.esb.gridCached('2026-10-21'))
  check('Offline: the saved copy of the day still opens', offline.ok === true && offline.cached === true)
  check('No page errors', errors.length === 0, errors.join(' | '))
} catch (e) {
  failed++
  console.log('FAIL (exception)', e && e.stack ? e.stack : e)
  await shot('data-failure.png').catch(() => {})
} finally {
  await app.close().catch(() => {})
  fake.close?.()
}
console.log(failed ? `\n${failed} check(s) failed` : '\nAll data-card desktop checks passed')
process.exit(failed ? 1 : 0)
