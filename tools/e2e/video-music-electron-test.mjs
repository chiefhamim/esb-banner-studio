// Phase 4 Part B: the music library in the desktop app (dist/ + Electron). The owner chooses ONE folder in main's dialog
// (stubbed here); the library lists only that folder's audio, and main's IPC refuses every path outside it: traversal,
// absolute paths, a junction leading out, non-audio files. Read-only. Needs a fresh `npm run build`.
import { _electron as electron } from 'playwright-core'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const root = path.resolve(import.meta.dirname, '../..')
const win = process.platform === 'win32'
const exe = path.join(root, 'node_modules', 'electron', 'dist', win ? 'electron.exe' : 'electron')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'p4b-profile-'))
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'p4b-music-'))
const OUT = process.env.OUT || path.join(root, 'tools', 'out', 'p4b')
fs.mkdirSync(OUT, { recursive: true })
let failed = 0
const check = (label, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${info}`); if (!ok) failed++ }

const lib = path.join(base, 'ESB licensed music')
const secret = path.join(base, 'secret')
fs.mkdirSync(path.join(lib, 'Calm'), { recursive: true })
fs.mkdirSync(secret)
const tone = (f, hz) => { const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${hz}:sample_rate=48000:duration=3`, f]); if (r.status !== 0) throw new Error(String(r.stderr)) }
const LONG = 'অত্যন্ত দীর্ঘ বাংলা গানের নাম যেটি অনেক লম্বা [শান্ত, ধীর]'
tone(path.join(lib, 'Morning Drive [upbeat, tech].wav'), 330)
tone(path.join(lib, `${LONG}.wav`), 440)
tone(path.join(lib, 'Calm', 'Piano.wav'), 220)
fs.writeFileSync(path.join(lib, 'notes.txt'), 'not audio')
tone(path.join(secret, 'private.wav'), 880)
let junction = true
try { fs.symlinkSync(secret, path.join(lib, 'linkout'), 'junction') } catch { junction = false }

const app = await electron.launch({ executablePath: exe, args: [...(win ? [] : ['--no-sandbox']), root, '--user-data-dir=' + profile], env: { ...process.env, ESB_NO_SYNC: '1' } })
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.setDefaultTimeout(30000)
await page.setViewportSize({ width: 1366, height: 820 }).catch(() => {})
await app.evaluate(({ dialog }, dir) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] }) }, lib)
await page.waitForSelector('.home-shell, .topbar')
try {
  await page.click('.launch-tile:has-text("Video")')
  await page.waitForSelector('.video-workspace')
  await page.click('.vw-bin-panel [role=tab]:has-text("Audio")')
  await page.waitForSelector('.vw-au-choose')
  check('before choosing, the library lists nothing and asks for a folder (no bundled music)', (await page.locator('.vw-au-track').count()) === 0 && /ships no music/i.test(await page.locator('.vw-au-lib').innerText()))
  await page.click('.vw-au-choose')
  await page.waitForSelector('.vw-au-track')
  const rels = await page.$$eval('.vw-au-track', (rows) => rows.map((r) => r.dataset.rel))
  check('the library lists exactly the audio files inside the chosen folder', rels.length === 3 && rels.includes('Calm/Piano.wav') && !rels.some((r) => /notes|private|linkout/.test(r)), JSON.stringify(rels))
  const titles = await page.$$eval('.vw-au-title', (t) => t.map((x) => x.textContent))
  check('titles and tags come from the file names (brackets, folders)', titles.includes('Morning Drive') && titles.some((t) => t.startsWith('অত্যন্ত')) && (await page.locator('.vw-au-tag', { hasText: 'upbeat' }).count()) === 1 && (await page.locator('.vw-au-tag', { hasText: 'Calm' }).count()) === 1, JSON.stringify(titles))

  const r = await page.evaluate(async ([secretFile, junctionOk]) => {
    const e = window.esb
    const tryUse = async (rel) => { try { const x = await e.videoMusicUse(rel); return x ? 'ALLOWED' : 'null' } catch { return 'refused' } }
    return {
      ok: await tryUse('Calm/Piano.wav'),
      traversal: await tryUse('../secret/private.wav'),
      deep: await tryUse('Calm/../../secret/private.wav'),
      absolute: await tryUse(secretFile),
      drive: await tryUse('C:/Windows/win.ini'),
      unc: await tryUse('//host/share/x.wav'),
      notAudio: await tryUse('notes.txt'),
      junction: junctionOk ? await tryUse('linkout/private.wav') : 'skipped',
      list: (await e.videoMusicList()).files.map((f) => f.rel),
    }
  }, [path.join(secret, 'private.wav'), junction])
  check('a file inside the folder is allowed', r.ok === 'ALLOWED')
  check('IPC refuses traversal, absolute, drive and UNC paths', r.traversal === 'refused' && r.deep === 'refused' && r.absolute === 'refused' && r.drive === 'refused' && r.unc === 'refused', JSON.stringify(r))
  check('IPC refuses a non-audio file and a junction leading out of the folder', r.notAudio === 'refused' && (r.junction === 'refused' || r.junction === 'skipped'), `junction=${r.junction}`)
  check('the list never includes the file behind the junction', !r.list.some((x) => /private|linkout/.test(x)))
  const served = await page.evaluate(async () => { const x = await window.esb.videoMusicUse('Calm/Piano.wav'); const rs = await fetch(x.url, { headers: { Range: 'bytes=0-15' } }); return rs.status })
  check('a registered track plays through esb-media (range request)', served === 206 || served === 200, String(served))

  await page.locator('.vw-au-track', { hasText: 'Morning Drive' }).locator('.vw-au-add').click()
  await page.waitForSelector('.vw-clip-block[data-clip-kind="audio"]')
  const track = await page.$$eval('.vw-track-head .vw-th-title', (s) => s.map((x) => x.textContent))
  check('Add puts the track on a Music audio track', track.some((t) => /Music/.test(t)), JSON.stringify(track))
  await page.locator('.vw-au-track', { hasText: 'Morning Drive' }).locator('.vw-au-lic-btn').click()
  await page.fill('.vw-au-lic', 'Licensed to ESB, invoice 123 (test note)')
  check('a licence note can be typed for the track', /invoice 123/.test(await page.inputValue('.vw-au-lic')))
  await page.screenshot({ path: path.join(OUT, 'library-electron.png') })
  const folder = await page.evaluate(() => window.esb.videoMusicFolder())
  check('main remembers the chosen folder', folder?.name === 'ESB licensed music')
  await page.click('.vw-au-lib-acts .vw-au-forget')
  await page.waitForSelector('.vw-au-choose')
  const after = await page.evaluate(async () => ({ f: await window.esb.videoMusicFolder(), u: await window.esb.videoMusicUse('Calm/Piano.wav').then(() => 'ALLOWED', () => 'refused') }))
  check('forgetting the folder closes access', after.f === null && after.u === 'refused', JSON.stringify(after))
  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
} catch (e) {
  console.error('FAIL crashed:', e?.stack || e)
  failed++
} finally {
  await app.close().catch(() => {})
}
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
