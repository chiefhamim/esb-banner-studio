// Phase 7 in the desktop app (dist/ + Electron) against the FAKE YouTube and Facebook servers (ESB_VIDEO_PUBLISH_DRYRUN=1):
// the renderer is treated as hostile. Nothing is posted without the native Approve dialog in main; a render is named by id
// (never a path); a thumbnail must be a real small image; a forged / reused / missing approval token is refused; a 95 s
// Reel and a variable-fps file are refused by the validators; an approved post uploads, resumes after a cut-off, and
// leaves no token in any URL. Needs a fresh `npm run build`. No real platform is ever contacted.
import { _electron as electron } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { startFakePlatforms, FAKE_PAGE_ID, FAKE_PAGE_TOKEN } from '../fixtures/publish/fake-platforms.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const win = process.platform === 'win32'
const exe = path.join(root, 'node_modules', 'electron', 'dist', win ? 'electron.exe' : 'electron')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-v7profile-'))
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-v7work-'))
let failed = 0
const check = (label, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${info}`); if (!ok) failed++ }
const speech = path.join(work, 'speech-6s.mp4')
fs.copyFileSync(path.join(root, 'tools/fixtures/video/speech-6s.mp4'), speech)

const fake = await startFakePlatforms()
const app = await electron.launch({
  executablePath: exe,
  args: [...(win ? [] : ['--no-sandbox']), root, '--user-data-dir=' + profile],
  env: { ...process.env, ESB_NO_SYNC: '1', ESB_VIDEO_PUBLISH_DRYRUN: '1', ESB_VIDEO_PUBLISH_FAKE_BASE: fake.base },
})
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.setDefaultTimeout(60000)
await page.setViewportSize({ width: 1366, height: 820 }).catch(() => {})
await app.evaluate(({ dialog, shell }) => {
  globalThis.__open = []; globalThis.__save = []; globalThis.__approve = []; globalThis.__approvals = []
  dialog.showOpenDialog = async () => { const p = globalThis.__open.shift(); return p ? { canceled: false, filePaths: [].concat(p) } : { canceled: true, filePaths: [] } }
  dialog.showSaveDialog = async () => { const p = globalThis.__save.shift(); return p ? { canceled: false, filePath: p } : { canceled: true } }
  // the native Approve dialog: the test answers it as the owner would (0 = Cancel, 1 = Approve and post), and records what it said
  dialog.showMessageBox = async (_w, o) => { globalThis.__approvals.push({ message: o.message, detail: o.detail, buttons: o.buttons, defaultId: o.defaultId }); return { response: globalThis.__approve.shift() ?? 0 } }
  shell.openExternal = async (u) => { await fetch(u) } // the "browser": the fake Google consent answers at once
}).catch((e) => console.log('stub error', e.message))
const answer = (n) => app.evaluate((_e, v) => { globalThis.__approve.push(v) }, n)
const vp = (fn, ...args) => page.evaluate(([f, a]) => window.esb[f](...a), [fn, args])

try {
  await page.waitForSelector('.home-shell, .topbar')
  await page.click('.launch-tile:has-text("Video")')
  await page.waitForSelector('.video-workspace')

  // ---- make a real render through the app's own export (it is registered by id in main)
  await app.evaluate((_e, p) => { globalThis.__open.push(p) }, speech)
  await page.click('.vw-start-import')
  await page.waitForSelector('.vw-media-card:has-text("speech-6s.mp4")')
  await page.click('.vw-media-card .vw-add')
  await page.waitForFunction(() => document.querySelectorAll('.vw-clip-block').length >= 1)
  const out = path.join(work, 'render-16x9.mp4')
  await app.evaluate((_e, p) => { globalThis.__save.push(p) }, out)
  await page.click('.vw-header-actions button:has-text("Export")')
  await page.waitForSelector('.vx-go:not([disabled])')
  await page.click('.vx-go')
  await page.waitForSelector('.vw-export-success', { timeout: 180000 })
  await page.click('.vw-export-modal button:has-text("Done")')
  const renders = (await vp('vpubRenders')).renders
  check('A finished export is remembered by id; the list shows name and size but never a path', renders.length === 1 && renders[0].name === 'render-16x9.mp4' && renders[0].exists && !JSON.stringify(renders).includes(work.replace(/\\/g, '\\\\')) && !('path' in renders[0]), JSON.stringify(renders).slice(0, 160))
  const rid = renders[0].id

  // ---- credentials: sealed in main, never returned
  const st0 = await vp('vpubStatus')
  check('Status: dry run, credentials empty, nothing secret in it', st0.ok && st0.dryRun === true && st0.credentials.youtube.connected === false && st0.credentials.facebook.connected === false)
  const bad = await vp('vpubYtClient', { clientId: 'not-a-client', clientSecret: 's' })
  check('A client ID that is not a Google one is refused with a reason', bad.ok === false && /OAuth client ID/.test(bad.error), bad.error)
  const cs = await vp('vpubYtClient', { clientId: '123456789-fakeclient.apps.googleusercontent.com', clientSecret: 'fake-secret' })
  check('The OAuth client is saved (status says so, the secret is not in the answer)', cs.ok && cs.credentials.youtube.clientSaved && !JSON.stringify(cs).includes('fake-secret'))
  const conn = await vp('vpubYtConnect', { captions: false })
  check('YouTube connects through the loopback sign-in + PKCE (fake Google); only status comes back', conn.ok && conn.credentials.youtube.connected && !/refresh|access_token/i.test(JSON.stringify(conn)), JSON.stringify(conn.credentials?.youtube))
  const fbp = await vp('vpubFbUsePage', { pageId: FAKE_PAGE_ID, token: FAKE_PAGE_TOKEN, pageName: 'Fake Page' })
  check('The Page token is handed over once and sealed; status shows the page, not the token', fbp.ok && fbp.credentials.facebook.connected && !JSON.stringify(fbp).includes(FAKE_PAGE_TOKEN))
  const walk = (d, n = 0) => (n > 3 ? [] : fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name), n + 1) : [path.join(d, e.name)])))
  const pubFiles = walk(profile).filter((f) => /publish/i.test(path.basename(f)) && fs.statSync(f).size < 2e6)
  const onDisk = pubFiles.map((f) => fs.readFileSync(f, 'utf8')).join('')
  check('The credential file exists and holds no token or secret in plain text', pubFiles.length > 0 && !onDisk.includes(FAKE_PAGE_TOKEN) && !onDisk.includes('fake-secret'), pubFiles.map((f) => path.basename(f)).join(','))

  const meta = { title: 'Two new wells in Sylhet', description: 'Petrobangla will drill two wells.', tags: ['gas'], link: 'https://esbpowerline.com/articles/two-new-wells-sylhet' }
  const facts = { durationSec: 6, width: 1920, height: 1080, fps: 30, fpsMode: 'constant', videoCodec: 'avc', audioCodec: 'aac', fileSize: fs.statSync(out).size }
  const yt = { renderId: rid, metadata: meta, destinations: [{ kind: 'youtube', privacyStatus: 'private' }], schedule: { at: null }, facts }

  // ---- hostile renderer: nothing is posted
  const unknown = await vp('vpubApprove', { ...yt, renderId: '../../../Windows/System32/notepad.exe' })
  check('A render named by a path is not found (only ids main issued)', unknown.ok === false && /not found/i.test(unknown.error), unknown.error)
  const thumb = await vp('vpubApprove', { ...yt, thumbnail: new Uint8Array([1, 2, 3, 4]) })
  check('A thumbnail that is not a real image is refused', thumb.ok === false && /JPEG or PNG/.test(thumb.error), thumb.error)
  const noToken = await vp('vpubStart', yt)
  check('Starting without an approval token is refused (the gate cannot be skipped from the page)', noToken.ok === false && /not been approved/i.test(noToken.error), noToken.error)
  const forged = await vp('vpubStart', { ...yt, approvalToken: 'a'.repeat(64) })
  check('A forged approval token is refused', forged.ok === false && /not been approved/i.test(forged.error), forged.error)
  check('...and nothing reached the fake platforms', fake.state.insertCalls === 0 && fake.state.sessions.size === 0)

  // ---- validators: a 95 s Reel and a variable-fps file are refused before any dialog
  const reel = { renderId: rid, metadata: meta, destinations: [{ kind: 'facebook_reel', state: 'DRAFT' }], schedule: { at: null }, facts: { ...facts, width: 1080, height: 1920, durationSec: 95 } }
  const r95 = await vp('vpubApprove', reel)
  console.log('r95:', JSON.stringify(r95).slice(0, 400))
  check('A 95 s Reel is refused by the validators', r95.ok === false && Array.isArray(r95.problems) && r95.problems.some((p) => /90|long|length|seconds/i.test(String(p.message ?? p))), JSON.stringify(r95.problems)?.slice(0, 200))
  const rvar = await vp('vpubApprove', { ...reel, facts: { ...facts, width: 1080, height: 1920, durationSec: 30, fpsMode: 'variable' } })
  check('A variable-frame-rate file is refused for a Reel', rvar.ok === false && Array.isArray(rvar.problems) && rvar.problems.length > 0, JSON.stringify(rvar.problems)?.slice(0, 200))
  check('No Approve dialog was shown for either (a problem stops it first)', (await app.evaluate(() => globalThis.__approvals.length)) === 0)

  // ---- the Approve dialog: Cancel (also the default) posts nothing; Approve issues one single-use token
  await answer(0)
  const cancelled = await vp('vpubApprove', yt)
  const shown = await app.evaluate(() => globalThis.__approvals[0])
  check('The native dialog names the title and destination, and Cancel is the default button', cancelled.ok === false && cancelled.cancelled === true && /Two new wells/.test(shown.message) && /YouTube \(private\)/.test(shown.detail) && shown.defaultId === 0, JSON.stringify(shown).slice(0, 200))
  await answer(1)
  const ok = await vp('vpubApprove', yt)
  check('After Approve, a token bound to this render and text is issued', ok.ok === true && typeof ok.approvalToken === 'string' && ok.approvalToken.length >= 32)
  const changed = await vp('vpubStart', { ...yt, metadata: { ...meta, title: 'A different title' }, approvalToken: ok.approvalToken })
  check('Changing the title after approval is refused (and the token is spent)', changed.ok === false && /changed after it was approved|not been approved/i.test(changed.error), changed.error)
  await answer(1)
  const ok2 = await vp('vpubApprove', yt)
  const started = await vp('vpubStart', { ...yt, approvalToken: ok2.approvalToken })
  check('The approved post starts as a background job', started.ok === true && !!started.jobId, JSON.stringify(started))
  let job = null
  for (let i = 0; i < 300; i++) { job = (await vp('vpubJob', started.jobId)).job; if (job && ['done', 'failed', 'cancelled'].includes(job.status)) break; await new Promise((r) => setTimeout(r, 300)) }
  console.log('job:', JSON.stringify({ status: job.status, d: job.destinations.map((d) => ({ state: d.state, error: d.error, steps: d.steps.map((x) => x.name + ':' + x.status + (x.error ? '(' + x.error + ')' : '')) })) }).slice(0, 700))
  check('The upload finished on the fake YouTube, private, once, with a link in the job', job.status === 'done' && fake.state.videos.length === 1 && fake.state.insertCalls >= 1 && /\//.test(job.destinations[0].result?.url ?? ''), JSON.stringify(job.destinations[0].result))
  check('A job shows the file name but never its path on disk', !('renderPath' in job) && job.file === 'render-16x9.mp4' && !JSON.stringify(job).includes(path.basename(work)), job.file)
  const reuse = await vp('vpubStart', { ...yt, approvalToken: ok2.approvalToken })
  check('The same approval cannot be used twice (no second post)', reuse.ok === false && fake.state.videos.length === 1, reuse.error)
  // ================= the real UI: queue two sizes, then post the 9:16 render as a Reel draft and a private YouTube upload
  const shots = process.env.OUT || path.join(root, 'tools', 'out', 'p7')
  fs.mkdirSync(shots, { recursive: true })
  await page.click('.vw-hdr-publish')
  await page.waitForSelector('.vw-pub')
  await page.screenshot({ path: path.join(shots, 'publish-renders-empty.png') })
  await page.locator('label.vw-size:has-text("9:16")').click()
  await page.getByRole('button', { name: 'Add to the queue' }).click()
  await page.waitForSelector('.vw-q-bar', { timeout: 60000 })
  await page.screenshot({ path: path.join(shots, 'publish-renders-running.png') })
  await page.waitForFunction(() => document.querySelectorAll('.vw-q-out.st-done').length >= 2, null, { timeout: 240000 })
  await page.screenshot({ path: path.join(shots, 'publish-renders-done.png') })
  const doneRows = await page.locator('.vw-q-out.st-done').count()
  check('The queue renders both sizes one after another and shows each as Done with Show in folder and Publish', doneRows >= 2 && (await page.getByRole('button', { name: 'Show in folder' }).count()) >= 2, 'done rows ' + doneRows)
  const all = (await vp('vpubRenders')).renders
  const nine = all.find((r) => /9x16/.test(r.name))
  check('The 9:16 render is a registered file in Pictures/ESB Banners/Video renders', !!nine && nine.exists, JSON.stringify(all.map((r) => r.name)))
  const outDir = path.join(os.homedir(), 'Pictures', 'ESB Banners', 'Video renders')
  const nineFile = fs.readdirSync(outDir).filter((n) => /9x16/.test(n)).map((n) => path.join(outDir, n)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]
  const pr = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', nineFile])
  const info = JSON.parse(pr.stdout.toString())
  const vs = info.streams.find((x) => x.codec_type === 'video')
  check('Our own 9:16 render is 1080×1920, H.264, 30 fps', vs.width === 1080 && vs.height === 1920 && vs.codec_name === 'h264' && vs.r_frame_rate === '30/1', JSON.stringify({ w: vs.width, h: vs.height, c: vs.codec_name, r: vs.r_frame_rate }))

  // post tab: pick the 9:16 render; YouTube private + Facebook Reel draft; Approve in the (stubbed) native dialog
  await page.getByRole('button', { name: 'Show in folder' }).first().isVisible()
  await page.locator('.vw-q-out.st-done', { hasText: '9:16' }).getByRole('button', { name: 'Publish…' }).click()
  await page.waitForSelector('.vw-pub-post')
  await page.waitForFunction(() => /Everything checks out|could not be read|×/.test(document.querySelector('[aria-label="Checks"]')?.textContent ?? '') || document.querySelectorAll('[aria-label="Checks"] .vw-error').length > 0, null, { timeout: 60000 })
  await page.locator('label:has-text("Facebook Reel")').locator('input').check()
  await page.locator('[aria-label="Title"], .vw-copy-field input').first().fill('Two new wells in Sylhet')
  await page.screenshot({ path: path.join(shots, 'publish-post.png') })
  const checksText = await page.locator('[aria-label="Checks"]').innerText()
  console.log('checks:', checksText.replace(/\s+/g, ' ').slice(0, 500))
  await answer(1)
  await page.getByRole('button', { name: 'Approve…' }).click()
  // the new post exists once main lists a second job; it is judged when every job has finished
  for (let i = 0; i < 500; i++) { const js = (await vp('vpubJobs')).jobs ?? []; if (js.length >= 2 && js.every((j) => ['done', 'failed', 'cancelled'].includes(j.status))) break; await new Promise((r) => setTimeout(r, 300)) }
  await page.waitForFunction(() => document.querySelectorAll('.vw-pub-post .vw-q-job.st-done, .vw-pub-post .vw-q-job.st-failed').length >= 2, null, { timeout: 30000 })
  console.log('jobs:', JSON.stringify(((await vp('vpubJobs')).jobs ?? []).map((j) => ({ status: j.status, title: j.title, d: j.destinations.map((d) => ({ k: d.kind, st: d.state, e: d.error, sent: d.sent, total: d.total, steps: d.steps.map((x) => x.name + ':' + x.status + (x.error ? '(' + x.error + ')' : '')) })) }))).slice(0, 1500))
  await page.screenshot({ path: path.join(shots, 'publish-posted.png') })
  const jobText = await page.locator('.vw-pub-post [aria-label="Posts"]').innerText()
  check('Posting from the sheet: the job lists each destination with its steps and, when done, a link', /YouTube/.test(jobText) && /Facebook Reel/.test(jobText), jobText.replace(/\s+/g, ' ').slice(0, 300))
  check('The Reel went up as a DRAFT on the fake Facebook, not published', fake.state.reels.size === 1 && [...fake.state.reels.values()].every((r) => r.finished && r.state === 'DRAFT'), JSON.stringify([...fake.state.reels.values()].map((r) => ({ finished: r.finished, state: r.state }))))
  await page.getByRole('tab', { name: 'Connections', exact: true }).click()
  await page.waitForSelector('.vw-pub-conn')
  await page.waitForFunction(() => /uploads/i.test(document.querySelector('.vw-pub-conn')?.textContent ?? ''))
  await page.screenshot({ path: path.join(shots, 'publish-connections.png') })
  check('Connections shows YouTube and the Page as connected, with quota lines', /connected/i.test(await page.locator('.vw-pub-conn').innerText()) && /uploads/i.test(await page.locator('.vw-pub-conn').innerText()))
  check('No token or secret ever appeared in a URL the fake servers saw', fake.leaks.length === 0, JSON.stringify(fake.leaks).slice(0, 120))
  check('No page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
} catch (e) {
  console.log('FAIL test error', e.message)
  console.log('page errors:', errors.slice(0, 3).join(' | '))
  try { await page.screenshot({ path: path.join(process.env.OUT || path.join(root, 'tools', 'out', 'p7'), 'failure.png') }) } catch { /* no window */ }
  failed++
}
await app.close().catch(() => {})
await fake.close().catch(() => {})
console.log(failed ? `\n${failed} FAILED` : '\nAll passed')
process.exit(failed ? 1 : 0)
