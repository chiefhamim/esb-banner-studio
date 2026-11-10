// Every fold button against what sits beside it: centre offset to the row it shares, gap to its neighbour, inset from
// its panel's edges. Shoots a crop of each. Usage: npm run build && node tools/audit/fold-geometry.mjs (THEME, W, H)
import { _electron as electron } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
const root = path.resolve(import.meta.dirname, '../..')
const out = path.join(root, 'artifacts', 'pass10', 'folds'); fs.mkdirSync(out, { recursive: true })
const exe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-fg-'))
const theme = process.env.THEME || 'dark'
const W = Number(process.env.W || 1600), H = Number(process.env.H || 950)
const speech = path.join(work, 'speech-6s.mp4'); fs.copyFileSync(path.join(root, 'tools/fixtures/video/speech-6s.mp4'), speech)
const app = await electron.launch({ executablePath: exe, args: [root, '--user-data-dir=' + path.join(work, 'p')], env: { ...process.env, ESB_NO_SYNC: '1', ESB_OUTREACH_DRYRUN: '1' } })
const page = await app.firstWindow()
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }) }, speech)
await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [W, H])
await page.evaluate((t) => localStorage.setItem('esb-banner-studio/theme', t), theme); await page.reload()
await page.waitForSelector('.launch-tile')
const restore = () => app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w.isMinimized()) { w.showInactive(); w.restore() } })
const go = async (l) => { await page.evaluate((l) => [...document.querySelectorAll('.ws-btn, .launch-tile, button')].find((x) => new RegExp('^' + l).test((x.getAttribute('aria-label') || x.textContent || '').trim()))?.click(), l); await page.waitForTimeout(1200) }
const report = async (desk) => {
  await restore()
  const rows = await page.evaluate(() => {
    const act = document.querySelector('.desk-slot.is-active') || document
    return [...act.querySelectorAll('.col-fold')].filter((f) => f.offsetParent).map((f) => {
      const r = f.getBoundingClientRect(); const panel = f.parentElement; const p = panel.getBoundingClientRect()
      // the neighbour = the visible element (not the fold, not the handle) in the panel whose box overlaps the fold's row and is closest horizontally
      const cands = [...panel.querySelectorAll('*')].filter((e) => e !== f && !f.contains(e) && !e.closest('.col-fold, .col-handle, .col-rail') && e.offsetParent && e.children.length >= 0).map((e) => ({ e, b: e.getBoundingClientRect() }))
        .filter(({ b }) => b.height >= 20 && b.height <= 60 && b.top < r.bottom && b.bottom > r.top && (b.right <= r.left + 1 || b.left >= r.right - 1))
      cands.sort((a, b) => Math.min(Math.abs(a.b.right - r.left), Math.abs(a.b.left - r.right)) - Math.min(Math.abs(b.b.right - r.left), Math.abs(b.b.left - r.right)))
      const n = cands[0]
      const nb = n?.b
      return {
        fold: `${f.className} ${Math.round(r.width)}x${Math.round(r.height)} @${Math.round(r.left)},${Math.round(r.top)}`,
        panel: `${(panel.className || '').toString().slice(0, 40)} top+${Math.round(r.top - p.top)} left+${Math.round(r.left - p.left)} right+${Math.round(p.right - r.right)}`,
        neighbour: n ? `${(n.e.className || n.e.tagName).toString().slice(0, 40)} ${Math.round(nb.width)}x${Math.round(nb.height)} gap ${Math.round(nb.right <= r.left + 1 ? r.left - nb.right : nb.left - r.right)} dCentre ${Math.round(((nb.top + nb.bottom) - (r.top + r.bottom)) / 2 * 10) / 10} dH ${Math.round(nb.height - r.height)}` : 'none',
        clip: { x: Math.max(0, r.left - 160), y: Math.max(0, r.top - 30), width: 320, height: 100 },
      }
    })
  })
  for (const [i, r] of rows.entries()) { console.log(desk.padEnd(10), r.fold, '|', r.panel, '|', r.neighbour); await page.screenshot({ path: path.join(out, `${desk}-${i}-${theme}.png`), clip: r.clip }) }
}
await go('Graphics'); await report('graphics')
await go('News'); await page.waitForTimeout(2500); await page.evaluate(() => document.querySelector('.nw-row')?.click()); await page.waitForTimeout(600); await report('news')
await go('Outreach'); await report('outreach')
await go('Editorial'); await report('editorial')
await go('Video'); await page.click('.vw-start-import'); await page.waitForSelector('.vw-media-card'); await page.click('.vw-media-card .vw-add'); await page.waitForTimeout(800)
await page.click('.vw-clip-block'); await page.waitForTimeout(500); await report('video')
await app.close()
