// Export, end to end in the desktop app: the Export dialog, the quick-export menu and the Editorial desk's Export PNG
// must each write real PNG files. The OS folder/save dialogs are answered with a temp folder.
// Run on Linux under `xvfb-run -a`. Needs a fresh `npm run build`.
import { _electron as electron } from 'playwright-core'
import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os'
const root = path.resolve(import.meta.dirname, '..')
const win = process.platform === 'win32'
let failed = 0
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-profile-'))
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-export-'))
const app = await electron.launch({ executablePath: path.join(root, 'node_modules', 'electron', 'dist', win ? 'electron.exe' : 'electron'), args: [...(win ? [] : ['--no-sandbox']), root, '--user-data-dir=' + profile] })
const page = await app.firstWindow()
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
try {
  await page.waitForSelector('.topbar', { timeout: 20000 }); await page.waitForTimeout(800)
  // the OS dialogs answer with a temp folder / file, as a user picking a place would
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
    dialog.showSaveDialog = async (_w, o) => ({ canceled: false, filePath: require('node:path').join(dir, (o && o.defaultPath ? require('node:path').basename(o.defaultPath) : 'single.png')) })
  }, outDir)
  await page.click('.split > .btn.primary:not(.split-caret)')
  await page.waitForSelector('.dialog', { timeout: 5000 })
  const btn = page.locator('.dialog footer .btn.primary')
  console.log('dialog button:', await btn.innerText())
  await btn.click()
  await page.waitForTimeout(4000)
  const files = fs.readdirSync(outDir)
  if (files.length < 2) failed++
  console.log(files.length >= 2 ? 'PASS' : 'FAIL', 'Graphics export wrote', files.join(', '))
  for (const f of files) { const b = fs.readFileSync(path.join(outDir, f)); console.log('  ', f, b.length, 'bytes', b.subarray(1, 4).toString()) }
  // quick menu: this banner only
  await page.keyboard.press('Escape').catch(() => {})
  const snap = () => Object.fromEntries(fs.readdirSync(outDir).map((f) => [f, fs.statSync(path.join(outDir, f)).mtimeMs]))
  const before = snap()
  await page.waitForTimeout(1100)
  await page.click('.split-caret'); await page.click('.menu-item:has-text("Quick: this banner only")')
  await page.waitForTimeout(3500)
  const after = snap()
  const changed = Object.keys(after).filter((f) => after[f] !== before[f])
  if (!changed.length) failed++
  console.log(changed.length ? 'PASS' : 'FAIL', 'Quick export (this banner only) wrote', changed.join(', ') || 'nothing', '| dialog open:', await page.locator('.dialog').count())
  // Editorial → Outputs → Export PNG (one file, through the save dialog)
  await page.evaluate(() => { window.__customTranslator = async (t) => t.replace(/[\u0980-\u09FF]+/g, 'gas') })
  await page.click('.ws-btn[data-ws="editorial"]')
  await page.click('button:has-text("Paste Bengali Story")')
  await page.fill('.ed-paste-area', 'সিলেটে দুটি নতুন কূপ\nপ্রকল্পটিতে মোট ৫৯২ কোটি টাকা ব্যয় হবে।')
  await page.click('button:has-text("Auto-Translate & Populate")')
  await page.waitForSelector('.ed-card-story', { timeout: 30000 })
  await page.click('[data-panel="ed-outputs"] > header')
  const b2 = snap()
  await page.waitForTimeout(1100)
  await page.click('.ed-outputs button:has-text("Export PNG")')
  await page.waitForTimeout(3500)
  const a2 = snap()
  const changed2 = Object.keys(a2).filter((f) => a2[f] !== b2[f])
  if (!changed2.length) failed++
  console.log(changed2.length ? 'PASS' : 'FAIL', 'Editorial Export PNG wrote', changed2.join(', ') || 'nothing')
  console.log('errors:', errs.length ? errs.slice(0, 5) : 'none')
} catch (e) { failed++; console.log('FAIL', e.message) } finally { await app.close() }
process.exit(failed ? 1 : 0)
