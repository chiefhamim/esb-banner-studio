// The real renderer (Electron, headed scrollbars): open a pasted story on Editorial, shoot it, and film a column fold.
// Usage: npm run build && node tools/audit/electron-story.mjs  → artifacts/electron/*.png   (THEME=dark|light, W/H = window size)
import { _electron as electron } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
const root = path.resolve(import.meta.dirname, '../..')
const out = path.join(root, 'artifacts', 'electron'); fs.mkdirSync(out, { recursive: true })
const win = process.platform === 'win32'
const exe = path.join(root, 'node_modules', 'electron', 'dist', win ? 'electron.exe' : 'electron')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-el-'))
const theme = process.env.THEME || 'dark'
const W = Number(process.env.W || 1440), H = Number(process.env.H || 900)
const paras = ['৫৯২ কোটি টাকায় দুটি নতুন কূপ খনন করবে পেট্রোবাংলা', ...Array.from({ length: 14 }, (_, i) => `সিলেট গ্যাস ফিল্ডের আওতায় দুটি নতুন উন্নয়ন কূপ খননের উদ্যোগ নিয়েছে পেট্রোবাংলা ও বাপেক্স। অনুচ্ছেদ ${i + 1}।`)]
const app = await electron.launch({ executablePath: exe, args: [...(win ? [] : ['--no-sandbox']), root, '--user-data-dir=' + profile], env: { ...process.env, ESB_NO_SYNC: '1' } })
const page = await app.firstWindow()
page.setDefaultTimeout(20000)
await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [W, H])
await page.addInitScript(() => { window.__customTranslator = async (t) => 'Petrobangla will drill two new wells at Tk 592 crore, adding 30 MMCFD of gas to the national grid. ' + t.length })
await page.evaluate((t) => localStorage.setItem('esb-banner-studio/theme', t), theme)
await page.reload(); await page.waitForTimeout(1200)
const shot = async (n, clip) => { await page.screenshot({ path: path.join(out, `${n}-${theme}.png`), ...(clip ? { clip } : {}) }); console.log('shot', n) }
const go = async (label) => { await page.evaluate((l) => [...document.querySelectorAll('.ws-btn, .launch-tile, button')].find((x) => new RegExp(l).test(x.getAttribute('aria-label') || x.textContent || ''))?.click(), label); await page.waitForTimeout(900) }
await shot('home')
await go('Editorial')
await page.click('button:has-text("Paste Text or File")'); await page.fill('.ed-paste-area', paras.join('\n')); await page.click('button:has-text("Process Story")')
await page.waitForSelector('.ed-card-story', { timeout: 40000 }); await page.waitForTimeout(2200)
await shot('story')
console.log(JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.ed-head > *, .ed-head .ed-head-group > *')].map(e => { const r = e.getBoundingClientRect(); return (e.className || e.tagName).toString().slice(0, 60) + ' x' + Math.round(r.left) + '-' + Math.round(r.right) + ' "' + (e.textContent || '').trim().slice(0, 24) + '"' }))))
await shot('story-head', { x: 0, y: 0, width: W, height: 46 })
// the Going-to-press countdown: armed, filmed mid-way, then CANCELLED (nothing is ever published by this script)
await page.click('.ed-head button:has-text("Publish")'); await page.waitForSelector('.dialog'); await page.waitForTimeout(600)
await page.click('.dialog .btn.primary:has-text("Publish")'); await page.waitForTimeout(2300)
await shot('countdown')
await page.keyboard.press('Escape'); await page.waitForTimeout(400)
console.log('countdown cancelled:', await page.locator('.gp-overlay').count() === 0)
await page.keyboard.press('Escape'); await page.waitForTimeout(400)
await shot('story-edge-center', { x: W - 420, y: 300, width: 120, height: 280 })
await shot('story-edge-window', { x: W - 120, y: 300, width: 120, height: 280 })
for (const d of ['Graphics', 'News', 'Outreach', 'Video']) { await go(d); await shot('desk-' + d.toLowerCase()) }
await go('Editorial'); await page.waitForTimeout(500)
// fold film: fold the left column and capture a frame as fast as the screenshotter allows
const frames = []
await page.evaluate(() => document.querySelector('.col-handle').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
for (let i = 0; i < 9; i++) { const t = Date.now(); await page.screenshot({ path: path.join(out, `fold-${theme}-${i}.png`), clip: { x: 0, y: 44, width: 460, height: 360 } }); frames.push(Date.now() - t) }
console.log('frame costs ms', frames.join(','))
await app.close()
