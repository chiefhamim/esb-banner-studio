// Fold film for any desk: frame pacing + a strip of frames while a column folds and opens (real renderer).
// Usage: DESK=news SIDE=left node tools/audit/electron-fold-film.mjs  → artifacts/fold-film/<desk>-<side>-*.png
import { _electron as electron } from 'playwright-core'
import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os'
const root = path.resolve(import.meta.dirname, '../..')
const desk = process.env.DESK || 'news', side = process.env.SIDE || 'left'
const out = path.join(root, 'artifacts', 'fold-film'); fs.mkdirSync(out, { recursive: true })
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root, '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'esb-ff-'))], env: { ...process.env, ESB_NO_SYNC: '1' } })
const page = await app.firstWindow(); page.setDefaultTimeout(30000)
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 860))
await page.evaluate(() => localStorage.setItem('esb-banner-studio/theme', 'dark')); await page.reload(); await page.waitForTimeout(1500)
await page.evaluate((i) => { const b = document.querySelector('.ws-btn[data-ws="' + i + '"]') || [...document.querySelectorAll('.home-shell button, .launch-tile')].find((x) => (x.textContent || '').trim().toLowerCase().startsWith(i)); b?.click() }, desk)
await page.waitForTimeout(Number(process.env.WAIT || (desk === 'news' ? 6000 : 1500)))
const sel = `.desk-slot.is-active .col-fold.${side}`
const measure = () => page.evaluate((s) => new Promise((res) => {
  const d = []; let last = performance.now(); const t0 = last
  const col = document.querySelector(s).parentElement
  const widths = []
  document.querySelector(s).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); document.querySelector(s).click()
  const f = (n) => { d.push(n - last); last = n; widths.push(Math.round(col.getBoundingClientRect().width)); if (n - t0 < 650) requestAnimationFrame(f); else res({ worst: Math.max(...d).toFixed(1), drops: d.filter((x) => x > 16).length, n: d.length, widths: widths.filter((_, i) => i % 3 === 0).join(' ') }) }
  requestAnimationFrame(f)
}), sel)
if (process.env.TRACE) {
  const cdp = await page.context().newCDPSession(page); const events = []
  cdp.on('Tracing.dataCollected', (e) => events.push(...e.value)); const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r))
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline', transferMode: 'ReportEvents' })
  await page.click(sel); await page.waitForTimeout(600)
  await cdp.send('Tracing.end'); await done
  const by = {}; for (const e of events) if (e.ph === 'X' && e.dur) by[e.name] = (by[e.name] || 0) + e.dur / 1000
  console.log('trace', Object.entries(by).filter(([k]) => !/RunTask|ThreadControllerImpl|Run|Task/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(' · '))
  const big = events.filter((e) => e.ph === 'X' && e.dur > 6000 && !/Task|Run/.test(e.name)).map((e) => `${e.name} ${(e.dur / 1000).toFixed(1)}${e.args?.beginData?.dirtyObjects ? ' dirty=' + e.args.beginData.dirtyObjects : ''}${e.args?.elementCount ? ' els=' + e.args.elementCount : ''}${e.args?.data?.url ? ' @' + e.args.data.url.split('/').pop() + ':' + e.args.data.lineNumber + ':' + e.args.data.columnNumber : ''}${e.args?.data?.timerId ? ' timer' : ''}`)
  console.log('big', big.slice(0, 20).join(' | '))
  await page.click(sel); await page.waitForTimeout(700)
}
console.log('fold ', JSON.stringify(await measure())); await page.waitForTimeout(700)
console.log('open ', JSON.stringify(await measure())); await page.waitForTimeout(700)
await page.click(sel)
for (let i = 0; i < 8; i++) await page.screenshot({ path: path.join(out, `${desk}-${side}-${i}.png`), clip: side === 'left' ? { x: 0, y: 40, width: 520, height: 330 } : { x: 920, y: 40, width: 520, height: 330 } })
await app.close()
