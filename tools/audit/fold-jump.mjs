// Per frame while a column folds and opens: does anything move vertically? (DESK, SIDE, COL = the column selector)
import { _electron as electron } from 'playwright-core'
import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os'
const root = path.resolve(import.meta.dirname, '../..')
const desk = process.env.DESK || 'graphics', side = process.env.SIDE || 'left'
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root, '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'esb-fj-'))], env: { ...process.env, ESB_NO_SYNC: '1' } })
const page = await app.firstWindow(); page.setDefaultTimeout(20000)
await app.evaluate(({ BrowserWindow }) => { const b = BrowserWindow.getAllWindows()[0]; b.setContentSize(1440, 860); if (b.isMinimized()) b.restore(); b.showInactive() })
await page.waitForSelector('.launch-tile'); await page.evaluate((d) => [...document.querySelectorAll('.launch-tile')].find((x) => x.textContent.toLowerCase().includes(d))?.click(), desk); await page.waitForTimeout(1800)
const run = () => page.evaluate((side) => new Promise((res) => {
  const fold = document.querySelector(`.desk-slot.is-active .col-fold.${side}`)
  const col = fold.parentElement
  const watch = [...col.children].filter((c) => !c.classList.contains('col-fold') && !c.classList.contains('col-handle')).slice(0, 4)
  const deep = [col.querySelector('.side-tabs'), col.querySelector('.pnl, .or-card, .nw-card')].filter(Boolean)
  const rows = []
  const t0 = performance.now()
  fold.click()
  const f = () => {
    rows.push([Math.round(performance.now() - t0), Math.round(col.getBoundingClientRect().top), Math.round(col.getBoundingClientRect().width), ...deep.map((e) => Math.round(e.getBoundingClientRect().top)), ...watch.map((e) => (e.className || e.tagName).toString().split(' ')[0] + ':' + Math.round(e.getBoundingClientRect().top))].join(' '))
    if (performance.now() - t0 < 600) requestAnimationFrame(f); else res(rows)
  }
  requestAnimationFrame(f)
}), side)
console.log('FOLD'); console.log((await run()).join('\n'))
await page.waitForTimeout(500)
console.log('OPEN'); console.log((await run()).join('\n'))
await app.close()
