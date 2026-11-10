// Each fold button against the ROW it sits in (the element whose box contains its centre line, beside it): vertical
// centre offset, and its inset from the panel/card edge versus that row's own content inset.
import { _electron as electron } from 'playwright-core'
import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os'
const root = path.resolve(import.meta.dirname, '../..')
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root, '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'esb-fr-'))], env: { ...process.env, ESB_NO_SYNC: '1' } })
const page = await app.firstWindow(); page.setDefaultTimeout(20000)
await app.evaluate(({ BrowserWindow }) => { const b = BrowserWindow.getAllWindows()[0]; b.setContentSize(1600, 950); if (b.isMinimized()) b.restore(); b.showInactive() })
await page.waitForSelector('.launch-tile')
const go = async (d) => { await page.evaluate((d) => { const t = [...document.querySelectorAll('.launch-tile')].find((x) => x.textContent.includes(d)); if (t) t.click(); else document.querySelector(`.desk-slot.is-active .ws-btn[data-ws="${d.toLowerCase()}"]`)?.click() }, d); await page.waitForTimeout(1300) }
const probe = (sel) => page.evaluate((sel) => [...document.querySelectorAll(`.desk-slot.is-active ${sel}`)].map((pair) => {
  const [foldSel, rowSel] = pair.split('|')
  return null
}), sel)
const rows = {
  graphics: [['.app > .left > .col-fold', '.app > .left > .side-tabs'], ['.app > .right .col-fold', '.app > .right .pnl:first-child > header']],
  news: [['.nw-left > .col-fold', '.nw-left > .nw-brandbar, .nw-left > :first-child:not(.col-fold)'], ['.nw-right > .col-fold', '.nw-right .nw-detail-top']],
  outreach: [['.or-left > .col-fold', '.or-left > .side-tabs'], ['.or-right > .col-fold', '.or-right > .side-tabs']],
  video: [['.vw-bin-panel > .col-fold', '.vw-bin-panel > .side-tabs'], ['.vw-inspector-panel > .col-fold', '.vw-ih-row']],
  editorial: [['.ed-src > .col-fold', '.ed-src > .side-tabs'], ['.ed-side .col-fold', '.ed-side .es-status']],
}
for (const d of ['Graphics', 'News', 'Outreach', 'Video', 'Editorial']) {
  await go(d)
  if (d === 'Video') { await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }) }, path.join(root, 'tools/fixtures/video/speech-6s.mp4')); await page.click('.desk-slot.is-active .vw-start-import'); await page.waitForSelector('.vw-media-card'); await page.click('.vw-media-card .vw-add'); await page.waitForTimeout(600); await page.click('.vw-clip-block'); await page.waitForTimeout(500) }
  if (d === 'Editorial') { await page.click('button:has-text("Paste Text or File")'); await page.fill('.ed-paste-area', 'সিলেট গ্যাস ফিল্ডের আওতায় দুটি নতুন উন্নয়ন কূপ খননের উদ্যোগ নিয়েছে পেট্রোবাংলা।\nদ্বিতীয় অনুচ্ছেদ।'); await page.click('button:has-text("Process Story")'); await page.waitForSelector('.ed-card-story', { timeout: 40000 }); await page.waitForTimeout(1200) }
  if (d === 'News') { await page.waitForTimeout(2000); await page.evaluate(() => document.querySelector('.desk-slot.is-active .nw-row')?.click()); await page.waitForTimeout(500) }
  for (const [f, r] of rows[d.toLowerCase()]) {
    const out = await page.evaluate(([f, r]) => {
      const fo = document.querySelector(`.desk-slot.is-active ${f}`), ro = document.querySelector(`.desk-slot.is-active ${r.split(', ')[0]}`) || document.querySelector(`.desk-slot.is-active ${r.split(', ')[1] || r}`)
      if (!fo || !ro) return 'missing ' + (!fo ? f : r)
      const a = fo.getBoundingClientRect(), b = ro.getBoundingClientRect(), p = fo.parentElement.getBoundingClientRect()
      const card = ro.closest('.pnl, .nw-card, .or-card')?.getBoundingClientRect()
      return `fold ${Math.round(a.width)}x${Math.round(a.height)} | row ${Math.round(b.height)}h dCentreY ${((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2).toFixed(1)} | gap to row ${Math.round(a.left > b.right ? a.left - b.right : b.left - a.right)} | inset L${Math.round(a.left - (card ?? p).left)} R${Math.round((card ?? p).right - a.right)} T${Math.round(a.top - (card ?? p).top)}${card ? ' (card)' : ' (panel)'}`
    }, [f, r])
    console.log(d.padEnd(9), f.padEnd(28), out)
  }
}
await app.close()
